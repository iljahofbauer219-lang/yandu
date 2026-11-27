import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 用户口径（2026-11-28 00:46 截图）：下载图文报「原商品页没有识别到可下载图片」，但「原址」打开正常。
 * 根因＝隐藏窗抓取 0 图（会话同 partition 但渲染/懒加载差异）；修复＝0 图时回落原址同通道
 * （openSupplyUrl 可见供应页签）加长 wait＋scroll 复抓 images＋html，scrapeNote 中文说明入下载档案 notice。
 */
const ws = readFileSync(path.resolve(process.cwd(), 'src/main/browser/BrowserWorkspace.ts'), 'utf8')
const svc = readFileSync(path.resolve(process.cwd(), 'src/main/services/SupplyProductDownloadService.ts'), 'utf8')

describe('隐藏窗0图回落原址同通道复抓', () => {
  it('回落块：openSupplyUrl＋可见视图 scroll＋images/html 复抓＋scrapeNote', () => {
    expect(ws).toContain('await this.openSupplyUrl(warehouseCode, parsed.toString())')
    expect(ws).toContain('const liveView = this.supplyViews.get(warehouseCode)')
    expect(ws).toContain("extracted = { ...extracted, images: visibleImages }")
    expect(ws).toContain("html = await liveWc.executeJavaScript('document.documentElement.outerHTML') as string")
    expect(ws).toContain('隐藏窗未识别到图片，已借用可见供应页签（原址同通道）复抓成功')
    expect(ws).toContain('let scrapeNote = \'\'')
    expect(ws).toContain('return { html, extracted, scrapeNote }')
    expect(ws).toContain('scrapeNote?: string')
  })
  it('回落失败仍保留原中文报错（不静默吞错）', () => {
    expect(ws).toContain("if (!extracted?.images?.length) throw new Error('原商品页没有识别到可下载图片，请确认商品页正常显示后重试')")
    expect(ws).toContain('catch { /* 回落失败保留原中文报错 */ }')
  })
  it('service 把 scrapeNote 入下载档案 notice（无图片失败时）', () => {
    expect(svc).toContain("error: failedCount ? `部分图片失败：${failures.slice(0, 3).join('；')}` : (snapshot.scrapeNote || ''),")
  })
})