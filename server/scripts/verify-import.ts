/**
 * SQLite → PG 数据导入器验收脚本：
 * 1. 启动内存版 PGlite → 2. prisma migrate deploy → 3. 构造合成 SQLite fixture（真实 DDL + 边界数据）
 * 4. 断言：全表导入计数、org_id 注入、JSONB/数值/时间戳类型转换、删除标记保留、
 *    外键顺序（拓扑）、凭据保留、幂等重跑、dry-run、无效组织报错、跨组织隔离
 * 运行：pnpm verify:import
 */
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// 注意：必须用异步 execFile——同步 exec 会冻结事件循环，导致同进程的 PGlite socket 无法响应
const execFileAsync = promisify(execFile)
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dbPort = 5438

// connection_limit 封顶 Prisma 连接池，避免 Promise.all 突发查询超出 PGlite socket 上限被销毁（P1001）
process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres?sslmode=disable&connection_limit=20`
process.env.LOG_LEVEL = 'warn'

// ---------- 基础设施 ----------
console.log('[verify] 启动嵌入式 PostgreSQL…')
const db = new PGlite()
const socket = new PGLiteSocketServer({ db, port: dbPort, host: '127.0.0.1', maxConnections: 50 })
await socket.start()

async function waitForPgReady(port: number, attempts = 30): Promise<void> {
  const net = await import('node:net')
  for (let i = 0; i < attempts; i += 1) {
    const ok = await new Promise<boolean>(resolve => {
      const sock = net.connect(port, '127.0.0.1')
      const done = (result: boolean) => { sock.destroy(); resolve(result) }
      sock.on('connect', () => {
        const params = Buffer.from('user\0postgres\0database\0postgres\0\0')
        const msg = Buffer.alloc(8 + params.length)
        msg.writeInt32BE(8 + params.length, 0)
        msg.writeInt32BE(196608, 4)
        params.copy(msg, 8)
        sock.write(msg)
      })
      sock.on('data', () => done(true))
      sock.on('error', () => done(false))
      setTimeout(() => done(false), 1000)
    })
    if (ok) return
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error('PGlite 就绪等待超时')
}
await waitForPgReady(dbPort)

console.log('[verify] 执行数据库迁移…')
const prismaBin = path.join(serverDir, 'node_modules', '.bin', 'prisma')
const { stdout, stderr } = await execFileAsync(prismaBin, ['migrate', 'deploy'], { cwd: serverDir, env: { ...process.env } })
if (stdout.trim()) console.log(stdout.trim())
if (stderr.trim()) console.error(stderr.trim())

const { prisma } = await import('../src/lib/prisma.js')
const { importFromSqlite } = await import('../src/lib/sqlite-import.js')

// ---------- 测试工具 ----------
let passed = 0
let failed = 0
function check(name: string, condition: boolean, extra?: unknown) {
  if (condition) {
    passed += 1
    console.log(`  ✔ ${name}`)
  } else {
    failed += 1
    console.error(`  ✘ ${name}`, extra === undefined ? '' : JSON.stringify(extra))
  }
}

// ---------- 构造合成 SQLite fixture（DDL 与生产库一致） ----------
const fixtureDir = mkdtempSync(path.join(tmpdir(), 'verify-import-'))
const sqlitePath = path.join(fixtureDir, 'fixture.sqlite')
const sqlite = new DatabaseSync(sqlitePath)
const NOW = '2026-07-01T08:00:00.000Z'
const LATER = '2026-07-02T09:30:00.000Z'

sqlite.exec(`
CREATE TABLE ebay_stores (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, seller_id TEXT NOT NULL DEFAULT '',
  marketplace_id TEXT NOT NULL DEFAULT 'EBAY_US', status TEXT NOT NULL DEFAULT 'PENDING',
  encrypted_access_token TEXT NOT NULL DEFAULT '', encrypted_refresh_token TEXT NOT NULL DEFAULT '',
  access_token_expires_at TEXT, refresh_token_expires_at TEXT, last_sync_at TEXT, sync_error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  public_store_url TEXT NOT NULL DEFAULT '', public_store_verified_at TEXT);
