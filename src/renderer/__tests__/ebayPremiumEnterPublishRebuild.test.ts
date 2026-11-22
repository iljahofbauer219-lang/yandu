/**
 * 「进入发布」本地流程优品重建兜底守卫：
 * 本地产品→AI优化→存优品会刻意移除本地行；无在线商品且 eBay 找回无果时，
 * 须按优品草稿 payload 直接 seedLocalProductFromPremium 重建本地行并开编辑器，
 * 不得弹「该优品尚未同步为本地产品」把用户赶回本地产品（死胡同）。
 * 模态仅保留给重建失败的真无来源场景；ReviseItem/草稿续作分支口径不动。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const app = readFileSync(path.resolve(__dirname, '../App.tsx'), 'utf8')
const preload = readFileSync(path.resolve(__dirname, '../../preload/preload.ts'), 'utf8')

describe('进入发布重建兜底', () => {
  it('找回失败或无果后仍按优品草稿重建本地行（兜底独立于找回 try/catch）', () => {
    expect(app).toContain("const seeded=await window.desktop.ebay.seedLocalProductFromPremium(premium.storeId,premium,premium.publishRef?.kind==='draft'?premium.publishRef.id:'')")
    expect(app).toContain('按优品草稿重建本地版本失败')
  })

  it('重建后回写本地列表并提示不重复新建', () => {
    expect(app).toContain('setLocalProducts(current=>[seeded,...current.filter(item=>item.id!==seeded.id)])')
    expect(app).toContain('本地行已随存优品移除，已按优品草稿重建本地版本并打开发布编辑器；不重复新建线上商品。')
  })

  it('seed 能力存在于 preload 契约', () => {
    expect(preload).toContain('seedLocalProductFromPremium')
  })
})

describe('既有分支口径不动', () => {
  it('在线商品仍走 ReviseItem 不重复新建', () => {
    expect(app).toContain('该优品已存在在线商品（全流程后本地行已移除属预期），进入发布改为打开 eBay 修改页（ReviseItem），不重复新建。')
  })

  it('eBay 草稿命中仍续作既有草稿', () => {
    expect(app).toContain('本地行已移除，已按优品草稿重建本地版本并打开发布编辑器；续作既有 eBay 草稿，不重复新建。')
  })

  it('模态保留给重建失败的真无来源场景', () => {
    expect(app).toContain('if(!lp){setPublishNoMatchDraft(premium);return}')
    expect(app).toContain('该优品尚未同步为本地产品')
  })
})