import { randomUUID } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { httpError } from '../../lib/errors.js'
import { ComplianceRepository } from '../compliance/repository.js'
import { complianceCheckFingerprint } from '../compliance/engine.js'
import type { ComplianceCheckRequest } from '../compliance/types.js'
import { ebayCountryForMarketplace, rebuildEbayImageVisualReport, uniqueEbayImages } from './utils.js'
import type {
  EbayAcceptanceBatch,
  EbayCategoryChange,
  EbayCategorySyncSummary,
  EbayCategoryWorkspace,
  EbayCollectedProduct,
  EbayCollectionImportResult,
  EbayContentOptimizationRecord,
  EbayContentOptimizationRecordInput,
  EbayDirectoryProductScanCategory,
  EbayDirectoryProductSyncCheckpoint,
  EbayDirectoryProductSyncResult,
  EbayImageVisualInspectionReport,
  EbayImageVisualReviewInput,
  EbayListing,
  EbayListingsReportImportResult,
  EbayLocalProduct,
  EbayLocalProductSnapshot,
  EbayLocalProductSnapshotInput,
  EbayMarketResearchDecisionRequest,
  EbayMarketResearchSnapshot,
  EbayOptimizationDraft,
  EbayOptimizationDraftInput,
  EbayProductSyncChange,
  EbayProductSyncCheckpointData,
  EbayProductSyncRun,
  EbayProductDetails,
  EbayPublishComplianceValidation,
  EbayPublishTask,
  EbayStore,
  EbayStoreCategory,
  EbayTitleDecision,
  EbayTitleDecisionInput,
  EbayTitleHandoff
} from './types.js'

type Db = PrismaClient | Prisma.TransactionClient

const CHECKPOINT_ACTIVE_STATUSES = ['RUNNING', 'PAUSED', 'INTERRUPTED', 'NEEDS_ATTENTION']

/**
 * eBay 域仓储：从 AppDatabase.ts eBay 段（原 1574-2257 行）忠实移植。
 * 差异：全部查询强制 orgId 过滤；JSON 列由 Prisma Json 原生承载；
 * BEGIN IMMEDIATE → prisma.$transaction；多语句写操作包裹事务保证多用户下的原子性。
 * 范围：仅数据层。浏览器动作留客户端；AI 调用走 AI 网关；令牌记录不下发（无读取端点）。
 */
export class EbayRepository {
  constructor(
    private readonly orgId: string,
    private readonly db: Db = prisma
  ) {}

  /** 在事务中执行；若当前实例已处于事务则直接复用 */
  private inTx<T>(fn: (repo: EbayRepository) => Promise<T>): Promise<T> {
    if (this.db !== prisma) return fn(this)
    return prisma.$transaction(tx => fn(new EbayRepository(this.orgId, tx)), { timeout: 30000 })
  }

  // ---------------------------------------------------------------- 店铺扩展

  async getEbayStores(): Promise<EbayStore[]> {
    const stores = await this.db.ebayStore.findMany({ where: { orgId: this.orgId }, orderBy: { createdAt: 'asc' } })
    if (!stores.length) return []
    const storeIds = stores.map(store => store.id)
    const credentials = await this.db.marketplaceAccountCredential.findMany({
      where: { orgId: this.orgId, accountId: { in: storeIds.map(id => `ebay:${id}`) } }
    })
    const credentialMap = new Map(credentials.map(row => [row.accountId, row]))
    const counts = await this.db.ebayListing.groupBy({
      by: ['storeId'],
      where: { orgId: this.orgId, storeId: { in: storeIds }, status: 'ACTIVE' },
      _count: { _all: true }
    })
    const countMap = new Map(counts.map(row => [row.storeId, row._count._all]))
    return stores.map(store => {
      const credential = credentialMap.get(`ebay:${store.id}`)
      return {
        id: store.id,
        name: store.name,
        sellerId: store.sellerId,
        publicStoreUrl: store.publicStoreUrl || '',
        publicStoreVerifiedAt: store.publicStoreVerifiedAt || undefined,
        loginUsername: credential?.username || '',
        passwordSaved: Boolean(credential?.encryptedPassword),
        marketplaceId: store.marketplaceId,
        status: store.status as EbayStore['status'],
        lastSyncAt: store.lastSyncAt || undefined,
        syncError: store.syncError || undefined,
        listingCount: countMap.get(store.id) || 0
      }
    })
  }

  private async requireStore(storeId: string) {
    const store = await this.db.ebayStore.findFirst({ where: { id: storeId, orgId: this.orgId }, select: { id: true } })
    if (!store) throw httpError(404, 'STORE_NOT_FOUND', '店铺不存在')
    return store
  }

  async createEbayStore(name: string, username: string, encryptedPassword: string, marketplaceId = 'EBAY_US'): Promise<EbayStore> {
    const id = randomUUID()
    const now = new Date().toISOString()
    await this.inTx(async repo => {
      await repo.db.ebayStore.create({
        data: { id, orgId: repo.orgId, name, sellerId: '待同步', marketplaceId, status: 'PENDING' }
      })
      await repo.db.marketplaceAccountCredential.create({
        data: { accountId: `ebay:${id}`, orgId: repo.orgId, platformCode: 'EBAY', username, encryptedPassword, automationMode: 'AUTO_FILL', updatedAt: now }
      })
    })
    const store = (await this.getEbayStores()).find(item => item.id === id)
    if (!store) throw httpError(500, 'STORE_CREATE_FAILED', '店铺创建失败')
    return store
  }

  async saveEbayPublicStore(storeId: string, publicStoreUrl: string, sellerId = '') {
    const now = new Date().toISOString()
    const previous = await this.db.ebayStore.findFirst({ where: { id: storeId, orgId: this.orgId }, select: { publicStoreUrl: true } })
    if (!previous) throw httpError(404, 'STORE_NOT_FOUND', '店铺不存在')
    await this.inTx(async repo => {
      await repo.db.ebayStore.update({
        where: { id: storeId },
        data: { publicStoreUrl, publicStoreVerifiedAt: now, ...(sellerId ? { sellerId } : {}) }
      })
      if (publicStoreUrl && previous.publicStoreUrl !== publicStoreUrl) {
        await repo.db.ebayStoreUrlHistory.create({
          data: { id: randomUUID(), orgId: repo.orgId, storeId, publicStoreUrl, changeType: previous.publicStoreUrl ? 'CHANGED' : 'DISCOVERED', verifiedAt: now }
        })
      }
    })
  }

  /** 保存 eBay 店铺登录凭据（密文由客户端加密后上传；空密码保留原值，与原版一致） */
  async saveEbayStoreCredential(storeId: string, username: string, encryptedPassword: string, mode = 'AUTO_FILL') {
    await this.requireStore(storeId)
    const accountId = `ebay:${storeId}`
    const now = new Date().toISOString()
    const existing = await this.db.marketplaceAccountCredential.findUnique({ where: { accountId } })
    await this.db.marketplaceAccountCredential.upsert({
      where: { accountId },
      create: { accountId, orgId: this.orgId, platformCode: 'EBAY', username, encryptedPassword, automationMode: mode, updatedAt: now },
      update: {
        username,
        encryptedPassword: encryptedPassword === '' ? existing?.encryptedPassword ?? '' : encryptedPassword,
        automationMode: mode,
        updatedAt: now
      }
    })
  }

  async saveEbayAuthorization(storeId: string, input: { encryptedAccessToken: string; encryptedRefreshToken: string; accessTokenExpiresAt: string; refreshTokenExpiresAt: string }) {
    await this.requireStore(storeId)
    await this.db.ebayStore.update({
      where: { id: storeId },
      data: {
        status: 'CONNECTED',
        encryptedAccessToken: input.encryptedAccessToken,
        encryptedRefreshToken: input.encryptedRefreshToken,
        accessTokenExpiresAt: input.accessTokenExpiresAt,
        refreshTokenExpiresAt: input.refreshTokenExpiresAt,
        syncError: null
      }
    })
  }

  async updateEbayAccessToken(storeId: string, encryptedAccessToken: string, expiresAt: string) {
    await this.requireStore(storeId)
    await this.db.ebayStore.update({
      where: { id: storeId },
      data: { encryptedAccessToken, accessTokenExpiresAt: expiresAt }
    })
  }

  async setEbaySyncError(storeId: string, message: string) {
    await this.requireStore(storeId)
    await this.db.ebayStore.update({ where: { id: storeId }, data: { status: 'ERROR', syncError: message } })
  }

  // ---------------------------------------------------------------- 线上产品（listing）

