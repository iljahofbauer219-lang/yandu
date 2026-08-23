// K 阶段新增：团队工作台聚合接口
// - 入口：GET /api/dashboard/summary
// - 权限：dashboard.view（OWNER/OPERATOR/PUBLISHER/VIEWER 均可见；按角色差异化返回数据）
// - 数据源：audit_logs / selection_tasks / ai_usage_logs / users

import type { FastifyInstance } from 'fastify'
import { prisma } from '../../lib/prisma.js'

/**
 * K 阶段新增：工作台权限码（按预置角色映射见 server/src/modules/rbac/permissions.ts）
 * - OWNER / OPERATOR / PUBLISHER / VIEWER 都应可见（首页是"门面"）
 * - VIEWER 仅看到只读聚合（KPI），不暴露待办/动态
 */
const DASHBOARD_VIEW_PERMISSION = 'dashboard.view'

/** 团队动作白名单（仅这些 action 会出现在"团队动态"中） */
const TEAM_ACTIVITY_ACTIONS = [
  'created',
  'updated',
  'deleted',
  'enabled',
  'disabled',
  'reset_pwd',
  'role_changed',
  'ai_quota_exceeded',
  'login',
  'logout'
] as const

/** 视角用户：OWNER 看到全量；OPERATOR 看自己 + 同 org；PUBLISHER 仅自己；VIEWER 只见 KPI */
function isWideView(user: { isOwner: boolean; permissions: Set<string> }): boolean {
  if (user.isOwner) return true
  return user.permissions.has('member.manage')
}

