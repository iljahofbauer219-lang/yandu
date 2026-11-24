import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 用户口径（2026-11-19 截图红框）：AI跨境流程＝本地产品→AI优化→优品仓库→线上发布→线上产品，
 * 每产品逐环节顺序、过环节即移入下一环节且本环节不再存在。
 * 线上发布定时列表只列「本地行＋未打回同 listingId 草稿＋非 listing」的产品；
 * 打回本地/纯本地产品不得出现；离阶段产品清 enabled，due 加成员守卫双保险。
 */
const app = readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')

describe('线上发布环节互斥 · 候选与调度', () => {
  it('scheduledCandidates 三条件：非 listing＋存在未打回同源草稿', () => {
    expect(app).toContain("const scheduledCandidates=localProducts.filter(product=>product.publishRef?.kind!=='listing'&&optimizationDrafts.some(draft=>!draft.returnedAt&&draft.listing.listingId===product.listingId))")
  })
  it('due effect 成员守卫：无未打回同源草稿不到点执行', () => {
    const mainSrc = readFileSync(path.resolve(process.cwd(), 'src/main/main.ts'), 'utf8')
    const seg = mainSrc.split('dueScheduledPublish(map,')[1]?.split('},15000)')[0] ?? ''
    expect(seg).toContain("if(!database.getEbayOptimizationDrafts(product.storeId).some(draft=>!draft.returnedAt&&draft.listing.listingId===product.listingId))continue")
    expect(mainSrc).toContain('startEbayBackgroundScheduler()')
  })
  it('离阶段残留 enabled 清理 effect（批次分配不被幽灵条目占用）', () => {
    expect(app).toContain('const stale=Object.keys(cur).filter(id=>cur[id]?.enabled&&!ids.has(id))')
    expect(app).toContain('for(const id of stale)next[id]={...next[id],enabled:false};writeScheduledPublish(next)},[scheduledCandidates])')
  })
  it('打回本地同步清该产品 enabled', () => {
    const seg = app.split('const sendPremiumBackToLocal=async(draft:EbayOptimizationDraft)=>{')[1]?.split('\n  const openOptimizedVersion')[0] ?? ''
    expect(seg).toContain('const seeded=await window.desktop.ebay.seedLocalProductFromPremium(')
    expect(seg).toContain('const entry0=baseMap[seeded.id];if(entry0?.enabled)writeScheduledPublish({...baseMap,[seeded.id]:{...entry0,enabled:false}})')
  })
})

describe('线上发布环节互斥 · 表头与 chip 同源', () => {
  it('全选自动发布按候选列表判满选与施加', () => {
    expect(app).toContain("className={scheduledCandidates.length&&scheduledCandidates.every(p=>scheduledPublish[p.id]?.enabled)?'primary':''}")
    expect(app).toContain('applyScheduleConfigToAll(scheduledPublish,scheduledCandidates.map(p=>p.id)')
  })
  it('chip 批次分配只统计候选内 enabled', () => {
    expect(app).toContain('allocateBatches(scheduledCandidates.filter(p=>scheduledPublish[p.id]?.enabled).map(p=>p.id)')
    expect(app).not.toContain('allocateBatches(localProducts.filter(p=>scheduledPublish[p.id]?.enabled)')
  })
})