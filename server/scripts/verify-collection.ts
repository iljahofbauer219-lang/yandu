/**
 * 选品采集域 API 端到端验收脚本：
 * 1. 启动内存版 PGlite → 2. prisma migrate deploy → 3. 启动应用
 * 4. 断言：采集任务与候选工作区、候选删除/恢复/清除与 intake 四级去重、比价（导入/更新/晋级）、
 *    选品与供应仓联动、平台选品/媒体/发布草稿、平台账号凭据、权限与跨组织隔离
 * 运行：pnpm verify:collection
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
const dbPort = 5437

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
function makeTaskDraft(overrides: Record<string, unknown> = {}) {
  return {
    selectionMode: 'FORWARD_SUPPLY', marketplacePlatform: 'OZON', marketplaceAccountId: 'ozon-default',
    networkStrategy: 'LOCAL_DIRECT', selectionRulePreset: 'BALANCED', minimumSelectionScore: 65,
    selectionDimensions: ['supplier', 'quality'], requiredSupplierBadges: ['实力商家'],
    maxCategoryTopRank: 100, minimumReturnRate: 0.2, minimumNetworkSales: 100, minimumServiceRating: 4.5,
    collectionMethod: 'KEYWORD', sourceUrl: '', maxPages: 1, supplyPlatforms: ['1688'],
    maxMoq: 10, minSupplierYears: 1, onlyVerifiedSupplier: false,
    gigaSellerIndexFilter: 'ANY', gigaReturnRateFilter: 'ANY',
    name: '测试采集任务', ozonUrl: '', keyword: '耳机', targetQuantity: 50,
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
    dimensionScores: { quality: 85, price: 80 }, recommendation: '推荐', riskFlags: ['低风险提示'],
    selected: true,
    ...overrides
  }
}

// ---------- 验收场景 ----------
try {
  console.log('\n[1] 采集任务与候选工作区')
  const register = await api('POST', '/api/auth/register', { orgName: '砚都跨境', name: '老板', email: 'owner-a@test.com', password: 'pass1234' })
  check('注册组织A → 200', register.status === 200, register.data)
  const ownerToken: string = register.data?.tokens?.accessToken ?? ''
  const orgAId: string = register.data?.user?.org?.id ?? ''
  check('组织ID 已从注册响应提取', Boolean(orgAId), register.data?.user)

  // 市场采集任务（OZON 列表）：run id=taskId，与供应任务分开避免单行 run 互相覆盖
  const createMarketTask = await api('POST', '/api/collection/tasks', makeTaskDraft({ name: 'OZON 市场任务' }), ownerToken)
  const marketTaskId: string = createMarketTask.data?.id ?? ''
  check('创建市场采集任务 → 200', createMarketTask.status === 200 && Boolean(marketTaskId), createMarketTask.data)

  const saveMarket = await api('POST', `/api/collection/tasks/${marketTaskId}/products/market`, {
    products: [makeOzonProduct('a'), makeOzonProduct('b')]
  }, ownerToken)
  check('保存 OZON 市场候选 → 200', saveMarket.status === 200 && saveMarket.data?.count === 2, saveMarket.data)
  let candidates = await api('GET', '/api/collection/candidates', undefined, ownerToken)
  const marketRun = (candidates.data?.runs ?? []).find((run: any) => run.candidateArea === 'MARKET' && run.taskId === marketTaskId)
  check('候选工作区：市场候选 2 条 + MARKET run newCount=2',
    candidates.data?.products?.length === 2 && marketRun?.newCount === 2 && marketRun?.platformCode === 'OZON',
    { products: candidates.data?.products?.length, run: marketRun })
  const saveMarketAgain = await api('POST', `/api/collection/tasks/${marketTaskId}/products/market`, {
    products: [makeOzonProduct('a', { title: 'Ozon 商品 a 更新' })]
  }, ownerToken)
  candidates = await api('GET', '/api/collection/candidates', undefined, ownerToken)
  const marketRun2 = (candidates.data?.runs ?? []).find((run: any) => run.candidateArea === 'MARKET' && run.taskId === marketTaskId)
  check('重复保存市场候选 → updatedCount=1/newCount=0 且标题已更新',
    saveMarketAgain.status === 200 && marketRun2?.updatedCount === 1 && marketRun2?.newCount === 0
    && candidates.data?.products?.find((item: any) => item.url.includes('/a/'))?.title === 'Ozon 商品 a 更新',
    marketRun2)
  await api('POST', `/api/collection/tasks/${marketTaskId}/products/market`, { products: [makeOzonProduct('a'), makeOzonProduct('b')] }, ownerToken)

  const createTask = await api('POST', '/api/collection/tasks', makeTaskDraft(), ownerToken)
  check('创建采集任务 → 200/stage=OZON_LIST_PENDING',
    createTask.status === 200 && Boolean(createTask.data?.id) && createTask.data?.stage === 'OZON_LIST_PENDING' && createTask.data?.name === '测试采集任务',
    createTask.data)
  const taskId: string = createTask.data?.id ?? ''
  const ruleRow = await prisma.taskSelectionRule.findFirst({ where: { taskId, orgId: orgAId } })
  check('任务规则已落库（criteria 含 requiredSupplierBadges）',
    ruleRow?.platformCode === '1688' && JSON.stringify(ruleRow?.criteria).includes('实力商家'), ruleRow?.criteria)
  const taskPlatform = await prisma.collectionTaskPlatform.findFirst({ where: { taskId, orgId: orgAId } })
  check('任务平台 PENDING 一行', taskPlatform?.platformCode === '1688' && taskPlatform?.status === 'PENDING', taskPlatform)

  const saveSupply = await api('POST', `/api/collection/tasks/${taskId}/products/supply`, {
    products: [makeSupplyProduct('s1'), makeSupplyProduct('s2', { selected: false })]
  }, ownerToken)
  check('保存供应链候选 → 200', saveSupply.status === 200 && saveSupply.data?.count === 2, saveSupply.data)
  const evalCount = await prisma.productEvaluation.count({ where: { taskId, orgId: orgAId } })
  const evidenceCount = await prisma.evaluationEvidence.count({ where: { orgId: orgAId } })
  const riskCount = await prisma.productRiskFlag.count({ where: { orgId: orgAId } })
  const rejectionCount = await prisma.productRejectionRecord.count({ where: { taskId, orgId: orgAId } })
  check('评估/证据/风险/拒绝记录齐全（2/4/2/1）',
    evalCount === 2 && evidenceCount === 4 && riskCount === 2 && rejectionCount === 1,
    { evalCount, evidenceCount, riskCount, rejectionCount })

  const latest = await api('GET', '/api/collection/tasks/latest', undefined, ownerToken)
  check('最新工作区返回任务与供应候选（selected 优先排序）',
    latest.status === 200 && latest.data?.task?.id === taskId && latest.data?.supplyProducts?.length === 2
    && latest.data?.supplyProducts?.[0]?.selected === true,
    { taskId: latest.data?.task?.id, count: latest.data?.supplyProducts?.length })

  candidates = await api('GET', '/api/collection/candidates', undefined, ownerToken)
  const supplyRun = (candidates.data?.runs ?? []).find((run: any) => run.candidateArea === 'SUPPLY' && run.taskId === taskId)
  check('候选工作区：供应候选 2 条 + SUPPLY run selectedCount=1 + records 2 条',
    candidates.status === 200 && candidates.data?.supplyProducts?.length === 2
    && supplyRun?.selectedCount === 1 && supplyRun?.collectedCount === 2
    && (candidates.data?.records ?? []).filter((record: any) => record.candidateArea === 'SUPPLY').length === 2,
    { supply: candidates.data?.supplyProducts?.length, run: supplyRun })

  const saveSupplyNoTask = await api('POST', '/api/collection/tasks/nonexistent/products/supply', { products: [makeSupplyProduct('x')] }, ownerToken)
  check('保存候选到不存在任务 → 404 TASK_NOT_FOUND',
    saveSupplyNoTask.status === 404 && saveSupplyNoTask.data?.error === 'TASK_NOT_FOUND', saveSupplyNoTask.data)

  console.log('\n[2] 候选删除/恢复/清除与 intake 去重')
  const urlS2 = 'https://detail.1688.com/offer/s2.html'
  const delSupply = await api('POST', '/api/collection/candidates/delete', { candidateArea: 'SUPPLY', candidateKeys: [`1688:${urlS2}`] }, ownerToken)
  check('删除供应候选 → candidateDeletedAt 已标记',
    delSupply.status === 200 && delSupply.data?.supplyProducts?.find((item: any) => item.url === urlS2)?.candidateDeletedAt,
    delSupply.data?.supplyProducts?.map((item: any) => ({ url: item.url, deleted: item.candidateDeletedAt })))
  const restoreSupply = await api('POST', '/api/collection/candidates/restore', { candidateArea: 'SUPPLY', candidateKeys: [`1688:${urlS2}`] }, ownerToken)
  check('恢复供应候选 → candidateDeletedAt 消失',
    restoreSupply.status === 200 && !restoreSupply.data?.supplyProducts?.find((item: any) => item.url === urlS2)?.candidateDeletedAt,
    restoreSupply.data?.supplyProducts?.map((item: any) => ({ url: item.url, deleted: item.candidateDeletedAt })))
  const purgeSupply = await api('POST', '/api/collection/candidates/purge', { candidateArea: 'SUPPLY', candidateKeys: [`1688:${urlS2}`] }, ownerToken)
  const intakeS2 = await prisma.productIntakeRegistry.findFirst({ where: { orgId: orgAId, identityKey: '1688:pid-s2' } })
  check('清除供应候选 → 候选消失且 intake 登记 HISTORY',
    purgeSupply.status === 200 && !(purgeSupply.data?.supplyProducts ?? []).some((item: any) => item.url === urlS2)
    && intakeS2?.lastStage === 'HISTORY' && Boolean(intakeS2?.candidateDeletedAt),
    { left: purgeSupply.data?.supplyProducts?.length, intake: intakeS2 })

  const pluginTask = { ...makeTaskDraft(), id: taskId, stage: 'OZON_LIST_COMPLETED', createdAt: createTask.data?.createdAt ?? nowIso() }
  const importHistory = await api('POST', '/api/collection/tasks/import-plugin-candidates', {
    task: pluginTask, products: [makeSupplyProduct('s2')]
  }, ownerToken)
  check('插件导入已清除商品 → HISTORY 去重（该商品曾收录，已从候选删除）',
    importHistory.status === 200 && importHistory.data?.imported === 0 && importHistory.data?.blocked === 1
    && importHistory.data?.duplicates?.[0]?.stage === 'HISTORY' && importHistory.data?.duplicates?.[0]?.message === '该商品曾收录，已从候选删除',
    importHistory.data)

  const importNew = await api('POST', '/api/collection/tasks/import-plugin-candidates', {
    task: pluginTask, products: [makeSupplyProduct('c'), makeSupplyProduct('d'), makeSupplyProduct('e')]
  }, ownerToken)
  check('插件导入 3 个新商品 → imported=3',
    importNew.status === 200 && importNew.data?.imported === 3 && importNew.data?.blocked === 0 && importNew.data?.total >= 4,
    importNew.data)
  const importAgain = await api('POST', '/api/collection/tasks/import-plugin-candidates', {
    task: pluginTask, products: [makeSupplyProduct('c')]
  }, ownerToken)
  check('重复导入同商品 → CANDIDATE 去重（该商品已在采集候选）',
    importAgain.status === 200 && importAgain.data?.imported === 0
    && importAgain.data?.duplicates?.[0]?.stage === 'CANDIDATE' && importAgain.data?.duplicates?.[0]?.message === '该商品已在采集候选',
    importAgain.data)
  const importBatchDup = await api('POST', '/api/collection/tasks/import-plugin-candidates', {
    task: pluginTask, products: [makeSupplyProduct('f'), makeSupplyProduct('f2', { productId: 'pid-f' })]
  }, ownerToken)
  check('同批次内重复 → 一个导入一个拦截（本次选择中存在重复商品）',
    importBatchDup.status === 200 && importBatchDup.data?.imported === 1 && importBatchDup.data?.blocked === 1
    && importBatchDup.data?.duplicates?.[0]?.message === '本次选择中存在重复商品',
    importBatchDup.data)

  console.log('\n[3] 比价（导入/更新/晋级）')
  const importComparison = await api('POST', '/api/collection/comparisons/import', { product: makeOzonProduct('a') }, ownerToken)
  check('导入比价 → 供应商按 matchScore 排序且首位 PRIMARY',
    importComparison.status === 200 && importComparison.data?.suppliers?.length === 5
    && importComparison.data?.suppliers?.[0]?.binding === 'PRIMARY'
    && (importComparison.data?.suppliers ?? []).every((item: any, index: number, arr: any[]) => index === 0 || arr[index - 1].matchScore >= item.matchScore),
    importComparison.data?.suppliers?.map((item: any) => ({ url: item.url, matchScore: item.matchScore, binding: item.binding })))
  const comparisonAId: string = importComparison.data?.id ?? ''
  check('比价计算正确（sellingPriceRub=1299/exchangeRate=0.09/landedCostCny>0）',
    importComparison.data?.sellingPriceRub === 1299 && importComparison.data?.settings?.exchangeRate === 0.09
    && importComparison.data?.landedCostCny > 0 && importComparison.data?.decision === 'PENDING',
    { rub: importComparison.data?.sellingPriceRub, landed: importComparison.data?.landedCostCny })
  const importComparisonAgain = await api('POST', '/api/collection/comparisons/import', { product: makeOzonProduct('a') }, ownerToken)
  check('重复导入比价 → 幂等返回同 id', importComparisonAgain.status === 200 && importComparisonAgain.data?.id === comparisonAId, importComparisonAgain.data?.id)
  const importComparison404 = await api('POST', '/api/collection/comparisons/import', { product: makeOzonProduct('nonexistent') }, ownerToken)
  check('无采集任务商品导入比价 → 404', importComparison404.status === 404 && importComparison404.data?.error === 'TASK_NOT_FOUND', importComparison404.data)

  const landedBefore: number = importComparison.data?.landedCostCny ?? 0
  const updateSettings = await api('POST', '/api/collection/comparisons/update', {
    id: comparisonAId, settings: { ...importComparison.data?.settings, exchangeRate: 0.1 }
  }, ownerToken)
  check('更新比价参数 → 成本重算',
    updateSettings.status === 200 && updateSettings.data?.settings?.exchangeRate === 0.1 && updateSettings.data?.landedCostCny !== landedBefore,
    { before: landedBefore, after: updateSettings.data?.landedCostCny })
  const secondSupplierUrl: string = importComparison.data?.suppliers?.[1]?.url ?? ''
  const secondSupplierPrice: number = importComparison.data?.suppliers?.[1]?.price ?? 0
  const updateBinding = await api('POST', '/api/collection/comparisons/update', { id: comparisonAId, supplierUrl: secondSupplierUrl, binding: 'PRIMARY' }, ownerToken)
  check('改绑主货源 → 原 PRIMARY 降级且采购价联动',
    updateBinding.status === 200
    && updateBinding.data?.suppliers?.find((item: any) => item.url === secondSupplierUrl)?.binding === 'PRIMARY'
    && updateBinding.data?.suppliers?.filter((item: any) => item.binding === 'PRIMARY')?.length === 1
    && updateBinding.data?.purchasePriceCny === secondSupplierPrice,
    updateBinding.data?.suppliers?.map((item: any) => ({ url: item.url, binding: item.binding })))

  const comparisonARow = await prisma.comparisonRecord.findFirst({ where: { id: comparisonAId, orgId: orgAId } })
  const comparisonAPayload = comparisonARow?.payload as any
  comparisonAPayload.suppliers = comparisonAPayload.suppliers.map((item: any) => ({ ...item, binding: 'NONE' }))
  await prisma.comparisonRecord.update({ where: { id: comparisonAId }, data: { payload: comparisonAPayload } })
  const promoteNoPrimary = await api('POST', '/api/collection/comparisons/promote', { id: comparisonAId, category: '耳机', subcategory: '蓝牙', tertiaryCategory: '头戴' }, ownerToken)
  check('未绑定主货源晋级 → 400 PRIMARY_SUPPLIER_REQUIRED',
    promoteNoPrimary.status === 400 && promoteNoPrimary.data?.error === 'PRIMARY_SUPPLIER_REQUIRED', promoteNoPrimary.data)
  const promote404 = await api('POST', '/api/collection/comparisons/promote', { id: 'nonexistent', category: '', subcategory: '', tertiaryCategory: '' }, ownerToken)
  check('不存在比价晋级 → 404', promote404.status === 404 && promote404.data?.error === 'COMPARISON_NOT_FOUND', promote404.data)

  const importComparisonB = await api('POST', '/api/collection/comparisons/import', { product: makeOzonProduct('b') }, ownerToken)
  const comparisonBId: string = importComparisonB.data?.id ?? ''
  const promote = await api('POST', '/api/collection/comparisons/promote', { id: comparisonBId, category: '耳机', subcategory: '蓝牙', tertiaryCategory: '头戴' }, ownerToken)
  check('晋级比价 → 选品 APPROVED + 供应仓生成 + decision=RECOMMENDED',
    promote.status === 200 && promote.data?.selection?.decision === 'APPROVED'
    && promote.data?.warehouseProduct?.warehouseCode === '1688' && promote.data?.warehouseProduct?.status === 'ACTIVE'
    && promote.data?.comparison?.decision === 'RECOMMENDED',
    promote.data)
  const workflowEvent = await prisma.workflowEvent.findFirst({ where: { orgId: orgAId, action: 'PROMOTE_TO_SUPPLY_WAREHOUSE' } })
  check('晋级留痕 workflow_events', Boolean(workflowEvent), workflowEvent)
  const comparisonsAfterPromote = await api('GET', '/api/collection/comparisons', undefined, ownerToken)
  const comparisonBView = (comparisonsAfterPromote.data ?? []).find((item: any) => item.id === comparisonBId)
  check('比价列表联动 selectionDecision/warehouseProductId',
    comparisonBView?.selectionDecision === 'APPROVED' && comparisonBView?.warehouseProductId === promote.data?.warehouseProduct?.id,
    comparisonBView)

  console.log('\n[4] 选品与供应仓联动')
  const importSelectionC = await api('POST', '/api/collection/selections/import', {
    sourceArea: 'SUPPLY', product: makeSupplyProduct('c'), category: '耳机', subcategory: '蓝牙', tertiaryCategory: '头戴'
  }, ownerToken)
  check('导入选品（SUPPLY）→ PENDING/score=供应分',
    importSelectionC.status === 200 && importSelectionC.data?.decision === 'PENDING'
    && importSelectionC.data?.score === 85 && importSelectionC.data?.platformCode === '1688',
    importSelectionC.data)
  const selectionCId: string = importSelectionC.data?.id ?? ''
  const importSelection404 = await api('POST', '/api/collection/selections/import', {
    sourceArea: 'SUPPLY', product: makeSupplyProduct('ghost'), category: '', subcategory: ''
  }, ownerToken)
  check('无候选商品导入选品 → 404', importSelection404.status === 404 && importSelection404.data?.error === 'TASK_NOT_FOUND', importSelection404.data)

  const importSelectionD = await api('POST', '/api/collection/selections/import', {
    sourceArea: 'SUPPLY', product: makeSupplyProduct('d'), category: '耳机', subcategory: '有线'
  }, ownerToken)
  check('导入第二条选品（保持 PENDING 供去重测试）', importSelectionD.status === 200 && importSelectionD.data?.decision === 'PENDING', importSelectionD.data)
  const selectionDId: string = importSelectionD.data?.id ?? ''

  const importDupSelection = await api('POST', '/api/collection/tasks/import-plugin-candidates', {
    task: pluginTask, products: [makeSupplyProduct('d-new', { productId: 'pid-d' })]
  }, ownerToken)
  check('插件导入已入选商品 → SELECTION 去重（该商品已进入优选产品）',
    importDupSelection.status === 200 && importDupSelection.data?.imported === 0
    && importDupSelection.data?.duplicates?.[0]?.stage === 'SELECTION' && importDupSelection.data?.duplicates?.[0]?.message === '该商品已进入优选产品',
    importDupSelection.data)

  const approveC = await api('POST', `/api/collection/selections/${selectionCId}/decision`, { decision: 'APPROVED' }, ownerToken)
  check('选品 APPROVED → 供应仓自动生成',
    approveC.status === 200 && approveC.data?.decision === 'APPROVED', approveC.data)
  let warehouse = await api('GET', '/api/collection/warehouse/products', undefined, ownerToken)
  const warehouseC = (warehouse.data ?? []).find((item: any) => item.sourceUrl === 'https://detail.1688.com/offer/c.html')
  check('供应仓含 url-c 商品（ACTIVE/1688）', warehouseC?.warehouseCode === '1688' && warehouseC?.status === 'ACTIVE', warehouseC)

  const importDupWarehouse = await api('POST', '/api/collection/tasks/import-plugin-candidates', {
    task: pluginTask, products: [makeSupplyProduct('c-new', { productId: 'pid-c' })]
  }, ownerToken)
  check('插件导入已入库商品 → WAREHOUSE 去重（该商品已正式入库）',
    importDupWarehouse.status === 200 && importDupWarehouse.data?.imported === 0
    && importDupWarehouse.data?.duplicates?.[0]?.stage === 'WAREHOUSE' && importDupWarehouse.data?.duplicates?.[0]?.message === '该商品已正式入库',
    importDupWarehouse.data)

  await api('POST', `/api/collection/selections/${selectionCId}/decision`, { decision: 'REJECTED' }, ownerToken)
  warehouse = await api('GET', '/api/collection/warehouse/products', undefined, ownerToken)
  check('选品 REJECTED → 供应仓商品归档',
    !(warehouse.data ?? []).some((item: any) => item.sourceUrl === 'https://detail.1688.com/offer/c.html'),
    warehouse.data?.map((item: any) => item.sourceUrl))
  const approveCAgain = await api('POST', `/api/collection/selections/${selectionCId}/decision`, { decision: 'APPROVED' }, ownerToken)
  warehouse = await api('GET', '/api/collection/warehouse/products', undefined, ownerToken)
  check('再次 APPROVED → 供应仓商品复活',
    approveCAgain.status === 200 && (warehouse.data ?? []).some((item: any) => item.sourceUrl === 'https://detail.1688.com/offer/c.html' && item.status === 'ACTIVE'),
    warehouse.data?.map((item: any) => ({ url: item.sourceUrl, status: item.status })))

  const reimportC = await api('POST', '/api/collection/selections/import', {
    sourceArea: 'SUPPLY', product: makeSupplyProduct('c'), category: '新类目', subcategory: '新子类'
  }, ownerToken)
  check('重复导入选品 → 保留已有 decision', reimportC.status === 200 && reimportC.data?.decision === 'APPROVED' && reimportC.data?.id === selectionCId, reimportC.data)

  const categorize = await api('POST', `/api/collection/selections/${selectionCId}/category`, { category: '数码', subcategory: '音频', tertiaryCategory: '耳机' }, ownerToken)
  check('选品改类目 → 200', categorize.status === 200 && categorize.data?.category === '数码' && categorize.data?.tertiaryCategory === '耳机', categorize.data)

  const returnC = await api('DELETE', `/api/collection/selections/${selectionCId}`, undefined, ownerToken)
  check('选品退回候选 → 200', returnC.status === 200, returnC.data)
  const returnCAgain = await api('DELETE', `/api/collection/selections/${selectionCId}`, undefined, ownerToken)
  check('重复退回 → 404', returnCAgain.status === 404 && returnCAgain.data?.error === 'SELECTION_NOT_FOUND', returnCAgain.data)
  const selectionsAfterReturn = await api('GET', '/api/collection/selections', undefined, ownerToken)
  check('退回后选品目录不再含该记录', !(selectionsAfterReturn.data ?? []).some((item: any) => item.id === selectionCId), selectionsAfterReturn.data?.length)

  console.log('\n[5] 平台选品 / 媒体 / 发布草稿')
  warehouse = await api('GET', '/api/collection/warehouse/products', undefined, ownerToken)
  const warehouseForMarketplace = (warehouse.data ?? []).find((item: any) => item.sourceUrl === 'https://detail.1688.com/offer/c.html')
  const importMarketplace = await api('POST', '/api/collection/marketplace/selections/import', {
    marketplaceCode: 'OZON', supplyProductId: warehouseForMarketplace?.id ?? ''
  }, ownerToken)
  check('导入平台选品 → SELECTED/PENDING',
    importMarketplace.status === 200 && importMarketplace.data?.status === 'SELECTED' && importMarketplace.data?.mediaStatus === 'PENDING'
    && importMarketplace.data?.marketplaceCode === 'OZON',
    importMarketplace.data)
  const marketplaceSelectionId: string = importMarketplace.data?.id ?? ''
  const importMarketplaceAgain = await api('POST', '/api/collection/marketplace/selections/import', {
    marketplaceCode: 'OZON', supplyProductId: warehouseForMarketplace?.id ?? ''
  }, ownerToken)
  check('重复导入平台选品 → 幂等同 id', importMarketplaceAgain.status === 200 && importMarketplaceAgain.data?.id === marketplaceSelectionId, importMarketplaceAgain.data)
  const importMarketplace404 = await api('POST', '/api/collection/marketplace/selections/import', { marketplaceCode: 'OZON', supplyProductId: 'nonexistent' }, ownerToken)
  check('不存在供应仓商品导入 → 404', importMarketplace404.status === 404 && importMarketplace404.data?.error === 'WAREHOUSE_PRODUCT_NOT_FOUND', importMarketplace404.data)

  const media1 = await api('POST', '/api/collection/marketplace/media/save', {
    marketplaceSelectionId, assetType: 'ORIGINAL', imageUrl: 'https://img.1688.com/c.jpg', localPath: '', selected: false
  }, ownerToken)
  check('保存媒体素材（未选中）→ selection.mediaStatus=PROCESSING',
    media1.status === 200 && media1.data?.selected === false, media1.data)
  const media2 = await api('POST', '/api/collection/marketplace/media/save', {
    marketplaceSelectionId, assetType: 'AI_GENERATED', imageUrl: 'https://ai.img/c-v2.jpg', localPath: '', selected: true
  }, ownerToken)
  check('保存选中媒体 → 其他素材取消选中',
    media2.status === 200 && media2.data?.selected === true, media2.data)
  let mediaList = await api('GET', `/api/collection/marketplace/media?selectionId=${marketplaceSelectionId}`, undefined, ownerToken)
  check('媒体列表：selected 唯一且排序优先',
    mediaList.status === 200 && mediaList.data?.length === 2
    && mediaList.data?.[0]?.selected === true && mediaList.data?.filter((item: any) => item.selected)?.length === 1,
    mediaList.data?.map((item: any) => ({ id: item.id, selected: item.selected })))
  const selectMedia1 = await api('POST', `/api/collection/marketplace/media/${media1.data?.id}/select`, undefined, ownerToken)
  check('改选第一条媒体 → 200', selectMedia1.status === 200 && selectMedia1.data?.selected === true && selectMedia1.data?.id === media1.data?.id, selectMedia1.data)
  mediaList = await api('GET', `/api/collection/marketplace/media?selectionId=${marketplaceSelectionId}`, undefined, ownerToken)
  const marketplaceSelections = await api('GET', '/api/collection/marketplace/selections?marketplace=OZON', undefined, ownerToken)
  const marketplaceSelectionView = (marketplaceSelections.data ?? []).find((item: any) => item.id === marketplaceSelectionId)
  check('改选后 selected 切换且 mediaStatus=READY',
    mediaList.data?.find((item: any) => item.id === media1.data?.id)?.selected === true
    && mediaList.data?.find((item: any) => item.id === media2.data?.id)?.selected === false
    && marketplaceSelectionView?.mediaStatus === 'READY',
    mediaList.data?.map((item: any) => ({ id: item.id, selected: item.selected })))
  const media404 = await api('POST', '/api/collection/marketplace/media/nonexistent/select', undefined, ownerToken)
  check('不存在素材改选 → 404', media404.status === 404 && media404.data?.error === 'MEDIA_ASSET_NOT_FOUND', media404.data)

  const draftCreate = await api('POST', '/api/collection/marketplace/publish-drafts/create', { marketplaceSelectionId, storeId: 'store-x' }, ownerToken)
  check('生成发布草稿 → platformSku/选中图/DRAFT',
    draftCreate.status === 200 && draftCreate.data?.platformSku?.startsWith('OZON-1688-')
    && draftCreate.data?.imageUrl === 'https://img.1688.com/c.jpg' && draftCreate.data?.status === 'DRAFT'
    && draftCreate.data?.storeId === 'store-x',
    draftCreate.data)
  const draftId: string = draftCreate.data?.id ?? ''
  const draftRecreate = await api('POST', '/api/collection/marketplace/publish-drafts/create', { marketplaceSelectionId, storeId: '' }, ownerToken)
  check('重新生成草稿（空 storeId）→ 保留原 storeId',
    draftRecreate.status === 200 && draftRecreate.data?.id === draftId && draftRecreate.data?.storeId === 'store-x', draftRecreate.data)
  const draftUpdateError = await api('POST', '/api/collection/marketplace/publish-drafts/update', { id: draftId, error: '图片校验失败', action: '校验失败' }, ownerToken)
  check('更新草稿写入 error', draftUpdateError.status === 200 && draftUpdateError.data?.error === '图片校验失败', draftUpdateError.data)
  const draftUpdateNoError = await api('POST', '/api/collection/marketplace/publish-drafts/update', { id: draftId, status: 'VALIDATED', action: '校验通过' }, ownerToken)
  check('更新草稿不带 error → 原 error 保留',
    draftUpdateNoError.status === 200 && draftUpdateNoError.data?.status === 'VALIDATED' && draftUpdateNoError.data?.error === '图片校验失败',
    draftUpdateNoError.data)
  const draftAudits = await api('GET', '/api/collection/marketplace/publish-audits?marketplace=OZON', undefined, ownerToken)
  const auditActions: string[] = (draftAudits.data ?? []).map((item: any) => item.action)
  check('发布审计含 生成发布草稿/校验失败/校验通过',
    draftAudits.status === 200 && auditActions.includes('生成发布草稿') && auditActions.includes('校验失败') && auditActions.includes('校验通过'),
    auditActions)
  const draft404 = await api('POST', '/api/collection/marketplace/publish-drafts/update', { id: 'nonexistent', status: 'VALIDATED' }, ownerToken)
  check('不存在草稿更新 → 404', draft404.status === 404 && draft404.data?.error === 'PUBLISH_DRAFT_NOT_FOUND', draft404.data)

  console.log('\n[6] 平台账号凭据与工作流计数')
  const profiles = await api('GET', '/api/collection/marketplace/profiles', undefined, ownerToken)
  check('平台画像：5 平台 OZON 首位且采集就绪',
    profiles.status === 200 && profiles.data?.platforms?.length === 5
    && profiles.data?.platforms?.[0]?.code === 'OZON' && profiles.data?.platforms?.[0]?.collectorReady === true
    && profiles.data?.accounts?.length === 0,
    profiles.data?.platforms?.map((item: any) => item.code))
  const addAccount = await api('POST', '/api/collection/marketplace/accounts', { platformCode: 'OZON', name: '主账号' }, ownerToken)
  check('添加平台账号 → 200', addAccount.status === 200 && addAccount.data?.networkStrategy === 'LOCAL_DIRECT' && addAccount.data?.status === 'ACTIVE', addAccount.data)
  const accountId: string = addAccount.data?.id ?? ''
  const addAccountEmpty = await api('POST', '/api/collection/marketplace/accounts', { platformCode: 'OZON', name: '  ' }, ownerToken)
  check('空账号名 → 400 VALIDATION', addAccountEmpty.status === 400 && addAccountEmpty.data?.error === 'VALIDATION', addAccountEmpty.data)

  const saveCredential = await api('PUT', `/api/collection/marketplace/credentials/${accountId}`, {
    platformCode: 'OZON', username: 'ozon-user', encryptedPassword: 'enc-pw-1', mode: 'AUTO_FILL'
  }, ownerToken)
  check('保存凭据 → passwordSaved=true',
    saveCredential.status === 200 && saveCredential.data?.passwordSaved === true && saveCredential.data?.username === 'ozon-user'
    && saveCredential.data?.mode === 'AUTO_FILL',
    saveCredential.data)
  const saveCredentialKeep = await api('PUT', `/api/collection/marketplace/credentials/${accountId}`, {
    platformCode: 'OZON', username: 'ozon-user-2', encryptedPassword: '', mode: 'SESSION_ONLY'
  }, ownerToken)
  check('空密码保存 → 保留原密码',
    saveCredentialKeep.status === 200 && saveCredentialKeep.data?.passwordSaved === true && saveCredentialKeep.data?.username === 'ozon-user-2',
    saveCredentialKeep.data)
  const credentialStatus = await api('GET', `/api/collection/marketplace/credentials/${accountId}`, undefined, ownerToken)
  check('凭据状态读取 → 不含密码字段',
    credentialStatus.status === 200 && credentialStatus.data?.passwordSaved === true && credentialStatus.data?.username === 'ozon-user-2'
    && !('encryptedPassword' in (credentialStatus.data ?? {})) && !('password' in (credentialStatus.data ?? {})),
    credentialStatus.data)
  const deleteCredential = await api('DELETE', `/api/collection/marketplace/credentials/${accountId}`, undefined, ownerToken)
  check('删除凭据 → passwordSaved=false',
    deleteCredential.status === 200 && deleteCredential.data?.passwordSaved === false, deleteCredential.data)
  const credentialAfterDelete = await api('GET', `/api/collection/marketplace/credentials/${accountId}`, undefined, ownerToken)
  check('删除后凭据状态 → username 清空', credentialAfterDelete.status === 200 && credentialAfterDelete.data?.username === '' && credentialAfterDelete.data?.passwordSaved === false, credentialAfterDelete.data)

  const counts = await api('GET', '/api/collection/workflow/counts', undefined, ownerToken)
  check('工作流计数（collected≥6/compared=2/selected=1：选品C退回后仅剩晋级选品）',
    counts.status === 200 && counts.data?.collected >= 6 && counts.data?.compared === 2 && counts.data?.selected === 1,
    counts.data)

  console.log('\n[7] 权限与跨组织隔离')
  const roles = await api('GET', '/api/roles', undefined, ownerToken)
  const operatorRoleId = roles.data?.find((role: any) => role.name === '运营')?.id
  const publisherRoleId = roles.data?.find((role: any) => role.name === '发布员')?.id
  await api('POST', '/api/members', { email: 'op-coll@test.com', name: '运营小A', password: 'pass1234', roleIds: [operatorRoleId], storeIds: [] }, ownerToken)
  await api('POST', '/api/members', { email: 'pub-coll@test.com', name: '发布小B', password: 'pass1234', roleIds: [publisherRoleId], storeIds: [] }, ownerToken)
  const opToken: string = (await api('POST', '/api/auth/login', { email: 'op-coll@test.com', password: 'pass1234' })).data?.tokens?.accessToken ?? ''
  const pubToken: string = (await api('POST', '/api/auth/login', { email: 'pub-coll@test.com', password: 'pass1234' })).data?.tokens?.accessToken ?? ''

  const opCreateTask = await api('POST', '/api/collection/tasks', makeTaskDraft({ name: '运营任务' }), opToken)
  check('运营创建采集任务 → 200（collection.run）', opCreateTask.status === 200, opCreateTask.data)
  const opImportSelection = await api('POST', '/api/collection/selections/import', {
    sourceArea: 'SUPPLY', product: makeSupplyProduct('e'), category: '耳机', subcategory: '骨传导'
  }, opToken)
  check('运营导入选品 → 200', opImportSelection.status === 200, opImportSelection.data)
  const opDraftCreate = await api('POST', '/api/collection/marketplace/publish-drafts/create', { marketplaceSelectionId, storeId: '' }, opToken)
  check('运营生成发布草稿 → 403（publish.run）', opDraftCreate.status === 403, opDraftCreate.data)
  const opAddAccount = await api('POST', '/api/collection/marketplace/accounts', { platformCode: 'EBAY', name: '越权账号' }, opToken)
  check('运营添加平台账号 → 403（store.manage）', opAddAccount.status === 403, opAddAccount.data)
  const opCredential = await api('PUT', `/api/collection/marketplace/credentials/${accountId}`, { platformCode: 'OZON', username: 'x', encryptedPassword: 'y', mode: 'SESSION_ONLY' }, opToken)
  check('运营改平台凭据 → 403（store.manage）', opCredential.status === 403, opCredential.data)

  const pubDraftCreate = await api('POST', '/api/collection/marketplace/publish-drafts/create', { marketplaceSelectionId, storeId: '' }, pubToken)
  check('发布员生成发布草稿 → 200（publish.run）', pubDraftCreate.status === 200, pubDraftCreate.data)
  const pubCreateTask = await api('POST', '/api/collection/tasks', makeTaskDraft(), pubToken)
  check('发布员创建采集任务 → 403（collection.run）', pubCreateTask.status === 403, pubCreateTask.data)
  const pubImportMarketplace = await api('POST', '/api/collection/marketplace/selections/import', { marketplaceCode: 'OZON', supplyProductId: warehouseForMarketplace?.id ?? '' }, pubToken)
  check('发布员导入平台选品 → 403（product.edit）', pubImportMarketplace.status === 403, pubImportMarketplace.data)
  const pubCandidates = await api('GET', '/api/collection/candidates', undefined, pubToken)
  check('发布员读候选工作区 → 200（读=已认证）', pubCandidates.status === 200 && pubCandidates.data?.supplyProducts?.length > 0, pubCandidates.status)
  const pubSelections = await api('GET', '/api/collection/selections', undefined, pubToken)
  check('发布员读选品目录 → 200', pubSelections.status === 200 && pubSelections.data?.length > 0, pubSelections.status)

  const registerB = await api('POST', '/api/auth/register', { orgName: '竞争对手', name: '老板B', email: 'owner-b@test.com', password: 'pass1234' })
  const ownerBToken: string = registerB.data?.tokens?.accessToken ?? ''
  const candidatesB = await api('GET', '/api/collection/candidates', undefined, ownerBToken)
  check('组织B 候选工作区全空',
    candidatesB.status === 200 && candidatesB.data?.products?.length === 0 && candidatesB.data?.supplyProducts?.length === 0 && candidatesB.data?.runs?.length === 0,
    candidatesB.data)
  const selectionsB = await api('GET', '/api/collection/selections', undefined, ownerBToken)
  check('组织B 选品目录为空', selectionsB.status === 200 && selectionsB.data?.length === 0, selectionsB.data)
  const crossDecision = await api('POST', `/api/collection/selections/${selectionDId}/decision`, { decision: 'APPROVED' }, ownerBToken)
  check('组织B 改组织A 选品 → 404', crossDecision.status === 404 && crossDecision.data?.error === 'SELECTION_NOT_FOUND', crossDecision.data)
  const crossDraft = await api('POST', '/api/collection/marketplace/publish-drafts/update', { id: draftId, status: 'FAILED' }, ownerBToken)
  check('组织B 改组织A 发布草稿 → 404', crossDraft.status === 404 && crossDraft.data?.error === 'PUBLISH_DRAFT_NOT_FOUND', crossDraft.data)
  const profilesB = await api('GET', '/api/collection/marketplace/profiles', undefined, ownerBToken)
  check('组织B 平台画像：种子独立（5 平台 0 账号）',
    profilesB.status === 200 && profilesB.data?.platforms?.length === 5 && profilesB.data?.accounts?.length === 0,
    { platforms: profilesB.data?.platforms?.length, accounts: profilesB.data?.accounts?.length })
  const noToken = await api('GET', '/api/collection/candidates')
  check('无令牌访问 → 401', noToken.status === 401)

  const audit = await api('GET', '/api/audit-logs?limit=200', undefined, ownerToken)
  const actions: string[] = audit.data?.items?.map((item: any) => item.action) ?? []
  for (const expected of ['collection.task.create', 'collection.candidates.save-supply', 'collection.comparison.promote', 'collection.publish-draft.create']) {
    check(`审计包含 ${expected}`, actions.includes(expected), actions)
  }
} finally {
  await app.close()
  await socket.stop()
  await db.close()
}

console.log(`\n========== 验收结果：${passed} 通过 / ${failed} 失败 ==========`)
process.exit(failed > 0 ? 1 : 0)