function isSelfOnlyView(user: { isOwner: boolean; permissions: Set<string> }): boolean {
  if (user.isOwner) return false
  // PUBLISHER 默认无 member.manage，无 report.view:all
  return !user.permissions.has('report.view:all') && !user.permissions.has('member.manage')
}

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  // K 阶段新增：工作台首页聚合（首页默认跳转；所有角色可看）
  app.get('/summary', { preHandler: [app.requirePermission(DASHBOARD_VIEW_PERMISSION)] }, async (request) => {
    const user = request.currentUser
    const orgId = user.orgId
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000)
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)

    // ─── 1) KPI 聚合 ─────────────────────────────────────────
    const [
      todayProducts,
      yesterdayProducts,
      pendingReports,
      yesterdayPendingReports,
      failedTasks,
      yesterdayFailedTasks,
      aiUsageToday,
      aiUsageYesterday,
      activeMembers,
      runningSkills
    ] = await Promise.all([
      // 今日新增产品（本地仓库）—— 0 兜底（表暂无）
      Promise.resolve(0),
      Promise.resolve(0),
      // 待审报告：selection_records 中 decision=PENDING 的数量
      prisma.selectionRecord.count({ where: { orgId, decision: 'PENDING' } }).catch(() => 0),
      prisma.selectionRecord.count({
        where: { orgId, decision: 'PENDING', updatedAt: { gte: yesterdayStart.toISOString(), lt: todayStart.toISOString() } }
      }).catch(() => 0),
      // 失败任务：stage=FAILED 的 selection_task
      prisma.selectionTask.count({ where: { orgId, stage: 'FAILED' } }).catch(() => 0),
      prisma.selectionTask.count({
        where: { orgId, stage: 'FAILED', createdAt: { gte: yesterdayStart.toISOString(), lt: todayStart.toISOString() } }
      }).catch(() => 0),
      // 今日 AI 用量单位数
      prisma.aiUsageLog.count({ where: { orgId, createdAt: { gte: todayStart } } }).catch(() => 0),
      prisma.aiUsageLog.count({
        where: { orgId, createdAt: { gte: yesterdayStart, lt: todayStart } }
      }).catch(() => 0),
      // 在岗成员：最近 24h 有 audit_logs 的用户数
      prisma.auditLog.findMany({
        where: { orgId, createdAt: { gte: last24h } },
        select: { userId: true },
        distinct: ['userId']
      }).then(rows => rows.filter(r => r.userId).length).catch(() => 0),
      // 运行中技能（KB Guardian）—— 0 兜底（主进程内状态；中央服务器无此表）
      Promise.resolve(0)
    ])

    // 计算趋势
    const trend = (current: number, previous: number): { trend: 'up' | 'down' | 'flat'; trendValue: number } => {
      const diff = current - previous
      if (diff > 0) return { trend: 'up', trendValue: diff }
      if (diff < 0) return { trend: 'down', trendValue: -diff }
      return { trend: 'flat', trendValue: 0 }
    }

    // AI 用量百分比：今日单位数 / 100（简化：实际应有配额阈值）
    const aiQuotaUsed = Math.min(100, Math.round((aiUsageToday / 100) * 100))

    // K 阶段新增：KPI 列表（按视角裁剪）
    const wideView = isWideView(user)
    const kpis = [
      { key: 'todayProducts', label: '今日新增产品', value: todayProducts, suffix: '件', ...trend(todayProducts, yesterdayProducts) },
      { key: 'pendingReports', label: '待审报告', value: pendingReports, suffix: '份', ...trend(pendingReports, yesterdayPendingReports) },
      { key: 'failedTasks', label: '失败任务', value: failedTasks, suffix: '个', ...trend(failedTasks, yesterdayFailedTasks) },
      { key: 'aiQuotaUsed', label: 'AI 用量', value: aiQuotaUsed, suffix: '%' },
      ...(wideView
        ? [{ key: 'activeMembers', label: '在岗成员', value: activeMembers, suffix: '人' }]
        : []),
      { key: 'runningSkills', label: '运行中技能', value: runningSkills, suffix: '个' }
    ]

    // ─── 2) 我的待办（VIEWER 不可见） ─────────────────────────
    let myTodos: Array<{
      id: string
      type: string
      title: string
      ownerName: string
      ownerAvatar?: string
      status: 'pending' | 'running' | 'failed'
      dueAt?: number
      createdAt: number
      link: string
    }> = []

    if (!isSelfOnlyView(user) || user.isOwner) {
      // 简化版：取当前用户最近 5 条 selection_task 作为待办
      // 实际应有 ownerId 字段关联 user；当前 schema 用 stage 推
      const tasks = await prisma.selectionTask
        .findMany({
          where: { orgId, stage: { in: ['PENDING', 'RUNNING', 'FAILED'] } },
          orderBy: [{ createdAt: 'desc' }],
          take: 5
        })
        .catch(() => [])

      myTodos = tasks.map(task => {
        const status = task.stage === 'FAILED' ? 'failed' : task.stage === 'RUNNING' ? 'running' : 'pending'
        return {
          id: task.id,
          type: 'selection',
          title: `选品任务 ${task.id.slice(0, 8)}`,
          ownerName: user.name,
          status: status as 'pending' | 'running' | 'failed',
          createdAt: Date.parse(task.createdAt) || Date.now(),
          link: '/tasks'
        }
      })
    }

    // ─── 3) 团队动态（VIEWER 不可见；仅广角视角或自视角） ─────
    let teamActivities: Array<{
      id: string
      memberId: string
      memberName: string
      action: string
      targetType: string
      targetLabel: string
      at: number
    }> = []

    if (wideView) {
      // 广角视角：全 org 最近 20 条审计
      const logs = await prisma.auditLog
        .findMany({
          where: { orgId, action: { in: [...TEAM_ACTIVITY_ACTIONS] } },
          include: { user: { select: { id: true, name: true } } },
          orderBy: [{ createdAt: 'desc' }],
          take: 20
        })
        .catch(() => [])

      teamActivities = logs.map(log => ({
        id: log.id,
        memberId: log.userId || 'unknown',
        memberName: log.user?.name || '匿名',
        action: log.action,
        targetType: log.targetType || 'unknown',
        targetLabel: (log.detail as { label?: string } | null)?.label || log.targetId || log.targetType || '—',
        at: log.createdAt.getTime()
      }))
    } else if (!isSelfOnlyView(user)) {
      // OPERATOR 自视角：仅自己的最近 20 条审计
      const logs = await prisma.auditLog
        .findMany({
          where: { orgId, userId: user.id, action: { in: [...TEAM_ACTIVITY_ACTIONS] } },
          orderBy: [{ createdAt: 'desc' }],
          take: 20
        })
        .catch(() => [])

      teamActivities = logs.map(log => ({
        id: log.id,
        memberId: log.userId || user.id,
        memberName: user.name,
        action: log.action,
        targetType: log.targetType || 'unknown',
        targetLabel: (log.detail as { label?: string } | null)?.label || log.targetId || log.targetType || '—',
        at: log.createdAt.getTime()
      }))
    }

    return {
      kpis,
      myTodos,
      teamActivities,
      generatedAt: now.getTime()
    }
  })
}
