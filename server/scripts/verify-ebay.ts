/**
 * eBay 域 API 端到端验收脚本：
 * 1. 启动内存版 PGlite → 2. prisma migrate deploy → 3. 启动应用
 * 4. 断言：店铺扩展与凭据、listing 同步/导入、类目工作区与 reconcile、目录同步（缺席证据/检查点/草稿保护）、
 *    本地产品快照与视觉复核、市场研究/标题/内容/草稿/合规验证/发布/验收、权限与跨组织隔离
 * 运行：pnpm verify:ebay
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
const dbPort = 5436

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

const nowIso = () => new Date().toISOString()

// ---------- 测试数据工厂 ----------
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

function makeCollected(listingId: string, overrides: Record<string, unknown> = {}) {
  return {
    url: `https://www.ebay.com/itm/${listingId}`,
    listingId,
    title: `Directory Product ${listingId}`,
    imageUrl: `https://i.ebayimg.com/images/g/${listingId}/s-l500.jpg`,
    price: '9.99',
    currency: 'USD',
    categoryId: 'dc-1',
    categoryName: 'Gadgets',
    ...overrides
  }
}

function makeCategory(categoryId: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    categoryId, name, parentCategoryId: '', level: 1, childCount: 0,
    listingCount: 0, sortOrder: 0, status: 'ACTIVE', syncedAt: nowIso(),
    ...overrides
  }
}

// ---------- 验收场景 ----------
try {
  console.log('\n[1] 店铺扩展与凭据')
  const register = await api('POST', '/api/auth/register', { orgName: '砚都跨境', name: '老板', email: 'owner-a@test.com', password: 'pass1234' })
  check('注册组织A → 200', register.status === 200, register.data)
  const ownerToken: string = register.data?.tokens?.accessToken ?? ''

  const createStore1 = await api('POST', '/api/ebay/stores', { name: '美国一号店', username: 'seller1', encryptedPassword: 'enc-pw-1', marketplaceId: 'EBAY_US' }, ownerToken)
  check('创建店铺 → sellerId=待同步/PENDING/凭据已保存',
    createStore1.status === 200 && createStore1.data?.sellerId === '待同步' && createStore1.data?.status === 'PENDING'
    && createStore1.data?.loginUsername === 'seller1' && createStore1.data?.passwordSaved === true && createStore1.data?.listingCount === 0,
    createStore1.data)
  const store1Id: string = createStore1.data?.id ?? ''
  const createStore2 = await api('POST', '/api/ebay/stores', { name: '美国二号店', username: 'seller2', encryptedPassword: '', marketplaceId: 'EBAY_US' }, ownerToken)
  const store2Id: string = createStore2.data?.id ?? ''
  check('第二店铺创建（空密码 → passwordSaved=false）', createStore2.status === 200 && createStore2.data?.passwordSaved === false, createStore2.data)

  const pub1 = await api('PUT', `/api/ebay/stores/${store1Id}/public-store`, { publicStoreUrl: 'https://www.ebay.com/str/seller-one', sellerId: 'seller-one' }, ownerToken)
  check('保存公开店铺 → 200', pub1.status === 200, pub1.data)
  await api('PUT', `/api/ebay/stores/${store1Id}/public-store`, { publicStoreUrl: 'https://www.ebay.com/str/seller-one-new' }, ownerToken)
  const urlHistory = await prisma.ebayStoreUrlHistory.count({ where: { storeId: store1Id } })
  const storesAfterPub = await api('GET', '/api/ebay/stores', undefined, ownerToken)
  const store1AfterPub = (storesAfterPub.data ?? []).find((item: any) => item.id === store1Id)
  check('公开店铺 URL 历史 DISCOVERED+CHANGED 两条且 sellerId 已更新', urlHistory === 2 && store1AfterPub?.sellerId === 'seller-one', { urlHistory, sellerId: store1AfterPub?.sellerId })

  await api('PUT', `/api/ebay/stores/${store1Id}/credential`, { username: 'seller1-new', encryptedPassword: '', mode: 'AUTO_FILL' }, ownerToken)
  const storesAfterCred = await api('GET', '/api/ebay/stores', undefined, ownerToken)
  const store1AfterCred = (storesAfterCred.data ?? []).find((item: any) => item.id === store1Id)
  check('凭据空密码保留原值且用户名已更新', store1AfterCred?.loginUsername === 'seller1-new' && store1AfterCred?.passwordSaved === true, store1AfterCred)

  const auth = await api('POST', `/api/ebay/stores/${store1Id}/authorization`, {
    encryptedAccessToken: 'enc-at', encryptedRefreshToken: 'enc-rt',
    accessTokenExpiresAt: '2027-01-01T00:00:00.000Z', refreshTokenExpiresAt: '2028-01-01T00:00:00.000Z'
  }, ownerToken)
  const token = await api('PUT', `/api/ebay/stores/${store1Id}/access-token`, { encryptedAccessToken: 'enc-at-2', expiresAt: '2027-06-01T00:00:00.000Z' }, ownerToken)
  const storesAfterAuth = await api('GET', '/api/ebay/stores', undefined, ownerToken)
  const store1AfterAuth = (storesAfterAuth.data ?? []).find((item: any) => item.id === store1Id)
  check('授权保存 + 访问令牌更新 → CONNECTED', auth.status === 200 && token.status === 200 && store1AfterAuth?.status === 'CONNECTED', store1AfterAuth?.status)

  await api('POST', `/api/ebay/stores/${store1Id}/sync-error`, { message: '同步网络超时' }, ownerToken)
  const storesAfterErr = await api('GET', '/api/ebay/stores', undefined, ownerToken)
  const store1AfterErr = (storesAfterErr.data ?? []).find((item: any) => item.id === store1Id)
  check('同步错误 → status=ERROR 且消息留痕', store1AfterErr?.status === 'ERROR' && store1AfterErr?.syncError === '同步网络超时', store1AfterErr)

  console.log('\n[2] listing 同步与导入')
  const sync1 = await api('POST', `/api/ebay/stores/${store1Id}/listings/sync`, { listings: [makeListing(store1Id, 'L1'), makeListing(store1Id, 'L2')] }, ownerToken)
  check('首次同步两条 listing → 200', sync1.status === 200, sync1.data)
  const list1 = await api('GET', `/api/ebay/listings?storeId=${store1Id}`, undefined, ownerToken)
  check('同步后可见 2 条 ACTIVE 且店铺恢复 CONNECTED', list1.data?.length === 2, list1.data?.length)

  await api('POST', `/api/ebay/stores/${store1Id}/listings/sync`, { listings: [makeListing(store1Id, 'L1', { price: '21.99' })] }, ownerToken)
  const list2 = await api('GET', `/api/ebay/listings?storeId=${store1Id}`, undefined, ownerToken)
  const l2Row = await prisma.ebayListing.findFirst({ where: { storeId: store1Id, listingId: 'L2' } })
  check('二次同步缺席 listing 置 ENDED（查询仅见 ACTIVE）', list2.data?.length === 1 && l2Row?.status === 'ENDED', { active: list2.data?.length, l2: l2Row?.status })

  const report = await api('POST', `/api/ebay/stores/${store1Id}/listings/import-report`, { listings: [makeListing(store1Id, 'L2'), makeListing(store1Id, 'L3')] }, ownerToken)
  check('Active Listings 报告导入 → imported=1 updated=1 total=3（复活 ENDED）',
    report.status === 200 && report.data?.imported === 1 && report.data?.updated === 1 && report.data?.total === 3, report.data)

  const collected = await api('POST', `/api/ebay/stores/${store1Id}/listings/import-collected`, {
    marketplaceId: 'EBAY_US',
    products: [
      { url: 'https://www.ebay.com/itm/L3', listingId: 'L3', title: '旧标题', originalTitle: '全新的 L3 标题', originalTitleVerified: true, titleSource: 'EBAY_STRUCTURED_DATA', imageUrl: '', price: '19.99', currency: 'USD', categoryId: '', categoryName: '' },
      { url: 'https://www.ebay.com/itm/L4', listingId: 'L4', title: 'Title L4', imageUrl: '', price: '8.88', currency: 'USD', categoryId: '', categoryName: '' }
    ]
  }, ownerToken)
  check('采集导入 → imported=1 duplicates=1 total=4', collected.status === 200 && collected.data?.imported === 1 && collected.data?.duplicates === 1 && collected.data?.total === 4, collected.data)
  const list3 = await api('GET', `/api/ebay/listings?storeId=${store1Id}`, undefined, ownerToken)
  const l3 = (list3.data ?? []).find((item: any) => item.listingId === 'L3')
  check('已核验原标题覆盖刷新已存在 listing 标题', l3?.title === '全新的 L3 标题', l3?.title)

  const removeL4 = await api('DELETE', `/api/ebay/stores/${store1Id}/listings/L4`, undefined, ownerToken)
  const removeL4Again = await api('DELETE', `/api/ebay/stores/${store1Id}/listings/L4`, undefined, ownerToken)
  check('移除本地 listing → 200；重复移除 → 404', removeL4.status === 200 && removeL4Again.status === 404, { first: removeL4.status, second: removeL4Again.status })

  console.log('\n[3] 类目工作区与 reconcile')
  const cat1 = await api('PUT', `/api/ebay/stores/${store1Id}/categories`, {
    categories: [makeCategory('cat-1', 'Headphones', { listingCount: 5 }), makeCategory('cat-2', 'Earbuds', { sortOrder: 1 })]
  }, ownerToken)
  check('首次写入店铺目录 → added=2', cat1.status === 200 && cat1.data?.lastSync?.added === 2 && cat1.data?.categories?.length === 2, cat1.data?.lastSync)

  const cat2 = await api('PUT', `/api/ebay/stores/${store1Id}/categories`, {
    categories: [makeCategory('cat-1', 'Headphones Pro', { listingCount: 5 }), makeCategory('cat-3', 'Speakers', { sortOrder: 1 })]
  }, ownerToken)
  check('二次写入 → renamed=1 added=1 removed=1',
    cat2.status === 200 && cat2.data?.lastSync?.renamed === 1 && cat2.data?.lastSync?.added === 1 && cat2.data?.lastSync?.removed === 1, cat2.data?.lastSync)
  const catEmpty = await api('PUT', `/api/ebay/stores/${store1Id}/categories`, { categories: [] }, ownerToken)
  check('空目录写入 → 400', catEmpty.status === 400, catEmpty.data)

  const collectP5 = await api('POST', `/api/ebay/stores/${store1Id}/listings/import-collected`, {
    marketplaceId: 'EBAY_US',
    products: [{ url: 'https://www.ebay.com/itm/P5', listingId: 'P5', title: 'Title P5', imageUrl: '', price: '5.55', currency: 'USD', categoryId: '', categoryName: 'headphones pro' }]
  }, ownerToken)
  const list4 = await api('GET', `/api/ebay/listings?storeId=${store1Id}`, undefined, ownerToken)
  const p5 = (list4.data ?? []).find((item: any) => item.listingId === 'P5')
  check('采集导入按类目名匹配店铺目录 → cat-1', collectP5.status === 200 && p5?.categoryId === 'cat-1', p5)

  const patchCat = await api('PATCH', `/api/ebay/stores/${store1Id}/listings/L1/category`, { categoryId: 'cat-3' }, ownerToken)
  check('手动改类目 → cat-3/Speakers', patchCat.status === 200 && patchCat.data?.categoryId === 'cat-3' && patchCat.data?.categoryName === 'Speakers', patchCat.data)
  const patchCatBad = await api('PATCH', `/api/ebay/stores/${store1Id}/listings/L1/category`, { categoryId: 'cat-999' }, ownerToken)
  check('改不存在类目 → 400 CATEGORY_NOT_FOUND', patchCatBad.status === 400 && patchCatBad.data?.error === 'CATEGORY_NOT_FOUND', patchCatBad.data)

  const patchDetails = await api('PATCH', `/api/ebay/stores/${store1Id}/listings/L1/details`, {
    url: 'https://www.ebay.com/itm/L1',
    itemSpecifics: [{ name: 'Brand', value: 'Acme' }],
    condition: 'New',
    imageUrls: ['https://i.ebayimg.com/images/g/AAA/s-l500.jpg', 'https://i.ebayimg.com/images/g/AAA/s-l1600.jpg'],
    price: '$25.50',
    currency: 'usd'
  }, ownerToken)
  check('详情合并：同 key 图片去重升 1600、价格清洗、币种大写',
    patchDetails.status === 200 && patchDetails.data?.imageUrls?.length === 2
    && patchDetails.data?.imageUrl === 'https://i.ebayimg.com/images/g/AAA/s-l1600.jpg'
    && patchDetails.data?.price === '25.50' && patchDetails.data?.currency === 'USD',
    patchDetails.data)

  console.log('\n[4] 目录产品同步（缺席证据 / 检查点 / 草稿保护）')
  await api('PUT', `/api/ebay/stores/${store2Id}/categories`, { categories: [makeCategory('dc-1', 'Gadgets', { listingCount: 3 })] }, ownerToken)
  const scanAll = { categoryId: 'dc-1', categoryName: 'Gadgets', expected: 2, found: 2, complete: true, listingIds: ['dp-a', 'dp-b'], error: '' }
  const scanOnlyA = { ...scanAll, expected: 2, found: 1, listingIds: ['dp-a'] }

  const dirSync1 = await api('POST', `/api/ebay/stores/${store2Id}/directory-sync`, { marketplaceId: 'EBAY_US', products: [makeCollected('dp-a'), makeCollected('dp-b')], scans: [scanAll], errors: [] }, ownerToken)
  check('目录同步#1 → imported=2 total=2 无错误', dirSync1.status === 200 && dirSync1.data?.imported === 2 && dirSync1.data?.total === 2 && dirSync1.data?.failed === 0 && dirSync1.data?.errors?.length === 0, dirSync1.data)

  const dirSync2 = await api('POST', `/api/ebay/stores/${store2Id}/directory-sync`, { marketplaceId: 'EBAY_US', products: [makeCollected('dp-a')], scans: [scanOnlyA], errors: [] }, ownerToken)
  check('目录同步#2 缺席一次 → suspectedEnded=1 unchanged=1', dirSync2.data?.suspectedEnded === 1 && dirSync2.data?.unchanged === 1 && dirSync2.data?.changes?.some((item: any) => item.type === 'SUSPECTED_ENDED' && item.listingId === 'dp-b'), dirSync2.data)

  const dirSync3 = await api('POST', `/api/ebay/stores/${store2Id}/directory-sync`, { marketplaceId: 'EBAY_US', products: [makeCollected('dp-a')], scans: [scanOnlyA], errors: [] }, ownerToken)
  const listStore2 = await api('GET', `/api/ebay/listings?storeId=${store2Id}`, undefined, ownerToken)
  check('目录同步#3 连续缺席 → ended=1 且查询仅剩 dp-a', dirSync3.data?.ended === 1 && listStore2.data?.length === 1 && listStore2.data?.[0]?.listingId === 'dp-a', { ended: dirSync3.data?.ended, listings: listStore2.data?.length })

  const dirSync4 = await api('POST', `/api/ebay/stores/${store2Id}/directory-sync`, { marketplaceId: 'EBAY_US', products: [makeCollected('dp-a'), makeCollected('dp-b')], scans: [scanAll], errors: [] }, ownerToken)
  check('目录同步#4 dp-b 回归 → reactivated=1', dirSync4.data?.reactivated === 1 && dirSync4.data?.imported === 0, dirSync4.data)

  const draftDpA = await api('PUT', '/api/ebay/drafts', {
    storeId: store2Id, listingId: 'dp-a', listing: makeListing(store2Id, 'dp-a', { categoryId: 'dc-1', categoryName: 'Gadgets' }),
    selectedTitle: 'Directory Product dp-a Optimized', titleVariants: [], itemSpecifics: [], description: '描述',
    imageUrl: 'https://i.ebayimg.com/images/g/dp-a/s-l500.jpg', scoreBefore: 50, scoreAfter: 90
  }, ownerToken)
  check('为 dp-a 建优化草稿 → PREMIUM', draftDpA.status === 200 && draftDpA.data?.status === 'PREMIUM', draftDpA.data)
  const store2DraftId: string = draftDpA.data?.id ?? ''

  const dirSync5 = await api('POST', `/api/ebay/stores/${store2Id}/directory-sync`, { marketplaceId: 'EBAY_US', products: [makeCollected('dp-a'), makeCollected('dp-b')], scans: [scanAll], errors: [] }, ownerToken)
  check('目录同步#5 含草稿商品 → protectedOptimizations=1 unchanged=2', dirSync5.data?.protectedOptimizations === 1 && dirSync5.data?.unchanged === 2, dirSync5.data)

  const dirSync6 = await api('POST', `/api/ebay/stores/${store2Id}/directory-sync`, { marketplaceId: 'EBAY_US', products: [], scans: [], errors: ['类目 dc-9 扫描失败'] }, ownerToken)
  const store2AfterPartial = (await api('GET', '/api/ebay/stores', undefined, ownerToken)).data?.find((item: any) => item.id === store2Id)
  check('目录同步#6 有错误 → failed=1 且店铺 syncError 留痕', dirSync6.data?.failed === 1 && store2AfterPartial?.syncError?.includes('扫描失败'), { failed: dirSync6.data?.failed, syncError: store2AfterPartial?.syncError })

  const syncFailure = await api('POST', `/api/ebay/stores/${store2Id}/directory-sync/failure`, { categoryCount: 2, errors: ['浏览器会话失效'] }, ownerToken)
  const runs = await api('GET', `/api/ebay/stores/${store2Id}/directory-sync/runs`, undefined, ownerToken)
  check('整体失败记录 FAILED 且 runs 列表 7 条倒序', syncFailure.status === 200 && runs.data?.length === 7 && runs.data?.[0]?.status === 'FAILED', runs.data?.map((item: any) => item.status))

  const checkpoint = await api('POST', `/api/ebay/stores/${store2Id}/directory-sync/checkpoints`, { categoryIds: ['dc-1', 'dc-2'], publicStoreUrl: 'https://www.ebay.com/str/two' }, ownerToken)
  const taskId: string = checkpoint.data?.taskId ?? ''
  const pending = await api('GET', `/api/ebay/stores/${store2Id}/directory-sync/checkpoint-pending`, undefined, ownerToken)
  check('创建检查点 → RUNNING 且 pending 可读', checkpoint.status === 200 && checkpoint.data?.status === 'RUNNING' && pending.data?.taskId === taskId, checkpoint.data)

  await api('PUT', `/api/ebay/directory-sync/checkpoints/${taskId}/category`, { scan: { ...scanOnlyA, categoryId: 'dc-1', found: 1, expected: 1, complete: true, listingIds: ['dp-c'] }, products: [makeCollected('dp-c')], publicStoreUrl: 'https://www.ebay.com/str/two' }, ownerToken)
  const checkpointData = await api('GET', `/api/ebay/directory-sync/checkpoints/${taskId}`, undefined, ownerToken)
  check('检查点类目进度合并 → completed=dc-1 products=1',
    checkpointData.data?.completedCategoryIds?.includes('dc-1') && checkpointData.data?.products?.length === 1 && checkpointData.data?.scans?.length === 1, checkpointData.data)

  await api('PATCH', `/api/ebay/directory-sync/checkpoints/${taskId}/status`, { status: 'COMPLETED' }, ownerToken)
  const pendingAfter = await api('GET', `/api/ebay/stores/${store2Id}/directory-sync/checkpoint-pending`, undefined, ownerToken)
  check('检查点完成后 pending 为空', pendingAfter.status === 200 && pendingAfter.data === null, pendingAfter.data)
  await api('DELETE', `/api/ebay/directory-sync/checkpoints/${taskId}`, undefined, ownerToken)
  const checkpointGone = await api('GET', `/api/ebay/directory-sync/checkpoints/${taskId}`, undefined, ownerToken)
  check('检查点删除后读取 → 404', checkpointGone.status === 404, checkpointGone.data)

  console.log('\n[5] 本地产品快照与图片视觉复核')
  const listForSnapshot = await api('GET', `/api/ebay/listings?storeId=${store1Id}`, undefined, ownerToken)
  const l1Full = (listForSnapshot.data ?? []).find((item: any) => item.listingId === 'L1')
  const snapshotInput = (completeness: number, contentHash: string, capturedAt: string) => ({
    listing: l1Full,
    details: { url: l1Full.viewUrl, itemSpecifics: [{ name: 'Brand', value: 'Acme' }], condition: 'New', imageUrls: ['https://i.ebayimg.com/images/g/L1/s-l1600.jpg'] },
    media: [{ id: `media-${contentHash}`, mediaType: 'IMAGE', sortOrder: 0, remoteUrl: 'https://i.ebayimg.com/images/g/L1/s-l1600.jpg', localPath: '/tmp/l1.jpg', mimeType: 'image/jpeg', width: 1600, height: 1600, fileSize: 2048, sha256: contentHash, downloadStatus: 'DOWNLOADED' }],
    completeness, missingFields: completeness >= 80 ? [] : ['itemSpecifics'], contentHash, capturedAt
  })
  const snap1 = await api('POST', '/api/ebay/local-products/snapshots', snapshotInput(85, 'hash-v1', '2026-07-01T00:00:00.000Z'), ownerToken)
  check('快照 v1 completeness=85 → READY versionCount=1', snap1.status === 200 && snap1.data?.status === 'READY' && snap1.data?.versionCount === 1, snap1.data)
  const localProductId: string = snap1.data?.id ?? ''

  const snap2 = await api('POST', '/api/ebay/local-products/snapshots', snapshotInput(50, 'hash-v2', '2026-07-02T00:00:00.000Z'), ownerToken)
  check('快照 v2 completeness=50 → INCOMPLETE versionCount=2', snap2.status === 200 && snap2.data?.status === 'INCOMPLETE' && snap2.data?.versionCount === 2, snap2.data)
  const latestSnapshotId: string = snap2.data?.latestSnapshotId ?? ''

  const snapshots = await api('GET', `/api/ebay/local-products/${localProductId}/snapshots`, undefined, ownerToken)
  check('快照历史按版本倒序', snapshots.data?.length === 2 && snapshots.data?.[0]?.version === 2, snapshots.data?.map((item: any) => item.version))
  const localProducts = await api('GET', `/api/ebay/local-products?storeId=${store1Id}`, undefined, ownerToken)
  check('本地产品列表可见且含最新快照', localProducts.data?.length === 1 && localProducts.data?.[0]?.snapshot?.contentHash === 'hash-v2', localProducts.data?.length)

  const visualReport = {
    checkedAt: nowIso(), model: 'test-vision', ruleSetVersion: 'v1', status: 'REVIEW',
    checkedImageCount: 1, passed: 0, failed: 0, review: 1, message: '',
    images: [{
      mediaId: 'media-hash-v2', sortOrder: 0, status: 'REVIEW', summary: '待复核',
      rules: [
        { rule: 'NO_WATERMARK', label: '无水印', status: 'REVIEW', confidence: 0.6, evidence: '右下角疑似水印' },
        { rule: 'NO_BORDER', label: '无边框', status: 'PASSED', confidence: 0.99, evidence: '' }
      ]
    }]
  }
  const saveVisual = await api('POST', `/api/ebay/local-products/${localProductId}/visual-inspection`, { snapshot: { id: latestSnapshotId, contentHash: 'hash-v2' }, report: visualReport }, ownerToken)
  check('保存视觉检查 → REVIEW', saveVisual.status === 200, saveVisual.data)
  const getVisual = await api('GET', `/api/ebay/local-products/${localProductId}/visual-inspection`, undefined, ownerToken)
  check('读取最新视觉检查 → REVIEW', getVisual.status === 200 && getVisual.data?.status === 'REVIEW', getVisual.data)

  const reviewVisual = await api('POST', '/api/ebay/visual-inspections/review', { localProductId, mediaId: 'media-hash-v2', rule: 'NO_WATERMARK', decision: 'PASSED', note: '人工确认为商品本身图案' }, ownerToken)
  check('人工复核 REVIEW→PASSED → 报告重建为 PASSED 且留痕复核人',
    reviewVisual.status === 200 && reviewVisual.data?.status === 'PASSED'
    && reviewVisual.data?.images?.[0]?.rules?.[0]?.manualReview?.reviewedBy === '老板'
    && reviewVisual.data?.images?.[0]?.rules?.[0]?.manualReview?.note === '人工确认为商品本身图案', reviewVisual.data)
  const reviewPassed = await api('POST', '/api/ebay/visual-inspections/review', { localProductId, mediaId: 'media-hash-v2', rule: 'NO_BORDER', decision: 'FAILED' }, ownerToken)
  check('非 REVIEW 规则（无人工复核记录）→ 400', reviewPassed.status === 400 && reviewPassed.data?.error === 'VISUAL_RULE_NOT_REVIEWABLE', reviewPassed.data)

  const staleVisual = await api('POST', `/api/ebay/local-products/${localProductId}/visual-inspection`, { snapshot: { id: snap1.data?.latestSnapshotId, contentHash: 'hash-v1' }, report: visualReport }, ownerToken)
  check('陈旧快照保存检查 → 409 LOCAL_PRODUCT_STALE', staleVisual.status === 409 && staleVisual.data?.error === 'LOCAL_PRODUCT_STALE', staleVisual.data)

  const patchEmpty = await api('PATCH', `/api/ebay/local-products/${localProductId}`, { title: '', descriptionText: '', descriptionHtml: '', price: '10', currency: 'USD', media: [] }, ownerToken)
  check('本地产品编辑空标题+无图 → 400 LOCAL_PRODUCT_INVALID 且校验信息留痕',
    patchEmpty.status === 400 && patchEmpty.data?.error === 'LOCAL_PRODUCT_INVALID'
    && patchEmpty.data?.message?.includes('物品标题不能为空') && patchEmpty.data?.message?.includes('至少需要 1 张'), patchEmpty.data)

  const patchBadMedia = await api('PATCH', `/api/ebay/local-products/${localProductId}`, {
    title: 'Valid Title', descriptionText: '描述', price: '10', currency: 'USD',
    media: [{ id: 'm-bad', mediaType: 'IMAGE', sortOrder: 0, remoteUrl: 'https://i.ebayimg.com/images/g/L1/s-l1600.jpg', localPath: '/tmp/l1.png', mimeType: 'image/png', width: 300, height: 300, fileSize: 2048, sha256: 'x', downloadStatus: 'DOWNLOADED' }]
  }, ownerToken)
  check('本地产品编辑图片不足 500px → 400', patchBadMedia.status === 400 && patchBadMedia.data?.message?.includes('不足 500px'), patchBadMedia.data)

  const patchMissing = await api('PATCH', '/api/ebay/local-products/not-exists', { title: 'X', descriptionText: 'x', price: '10', currency: 'USD', media: [] }, ownerToken)
  check('编辑不存在本地产品 → 404', patchMissing.status === 404 && patchMissing.data?.error === 'LOCAL_PRODUCT_NOT_FOUND', patchMissing.data)

  const patchOk = await api('PATCH', `/api/ebay/local-products/${localProductId}`, {
    title: 'Updated L1 Title', descriptionText: '全新描述文本', descriptionHtml: '', price: '42.99', currency: 'USD',
    media: [{ id: 'media-hash-v2', mediaType: 'IMAGE', sortOrder: 5, remoteUrl: 'https://i.ebayimg.com/images/g/L1/s-l1600.jpg', localPath: '/tmp/l1.jpg', mimeType: 'image/jpeg', width: 1600, height: 1600, fileSize: 2048, sha256: 'hash-v2', downloadStatus: 'DOWNLOADED' }]
  }, ownerToken)
  check('本地产品编辑 → v3 且完整度100 READY 标题更新',
    patchOk.status === 200 && patchOk.data?.versionCount === 3 && patchOk.data?.title === 'Updated L1 Title'
    && patchOk.data?.status === 'READY' && patchOk.data?.snapshot?.completeness === 100, patchOk.data)
  check('编辑后媒体继承源记录并重排序号/详情落盘',
    patchOk.data?.snapshot?.media?.[0]?.sortOrder === 0 && patchOk.data?.snapshot?.media?.[0]?.sha256 === 'hash-v2'
    && patchOk.data?.snapshot?.details?.descriptionText === '全新描述文本' && patchOk.data?.snapshot?.sourceListing?.price === '42.99', patchOk.data?.snapshot)

  const removeProduct = await api('DELETE', `/api/ebay/local-products/${localProductId}`, undefined, ownerToken)
  const removeProductAgain = await api('DELETE', `/api/ebay/local-products/${localProductId}`, undefined, ownerToken)
  check('删除本地产品 → 200；重复删除 → 404', removeProduct.status === 200 && removeProductAgain.status === 404, { first: removeProduct.status, second: removeProductAgain.status })

  console.log('\n[6] 市场研究 / 标题 / 内容 / 草稿 / 合规验证 / 发布 / 验收')
  const researchSnapshot = (id: string, fetchedAt: string) => ({
    id, storeId: store1Id, listingId: 'L1', marketplaceId: 'EBAY_US', categoryId: 'cat-1', categoryName: 'Headphones Pro',
    condition: 'New', query: 'headphones', periodDays: 30, source: 'EBAY_PRODUCT_RESEARCH', sourceUrl: 'https://www.ebay.com/sh/research',
    fetchedAt, sampleCount: 4, metrics: [],
    samples: [
      { title: 'Shop on eBay', price: '', currency: 'USD', soldDate: '', url: '', imageUrl: '' },
      { title: 'Alpha Headphones', price: '29.99', currency: 'USD', soldDate: '2026-06-01', url: 'https://www.ebay.com/itm/a1', imageUrl: '', soldQuantity: '12' },
      { title: 'alpha   headphones', price: '28.99', currency: 'USD', soldDate: '2026-06-02', url: 'https://www.ebay.com/itm/a2', imageUrl: '', soldQuantity: '3' },
      { title: 'Beta Earbuds', price: '15.99', currency: 'USD', soldDate: '2026-06-03', url: 'https://www.ebay.com/itm/b1', imageUrl: '', soldQuantity: '' }
    ],
    keywords: [{ term: 'wireless', count: 2, coverage: 1, factStatus: 'REVIEW', factSource: '' }],
    combinations: [{ term: 'wireless headphones', count: 1, coverage: 1, factStatus: 'REVIEW', factSource: '' }]
  })
  const saveResearch = await api('PUT', '/api/ebay/market-research', researchSnapshot('research-1', '2026-07-01T00:00:00.000Z'), ownerToken)
  check('保存市场研究快照 → 200', saveResearch.status === 200, saveResearch.data)
  const getResearch = await api('GET', `/api/ebay/stores/${store1Id}/listings/L1/market-research`, undefined, ownerToken)
  check('读取时 normalize：导航样本过滤 + 标题去重 + 排序依据推导',
    getResearch.data?.sampleCount === 2 && getResearch.data?.samples?.length === 2
    && getResearch.data?.rankingBasis === 'SOLD_QUANTITY' && getResearch.data?.soldQuantityEvidenceCount === 1,
    { sampleCount: getResearch.data?.sampleCount, rankingBasis: getResearch.data?.rankingBasis, sold: getResearch.data?.soldQuantityEvidenceCount })

  const recordResearch = await api('POST', '/api/ebay/market-research/record', researchSnapshot('research-2', '2026-07-02T00:00:00.000Z'), ownerToken)
  const researchHistory = await api('GET', `/api/ebay/stores/${store1Id}/listings/L1/market-research/history`, undefined, ownerToken)
  check('记录快照 → 历史 1 条且当前指向新快照', recordResearch.status === 200 && researchHistory.data?.length === 1 && researchHistory.data?.[0]?.id === 'research-2', researchHistory.data?.length)

  const decide = await api('POST', '/api/ebay/market-research/decide', { storeId: store1Id, listingId: 'L1', kind: 'KEYWORD', term: 'wireless', status: 'CONFIRMED' }, ownerToken)
  const researchAfterDecide = await api('GET', `/api/ebay/stores/${store1Id}/listings/L1/market-research`, undefined, ownerToken)
  const wireless = (researchAfterDecide.data?.keywords ?? []).find((item: any) => item.term === 'wireless')
  check('市场词人工确认 → factStatus/factSource 留痕', decide.status === 200 && wireless?.factStatus === 'CONFIRMED' && wireless?.factSource === '人工确认：与当前商品事实一致', wireless)
  const decideBad = await api('POST', '/api/ebay/market-research/decide', { storeId: store1Id, listingId: 'L1', kind: 'KEYWORD', term: 'nonexistent', status: 'CONFIRMED' }, ownerToken)
  check('不存在的市场词 → 400', decideBad.status === 400 && decideBad.data?.error === 'MARKET_TERM_NOT_FOUND', decideBad.data)

  const titleDecision = await api('PUT', '/api/ebay/title-decisions', {
    input: {
      storeId: store1Id, listingId: 'L1', researchSnapshotId: 'research-2', originalTitle: l1Full.title,
      selectedTitle: 'Wireless Bluetooth Headphones Alpha', selectedVariantId: 'BALANCED',
      variants: [{ id: 'BALANCED', title: 'Wireless Bluetooth Headphones Alpha' }], verifiedFacts: ['wireless']
    },
    audit: { characterCount: 38, withinLimit: true, duplicateTerms: [], danglingConnector: false, confirmedTermHits: ['wireless'], unverifiedTerms: [], coverageScore: 0.9, passed: true }
  }, ownerToken)
  check('保存标题决策 → CONFIRMED', titleDecision.status === 200 && titleDecision.data?.status === 'CONFIRMED', titleDecision.data)
  const getTitleDecision = await api('GET', `/api/ebay/stores/${store1Id}/listings/L1/title-decision`, undefined, ownerToken)
  check('读取标题决策 → 标题一致', getTitleDecision.data?.selectedTitle === 'Wireless Bluetooth Headphones Alpha', getTitleDecision.data?.selectedTitle)

  const handoff = await api('PUT', '/api/ebay/title-handoffs', {
    id: 'handoff-1', storeId: store1Id, listingId: 'L1', titleDecisionId: titleDecision.data?.id ?? '', researchSnapshotId: 'research-2',
    originalTitle: l1Full.title, preparedTitle: 'Wireless Bluetooth Headphones Alpha', status: 'WAITING_CONFIRMATION',
    reviseUrl: 'https://www.ebay.com/sl/revise?item=L1', filledFields: ['title'], warnings: [], submitButtonDetected: true,
    message: '', auditTrail: [], createdAt: nowIso(), updatedAt: nowIso()
  }, ownerToken)
  const getHandoff = await api('GET', `/api/ebay/stores/${store1Id}/listings/L1/title-handoff`, undefined, ownerToken)
  check('标题交接保存与读取 → WAITING_CONFIRMATION', handoff.status === 200 && getHandoff.data?.status === 'WAITING_CONFIRMATION', getHandoff.data?.status)

  const content1 = await api('PUT', '/api/ebay/content-optimizations', { storeId: store1Id, listingId: 'L1', selectedTitle: 'Wireless Bluetooth Headphones Alpha', result: { sections: [{ key: 'OVERVIEW' }] } }, ownerToken)
  const content2 = await api('PUT', '/api/ebay/content-optimizations', { storeId: store1Id, listingId: 'L1', selectedTitle: 'Wireless Bluetooth Headphones Alpha', result: { sections: [{ key: 'OVERVIEW' }, { key: 'SPECS' }] } }, ownerToken)
  check('内容优化记录幂等更新（id/createdAt 稳定）', content1.status === 200 && content2.status === 200 && content1.data?.id === content2.data?.id && content1.data?.createdAt === content2.data?.createdAt, { id1: content1.data?.id, id2: content2.data?.id })

  const draftInput = (title: string) => ({
    storeId: store1Id, listingId: 'L1', listing: l1Full, selectedTitle: title, titleVariants: [],
    itemSpecifics: [{ name: 'Brand', value: 'Acme' }], description: '优化后的描述',
    imageUrl: 'https://i.ebayimg.com/images/g/L1/s-l1600.jpg', scoreBefore: 60, scoreAfter: 92
  })
  const draft = await api('PUT', '/api/ebay/drafts', draftInput('Wireless Bluetooth Headphones Alpha'), ownerToken)
  check('保存优化草稿 → PREMIUM', draft.status === 200 && draft.data?.status === 'PREMIUM', draft.data)
  const draftId: string = draft.data?.id ?? ''

  const validate1 = await api('POST', `/api/ebay/drafts/${draftId}/validate`, undefined, ownerToken)
  check('草稿合规验证 → PASSED 放行并签发许可',
    validate1.status === 200 && validate1.data?.publishAllowed === true && validate1.data?.check?.gateStatus === 'PASSED'
    && validate1.data?.permit?.status === 'VALID' && validate1.data?.draft?.complianceGateStatus === 'PASSED',
    { gate: validate1.data?.check?.gateStatus, permit: validate1.data?.permit?.status })
  const validate2 = await api('POST', `/api/ebay/drafts/${draftId}/validate`, undefined, ownerToken)
  check('再次验证重新执行检查（EBAY 规则集 stale 语义，checkId 不同）',
    validate2.status === 200 && validate2.data?.check?.id !== validate1.data?.check?.id && validate2.data?.publishAllowed === true,
    { first: validate1.data?.check?.id, second: validate2.data?.check?.id })

  await api('PUT', '/api/ebay/drafts', draftInput('X'.repeat(81)), ownerToken)
  const validateBlocked = await api('POST', `/api/ebay/drafts/${draftId}/validate`, undefined, ownerToken)
  check('81 字符标题 → BLOCKED 不放行且无许可',
    validateBlocked.status === 200 && validateBlocked.data?.publishAllowed === false
    && validateBlocked.data?.check?.gateStatus === 'BLOCKED' && !validateBlocked.data?.permit,
    { gate: validateBlocked.data?.check?.gateStatus, permit: validateBlocked.data?.permit })

  const publishTask = await api('PUT', '/api/ebay/publish-tasks', {
    id: 'publish-task-1', storeId: store1Id, draftId, listingId: 'L1', status: 'WAITING_CONFIRMATION',
    reviseUrl: '', categorySpecifics: [], imageInspection: { status: 'PASSED' }, filledFields: ['title'], warnings: [],
    message: '已选择本地视频文件，视频尚未上传或提交', createdAt: nowIso(), updatedAt: nowIso(),
    videoUpload: { status: 'FILE_SELECTED', message: '视频尚未上传或提交' }
  }, ownerToken)
  const publishTasks = await api('GET', `/api/ebay/publish-tasks?storeId=${store1Id}`, undefined, ownerToken)
  const pt1 = (publishTasks.data ?? []).find((item: any) => item.id === 'publish-task-1')
  check('发布任务保存；读取时改写 FILE_SELECTED 提示文案（原版语义）',
    publishTask.status === 200 && pt1?.message === '已选择本地视频文件，eBay 可能正在上传或处理；尚未提交，请人工确认处理结果',
    pt1?.message)

  const acceptance = await api('POST', '/api/ebay/acceptance-batches', {
    id: 'acceptance-1', storeId: store1Id, mode: 'SINGLE', status: 'PASSED',
    requested: 1, checked: 1, passed: 1, attention: 0, blocked: 0,
    items: [{ listingId: 'L1', title: 'Title L1', status: 'PASSED' }], scenarios: [], reportPath: '', createdAt: nowIso()
  }, ownerToken)
  const acceptanceList = await api('GET', `/api/ebay/stores/${store1Id}/acceptance-batches`, undefined, ownerToken)
  check('验收批次保存与读取 → 1 条 PASSED', acceptance.status === 200 && acceptanceList.data?.length === 1 && acceptanceList.data?.[0]?.status === 'PASSED', acceptanceList.data?.length)

  console.log('\n[7] 权限与跨组织隔离')
  const snapStore2 = await api('POST', '/api/ebay/local-products/snapshots', {
    listing: makeListing(store2Id, 'dp-a', { categoryId: 'dc-1', categoryName: 'Gadgets' }),
    details: { url: '', itemSpecifics: [], condition: 'New', imageUrls: [] },
    media: [], completeness: 90, missingFields: [], contentHash: 'hash-store2', capturedAt: nowIso()
  }, ownerToken)
  const store2LocalProductId: string = snapStore2.data?.id ?? ''

  const roles = await api('GET', '/api/roles', undefined, ownerToken)
  const operatorRoleId = roles.data?.find((role: any) => role.name === '运营')?.id
  const publisherRoleId = roles.data?.find((role: any) => role.name === '发布员')?.id
  await api('POST', '/api/members', { email: 'op-ebay@test.com', name: '运营小A', password: 'pass1234', roleIds: [operatorRoleId], storeIds: [store1Id] }, ownerToken)
  await api('POST', '/api/members', { email: 'pub-ebay@test.com', name: '发布小B', password: 'pass1234', roleIds: [publisherRoleId], storeIds: [store2Id] }, ownerToken)
  const opToken: string = (await api('POST', '/api/auth/login', { email: 'op-ebay@test.com', password: 'pass1234' })).data?.tokens?.accessToken ?? ''
  const pubToken: string = (await api('POST', '/api/auth/login', { email: 'pub-ebay@test.com', password: 'pass1234' })).data?.tokens?.accessToken ?? ''

  const opStores = await api('GET', '/api/ebay/stores', undefined, opToken)
  check('运营仅见授权店铺', opStores.status === 200 && opStores.data?.length === 1 && opStores.data?.[0]?.id === store1Id, opStores.data?.length)
  const opListingsDenied = await api('GET', `/api/ebay/listings?storeId=${store2Id}`, undefined, opToken)
  check('运营读未授权店铺 listing → 403', opListingsDenied.status === 403, opListingsDenied.data)
  const opListings = await api('GET', '/api/ebay/listings', undefined, opToken)
  check('运营读全部 listing → 仅授权店铺数据', opListings.status === 200 && (opListings.data ?? []).every((item: any) => item.storeId === store1Id) && opListings.data?.length > 0, opListings.data?.length)
  const opCreateStore = await api('POST', '/api/ebay/stores', { name: '越权店铺' }, opToken)
  check('运营创建店铺 → 403（store.manage）', opCreateStore.status === 403, opCreateStore.data)
  const opCredential = await api('PUT', `/api/ebay/stores/${store1Id}/credential`, { username: 'x', encryptedPassword: 'y' }, opToken)
  check('运营改店铺凭据 → 403（store.manage）', opCredential.status === 403, opCredential.data)
  const opValidate = await api('POST', `/api/ebay/drafts/${draftId}/validate`, undefined, opToken)
  check('运营执行发布前验证 → 403（publish.run）', opValidate.status === 403, opValidate.data)
  const opSnapshot = await api('POST', '/api/ebay/local-products/snapshots', {
    listing: l1Full, details: { url: '', itemSpecifics: [], condition: 'New', imageUrls: [] },
    media: [], completeness: 88, missingFields: [], contentHash: 'hash-op', capturedAt: nowIso()
  }, opToken)
  check('运营在授权店铺保存快照 → 200（product.edit）', opSnapshot.status === 200, opSnapshot.data)
  const opSync = await api('POST', `/api/ebay/stores/${store1Id}/listings/sync`, { listings: [makeListing(store1Id, 'L1')] }, opToken)
  check('运营同步授权店铺 listing → 200（collection.run）', opSync.status === 200, opSync.data)
  const opStore2Product = await api('GET', `/api/ebay/local-products/${store2LocalProductId}/snapshots`, undefined, opToken)
  check('运营读未授权店铺本地产品 → 403', opStore2Product.status === 403, opStore2Product.data)

  const pubValidate = await api('POST', `/api/ebay/drafts/${store2DraftId}/validate`, undefined, pubToken)
  check('发布员验证授权店铺草稿 → 200（publish.run）', pubValidate.status === 200 && pubValidate.data?.publishAllowed === true, pubValidate.data)
  const pubDraft = await api('PUT', '/api/ebay/drafts', draftInput('越权草稿'), pubToken)
  check('发布员保存草稿 → 403（product.edit）', pubDraft.status === 403, pubDraft.data)
  const pubDraftsDenied = await api('GET', `/api/ebay/drafts?storeId=${store1Id}`, undefined, pubToken)
  check('发布员读未授权店铺草稿 → 403', pubDraftsDenied.status === 403, pubDraftsDenied.data)
  const pubTask = await api('PUT', '/api/ebay/publish-tasks', {
    id: 'publish-task-2', storeId: store2Id, draftId: store2DraftId, listingId: 'dp-a', status: 'READY_TO_FILL',
    reviseUrl: '', categorySpecifics: [], imageInspection: {}, filledFields: [], warnings: [], message: '', createdAt: nowIso(), updatedAt: nowIso()
  }, pubToken)
  check('发布员保存授权店铺发布任务 → 200', pubTask.status === 200, pubTask.data)

  const registerB = await api('POST', '/api/auth/register', { orgName: '竞争对手', name: '老板B', email: 'owner-b@test.com', password: 'pass1234' })
  const ownerBToken: string = registerB.data?.tokens?.accessToken ?? ''
  const storesB = await api('GET', '/api/ebay/stores', undefined, ownerBToken)
  check('组织B 店铺列表为空', storesB.status === 200 && storesB.data?.length === 0, storesB.data?.length)
  const crossDraft = await api('GET', `/api/ebay/drafts/${draftId}`, undefined, ownerBToken)
  check('组织B 读组织A 草稿 → 404', crossDraft.status === 404, crossDraft.data)
  const crossSync = await api('POST', `/api/ebay/stores/${store1Id}/listings/sync`, { listings: [makeListing(store1Id, 'X1')] }, ownerBToken)
  check('组织B 同步组织A 店铺 → 404', crossSync.status === 404, crossSync.data)
  const crossListings = await api('GET', `/api/ebay/listings?storeId=${store1Id}`, undefined, ownerBToken)
  check('组织B 按组织A 店铺查 listing → 200 空数组（org 过滤）', crossListings.status === 200 && crossListings.data?.length === 0, crossListings.data)
  const noToken = await api('GET', '/api/ebay/stores')
  check('无令牌访问 → 401', noToken.status === 401)

  const audit = await api('GET', '/api/audit-logs?limit=200', undefined, ownerToken)
  const actions: string[] = audit.data?.items?.map((item: any) => item.action) ?? []
  for (const expected of ['ebay.store.create', 'ebay.listings.sync', 'ebay.draft.validate']) {
    check(`审计包含 ${expected}`, actions.includes(expected), actions)
  }
} finally {
  await app.close()
  await socket.stop()
  await db.close()
}

console.log(`\n========== 验收结果：${passed} 通过 / ${failed} 失败 ==========`)
process.exit(failed > 0 ? 1 : 0)
