/**
 * K 阶段新增：团队工作台首页
 *
 * 数据源：中央服务器 GET /api/dashboard/summary（按角色差异化）
 * - OWNER：全量 KPI + 全团队待办 + 全团队动态
 * - OPERATOR：全量 KPI + 自己 + 同 org 动态
 * - PUBLISHER：精简 KPI + 仅自己待办
 * - VIEWER：只读聚合 KPI（无待办、无动态）
 *
 * UI 结构：
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  团队工作台                            [🔄 刷新]  [更新时间]  │
 *   ├──────────────┬──────────────┬──────────────┬────────────────┤
 *   │ 今日新增产品 │ 待审报告    │ 失败任务    │ AI 用量        │
 *   ├──────────────┴──────────────┼──────────────┴────────────────┤
 *   │ ┌── 我的待办 (5) ───┐  ┌─── 团队动态 (24h) ────┐         │
 *   │ │ 🔴 选品 ...        │  │ 张三 14:23 创建…     │         │
 *   │ │ ...                 │  │ ...                   │         │
 *   │ └────────────────────┘  └────────────────────────┘         │
 *   └──────────────────────────────────────────────────────────────┘
 */

import { useCallback, useEffect, useState } from 'react'
import { fetchDashboardSummary } from './serverApi'
import type { DashboardKpi, DashboardSummary, MyTodo, TeamActivity } from '../shared/dashboard'
import './dashboard.css'

const TREND_ARROW: Record<NonNullable<DashboardKpi['trend']>, string> = {
  up: '↑',
  down: '↓',
  flat: '─'
}

const TREND_CLASS: Record<NonNullable<DashboardKpi['trend']>, string> = {
  up: 'kpi-trend up',
  down: 'kpi-trend down',
  flat: 'kpi-trend flat'
}

const TODO_TYPE_LABEL: Record<MyTodo['type'], string> = {
  selection: '选品',
  compliance: '合规',
  publish: '发布',
  guardian: '守卫',
  review: '审核'
}

const TODO_STATUS_BADGE: Record<MyTodo['status'], string> = {
  pending: '待处理',
  running: '进行中',
  failed: '失败'
}

const TODO_STATUS_CLASS: Record<MyTodo['status'], string> = {
  pending: 'todo-status pending',
  running: 'todo-status running',
  failed: 'todo-status failed'
}

const ACTION_LABEL: Record<TeamActivity['action'], string> = {
  created: '创建',
  updated: '更新',
  deleted: '删除',
  enabled: '启用',
  disabled: '禁用',
  reset_pwd: '重置密码',
  role_changed: '角色变更',
  ai_quota_exceeded: 'AI 配额超限',
  login: '登录',
  logout: '登出'
}

const TARGET_TYPE_LABEL: Record<TeamActivity['targetType'], string> = {
  product: '产品',
  report: '报告',
  task: '任务',
  user: '成员',
  role: '角色',
  kb: '知识库',
  session: '会话'
}

