import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { palletWarehouseIdFromListingId } from '../../shared/palletToEbayLocal'

/**
 * 用户口径（2026-11-19 截图）：我的货盘「送eBay」按钮对已送商品变灰改文字「已送eBay」，
 * 未送保持青绿「送eBay」，一眼可分。已送＝eBay 工作台本地产品/优品草稿存在同源
 * listingId（PALLET-<货盘编号>）；线上产品无同源字段不纳入（已记录上报）。
 * 只改按钮态展示，点击送入行为不变。
 */
const app = readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')
const page = readFileSync(path.resolve(process.cwd(), 'src/renderer/erp/PalletWarehousePage.tsx'), 'utf8')
const css = readFileSync(path.resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8')

describe('货盘送eBay已送态 · 判定源与接线', () => {
  it('纯函数：PALLET- 前缀反查货盘编号，非货盘来源返回空串', () => {
    expect(palletWarehouseIdFromListingId('PALLET-814099')).toBe('814099')
    expect(palletWarehouseIdFromListingId('1234567890')).toBe('')
  })
  it('App 跨店铺读本地产品+优品草稿同源 listingId，仅货盘页可见时刷新', () => {
    expect(app).toContain("if(page!=='ai-hub-my-pallet')return")
    expect(app).toContain('window.desktop.ebay.stores()')
    expect(app).toContain('window.desktop.ebay.localProducts(store.id),window.desktop.ebay.optimizationDrafts(store.id)')
    expect(app).toContain('palletWarehouseIdFromListingId(entry.listingId)')
  })
  it('送入成功按返回产品同源 id 即时登记已送集合', () => {
    const seg = app.split('onSendToEbay={async warehouseProductId=>{')[1]?.split('}}/>')[0] ?? ''
    expect(seg).toContain('const product=await window.desktop.myPallet.sendToEbay(undefined,warehouseProductId)')
    expect(seg).toContain('palletWarehouseIdFromListingId(product.listingId)||warehouseProductId')
    expect(seg).toContain('next.add(sentId)')
  })
  it('已送集合传入我的货盘页且 props 声明为只读集合', () => {
    expect(app).toContain('ebaySentIds={ebaySentPalletIds}')
    expect(page).toContain('ebaySentIds?: ReadonlySet<string>')
  })
})

describe('货盘送eBay已送态 · 两态渲染', () => {
  it('按钮按已送集合区分类名与文案，点击行为不变', () => {
    expect(page).toContain('const sentToEbay = Boolean(ebaySentIds?.has(item.warehouseProductId))')
    expect(page).toContain("className={sentToEbay ? 'pallet-ebay-sent' : 'primary'}")
    expect(page).toContain("{sentToEbay ? '已送eBay' : '送eBay'}")
    expect(page).toContain('onClick={() => void sendToEbay(item.warehouseProductId)}')
  })
  it('CSS 已送态中性灰扁平，与青绿 primary 区分', () => {
    const start = css.indexOf('.supply-source-card .pallet-ebay-sent')
    expect(start).toBeGreaterThan(-1)
    const block = css.slice(start, css.indexOf('}', start))
    expect(block).toContain('background:#eef1f4')
    expect(block).toContain('color:#5b6470')
  })
})