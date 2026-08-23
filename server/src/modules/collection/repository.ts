import { randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { httpError } from '../../lib/errors.js'
import { isUsableCandidateImage } from './utils.js'
import type {
  CandidateCollectionRecord,
  CandidateCollectionRun,
  CandidateUpdateRequest,
  CandidateWorkspace,
  CollectedOzonProduct,
  CollectedSupplyProduct,
  CollectorDuplicateProduct,
  CollectorDuplicateStage,
  CollectorPluginImportResult,
  ComparisonCostSettings,
  ComparisonImportRequest,
  ComparisonPromotionRequest,
  ComparisonPromotionResult,
  ComparisonRecordView,
  ComparisonSupplierMatch,
  ComparisonUpdateRequest,
  MarketplaceAccountProfile,
  MarketplaceCredentialSaveInput,
  MarketplaceCredentialStatus,
  MarketplaceMediaAsset,
  MarketplaceMediaAssetType,
  MarketplacePlatformCode,
  MarketplaceProfiles,
  MarketplacePublishAudit,
  MarketplacePublishDraft,
  MarketplacePublishDraftUpdate,
  MarketplaceSelectionProduct,
  PersistedWorkspace,
  SelectionCatalogItem,
  SelectionDecision,
  SelectionImportRequest,
  SelectionTask,
  SupplyWarehouseProduct,
  WorkflowCounts
} from './types.js'

type Db = PrismaClient | Prisma.TransactionClient

/** 市场平台展示顺序：对齐种子定义顺序（原 SQLite ORDER BY rowid 语义） */
const MARKETPLACE_PLATFORM_ORDER: MarketplacePlatformCode[] = ['OZON', 'AMAZON', 'EBAY', 'ALIEXPRESS', 'TEMU']

/** $queryRaw 返回的 Json 列兼容处理（PG 驱动对 jsonb 通常已解析为对象，SQLite 移植期为字符串） */
function parsePayload<T>(value: unknown): T {
  if (typeof value === 'string') return JSON.parse(value) as T
  return value as T
}

/**
 * 选品采集域仓储：从 AppDatabase.ts 采集/比价/选品/供应仓/平台发布段忠实移植。
 * 差异：全部查询强制 orgId 过滤；JSON 列由 Prisma Json 原生承载；
 * BEGIN IMMEDIATE → prisma.$transaction；json_extract → PG ->> 操作符（$queryRaw）；
 * SQLite rowid 排序 → 关联任务 created_at 近似。浏览器采集动作留客户端，此处仅数据层。
 */
export class CollectionRepository {
  constructor(
    private readonly orgId: string,
    private readonly db: Db = prisma
  ) {}

  /** 在事务中执行；若当前实例已处于事务则直接复用 */
  private inTx<T>(fn: (repo: CollectionRepository) => Promise<T>): Promise<T> {
    if (this.db !== prisma) return fn(this)
    return prisma.$transaction(tx => fn(new CollectionRepository(this.orgId, tx)), { timeout: 30000 })
  }

  // ---------------------------------------------------------------- intake 去重登记

  private intakeIdentity(platformCode: string, productId: string, url: string) {
    const normalizedId = productId.trim()
    return normalizedId ? `${platformCode}:${normalizedId}` : `${platformCode}:URL:${url}`
  }

  private async registerProductIntake(platformCode: string, productId: string, url: string, title: string, stage: CollectorDuplicateStage, seenAt: string, deletedAt: string | null = null) {
    const identityKey = this.intakeIdentity(platformCode, productId, url)
    const existing = await this.db.productIntakeRegistry.findUnique({
      where: { orgId_identityKey: { orgId: this.orgId, identityKey } },
      select: { firstCollectedAt: true, lastStage: true }
    })
    const rank: Record<CollectorDuplicateStage, number> = { HISTORY: 0, CANDIDATE: 1, SELECTION: 2, WAREHOUSE: 3 }
    const existingStage = existing?.lastStage as CollectorDuplicateStage | undefined
    const resolvedStage = existingStage && rank[existingStage] > rank[stage] ? existingStage : stage
    const candidateDeletedAt = resolvedStage === 'CANDIDATE' ? null : deletedAt
    await this.db.productIntakeRegistry.upsert({
      where: { orgId_identityKey: { orgId: this.orgId, identityKey } },
      create: {
        orgId: this.orgId, identityKey, platformCode, productId, canonicalUrl: url, titleSnapshot: title,
        firstCollectedAt: existing?.firstCollectedAt || seenAt, lastSeenAt: seenAt, lastStage: resolvedStage, candidateDeletedAt
      },
      update: { canonicalUrl: url, titleSnapshot: title, lastSeenAt: seenAt, lastStage: resolvedStage, candidateDeletedAt }
    })
  }

  private async duplicateForProduct(product: CollectedSupplyProduct): Promise<CollectorDuplicateProduct | null> {
    const identityKey = this.intakeIdentity(product.platformCode, product.productId, product.url)
    const warehouse = await this.db.supplyWarehouseProduct.findFirst({
      where: { orgId: this.orgId, warehouseCode: product.platformCode, productId: product.productId, status: 'ACTIVE' },
      select: { id: true }
    })
    if (warehouse) return { platformCode: product.platformCode, productId: product.productId, title: product.title, stage: 'WAREHOUSE', message: '该商品已正式入库' }
    const selection = await this.db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM selection_records
      WHERE org_id = ${this.orgId} AND payload->>'platformCode' = ${product.platformCode} AND payload->>'productId' = ${product.productId}
      LIMIT 1`
    if (selection.length) return { platformCode: product.platformCode, productId: product.productId, title: product.title, stage: 'SELECTION', message: '该商品已进入优选产品' }
    const candidate = await this.db.$queryRaw<Array<{ url: string }>>`
      SELECT url FROM supply_candidates
      WHERE org_id = ${this.orgId} AND deleted_at IS NULL
        AND COALESCE(payload->>'platformCode', '1688') = ${product.platformCode}
        AND (payload->>'productId' = ${product.productId} OR url = ${product.url})
      LIMIT 1`
    if (candidate.length) return { platformCode: product.platformCode, productId: product.productId, title: product.title, stage: 'CANDIDATE', message: '该商品已在采集候选' }
    const history = await this.db.productIntakeRegistry.findUnique({
      where: { orgId_identityKey: { orgId: this.orgId, identityKey } },
      select: { identityKey: true }
    })
    return history ? { platformCode: product.platformCode, productId: product.productId, title: product.title, stage: 'HISTORY', message: '该商品曾收录，已从候选删除' } : null
  }

  private async markCandidatePhysicallyDeleted(product: { platformCode: string; productId: string; url: string; title: string }, deletedAt: string) {
    await this.registerProductIntake(product.platformCode, product.productId, product.url, product.title, 'HISTORY', deletedAt, deletedAt)
    const warehouse = await this.db.supplyWarehouseProduct.findFirst({
      where: { orgId: this.orgId, warehouseCode: product.platformCode, productId: product.productId, status: 'ACTIVE' },
      select: { id: true }
    })
    const selection = await this.db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM selection_records
      WHERE org_id = ${this.orgId} AND payload->>'platformCode' = ${product.platformCode} AND payload->>'productId' = ${product.productId}
      LIMIT 1`
    const stage: CollectorDuplicateStage = warehouse ? 'WAREHOUSE' : selection.length ? 'SELECTION' : 'HISTORY'
    await this.db.productIntakeRegistry.update({
      where: { orgId_identityKey: { orgId: this.orgId, identityKey: this.intakeIdentity(product.platformCode, product.productId, product.url) } },
      data: { lastStage: stage, lastSeenAt: deletedAt, candidateDeletedAt: deletedAt }
    })
  }

  // ---------------------------------------------------------------- 任务

  async saveTask(task: SelectionTask): Promise<void> {
    await this.inTx(async repo => {
      const existing = await repo.db.selectionTask.findFirst({ where: { id: task.id, orgId: repo.orgId }, select: { id: true } })
      const payload = task as unknown as Prisma.JsonObject
      if (existing) {
        await repo.db.selectionTask.update({ where: { id: task.id }, data: { payload, stage: task.stage } })
      } else {
        await repo.db.selectionTask.create({ data: { id: task.id, orgId: repo.orgId, payload, stage: task.stage, createdAt: task.createdAt } })
      }
      const platforms = task.selectionMode === 'FORWARD_SUPPLY' ? task.supplyPlatforms : []
      await repo.db.collectionTaskPlatform.deleteMany({ where: { taskId: task.id, orgId: repo.orgId } })
      if (platforms.length) {
        await repo.db.collectionTaskPlatform.createMany({
          data: platforms.map(platform => ({ taskId: task.id, orgId: repo.orgId, platformCode: platform, status: 'PENDING', createdAt: task.createdAt }))
        })
      }
      if (task.selectionMode === 'FORWARD_SUPPLY') {
        const ruleData = {
          platformCode: task.supplyPlatforms[0] || '1688',
          presetCode: task.selectionRulePreset,
          minimumScore: task.minimumSelectionScore,
          dimensions: task.selectionDimensions as unknown as Prisma.JsonArray,
          criteria: {
            requiredSupplierBadges: task.requiredSupplierBadges,
            maxCategoryTopRank: task.maxCategoryTopRank,
            minimumReturnRate: task.minimumReturnRate,
            minimumNetworkSales: task.minimumNetworkSales,
            minimumServiceRating: task.minimumServiceRating,
            gigaSellerIndexFilter: task.gigaSellerIndexFilter,
            gigaReturnRateFilter: task.gigaReturnRateFilter
          } as unknown as Prisma.JsonObject
        }
        const existingRule = await repo.db.taskSelectionRule.findFirst({ where: { taskId: task.id, orgId: repo.orgId }, select: { taskId: true } })
        if (existingRule) {
          await repo.db.taskSelectionRule.update({ where: { taskId: task.id }, data: ruleData })
        } else {
          await repo.db.taskSelectionRule.create({ data: { taskId: task.id, orgId: repo.orgId, createdAt: task.createdAt, ...ruleData } })
        }
      }
    })
  }

  async getTask(taskId: string): Promise<SelectionTask | null> {
    const row = await this.db.selectionTask.findFirst({ where: { id: taskId, orgId: this.orgId }, select: { payload: true, stage: true } })
    if (!row) return null
    const task = parsePayload<SelectionTask>(row.payload)
    task.stage = row.stage as SelectionTask['stage']
    return task
  }

  // ---------------------------------------------------------------- 平台账号与凭据

  async getMarketplaceProfiles(): Promise<MarketplaceProfiles> {
    const platforms = await this.db.marketplacePlatform.findMany({ where: { orgId: this.orgId, enabled: 1 } })
    const accounts = await this.db.marketplaceAccount.findMany({ where: { orgId: this.orgId, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } })
    const orderIndex = (code: string) => {
      const index = MARKETPLACE_PLATFORM_ORDER.indexOf(code as MarketplacePlatformCode)
      return index === -1 ? MARKETPLACE_PLATFORM_ORDER.length : index
    }
    platforms.sort((a, b) => orderIndex(a.code) - orderIndex(b.code) || a.code.localeCompare(b.code))
    return {
      platforms: platforms.map(row => ({
        code: row.code as MarketplacePlatformCode,
        name: row.name,
        homeUrl: row.homeUrl,
        defaultNetworkStrategy: row.defaultNetworkStrategy as MarketplaceProfiles['platforms'][number]['defaultNetworkStrategy'],
        collectorReady: Boolean(row.collectorReady)
      })),
      accounts: accounts.map(row => ({
        id: row.id,
        platformCode: row.platformCode as MarketplacePlatformCode,
        name: row.name,
        networkStrategy: row.networkStrategy as MarketplaceAccountProfile['networkStrategy'],
        status: row.status
      }))
    }
  }

  async addMarketplaceAccount(platformCode: MarketplacePlatformCode, name: string): Promise<MarketplaceAccountProfile> {
    const account: MarketplaceAccountProfile = { id: randomUUID(), platformCode, name, networkStrategy: 'LOCAL_DIRECT', status: 'ACTIVE' }
    const now = new Date().toISOString()
    await this.db.marketplaceAccount.create({
      data: { id: account.id, orgId: this.orgId, platformCode: account.platformCode, name: account.name, networkStrategy: account.networkStrategy, status: account.status, createdAt: now, updatedAt: now }
    })
    return account
  }

  async getMarketplaceCredentialStatus(accountId: string): Promise<MarketplaceCredentialStatus> {
    const row = await this.db.marketplaceAccountCredential.findFirst({ where: { orgId: this.orgId, accountId } })
    return {
      accountId,
      username: row?.username || '',
      passwordSaved: Boolean(row?.encryptedPassword),
      mode: row?.automationMode || 'SESSION_ONLY',
      updatedAt: row?.updatedAt || undefined
    }
  }

  async saveMarketplaceCredential(input: MarketplaceCredentialSaveInput): Promise<MarketplaceCredentialStatus> {
    const account = await this.db.marketplaceAccount.findFirst({ where: { id: input.accountId, orgId: this.orgId }, select: { id: true } })
    if (!account) throw httpError(404, 'ACCOUNT_NOT_FOUND', '平台账号不存在')
    const now = new Date().toISOString()
    const existing = await this.db.marketplaceAccountCredential.findFirst({ where: { orgId: this.orgId, accountId: input.accountId } })
    const encryptedPassword = input.encryptedPassword === '' ? existing?.encryptedPassword || '' : input.encryptedPassword
    if (existing) {
      await this.db.marketplaceAccountCredential.update({
        where: { accountId: input.accountId },
        data: { platformCode: input.platformCode, username: input.username, encryptedPassword, automationMode: input.mode, updatedAt: now }
      })
    } else {
      await this.db.marketplaceAccountCredential.create({
        data: { accountId: input.accountId, orgId: this.orgId, platformCode: input.platformCode, username: input.username, encryptedPassword, automationMode: input.mode, updatedAt: now }
      })
    }
    return this.getMarketplaceCredentialStatus(input.accountId)
  }

  async deleteMarketplaceCredential(accountId: string): Promise<void> {
    await this.db.marketplaceAccountCredential.deleteMany({ where: { orgId: this.orgId, accountId } })
  }

  // ---------------------------------------------------------------- 候选保存

  async saveProducts(taskId: string, products: CollectedOzonProduct[]): Promise<void> {
    const task = await this.getTask(taskId)
    if (!task) throw httpError(404, 'TASK_NOT_FOUND', '保存跨境候选失败：任务不存在')
    await this.inTx(async repo => {
      const now = new Date().toISOString()
      const existingRows = await repo.db.marketCandidate.findMany({
        where: { orgId: repo.orgId, platformCode: 'OZON', url: { in: products.map(product => product.url) } },
        select: { url: true }
      })
      const updatedCount = existingRows.length
      for (const product of products) {
        await repo.db.marketCandidate.upsert({
          where: { orgId_platformCode_url: { orgId: repo.orgId, platformCode: 'OZON', url: product.url } },
          create: {
            orgId: repo.orgId, platformCode: 'OZON', productId: product.productId || '', url: product.url,
            firstTaskId: taskId, latestTaskId: taskId, payload: product as unknown as Prisma.JsonObject, collectedAt: now, updatedAt: now
          },
          update: { productId: product.productId || '', latestTaskId: taskId, payload: product as unknown as Prisma.JsonObject, updatedAt: now, deletedAt: null }
        })
      }
      const sourceEntry = task.collectionMethod === 'KEYWORD' ? task.keyword : task.sourceUrl
      await repo.db.candidateCollectionRun.upsert({
        where: { id: taskId },
        create: {
          id: taskId, orgId: repo.orgId, taskId, candidateArea: 'MARKET', platformCode: 'OZON', collectionMethod: task.collectionMethod,
          sourceEntry, requestedCount: task.maxProducts, collectedCount: products.length, newCount: products.length - updatedCount,
          updatedCount, selectedCount: 0, status: 'COMPLETED', startedAt: task.createdAt, completedAt: now
        },
        update: { collectedCount: products.length, newCount: products.length - updatedCount, updatedCount, status: 'COMPLETED', completedAt: now }
      })
      await repo.db.candidateCollectionRecord.deleteMany({ where: { collectionRunId: taskId, orgId: repo.orgId } })
      if (products.length) {
        await repo.db.candidateCollectionRecord.createMany({
          data: products.map((product, index) => ({
            collectionRunId: taskId, orgId: repo.orgId, candidateArea: 'MARKET', candidateKey: `OZON:${product.url}`, platformCode: 'OZON',
            collectionMethod: task.collectionMethod, sourceEntry, sourceRank: index, collectedAt: now
          }))
        })
      }
    })
  }

  async saveSupplyProducts(taskId: string, products: CollectedSupplyProduct[]): Promise<void> {
    const task = await this.getTask(taskId)
    if (!task) throw httpError(404, 'TASK_NOT_FOUND', '保存供应链候选失败：任务不存在')
    await this.inTx(async repo => {
      const now = new Date().toISOString()
      const urls = products.map(product => product.url)
      const existingRows = urls.length
        ? await repo.db.supplyCandidate.findMany({ where: { orgId: repo.orgId, url: { in: urls }, taskId: { not: taskId } }, select: { url: true } })
        : []
      const updatedCount = existingRows.length
      await repo.db.supplyCandidate.deleteMany({ where: { taskId, orgId: repo.orgId } })
      await repo.db.productEvaluation.deleteMany({ where: { taskId, orgId: repo.orgId } })
      await repo.db.productRejectionRecord.deleteMany({ where: { taskId, orgId: repo.orgId } })
      for (const [index, product] of products.entries()) {
        await repo.db.supplyCandidate.create({
          data: { taskId, orgId: repo.orgId, url: product.url, payload: product as unknown as Prisma.JsonObject, score: product.score, selected: product.selected ? 1 : 0, sortOrder: index }
        })
        const evaluationId = randomUUID()
        await repo.db.productEvaluation.create({
          data: {
            id: evaluationId, orgId: repo.orgId, taskId, productUrl: product.url, totalScore: product.score, grade: product.grade,
            dataCompleteness: product.dataCompleteness / 100, dimensionScores: product.dimensionScores as unknown as Prisma.JsonObject,
            recommendation: product.recommendation, evaluatedAt: now
          }
        })
        const evidenceContent = JSON.stringify({
          supplierBadges: product.supplierBadges,
          categoryTopRank: product.categoryTopRank,
          returnRate: product.returnRate,
          networkSalesCount: product.networkSalesCount,
          serviceRating: product.serviceRating
        })
        for (const [code, score] of Object.entries(product.dimensionScores)) {
          await repo.db.evaluationEvidence.create({
            data: { id: randomUUID(), orgId: repo.orgId, evaluationId, dimensionCode: code, evidenceType: 'DOM_TEXT', sourceUrl: product.url, content: evidenceContent, scoreEffect: score }
          })
        }
        for (const [riskIndex, risk] of product.riskFlags.entries()) {
          await repo.db.productRiskFlag.create({
            data: { id: randomUUID(), orgId: repo.orgId, evaluationId, riskCode: `RISK_${riskIndex + 1}`, severity: 'MEDIUM', detail: risk }
          })
        }
        if (!product.selected) {
          await repo.db.productRejectionRecord.create({
            data: { id: randomUUID(), orgId: repo.orgId, taskId, productUrl: product.url, reasonCode: 'RULE_NOT_MET', reason: product.recommendation, createdAt: now }
          })
        }
      }
      const platformCode = task.supplyPlatforms[0] || '1688'
      const sourceEntry = task.collectionMethod === 'KEYWORD' ? task.keyword : task.sourceUrl
      await repo.db.candidateCollectionRun.upsert({
        where: { id: taskId },
        create: {
          id: taskId, orgId: repo.orgId, taskId, candidateArea: 'SUPPLY', platformCode, collectionMethod: task.collectionMethod,
          sourceEntry, requestedCount: task.maxProducts, collectedCount: products.length, newCount: products.length - updatedCount,
          updatedCount, selectedCount: products.filter(product => product.selected).length, status: 'COMPLETED', startedAt: task.createdAt, completedAt: now
        },
        update: {
          collectedCount: products.length, newCount: products.length - updatedCount, updatedCount,
          selectedCount: products.filter(product => product.selected).length, status: 'COMPLETED', completedAt: now
        }
      })
      await repo.db.candidateCollectionRecord.deleteMany({ where: { collectionRunId: taskId, orgId: repo.orgId } })
      if (products.length) {
        await repo.db.candidateCollectionRecord.createMany({
          data: products.map((product, index) => ({
            collectionRunId: taskId, orgId: repo.orgId, candidateArea: 'SUPPLY', candidateKey: `${product.platformCode}:${product.url}`, platformCode: product.platformCode,
            collectionMethod: task.collectionMethod, sourceEntry, sourceRank: index, collectedAt: now
          }))
        })
      }
    })
  }

  async importPluginSupplyCandidates(task: SelectionTask, products: CollectedSupplyProduct[]): Promise<CollectorPluginImportResult> {
    if (!products.length) return { imported: 0, updated: 0, total: 0, blocked: 0, duplicates: [] }
    const duplicates: CollectorDuplicateProduct[] = []
    const accepted: CollectedSupplyProduct[] = []
    const incoming = new Set<string>()
    for (const product of products) {
      const identity = this.intakeIdentity(product.platformCode, product.productId, product.url)
      const duplicate = await this.duplicateForProduct(product)
      if (duplicate) duplicates.push(duplicate)
      else if (incoming.has(identity)) duplicates.push({ platformCode: product.platformCode, productId: product.productId, title: product.title, stage: 'CANDIDATE', message: '本次选择中存在重复商品' })
      else {
        incoming.add(identity)
        accepted.push(product)
      }
    }
    if (!accepted.length) {
      const rows = await this.db.$queryRaw<Array<{ total: bigint }>>`
        SELECT COUNT(DISTINCT url) AS total FROM supply_candidates
        WHERE org_id = ${this.orgId} AND deleted_at IS NULL AND COALESCE(payload->>'platformCode', '1688') = ${task.supplyPlatforms[0]}`
      return { imported: 0, updated: 0, total: Number(rows[0]?.total || 0), blocked: duplicates.length, duplicates }
    }
    await this.saveTask(task)
    const now = new Date().toISOString()
    const runId = randomUUID()
    await this.inTx(async repo => {
      for (const [index, product] of accepted.entries()) {
        const previousRows = await repo.db.$queryRaw<Array<{ payload: unknown }>>`
          SELECT p.payload FROM supply_candidates p
          JOIN selection_tasks t ON t.id = p.task_id AND t.org_id = p.org_id
          WHERE p.org_id = ${repo.orgId} AND p.url = ${product.url} AND COALESCE(p.payload->>'platformCode', '1688') = ${product.platformCode}
          ORDER BY t.created_at DESC`
        const previousProducts = previousRows.map(row => parsePayload<CollectedSupplyProduct>(row.payload))
        let imageUrl = product.imageUrl
        if (!isUsableCandidateImage(imageUrl)) {
          const existing = previousProducts.map(item => item.imageUrl).find(isUsableCandidateImage)
          if (existing) imageUrl = existing
        }
        const previousCategory = previousProducts.map(item => item.sourceCategory).find(Boolean)
        const categoryRank = (status?: string) => status === 'EXACT' ? 3 : status === 'PARTIAL' ? 2 : status === 'NEEDS_REVIEW' ? 1 : 0
        const sourceCategory = categoryRank(previousCategory?.status) > categoryRank(product.sourceCategory?.status) ? previousCategory : product.sourceCategory
        const savedProduct = { ...product, imageUrl, sourceCategory }
        await repo.db.supplyCandidate.upsert({
          where: { taskId_url: { taskId: task.id, url: product.url } },
          create: { taskId: task.id, orgId: repo.orgId, url: product.url, payload: savedProduct as unknown as Prisma.JsonObject, score: product.score, selected: 0, sortOrder: index },
          update: { payload: savedProduct as unknown as Prisma.JsonObject, score: product.score, selected: 0, sortOrder: index, deletedAt: null }
        })
        await repo.registerProductIntake(product.platformCode, product.productId, product.url, product.title, 'CANDIDATE', now)
      }
      await repo.db.candidateCollectionRun.create({
        data: {
          id: runId, orgId: repo.orgId, taskId: task.id, candidateArea: 'SUPPLY', platformCode: task.supplyPlatforms[0] || '1688',
          collectionMethod: 'PRODUCT_URL', sourceEntry: '内置选择采集', requestedCount: products.length, collectedCount: accepted.length,
          newCount: accepted.length, updatedCount: 0, selectedCount: 0, status: 'COMPLETED', startedAt: now, completedAt: now
        }
      })
      await repo.db.candidateCollectionRecord.createMany({
        data: accepted.map((product, index) => ({
          collectionRunId: runId, orgId: repo.orgId, candidateArea: 'SUPPLY', candidateKey: `${product.platformCode}:${product.url}`,
          platformCode: product.platformCode, collectionMethod: 'PRODUCT_URL', sourceEntry: '内置选择采集', sourceRank: index, collectedAt: now
        }))
      })
    })
    const rows = await this.db.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(DISTINCT url) AS total FROM supply_candidates
      WHERE org_id = ${this.orgId} AND deleted_at IS NULL AND COALESCE(payload->>'platformCode', '1688') = ${task.supplyPlatforms[0]}`
    return { imported: accepted.length, updated: 0, total: Number(rows[0]?.total || 0), blocked: duplicates.length, duplicates }
  }

  // ---------------------------------------------------------------- 候选工作区

  async getLatestWorkspace(): Promise<PersistedWorkspace | null> {
    const row = await this.db.selectionTask.findFirst({
      where: { orgId: this.orgId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, payload: true, stage: true }
    })
    if (!row) return null
    const task = parsePayload<SelectionTask>(row.payload)
    task.stage = row.stage as SelectionTask['stage']
    const productRows = await this.db.marketCandidate.findMany({
      where: { orgId: this.orgId, latestTaskId: task.id },
      orderBy: { updatedAt: 'desc' },
      select: { payload: true }
    })
    const supplyRows = await this.db.supplyCandidate.findMany({
      where: { orgId: this.orgId, taskId: task.id },
      orderBy: [{ selected: 'desc' }, { score: 'desc' }, { sortOrder: 'asc' }],
      select: { payload: true }
    })
    return {
      task,
      products: productRows.map(item => parsePayload<CollectedOzonProduct>(item.payload)),
      supplyProducts: supplyRows.map(item => parsePayload<CollectedSupplyProduct>(item.payload))
    }
  }

  async getCandidateWorkspace(): Promise<CandidateWorkspace> {
    const productRows = await this.db.marketCandidate.findMany({
      where: { orgId: this.orgId },
      select: { payload: true, deletedAt: true, updatedAt: true }
    })
    productRows.sort((a, b) => Number(Boolean(a.deletedAt)) - Number(Boolean(b.deletedAt)) || b.updatedAt.localeCompare(a.updatedAt))
    const supplyRows = await this.db.supplyCandidate.findMany({
      where: { orgId: this.orgId },
      select: { payload: true, deletedAt: true, selected: true, score: true, sortOrder: true, task: { select: { createdAt: true } } }
    })
    supplyRows.sort((a, b) =>
      Number(Boolean(a.deletedAt)) - Number(Boolean(b.deletedAt)) ||
      b.task.createdAt.localeCompare(a.task.createdAt) ||
      b.selected - a.selected ||
      b.score - a.score ||
      a.sortOrder - b.sortOrder
    )
    const runRows = await this.db.candidateCollectionRun.findMany({ where: { orgId: this.orgId }, orderBy: { completedAt: 'desc' } })
    const recordRows = await this.db.candidateCollectionRecord.findMany({
      where: { orgId: this.orgId },
      orderBy: [{ collectedAt: 'desc' }, { sourceRank: 'asc' }]
    })
    const unique = <T extends { url: string; candidateDeletedAt?: string }>(rows: Array<{ payload: unknown; deletedAt: string | null }>) => {
      const products = new Map<string, T>()
      rows.forEach(row => {
        const product = parsePayload<T>(row.payload)
        if (row.deletedAt) product.candidateDeletedAt = row.deletedAt
        else delete product.candidateDeletedAt
        if (!products.has(product.url)) products.set(product.url, product)
      })
      return [...products.values()]
    }
    return {
      products: unique<CollectedOzonProduct>(productRows),
      supplyProducts: unique<CollectedSupplyProduct>(supplyRows),
      runs: runRows.map(row => ({
        id: row.id, taskId: row.taskId, candidateArea: row.candidateArea as CandidateCollectionRun['candidateArea'], platformCode: row.platformCode,
        collectionMethod: row.collectionMethod as CandidateCollectionRun['collectionMethod'], sourceEntry: row.sourceEntry,
        requestedCount: row.requestedCount, collectedCount: row.collectedCount, newCount: row.newCount, updatedCount: row.updatedCount,
        selectedCount: row.selectedCount, status: row.status, startedAt: row.startedAt, completedAt: row.completedAt
      })),
      records: recordRows.map(row => ({
        candidateArea: row.candidateArea as CandidateCollectionRecord['candidateArea'], candidateKey: row.candidateKey, collectionRunId: row.collectionRunId,
        platformCode: row.platformCode, collectionMethod: row.collectionMethod as CandidateCollectionRecord['collectionMethod'],
        sourceEntry: row.sourceEntry, sourceRank: row.sourceRank, collectedAt: row.collectedAt
      }))
    }
  }

  async setCandidatesDeleted(request: CandidateUpdateRequest, deleted: boolean): Promise<CandidateWorkspace> {
    if (!request.candidateKeys.length) return this.getCandidateWorkspace()
    const timestamp = deleted ? new Date().toISOString() : null
    await this.inTx(async repo => {
      if (request.candidateArea === 'MARKET') {
        for (const key of request.candidateKeys) {
          const separator = key.indexOf(':')
          await repo.db.marketCandidate.updateMany({
            where: { orgId: repo.orgId, platformCode: key.slice(0, separator), url: key.slice(separator + 1) },
            data: { deletedAt: timestamp }
          })
        }
      } else {
        for (const key of request.candidateKeys) {
          const separator = key.indexOf(':')
          const platformCode = key.slice(0, separator)
          const url = key.slice(separator + 1)
          await repo.db.$executeRaw`
            UPDATE supply_candidates SET deleted_at = ${timestamp}
            WHERE org_id = ${repo.orgId} AND url = ${url} AND COALESCE(payload->>'platformCode', '1688') = ${platformCode}`
        }
      }
    })
    return this.getCandidateWorkspace()
  }

  async purgeCandidates(request: CandidateUpdateRequest): Promise<CandidateWorkspace> {
    if (!request.candidateKeys.length) return this.getCandidateWorkspace()
    await this.inTx(async repo => {
      if (request.candidateArea === 'MARKET') {
        for (const key of request.candidateKeys) {
          const separator = key.indexOf(':')
          const platformCode = key.slice(0, separator)
          const url = key.slice(separator + 1)
          const row = await repo.db.marketCandidate.findFirst({
            where: { orgId: repo.orgId, platformCode, url },
            select: { productId: true, payload: true }
          })
          if (row) {
            const payload = parsePayload<CollectedOzonProduct>(row.payload)
            const now = new Date().toISOString()
            await repo.registerProductIntake(platformCode, row.productId, url, payload.title, 'HISTORY', now, now)
          }
          await repo.db.marketCandidate.deleteMany({ where: { orgId: repo.orgId, platformCode, url } })
          await repo.db.candidateCollectionRecord.deleteMany({ where: { orgId: repo.orgId, candidateArea: 'MARKET', candidateKey: key } })
        }
      } else {
        const deletedAt = new Date().toISOString()
        for (const key of request.candidateKeys) {
          const separator = key.indexOf(':')
          const platformCode = key.slice(0, separator)
          const url = key.slice(separator + 1)
          const rows = await repo.db.$queryRaw<Array<{ payload: unknown }>>`
            SELECT payload FROM supply_candidates
            WHERE org_id = ${repo.orgId} AND url = ${url} AND COALESCE(payload->>'platformCode', '1688') = ${platformCode}`
          for (const row of rows) {
            await repo.markCandidatePhysicallyDeleted(parsePayload<CollectedSupplyProduct>(row.payload), deletedAt)
          }
          await repo.db.$executeRaw`
            DELETE FROM supply_candidates
            WHERE org_id = ${repo.orgId} AND url = ${url} AND COALESCE(payload->>'platformCode', '1688') = ${platformCode}`
          await repo.db.candidateCollectionRecord.deleteMany({ where: { orgId: repo.orgId, candidateArea: 'SUPPLY', candidateKey: key } })
        }
      }
    })
    return this.getCandidateWorkspace()
  }

  // ---------------------------------------------------------------- 比价

  private comparisonNumber(value: string) {
    const match = value.replace(/\s/g, '').replace(',', '.').match(/\d+(?:\.\d+)?/)
    return match ? Number(match[0]) : 0
  }

  private comparisonSimilarity(left: string, right: string) {
    const pairs = (value: string) => {
      const normalized = value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
      const result = new Set<string>()
      for (let index = 0; index < normalized.length - 1; index += 1) result.add(normalized.slice(index, index + 2))
      return result
    }
    const a = pairs(left)
    const b = pairs(right)
    if (!a.size || !b.size) return 0
    const common = [...a].filter(pair => b.has(pair)).length
    return common / new Set([...a, ...b]).size
  }

  private calculateComparison(record: ComparisonRecordView): ComparisonRecordView {
    const primary = record.suppliers.find(item => item.binding === 'PRIMARY')
    const purchase = record.purchasePriceCny || primary?.price || 0
    const revenue = record.sellingPriceRub * record.settings.exchangeRate
    const rateCosts = revenue * (record.settings.commissionRate + record.settings.advertisingRate + record.settings.returnLossRate + record.settings.taxRate) / 100
    const landed = purchase + record.settings.domesticShipping + record.settings.packagingCost + record.settings.internationalLogistics + record.settings.fulfillmentCost + record.settings.otherCost + rateCosts
    const profit = revenue - landed
    return {
      ...record,
      sellingPriceCny: Number(revenue.toFixed(2)),
      purchasePriceCny: Number(purchase.toFixed(2)),
      landedCostCny: Number(landed.toFixed(2)),
      estimatedProfitCny: Number(profit.toFixed(2)),
      estimatedMargin: revenue ? Number((profit / revenue * 100).toFixed(1)) : 0
    }
  }

  async getComparisons(): Promise<ComparisonRecordView[]> {
    const rows = await this.db.$queryRaw<Array<Record<string, unknown>>>`
      SELECT c.id, c.task_id, c.ozon_url, c.status, c.match_score, c.ozon_price_rub, c.purchase_price_cny, c.landed_cost_cny, c.estimated_profit_cny, c.estimated_margin, c.payload, c.updated_at,
        (SELECT s.decision FROM selection_records s WHERE s.org_id = c.org_id AND s.comparison_id = c.id ORDER BY s.updated_at DESC LIMIT 1) AS selection_decision,
        (SELECT w.id FROM supply_warehouse_products w WHERE w.org_id = c.org_id AND w.selection_id = (
          SELECT s2.id FROM selection_records s2 WHERE s2.org_id = c.org_id AND s2.comparison_id = c.id ORDER BY s2.updated_at DESC LIMIT 1
        ) AND w.status = 'ACTIVE' LIMIT 1) AS warehouse_product_id
      FROM comparison_records c
      WHERE c.org_id = ${this.orgId}
      ORDER BY c.updated_at DESC`
    return rows.map(row => {
      const payload = parsePayload<Partial<ComparisonRecordView>>(row.payload || {})
      return {
        id: String(row.id),
        taskId: String(row.task_id),
        marketProduct: payload.marketProduct!,
        suppliers: payload.suppliers || [],
        decision: payload.decision || 'PENDING',
        sellingPriceRub: Number(row.ozon_price_rub || payload.sellingPriceRub || 0),
        sellingPriceCny: Number(payload.sellingPriceCny || 0),
        purchasePriceCny: Number(row.purchase_price_cny || 0),
        landedCostCny: Number(row.landed_cost_cny || 0),
        estimatedProfitCny: Number(row.estimated_profit_cny || 0),
        estimatedMargin: Number(row.estimated_margin || 0),
        settings: payload.settings!,
        selectionDecision: (row.selection_decision as SelectionDecision | null) || undefined,
        warehouseProductId: row.warehouse_product_id ? String(row.warehouse_product_id) : undefined,
        updatedAt: String(row.updated_at)
      }
    }).filter(item => Boolean(item.marketProduct && item.settings))
  }

  async importComparison(request: ComparisonImportRequest): Promise<ComparisonRecordView> {
    const taskRow = await this.db.marketCandidate.findFirst({
      where: { orgId: this.orgId, url: request.product.url },
      orderBy: { updatedAt: 'desc' },
      select: { latestTaskId: true }
    })
    if (!taskRow) throw httpError(404, 'TASK_NOT_FOUND', '无法找到该商品的采集任务')
    const existing = await this.db.comparisonRecord.findFirst({ where: { orgId: this.orgId, ozonUrl: request.product.url }, select: { id: true } })
    if (existing) {
      const saved = (await this.getComparisons()).find(item => item.id === existing.id)
      if (saved) return saved
      await this.db.comparisonRecord.deleteMany({ where: { id: existing.id, orgId: this.orgId } })
    }
    const task = await this.getTask(taskRow.latestTaskId)
    const supply = (await this.getCandidateWorkspace()).supplyProducts.filter(item => !item.candidateDeletedAt)
    const suppliers: ComparisonSupplierMatch[] = supply.map(item => {
      const similarity = this.comparisonSimilarity(request.product.title, item.title)
      return {
        url: item.url, productId: item.productId, title: item.title, imageUrl: item.imageUrl, supplierName: item.supplierName,
        price: this.comparisonNumber(item.priceText), priceText: item.priceText, moq: 1,
        matchScore: Math.min(99, Math.round(45 + similarity * 40 + item.score * 0.14)),
        supplyScore: item.score, recommendation: item.recommendation, riskFlags: item.riskFlags, binding: 'NONE' as const
      }
    }).sort((a, b) => b.matchScore - a.matchScore).slice(0, 6)
    if (suppliers[0]) suppliers[0].binding = 'PRIMARY'
    const settings: ComparisonCostSettings = {
      exchangeRate: task?.exchangeRate || 0.09, commissionRate: 12, domesticShipping: 2, packagingCost: 1.5,
      internationalLogistics: 18, fulfillmentCost: 8, advertisingRate: 5, returnLossRate: 3, taxRate: 0, otherCost: 1
    }
    const now = new Date().toISOString()
    const id = randomUUID()
    let record: ComparisonRecordView = {
      id, taskId: taskRow.latestTaskId, marketProduct: request.product, suppliers,
      decision: suppliers.length ? 'PENDING' : 'FAILED',
      sellingPriceRub: this.comparisonNumber(request.product.priceText), sellingPriceCny: 0,
      purchasePriceCny: suppliers[0]?.price || 0, landedCostCny: 0, estimatedProfitCny: 0, estimatedMargin: 0,
      settings, updatedAt: now
    }
    record = this.calculateComparison(record)
    await this.db.comparisonRecord.create({
      data: {
        id, orgId: this.orgId, taskId: record.taskId, ozonUrl: record.marketProduct.url, supplierUrl: suppliers[0]?.url || null,
        status: 'COMPLETED', matchScore: suppliers[0]?.matchScore || 0, ozonPriceRub: record.sellingPriceRub,
        purchasePriceCny: record.purchasePriceCny, landedCostCny: record.landedCostCny, estimatedProfitCny: record.estimatedProfitCny,
        estimatedMargin: record.estimatedMargin, payload: record as unknown as Prisma.JsonObject, updatedAt: now
      }
    })
    return record
  }

  async updateComparison(request: ComparisonUpdateRequest): Promise<ComparisonRecordView> {
    const record = (await this.getComparisons()).find(item => item.id === request.id)
    if (!record) throw httpError(404, 'COMPARISON_NOT_FOUND', '比价记录不存在')
    if (request.decision) record.decision = request.decision
    if (request.settings) record.settings = request.settings
    if (request.purchasePriceCny !== undefined) record.purchasePriceCny = Math.max(0, request.purchasePriceCny)
    if (request.supplierUrl && request.binding) {
      record.suppliers = record.suppliers.map(item => ({
        ...item,
        binding: item.url === request.supplierUrl ? request.binding! : request.binding === 'PRIMARY' && item.binding === 'PRIMARY' ? 'NONE' : item.binding
      }))
      const primary = record.suppliers.find(item => item.binding === 'PRIMARY')
      if (request.binding === 'PRIMARY' && primary) record.purchasePriceCny = primary.price
    }
    record.updatedAt = new Date().toISOString()
    const calculated = this.calculateComparison(record)
    const primary = calculated.suppliers.find(item => item.binding === 'PRIMARY')
    await this.db.comparisonRecord.updateMany({
      where: { id: calculated.id, orgId: this.orgId },
      data: {
        supplierUrl: primary?.url || null, status: 'COMPLETED', matchScore: primary?.matchScore || 0,
        purchasePriceCny: calculated.purchasePriceCny, landedCostCny: calculated.landedCostCny,
        estimatedProfitCny: calculated.estimatedProfitCny, estimatedMargin: calculated.estimatedMargin,
        payload: calculated as unknown as Prisma.JsonObject, updatedAt: calculated.updatedAt
      }
    })
    return calculated
  }

  async promoteComparisonToWarehouse(request: ComparisonPromotionRequest): Promise<ComparisonPromotionResult> {
    return this.inTx(async repo => {
      let comparison = (await repo.getComparisons()).find(item => item.id === request.id)
      if (!comparison) throw httpError(404, 'COMPARISON_NOT_FOUND', '比价记录不存在')
      const primary = comparison.suppliers.find(item => item.binding === 'PRIMARY')
      if (!primary) throw httpError(400, 'PRIMARY_SUPPLIER_REQUIRED', '请先绑定1688主货源')
      comparison = await repo.updateComparison({ id: comparison.id, decision: 'RECOMMENDED' })
      const imported = await repo.importSelection({
        sourceArea: 'MARKET',
        product: comparison.marketProduct,
        category: request.category,
        subcategory: request.subcategory,
        tertiaryCategory: request.tertiaryCategory,
        comparison
      })
      const selection = await repo.updateSelectionDecision(imported.id, 'APPROVED')
      const warehouseProduct = (await repo.getSupplyWarehouseProducts()).find(item => item.selectionId === selection.id)
      if (!warehouseProduct) throw new Error('供应仓商品生成失败')
      await repo.db.workflowEvent.create({
        data: {
          orgId: repo.orgId, taskId: comparison.taskId, ozonUrl: comparison.marketProduct.url, stage: 'REVERSE_COMPARE',
          action: 'PROMOTE_TO_SUPPLY_WAREHOUSE',
          detail: {
            comparisonId: comparison.id, selectionId: selection.id, warehouseProductId: warehouseProduct.id,
            supplierUrl: primary.url, estimatedMargin: comparison.estimatedMargin
          } as unknown as Prisma.JsonObject,
          createdAt: new Date().toISOString()
        }
      })
      return { comparison: (await repo.getComparisons()).find(item => item.id === comparison.id)!, selection, warehouseProduct }
    })
  }

  // ---------------------------------------------------------------- 选品

  async getSelectionCatalog(): Promise<SelectionCatalogItem[]> {
    const rows = await this.db.selectionRecord.findMany({
      where: { orgId: this.orgId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, taskId: true, ozonUrl: true, decision: true, reason: true, payload: true, updatedAt: true }
    })
    return rows.map(row => {
      const payload = parsePayload<Partial<SelectionCatalogItem>>(row.payload || {})
      return {
        id: row.id, taskId: row.taskId, sourceArea: payload.sourceArea || 'MARKET', sourceUrl: row.ozonUrl,
        productId: payload.productId || '', platformCode: payload.platformCode || 'OZON', title: payload.title || '未命名商品',
        imageUrl: payload.imageUrl || '', priceText: payload.priceText || '', score: Number(payload.score || 0),
        category: payload.category || '未分类', subcategory: payload.subcategory || '未分类', tertiaryCategory: payload.tertiaryCategory || '待细分',
        decision: row.decision as SelectionDecision, reason: row.reason || payload.reason || '', recommendation: payload.recommendation || '',
        riskFlags: Array.isArray(payload.riskFlags) ? payload.riskFlags : [],
        comparisonId: payload.comparisonId, supplierUrl: payload.supplierUrl,
        landedCostCny: payload.landedCostCny, estimatedProfitCny: payload.estimatedProfitCny, estimatedMargin: payload.estimatedMargin,
        updatedAt: row.updatedAt
      }
    })
  }

  async importSelection(request: SelectionImportRequest): Promise<SelectionCatalogItem> {
    const product = request.product
    const sourceUrl = product.url
    const taskRow = request.sourceArea === 'MARKET'
      ? await this.db.marketCandidate.findFirst({ where: { orgId: this.orgId, url: sourceUrl }, orderBy: { updatedAt: 'desc' }, select: { latestTaskId: true } }).then(row => row ? { taskId: row.latestTaskId } : null)
      : await this.db.$queryRaw<Array<{ task_id: string }>>`
          SELECT p.task_id FROM supply_candidates p
          JOIN selection_tasks t ON t.id = p.task_id AND t.org_id = p.org_id
          WHERE p.org_id = ${this.orgId} AND p.url = ${sourceUrl}
          ORDER BY t.created_at DESC LIMIT 1`.then(rows => rows[0] ? { taskId: rows[0].task_id } : null)
    if (!taskRow) throw httpError(404, 'TASK_NOT_FOUND', '无法找到该候选商品的采集任务')
    const taskId = taskRow.taskId
    const supply = request.sourceArea === 'SUPPLY' ? product as CollectedSupplyProduct : null
    const existing = await this.db.selectionRecord.findFirst({ where: { orgId: this.orgId, ozonUrl: sourceUrl }, select: { id: true, decision: true } })
    const now = new Date().toISOString()
    const id = existing?.id || randomUUID()
    const item: SelectionCatalogItem = {
      id, taskId, sourceArea: request.sourceArea, sourceUrl, productId: product.productId || '', platformCode: supply?.platformCode || 'OZON',
      title: product.title, imageUrl: product.imageUrl, priceText: product.priceText, score: supply?.score || 70,
      category: request.category, subcategory: request.subcategory, tertiaryCategory: request.tertiaryCategory || '待细分',
      decision: (existing?.decision as SelectionDecision | undefined) || 'PENDING',
      reason: supply?.recommendation || '已进入选品库，待结合利润和风险完成决策。',
      recommendation: supply?.recommendation || '待完成供应链比价',
      riskFlags: supply?.riskFlags || [],
      comparisonId: request.comparison?.id,
      supplierUrl: request.comparison?.suppliers.find(item => item.binding === 'PRIMARY')?.url,
      landedCostCny: request.comparison?.landedCostCny,
      estimatedProfitCny: request.comparison?.estimatedProfitCny,
      estimatedMargin: request.comparison?.estimatedMargin,
      updatedAt: now
    }
    if (existing) {
      await this.db.selectionRecord.update({
        where: { id },
        data: {
          taskId, comparisonId: request.comparison?.id || null, reason: item.reason,
          payload: item as unknown as Prisma.JsonObject, updatedAt: now
        }
      })
    } else {
      await this.db.selectionRecord.create({
        data: {
          id, orgId: this.orgId, taskId, ozonUrl: sourceUrl, comparisonId: request.comparison?.id || null,
          decision: item.decision, reason: item.reason, payload: item as unknown as Prisma.JsonObject, updatedAt: now
        }
      })
    }
    if (supply) await this.registerProductIntake(supply.platformCode, supply.productId, supply.url, supply.title, 'SELECTION', now)
    return item
  }

  async updateSelectionDecision(id: string, decision: SelectionDecision): Promise<SelectionCatalogItem> {
    const row = await this.db.selectionRecord.findFirst({ where: { id, orgId: this.orgId }, select: { payload: true } })
    if (!row) throw httpError(404, 'SELECTION_NOT_FOUND', '选品记录不存在')
    const payload = parsePayload<SelectionCatalogItem>(row.payload)
    payload.decision = decision
    payload.updatedAt = new Date().toISOString()
    await this.db.selectionRecord.update({
      where: { id },
      data: { decision, payload: payload as unknown as Prisma.JsonObject, updatedAt: payload.updatedAt }
    })
    if (payload.sourceArea === 'SUPPLY' || payload.supplierUrl) {
      if (decision === 'APPROVED') {
        await this.upsertSupplyWarehouseProduct(payload)
      } else {
        await this.db.supplyWarehouseProduct.updateMany({
          where: { orgId: this.orgId, selectionId: payload.id },
          data: { status: 'ARCHIVED', updatedAt: payload.updatedAt }
        })
      }
    }
    return (await this.getSelectionCatalog()).find(item => item.id === id)!
  }

  async updateSelectionCategory(id: string, category: string, subcategory: string, tertiaryCategory: string): Promise<SelectionCatalogItem> {
    const row = await this.db.selectionRecord.findFirst({ where: { id, orgId: this.orgId }, select: { payload: true } })
    if (!row) throw httpError(404, 'SELECTION_NOT_FOUND', '选品记录不存在')
    const payload = parsePayload<SelectionCatalogItem>(row.payload)
    payload.category = category
    payload.subcategory = subcategory
    payload.tertiaryCategory = tertiaryCategory
    payload.updatedAt = new Date().toISOString()
    await this.db.selectionRecord.update({
      where: { id },
      data: { payload: payload as unknown as Prisma.JsonObject, updatedAt: payload.updatedAt }
    })
    return (await this.getSelectionCatalog()).find(item => item.id === id)!
  }

  async returnSelectionToCandidates(id: string): Promise<void> {
    const result = await this.db.selectionRecord.deleteMany({ where: { id, orgId: this.orgId } })
    if (!result.count) throw httpError(404, 'SELECTION_NOT_FOUND', '选品记录不存在')
  }

  private async upsertSupplyWarehouseProduct(item: SelectionCatalogItem) {
    const now = new Date().toISOString()
    const sourceUrl = item.sourceArea === 'MARKET' && item.supplierUrl ? item.supplierUrl : item.sourceUrl
    const sourceRows = await this.db.$queryRaw<Array<{ payload: unknown }>>`
      SELECT p.payload FROM supply_candidates p
      JOIN selection_tasks t ON t.id = p.task_id AND t.org_id = p.org_id
      WHERE p.org_id = ${this.orgId} AND p.url = ${sourceUrl}
      ORDER BY t.created_at DESC LIMIT 1`
    const sourceProduct = sourceRows.length ? parsePayload<Partial<CollectedSupplyProduct>>(sourceRows[0]!.payload) : {}
    const warehouseCode = sourceProduct.platformCode === 'GIGACLOUD' || item.platformCode === 'GIGACLOUD' ? 'GIGACLOUD' : '1688'
    const existing = await this.db.supplyWarehouseProduct.findFirst({
      where: { orgId: this.orgId, warehouseCode, sourceUrl },
      select: { id: true }
    })
    const product: SupplyWarehouseProduct = {
      id: existing?.id || randomUUID(), warehouseCode, selectionId: item.id, sourceUrl,
      productId: sourceProduct.productId || item.productId, title: sourceProduct.title || item.title,
      imageUrl: sourceProduct.imageUrl || item.imageUrl, priceText: sourceProduct.priceText || item.priceText,
      supplierName: sourceProduct.supplierName || '', category: item.category, subcategory: item.subcategory,
      tertiaryCategory: item.tertiaryCategory || '待细分', status: 'ACTIVE', updatedAt: now
    }
    await this.db.supplyWarehouseProduct.upsert({
      where: { orgId_warehouseCode_sourceUrl: { orgId: this.orgId, warehouseCode, sourceUrl } },
      create: {
        id: product.id, orgId: this.orgId, warehouseCode, selectionId: item.id, sourceUrl,
        productId: product.productId, title: product.title, imageUrl: product.imageUrl, priceText: product.priceText,
        supplierName: product.supplierName, category: item.category, subcategory: item.subcategory,
        tertiaryCategory: product.tertiaryCategory, status: 'ACTIVE', payload: product as unknown as Prisma.JsonObject, createdAt: now, updatedAt: now
      },
      update: {
        selectionId: item.id, productId: product.productId, title: product.title, imageUrl: product.imageUrl,
        priceText: product.priceText, supplierName: product.supplierName, category: item.category, subcategory: item.subcategory,
        tertiaryCategory: product.tertiaryCategory, status: 'ACTIVE', payload: product as unknown as Prisma.JsonObject, updatedAt: now
      }
    })
    await this.registerProductIntake(warehouseCode, product.productId, sourceUrl, product.title, 'WAREHOUSE', now)
    return product
  }

  async getSupplyWarehouseProducts(): Promise<SupplyWarehouseProduct[]> {
    const rows = await this.db.supplyWarehouseProduct.findMany({
      where: { orgId: this.orgId, status: 'ACTIVE' },
      orderBy: { updatedAt: 'desc' }
    })
    return rows.map(row => ({
      id: row.id, warehouseCode: row.warehouseCode as SupplyWarehouseProduct['warehouseCode'], selectionId: row.selectionId || '',
      sourceUrl: row.sourceUrl, productId: row.productId, title: row.title, imageUrl: row.imageUrl, priceText: row.priceText,
      supplierName: row.supplierName, category: row.category, subcategory: row.subcategory, tertiaryCategory: row.tertiaryCategory,
      status: row.status as SupplyWarehouseProduct['status'], updatedAt: row.updatedAt
    }))
  }

  // ---------------------------------------------------------------- 平台选品 / 媒体 / 发布草稿

  async getMarketplaceSelections(marketplaceCode: MarketplacePlatformCode): Promise<MarketplaceSelectionProduct[]> {
    const rows = await this.db.marketplaceSelectionProduct.findMany({
      where: { orgId: this.orgId, marketplaceCode },
      orderBy: { updatedAt: 'desc' }
    })
    return rows.map(row => ({
      id: row.id, marketplaceCode: row.marketplaceCode as MarketplacePlatformCode, supplyProductId: row.supplyProductId,
      warehouseCode: row.warehouseCode as MarketplaceSelectionProduct['warehouseCode'], sourceUrl: row.sourceUrl, productId: row.productId,
      title: row.title, imageUrl: row.imageUrl, priceText: row.priceText, category: row.category,
      status: row.status as MarketplaceSelectionProduct['status'], mediaStatus: row.mediaStatus as MarketplaceSelectionProduct['mediaStatus'],
      updatedAt: row.updatedAt
    }))
  }

  async importMarketplaceSelection(marketplaceCode: MarketplacePlatformCode, supplyProductId: string): Promise<MarketplaceSelectionProduct> {
    const supply = (await this.getSupplyWarehouseProducts()).find(item => item.id === supplyProductId)
    if (!supply) throw httpError(404, 'WAREHOUSE_PRODUCT_NOT_FOUND', '供应仓商品不存在或已归档')
    const now = new Date().toISOString()
    const existing = await this.db.marketplaceSelectionProduct.findFirst({
      where: { orgId: this.orgId, marketplaceCode, supplyProductId },
      select: { id: true }
    })
    const item: MarketplaceSelectionProduct = {
      id: existing?.id || randomUUID(), marketplaceCode, supplyProductId, warehouseCode: supply.warehouseCode,
      sourceUrl: supply.sourceUrl, productId: supply.productId, title: supply.title, imageUrl: supply.imageUrl,
      priceText: supply.priceText, category: supply.category, status: 'SELECTED', mediaStatus: 'PENDING', updatedAt: now
    }
    await this.db.marketplaceSelectionProduct.upsert({
      where: { orgId_marketplaceCode_supplyProductId: { orgId: this.orgId, marketplaceCode, supplyProductId } },
      create: {
        id: item.id, orgId: this.orgId, marketplaceCode, supplyProductId, warehouseCode: supply.warehouseCode,
        sourceUrl: supply.sourceUrl, productId: supply.productId, title: supply.title, imageUrl: supply.imageUrl,
        priceText: supply.priceText, category: supply.category, status: 'SELECTED', mediaStatus: 'PENDING',
        payload: item as unknown as Prisma.JsonObject, createdAt: now, updatedAt: now
      },
      update: {
        title: supply.title, imageUrl: supply.imageUrl, priceText: supply.priceText, category: supply.category,
        status: 'SELECTED', payload: item as unknown as Prisma.JsonObject, updatedAt: now
      }
    })
    return item
  }

  async getMarketplaceMediaAssets(marketplaceSelectionId: string): Promise<MarketplaceMediaAsset[]> {
    const rows = await this.db.marketplaceMediaAsset.findMany({
      where: { orgId: this.orgId, marketplaceSelectionId },
      orderBy: [{ selected: 'desc' }, { createdAt: 'desc' }]
    })
    return rows.map(row => ({
      id: row.id, marketplaceSelectionId: row.marketplaceSelectionId, marketplaceCode: row.marketplaceCode as MarketplacePlatformCode,
      assetType: row.assetType as MarketplaceMediaAssetType, imageUrl: row.imageUrl, localPath: row.localPath,
      selected: Boolean(row.selected), createdAt: row.createdAt
    }))
  }

  async saveMarketplaceMediaAsset(marketplaceSelectionId: string, assetType: MarketplaceMediaAssetType, imageUrl: string, localPath = '', selected = false): Promise<MarketplaceMediaAsset> {
    const selection = await this.db.marketplaceSelectionProduct.findFirst({
      where: { id: marketplaceSelectionId, orgId: this.orgId },
      select: { marketplaceCode: true }
    })
    if (!selection) throw httpError(404, 'MARKETPLACE_SELECTION_NOT_FOUND', '平台选品记录不存在')
    const now = new Date().toISOString()
    const existing = await this.db.marketplaceMediaAsset.findFirst({
      where: { orgId: this.orgId, marketplaceSelectionId, assetType, imageUrl, localPath },
      select: { id: true }
    })
    const id = existing?.id || randomUUID()
    await this.inTx(async repo => {
      if (selected) await repo.db.marketplaceMediaAsset.updateMany({ where: { orgId: repo.orgId, marketplaceSelectionId }, data: { selected: 0 } })
      if (existing) {
        await repo.db.marketplaceMediaAsset.update({ where: { id }, data: { selected: selected ? 1 : 0 } })
      } else {
        await repo.db.marketplaceMediaAsset.create({
          data: {
            id, orgId: repo.orgId, marketplaceSelectionId, marketplaceCode: selection.marketplaceCode,
            assetType, imageUrl, localPath, selected: selected ? 1 : 0, createdAt: now
          }
        })
      }
      const mediaStatus = selected ? 'READY' : 'PROCESSING'
      await repo.db.marketplaceSelectionProduct.updateMany({
        where: { id: marketplaceSelectionId, orgId: repo.orgId },
        data: { mediaStatus, updatedAt: now }
      })
    })
    return (await this.getMarketplaceMediaAssets(marketplaceSelectionId)).find(item => item.id === id)!
  }

  async selectMarketplaceMediaAsset(id: string): Promise<MarketplaceMediaAsset> {
    const row = await this.db.marketplaceMediaAsset.findFirst({
      where: { id, orgId: this.orgId },
      select: { marketplaceSelectionId: true }
    })
    if (!row) throw httpError(404, 'MEDIA_ASSET_NOT_FOUND', '平台素材不存在')
    const now = new Date().toISOString()
    await this.inTx(async repo => {
      const assets = await repo.db.marketplaceMediaAsset.findMany({ where: { orgId: repo.orgId, marketplaceSelectionId: row.marketplaceSelectionId }, select: { id: true } })
      for (const asset of assets) {
        await repo.db.marketplaceMediaAsset.update({ where: { id: asset.id }, data: { selected: asset.id === id ? 1 : 0 } })
      }
      await repo.db.marketplaceSelectionProduct.updateMany({
        where: { id: row.marketplaceSelectionId, orgId: repo.orgId },
        data: { mediaStatus: 'READY', updatedAt: now }
      })
    })
    return (await this.getMarketplaceMediaAssets(row.marketplaceSelectionId)).find(item => item.id === id)!
  }

  async getMarketplacePublishDrafts(marketplaceCode: MarketplacePlatformCode): Promise<MarketplacePublishDraft[]> {
    const rows = await this.db.marketplacePublishDraft.findMany({
      where: { orgId: this.orgId, marketplaceCode },
      orderBy: { updatedAt: 'desc' }
    })
    return rows.map(row => ({
      id: row.id, marketplaceCode: row.marketplaceCode as MarketplacePlatformCode, marketplaceSelectionId: row.marketplaceSelectionId,
      platformSku: row.platformSku, title: row.title, imageUrl: row.imageUrl, priceText: row.priceText, storeId: row.storeId,
      status: row.status as MarketplacePublishDraft['status'], checks: parsePayload<string[]>(row.checks || []),
      error: row.error || undefined, platformProductId: row.platformProductId || undefined, updatedAt: row.updatedAt
    }))
  }

  async createMarketplacePublishDraft(marketplaceSelectionId: string, storeId = ''): Promise<MarketplacePublishDraft> {
    const selection = await this.db.marketplaceSelectionProduct.findFirst({
      where: { id: marketplaceSelectionId, orgId: this.orgId },
      select: { marketplaceCode: true, warehouseCode: true, productId: true, title: true, imageUrl: true, priceText: true }
    })
    if (!selection) throw httpError(404, 'MARKETPLACE_SELECTION_NOT_FOUND', '平台选品记录不存在')
    const selectedMedia = await this.db.marketplaceMediaAsset.findFirst({
      where: { orgId: this.orgId, marketplaceSelectionId, selected: 1 },
      select: { imageUrl: true, localPath: true }
    })
    const marketplaceCode = selection.marketplaceCode as MarketplacePlatformCode
    const skuPart = String(selection.productId || marketplaceSelectionId.slice(0, 8)).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || marketplaceSelectionId.slice(0, 8)
    const platformSku = `${marketplaceCode}-${selection.warehouseCode}-${skuPart}`.toUpperCase()
    const existing = await this.db.marketplacePublishDraft.findFirst({
      where: { orgId: this.orgId, marketplaceCode, marketplaceSelectionId },
      select: { id: true, storeId: true }
    })
    const id = existing?.id || randomUUID()
    const now = new Date().toISOString()
    const imageUrl = selectedMedia?.imageUrl || selectedMedia?.localPath || selection.imageUrl || ''
    const resolvedStoreId = storeId === '' && existing ? existing.storeId : storeId
    await this.db.marketplacePublishDraft.upsert({
      where: { orgId_marketplaceCode_marketplaceSelectionId: { orgId: this.orgId, marketplaceCode, marketplaceSelectionId } },
      create: {
        id, orgId: this.orgId, marketplaceCode, marketplaceSelectionId, platformSku, title: selection.title,
        imageUrl, priceText: selection.priceText || '', storeId: resolvedStoreId, status: 'DRAFT', checks: [], createdAt: now, updatedAt: now
      },
      update: { title: selection.title, imageUrl, priceText: selection.priceText || '', storeId: resolvedStoreId, updatedAt: now }
    })
    await this.addMarketplacePublishAudit(marketplaceCode, id, '生成发布草稿', `${platformSku} · 本地安全模式`)
    return (await this.getMarketplacePublishDrafts(marketplaceCode)).find(item => item.id === id)!
  }

  async updateMarketplacePublishDraft(request: MarketplacePublishDraftUpdate, action: string): Promise<MarketplacePublishDraft> {
    const current = await this.db.marketplacePublishDraft.findFirst({
      where: { id: request.id, orgId: this.orgId },
      select: { marketplaceCode: true, storeId: true, status: true, checks: true, error: true }
    })
    if (!current) throw httpError(404, 'PUBLISH_DRAFT_NOT_FOUND', '发布草稿不存在')
    const now = new Date().toISOString()
    const storeId = request.storeId ?? current.storeId ?? ''
    const status = request.status ?? current.status
    const checks = request.checks ?? parsePayload<string[]>(current.checks || [])
    const error = request.error === undefined ? current.error || null : request.error || null
    await this.db.marketplacePublishDraft.update({
      where: { id: request.id },
      data: { storeId, status, checks: checks as unknown as Prisma.JsonArray, error, updatedAt: now }
    })
    await this.addMarketplacePublishAudit(current.marketplaceCode as MarketplacePlatformCode, request.id, action, String(status))
    return (await this.getMarketplacePublishDrafts(current.marketplaceCode as MarketplacePlatformCode)).find(item => item.id === request.id)!
  }

  private async addMarketplacePublishAudit(marketplaceCode: MarketplacePlatformCode, draftId: string | undefined, action: string, detail: string) {
    await this.db.marketplacePublishAudit.create({
      data: { id: randomUUID(), orgId: this.orgId, marketplaceCode, draftId: draftId || null, action, detail, createdAt: new Date().toISOString() }
    })
  }

  async getMarketplacePublishAudits(marketplaceCode: MarketplacePlatformCode): Promise<MarketplacePublishAudit[]> {
    const rows = await this.db.marketplacePublishAudit.findMany({
      where: { orgId: this.orgId, marketplaceCode },
      orderBy: { createdAt: 'desc' }
    })
    return rows.map(row => ({
      id: row.id, marketplaceCode: row.marketplaceCode as MarketplacePlatformCode, draftId: row.draftId || undefined,
      action: row.action, detail: row.detail, createdAt: row.createdAt
    }))
  }

  // ---------------------------------------------------------------- 工作流计数

  async getWorkflowCounts(): Promise<WorkflowCounts> {
    const rows = await this.db.$queryRaw<Array<Record<string, bigint>>>`
      SELECT
        (SELECT COUNT(*) FROM market_candidates WHERE org_id = ${this.orgId} AND deleted_at IS NULL)
          + (SELECT COUNT(DISTINCT url) FROM supply_candidates WHERE org_id = ${this.orgId} AND deleted_at IS NULL) AS collected,
        (SELECT COUNT(*) FROM comparison_records WHERE org_id = ${this.orgId} AND status = 'COMPLETED') AS compared,
        (SELECT COUNT(*) FROM selection_records WHERE org_id = ${this.orgId} AND decision = 'APPROVED') AS selected,
        (SELECT COUNT(*) FROM inventory_records WHERE org_id = ${this.orgId} AND status = 'IN_STOCK') AS stocked,
        (SELECT COUNT(*) FROM listing_records WHERE org_id = ${this.orgId} AND status = 'PUBLISHED') AS listed,
        (SELECT COUNT(*) FROM purchase_orders WHERE org_id = ${this.orgId} AND status NOT IN ('COMPLETED', 'CANCELLED')) AS purchasing,
        (SELECT COUNT(*) FROM reconciliation_records WHERE org_id = ${this.orgId} AND status = 'COMPLETED') AS reconciled`
    const row = rows[0] || {}
    return {
      collected: Number(row.collected || 0),
      compared: Number(row.compared || 0),
      selected: Number(row.selected || 0),
      stocked: Number(row.stocked || 0),
      listed: Number(row.listed || 0),
      purchasing: Number(row.purchasing || 0),
      reconciled: Number(row.reconciled || 0)
    }
  }
}
