// K 阶段新增：团队工作台聚合接口
// - 入口：GET /api/dashboard/summary
// - 权限：dashboard.view（OWNER/OPERATOR/PUBLISHER/VIEWER 均可见；按角色差异化返回数据）
// - 数据源：audit_logs / selection_tasks / ai_usage_logs / ai_quotas / erp_products / users
// - 指标查询失败一律记 warn 并返回 null（KPI）或空数组（列表），不再 .catch(()=>0) 造假 0

import type { FastifyInstance } from 'fastify'
import { prisma } from '../../lib/prisma.js'
import { startOfMonthUtc } from '../ai/gateway.js'
import { TEAM_ACTIVITY_ACTIONS } from './teamActivity.js'

/**
 * K 阶段新增：工作台权限码（按预置角色映射见 server/src/modules/rbac/permissions.ts）
 * - OWNER / OPERATOR / PUBLISHER / VIEWER 都应可见（首页是"门面"）
 * - VIEWER 仅看到只读聚合（KPI），不暴露待办/动态
 */
const DASHBOARD_VIEW_PERMISSION = 'dashboard.view'

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
    const monthStart = startOfMonthUtc(now)

    // 指标查询不再吞错造假 0：失败记 warn 并返回 null，前端按「—」渲染（plan frosty-wood-gudgeon #25）
    const metric = async <T>(name: string, query: Promise<T>): Promise<T | null> => {
      try {
        return await query
      } catch (error) {
        request.log.warn({ err: error, metric: name }, 'dashboard 指标查询失败，该指标返回 null')
        return null
      }
    }
    // 列表区块（待办/动态）失败同样记 warn，返回空数组
    const metricList = async <T>(name: string, query: Promise<T[]>): Promise<T[]> => {
      try {
        return await query
      } catch (error) {
        request.log.warn({ err: error, metric: name }, 'dashboard 列表查询失败，返回空列表')
        return []
      }
    }

    // ─── 1) KPI 聚合 ─────────────────────────────────────────
    // erp_products.created_at 为 ISO8601 UTC 字符串（collect.ts 写入），同格式下字典序即时间序
    const [
      todayProducts,
      yesterdayProducts,
      pendingReports,
      yesterdayPendingReports,
      failedTasks,
      yesterdayFailedTasks,
      monthAiUnits,
      quotaRows,
      activeMembers
    ] = await Promise.all([
      // 今日新增产品（ERP 货盘真实计数）
      metric('todayProducts', prisma.erpProduct.count({ where: { orgId, createdAt: { gte: todayStart.toISOString() } } })),
      metric('yesterdayProducts', prisma.erpProduct.count({
        where: { orgId, createdAt: { gte: yesterdayStart.toISOString(), lt: todayStart.toISOString() } }
      })),
      // 待审报告：selection_records 中 decision=PENDING 的数量
      metric('pendingReports', prisma.selectionRecord.count({ where: { orgId, decision: 'PENDING' } })),
      metric('yesterdayPendingReports', prisma.selectionRecord.count({
        where: { orgId, decision: 'PENDING', updatedAt: { gte: yesterdayStart.toISOString(), lt: todayStart.toISOString() } }
      })),
      // 失败任务：stage=FAILED 的 selection_task
      metric('failedTasks', prisma.selectionTask.count({ where: { orgId, stage: 'FAILED' } })),
      metric('yesterdayFailedTasks', prisma.selectionTask.count({
        where: { orgId, stage: 'FAILED', createdAt: { gte: yesterdayStart.toISOString(), lt: todayStart.toISOString() } }
      })),
      // 本自然月 AI 用量单位数（与 ai/gateway 配额口径一致：units 求和而非行数）
      metric('monthAiUnits', prisma.aiUsageLog.aggregate({
        _sum: { units: true },
        where: { orgId, createdAt: { gte: monthStart } }
      })),
      // 组织内已配置的月度配额上限（AI 用量百分比的真实分母）
      metric('aiQuotaLimits', prisma.aiQuota.findMany({ where: { orgId } })),
      // 在岗成员：最近 24h 有 audit_logs 的用户数
      metric('activeMembers', prisma.auditLog.findMany({
        where: { orgId, createdAt: { gte: last24h } },
        select: { userId: true },
        distinct: ['userId']
      }).then(rows => rows.filter(r => r.userId).length))
    ])

    // AI 用量百分比：本月已用 units / 本月真实配额上限（组织内全部有限额之和）。
    // 无任何有限额配置 = 全组织不限量，百分比无意义 → null（不再拍脑袋除以 100）
    const finiteLimits = (quotaRows ?? []).flatMap(row => [row.imageLimit, row.videoLimit, row.textLimit])
      .filter((limit): limit is number => limit !== null)
    const quotaCeiling = finiteLimits.reduce((sum, limit) => sum + limit, 0)
    const monthUnits = monthAiUnits?._sum.units ?? null
    const aiQuotaUsed = monthUnits !== null && finiteLimits.length > 0 && quotaCeiling > 0
      ? Math.min(100, Math.round((monthUnits / quotaCeiling) * 100))
      : null

    // 计算趋势（任一指标查询失败为 null 时不给假趋势）
    const trend = (current: number | null, previous: number | null): { trend: 'up' | 'down' | 'flat'; trendValue: number } => {
      if (current === null || previous === null) return { trend: 'flat', trendValue: 0 }
      const diff = current - previous
      if (diff > 0) return { trend: 'up', trendValue: diff }
      if (diff < 0) return { trend: 'down', trendValue: -diff }
      return { trend: 'flat', trendValue: 0 }
    }

    // K 阶段新增：KPI 列表（按视角裁剪）。
    // 「运行中技能」已移除：KB Guardian 状态只存在于 Electron 主进程内存，中央服务器无真实数据源，
    // 硬编码 0 属于误导性假指标（plan frosty-wood-gudgeon #25）。
    const wideView = isWideView(user)
    const kpis = [
      { key: 'todayProducts', label: '今日新增产品', value: todayProducts, suffix: '件', ...trend(todayProducts, yesterdayProducts) },
      { key: 'pendingReports', label: '待审报告', value: pendingReports, suffix: '份', ...trend(pendingReports, yesterdayPendingReports) },
      { key: 'failedTasks', label: '失败任务', value: failedTasks, suffix: '个', ...trend(failedTasks, yesterdayFailedTasks) },
      { key: 'aiQuotaUsed', label: 'AI 用量', value: aiQuotaUsed, suffix: '%' },
      ...(wideView
        ? [{ key: 'activeMembers', label: '在岗成员', value: activeMembers, suffix: '人' }]
        : [])
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
      const tasks = await metricList('myTodos', prisma.selectionTask.findMany({
        where: { orgId, stage: { in: ['PENDING', 'RUNNING', 'FAILED'] } },
        orderBy: [{ createdAt: 'desc' }],
        take: 5
      }))

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
      const logs = await metricList('teamActivities.all', prisma.auditLog.findMany({
        where: { orgId, action: { in: [...TEAM_ACTIVITY_ACTIONS] } },
        include: { user: { select: { id: true, name: true } } },
        orderBy: [{ createdAt: 'desc' }],
        take: 20
      }))

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
      const logs = await metricList('teamActivities.self', prisma.auditLog.findMany({
        where: { orgId, userId: user.id, action: { in: [...TEAM_ACTIVITY_ACTIONS] } },
        orderBy: [{ createdAt: 'desc' }],
        take: 20
      }))

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
