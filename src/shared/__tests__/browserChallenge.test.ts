import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CHALLENGE_WORDLISTS, challengeRegexSource } from '../browserChallenge'

/**
 * C 批「统一挑战词表」口径：
 * 原 5 族按厂商各写一份（SUPPLY_RATE / SUPPLY_PUNISH / SUPPLY_PUNISH_RATE / EBAY / EBAY_INTERRUPT），词互缺，
 * 同一块风控门在 A 站能认、在 B 站被当正常页继续读，属判定口径分裂。现按「意图」重划两族：
 *   VERIFY      —— 安全验证 / 确认身份门（跨厂商并集）
 *   VERIFY_RATE —— 上述 + 限流频繁门（只给本来就把两类合并上报的站点）
 * 分族依据是站点分支语义，不是厂商：BrowserWorkspace:2777 那条「访问频繁→任务自动暂停」的独立分支必须留在 VERIFY 之外，
 * 否则并成一张表会让限流页先命中安全验证，用户被要求去做根本不存在的验证。
 * 刻意收紧：punish 只认 URL 形态（…/punish?x5secdata、…/punish.htm?…、结尾 /punish），
 * 因为统一后 eBay 站点也共用，裸词会把书名「Discipline and Punish」、The Punisher、punished 类正常文案判成风控门。
 */
const PRE_MIGRATION_FAMILIES: Record<string, string[]> = {
  SUPPLY_RATE: ['captcha', 'verify', '安全验证', '滑块', '验证码', '访问频繁', '操作异常', '请求过于频繁', 'too many requests'],
  SUPPLY_PUNISH: ['punish', 'captcha', 'verify', '安全验证', '滑块', '验证码', '访问频繁', '操作异常', '请求过于频繁', 'cloud_ip_bl'],
  SUPPLY_PUNISH_RATE: ['punish', 'captcha', 'verify', '安全验证', '滑块', '验证码', '访问频繁', '操作异常', '请求过于频繁', 'cloud_ip_bl', 'too many requests'],
  EBAY: ['captcha', 'security check', 'verification code', '验证码', '安全验证', '确认是您本人'],
  EBAY_INTERRUPT: ['captcha', 'security check', 'verification code', '验证码', '安全验证', '确认是您本人', 'pardon the interruption'],
}

/** 老族 → 新族：按站点分支语义归位，必须逐族是原词表的超集（只增不减） */
const FAMILY_REMAPPING: Record<string, 'VERIFY' | 'VERIFY_RATE'> = {
  SUPPLY_RATE: 'VERIFY_RATE',
  SUPPLY_PUNISH: 'VERIFY_RATE',
  SUPPLY_PUNISH_RATE: 'VERIFY_RATE',
  EBAY: 'VERIFY',
  EBAY_INTERRUPT: 'VERIFY',
}

const PUNISH_TOKEN = 'punish(?:[/?=&]|\\.htm|$)'

function pattern(family: 'VERIFY' | 'VERIFY_RATE'): RegExp {
  // 注入页面脚本里词表以正则字面量落地，这里按同样形式求值，保证拼出来的字面量本身就是可用正则
  return new Function(`return ${challengeRegexSource(family)}`)() as RegExp
}

