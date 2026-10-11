export interface WarehouseQuickFlags {
  notCopied: boolean
  notDownloaded: boolean
}

// 正式入库页头快捷筛选：未抄货盘 / 未下图文，两开关独立可叠加（AND）
export function applyWarehouseQuickFilter<T extends { id: string }>(
  items: T[],
  copiedIds: readonly string[],
  statusOf: (item: T) => string | undefined,
  flags: WarehouseQuickFlags
): T[] {
  if (!flags.notCopied && !flags.notDownloaded) return items
  return items.filter(item =>
    (!flags.notCopied || !copiedIds.includes(item.id)) &&
    (!flags.notDownloaded || statusOf(item) !== 'DOWNLOADED'))
}

export function warehouseQuickCounts<T extends { id: string }>(
  items: T[],
  copiedIds: readonly string[],
  statusOf: (item: T) => string | undefined
): { notCopied: number; notDownloaded: number } {
  let notCopied = 0
  let notDownloaded = 0
  for (const item of items) {
    if (!copiedIds.includes(item.id)) notCopied += 1
    if (statusOf(item) !== 'DOWNLOADED') notDownloaded += 1
  }
  return { notCopied, notDownloaded }
}
