// 图文描述只取源站「图文描述」版块原文；版块缺失留空，禁止回落整页正文（会混入导航/菜单垃圾文本）。
// 本函数经 toString 嵌入采集页脚本执行，必须自包含（不得引用模块级变量）。
export function pickSupplyDescriptionText(descRootText: string | null): string {
  if (descRootText === null) return ''
  return descRootText.trim().slice(0, 20000)
}
