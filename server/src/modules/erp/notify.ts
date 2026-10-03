/**
 * ERP 通知中心（规格 §9 / 方案 M6 / 数据流 4）。
 *
 * 通知种类：
 *   - PATROL_CHANGE：巡盘检测到货盘改价/改库存等变更（一般）
 *   - PATROL_URGENT：变更命中「已发布（status ≥ PUBLISHED）」产品，需标红优先处理
 *   - MORNING_SUMMARY：早 8 点汇总（过去 24h 变更数 / 紧急数 / 待确认数）
 *
 * 读状态模型（P1-14）：组织级事件在创建时按活跃用户逐人落行（userId 定向），
 * 已读/全部已读按 currentUser 过滤——修复此前 userId 恒 null 导致 readAt 全组织共享、
 * 一人点「全部已读」清零所有人徽标的问题。历史存量的 userId=null 广播行仍对全员可见（兼容不丢通知）。
 * readAt 非空表示已读。
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { httpError } from '../../lib/errors.js'
import type { CurrentUser } from '../../plugins/auth.js'

export type NotificationKind = 'PATROL_CHANGE' | 'PATROL_URGENT' | 'MORNING_SUMMARY'

export interface NotificationView {
  id: string
  kind: string
  title: string
  body: Record<string, unknown>
  productId: string | null
  urgent: boolean
  read: boolean
  readAt: string | null
  createdAt: string
}

function toView(row: { id: string; kind: string; title: string; body: Prisma.JsonValue; productId: string | null; readAt: string | null; createdAt: string }): NotificationView {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: (row.body ?? {}) as Record<string, unknown>,
    productId: row.productId,
    urgent: row.kind === 'PATROL_URGENT',
    read: Boolean(row.readAt),
    readAt: row.readAt,
    createdAt: row.createdAt
  }
}

/**
 * 纯函数：当前用户的通知可见/可操作范围——本人的定向行 + userId=null 的历史组织广播行
 * （升级前落库的存量数据不因此丢失可见性）。供单测直接验证，不触库。
 */
export function notificationScopeWhere(userId: string): { OR: Array<{ userId: string | null }> } {
  return { OR: [{ userId }, { userId: null }] }
}

export interface CreateNotificationResult {
  /** 代表行 id（广播扇出时为第一个用户的行）；无落行时为 null */
  id: string | null
  /** 实际落库行数（广播 = 目标用户数） */
  created: number
}

/**
 * 创建通知：指定 userId 时单人定向落一行；未指定（组织广播）时按活跃用户逐人扇出，
 * 每行都写目标用户 id——已读状态从此按人独立。组织暂无活跃用户时兜底落一行 userId=null。
 */
export async function createNotification(
  orgId: string,
  input: { kind: NotificationKind | string; title: string; body?: Record<string, unknown>; productId?: string | null; userId?: string | null }
): Promise<CreateNotificationResult> {
  const base = {
    orgId,
    kind: input.kind,
    title: input.title,
    body: (input.body ?? {}) as Prisma.InputJsonValue,
    productId: input.productId ?? null,
    createdAt: new Date().toISOString()
  }
  if (input.userId) {
    const row = await prisma.erpNotification.create({ data: { ...base, userId: input.userId } })
    return { id: row.id, created: 1 }
  }
  const users = await prisma.user.findMany({ where: { orgId, status: 'ACTIVE' }, select: { id: true } })
  if (users.length === 0) {
    const row = await prisma.erpNotification.create({ data: { ...base, userId: null } })
    return { id: row.id, created: 1 }
  }
  let firstId: string | null = null
  for (const user of users) {
    const row = await prisma.erpNotification.create({ data: { ...base, userId: user.id } })
    if (!firstId) firstId = row.id
  }
  return { id: firstId, created: users.length }
}

export interface NotificationListResult {
  items: NotificationView[]
  total: number
  unread: number
  page: number
  pageSize: number
}

