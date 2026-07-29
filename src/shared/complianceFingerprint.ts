import type { ComplianceCheckRequest } from './contracts'

function normalizedText(value: string | undefined) {
  return (value || '').replace(/\s+/g, ' ').trim()
}

export function complianceCheckFingerprint(request: ComplianceCheckRequest) {
  const payload = JSON.stringify({
    policyVersion: request.platform === 'EBAY' ? 'EBAY-DETAIL-PAGE-2026.07.21' : 'COMPLIANCE-V1',
    productId: request.productId,
    platform: request.platform,
    marketplaceSite: request.marketplaceSite,
    country: request.country,
    categoryId: normalizedText(request.categoryId),
    categoryName: normalizedText(request.categoryName),
    title: normalizedText(request.title),
    description: normalizedText(request.description),
    imageUrl: normalizedText(request.imageUrl),
    itemSpecifics: [...(request.itemSpecifics || [])]
      .map(item => ({ name: normalizedText(item.name), value: normalizedText(item.value) }))
      .sort((left, right) => `${left.name}\u0000${left.value}`.localeCompare(`${right.name}\u0000${right.value}`))
  })
  let hash = 2166136261
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `v2-${(hash >>> 0).toString(16).padStart(8, '0')}`
}
