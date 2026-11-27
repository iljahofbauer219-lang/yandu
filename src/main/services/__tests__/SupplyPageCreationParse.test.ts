import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSupplyPageCreationBody, supplyPageCreationFailureMessage } from '../SupplyProductDownloadService'

/**
 * 用户口径（2026-11-27 截图 SKU 1091290）：下载图文报 raw 英文
 * 「Body is not valid JSON but content-type is set to 'application/json'」。
 * 根因＝200 响应直接 response.json()，网关/代理拦截页或空 body 时 undici 抛 raw 串直入卡片 notice。
 * 修复＝read text 一次＋JSON.parse 容错；失败/缺字段抛中文全文含 HTTP 状态与重试指引。
 */
describe('建页响应容错解析', () => {
  it('正常 JSON 返回 pageId/url', () => {
    expect(parseSupplyPageCreationBody('{"pageId":"p1","url":"/pages/p1.html"}', 200)).toEqual({ pageId: 'p1', url: '/pages/p1.html' })
  })
  it('HTML 拦截页（content-type json 但 body 非 JSON）抛中文全文含状态与重试指引', () => {
    expect(() => parseSupplyPageCreationBody('<html><body>502 Bad Gateway</body></html>', 200)).toThrow(/服务器建页响应不是有效 JSON（HTTP 200/)
    expect(() => parseSupplyPageCreationBody('<html></html>', 200)).toThrow(/请重试/)
    expect(() => parseSupplyPageCreationBody('<html></html>', 200)).toThrow(/中央服务器/)
  })
  it('空 body / null / 缺字段抛中文全文', () => {
    expect(() => parseSupplyPageCreationBody('', 200)).toThrow(/不是有效 JSON/)
    expect(() => parseSupplyPageCreationBody('null', 200)).toThrow(/缺少 pageId\/url（HTTP 200）/)
    expect(() => parseSupplyPageCreationBody('{"pageId":"p1"}', 200)).toThrow(/缺少 pageId\/url/)
    expect(() => parseSupplyPageCreationBody('{"url":"/x"}', 200)).toThrow(/缺少 pageId\/url/)
    expect(() => parseSupplyPageCreationBody('{"pageId":"","url":"/x"}', 200)).toThrow(/缺少 pageId\/url/)
  })
  it('错误文案不含 raw 英文 undici 串', () => {
    try {
      parseSupplyPageCreationBody('<html></html>', 200)
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('Body is not valid JSON')
      expect(String((error as Error).message)).not.toContain('content-type')
    }
  })
  it('服务调用点走容错解析（read text 一次）', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/main/services/SupplyProductDownloadService.ts'), 'utf8')
    expect(source).toContain('const result = parseSupplyPageCreationBody(await response.text(), response.status)')
    expect(source).not.toContain('const result = await response.json() as { pageId: string; url: string }')
    expect(source).toContain('throw new Error(supplyPageCreationFailureMessage(response.status, String(data?.message || \'\')))')
  })
  it('400 relay 的 raw undici 串转中文全文＋验证/重试指引（11-28 插桩根因）', () => {
    const raw = "Body is not valid JSON but content-type is set to 'application/json'"
    const message = supplyPageCreationFailureMessage(400, raw)
    expect(message).toContain('服务器建页失败（HTTP 400）')
    expect(message).toContain('上游响应不是有效 JSON')
    expect(message).toContain('安全验证')
    expect(message).not.toContain('Body is not valid JSON')
    expect(supplyPageCreationFailureMessage(502, '')).toBe('服务器建页失败（HTTP 502）')
    expect(supplyPageCreationFailureMessage(400, '类目缺失')).toBe('类目缺失')
  })
})