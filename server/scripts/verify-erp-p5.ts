/**
 * ERP P5 巡盘 + 通知端到端验收脚本（对照方案 P5 验收标准）：
 * 验收标准原文：
 *   「scheduler + 双通道巡盘 + 变更确认 + 通知中心 |
 *     mock 货盘改价/改库存生成 crawl_logs+通知；≥published 标红；早 8 点汇总可见；
 *     10 万品分批并发配置生效不触发风控」
 *
 * 覆盖断言：
 *   1. mock 货盘改价/改库存 → 生成 crawl_logs + 通知（SERVER 通道 fetcher 注入）
 *   2. 命中已发布（status=PUBLISHED）产品变更 → PATROL_URGENT 标红（urgent=true）
 *   3. 未发布产品变更 → PATROL_CHANGE（urgent=false）
 *   4. 双通道路由：SERVER 直连抓取 / CLIENT 下发客户端（clientDispatcher 调用）
 *   5. 早 8 点汇总可见：buildMorningSummary → totalChanges/urgentChanges/pendingProducts + MORNING_SUMMARY 通知
 *   6. 10 万品分批并发配置生效：planPatrolBatches 数学 + runPool/runPatrolBatch 峰值并发 ≤ concurrency
 *   7. 变更确认：APPLY 采纳新值写入产品 / DISMISS 忽略；采集角色 resolve 403
 *   8. 通知已读：单条 read + 全部 read-all
 *   9. 权限隔离：未登录 401
 *
 * 运行：npx tsx scripts/verify-erp-p5.ts
 */
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { execFile } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import type { PatrolPayload } from '../src/modules/erp/patrol.js'

const execFileAsync = promisify(execFile)
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dbPort = 5440

process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres?sslmode=disable`
process.env.JWT_SECRET = 'verify-erp-secret'
process.env.ACCESS_TOKEN_TTL = '1h'
process.env.REFRESH_TOKEN_TTL_DAYS = '7'
process.env.LOG_LEVEL = 'warn'
process.env.MEDIA_DRIVER = 'local'
process.env.ERP_PATROL_ENABLED = 'false' // 验收脚本手动触发巡盘，禁用后台定时器避免干扰
process.env.ERP_PATROL_BATCH_SIZE = '2'
process.env.ERP_PATROL_CONCURRENCY = '3'
process.env.ERP_PATROL_DELAY_MS = '0'

console.log('[verify-erp-p5] 启动嵌入式 PostgreSQL…')
const db = new PGlite()
const socket = new PGLiteSocketServer({ db, port: dbPort, host: '127.0.0.1', maxConnections: 10 })
await socket.start()

async function waitForPgReady(port: number, attempts = 30): Promise<void> {
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

console.log('[verify-erp-p5] 执行数据库迁移…')
const prismaBin = path.join(serverDir, 'node_modules', '.bin', 'prisma')
await execFileAsync(prismaBin, ['migrate', 'deploy'], { cwd: serverDir, env: { ...process.env } })

console.log('[verify-erp-p5] 启动应用…')
const { buildApp } = await import('../src/app.js')
const { prisma } = await import('../src/lib/prisma.js')
const { runPatrolBatch, planPatrolBatches, runPool } = await import('../src/modules/erp/patrol.js')
const { registerPatrolFetcher } = await import('../src/modules/erp/scheduler.js')
const app = await buildApp()
await app.listen({ port: 0, host: '127.0.0.1' })
const address = app.server.address()
const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`

let passed = 0
let failed = 0
function check(name: string, condition: boolean, extra?: unknown) {
  if (condition) { passed += 1; console.log(`  ✔ ${name}`) } else { failed += 1; console.error(`  ✘ ${name}`, extra === undefined ? '' : JSON.stringify(extra)) }
}

