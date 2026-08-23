/**
 * 选品采集域数据层类型：移植自 src/shared/contracts.ts 选品采集段。
 * 仅保留数据层往返所需类型；浏览器采集动作、插件状态等留在客户端。
 */

export type SupplyPlatformCode = '1688' | 'TAOBAO' | 'TMALL' | 'JD' | 'PINDUODUO' | 'DOUYIN' | 'XIAOHONGSHU' | 'KUAISHOU' | 'GIGACLOUD' | 'YIWUGO' | 'CUSTOM'
export type SelectionMode = 'FORWARD_SUPPLY' | 'REVERSE_MARKET'
export type CollectionMethod = 'KEYWORD' | 'PRODUCT_URL' | 'CATEGORY_URL'
export type MarketplacePlatformCode = 'OZON' | 'AMAZON' | 'EBAY' | 'ALIEXPRESS' | 'TEMU'
export type NetworkStrategy = 'LOCAL_DIRECT' | 'SYSTEM' | 'PROXY_PROFILE'
export type SelectionRulePreset = 'BALANCED' | 'QUALITY_FIRST' | 'SALES_FIRST' | 'SUPPLY_FIRST' | 'LOW_RISK'
export type CollectionProtectionMode = 'CAUTIOUS' | 'STANDARD' | 'FAST'
export type GigaSellerIndexFilter = 'ANY' | 'NEW' | 'GE90' | 'GE80' | 'GE70' | 'GE60' | 'LT60'
export type GigaReturnRateFilter = 'ANY' | 'LOW' | 'MEDIUM' | 'HIGH'
export type CandidateArea = 'SUPPLY' | 'MARKET'

export type TaskStage =
  | 'CREATED'
  | 'PREVIEW_RUNNING'
  | 'PREVIEW_READY'
  | 'CONFIRM_RUNNING'
  | 'OZON_LIST_PENDING'
  | 'OZON_LIST_RUNNING'
  | 'OZON_LIST_COMPLETED'
  | 'SUPPLY_LIST_RUNNING'
  | 'SUPPLY_LIST_COMPLETED'
  | 'PAUSED'
  | 'FAILED'

export interface MarketplacePlatformProfile {
  code: MarketplacePlatformCode
  name: string
  homeUrl: string
  defaultNetworkStrategy: NetworkStrategy
  collectorReady: boolean
}

export interface MarketplaceAccountProfile {
  id: string
  platformCode: MarketplacePlatformCode
  name: string
  networkStrategy: NetworkStrategy
  status: string
}

export interface MarketplaceProfiles {
  platforms: MarketplacePlatformProfile[]
  accounts: MarketplaceAccountProfile[]
}

export type LoginAutomationMode = 'SESSION_ONLY' | 'AUTO_FILL'

export interface MarketplaceCredentialStatus {
  accountId: string
  username: string
  passwordSaved: boolean
  mode: string
  updatedAt?: string
}

export interface MarketplaceCredentialSaveInput {
  accountId: string
  platformCode: string
  username: string
  encryptedPassword: string
  mode: string
}

export interface SelectionTaskDraft {
  selectionMode: SelectionMode
  marketplacePlatform: MarketplacePlatformCode
  marketplaceAccountId: string
  networkStrategy: NetworkStrategy
  selectionRulePreset: SelectionRulePreset
  minimumSelectionScore: number
  selectionDimensions: string[]
  requiredSupplierBadges: string[]
  maxCategoryTopRank: number
  minimumReturnRate: number
  minimumNetworkSales: number
  minimumServiceRating: number
  collectionMethod: CollectionMethod
  sourceUrl: string
  maxPages: number
  supplyPlatforms: SupplyPlatformCode[]
  sourcePlatform?: string
  targetPlatform?: string
  maxMoq: number
  minSupplierYears: number
  onlyVerifiedSupplier: boolean
  gigaSellerIndexFilter: GigaSellerIndexFilter
  gigaReturnRateFilter: GigaReturnRateFilter
  name: string
  ozonUrl: string
  keyword: string
  targetQuantity: number
  minPrice: number
  maxPrice: number
  minRating: number
  minReviews: number
  maxProducts: number
  collectionProtectionEnabled: boolean
  collectionProtectionMode: CollectionProtectionMode
  collectionBatchSize: number
  collectionRestMinSeconds: number
  collectionRestMaxSeconds: number
  collectionMaxRunMinutes: number
  collectionAutoPause: boolean
  exchangeRate: number
  targetMargin: number
}

