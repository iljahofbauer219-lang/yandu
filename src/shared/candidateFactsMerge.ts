const CATEGORY_RANK: Record<string, number> = { EXACT: 2, PARTIAL: 1, NEEDS_REVIEW: 0 }

function categoryRank(value: unknown): number {
  if (!value || typeof value !== 'object') return -1
  const status = String((value as { status?: unknown }).status ?? '')
  return CATEGORY_RANK[status] ?? -1
}

/**
 * 重读补采的合并策略：空值不覆盖既有值；sourceCategory 只允许同级或升级覆盖，
 * 防止重读时面包屑缺载把 EXACT 类目降级成「类目待核实」。
 */
export function mergeCandidateFacts(oldFacts: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...oldFacts }
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined || value === null || value === '') continue
    if (key === 'sourceCategory' && categoryRank(value) < categoryRank(merged.sourceCategory)) continue
    merged[key] = value
  }
  return merged
}