function formatRelativeTime(at: number, now: number): string {
  const diff = now - at
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

function formatClock(at: number): string {
  const d = new Date(at)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function kpiIcon(key: DashboardKpi['key']): string {
  switch (key) {
    case 'todayProducts': return '📦'
    case 'pendingReports': return '📋'
    case 'failedTasks': return '⚠️'
    case 'aiQuotaUsed': return '🤖'
    case 'activeMembers': return '👥'
    case 'runningSkills': return '🛡️'
    default: return '·'
  }
}

export default function Dashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [error, setError] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [tickNow, setTickNow] = useState(Date.now())

  const load = useCallback(async (background = false) => {
    if (background) setRefreshing(true)
    else setLoading(true)
    setError('')
    try {
      const data = await fetchDashboardSummary()
      setSummary(data)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载失败')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load(false)
  }, [load])

  // 每 30s 自动刷新相对时间显示
  useEffect(() => {
    const timer = setInterval(() => setTickNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  // 每 60s 自动后台刷新数据
  useEffect(() => {
    const timer = setInterval(() => void load(true), 60_000)
    return () => clearInterval(timer)
  }, [load])

  if (loading) {
    return (
      <section className="dashboard-page">
        <div className="dashboard-loading">正在加载团队工作台…</div>
      </section>
    )
  }

  if (error && !summary) {
    return (
      <section className="dashboard-page">
        <div className="dashboard-error">
          <strong>加载失败</strong>
          <span>{error}</span>
          <button onClick={() => void load(false)}>重试</button>
        </div>
      </section>
    )
  }

  if (!summary) return null

  return (
    <section className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <h1>📊 团队工作台</h1>
          <p>K 阶段新增 · 团队状态聚合与我的待办</p>
        </div>
        <div className="dashboard-header-actions">
          <span className="dashboard-updated-at">
            最后更新 {formatClock(summary.generatedAt)}
          </span>
          <button
            className="dashboard-refresh-btn"
            onClick={() => void load(true)}
            disabled={refreshing}
            title="刷新数据"
          >
            {refreshing ? '刷新中…' : '🔄 刷新'}
          </button>
        </div>
      </header>

      {/* KPI 区 */}
      <div className="dashboard-kpis" data-testid="dashboard-kpis">
        {summary.kpis.map(kpi => <KpiCard key={kpi.key} kpi={kpi} />)}
      </div>

      <div className="dashboard-grid">
        {/* 我的待办 */}
        <section className="dashboard-panel" data-testid="dashboard-my-todos">
          <h2>
            <span>📌 我的待办</span>
            <small>({summary.myTodos.length})</small>
          </h2>
          {summary.myTodos.length === 0 ? (
            <div className="dashboard-empty">暂无待办</div>
          ) : (
            <ul className="dashboard-todo-list">
              {summary.myTodos.map(todo => (
                <li key={todo.id} className="dashboard-todo-item">
                  <span className={TODO_STATUS_CLASS[todo.status]}>{TODO_STATUS_BADGE[todo.status]}</span>
                  <span className="todo-type">{TODO_TYPE_LABEL[todo.type]}</span>
                  <span className="todo-title">{todo.title}</span>
                  <span className="todo-owner">{todo.ownerName}</span>
                  <span className="todo-time">{formatRelativeTime(todo.createdAt, tickNow)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 团队动态 */}
        <section className="dashboard-panel" data-testid="dashboard-team-activities">
          <h2>
            <span>🕒 团队动态</span>
            <small>(24h · {summary.teamActivities.length})</small>
          </h2>
          {summary.teamActivities.length === 0 ? (
            <div className="dashboard-empty">暂无团队动态</div>
          ) : (
            <ul className="dashboard-activity-list">
              {summary.teamActivities.map(activity => (
                <li key={activity.id} className="dashboard-activity-item">
                  <span className="activity-time">{formatClock(activity.at)}</span>
                  <span className="activity-member">{activity.memberName}</span>
                  <span className="activity-action">{ACTION_LABEL[activity.action]}</span>
                  <span className="activity-target">
                    {TARGET_TYPE_LABEL[activity.targetType]}: <b>{activity.targetLabel}</b>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  )
}

function KpiCard({ kpi }: { kpi: DashboardKpi }) {
  return (
    <div className={`dashboard-kpi kpi-${kpi.key}`} data-testid={`kpi-${kpi.key}`}>
      <div className="kpi-icon">{kpiIcon(kpi.key)}</div>
      <div className="kpi-body">
        <div className="kpi-label">{kpi.label}</div>
        <div className="kpi-value-row">
          <span className="kpi-value">{kpi.value}</span>
          {kpi.suffix && <span className="kpi-suffix">{kpi.suffix}</span>}
        </div>
        {kpi.trend && kpi.trendValue !== undefined && kpi.trendValue > 0 && (
          <span className={TREND_CLASS[kpi.trend]}>
            {TREND_ARROW[kpi.trend]} {kpi.trendValue}
          </span>
        )}
      </div>
    </div>
  )
}
