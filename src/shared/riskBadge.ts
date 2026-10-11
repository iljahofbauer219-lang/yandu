export interface RiskBadge {
  text: string
  title: string
}

// 优选卡风险徽标可读化：直接展示风险文案，多条时首条+计数，全量放悬停标题
export function riskBadge(flags: string[]): RiskBadge {
  if (!flags.length) return { text: '暂无风险', title: '' }
  const text = flags.length === 1 ? flags[0] : `${flags[0]} 等${flags.length}项`
  return { text, title: flags.join('、') }
}
