// eBay 域工具函数：从 AppDatabase.ts 文件头（原 7-50 行）原样移植

import { createHash } from 'node:crypto'
import type { EbayImageVisualInspectionReport, EbayLocalProductMedia, EbayLocalProductSnapshotInput } from './types.js'

export function isUsableCandidateImage(value: string) {
  return /^https?:\/\//i.test(value) && !/(?:product_base|placeholder|default[-_]?image|loading|lazyload|blank|transparent|no[-_]?image)/i.test(value)
}

export function normalizeEbayImage(value: string) {
  return value.replace(/\/s-l\d+(?=\.[a-z0-9]+(?:\?|$))/i, '/s-l1600')
}

export function uniqueEbayImages(values: string[]) {
  const seen = new Set<string>()
  return values.map(normalizeEbayImage).filter(value => {
    if (!value) return false
    const key = value.match(/\/images\/g\/([^/]+)/i)?.[1] || value
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function ebayCountryForMarketplace(marketplaceId: string) {
  const suffix = marketplaceId.replace(/^EBAY_/, '').toUpperCase()
  const countries: Record<string, string> = { US: 'US', GB: 'GB', DE: 'DE', FR: 'FR', IT: 'IT', ES: 'ES', AU: 'AU', CA: 'CA', AT: 'AT', BE: 'BE', CH: 'CH', IE: 'IE', NL: 'NL', PL: 'PL' }
  return countries[suffix] || 'US'
}

/** 站点默认币种：移植自 main.ts ebayMarketplaceCurrency（本地产品编辑完整度计算用） */
export function ebayMarketplaceCurrency(marketplaceId: string) {
  const code = marketplaceId.trim().toUpperCase()
  if (code === 'EBAY_GB') return 'GBP'
  if (['EBAY_DE', 'EBAY_FR', 'EBAY_IT', 'EBAY_ES', 'EBAY_AT', 'EBAY_IE', 'EBAY_NL', 'EBAY_BE'].includes(code)) return 'EUR'
  if (code === 'EBAY_CA') return 'CAD'
  if (code === 'EBAY_AU') return 'AUD'
  return 'USD'
}

/** eBay 支持的图片 MIME：移植自 main.ts ebayImageFormats（本地产品编辑校验用） */
const EBAY_IMAGE_MIME_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/tiff', 'image/x-tiff',
  'image/bmp', 'image/x-ms-bmp', 'image/webp', 'image/heic'
])

export function ebayImageFormatSupported(mimeType: string) {
  return EBAY_IMAGE_MIME_TYPES.has(mimeType.toLowerCase().split(';')[0] ?? '')
}

/** 快照完整度/缺失字段/内容哈希：移植自 main.ts completeEbayLocalSnapshot（本地产品编辑落新快照版本用） */
export function completeEbayLocalSnapshot(input: Omit<EbayLocalProductSnapshotInput, 'completeness' | 'missingFields' | 'contentHash'>): EbayLocalProductSnapshotInput {
  const { listing, details, media } = input
  const expectedCurrency = ebayMarketplaceCurrency(listing.marketplaceId)
  const trustedPrice = (details.currency || '').trim().toUpperCase() === expectedCurrency
    ? details.price
    : (listing.currency || '').trim().toUpperCase() === expectedCurrency ? listing.price : ''
  const checks = [
    { label: '图片', ok: media.some((item: EbayLocalProductMedia) => item.downloadStatus === 'DOWNLOADED' && item.localPath), weight: 25 },
    { label: '标题', ok: Boolean(details.title || listing.title), weight: 25 },
    { label: '描述', ok: Boolean(details.descriptionText || details.descriptionHtml), weight: 30 },
    { label: `${expectedCurrency} 原价`, ok: Boolean(trustedPrice), weight: 20 }
  ]
  const completeness = checks.reduce((total, item) => total + (item.ok ? item.weight : 0), 0)
  const missingFields = checks.filter(item => !item.ok).map(item => item.label)
  const contentHash = createHash('sha256').update(JSON.stringify({
    listing,
    details,
    media: media.map((item: EbayLocalProductMedia) => ({ remoteUrl: item.remoteUrl, localPath: item.localPath, fileSize: item.fileSize, sha256: item.sha256, downloadStatus: item.downloadStatus }))
  })).digest('hex')
  return { ...input, completeness, missingFields, contentHash }
}

export function rebuildEbayImageVisualReport(report: EbayImageVisualInspectionReport): EbayImageVisualInspectionReport {
  const images = report.images.map(image => {
    const status: EbayImageVisualInspectionReport['images'][number]['status'] = image.rules.some(rule => rule.status === 'FAILED') ? 'FAILED' : image.rules.some(rule => rule.status === 'REVIEW') ? 'REVIEW' : 'PASSED'
    return { ...image, status, summary: status === 'PASSED' ? '四项视觉规则均已通过。' : status === 'FAILED' ? '存在不符合 eBay 图片要求的内容。' : '存在需要人工确认的低置信度结论。' }
  })
  const passed = images.filter(image => image.status === 'PASSED').length
  const failed = images.filter(image => image.status === 'FAILED').length
  const review = images.filter(image => image.status === 'REVIEW').length
  const status = failed ? 'FAILED' : review ? 'REVIEW' : 'PASSED'
  const message = status === 'PASSED' ? '图片内容符合当前四项 eBay 视觉规则。' : status === 'FAILED' ? `${failed} 张图片存在必须修改项。` : `${review} 张图片需要人工复核。`
  return { ...report, images, status, passed, failed, review, message }
}