export interface SelectionTask extends SelectionTaskDraft {
  id: string
  stage: TaskStage
  createdAt: string
}

export interface CollectedOzonProduct {
  productId: string
  url: string
  title: string
  priceText: string
  originalPriceText: string
  imageUrl: string
  brand: string
  attributeCount: number | null
  candidateDeletedAt?: string
}

export interface SupplyCategoryLevel {
  id: string
  name: string
}

export interface SupplySourceCategory {
  platformCode: 'GIGACLOUD'
  catalogVersion: string
  level1?: SupplyCategoryLevel
  level2?: SupplyCategoryLevel
  level3?: SupplyCategoryLevel
  pathIds: string[]
  pathNames: string[]
  capturedFrom: 'PRODUCT_URL' | 'BREADCRUMB' | 'PAGE_CONTEXT'
  status: 'EXACT' | 'PARTIAL' | 'NEEDS_REVIEW'
  capturedAt: string
}

export interface CollectedSupplyProduct {
  platformCode: SupplyPlatformCode
  productId: string
  url: string
  title: string
  imageUrl: string
  priceText: string
  salesText: string
  shippingFeeText?: string
  sellableInventory?: number | null
  gigaIndex?: number | null
  promotionText?: string
  supplierName: string
  supplierBadges: string[]
  categoryTopRank: number | null
  returnRate: number | null
  networkSalesCount: number | null
  serviceRating: number | null
  serviceDetails: Record<string, number>
  dataCompleteness: number
  score: number
  grade: 'A' | 'B' | 'C' | 'REJECTED'
  dimensionScores: Record<string, number>
  recommendation: string
  riskFlags: string[]
  selected: boolean
  sourceCategory?: SupplySourceCategory
  candidateDeletedAt?: string
}

export type CollectorDuplicateStage = 'CANDIDATE' | 'SELECTION' | 'WAREHOUSE' | 'HISTORY'

export interface CollectorDuplicateProduct {
  platformCode: string
  productId: string
  title: string
  stage: CollectorDuplicateStage
  message: string
}

export interface CollectorPluginImportResult {
  imported: number
  updated: number
  total: number
  blocked: number
  duplicates: CollectorDuplicateProduct[]
}

export interface CandidateCollectionRun {
  id: string
  taskId: string
  candidateArea: CandidateArea
  platformCode: string
  collectionMethod: CollectionMethod
  sourceEntry: string
  requestedCount: number
  collectedCount: number
  newCount: number
  updatedCount: number
  selectedCount: number
  status: string
  startedAt: string
  completedAt: string
}

export interface CandidateCollectionRecord {
  candidateArea: CandidateArea
  candidateKey: string
  collectionRunId: string
  platformCode: string
  collectionMethod: CollectionMethod
  sourceEntry: string
  sourceRank: number
  collectedAt: string
}

export interface CandidateWorkspace {
  products: CollectedOzonProduct[]
  supplyProducts: CollectedSupplyProduct[]
  runs: CandidateCollectionRun[]
  records: CandidateCollectionRecord[]
}

export interface CandidateUpdateRequest {
  candidateArea: CandidateArea
  candidateKeys: string[]
}

/** getLatestWorkspace 返回形状：最新任务及其候选（与客户端 CollectionPreviewResult 同构） */
export interface PersistedWorkspace {
  task: SelectionTask
  products: CollectedOzonProduct[]
  supplyProducts: CollectedSupplyProduct[]
}

export type SelectionDecision = 'PENDING' | 'APPROVED' | 'REJECTED'

export interface SelectionCatalogItem {
  id: string
  taskId: string
  sourceArea: CandidateArea
  sourceUrl: string
  productId: string
  platformCode: string
  title: string
  imageUrl: string
  priceText: string
  score: number
  category: string
  subcategory: string
  tertiaryCategory: string
  decision: SelectionDecision
  reason: string
  recommendation: string
  riskFlags: string[]
  comparisonId?: string
  supplierUrl?: string
  landedCostCny?: number
  estimatedProfitCny?: number
  estimatedMargin?: number
  updatedAt: string
}

export type SupplyWarehouseCode = '1688' | 'GIGACLOUD'

