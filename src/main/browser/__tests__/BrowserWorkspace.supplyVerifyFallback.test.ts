import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 用户口径（2026-11-28 截图）：已登录大健云仓（AI采集页签红框可见 Hi 账号）但点「下载图文」仍弹
 * 「需要安全验证」。根因两类：①隐藏窗深链新导航被风控拦截而可见页签正常；②已登录正常页文本/URL
 * 误命中 VERIFY_RATE 裸词（无商品数据上下文约束）。
 * 修复：判定加商品数据上下文（有 单价/可售库存/产品规格 等即非验证页）；隐藏窗仍报 VERIFY 时回落
 * 同 partition 已登录可见供应页签（openSupplyUrl 原址同通道）复抓；仅当可见页签也 VERIFY 才抛原错。
 */
const ws = readFileSync(path.resolve(process.cwd(), 'src/main/browser/BrowserWorkspace.ts'), 'utf8')

const wrapperStart = ws.indexOf('async readSupplyProductPage(')
const carrierStart = ws.indexOf('  /** 隐藏窗报安全验证时的回落载体')
const wrapper = ws.slice(wrapperStart, carrierStart)
const readOnStart = ws.indexOf('private async readSupplyProductPageOn(')
const readOn = ws.slice(readOnStart, readOnStart + 2600)

describe('隐藏窗VERIFY回落已登录可见页签', () => {
  it('wrapper 捕获安全验证错→visibleSupplyCarrier→readOn 复抓', () => {
    expect(wrapperStart).toBeGreaterThan(-1)
    expect(wrapper).toContain("if (error instanceof Error && error.message.includes('要求安全验证')) {")
    expect(wrapper).toContain('const live = await this.visibleSupplyCarrier(warehouseCode, parsed.toString())')
    expect(wrapper).toContain('return await this.readSupplyProductPageOn(live, warehouseCode, parsed, name)')
    expect(wrapper).toContain('throw error')
  })
  it('wrapper 不再直接抛安全验证（判定与抛错只在 readOn）', () => {
    expect(wrapper).not.toContain('要求安全验证，请先在 IE浏览 中打开该商品页人工完成验证后重试')
  })
  it('visibleSupplyCarrier 复用 openSupplyUrl 同通道＋supplyViews＋销毁守卫', () => {
    expect(ws).toContain('private async visibleSupplyCarrier(')
    const seg = ws.slice(carrierStart, readOnStart)
    expect(seg).toContain('await this.openSupplyUrl(warehouseCode, url)')
    expect(seg).toContain('const view = this.supplyViews.get(warehouseCode)')
    expect(seg).toContain('return view && !view.webContents.isDestroyed() ? view.webContents : null')
  })
})

describe('VERIFY判定加商品数据上下文', () => {
  it('有商品数据即非验证页（防已登录正常页裸词误命中）', () => {
    expect(readOn).toContain("const challenge=${challengeRegexSource('VERIFY_RATE')}.test(text+' '+url)")
    expect(readOn).toContain('const productData=/单价\\(件\\)|可售库存|产品规格|打包费|Item Code/i.test(text)')
    expect(readOn).toContain("if (challenge&&!productData) return 'VERIFY'")
  })
  it('真验证页（无商品数据）仍抛原中文错不放宽', () => {
    expect(readOn).toContain('要求安全验证，请先在 IE浏览 中打开该商品页人工完成验证后重试')
    expect(readOn).toContain("verifyError.code = 'SUPPLY_VERIFY_REQUIRED'")
    expect(readOn).toContain("if (issue === 'LOGIN') throw new Error(`${name}登录状态已失效，请先在 IE浏览 中登录${name}后重试`)")
  })
})
