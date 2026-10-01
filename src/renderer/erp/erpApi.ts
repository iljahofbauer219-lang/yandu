/**
 * ERP 采集加工域渲染层 API 封装（方案 §3 REST）。
 * 全部经 shared/serverHttp.apiFetch，自动携带 JWT 并在 401 时刷新重放。
 * 运营角色响应已由服务端投影剥离敏感字段，前端不做任何"隐藏即安全"。
 */
import { apiFetch } from '../serverApi'

export interface ErpSupplierView {
  id: string
  code: string
  name: string
  loginUrl: string
  crawlRules: Record<string, unknown>
  patrolChannel: string
  status: string
  createdAt: string
  updatedAt: string
}

export interface ErpProductImageView {
  id: string
  imageType: string
  /** 已落盘 → 本地媒体签名 URL（/media/...）；未落盘 → 采集角色为货盘外链、运营为空串（服务端 resolveImageViews 门控） */
  url: string
  localPath: string
  platform: string | null
  isSelected: number
  sortOrder: number
  /** 仅采集角色且尚未落盘时返回；入库后禁引外链，不出现 */
  sourceUrl?: string
}

export interface ErpDownloadJobView {
  id: string
  productId: string
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'PARTIAL' | 'FAILED' | string
  total: number
  done: number
  failedUrls: string[]
  error: string
  createdAt: string
  updatedAt: string
}

/** 产品视图：敏感字段（supplierId/sourceUrl/...）仅采集角色返回，故全部可选 */
export interface ErpProductView {
  id: string
  orgId: string
  titleOriginal: string
  descriptionOriginal: string
  costPrice: number | null
  shippingCost: number | null
  currency: string
  stockQuantity: number | null
  dimensions: Record<string, unknown>
  weight: number | null
  material: string
  color: string
  brand: string
  category: string
  variants: unknown[]
  status: string
  changeFlag: number
  lastCrawledAt: string | null
  createdAt: string
  updatedAt: string
  images: ErpProductImageView[]
  // —— 敏感字段（仅采集专员/主帐号可见）——
  supplierId?: string
  sourceUrl?: string
  sourceProductId?: string
  sourceSku?: string
  collectedBy?: string
  crawlConfig?: Record<string, unknown>
  supplier?: { id: string; code: string; name: string; patrolChannel: string }
}

export interface ErpProductListResult {
  items: ErpProductView[]
  total: number
  page: number
  pageSize: number
}

export interface ErpCapabilities {
  canViewSource: boolean
  canCollect: boolean
  canEdit: boolean
  canPricing: boolean
  canResolveChanges: boolean
}

export interface ErpFieldDiff {
  field: string
  oldValue: string
  newValue: string
}

export type ErpCollectResultType = 'CREATED' | 'NEEDS_CONFIRM' | 'OVERWRITTEN' | 'CHANGE_FLAGGED' | 'UNCHANGED'

export interface ErpCollectItemResult {
  sourceProductId: string
  productId: string | null
  result: ErpCollectResultType
  diff: ErpFieldDiff[]
  existingStatus?: string
}

export interface ErpCollectBatchResult {
  mode: 'SINGLE' | 'BATCH'
  total: number
  created: number
  overwritten: number
  changeFlagged: number
  needsConfirm: number
  unchanged: number
  items: ErpCollectItemResult[]
}

/** 采集条目（与 server collectItemSchema 对齐；由注入器 outbox 或手工构造） */
export interface ErpCollectItemInput {
  supplierId: string
  sourceProductId: string
  sourceUrl?: string
  sourceSku?: string
  titleOriginal?: string
  descriptionOriginal?: string
  costPrice?: number | null
  shippingCost?: number | null
  currency?: string
  stockQuantity?: number | null
  dimensions?: Record<string, unknown>
  weight?: number | null
  material?: string
  color?: string
  brand?: string
  category?: string
  variants?: unknown[]
  crawlConfig?: Record<string, unknown>
  images?: Array<{ imageType: string; sourceUrl: string; platform?: string; sortOrder?: number }>
}

export function fetchErpCapabilities(): Promise<ErpCapabilities> {
  return apiFetch<ErpCapabilities>('/api/erp/capabilities', { method: 'GET' })
}

export function fetchErpSuppliers(): Promise<ErpSupplierView[]> {
  return apiFetch<ErpSupplierView[]>('/api/erp/suppliers', { method: 'GET' })
}

export function fetchErpProducts(query: { status?: string; supplierId?: string; q?: string; page?: number; pageSize?: number } = {}): Promise<ErpProductListResult> {
  return apiFetch<ErpProductListResult>('/api/erp/products', {
    method: 'GET',
    query: { status: query.status, supplierId: query.supplierId, q: query.q, page: query.page, pageSize: query.pageSize }
  })
}