describe('统一挑战词表（按意图分族）', () => {
  it('只有两族，且都不含重复词', () => {
    expect(Object.keys(CHALLENGE_WORDLISTS).sort()).toEqual(['VERIFY', 'VERIFY_RATE'])
    for (const words of Object.values(CHALLENGE_WORDLISTS)) expect(new Set(words).size).toBe(words.length)
  })

  it('VERIFY_RATE 是 VERIFY 的超集，多出的只有 4 条限流词', () => {
    const verify = CHALLENGE_WORDLISTS.VERIFY as readonly string[]
    const extra = (CHALLENGE_WORDLISTS.VERIFY_RATE as readonly string[]).filter(word => !verify.includes(word))
    expect(extra).toEqual(['访问频繁', '操作异常', '请求过于频繁', 'too many requests'])
  })

  it('每个老族的词都完整保留在归位后的新族里（punish 以 URL 形态保留）', () => {
    for (const [family, words] of Object.entries(PRE_MIGRATION_FAMILIES)) {
      const target = CHALLENGE_WORDLISTS[FAMILY_REMAPPING[family]] as readonly string[]
      for (const word of words) {
        const kept = target.some(entry => entry === word || (word === 'punish' && entry === PUNISH_TOKEN))
        expect(kept, `${family} 的词「${word}」在 ${FAMILY_REMAPPING[family]} 里丢了`).toBe(true)
      }
    }
  })

  it('跨站不再互缺：eBay 侧认中文验证门，供应站侧认英文确认身份门', () => {
    const list = pattern('VERIFY')
    expect(list.test('请完成安全验证，拖动滑块完成拼图')).toBe(true)
    expect(list.test('Pardon the interruption, we need to verify it is you')).toBe(true)
    expect(list.test('We performed a security check on this device')).toBe(true)
    expect(list.test('请确认是您本人后继续')).toBe(true)
    expect(list.test('https://x5sec.1688.com/_____tmd_____/punish?x5secdata=abc')).toBe(true)
  })

  it('限流门只在 VERIFY_RATE 里，VERIFY 不认（否则 :2777 的独立分支会被遮蔽）', () => {
    for (const text of ['Too many requests', '由于您的访问频繁，请刷新后重试', '请求过于频繁，请稍后再试']) {
      expect(pattern('VERIFY_RATE').test(text), text).toBe(true)
      expect(pattern('VERIFY').test(text), text).toBe(false)
    }
  })

  it('正常商品页文案放行；punish 不误判书名/Punisher/punished', () => {
    const list = pattern('VERIFY_RATE')
    expect(list.test('Pallets of mixed home goods, ships in 2 business days')).toBe(false)
    expect(list.test('Foucault, Discipline and Punish: Book Two, a classic')).toBe(false)
    expect(list.test('The Punisher movie box set, brand new')).toBe(false)
    expect(list.test('Account punished for policy violation, see order history')).toBe(false)
  })
})

describe('BrowserWorkspace 接线', () => {
  const source = readFileSync(new URL('../../main/browser/BrowserWorkspace.ts', import.meta.url), 'utf8')

  it('17 个判定站点全部引用 shared 词表：13 处 VERIFY、4 处 VERIFY_RATE', () => {
    expect((source.match(/challengeRegexSource\('VERIFY'\)/g) || []).length).toBe(13)
    expect((source.match(/challengeRegexSource\('VERIFY_RATE'\)/g) || []).length).toBe(4)
    expect((source.match(/challengeRegexSource\('(SUPPLY|EBAY)[A-Z_]*'\)/g) || []).length).toBe(0)
  })

  it('带独立限流分支的扫描站点用 VERIFY，不会被安全验证抢先命中', () => {
    expect(source).toMatch(/challengeRegexSource\('VERIFY'\)\}\.test\(bodyText\+' '\+pageUrl\)/)
    expect(source).toContain(`if(/too many requests|access denied|temporarily blocked|unusual traffic|访问频繁|请求过多|稍后再试/i.test(bodyText))return {issue:'eBay检测到访问频繁`)
  })

  it('迁移前五个老族的内联字面量不再出现在主进程源码里', () => {
    for (const words of Object.values(PRE_MIGRATION_FAMILIES)) expect(source).not.toContain(`/${words.join('|')}/i`)
  })

  it('两处刻意保留的站点仍在原位（DOM 结构混合判定与 Amazon 标题判定，语义不同不予合并）', () => {
    expect(source).toContain('/captcha|verify|security check|verification code|验证码|安全验证|邮箱验证|短信验证|访问频繁|too many requests/i')
    expect(source).toContain('/captcha|robot check/i')
  })

  it('引用了 shared 词表模块', () => {
    expect(source).toContain("from '../../shared/browserChallenge'")
  })
})
