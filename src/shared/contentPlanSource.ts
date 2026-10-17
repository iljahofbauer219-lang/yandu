export interface ContentPlanSource {
  sourceDescription: string
  itemSpecifics: Array<{ name: string; value: string }>
}

// 生成/重新生成内容方案时优先采纳最新一次下载图文的事实；最新为空则保留本地快照事实
export function resolveContentPlanSource(local: ContentPlanSource, latest: ContentPlanSource | null): { source: ContentPlanSource; refreshed: boolean } {
  if (!latest) return { source: local, refreshed: false }
  const sourceDescription = latest.sourceDescription.trim() ? latest.sourceDescription : local.sourceDescription
  const itemSpecifics = latest.itemSpecifics.length ? latest.itemSpecifics : local.itemSpecifics
  const refreshed = Boolean(latest.sourceDescription.trim()) || latest.itemSpecifics.length > 0
  return { source: { sourceDescription, itemSpecifics }, refreshed }
}