export async function listNotifications(
  user: CurrentUser,
  query: { unreadOnly?: boolean; kind?: string; page?: number; pageSize?: number } = {}
): Promise<NotificationListResult> {
  const page = Math.max(1, query.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20))
  // P1-14：按 currentUser 过滤（本人定向行 + 历史 userId=null 广播行），未读数同口径，徽标不再全组织共享
  const where: Record<string, unknown> = { orgId: user.orgId, ...notificationScopeWhere(user.id) }
  if (query.unreadOnly) where.readAt = null
  if (query.kind) where.kind = query.kind
  const [rows, total, unread] = await Promise.all([
    prisma.erpNotification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.erpNotification.count({ where }),
    prisma.erpNotification.count({ where: { orgId: user.orgId, readAt: null, ...notificationScopeWhere(user.id) } })
  ])
  return { items: rows.map(toView), total, unread, page, pageSize }
}

export async function markNotificationRead(user: CurrentUser, id: string): Promise<NotificationView> {
  const row = await prisma.erpNotification.findFirst({ where: { id, orgId: user.orgId, ...notificationScopeWhere(user.id) } })
  if (!row) throw httpError(404, 'ERP_NOTIFICATION_NOT_FOUND', '通知不存在或无权访问')
  const updated = await prisma.erpNotification.update({
    where: { id },
    data: { readAt: row.readAt ?? new Date().toISOString() }
  })
  return toView(updated)
}

export async function markAllNotificationsRead(user: CurrentUser): Promise<{ updated: number }> {
  // 只清当前用户可见范围内的未读（本人定向行 + 历史广播行），不再清零其他人的徽标
  const result = await prisma.erpNotification.updateMany({
    where: { orgId: user.orgId, readAt: null, ...notificationScopeWhere(user.id) },
    data: { readAt: new Date().toISOString() }
  })
  return { updated: result.count }
}

export interface MorningSummary {
  orgId: string
  windowStart: string
  generatedAt: string
  totalChanges: number
  urgentChanges: number
  pendingProducts: number
  byField: Record<string, number>
  notificationId: string | null
}

/**
 * 早 8 点汇总：统计过去 windowMs（默认 24h）内的巡盘变更（crawl_logs）、
 * 其中命中已发布产品的紧急变更数、当前待确认变更产品数，并落一条 MORNING_SUMMARY 通知。
 */
export async function buildMorningSummary(orgId: string, windowMs = 24 * 60 * 60 * 1000, now = Date.now()): Promise<MorningSummary> {
  const windowStart = new Date(now - windowMs).toISOString()
  const logs = await prisma.erpCrawlLog.findMany({
    where: { orgId, createdAt: { gte: windowStart } },
    select: { fieldChanged: true, product: { select: { status: true } } }
  })
  const byField: Record<string, number> = {}
  let urgentChanges = 0
  for (const log of logs) {
    byField[log.fieldChanged] = (byField[log.fieldChanged] ?? 0) + 1
    if (log.product && isPublishedStatus(log.product.status)) urgentChanges += 1
  }
  const pendingProducts = await prisma.erpProduct.count({ where: { orgId, changeFlag: 1 } })
  const generatedAt = new Date(now).toISOString()
  const title = `早间巡盘汇总：${logs.length} 项变更${urgentChanges > 0 ? `，${urgentChanges} 项命中已发布（需优先）` : ''}，${pendingProducts} 个产品待确认`
  const row = await createNotification(orgId, {
    kind: 'MORNING_SUMMARY',
    title,
    body: { windowStart, totalChanges: logs.length, urgentChanges, pendingProducts, byField }
  })
  return {
    orgId, windowStart, generatedAt,
    totalChanges: logs.length, urgentChanges, pendingProducts, byField,
    notificationId: row.id
  }
}

/** 已发布判定：status ≥ PUBLISHED（用于变更标红） */
export function isPublishedStatus(status: string): boolean {
  return (status || '').toUpperCase() === 'PUBLISHED'
}
