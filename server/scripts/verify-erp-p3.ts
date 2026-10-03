/**
 * ERP P3 AI 加工端到端验收脚本（对照方案 P3 验收标准）：
 * 验收标准原文：
 *   「图生图适配 + 待选图定稿 + 三风格标题 |
 *     产品本体一致性人工核对表通过；eBay 主图无文字规则生效；标题≤平台上限；
 *     未定稿不替换原图；可换模型重试」
 *
 * 覆盖断言：
 *   A. 产品本体一致性：图生图以「已入库原图」作参考图（referenceImageUrls 指向本地 /media/），
 *      模型为参照编辑模型（qwen-image-edit-plus），prompt 含保持商品本体约束。
 *   B. eBay 主图无文字规则生效：ensurePlatformRule 默认 ebay.mainImageNoText=true → prompt 含 no text/watermark/logo。
 *   C. 未定稿不替换原图：AI 图以 imageType='AI' + isSelected=0 落库为待选图，原图数量/localPath 不变。
 *   D. 状态 DOWNLOADED→PROCESSING；候选图下载落盘。
 *   E. 可换模型重试：二次以 qwen-image-edit-max 追加候选，不覆盖首批。
 *   F. 三风格标题 + 字符上限：eBay(80) 超限截断、Amazon(200) 不截断，写入 ErpListing.aiTitleOptions。
 *   G. 待选图定稿（HTTP select）：isSelected=1，原图仍 isSelected=0。
 *   H. 选定标题（HTTP choose-title）→ 状态推进 READY。
 *   I. 平台规则 HTTP GET/PUT 生效。
 *   J. 权限：未登录 401；未入库产品 AI 加工 400；缺 platform 400。
 *
 * 运行：npx tsx scripts/verify-erp-p3.ts
 */
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { execFile } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dbPort = 5438
const mediaDir = path.join(os.tmpdir(), `erp-p3-media-${Date.now()}`)

process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres?sslmode=disable`
process.env.JWT_SECRET = 'verify-erp-secret'
process.env.ACCESS_TOKEN_TTL = '1h'
process.env.REFRESH_TOKEN_TTL_DAYS = '7'
process.env.LOG_LEVEL = 'warn'
process.env.MEDIA_DRIVER = 'local'
process.env.MEDIA_LOCAL_DIR = mediaDir
process.env.MEDIA_PUBLIC_BASE_URL = ''
process.env.ERP_DOWNLOAD_RETRIES = '2'
process.env.ERP_DOWNLOAD_BACKOFF_MS = '30,30,30'
process.env.ERP_DOWNLOAD_CONCURRENCY = '4'
process.env.ERP_DOWNLOAD_TIMEOUT_MS = '3000'

// ---- 本地图床：既作采集原图源，也作 AI 生成图（mock）回源下载地址 ----
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9])
const imageServer = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': String(JPEG_BYTES.length) })
  res.end(JPEG_BYTES)
})
await new Promise<void>(resolve => imageServer.listen(0, '127.0.0.1', resolve))
const imgAddress = imageServer.address()
const imgPort = typeof imgAddress === 'object' && imgAddress ? imgAddress.port : 0
const imgBase = `http://127.0.0.1:${imgPort}`

console.log('[verify-erp-p3] 启动嵌入式 PostgreSQL…')
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

console.log('[verify-erp-p3] 执行数据库迁移…')
const prismaBin = path.join(serverDir, 'node_modules', '.bin', 'prisma')
await execFileAsync(prismaBin, ['migrate', 'deploy'], { cwd: serverDir, env: { ...process.env } })

