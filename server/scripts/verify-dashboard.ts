/**
 * 团队工作台仪表盘端到端验收脚本：
 * 1. 启动内存版 PGlite → 2. prisma migrate deploy → 3. 启动应用
 * 4. 断言：GET /api/dashboard/summary 的「团队动态」真的能返回数据
 *    （历史上 TEAM_ACTIVITY_ACTIONS 写的是 created/login 一类裸词，与 writeAudit 实际写入的
 *     member.create/auth.login 点分格式零交集，导致该区块永远为空且无任何报错）
 *    以及白名单过滤确实生效、字段可被前端标签映射渲染。
 * 运行：pnpm verify:dashboard
 */
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// 注意：必须用异步 execFile——同步 exec 会冻结事件循环，导致同进程的 PGlite socket 无法响应
const execFileAsync = promisify(execFile)
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// 5442：避开 dev-db(5433)、compliance(5435)/ebay(5436)/collection(5437)/import(5438)/erp-p4(5439)/media(5440)/product-pages(5441)
const dbPort = 5442

// connection_limit 封顶 Prisma 连接池，避免 Promise.all 突发查询超出 PGlite socket 上限被销毁（P1001）
process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres?sslmode=disable&connection_limit=20`
process.env.JWT_SECRET = 'verify-dashboard-secret'
process.env.ACCESS_TOKEN_TTL = '1h'
process.env.LOG_LEVEL = 'warn'

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

console.log('[verify] 启动应用…')
const { buildApp } = await import('../src/app.js')
const { prisma } = await import('../src/lib/prisma.js')
const { TEAM_ACTIVITY_ACTIONS } = await import('../src/modules/dashboard/teamActivity.js')
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

interface Activity { id: string; memberId: string; memberName: string; action: string; targetType: string; targetLabel: string; at: number }

try {
  console.log('\n[1] 未登录门禁')
  const noAuth = await api('GET', '/api/dashboard/summary')
  check('未登录 GET /summary → 401', noAuth.status === 401, noAuth.status)

  console.log('\n[2] bootstrap OWNER 后动态即有数据（auth.register 属白名单）')
  const register = await api('POST', '/api/auth/register', { name: '老板A', email: '13900000011', password: 'pass1234' })
  const token: string = register.data?.tokens?.accessToken ?? ''
  const orgId: string = register.data?.user?.org?.id ?? ''
  check('注册 OWNER → 200', register.status === 200 && Boolean(token) && Boolean(orgId), register.data)

  const afterRegister = await api('GET', '/api/dashboard/summary', undefined, token)
  const activitiesAfterRegister = (afterRegister.data?.teamActivities ?? []) as Activity[]
  check('GET /summary → 200', afterRegister.status === 200, afterRegister.status)
  check('注册后团队动态非空（修复前这里恒为空）', activitiesAfterRegister.length > 0, activitiesAfterRegister)
  check('动态含 auth.register', activitiesAfterRegister.some(item => item.action === 'auth.register'), activitiesAfterRegister.map(item => item.action))

  console.log('\n[3] 新增成员后动态追加 member.create')
  const createMember = await api('POST', '/api/members', { email: '13900000012', name: '运营小张', password: 'pass1234', roleIds: [], permissions: ['dashboard.view'], storeIds: [] }, token)
  check('创建成员 → 200', createMember.status === 200, createMember.data)

  const afterMember = await api('GET', '/api/dashboard/summary', undefined, token)
  const activities = (afterMember.data?.teamActivities ?? []) as Activity[]
  const memberCreate = activities.find(item => item.action === 'member.create')
  check('动态含 member.create', Boolean(memberCreate), activities.map(item => item.action))
  check('member.create 的 targetType/targetLabel/memberName 可用于前端渲染',
    memberCreate?.targetType === 'user' && Boolean(memberCreate?.targetLabel) && Boolean(memberCreate?.memberName),
    memberCreate)
  check('动态按时间倒序（最新在前）',
    activities.every((item, index) => index === 0 || (activities[index - 1]?.at ?? 0) >= item.at),
    activities.map(item => item.at))

  console.log('\n[4] 白名单过滤：非白名单 action 不得出现在动态里')
  await prisma.auditLog.create({ data: { orgId, action: 'ai.image.generate', targetType: 'ai', targetId: 'noise-1' } })
  await prisma.auditLog.create({ data: { orgId, action: 'ERP_COLLECT_CREATE', targetType: 'ErpProduct', targetId: 'noise-2' } })
  await prisma.auditLog.create({ data: { orgId, action: 'compliance.check.run', targetType: 'product', targetId: 'noise-3' } })
  const afterNoise = await api('GET', '/api/dashboard/summary', undefined, token)
  const filtered = (afterNoise.data?.teamActivities ?? []) as Activity[]
  const noiseActions = ['ai.image.generate', 'ERP_COLLECT_CREATE', 'compliance.check.run']
  check('高频/非治理类 action 被过滤掉', filtered.every(item => !noiseActions.includes(item.action)), filtered.map(item => item.action))
  check('返回的每条 action 都在白名单内', filtered.every(item => (TEAM_ACTIVITY_ACTIONS as readonly string[]).includes(item.action)), filtered.map(item => item.action))
  check('过滤后仍保留治理类动态', filtered.some(item => item.action === 'member.create') && filtered.some(item => item.action === 'auth.register'), filtered.map(item => item.action))

  console.log('\n[5] 视角控制')
  const login = await api('POST', '/api/auth/login', { email: '13900000011', password: 'pass1234' })
  check('OWNER 登录 → 200', login.status === 200 && Boolean(login.data?.tokens?.accessToken), login.status)
  const selfView = await api('GET', '/api/dashboard/summary', undefined, login.data?.tokens?.accessToken)
  check('重新登录后动态依然可读', selfView.status === 200 && (selfView.data?.teamActivities ?? []).length > 0, selfView.status)
} finally {
  await app.close()
  await socket.stop()
  await db.close()
}

console.log(`\n[verify] 通过 ${passed} 项，失败 ${failed} 项`)
if (failed > 0) process.exit(1)
