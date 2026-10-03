/**
 * ERP P0 地基端到端验收脚本（对照方案 P0 验收标准）：
 * 1. 嵌入式 PGlite(5435) + migrate deploy → 2. 启动应用
 * 3. 首装注册主帐号（自动创建含 COLLECTOR 的预置角色）→ 创建采集专员/运营子帐号
 * 4. 双角色登录 → 同一 GET /api/erp/products：采集可见 6 敏感字段、运营 JSON 完全不出现
 * 5. 运营访问 /api/erp/suppliers 必须 403；capabilities 摘要按角色区分
 * 运行：npx tsx scripts/verify-erp-p0.ts
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
const dbPort = 5435

process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres?sslmode=disable`
process.env.JWT_SECRET = 'verify-erp-secret'
process.env.ACCESS_TOKEN_TTL = '1h'
process.env.REFRESH_TOKEN_TTL_DAYS = '7'
process.env.LOG_LEVEL = 'warn'

console.log('[verify-erp-p0] 启动嵌入式 PostgreSQL…')
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

console.log('[verify-erp-p0] 执行数据库迁移…')
const prismaBin = path.join(serverDir, 'node_modules', '.bin', 'prisma')
await execFileAsync(prismaBin, ['migrate', 'deploy'], { cwd: serverDir, env: { ...process.env } })

console.log('[verify-erp-p0] 启动应用…')
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

const SENSITIVE = ['supplierId', 'sourceUrl', 'sourceProductId', 'sourceSku', 'collectedBy', 'crawlConfig', 'supplier']

try {
  console.log('\n[1] 首装注册 + 预置角色（含采集专员）')
  const register = await api('POST', '/api/auth/register', {
    name: '老板', email: '13800000001', password: 'Owner#2026erp'
  })
  check('主帐号注册成功', register.status === 200 || register.status === 201, register)
  const ownerToken: string = register.data?.accessToken ?? register.data?.tokens?.accessToken
  check('主帐号拿到 accessToken', Boolean(ownerToken))

  const roles = await prisma.role.findMany({ where: { orgId: register.data?.user?.orgId ?? (await prisma.user.findUnique({ where: { email: '13800000001' } }))?.orgId }, select: { id: true, key: true } })
  const roleKeyMap = new Map(roles.map(role => [role.key, role.id]))
  check('预置角色含 COLLECTOR（采集专员）', roleKeyMap.has('COLLECTOR'), [...roleKeyMap.keys()])
  check('预置角色含 OPERATOR（运营）', roleKeyMap.has('OPERATOR'))

  console.log('\n[2] 创建采集专员 / 运营子帐号并登录')
  const collectorMember = await api('POST', '/api/members', {
    email: '13800000002', password: 'Collector#2026', name: '采集小张', roleIds: [roleKeyMap.get('COLLECTOR')!]
  }, ownerToken)
  check('采集专员子帐号创建成功', collectorMember.status === 200 || collectorMember.status === 201, collectorMember)
  const operatorMember = await api('POST', '/api/members', {
    email: '13800000003', password: 'Operator#2026', name: '运营小李', roleIds: [roleKeyMap.get('OPERATOR')!]
  }, ownerToken)
  check('运营子帐号创建成功', operatorMember.status === 200 || operatorMember.status === 201, operatorMember)

  // 若成员创建后为待审核状态则批准
  for (const member of [collectorMember, operatorMember]) {
    if (member.data?.status && member.data.status !== 'ACTIVE') {
      await api('POST', `/api/members/${member.data.id}/approve`, {}, ownerToken)
    }
  }

  const collectorLogin = await api('POST', '/api/auth/login', { email: '13800000002', password: 'Collector#2026' })
  const operatorLogin = await api('POST', '/api/auth/login', { email: '13800000003', password: 'Operator#2026' })
  check('采集专员登录成功', collectorLogin.status === 200, collectorLogin)
  check('运营登录成功', operatorLogin.status === 200, operatorLogin)
  const collectorToken: string = collectorLogin.data?.accessToken ?? collectorLogin.data?.tokens?.accessToken
  const operatorToken: string = operatorLogin.data?.accessToken ?? operatorLogin.data?.tokens?.accessToken

  console.log('\n[3] 种子数据：货盘 + 产品（含敏感字段）')
  const orgId = (await prisma.user.findUnique({ where: { email: '13800000002' } }))!.orgId
  const supplier = await prisma.erpSupplier.create({
    data: {
      orgId, code: 'GIGACLOUD', name: '大健云仓', loginUrl: 'https://www.gigab2b.com/',
      crawlRules: { detail: { title: 'h1' } }, patrolChannel: 'SERVER',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }
  })
  const now = new Date().toISOString()
  await prisma.erpProduct.create({
    data: {
      orgId, supplierId: supplier.id, sourceProductId: 'GIGA-1001',
      sourceUrl: 'https://www.gigab2b.com/index.php?route=product/product&product_id=1001',
      sourceSku: 'GIGA-SKU-1001', collectedBy: '13800000002',
      crawlConfig: { capturedFrom: 'DETAIL' },
      titleOriginal: '刹车片套装 陶瓷配方', costPrice: 12.5, shippingCost: 3.2,
      stockQuantity: 50, status: 'COLLECTED', createdAt: now, updatedAt: now
    }
  })

  console.log('\n[4] 同一接口双角色投影对比（验收核心）')
  const collectorList = await api('GET', '/api/erp/products', undefined, collectorToken)
  const operatorList = await api('GET', '/api/erp/products', undefined, operatorToken)
  check('采集专员列表 200', collectorList.status === 200, collectorList)
  check('运营列表 200', operatorList.status === 200, operatorList)
  const collectorItem = collectorList.data?.items?.[0]
  const operatorItem = operatorList.data?.items?.[0]
  check('采集专员可见全部敏感字段', collectorItem && SENSITIVE.every(field => field in collectorItem), collectorItem ? Object.keys(collectorItem) : null)
  check('运营 JSON 完全不出现敏感字段', operatorItem && SENSITIVE.every(field => !(field in operatorItem)), operatorItem ? Object.keys(operatorItem) : null)
  check('运营仍可见业务字段（标题/成本价/库存/状态）', operatorItem && operatorItem.titleOriginal === '刹车片套装 陶瓷配方' && operatorItem.costPrice === 12.5 && operatorItem.stockQuantity === 50 && operatorItem.status === 'COLLECTED')

  const collectorDetail = await api('GET', `/api/erp/products/${collectorItem?.id}`, undefined, collectorToken)
  const operatorDetail = await api('GET', `/api/erp/products/${operatorItem?.id}`, undefined, operatorToken)
  check('详情接口采集角色含 sourceUrl', collectorDetail.status === 200 && 'sourceUrl' in (collectorDetail.data ?? {}))
  check('详情接口运营角色不含 sourceUrl', operatorDetail.status === 200 && !('sourceUrl' in (operatorDetail.data ?? {})))

  console.log('\n[5] 货盘管理接口角色隔离 + 能力摘要')
  const collectorSuppliers = await api('GET', '/api/erp/suppliers', undefined, collectorToken)
  const operatorSuppliers = await api('GET', '/api/erp/suppliers', undefined, operatorToken)
  check('采集专员可访问货盘列表', collectorSuppliers.status === 200)
  check('运营访问货盘列表 403', operatorSuppliers.status === 403, operatorSuppliers)
  const collectorCaps = await api('GET', '/api/erp/capabilities', undefined, collectorToken)
  const operatorCaps = await api('GET', '/api/erp/capabilities', undefined, operatorToken)
  check('capabilities：采集 canViewSource=true', collectorCaps.data?.canViewSource === true)
  check('capabilities：运营 canViewSource=false 且可定价/确认变更', operatorCaps.data?.canViewSource === false && operatorCaps.data?.canPricing === true && operatorCaps.data?.canResolveChanges === true)
  check('capabilities：采集不可定价/不可确认变更', collectorCaps.data?.canPricing === false && collectorCaps.data?.canResolveChanges === false)
} catch (error) {
  failed += 1
  console.error('[verify-erp-p0] 异常：', error)
}

console.log(`\n[verify-erp-p0] 通过 ${passed} 项，失败 ${failed} 项`)
await app.close()
await socket.stop()
process.exit(failed === 0 ? 0 : 1)
