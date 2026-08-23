import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { writeAudit } from '../../lib/audit.js'
import { prisma } from '../../lib/prisma.js'
import type { CurrentUser } from '../../plugins/auth.js'
import { CollectionRepository } from './repository.js'
import type { CollectedOzonProduct, CollectedSupplyProduct, SelectionTask } from './types.js'

// ---------------------------------------------------------------- 请求 schema
// 策略：窄列与关键字段严格校验，payload 级嵌套对象 .passthrough() 原样往返（与客户端 contracts 对齐）

const marketplacePlatformCodeSchema = z.enum(['OZON', 'AMAZON', 'EBAY', 'ALIEXPRESS', 'TEMU'])
const supplyPlatformCodeSchema = z.enum(['1688', 'TAOBAO', 'TMALL', 'JD', 'PINDUODUO', 'DOUYIN', 'XIAOHONGSHU', 'KUAISHOU', 'GIGACLOUD', 'YIWUGO', 'CUSTOM'])
const candidateAreaSchema = z.enum(['SUPPLY', 'MARKET'])

const ozonProductSchema = z.object({
  productId: z.string().default(''),
  url: z.string().min(1),
  title: z.string().default(''),
  priceText: z.string().default(''),
  originalPriceText: z.string().default(''),
  imageUrl: z.string().default(''),
  brand: z.string().default(''),
  attributeCount: z.number().int().nullable().default(null)
}).passthrough()

const supplySourceCategorySchema = z.object({
  platformCode: z.literal('GIGACLOUD'),
  catalogVersion: z.string().default(''),
  status: z.enum(['EXACT', 'PARTIAL', 'NEEDS_REVIEW']).default('NEEDS_REVIEW')
}).passthrough()

const supplyProductSchema = z.object({
  platformCode: supplyPlatformCodeSchema.default('1688'),
  productId: z.string().default(''),
  url: z.string().min(1),
  title: z.string().default(''),
  imageUrl: z.string().default(''),
  priceText: z.string().default(''),
  salesText: z.string().default(''),
  supplierName: z.string().default(''),
  supplierBadges: z.array(z.string()).default([]),
  categoryTopRank: z.number().nullable().default(null),
  returnRate: z.number().nullable().default(null),
  networkSalesCount: z.number().nullable().default(null),
  serviceRating: z.number().nullable().default(null),
  serviceDetails: z.record(z.number()).default({}),
  dataCompleteness: z.number().default(0),
  score: z.number().default(0),
  grade: z.enum(['A', 'B', 'C', 'REJECTED']).default('C'),
  dimensionScores: z.record(z.number()).default({}),
  recommendation: z.string().default(''),
  riskFlags: z.array(z.string()).default([]),
  selected: z.boolean().default(false),
  sourceCategory: supplySourceCategorySchema.optional()
}).passthrough()

const taskStageSchema = z.enum([
  'CREATED', 'PREVIEW_RUNNING', 'PREVIEW_READY', 'CONFIRM_RUNNING',
  'OZON_LIST_PENDING', 'OZON_LIST_RUNNING', 'OZON_LIST_COMPLETED',
  'SUPPLY_LIST_RUNNING', 'SUPPLY_LIST_COMPLETED', 'PAUSED', 'FAILED'
])

