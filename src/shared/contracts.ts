export type Platform = 'ozon' | '1688' | 'web'
export type SelectionMode = 'FORWARD_SUPPLY' | 'REVERSE_MARKET'
export type SupplyPlatformCode = '1688' | 'TAOBAO' | 'TMALL' | 'JD' | 'PINDUODUO' | 'DOUYIN' | 'XIAOHONGSHU' | 'KUAISHOU' | 'GIGACLOUD' | 'YIWUGO' | 'CUSTOM'
export type CollectionMethod = 'KEYWORD' | 'PRODUCT_URL' | 'CATEGORY_URL'
export type MarketplacePlatformCode = 'OZON' | 'AMAZON' | 'EBAY' | 'ALIEXPRESS' | 'TEMU'
export type NetworkStrategy = 'LOCAL_DIRECT' | 'SYSTEM' | 'PROXY_PROFILE'
export type SelectionRulePreset = 'BALANCED' | 'QUALITY_FIRST' | 'SALES_FIRST' | 'SUPPLY_FIRST' | 'LOW_RISK'
export type CollectionProtectionMode = 'CAUTIOUS' | 'STANDARD' | 'FAST'
export type GigaSellerIndexFilter = 'ANY' | 'NEW' | 'GE90' | 'GE80' | 'GE70' | 'GE60' | 'LT60'
export type GigaReturnRateFilter = 'ANY' | 'LOW' | 'MEDIUM' | 'HIGH'

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

export type LoginAutomationMode = 'SESSION_ONLY' | 'AUTO_FILL'

export interface MarketplaceCredentialStatus {
  accountId: string
  username: string
  passwordSaved: boolean
  mode: LoginAutomationMode
  updatedAt?: string
}

export interface MarketplaceCredentialInput {
  accountId: string
  platformCode: string
  username: string
  password?: string
  mode: LoginAutomationMode
}

export interface EbayConfigurationStatus {
  environment:'PRODUCTION'
  configured:boolean
  marketDataConfigured:boolean
  clientIdConfigured:boolean
  clientSecretConfigured:boolean
  ruNameConfigured:boolean
  readOnly:true
}

export interface EbayStore {
  id:string
  name:string
  sellerId:string
  publicStoreUrl:string
  publicStoreVerifiedAt?:string
  loginUsername:string
  passwordSaved:boolean
  marketplaceId:string
  status:'PENDING'|'CONNECTED'|'ERROR'
  lastSyncAt?:string
  syncError?:string
  listingCount:number
}

export type EbayTitleSource = 'EBAY_STORE_LINK'|'EBAY_STRUCTURED_DATA'|'EBAY_API'|'EBAY_REPORT'|'UNVERIFIED_PAGE_TEXT'

export interface EbayListing {
  id:string
  storeId:string
  marketplaceId:string
  listingId:string
  sku:string
  title:string
  originalTitle?:string
  translatedTitle?:string
  originalTitleVerified?:boolean
  titleSource?:EbayTitleSource
  price:string
  currency:string
  quantity:number
  imageUrl:string
  imageUrls?:string[]
  categoryId:string
  categoryName:string
  status:'ACTIVE'|'ENDED'
  viewUrl:string
  updatedAt:string
  itemSpecifics?:EbayItemSpecific[]
  condition?:string
}

export interface EbayItemSpecific { name:string; value:string }

export interface EbayProductDetails {
  url:string
  itemSpecifics:EbayItemSpecific[]
  condition:string
  imageUrls:string[]
  title?:string
  subtitle?:string
  descriptionHtml?:string
  descriptionText?:string
  price?:string
  currency?:string
  shippingPolicy?:string
  returnPolicy?:string
  paymentPolicy?:string
  sellerNotes?:string
  listingFormat?:'FIXED_PRICE'|'AUCTION'
  bestOfferEnabled?:boolean
}

export interface EbayLocalProductMedia {
  id:string
  mediaType:'IMAGE'
  sortOrder:number
  remoteUrl:string
  localPath:string
  mimeType:string
  width:number
  height:number
  fileSize:number
  sha256:string
  downloadStatus:'DOWNLOADED'|'FAILED'
}

export interface EbayLocalProductSnapshot {
  id:string
  localProductId:string
  version:number
  sourceListing:EbayListing
  details:EbayProductDetails
  media:EbayLocalProductMedia[]
  completeness:number
  missingFields:string[]
  contentHash:string
  capturedAt:string
}

export interface EbayLocalProduct {
  id:string
  storeId:string
  marketplaceId:string
  listingId:string
  categoryId:string
  categoryName:string
  title:string
  status:'READY'|'INCOMPLETE'
  versionCount:number
  latestSnapshotId:string
  downloadedAt:string
  updatedAt:string
  snapshot:EbayLocalProductSnapshot
}

export interface EbayLocalProductSnapshotInput {
  listing:EbayListing
  details:EbayProductDetails
  media:EbayLocalProductMedia[]
  completeness:number
  missingFields:string[]
  contentHash:string
  capturedAt:string
}

export interface EbayLocalProductUpdateInput {
  title:string
  descriptionText:string
  descriptionHtml:string
  price:string
  currency:string
  media:EbayLocalProductMedia[]
}

export interface EbayLocalProductMediaUploadInput {
  fileName:string
  mimeType:string
  base64:string
}

export interface EbayLocalListingRequirements {
  sourceUrl:string
  categorySpecifics:EbayCategorySpecificRequirement[]
  inspectedAt:string
  warnings:string[]
}

export interface EbayLocalRevisionPreparationResult {
  reviseUrl:string
  filledFields:string[]
  skippedFields:string[]
  warnings:string[]
  submitButtonDetected:boolean
  preparedAt:string
}

export interface EbayMarketResearchSample {
  title:string
  price:string
  currency:string
  soldDate:string
  url:string
  imageUrl:string
  itemId?:string
  shipping?:string
  condition?:string
  listingFormat?:string
  soldQuantity?:string
}

export interface EbayMarketKeywordStat {
  term:string
  count:number
  coverage:number
  factStatus:'CONFIRMED'|'REVIEW'|'EXCLUDED'
  factSource:string
}

export interface EbayMarketResearchMetric {
  key:'TOTAL_SOLD'|'AVERAGE_SOLD_PRICE'|'SOLD_PRICE_RANGE'|'AVERAGE_SHIPPING'|'FREE_SHIPPING_RATE'|'SELL_THROUGH_RATE'|'SELLER_COUNT'
  label:string
  value:string
  available:boolean
}

