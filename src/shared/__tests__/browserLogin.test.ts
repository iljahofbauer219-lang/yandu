import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LOGIN_WORDLISTS, challengeRegexSource, loginRegexSource } from '../browserChallenge'
import type { ChallengeFamily, LoginWordlistFamily } from '../browserChallenge'

/**
 * C 批「统一挑战词表」的登录侧：只做**原样归位**，不做合并。
 * 三组供应站登录词表字面量互不相同（4／4／7 词），eBay 侧另有路径哨兵；把它们并成一张就是改登录判定口径，
 * 而「不改 eBay OAuth、凭据存储与登录判定口径」是硬约束，故此处仅把散落硬编码搬进 shared，字面量逐字锁死。
 * 唯一的非字面量差异：原先 5 处写成 /signin|login/（跑在已小写化的串上），归一后带 i 标志；
 * 判定结果集相同，单测用同一批样本对账两种写法。
 */
const PRE_MIGRATION_LITERALS = {
  SUPPLY_ACCOUNT: '/account\\/login|请登录|重新登录|登录已失效/i',
  SUPPLY_1688: '/login\\.1688\\.com|请登录|重新登录|登录已失效/i',
  SUPPLY_FULL: '/route=account\\/login|login\\.1688\\.com|account\\/login|请登录|重新登录|登录已失效|sign in to continue/i',
  EBAY_PATH: '/signin|login/i',
} as const

/**
 * 已知遗留：C 批范围外的注入脚本缺陷，逐条锁死防止再新增；修它等于改那条采集通道的行为，需单独授权。
 * - x-oss-signature：供应站下载链接四通道并收里的「全页扫描」，模板里圆括号多闭一个，页面侧直接 SyntaxError，
 *   被外层 try/catch 吞成 probeLog 里的一条 error，通道长期空转。
 * 身份用代码片段而非行号：行号会随类成员增删漂移，片段才指向那条脚本本身。
 */
const KNOWN_BROKEN_MARKERS = ['x-oss-signature']

/** 按 JS 模板字面量的真实语义把每处 executeJavaScript 的入参还原成运行时字符串。 */
function extractInjectedScripts(source: string): Array<{ line: number; code: string }> {
  const sites: Array<{ line: number; code: string }> = []
  const CALL = 'executeJavaScript('
  for (let cursor = source.indexOf(CALL); cursor !== -1;) {
    const open = cursor + CALL.length
    const lead = /^\s*(String\.raw\s*)?`/.exec(source.slice(open))
    if (!lead) { cursor = source.indexOf(CALL, open); continue }
    let i = open + lead[0].length
    const raw = Boolean(lead[1])
    let code = ''
    let literalStart = i
    while (i < source.length) {
      const ch = source[i]
      if (ch === '\\') { i += 2; continue }
      if (ch === '`') break
      if (ch === '$' && source[i + 1] === '{') {
        code += cook(source.slice(literalStart, i), raw)
        const close = matchBrace(source, i + 1)
        const expr = source.slice(i + 2, close).trim()
        const challenge = /^challengeRegexSource\(\s*'([A-Z0-9_]+)'\s*\)$/.exec(expr)
        const login = /^loginRegexSource\(\s*'([A-Z0-9_]+)'\s*\)$/.exec(expr)
        if (challenge) code += challengeRegexSource(challenge[1] as ChallengeFamily)
        else if (login) code += loginRegexSource(login[1] as LoginWordlistFamily)
        else {
          // 其余插值依赖主进程局部变量，离线无法求值；用 X 占位保持语法位
          if (/RegexSource\(/.test(expr)) throw new Error(`词表插值形式未被守卫识别：${expr}`)
          code += 'X'
        }
        i = close
        literalStart = i + 1
      }
      i += 1
    }
    code += cook(source.slice(literalStart, i), raw)
    sites.push({ line: source.slice(0, open).split('\n').length, code })
    cursor = source.indexOf(CALL, i + 1)
  }
  return sites
}

/** 字面块里没有插值、反引号都已转义，交给 JS 自己按模板语义 cook，转义折叠（含 \/ → /）零偏差。 */
function cook(literal: string, raw: boolean): string {
  return raw ? literal : new Function(`return \`${literal}\``)() as string
}

function matchBrace(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '\\') { i += 1; continue }
    if (ch === "'" || ch === '"' || ch === '`') {
      i += 1
      while (i < text.length && text[i] !== ch) { if (text[i] === '\\') i += 1; i += 1 }
      continue
    }
    if (ch === '{') depth += 1
    else if (ch === '}') { depth -= 1; if (depth === 0) return i }
  }
  throw new Error('插值花括号未闭合')
}

