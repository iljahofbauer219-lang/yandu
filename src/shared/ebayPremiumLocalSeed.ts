import type { EbayLocalProductMedia, EbayLocalProductSnapshotInput, EbayOptimizationDraft } from './contracts'

export type EbayPremiumLocalSeed = Omit<EbayLocalProductSnapshotInput, 'completeness' | 'missingFields' | 'contentHash'>

// 优品草稿重建本地行：媒体只挂 remoteUrl（localPath 留空标 FAILED），落盘交给进入发布后的 media-download。
export function buildEbayPremiumLocalSeed(draft: EbayOptimizationDraft, marketplaceId: string, capturedAt: string): EbayPremiumLocalSeed {
  const imageUrls = (draft.imageUrls || []).filter(Boolean).slice(0, 24)
  const title = draft.selectedTitle || draft.listing.title
  const price = draft.salePrice || draft.listing.price || '0'
  const currency = draft.saleCurrency || draft.listing.currency || 'USD'
  const listing = {
    ...draft.listing,
    marketplaceId,
    title,
    price,
    currency,
    imageUrl: imageUrls[0] || draft.listing.imageUrl || '',
    imageUrls,
    updatedAt: capturedAt
  }
  const details = {
    url: draft.listing.viewUrl || '',
    itemSpecifics: (draft.itemSpecifics || []).map(item => ({ name: item.name, value: item.value })),
    condition: '',
    imageUrls,
    title,
    descriptionText: draft.description || '',
    price,
    currency
  }
  const media: EbayLocalProductMedia[] = imageUrls.map((url, index) => ({
    id: `${draft.id}-m${index}`,
    mediaType: 'IMAGE' as const,
    sortOrder: index,
    remoteUrl: url,
    localPath: '',
    mimeType: 'image/jpeg',
    width: 0,
    height: 0,
    fileSize: 0,
    sha256: '',
    downloadStatus: 'FAILED' as const
  }))
  return { listing, details, media, capturedAt }
}