/**
 * 一次性修复：优品草稿 5c8f788c… 的 16 个 /ai-assets/EY37jBDi7Q5iT15O 地址（该批次随旧容器已丢失，实测全 404）
 * 改指向同一商品在服务器上的当前自托管批次 /product-pages/VvvHDTiUXSyXlHDm/assets（按序号对齐，扩展名以实际文件为准）。
 * 默认干跑；--execute 才写库。写前必备 sqlite/wal/shm 三件套备份，且必须先停掉正在运行的 App（并发写会损坏 WAL 库）。
 * 用法：node tools/repair-premium-draft-ai-assets.cjs [--execute]
 */
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DRAFT_ID = '5c8f788c-fff5-4686-9385-e19bdf29432d'
const DEAD_PREFIX = 'http://114.55.149.192/ai-assets/EY37jBDi7Q5iT15O/'
const BATCH_PREFIX = 'http://114.55.149.192/product-pages/VvvHDTiUXSyXlHDm/assets/'
// 2026-11-07 实测卷内文件名（15 张 + 1 段视频）；序号 → 当前批次实际文件名
const BATCH_BY_INDEX = {
  1: '01.jpg', 2: '02.jpg', 3: '03.jpg', 4: '04.jpg', 5: '05.jpg', 6: '06.jpg', 7: '07.jpg',
  8: '08.png', 9: '09.png', 10: '10.jpg', 11: '11.jpg', 12: '12.jpg', 13: '13.jpg', 14: '14.jpg', 15: '15.jpg'
}
const execute = process.argv.includes('--execute')
const userData = path.join(os.homedir(), 'Library/Application Support/cross-border-sourcing-desktop')
const dbFile = path.join(userData, 'sourcing-data.sqlite')

function fail(message) {
  console.error(`[repair] 中止：${message}`)
  process.exit(1)
}

// 1) 并发写护栏：有任何 Electron 主进程在跑就不动库
const running = spawnSync('sh', ['-c', 'ps -eo pid,args -ww | grep -E "Electron\\.app/Contents/MacOS/Electron (\\.|$)" | grep -v grep | awk \'{print $1}\''], { encoding: 'utf8' })
const pids = (running.stdout || '').split('\n').filter(Boolean)
if (pids.length) fail(`仍有 App 实例在写库（pid ${pids.join(' ')}），先退出再执行`)
if (!fs.existsSync(dbFile)) fail(`找不到库文件 ${dbFile}`)

// 2) 目标 URL 预检：任一 404 就不写，避免把死链换成另一批死链
const targets = Object.values(BATCH_BY_INDEX)
for (const name of targets) {
  const probe = spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '15', `${BATCH_PREFIX}${name}`], { encoding: 'utf8' })
  if (probe.stdout?.trim() !== '200') fail(`目标批次 ${name} 不可用（HTTP ${probe.stdout?.trim() || '无响应'}）`)
}
console.log(`[repair] 目标批次预检通过：${targets.length} 个文件全部 200`)

const db = new DatabaseSync(dbFile)
const row = db.prepare('select id, payload from ebay_optimization_drafts where id = ?').get(DRAFT_ID)
if (!row) fail(`草稿 ${DRAFT_ID} 不存在`)

const urls = []
const collect = value => {
  if (typeof value === 'string') { if (value.startsWith(DEAD_PREFIX)) urls.push(value) }
  else if (Array.isArray(value)) value.forEach(collect)
  else if (value && typeof value === 'object') Object.values(value).forEach(collect)
}
collect(JSON.parse(row.payload))
const beforeCount = urls.length
const beforeList = [...new Set(urls)].sort()
console.log(`[repair] 改前：死链引用 ${beforeCount} 处 / 唯一 ${beforeList.length} 个`)
if (!beforeCount) { console.log('[repair] 该草稿已无死链引用，无需改动'); process.exit(0) }

function mapUrl(url) {
  const name = url.slice(DEAD_PREFIX.length)
  const index = Number(name.match(/^(\d{2})\./)?.[1] ?? 0)
  return BATCH_BY_INDEX[index] ? `${BATCH_PREFIX}${BATCH_BY_INDEX[index]}` : null
}

