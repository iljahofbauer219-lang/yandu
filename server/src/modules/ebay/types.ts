// eBay 域数据层类型：与客户端 src/shared/contracts.ts 保持一致（字段名不变，payload 原样往返）
// 仅包含服务端数据层需要的类型；浏览器动作 / AI 生成请求类型不在此列

import type { ComplianceCheckResult, ComplianceGateStatus, ComplianceReleasePermit } from '../compliance/types.js'

export interface EbayStore {
  id: string
  name: string
  sellerId: string
  publicStoreUrl: string
  publicStoreVerifiedAt?: string
  loginUsername: string
  passwordSaved: boolean
  marketplaceId: string
  status: 'PENDING' | 'CONNECTED' | 'ERROR'
  lastSyncAt?: string
  syncError?: string
  listingCount: number
}

export type EbayTitleSource = 'EBAY_STORE_LINK' | 'EBAY_STRUCTURED_DATA' | 'EBAY_API' | 'EBAY_REPORT' | 'UNVERIFIED_PAGE_TEXT'

export interface EbayItemSpecific { name: string; value: string }

export interface EbayListing {
  id: string
  storeId: string
  marketplaceId: string
  listingId: string
  sku: string
  title: string
  originalTitle?: string
  translatedTitle?: string
  originalTitleVerified?: boolean
  titleSource?: EbayTitleSource
  price: string
  currency: string
  quantity: number
  imageUrl: string
  imageUrls?: string[]
  categoryId: string
  categoryName: string
  status: 'ACTIVE' | 'ENDED'
  viewUrl: string
  updatedAt: string
  itemSpecifics?: EbayItemSpecific[]
  condition?: string
}

export interface EbayProductDetails {
  url: string
  itemSpecifics: EbayItemSpecific[]
  condition: string
  imageUrls: string[]
  title?: string
  subtitle?: string
  descriptionHtml?: string
  descriptionText?: string
  price?: string
  currency?: string
  shippingPolicy?: string
  returnPolicy?: string
  paymentPolicy?: string
  sellerNotes?: string
  listingFormat?: 'FIXED_PRICE' | 'AUCTION'
  bestOfferEnabled?: boolean
}

export interface EbayLocalProductMedia {
  id: string
  mediaType: 'IMAGE'
  sortOrder: number
  remoteUrl: string
  localPath: string
  mimeType: string
  width: number
  height: number
  fileSize: number
  sha256: string
  downloadStatus: 'DOWNLOADED' | 'FAILED'
}

export interface EbayLocalProductSnapshot {
  id: string
  localProductId: string
  version: number
  sourceListing: EbayListing
  details: EbayProductDetails
  media: EbayLocalProductMedia[]
  completeness: number
  missingFields: string[]
  contentHash: string
  capturedAt: string
}

export interface EbayLocalProduct {
  id: string
  storeId: string
  marketplaceId: string
  listingId: string
  categoryId: string
  categoryName: string
  title: string
  status: 'READY' | 'INCOMPLETE'
  versionCount: number
  latestSnapshotId: string
  downloadedAt: string
  updatedAt: string
  snapshot: EbayLocalProductSnapshot
}

export interface EbayLocalProductSnapshotInput {
  listing: EbayListing
  details: EbayProductDetails
  media: EbayLocalProductMedia[]
  completeness: number
  missingFields: string[]
  contentHash: string
  capturedAt: string
}

// ---------------------------------------------------------------- 市场研究

export interface EbayMarketResearchSample {
  title: string
  price: string
  currency: string
  soldDate: string
  url: string
  imageUrl: string
  itemId?: string
  shipping?: string
  condition?: string
  listingFormat?: string
  soldQuantity?: string
}

export interface EbayMarketKeywordStat {
  term: string
  count: number
  coverage: number
  factStatus: 'CONFIRMED' | 'REVIEW' | 'EXCLUDED'
  factSource: string
}

export interface EbayMarketResearchMetric {
  key: 'TOTAL_SOLD' | 'AVERAGE_SOLD_PRICE' | 'SOLD_PRICE_RANGE' | 'AVERAGE_SHIPPING' | 'FREE_SHIPPING_RATE' | 'SELL_THROUGH_RATE' | 'SELLER_COUNT'
  label: string
  value: string
  available: boolean
}

export interface EbayMarketResearchFilter { label: string; value: string }

