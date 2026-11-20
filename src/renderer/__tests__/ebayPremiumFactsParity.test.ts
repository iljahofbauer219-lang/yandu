import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 用户口径（2026-11-19 双截图）：优品仓库产品卡的内容参数要与本地产品卡逐项同口径——
 * 原货盘·Item Code/地区货盘/预估总额(含物流费)/物流费/可售库存/货盘类目/店铺类目/
 * GIGA Index/采集时间/中文产品/英文产品 11 项，PALLET- 反查货盘档案，占位同口径；
 * 优品卡现有 chips、缺失提示与两按钮保留；无档案不渲染（与本地卡一致）。
 */
const app = readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')
const css = readFileSync(path.resolve(process.cwd(), 'src/renderer/image-studio.css'), 'utf8')

const FACT_LABELS = ['原货盘', '地区货盘', '预估总额', '物流费', '可售库存', '货盘类目', '店铺类目', 'GIGA Index', '采集时间', '中文产品', '英文产品']

function factLabelsOf(block: string): string[] {
  return [...block.matchAll(/<dt>([^<]+)<\/dt>/g)].map(m => m[1])
}

describe('优品卡参数对齐本地卡 · 字段与口径', () => {
  const localBlock = app.split('{palletItem?<dl className="candidate-source-facts">')[1]?.split('</dl>:null}')[0] ?? ''
  const premiumSeg = app.split('className="ebay-premium-card-grid"')[1]?.split('</article>')[0] ?? ''
  const premiumBlock = premiumSeg.split('<dl className="candidate-source-facts">')[1]?.split('</dl>})()}')[0] ?? ''

  it('本地卡参数块 11 项字段序不变（防回归基线）', () => {
    expect(factLabelsOf(localBlock)).toEqual(FACT_LABELS)
  })
  it('优品卡参数块字段与本地卡逐项同序', () => {
    expect(premiumBlock.length).toBeGreaterThan(0)
    expect(factLabelsOf(premiumBlock)).toEqual(FACT_LABELS)
  })
  it('优品卡按 draft.listingId 走同一 PALLET- 反查表与下载档案', () => {
    expect(premiumSeg).toContain('const wpId=palletWarehouseIdFromListingId(draft.listingId)')
    expect(premiumSeg).toContain('localPalletByWp[wpId]')
    expect(premiumSeg).toContain('localDownloadsByWp[wpId]')
    expect(premiumSeg).toContain("if(!palletItem)return null")
  })
  it('反查表加载门含 premium 页签（否则优品卡参数块落空分支）', () => {
    expect(app).toContain("if(activeTab!=='local'&&activeTab!=='optimize'&&activeTab!=='premium')return")
  })
  it('占位与文本口径同本地卡：待补采/—/含物流费/库存正则/类目路径', () => {
    for (const token of ["'待补采'", "||'—'", '(含物流费)']) {
      expect(premiumBlock).toContain(token)
    }
    expect(premiumSeg).toContain('Available\\s*Stock|可售库存|库存')
    expect(premiumSeg).toContain("palletItem.category?`${palletItem.category} / ${palletItem.subcategory||'—'} / ${palletItem.tertiaryCategory||'—'}`:'—'")
    expect(premiumSeg).toContain("storePathText(draft.listing.categoryId):'未分类'")
    expect(premiumBlock).toContain('palletItem.coreTermZh||')
    expect(premiumBlock).toContain('palletItem.coreTermEn||')
  })
  it('未优化项 chips 与缺失提示行不再渲染；按钮行三按钮含打回本地', () => {
    expect(premiumSeg).not.toContain('ebay-premium-tags')
    expect(premiumSeg).not.toContain('ebay-premium-issues')
    expect(premiumSeg).not.toContain('ebay-premium-ready')
    expect(premiumSeg).toContain("{fullyReady?'优化成功':'重新优化'}")
    expect(premiumSeg).toContain('打回本地')
    expect(premiumSeg).toContain('进入发布')
  })
  it('优品卡内参数列表有间距样式', () => {
    expect(css).toContain('.ebay-premium-card .candidate-source-facts { margin:6px 0 2px; }')
  })
})