/**
 * 阶段 2 收官验收：采集 → 本地产品 → AI 优化 → 优品仓库 → 发布全流程
 * 在主帐号 + 子帐号（运营/发布员）双角色下互通且隔离。
 * 断言：跨角色业务主线贯通、主帐号全量互通、店铺级授权隔离、跨组织隔离、审计按人留痕
 * （SQLite 导入与媒体签名 URL 分别由 verify:import / verify:media 覆盖）
 * 运行：pnpm verify:full-flow
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
import { fileURLToPath } from 'node:url'

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dbPort = 5441
const mediaDir = mkdtempSync(path.join(tmpdir(), 'verify-full-flow-media-'))

// connection_limit 封顶 Prisma 连接池，避免 Promise.all 突发查询超出 PGlite socket 上限被销毁（P1001）
process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres?sslmode=disable&connection_limit=20`
process.env.JWT_SECRET = 'verify-secret'
process.env.ACCESS_TOKEN_TTL = '1h'
process.env.LOG_LEVEL = 'warn'
process.env.MEDIA_DRIVER = 'local'
process.env.MEDIA_LOCAL_DIR = mediaDir
process.env.MEDIA_SIGNING_SECRET = 'verify-full-flow-media-secret'

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

const nowIso = () => new Date().toISOString()

// ---------- 测试数据工厂 ----------
function makeTaskDraft(overrides: Record<string, unknown> = {}) {
  return {
    selectionMode: 'FORWARD_SUPPLY', marketplacePlatform: 'OZON', marketplaceAccountId: 'ozon-default',
    networkStrategy: 'LOCAL_DIRECT', selectionRulePreset: 'BALANCED', minimumSelectionScore: 65,
    selectionDimensions: ['supplier', 'quality'], requiredSupplierBadges: ['实力商家'],
    maxCategoryTopRank: 100, minimumReturnRate: 0.2, minimumNetworkSales: 100, minimumServiceRating: 4.5,
    collectionMethod: 'KEYWORD', sourceUrl: '', maxPages: 1, supplyPlatforms: ['1688'],
    maxMoq: 10, minSupplierYears: 1, onlyVerifiedSupplier: false,
    gigaSellerIndexFilter: 'ANY', gigaReturnRateFilter: 'ANY',
    name: '主线采集任务', ozonUrl: '', keyword: '耳机', targetQuantity: 50,
    minPrice: 0, maxPrice: 1000, minRating: 4, minReviews: 10, maxProducts: 50,
    collectionProtectionEnabled: false, collectionProtectionMode: 'STANDARD', collectionBatchSize: 10,
    collectionRestMinSeconds: 1, collectionRestMaxSeconds: 2, collectionMaxRunMinutes: 30, collectionAutoPause: false,
    exchangeRate: 0.09, targetMargin: 0.3,
    ...overrides
  }
}

function makeOzonProduct(suffix: string, overrides: Record<string, unknown> = {}) {
  return {
    productId: `oz-${suffix}`, url: `https://www.ozon.ru/product/${suffix}/`, title: `Ozon 商品 ${suffix}`,
    priceText: '1 299 ₽', originalPriceText: '1 599 ₽', imageUrl: `https://ozon.img/${suffix}.jpg`,
    brand: 'BrandX', attributeCount: 5,
    ...overrides
  }
}

function makeSupplyProduct(suffix: string, overrides: Record<string, unknown> = {}) {
  return {
    platformCode: '1688', productId: `pid-${suffix}`, url: `https://detail.1688.com/offer/${suffix}.html`,
    title: `供应商品 ${suffix}`, imageUrl: `https://img.1688.com/${suffix}.jpg`, priceText: '¥12.50',
    salesText: '月销1000', supplierName: '深圳供应商', supplierBadges: ['实力商家'],
    categoryTopRank: 50, returnRate: 0.1, networkSalesCount: 500, serviceRating: 4.8,
    serviceDetails: { delivery: 4.8 }, dataCompleteness: 90, score: 85, grade: 'A',
    dimensionScores: { quality: 85, price: 80 }, recommendation: '推荐', riskFlags: [],
    selected: true,
    ...overrides
  }
}

function makeListing(storeId: string, listingId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `${storeId}:EBAY_US:${listingId}`,
    storeId,
    marketplaceId: 'EBAY_US',
    listingId,
    sku: `SKU-${listingId}`,
    title: `Title ${listingId}`,
    price: '19.99',
    currency: 'USD',
    quantity: 5,
    imageUrl: `https://i.ebayimg.com/images/g/${listingId}/s-l500.jpg`,
    categoryId: '',
    categoryName: '',
    status: 'ACTIVE',
    viewUrl: `https://www.ebay.com/itm/${listingId}`,
    updatedAt: nowIso(),
    ...overrides
  }
}

// ---------- 验收场景 ----------
try {
  console.log('\n[1] 组织与角色搭建')
  const registerA = await api('POST', '/api/auth/register', { orgName: '全流程组织A', name: '老板A', email: 'ff-owner-a@test.com', password: 'pass1234' })
  const ownerToken: string = registerA.data?.tokens?.accessToken ?? ''
  const orgAId: string = registerA.data?.user?.org?.id ?? ''
  check('注册组织A → 200', registerA.status === 200 && Boolean(orgAId), registerA.data)

  const store1 = await api('POST', '/api/ebay/stores', { name: '主线一店', username: 'seller-1', encryptedPassword: 'enc-1', marketplaceId: 'EBAY_US' }, ownerToken)
  const store2 = await api('POST', '/api/ebay/stores', { name: '主线二店', username: 'seller-2', encryptedPassword: '', marketplaceId: 'EBAY_US' }, ownerToken)
  const store1Id: string = store1.data?.id ?? ''
  const store2Id: string = store2.data?.id ?? ''
  check('主帐号创建两家店铺', store1.status === 200 && store2.status === 200, { s1: store1.status, s2: store2.status })

  const roles = await api('GET', '/api/roles', undefined, ownerToken)
  const operatorRoleId = roles.data?.find((role: any) => role.name === '运营')?.id
  const publisherRoleId = roles.data?.find((role: any) => role.name === '发布员')?.id
  const opCreate = await api('POST', '/api/members', { email: 'ff-op@test.com', name: '运营小A', password: 'pass1234', roleIds: [operatorRoleId], storeIds: [store1Id] }, ownerToken)
  const pubCreate = await api('POST', '/api/members', { email: 'ff-pub@test.com', name: '发布小B', password: 'pass1234', roleIds: [publisherRoleId], storeIds: [store2Id] }, ownerToken)
  const opId: string = opCreate.data?.id ?? ''
  const pubId: string = pubCreate.data?.id ?? ''
  const opToken: string = (await api('POST', '/api/auth/login', { email: 'ff-op@test.com', password: 'pass1234' })).data?.tokens?.accessToken ?? ''
  const pubToken: string = (await api('POST', '/api/auth/login', { email: 'ff-pub@test.com', password: 'pass1234' })).data?.tokens?.accessToken ?? ''
  check('运营（授权一店）与发布员（授权二店）登录成功', Boolean(opId) && Boolean(pubId) && Boolean(opToken) && Boolean(pubToken), { opId, pubId })

  const registerB = await api('POST', '/api/auth/register', { orgName: '竞争组织B', name: '老板B', email: 'ff-owner-b@test.com', password: 'pass1234' })
  const ownerBToken: string = registerB.data?.tokens?.accessToken ?? ''
  check('注册组织B → 200', registerB.status === 200 && Boolean(ownerBToken), registerB.data)

  console.log('\n[2] 采集主线（运营）：任务 → 候选 → 比价 → 晋级优品仓库')
  const task = await api('POST', '/api/collection/tasks', makeTaskDraft(), opToken)
  const taskId: string = task.data?.id ?? ''
  check('运营创建采集任务 → 200', task.status === 200 && Boolean(taskId), task.data)

  const saveSupply = await api('POST', `/api/collection/tasks/${taskId}/products/supply`, { products: [makeSupplyProduct('s1')] }, opToken)
  check('运营保存供应候选 → 200', saveSupply.status === 200, saveSupply.data)
  const saveMarket = await api('POST', `/api/collection/tasks/${taskId}/products/market`, { products: [makeOzonProduct('a')] }, opToken)
  check('运营保存市场候选 → 200', saveMarket.status === 200, saveMarket.data)

  const importCmp = await api('POST', '/api/collection/comparisons/import', { product: makeOzonProduct('a') }, opToken)
  const comparisonId: string = importCmp.data?.id ?? ''
  check('运营导入比价 → PRIMARY 主货源已绑定',
    importCmp.status === 200 && importCmp.data?.suppliers?.[0]?.binding === 'PRIMARY', importCmp.data)

  const promote = await api('POST', '/api/collection/comparisons/promote', { id: comparisonId, category: '耳机', subcategory: '蓝牙', tertiaryCategory: '头戴' }, opToken)
  const warehouseProductId: string = promote.data?.warehouseProduct?.id ?? ''
  check('运营晋级比价 → 选品 APPROVED + 优品仓库生成',
    promote.status === 200 && promote.data?.selection?.decision === 'APPROVED' && Boolean(warehouseProductId), promote.data)

  console.log('\n[3] 采集数据：主帐号互通 + 跨组织隔离')
  const ownerCandidates = await api('GET', '/api/collection/candidates', undefined, ownerToken)
  check('主帐号读候选工作区 → 可见运营采集的市场候选',
    ownerCandidates.status === 200 && (ownerCandidates.data?.products ?? []).some((item: any) => item.url.includes('/a/')), ownerCandidates.data?.products?.length)
  const ownerWarehouse = await api('GET', '/api/collection/warehouse/products', undefined, ownerToken)
  check('主帐号读优品仓库 → 可见晋级产品',
    ownerWarehouse.status === 200 && (ownerWarehouse.data ?? []).some((item: any) => item.id === warehouseProductId), ownerWarehouse.data?.length)
  const ownerComparisons = await api('GET', '/api/collection/comparisons', undefined, ownerToken)
  check('主帐号读比价列表 → 可见晋级比价 RECOMMENDED',
    ownerComparisons.status === 200 && (ownerComparisons.data ?? []).some((item: any) => item.id === comparisonId && item.decision === 'RECOMMENDED'), ownerComparisons.data?.length)

  const crossCandidates = await api('GET', '/api/collection/candidates', undefined, ownerBToken)
  const crossWarehouse = await api('GET', '/api/collection/warehouse/products', undefined, ownerBToken)
  const crossComparisons = await api('GET', '/api/collection/comparisons', undefined, ownerBToken)
  check('组织B：候选/优品仓库/比价全部为空',
    (crossCandidates.data?.products ?? []).length === 0 && (crossWarehouse.data ?? []).length === 0 && (crossComparisons.data ?? []).length === 0,
    { candidates: crossCandidates.data?.products?.length, warehouse: crossWarehouse.data?.length, comparisons: crossComparisons.data?.length })

  console.log('\n[4] 本地产品 → AI 优化草稿（运营，一店）')
  const syncL1 = await api('POST', `/api/ebay/stores/${store1Id}/listings/sync`, { listings: [makeListing(store1Id, 'L1')] }, opToken)
  check('运营同步 listing 到授权店铺 → 200', syncL1.status === 200, syncL1.data)
  const listings1 = await api('GET', `/api/ebay/listings?storeId=${store1Id}`, undefined, opToken)
  const l1Full = (listings1.data ?? []).find((item: any) => item.listingId === 'L1')

  const snapshot = await api('POST', '/api/ebay/local-products/snapshots', {
    listing: l1Full,
    details: { url: l1Full.viewUrl, itemSpecifics: [{ name: 'Brand', value: 'Acme' }], condition: 'New', imageUrls: ['https://i.ebayimg.com/images/g/L1/s-l1600.jpg'] },
    media: [{ id: 'ff-media-1', mediaType: 'IMAGE', sortOrder: 0, remoteUrl: 'https://i.ebayimg.com/images/g/L1/s-l1600.jpg', localPath: '/tmp/l1.jpg', mimeType: 'image/jpeg', width: 1600, height: 1600, fileSize: 2048, sha256: 'ff-hash-1', downloadStatus: 'DOWNLOADED' }],
    completeness: 85, missingFields: [], contentHash: 'ff-hash-1', capturedAt: nowIso()
  }, opToken)
  check('运营保存本地产品快照 → READY', snapshot.status === 200 && snapshot.data?.status === 'READY', snapshot.data)

  const draft = await api('PUT', '/api/ebay/drafts', {
    storeId: store1Id, listingId: 'L1', listing: l1Full, selectedTitle: 'Wireless Bluetooth Headphones Alpha',
    titleVariants: [], itemSpecifics: [{ name: 'Brand', value: 'Acme' }], description: '优化后的描述',
    imageUrl: 'https://i.ebayimg.com/images/g/L1/s-l1600.jpg', scoreBefore: 60, scoreAfter: 92
  }, opToken)
  const draftId: string = draft.data?.id ?? ''
  check('运营保存优化草稿 → PREMIUM', draft.status === 200 && draft.data?.status === 'PREMIUM', draft.data)

  const ownerDrafts = await api('GET', `/api/ebay/drafts?storeId=${store1Id}`, undefined, ownerToken)
  check('主帐号读一店草稿 → 互通可见', ownerDrafts.status === 200 && (ownerDrafts.data ?? []).some((item: any) => item.id === draftId), ownerDrafts.data?.length)
  const pubDraftsDenied = await api('GET', `/api/ebay/drafts?storeId=${store1Id}`, undefined, pubToken)
  check('发布员读未授权一店草稿 → 403（店铺级隔离）', pubDraftsDenied.status === 403, pubDraftsDenied.data)
  const crossDraft = await api('GET', `/api/ebay/drafts/${draftId}`, undefined, ownerBToken)
  check('组织B 读组织A 草稿 → 404', crossDraft.status === 404, crossDraft.data)

  console.log('\n[5] 合规验证 → 发布 → 验收（发布员，二店）')
  await api('POST', `/api/ebay/stores/${store2Id}/listings/sync`, { listings: [makeListing(store2Id, 'dp-a')] }, ownerToken)
  const listings2 = await api('GET', `/api/ebay/listings?storeId=${store2Id}`, undefined, ownerToken)
  const dpFull = (listings2.data ?? []).find((item: any) => item.listingId === 'dp-a')
  const draft2 = await api('PUT', '/api/ebay/drafts', {
    storeId: store2Id, listingId: 'dp-a', listing: dpFull, selectedTitle: 'Gadget Alpha Pro Wireless',
    titleVariants: [], itemSpecifics: [], description: '二店草稿',
    imageUrl: 'https://i.ebayimg.com/images/g/dp-a/s-l1600.jpg', scoreBefore: 55, scoreAfter: 88
  }, ownerToken)
  const draftId2: string = draft2.data?.id ?? ''
  check('主帐号代建二店草稿 → 200', draft2.status === 200 && Boolean(draftId2), draft2.data)

  const opValidate = await api('POST', `/api/ebay/drafts/${draftId}/validate`, undefined, opToken)
  check('运营执行发布前验证 → 403（无 publish.run）', opValidate.status === 403, opValidate.data)

  const pubValidate = await api('POST', `/api/ebay/drafts/${draftId2}/validate`, undefined, pubToken)
  check('发布员验证二店草稿 → PASSED 放行并签发许可',
    pubValidate.status === 200 && pubValidate.data?.publishAllowed === true && pubValidate.data?.permit?.status === 'VALID',
    { gate: pubValidate.data?.check?.gateStatus })

  const pubTask = await api('PUT', '/api/ebay/publish-tasks', {
    id: 'ff-publish-1', storeId: store2Id, draftId: draftId2, listingId: 'dp-a', status: 'READY_TO_FILL',
    reviseUrl: '', categorySpecifics: [], imageInspection: {}, filledFields: [], warnings: [],
    message: '', createdAt: nowIso(), updatedAt: nowIso()
  }, pubToken)
  check('发布员保存发布任务 → 200', pubTask.status === 200, pubTask.data)

  const pubAcceptance = await api('POST', '/api/ebay/acceptance-batches', {
    id: 'ff-acceptance-1', storeId: store2Id, mode: 'SINGLE', status: 'PASSED',
    requested: 1, checked: 1, passed: 1, attention: 0, blocked: 0,
    items: [{ listingId: 'dp-a', title: 'Title dp-a', status: 'PASSED' }], scenarios: [], reportPath: '', createdAt: nowIso()
  }, pubToken)
  check('发布员保存验收批次 → PASSED', pubAcceptance.status === 200, pubAcceptance.data)

  const ownerPublishTasks = await api('GET', `/api/ebay/publish-tasks?storeId=${store2Id}`, undefined, ownerToken)
  check('主帐号读二店发布任务 → 互通可见',
    ownerPublishTasks.status === 200 && (ownerPublishTasks.data ?? []).some((item: any) => item.id === 'ff-publish-1'), ownerPublishTasks.data?.length)
  const crossPublishTasks = await api('GET', `/api/ebay/publish-tasks?storeId=${store2Id}`, undefined, ownerBToken)
  check('组织B 读组织A 发布任务 → 空数组', crossPublishTasks.status === 200 && (crossPublishTasks.data ?? []).length === 0, crossPublishTasks.data?.length)

  console.log('\n[6] 合规检查（运营执行，发布员受限）')
  const complianceCheck = await api('POST', '/api/compliance/checks', {
    productId: 'ff-p1', platform: 'EBAY', marketplaceSite: 'EBAY_US', country: 'US',
    title: 'Wireless Bluetooth Headphones', imageUrl: 'https://i.ebayimg.com/images/g/abc/s-l500.jpg'
  }, opToken)
  check('运营执行合规检查 → PASSED', complianceCheck.status === 200 && complianceCheck.data?.gateStatus === 'PASSED', complianceCheck.data)
  const workspace = await api('GET', '/api/compliance/workspace', undefined, ownerToken)
  const ffPermits = (workspace.data?.permits ?? []).filter((item: any) => item.productId === 'ff-p1' && item.status === 'VALID')
  check('主帐号工作区可见许可（互通）', ffPermits.length === 1, workspace.data?.permits?.length)
  const pubCheck = await api('POST', '/api/compliance/checks', {
    productId: 'ff-p2', platform: 'EBAY', marketplaceSite: 'EBAY_US', country: 'US', title: 'T', imageUrl: 'u'
  }, pubToken)
  check('发布员执行合规检查 → 403（无 compliance.manage）', pubCheck.status === 403, pubCheck.data)
  const crossLatest = await api('GET', '/api/compliance/checks/latest/ff-p1', undefined, ownerBToken)
  check('组织B 读组织A 检查结论 → null', crossLatest.status === 200 && crossLatest.data === null, crossLatest.data)

  console.log('\n[7] 媒体：组织内共享 + 跨组织隔离')
  const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, ...Buffer.from('full-flow-media', 'utf8')])
  const upload = await api('POST', '/api/media/uploads', { fileName: '主图.png', contentType: 'image/png', dataBase64: PNG_BYTES.toString('base64'), prefix: 'products' }, opToken)
  const mediaKey: string = upload.data?.key ?? ''
  check('运营上传图片 → 200', upload.status === 200 && mediaKey.startsWith(`org-${orgAId}/`), upload.data)
  const pubSign = await api('POST', '/api/media/sign-download', { key: mediaKey }, pubToken)
  check('发布员签下载 URL（组织内共享）→ 200', pubSign.status === 200 && Boolean(pubSign.data?.url), pubSign.data)
  const ownerDownload = await fetch(base + upload.data.url)
  check('主帐号按签名 URL 下载 → 字节一致',
    ownerDownload.status === 200 && Buffer.from(await ownerDownload.arrayBuffer()).equals(PNG_BYTES), ownerDownload.status)
  const crossSign = await api('POST', '/api/media/sign-download', { key: mediaKey }, ownerBToken)
  check('组织B 签组织A 媒体 URL → 403', crossSign.status === 403, crossSign.data)

  console.log('\n[8] 审计按人留痕（主帐号专属）')
  const audit = await api('GET', '/api/audit-logs?limit=200', undefined, ownerToken)
  const items: any[] = audit.data?.items ?? []
  const actions: string[] = items.map(item => item.action)
  const expectedActions = [
    'collection.task.create', 'collection.comparison.promote', 'ebay.listings.sync', 'ebay.draft.save',
    'ebay.draft.validate', 'ebay.acceptance.save', 'compliance.check.run', 'media.upload'
  ]
  check('审计覆盖全流程 8 类关键操作', expectedActions.every(action => actions.includes(action)), actions)
  const opActions = items.filter(item => item.user?.id === opId).map(item => item.action)
  const pubActions = items.filter(item => item.user?.id === pubId).map(item => item.action)
  check('审计按操作人留痕：运营的采集/编辑动作',
    ['collection.task.create', 'collection.comparison.promote', 'ebay.draft.save', 'compliance.check.run', 'media.upload'].every(action => opActions.includes(action)),
    opActions)
  check('审计按操作人留痕：发布员的验证/发布/验收动作',
    ['ebay.draft.validate', 'ebay.acceptance.save'].every(action => pubActions.includes(action)),
    pubActions)
  const auditB = await api('GET', '/api/audit-logs?limit=200', undefined, ownerBToken)
  const actionsB: string[] = (auditB.data?.items ?? []).map((item: any) => item.action)
  check('组织B 审计不含组织A 操作', auditB.status === 200 && !actionsB.some(action => expectedActions.includes(action)), actionsB)
  const opAudit = await api('GET', '/api/audit-logs', undefined, opToken)
  check('运营查审计日志 → 403（主帐号专属）', opAudit.status === 403, opAudit.data)
} finally {
  await app.close()
  await socket.stop()
  await db.close()
  rmSync(mediaDir, { recursive: true, force: true })
}

console.log(`\n========== 验收结果：${passed} 通过 / ${failed} 失败 ==========`)
process.exit(failed > 0 ? 1 : 0)