const taskDraftSchema = z.object({
  selectionMode: z.enum(['FORWARD_SUPPLY', 'REVERSE_MARKET']),
  marketplacePlatform: marketplacePlatformCodeSchema.default('OZON'),
  marketplaceAccountId: z.string().default(''),
  networkStrategy: z.enum(['LOCAL_DIRECT', 'SYSTEM', 'PROXY_PROFILE']).default('LOCAL_DIRECT'),
  selectionRulePreset: z.enum(['BALANCED', 'QUALITY_FIRST', 'SALES_FIRST', 'SUPPLY_FIRST', 'LOW_RISK']).default('BALANCED'),
  minimumSelectionScore: z.number().default(65),
  selectionDimensions: z.array(z.string()).default([]),
  requiredSupplierBadges: z.array(z.string()).default([]),
  maxCategoryTopRank: z.number().default(0),
  minimumReturnRate: z.number().default(0),
  minimumNetworkSales: z.number().default(0),
  minimumServiceRating: z.number().default(0),
  collectionMethod: z.enum(['KEYWORD', 'PRODUCT_URL', 'CATEGORY_URL']).default('KEYWORD'),
  sourceUrl: z.string().default(''),
  maxPages: z.number().int().default(1),
  supplyPlatforms: z.array(supplyPlatformCodeSchema).default(['1688']),
  maxMoq: z.number().default(0),
  minSupplierYears: z.number().default(0),
  onlyVerifiedSupplier: z.boolean().default(false),
  gigaSellerIndexFilter: z.enum(['ANY', 'NEW', 'GE90', 'GE80', 'GE70', 'GE60', 'LT60']).default('ANY'),
  gigaReturnRateFilter: z.enum(['ANY', 'LOW', 'MEDIUM', 'HIGH']).default('ANY'),
  name: z.string().default(''),
  ozonUrl: z.string().default(''),
  keyword: z.string().default(''),
  targetQuantity: z.number().default(0),
  minPrice: z.number().default(0),
  maxPrice: z.number().default(0),
  minRating: z.number().default(0),
  minReviews: z.number().default(0),
  maxProducts: z.number().int().default(50),
  collectionProtectionEnabled: z.boolean().default(false),
  collectionProtectionMode: z.enum(['CAUTIOUS', 'STANDARD', 'FAST']).default('STANDARD'),
  collectionBatchSize: z.number().int().default(10),
  collectionRestMinSeconds: z.number().default(0),
  collectionRestMaxSeconds: z.number().default(0),
  collectionMaxRunMinutes: z.number().default(0),
  collectionAutoPause: z.boolean().default(false),
  exchangeRate: z.number().default(0.09),
  targetMargin: z.number().default(0)
}).passthrough()

const taskSchema = taskDraftSchema.extend({
  id: z.string().min(1),
  stage: taskStageSchema,
  createdAt: z.string().min(1)
})

const candidateUpdateSchema = z.object({
  candidateArea: candidateAreaSchema,
  candidateKeys: z.array(z.string().min(1)).default([])
})

const comparisonSettingsSchema = z.object({
  exchangeRate: z.number().default(0.09),
  commissionRate: z.number().default(12),
  domesticShipping: z.number().default(2),
  packagingCost: z.number().default(1.5),
  internationalLogistics: z.number().default(18),
  fulfillmentCost: z.number().default(8),
  advertisingRate: z.number().default(5),
  returnLossRate: z.number().default(3),
  taxRate: z.number().default(0),
  otherCost: z.number().default(1)
})

const comparisonUpdateSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(['PENDING', 'REVIEW', 'RECOMMENDED', 'REJECTED', 'FAILED']).optional(),
  supplierUrl: z.string().optional(),
  binding: z.enum(['NONE', 'PRIMARY', 'BACKUP']).optional(),
  purchasePriceCny: z.number().optional(),
  settings: comparisonSettingsSchema.optional()
})

const comparisonPromoteSchema = z.object({
  id: z.string().min(1),
  category: z.string().default(''),
  subcategory: z.string().default(''),
  tertiaryCategory: z.string().default('')
})

const selectionImportSchema = z.object({
  sourceArea: candidateAreaSchema,
  product: z.union([supplyProductSchema, ozonProductSchema]),
  category: z.string().default(''),
  subcategory: z.string().default(''),
  tertiaryCategory: z.string().optional(),
  comparison: z.object({ id: z.string().min(1) }).passthrough().optional()
})

const selectionDecisionSchema = z.object({
  decision: z.enum(['PENDING', 'APPROVED', 'REJECTED'])
})

