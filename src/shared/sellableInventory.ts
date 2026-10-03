/** 源页「可售库存」文本匹配：标签在前（可售库存 100）与数字在前（60 可售库存）双形态；0 是合法值。 */
export function matchSellableInventoryText(text: string): { stockText: string; sellableInventory: number } | null {
  const labelFirst = /(?:可售库存|Available\s*Stock|库存数量|库存|Stock)\s*[:：]?\s*([\d,]+)/i.exec(text)
  const numberFirst = /([\d,]+)\s*(?:可售库存|Available\s*Stock)/i.exec(text)
  const raw = labelFirst?.[1] ?? numberFirst?.[1]
  if (raw === undefined) return null
  const value = Number(raw.replace(/,/g, ''))
  if (!Number.isFinite(value)) return null
  return { stockText: `可售库存 ${raw}`, sellableInventory: value }
}
