import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { writeAudit } from '../../lib/audit.js'
import { httpError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { hasStoreAccess, type CurrentUser } from '../../plugins/auth.js'
import { EbayRepository } from './repository.js'
import { completeEbayLocalSnapshot, ebayImageFormatSupported } from './utils.js'
import type {
  EbayAcceptanceBatch,
  EbayContentOptimizationRecordInput,
  EbayImageVisualInspectionReport,
  EbayListing,
  EbayLocalProductMedia,
  EbayLocalProductSnapshot,
  EbayMarketResearchSnapshot,
  EbayOptimizationDraftInput,
  EbayProductDetails,
  EbayPublishTask,
  EbayTitleDecisionInput,
  EbayTitleHandoff
} from './types.js'

// ---------------------------------------------------------------- 请求 schema
// 策略：窄列与关键字段严格校验，payload 级嵌套对象 .passthrough() 原样往返（与客户端 contracts 对齐）

const titleSourceSchema = z.enum(['EBAY_STORE_LINK', 'EBAY_STRUCTURED_DATA', 'EBAY_API', 'EBAY_REPORT', 'UNVERIFIED_PAGE_TEXT'])

const listingSchema = z.object({
  id: z.string().min(1),
  storeId: z.string().min(1),
  marketplaceId: z.string().min(1),
  listingId: z.string().min(1),
  sku: z.string().default(''),
  title: z.string().default(''),
  price: z.string().default(''),
  currency: z.string().default(''),
  quantity: z.number().int().nonnegative().default(0),
  imageUrl: z.string().default(''),
  categoryId: z.string().default(''),
  categoryName: z.string().default(''),
  status: z.enum(['ACTIVE', 'ENDED']).default('ACTIVE'),
  viewUrl: z.string().default(''),
  updatedAt: z.string().min(1)
}).passthrough()

const collectedProductSchema = z.object({
  url: z.string().default(''),
  listingId: z.string().min(1),
  title: z.string().default(''),
  originalTitle: z.string().optional(),
  translatedTitle: z.string().optional(),
  originalTitleVerified: z.boolean().optional(),
  titleSource: titleSourceSchema.optional(),
  imageUrl: z.string().default(''),
  price: z.string().default(''),
  currency: z.string().default(''),
  categoryId: z.string().default(''),
  categoryName: z.string().default('')
})

const scanCategorySchema = z.object({
  categoryId: z.string().min(1),
  categoryName: z.string().default(''),
  expected: z.number().int().nonnegative().default(0),
  found: z.number().int().nonnegative().default(0),
  complete: z.boolean().default(false),
  listingIds: z.array(z.string()).default([]),
  error: z.string().default('')
})

const storeCategorySchema = z.object({
  categoryId: z.string().min(1),
  name: z.string().min(1),
  parentCategoryId: z.string().default(''),
  level: z.number().int().min(1).default(1),
  childCount: z.number().int().nonnegative().default(0),
  listingCount: z.number().int().nonnegative().default(0),
  sortOrder: z.number().int().nonnegative().default(0),
  status: z.enum(['ACTIVE', 'REMOVED']).default('ACTIVE'),
  syncedAt: z.string().default('')
})

const productDetailsSchema = z.object({
  url: z.string().default(''),
  itemSpecifics: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
  condition: z.string().default(''),
  imageUrls: z.array(z.string()).default([]),
  price: z.string().optional(),
  currency: z.string().optional()
}).passthrough()

const localProductMediaSchema = z.object({
  id: z.string().min(1),
  mediaType: z.literal('IMAGE').default('IMAGE'),
  sortOrder: z.number().int().nonnegative(),
  remoteUrl: z.string().default(''),
  localPath: z.string().default(''),
  mimeType: z.string().default(''),
  width: z.number().int().nonnegative().default(0),
  height: z.number().int().nonnegative().default(0),
  fileSize: z.number().int().nonnegative().default(0),
  sha256: z.string().default(''),
  downloadStatus: z.enum(['DOWNLOADED', 'FAILED'])
})

const snapshotInputSchema = z.object({
  listing: listingSchema,
  details: productDetailsSchema,
  media: z.array(localProductMediaSchema).default([]),
  completeness: z.number().min(0).max(100),
  missingFields: z.array(z.string()).default([]),
  contentHash: z.string().min(1),
  capturedAt: z.string().min(1)
})

const visualInspectionSaveSchema = z.object({
  snapshot: z.object({ id: z.string().min(1), contentHash: z.string().min(1) }).passthrough(),
  report: z.object({
    checkedAt: z.string().min(1),
    status: z.enum(['PASSED', 'FAILED', 'REVIEW']),
    images: z.array(z.record(z.unknown())).default([])
  }).passthrough()
})

const visualReviewSchema = z.object({
  localProductId: z.string().min(1),
  mediaId: z.string().min(1),
  rule: z.enum(['PRODUCT_ACCURACY', 'NO_BORDER', 'NO_ADDED_TEXT', 'NO_WATERMARK']),
  decision: z.enum(['PASSED', 'FAILED']),
  reviewedBy: z.string().default(''),
  note: z.string().default('')
})

const marketResearchSnapshotSchema = z.object({
  id: z.string().min(1),
  storeId: z.string().min(1),
  listingId: z.string().min(1),
  source: z.enum(['EBAY_PRODUCT_RESEARCH', 'EBAY_SOLD_SEARCH']),
  fetchedAt: z.string().min(1),
  samples: z.array(z.record(z.unknown())).default([]),
  keywords: z.array(z.record(z.unknown())).default([]),
  combinations: z.array(z.record(z.unknown())).default([])
}).passthrough()

const marketDecideSchema = z.object({
  storeId: z.string().min(1),
  listingId: z.string().min(1),
  kind: z.enum(['KEYWORD', 'COMBINATION']),
  term: z.string().min(1),
  status: z.enum(['CONFIRMED', 'REVIEW', 'EXCLUDED'])
})

const titleDecisionSaveSchema = z.object({
  input: z.object({
    storeId: z.string().min(1),
    listingId: z.string().min(1),
    researchSnapshotId: z.string().default(''),
    originalTitle: z.string().default(''),
    selectedTitle: z.string().min(1),
    selectedVariantId: z.enum(['SEARCH', 'PARAMETER', 'BENEFIT', 'SCENARIO', 'INTENT', 'BALANCED', 'READABLE']),
    variants: z.array(z.record(z.unknown())).default([]),
    verifiedFacts: z.array(z.string()).optional()
  }).passthrough(),
  audit: z.object({
    characterCount: z.number().int().nonnegative(),
    withinLimit: z.boolean(),
    duplicateTerms: z.array(z.string()).default([]),
    danglingConnector: z.boolean().default(false),
    confirmedTermHits: z.array(z.string()).default([]),
    unverifiedTerms: z.array(z.string()).default([]),
    coverageScore: z.number().default(0),
    passed: z.boolean()
  })
})

const titleHandoffSchema = z.object({
  id: z.string().min(1),
  storeId: z.string().min(1),
  listingId: z.string().min(1),
  titleDecisionId: z.string().default(''),
  researchSnapshotId: z.string().default(''),
  originalTitle: z.string().default(''),
  preparedTitle: z.string().default(''),
  status: z.enum(['PREPARING', 'WAITING_CONFIRMATION', 'BLOCKED', 'FAILED']),
  reviseUrl: z.string().default(''),
  filledFields: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  submitButtonDetected: z.boolean().default(false),
  message: z.string().default(''),
  auditTrail: z.array(z.record(z.unknown())).default([]),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
}).passthrough()

const contentRecordSchema = z.object({
  storeId: z.string().min(1),
  listingId: z.string().min(1),
  selectedTitle: z.string().default(''),
  result: z.record(z.unknown())
}).passthrough()

const draftInputSchema = z.object({
  storeId: z.string().min(1),
  listingId: z.string().min(1),
  listing: listingSchema,
  selectedTitle: z.string().default(''),
  titleVariants: z.array(z.record(z.unknown())).default([]),
  itemSpecifics: z.array(z.object({ name: z.string(), value: z.string() }).passthrough()).default([]),
  description: z.string().default(''),
  imageUrl: z.string().default(''),
  scoreBefore: z.number().default(0),
  scoreAfter: z.number().default(0)
}).passthrough()

const publishTaskSchema = z.object({
  id: z.string().min(1),
  storeId: z.string().min(1),
  draftId: z.string().min(1),
  listingId: z.string().min(1),
  status: z.enum(['DRAFT', 'VALIDATING', 'READY_TO_FILL', 'FILLING', 'WAITING_CONFIRMATION', 'BLOCKED', 'FAILED']),
  reviseUrl: z.string().default(''),
  categorySpecifics: z.array(z.record(z.unknown())).default([]),
  imageInspection: z.record(z.unknown()),
  filledFields: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  message: z.string().default(''),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
}).passthrough()

const acceptanceBatchSchema = z.object({
  id: z.string().min(1),
  storeId: z.string().min(1),
  mode: z.enum(['SINGLE', 'BATCH_10']),
  status: z.enum(['PASSED', 'ATTENTION', 'BLOCKED']),
  requested: z.number().int().nonnegative().default(0),
  checked: z.number().int().nonnegative().default(0),
  passed: z.number().int().nonnegative().default(0),
  attention: z.number().int().nonnegative().default(0),
  blocked: z.number().int().nonnegative().default(0),
  items: z.array(z.record(z.unknown())).default([]),
  scenarios: z.array(z.record(z.unknown())).default([]),
  reportPath: z.string().default(''),
  createdAt: z.string().min(1)
}).passthrough()

const checkpointStatusSchema = z.object({
  status: z.enum(['RUNNING', 'PAUSED', 'NEEDS_ATTENTION', 'COMPLETED', 'CANCELLED', 'INTERRUPTED'])
})

/** 本地产品编辑载荷（对齐客户端 EbayLocalProductUpdateInput）；条数上限等规则在路由内按原 main.ts 校验信息检查 */
const localProductUpdateSchema = z.object({
  title: z.string().max(200),
  descriptionText: z.string().max(200000).default(''),
  descriptionHtml: z.string().max(400000).default(''),
  price: z.string().max(40),
  currency: z.string().max(8),
  media: z.array(localProductMediaSchema).max(50)
})

// ---------------------------------------------------------------- 路由

/**
 * eBay 域 API（数据层）。权限映射：
 * 店铺扩展 store.manage；listing 同步/导入/目录同步/类目写入 collection.run；
 * 本地产品/视觉/标题/草稿/市场研究/内容优化 product.edit；标题交接/发布/验收/validate publish.run；
 * 读接口 = 已认证 + 店铺范围（storeScope）过滤。令牌记录不下发（无读取端点）。
 */
export async function ebayRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  const repoOf = (orgId: string) => new EbayRepository(orgId)

  const assertStoreAccess = (user: CurrentUser, storeId: string) => {
    if (!hasStoreAccess(user, storeId)) throw httpError(403, 'STORE_ACCESS_DENIED', '没有该店铺的访问权限')
  }

  /** 按店铺范围过滤读结果；storeId 指定且非 all 时先做访问断言 */
  const scopedList = <T extends { storeId: string }>(user: CurrentUser, items: T[], storeId?: string): T[] => {
    if (storeId && storeId !== 'all') {
      assertStoreAccess(user, storeId)
      return items
    }
    return user.storeScope === null ? items : items.filter(item => user.storeScope!.includes(item.storeId))
  }

  const audit = (request: { currentUser: CurrentUser; ip: string }, action: string, targetType: string, targetId: string, detail: Record<string, unknown>) =>
    writeAudit(prisma, { orgId: request.currentUser.orgId, userId: request.currentUser.id, action, targetType, targetId, detail, ip: request.ip })

  // ---------------- 店铺扩展 ----------------

  app.get('/stores', async request => {
    const stores = await repoOf(request.currentUser.orgId).getEbayStores()
    return request.currentUser.storeScope === null ? stores : stores.filter(store => request.currentUser.storeScope!.includes(store.id))
  })

  app.post('/stores', { preHandler: [app.requirePermission('store.manage')] }, async request => {
    const body = z.object({
      name: z.string().trim().min(1, '请填写店铺名称').max(50),
      username: z.string().default(''),
      encryptedPassword: z.string().default(''),
      marketplaceId: z.string().trim().min(1).default('EBAY_US')
    }).parse(request.body)
    const store = await repoOf(request.currentUser.orgId).createEbayStore(body.name, body.username, body.encryptedPassword, body.marketplaceId)
    await audit(request, 'ebay.store.create', 'store', store.id, { name: store.name, marketplaceId: store.marketplaceId })
    return store
  })

  app.put('/stores/:storeId/public-store', { preHandler: [app.requirePermission('collection.run')] }, async request => {
    const { storeId } = request.params as { storeId: string }
    assertStoreAccess(request.currentUser, storeId)
    const body = z.object({ publicStoreUrl: z.string().default(''), sellerId: z.string().default('') }).parse(request.body)
    await repoOf(request.currentUser.orgId).saveEbayPublicStore(storeId, body.publicStoreUrl, body.sellerId)
    return { ok: true }
  })

  app.put('/stores/:storeId/credential', { preHandler: [app.requirePermission('store.manage')] }, async request => {
    const { storeId } = request.params as { storeId: string }
    assertStoreAccess(request.currentUser, storeId)
    const body = z.object({ username: z.string().default(''), encryptedPassword: z.string().default(''), mode: z.string().default('AUTO_FILL') }).parse(request.body)
    await repoOf(request.currentUser.orgId).saveEbayStoreCredential(storeId, body.username, body.encryptedPassword, body.mode)
    await audit(request, 'ebay.store.credential', 'store', storeId, { username: body.username })
    return { ok: true }
  })

  app.post('/stores/:storeId/authorization', { preHandler: [app.requirePermission('store.manage')] }, async request => {
    const { storeId } = request.params as { storeId: string }
    assertStoreAccess(request.currentUser, storeId)
    const body = z.object({
      encryptedAccessToken: z.string().min(1),
      encryptedRefreshToken: z.string().min(1),
      accessTokenExpiresAt: z.string().min(1),
      refreshTokenExpiresAt: z.string().min(1)
    }).parse(request.body)
    await repoOf(request.currentUser.orgId).saveEbayAuthorization(storeId, body)
    await audit(request, 'ebay.store.authorization', 'store', storeId, {})
    return { ok: true }
  })

  app.put('/stores/:storeId/access-token', { preHandler: [app.requirePermission('store.manage')] }, async request => {
    const { storeId } = request.params as { storeId: string }
    assertStoreAccess(request.currentUser, storeId)
    const body = z.object({ encryptedAccessToken: z.string().min(1), expiresAt: z.string().min(1) }).parse(request.body)
    await repoOf(request.currentUser.orgId).updateEbayAccessToken(storeId, body.encryptedAccessToken, body.expiresAt)
    return { ok: true }
  })

  app.post('/stores/:storeId/sync-error', { preHandler: [app.requirePermission('collection.run')] }, async request => {
    const { storeId } = request.params as { storeId: string }
    assertStoreAccess(request.currentUser, storeId)
    const body = z.object({ message: z.string().min(1) }).parse(request.body)
    await repoOf(request.currentUser.orgId).setEbaySyncError(storeId, body.message)
    return { ok: true }
  })

  // ---------------- 线上产品（listing） ----------------

  app.get('/listings', async request => {
    const { storeId } = request.query as { storeId?: string }
    const listings = await repoOf(request.currentUser.orgId).getEbayListings(storeId)
    return scopedList(request.currentUser, listings, storeId)
  })

  app.post('/stores/:storeId/listings/sync', { preHandler: [app.requirePermission('collection.run')] }, async request => {
    const { storeId } = request.params as { storeId: string }
    assertStoreAccess(request.currentUser, storeId)
    const body = z.object({ listings: z.array(listingSchema) }).parse(request.body)
    await repoOf(request.currentUser.orgId).saveEbayListings(storeId, body.listings as EbayListing[])
    await audit(request, 'ebay.listings.sync', 'store', storeId, { count: body.listings.length })
    return { ok: true }
  })

  app.post('/stores/:storeId/listings/import-report', { preHandler: [app.requirePermission('collection.run')] }, async request => {
    const { storeId } = request.params as { storeId: string }
    assertStoreAccess(request.currentUser, storeId)
    const body = z.object({ listings: z.array(listingSchema) }).parse(request.body)
    const result = await repoOf(request.currentUser.orgId).importEbayListingsReport(storeId, body.listings as EbayListing[])
    await audit(request, 'ebay.listings.import-report', 'store', storeId, result as unknown as Record<string, unknown>)
    return result
  })

  app.post('/stores/:storeId/listings/import-collected', { preHandler: [app.requirePermission('collection.run')] }, async request => {
    const { storeId } = request.params as { storeId: string }
    assertStoreAccess(request.currentUser, storeId)
    const body = z.object({ marketplaceId: z.string().min(1), products: z.array(collectedProductSchema) }).parse(request.body)
    const result = await repoOf(request.currentUser.orgId).importEbayCollectedProducts(storeId, body.marketplaceId, body.products)
    await audit(request, 'ebay.listings.import-collected', 'store', storeId, result as unknown as Record<string, unknown>)
    return result
  })

  app.delete('/stores/:storeId/listings/:listingId', { preHandler: [app.requirePermission('product.edit')] }, async request => {
    const { storeId, listingId } = request.params as { storeId: string; listingId: string }
    assertStoreAccess(request.currentUser, storeId)
    await repoOf(request.currentUser.orgId).removeEbayListingLocal(storeId, listingId)
    await audit(request, 'ebay.listing.remove', 'store', storeId, { listingId })
    return { ok: true }
  })

  app.patch('/stores/:storeId/listings/:listingId/category', { preHandler: [app.requirePermission('product.edit')] }, async request => {
    const { storeId, listingId } = request.params as { storeId: string; listingId: string }
    assertStoreAccess(request.currentUser, storeId)
    const body = z.object({ categoryId: z.string().min(1) }).parse(request.body)
    return repoOf(request.currentUser.orgId).updateEbayListingCategory(storeId, listingId, body.categoryId)
  })

  app.patch('/stores/:storeId/listings/:listingId/details', { preHandler: [app.requirePermission('product.edit')] }, async request => {
    const { storeId, listingId } = request.params as { storeId: string; listingId: string }
    assertStoreAccess(request.currentUser, storeId)
    const body = productDetailsSchema.parse(request.body)
    return repoOf(request.currentUser.orgId).updateEbayListingDetails(storeId, listingId, body)
  })

  // ---------------- 目录产品同步 ----------------

  app.post('/stores/:storeId/directory-sync', { preHandler: [app.requirePermission('collection.run')] }, async request => {
    const { storeId } = request.params as { storeId: string }
    assertStoreAccess(request.currentUser, storeId)
    const body = z.object({
      marketplaceId: z.string().min(1),
      products: z.array(collectedProductSchema),
      scans: z.array(scanCategorySchema),
      errors: z.array(z.string()).default([])
    }).parse(request.body)
    const result = await repoOf(request.currentUser.orgId).syncEbayDirectoryProducts(storeId, body.marketplaceId, body.products, body.scans, body.errors)
    await audit(request, 'ebay.directory-sync', 'store', storeId, { runId: result.runId, status: result.errors.length ? 'PARTIAL' : 'SUCCESS', total: result.total })
    return result
  })

  app.post('/stores/:storeId/directory-sync/failure', { preHandler: [app.requirePermission('collection.run')] }, async request => {
    const { storeId } = request.params as { storeId: string }
    assertStoreAccess(request.currentUser, storeId)
    const body = z.object({ categoryCount: z.number().int().nonnegative().default(0), errors: z.array(z.string()).min(1) }).parse(request.body)
    return repoOf(request.currentUser.orgId).recordEbayProductSyncFailure(storeId, body.categoryCount, body.errors)
  })

  app.get('/stores/:storeId/directory-sync/runs', async request => {
    const { storeId } = request.params as { storeId: string }
    assertStoreAccess(request.currentUser, storeId)
    return repoOf(request.currentUser.orgId).getEbayProductSyncRuns(storeId)
  })

  app.get('/stores/:storeId/directory-sync/checkpoint-pending', async request => {
    const { storeId } = request.params as { storeId: string }
    assertStoreAccess(request.currentUser, storeId)
    const checkpoint = await repoOf(request.currentUser.orgId).getPendingEbayProductSyncCheckpoint(storeId)
    return checkpoint ?? null
  })

  app.post('/stores/:storeId/directory-sync/checkpoints', { preHandler: [app.requirePermission('collection.run')] }, async request => {
    const { storeId } = request.params as { storeId: string }
    assertStoreAccess(request.currentUser, storeId)
    const body = z.object({ categoryIds: z.array(z.string()), publicStoreUrl: z.string().default('') }).parse(request.body)
    return repoOf(request.currentUser.orgId).createEbayProductSyncCheckpoint(storeId, body.categoryIds, body.publicStoreUrl)
  })

  app.get('/directory-sync/checkpoints/:taskId', async request => {
    const { taskId } = request.params as { taskId: string }
    const checkpoint = await repoOf(request.currentUser.orgId).getEbayProductSyncCheckpointData(taskId)
    if (!checkpoint) throw httpError(404, 'CHECKPOINT_NOT_FOUND', '同步检查点不存在')
    assertStoreAccess(request.currentUser, checkpoint.storeId)
    return checkpoint
  })

  app.put('/directory-sync/checkpoints/:taskId/category', { preHandler: [app.requirePermission('collection.run')] }, async request => {
    const { taskId } = request.params as { taskId: string }
    const repo = repoOf(request.currentUser.orgId)
    const checkpoint = await repo.getEbayProductSyncCheckpointData(taskId)
    if (!checkpoint) throw httpError(404, 'CHECKPOINT_NOT_FOUND', '同步检查点不存在')
    assertStoreAccess(request.currentUser, checkpoint.storeId)
    const body = z.object({ scan: scanCategorySchema, products: z.array(collectedProductSchema), publicStoreUrl: z.string().default('') }).parse(request.body)
    await repo.saveEbayProductSyncCheckpointCategory(taskId, body.scan, body.products, body.publicStoreUrl)
    return { ok: true }
  })

  app.patch('/directory-sync/checkpoints/:taskId/status', { preHandler: [app.requirePermission('collection.run')] }, async request => {
    const { taskId } = request.params as { taskId: string }
    const repo = repoOf(request.currentUser.orgId)
    const checkpoint = await repo.getEbayProductSyncCheckpointData(taskId)
    if (!checkpoint) throw httpError(404, 'CHECKPOINT_NOT_FOUND', '同步检查点不存在')
    assertStoreAccess(request.currentUser, checkpoint.storeId)
    const body = checkpointStatusSchema.parse(request.body)
    await repo.setEbayProductSyncCheckpointStatus(taskId, body.status)
    return { ok: true }
  })

  app.delete('/directory-sync/checkpoints/:taskId', { preHandler: [app.requirePermission('collection.run')] }, async request => {
    const { taskId } = request.params as { taskId: string }
    const repo = repoOf(request.currentUser.orgId)
    const checkpoint = await repo.getEbayProductSyncCheckpointData(taskId)
    if (!checkpoint) throw httpError(404, 'CHECKPOINT_NOT_FOUND', '同步检查点不存在')
    assertStoreAccess(request.currentUser, checkpoint.storeId)
    await repo.deleteEbayProductSyncCheckpoint(taskId)
    return { ok: true }
  })

  // ---------------- 店铺目录（类目） ----------------

  app.get('/stores/:storeId/categories/workspace', async request => {
    const { storeId } = request.params as { storeId: string }
    assertStoreAccess(request.currentUser, storeId)
    return repoOf(request.currentUser.orgId).getEbayCategoryWorkspace(storeId)
  })

  app.put('/stores/:storeId/categories', { preHandler: [app.requirePermission('collection.run')] }, async request => {
    const { storeId } = request.params as { storeId: string }
    assertStoreAccess(request.currentUser, storeId)
    const body = z.object({ categories: z.array(storeCategorySchema).min(1) }).parse(request.body)
    const workspace = await repoOf(request.currentUser.orgId).saveEbayStoreCategories(storeId, body.categories.map(item => ({ ...item, storeId })))
    await audit(request, 'ebay.categories.save', 'store', storeId, { total: body.categories.length })
    return workspace
  })

  // ---------------- 本地产品库 / 快照 / 视觉检查 ----------------

  app.get('/local-products', async request => {
    const { storeId } = request.query as { storeId?: string }
    const products = await repoOf(request.currentUser.orgId).getEbayLocalProducts(storeId)
    return scopedList(request.currentUser, products, storeId)
  })

  app.get('/local-products/:localProductId/snapshots', async request => {
    const { localProductId } = request.params as { localProductId: string }
    const repo = repoOf(request.currentUser.orgId)
    const storeId = await repo.findLocalProductStoreId(localProductId)
    if (!storeId) throw httpError(404, 'LOCAL_PRODUCT_NOT_FOUND', '本地产品不存在或已删除')
    assertStoreAccess(request.currentUser, storeId)
    return repo.getEbayLocalProductSnapshots(localProductId)
  })

  app.post('/local-products/snapshots', { preHandler: [app.requirePermission('product.edit')] }, async request => {
    const body = snapshotInputSchema.parse(request.body)
    assertStoreAccess(request.currentUser, body.listing.storeId)
    const product = await repoOf(request.currentUser.orgId).saveEbayLocalProductSnapshot(body)
    await audit(request, 'ebay.local-product.snapshot', 'local_product', product.id, { listingId: product.listingId, version: product.versionCount })
    return product
  })

  app.delete('/local-products/:localProductId', { preHandler: [app.requirePermission('product.edit')] }, async request => {
    const { localProductId } = request.params as { localProductId: string }
    const repo = repoOf(request.currentUser.orgId)
    const storeId = await repo.findLocalProductStoreId(localProductId)
    if (!storeId) throw httpError(404, 'LOCAL_PRODUCT_NOT_FOUND', '本地产品不存在或已删除')
    assertStoreAccess(request.currentUser, storeId)
    await repo.removeEbayLocalProduct(localProductId)
    await audit(request, 'ebay.local-product.remove', 'local_product', localProductId, {})
    return { ok: true }
  })

  /**
   * 本地产品编辑：校验规则与快照构建移植自原 main.ts updateEbayLocalProduct。
   * 编辑不落字段补丁，而是以最新快照为底构建新版本快照（版本化审计与旧行为一致）。
   */
  app.patch('/local-products/:localProductId', { preHandler: [app.requirePermission('product.edit')] }, async request => {
    const { localProductId } = request.params as { localProductId: string }
    const repo = repoOf(request.currentUser.orgId)
    const product = await repo.getEbayLocalProduct(localProductId)
    if (!product) throw httpError(404, 'LOCAL_PRODUCT_NOT_FOUND', '本地产品不存在或已删除')
    assertStoreAccess(request.currentUser, product.storeId)
    const changes = localProductUpdateSchema.parse(request.body)
    const title = changes.title.trim()
    const validationErrors: string[] = []
    if (!title) validationErrors.push('物品标题不能为空')
    if (title.length > 80) validationErrors.push('物品标题不能超过 80 个字符')
    if (!changes.descriptionText.trim() && !changes.descriptionHtml.trim()) validationErrors.push('商品描述不能为空')
    if (!Number.isFinite(Number(changes.price)) || Number(changes.price) <= 0) validationErrors.push('价格必须是大于 0 的数字')
    if (!/^[A-Z]{3}$/.test(changes.currency.trim())) validationErrors.push('币种必须使用 3 位大写代码')
    const downloadedMedia = changes.media.filter(item => item.downloadStatus === 'DOWNLOADED' && item.localPath)
    if (!downloadedMedia.length) validationErrors.push('至少需要 1 张已保存到本地的商品图片')
    if (changes.media.length > 24) validationErrors.push('商品图片不能超过 24 张')
    if (downloadedMedia.some(item => item.width > 0 && item.height > 0 && Math.max(item.width, item.height) < 500)) validationErrors.push('存在最长边不足 500px 的商品图片')
    if (downloadedMedia.some(item => (item.fileSize || 0) > 12 * 1024 * 1024)) validationErrors.push('存在单张超过 12MB 的商品图片')
    if (downloadedMedia.some(item => !ebayImageFormatSupported(item.mimeType))) validationErrors.push('存在 eBay 不支持的商品图片格式')
    if (validationErrors.length) throw httpError(400, 'LOCAL_PRODUCT_INVALID', `本地刊登资料未通过校验：${validationErrors.join('；')}`)
    const capturedAt = new Date().toISOString()
    const listing: EbayListing = {
      ...product.snapshot.sourceListing,
      title,
      price: changes.price.trim(),
      currency: changes.currency.trim(),
      updatedAt: capturedAt
    }
    const details: EbayProductDetails = {
      url: product.snapshot.details.url,
      itemSpecifics: [],
      condition: '',
      imageUrls: changes.media.map(item => item.remoteUrl).filter(Boolean),
      title,
      descriptionText: changes.descriptionText.trim(),
      descriptionHtml: changes.descriptionHtml.trim(),
      price: listing.price,
      currency: listing.currency
    }
    const sourceMedia = new Map(product.snapshot.media.map(item => [item.id, item]))
    const media = changes.media.slice(0, 24).map((item, index) => ({ ...(sourceMedia.get(item.id) || item), sortOrder: index }) as EbayLocalProductMedia)
    const updated = await repo.saveEbayLocalProductSnapshot(completeEbayLocalSnapshot({ listing, details, media, capturedAt }))
    await audit(request, 'ebay.local-product.update', 'local_product', localProductId, { listingId: updated.listingId, version: updated.versionCount })
    return updated
  })

  app.get('/local-products/:localProductId/visual-inspection', async request => {
    const { localProductId } = request.params as { localProductId: string }
    const repo = repoOf(request.currentUser.orgId)
    const storeId = await repo.findLocalProductStoreId(localProductId)
    if (!storeId) throw httpError(404, 'LOCAL_PRODUCT_NOT_FOUND', '本地产品不存在或已删除')
    assertStoreAccess(request.currentUser, storeId)
    return repo.getEbayImageVisualInspection(localProductId)
  })

  app.post('/local-products/:localProductId/visual-inspection', { preHandler: [app.requirePermission('product.edit')] }, async request => {
    const { localProductId } = request.params as { localProductId: string }
    const repo = repoOf(request.currentUser.orgId)
    const storeId = await repo.findLocalProductStoreId(localProductId)
    if (!storeId) throw httpError(404, 'LOCAL_PRODUCT_NOT_FOUND', '本地产品不存在或已删除')
    assertStoreAccess(request.currentUser, storeId)
    const body = visualInspectionSaveSchema.parse(request.body)
    return repo.saveEbayImageVisualInspection(localProductId, body.snapshot as unknown as EbayLocalProductSnapshot, body.report as unknown as EbayImageVisualInspectionReport)
  })

  app.post('/visual-inspections/review', { preHandler: [app.requirePermission('product.edit')] }, async request => {
    const body = visualReviewSchema.parse(request.body)
    const repo = repoOf(request.currentUser.orgId)
    const storeId = await repo.findLocalProductStoreId(body.localProductId)
    if (!storeId) throw httpError(404, 'LOCAL_PRODUCT_NOT_FOUND', '本地产品不存在或已删除')
    assertStoreAccess(request.currentUser, storeId)
    const report = await repo.reviewEbayImageVisualRule({ ...body, reviewedBy: body.reviewedBy || request.currentUser.name })
    await audit(request, 'ebay.visual-inspection.review', 'local_product', body.localProductId, { mediaId: body.mediaId, rule: body.rule, decision: body.decision })
    return report
  })

  // ---------------- 市场研究 ----------------

  app.get('/stores/:storeId/listings/:listingId/market-research', async request => {
    const { storeId, listingId } = request.params as { storeId: string; listingId: string }
    assertStoreAccess(request.currentUser, storeId)
    const snapshot = await repoOf(request.currentUser.orgId).getEbayMarketResearch(storeId, listingId)
    return snapshot ?? null
  })

  app.get('/stores/:storeId/listings/:listingId/market-research/history', async request => {
    const { storeId, listingId } = request.params as { storeId: string; listingId: string }
    assertStoreAccess(request.currentUser, storeId)
    return repoOf(request.currentUser.orgId).getEbayMarketResearchHistory(storeId, listingId)
  })

  app.put('/market-research', { preHandler: [app.requirePermission('product.edit')] }, async request => {
    const body = marketResearchSnapshotSchema.parse(request.body)
    assertStoreAccess(request.currentUser, body.storeId)
    return repoOf(request.currentUser.orgId).saveEbayMarketResearch(body as unknown as EbayMarketResearchSnapshot)
  })

  app.post('/market-research/record', { preHandler: [app.requirePermission('product.edit')] }, async request => {
    const body = marketResearchSnapshotSchema.parse(request.body)
    assertStoreAccess(request.currentUser, body.storeId)
    return repoOf(request.currentUser.orgId).recordEbayMarketResearch(body as unknown as EbayMarketResearchSnapshot)
  })

  app.post('/market-research/decide', { preHandler: [app.requirePermission('product.edit')] }, async request => {
    const body = marketDecideSchema.parse(request.body)
    assertStoreAccess(request.currentUser, body.storeId)
    return repoOf(request.currentUser.orgId).decideEbayMarketResearchTerm(body)
  })

  // ---------------- 标题决策 / 交接 ----------------

  app.get('/stores/:storeId/listings/:listingId/title-decision', async request => {
    const { storeId, listingId } = request.params as { storeId: string; listingId: string }
    assertStoreAccess(request.currentUser, storeId)
    const decision = await repoOf(request.currentUser.orgId).getEbayTitleDecision(storeId, listingId)
    return decision ?? null
  })

  app.put('/title-decisions', { preHandler: [app.requirePermission('product.edit')] }, async request => {
    const body = titleDecisionSaveSchema.parse(request.body)
    assertStoreAccess(request.currentUser, body.input.storeId)
    const decision = await repoOf(request.currentUser.orgId).saveEbayTitleDecision(body.input as unknown as EbayTitleDecisionInput, body.audit)
    await audit(request, 'ebay.title-decision.save', 'store', body.input.storeId, { listingId: body.input.listingId })
    return decision
  })

  app.get('/stores/:storeId/listings/:listingId/title-handoff', async request => {
    const { storeId, listingId } = request.params as { storeId: string; listingId: string }
    assertStoreAccess(request.currentUser, storeId)
    const handoff = await repoOf(request.currentUser.orgId).getEbayTitleHandoff(storeId, listingId)
    return handoff ?? null
  })

  app.put('/title-handoffs', { preHandler: [app.requirePermission('publish.run')] }, async request => {
    const body = titleHandoffSchema.parse(request.body)
    assertStoreAccess(request.currentUser, body.storeId)
    return repoOf(request.currentUser.orgId).saveEbayTitleHandoff(body as unknown as EbayTitleHandoff)
  })

  // ---------------- 内容优化记录 ----------------

  app.get('/stores/:storeId/listings/:listingId/content-optimization', async request => {
    const { storeId, listingId } = request.params as { storeId: string; listingId: string }
    assertStoreAccess(request.currentUser, storeId)
    const record = await repoOf(request.currentUser.orgId).getEbayContentOptimizationRecord(storeId, listingId)
    return record ?? null
  })

  app.put('/content-optimizations', { preHandler: [app.requirePermission('product.edit')] }, async request => {
    const body = contentRecordSchema.parse(request.body)
    assertStoreAccess(request.currentUser, body.storeId)
    return repoOf(request.currentUser.orgId).saveEbayContentOptimizationRecord(body as unknown as EbayContentOptimizationRecordInput)
  })

  // ---------------- 优化草稿 / 合规验证 ----------------

  app.get('/drafts', async request => {
    const { storeId } = request.query as { storeId?: string }
    const drafts = await repoOf(request.currentUser.orgId).getEbayOptimizationDrafts(storeId || undefined)
    return scopedList(request.currentUser, drafts, storeId)
  })

  app.get('/drafts/:draftId', async request => {
    const { draftId } = request.params as { draftId: string }
    const draft = await repoOf(request.currentUser.orgId).getEbayOptimizationDraft(draftId)
    if (!draft) throw httpError(404, 'DRAFT_NOT_FOUND', '优品草稿不存在，请刷新后重试')
    assertStoreAccess(request.currentUser, draft.storeId)
    return draft
  })

  app.put('/drafts', { preHandler: [app.requirePermission('product.edit')] }, async request => {
    const body = draftInputSchema.parse(request.body)
    assertStoreAccess(request.currentUser, body.storeId)
    const draft = await repoOf(request.currentUser.orgId).saveEbayOptimizationDraft(body as unknown as EbayOptimizationDraftInput)
    await audit(request, 'ebay.draft.save', 'store', body.storeId, { listingId: body.listingId, draftId: draft.id })
    return draft
  })

  app.post('/drafts/:draftId/validate', { preHandler: [app.requirePermission('publish.run')] }, async request => {
    const { draftId } = request.params as { draftId: string }
    const repo = repoOf(request.currentUser.orgId)
    const draft = await repo.getEbayOptimizationDraft(draftId)
    if (!draft) throw httpError(404, 'DRAFT_NOT_FOUND', '优品草稿不存在，请刷新后重试')
    assertStoreAccess(request.currentUser, draft.storeId)
    const result = await repo.validateEbayOptimizationDraft(draftId)
    await audit(request, 'ebay.draft.validate', 'store', draft.storeId, { draftId, gateStatus: result.check.gateStatus, publishAllowed: result.publishAllowed })
    return result
  })

  // ---------------- 发布任务 / 验收 ----------------

  app.get('/publish-tasks', async request => {
    const { storeId } = request.query as { storeId?: string }
    const tasks = await repoOf(request.currentUser.orgId).getEbayPublishTasks(storeId || undefined)
    return scopedList(request.currentUser, tasks, storeId)
  })

  app.put('/publish-tasks', { preHandler: [app.requirePermission('publish.run')] }, async request => {
    const body = publishTaskSchema.parse(request.body)
    assertStoreAccess(request.currentUser, body.storeId)
    const task = await repoOf(request.currentUser.orgId).saveEbayPublishTask(body as unknown as EbayPublishTask)
    await audit(request, 'ebay.publish-task.save', 'store', body.storeId, { taskId: task.id, status: task.status })
    return task
  })

  app.get('/stores/:storeId/acceptance-batches', async request => {
    const { storeId } = request.params as { storeId: string }
    assertStoreAccess(request.currentUser, storeId)
    return repoOf(request.currentUser.orgId).getEbayAcceptanceBatches(storeId)
  })

  app.post('/acceptance-batches', { preHandler: [app.requirePermission('publish.run')] }, async request => {
    const body = acceptanceBatchSchema.parse(request.body)
    assertStoreAccess(request.currentUser, body.storeId)
    const batch = await repoOf(request.currentUser.orgId).saveEbayAcceptanceBatch(body as unknown as EbayAcceptanceBatch)
    await audit(request, 'ebay.acceptance.save', 'store', body.storeId, { batchId: batch.id, status: batch.status })
    return batch
  })
}
