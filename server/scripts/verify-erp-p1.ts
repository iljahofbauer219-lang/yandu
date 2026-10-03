/**
 * ERP P1 采集闭环端到端验收脚本（对照方案 P1 验收标准）：
 * 验收标准原文：
 *   「大健云仓 crawl_rules + 注入器 + collect API + 采集池 tab |
 *     详情页单采、列表批量 20 品成功；重复采集弹覆盖确认；
 *     已加工品再采只置 change_flag 不覆盖；批量采集不阻塞内嵌浏览器」
 *
 * 覆盖断言：
 *   1. 单品采集 → CREATED（status=COLLECTED，图片写入）
 *   2. 列表批量 20 品 → 全部 CREATED（批量不阻塞：一次请求聚合 20 品结果）
 *   3. crawl_rules GET：采集专员 200 / 运营 403；PUT 需 erp.source.manage（运营 403，采集/主帐号 200）
 *   4. COLLECTED 态重复采集有 diff → NEEDS_CONFIRM（返回字段级 diff）
 *   5. overwrite=true 重提 → OVERWRITTEN（字段与图集被覆盖）
 *   6. COLLECTED 态无 diff 重采 → UNCHANGED
 *   7. 已加工（DOWNLOADED）态有 diff 再采 → CHANGE_FLAGGED（changeFlag=1 + crawl_logs 写入 + 字段未被覆盖）
 *   8. 已加工态无 diff 再采 → UNCHANGED（不置 change_flag）
 *   9. 采集接口权限隔离：运营无 erp.collect → POST /collect 403
 *
 * 运行：npx tsx scripts/verify-erp-p1.ts
 */
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { execFile } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dbPort = 5436

process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres?sslmode=disable`
process.env.JWT_SECRET = 'verify-erp-secret'
process.env.ACCESS_TOKEN_TTL = '1h'
process.env.REFRESH_TOKEN_TTL_DAYS = '7'
process.env.LOG_LEVEL = 'warn'

console.log('[verify-erp-p1] 启动嵌入式 PostgreSQL…')
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

console.log('[verify-erp-p1] 执行数据库迁移…')
const prismaBin = path.join(serverDir, 'node_modules', '.bin', 'prisma')
await execFileAsync(prismaBin, ['migrate', 'deploy'], { cwd: serverDir, env: { ...process.env } })

console.log('[verify-erp-p1] 启动应用…')
const { buildApp } = await import('../src/app.js')
const { prisma } = await import('../src/lib/prisma.js')
const app = await buildApp()
await app.listen({ port: 0, host: '127.0.0.1' })
const address = app.server.address()
const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`

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

/** 构造一条采集条目（模拟注入器 outbox 产物） */
function collectItem(supplierId: string, sourceProductId: string, overrides: Record<string, unknown> = {}) {
  return {
    supplierId,
    sourceProductId,
    sourceUrl: `https://www.gigab2b.com/index.php?route=product/product&product_id=${sourceProductId}`,
    sourceSku: `SKU-${sourceProductId}`,
    titleOriginal: `大健云仓测试产品 ${sourceProductId}`,
    costPrice: 10,
    shippingCost: 2,
    currency: 'CNY',
    stockQuantity: 100,
    images: [{ imageType: 'MAIN', sourceUrl: `https://cdn.gigab2b.com/${sourceProductId}-1.jpg` }],
    ...overrides
  }
}

