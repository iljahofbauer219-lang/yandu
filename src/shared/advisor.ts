export type AdvisorPermissionMode = 'ask' | 'agent' | 'fullAccess'

export interface AdvisorModelProfile {
  id: string
  name: string
  providerId: string
  supportsTools: boolean
  supportsVision: boolean
}

export interface AdvisorChatRequest {
  requestId: string
  conversationId?: string
  model: string
  permissionMode: AdvisorPermissionMode
  message: string
  workspacePath: string
  edit?: {
    sourceBranchId: string
    replacesRequestId: string
    beforeTurnId: string
  }
}

export interface AdvisorAttachment {
  id: string
  sessionId: string
  fileName: string
  mimeType: string
  size: number
  filePath: string
  thumbnailPath: string
  previewUrl: string
  available?: boolean
  /**
   * 附件类型。重构后区分 image（需要交给 vision-sidecar）与 document（需要抽取纯文本后拼到 message）。
   * 旧 manifest 中没有该字段，读取时默认 image。
   */
  kind?: 'image' | 'document'
}

export interface AdvisorIncomingImage {
  name: string
  mimeType: string
  bytes: Uint8Array
}

export interface AdvisorIncomingDocument {
  name: string
  mimeType: string
  bytes: Uint8Array
}

export interface AdvisorVisionOcrBlock {
  id: string
  text: string
  confidence: number
  x: number
  y: number
  width: number
  height: number
}

export interface AdvisorVisionAnnotation {
  color: 'red' | 'green'
  shape: 'rectangle'
  confidence: number
  x: number
  y: number
  width: number
  height: number
  regionText: string[]
  position: string
  enclosedBlockIds: string[]
  enclosedText: string[]
  nearbyText: string[]
}

export interface AdvisorVisionAnalysis {
  schemaVersion: 2
  adapter: string
  success: boolean
  imageId: string
  fileName: string
  image: { width: number; height: number }
  ocr: { fullText: string; blocks: AdvisorVisionOcrBlock[] }
  annotations: AdvisorVisionAnnotation[]
  productAttributes: Record<string, string>
  logoCandidates: string[]
  risks: string[]
  suggestions: string[]
  error?: string
}

export type AdvisorApprovalDecision = 'accept' | 'decline' | 'acceptForSession'

export interface AdvisorApprovalPrompt {
  id: string
  requestId: string
  kind: 'command' | 'file'
  title: string
  detail?: string
  diff?: string
  cwd?: string
  reason?: string
  allowRemember?: boolean
}

export type AdvisorTaskStatus = 'running' | 'waitingApproval' | 'completed' | 'failed' | 'stopped'

export type AdvisorActivityKind = 'plan' | 'command' | 'file' | 'vision' | 'status' | 'warning' | 'error'

export interface AdvisorActivity {
  kind: AdvisorActivityKind
  title: string
  detail?: string
  state?: string
}

export type AdvisorChatEvent =
  | { requestId: string; type: 'delta'; text: string }
  | { requestId: string; type: 'turnStarted'; turnId: string }
  | { requestId: string; type: 'taskStatus'; status: AdvisorTaskStatus; label: string; detail?: string; pendingApprovalCount: number }
  | { requestId: string; type: 'activity'; activity: AdvisorActivity }
  | { requestId: string; type: 'approval'; approval: AdvisorApprovalPrompt }
  | { requestId: string; type: 'approvalResolved'; approvalId: string; decision: AdvisorApprovalDecision }
  | { requestId: string; type: 'done' | 'stopped' }
  | { requestId: string; type: 'error'; message: string }
  /**
   * 原对话上下文已丢失（Codex app-server 重启/被清理后 thread/resume 失败）。
   * 业务层已自动回退到 thread/start 创建新线程，UI 收到该事件后应展示一次性提示。
   * reason 包含原始错误信息，供调试。
   */
  | { requestId: string; type: 'threadReset'; reason: string }

export interface AdvisorStoredTaskEvent {
  at: string
  type: string
  payload: unknown
}

export interface AdvisorStoredTask {
  id: string
  title: string
  message: string
  model: string
  permissionMode?: AdvisorPermissionMode
  codexThreadId?: string
  workspacePath: string
  createdAt: string
  updatedAt: string
  completedAt?: string
  durationMs?: number
  status: AdvisorTaskStatus
  pendingApprovalCount?: number
  failureReason?: string
  usage?: unknown
  activeBranchId?: string
  branches?: Array<{
    id: string
    parentBranchId?: string
    forkRequestId?: string
    replacesRequestId?: string
    threadId?: string
    createdAt: string
  }>
  events: AdvisorStoredTaskEvent[]
}

/**
 * Advisor 连接模式。
 * - app-server : Codex app-server 模式 (默认，stdio RPC)
 * - harness    : harness gateway 已就绪，可选执行器
 * - signed-out : 当前未配置 YANDU_USER_JWT,受限隔离执行器未启用(非故障状态)
 * - unavailable: harness gateway 探测失败(故障状态)
 * - unknown    : 未尝试连接
 */