export function fetchErpProduct(id: string): Promise<ErpProductView> {
  return apiFetch<ErpProductView>(`/api/erp/products/${encodeURIComponent(id)}`, { method: 'GET' })
}

/** 采集入库（去重三态）；overwrite=true 时对 COLLECTED 态执行覆盖 */
export function collectErp(items: ErpCollectItemInput[], overwrite = false): Promise<ErpCollectBatchResult> {
  return apiFetch<ErpCollectBatchResult>('/api/erp/collect', {
    body: { items, overwrite, mode: items.length > 1 ? 'BATCH' : 'SINGLE' }
  })
}

export function fetchErpCrawlRules(supplierId: string): Promise<{ id: string; code: string; name: string; crawlRules: Record<string, unknown> }> {
  return apiFetch(`/api/erp/suppliers/${encodeURIComponent(supplierId)}/crawl-rules`, { method: 'GET' })
}

export function updateErpCrawlRules(supplierId: string, crawlRules: Record<string, unknown>): Promise<{ id: string; code: string; name: string; crawlRules: Record<string, unknown> }> {
  return apiFetch(`/api/erp/suppliers/${encodeURIComponent(supplierId)}/crawl-rules`, { method: 'PUT', body: { crawlRules } })
}

/** 触发原图下载队列（非阻塞入队），返回任务视图供轮询 */
export function triggerDownloadImages(productId: string): Promise<ErpDownloadJobView> {
  return apiFetch<ErpDownloadJobView>(`/api/erp/products/${encodeURIComponent(productId)}/download-images`, { method: 'POST', body: {} })
}

/** 标记已发布（READY→PUBLISHED，服务端状态机校验）：使巡盘 urgent 语义有真实写入方 */
export function markPublishedErpProduct(productId: string): Promise<ErpProductView> {
  return apiFetch<ErpProductView>(`/api/erp/products/${encodeURIComponent(productId)}/mark-published`, { method: 'POST', body: {} })
}

export function fetchDownloadJobs(query: { productId?: string; status?: string; pageSize?: number } = {}): Promise<ErpDownloadJobView[]> {
  return apiFetch<ErpDownloadJobView[]>('/api/erp/download-jobs', { method: 'GET', query })
}

export function fetchDownloadJob(jobId: string): Promise<ErpDownloadJobView> {
  return apiFetch<ErpDownloadJobView>(`/api/erp/download-jobs/${encodeURIComponent(jobId)}`, { method: 'GET' })
}

/** 产品状态中文标签与色板（采集池/产品库共用） */
export const ERP_STATUS_LABELS: Record<string, string> = {
  COLLECTED: '已采集',
  DOWNLOADED: '已入库',
  PROCESSING: '加工中',
  READY: '待发布',
  PUBLISHED: '已发布'
}

// —— P3 AI 加工 ——

export interface ErpAiImageCandidate {
  id: string
  sortOrder: number
  localPath: string
  url: string
}

export interface ErpAiImagesResult {
  productId: string
  model: string
  platform: string
  generated: number
  status: string
  candidates: ErpAiImageCandidate[]
}

export interface ErpAiTitleOption {
  style: string
  title: string
  charCount: number
  truncated: boolean
}

export interface ErpAiTitlesResult {
  productId: string
  platform: string
  charLimit: number
  options: ErpAiTitleOption[]
}

export interface ErpSelectImageResult {
  id: string
  isSelected: number
  productStatus: string
}

export interface ErpChooseTitleResult {
  listingId: string
  platform: string
  title: string
  charCount: number
  truncated: boolean
  productStatus: string
}

export interface ErpPlatformRuleView {
  id: string
  orgId: string
  platformCode: string
  titleCharLimit: number
  imageRules: Record<string, unknown>
  updatedAt: string
}

/** 可选目标平台（与 DEFAULT_PLATFORM_RULES 对齐） */
export const ERP_PLATFORMS: Array<{ code: string; label: string }> = [
  { code: 'ebay', label: 'eBay' },
  { code: 'amazon', label: 'Amazon' },
  { code: 'ozon', label: 'Ozon' }
]

/** 可选图生图模型（参照编辑优先，保持商品本体一致性；可换模型重试） */
export const ERP_IMAGE_MODELS: Array<{ id: string; label: string }> = [
  { id: 'qwen-image-edit-plus', label: '千问 Image Edit Plus（默认·保结构）' },
  { id: 'qwen-image-edit-max', label: '千问 Image Edit Max（高保真）' },
  { id: 'wan2.7-image', label: '万相 2.7（参照上限8张）' }
]

