/**
 * 阶段 1 端到端验收脚本：
 * 1. 启动内存版 PGlite（真实 PostgreSQL 协议）→ 2. prisma migrate deploy
 * 3. 启动应用 → 4. 覆盖验收标准的 HTTP 断言（注册/登录/RBAC/店铺隔离/401/403/审计）
 * 运行：pnpm verify
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
const dbPort = 5434

process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres?sslmode=disable`
process.env.JWT_SECRET = 'verify-secret'
process.env.ACCESS_TOKEN_TTL = '1h'
process.env.REFRESH_TOKEN_TTL_DAYS = '7'
process.env.LOG_LEVEL = 'warn'

// ---------- 基础设施 ----------
console.log('[verify] 启动嵌入式 PostgreSQL…')
const db = new PGlite()
// maxConnections 默认仅 1，Prisma 需要多条并发连接
const socket = new PGLiteSocketServer({ db, port: dbPort, host: '127.0.0.1', maxConnections: 10 })
await socket.start()

// 协议级就绪探针：直到 PG 握手真正有响应再放行后续子进程连接
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
const { stdout, stderr } = await execFileAsync(prismaBin, ['migrate', 'deploy'], {
  cwd: serverDir,
  env: { ...process.env }
})
if (stdout.trim()) console.log(stdout.trim())
if (stderr.trim()) console.error(stderr.trim())

console.log('[verify] 启动应用…')
const { buildApp } = await import('../src/app.js')
const app = await buildApp()
await app.listen({ port: 0, host: '127.0.0.1' })
const address = app.server.address()
const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`

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

interface ApiResult {
  status: number
  data: any
}

async function api(method: string, pathName: string, body?: unknown, token?: string): Promise<ApiResult> {
  const response = await fetch(base + pathName, {
    method,
    headers: {
      // 仅在携带请求体时声明 content-type，避免 Fastify 对空 JSON 体报 400
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  let data: any = null
  try {
    data = await response.json()
  } catch {
    // 无响应体
  }
  return { status: response.status, data }
}

async function login(email: string, password: string) {
  const result = await api('POST', '/api/auth/login', { email, password })
  return result
}

// ---------- 验收场景 ----------
try {
  console.log('\n[1] 注册与登录')
  const badRegister = await api('POST', '/api/auth/register', { orgName: '砚都跨境', name: '老板', email: 'owner@test.com', password: 'short' })
  check('弱密码注册 → 400', badRegister.status === 400, badRegister.data)

  const register = await api('POST', '/api/auth/register', { orgName: '砚都跨境', name: '老板', email: 'owner@test.com', password: 'pass1234' })
  check('注册组织+主帐号 → 200', register.status === 200, register.data)
  const ownerToken: string = register.data?.tokens?.accessToken ?? ''
  check('注册返回访问令牌', typeof ownerToken === 'string' && ownerToken.length > 20)

  const dupRegister = await api('POST', '/api/auth/register', { orgName: '另一个组织', name: '别人', email: 'owner@test.com', password: 'pass1234' })
  check('重复邮箱注册 → 409', dupRegister.status === 409, dupRegister.data)

  const ownerLogin = await login('owner@test.com', 'pass1234')
  check('主帐号登录 → 200', ownerLogin.status === 200, ownerLogin.data)
  const ownerRefresh: string = ownerLogin.data?.tokens?.refreshToken ?? ''

  const me = await api('GET', '/api/auth/me', undefined, ownerToken)
  check('me 返回主帐号资料', me.status === 200 && me.data?.isOwner === true && me.data?.org?.name === '砚都跨境', me.data)
  check('主帐号角色为"主帐号"且权限为 ALL', me.data?.roles?.[0]?.name === '主帐号' && me.data?.permissions === 'ALL', me.data?.roles)

  const noToken = await api('GET', '/api/auth/me')
  check('未登录访问 → 401', noToken.status === 401)

  const badLogin = await login('owner@test.com', 'wrong-pass1')
  check('错误密码登录 → 401', badLogin.status === 401)

  console.log('\n[2] 店铺管理')
  const store1 = await api('POST', '/api/stores', { name: '美国主店' }, ownerToken)
  const store2 = await api('POST', '/api/stores', { name: '英国店', marketplaceId: 'EBAY_GB' }, ownerToken)
  check('主帐号创建店铺 ×2 → 200', store1.status === 200 && store2.status === 200, { store1: store1.data, store2: store2.data })
  const s1: string = store1.data?.id
  const s2: string = store2.data?.id
  const ownerStores = await api('GET', '/api/stores', undefined, ownerToken)
  check('主帐号店铺列表 = 2', ownerStores.status === 200 && ownerStores.data?.length === 2, ownerStores.data)

  console.log('\n[3] 预置角色与子帐号创建')
  const roles = await api('GET', '/api/roles', undefined, ownerToken)
  check('预置角色 = 4（主帐号/运营/发布员/只读）',
    roles.status === 200 && roles.data?.length === 4 &&
    ['主帐号', '运营', '发布员', '只读'].every(name => roles.data.some((r: any) => r.name === name)),
    roles.data)
  const roleIdByName = (name: string) => roles.data.find((r: any) => r.name === name)?.id as string
  const ownerRoleId = roleIdByName('主帐号')

  const permCatalog = await api('GET', '/api/roles/permissions', undefined, ownerToken)
  check('权限点目录 ≥ 10 项', permCatalog.status === 200 && permCatalog.data?.length >= 10, permCatalog.data)

  const opCreate = await api('POST', '/api/members', { email: 'op@test.com', name: '运营A', password: 'pass1234', roleIds: [roleIdByName('运营')], storeIds: [s1] }, ownerToken)
  check('创建运营子帐号（授权美国主店）→ 200', opCreate.status === 200, opCreate.data)
  const opId: string = opCreate.data?.id

  const pubCreate = await api('POST', '/api/members', { email: 'pub@test.com', name: '发布员B', password: 'pass1234', roleIds: [roleIdByName('发布员')], storeIds: [s2] }, ownerToken)
  check('创建发布员子帐号（授权英国店）→ 200', pubCreate.status === 200, pubCreate.data)

  const viewerCreate = await api('POST', '/api/members', { email: 'viewer@test.com', name: '只读C', password: 'pass1234', roleIds: [roleIdByName('只读')], storeIds: [] }, ownerToken)
  check('创建只读子帐号（不授权店铺）→ 200', viewerCreate.status === 200, viewerCreate.data)
  const viewerId: string = viewerCreate.data?.id

  const ownerRoleAssign = await api('POST', '/api/members', { email: 'fake@test.com', name: '假冒', password: 'pass1234', roleIds: [ownerRoleId], storeIds: [] }, ownerToken)
  check('禁止分配主帐号角色 → 400', ownerRoleAssign.status === 400, ownerRoleAssign.data)

  const crossStoreAssign = await api('POST', '/api/members', { email: 'cross@test.com', name: '越权', password: 'pass1234', roleIds: [roleIdByName('运营')], storeIds: ['not-exist-store'] }, ownerToken)
  check('授权不存在的店铺 → 400', crossStoreAssign.status === 400, crossStoreAssign.data)

  const members = await api('GET', '/api/members', undefined, ownerToken)
  check('成员列表 = 4（1 主 + 3 子）', members.status === 200 && members.data?.length === 4, members.data?.length)

  console.log('\n[4] 数据隔离：子帐号仅见授权店铺')
  const opLogin = await login('op@test.com', 'pass1234')
  const opToken: string = opLogin.data?.tokens?.accessToken ?? ''
  const opRefresh: string = opLogin.data?.tokens?.refreshToken ?? ''
  check('运营A 登录 → 200', opLogin.status === 200, opLogin.data)
  check('子帐号首次登录标记需改密', opLogin.data?.user?.mustChangePassword === true, opLogin.data?.user)

  const opStores = await api('GET', '/api/stores', undefined, opToken)
  check('运营A 店铺列表 = [美国主店]', opStores.status === 200 && opStores.data?.length === 1 && opStores.data[0]?.id === s1, opStores.data)

  const pubLogin = await login('pub@test.com', 'pass1234')
  const pubToken: string = pubLogin.data?.tokens?.accessToken ?? ''
  const pubStores = await api('GET', '/api/stores', undefined, pubToken)
  check('发布员B 店铺列表 = [英国店]', pubStores.status === 200 && pubStores.data?.length === 1 && pubStores.data[0]?.id === s2, pubStores.data)

  const viewerLogin = await login('viewer@test.com', 'pass1234')
  const viewerToken: string = viewerLogin.data?.tokens?.accessToken ?? ''
  const viewerStores = await api('GET', '/api/stores', undefined, viewerToken)
  check('只读C 店铺列表 = []', viewerStores.status === 200 && Array.isArray(viewerStores.data) && viewerStores.data.length === 0, viewerStores.data)

  console.log('\n[5] 权限边界（401/403）')
  const opCreateStore = await api('POST', '/api/stores', { name: '越权店铺' }, opToken)
  check('运营A 创建店铺 → 403', opCreateStore.status === 403, opCreateStore.data)
  const pubCreateStore = await api('POST', '/api/stores', { name: '越权店铺2' }, pubToken)
  check('发布员B 创建店铺 → 403', pubCreateStore.status === 403, pubCreateStore.data)
  const opMembers = await api('GET', '/api/members', undefined, opToken)
  check('运营A 查看成员 → 403', opMembers.status === 403, opMembers.data)
  const viewerMembers = await api('GET', '/api/members', undefined, viewerToken)
  check('只读C 查看成员 → 403', viewerMembers.status === 403, viewerMembers.data)
  const opAudit = await api('GET', '/api/audit-logs', undefined, opToken)
  check('运营A 查看审计日志 → 403', opAudit.status === 403, opAudit.data)
  const noTokenStores = await api('GET', '/api/stores')
  check('无令牌访问业务接口 → 401', noTokenStores.status === 401)
  const fakeToken = await api('GET', '/api/stores', undefined, 'fake.token.value')
  check('伪造令牌 → 401', fakeToken.status === 401)

  console.log('\n[6] 自定义角色')
  const customRole = await api('POST', '/api/roles', { name: '采集专员', permissions: ['collection.run'] }, ownerToken)
  check('创建自定义角色 → 200', customRole.status === 200 && customRole.data?.isSystem === false, customRole.data)
  const customRoleId: string = customRole.data?.id
  const customRoleEdit = await api('PATCH', `/api/roles/${customRoleId}`, { permissions: ['collection.run', 'product.edit'] }, ownerToken)
  check('编辑自定义角色权限 → 200', customRoleEdit.status === 200 && customRoleEdit.data?.permissions?.length === 2, customRoleEdit.data)
  const invalidPerm = await api('POST', '/api/roles', { name: '错误角色', permissions: ['not.a.perm'] }, ownerToken)
  check('未知权限点 → 400', invalidPerm.status === 400, invalidPerm.data)
  const systemRoleEdit = await api('PATCH', `/api/roles/${ownerRoleId}`, { name: '超级管理员' }, ownerToken)
  check('预置角色不可修改 → 400', systemRoleEdit.status === 400, systemRoleEdit.data)
  const systemRoleDelete = await api('DELETE', `/api/roles/${ownerRoleId}`, undefined, ownerToken)
  check('预置角色不可删除 → 400', systemRoleDelete.status === 400, systemRoleDelete.data)
  const opRoleManage = await api('POST', '/api/roles', { name: '越权角色', permissions: [] }, opToken)
  check('运营A 创建角色 → 403', opRoleManage.status === 403, opRoleManage.data)

  console.log('\n[7] 店铺授权变更')
  const grantBoth = await api('PUT', `/api/members/${opId}/store-grants`, { storeIds: [s1, s2] }, ownerToken)
  check('主帐号调整运营A 授权为两家店铺 → 200', grantBoth.status === 200, grantBoth.data)
  const opStores2 = await api('GET', '/api/stores', undefined, opToken)
  check('运营A 店铺列表变为 2', opStores2.status === 200 && opStores2.data?.length === 2, opStores2.data)
  await api('PUT', `/api/members/${opId}/store-grants`, { storeIds: [s1] }, ownerToken)

  console.log('\n[8] 令牌生命周期')
  const refreshed = await api('POST', '/api/auth/refresh', { refreshToken: opRefresh })
  check('刷新令牌轮换 → 200 且返回新令牌', refreshed.status === 200 && typeof refreshed.data?.tokens?.accessToken === 'string', refreshed.data)
  const reuseOld = await api('POST', '/api/auth/refresh', { refreshToken: opRefresh })
  check('旧刷新令牌复用 → 401', reuseOld.status === 401, reuseOld.data)

  const changePw = await api('POST', '/api/auth/change-password', { oldPassword: 'pass1234', newPassword: 'newpass123' }, opToken)
  check('运营A 修改密码 → 200', changePw.status === 200, changePw.data)
  const oldRefreshAfterPw = await api('POST', '/api/auth/refresh', { refreshToken: refreshed.data?.tokens?.refreshToken ?? '' })
  check('改密后旧刷新令牌失效 → 401', oldRefreshAfterPw.status === 401, oldRefreshAfterPw.data)
  const opRelogin = await login('op@test.com', 'newpass123')
  check('新密码登录 → 200 且需改密标记已清除', opRelogin.status === 200 && opRelogin.data?.user?.mustChangePassword === false, opRelogin.data)

  const ownerRefreshReuse = await api('POST', '/api/auth/refresh', { refreshToken: ownerRefresh })
  check('主帐号刷新令牌可用 → 200', ownerRefreshReuse.status === 200, ownerRefreshReuse.data)

  console.log('\n[9] 禁用与恢复')
  const disableViewer = await api('DELETE', `/api/members/${viewerId}`, undefined, ownerToken)
  check('禁用只读C → 200', disableViewer.status === 200, disableViewer.data)
  const viewerAfterDisable = await api('GET', '/api/stores', undefined, viewerToken)
  check('被禁用子帐号访问 → 401', viewerAfterDisable.status === 401, viewerAfterDisable.data)
  const viewerLoginDisabled = await login('viewer@test.com', 'pass1234')
  check('被禁用子帐号登录 → 403', viewerLoginDisabled.status === 403, viewerLoginDisabled.data)
  const enableViewer = await api('PATCH', `/api/members/${viewerId}`, { status: 'ACTIVE' }, ownerToken)
  check('恢复只读C → 200', enableViewer.status === 200 && enableViewer.data?.status === 'ACTIVE', enableViewer.data)
  const viewerRelogin = await login('viewer@test.com', 'pass1234')
  check('恢复后重新登录 → 200', viewerRelogin.status === 200, viewerRelogin.data)

  const disableOwner = await api('DELETE', `/api/members/${me.data?.id}`, undefined, ownerToken)
  check('不能禁用主帐号 → 400', disableOwner.status === 400, disableOwner.data)

  console.log('\n[10] 审计日志')
  const audit = await api('GET', '/api/audit-logs?limit=200', undefined, ownerToken)
  const actions: string[] = audit.data?.items?.map((item: any) => item.action) ?? []
  check('审计日志可查（主帐号）', audit.status === 200 && audit.data.items.length > 0, audit.data)
  for (const expected of ['auth.register', 'auth.login', 'store.create', 'member.create', 'grant.update', 'member.disable', 'auth.change-password', 'role.create']) {
    check(`审计包含 ${expected}`, actions.includes(expected), actions)
  }
  const auditFiltered = await api('GET', '/api/audit-logs?action=member.create', undefined, ownerToken)
  check('审计按动作过滤 → 仅 member.create', auditFiltered.status === 200 && auditFiltered.data.items.every((item: any) => item.action === 'member.create'), auditFiltered.data)
} finally {
  await app.close()
  await socket.stop()
  await db.close()
}

console.log(`\n========== 验收结果：${passed} 通过 / ${failed} 失败 ==========`)
process.exit(failed > 0 ? 1 : 0)
