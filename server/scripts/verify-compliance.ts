/**
 * 合规模块 + 组织级种子端到端验收脚本：
 * 1. 启动内存版 PGlite → 2. prisma migrate deploy → 3. 启动应用
 * 4. 断言：注册触发种子、eBay 详情页检查分流、通用规则引擎、许可签发、规则版本、权限与跨组织隔离
 * 运行：pnpm verify:compliance
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
const dbPort = 5435

// connection_limit 封顶 Prisma 连接池，避免 Promise.all 突发查询超出 PGlite socket 上限被销毁（P1001）
process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres?sslmode=disable&connection_limit=20`
process.env.JWT_SECRET = 'verify-secret'
process.env.ACCESS_TOKEN_TTL = '1h'
process.env.REFRESH_TOKEN_TTL_DAYS = '7'
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

console.log('[verify] 启动应用…')
const { buildApp } = await import('../src/app.js')
const { prisma } = await import('../src/lib/prisma.js')
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

async function registerOrg(orgName: string, email: string) {
  const result = await api('POST', '/api/auth/register', { orgName, name: '老板', email, password: 'pass1234' })
  return result
}

// ---------- 验收场景 ----------
try {
  console.log('\n[1] 注册触发组织级种子')
  const register = await registerOrg('砚都跨境', 'owner-a@test.com')
  check('注册组织A → 200', register.status === 200, register.data)
  const ownerToken: string = register.data?.tokens?.accessToken ?? ''
  const orgId: string = register.data?.user?.org?.id ?? ''

  const supplyCount = await prisma.supplyPlatform.count({ where: { orgId } })
  const p1688 = await prisma.supplyPlatform.findUnique({ where: { orgId_code: { orgId, code: '1688' } } })
  check('供应平台种子 = 11 且 1688 为 BROWSER_READY', supplyCount === 11 && p1688?.connectorStatus === 'BROWSER_READY', { supplyCount, p1688 })
  const marketCount = await prisma.marketplacePlatform.count({ where: { orgId } })
  const ozon = await prisma.marketplacePlatform.findUnique({ where: { orgId_code: { orgId, code: 'OZON' } } })
  check('市场平台种子 = 5 且仅 OZON 采集就绪', marketCount === 5 && ozon?.collectorReady === 1, { marketCount, ozon })
  const warehouses = await prisma.productWarehouse.findMany({ where: { orgId } })
  const w1688 = warehouses.find(item => item.code === '1688')
  check('产品仓库种子 = 4 且规则画像为数组', warehouses.length === 4 && Array.isArray(w1688?.ruleProfile) && (w1688?.ruleProfile as unknown[]).length === 4, warehouses.map(item => item.code))

  const ws0 = await api('GET', '/api/compliance/workspace', undefined, ownerToken)
  check('合规知识工作区：来源 6 / 规则 11 / 模板 5',
    ws0.status === 200 && ws0.data?.sources?.length === 6 && ws0.data?.rules?.length === 11 && ws0.data?.templates?.length === 5,
    { sources: ws0.data?.sources?.length, rules: ws0.data?.rules?.length, templates: ws0.data?.templates?.length })
  check('初始无发布许可/任务/告警', ws0.data?.permits?.length === 0 && ws0.data?.tasks?.length === 0 && ws0.data?.alerts?.length === 0)

  console.log('\n[2] eBay 检查分流（详情页规则集）')
  const ebayOk = await api('POST', '/api/compliance/checks', {
    productId: 'p-ebay-1', platform: 'EBAY', marketplaceSite: 'EBAY_US', country: 'US',
    title: 'Wireless Bluetooth Headphones', imageUrl: 'https://i.ebayimg.com/images/g/abc/s-l500.jpg'
  }, ownerToken)
  check('eBay 资料齐全 → PASSED', ebayOk.status === 200 && ebayOk.data?.gateStatus === 'PASSED' && ebayOk.data?.findings?.length === 0, ebayOk.data)
  check('eBay 检查使用详情页规则集常量', ebayOk.data?.ruleSetVersion === 'EBAY-DETAIL-PAGE-2026.07.21', ebayOk.data?.ruleSetVersion)

  const ws1 = await api('GET', '/api/compliance/workspace', undefined, ownerToken)
  const ebayPermits = (ws1.data?.permits ?? []).filter((item: any) => item.productId === 'p-ebay-1')
  check('PASSED 自动签发发布许可（VALID）', ebayPermits.length === 1 && ebayPermits[0]?.status === 'VALID', ebayPermits)
  const ebayPermitId: string = ebayPermits[0]?.id ?? ''

  // 原版语义：详情页检查的规则集常量 ≠ 动态签名，getLatestCheck 判定 stale → RECHECK_REQUIRED
  const ebayLatest = await api('GET', '/api/compliance/checks/latest/p-ebay-1', undefined, ownerToken)
  check('eBay 最新检查经 latest 读取 → RECHECK_REQUIRED（原版 stale 语义）',
    ebayLatest.status === 200 && ebayLatest.data?.gateStatus === 'RECHECK_REQUIRED' && ebayLatest.data?.findings?.[0]?.ruleCode === 'RULESET-UPDATED',
    ebayLatest.data)

  const longTitle = 'X'.repeat(81)
  const ebayBlocked = await api('POST', '/api/compliance/checks', {
    productId: 'p-ebay-1', platform: 'EBAY', marketplaceSite: 'EBAY_US', country: 'US',
    title: longTitle, imageUrl: 'https://i.ebayimg.com/images/g/abc/s-l500.jpg'
  }, ownerToken)
  check('eBay 标题 81 字符 → BLOCKED（P0）', ebayBlocked.status === 200 && ebayBlocked.data?.gateStatus === 'BLOCKED', ebayBlocked.data)
  const ws2 = await api('GET', '/api/compliance/workspace', undefined, ownerToken)
  const ebayValidPermits = (ws2.data?.permits ?? []).filter((item: any) => item.productId === 'p-ebay-1' && item.status === 'VALID')
  check('新检查结论吊销旧许可', ebayValidPermits.length === 0, ws2.data?.permits)
  check('BLOCKED 产生合规任务与告警',
    (ws2.data?.tasks ?? []).some((item: any) => item.productId === 'p-ebay-1') &&
    (ws2.data?.alerts ?? []).some((item: any) => item.entityId === 'p-ebay-1'),
    { tasks: ws2.data?.tasks?.length, alerts: ws2.data?.alerts?.length })

  console.log('\n[3] 通用规则引擎（OZON）')
  const ozonMissing = await api('POST', '/api/compliance/checks', {
    productId: 'p-ozon-miss', platform: 'OZON', marketplaceSite: 'ALL', country: 'ALL',
    title: 'Running shoes', imageUrl: 'https://example.com/1.jpg'
  }, ownerToken)
  check('OZON 缺类目 → BLOCKED（OZON-LISTING-REQUIRED P0）',
    ozonMissing.status === 200 && ozonMissing.data?.gateStatus === 'BLOCKED' &&
    ozonMissing.data?.findings?.some((item: any) => item.ruleCode === 'OZON-LISTING-REQUIRED'),
    ozonMissing.data)

  const ozonClean = await api('POST', '/api/compliance/checks', {
    productId: 'p-ozon-1', platform: 'OZON', marketplaceSite: 'ALL', country: 'ALL', categoryName: '运动鞋',
    title: 'Comfortable running shoes for men', imageUrl: 'https://example.com/2.jpg'
  }, ownerToken)
  check('OZON 资料齐全 → REVIEW_REQUIRED（模板人工复核）',
    ozonClean.status === 200 && ozonClean.data?.gateStatus === 'REVIEW_REQUIRED' &&
    ozonClean.data?.findings?.some((item: any) => item.ruleCode === 'CATEGORY-MANUAL-REVIEW'),
    ozonClean.data)
  const ozonCheckId: string = ozonClean.data?.id ?? ''

  const ozonVape = await api('POST', '/api/compliance/checks', {
    productId: 'p-ozon-2', platform: 'OZON', marketplaceSite: 'ALL', country: 'ALL', categoryName: '电子烟',
    title: 'vape pen starter kit', imageUrl: 'https://example.com/3.jpg'
  }, ownerToken)
  check('OZON 敏感词命中 → REVIEW_REQUIRED 且含 OZON-RESTRICTED-SENSITIVE',
    ozonVape.status === 200 && ozonVape.data?.findings?.some((item: any) => item.ruleCode === 'OZON-RESTRICTED-SENSITIVE'),
    ozonVape.data)

  const review = await api('POST', `/api/compliance/checks/${ozonCheckId}/review`, { note: '人工复核通过，资料无误' }, ownerToken)
  check('人工复核留痕 → reviewedAt 已记录', review.status === 200 && Boolean(review.data?.reviewedAt), review.data)
  const ws3 = await api('GET', '/api/compliance/workspace', undefined, ownerToken)
  const ozonPermits = (ws3.data?.permits ?? []).filter((item: any) => item.productId === 'p-ozon-1' && item.status === 'VALID')
  check('复核通过自动签发许可', ozonPermits.length === 1, ws3.data?.permits)
  const ozonPermitId: string = ozonPermits[0]?.id ?? ''

  const report = await api('GET', `/api/compliance/permits/${ozonPermitId}/report`, undefined, ownerToken)
  check('许可报告含 schemaVersion 与检查快照',
    report.status === 200 && report.data?.schemaVersion === 'COMPLIANCE-RELEASE-PERMIT-V1' && report.data?.check?.request?.productId === 'p-ozon-1',
    report.data?.schemaVersion)

  const permitAgain = await api('POST', '/api/compliance/permits', { checkId: ozonCheckId, validDays: 7 }, ownerToken)
  check('重复签发返回同一 VALID 许可（幂等）', permitAgain.status === 200 && permitAgain.data?.id === ozonPermitId, permitAgain.data)

  const permitBlockedCheck = await api('POST', '/api/compliance/permits', { checkId: ozonMissing.data?.id, validDays: 7 }, ownerToken)
  check('BLOCKED 检查不可签发许可 → 400', permitBlockedCheck.status === 400, permitBlockedCheck.data)

  console.log('\n[4] 商品档案与合规文件')
  const profile = await api('POST', '/api/compliance/profiles', { productId: 'p-doc-1', platform: 'EBAY', brand: 'Acme', country: 'US' }, ownerToken)
  check('保存商品档案 → 200', profile.status === 200 && profile.data?.brand === 'Acme', profile.data)

  const docOrphan = await api('POST', '/api/compliance/documents', {
    productId: 'p-doc-new', documentType: 'SAFETY_DOCUMENT', name: '安全测试报告', status: 'PENDING_REVIEW', filePath: '/files/report.pdf'
  }, ownerToken)
  check('无档案商品保存文件 → 200（自动补建空档案）', docOrphan.status === 200, docOrphan.data)
  const ws4 = await api('GET', '/api/compliance/workspace', undefined, ownerToken)
  check('空档案已补建', (ws4.data?.profiles ?? []).some((item: any) => item.productId === 'p-doc-new'), ws4.data?.profiles?.length)

  const docExpired = await api('POST', '/api/compliance/documents', {
    productId: 'p-doc-1', documentType: 'SAFETY_DOCUMENT', name: '过期证书', status: 'APPROVED', expiresAt: '2020-01-01', filePath: '/files/old.pdf', reviewNote: '历史证书，留存对照'
  }, ownerToken)
  check('保存过期文件 → 200', docExpired.status === 200, docExpired.data)
  const ws5 = await api('GET', '/api/compliance/workspace', undefined, ownerToken)
  const expiredDoc = (ws5.data?.documents ?? []).find((item: any) => item.id === docExpired.data?.id)
  check('过期文件读取时状态修正为 EXPIRED', expiredDoc?.status === 'EXPIRED', expiredDoc)

  console.log('\n[5] 规则版本与 stale 检测')
  const newRule = await api('POST', '/api/compliance/rules', {
    code: 'OZON-SMOKETEST', platform: 'OZON', marketplaceSite: 'ALL', country: 'ALL', category: 'ALL',
    ruleType: 'LISTING_CONTENT', riskLevel: 'P2', reviewStatus: 'ACTIVE',
    title: '冒烟测试规则', summary: '测试用', keywords: ['smoketest'], requiredFields: [], remediation: '无', sourceUrl: '', effectiveFrom: '2026-01-01'
  }, ownerToken)
  check('新建规则 → v1 ACTIVE', newRule.status === 200 && newRule.data?.currentVersion === 1 && newRule.data?.reviewStatus === 'ACTIVE', newRule.data)
  const newRuleId: string = newRule.data?.id ?? ''

  const staleLatest = await api('GET', '/api/compliance/checks/latest/p-ozon-1', undefined, ownerToken)
  check('规则库变化后旧检查 → RECHECK_REQUIRED（RULESET-UPDATED）',
    staleLatest.status === 200 && staleLatest.data?.gateStatus === 'RECHECK_REQUIRED' && staleLatest.data?.findings?.[0]?.ruleCode === 'RULESET-UPDATED',
    staleLatest.data)

  const editRule = await api('POST', '/api/compliance/rules', {
    id: newRuleId, code: 'OZON-SMOKETEST', platform: 'OZON', marketplaceSite: 'ALL', country: 'ALL', category: 'ALL',
    ruleType: 'LISTING_CONTENT', riskLevel: 'P2', reviewStatus: 'ACTIVE',
    title: '冒烟测试规则 v2', summary: '测试用', keywords: ['smoketest'], requiredFields: [], remediation: '无', sourceUrl: '', effectiveFrom: '2026-01-01'
  }, ownerToken)
  check('编辑规则 → v2 且回到 PENDING_REVIEW', editRule.status === 200 && editRule.data?.currentVersion === 2 && editRule.data?.reviewStatus === 'PENDING_REVIEW', editRule.data)

  const activate = await api('PATCH', `/api/compliance/rules/${newRuleId}/status`, { status: 'ACTIVE' }, ownerToken)
  check('审核启用规则 → ACTIVE', activate.status === 200 && activate.data?.reviewStatus === 'ACTIVE', activate.data)

  console.log('\n[6] 权限与跨组织隔离')
  const roles = await api('GET', '/api/roles', undefined, ownerToken)
  const viewerRoleId = roles.data?.find((role: any) => role.name === '只读')?.id
  await api('POST', '/api/members', { email: 'viewer-a@test.com', name: '只读', password: 'pass1234', roleIds: [viewerRoleId], storeIds: [] }, ownerToken)
  const viewerLogin = await api('POST', '/api/auth/login', { email: 'viewer-a@test.com', password: 'pass1234' })
  const viewerToken: string = viewerLogin.data?.tokens?.accessToken ?? ''
  const viewerCheck = await api('POST', '/api/compliance/checks', {
    productId: 'p-x', platform: 'OZON', marketplaceSite: 'ALL', country: 'ALL', title: 't', imageUrl: 'u', categoryName: 'c'
  }, viewerToken)
  check('只读子帐号执行合规检查 → 403', viewerCheck.status === 403, viewerCheck.data)
  const viewerWs = await api('GET', '/api/compliance/workspace', undefined, viewerToken)
  check('只读子帐号可查看知识工作区 → 200', viewerWs.status === 200 && viewerWs.data?.rules?.length === 12, viewerWs.data?.rules?.length)

  const registerB = await registerOrg('竞争对手', 'owner-b@test.com')
  check('注册组织B → 200', registerB.status === 200, registerB.data)
  const ownerBToken: string = registerB.data?.tokens?.accessToken ?? ''
  const wsB = await api('GET', '/api/compliance/workspace', undefined, ownerBToken)
  check('组织B 拥有独立种子（规则 11）且无任何检查记录',
    wsB.status === 200 && wsB.data?.rules?.length === 11 && (wsB.data?.permits ?? []).length === 0,
    { rules: wsB.data?.rules?.length, permits: wsB.data?.permits?.length })
  const crossLatest = await api('GET', '/api/compliance/checks/latest/p-ozon-1', undefined, ownerBToken)
  check('组织B 读组织A 检查结论 → null', crossLatest.status === 200 && crossLatest.data === null, crossLatest.data)
  const crossReport = await api('GET', `/api/compliance/permits/${ozonPermitId}/report`, undefined, ownerBToken)
  check('组织B 读组织A 许可报告 → 404', crossReport.status === 404, crossReport.data)
  const crossCheck = await api('POST', `/api/compliance/checks/${ozonCheckId}/review`, { note: '越权' }, ownerBToken)
  check('组织B 复核组织A 检查 → 404', crossCheck.status === 404, crossCheck.data)
  const noToken = await api('GET', '/api/compliance/workspace')
  check('无令牌访问合规接口 → 401', noToken.status === 401)

  console.log('\n[7] 批量重检与审计')
  const recheck = await api('POST', '/api/compliance/checks/recheck', { platform: 'OZON', country: 'ALL' }, ownerToken)
  check('批量重检 OZON 档案 → 200 且总数 ≥ 2',
    recheck.status === 200 && recheck.data?.total >= 2 && recheck.data?.checked >= 2, recheck.data)

  const audit = await api('GET', '/api/audit-logs?limit=200', undefined, ownerToken)
  const actions: string[] = audit.data?.items?.map((item: any) => item.action) ?? []
  for (const expected of ['compliance.check.run', 'compliance.check.review', 'compliance.permit.issue', 'compliance.rule.save']) {
    check(`审计包含 ${expected}`, actions.includes(expected), actions)
  }
} finally {
  await app.close()
  await socket.stop()
  await db.close()
}

console.log(`\n========== 验收结果：${passed} 通过 / ${failed} 失败 ==========`)
process.exit(failed > 0 ? 1 : 0)