const selectionCategorySchema = z.object({
  category: z.string().default(''),
  subcategory: z.string().default(''),
  tertiaryCategory: z.string().default('')
})

const marketplaceSelectionImportSchema = z.object({
  marketplaceCode: marketplacePlatformCodeSchema,
  supplyProductId: z.string().min(1)
})

const mediaAssetSaveSchema = z.object({
  marketplaceSelectionId: z.string().min(1),
  assetType: z.enum(['ORIGINAL', 'AI_GENERATED', 'REALSHIFT']),
  imageUrl: z.string().default(''),
  localPath: z.string().default(''),
  selected: z.boolean().default(false)
})

const publishDraftCreateSchema = z.object({
  marketplaceSelectionId: z.string().min(1),
  storeId: z.string().default('')
})

const publishDraftUpdateSchema = z.object({
  id: z.string().min(1),
  storeId: z.string().optional(),
  status: z.enum(['DRAFT', 'VALIDATED', 'SELLER_DRAFT', 'REVIEW', 'PUBLISHED', 'FAILED']).optional(),
  checks: z.array(z.string()).optional(),
  error: z.string().optional(),
  action: z.string().default('更新发布草稿')
})

const accountAddSchema = z.object({
  platformCode: marketplacePlatformCodeSchema,
  name: z.string().trim().min(1, '请输入账号名称')
})

const credentialSaveSchema = z.object({
  platformCode: z.string().min(1),
  username: z.string().default(''),
  encryptedPassword: z.string().default(''),
  mode: z.string().default('SESSION_ONLY')
})

// ---------------------------------------------------------------- 路由

/**
 * 选品采集域 API（数据层）。权限映射：
 * 任务创建/候选保存与删除/比价/选品决策 collection.run（采集选品流程）；
 * 平台选品导入/媒体素材 product.edit（发布前商品准备）；发布草稿 publish.run；
 * 平台账号与凭据 store.manage（主帐号专属）；读接口 = 已认证（组织内共享工作区，无店铺维度）。
 */
