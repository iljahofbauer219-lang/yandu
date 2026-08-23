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
}

export interface AdvisorIncomingImage {
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

export type AdvisorConnectionMode = 'app-server' | 'harness' | 'unavailable' | 'unknown'

/**
 * Advisor 连接状态。供 UI 顶栏 chip 与 composer 启用判断。
 * - app-server: Codex app-server 模式 (默认，stdio RPC)
 * - harness: harness gateway 已就绪，可选执行器
 * - unavailable: harness gateway 不可用
 * - unknown: 未尝试连接
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
  selectProject(): Promise<string | null>
  revealProject(projectPath: string): Promise<boolean>
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
