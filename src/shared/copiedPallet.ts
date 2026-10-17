// 已抄送货盘状态派生：入库处理队列中 WAREHOUSE 来源行即代表该正式入库商品已抄送；
// 驳回（REJECTED）行保留在队列但抄送关系已解除，商品应可重新抄送
export function copiedWarehouseIds(items: Array<{ origin: string; warehouseProductId: string | null; status?: string }>): string[] {
  const ids = new Set<string>()
  for (const item of items) {
    if (item.origin === 'WAREHOUSE' && item.warehouseProductId && item.status !== 'REJECTED') ids.add(item.warehouseProductId)
  }
  return [...ids]
}
