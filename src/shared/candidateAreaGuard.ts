// 进入采集候选页的区域自愈：供应仓且跨境方无数据时，纠正停留在跨境侧的空态（默认 area=MARKET 的历史残留）
export function shouldForceSupplyAreaOnEnter(page: string, warehouseKind: string, candidateArea: string, marketCandidateCount: number): boolean {
  return page === 'ozon' && warehouseKind === 'SUPPLY' && candidateArea === 'MARKET' && marketCandidateCount === 0
}
