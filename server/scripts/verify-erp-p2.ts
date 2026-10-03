/**
 * ERP P2 仓库入库端到端验收脚本（对照方案 P2 验收标准）：
 * 验收标准原文：
 *   「下载队列 worker + 产品库/详情 UI（AI仓库页上线）|
 *     单品全图下载成功且详情只引 local_path；断网模拟失败重试并记录失败 URL；
 *     状态 collected→downloaded 正确」
 *
 * 覆盖断言：
 *   1. 单品 3 图全部下载成功 → 每张 localPath 非空、文件落盘、job.status=DONE
 *   2. 详情只引 local_path：GET /products/:id 图片 url 走本地 /media/，不含货盘外链，且不返回 sourceUrl
 *   3. 状态 collected→downloaded 正确
 *   4. 断网模拟（不可达 URL）→ 退避重试后失败，failedUrls 记录失败图片的行主键（绝不落外链），产品仍为 COLLECTED
 *   5. 下载队列接口权限：未登录 401；运营（持 erp.warehouse.edit）可触发 200
 *   6. GET /download-jobs 列表可见进度
 *   7. 运营视角任务详情全文不含 scheme:// 外链（§2.2 SQL 层剥离不被 failed_urls/error 旁路）
 *   8. COLLECTED 部分落盘后覆盖重采：已落盘图与 AI 生成图不丢，未落盘死链行被替换
 *   9. 存量毒数据 migration：把 failed_urls 里的历史外链原值红化，且重跑幂等、不破坏脏 Json
 *
 * 运行：npx tsx scripts/verify-erp-p2.ts
 */
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { execFile } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dbPort = 5437
const mediaDir = path.join(os.tmpdir(), `erp-p2-media-${Date.now()}`)

process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres?sslmode=disable`
process.env.JWT_SECRET = 'verify-erp-secret'
process.env.ACCESS_TOKEN_TTL = '1h'
process.env.REFRESH_TOKEN_TTL_DAYS = '7'
process.env.LOG_LEVEL = 'warn'
process.env.MEDIA_DRIVER = 'local'
process.env.MEDIA_LOCAL_DIR = mediaDir
process.env.MEDIA_PUBLIC_BASE_URL = ''
// 快速退避，令断网失败用例在毫秒级完成（重试 2 次，每次退避 30ms）
process.env.ERP_DOWNLOAD_RETRIES = '2'
process.env.ERP_DOWNLOAD_BACKOFF_MS = '30,30,30'
process.env.ERP_DOWNLOAD_CONCURRENCY = '4'
process.env.ERP_DOWNLOAD_TIMEOUT_MS = '3000'

// ---- 本地图床：返回极小合法图片，令下载成功用例可确定性验证 ----
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9])
const imageServer = http.createServer((req, res) => {
  const url = req.url ?? ''
  if (url.startsWith('/dead')) { res.writeHead(500); res.end('err'); return }
  res.writeHead(200, { 'content-type': url.endsWith('.png') ? 'image/png' : 'image/jpeg', 'content-length': String(JPEG_BYTES.length) })
  res.end(JPEG_BYTES)
})
await new Promise<void>(resolve => imageServer.listen(0, '127.0.0.1', resolve))
const imgAddress = imageServer.address()
const imgPort = typeof imgAddress === 'object' && imgAddress ? imgAddress.port : 0
const imgBase = `http://127.0.0.1:${imgPort}`

console.log('[verify-erp-p2] 启动嵌入式 PostgreSQL…')
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

console.log('[verify-erp-p2] 执行数据库迁移…')
const prismaBin = path.join(serverDir, 'node_modules', '.bin', 'prisma')
await execFileAsync(prismaBin, ['migrate', 'deploy'], { cwd: serverDir, env: { ...process.env } })

console.log('[verify-erp-p2] 启动应用…')
const { buildApp } = await import('../src/app.js')
const { prisma } = await import('../src/lib/prisma.js')
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