export interface EbayMarketResearchFilter {
  label:string
  value:string
}

export interface EbayMarketResearchFinding {
  key:'DATA_QUALITY'|'PRICE'|'DEMAND'|'COMPETITION'|'SHIPPING'|'TITLE'
  title:string
  conclusion:string
  evidence:string
  level:'INFO'|'POSITIVE'|'ATTENTION'
}

export interface EbayMarketResearchSnapshot {
  id:string
  storeId:string
  listingId:string
  marketplaceId:string
  categoryId:string
  categoryName:string
  condition:string
  query:string
  periodDays:number
  source:'EBAY_PRODUCT_RESEARCH'|'EBAY_SOLD_SEARCH'|'OMKAR_EBAY_SCRAPER'
  sourceUrl:string
  fetchedAt:string
  captureMode?:'MANUAL_RESEARCH_PAGE'|'AUTOMATIC'
  rawSampleCount?:number
  sampleCount:number
  analysisSampleCount?:number
  rankingBasis?:'SOLD_QUANTITY'|'EBAY_RESULT_ORDER'
  soldQuantityEvidenceCount?:number
  metrics:EbayMarketResearchMetric[]
  samples:EbayMarketResearchSample[]
  filters?:EbayMarketResearchFilter[]
  findings?:EbayMarketResearchFinding[]
  keywords:EbayMarketKeywordStat[]
  combinations:EbayMarketKeywordStat[]
}

export interface EbayMarketResearchRequest {
  storeId:string
  listingId:string
  query:string
  periodDays:30|90|365
}

export interface EbayMarketResearchDecisionRequest {
  storeId:string
  listingId:string
  kind:'KEYWORD'|'COMBINATION'
  term:string
  status:'CONFIRMED'|'REVIEW'|'EXCLUDED'
}

export interface EbayMarketDecisionSignal {
  key:'DATA_QUALITY'|'RANKING'|'DEMAND'|'COMPETITION'|'PRICE'|'SHIPPING'|'TERMS'
  label:string
  status:'POSITIVE'|'NEUTRAL'|'ATTENTION'
  conclusion:string
  evidence:string
}

export interface EbayMarketDecisionReport {
  generatedAt:string
  currentSnapshotId:string
  previousSnapshotId?:string
  comparableSnapshotCount:number
  confidence:'HIGH'|'MEDIUM'|'LOW'
  titleReadiness:'READY'|'REVIEW'|'BLOCKED'
  summary:string
  analysisSampleCount:number
  rankingBasis:'SOLD_QUANTITY'|'EBAY_RESULT_ORDER'
  soldQuantityEvidenceCount:number
  confirmedTerms:EbayMarketKeywordStat[]
  missingMetrics:string[]
  signals:EbayMarketDecisionSignal[]
}

export interface EbaySyncResult { storeId:string; imported:number; total:number; syncedAt:string }

export interface EbayStoreCategory {
  storeId:string
  categoryId:string
  name:string
  parentCategoryId:string
  level:number
  childCount:number
  listingCount:number
  sortOrder:number
  status:'ACTIVE'|'REMOVED'
  syncedAt:string
}

export type EbayCategoryChangeType = 'ADDED'|'RENAMED'|'MOVED'|'REMOVED'|'REORDERED'

export interface EbayCategoryChange {
  type:EbayCategoryChangeType
  categoryId:string
  beforeName:string
  afterName:string
}

export interface EbayCategorySyncSummary {
  storeId:string
  total:number
  added:number
  renamed:number
  moved:number
  removed:number
  reordered:number
  syncedAt:string
  changes:EbayCategoryChange[]
}

export interface EbayCategoryWorkspace {
  categories:EbayStoreCategory[]
  lastSync?:EbayCategorySyncSummary
}

export interface EbayReportImportResult {
  storeId:string
  fileName:string
  imported:number
  updated:number
  failed:number
  total:number
  errors:string[]
  importedAt:string
}

export interface EbayTitleOptimizationRequest {
  listingId:string
  title:string
  categoryName:string
  marketplaceId:string
  sku:string
  itemSpecifics?:EbayItemSpecific[]
  condition?:string
  verifiedDescription?:string
  marketResearch?:EbayMarketResearchSnapshot
  marketResearchHistory?:EbayMarketResearchSnapshot[]
}

export interface EbayTitleOptimizationResult {
  originalTitle:string
  optimizedTitle:string
  keywords:string[]
  rationale:string
  model:string
  variants:EbayTitleVariant[]
  itemSpecifics:EbayOptimizationSpecific[]
  description:string
  marketDecision?:EbayMarketDecisionReport
}

export interface EbayContentOptimizationRequest {
  listingId:string
  originalTitle:string
  selectedTitle:string
  categoryName:string
  condition?:string
  itemSpecifics:EbayItemSpecific[]
  sourceDescription?:string
  sellerNotes?:string
}

export interface EbayContentSection {
  id:'SUMMARY'|'PROBLEMS'|'FEATURES'|'SCENARIOS'|'SPECIFICATIONS'|'PACKAGE'|'INSTALLATION'|'CARE'
  title:string
  content:string
}

export type EbayContentFactKind='FEATURE'|'SPECIFICATION'|'PACKAGE'|'INSTALLATION'|'CARE'

export interface EbayContentSourceFact {
  id:string
  kind:EbayContentFactKind
  text:string
  source:'SOURCE_DESCRIPTION'|'ITEM_SPECIFIC'|'SELLER_NOTE'
  sourceLabel:string
}

export interface EbayContentBenefit {
  painPoint:string
  solution:string
  customerBenefit:string
  evidenceFactIds:string[]
}

export interface EbayContentScenario {
  title:string
  description:string
  evidenceFactIds:string[]
}

export interface EbayContentValidation {
  sourceFactCount:number
  coveredFactCount:number
  factCoverage:number
  numericFactCount:number
  missingNumericFacts:string[]
  unsupportedClaimCount:number
  passed:boolean
  warnings:string[]
}

export interface EbayVideoStoryboardShot {
  order:number
  durationSeconds:number
  visual:string
  caption:string
  sourceRequirement:string
}