export interface EbayMarketResearchFinding {
  key: 'DATA_QUALITY' | 'PRICE' | 'DEMAND' | 'COMPETITION' | 'SHIPPING' | 'TITLE'
  title: string
  conclusion: string
  evidence: string
  level: 'INFO' | 'POSITIVE' | 'ATTENTION'
}

export interface EbayMarketResearchSnapshot {
  id: string
  storeId: string
  listingId: string
  marketplaceId: string
  categoryId: string
  categoryName: string
  condition: string
  query: string
  periodDays: number
  source: 'EBAY_PRODUCT_RESEARCH' | 'EBAY_SOLD_SEARCH'
  sourceUrl: string
  fetchedAt: string
  captureMode?: 'MANUAL_RESEARCH_PAGE' | 'AUTOMATIC'
  rawSampleCount?: number
  sampleCount: number
  analysisSampleCount?: number
  rankingBasis?: 'SOLD_QUANTITY' | 'EBAY_RESULT_ORDER'
  soldQuantityEvidenceCount?: number
  metrics: EbayMarketResearchMetric[]
  samples: EbayMarketResearchSample[]
  filters?: EbayMarketResearchFilter[]
  findings?: EbayMarketResearchFinding[]
  keywords: EbayMarketKeywordStat[]
  combinations: EbayMarketKeywordStat[]
}

export interface EbayMarketResearchDecisionRequest {
  storeId: string
  listingId: string
  kind: 'KEYWORD' | 'COMBINATION'
  term: string
  status: 'CONFIRMED' | 'REVIEW' | 'EXCLUDED'
}

export interface EbayMarketDecisionSignal {
  key: 'DATA_QUALITY' | 'RANKING' | 'DEMAND' | 'COMPETITION' | 'PRICE' | 'SHIPPING' | 'TERMS'
  label: string
  status: 'POSITIVE' | 'NEUTRAL' | 'ATTENTION'
  conclusion: string
  evidence: string
}

export interface EbayMarketDecisionReport {
  generatedAt: string
  currentSnapshotId: string
  previousSnapshotId?: string
  comparableSnapshotCount: number
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  titleReadiness: 'READY' | 'REVIEW' | 'BLOCKED'
  summary: string
  analysisSampleCount: number
  rankingBasis: 'SOLD_QUANTITY' | 'EBAY_RESULT_ORDER'
  soldQuantityEvidenceCount: number
  confirmedTerms: EbayMarketKeywordStat[]
  missingMetrics: string[]
  signals: EbayMarketDecisionSignal[]
}

// ---------------------------------------------------------------- 店铺目录

export interface EbayStoreCategory {
  storeId: string
  categoryId: string
  name: string
  parentCategoryId: string
  level: number
  childCount: number
  listingCount: number
  sortOrder: number
  status: 'ACTIVE' | 'REMOVED'
  syncedAt: string
}

export type EbayCategoryChangeType = 'ADDED' | 'RENAMED' | 'MOVED' | 'REMOVED' | 'REORDERED'

export interface EbayCategoryChange {
  type: EbayCategoryChangeType
  categoryId: string
  beforeName: string
  afterName: string
}

export interface EbayCategorySyncSummary {
  storeId: string
  total: number
  added: number
  renamed: number
  moved: number
  removed: number
  reordered: number
  syncedAt: string
  changes: EbayCategoryChange[]
}

export interface EbayCategoryWorkspace {
  categories: EbayStoreCategory[]
  lastSync?: EbayCategorySyncSummary
}

export interface EbayReportImportResult {
  storeId: string
  fileName: string
  imported: number
  updated: number
  failed: number
  total: number
  errors: string[]
  importedAt: string
}

// ---------------------------------------------------------------- 内容优化 / 标题

export interface EbayContentSection {
  id: 'SUMMARY' | 'PROBLEMS' | 'FEATURES' | 'SCENARIOS' | 'SPECIFICATIONS' | 'PACKAGE' | 'INSTALLATION' | 'CARE'
  title: string
  content: string
}

export type EbayContentFactKind = 'FEATURE' | 'SPECIFICATION' | 'PACKAGE' | 'INSTALLATION' | 'CARE'

export interface EbayContentSourceFact {
  id: string
  kind: EbayContentFactKind
  text: string
  source: 'SOURCE_DESCRIPTION' | 'ITEM_SPECIFIC' | 'SELLER_NOTE'
  sourceLabel: string
}

export interface EbayContentBenefit {
  painPoint: string
  solution: string
  customerBenefit: string
  evidenceFactIds: string[]
}

