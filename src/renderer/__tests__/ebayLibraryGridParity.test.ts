import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 线上产品卡重叠根因：基础 grid＝minmax(240px,1fr)，线上卡固定 280 → 列宽不足时溢出压盖邻卡。
 * 修复：线上布局 grid 镜像本地产品布局规格（repeat(auto-fill,280px)/左对齐/gap14），卡片互不压盖。
 */
const css = readFileSync(path.join(__dirname, '..', 'image-studio.css'), 'utf8')

describe('线上产品 grid 排布镜像本地', () => {
  it('线上布局列规格＝280px 固定列＋左对齐＋14px 间距（与本地 :123 同口径）', () => {
    expect(css).toContain('.ebay-library-layout .ebay-listing-grid{grid-template-columns:repeat(auto-fill,280px);justify-content:start;gap:14px;}')
  })
  it('本地布局规格不被改动', () => {
    expect(css).toContain('.ebay-local-products-layout .ebay-listing-grid { grid-template-columns:repeat(auto-fill,280px); justify-content:start; gap:14px; }')
  })
  it('卡片固定宽 280 与列宽一致（不再溢出）', () => {
    expect(css).toContain('.ebay-listing-grid .ebay-local-product-card, .ebay-listing-grid .ebay-online-product-card { width:280px; min-width:280px;')
  })
})