/** 图生图：以已入库原图为参考图生成待选图（isSelected=0，不替换原图） */
export function generateAiImages(
  productId: string,
  options: { platform: string; model?: string; count?: number; size?: '1K' | '2K' }
): Promise<ErpAiImagesResult> {
  return apiFetch<ErpAiImagesResult>(`/api/erp/products/${encodeURIComponent(productId)}/ai-images`, { method: 'POST', body: options })
}

/** 三风格标题生成（按平台字符上限强制校验，存 aiTitleOptions） */
export function generateAiTitles(productId: string, options: { platform: string }): Promise<ErpAiTitlesResult> {
  return apiFetch<ErpAiTitlesResult>(`/api/erp/products/${encodeURIComponent(productId)}/ai-titles`, { method: 'POST', body: options })
}

/** 待选图定稿/取消定稿（仅置 isSelected，绝不删除或替换原图） */
export function selectErpImage(productId: string, imageId: string, isSelected: boolean): Promise<ErpSelectImageResult> {
  return apiFetch<ErpSelectImageResult>(`/api/erp/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(imageId)}/select`, { method: 'POST', body: { isSelected } })
}

/** 标题人工选定（写入 listing.title，保护后续重算，推进 READY） */
export function chooseErpTitle(productId: string, platform: string, title: string): Promise<ErpChooseTitleResult> {
  return apiFetch<ErpChooseTitleResult>(`/api/erp/products/${encodeURIComponent(productId)}/choose-title`, { method: 'POST', body: { platform, title } })
}

export function fetchPlatformRules(): Promise<ErpPlatformRuleView[]> {
  return apiFetch<ErpPlatformRuleView[]>('/api/erp/platform-rules', { method: 'GET' })
}

export function updatePlatformRule(code: string, patch: { titleCharLimit?: number; imageRules?: Record<string, unknown> }): Promise<ErpPlatformRuleView> {
  return apiFetch<ErpPlatformRuleView>(`/api/erp/platform-rules/${encodeURIComponent(code)}`, { method: 'PUT', body: patch })
}

// —— P4 定价 + 多平台 listing + 导出 ——

export interface ErpPricingRuleView {
  id: string
  platformCode: string
  category: string
  markupRate: number
  commissionRate: number
  fixedFee: number
  currency: string
  updatedAt: string
}

export interface ErpListingView {
  id: string
  productId: string
  platformCode: string
  title: string
  aiTitleOptions: unknown
  price: number | null
  priceManual: number
  category: string
  description: string
  status: string
  updatedAt: string
}

export interface ErpPriceBreakdown {
  landedCost: number
  target: number
  commission: number
  fixedFee: number
  price: number
  currency: string
  exchangeRate: number
  markupRate: number
  commissionRate: number
}

export interface ErpRecalcResult {
  listingId: string
  platformCode: string
  protected: boolean
  price: number | null
  breakdown: ErpPriceBreakdown | null
}

export interface ErpExportBundle {
  productId: string
  exportedAt: string
  product: Record<string, unknown>
  images: ErpProductImageView[]
  listings: Array<ErpListingView & { breakdown: ErpPriceBreakdown | null }>
  completeness: {
    hasSelectedImage: boolean
    imageCount: number
    platforms: string[]
    allHaveTitle: boolean
    allHavePrice: boolean
    noExternalRefs: boolean
    complete: boolean
  }
}

export function fetchPricingRules(): Promise<ErpPricingRuleView[]> {
  return apiFetch<ErpPricingRuleView[]>('/api/erp/pricing-rules', { method: 'GET' })
}

export function upsertPricingRule(patch: { platformCode: string; category?: string; markupRate?: number; commissionRate?: number; fixedFee?: number; currency?: string }): Promise<ErpPricingRuleView> {
  return apiFetch<ErpPricingRuleView>('/api/erp/pricing-rules', { method: 'POST', body: patch })
}

export function fetchProductListings(productId: string): Promise<ErpListingView[]> {
  return apiFetch<ErpListingView[]>(`/api/erp/products/${encodeURIComponent(productId)}/listings`, { method: 'GET' })
}

export function generateProductListings(productId: string, platforms: string[]): Promise<{ productId: string; listings: ErpListingView[] }> {
  return apiFetch(`/api/erp/products/${encodeURIComponent(productId)}/listings`, { method: 'POST', body: { platforms } })
}

export function updateErpListing(listingId: string, patch: { title?: string; price?: number; category?: string; description?: string; status?: string }): Promise<ErpListingView> {
  return apiFetch<ErpListingView>(`/api/erp/listings/${encodeURIComponent(listingId)}`, { method: 'PUT', body: patch })
}