  async saveEbayListings(storeId: string, listings: EbayListing[]) {
    await this.requireStore(storeId)
    await this.inTx(async repo => {
      const now = new Date().toISOString()
      await repo.db.ebayListing.updateMany({ where: { orgId: repo.orgId, storeId }, data: { status: 'ENDED', updatedAt: now } })
      for (const item of listings) {
        const canonical: EbayListing = {
          ...item,
          imageUrls: item.imageUrls?.length ? item.imageUrls : (item.imageUrl ? [item.imageUrl] : []),
          originalTitle: item.originalTitle || item.title,
          originalTitleVerified: true,
          titleSource: 'EBAY_API'
        }
        await repo.upsertListing(canonical, { forceActive: false })
      }
      await repo.db.ebayStore.update({ where: { id: storeId }, data: { lastSyncAt: now, syncError: null, status: 'CONNECTED' } })
    })
  }

  /** listing 窄列 + payload 整体 upsert（对应原版 save 预处理语句）；forceActive 对应 importReport/collected 的 status='ACTIVE' 语义 */
  private async upsertListing(canonical: EbayListing, options: { forceActive: boolean; touchSkuQuantity?: boolean }) {
    const payload = canonical as unknown as Prisma.JsonObject
    const update: Prisma.EbayListingUpdateInput = {
      title: canonical.title,
      price: canonical.price,
      currency: canonical.currency,
      imageUrl: canonical.imageUrl,
      categoryId: canonical.categoryId,
      categoryName: canonical.categoryName,
      status: options.forceActive ? 'ACTIVE' : canonical.status,
      viewUrl: canonical.viewUrl,
      payload,
      updatedAt: canonical.updatedAt
    }
    if (options.touchSkuQuantity !== false) {
      update.sku = canonical.sku
      update.quantity = canonical.quantity
    }
    await this.db.ebayListing.upsert({
      where: { id: canonical.id },
      create: {
        id: canonical.id,
        orgId: this.orgId,
        storeId: canonical.storeId,
        marketplaceId: canonical.marketplaceId,
        listingId: canonical.listingId,
        sku: canonical.sku,
        title: canonical.title,
        price: canonical.price,
        currency: canonical.currency,
        quantity: canonical.quantity,
        imageUrl: canonical.imageUrl,
        categoryId: canonical.categoryId,
        categoryName: canonical.categoryName,
        status: canonical.status,
        viewUrl: canonical.viewUrl,
        payload,
        updatedAt: canonical.updatedAt
      },
      update
    })
  }

  async importEbayListingsReport(storeId: string, listings: EbayListing[]): Promise<EbayListingsReportImportResult> {
    await this.requireStore(storeId)
    return this.inTx(async repo => {
      const existingRows = await repo.db.ebayListing.findMany({ where: { orgId: repo.orgId, storeId }, select: { id: true } })
      const existing = new Set(existingRows.map(row => row.id))
      let imported = 0
      let updated = 0
      for (const item of listings) {
        if (existing.has(item.id)) updated += 1
        else { imported += 1; existing.add(item.id) }
        const canonical: EbayListing = {
          ...item,
          imageUrls: item.imageUrls?.length ? item.imageUrls : (item.imageUrl ? [item.imageUrl] : []),
          originalTitle: item.originalTitle || item.title,
          originalTitleVerified: true,
          titleSource: 'EBAY_REPORT'
        }
        await repo.upsertListing(canonical, { forceActive: true })
      }
      const now = new Date().toISOString()
      await repo.db.ebayStore.update({ where: { id: storeId }, data: { lastSyncAt: now, syncError: null } })
      const total = await repo.db.ebayListing.count({ where: { orgId: repo.orgId, storeId, status: 'ACTIVE' } })
      return { imported, updated, total, importedAt: now }
    })
  }

  async importEbayCollectedProducts(storeId: string, marketplaceId: string, products: EbayCollectedProduct[]): Promise<EbayCollectionImportResult> {
    await this.requireStore(storeId)
    return this.inTx(async repo => {
      const now = new Date().toISOString()
      const existingRows = await repo.db.ebayListing.findMany({
        where: { orgId: repo.orgId, storeId, status: 'ACTIVE' },
        select: { id: true, listingId: true, payload: true }
      })
      const existing = new Map(existingRows.map(row => [row.listingId, row]))
      const categories = await repo.activeEbayCategories(storeId)
      let imported = 0
      let duplicates = 0
      for (const product of products) {
        const sourceTitle = (product.originalTitle || product.title).trim()
        const existingRow = existing.get(product.listingId)
        if (existingRow) {
          if (product.originalTitle && product.originalTitleVerified) {
            const payload = existingRow.payload as unknown as EbayListing
            const refreshed: EbayListing = {
              ...payload,
              title: sourceTitle,
              originalTitle: sourceTitle,
              translatedTitle: product.translatedTitle || payload.translatedTitle,
              originalTitleVerified: true,
              titleSource: product.titleSource,
              updatedAt: now
            }
            await repo.db.ebayListing.update({
              where: { id: existingRow.id },
              data: { title: refreshed.title, payload: refreshed as unknown as Prisma.JsonObject, updatedAt: now }
            })
          }
          duplicates += 1
          continue
        }
        const matched = repo.matchEbayCategory(categories, product.categoryId, product.categoryName, product.title)
        const item: EbayListing = {
          id: `${storeId}:${marketplaceId}:${product.listingId}`,
          storeId,
          marketplaceId,
          listingId: product.listingId,
          sku: '',
          title: sourceTitle,
          originalTitle: product.originalTitleVerified ? sourceTitle : undefined,
          translatedTitle: product.translatedTitle || '',
          originalTitleVerified: Boolean(product.originalTitleVerified),
          titleSource: product.titleSource || 'UNVERIFIED_PAGE_TEXT',
          price: product.price,
          currency: product.currency,
          quantity: 0,
          imageUrl: product.imageUrl,
          imageUrls: product.imageUrl ? [product.imageUrl] : [],
          categoryId: matched?.categoryId || '',
          categoryName: matched?.name || '',
          status: 'ACTIVE',
          viewUrl: product.url,
          updatedAt: now
        }
        await repo.upsertListing(item, { forceActive: true })
        existing.set(product.listingId, { id: item.id, listingId: item.listingId, payload: item as unknown as Prisma.JsonValue })
        imported += 1
      }
      await repo.reconcileEbayListingCategories(storeId)
      await repo.db.ebayStore.update({ where: { id: storeId }, data: { updatedAt: new Date() } })
      const total = await repo.db.ebayListing.count({ where: { orgId: repo.orgId, storeId, status: 'ACTIVE' } })
      return { imported, duplicates, total }
    })
  }

  async getEbayListings(storeId?: string): Promise<EbayListing[]> {
    if (storeId && storeId !== 'all') {
      await this.reconcileEbayListingCategories(storeId)
      const rows = await this.db.ebayListing.findMany({
        where: { orgId: this.orgId, storeId, status: 'ACTIVE' },
        orderBy: { updatedAt: 'desc' }
      })
      return rows.map(row => row.payload as unknown as EbayListing)
    }
    const stores = await this.db.ebayStore.findMany({ where: { orgId: this.orgId }, select: { id: true } })
    for (const store of stores) await this.reconcileEbayListingCategories(store.id)
    const rows = await this.db.ebayListing.findMany({
      where: { orgId: this.orgId, status: 'ACTIVE' },
      orderBy: { updatedAt: 'desc' }
    })
    return rows.map(row => row.payload as unknown as EbayListing)
  }

  async removeEbayListingLocal(storeId: string, listingId: string) {
    const row = await this.db.ebayListing.findFirst({
      where: { orgId: this.orgId, storeId, listingId, status: 'ACTIVE' },
      select: { id: true }
    })
    if (!row) throw httpError(404, 'LISTING_NOT_FOUND', '线上产品不存在，或已从本地产品库移除')
    await this.inTx(async repo => {
      await repo.db.ebayTitleDecision.deleteMany({ where: { orgId: repo.orgId, storeId, listingId } })
      await repo.db.ebayTitleHandoff.deleteMany({ where: { orgId: repo.orgId, storeId, listingId } })
      await repo.db.ebayListing.delete({ where: { id: row.id } })
    })
    return true
  }

  // ---------------------------------------------------------------- 店铺目录（类目）

