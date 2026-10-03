/** 图上评分徽标的回退得分：选品快照优先（入库后仍与优选阶段同口径），其次候选活记录得分。 */
export function badgeFallbackScore(selectionScore?: number | null, joinedScore?: number | null): number | undefined {
  if (typeof selectionScore === 'number' && Number.isFinite(selectionScore)) return selectionScore
  if (typeof joinedScore === 'number' && Number.isFinite(joinedScore)) return joinedScore
  return undefined
}