export interface EbayContentScenario {
  title: string
  description: string
  evidenceFactIds: string[]
}

export interface EbayContentValidation {
  sourceFactCount: number
  coveredFactCount: number
  factCoverage: number
  numericFactCount: number
  missingNumericFacts: string[]
  unsupportedClaimCount: number
  passed: boolean
  warnings: string[]
}

export interface EbayVideoStoryboardShot {
  order: number
  durationSeconds: number
  visual: string
  caption: string
  sourceRequirement: string
}

export type EbayContentTranslationStatus = 'SYNCED' | 'STALE' | 'FAILED'

export interface EbayContentTranslationSegment {
  id: string
  english: string
  chinese: string
  sourceHash: string
  status: EbayContentTranslationStatus
}

export interface EbayContentTranslationResult {
  model: 'qwen-mt-flash'
  translatedAt: string
  segments: EbayContentTranslationSegment[]
  error?: string
}

export interface EbayContentOptimizationResult {
  sections: EbayContentSection[]
  sourceFacts: EbayContentSourceFact[]
  benefits: EbayContentBenefit[]
  scenarios: EbayContentScenario[]
  validation: EbayContentValidation
  englishDescription: string
  chineseReference: string
  translation: EbayContentTranslationResult
  storyboard: EbayVideoStoryboardShot[]
  model: string
}

export interface EbayContentOptimizationRecord {
  id: string
  storeId: string
  listingId: string
  selectedTitle: string
  result: EbayContentOptimizationResult
  createdAt: string
  updatedAt: string
}

export type EbayContentOptimizationRecordInput = Omit<EbayContentOptimizationRecord, 'id' | 'createdAt' | 'updatedAt'>

export interface EbayTitleVariant {
  id: 'SEARCH' | 'PARAMETER' | 'BENEFIT' | 'SCENARIO' | 'INTENT' | 'BALANCED' | 'READABLE'
  name: string
  title: string
  keywords: string[]
  rationale: string
}

export interface EbayTitleAudit {
  characterCount: number
  withinLimit: boolean
  duplicateTerms: string[]
  danglingConnector: boolean
  confirmedTermHits: string[]
  unverifiedTerms: string[]
  coverageScore: number
  passed: boolean
}

export interface EbayTitleDecision {
  id: string
  storeId: string
  listingId: string
  researchSnapshotId: string
  originalTitle: string
  selectedTitle: string
  selectedVariantId: EbayTitleVariant['id']
  variants: EbayTitleVariant[]
  verifiedFacts?: string[]
  audit: EbayTitleAudit
  status: 'CONFIRMED'
  confirmedAt: string
}

export type EbayTitleDecisionInput = Omit<EbayTitleDecision, 'id' | 'audit' | 'status' | 'confirmedAt'>

export interface EbayTitleHandoffAuditEvent {
  id: string
  action: 'VALIDATION_PASSED' | 'SELLER_HUB_OPENED' | 'TITLE_FILLED' | 'BLOCKED' | 'FAILED'
  status: 'SUCCESS' | 'WARNING' | 'FAILED'
  detail: string
  createdAt: string
}