  private async activeEbayCategories(storeId: string) {
    const rows = await this.db.ebayStoreCategory.findMany({
      where: { orgId: this.orgId, storeId, status: 'ACTIVE', categoryId: { not: { startsWith: 'collected:' } } },
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }],
      select: { categoryId: true, name: true, listingCount: true }
    })
    return rows
  }

  private normalizeEbayCategoryName(value: string) {
    return value.toLocaleLowerCase().replace(/[\s·•_\-/\\]+/g, '').replace(/[()（）]/g, '').trim()
  }

  private matchEbayCategory(categories: Array<{ categoryId: string; name: string; listingCount: number }>, categoryId: string, categoryName: string, title: string) {
    const direct = categories.find(item => item.categoryId === categoryId)
    if (direct) return direct
    const normalizedName = this.normalizeEbayCategoryName(categoryName)
    if (normalizedName && !/^\d+$/.test(normalizedName) && !/^allitems$|^全部物品$/.test(normalizedName)) {
      const byName = categories.find(item => this.normalizeEbayCategoryName(item.name) === normalizedName)
      if (byName) return byName
    }
    const normalizedTitle = this.normalizeEbayCategoryName(title)
    const byTitle = categories.filter(item => {
      const name = this.normalizeEbayCategoryName(item.name)
      return name.length >= 3 && normalizedTitle.includes(name)
    })
    if (byTitle.length === 1) return byTitle[0]
    const populated = categories.filter(item => Number(item.listingCount) > 0)
    if (populated.length === 1) return populated[0]
    if (categories.length === 1) return categories[0]
    return undefined
  }

  private async reconcileEbayListingCategories(storeId: string) {
    const categories = await this.activeEbayCategories(storeId)
    if (!categories.length) return 0
    const rows = await this.db.ebayListing.findMany({
      where: { orgId: this.orgId, storeId, status: 'ACTIVE' },
      select: { id: true, categoryId: true, categoryName: true, title: true, payload: true }
    })
    let changed = 0
    for (const row of rows) {
      const matched = this.matchEbayCategory(categories, row.categoryId, row.categoryName, row.title)
      if (!matched || (row.categoryId === matched.categoryId && row.categoryName === matched.name)) continue
      let payload: Record<string, unknown>
      try { payload = row.payload as Record<string, unknown> } catch { payload = {} }
      payload.categoryId = matched.categoryId
      payload.categoryName = matched.name
      const updatedAt = new Date().toISOString()
      payload.updatedAt = updatedAt
      await this.db.ebayListing.update({
        where: { id: row.id },
        data: { categoryId: matched.categoryId, categoryName: matched.name, payload: payload as Prisma.JsonObject, updatedAt }
      })
      changed += 1
    }
    if (changed) {
      await this.db.ebayStoreCategory.deleteMany({
        where: { orgId: this.orgId, storeId, categoryId: { startsWith: 'collected:' } }
      })
    }
    return changed
  }

  async updateEbayListingCategory(storeId: string, listingId: string, categoryId: string): Promise<EbayListing> {
    const category = await this.db.ebayStoreCategory.findFirst({
      where: { orgId: this.orgId, storeId, status: 'ACTIVE', categoryId: { equals: categoryId, not: { startsWith: 'collected:' } } },
      select: { categoryId: true, name: true }
    })
    if (!category) throw httpError(400, 'CATEGORY_NOT_FOUND', '所选eBay店铺目录不存在，请先重新同步目录')
    const row = await this.db.ebayListing.findFirst({
      where: { orgId: this.orgId, storeId, listingId, status: 'ACTIVE' },
      select: { id: true, payload: true }
    })
    if (!row) throw httpError(404, 'LISTING_NOT_FOUND', '线上产品不存在或已经下架')
    const now = new Date().toISOString()
    let payload: Record<string, unknown>
    try { payload = row.payload as Record<string, unknown> } catch { payload = {} }
    payload.categoryId = category.categoryId
    payload.categoryName = category.name
    payload.updatedAt = now
    await this.db.ebayListing.update({
      where: { id: row.id },
      data: { categoryId: category.categoryId, categoryName: category.name, payload: payload as Prisma.JsonObject, updatedAt: now }
    })
    return payload as unknown as EbayListing
  }

  async updateEbayListingDetails(storeId: string, listingId: string, details: EbayProductDetails): Promise<EbayListing> {
    const row = await this.db.ebayListing.findFirst({
      where: { orgId: this.orgId, storeId, listingId, status: 'ACTIVE' },
      select: { id: true, payload: true }
    })
    if (!row) throw httpError(404, 'LISTING_NOT_FOUND', '线上产品不存在或已经下架')
    const now = new Date().toISOString()
    let payload: Record<string, unknown>
    try { payload = row.payload as Record<string, unknown> } catch { payload = {} }
    payload.itemSpecifics = details.itemSpecifics
    payload.condition = details.condition
    const previousImages = Array.isArray(payload.imageUrls) ? (payload.imageUrls as unknown[]).filter((value): value is string => typeof value === 'string' && Boolean(value)) : []
    const currentImage = typeof payload.imageUrl === 'string' && payload.imageUrl ? payload.imageUrl : ''
    const imageUrls = uniqueEbayImages([...details.imageUrls, ...previousImages, currentImage])
    payload.imageUrls = imageUrls
    if (imageUrls[0]) payload.imageUrl = imageUrls[0]
    const livePrice = String(details.price || '').replace(/[^0-9.,-]/g, '').replace(/,/g, '')
    if (Number.isFinite(Number(livePrice)) && Number(livePrice) > 0) payload.price = livePrice
    if (details.currency?.trim()) payload.currency = details.currency.trim().toUpperCase()
    payload.updatedAt = now
    await this.db.ebayListing.update({
      where: { id: row.id },
      data: {
        price: String(payload.price || ''),
        currency: String(payload.currency || 'USD'),
        imageUrl: String(payload.imageUrl || ''),
        payload: payload as Prisma.JsonObject,
        updatedAt: now
      }
    })
    return payload as unknown as EbayListing
  }

  // ---------------------------------------------------------------- 目录同步检查点

  async createEbayProductSyncCheckpoint(storeId: string, categoryIds: string[], publicStoreUrl: string): Promise<EbayProductSyncCheckpointData> {
    await this.requireStore(storeId)
    const taskId = randomUUID()
    const now = new Date().toISOString()
    await this.db.ebayProductSyncCheckpoint.create({
      data: {
        taskId,
        orgId: this.orgId,
        storeId,
        status: 'RUNNING',
        categoryIds: categoryIds as unknown as Prisma.JsonArray,
        completedCategoryIds: [],
        failedCategoryIds: [],
        products: [],
        scans: [],
        publicStoreUrl,
        startedAt: now,
        updatedAt: now
      }
    })
    const checkpoint = await this.getEbayProductSyncCheckpointData(taskId)
    if (!checkpoint) throw httpError(500, 'CHECKPOINT_CREATE_FAILED', '同步检查点创建失败')
    return checkpoint
  }

  async getEbayProductSyncCheckpointData(taskId: string): Promise<EbayProductSyncCheckpointData | undefined> {
    const row = await this.db.ebayProductSyncCheckpoint.findFirst({ where: { taskId, orgId: this.orgId } })
    if (!row) return undefined
    return {
      taskId: row.taskId,
      storeId: row.storeId,
      status: row.status as EbayProductSyncCheckpointData['status'],
      categoryIds: row.categoryIds as unknown as string[],
      completedCategoryIds: row.completedCategoryIds as unknown as string[],
      failedCategoryIds: row.failedCategoryIds as unknown as string[],
      products: row.products as unknown as EbayCollectedProduct[],
      scans: row.scans as unknown as EbayDirectoryProductScanCategory[],
      publicStoreUrl: row.publicStoreUrl || '',
      startedAt: row.startedAt,
      updatedAt: row.updatedAt
    }
  }

  async getPendingEbayProductSyncCheckpoint(storeId: string): Promise<EbayDirectoryProductSyncCheckpoint | undefined> {
    const row = await this.db.ebayProductSyncCheckpoint.findFirst({
      where: { orgId: this.orgId, storeId, status: { in: CHECKPOINT_ACTIVE_STATUSES } },
      orderBy: { updatedAt: 'desc' },
      select: { taskId: true }
    })
    const checkpoint = row ? await this.getEbayProductSyncCheckpointData(row.taskId) : undefined
    if (!checkpoint) return undefined
    return {
      taskId: checkpoint.taskId,
      storeId: checkpoint.storeId,
      status: checkpoint.status,
      categoryIds: checkpoint.categoryIds,
      completedCategoryIds: checkpoint.completedCategoryIds,
      failedCategoryIds: checkpoint.failedCategoryIds,
      publicStoreUrl: checkpoint.publicStoreUrl,
      startedAt: checkpoint.startedAt,
      updatedAt: checkpoint.updatedAt
    }
  }

  async saveEbayProductSyncCheckpointCategory(taskId: string, scan: EbayDirectoryProductScanCategory, products: EbayCollectedProduct[], publicStoreUrl: string) {
    const checkpoint = await this.getEbayProductSyncCheckpointData(taskId)
    if (!checkpoint) return
    const productMap = new Map(checkpoint.products.map(item => [item.listingId, item]))
    products.forEach(item => productMap.set(item.listingId, item))
    const scans = [...checkpoint.scans.filter(item => item.categoryId !== scan.categoryId), scan]
    const completed = scan.complete ? [...new Set([...checkpoint.completedCategoryIds, scan.categoryId])] : checkpoint.completedCategoryIds.filter(id => id !== scan.categoryId)
    const failed = scans.filter(item => !item.complete).map(item => item.categoryId)
    await this.db.ebayProductSyncCheckpoint.update({
      where: { taskId },
      data: {
        completedCategoryIds: completed as unknown as Prisma.JsonArray,
        failedCategoryIds: failed as unknown as Prisma.JsonArray,
        products: [...productMap.values()] as unknown as Prisma.JsonArray,
        scans: scans as unknown as Prisma.JsonArray,
        publicStoreUrl,
        updatedAt: new Date().toISOString()
      }
    })
  }

  async setEbayProductSyncCheckpointStatus(taskId: string, status: EbayDirectoryProductSyncCheckpoint['status']) {
    await this.db.ebayProductSyncCheckpoint.updateMany({
      where: { taskId, orgId: this.orgId },
      data: { status, updatedAt: new Date().toISOString() }
    })
  }

  async deleteEbayProductSyncCheckpoint(taskId: string) {
    await this.db.ebayProductSyncCheckpoint.deleteMany({ where: { taskId, orgId: this.orgId } })
  }

  // ---------------------------------------------------------------- 目录产品同步

  async syncEbayDirectoryProducts(
    storeId: string,
    marketplaceId: string,
    products: EbayCollectedProduct[],
    scans: EbayDirectoryProductScanCategory[],
    errors: string[]
  ): Promise<Omit<EbayDirectoryProductSyncResult, 'publicStoreUrl' | 'failedCategoryIds'>> {
    await this.requireStore(storeId)
    return this.inTx(async repo => {
      const now = new Date().toISOString()
      const runId = randomUUID()
      const rows = await repo.db.ebayListing.findMany({
        where: { orgId: repo.orgId, storeId },
        select: { id: true, listingId: true, payload: true, status: true }
      })
      const existing = new Map(rows.map(row => [row.listingId, row]))
      const draftRows = await repo.db.ebayOptimizationDraft.findMany({ where: { orgId: repo.orgId, storeId }, select: { listingId: true } })
      const protectedListingIds = new Set(draftRows.map(row => row.listingId))
      const protectedOptimizations = new Set<string>()
      const categories = await repo.activeEbayCategories(storeId)
      let imported = 0
      let updated = 0
      let unchanged = 0
      let ended = 0
      let reactivated = 0
      let moved = 0
      let suspectedEnded = 0
      const changes: EbayProductSyncChange[] = []
      for (const product of products) {
        const sourceTitle = (product.originalTitle || product.title).trim()
        const matched = repo.matchEbayCategory(categories, product.categoryId, product.categoryName, sourceTitle)
        const categoryId = matched?.categoryId || product.categoryId || ''
        const categoryName = matched?.name || product.categoryName || ''
        const previous = existing.get(product.listingId)
        let previousPayload: EbayListing | undefined
        if (previous) {
          try { previousPayload = previous.payload as unknown as EbayListing } catch { previousPayload = undefined }
        }
        const item: EbayListing = {
          ...(previousPayload || {} as EbayListing),
          id: previous?.id || `${storeId}:${marketplaceId}:${product.listingId}`,
          storeId,
          marketplaceId,
          listingId: product.listingId,
          sku: previousPayload?.sku || '',
          title: sourceTitle,
          originalTitle: sourceTitle,
          translatedTitle: product.translatedTitle || previousPayload?.translatedTitle || '',
          originalTitleVerified: true,
          titleSource: 'EBAY_STORE_LINK',
          price: product.price || previousPayload?.price || '',
          currency: product.currency || previousPayload?.currency || 'USD',
          quantity: previousPayload?.quantity || 0,
          imageUrl: product.imageUrl || previousPayload?.imageUrl || '',
          imageUrls: product.imageUrl ? [product.imageUrl, ...(previousPayload?.imageUrls || []).filter(value => value !== product.imageUrl)] : (previousPayload?.imageUrls || []),
          categoryId,
          categoryName,
          status: 'ACTIVE',
          viewUrl: product.url,
          updatedAt: now
        }
        const changed = !previousPayload
          || previous?.status !== 'ACTIVE'
          || previousPayload.title !== item.title
          || previousPayload.price !== item.price
          || previousPayload.currency !== item.currency
          || previousPayload.imageUrl !== item.imageUrl
          || previousPayload.categoryId !== item.categoryId
          || previousPayload.viewUrl !== item.viewUrl
        const categoryMoved = Boolean(previousPayload?.categoryId && item.categoryId && previousPayload.categoryId !== item.categoryId)
        if (categoryMoved) moved += 1
        await repo.db.ebayListingAbsenceEvidence.deleteMany({ where: { orgId: repo.orgId, storeId, listingId: product.listingId } })
        if (protectedListingIds.has(product.listingId)) protectedOptimizations.add(product.listingId)
        if (!previous) {
          imported += 1
          changes.push({ listingId: item.listingId, title: item.title, type: 'IMPORTED', beforeCategory: '', afterCategory: item.categoryName })
        } else if (previous.status !== 'ACTIVE') {
          reactivated += 1
          changes.push({ listingId: item.listingId, title: item.title, type: 'REACTIVATED', beforeCategory: previousPayload?.categoryName || '', afterCategory: item.categoryName })
        } else if (changed) {
          updated += 1
          changes.push({ listingId: item.listingId, title: item.title, type: categoryMoved ? 'MOVED' : 'UPDATED', beforeCategory: previousPayload?.categoryName || '', afterCategory: item.categoryName })
        } else {
          unchanged += 1
        }
        if (!previous || changed) await repo.upsertListing(item, { forceActive: true, touchSkuQuantity: false })
        existing.set(product.listingId, { id: item.id, listingId: item.listingId, payload: item as unknown as Prisma.JsonValue, status: 'ACTIVE' })
      }
      const endedListingIds = new Set<string>()
      for (const scan of scans.filter(item => item.complete)) {
        const visibleListingIds = new Set(scan.listingIds)
        for (const row of existing.values()) {
          if (row.status !== 'ACTIVE' || endedListingIds.has(row.listingId) || visibleListingIds.has(row.listingId)) continue
          let payload: EbayListing | undefined
          try { payload = row.payload as unknown as EbayListing } catch { payload = undefined }
          if (payload?.categoryId !== scan.categoryId) continue
          const evidence = await repo.db.ebayListingAbsenceEvidence.findFirst({
            where: { orgId: repo.orgId, storeId, listingId: row.listingId },
            select: { consecutiveCount: true }
          })
          if ((evidence?.consecutiveCount || 0) >= 1) {
            const endedPayload: EbayListing = { ...payload, status: 'ENDED', updatedAt: now }
            await repo.db.ebayListing.update({
              where: { id: row.id },
              data: { status: 'ENDED', payload: endedPayload as unknown as Prisma.JsonObject, updatedAt: now }
            })
            await repo.db.ebayListingAbsenceEvidence.deleteMany({ where: { orgId: repo.orgId, storeId, listingId: row.listingId } })
            endedListingIds.add(row.listingId)
            if (protectedListingIds.has(row.listingId)) protectedOptimizations.add(row.listingId)
            ended += 1
            changes.push({ listingId: row.listingId, title: payload.title, type: 'ENDED', beforeCategory: payload.categoryName, afterCategory: '' })
          } else {
            await repo.db.ebayListingAbsenceEvidence.upsert({
              where: { storeId_listingId: { storeId, listingId: row.listingId } },
              create: { orgId: repo.orgId, storeId, listingId: row.listingId, consecutiveCount: 1, lastMissingAt: now },
              update: { consecutiveCount: { increment: 1 }, lastMissingAt: now }
            })
            suspectedEnded += 1
            changes.push({ listingId: row.listingId, title: payload.title, type: 'SUSPECTED_ENDED', beforeCategory: payload.categoryName, afterCategory: '' })
          }
        }
      }
      await repo.reconcileEbayListingCategories(storeId)
      const total = await repo.db.ebayListing.count({ where: { orgId: repo.orgId, storeId, status: 'ACTIVE' } })
      const status: EbayProductSyncRun['status'] = errors.length ? 'PARTIAL' : 'SUCCESS'
      await repo.db.ebayProductSyncRun.create({
        data: {
          id: runId,
          orgId: repo.orgId,
          storeId,
          mode: 'INCREMENTAL',
          categoryCount: scans.length,
          scannedCategoryCount: scans.filter(item => item.complete).length,
          importedCount: imported,
          updatedCount: updated,
          unchangedCount: unchanged,
          endedCount: ended,
          suspectedEndedCount: suspectedEnded,
          movedCount: moved,
          reactivatedCount: reactivated,
          protectedCount: protectedOptimizations.size,
          failedCount: errors.length,
          totalCount: total,
          status,
          errors: errors as unknown as Prisma.JsonArray,
          changes: changes as unknown as Prisma.JsonArray,
          syncedAt: now
        }
      })
      await repo.db.ebayStore.update({
        where: { id: storeId },
        data: { lastSyncAt: now, syncError: errors.length ? errors.join('；') : null }
      })
      return {
        runId,
        storeId,
        mode: 'INCREMENTAL' as const,
        categoryCount: scans.length,
        scannedCategoryCount: scans.filter(item => item.complete).length,
        imported,
        updated,
        unchanged,
        ended,
        suspectedEnded,
        moved,
        reactivated,
        protectedOptimizations: protectedOptimizations.size,
        failed: errors.length,
        total,
        syncedAt: now,
        errors,
        changes
      }
    })
  }

  async recordEbayProductSyncFailure(storeId: string, categoryCount: number, errors: string[]): Promise<EbayProductSyncRun> {
    await this.requireStore(storeId)
    const total = await this.db.ebayListing.count({ where: { orgId: this.orgId, storeId, status: 'ACTIVE' } })
    const run: EbayProductSyncRun = {
      id: randomUUID(),
      storeId,
      mode: 'INCREMENTAL',
      categoryCount,
      scannedCategoryCount: 0,
      imported: 0,
      updated: 0,
      unchanged: 0,
      ended: 0,
      suspectedEnded: 0,
      moved: 0,
      reactivated: 0,
      protectedOptimizations: 0,
      failed: Math.max(1, errors.length),
      total,
      status: 'FAILED',
      errors,
      changes: [],
      syncedAt: new Date().toISOString()
    }
    await this.db.ebayProductSyncRun.create({
      data: {
        id: run.id,
        orgId: this.orgId,
        storeId,
        mode: run.mode,
        categoryCount: run.categoryCount,
        scannedCategoryCount: run.scannedCategoryCount,
        importedCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
        endedCount: 0,
        suspectedEndedCount: 0,
        movedCount: 0,
        reactivatedCount: 0,
        protectedCount: 0,
        failedCount: run.failed,
        totalCount: run.total,
        status: run.status,
        errors: run.errors as unknown as Prisma.JsonArray,
        changes: [],
        syncedAt: run.syncedAt
      }
    })
    return run
  }

  async getEbayProductSyncRuns(storeId: string): Promise<EbayProductSyncRun[]> {
    const rows = await this.db.ebayProductSyncRun.findMany({
      where: { orgId: this.orgId, storeId },
      orderBy: { syncedAt: 'desc' },
      take: 20
    })
    return rows.map(row => ({
      id: row.id,
      storeId: row.storeId,
      mode: 'INCREMENTAL' as const,
      categoryCount: row.categoryCount,
      scannedCategoryCount: row.scannedCategoryCount,
      imported: row.importedCount,
      updated: row.updatedCount,
      unchanged: row.unchangedCount,
      ended: row.endedCount,
      suspectedEnded: row.suspectedEndedCount || 0,
      moved: row.movedCount || 0,
      reactivated: row.reactivatedCount,
      protectedOptimizations: row.protectedCount,
      failed: row.failedCount,
      total: row.totalCount,
      status: row.status as EbayProductSyncRun['status'],
      errors: row.errors as unknown as string[],
      changes: row.changes as unknown as EbayProductSyncChange[],
      syncedAt: row.syncedAt
    }))
  }

  // ---------------------------------------------------------------- 本地产品库 / 快照

  async getEbayLocalProducts(storeId?: string): Promise<EbayLocalProduct[]> {
    const products = await this.db.ebayLocalProduct.findMany({
      where: { orgId: this.orgId, ...(storeId && storeId !== 'all' ? { storeId } : {}) },
      orderBy: { updatedAt: 'desc' }
    })
    if (!products.length) return []
    const snapshots = await this.db.ebayLocalProductSnapshot.findMany({
      where: { orgId: this.orgId, id: { in: products.map(product => product.latestSnapshotId) } },
      select: { id: true, payload: true }
    })
    const snapshotMap = new Map(snapshots.map(row => [row.id, row.payload]))
    return products
      .filter(product => snapshotMap.has(product.latestSnapshotId))
      .map(product => ({
        id: product.id,
        storeId: product.storeId,
        marketplaceId: product.marketplaceId,
        listingId: product.listingId,
        categoryId: product.categoryId,
        categoryName: product.categoryName,
        title: product.title,
        status: product.status as EbayLocalProduct['status'],
        versionCount: product.versionCount,
        latestSnapshotId: product.latestSnapshotId,
        downloadedAt: product.downloadedAt,
        updatedAt: product.updatedAt,
        snapshot: snapshotMap.get(product.latestSnapshotId) as unknown as EbayLocalProductSnapshot
      }))
  }

  /** 供路由做店铺范围检查：返回本地产品所属店铺 */
  async findLocalProductStoreId(localProductId: string): Promise<string | undefined> {
    const row = await this.db.ebayLocalProduct.findFirst({ where: { id: localProductId, orgId: this.orgId }, select: { storeId: true } })
    return row?.storeId
  }

  /** 单个本地产品（含最新快照水合）；不存在返回 null。供本地产品编辑（PATCH）使用 */
  async getEbayLocalProduct(localProductId: string): Promise<EbayLocalProduct | null> {
    const product = await this.db.ebayLocalProduct.findFirst({ where: { id: localProductId, orgId: this.orgId } })
    if (!product) return null
    const snapshot = await this.db.ebayLocalProductSnapshot.findFirst({
      where: { orgId: this.orgId, id: product.latestSnapshotId },
      select: { payload: true }
    })
    if (!snapshot) return null
    return {
      id: product.id,
      storeId: product.storeId,
      marketplaceId: product.marketplaceId,
      listingId: product.listingId,
      categoryId: product.categoryId,
      categoryName: product.categoryName,
      title: product.title,
      status: product.status as EbayLocalProduct['status'],
      versionCount: product.versionCount,
      latestSnapshotId: product.latestSnapshotId,
      downloadedAt: product.downloadedAt,
      updatedAt: product.updatedAt,
      snapshot: snapshot.payload as unknown as EbayLocalProductSnapshot
    }
  }

  async getEbayLocalProductSnapshots(localProductId: string): Promise<EbayLocalProductSnapshot[]> {
    const rows = await this.db.ebayLocalProductSnapshot.findMany({
      where: { orgId: this.orgId, localProductId },
      orderBy: { version: 'desc' }
    })
    return rows.map(row => row.payload as unknown as EbayLocalProductSnapshot)
  }

  async saveEbayLocalProductSnapshot(input: EbayLocalProductSnapshotInput): Promise<EbayLocalProduct> {
    const listing = input.listing
    const localProductId = await this.inTx(async repo => {
      const existing = await repo.db.ebayLocalProduct.findFirst({
        where: { orgId: repo.orgId, storeId: listing.storeId, marketplaceId: listing.marketplaceId, listingId: listing.listingId },
        select: { id: true, versionCount: true }
      })
      const localProductId = existing?.id || randomUUID()
      const snapshotId = randomUUID()
      const version = (existing?.versionCount || 0) + 1
      const status: EbayLocalProduct['status'] = input.completeness >= 80 ? 'READY' : 'INCOMPLETE'
      const snapshot: EbayLocalProductSnapshot = {
        id: snapshotId,
        localProductId,
        version,
        sourceListing: listing,
        details: input.details,
        media: input.media,
        completeness: input.completeness,
        missingFields: input.missingFields,
        contentHash: input.contentHash,
        capturedAt: input.capturedAt
      }
      await repo.db.ebayLocalProduct.upsert({
        where: { storeId_marketplaceId_listingId: { storeId: listing.storeId, marketplaceId: listing.marketplaceId, listingId: listing.listingId } },
        create: {
          id: localProductId,
          orgId: repo.orgId,
          storeId: listing.storeId,
          marketplaceId: listing.marketplaceId,
          listingId: listing.listingId,
          categoryId: listing.categoryId,
          categoryName: listing.categoryName,
          title: listing.title,
          status,
          versionCount: version,
          latestSnapshotId: snapshotId,
          downloadedAt: input.capturedAt,
          updatedAt: input.capturedAt
        },
        update: {
          categoryId: listing.categoryId,
          categoryName: listing.categoryName,
          title: listing.title,
          status,
          versionCount: version,
          latestSnapshotId: snapshotId,
          downloadedAt: input.capturedAt,
          updatedAt: input.capturedAt
        }
      })
      await repo.db.ebayLocalProductSnapshot.create({
        data: {
          id: snapshotId,
          orgId: repo.orgId,
          localProductId,
          version,
          payload: snapshot as unknown as Prisma.JsonObject,
          contentHash: input.contentHash,
          capturedAt: input.capturedAt
        }
      })
      if (input.media.length) {
        await repo.db.ebayLocalProductMedia.createMany({
          data: input.media.map(media => ({
            id: media.id,
            orgId: repo.orgId,
            snapshotId,
            mediaType: media.mediaType,
            sortOrder: media.sortOrder,
            remoteUrl: media.remoteUrl,
            localPath: media.localPath,
            mimeType: media.mimeType,
            width: media.width,
            height: media.height,
            fileSize: media.fileSize || 0,
            sha256: media.sha256,
            downloadStatus: media.downloadStatus
          }))
        })
      }
      return localProductId
    })
    const product = (await this.getEbayLocalProducts(listing.storeId)).find(item => item.id === localProductId)
    if (!product) throw httpError(500, 'LOCAL_PRODUCT_SAVE_FAILED', '本地产品保存失败')
    return product
  }

  async removeEbayLocalProduct(localProductId: string) {
    const result = await this.db.ebayLocalProduct.deleteMany({ where: { id: localProductId, orgId: this.orgId } })
    if (!result.count) throw httpError(404, 'LOCAL_PRODUCT_NOT_FOUND', '本地产品不存在或已删除')
    return true
  }

  // ---------------------------------------------------------------- 图片视觉检查

  async getEbayImageVisualInspection(localProductId: string): Promise<EbayImageVisualInspectionReport | null> {
    const product = await this.db.ebayLocalProduct.findFirst({ where: { id: localProductId, orgId: this.orgId }, select: { latestSnapshotId: true } })
    if (!product) return null
    const snapshot = await this.db.ebayLocalProductSnapshot.findFirst({
      where: { id: product.latestSnapshotId, localProductId, orgId: this.orgId },
      select: { contentHash: true }
    })
    if (!snapshot) return null
    const row = await this.db.ebayImageVisualInspection.findFirst({
      where: { orgId: this.orgId, localProductId, snapshotId: product.latestSnapshotId, contentHash: snapshot.contentHash },
      orderBy: { checkedAt: 'desc' },
      select: { reportJson: true }
    })
    return row ? (row.reportJson as unknown as EbayImageVisualInspectionReport) : null
  }

  async saveEbayImageVisualInspection(localProductId: string, snapshot: EbayLocalProductSnapshot, report: EbayImageVisualInspectionReport): Promise<EbayImageVisualInspectionReport> {
    const current = await this.db.ebayLocalProduct.findFirst({ where: { id: localProductId, orgId: this.orgId }, select: { latestSnapshotId: true } })
    if (!current || current.latestSnapshotId !== snapshot.id) throw httpError(409, 'LOCAL_PRODUCT_STALE', '本地产品内容已变化，请按最新版本重新检查')
    await this.db.ebayImageVisualInspection.create({
      data: {
        id: randomUUID(),
        orgId: this.orgId,
        localProductId,
        snapshotId: snapshot.id,
        contentHash: snapshot.contentHash,
        status: report.status,
        reportJson: report as unknown as Prisma.JsonObject,
        checkedAt: report.checkedAt,
        updatedAt: report.checkedAt
      }
    })
    return report
  }

  async reviewEbayImageVisualRule(input: EbayImageVisualReviewInput): Promise<EbayImageVisualInspectionReport> {
    const product = await this.db.ebayLocalProduct.findFirst({ where: { id: input.localProductId, orgId: this.orgId }, select: { latestSnapshotId: true } })
    if (!product) throw httpError(404, 'LOCAL_PRODUCT_NOT_FOUND', '本地产品不存在或已删除')
    const snapshot = await this.db.ebayLocalProductSnapshot.findFirst({
      where: { id: product.latestSnapshotId, localProductId: input.localProductId, orgId: this.orgId },
      select: { contentHash: true }
    })
    if (!snapshot) throw httpError(404, 'SNAPSHOT_NOT_FOUND', '本地产品快照不存在')
    const row = await this.db.ebayImageVisualInspection.findFirst({
      where: { orgId: this.orgId, localProductId: input.localProductId, snapshotId: product.latestSnapshotId, contentHash: snapshot.contentHash },
      orderBy: { checkedAt: 'desc' },
      select: { id: true, reportJson: true }
    })
    if (!row) throw httpError(400, 'VISUAL_INSPECTION_MISSING', '当前本地产品版本尚未执行图片内容检查')
    const report = row.reportJson as unknown as EbayImageVisualInspectionReport
    const image = report.images.find(item => item.mediaId === input.mediaId)
    const rule = image?.rules.find(item => item.rule === input.rule)
    if (!image || !rule) throw httpError(400, 'VISUAL_RULE_NOT_FOUND', '待复核图片规则不存在')
    if (rule.status !== 'REVIEW' && !rule.manualReview) throw httpError(400, 'VISUAL_RULE_NOT_REVIEWABLE', '只有人工复核项可以手动确认')
    const reviewedAt = new Date().toISOString()
    rule.modelStatus = rule.modelStatus || rule.status
    rule.status = input.decision
    rule.manualReview = {
      decision: input.decision,
      reviewedAt,
      reviewedBy: input.reviewedBy.trim() || '本机用户',
      note: input.note.trim() || '人工查看原图后确认'
    }
    const updated = rebuildEbayImageVisualReport(report)
    await this.inTx(async repo => {
      await repo.db.ebayImageVisualInspection.update({
        where: { id: row.id },
        data: { status: updated.status, reportJson: updated as unknown as Prisma.JsonObject, updatedAt: reviewedAt }
      })
      await repo.db.ebayImageVisualReviewEvent.create({
        data: {
          id: randomUUID(),
          orgId: repo.orgId,
          inspectionId: row.id,
          mediaId: input.mediaId,
          ruleCode: input.rule,
          decision: input.decision,
          reviewedBy: rule.manualReview!.reviewedBy,
          reviewNote: rule.manualReview!.note,
          reviewedAt
        }
      })
    })
    return updated
  }

  // ---------------------------------------------------------------- 类目工作区

  async getEbayCategoryWorkspace(storeId: string): Promise<EbayCategoryWorkspace> {
    const rows = await this.db.ebayStoreCategory.findMany({
      where: { orgId: this.orgId, storeId, status: 'ACTIVE' },
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }]
    })
    const categories: EbayStoreCategory[] = rows.map(row => ({
      storeId: row.storeId,
      categoryId: row.categoryId,
      name: row.name,
      parentCategoryId: row.parentCategoryId,
      level: row.level,
      childCount: row.childCount,
      listingCount: row.listingCount,
      sortOrder: row.sortOrder,
      status: 'ACTIVE',
      syncedAt: row.syncedAt
    }))
    const run = await this.db.ebayCategorySyncRun.findFirst({
      where: { orgId: this.orgId, storeId },
      orderBy: { syncedAt: 'desc' }
    })
    const lastSync: EbayCategorySyncSummary | undefined = run
      ? {
          storeId,
          total: run.totalCount,
          added: run.addedCount,
          renamed: run.renamedCount,
          moved: run.movedCount,
          removed: run.removedCount,
          reordered: run.reorderedCount,
          changes: run.changes as unknown as EbayCategoryChange[],
          syncedAt: run.syncedAt
        }
      : undefined
    return { categories, lastSync }
  }

  async saveEbayStoreCategories(storeId: string, categories: EbayStoreCategory[]): Promise<EbayCategoryWorkspace> {
    await this.requireStore(storeId)
    if (!categories.length) throw httpError(400, 'CATEGORY_EMPTY', 'eBay店铺目录为空，已取消写入')
    await this.inTx(async repo => {
      const existingRows = await repo.db.ebayStoreCategory.findMany({
        where: { orgId: repo.orgId, storeId },
        select: { categoryId: true, name: true, parentCategoryId: true, sortOrder: true, status: true }
      })
      const existing = new Map(existingRows.map(row => [row.categoryId, row]))
      const remoteIds = new Set(categories.map(item => item.categoryId))
      const changes: EbayCategoryChange[] = []
      let added = 0
      let renamed = 0
      let moved = 0
      let removed = 0
      let reordered = 0
      for (const item of categories) {
        const previous = existing.get(item.categoryId)
        if (!previous || previous.status === 'REMOVED') {
          added += 1
          changes.push({ type: 'ADDED', categoryId: item.categoryId, beforeName: '', afterName: item.name })
          continue
        }
        if (previous.name !== item.name) {
          renamed += 1
          changes.push({ type: 'RENAMED', categoryId: item.categoryId, beforeName: previous.name, afterName: item.name })
        }
        if (previous.parentCategoryId !== item.parentCategoryId) {
          moved += 1
          changes.push({ type: 'MOVED', categoryId: item.categoryId, beforeName: previous.name, afterName: item.name })
        }
        if (previous.sortOrder !== item.sortOrder) {
          reordered += 1
          changes.push({ type: 'REORDERED', categoryId: item.categoryId, beforeName: item.name, afterName: item.name })
        }
      }
      for (const previous of existingRows) {
        if (previous.status === 'ACTIVE' && !previous.categoryId.startsWith('collected:') && !remoteIds.has(previous.categoryId)) {
          removed += 1
          changes.push({ type: 'REMOVED', categoryId: previous.categoryId, beforeName: previous.name, afterName: '' })
        }
      }
      const now = new Date().toISOString()
      for (const item of categories) {
        await repo.db.ebayStoreCategory.upsert({
          where: { storeId_categoryId: { storeId, categoryId: item.categoryId } },
          create: {
            orgId: repo.orgId,
            storeId,
            categoryId: item.categoryId,
            name: item.name,
            parentCategoryId: item.parentCategoryId,
            level: item.level,
            childCount: item.childCount,
            listingCount: item.listingCount,
            sortOrder: item.sortOrder,
            status: 'ACTIVE',
            syncedAt: now,
            updatedAt: now
          },
          update: {
            name: item.name,
            parentCategoryId: item.parentCategoryId,
            level: item.level,
            childCount: item.childCount,
            listingCount: item.listingCount,
            sortOrder: item.sortOrder,
            status: 'ACTIVE',
            syncedAt: now,
            updatedAt: now
          }
        })
      }
      await repo.db.ebayStoreCategory.updateMany({
        where: {
          orgId: repo.orgId,
          storeId,
          status: 'ACTIVE',
          categoryId: { notIn: categories.map(item => item.categoryId), not: { startsWith: 'collected:' } }
        },
        data: { status: 'REMOVED', syncedAt: now, updatedAt: now }
      })
      await repo.db.ebayCategorySyncRun.create({
        data: {
          id: randomUUID(),
          orgId: repo.orgId,
          storeId,
          totalCount: categories.length,
          addedCount: added,
          renamedCount: renamed,
          movedCount: moved,
          removedCount: removed,
          reorderedCount: reordered,
          changes: changes as unknown as Prisma.JsonArray,
          syncedAt: now
        }
      })
      await repo.reconcileEbayListingCategories(storeId)
    })
    return this.getEbayCategoryWorkspace(storeId)
  }

  // ---------------------------------------------------------------- 市场研究

  private normalizeEbayMarketResearchSnapshot(snapshot: EbayMarketResearchSnapshot): EbayMarketResearchSnapshot | undefined {
    if (!['EBAY_PRODUCT_RESEARCH', 'EBAY_SOLD_SEARCH'].includes(snapshot.source)) return undefined
    if (snapshot.captureMode && !['MANUAL_RESEARCH_PAGE', 'AUTOMATIC'].includes(snapshot.captureMode)) return undefined
    const valid = snapshot.samples.filter(item => !/^(shop on ebay|sign in|register|see all|view item|research)$/i.test(item.title.trim()))
    const unique = new Map<string, EbayMarketResearchSnapshot['samples'][number]>()
    valid.forEach(item => {
      const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
      if (key && !unique.has(key)) unique.set(key, item)
    })
    const samples = [...unique.values()]
    const soldQuantityEvidenceCount = snapshot.soldQuantityEvidenceCount ?? samples.filter(item => Number((item.soldQuantity || '').replace(/,/g, '')) > 0).length
    const rankingBasis = snapshot.rankingBasis || (soldQuantityEvidenceCount >= Math.min(5, Math.max(1, Math.ceil(samples.length * 0.1))) ? 'SOLD_QUANTITY' : 'EBAY_RESULT_ORDER')
    return {
      ...snapshot,
      rawSampleCount: snapshot.rawSampleCount ?? snapshot.samples.length,
      samples,
      sampleCount: samples.length,
      analysisSampleCount: Math.min(snapshot.analysisSampleCount ?? 30, samples.length),
      rankingBasis,
      soldQuantityEvidenceCount
    }
  }

  async getEbayMarketResearch(storeId: string, listingId: string): Promise<EbayMarketResearchSnapshot | undefined> {
    const row = await this.db.ebayMarketResearch.findFirst({ where: { orgId: this.orgId, storeId, listingId }, select: { payload: true } })
    return row ? this.normalizeEbayMarketResearchSnapshot(row.payload as unknown as EbayMarketResearchSnapshot) : undefined
  }

  async getEbayMarketResearchHistory(storeId: string, listingId: string): Promise<EbayMarketResearchSnapshot[]> {
    const rows = await this.db.ebayMarketResearchHistory.findMany({
      where: { orgId: this.orgId, storeId, listingId },
      orderBy: { fetchedAt: 'desc' },
      take: 30,
      select: { payload: true }
    })
    return rows
      .map(row => this.normalizeEbayMarketResearchSnapshot(row.payload as unknown as EbayMarketResearchSnapshot))
      .filter((snapshot): snapshot is EbayMarketResearchSnapshot => Boolean(snapshot))
  }

  async saveEbayMarketResearch(snapshot: EbayMarketResearchSnapshot): Promise<EbayMarketResearchSnapshot> {
    await this.db.ebayMarketResearch.upsert({
      where: { storeId_listingId: { storeId: snapshot.storeId, listingId: snapshot.listingId } },
      create: { id: snapshot.id, orgId: this.orgId, storeId: snapshot.storeId, listingId: snapshot.listingId, payload: snapshot as unknown as Prisma.JsonObject, fetchedAt: snapshot.fetchedAt },
      update: { id: snapshot.id, payload: snapshot as unknown as Prisma.JsonObject, fetchedAt: snapshot.fetchedAt }
    })
    return snapshot
  }

  async recordEbayMarketResearch(snapshot: EbayMarketResearchSnapshot): Promise<EbayMarketResearchSnapshot> {
    await this.inTx(async repo => {
      await repo.db.ebayMarketResearchHistory.create({
        data: { id: snapshot.id, orgId: repo.orgId, storeId: snapshot.storeId, listingId: snapshot.listingId, payload: snapshot as unknown as Prisma.JsonObject, fetchedAt: snapshot.fetchedAt }
      })
      await repo.db.ebayMarketResearch.upsert({
        where: { storeId_listingId: { storeId: snapshot.storeId, listingId: snapshot.listingId } },
        create: { id: snapshot.id, orgId: repo.orgId, storeId: snapshot.storeId, listingId: snapshot.listingId, payload: snapshot as unknown as Prisma.JsonObject, fetchedAt: snapshot.fetchedAt },
        update: { id: snapshot.id, payload: snapshot as unknown as Prisma.JsonObject, fetchedAt: snapshot.fetchedAt }
      })
    })
    return snapshot
  }

  async decideEbayMarketResearchTerm(request: EbayMarketResearchDecisionRequest): Promise<EbayMarketResearchSnapshot> {
    const snapshot = await this.getEbayMarketResearch(request.storeId, request.listingId)
    if (!snapshot) throw httpError(404, 'MARKET_RESEARCH_NOT_FOUND', '尚未获取当前商品的 eBay 市场数据')
    const key = request.kind === 'KEYWORD' ? 'keywords' : 'combinations'
    const index = snapshot[key].findIndex(item => item.term === request.term)
    if (index < 0) throw httpError(400, 'MARKET_TERM_NOT_FOUND', '当前市场词不存在，请重新获取市场数据')
    snapshot[key][index] = {
      ...snapshot[key][index]!,
      factStatus: request.status,
      factSource: request.status === 'CONFIRMED' ? '人工确认：与当前商品事实一致' : request.status === 'EXCLUDED' ? '人工排除：不得用于当前商品标题' : '市场成交词，需结合商品事实人工确认'
    }
    return this.saveEbayMarketResearch({ ...snapshot, id: randomUUID() })
  }

  // ---------------------------------------------------------------- 标题决策 / 交接

  async getEbayTitleDecision(storeId: string, listingId: string): Promise<EbayTitleDecision | undefined> {
    const row = await this.db.ebayTitleDecision.findFirst({ where: { orgId: this.orgId, storeId, listingId }, select: { payload: true } })
    return row ? (row.payload as unknown as EbayTitleDecision) : undefined
  }

  async saveEbayTitleDecision(input: EbayTitleDecisionInput, audit: EbayTitleDecision['audit']): Promise<EbayTitleDecision> {
    const decision: EbayTitleDecision = { ...input, audit, id: randomUUID(), status: 'CONFIRMED', confirmedAt: new Date().toISOString() }
    await this.db.ebayTitleDecision.upsert({
      where: { storeId_listingId: { storeId: decision.storeId, listingId: decision.listingId } },
      create: { id: decision.id, orgId: this.orgId, storeId: decision.storeId, listingId: decision.listingId, researchSnapshotId: decision.researchSnapshotId, payload: decision as unknown as Prisma.JsonObject, confirmedAt: decision.confirmedAt },
      update: { id: decision.id, researchSnapshotId: decision.researchSnapshotId, payload: decision as unknown as Prisma.JsonObject, confirmedAt: decision.confirmedAt }
    })
    return decision
  }

  async getEbayTitleHandoff(storeId: string, listingId: string): Promise<EbayTitleHandoff | undefined> {
    const row = await this.db.ebayTitleHandoff.findFirst({ where: { orgId: this.orgId, storeId, listingId }, select: { payload: true } })
    return row ? (row.payload as unknown as EbayTitleHandoff) : undefined
  }

  async saveEbayTitleHandoff(handoff: EbayTitleHandoff): Promise<EbayTitleHandoff> {
    await this.db.ebayTitleHandoff.upsert({
      where: { storeId_listingId: { storeId: handoff.storeId, listingId: handoff.listingId } },
      create: { id: handoff.id, orgId: this.orgId, storeId: handoff.storeId, listingId: handoff.listingId, titleDecisionId: handoff.titleDecisionId, status: handoff.status, payload: handoff as unknown as Prisma.JsonObject, createdAt: handoff.createdAt, updatedAt: handoff.updatedAt },
      update: { id: handoff.id, titleDecisionId: handoff.titleDecisionId, status: handoff.status, payload: handoff as unknown as Prisma.JsonObject, updatedAt: handoff.updatedAt }
    })
    return handoff
  }

  // ---------------------------------------------------------------- 内容优化记录

  async getEbayContentOptimizationRecord(storeId: string, listingId: string): Promise<EbayContentOptimizationRecord | undefined> {
    const row = await this.db.ebayContentOptimizationRecord.findFirst({ where: { orgId: this.orgId, storeId, listingId }, select: { payload: true } })
    return row ? (row.payload as unknown as EbayContentOptimizationRecord) : undefined
  }

  async saveEbayContentOptimizationRecord(input: EbayContentOptimizationRecordInput): Promise<EbayContentOptimizationRecord> {
    const existing = await this.db.ebayContentOptimizationRecord.findFirst({
      where: { orgId: this.orgId, storeId: input.storeId, listingId: input.listingId },
      select: { id: true, createdAt: true }
    })
    const now = new Date().toISOString()
    const record: EbayContentOptimizationRecord = { ...input, id: existing?.id || randomUUID(), createdAt: existing?.createdAt || now, updatedAt: now }
    await this.db.ebayContentOptimizationRecord.upsert({
      where: { storeId_listingId: { storeId: record.storeId, listingId: record.listingId } },
      create: { id: record.id, orgId: this.orgId, storeId: record.storeId, listingId: record.listingId, selectedTitle: record.selectedTitle, payload: record as unknown as Prisma.JsonObject, createdAt: record.createdAt, updatedAt: record.updatedAt },
      update: { selectedTitle: record.selectedTitle, payload: record as unknown as Prisma.JsonObject, updatedAt: record.updatedAt }
    })
    return record
  }

  // ---------------------------------------------------------------- 优化草稿 / 合规验证

  async getEbayOptimizationDrafts(storeId?: string): Promise<EbayOptimizationDraft[]> {
    const rows = await this.db.ebayOptimizationDraft.findMany({
      where: { orgId: this.orgId, ...(storeId ? { storeId } : {}) },
      orderBy: { updatedAt: 'desc' },
      select: { payload: true }
    })
    return rows.map(row => row.payload as unknown as EbayOptimizationDraft)
  }

  async getEbayOptimizationDraft(draftId: string): Promise<EbayOptimizationDraft | undefined> {
    const row = await this.db.ebayOptimizationDraft.findFirst({ where: { id: draftId, orgId: this.orgId }, select: { payload: true } })
    return row ? (row.payload as unknown as EbayOptimizationDraft) : undefined
  }

  async saveEbayOptimizationDraft(input: EbayOptimizationDraftInput): Promise<EbayOptimizationDraft> {
    const existing = await this.db.ebayOptimizationDraft.findFirst({
      where: { orgId: this.orgId, storeId: input.storeId, listingId: input.listingId },
      select: { id: true, createdAt: true }
    })
    const now = new Date().toISOString()
    const draft: EbayOptimizationDraft = { ...input, id: existing?.id || randomUUID(), status: 'PREMIUM', createdAt: existing?.createdAt || now, updatedAt: now }
    await this.db.ebayOptimizationDraft.upsert({
      where: { storeId_listingId: { storeId: draft.storeId, listingId: draft.listingId } },
      create: { id: draft.id, orgId: this.orgId, storeId: draft.storeId, listingId: draft.listingId, status: draft.status, payload: draft as unknown as Prisma.JsonObject, createdAt: draft.createdAt, updatedAt: draft.updatedAt },
      update: { status: draft.status, payload: draft as unknown as Prisma.JsonObject, updatedAt: draft.updatedAt }
    })
    return draft
  }

  /**
   * 发布前合规验证（原版 validateEbayOptimizationDraft 1665-1702 行）：
   * 指纹匹配复用最新检查，否则重新执行；PASSED 或已复核的 REVIEW_REQUIRED 放行并签发许可；
   * 草稿回写合规结论字段。
   */
  async validateEbayOptimizationDraft(draftId: string): Promise<EbayPublishComplianceValidation> {
    const row = await this.db.ebayOptimizationDraft.findFirst({ where: { id: draftId, orgId: this.orgId }, select: { payload: true } })
    if (!row) throw httpError(404, 'DRAFT_NOT_FOUND', '优品草稿不存在，请刷新后重试')
    const draft = row.payload as unknown as EbayOptimizationDraft
    const compliance = new ComplianceRepository(this.orgId)
    const request: ComplianceCheckRequest = {
      productId: draft.listing.id,
      platform: 'EBAY',
      marketplaceSite: draft.listing.marketplaceId || 'EBAY_US',
      country: ebayCountryForMarketplace(draft.listing.marketplaceId || 'EBAY_US'),
      categoryId: draft.listing.categoryId,
      categoryName: draft.listing.categoryName,
      title: draft.selectedTitle,
      description: draft.description,
      imageUrl: draft.imageUrl,
      itemSpecifics: draft.itemSpecifics.map(item => ({ name: item.name, value: item.value }))
    }
    const fingerprint = complianceCheckFingerprint(request)
    const latest = await compliance.getLatestCheck(request.productId)
    const check = latest && latest.inputFingerprint === fingerprint && latest.gateStatus !== 'RECHECK_REQUIRED' ? latest : await compliance.runCheck(request)
    const publishAllowed = check.gateStatus === 'PASSED' || (check.gateStatus === 'REVIEW_REQUIRED' && Boolean(check.reviewedAt))
    const permit = publishAllowed ? await compliance.issueReleasePermit(check.id) : undefined
    if (permit) await compliance.resolveEnforcementCases(request.productId, '最新合规结论有效并已续签发布许可')
    const updated: EbayOptimizationDraft = {
      ...draft,
      complianceCheckId: check.id,
      complianceGateStatus: check.gateStatus,
      complianceRuleSetVersion: check.ruleSetVersion,
      complianceCheckedAt: check.checkedAt,
      complianceReviewedAt: check.reviewedAt,
      complianceInputFingerprint: check.inputFingerprint,
      updatedAt: new Date().toISOString()
    }
    await this.db.ebayOptimizationDraft.update({
      where: { id: draftId },
      data: { payload: updated as unknown as Prisma.JsonObject, updatedAt: updated.updatedAt }
    })
    const reason = publishAllowed
      ? check.gateStatus === 'PASSED' ? '已通过最新规则与内容一致性检查，可进入发布确认。' : '已完成最新规则检查和人工复核，可进入发布确认。'
      : check.gateStatus === 'BLOCKED' ? '存在禁止发布风险，必须整改或停止发布。' : check.gateStatus === 'REVIEW_REQUIRED' ? '当前结论需要人工复核并留痕。' : '规则或商品内容已变化，必须整改后重新检查。'
    return { draft: updated, check, permit, publishAllowed, reason }
  }

  // ---------------------------------------------------------------- 发布任务 / 验收

  async getEbayPublishTasks(storeId?: string): Promise<EbayPublishTask[]> {
    const rows = await this.db.ebayPublishTask.findMany({
      where: { orgId: this.orgId, ...(storeId ? { storeId } : {}) },
      orderBy: { updatedAt: 'desc' },
      select: { payload: true }
    })
    return rows.map(row => {
      const task = row.payload as unknown as EbayPublishTask
      if (task.videoUpload?.status === 'FILE_SELECTED' && /尚未上传或提交/.test(task.videoUpload.message)) {
        const message = '已选择本地视频文件，eBay 可能正在上传或处理；尚未提交，请人工确认处理结果'
        return { ...task, message, videoUpload: { ...task.videoUpload, message } }
      }
      return task
    })
  }

  async saveEbayPublishTask(task: EbayPublishTask): Promise<EbayPublishTask> {
    await this.db.ebayPublishTask.upsert({
      where: { storeId_draftId: { storeId: task.storeId, draftId: task.draftId } },
      create: { id: task.id, orgId: this.orgId, storeId: task.storeId, draftId: task.draftId, listingId: task.listingId, status: task.status, payload: task as unknown as Prisma.JsonObject, createdAt: task.createdAt, updatedAt: task.updatedAt },
      update: { id: task.id, status: task.status, payload: task as unknown as Prisma.JsonObject, updatedAt: task.updatedAt }
    })
    return task
  }

  async getEbayAcceptanceBatches(storeId: string): Promise<EbayAcceptanceBatch[]> {
    const rows = await this.db.ebayAcceptanceBatch.findMany({
      where: { orgId: this.orgId, storeId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { payload: true }
    })
    return rows.map(row => row.payload as unknown as EbayAcceptanceBatch)
  }

  async saveEbayAcceptanceBatch(batch: EbayAcceptanceBatch): Promise<EbayAcceptanceBatch> {
    await this.db.ebayAcceptanceBatch.create({
      data: { id: batch.id, orgId: this.orgId, storeId: batch.storeId, mode: batch.mode, status: batch.status, payload: batch as unknown as Prisma.JsonObject, createdAt: batch.createdAt }
    })
    return batch
  }
}
