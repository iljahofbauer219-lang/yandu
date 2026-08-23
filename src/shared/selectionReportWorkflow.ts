import { SELECTION_REPORT_TEMPLATE, type SelectionReportSectionContract } from './selectionReportTemplate'
import { buildSampleLibraryPromptSection } from './sampleLibraryPrompt'

/** 两个智能体在同一报告任务中的固定职责；职责以事实包交接，不以自由文本互相覆盖。 */
export type SelectionReportAgentRole = 'researcher' | 'analyst'

export const SELECTION_REPORT_AGENT_ROLES: Record<SelectionReportAgentRole, {
  name: string
  responsibility: string
  forbidden: string
}> = {
  researcher: {
    name: '选品调研员',
    responsibility: '锁定1688商品身份；提取可追溯供货事实；按“同一核心用途 + 同一形态 + 同一对象”收集并分类 Amazon DIRECT/ADJACENT/NON_COMPARABLE 样本；交付证据、来源、日期和待补数清单。',
    forbidden: '不得把未抓取销量、销售额、BSR、趋势、合规、专利或成本写成事实；不得用ADJACENT替代DIRECT。'
  },
  analyst: {
    name: '选品分析师（Amazon-Skills）',
    responsibility: '仅依据调研员锁定的事实包，完成竞品比较、价格带、快速市场利润与全成本利润、风险门禁、入市结论和30天验证计划。',
    forbidden: '不得修改商品身份、目标平台、证据等级或样本分类；不得用模型常识填补未知字段；不得自行删改固定章节和表格。'
  }
}

export function selectionReportTemplateInstruction(sections: readonly SelectionReportSectionContract[] = SELECTION_REPORT_TEMPLATE): string {
  return sections.map(section => [
    `## ${section.title}`,
    ...section.tables.map(table => `- ${table.title}：${table.columns.join('｜')}`)
  ].join('\n')).join('\n\n')
}

/**
 * 组合任务的唯一提示词外壳。业务事实仍由调用方传入，避免在共享层擅自推断。
 * 返回内容要求为 Markdown，后续阶段将由确定性渲染器转换为 DOCX 原生黑边表格。
 */
export function buildSelectionReportCollaborationPrompt(factPackage: string, targetPlatform: string): string {
  return [
    '【选品调研员 + 选品分析师（Amazon-Skills）协同任务】',
    `目标平台（系统锁定）：${targetPlatform}。报告标题和元数据必须只使用该平台。`,
    `调研员职责：${SELECTION_REPORT_AGENT_ROLES.researcher.responsibility}`,
    `调研员禁止：${SELECTION_REPORT_AGENT_ROLES.researcher.forbidden}`,
    `分析师职责：${SELECTION_REPORT_AGENT_ROLES.analyst.responsibility}`,
    `分析师禁止：${SELECTION_REPORT_AGENT_ROLES.analyst.forbidden}`,
    '交接规则：只使用下方“系统事实包”；事实包未提供的字段填“待验证”，并在对应表格保留该行。',
    '输出规则：直接输出完整 Markdown 正文；严格保留以下六大部分、顺序、11张表及列名。不得只返回修改说明、/tmp路径或摘要。',
    selectionReportTemplateInstruction(),
    'Word导出规则：Markdown表格必须可转换为原生表格，表格边框为黑色。',
    buildSampleLibraryPromptSection(),
    '【系统事实包】',
    factPackage
  ].join('\n\n')
}
