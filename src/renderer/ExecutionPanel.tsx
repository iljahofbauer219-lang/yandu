/**
 * ExecutionPanel — 执行步骤面板
 *
 * 行为：
 * - 订阅 ai-employee:event 事件流，渲染 5 类步骤
 * - 默认折叠（仅显示「⏱ 步骤 N/5」+ 当前步骤名）
 * - 推理步骤超过 8s 自动展开（让用户看到进度）
 * - 完成后保持 5s 高亮，然后折叠
 *
 * 数据形态：
 * - 与后端 ExecutionEvent 对齐（requestId/type/label/detail/status/durationMs/at）
 *
 * 集成：
 * - AIEmployee 在 process tab 内嵌（替换旧的「思考中…」 spinner）
 */

import { useEffect, useRef, useState } from 'react'
import type { ExecutionEvent, ExecutionStepType } from '../shared/executionEvent'

type StepState = 'pending' | 'active' | 'done' | 'error'

type StepView = {
  key: string
  type: ExecutionStepType
  label: string
  detail?: string
  state: StepState
  durationMs?: number
  at: number
}

const STEP_ORDER: ExecutionStepType[] = ['queued', 'analyzing', 'reasoning', 'finalizing', 'done']

const STEP_DEFAULT_LABEL: Record<ExecutionStepType, string> = {
  queued: '已接收任务',
  analyzing: '预处理（图片/KB/路由）',
  reasoning: '模型推理',
  finalizing: '后处理（报告渲染）',
  done: '完成'
}

type Props = {
  /** 是否启用（避免主进程未注册 IPC 时报错） */
  enabled?: boolean
  /** 当前会话请求 id（用于隔离多轮任务） */
  requestId?: string
  /** 触发器：发送消息时调用 reset() */
  resetSignal?: number
  /** 完成后自动折叠延迟（ms） */
  autoCollapseDelayMs?: number
  /** 卡时自动展开阈值（ms） */
  stuckThresholdMs?: number
}

export default function ExecutionPanel({
  enabled = true,
  requestId,
  resetSignal,
  autoCollapseDelayMs = 5000,
  stuckThresholdMs = 8000
}: Props) {
  const [events, setEvents] = useState<ExecutionEvent[]>([])
  const [open, setOpen] = useState(false)
  const stuckTimerRef = useRef<number | null>(null)
  const collapseTimerRef = useRef<number | null>(null)

  // 订阅事件
  useEffect(() => {
    if (!enabled) return
    const off = window.desktop.aiEmployee.onEvent((event: ExecutionEvent) => {
      if (requestId && event.requestId !== requestId) return
      setEvents(prev => [...prev, event])
      // 收到首个事件时自动展开
      if (event.type === 'queued' || event.type === 'analyzing' || event.type === 'reasoning') {
        setOpen(true)
      }
      // 完成后保持 5s 再折叠
      if (event.type === 'done') {
        if (collapseTimerRef.current) window.clearTimeout(collapseTimerRef.current)
        collapseTimerRef.current = window.setTimeout(() => setOpen(false), autoCollapseDelayMs)
      }
    })
    return () => {
      off()
      if (stuckTimerRef.current) window.clearTimeout(stuckTimerRef.current)
      if (collapseTimerRef.current) window.clearTimeout(collapseTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, requestId])

  // 卡时展开
  useEffect(() => {
    if (!enabled) return
    if (stuckTimerRef.current) window.clearTimeout(stuckTimerRef.current)
    const latest = events[events.length - 1]
    if (latest && (latest.type === 'analyzing' || latest.type === 'reasoning' || latest.type === 'finalizing')) {
      stuckTimerRef.current = window.setTimeout(() => setOpen(true), stuckThresholdMs)
    }
    return () => {
      if (stuckTimerRef.current) window.clearTimeout(stuckTimerRef.current)
    }
  }, [events, enabled, stuckThresholdMs])

  // resetSignal 变化时清空
  useEffect(() => {
    setEvents([])
    setOpen(false)
  }, [resetSignal])

  // 派生步骤视图
  const steps: StepView[] = STEP_ORDER.map(type => {
    const matched = events.filter(e => e.type === type)
    const latest = matched[matched.length - 1]
    const done = matched.some(e => e.type === 'done' && e.status === 'success' || e.type === 'done' && e.status === 'error')
    const error = matched.some(e => e.type === 'done' && e.status === 'error')
    const state: StepState = latest
      ? (latest.type === 'done' ? (error ? 'error' : 'done') : 'active')
      : 'pending'
    return {
      key: type,
      type,
      label: latest?.label || STEP_DEFAULT_LABEL[type],
      detail: latest?.detail,
      state,
      durationMs: latest?.durationMs,
      at: latest?.at || 0
    }
  })

  // 折叠态：仅显示「⏱ 步骤 N/5」+ 当前步骤名
  const activeIndex = steps.findIndex(s => s.state === 'active')
  const completedCount = steps.filter(s => s.state === 'done' || s.state === 'error').length
  const currentLabel = activeIndex >= 0 ? steps[activeIndex].label : (completedCount === steps.length ? '完成' : '')

  if (events.length === 0) return null

  return (
    <div
      className={`ai-employee-execution-panel${open ? ' open' : ' collapsed'}${steps.some(s => s.state === 'error') ? ' has-error' : ''}`}
      role="region"
      aria-label="执行步骤"
    >
      <button
        type="button"
        className="ai-employee-execution-head"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <i className="ai-employee-execution-spinner" aria-hidden="true" />
        <span className="ai-employee-execution-progress">⏱ 步骤 {Math.min(completedCount + (activeIndex >= 0 ? 1 : 0), steps.length)}/{steps.length}</span>
        <b>{currentLabel}</b>
        <span className="ai-employee-execution-chevron" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <ol className="ai-employee-execution-list">
          {steps.map((step, index) => (
            <li key={step.key} className={`ai-employee-execution-step state-${step.state}`}>
              <span className="ai-employee-execution-step-icon" aria-hidden="true">
                {stepIcon(step.state, index, activeIndex)}
              </span>
              <div className="ai-employee-execution-step-text">
                <b>{step.label}</b>
                {step.detail && <small>{step.detail}</small>}
              </div>
              {step.durationMs != null && step.type === 'done' && (
                <time>{(step.durationMs / 1000).toFixed(1)}s</time>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function stepIcon(state: StepState, index: number, activeIndex: number): string {
  if (state === 'done') return '✓'
  if (state === 'error') return '✗'
  if (state === 'active') return '●'
  return '○'
}