export type EbayVideoSubtitleMode='NONE'|'ENGLISH'|'CHINESE'|'BILINGUAL'
export type EbayVideoVoiceMode='NONE'|'ENGLISH'|'CHINESE'
export type EbayVideoVoiceStyle='NATURAL_FEMALE'|'NATURAL_MALE'|'PROFESSIONAL_FEMALE'|'PROFESSIONAL_MALE'
export type EbayVideoVoiceProvider='LOCAL_MACOS'|'DOUBAO_TTS_2_0'
export type EbayVideoCapabilityKind='VIDEO'|'TEXT'|'VOICE'
export type EbayVideoCapabilityStatus='CALLABLE'|'CONFIGURED'|'PENDING_VERIFICATION'|'VERIFYING'|'FAILED'|'UNCONFIGURED'

export interface EbayVideoStudioCapability {
  id:string
  label:string
  kind:EbayVideoCapabilityKind
  status:EbayVideoCapabilityStatus
  selectable:boolean
  configured:boolean
  discovered:boolean
  message:string
  verifiedAt?:string
  verificationTaskId?:string
}

export interface EbayVideoCapabilityVerificationRequest {
  id:string
  kind:EbayVideoCapabilityKind
  imageUrl?:string
}

export interface EbayVideoTextPlanShot {
  visual:string
  englishCaption:string
  chineseCaption:string
  englishNarration:string
  chineseNarration:string
}

export interface EbayVideoTextPlan {
  model:string
  shots:EbayVideoTextPlanShot[]
  englishNarration:string
  chineseNarration:string
  generatedAt:string
}

export interface EbayVideoStudioRequest {
  listingId:string
  videoModelId?:string
  textModelId?:string
  title:string
  description:string
  chineseDescription:string
  imageUrls:string[]
  additionalImageUrls:string[]
  additionalText:string
  subtitleMode:EbayVideoSubtitleMode
  voiceMode:EbayVideoVoiceMode
  voiceProvider?:EbayVideoVoiceProvider
  voiceStyle:EbayVideoVoiceStyle
  voiceSpeed:number
  narrationText:string
  storyboard:EbayVideoStoryboardShot[]
}

export type EbayVideoStudioPhase='PREPARING'|'SUBMITTING'|'GENERATING'|'DOWNLOADING'|'COMPOSITING'|'COMPLETED'|'FAILED'

export interface EbayVideoStudioProgress {
  listingId:string
  projectId:string
  phase:EbayVideoStudioPhase
  progress:number
  message:string
}

export interface EbayVideoStudioConfiguration {
  connected:boolean
  model:string
  voiceAvailable:boolean
  message:string
  videoModels:EbayVideoStudioCapability[]
  textModels:EbayVideoStudioCapability[]
  voiceProviders:EbayVideoStudioCapability[]
  checkStatus:'NOT_CHECKED'|'SUCCEEDED'|'FAILED'
  checkMessage:string
  checkedAt?:string
}

export interface EbayVideoStudioProject {
  id:string
  listingId:string
  version:number
  status:'GENERATING'|'READY'|'FAILED'
  model:string
  textModelId?:string
  textPlan?:EbayVideoTextPlan
  title:string
  sourceImageCount:number
  subtitleMode:EbayVideoSubtitleMode
  voiceMode:EbayVideoVoiceMode
  voiceProvider?:EbayVideoVoiceProvider
  additionalText:string
  narrationText:string
  taskIds:string[]
  clipPaths:string[]
  subtitlePath?:string
  voicePath?:string
  video?:EbayPublishVideoArtifact
  confirmedAt?:string
  error?:string
  createdAt:string
  updatedAt:string
}

export interface EbayContentOptimizationResult {
  sections:EbayContentSection[]
  sourceFacts:EbayContentSourceFact[]
  benefits:EbayContentBenefit[]
  scenarios:EbayContentScenario[]
  validation:EbayContentValidation
  englishDescription:string
  chineseReference:string
  translation:EbayContentTranslationResult
  storyboard:EbayVideoStoryboardShot[]
  model:string
}

export interface EbayContentOptimizationRecord {
  id:string
  storeId:string
  listingId:string
  selectedTitle:string
  result:EbayContentOptimizationResult
  createdAt:string
  updatedAt:string
}

export type EbayContentOptimizationRecordInput=Omit<EbayContentOptimizationRecord,'id'|'createdAt'|'updatedAt'>

export type EbayContentTranslationStatus='SYNCED'|'STALE'|'FAILED'

export interface EbayContentTranslationSegment {
  id:string
  english:string
  chinese:string
  sourceHash:string
  status:EbayContentTranslationStatus
}

export interface EbayContentTranslationRequest {
  segments:Array<{id:string;english:string}>
}

export interface EbayContentTranslationResult {
  model:'qwen-mt-flash'
  translatedAt:string
  segments:EbayContentTranslationSegment[]
  error?:string
}

export interface EbayOptimizationExportInput {
  listing:EbayListing
  selectedTitle:string
  itemSpecifics:EbayItemSpecific[]
  description:string
  chineseReference:string
  imageUrls:string[]
  storyboard:EbayVideoStoryboardShot[]
  marketDecision?:EbayMarketDecisionReport
}

export interface EbayOptimizationExportResult {
  filePath:string
}

export interface EbayTitleVariant {
  id:'SEARCH'|'PARAMETER'|'BENEFIT'|'SCENARIO'|'INTENT'|'BALANCED'|'READABLE'
  name:string
  title:string
  keywords:string[]
  rationale:string
}

export interface EbayTitleAudit {
  characterCount:number
  withinLimit:boolean
  duplicateTerms:string[]
  danglingConnector:boolean
  confirmedTermHits:string[]
  unverifiedTerms:string[]
  coverageScore:number
  passed:boolean
}

export interface EbayTitleDecision {
  id:string
  storeId:string
  listingId:string
  researchSnapshotId:string
  originalTitle:string
  selectedTitle:string
  selectedVariantId:EbayTitleVariant['id']
  variants:EbayTitleVariant[]
  verifiedFacts?:string[]
  audit:EbayTitleAudit
  status:'CONFIRMED'
  confirmedAt:string
}

export type EbayTitleDecisionInput=Omit<EbayTitleDecision,'id'|'audit'|'status'|'confirmedAt'>

export interface EbayTitleHandoffAuditEvent {
  id:string
  action:'VALIDATION_PASSED'|'SELLER_HUB_OPENED'|'TITLE_FILLED'|'BLOCKED'|'FAILED'
  status:'SUCCESS'|'WARNING'|'FAILED'
  detail:string
  createdAt:string
}