export function recalcErpListingPrice(listingId: string, force = false): Promise<ErpRecalcResult> {
  return apiFetch<ErpRecalcResult>(`/api/erp/listings/${encodeURIComponent(listingId)}/price-recalc`, { method: 'POST', body: { force } })
}

export function exportErpBundle(productId: string): Promise<ErpExportBundle> {
  return apiFetch<ErpExportBundle>(`/api/erp/products/${encodeURIComponent(productId)}/export`, { method: 'GET' })
}

// ---------------------------------------------------------------- P5 巡盘 + 变更确认 + 通知中心

export interface ErpChangeFieldDiff {
  id: string
  field: string
  oldValue: string
  newValue: string
  createdAt: string
}

export interface ErpChangeItem {
  productId: string
  titleOriginal: string
  status: string
  /** status ≥ PUBLISHED，UI 标红优先处理 */
  published: boolean
  lastCrawledAt: string | null
  changes: ErpChangeFieldDiff[]
}

export interface ErpChangeListResult {
  items: ErpChangeItem[]
  total: number
  page: number
  pageSize: number
}

export interface ErpNotificationView {
  id: string
  kind: string
  title: string
  body: Record<string, unknown>
  productId: string | null
  urgent: boolean
  read: boolean
  readAt: string | null
  createdAt: string
}

export interface ErpNotificationListResult {
  items: ErpNotificationView[]
  total: number
  unread: number
  page: number
  pageSize: number
}

export interface ErpMorningSummary {
  orgId: string
  windowStart: string
  generatedAt: string
  totalChanges: number
  urgentChanges: number
  pendingProducts: number
  byField: Record<string, number>
  notificationId: string
}

export interface ErpResolveResult {
  productId: string
  action: 'APPLY' | 'DISMISS'
  applied: string[]
  status: string
  changeFlag: number
}

export interface ErpPatrolRunResult {
  orgId: string
  scanned: number
  serverChannel: number
  clientChannel: number
  changed: number
  urgent: number
  plan: { total: number; batchSize: number; concurrency: number; batchCount: number; maxInFlight: number }
  pool: { processed: number; failed: number; peakConcurrency: number; gapsMs: number[] }
}

export function fetchErpChanges(query: { page?: number; pageSize?: number } = {}): Promise<ErpChangeListResult> {
  const params = new URLSearchParams()
  if (query.page) params.set('page', String(query.page))
  if (query.pageSize) params.set('pageSize', String(query.pageSize))
  const suffix = params.toString() ? `?${params.toString()}` : ''
  return apiFetch<ErpChangeListResult>(`/api/erp/changes${suffix}`, { method: 'GET' })
}

export function resolveErpChange(productId: string, action: 'APPLY' | 'DISMISS'): Promise<ErpResolveResult> {
  return apiFetch<ErpResolveResult>(`/api/erp/changes/${encodeURIComponent(productId)}/resolve`, { method: 'POST', body: { action } })
}

export function fetchErpNotifications(query: { unreadOnly?: boolean; kind?: string; page?: number; pageSize?: number } = {}): Promise<ErpNotificationListResult> {
  const params = new URLSearchParams()
  if (query.unreadOnly) params.set('unreadOnly', 'true')
  if (query.kind) params.set('kind', query.kind)
  if (query.page) params.set('page', String(query.page))
  if (query.pageSize) params.set('pageSize', String(query.pageSize))
  const suffix = params.toString() ? `?${params.toString()}` : ''
  return apiFetch<ErpNotificationListResult>(`/api/erp/notifications${suffix}`, { method: 'GET' })
}

export function markErpNotificationRead(id: string): Promise<ErpNotificationView> {
  return apiFetch<ErpNotificationView>(`/api/erp/notifications/${encodeURIComponent(id)}/read`, { method: 'POST', body: {} })
}

export function markAllErpNotificationsRead(): Promise<{ updated: number }> {
  return apiFetch<{ updated: number }>('/api/erp/notifications/read-all', { method: 'POST', body: {} })
}

export function generateErpMorningSummary(): Promise<ErpMorningSummary> {
  return apiFetch<ErpMorningSummary>('/api/erp/notifications/summary', { method: 'POST', body: {} })
}

export function runErpPatrol(body: { supplierId?: string; batchSize?: number; concurrency?: number; delayMs?: number } = {}): Promise<ErpPatrolRunResult> {
  return apiFetch<ErpPatrolRunResult>('/api/erp/patrol/run', { method: 'POST', body })
}
