import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { friendlySupplyError } from '../friendlyError'

/**
 * 用户口径（2026-11-28 17:26 截图）：已登录大健云仓仍弹「需要安全验证」旧框。
 * 插桩真点取证：模态背后真实错误＝「服务器建页失败（HTTP 400）…若持续出现请在店铺采集浏览器完成安全验证后重试」，
 * 旧 verify 分支以 /VERIFY|安全验证|…/ 子串匹配把我方中文指引串误标成浏览器风控模态。
 * 修复＝server kind 承载服务器失败全文模态；verify 改窄匹配真风控句式/码；双窗口均被拦截时文案点名。
 */
const app = readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')
const ws = readFileSync(path.resolve(process.cwd(), 'src/main/browser/BrowserWorkspace.ts'), 'utf8')

const SERVER_400 = '服务器建页失败（HTTP 400）：中央服务器处理请求时上游响应不是有效 JSON（疑似供应商反爬拦截页或网关异常），请稍后重试；若持续出现请在店铺采集浏览器完成安全验证后重试'

describe('安全验证模态误标根治', () => {
  it('服务器建页 400 指引串→server kind 全文保留，不再误标 verify', () => {
    const out = friendlySupplyError(SERVER_400)
    expect(out.kind).toBe('server')
    expect(out.text).toBe(SERVER_400)
    expect(out.brief).toBe('服务器建页失败')
  })
  it('仅含建议性「安全验证」四字的其它串不触发 verify', () => {
    expect(friendlySupplyError('若持续出现请在店铺采集浏览器完成安全验证后重试').kind).not.toBe('verify')
  })
  it('真风控句式与码仍判 verify（不放宽）', () => {
    expect(friendlySupplyError('大健云仓要求安全验证，请先在 IE浏览 中打开该商品页人工完成验证后重试').kind).toBe('verify')
    expect(friendlySupplyError('SUPPLY_VERIFY_REQUIRED').kind).toBe('verify')
    expect(friendlySupplyError('采集保护已暂停：检测到安全验证或访问频繁。请在右侧浏览器人工处理后重新启动').kind).toBe('verify')
    expect(friendlySupplyError('1688要求安全验证，已打开独立验证窗口；请人工完成验证并关闭窗口后重新读取').kind).toBe('verify')
  })
  it('模态标题含 server 分支且 other 不弹模态', () => {
    expect(app).toContain("supplyErrorModal.kind === 'server' ? '服务器处理失败'")
    expect(app).toContain("if (friendly.kind !== 'other') setSupplyErrorModal({ ...friendly, warehouse })")
  })
  it('真 VERIFY 抛错带码＋双窗口均拦截文案点名', () => {
    expect(ws).toContain("verifyError.code = 'SUPPLY_VERIFY_REQUIRED'")
    expect(ws).toContain('；可见供应页签同样被拦截，出口 IP 可能已被风控')
    expect(ws).toContain("both.code = 'SUPPLY_VERIFY_REQUIRED'")
  })
})
