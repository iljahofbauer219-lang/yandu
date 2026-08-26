export type AiEmployeeAttachmentKind = 'image' | 'doc'
export interface AiEmployeeAttachment {
  id: string
  name: string
  kind: AiEmployeeAttachmentKind
  mimeType: string
  size: number
  dataUrl?: string   // 压缩后图片 base64 data URL
  text?: string      // 文档提取文本（已截断）
  truncated?: boolean
}
export interface AiEmployeeChatModelProfile {
  id: string
  name: string
  hint: string
  // provider 语义：
  //   - maxkb：MaxKB v2.10.5-lts 智体（5 application 全部走 maxkbChat，优先路径）
  //   - ragflow：RAGFlow 智能体（30 天兼容回退，2026-09-23 停服）
  //   - bailian / deepseek：直连 OpenAI 兼容 chat/completions（用于视觉转写 / 长文回退）
  provider: 'maxkb' | 'ragflow' | 'bailian' | 'deepseek'
  supportsVision: boolean
  available: boolean
}
export interface AiEmployeeAskRequest {
  agentId?: string
  modelId?: string
  query: string
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  attachments?: AiEmployeeAttachment[]
  // I.4 阶段新增：本次问询是否启用「报告样例库」KB 引用提示
  // - true：主进程 chat() 入口在 user content 末尾追加 SAMPLE_LIBRARY_KB_REFERENCE_PROMPT
  // - false/缺省：不追加（默认行为）
  // - 优先对 MaxKB 智能体链路生效（amazon-skills-agent / maxkb-sourcing / maxkb-listing / maxkb-guardian）；
  //   RAGFlow 30 天回退链路（ragflow-agent / listing-agent）也注入但即将停服；直连模型（百炼/DeepSeek）不注入
  useSampleLibrary?: boolean
}
export interface AiEmployeePickResult { ok: boolean; attachments: AiEmployeeAttachment[]; message?: string }