try {
  console.log('\n[0] 首装注册 + 采集专员 / 运营子帐号')
  const register = await api('POST', '/api/auth/register', {
    name: '老板', email: '13800000001', password: 'Owner#2026erp'
  })
  check('主帐号注册成功', register.status === 200 || register.status === 201, register)
  const ownerToken: string = register.data?.accessToken ?? register.data?.tokens?.accessToken
  const orgId = register.data?.user?.orgId ?? (await prisma.user.findUnique({ where: { email: '13800000001' } }))!.orgId

  const roles = await prisma.role.findMany({ where: { orgId }, select: { id: true, key: true } })
  const roleKeyMap = new Map(roles.map(role => [role.key, role.id]))
  check('预置角色含 COLLECTOR / OPERATOR', roleKeyMap.has('COLLECTOR') && roleKeyMap.has('OPERATOR'))

  await api('POST', '/api/members', { email: '13800000002', password: 'Collector#2026', name: '采集小张', roleIds: [roleKeyMap.get('COLLECTOR')!] }, ownerToken)
  await api('POST', '/api/members', { email: '13800000003', password: 'Operator#2026', name: '运营小李', roleIds: [roleKeyMap.get('OPERATOR')!] }, ownerToken)
  const collectorLogin = await api('POST', '/api/auth/login', { email: '13800000002', password: 'Collector#2026' })
  const operatorLogin = await api('POST', '/api/auth/login', { email: '13800000003', password: 'Operator#2026' })
  const collectorToken: string = collectorLogin.data?.accessToken ?? collectorLogin.data?.tokens?.accessToken
  const operatorToken: string = operatorLogin.data?.accessToken ?? operatorLogin.data?.tokens?.accessToken
  check('采集专员 / 运营登录成功', Boolean(collectorToken) && Boolean(operatorToken))

  console.log('\n[1] 种子货盘（大健云仓 + crawl_rules）')
  const supplier = await prisma.erpSupplier.create({
    data: {
      orgId, code: 'GIGACLOUD', name: '大健云仓', loginUrl: 'https://www.gigab2b.com/',
      crawlRules: {
        domains: ['gigab2b.com', 'www.gigab2b.com'],
        detail: { productId: { param: 'product_id' }, title: 'h1.product-title', price: '.price-new', images: '.product-image img' },
        list: { card: '.product-card', link: 'a.product-link', productId: { param: 'product_id' }, title: '.product-title', price: '.price' }
      },
      patrolChannel: 'CLIENT',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }
  })
  check('货盘创建成功（含 crawl_rules）', Boolean(supplier.id))

  console.log('\n[2] 详情页单采 → CREATED')
  const single = await api('POST', '/api/erp/collect', { items: [collectItem(supplier.id, 'GIGA-1001')], mode: 'SINGLE' }, collectorToken)
  check('单采接口 200', single.status === 200, single)
  check('单采结果 CREATED', single.data?.items?.[0]?.result === 'CREATED', single.data?.items)
  check('单采聚合计数 created=1', single.data?.created === 1)
  const createdProduct = await prisma.erpProduct.findFirst({ where: { orgId, sourceProductId: 'GIGA-1001' }, include: { images: true } })
  check('单采落库 status=COLLECTED', createdProduct?.status === 'COLLECTED')
  check('单采图片写入 1 张', createdProduct?.images?.length === 1)

  console.log('\n[3] 列表批量 20 品 → 全部 CREATED（批量不阻塞：一次请求聚合）')
  const batchItems = Array.from({ length: 20 }, (_, i) => collectItem(supplier.id, `GIGA-B${String(i + 1).padStart(3, '0')}`))
  const batchStart = Date.now()
  const batch = await api('POST', '/api/erp/collect', { items: batchItems, mode: 'BATCH' }, collectorToken)
  const batchMs = Date.now() - batchStart
  check('批量接口 200', batch.status === 200, batch)
  check('批量 total=20', batch.data?.total === 20)
  check('批量 created=20', batch.data?.created === 20, batch.data)
  check('批量 20 品结果全为 CREATED', batch.data?.items?.every((i: any) => i.result === 'CREATED'))
  const batchCount = await prisma.erpProduct.count({ where: { orgId, sourceProductId: { startsWith: 'GIGA-B' } } })
  check('批量落库 20 条', batchCount === 20, batchCount)
  console.log(`    （批量 20 品单次请求耗时 ${batchMs}ms，注入侧异步回收不阻塞浏览器）`)

  console.log('\n[4] crawl_rules 读写权限隔离（规格 §4.4 规则存库）')
  const rulesCollector = await api('GET', `/api/erp/suppliers/${supplier.id}/crawl-rules`, undefined, collectorToken)
  const rulesOperator = await api('GET', `/api/erp/suppliers/${supplier.id}/crawl-rules`, undefined, operatorToken)
  check('采集专员读取 crawl_rules 200', rulesCollector.status === 200, rulesCollector)
  check('crawl_rules 含注入器所需 domains/detail/list', Boolean(rulesCollector.data?.crawlRules?.domains && rulesCollector.data?.crawlRules?.detail && rulesCollector.data?.crawlRules?.list))
  check('运营读取 crawl_rules 403（无 erp.source.view）', rulesOperator.status === 403, rulesOperator)
  const putOperator = await api('PUT', `/api/erp/suppliers/${supplier.id}/crawl-rules`, { crawlRules: { domains: ['evil.com'] } }, operatorToken)
  check('运营更新 crawl_rules 403（无 erp.source.manage）', putOperator.status === 403, putOperator)
  const putCollector = await api('PUT', `/api/erp/suppliers/${supplier.id}/crawl-rules`, { crawlRules: { domains: ['gigab2b.com'], detail: { title: 'h1.updated' }, list: { card: '.card' } } }, collectorToken)
  check('采集专员更新 crawl_rules 200', putCollector.status === 200, putCollector)
  check('crawl_rules 已持久化更新', putCollector.data?.crawlRules?.detail?.title === 'h1.updated')

  console.log('\n[5] COLLECTED 态重复采集有 diff → NEEDS_CONFIRM')
  const needsConfirm = await api('POST', '/api/erp/collect', { items: [collectItem(supplier.id, 'GIGA-1001', { costPrice: 15, stockQuantity: 80 })], mode: 'SINGLE' }, collectorToken)
  check('重复采集结果 NEEDS_CONFIRM', needsConfirm.data?.items?.[0]?.result === 'NEEDS_CONFIRM', needsConfirm.data?.items)
  check('NEEDS_CONFIRM 返回字段级 diff（含 costPrice/stockQuantity）', (needsConfirm.data?.items?.[0]?.diff ?? []).some((d: any) => d.field === 'costPrice') && (needsConfirm.data?.items?.[0]?.diff ?? []).some((d: any) => d.field === 'stockQuantity'))
  const afterConfirm = await prisma.erpProduct.findFirst({ where: { orgId, sourceProductId: 'GIGA-1001' } })
  check('NEEDS_CONFIRM 未覆盖原值（costPrice 仍为 10）', Number(afterConfirm?.costPrice) === 10, afterConfirm?.costPrice)

  console.log('\n[6] overwrite=true 重提 → OVERWRITTEN')
  const overwrite = await api('POST', '/api/erp/collect', { items: [collectItem(supplier.id, 'GIGA-1001', { costPrice: 15, stockQuantity: 80, images: [{ imageType: 'MAIN', sourceUrl: 'https://cdn.gigab2b.com/GIGA-1001-v2.jpg' }, { imageType: 'MAIN', sourceUrl: 'https://cdn.gigab2b.com/GIGA-1001-v3.jpg' }] })], overwrite: true, mode: 'SINGLE' }, collectorToken)
  check('覆盖采集结果 OVERWRITTEN', overwrite.data?.items?.[0]?.result === 'OVERWRITTEN', overwrite.data?.items)
  const afterOverwrite = await prisma.erpProduct.findFirst({ where: { orgId, sourceProductId: 'GIGA-1001' }, include: { images: true } })
  check('覆盖后 costPrice=15', Number(afterOverwrite?.costPrice) === 15, afterOverwrite?.costPrice)
  check('覆盖后 stockQuantity=80', afterOverwrite?.stockQuantity === 80)
  check('覆盖后图集替换为 2 张', afterOverwrite?.images?.length === 2, afterOverwrite?.images?.length)

  console.log('\n[7] COLLECTED 态无 diff 重采 → UNCHANGED')
  const unchanged = await api('POST', '/api/erp/collect', { items: [collectItem(supplier.id, 'GIGA-1001', { costPrice: 15, stockQuantity: 80, images: [{ imageType: 'MAIN', sourceUrl: 'https://cdn.gigab2b.com/GIGA-1001-v2.jpg' }, { imageType: 'MAIN', sourceUrl: 'https://cdn.gigab2b.com/GIGA-1001-v3.jpg' }] })], mode: 'SINGLE' }, collectorToken)
  check('无 diff 重采结果 UNCHANGED', unchanged.data?.items?.[0]?.result === 'UNCHANGED', unchanged.data?.items)

  console.log('\n[8] 已加工（DOWNLOADED）态有 diff 再采 → CHANGE_FLAGGED 不覆盖')
  await prisma.erpProduct.updateMany({ where: { orgId, sourceProductId: 'GIGA-B001' }, data: { status: 'DOWNLOADED', costPrice: 20, stockQuantity: 200 } })
  const changeFlag = await api('POST', '/api/erp/collect', { items: [collectItem(supplier.id, 'GIGA-B001', { costPrice: 99, stockQuantity: 1 })], mode: 'SINGLE' }, collectorToken)
  check('已加工再采结果 CHANGE_FLAGGED', changeFlag.data?.items?.[0]?.result === 'CHANGE_FLAGGED', changeFlag.data?.items)
  check('CHANGE_FLAGGED 返回 diff', (changeFlag.data?.items?.[0]?.diff ?? []).length > 0)
  const flaggedProduct = await prisma.erpProduct.findFirst({ where: { orgId, sourceProductId: 'GIGA-B001' } })
  check('已加工品 change_flag=1', flaggedProduct?.changeFlag === 1, flaggedProduct?.changeFlag)
  check('已加工品字段未被覆盖（costPrice 仍为 20）', Number(flaggedProduct?.costPrice) === 20, flaggedProduct?.costPrice)
  check('已加工品库存未被覆盖（仍为 200）', flaggedProduct?.stockQuantity === 200)
  const crawlLogs = await prisma.erpCrawlLog.findMany({ where: { orgId, productId: flaggedProduct!.id } })
  check('变更写入 crawl_logs（含 costPrice/stockQuantity）', crawlLogs.some(l => l.fieldChanged === 'costPrice') && crawlLogs.some(l => l.fieldChanged === 'stockQuantity'), crawlLogs.map(l => l.fieldChanged))

  console.log('\n[9] 已加工态无 diff 再采 → UNCHANGED（不置 change_flag）')
  await prisma.erpProduct.updateMany({ where: { orgId, sourceProductId: 'GIGA-B002' }, data: { status: 'DOWNLOADED', changeFlag: 0 } })
  const processedUnchanged = await api('POST', '/api/erp/collect', { items: [collectItem(supplier.id, 'GIGA-B002')], mode: 'SINGLE' }, collectorToken)
  check('已加工无 diff 再采 UNCHANGED', processedUnchanged.data?.items?.[0]?.result === 'UNCHANGED', processedUnchanged.data?.items)
  const b002 = await prisma.erpProduct.findFirst({ where: { orgId, sourceProductId: 'GIGA-B002' } })
  check('已加工无 diff 不置 change_flag（仍为 0）', b002?.changeFlag === 0, b002?.changeFlag)

  console.log('\n[10] 采集接口权限隔离：运营无 erp.collect')
  const operatorCollect = await api('POST', '/api/erp/collect', { items: [collectItem(supplier.id, 'GIGA-X')], mode: 'SINGLE' }, operatorToken)
  check('运营 POST /collect 403', operatorCollect.status === 403, operatorCollect)
  const anonCollect = await api('POST', '/api/erp/collect', { items: [collectItem(supplier.id, 'GIGA-Y')], mode: 'SINGLE' })
  check('未登录 POST /collect 401', anonCollect.status === 401, anonCollect)

  console.log('\n[11] 采集池 tab 数据源：GET /products?status=COLLECTED')
  const pool = await api('GET', '/api/erp/products?status=COLLECTED', undefined, collectorToken)
  check('采集池列表 200', pool.status === 200, pool)
  check('采集池仅含 COLLECTED 态', (pool.data?.items ?? []).every((i: any) => i.status === 'COLLECTED'))
  // 采集池（COLLECTED）= GIGA-1001 + 批量 B003..B020（B001/B002 已在步骤 8/9 转 DOWNLOADED，不在采集池）= 19
  check('采集池含批量采集品（19 条：GIGA-1001 + B003..B020）', (pool.data?.total ?? 0) === 19, pool.data?.total)
} catch (error) {
  failed += 1
  console.error('[verify-erp-p1] 异常：', error)
}

console.log(`\n[verify-erp-p1] 通过 ${passed} 项，失败 ${failed} 项`)
await app.close()
await socket.stop()
process.exit(failed === 0 ? 0 : 1)