function rewrite(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(rewrite)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(value)) {
      if (Array.isArray(item) && key === 'imageUrls') {
        out[key] = item.map(entry => typeof entry === 'string' && entry.startsWith(DEAD_PREFIX) ? mapUrl(entry) : rewrite(entry)).filter(entry => entry !== null)
        continue
      }
      out[key] = rewrite(item)
    }
    return out
  }
  return value
}

const payload = JSON.parse(row.payload)
// imageUrl 是单值字符串，数组之外单独换；映射不到（第 16 张）时退回本批次首图，保证主图不为空
const replaceScalar = obj => {
  for (const [key, item] of Object.entries(obj)) {
    if (typeof item === 'string' && item.startsWith(DEAD_PREFIX)) obj[key] = mapUrl(item) ?? `${BATCH_PREFIX}${BATCH_BY_INDEX[1]}`
    else if (item && typeof item === 'object') replaceScalar(item)
  }
}
const rewritten = rewrite(payload)
replaceScalar(rewritten)

const afterUrls = []
collectUrls(rewritten, afterUrls)
function collectUrls(value, sink) {
  if (typeof value === 'string') { if (value.startsWith('http://114.55.149.192/')) sink.push(value) }
  else if (Array.isArray(value)) value.forEach(item => collectUrls(item, sink))
  else if (value && typeof value === 'object') Object.values(value).forEach(item => collectUrls(item, sink))
}
const stillDead = afterUrls.filter(url => url.startsWith(DEAD_PREFIX))
const newUnique = [...new Set(afterUrls)].sort()
console.log(`[repair] 改后：图片引用 ${afterUrls.length} 处 / 唯一 ${newUnique.length} 个，剩余死链 ${stillDead.length}`)
console.log(`[repair] imageUrls 数量 ${payload.imageUrls.length} → ${rewritten.imageUrls.length}`)
for (const url of newUnique) console.log('  ', url)
if (stillDead.length) fail(`仍有 ${stillDead.length} 处未映射死链，拒绝写入`)

if (!execute) {
  console.log('[repair] 干跑结束（未写库）。确认无误后加 --execute')
  process.exit(0)
}

// 3) 三件套备份
const backupDir = path.join(userData, `backup-${path.basename(dbFile)}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
fs.mkdirSync(backupDir, { recursive: true })
let copied = 0
for (const suffix of ['', '-wal', '-shm']) {
  const source = dbFile + suffix
  if (fs.existsSync(source)) { fs.copyFileSync(source, path.join(backupDir, path.basename(source))); copied += 1 }
}
console.log(`[repair] 已备份 ${copied} 个文件 → ${backupDir}`)

// 4) 短事务写入 + WAL 收敛
db.exec('BEGIN IMMEDIATE')
try {
  const result = db.prepare('update ebay_optimization_drafts set payload = ?, updated_at = ? where id = ?')
    .run(JSON.stringify(rewritten), new Date().toISOString(), DRAFT_ID)
  if (result.changes !== 1) throw new Error(`更新影响行数 ${result.changes}，预期 1`)
  db.exec('COMMIT')
} catch (error) {
  db.exec('ROLLBACK')
  fail(`事务回滚：${error.message}`)
}
db.exec('PRAGMA wal_checkpoint(TRUNCATE)')

// 5) 前后对账：重读库 + 逐个 URL 实测 200
const check = new DatabaseSync(dbFile, { readOnly: true })
const reloaded = check.prepare('select payload from ebay_optimization_drafts where id = ?').get(DRAFT_ID).payload
const deadNow = (String(reloaded).match(/ai-assets\/EY37jBDi7Q5iT15O/g) || []).length
const writtenUrls = []
collectUrls(JSON.parse(reloaded), writtenUrls)
let ok = 0
let bad = 0
for (const url of [...new Set(writtenUrls)]) {
  const probe = spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '15', url], { encoding: 'utf8' })
  probe.stdout?.trim() === '200' ? ok += 1 : bad += 1
}
console.log(`[repair] 对账：库内剩余死链 ${deadNow} 处；回读 URL ${ok} 个 200 / ${bad} 个非 200`)
check.close()
db.close()
if (deadNow !== 0 || bad !== 0) fail(`对账未通过（剩余死链 ${deadNow}、非 200 ${bad}）；备份在 ${backupDir}`)
console.log(`[repair] 完成。备份：${backupDir}`)
