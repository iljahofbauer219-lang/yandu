/**
 * 一次性清理 ebay_local_products 里旧版类目解析写入的合成占位类目 ID（sug-<序号>-<时间戳>）。
 * 这些 ID 不是 eBay 类目，只清空 platform_category_id/name 两列（与应用内「清空」同语义），其余列不动。
 * 运行前自动备份 sqlite/wal/shm 三件套到 artifacts/backup-<时间戳>/；应用持 WAL 锁运行时短事务可提交。
 *
 * 运行：node tools/cleanup-sug-platform-category.cjs [dbPath]
 */
const { DatabaseSync } = require('node:sqlite')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const dbPath = process.argv[2] || path.join(os.homedir(), 'Library', 'Application Support', 'cross-border-sourcing-desktop', 'sourcing-data.sqlite')
if (!fs.existsSync(dbPath)) {
  console.error('数据库不存在：', dbPath)
  process.exit(1)
}

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14).replace(/(\d{8})(\d{6})/, '$1-$2')
const backupDir = path.join(__dirname, '..', 'artifacts', `backup-${stamp}`)
fs.mkdirSync(backupDir, { recursive: true })
for (const suffix of ['', '-wal', '-shm']) {
  const src = dbPath + suffix
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(backupDir, path.basename(dbPath) + suffix))
}
console.log('已备份三件套到：', backupDir)

const db = new DatabaseSync(dbPath)
const rows = db.prepare(`SELECT id, listing_id, core_term_en, platform_category_id, platform_category_name FROM ebay_local_products WHERE platform_category_id LIKE 'sug-%'`).all()
if (!rows.length) {
  console.log('无脏数据：没有 platform_category_id 以 sug- 开头的本地产品行')
  db.close()
  process.exit(0)
}
for (const row of rows) {
  console.log(`待清理：${row.id} listing=${row.listing_id} core=${row.core_term_en} pcat=${row.platform_category_id} name=${String(row.platform_category_name || '').slice(0, 60)}`)
}

const now = new Date().toISOString()
db.exec('BEGIN IMMEDIATE')
let changes = 0
try {
  changes = Number(db.prepare(`UPDATE ebay_local_products SET platform_category_id='', platform_category_name='', updated_at=? WHERE platform_category_id LIKE 'sug-%'`).run(now).changes)
  db.exec('COMMIT')
} catch (error) {
  db.exec('ROLLBACK')
  throw error
}
const left = db.prepare(`SELECT COUNT(*) c FROM ebay_local_products WHERE platform_category_id LIKE 'sug-%'`).get().c
db.close()
console.log(`清理完成：更新 ${changes} 行，残留 ${left} 行`)
if (left !== 0 || changes !== rows.length) {
  console.error('清理结果与预期不符，请检查备份后重试')
  process.exit(1)
}
console.log('CLEANUP_DONE', dbPath)