export interface EbayTitleHandoff {
  id:string
  storeId:string
  listingId:string
  titleDecisionId:string
  researchSnapshotId:string
  originalTitle:string
  preparedTitle:string
  status:'PREPARING'|'WAITING_CONFIRMATION'|'BLOCKED'|'FAILED'
  reviseUrl:string
  filledFields:string[]
  warnings:string[]
  submitButtonDetected:boolean
  message:string
  auditTrail:EbayTitleHandoffAuditEvent[]
  createdAt:string
  updatedAt:string
}

export interface EbayOptimizationSpecific {
  name:string
  value:string
  priority:'REQUIRED'|'RECOMMENDED'
  confidence:'HIGH'|'MEDIUM'|'LOW'
  needsConfirmation:boolean
  source:string
}

export interface EbayOptimizationDraft {
  id:string
  storeId:string
  listingId:string
  listing:EbayListing
  selectedTitle:string
  titleVariants:EbayTitleVariant[]
  itemSpecifics:EbayOptimizationSpecific[]
  description:string
  imageUrl:string
  imageUrls?:string[]
  storyboard?:EbayVideoStoryboardShot[]
  marketDecision?:EbayMarketDecisionReport
  scoreBefore:number
  scoreAfter:number
  complianceCheckId?:string
  complianceGateStatus?:ComplianceGateStatus
  complianceRuleSetVersion?:string
  complianceCheckedAt?:string
  complianceReviewedAt?:string
  complianceInputFingerprint?:string
  status:'PREMIUM'
  createdAt:string
  updatedAt:string
}

export type EbayOptimizationDraftInput=Omit<EbayOptimizationDraft,'id'|'status'|'createdAt'|'updatedAt'>

export interface EbayPublishComplianceValidation {
  draft:EbayOptimizationDraft
  check:ComplianceCheckResult
  permit?:ComplianceReleasePermit
  publishAllowed:boolean
  reason:string
}

export interface EbayCategorySpecificRequirement {
  name:string
  required:boolean
  value:string
  options:string[]
  source:'SELLER_HUB'
}

export interface EbayImageInspection {
  url:string
  reachable:boolean
  format:string
  width:number
  height:number
  longestEdge:number
  status:'PASSED'|'REVIEW'|'BLOCKED'
  findings:string[]
}

export interface EbayImageInspectionReport {
  checkedAt:string
  images:EbayImageInspection[]
  passed:number
  review:number
  blocked:number
}

export type EbayImageVisualRuleCode = 'PRODUCT_ACCURACY' | 'NO_BORDER' | 'NO_ADDED_TEXT' | 'NO_WATERMARK'
export type EbayImageVisualResultStatus = 'PASSED' | 'FAILED' | 'REVIEW'

export interface EbayImageVisualManualReview {
  decision:'PASSED'|'FAILED'
  reviewedAt:string
  reviewedBy:string
  note:string
}

export interface EbayImageVisualRuleResult {
  rule:EbayImageVisualRuleCode
  label:string
  status:EbayImageVisualResultStatus
  modelStatus?:EbayImageVisualResultStatus
  confidence:number
  evidence:string
  manualReview?:EbayImageVisualManualReview
}

export interface EbayImageVisualImageResult {
  mediaId:string
  sortOrder:number
  status:EbayImageVisualResultStatus
  summary:string
  rules:EbayImageVisualRuleResult[]
}

export interface EbayImageVisualInspectionReport {
  checkedAt:string
  model:string
  ruleSetVersion:string
  status:EbayImageVisualResultStatus
  checkedImageCount:number
  passed:number
  failed:number
  review:number
  message:string
  images:EbayImageVisualImageResult[]
}

export interface EbayImageVisualReviewInput {
  localProductId:string
  mediaId:string
  rule:EbayImageVisualRuleCode
  decision:'PASSED'|'FAILED'
  reviewedBy:string
  note:string
}

export interface EbayPublishComparisonItem {
  field:'标题'|'英文详情'|'商品属性'|'主图'
  before:string
  after:string
  status:'CHANGED'|'UNCHANGED'|'REVIEW'
}

export interface EbayPublishVideoArtifact {
  status:'READY'|'FAILED'
  fileName:string
  filePath:string
  previewUrl:string
  durationSeconds:number
  width:number
  height:number
  imageCount:number
  sizeBytes:number
  generatedAt:string
  message:string
}

export interface EbayVideoUploadPreparation {
  status:'FILE_SELECTED'|'MANUAL_SELECTION_REQUIRED'|'FAILED'
  reviseUrl:string
  fileInputDetected:boolean
  preparedAt:string
  message:string
}

export interface EbayPublishAuditEvent {
  id:string
  action:'VALIDATION_STARTED'|'VALIDATION_PASSED'|'VALIDATION_BLOCKED'|'SELLER_HUB_FILLED'|'VIDEO_GENERATED'|'VIDEO_UPLOAD_PREPARED'|'FAILED'
  status:'SUCCESS'|'WARNING'|'FAILED'
  detail:string
  createdAt:string
}

export type EbayPublishTaskStatus='DRAFT'|'VALIDATING'|'READY_TO_FILL'|'FILLING'|'WAITING_CONFIRMATION'|'BLOCKED'|'FAILED'

export interface EbayPublishTask {
  id:string
  storeId:string
  draftId:string
  listingId:string
  status:EbayPublishTaskStatus
  reviseUrl:string
  categorySpecifics:EbayCategorySpecificRequirement[]
  imageInspection:EbayImageInspectionReport
  filledFields:string[]
  warnings:string[]
  comparison?:EbayPublishComparisonItem[]
  video?:EbayPublishVideoArtifact
  videoUpload?:EbayVideoUploadPreparation
  auditTrail?:EbayPublishAuditEvent[]
  message:string
  createdAt:string
  updatedAt:string
}

export interface EbayPublishPreparationResult {
  task:EbayPublishTask
  categorySpecifics:EbayCategorySpecificRequirement[]
  filledFields:string[]
  warnings:string[]
  submitButtonDetected:boolean
}

export interface EbaySellerHubAcceptanceSnapshot {
  url:string
  pageStatus:'READY'|'LOGIN_EXPIRED'|'VERIFICATION_REQUIRED'|'FIELDS_UNAVAILABLE'
  title:string
  descriptionLength:number
  requiredSpecifics:Array<{name:string;value:string}>
  submitButtonDetected:boolean
  videoStatus:string
  inspectedAt:string
}

export interface EbayAcceptanceCheck {
  code:'SOURCE_DATA'|'OPTIMIZATION_DRAFT'|'COMPLIANCE_GATE'|'PUBLISH_PREPARATION'|'SELLER_HUB_SESSION'|'TITLE_MATCH'|'DESCRIPTION_MATCH'|'REQUIRED_SPECIFICS'|'VIDEO_READY'|'FINAL_SUBMIT_GUARD'
  label:string
  status:'PASSED'|'WARNING'|'BLOCKED'
  detail:string
}