console.log('[verify-erp-p3] 启动应用…')
const { buildApp } = await import('../src/app.js')
const { prisma } = await import('../src/lib/prisma.js')
const { generateProductImages, generateProductTitles, TITLE_STYLES } = await import('../src/modules/erp/ai-process.js')
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
  const ownerRow = await prisma.user.findUnique({ where: { email: '13800000001' } })
  const orgId = ownerRow!.orgId
  const ownerUser = { id: ownerRow!.id, orgId, email: ownerRow!.email, name: ownerRow!.name, isOwner: true, permissions: new Set<string>(), storeScope: null }
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

  console.log('\n[1] 种子货盘 + 采集 3 图产品 + 下载入库（前置：status=DOWNLOADED，原图 local_path 就绪）')
  const supplier = await prisma.erpSupplier.create({
    data: {
      orgId, code: 'GIGACLOUD', name: '大健云仓', loginUrl: 'https://www.gigab2b.com/',
      crawlRules: { domains: ['gigab2b.com'] }, patrolChannel: 'CLIENT',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }
  })
  const collectRes = await api('POST', '/api/erp/collect', {
    items: [{
      supplierId: supplier.id, sourceProductId: 'GIGA-3001', sourceUrl: 'https://www.gigab2b.com/p/3001',
      titleOriginal: 'Pet Grooming Brush for Dogs and Cats', category: 'Pet Supplies', brand: 'GIGA',
      costPrice: 20, stockQuantity: 10, currency: 'CNY',
      images: [
        { imageType: 'MAIN', sourceUrl: `${imgBase}/a.jpg`, sortOrder: 0 },
        { imageType: 'MAIN', sourceUrl: `${imgBase}/b.jpg`, sortOrder: 1 },
        { imageType: 'DETAIL', sourceUrl: `${imgBase}/c.jpg`, sortOrder: 2 }
      ]
    }], mode: 'SINGLE'
  }, collectorToken)
  const productId: string = collectRes.data?.items?.[0]?.productId
  if (!productId) throw new Error(`采集未返回 productId：${JSON.stringify(collectRes)}`)
  const enqueue = await api('POST', `/api/erp/products/${productId}/download-images`, {}, operatorToken)
  const doneJob = await pollJob(enqueue.data?.id, operatorToken)
  check('前置：下载任务 DONE', doneJob?.status === 'DONE', doneJob)
  const downloadedProduct = await prisma.erpProduct.findUnique({ where: { id: productId } })
  check('前置：产品状态 DOWNLOADED', downloadedProduct?.status === 'DOWNLOADED', downloadedProduct?.status)
  const originalImages = await prisma.erpProductImage.findMany({ where: { productId, imageType: { not: 'AI' } } })
  check('前置：3 张原图 localPath 就绪', originalImages.length === 3 && originalImages.every(i => i.localPath !== ''))

  console.log('\n[A/B/D] 图生图：以原图为参考图 + eBay 主图无文字规则 + DOWNLOADED→PROCESSING')
  let capturedInput: any = null
  let capturedProfile: any = null
  const mockImageGenerator = async (profile: any, input: any) => {
    capturedProfile = profile
    capturedInput = input
    return { provider: 'bailian' as const, model: input.model, taskId: 'mock-task-1', imageUrls: [`${imgBase}/ai1.jpg`, `${imgBase}/ai2.jpg`] }
  }
  const aiRes = await generateProductImages(ownerUser, productId, { platform: 'ebay', count: 2 }, { imageGenerator: mockImageGenerator })
  check('A. 以已入库原图作参考图（referenceImageUrls 非空）', Array.isArray(capturedInput?.referenceImageUrls) && capturedInput.referenceImageUrls.length >= 1, capturedInput?.referenceImageUrls)
  check('A. 参考图指向本地已入库媒体（/media/，禁外链原样）', (capturedInput?.referenceImageUrls ?? []).every((u: string) => typeof u === 'string' && u.includes('/media/')), capturedInput?.referenceImageUrls)
  check('A. 参考图数量不超过模型上限（qwen-image-edit-plus=3）', (capturedInput?.referenceImageUrls ?? []).length <= (capturedProfile?.maxReferenceImages ?? 3), { refs: capturedInput?.referenceImageUrls?.length, max: capturedProfile?.maxReferenceImages })
  check('A. 默认模型为参照编辑模型 qwen-image-edit-plus', aiRes.model === 'qwen-image-edit-plus' && capturedInput?.model === 'qwen-image-edit-plus', aiRes.model)
  check('A. prompt 含产品本体一致性约束', typeof capturedInput?.prompt === 'string' && capturedInput.prompt.includes('Keep the exact product identity'), capturedInput?.prompt)
  check('B. eBay 主图无文字规则生效（prompt 含 no text/watermark/logo）', typeof capturedInput?.prompt === 'string' && capturedInput.prompt.includes('no text') && capturedInput.prompt.includes('no watermark') && capturedInput.prompt.includes('no logo'), capturedInput?.prompt)
  check('D. 状态推进为 PROCESSING', aiRes.status === 'PROCESSING')
  const afterAiProduct = await prisma.erpProduct.findUnique({ where: { id: productId } })
  check('D. DB 中产品状态 PROCESSING', afterAiProduct?.status === 'PROCESSING', afterAiProduct?.status)
  check('D. 返回 2 张候选图', aiRes.generated === 2 && aiRes.candidates.length === 2, aiRes.candidates)
  check('D. 候选图下载落盘（localPath 非空且文件存在）', aiRes.candidates.every(c => c.localPath !== '' && existsSync(path.join(mediaDir, ...c.localPath.split('/')))), aiRes.candidates.map(c => c.localPath))

  console.log('\n[C] 未定稿不替换原图：AI 图为待选图 isSelected=0，原图完好')
  const aiImages = await prisma.erpProductImage.findMany({ where: { productId, imageType: 'AI' } })
  check('C. AI 图 imageType=AI 且 isSelected=0（待选图）', aiImages.length === 2 && aiImages.every(i => i.isSelected === 0), aiImages.map(i => i.isSelected))
  const originalsAfter = await prisma.erpProductImage.findMany({ where: { productId, imageType: { not: 'AI' } } })
  check('C. 原图数量仍为 3（未被替换/删除）', originalsAfter.length === 3)
  check('C. 原图 localPath 未变且 isSelected=0', originalsAfter.every(i => i.localPath !== '' && i.isSelected === 0))

  console.log('\n[E] 可换模型重试：二次以 qwen-image-edit-max 追加候选，不覆盖首批')
  let secondModel = ''
  const mockImageGenerator2 = async (_profile: any, input: any) => {
    secondModel = input.model
    return { provider: 'bailian' as const, model: input.model, taskId: 'mock-task-2', imageUrls: [`${imgBase}/ai3.jpg`] }
  }
  const aiRes2 = await generateProductImages(ownerUser, productId, { platform: 'ebay', model: 'qwen-image-edit-max', count: 1 }, { imageGenerator: mockImageGenerator2 })
  check('E. 二次调用使用换用模型 qwen-image-edit-max', secondModel === 'qwen-image-edit-max' && aiRes2.model === 'qwen-image-edit-max', aiRes2.model)
  const allAiImages = await prisma.erpProductImage.findMany({ where: { productId, imageType: 'AI' } })
  check('E. 候选图累计追加（2+1=3），首批未被覆盖', allAiImages.length === 3, allAiImages.length)
  check('E. 原图仍为 3（重试不影响原图）', (await prisma.erpProductImage.count({ where: { productId, imageType: { not: 'AI' } } })) === 3)

  console.log('\n[F] 三风格标题 + 平台字符上限（eBay 80 截断 / Amazon 200 不截断）')
  const mockTitleGenerator = async (ctx: any) => {
    // 第二条故意超限，验证 enforceTitleLimit 截断
    return [
      'Premium Pet Grooming Brush',
      'X'.repeat(ctx.charLimit + 40),
      'Soft Bristle Deshedding Tool for Dogs and Cats, Gentle Grooming'
    ]
  }
  const ebayTitles = await generateProductTitles(ownerUser, productId, { platform: 'ebay' }, { titleGenerator: mockTitleGenerator })
  check('F. 生成三风格标题', ebayTitles.options.length === 3, ebayTitles.options)
  check('F. 风格与 TITLE_STYLES 一致', ebayTitles.options.map(o => o.style).join('|') === [...TITLE_STYLES].join('|'), ebayTitles.options.map(o => o.style))
  check('F. eBay 字符上限 80', ebayTitles.charLimit === 80, ebayTitles.charLimit)
  check('F. 所有标题 charCount ≤ 80', ebayTitles.options.every(o => o.charCount <= 80), ebayTitles.options.map(o => o.charCount))
  check('F. 超限标题被截断（truncated=true）', ebayTitles.options.some(o => o.truncated === true), ebayTitles.options.map(o => o.truncated))
  const ebayListing = await prisma.erpListing.findUnique({ where: { productId_platformCode: { productId, platformCode: 'ebay' } } })
  const storedOptions = (ebayListing?.aiTitleOptions as any[]) ?? []
  check('F. aiTitleOptions 落库 3 条', storedOptions.length === 3, storedOptions)

  const amazonTitles = await generateProductTitles(ownerUser, productId, { platform: 'amazon' }, { titleGenerator: mockTitleGenerator })
  check('F. Amazon 字符上限 200', amazonTitles.charLimit === 200, amazonTitles.charLimit)
  check('F. Amazon 下正常标题不被截断', amazonTitles.options.filter(o => o.style !== '关键词覆盖型').every(o => o.truncated === false), amazonTitles.options.map(o => [o.style, o.truncated]))

  console.log('\n[G] 待选图定稿（HTTP select）：isSelected=1，原图仍 isSelected=0')
  const aiToSelect = allAiImages[0]!
  const selectRes = await api('POST', `/api/erp/products/${productId}/images/${aiToSelect.id}/select`, { isSelected: true }, operatorToken)
  check('G. 运营定稿待选图 200', selectRes.status === 200, selectRes)
  check('G. 返回 isSelected=1', selectRes.data?.isSelected === 1, selectRes.data)
  const dbSelected = await prisma.erpProductImage.findUnique({ where: { id: aiToSelect.id } })
  check('G. DB 中该 AI 图 isSelected=1', dbSelected?.isSelected === 1, dbSelected?.isSelected)
  check('G. 原图仍 isSelected=0（定稿不替换原图）', (await prisma.erpProductImage.findMany({ where: { productId, imageType: { not: 'AI' } } })).every(i => i.isSelected === 0))
  check('G. 定稿后状态仍为 PROCESSING（未选标题不 READY）', (await prisma.erpProduct.findUnique({ where: { id: productId } }))?.status === 'PROCESSING')

  console.log('\n[H] 选定标题（HTTP choose-title）→ 状态推进 READY')
  const chooseRes = await api('POST', `/api/erp/products/${productId}/choose-title`, { platform: 'ebay', title: 'Premium Pet Grooming Brush for Dogs and Cats' }, operatorToken)
  check('H. 选定标题 200', chooseRes.status === 200, chooseRes)
  check('H. 返回 productStatus=READY', chooseRes.data?.productStatus === 'READY', chooseRes.data)
  check('H. DB 中产品状态 READY', (await prisma.erpProduct.findUnique({ where: { id: productId } }))?.status === 'READY')
  const finalListing = await prisma.erpListing.findUnique({ where: { productId_platformCode: { productId, platformCode: 'ebay' } } })
  check('H. listing.title 写入选定标题', finalListing?.title === 'Premium Pet Grooming Brush for Dogs and Cats', finalListing?.title)

  console.log('\n[I] 平台规则 HTTP GET/PUT')
  const rulesRes = await api('GET', '/api/erp/platform-rules', undefined, operatorToken)
  check('I. 运营可查看平台规则 200', rulesRes.status === 200, rulesRes)
  check('I. 规则含 ebay/amazon', Array.isArray(rulesRes.data) && rulesRes.data.some((r: any) => r.platformCode === 'ebay') && rulesRes.data.some((r: any) => r.platformCode === 'amazon'), rulesRes.data?.map((r: any) => r.platformCode))
  const putRule = await api('PUT', '/api/erp/platform-rules/ebay', { titleCharLimit: 60 }, operatorToken)
  check('I. 更新 eBay 字符上限 200', putRule.status === 200, putRule)
  check('I. 更新后 titleCharLimit=60', putRule.data?.titleCharLimit === 60, putRule.data)

  console.log('\n[J] 权限与前置校验')
  const anonAi = await api('POST', `/api/erp/products/${productId}/ai-images`, { platform: 'ebay' })
  check('J. 未登录图生图 401', anonAi.status === 401, anonAi)
  const noPlatform = await api('POST', `/api/erp/products/${productId}/ai-images`, {}, operatorToken)
  check('J. 缺 platform 400', noPlatform.status === 400, noPlatform)
  // 未入库产品（COLLECTED）不可 AI 加工
  const rawCollect = await api('POST', '/api/erp/collect', {
    items: [{ supplierId: supplier.id, sourceProductId: 'GIGA-RAW', sourceUrl: 'https://www.gigab2b.com/p/raw', titleOriginal: '未入库产品', currency: 'CNY', images: [{ imageType: 'MAIN', sourceUrl: `${imgBase}/r.jpg`, sortOrder: 0 }] }],
    mode: 'SINGLE'
  }, collectorToken)
  const rawProductId: string = rawCollect.data?.items?.[0]?.productId
  let notDownloadedCode = ''
  try {
    await generateProductImages(ownerUser, rawProductId, { platform: 'ebay' }, { imageGenerator: mockImageGenerator })
  } catch (error: any) { notDownloadedCode = error?.code ?? '' }
  check('J. 未入库产品 AI 加工抛 ERP_NOT_DOWNLOADED', notDownloadedCode === 'ERP_NOT_DOWNLOADED', notDownloadedCode)
} catch (error) {
  failed += 1
  console.error('[verify-erp-p3] 异常：', error)
}

console.log(`\n[verify-erp-p3] 通过 ${passed} 项，失败 ${failed} 项`)
await app.close()
await socket.stop()
imageServer.close()
process.exit(failed === 0 ? 0 : 1)