export interface SupplyWarehouseProduct {
  id: string
  warehouseCode: SupplyWarehouseCode
  selectionId: string
  sourceUrl: string
  productId: string
  title: string
  imageUrl: string
  priceText: string
  supplierName: string
  category: string
  subcategory: string
  tertiaryCategory: string
  status: 'ACTIVE' | 'ARCHIVED'
  updatedAt: string
}

export interface MarketplaceSelectionProduct {
  id: string
  marketplaceCode: MarketplacePlatformCode
  supplyProductId: string
  warehouseCode: SupplyWarehouseCode
  sourceUrl: string
  productId: string
  title: string
  imageUrl: string
  priceText: string
  category: string
  status: 'SELECTED' | 'READY' | 'REJECTED'
  mediaStatus: 'PENDING' | 'PROCESSING' | 'READY'
  updatedAt: string
}

export type MarketplaceMediaAssetType = 'ORIGINAL' | 'AI_GENERATED' | 'REALSHIFT'

export interface MarketplaceMediaAsset {
  id: string
  marketplaceSelectionId: string
  marketplaceCode: MarketplacePlatformCode
  assetType: MarketplaceMediaAssetType
  imageUrl: string
  localPath: string
  selected: boolean
  createdAt: string
}

export type MarketplacePublishStatus = 'DRAFT' | 'VALIDATED' | 'SELLER_DRAFT' | 'REVIEW' | 'PUBLISHED' | 'FAILED'

export interface MarketplacePublishDraft {
  id: string
  marketplaceCode: MarketplacePlatformCode
  marketplaceSelectionId: string
  platformSku: string
  title: string
  imageUrl: string
  priceText: string
  storeId: string
  status: MarketplacePublishStatus
  checks: string[]
  error?: string
  platformProductId?: string
  updatedAt: string
}

export interface MarketplacePublishDraftUpdate {
  id: string
  storeId?: string
  status?: MarketplacePublishStatus
  checks?: string[]
  error?: string
}

export interface MarketplacePublishAudit {
  id: string
  marketplaceCode: MarketplacePlatformCode
  draftId?: string
  action: string
  detail: string
  createdAt: string
}

export interface SelectionImportRequest {
  sourceArea: CandidateArea
  product: CollectedOzonProduct | CollectedSupplyProduct
  category: string
  subcategory: string
  tertiaryCategory?: string
  comparison?: ComparisonRecordView
}

export type ComparisonDecision = 'PENDING' | 'REVIEW' | 'RECOMMENDED' | 'REJECTED' | 'FAILED'

export interface ComparisonSupplierMatch {
  url: string
  productId: string
  title: string
  imageUrl: string
  supplierName: string
  price: number
  priceText: string
  moq: number
  matchScore: number
  supplyScore: number
  recommendation: string
  riskFlags: string[]
  binding: 'NONE' | 'PRIMARY' | 'BACKUP'
}

export interface ComparisonCostSettings {
  exchangeRate: number
  commissionRate: number
  domesticShipping: number
  packagingCost: number
  internationalLogistics: number
  fulfillmentCost: number
  advertisingRate: number
  returnLossRate: number
  taxRate: number
  otherCost: number
}

export interface ComparisonRecordView {
  id: string
  taskId: string
  marketProduct: CollectedOzonProduct
  suppliers: ComparisonSupplierMatch[]
  decision: ComparisonDecision
  sellingPriceRub: number
  sellingPriceCny: number
  purchasePriceCny: number
  landedCostCny: number
  estimatedProfitCny: number
  estimatedMargin: number
  settings: ComparisonCostSettings
  selectionDecision?: SelectionDecision
  warehouseProductId?: string
  updatedAt: string
}

export interface ComparisonImportRequest {
  product: CollectedOzonProduct
}

export interface ComparisonUpdateRequest {
  id: string
  decision?: ComparisonDecision
  supplierUrl?: string
  binding?: 'NONE' | 'PRIMARY' | 'BACKUP'
  purchasePriceCny?: number
  settings?: ComparisonCostSettings
}

export interface ComparisonPromotionRequest {
  id: string
  category: string
  subcategory: string
  tertiaryCategory: string
}

export interface ComparisonPromotionResult {
  comparison: ComparisonRecordView
  selection: SelectionCatalogItem
  warehouseProduct: SupplyWarehouseProduct
}

export interface WorkflowCounts {
  collected: number
  compared: number
  selected: number
  stocked: number
  listed: number
  purchasing: number
  reconciled: number
}