export interface EbayAcceptanceItemResult {
  listingId:string
  title:string
  draftId?:string
  status:'PASSED'|'ATTENTION'|'BLOCKED'
  checks:EbayAcceptanceCheck[]
  inspectedAt:string
}

export interface EbayAcceptanceScenarioResult {
  scenario:'LOGIN_EXPIRED'|'CAPTCHA'|'FIELD_CHANGED'|'FAILURE_RECOVERY'
  status:'PASSED'|'FAILED'
  detail:string
}

export interface EbayAcceptanceBatch {
  id:string
  storeId:string
  mode:'SINGLE'|'BATCH_10'
  status:'PASSED'|'ATTENTION'|'BLOCKED'
  requested:number
  checked:number
  passed:number
  attention:number
  blocked:number
  items:EbayAcceptanceItemResult[]
  scenarios:EbayAcceptanceScenarioResult[]
  reportPath:string
  createdAt:string
}

export interface EbayAcceptanceRunRequest {
  storeId:string
  mode:'SINGLE'|'BATCH_10'
  draftId?:string
}

export interface BrowserState {
  platform: Platform
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export interface BrowserTab {
  id: string
  platform: Platform
  title: string
  faviconUrl?: string
  siteLogoUrl?: string
  closable: boolean
  active: boolean
  generic?: boolean
  scopeId?: string
}

export type BrowserTranslationMode = 'BILINGUAL' | 'CHINESE'

export interface BrowserTranslationStatus {
  translated: number
  detectedLanguages: string[]
  mode: BrowserTranslationMode
}

export interface EbayDeliveryLocationResult {
  found: boolean
  opened: boolean
  label: string
  fallback: boolean
}

export interface EbayBrowserPluginState {
  active: boolean
  recognizedCount: number
  selectedCount: number
  products: EbayCollectedProduct[]
}

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

export interface EbayDirectoryProductSyncRequest {
  storeId: string
  categoryIds: string[]
  publicStoreUrl?: string
  resumeTaskId?: string
  restart?: boolean
}

export type EbayDirectorySyncStatus = 'RUNNING' | 'PAUSED' | 'NEEDS_ATTENTION' | 'COMPLETED' | 'CANCELLED' | 'INTERRUPTED'
export type EbayDirectorySyncStage = 'LOGIN' | 'STORE' | 'CATEGORY' | 'PAGE' | 'WRITING' | 'COMPLETED'

export interface EbayDirectoryProductSyncProgress {
  taskId: string
  storeId: string
  status: EbayDirectorySyncStatus
  stage: EbayDirectorySyncStage
  message: string
  categoryId: string
  categoryName: string
  categoryIndex: number
  categoryCount: number
  expected: number
  found: number
  completedCategories: number
  failedCategories: number
  percent: number
  startedAt: string
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

export interface EbayProductSyncChange {
  listingId: string
  title: string
  type: 'IMPORTED' | 'UPDATED' | 'MOVED' | 'REACTIVATED' | 'SUSPECTED_ENDED' | 'ENDED'
  beforeCategory: string
  afterCategory: string
}

export interface EbayDirectoryProductScanCategory {
  categoryId: string
  categoryName: string
  expected: number
  found: number
  complete: boolean
  listingIds: string[]
  error: string
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

export type EbayLoginStatus = 'CHECKING' | 'ONLINE' | 'OFFLINE' | 'AUTO_LOGIN_RUNNING' | 'VERIFICATION_REQUIRED' | 'CREDENTIALS_REQUIRED' | 'ERROR'

export interface EbayLoginResult {
  status: EbayLoginStatus
  message: string
  url: string
  autoLoginAttempted: boolean
}

export type SupplyLoginStatus = 'NOT_APPLICABLE' | 'ONLINE' | 'OFFLINE' | 'AUTO_LOGIN_RUNNING' | 'VERIFICATION_REQUIRED' | 'UNKNOWN'

export interface SupplyActivationResult {
  platformCode: '1688' | 'GIGACLOUD'
  loginStatus: SupplyLoginStatus
  message: string
  url: string
  autoLoginAttempted: boolean
}

export interface BrowserBounds {
  x: number
  y: number
  width: number
  height: number
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

export interface CollectionPreviewResult {
  task: SelectionTask
  products: CollectedOzonProduct[]
  supplyProducts: CollectedSupplyProduct[]
}

export interface CollectionPreviewConfirmRequest {
  taskId: string
  selectedUrls: string[]
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

export interface CollectorPluginProduct {
  platformCode: 'GIGACLOUD' | '1688'
  productId: string
  url: string
  title: string
  imageUrl: string
  priceText: string
  salesText: string
  shippingFeeText?: string
  sellableInventory?: number | null
  promotionText?: string
  supplierName: string
  gigaIndex?: number | null
  storeReturnRate?: string
  capturedFrom: 'DETAIL' | 'LIST'
  sourceCategory?: SupplySourceCategory
}

export interface CollectorPluginStatus {
  running: boolean
  port: number
  pairingCode: string
  extensionPath: string
  importedCount: number
}

export interface CollectorPluginImportResult {
  imported: number
  updated: number
  total: number
  blocked: number
  duplicates: CollectorDuplicateProduct[]
}

export type CollectorDuplicateStage = 'CANDIDATE' | 'SELECTION' | 'WAREHOUSE' | 'HISTORY'

export interface CollectorDuplicateProduct {
  platformCode: string
  productId: string
  title: string
  stage: CollectorDuplicateStage
  message: string
}

export interface BuiltInCollectorState {
  active: boolean
  platformCode: 'GIGACLOUD'
  recognizedCount: number
  products: CollectorPluginProduct[]
}

export interface ImageModelProfile {
  id: string
  name: string
  description: string
  /** 单次生成可携带的参照图上限，来自 BailianImageService 模型元数据 */
  maxReferenceImages?: number
  /** 服务商标识；缺省视为百炼（bailian） */
  provider?: 'bailian' | 'volc' | 'openai'
  /** 功能强项描述，如 "商品一致性·细节还原·全场景适用" */
  strengths?: string
  /** 单张成本标签，如 "¥0.22/张" */
  costLabel?: string
  /** 该模型需通过 IMAGE_PROXY_URL 代理访问 */
  requiresProxy?: boolean
}

export interface ImageModelConnection {
  connected: boolean
  models: ImageModelProfile[]
  message: string
}

export interface ImageGenerationRequest {
  model: string
  prompt: string
  /** Whether the provider may rewrite/expand the prompt before generation. */
  promptExtend?: boolean
  referenceImageUrl?: string
  /** Source images for reference-aware generation. The supported count depends on the selected model. */
  referenceImageUrls?: string[]
  size: '1K' | '2K'
  count: number
}

export interface ImageGenerationResult {
  taskId: string
  imageUrls: string[]
}

export interface ImageMarketingTranslationRequest {
  texts:string[]
  targetLanguage:string
  protectedTerms?:string[]
}

export interface ImageMarketingTranslationResult {
  model:string
  targetLanguage:string
  translations:string[]
  status:'TRANSLATED'|'REVIEW'
  issues:string[]
}

export type EbayImageGenerationPurpose = 'HERO' | 'PRODUCT' | 'PAIN_POINT' | 'SCENE'

export interface EbayImageGroundingRequest {
  title: string
  description: string
  itemSpecifics: Array<{ name: string; value: string }>
  sourceImages: string[]
  /** Human-curated reference roles, aligned with sourceImages. */
  sourceLabels?: string[]
}

export interface EbayImageGroundingSource {
  sourceIndex: number
  roles: EbayImageGenerationPurpose[]
  facts: string[]
  quality: 'KEEP' | 'IMPROVE' | 'EXCLUDE'
}

export interface EbayImageGroundingPlan {
  model: string
  productIdentity: string
  protectedAttributes: string[]
  verifiedFacts: string[]
  warnings: string[]
  sources: EbayImageGroundingSource[]
  purposeReferences: Record<EbayImageGenerationPurpose, number[]>
  purposeInstructions: Record<EbayImageGenerationPurpose, string>
  analyzedAt: string
}

export type ImagePackageTextField = 'brand'|'productName'|'model'|'specification'|'quantity'|'barcode'|'otherText'
export interface ImagePackageTextObservation {
  sourceIndex:number
  rawText:string
  fields:Partial<Record<ImagePackageTextField,string>>
  confidence:number
}
export interface ImagePackageTextExtractionRequest {sourceImages:string[];sourceLabels?:string[]}
export interface ImagePackageTextExtractionResult {
  model:string
  observations:ImagePackageTextObservation[]
  conflicts:ImagePackageTextField[]
  combinedText:string
  warnings:string[]
  productForm?: string
  useMethod?: string
  targetObject?: string
  visualConfidence?: number
  analyzedAt:string
}

export interface EbayImageCandidateReviewRequest {
  title: string
  description: string
  itemSpecifics: Array<{ name: string; value: string }>
  purpose: EbayImageGenerationPurpose
  candidateUrl: string
  sourceImages: string[]
  /** 每张原图的角色标签（与 sourceImages 对齐），用于服务端按角色偏好智能截断 */
  sourceLabels?: string[]
  referenceIndices: number[]
  protectedAttributes: string[]
  verifiedFacts: string[]
  /** The required visual role for this single generated shot. */
  shotInstruction?: string
  /** Mandatory Style Lock criteria that the candidate must visibly satisfy. */
  styleInstruction?: string
  /** Target language for later typography; generated candidates are expected to remain text-free base images. */
  targetLanguage?:string
  /** Whether this candidate must contain no generated marketing typography. */
  baseImageNoMarketingText?:boolean
  verifiedPackageTexts?:string[]
  /** Earlier candidates used to reject near-duplicate shots: same role first, then a few cross-role shots. */
  comparisonCandidateUrls?: string[]
}

export interface EbayImageCandidateReview {
  candidateUrl: string
  purpose: EbayImageGenerationPurpose
  status: 'PASSED' | 'REVIEW' | 'REJECTED'
  identityScore: number
  structuralScore: number
  factScore: number
  purposeScore: number
  diversityScore: number
  /** Style Lock visual match score. Present when styleInstruction was supplied. */
  styleScore?: number
  /** No-text base image / target-language compliance score. */
  languageScore?:number
  packageTextVisible?:boolean
  packageTextScore?:number
  reason: string
  referenceIndices: number[]
  /** 候选图中出现、但任何原图参照角度都不存在的结构部件；非空时一票否决为 REJECTED。 */
  newStructures?: string[]
  /** 原图关键结构在候选图中缺失的部件；非空时至少降级为 REVIEW。 */
  missingStructures?: string[]
  /** 产品外形/轮廓/几何形态一致性评分（0-100）；低于 80 时不通过。 */
  geometryScore?: number
  /** 候选图产品外形/轮廓与原图明显不同时为 true，一票否决为 REJECTED。 */
  geometryMismatch?: boolean
}

/** AI 可建议的原图用途角色；不含 UNUSED，排除与否始终由人工决定。 */
export type EbayImageSourceRoleSuggestion = 'HERO' | 'FRONT' | 'SIDE' | 'BACK' | 'DETAIL' | 'INSTALLATION' | 'SIZE' | 'PAIN_POINT' | 'SCENE'

export interface EbayImageRoleSuggestionRequest {
  /** Retained source images (http URLs). Anything beyond 12 is truncated by the service. */
  sourceImages: string[]
  title?: string
  productIdentity?: string
}

export interface EbayImageRoleSuggestionResult {
  /** url → 建议角色；无法建议的图片不出现在结果中。 */
  suggestions: Record<string, EbayImageSourceRoleSuggestion>
  model: string
}

// ─── 阶段式图片优化（新框架） ───────────────────────────────────────────────

/** 图片优化的 5 个线性阶段 */
export type EbayImageStage = 'HERO' | 'PRODUCT' | 'PAIN_POINT' | 'SCENE' | 'NATURALIZE'

/** 每个阶段内部的子步骤状态 */
export type EbayImageStageStep = 'PENDING' | 'SELECTING' | 'GROUNDING' | 'STORYBOARD' | 'GENERATING' | 'REVIEW' | 'CONFIRMED'

/** 阶段进度记录 */
export interface EbayImageStageProgress {
  stage: EbayImageStage
  step: EbayImageStageStep
  /** 该阶段选用的原图索引列表 */
  selectedSourceIndices: number[]
  /** 该阶段选用的 AI 模型 ID */
  modelId: string
  /** 确认的最终图片 URL */
  confirmedImageUrl: string
  updatedAt: string
}

/** 单阶段事实卡（中文） */
export interface EbayStageFactCard {
  stage: EbayImageStage
  /** 商品主体描述 */
  productIdentity: string
  /** 不可改变的保护属性 */
  protectedAttributes: string[]
  /** 从原图中核实的事实 */
  verifiedFacts: string[]
  /** 针对该阶段的生成指令（中文） */
  stageInstruction: string
  /** 警告信息 */
  warnings: string[]
  /** 分析使用的模型 */
  model: string
  analyzedAt: string
}

/** 分镜卡（全中文，可编辑） */
export interface EbayStageStoryboardCard {
  id: string
  stage: EbayImageStage
  /** 镜头序号（从 1 开始） */
  index: number
  /** 镜头标题（中文） */
  title: string
  /** 镜头描述/拍摄指令（中文，用户可编辑） */
  instruction: string
  /** 参照原图索引列表 */
  referenceIndices: number[]
  /** 内容依据（中文） */
  evidence: string
  /** 验收标准（中文，用户可编辑） */
  acceptance: string
  /** 禁止事项（中文） */
  prohibited: string
  /** 用户附加备注（可编辑） */
  userNote: string
}

/** 单阶段分镜卡生成请求 */
export interface EbayStageStoryboardRequest {
  stage: EbayImageStage
  title: string
  description: string
  itemSpecifics: Array<{ name: string; value: string }>
  sourceImages: string[]
  sourceLabels?: string[]
  factCard: EbayStageFactCard
  /** 期望生成的分镜数量 */
  count?: number
}

/** 单阶段事实卡生成请求 */
export interface EbayStageGroundingRequest {
  stage: EbayImageStage
  title: string
  description: string
  itemSpecifics: Array<{ name: string; value: string }>
  sourceImages: string[]
  sourceLabels?: string[]
  /** 前一阶段的事实卡（用于继承全局信息） */
  previousFactCard?: EbayStageFactCard | null
}

/** 模型推荐结果 */
export interface EbayStageModelRecommendation {
  stage: EbayImageStage
  recommendations: Array<{
    modelId: string
    modelName: string
    reason: string
    score: number
  }>
}

/** 单阶段图片生成请求 */
export interface EbayStageGenerateRequest {
  stage: EbayImageStage
  modelId: string
  storyboardCard: EbayStageStoryboardCard
  factCard: EbayStageFactCard
  referenceImageUrls: string[]
  /** 重新生成时的附加指令 */
  retryDirective?: string
}

export type RealShiftProfile = 'light' | 'balanced'

export interface RealShiftRequest {
  imageUrl?: string
  localPath?: string
  productId: string
  profile: RealShiftProfile
  seed?: number
}

export interface RealShiftScore {
  risk: number
  entropy: number
  high_frequency: number
  smoothness: number
  channel_correlation: number
  model_probability: number | null
}

export interface RealShiftResult {
  originalDataUrl: string
  processedDataUrl: string
  originalPath: string
  processedPath: string
  reportPath: string
  profile: RealShiftProfile
  originalScore: RealShiftScore
  processedScore: RealShiftScore
  chosenIteration: number
}

export type CandidateArea = 'SUPPLY' | 'MARKET'

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

export interface TaskProgress {
  taskId: string
  stage: TaskStage
  message: string
  collected: number
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

export type ComplianceRiskLevel = 'P0' | 'P1' | 'P2' | 'P3'
export type ComplianceReviewStatus = 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'INACTIVE'
export type ComplianceGateStatus = 'BLOCKED' | 'REVIEW_REQUIRED' | 'RECHECK_REQUIRED' | 'PASSED'

export interface ComplianceSource {
  id: string
  name: string
  authority: string
  sourceType: 'PLATFORM' | 'REGULATOR' | 'RECALL'
  url: string
  syncMode: 'API' | 'MANUAL' | 'CREDENTIALS_REQUIRED' | 'WEB_MONITOR'
  syncStatus: 'READY' | 'NOT_CONFIGURED' | 'ERROR'
  lastSyncedAt?: string
  lastCheckedAt?: string
  lastChangedAt?: string
  contentHash?: string
  changeCount: number
  lastError?: string
}

export interface ComplianceSourceChange {
  id: string
  sourceId: string
  oldHash: string
  newHash: string
  summary: string
  affectedRuleIds: string[]
  status: 'PENDING_REVIEW' | 'REVIEWED' | 'APPROVED' | 'REJECTED'
  detectedAt: string
  reviewedAt?: string
  reviewedBy?: string
  reviewNote?: string
}

export type ComplianceSourceChangeDecision = 'APPROVED' | 'REJECTED'

export interface ComplianceSourceChangeReviewResult {
  change: ComplianceSourceChange
  recheck: ComplianceBatchRecheckResult
  workspace: ComplianceKnowledgeWorkspace
}

export interface ComplianceRuleVersion {
  id: string
  ruleId: string
  version: number
  title: string
  summary: string
  condition: { keywords?: string[]; requiredFields?: string[] }
  remediation: string
  sourceUrl: string
  effectiveFrom: string
  createdAt: string
}

export interface ComplianceRule {
  id: string
  code: string
  platform: string
  marketplaceSite: string
  country: string
  category: string
  ruleType: string
  riskLevel: ComplianceRiskLevel
  reviewStatus: ComplianceReviewStatus
  currentVersion: number
  updatedAt: string
  version: ComplianceRuleVersion
  versions: ComplianceRuleVersion[]
}

export interface ComplianceRuleDraft {
  id?: string
  code: string
  platform: string
  marketplaceSite: string
  country: string
  category: string
  ruleType: string
  riskLevel: ComplianceRiskLevel
  reviewStatus: ComplianceReviewStatus
  title: string
  summary: string
  keywords: string[]
  requiredFields: string[]
  remediation: string
  sourceUrl: string
  effectiveFrom: string
}

export interface ComplianceRecall {
  id: string
  sourceId: string
  externalId: string
  title: string
  description: string
  products: string
  hazards: string
  countries: string
  recallDate: string
  sourceUrl: string
  updatedAt: string
}

export type ComplianceDocumentStatus = 'MISSING' | 'PENDING_REVIEW' | 'APPROVED' | 'EXPIRING' | 'EXPIRED' | 'REJECTED'
export type ComplianceTaskStatus = 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'DISMISSED'

export interface ComplianceProductProfile {
  id: string
  productId: string
  platform: string
  marketplaceSite: string
  country: string
  categoryId: string
  categoryName: string
  title: string
  brand: string
  manufacturer: string
  importer: string
  euResponsiblePerson: string
  model: string
  batchNumber: string
  barcode: string
  originCountry: string
  materials: string
  ageGrade: string
  batteryType: string
  updatedAt: string
}

export interface ComplianceProductProfileDraft extends Omit<ComplianceProductProfile,'id'|'updatedAt'> { id?: string }

export interface ComplianceDocumentRecord {
  id: string
  productId: string
  documentType: string
  name: string
  documentNumber: string
  issuer: string
  modelNumbers: string
  countries: string
  issuedAt: string
  expiresAt: string
  status: ComplianceDocumentStatus
  fileName: string
  filePath: string
  reviewNote: string
  updatedAt: string
}

export interface ComplianceDocumentDraft extends Omit<ComplianceDocumentRecord,'id'|'updatedAt'> { id?: string }

export interface ComplianceCategoryTemplate {
  id: string
  name: string
  platform: string
  marketplaceSite: string
  country: string
  category: string
  requiredFields: string[]
  requiredDocuments: string[]
  requiredWarnings: string[]
  logisticsRequirements: string[]
  requiresManualReview: boolean
  active: boolean
  updatedAt: string
}

export interface ComplianceCategoryTemplateDraft extends Omit<ComplianceCategoryTemplate,'id'|'updatedAt'> { id?: string }

export interface ComplianceTaskRecord {
  id: string
  productId: string
  checkId?: string
  taskType: 'RULE_UPDATE' | 'DOCUMENT_MISSING' | 'DOCUMENT_EXPIRING' | 'RECALL_MATCH' | 'MANUAL_REVIEW' | 'REMEDIATION'
  riskLevel: ComplianceRiskLevel
  title: string
  detail: string
  status: ComplianceTaskStatus
  assignee: string
  dueAt: string
  resolution: string
  createdAt: string
  updatedAt: string
}

export type ComplianceAlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'

export interface ComplianceAlert {
  id: string
  alertType: 'SOURCE_ERROR' | 'SOURCE_CHANGE' | 'RECALL_MATCH' | 'PUBLISH_BLOCK'
  riskLevel: ComplianceRiskLevel
  entityId: string
  title: string
  detail: string
  status: ComplianceAlertStatus
  note: string
  createdAt: string
  updatedAt: string
}

export interface ComplianceAuditEvent {
  id: string
  action: string
  entityType: string
  entityId: string
  detail: string
  createdAt: string
}

export type ComplianceReleasePermitStatus = 'VALID' | 'REVOKED' | 'EXPIRED'

export interface ComplianceReleasePermit {
  id: string
  productId: string
  platform: string
  marketplaceSite: string
  checkId: string
  ruleSetVersion: string
  inputFingerprint: string
  gateStatus: ComplianceGateStatus
  issuedAt: string
  expiresAt: string
  status: ComplianceReleasePermitStatus
  revokedAt?: string
  revokeReason?: string
}

export type ComplianceEnforcementStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED'
export type ComplianceEnforcementAction = 'REMOVE_LISTING' | 'PAUSE_AND_REVIEW' | 'CORRECT_AND_RECHECK'

export interface ComplianceEnforcementCase {
  id: string
  productId: string
  platform: string
  marketplaceSite: string
  listingId: string
  storeId: string
  title: string
  viewUrl: string
  riskLevel: ComplianceRiskLevel
  reason: string
  recommendedAction: ComplianceEnforcementAction
  status: ComplianceEnforcementStatus
  assignee: string
  resolution: string
  createdAt: string
  updatedAt: string
  resolvedAt?: string
}

export interface ComplianceKnowledgeWorkspace {
  sources: ComplianceSource[]
  sourceChanges: ComplianceSourceChange[]
  rules: ComplianceRule[]
  recalls: ComplianceRecall[]
  profiles: ComplianceProductProfile[]
  documents: ComplianceDocumentRecord[]
  templates: ComplianceCategoryTemplate[]
  tasks: ComplianceTaskRecord[]
  alerts: ComplianceAlert[]
  auditEvents: ComplianceAuditEvent[]
  permits: ComplianceReleasePermit[]
  enforcementCases: ComplianceEnforcementCase[]
  metrics: { activeRules: number; pendingReview: number; recalls: number; staleSources: number; profiles: number; openTasks: number; expiringDocuments: number; blockedProducts: number; validPermits: number; openEnforcementCases: number }
}

export interface ComplianceBatchRecheckResult {
  total: number
  checked: number
  skipped: number
  passed: number
  reviewRequired: number
  recheckRequired: number
  blocked: number
  checkedAt: string
}

export interface ComplianceCheckRequest {
  productId: string
  platform: string
  marketplaceSite: string
  country: string
  categoryId?: string
  categoryName?: string
  title: string
  description?: string
  imageUrl?: string
  itemSpecifics?: Array<{ name: string; value: string }>
}

export interface ComplianceFinding {
  id: string
  ruleId: string
  ruleCode: string
  riskLevel: ComplianceRiskLevel
  title: string
  matchedContent: string
  reason: string
  remediation: string
  sourceUrl: string
  ruleVersion: number
  effectiveFrom: string
  requiresReview: boolean
}

export interface ComplianceCheckResult {
  id: string
  productId: string
  gateStatus: ComplianceGateStatus
  checkedAt: string
  ruleSetVersion: string
  inputFingerprint: string
  findings: ComplianceFinding[]
  reviewedAt?: string
  reviewedBy?: string
  reviewNote?: string
}

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

export type ImageSourceKind = 'LOCAL' | 'URL' | 'INVENTORY'
export type ImageReferenceRole = 'PRIMARY' | 'DETAIL' | 'PACKAGING' | 'ACCESSORY'

export interface ImportedProductImage {
  id?: string
  name: string
  dataUrl: string
  source: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  role?: ImageReferenceRole
  sourceType?:'GALLERY'|'SKU'|'DESCRIPTION'|'WEBPAGE'
  sourceText?:string
}

export interface ProductSourceEvidence {
  field: 'title' | 'productId' | 'priceText' | 'imageUrl' | 'attribute' | 'sku' | 'description'
  value: string
  source: string
}

export interface ImportedProductSource {
  sourceKind: Exclude<ImageSourceKind, 'INVENTORY'>
  sourceLabel: string
  sourceUrl?: string
  title: string
  productId: string
  priceText: string
  imageUrl: string
  images: ImportedProductImage[]
  evidence?: ProductSourceEvidence[]
  pageFacts?:Array<{key:string;label:string;value:string;source:string}>
}
