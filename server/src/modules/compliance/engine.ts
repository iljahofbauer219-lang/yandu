import type { ComplianceCheckRequest } from './types.js'

// 与客户端 src/shared/complianceFingerprint.ts 完全一致（保证指纹跨端一致）
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

const complianceRecallStopWords = new Set(['about', 'after', 'against', 'because', 'child', 'children', 'consumer', 'death', 'from', 'hazard', 'injury', 'mandatory', 'product', 'products', 'recall', 'recalled', 'risk', 'safety', 'sold', 'standard', 'this', 'that', 'their', 'these', 'those', 'with'])

export function complianceRecallMatches(productText: string, recallText: string) {
  const tokens = [...new Set(recallText.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter(token => token.length >= 4 && !complianceRecallStopWords.has(token)))]
  const normalized = productText.toLowerCase()
  const matched = tokens.filter(token => normalized.includes(token))
  return matched.length >= 2 && matched.some(token => token.length >= 6)
}

const EU_COUNTRIES = ['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'PL', 'SE', 'IE', 'AT', 'DK', 'FI', 'PT', 'CZ', 'SK', 'HU', 'RO', 'BG', 'HR', 'SI', 'LT', 'LV', 'EE', 'LU', 'MT', 'CY', 'GR']

export function complianceScopeMatches(
  rule: { platform: string; marketplaceSite: string; country: string; category: string },
  request: Pick<ComplianceCheckRequest, 'platform' | 'marketplaceSite' | 'country' | 'categoryId' | 'categoryName'>
) {
  return (rule.platform === 'ALL' || rule.platform === request.platform)
    && (rule.marketplaceSite === 'ALL' || rule.marketplaceSite === request.marketplaceSite)
    && (rule.country === 'ALL' || rule.country === request.country || (rule.country === 'EU' && EU_COUNTRIES.includes(request.country)))
    && (rule.category === 'ALL' || rule.category === request.categoryId || rule.category === request.categoryName)
}

export function requiredRecallSourceId(country: string) {
  const euCountries = ['EU', ...EU_COUNTRIES]
  if (country === 'US') return 'source-cpsc'
  if (country === 'GB' || country === 'UK') return 'source-uk-opss'
  if (euCountries.includes(country)) return 'source-eu-safety-gate'
  return ''
}

/** 规则集版本签名：与 AppDatabase.complianceRuleSetVersion 同一 FNV-1a 算法 */
export function fnv1aHex(signature: string) {
  let hash = 2166136261
  for (let index = 0; index < signature.length; index += 1) {
    hash ^= signature.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
