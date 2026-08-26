/**
 * AI 员工执行步骤事件类型（共享给主进程与渲染端）。
 *
 * 5 类步骤：
 * - queued     : 任务入队/接收到 chat 请求
 * - analyzing  : 预处理（图述/KB 引用/路由）
 * - reasoning  : 主模型推理中
 * - finalizing : 后处理（materialize markdown / 修正模型）
 * - done       : 终态（success/error + durationMs）
 *
 * 流向：main process → IPC 'ai-employee:event' → renderer ExecutionPanel
 */

export type ExecutionStepType = 'queued' | 'analyzing' | 'reasoning' | 'finalizing' | 'done'

export interface ExecutionEvent {
  /** 关联的请求（同一请求共用一个 id） */
  requestId: string
  type: ExecutionStepType
  /** 步骤显示标签（可选） */
  label?: string
  /** 补充详情（可选） */
  detail?: string
  /** 仅 type='done' */
  status?: 'success' | 'error' | 'cancelled'
  durationMs?: number
  /** 服务端时间戳 */
  at: number
}

/** 事件回调签名：主进程在 chat 过程中调用此回调传递事件。 */
export type ExecutionEventHandler = (event: ExecutionEvent) => void