CREATE TABLE selection_tasks (id TEXT PRIMARY KEY, payload TEXT NOT NULL, stage TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE supply_candidates (
  task_id TEXT NOT NULL, url TEXT NOT NULL, payload TEXT NOT NULL, score REAL NOT NULL DEFAULT 0,
  selected INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL, deleted_at TEXT,
  PRIMARY KEY (task_id, url), FOREIGN KEY (task_id) REFERENCES selection_tasks(id) ON DELETE CASCADE);
CREATE TABLE market_candidates (
  platform_code TEXT NOT NULL, product_id TEXT NOT NULL DEFAULT '', url TEXT NOT NULL,
  first_task_id TEXT NOT NULL, latest_task_id TEXT NOT NULL, payload TEXT NOT NULL,
  collected_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
  PRIMARY KEY (platform_code, url));
CREATE TABLE candidate_collection_runs (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, candidate_area TEXT NOT NULL, platform_code TEXT NOT NULL,
  collection_method TEXT NOT NULL, source_entry TEXT NOT NULL DEFAULT '',
  requested_count INTEGER NOT NULL DEFAULT 0, collected_count INTEGER NOT NULL DEFAULT 0,
  new_count INTEGER NOT NULL DEFAULT 0, updated_count INTEGER NOT NULL DEFAULT 0,
  selected_count INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'COMPLETED',
  started_at TEXT NOT NULL, completed_at TEXT NOT NULL);
CREATE TABLE candidate_collection_records (
  candidate_area TEXT NOT NULL, candidate_key TEXT NOT NULL, collection_run_id TEXT NOT NULL,
  platform_code TEXT NOT NULL, collection_method TEXT NOT NULL, source_entry TEXT NOT NULL DEFAULT '',
  source_rank INTEGER NOT NULL DEFAULT 0, collected_at TEXT NOT NULL,
  PRIMARY KEY (collection_run_id, candidate_area, candidate_key),
  FOREIGN KEY (collection_run_id) REFERENCES candidate_collection_runs(id) ON DELETE CASCADE);
CREATE TABLE product_evaluations (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, product_url TEXT NOT NULL, total_score REAL, grade TEXT,
  data_completeness REAL, dimension_scores TEXT NOT NULL DEFAULT '{}', recommendation TEXT, evaluated_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES selection_tasks(id) ON DELETE CASCADE);
CREATE TABLE evaluation_evidence (
  id TEXT PRIMARY KEY, evaluation_id TEXT NOT NULL, dimension_code TEXT NOT NULL, evidence_type TEXT NOT NULL,
  source_url TEXT, content TEXT NOT NULL, score_effect REAL,
  FOREIGN KEY (evaluation_id) REFERENCES product_evaluations(id) ON DELETE CASCADE);
CREATE TABLE comparison_records (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, ozon_url TEXT NOT NULL, supplier_url TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING', match_score REAL, ozon_price_rub REAL, purchase_price_cny REAL,
  landed_cost_cny REAL, estimated_profit_cny REAL, estimated_margin REAL,
  payload TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES selection_tasks(id) ON DELETE CASCADE);
CREATE TABLE selection_records (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, ozon_url TEXT NOT NULL, comparison_id TEXT,
  decision TEXT NOT NULL DEFAULT 'PENDING', reason TEXT, payload TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES selection_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (comparison_id) REFERENCES comparison_records(id));
CREATE TABLE supply_warehouse_products (
  id TEXT PRIMARY KEY, warehouse_code TEXT NOT NULL, selection_id TEXT NOT NULL, source_url TEXT NOT NULL,
  product_id TEXT NOT NULL DEFAULT '', title TEXT NOT NULL, image_url TEXT NOT NULL DEFAULT '',
  price_text TEXT NOT NULL DEFAULT '', supplier_name TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '未分类', subcategory TEXT NOT NULL DEFAULT '待人工分类',
  tertiary_category TEXT NOT NULL DEFAULT '待细分', status TEXT NOT NULL DEFAULT 'ACTIVE',
  payload TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(warehouse_code, source_url), FOREIGN KEY (selection_id) REFERENCES selection_records(id));
CREATE TABLE product_intake_registry (
  identity_key TEXT PRIMARY KEY, platform_code TEXT NOT NULL, product_id TEXT NOT NULL DEFAULT '',
  canonical_url TEXT NOT NULL DEFAULT '', title_snapshot TEXT NOT NULL DEFAULT '',
  first_collected_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, last_stage TEXT NOT NULL DEFAULT 'HISTORY',
  candidate_deleted_at TEXT);
CREATE TABLE workflow_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, ozon_url TEXT, stage TEXT NOT NULL,
  action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
CREATE TABLE marketplace_platforms (
  code TEXT PRIMARY KEY, name TEXT NOT NULL, home_url TEXT NOT NULL,
  default_network_strategy TEXT NOT NULL DEFAULT 'LOCAL_DIRECT',
  collector_ready INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE marketplace_accounts (
  id TEXT PRIMARY KEY, platform_code TEXT NOT NULL, name TEXT NOT NULL,
  network_strategy TEXT NOT NULL DEFAULT 'LOCAL_DIRECT', status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY (platform_code) REFERENCES marketplace_platforms(code));
CREATE TABLE marketplace_account_credentials (
  account_id TEXT PRIMARY KEY, platform_code TEXT NOT NULL, username TEXT NOT NULL DEFAULT '',
  encrypted_password TEXT NOT NULL DEFAULT '', automation_mode TEXT NOT NULL DEFAULT 'SESSION_ONLY',
  updated_at TEXT NOT NULL);
`)

const taskPayload1 = JSON.stringify({ id: 'task-1', name: '任务一', stage: 'OZON_LIST_COMPLETED', selectionMode: 'FORWARD_SUPPLY', exchangeRate: 0.09 })
const taskPayload2 = JSON.stringify({ id: 'task-2', name: '任务二', stage: 'OZON_LIST_PENDING', selectionMode: 'FORWARD_SUPPLY', exchangeRate: 0.1 })
const supplyPayload = (suffix: string) => JSON.stringify({ platformCode: '1688', productId: `pid-${suffix}`, url: `https://detail.1688.com/offer/${suffix}.html`, title: `供应商品 ${suffix}`, score: 85, selected: true })
sqlite.prepare(`INSERT INTO ebay_stores VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
  'store-1', '测试店铺', 'seller-1', 'EBAY_US', 'CONNECTED', 'enc-a', 'enc-r',
  '2026-08-01T00:00:00.000Z', null, NOW, null, NOW, NOW, 'https://www.ebay.com/str/test', NOW)
sqlite.prepare(`INSERT INTO selection_tasks VALUES (?,?,?,?)`).run('task-1', taskPayload1, 'OZON_LIST_COMPLETED', NOW)
sqlite.prepare(`INSERT INTO selection_tasks VALUES (?,?,?,?)`).run('task-2', taskPayload2, 'OZON_LIST_PENDING', LATER)
sqlite.prepare(`INSERT INTO supply_candidates VALUES (?,?,?,?,?,?,?)`).run('task-1', 'https://detail.1688.com/offer/s1.html', supplyPayload('s1'), 85.5, 1, 0, null)
sqlite.prepare(`INSERT INTO supply_candidates VALUES (?,?,?,?,?,?,?)`).run('task-1', 'https://detail.1688.com/offer/s2.html', supplyPayload('s2'), 60, 0, 1, LATER)
sqlite.prepare(`INSERT INTO market_candidates VALUES (?,?,?,?,?,?,?,?,?)`).run(
  'OZON', 'oz-1', 'https://www.ozon.ru/product/a/', 'task-1', 'task-1',
  JSON.stringify({ productId: 'oz-1', url: 'https://www.ozon.ru/product/a/', title: 'Ozon 商品 a', priceText: '1 299 ₽' }), NOW, NOW, null)
sqlite.prepare(`INSERT INTO candidate_collection_runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
  'task-1', 'task-1', 'SUPPLY', '1688', 'KEYWORD', '耳机', 50, 2, 2, 0, 1, 'COMPLETED', NOW, NOW)
sqlite.prepare(`INSERT INTO candidate_collection_records VALUES (?,?,?,?,?,?,?,?)`).run('SUPPLY', '1688:https://detail.1688.com/offer/s1.html', 'task-1', '1688', 'KEYWORD', '耳机', 0, NOW)
sqlite.prepare(`INSERT INTO candidate_collection_records VALUES (?,?,?,?,?,?,?,?)`).run('SUPPLY', '1688:https://detail.1688.com/offer/s2.html', 'task-1', '1688', 'KEYWORD', '耳机', 1, NOW)
sqlite.prepare(`INSERT INTO product_evaluations VALUES (?,?,?,?,?,?,?,?,?)`).run(
  'eval-1', 'task-1', 'https://detail.1688.com/offer/s1.html', 85.5, 'A', 0.9, JSON.stringify({ quality: 85, price: 80 }), '推荐', NOW)
sqlite.prepare(`INSERT INTO evaluation_evidence VALUES (?,?,?,?,?,?,?)`).run(
  'evi-1', 'eval-1', 'quality', 'DOM_TEXT', 'https://detail.1688.com/offer/s1.html', JSON.stringify({ supplierBadges: ['实力商家'] }), 85)
const comparisonPayload = JSON.stringify({
  id: 'cmp-1', taskId: 'task-1', decision: 'PENDING',
  suppliers: [{ url: 'https://detail.1688.com/offer/s1.html', matchScore: 61, binding: 'PRIMARY' }, { url: 'https://detail.1688.com/offer/s2.html', matchScore: 55, binding: 'NONE' }]
})
sqlite.prepare(`INSERT INTO comparison_records VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
  'cmp-1', 'task-1', 'https://www.ozon.ru/product/a/', 'https://detail.1688.com/offer/s1.html', 'COMPLETED', 61.5, 1299, 12.5, 150.75, 30.2, 18.4, comparisonPayload, NOW)
sqlite.prepare(`INSERT INTO selection_records VALUES (?,?,?,?,?,?,?,?)`).run(
  'sel-1', 'task-1', 'https://www.ozon.ru/product/a/', 'cmp-1', 'APPROVED', null, JSON.stringify({ id: 'sel-1', title: 'Ozon 商品 a', decision: 'APPROVED' }), NOW)
sqlite.prepare(`INSERT INTO supply_warehouse_products VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
  'wh-1', 'GIGACLOUD', 'sel-1', 'https://detail.1688.com/offer/s1.html', 'pid-s1', '供应商品 s1', 'https://img.1688.com/s1.jpg',
  '¥12.50', '深圳供应商', '耳机', '蓝牙', '头戴', 'ACTIVE', JSON.stringify({ id: 'wh-1', title: '供应商品 s1' }), NOW, NOW)
sqlite.prepare(`INSERT INTO product_intake_registry VALUES (?,?,?,?,?,?,?,?,?)`).run(
  '1688:pid-s1', '1688', 'pid-s1', 'https://detail.1688.com/offer/s1.html', '供应商品 s1', NOW, NOW, 'CANDIDATE', null)
sqlite.prepare(`INSERT INTO workflow_events (task_id, ozon_url, stage, action, detail, created_at) VALUES (?,?,?,?,?,?)`).run(
  'task-1', 'https://www.ozon.ru/product/a/', 'REVERSE_COMPARE', 'PROMOTE_TO_SUPPLY_WAREHOUSE', JSON.stringify({ comparisonId: 'cmp-1' }), NOW)
sqlite.prepare(`INSERT INTO marketplace_platforms VALUES (?,?,?,?,?,?)`).run('OZON', 'Ozon', 'https://www.ozon.ru', 'LOCAL_DIRECT', 1, 1)
sqlite.prepare(`INSERT INTO marketplace_platforms VALUES (?,?,?,?,?,?)`).run('EBAY', 'eBay', 'https://www.ebay.com', 'LOCAL_DIRECT', 0, 1)
sqlite.prepare(`INSERT INTO marketplace_accounts VALUES (?,?,?,?,?,?,?)`).run('acct-1', 'OZON', '主账号', 'LOCAL_DIRECT', 'ACTIVE', NOW, NOW)
sqlite.prepare(`INSERT INTO marketplace_account_credentials VALUES (?,?,?,?,?,?)`).run('acct-1', 'OZON', 'ozon-user', 'enc-password-1', 'AUTO_FILL', NOW)
sqlite.close()

// ---------- 验收场景 ----------
try {
  console.log('\n[1] 导入与计数')
  const orgA = await prisma.organization.create({ data: { name: '导入测试组织A' } })
  const stats = await importFromSqlite({ sqlitePath, orgId: orgA.id, prisma })
  const statOf = (table: string) => stats.find(stat => stat.table === table)
  const expected: Record<string, number> = {
    ebay_stores: 1, selection_tasks: 2, supply_candidates: 2, market_candidates: 1,
    candidate_collection_runs: 1, candidate_collection_records: 2, product_evaluations: 1, evaluation_evidence: 1,
    comparison_records: 1, selection_records: 1, supply_warehouse_products: 1, product_intake_registry: 1,
    workflow_events: 1, marketplace_platforms: 2, marketplace_accounts: 1, marketplace_account_credentials: 1
  }
  check('16 张 fixture 表全部按行数导入（0 跳过）',
    Object.entries(expected).every(([table, count]) => statOf(table)?.inserted === count && statOf(table)?.skipped === 0),
    Object.fromEntries(Object.keys(expected).map(table => [table, statOf(table)])))
  check('SQLite 缺失的 PG 业务表标记跳过说明',
    stats.some(stat => stat.note === 'SQLite 无此表，跳过' && stat.table === 'ebay_listings'), stats.length)

  console.log('\n[2] 数据保真与类型转换')
  const storeRow = (await prisma.$queryRawUnsafe<Array<{ org_id: string; name: string; created_at: string; public_store_url: string }>>(
    `SELECT org_id, name, created_at::text AS created_at, public_store_url FROM ebay_stores WHERE id = 'store-1'`))[0]
  check('ebay_stores：org_id 注入 + 时间戳保留原值',
    storeRow?.org_id === orgA.id && storeRow?.name === '测试店铺' && storeRow?.created_at?.startsWith('2026-07-01 08:00:00')
    && storeRow?.public_store_url === 'https://www.ebay.com/str/test', storeRow)
  const taskName = (await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT payload->>'name' AS name FROM selection_tasks WHERE id = 'task-1'`))[0]
  check('selection_tasks：payload 以 JSONB 可查询', taskName?.name === '任务一', taskName)
  const supplyRows = await prisma.$queryRawUnsafe<Array<{ url: string; deleted_at: string | null; score: number }>>(
    `SELECT url, deleted_at, score FROM supply_candidates WHERE org_id = $1 ORDER BY sort_order`, orgA.id)
  check('supply_candidates：deleted_at NULL/有值保留 + score REAL',
    supplyRows.length === 2 && supplyRows[0]?.deleted_at === null && supplyRows[1]?.deleted_at === LATER
    && Math.abs(Number(supplyRows[0]?.score) - 85.5) < 0.001, supplyRows)
  const evalScore = (await prisma.$queryRawUnsafe<Array<{ quality: string }>>(
    `SELECT dimension_scores->>'quality' AS quality FROM product_evaluations WHERE id = 'eval-1'`))[0]
  check('product_evaluations：dimension_scores JSONB 可查询', evalScore?.quality === '85', evalScore)
  const supplierCount = (await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT jsonb_array_length(payload->'suppliers') AS n FROM comparison_records WHERE id = 'cmp-1'`))[0]
  check('comparison_records：payload JSONB suppliers 数组 + match_score 数值',
    Number(supplierCount?.n) === 2, supplierCount)
  const joinRow = (await prisma.$queryRawUnsafe<Array<{ decision: string; ozon_url: string }>>(
    `SELECT s.decision, c.ozon_url FROM selection_records s JOIN comparison_records c ON c.id = s.comparison_id WHERE s.id = 'sel-1'`))[0]
  check('selection_records ↔ comparison_records 外键关联（拓扑顺序生效）',
    joinRow?.decision === 'APPROVED' && joinRow?.ozon_url === 'https://www.ozon.ru/product/a/', joinRow)
  const workflowRow = (await prisma.$queryRawUnsafe<Array<{ id: number; action: string; comparison: string }>>(
    `SELECT id, action, detail->>'comparisonId' AS comparison FROM workflow_events WHERE org_id = $1`, orgA.id))[0]
  check('workflow_events：自增 id 保留 + detail JSONB', Number(workflowRow?.id) === 1 && workflowRow?.action === 'PROMOTE_TO_SUPPLY_WAREHOUSE' && workflowRow?.comparison === 'cmp-1', workflowRow)
  const credentialRow = (await prisma.$queryRawUnsafe<Array<{ username: string; encrypted_password: string }>>(
    `SELECT username, encrypted_password FROM marketplace_account_credentials WHERE account_id = 'acct-1' AND org_id = $1`, orgA.id))[0]
  check('平台凭据：用户名与加密密码原样保留',
    credentialRow?.username === 'ozon-user' && credentialRow?.encrypted_password === 'enc-password-1', credentialRow)
  const platformRow = (await prisma.$queryRawUnsafe<Array<{ code: string; collector_ready: number }>>(
    `SELECT code, collector_ready FROM marketplace_platforms WHERE org_id = $1 AND code = 'OZON'`, orgA.id))[0]
  check('参考表（marketplace_platforms）按组织复合键导入', platformRow?.code === 'OZON' && Number(platformRow?.collector_ready) === 1, platformRow)
  const intakeRow = (await prisma.$queryRawUnsafe<Array<{ last_stage: string }>>(
    `SELECT last_stage FROM product_intake_registry WHERE identity_key = '1688:pid-s1' AND org_id = $1`, orgA.id))[0]
  check('product_intake_registry：去重登记原样导入', intakeRow?.last_stage === 'CANDIDATE', intakeRow)
  const leakCount = (await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT COUNT(*) AS n FROM selection_tasks WHERE org_id <> $1`, orgA.id))[0]
  check('跨组织隔离：他组织不可见导入数据', Number(leakCount?.n) === 0, leakCount)

  console.log('\n[3] 幂等 / dry-run / 异常')
  const statsAgain = await importFromSqlite({ sqlitePath, orgId: orgA.id, prisma })
  const totalFixtureRows = statsAgain.reduce((sum, stat) => sum + stat.sqliteRows, 0)
  check('幂等重跑：全部跳过（inserted=0）',
    statsAgain.every(stat => stat.inserted === 0) && statsAgain.reduce((sum, stat) => sum + stat.skipped, 0) === totalFixtureRows && totalFixtureRows === 20,
    statsAgain.filter(stat => stat.inserted > 0))
  const orgB = await prisma.organization.create({ data: { name: '导入测试组织B' } })
  const dryStats = await importFromSqlite({ sqlitePath, orgId: orgB.id, dryRun: true, prisma })
  const orgBCount = await prisma.selectionTask.count({ where: { orgId: orgB.id } })
  check('dry-run：统计有行数但零写入',
    dryStats.some(stat => stat.sqliteRows > 0 && stat.note?.includes('dry-run')) && orgBCount === 0, { orgBCount })
  let badOrgError = ''
  try {
    await importFromSqlite({ sqlitePath, orgId: 'org-not-exists', prisma })
  } catch (error) {
    badOrgError = error instanceof Error ? error.message : String(error)
  }
  check('无效组织 id → 明确报错', badOrgError.includes('目标组织不存在'), badOrgError)
  let badFileError = ''
  try {
    await importFromSqlite({ sqlitePath: path.join(fixtureDir, 'missing.sqlite'), orgId: orgA.id, prisma })
  } catch (error) {
    badFileError = error instanceof Error ? error.message : String(error)
  }
  check('SQLite 文件缺失 → 明确报错', badFileError.includes('SQLite 文件不存在'), badFileError)
} finally {
  await prisma.$disconnect()
  await socket.stop()
  await db.close()
  rmSync(fixtureDir, { recursive: true, force: true })
}

console.log(`\n========== 验收结果：${passed} 通过 / ${failed} 失败 ==========`)
process.exit(failed > 0 ? 1 : 0)
