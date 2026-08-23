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
  provider: 'ragflow' | 'bailian' | 'deepseek'
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
  // - 仅对 RAGFlow 智能体链路生效（amazon-skills / ragflow-agent / listing-agent）；
  //   直连模型（百炼/DeepSeek）暂不注入，保守起见不扩展
  useSampleLibrary?: boolean
}
export interface AiEmployeePickResult { ok: boolean; attachments: AiEmployeeAttachment[]; message?: string }