describe('登录词表原样归位（零判定变更）', () => {
  it('四族拼出的正则与迁移前内联字面量逐字一致', () => {
    for (const [family, literal] of Object.entries(PRE_MIGRATION_LITERALS)) {
      expect(loginRegexSource(family as keyof typeof LOGIN_WORDLISTS), family).toBe(literal)
    }
  })

  it('四族仍各自独立，未被顺手合并', () => {
    expect(LOGIN_WORDLISTS.SUPPLY_1688).not.toContain('route=account\\/login')
    expect(LOGIN_WORDLISTS.SUPPLY_ACCOUNT).not.toContain('login\\.1688\\.com')
    expect(LOGIN_WORDLISTS.SUPPLY_FULL).not.toContain('确认是您本人')
    expect(LOGIN_WORDLISTS.EBAY_PATH).toEqual(['signin', 'login'])
  })

  it('eBay 路径哨兵：带 i 的字面量与原「小写串 + 不带 i」写法判定结果集相同', () => {
    const unified = new Function(`return ${loginRegexSource('EBAY_PATH')}`)() as RegExp
    const legacy = /signin|login/
    for (const raw of ['/signin', '/login', '/itm/1234', 'https://www.ebay.com/sh/lst/active', '/SignIn', '/LOGIN', 'my-login-page']) {
      const lowered = raw.toLowerCase()
      expect(unified.test(raw), raw).toBe(legacy.test(lowered))
    }
  })
})

describe('BrowserWorkspace 登录词表接线', () => {
  const source = readFileSync(new URL('../../main/browser/BrowserWorkspace.ts', import.meta.url), 'utf8')

  it('17 处登录哨兵全部引用 shared 词表', () => {
    expect((source.match(/loginRegexSource\('SUPPLY_ACCOUNT'\)/g) || []).length).toBe(1)
    expect((source.match(/loginRegexSource\('SUPPLY_1688'\)/g) || []).length).toBe(1)
    expect((source.match(/loginRegexSource\('SUPPLY_FULL'\)/g) || []).length).toBe(2)
    expect((source.match(/loginRegexSource\('EBAY_PATH'\)/g) || []).length).toBe(13)
  })

  it('迁移前的内联字面量不再散落在主进程源码里', () => {
    for (const literal of Object.values(PRE_MIGRATION_LITERALS)) expect(source).not.toContain(literal)
    expect(source).not.toMatch(/\/signin\|login\/i\.test\(/)
    expect(source).not.toMatch(/\|\|\/signin\|login\/\.test\(/)
  })

  it('eBay 侧 DOM 凭据输入框判定仍在原位（属 DOM 结构判定，不进词表）', () => {
    expect((source.match(/#userid,#pass,input\[type="password"\]/g) || []).length).toBeGreaterThanOrEqual(13)
  })

  it('卖家中心阶段判定与货源站离线判定刻意保留原写法（语义是阶段分类，不是登录失效判定）', () => {
    expect(source).toContain("else if(lowerUrl.includes('signin')||lowerUrl.includes('login'))phase='OFFLINE'")
    expect(source).toContain("const offline=Boolean(password)||lowerUrl.includes('route=account/login')")
  })

  it('注入脚本在运行时必须可解析（非 raw 模板里的 \\/ 会塌成非法正则）', () => {
    const sites = extractInjectedScripts(source)
    expect(sites.length).toBeGreaterThanOrEqual(50)
    const broken = sites.filter(site => {
      try { new Function(site.code); return false } catch { return true }
    })
    const unexplained = broken.filter(site => !KNOWN_BROKEN_MARKERS.some(marker => site.code.includes(marker)))
    expect(unexplained.map(site => `第${site.line}行：${site.code.slice(0, 100)}`), '新增运行时语法非法的注入脚本').toEqual([])
    for (const marker of KNOWN_BROKEN_MARKERS) {
      expect(broken.some(site => site.code.includes(marker)), `已知遗留缺陷「${marker}」状态已变，请同步 KNOWN_BROKEN_MARKERS`).toBe(true)
    }
  })

  it('守卫能抓到新增的非法注入脚本（否则已知遗留允许列表形同虚设）', () => {
    // 造一处真实塌陷形态：非 raw 模板里的 \/ 折叠成 /，正则变成未闭合
    const mutantSource = `${source}\nconst __mutant = view.webContents.executeJavaScript(\`/https:\\/\\/x/\`)\n`
    const broken = extractInjectedScripts(mutantSource).filter(site => {
      try { new Function(site.code); return false } catch { return true }
    })
    expect(broken.length).toBe(KNOWN_BROKEN_MARKERS.length + 1)
    expect(broken.some(site => site.code.includes('https://x'))).toBe(true)
  })

  it('引用了 shared 词表模块', () => {
    expect(source).toContain("loginRegexSource } from '../../shared/browserChallenge'")
  })
})