async function pollJob(jobId: string, token: string, timeoutMs = 15000): Promise<any> {
  const deadline = Date.now() + timeoutMs
  let last: any = null
  while (Date.now() < deadline) {
    const res = await api('GET', `/api/erp/download-jobs/${jobId}`, undefined, token)
    last = res.data
    if (last && ['DONE', 'PARTIAL', 'FAILED'].includes(last.status)) return last
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  return last
}

try {
  console.log('\n[0] 首装注册 + 采集专员 / 运营子帐号')
  const register = await api('POST', '/api/auth/register', { name: '老板', email: '13800000001', password: 'Owner#2026erp' })
  const ownerToken: string = register.data?.accessToken ?? register.data?.tokens?.accessToken
  const orgId = register.data?.user?.orgId ?? (await prisma.user.findUnique({ where: { email: '13800000001' } }))!.orgId
  const roles = await prisma.role.findMany({ where: { orgId }, select: { id: true, key: true } })
  const roleKeyMap = new Map(roles.map(role => [role.key, role.id]))
  const collectorMember = await api('POST', '/api/members', { email: '13800000002', password: 'Collector#2026', name: '采集小张', roleIds: [roleKeyMap.get('COLLECTOR')!] }, ownerToken)
  const operatorMember = await api('POST', '/api/members', { email: '13800000003', password: 'Operator#2026', name: '运营小李', roleIds: [roleKeyMap.get('OPERATOR')!] }, ownerToken)
  for (const member of [collectorMember, operatorMember]) {
    if (member.data?.id && member.data?.status && member.data.status !== 'ACTIVE') {
      await api('POST', `/api/members/${member.data.id}/approve`, {}, ownerToken)
    }
  }
  const collectorLogin = await api('POST', '/api/auth/login', { email: '13800000002', password: 'Collector#2026' })
  const operatorLogin = await api('POST', '/api/auth/login', { email: '13800000003', password: 'Operator#2026' })
  const collectorToken: string = collectorLogin.data?.accessToken ?? collectorLogin.data?.tokens?.accessToken
  const operatorToken: string = operatorLogin.data?.accessToken ?? operatorLogin.data?.tokens?.accessToken
  check('双角色登录成功', Boolean(collectorToken) && Boolean(operatorToken), { collector: collectorLogin.status, operator: operatorLogin.status })

  console.log('\n[1] 种子货盘 + 采集一个含 3 图的产品（外链指向本地图床）')
  const supplier = await prisma.erpSupplier.create({
    data: {
      orgId, code: 'GIGACLOUD', name: '大健云仓', loginUrl: 'https://www.gigab2b.com/',
      crawlRules: { domains: ['gigab2b.com'] }, patrolChannel: 'CLIENT',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }
  })
  const collectRes = await api('POST', '/api/erp/collect', {
    items: [{
      supplierId: supplier.id, sourceProductId: 'GIGA-2001', sourceUrl: 'https://www.gigab2b.com/p/2001',
      titleOriginal: '入库测试产品', costPrice: 20, stockQuantity: 10, currency: 'CNY',
      images: [
        { imageType: 'MAIN', sourceUrl: `${imgBase}/a.jpg`, sortOrder: 0 },
        { imageType: 'MAIN', sourceUrl: `${imgBase}/b.jpg`, sortOrder: 1 },
        { imageType: 'DETAIL', sourceUrl: `${imgBase}/c.png`, sortOrder: 2 }
      ]
    }], mode: 'SINGLE'
  }, collectorToken)
  check('采集入库 CREATED', collectRes.data?.items?.[0]?.result === 'CREATED', collectRes.data?.items)
  const productId: string = collectRes.data?.items?.[0]?.productId
  if (!productId) throw new Error(`采集未返回 productId：${JSON.stringify(collectRes)}`)
  const beforeProduct = await prisma.erpProduct.findUnique({ where: { id: productId } })
  check('下载前状态为 COLLECTED', beforeProduct?.status === 'COLLECTED')
  const beforeImages = await prisma.erpProductImage.findMany({ where: { productId } })
  check('下载前 3 图 localPath 均为空', beforeImages.length === 3 && beforeImages.every(i => i.localPath === ''))

  console.log('\n[2] 触发下载队列 → 轮询至完成')
  const enqueue = await api('POST', `/api/erp/products/${productId}/download-images`, {}, operatorToken)
  check('触发下载接口 200', enqueue.status === 200, enqueue)
  const jobId: string = enqueue.data?.id
  check('返回下载任务 id', Boolean(jobId))
  const doneJob = await pollJob(jobId, operatorToken)
  check('下载任务状态 DONE', doneJob?.status === 'DONE', doneJob)
  check('下载任务 done=total=3', doneJob?.done === 3 && doneJob?.total === 3, doneJob)
  check('下载任务无失败 URL', (doneJob?.failedUrls ?? []).length === 0, doneJob?.failedUrls)

  console.log('\n[3] 全图落盘 + local_path 回填 + 磁盘文件存在')
  const afterImages = await prisma.erpProductImage.findMany({ where: { productId } })
  check('3 图 localPath 全部非空', afterImages.length === 3 && afterImages.every(i => i.localPath !== ''))
  check('localPath 为媒体 key（org-<orgId>/erp/...）', afterImages.every(i => i.localPath.startsWith(`org-${orgId}/erp/`)), afterImages.map(i => i.localPath))
  check('磁盘文件全部存在', afterImages.every(i => existsSync(path.join(mediaDir, ...i.localPath.split('/')))), afterImages.map(i => path.join(mediaDir, ...i.localPath.split('/'))))

  console.log('\n[4] 状态 collected→downloaded 正确')
  const afterProduct = await prisma.erpProduct.findUnique({ where: { id: productId } })
  check('下载后产品状态 DOWNLOADED', afterProduct?.status === 'DOWNLOADED', afterProduct?.status)

  console.log('\n[5] 详情只引 local_path（禁货盘外链）')
  const detail = await api('GET', `/api/erp/products/${productId}`, undefined, collectorToken)
  check('详情接口 200', detail.status === 200, detail)
  const detailImages = detail.data?.images ?? []
  check('详情图片 url 走本地 /media/', detailImages.length === 3 && detailImages.every((i: any) => typeof i.url === 'string' && i.url.includes('/media/')), detailImages.map((i: any) => i.url))
  check('详情图片 url 不含图床外链主机', detailImages.every((i: any) => !i.url.includes('127.0.0.1') && !i.url.includes('http')), detailImages.map((i: any) => i.url))
  check('入库后详情图片不再返回 sourceUrl（禁外链）', detailImages.every((i: any) => !('sourceUrl' in i)), detailImages.map((i: any) => Object.keys(i)))

  console.log('\n[6] 断网模拟：不可达外链 → 退避重试后失败并记录 failedUrls')
  const deadCollect = await api('POST', '/api/erp/collect', {
    items: [{
      supplierId: supplier.id, sourceProductId: 'GIGA-DEAD', sourceUrl: 'https://www.gigab2b.com/p/dead',
      titleOriginal: '断网测试产品', costPrice: 5, currency: 'CNY',
      images: [
        { imageType: 'MAIN', sourceUrl: 'http://127.0.0.1:1/dead-1.jpg', sortOrder: 0 },
        { imageType: 'MAIN', sourceUrl: 'http://127.0.0.1:1/dead-2.jpg', sortOrder: 1 }
      ]
    }], mode: 'SINGLE'
  }, collectorToken)
  const deadProductId: string = deadCollect.data?.items?.[0]?.productId
  const deadEnqueue = await api('POST', `/api/erp/products/${deadProductId}/download-images`, {}, operatorToken)
  const deadJobId: string = deadEnqueue.data?.id
  const deadJob = await pollJob(deadJobId, operatorToken)
  check('断网任务状态 FAILED', deadJob?.status === 'FAILED', deadJob)
  check('断网任务 done=0', deadJob?.done === 0, deadJob)
  const deadImages = await prisma.erpProductImage.findMany({ where: { productId: deadProductId } })
  check('failedUrls 记录 2 条失败图片的行主键', (deadJob?.failedUrls ?? []).length === 2 && deadJob.failedUrls.every((u: string) => deadImages.some(i => i.id === u)), deadJob?.failedUrls)
  check('failedUrls 不含任何 scheme:// 外链（禁旁路泄漏货盘来源）', deadJob.failedUrls.every((u: string) => !u.includes('://')), deadJob?.failedUrls)
  const deadJobRow = await prisma.erpDownloadJob.findUnique({ where: { id: deadJobId } })
  check('failed_urls 持久化列同样只存行主键', !JSON.stringify(deadJobRow?.failedUrls ?? []).includes('://'), deadJobRow?.failedUrls)
  check('error 持久化列不含外链', !(deadJobRow?.error ?? '').includes('://'), deadJobRow?.error)
  const deadProduct = await prisma.erpProduct.findUnique({ where: { id: deadProductId } })
  check('断网产品仍为 COLLECTED（未误切 DOWNLOADED）', deadProduct?.status === 'COLLECTED', deadProduct?.status)
  check('断网图片 localPath 仍为空', deadImages.every(i => i.localPath === ''))

  console.log('\n[7] 下载队列接口权限隔离')
  const anonTrigger = await api('POST', `/api/erp/products/${productId}/download-images`, {})
  check('未登录触发下载 401', anonTrigger.status === 401, anonTrigger)
  const collectorTrigger = await api('POST', `/api/erp/products/${productId}/download-images`, {}, collectorToken)
  check('采集专员（无 erp.warehouse.edit）触发下载 403', collectorTrigger.status === 403, collectorTrigger.status)
  const operatorJobs = await api('GET', '/api/erp/download-jobs', undefined, operatorToken)
  check('运营可查看下载队列列表 200', operatorJobs.status === 200, operatorJobs)
  check('下载队列列表含已完成与失败任务', Array.isArray(operatorJobs.data) && operatorJobs.data.some((j: any) => j.status === 'DONE') && operatorJobs.data.some((j: any) => j.status === 'FAILED'), operatorJobs.data?.map((j: any) => j.status))
  check('运营视角队列列表全文不含 scheme:// 外链', !JSON.stringify(operatorJobs.data ?? null).includes('://'), JSON.stringify(operatorJobs.data ?? null).slice(0, 400))
  const operatorDeadJob = await api('GET', `/api/erp/download-jobs/${deadJobId}`, undefined, operatorToken)
  check('运营可读失败任务详情 200', operatorDeadJob.status === 200, operatorDeadJob.status)
  check('运营视角失败任务详情全文不含 scheme:// 外链', !JSON.stringify(operatorDeadJob.data ?? null).includes('://'), operatorDeadJob.data)
  const collectorDeadJob = await api('GET', `/api/erp/download-jobs/${deadJobId}`, undefined, collectorToken)
  check('采集视角同样不返回外链（红化与角色无关）', !JSON.stringify(collectorDeadJob.data ?? null).includes('://'), collectorDeadJob.data)
  const operatorTrigger = await api('POST', `/api/erp/products/${deadProductId}/download-images`, {}, operatorToken)
  check('运营（持 erp.warehouse.edit）可触发下载 200', operatorTrigger.status === 200, operatorTrigger)

  console.log('\n[8] COLLECTED 部分落盘 → 覆盖重采不丢已落盘图与 AI 生成图')
  const partCollect = await api('POST', '/api/erp/collect', {
    items: [{
      supplierId: supplier.id, sourceProductId: 'GIGA-PART', sourceUrl: 'https://www.gigab2b.com/p/part',
      titleOriginal: '部分落盘产品', costPrice: 8, currency: 'CNY',
      images: [
        { imageType: 'MAIN', sourceUrl: `${imgBase}/p1.jpg`, sortOrder: 0 },
        { imageType: 'MAIN', sourceUrl: 'http://127.0.0.1:1/dead-p.jpg', sortOrder: 1 }
      ]
    }], mode: 'SINGLE'
  }, collectorToken)
  const partProductId: string = partCollect.data?.items?.[0]?.productId
  check('部分落盘产品采集 CREATED', partCollect.data?.items?.[0]?.result === 'CREATED', partCollect.data?.items)
  // AI 生成图是高成本增量资产：直接落一行 imageType=AI（ai-process 的 baseSort=1000+count 约定）
  const aiRow = await prisma.erpProductImage.create({
    data: {
      orgId, productId: partProductId, imageType: 'AI', sourceUrl: '', platform: null,
      localPath: `org-${orgId}/erp/${partProductId}/ai-gen-1.jpg`, isSelected: 0, sortOrder: 1000,
      createdAt: new Date().toISOString()
    }
  })
  const partEnqueue = await api('POST', `/api/erp/products/${partProductId}/download-images`, {}, operatorToken)
  const partJob = await pollJob(partEnqueue.data?.id, operatorToken)
  check('一成一败任务状态 PARTIAL', partJob?.status === 'PARTIAL', partJob)
  const partImagesBefore = await prisma.erpProductImage.findMany({ where: { productId: partProductId }, orderBy: { sortOrder: 'asc' } })
  const downloadedRow = partImagesBefore.find(i => i.imageType !== 'AI' && i.localPath !== '')
  const deadRow = partImagesBefore.find(i => i.imageType !== 'AI' && i.localPath === '')
  check('落盘 1 张 + 死链 1 张 + AI 行 1 条', Boolean(downloadedRow) && Boolean(deadRow) && partImagesBefore.length === 3, partImagesBefore.map(i => ({ id: i.id, type: i.imageType, local: i.localPath })))
  const partProductBefore = await prisma.erpProduct.findUnique({ where: { id: partProductId } })
  check('部分落盘后产品仍为 COLLECTED（可被覆盖重采）', partProductBefore?.status === 'COLLECTED', partProductBefore?.status)

  const recollected = await api('POST', '/api/erp/collect', {
    items: [{
      supplierId: supplier.id, sourceProductId: 'GIGA-PART', sourceUrl: 'https://www.gigab2b.com/p/part',
      titleOriginal: '部分落盘产品（货盘改价）', costPrice: 9, currency: 'CNY',
      images: [
        { imageType: 'MAIN', sourceUrl: `${imgBase}/p2.jpg`, sortOrder: 0 },
        { imageType: 'DETAIL', sourceUrl: `${imgBase}/p3.png`, sortOrder: 1 }
      ]
    }], mode: 'SINGLE', overwrite: true
  }, collectorToken)
  check('覆盖重采返回 OVERWRITTEN', recollected.data?.items?.[0]?.result === 'OVERWRITTEN', recollected.data?.items)
  const partImagesAfter = await prisma.erpProductImage.findMany({ where: { productId: partProductId }, orderBy: { sortOrder: 'asc' } })
  check('已落盘源图行保留且 localPath 未变', partImagesAfter.some(i => i.id === downloadedRow?.id && i.localPath === downloadedRow?.localPath), partImagesAfter.map(i => i.id))
  check('AI 生成图行保留', partImagesAfter.some(i => i.id === aiRow.id), partImagesAfter.map(i => ({ id: i.id, type: i.imageType })))
  check('未落盘死链行已被替换删除', !partImagesAfter.some(i => i.id === deadRow?.id), partImagesAfter.map(i => i.id))
  check('新图集 2 张已入库（未落盘）', partImagesAfter.filter(i => i.imageType !== 'AI' && i.localPath === '').length === 2, partImagesAfter.map(i => ({ type: i.imageType, local: i.localPath })))
  const partProductAfter = await prisma.erpProduct.findUnique({ where: { id: partProductId } })
  check('覆盖重采后仍为 COLLECTED（不回退也不越级）', partProductAfter?.status === 'COLLECTED', partProductAfter?.status)
  check('覆盖重采写入审计与产品/图片同事务', (await prisma.auditLog.count({ where: { orgId, action: 'ERP_COLLECT_OVERWRITE', targetId: partProductId } })) === 1)

  console.log('\n[9] 存量毒数据 migration：failed_urls / error 历史外链红化')
  // migrate deploy 只在全新库上跑过（当时零行），无法证明红化 SQL 真的生效；
  // 这里按生产形态造毒数据后原样重放该 migration 的 SQL，验证效果 + 幂等 + 脏 Json 不被破坏。
  const migrationPath = path.join(serverDir, 'prisma', 'migrations', '20260929000000_redact_erp_download_job_failed_urls', 'migration.sql')
  const migrationStatements = (await readFile(migrationPath, 'utf8'))
    .split('\n')
    .filter(line => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map(statement => statement.trim())
    .filter(Boolean)
  check('migration SQL 解析出 2 条语句', migrationStatements.length === 2, migrationStatements.length)
  const stamp = new Date().toISOString()
  const poisonJob = await prisma.erpDownloadJob.create({
    data: {
      orgId, productId: deadProductId, status: 'FAILED', total: 2, done: 0,
      failedUrls: ['https://cdn.gigab2b.com/product/dead/1.jpg', 'clxlegacyimageid0001'] as any,
      error: '下载失败（共尝试 3 次）：fetch failed https://cdn.gigab2b.com/product/dead/1.jpg',
      createdAt: stamp, updatedAt: stamp
    }
  })
  const dirtyJob = await prisma.erpDownloadJob.create({
    data: {
      orgId, productId: deadProductId, status: 'FAILED', total: 1, done: 0,
      failedUrls: { url: 'https://cdn.gigab2b.com/dirty.jpg' } as any,
      error: '', createdAt: stamp, updatedAt: stamp
    }
  })
  for (const statement of migrationStatements) await prisma.$executeRawUnsafe(statement)
  const redactedJob = await prisma.erpDownloadJob.findUnique({ where: { id: poisonJob.id } })
  check('存量外链元素被红化为 [REDACTED]', JSON.stringify(redactedJob?.failedUrls) === '["[REDACTED]","clxlegacyimageid0001"]', redactedJob?.failedUrls)
  check('存量 error 内 URL 被红化、中文说明保留', redactedJob?.error === '下载失败（共尝试 3 次）：fetch failed [REDACTED]', redactedJob?.error)
  for (const statement of migrationStatements) await prisma.$executeRawUnsafe(statement)
  const replayedJob = await prisma.erpDownloadJob.findUnique({ where: { id: poisonJob.id } })
  check('migration 幂等：重放后结果不变', JSON.stringify(replayedJob?.failedUrls) === JSON.stringify(redactedJob?.failedUrls) && replayedJob?.error === redactedJob?.error, replayedJob?.failedUrls)
  for (const statement of migrationStatements) await prisma.$executeRawUnsafe(statement)
  const dirtyAfter = await prisma.erpDownloadJob.findUnique({ where: { id: dirtyJob.id } })
  check('非数组脏 Json 不被 WHERE 守卫改写（由读时红化兜底）', JSON.stringify(dirtyAfter?.failedUrls) === '{"url":"https://cdn.gigab2b.com/dirty.jpg"}', dirtyAfter?.failedUrls)
  const dirtyView = await api('GET', `/api/erp/download-jobs/${dirtyJob.id}`, undefined, operatorToken)
  check('脏 Json 经读时红化归零为空数组（不抛异常）', dirtyView.status === 200 && Array.isArray(dirtyView.data?.failedUrls) && dirtyView.data.failedUrls.length === 0, dirtyView.data)
} catch (error) {
  failed += 1
  console.error('[verify-erp-p2] 异常：', error)
}

console.log(`\n[verify-erp-p2] 通过 ${passed} 项，失败 ${failed} 项`)
await app.close()
await socket.stop()
imageServer.close()
process.exit(failed === 0 ? 0 : 1)