export type AdvisorConnectionMode =
  | 'app-server'
  | 'harness'
  | 'signed-out'
  | 'unavailable'
  | 'unknown'

/**
 * Advisor 连接状态。供 UI 顶栏 chip 与 composer 启用判断。
 * - app-server : Codex app-server 模式 (默认，stdio RPC)
 * - harness    : harness gateway 已就绪，可选执行器
 * - signed-out : 受限隔离执行器未启用(用户未配置 JWT);业务流降级到本地 Codex,不展示错误横幅
 * - unavailable: harness gateway 不可用(网关或网络故障);业务流降级到本地 Codex
 * - unknown    : 未尝试连接
 */
export interface AdvisorConnectionStatus {
  connected: boolean
  mode: AdvisorConnectionMode
  label: string
  detail: string
}

export type AdvisorPersonality = 'pragmatic' | 'concise' | 'friendly' | 'professional'

export interface AdvisorPersonalizationSettings {
  personality: AdvisorPersonality
  customInstructions: string
  memoryEnabled: boolean
  toolMemoryEnabled: boolean
  memoryResetAt?: string
}

export interface AdvisorPersonalizationState {
  settings: AdvisorPersonalizationSettings
  memoryCount: number
}

export interface AdvisorDesktopApi {
  models(): Promise<AdvisorModelProfile[]>
  listSessions(): Promise<AdvisorStoredTask[]>
  getSession(taskId: string): Promise<AdvisorStoredTask | null>
  selectBranch(taskId: string, branchId: string): Promise<AdvisorStoredTask | null>
  renameSession(taskId: string, title: string): Promise<AdvisorStoredTask | null>
  deleteSession(taskId: string): Promise<boolean>
  exportSession(taskId: string): Promise<string | null>
  getDefaultProject(): Promise<string>
  getOrphanScratch(): Promise<string>
  selectProject(): Promise<string | null>
  revealProject(projectPath: string): Promise<boolean>
  /**
   * 下载 AI 输出文件：弹原生保存对话框，把 os.tmpdir() 下的临时文件复制到用户指定位置。
   * 后端仅允许 os.tmpdir() 之下的路径(防越权)，用户取消返回 canceled:true。
   */
  downloadOutputFile(filePath: string): Promise<{ ok: true; filePath: string; byteSize: number; fileName: string } | { canceled: true } | { ok: false; error: string }>
  getConnectionStatus(): Promise<AdvisorConnectionStatus>
  getPersonalization(): Promise<AdvisorPersonalizationState>
  savePersonalization(settings: Partial<AdvisorPersonalizationSettings>): Promise<AdvisorPersonalizationState>
  resetMemory(): Promise<AdvisorPersonalizationState>
  sendChat(request: AdvisorChatRequest): Promise<void>
  steerChat(requestId: string, message: string): Promise<boolean>
  stopChat(requestId: string): Promise<boolean>
  selectImages(sessionId: string): Promise<AdvisorAttachment[]>
  listImages(sessionId: string): Promise<AdvisorAttachment[]>
  cloneImages(sourceSessionId: string, targetSessionId: string): Promise<AdvisorAttachment[]>
  discardImages(sessionId: string): Promise<void>
  previewImage(sessionId: string, id: string): Promise<string>
  analyzeImages(sessionId: string): Promise<AdvisorVisionAnalysis[]>
  saveImages(sessionId: string, images: AdvisorIncomingImage[]): Promise<AdvisorAttachment[]>
  removeImage(sessionId: string, id: string): Promise<boolean>
  /**
   * 文档附件：通过系统文件选择器选 PDF/DOCX/DOC/RTF/TXT/MD，上传到当前 session。
   * listDocuments 返回的 records 中 `kind === 'document'`，不需要缩略图与预览。
   */
  selectDocuments(sessionId: string): Promise<AdvisorAttachment[]>
  listDocuments(sessionId: string): Promise<AdvisorAttachment[]>
  saveDocuments(sessionId: string, documents: AdvisorIncomingDocument[]): Promise<AdvisorAttachment[]>
  removeDocument(sessionId: string, id: string): Promise<boolean>
  /**
   * 统一附件选择入口：一次系统对话框多选，混选图片与文档。
   * 后端按扩展名分桶走 saveIncomingImages / saveIncomingDocuments，返回合并后的 records。
   * 与 selectImages / selectDocuments 并存（不破坏旧调用方）。
   */
  selectAttachments(sessionId: string): Promise<AdvisorAttachment[]>
  resolveApproval(approvalId: string, decision: AdvisorApprovalDecision): Promise<boolean>
  onChatEvent(listener: (event: AdvisorChatEvent) => void): () => void
  /** 主动建立 harness 网关会话 */
  connect(): Promise<AdvisorRemoteSession>
  /** 主动断开 harness 网关会话 */
  disconnect(): Promise<void>
}

export interface AdvisorRemoteSession {
  url: string
  message: string
  expiresAt: number
}
