/**
 * 一次性清理旧下载流程数据：目标店铺线上产品同步行 + 非 PALLET- 本地快照/优品草稿/发布任务等派生行。
 * PALLET- 送入链路数据、我的货盘、货盘系表不动；不调任何 eBay 站点 API。
 *
 * 运行（须先退出应用并备份 sqlite）：
 * ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
 *   tools/cleanup-legacy-ebay-flow.cjs <dbPath> [storeName]
 */
const { DatabaseSync } = require('node:sqlite')

const dbPath = process.argv[2]
const storeName = process.argv[3] || '美国主店'
if (!dbPath) {
  console.error('用法: cleanup-legacy-ebay-flow.cjs <dbPath> [storeName]')
  process.exit(1)
}

const db = new DatabaseSync(dbPath)
db.exec('PRAGMA foreign_keys = OFF')

const stores = db.prepare('SELECT id, name FROM ebay_stores').all()
const store = stores.find(s => s.name === storeName)
if (!store) {
  console.error('未找到店铺：', storeName, '；现有店铺：', stores.map(s => s.name).join(', ') || '(无)')
  process.exit(1)
}
const sid = store.id
const OLD = "NOT LIKE 'PALLET-%'"

const count = (sql, param) => db.prepare(sql).get(param).c
const before = {
  listings: count('SELECT COUNT(*) c FROM ebay_listings WHERE store_id=?', sid),
  localProducts: count(`SELECT COUNT(*) c FROM ebay_local_products WHERE store_id=? AND listing_id ${OLD}`, sid),
  drafts: count(`SELECT COUNT(*) c FROM ebay_optimization_drafts WHERE store_id=? AND listing_id ${OLD}`, sid),
  palletLocal: count("SELECT COUNT(*) c FROM ebay_local_products WHERE store_id=? AND listing_id LIKE 'PALLET-%'", sid)
}
console.log('清理前：', JSON.stringify(before))

const log = {}
const run = (label, sql, params = []) => { const r = db.prepare(sql).run(...params); log[label] = Number(r.changes) }
db.exec('BEGIN IMMEDIATE')
try {
  const oldLocalIds = db.prepare(`SELECT id FROM ebay_local_products WHERE store_id=? AND listing_id ${OLD}`).all(sid).map(r => r.id)
  const qmarks = ids => ids.map(() => '?').join(',')
  if (oldLocalIds.length) {
    run('review_events', `DELETE FROM ebay_image_visual_review_events WHERE inspection_id IN (SELECT id FROM ebay_image_visual_inspections WHERE local_product_id IN (${qmarks(oldLocalIds)}))`, oldLocalIds)
    run('inspections', `DELETE FROM ebay_image_visual_inspections WHERE local_product_id IN (${qmarks(oldLocalIds)})`, oldLocalIds)
    run('media', `DELETE FROM ebay_local_product_media WHERE snapshot_id IN (SELECT id FROM ebay_local_product_snapshots WHERE local_product_id IN (${qmarks(oldLocalIds)}))`, oldLocalIds)
    run('snapshots', `DELETE FROM ebay_local_product_snapshots WHERE local_product_id IN (${qmarks(oldLocalIds)})`, oldLocalIds)
    run('local_products', `DELETE FROM ebay_local_products WHERE id IN (${qmarks(oldLocalIds)})`, oldLocalIds)
  } else {
    Object.assign(log, { review_events: 0, inspections: 0, media: 0, snapshots: 0, local_products: 0 })
  }
  const oldDraftIds = db.prepare(`SELECT id FROM ebay_optimization_drafts WHERE store_id=? AND listing_id ${OLD}`).all(sid).map(r => r.id)
  if (oldDraftIds.length) {
    run('publish_tasks', `DELETE FROM ebay_publish_tasks WHERE draft_id IN (${qmarks(oldDraftIds)})`, oldDraftIds)
    run('drafts', `DELETE FROM ebay_optimization_drafts WHERE id IN (${qmarks(oldDraftIds)})`, oldDraftIds)
  } else {
    Object.assign(log, { publish_tasks: 0, drafts: 0 })
  }
  for (const table of ['ebay_content_optimization_records', 'ebay_listing_absence_evidence', 'ebay_market_research', 'ebay_market_research_history', 'ebay_title_decisions']) {
    run(table, `DELETE FROM ${table} WHERE store_id=? AND listing_id ${OLD}`, [sid])
  }
  run('listings', 'DELETE FROM ebay_listings WHERE store_id=?', [sid])
  db.exec('COMMIT')
} catch (error) {
  db.exec('ROLLBACK')
  throw error
}
console.log('删除行数：', JSON.stringify(log))

const after = {
  listings: count('SELECT COUNT(*) c FROM ebay_listings WHERE store_id=?', sid),
  localProducts: count(`SELECT COUNT(*) c FROM ebay_local_products WHERE store_id=? AND listing_id ${OLD}`, sid),
  drafts: count(`SELECT COUNT(*) c FROM ebay_optimization_drafts WHERE store_id=? AND listing_id ${OLD}`, sid),
  palletLocal: count("SELECT COUNT(*) c FROM ebay_local_products WHERE store_id=? AND listing_id LIKE 'PALLET-%'", sid)
}
console.log('清理后：', JSON.stringify(after))
db.close()
if (after.listings !== 0 || after.localProducts !== 0 || after.drafts !== 0) {
  console.error('清理后仍有旧流程残留，请检查')
  process.exit(1)
}
console.log('CLEANUP_DONE', dbPath, storeName)
