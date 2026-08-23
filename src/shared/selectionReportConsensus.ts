/** 多模型修正报告的确定性评审；不评价模型名，只按系统质量门禁选择唯一候选。 */
export interface SelectionReportCandidate {
  modelId: string
  content: string
  issues: string[]
}

function isPathOnlyResponse(content: string): boolean {
  const value = String(content || '').trim()
  return /^(?:完整(?:重写后)?的?\s*(?:Markdown\s*)?报告已输出至\s*)?\/?tmp\/[\w.-]+\.md$/i.test(value)
    || /^\/?tmp\/[\w.-]+\.md$/i.test(value)
}

/**
 * 先排除空回复和只给本地路径的伪交付，再按问题数、发起模型优先级和模型ID稳定排序。
 * qualityIssues 由调用方基于同一锁定事实包计算，模型本身不能声明“通过”。
 */
export function rankSelectionReportCandidates(candidates: SelectionReportCandidate[], modelPriority: readonly string[]): SelectionReportCandidate[] {
  const priority = new Map(modelPriority.map((modelId, index) => [modelId, index]))
  return candidates
    .filter(candidate => candidate.content.trim().length >= 120 && !isPathOnlyResponse(candidate.content))
    .sort((left, right) => {
      const issues = left.issues.length - right.issues.length
      if (issues) return issues
      const preferred = (priority.get(left.modelId) ?? Number.MAX_SAFE_INTEGER) - (priority.get(right.modelId) ?? Number.MAX_SAFE_INTEGER)
      if (preferred) return preferred
      return left.modelId.localeCompare(right.modelId)
    })
}

/** 供并行修正模型使用的共同评审约束，确保每一候选都基于同一事实包。 */
export function selectionReportConsensusInstruction(): string {
  return '多模型评审规则：所有候选只可依据同一份结构化报告事实包；系统将按质量门禁选择唯一候选。不要输出本地路径、修改说明或局部片段；未知项必须保留“待验证”。'
}
