import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 本地产品卡链接对调（2026-11-20 拍板）：「本地详情」改开下载图文页（与货盘「查看页面」同
 * warehouses.openDownload 链路、同 DOWNLOADED+pageUrl 门控，不可开时隐藏）；主图改开 core
 * 本地编辑器（openLocalEditor 唯一入口迁到主图点击）。填写引导文案同步点名主图点击。
 */
const app = readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')
const pallet = readFileSync(path.resolve(process.cwd(), 'src/renderer/erp/PalletWarehousePage.tsx'), 'utf8')
const mediaLine = app.split('\n').find(line => line.includes('ebay-market-card-media') && line.includes('>{mediaInner}</button>')) ?? ''

describe('本地产品卡 · 本地详情=图文页链路 / 主图=core 编辑器入口', () => {
  it('主图按钮开 core 编辑器：openLocalEditor＋中文提示＋读取中禁用态', () => {
    expect(mediaLine).toContain('onClick={()=>void openLocalEditor(product)}')
    expect(mediaLine).toContain('title="点击打开本地产品编辑"')
    expect(mediaLine).toContain('disabled={busy===`local-detail:${product.id}`}')
  })
  it('「本地详情」按钮与货盘「查看页面」同链路同门控：downloadable 才渲染，openDownload(wpId)＋中文失败提示', () => {
    expect(app).toContain("{downloadable?<button type=\"button\" title=\"查看下载图文页\" onClick={()=>void window.desktop.warehouses.openDownload(wpId).catch(reason=>setEbayError(readableError(reason,'打开下载图文页')))}>本地详情</button>:null}")
  })
  it('主图不再挂 openDownload，旧媒体链接类名清除', () => {
    expect(mediaLine).not.toContain('warehouses.openDownload')
    expect(app).not.toContain('ebay-local-media-link')
  })
  it('旧「本地详情」开编辑器按钮不得残留', () => {
    expect(app).not.toContain("onClick={()=>void openLocalEditor(product)}>{busy===`local-detail:${product.id}`?'读取中…':'本地详情'}")
  })
  it('填写引导两处改点名主图点击，旧「本地详情」引导清零', () => {
    expect(app.split('本地产品「主图点击」').length - 1).toBe(2)
    expect(app).not.toContain('本地产品「本地详情」')
  })
  it('货盘「查看页面」链路与 openLocalEditor 定义不受影响', () => {
    expect(pallet.split('window.desktop.warehouses.openDownload(downloadId)').length - 1).toBe(2)
    expect(app).toContain('const openLocalEditor=async(product:EbayLocalProduct)=>{')
  })
})