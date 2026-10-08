export interface CandidateFactsGateInput {
  platformCode: string
  priceText: string
  shippingFeeText?: string
  sellableInventory?: number | null
  salesText: string
  exactCatalog: boolean
  gigaIndex?: number | null
}

const INVENTORY_LABEL_PATTERN = /^(?:Available\s*Stock|可售库存|库存)\s*[:：]?\s*/i

// 优选入链闸口：大健云仓候选卡红框五要素（价格/物流费/可售库存/原始类目/GIGA Index）须全部读取成功。
// 可售库存 0 是有效真值；仅空值/占位文案算读取失败。其他平台事实口径不同，不设闸口。
export function missingCandidateFacts(facts: CandidateFactsGateInput): string[] {
  if (facts.platformCode !== 'GIGACLOUD') return []
  const missing: string[] = []
  if (!facts.priceText.trim()) missing.push('价格')
  if (!(facts.shippingFeeText || '').trim()) missing.push('物流费')
  const inventory = facts.sellableInventory
  const inventoryText = inventory !== null && inventory !== undefined
    ? String(inventory)
    : facts.salesText.replace(INVENTORY_LABEL_PATTERN, '').trim()
  if (!inventoryText || inventoryText === '待补采') missing.push('可售库存')
  if (!facts.exactCatalog) missing.push('原始类目')
  if (facts.gigaIndex === null || facts.gigaIndex === undefined) missing.push('GIGA Index')
  return missing
}

export function inferCandidateGigaIndex(product: { gigaIndex?: number | null; platformCode?: string; supplierBadges?: string[]; score?: number }): number | null {
  return product.gigaIndex ?? (product.platformCode === 'GIGACLOUD' && (product.supplierBadges || []).includes('GIGA_INDEX') && (product.score || 0) > 0 ? (product.score as number) : null)
}