export async function collectionRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  const repoOf = (orgId: string) => new CollectionRepository(orgId)

  const audit = (request: { currentUser: CurrentUser; ip: string }, action: string, targetType: string, targetId: string, detail: Record<string, unknown>) =>
    writeAudit(prisma, { orgId: request.currentUser.orgId, userId: request.currentUser.id, action, targetType, targetId, detail, ip: request.ip })

  // ---------------- 采集任务 ----------------

  app.post('/tasks', { preHandler: [app.requirePermission('collection.run')] }, async request => {
    const draft = taskDraftSchema.parse(request.body)
    const task: SelectionTask = { ...draft, id: randomUUID(), stage: 'OZON_LIST_PENDING', createdAt: new Date().toISOString() } as SelectionTask
    await repoOf(request.currentUser.orgId).saveTask(task)
    await audit(request, 'collection.task.create', 'SELECTION_TASK', task.id, { name: task.name, selectionMode: task.selectionMode })
    return task
  })

  app.get('/tasks/latest', async request => {
    return repoOf(request.currentUser.orgId).getLatestWorkspace()
  })

  app.post('/tasks/:taskId/products/market', { preHandler: [app.requirePermission('collection.run')] }, async request => {
    const { taskId } = request.params as { taskId: string }
    const body = z.object({ products: z.array(ozonProductSchema).default([]) }).parse(request.body)
    await repoOf(request.currentUser.orgId).saveProducts(taskId, body.products as CollectedOzonProduct[])
    await audit(request, 'collection.candidates.save-market', 'SELECTION_TASK', taskId, { count: body.products.length })
    return { ok: true, count: body.products.length }
  })

  app.post('/tasks/:taskId/products/supply', { preHandler: [app.requirePermission('collection.run')] }, async request => {
    const { taskId } = request.params as { taskId: string }
    const body = z.object({ products: z.array(supplyProductSchema).default([]) }).parse(request.body)
    await repoOf(request.currentUser.orgId).saveSupplyProducts(taskId, body.products as CollectedSupplyProduct[])
    await audit(request, 'collection.candidates.save-supply', 'SELECTION_TASK', taskId, { count: body.products.length })
    return { ok: true, count: body.products.length }
  })

  app.post('/tasks/import-plugin-candidates', { preHandler: [app.requirePermission('collection.run')] }, async request => {
    const body = z.object({ task: taskSchema, products: z.array(supplyProductSchema).default([]) }).parse(request.body)
    const result = await repoOf(request.currentUser.orgId).importPluginSupplyCandidates(body.task as SelectionTask, body.products as CollectedSupplyProduct[])
    await audit(request, 'collection.candidates.import-plugin', 'SELECTION_TASK', body.task.id, { imported: result.imported, blocked: result.blocked })
    return result
  })

  // ---------------- 候选工作区 ----------------

  app.get('/candidates', async request => {
    return repoOf(request.currentUser.orgId).getCandidateWorkspace()
  })

  app.post('/candidates/delete', { preHandler: [app.requirePermission('collection.run')] }, async request => {
    const body = candidateUpdateSchema.parse(request.body)
    const workspace = await repoOf(request.currentUser.orgId).setCandidatesDeleted(body, true)
    await audit(request, 'collection.candidates.delete', 'CANDIDATE', body.candidateArea, { count: body.candidateKeys.length })
    return workspace
  })

  app.post('/candidates/restore', { preHandler: [app.requirePermission('collection.run')] }, async request => {
    const body = candidateUpdateSchema.parse(request.body)
    const workspace = await repoOf(request.currentUser.orgId).setCandidatesDeleted(body, false)
    await audit(request, 'collection.candidates.restore', 'CANDIDATE', body.candidateArea, { count: body.candidateKeys.length })
    return workspace
  })

  app.post('/candidates/purge', { preHandler: [app.requirePermission('collection.run')] }, async request => {
    const body = candidateUpdateSchema.parse(request.body)
    const workspace = await repoOf(request.currentUser.orgId).purgeCandidates(body)
    await audit(request, 'collection.candidates.purge', 'CANDIDATE', body.candidateArea, { count: body.candidateKeys.length })
    return workspace
  })

  // ---------------- 比价 ----------------

  app.get('/comparisons', async request => {
    return repoOf(request.currentUser.orgId).getComparisons()
  })

  app.post('/comparisons/import', { preHandler: [app.requirePermission('collection.run')] }, async request => {
    const body = z.object({ product: ozonProductSchema }).parse(request.body)
    const result = await repoOf(request.currentUser.orgId).importComparison({ product: body.product as CollectedOzonProduct })
    await audit(request, 'collection.comparison.import', 'COMPARISON', result.id, { url: body.product.url })
    return result
  })

  app.post('/comparisons/update', { preHandler: [app.requirePermission('collection.run')] }, async request => {
    const body = comparisonUpdateSchema.parse(request.body)
    const result = await repoOf(request.currentUser.orgId).updateComparison(body)
    await audit(request, 'collection.comparison.update', 'COMPARISON', result.id, { decision: result.decision })
    return result
  })

  app.post('/comparisons/promote', { preHandler: [app.requirePermission('collection.run')] }, async request => {
    const body = comparisonPromoteSchema.parse(request.body)
    const result = await repoOf(request.currentUser.orgId).promoteComparisonToWarehouse(body)
    await audit(request, 'collection.comparison.promote', 'COMPARISON', body.id, { selectionId: result.selection.id, warehouseProductId: result.warehouseProduct.id })
    return result
  })

  // ---------------- 选品 ----------------

  app.get('/selections', async request => {
    return repoOf(request.currentUser.orgId).getSelectionCatalog()
  })

  app.post('/selections/import', { preHandler: [app.requirePermission('collection.run')] }, async request => {
    const body = selectionImportSchema.parse(request.body)
    const result = await repoOf(request.currentUser.orgId).importSelection(body as Parameters<CollectionRepository['importSelection']>[0])
    await audit(request, 'collection.selection.import', 'SELECTION', result.id, { sourceArea: body.sourceArea, url: body.product.url })
    return result
  })

  app.post('/selections/:id/decision', { preHandler: [app.requirePermission('collection.run')] }, async request => {
    const { id } = request.params as { id: string }
    const body = selectionDecisionSchema.parse(request.body)
    const result = await repoOf(request.currentUser.orgId).updateSelectionDecision(id, body.decision)
    await audit(request, 'collection.selection.decide', 'SELECTION', id, { decision: body.decision })
    return result
  })

  app.post('/selections/:id/category', { preHandler: [app.requirePermission('collection.run')] }, async request => {
    const { id } = request.params as { id: string }
    const body = selectionCategorySchema.parse(request.body)
    const result = await repoOf(request.currentUser.orgId).updateSelectionCategory(id, body.category, body.subcategory, body.tertiaryCategory)
    await audit(request, 'collection.selection.categorize', 'SELECTION', id, { category: body.category, subcategory: body.subcategory })
    return result
  })

  app.delete('/selections/:id', { preHandler: [app.requirePermission('collection.run')] }, async request => {
    const { id } = request.params as { id: string }
    await repoOf(request.currentUser.orgId).returnSelectionToCandidates(id)
    await audit(request, 'collection.selection.return', 'SELECTION', id, {})
    return { ok: true }
  })

  // ---------------- 工作流计数 ----------------

  app.get('/workflow/counts', async request => {
    return repoOf(request.currentUser.orgId).getWorkflowCounts()
  })

  // ---------------- 供应仓 ----------------

  app.get('/warehouse/products', async request => {
    return repoOf(request.currentUser.orgId).getSupplyWarehouseProducts()
  })

  // ---------------- 平台选品 / 媒体 / 发布草稿 ----------------

  app.get('/marketplace/selections', async request => {
    const { marketplace } = request.query as { marketplace?: string }
    const marketplaceCode = marketplacePlatformCodeSchema.parse(marketplace || 'OZON')
    return repoOf(request.currentUser.orgId).getMarketplaceSelections(marketplaceCode)
  })

  app.post('/marketplace/selections/import', { preHandler: [app.requirePermission('product.edit')] }, async request => {
    const body = marketplaceSelectionImportSchema.parse(request.body)
    const result = await repoOf(request.currentUser.orgId).importMarketplaceSelection(body.marketplaceCode, body.supplyProductId)
    await audit(request, 'collection.marketplace-selection.import', 'MARKETPLACE_SELECTION', result.id, { marketplaceCode: body.marketplaceCode, supplyProductId: body.supplyProductId })
    return result
  })

  app.get('/marketplace/media', async request => {
    const { selectionId } = request.query as { selectionId?: string }
    const id = z.string().min(1).parse(selectionId)
    return repoOf(request.currentUser.orgId).getMarketplaceMediaAssets(id)
  })

  app.post('/marketplace/media/save', { preHandler: [app.requirePermission('product.edit')] }, async request => {
    const body = mediaAssetSaveSchema.parse(request.body)
    const result = await repoOf(request.currentUser.orgId).saveMarketplaceMediaAsset(body.marketplaceSelectionId, body.assetType, body.imageUrl, body.localPath, body.selected)
    await audit(request, 'collection.marketplace-media.save', 'MARKETPLACE_MEDIA', result.id, { marketplaceSelectionId: body.marketplaceSelectionId, assetType: body.assetType, selected: body.selected })
    return result
  })

  app.post('/marketplace/media/:id/select', { preHandler: [app.requirePermission('product.edit')] }, async request => {
    const { id } = request.params as { id: string }
    const result = await repoOf(request.currentUser.orgId).selectMarketplaceMediaAsset(id)
    await audit(request, 'collection.marketplace-media.select', 'MARKETPLACE_MEDIA', id, { marketplaceSelectionId: result.marketplaceSelectionId })
    return result
  })

  app.get('/marketplace/publish-drafts', async request => {
    const { marketplace } = request.query as { marketplace?: string }
    const marketplaceCode = marketplacePlatformCodeSchema.parse(marketplace || 'OZON')
    return repoOf(request.currentUser.orgId).getMarketplacePublishDrafts(marketplaceCode)
  })

  app.post('/marketplace/publish-drafts/create', { preHandler: [app.requirePermission('publish.run')] }, async request => {
    const body = publishDraftCreateSchema.parse(request.body)
    const result = await repoOf(request.currentUser.orgId).createMarketplacePublishDraft(body.marketplaceSelectionId, body.storeId)
    await audit(request, 'collection.publish-draft.create', 'MARKETPLACE_PUBLISH_DRAFT', result.id, { marketplaceSelectionId: body.marketplaceSelectionId, platformSku: result.platformSku })
    return result
  })

  app.post('/marketplace/publish-drafts/update', { preHandler: [app.requirePermission('publish.run')] }, async request => {
    const body = publishDraftUpdateSchema.parse(request.body)
    const { action, ...update } = body
    const result = await repoOf(request.currentUser.orgId).updateMarketplacePublishDraft(update, action)
    await audit(request, 'collection.publish-draft.update', 'MARKETPLACE_PUBLISH_DRAFT', body.id, { action, status: result.status })
    return result
  })

  app.get('/marketplace/publish-audits', async request => {
    const { marketplace } = request.query as { marketplace?: string }
    const marketplaceCode = marketplacePlatformCodeSchema.parse(marketplace || 'OZON')
    return repoOf(request.currentUser.orgId).getMarketplacePublishAudits(marketplaceCode)
  })

  // ---------------- 平台账号与凭据 ----------------

  app.get('/marketplace/profiles', async request => {
    return repoOf(request.currentUser.orgId).getMarketplaceProfiles()
  })

  app.post('/marketplace/accounts', { preHandler: [app.requirePermission('store.manage')] }, async request => {
    const body = accountAddSchema.parse(request.body)
    const result = await repoOf(request.currentUser.orgId).addMarketplaceAccount(body.platformCode, body.name)
    await audit(request, 'collection.marketplace-account.add', 'MARKETPLACE_ACCOUNT', result.id, { platformCode: body.platformCode, name: body.name })
    return result
  })

  app.get('/marketplace/credentials/:accountId', async request => {
    const { accountId } = request.params as { accountId: string }
    return repoOf(request.currentUser.orgId).getMarketplaceCredentialStatus(accountId)
  })

  app.put('/marketplace/credentials/:accountId', { preHandler: [app.requirePermission('store.manage')] }, async request => {
    const { accountId } = request.params as { accountId: string }
    const body = credentialSaveSchema.parse(request.body)
    const result = await repoOf(request.currentUser.orgId).saveMarketplaceCredential({ accountId, ...body })
    await audit(request, 'collection.marketplace-credential.save', 'MARKETPLACE_ACCOUNT', accountId, { username: result.username, passwordSaved: result.passwordSaved })
    return result
  })

  app.delete('/marketplace/credentials/:accountId', { preHandler: [app.requirePermission('store.manage')] }, async request => {
    const { accountId } = request.params as { accountId: string }
    await repoOf(request.currentUser.orgId).deleteMarketplaceCredential(accountId)
    await audit(request, 'collection.marketplace-credential.delete', 'MARKETPLACE_ACCOUNT', accountId, {})
    return { accountId, username: '', passwordSaved: false, mode: 'SESSION_ONLY' }
  })
}