export interface EbayTitleHandoff {
  id: string
  storeId: string
  listingId: string
  titleDecisionId: string
  researchSnapshotId: string
  originalTitle: string
  preparedTitle: string
  status: 'PREPARING' | 'WAITING_CONFIRMATION' | 'BLOCKED' | 'FAILED'
  reviseUrl: string
  filledFields: string[]
  warnings: string[]
  submitButtonDetected: boolean
  message: string
  auditTrail: EbayTitleHandoffAuditEvent[]
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------- 优化草稿 / 发布 / 验收

export interface EbayOptimizationSpecific {
  name: string
  value: string
  priority: 'REQUIRED' | 'RECOMMENDED'
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  needsConfirmation: boolean
  source: string
}

export interface EbayOptimizationDraft {
  id: string
  storeId: string
  listingId: string
  listing: EbayListing
  selectedTitle: string
  titleVariants: EbayTitleVariant[]
  itemSpecifics: EbayOptimizationSpecific[]
  description: string
  imageUrl: string
  imageUrls?: string[]
  storyboard?: EbayVideoStoryboardShot[]
  marketDecision?: EbayMarketDecisionReport
  scoreBefore: number
  scoreAfter: number
  complianceCheckId?: string
  complianceGateStatus?: ComplianceGateStatus
  complianceRuleSetVersion?: string
  complianceCheckedAt?: string
  complianceReviewedAt?: string
  complianceInputFingerprint?: string
  status: 'PREMIUM'
  createdAt: string
  updatedAt: string
}

export type EbayOptimizationDraftInput = Omit<EbayOptimizationDraft, 'id' | 'status' | 'createdAt' | 'updatedAt'>

export interface EbayPublishComplianceValidation {
  draft: EbayOptimizationDraft
  check: ComplianceCheckResult
  permit?: ComplianceReleasePermit
  publishAllowed: boolean
  reason: string
}

export interface EbayCategorySpecificRequirement {
  name: string
  required: boolean
  value: string
  options: string[]
  source: 'SELLER_HUB'
}

export interface EbayImageInspection {
  url: string
  reachable: boolean
  format: string
  width: number
  height: number
  longestEdge: number
  status: 'PASSED' | 'REVIEW' | 'BLOCKED'
  findings: string[]
}

export interface EbayImageInspectionReport {
  checkedAt: string
  images: EbayImageInspection[]
  passed: number
  review: number
  blocked: number
}

export interface EbayPublishComparisonItem {
  field: '标题' | '英文详情' | '商品属性' | '主图'
  before: string
  after: string
  status: 'CHANGED' | 'UNCHANGED' | 'REVIEW'
}

export interface EbayPublishVideoArtifact {
  status: 'READY' | 'FAILED'
  fileName: string
  filePath: string
  previewUrl: string
  durationSeconds: number
  width: number
  height: number
  imageCount: number
  sizeBytes: number
  generatedAt: string
  message: string
}

export interface EbayVideoUploadPreparation {
  status: 'FILE_SELECTED' | 'MANUAL_SELECTION_REQUIRED' | 'FAILED'
  reviseUrl: string
  fileInputDetected: boolean
  preparedAt: string
  message: string
}

export interface EbayPublishAuditEvent {
  id: string
  action: 'VALIDATION_STARTED' | 'VALIDATION_PASSED' | 'VALIDATION_BLOCKED' | 'SELLER_HUB_FILLED' | 'VIDEO_GENERATED' | 'VIDEO_UPLOAD_PREPARED' | 'FAILED'
  status: 'SUCCESS' | 'WARNING' | 'FAILED'
  detail: string
  createdAt: string
}

export type EbayPublishTaskStatus = 'DRAFT' | 'VALIDATING' | 'READY_TO_FILL' | 'FILLING' | 'WAITING_CONFIRMATION' | 'BLOCKED' | 'FAILED'

export interface EbayPublishTask {
  id: string
  storeId: string
  draftId: string
  listingId: string
  status: EbayPublishTaskStatus
  reviseUrl: string
  categorySpecifics: EbayCategorySpecificRequirement[]
  imageInspection: EbayImageInspectionReport
  filledFields: string[]
  warnings: string[]
  comparison?: EbayPublishComparisonItem[]
  video?: EbayPublishVideoArtifact
  videoUpload?: EbayVideoUploadPreparation
  auditTrail?: EbayPublishAuditEvent[]
  message: string
  createdAt: string
  updatedAt: string
}

export interface EbayAcceptanceCheck {
  code: 'SOURCE_DATA' | 'OPTIMIZATION_DRAFT' | 'COMPLIANCE_GATE' | 'PUBLISH_PREPARATION' | 'SELLER_HUB_SESSION' | 'TITLE_MATCH' | 'DESCRIPTION_MATCH' | 'REQUIRED_SPECIFICS' | 'VIDEO_READY' | 'FINAL_SUBMIT_GUARD'
  label: string
  status: 'PASSED' | 'WARNING' | 'BLOCKED'
  detail: string
}

export interface EbayAcceptanceItemResult {
  listingId: string
  title: string
  draftId?: string
  status: 'PASSED' | 'ATTENTION' | 'BLOCKED'
  checks: EbayAcceptanceCheck[]
  inspectedAt: string
}

export interface EbayAcceptanceScenarioResult {
  scenario: 'LOGIN_EXPIRED' | 'CAPTCHA' | 'FIELD_CHANGED' | 'FAILURE_RECOVERY'
  status: 'PASSED' | 'FAILED'
  detail: string
}

export interface EbayAcceptanceBatch {
  id: string
  storeId: string
  mode: 'SINGLE' | 'BATCH_10'
  status: 'PASSED' | 'ATTENTION' | 'BLOCKED'
  requested: number
  checked: number
  passed: number
  attention: number
  blocked: number
  items: EbayAcceptanceItemResult[]
  scenarios: EbayAcceptanceScenarioResult[]
  reportPath: string
  createdAt: string
}

// ---------------------------------------------------------------- 视觉检查

export type EbayImageVisualRuleCode = 'PRODUCT_ACCURACY' | 'NO_BORDER' | 'NO_ADDED_TEXT' | 'NO_WATERMARK'
export type EbayImageVisualResultStatus = 'PASSED' | 'FAILED' | 'REVIEW'

export interface EbayImageVisualManualReview {
  decision: 'PASSED' | 'FAILED'
  reviewedAt: string
  reviewedBy: string
  note: string
}

export interface EbayImageVisualRuleResult {
  rule: EbayImageVisualRuleCode
  label: string
  status: EbayImageVisualResultStatus
  modelStatus?: EbayImageVisualResultStatus
  confidence: number
  evidence: string
  manualReview?: EbayImageVisualManualReview
}

export interface EbayImageVisualImageResult {
  mediaId: string
  sortOrder: number
  status: EbayImageVisualResultStatus
  summary: string
  rules: EbayImageVisualRuleResult[]
}

export interface EbayImageVisualInspectionReport {
  checkedAt: string
  model: string
  ruleSetVersion: string
  status: EbayImageVisualResultStatus
  checkedImageCount: number
  passed: number
  failed: number
  review: number
  message: string
  images: EbayImageVisualImageResult[]
}

export interface EbayImageVisualReviewInput {
  localProductId: string
  mediaId: string
  rule: EbayImageVisualRuleCode
  decision: 'PASSED' | 'FAILED'
  reviewedBy: string
  note: string
}

// ---------------------------------------------------------------- 采集 / 目录同步

export interface EbayCollectedProduct {
  url: string
  listingId: string
  title: string
  originalTitle?: string
  translatedTitle?: string
  originalTitleVerified?: boolean
  titleSource?: EbayTitleSource
  imageUrl: string
  price: string
  currency: string
  categoryId: string
  categoryName: string
}

export interface EbayCollectionImportResult {
  imported: number
  duplicates: number
  total: number
}

export type EbayDirectorySyncStatus = 'RUNNING' | 'PAUSED' | 'NEEDS_ATTENTION' | 'COMPLETED' | 'CANCELLED' | 'INTERRUPTED'

export interface EbayDirectoryProductScanCategory {
  categoryId: string
  categoryName: string
  expected: number
  found: number
  complete: boolean
  listingIds: string[]
  error: string
}

export interface EbayDirectoryProductSyncCheckpoint {
  taskId: string
  storeId: string
  status: EbayDirectorySyncStatus
  categoryIds: string[]
  completedCategoryIds: string[]
  failedCategoryIds: string[]
  publicStoreUrl: string
  startedAt: string
  updatedAt: string
}

/** 检查点完整数据（含已采产品与扫描明细），仅供同步流程内部读写 */
export interface EbayProductSyncCheckpointData extends EbayDirectoryProductSyncCheckpoint {
  products: EbayCollectedProduct[]
  scans: EbayDirectoryProductScanCategory[]
}

export interface EbayProductSyncChange {
  listingId: string
  title: string
  type: 'IMPORTED' | 'UPDATED' | 'MOVED' | 'REACTIVATED' | 'SUSPECTED_ENDED' | 'ENDED'
  beforeCategory: string
  afterCategory: string
}

export interface EbayProductSyncRun {
  id: string
  storeId: string
  mode: 'INCREMENTAL'
  categoryCount: number
  scannedCategoryCount: number
  imported: number
  updated: number
  unchanged: number
  ended: number
  suspectedEnded: number
  moved: number
  reactivated: number
  protectedOptimizations: number
  failed: number
  total: number
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED'
  errors: string[]
  changes: EbayProductSyncChange[]
  syncedAt: string
}

export interface EbayDirectoryProductSyncResult {
  runId: string
  storeId: string
  mode: 'INCREMENTAL'
  categoryCount: number
  scannedCategoryCount: number
  imported: number
  updated: number
  unchanged: number
  ended: number
  suspectedEnded: number
  moved: number
  reactivated: number
  protectedOptimizations: number
  failed: number
  total: number
  publicStoreUrl: string
  failedCategoryIds: string[]
  changes: EbayProductSyncChange[]
  syncedAt: string
  errors: string[]
}

export interface EbayListingsReportImportResult {
  imported: number
  updated: number
  total: number
  importedAt: string
}