interface ApiResult { status: number; data: any }
async function api(method: string, pathName: string, body?: unknown, token?: string): Promise<ApiResult> {
  const response = await fetch(base + pathName, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  let data: any = null
  try { data = await response.json() } catch { /* 无响应体 */ }
  return { status: response.status, data }
}

const now = new Date().toISOString()

try {
  console.log('\n[0] 注册 + 采集/运营子帐号')
  const register = await api('POST', '/api/auth/register', { name: '老板', email: '13900000001', password: 'Owner#2026erp' })
  const ownerToken: string = register.data?.accessToken ?? register.data?.tokens?.accessToken
  const ownerRow = await prisma.user.findUnique({ where: { email: '13900000001' } })
  const orgId = ownerRow!.orgId
  const roles = await prisma.role.findMany({ where: { orgId }, select: { id: true, key: true } })
  const roleKeyMap = new Map(roles.map(role => [role.key, role.id]))
  const collectorMember = await api('POST', '/api/members', { email: '13900000002', password: 'Collector#2026', name: '采集小张', roleIds: [roleKeyMap.get('COLLECTOR')!] }, ownerToken)
  const operatorMember = await api('POST', '/api/members', { email: '13900000003', password: 'Operator#2026', name: '运营小李', roleIds: [roleKeyMap.get('OPERATOR')!] }, ownerToken)
  for (const member of [collectorMember, operatorMember]) {
    if (member.data?.id && member.data?.status && member.data.status !== 'ACTIVE') {
      await api('POST', `/api/members/${member.data.id}/approve`, {}, ownerToken)
    }
  }
  const collectorLogin = await api('POST', '/api/auth/login', { email: '13900000002', password: 'Collector#2026' })
  const collectorToken: string = collectorLogin.data?.accessToken ?? collectorLogin.data?.tokens?.accessToken
  const operatorLogin = await api('POST', '/api/auth/login', { email: '13900000003', password: 'Operator#2026' })
  const operatorToken: string = operatorLogin.data?.accessToken ?? operatorLogin.data?.tokens?.accessToken
  check('双角色登录成功', Boolean(collectorToken) && Boolean(operatorToken), { collector: collectorLogin.status, operator: operatorLogin.status })

  console.log('\n[1] 建 SERVER / CLIENT 双通道货盘 + 产品')
  const serverSupplier = await prisma.erpSupplier.create({
    data: { orgId, code: 'S1688', name: '1688', loginUrl: 'https://www.1688.com/', crawlRules: {}, patrolChannel: 'SERVER', createdAt: now, updatedAt: now }
  })
  const clientSupplier = await prisma.erpSupplier.create({
    data: { orgId, code: 'GIGA', name: '大健云仓', loginUrl: 'https://www.gigab2b.com/', crawlRules: {}, patrolChannel: 'CLIENT', createdAt: now, updatedAt: now }
  })
  // SERVER 通道：已发布产品（改价应标红）+ 未发布产品（改库存不标红）+ 并发验证用产品
  const published = await prisma.erpProduct.create({
    data: { orgId, supplierId: serverSupplier.id, sourceProductId: 'S-PUB-1', sourceUrl: 'https://1688.com/p/1', titleOriginal: '已发布宠物刷', costPrice: 20, stockQuantity: 100, status: 'PUBLISHED', createdAt: now, updatedAt: now }
  })
  const collected = await prisma.erpProduct.create({
    data: { orgId, supplierId: serverSupplier.id, sourceProductId: 'S-COL-1', sourceUrl: 'https://1688.com/p/2', titleOriginal: '待加工宠物碗', costPrice: 8, stockQuantity: 50, status: 'COLLECTED', createdAt: now, updatedAt: now }
  })
  // CLIENT 通道：应下发客户端而非服务端直连
  const clientProduct = await prisma.erpProduct.create({
    data: { orgId, supplierId: clientSupplier.id, sourceProductId: 'C-1', sourceUrl: 'https://gigab2b.com/p/9', titleOriginal: '客户端货盘品', costPrice: 30, stockQuantity: 10, status: 'COLLECTED', createdAt: now, updatedAt: now }
  })
  check('前置：3 个产品建好（PUBLISHED/COLLECTED/CLIENT）', Boolean(published.id && collected.id && clientProduct.id))

  console.log('\n[2] 双通道巡盘：SERVER 直连抓取 + CLIENT 下发（mock fetcher/dispatcher）')
  // mock 货盘：已发布品改价 20→18，未发布品改库存 50→0
  const mockPayloads: Record<string, PatrolPayload> = {
    [published.id]: { costPrice: 18 },
    [collected.id]: { stockQuantity: 0 }
  }
  const dispatched: string[] = []
  const runRes = await runPatrolBatch(orgId, {
    fetcher: async product => mockPayloads[product.id] ?? null,
    clientDispatcher: async product => { dispatched.push(product.id) },
    batchSize: 2,
    concurrency: 3,
    delayMs: 0
  })
  check('巡盘扫描全部 3 个产品', runRes.scanned === 3, runRes.scanned)
  check('双通道路由：SERVER 通道 2 个 / CLIENT 通道 1 个', runRes.serverChannel === 2 && runRes.clientChannel === 1, { server: runRes.serverChannel, client: runRes.clientChannel })
  check('CLIENT 通道下发客户端（dispatcher 命中，不走服务端抓取）', dispatched.length === 1 && dispatched[0] === clientProduct.id, dispatched)
  check('SERVER 通道检测到 2 项变更', runRes.changed === 2, runRes.changed)
  check('其中 1 项命中已发布（urgent=1）', runRes.urgent === 1, runRes.urgent)

  console.log('\n[3] mock 改价/改库存 → 生成 crawl_logs + 通知')
  const pubLogs = await prisma.erpCrawlLog.findMany({ where: { productId: published.id } })
  check('已发布品改价生成 crawl_log（costPrice 20→18）', pubLogs.some(l => l.fieldChanged === 'costPrice' && l.oldValue === '20' && l.newValue === '18'), pubLogs)
  check('crawl_log notified=1（已触发通知）', pubLogs.every(l => l.notified === 1), pubLogs.map(l => l.notified))
  const colLogs = await prisma.erpCrawlLog.findMany({ where: { productId: collected.id } })
  check('未发布品改库存生成 crawl_log（stockQuantity 50→0）', colLogs.some(l => l.fieldChanged === 'stockQuantity' && l.oldValue === '50' && l.newValue === '0'), colLogs)
  const pubAfter = await prisma.erpProduct.findUnique({ where: { id: published.id } })
  check('巡盘不直接覆盖产品字段（costPrice 仍为原值 20，仅置 change_flag=1）', pubAfter?.costPrice === 20 && pubAfter?.changeFlag === 1, { cost: pubAfter?.costPrice, flag: pubAfter?.changeFlag })

  console.log('\n[4] ≥published 标红：PATROL_URGENT vs PATROL_CHANGE')
  const notifRes = await api('GET', '/api/erp/notifications', undefined, operatorToken)
  check('通知列表 200', notifRes.status === 200, notifRes.status)
  const urgentNotif = notifRes.data.items.find((n: any) => n.productId === published.id)
  const normalNotif = notifRes.data.items.find((n: any) => n.productId === collected.id)
  check('已发布品变更 → PATROL_URGENT 且 urgent=true（标红）', urgentNotif?.kind === 'PATROL_URGENT' && urgentNotif?.urgent === true, urgentNotif)
  check('未发布品变更 → PATROL_CHANGE 且 urgent=false', normalNotif?.kind === 'PATROL_CHANGE' && normalNotif?.urgent === false, normalNotif)
  check('通知含未读计数 ≥2', notifRes.data.unread >= 2, notifRes.data.unread)

  console.log('\n[5] 早 8 点汇总可见')
  const summaryRes = await api('POST', '/api/erp/notifications/summary', {}, operatorToken)
  check('汇总接口 200', summaryRes.status === 200, summaryRes.status)
  check('汇总统计过去 24h 变更数 ≥2', summaryRes.data?.totalChanges >= 2, summaryRes.data?.totalChanges)
  check('汇总标记紧急变更数 ≥1（命中已发布）', summaryRes.data?.urgentChanges >= 1, summaryRes.data?.urgentChanges)
  check('汇总标记待确认产品数 ≥2', summaryRes.data?.pendingProducts >= 2, summaryRes.data?.pendingProducts)
  const afterSummary = await api('GET', '/api/erp/notifications?kind=MORNING_SUMMARY', undefined, operatorToken)
  check('MORNING_SUMMARY 通知已落库可见', afterSummary.data.items.some((n: any) => n.kind === 'MORNING_SUMMARY'), afterSummary.data.items)

  console.log('\n[6] 10 万品分批并发配置生效（不触发风控）')
  const plan = planPatrolBatches(100000, 200, 3)
  check('10 万品分批：batchSize=200 → 500 批', plan.batchCount === 500, plan.batchCount)
  check('并发上限 maxInFlight=3', plan.maxInFlight === 3, plan.maxInFlight)
  const poolStats = await runPool(Array.from({ length: 30 }, (_, i) => i), 3, 0, async () => { await new Promise(r => setTimeout(r, 2)) })
  check('runPool 峰值并发 ≤ concurrency=3（并发上限强制生效）', poolStats.peakConcurrency <= 3 && poolStats.peakConcurrency > 1, poolStats.peakConcurrency)
  check('runPatrolBatch 回传分批计划遵循配置', runRes.plan.batchSize === 2 && runRes.plan.concurrency === 3, runRes.plan)
  check('runPatrolBatch 峰值并发 ≤ 3', runRes.pool.peakConcurrency <= 3, runRes.pool.peakConcurrency)
  const throttled = await runPool(Array.from({ length: 4 }, (_, i) => i), 1, 40, async () => { /* no-op */ })
  check('节流生效：delayMs=40 时相邻启动间隔 ≥35ms', throttled.gapsMs.every(g => g >= 35), throttled.gapsMs)

  console.log('\n[7] 变更确认：APPLY 采纳 / DISMISS 忽略 / 权限')
  const changesRes = await api('GET', '/api/erp/changes', undefined, operatorToken)
  check('待确认变更列表 200 且含 2 个产品', changesRes.status === 200 && changesRes.data.total === 2, changesRes.data?.total)
  const pubChange = changesRes.data.items.find((c: any) => c.productId === published.id)
  check('已发布品变更项 published=true（供 UI 标红）', pubChange?.published === true, pubChange?.published)
  check('变更项含字段级 diff（costPrice）', (pubChange?.changes ?? []).some((ch: any) => ch.field === 'costPrice'), pubChange?.changes)
  // APPLY：采纳新值 costPrice 18 写入产品，清 change_flag
  const applyRes = await api('POST', `/api/erp/changes/${published.id}/resolve`, { action: 'APPLY' }, operatorToken)
  check('APPLY 变更确认 200', applyRes.status === 200, applyRes.status)
  const appliedProduct = await prisma.erpProduct.findUnique({ where: { id: published.id } })
  check('APPLY 后产品 costPrice 采纳为新值 18', appliedProduct?.costPrice === 18, appliedProduct?.costPrice)
  check('APPLY 后 change_flag 清零', appliedProduct?.changeFlag === 0, appliedProduct?.changeFlag)
  // DISMISS：忽略变更，产品原值不变，清 change_flag
  const dismissRes = await api('POST', `/api/erp/changes/${collected.id}/resolve`, { action: 'DISMISS' }, operatorToken)
  check('DISMISS 变更确认 200', dismissRes.status === 200, dismissRes.status)
  const dismissedProduct = await prisma.erpProduct.findUnique({ where: { id: collected.id } })
  check('DISMISS 后产品 stockQuantity 保留原值 50（未采纳 0）', dismissedProduct?.stockQuantity === 50, dismissedProduct?.stockQuantity)
  check('DISMISS 后 change_flag 清零', dismissedProduct?.changeFlag === 0, dismissedProduct?.changeFlag)
  const changesAfter = await api('GET', '/api/erp/changes', undefined, operatorToken)
  check('确认后待确认列表清空（total=0）', changesAfter.data.total === 0, changesAfter.data.total)
  // 权限：采集角色无 erp.changes.resolve
  await prisma.erpProduct.update({ where: { id: collected.id }, data: { changeFlag: 1 } })
  const collectorResolve = await api('POST', `/api/erp/changes/${collected.id}/resolve`, { action: 'APPLY' }, collectorToken)
  check('采集角色变更确认 403（无 erp.changes.resolve）', collectorResolve.status === 403, collectorResolve.status)
  await prisma.erpProduct.update({ where: { id: collected.id }, data: { changeFlag: 0 } })

  console.log('\n[8] 手动触发巡盘 HTTP 端点（复用注入的真实抓取器）')
  registerPatrolFetcher(async product => ({ costPrice: 99, _pid: product.id } as unknown as PatrolPayload))
  const patrolRunRes = await api('POST', '/api/erp/patrol/run', { batchSize: 2, concurrency: 3 }, operatorToken)
  check('POST /patrol/run 200 且扫描 SERVER 通道产品', patrolRunRes.status === 200 && patrolRunRes.data?.scanned >= 2, patrolRunRes.data?.scanned)
  const collectorPatrol = await api('POST', '/api/erp/patrol/run', {}, collectorToken)
  check('采集角色触发巡盘 403', collectorPatrol.status === 403, collectorPatrol.status)

  console.log('\n[9] 通知已读 + 权限隔离')
  const oneNotif = (await api('GET', '/api/erp/notifications?unreadOnly=true', undefined, operatorToken)).data.items[0]
  const readOne = await api('POST', `/api/erp/notifications/${oneNotif.id}/read`, {}, operatorToken)
  check('单条通知标记已读（read=true）', readOne.status === 200 && readOne.data?.read === true, readOne.data)
  const readAll = await api('POST', '/api/erp/notifications/read-all', {}, operatorToken)
  check('全部标记已读接口 200', readAll.status === 200, readAll.status)
  const afterRead = await api('GET', '/api/erp/notifications', undefined, operatorToken)
  check('全部已读后未读数=0', afterRead.data.unread === 0, afterRead.data.unread)
  const anonChanges = await api('GET', '/api/erp/changes')
  check('未登录访问变更列表 401', anonChanges.status === 401, anonChanges.status)
  const anonNotif = await api('GET', '/api/erp/notifications')
  check('未登录访问通知中心 401', anonNotif.status === 401, anonNotif.status)
} catch (error) {
  failed += 1
  console.error('[verify-erp-p5] 异常：', error)
}

console.log(`\n[verify-erp-p5] 通过 ${passed} 项，失败 ${failed} 项`)
await app.close()
await socket.stop()
process.exit(failed === 0 ? 0 : 1)
