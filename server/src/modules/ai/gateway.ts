/**
 * AI 网关核心：月度配额拦截 + 用量记账。
 * - AiQuota（orgId+userId 唯一）：imageLimit / videoLimit / textLimit，null = 不限，0 = 禁止
 * - 无配额记录 = 不限（主帐号不配置即可全员自由使用）
 * - 按自然月（UTC）聚合 AiUsageLog.units，超预估值即拒绝（429 QUOTA_EXCEEDED）
 * - 记账按实际消耗（生图按实际返回张数，翻译按去重条数，视频/指令按次）
 */
import type { PrismaClient } from '@prisma/client'
import { httpError } from '../../lib/errors.js'

export type AiPurpose = 'image.generate' | 'text.translate' | 'text.command' | 'text.chat' | 'video.generate'

export type AiQuotaKind = 'image' | 'video' | 'text'

const QUOTA_KIND_LABEL: Record<AiQuotaKind, string> = {
  image: '生图',
  video: '视频生成',
  text: '文本'
}

export function quotaKindOf(purpose: AiPurpose): AiQuotaKind {
  if (purpose.startsWith('image.')) return 'image'
  if (purpose.startsWith('video.')) return 'video'
  return 'text'
}

/** 自然月起点的 UTC 时间（与 verify 脚本可预测的月份边界一致） */
export function startOfMonthUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

/** 当前自然月标识，如 2026-08 */
export function monthKeyOf(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export interface QuotaStatus {
  kind: AiQuotaKind
  limit: number | null
  used: number
  remaining: number | null
}

/** 查询某用户当月三类配额的限额/已用/剩余（无记录或 null 视为不限） */
export async function quotaStatusOf(db: PrismaClient, orgId: string, userId: string): Promise<QuotaStatus[]> {
  const quota = await db.aiQuota.findUnique({ where: { orgId_userId: { orgId, userId } } })
  const monthStart = startOfMonthUtc()
  const grouped = await db.aiUsageLog.groupBy({
    by: ['purpose'],
    where: { orgId, userId, createdAt: { gte: monthStart } },
    _sum: { units: true }
  })
  const usedByKind: Record<AiQuotaKind, number> = { image: 0, video: 0, text: 0 }
  for (const row of grouped) {
    const kind = quotaKindOf(row.purpose as AiPurpose)
    usedByKind[kind] += row._sum.units ?? 0
  }
  const limitOf = (kind: AiQuotaKind): number | null =>
    kind === 'image' ? quota?.imageLimit ?? null : kind === 'video' ? quota?.videoLimit ?? null : quota?.textLimit ?? null
  return (['image', 'video', 'text'] as AiQuotaKind[]).map(kind => {
    const limit = limitOf(kind)
    const used = usedByKind[kind]
    return { kind, limit, used, remaining: limit === null ? null : Math.max(0, limit - used) }
  })
}

/**
 * 配额拦截：预计消耗 units 前调用。超限抛 429 QUOTA_EXCEEDED。
 * 主帐号本人同样受配额约束（若配置了配额），无记录/null 则放行。
 */
export async function assertQuota(
  db: PrismaClient,
  orgId: string,
  userId: string,
  purpose: AiPurpose,
  units: number
): Promise<void> {
  const quota = await db.aiQuota.findUnique({ where: { orgId_userId: { orgId, userId } } })
  if (!quota) return
  const kind = quotaKindOf(purpose)
  const limit = kind === 'image' ? quota.imageLimit : kind === 'video' ? quota.videoLimit : quota.textLimit
  if (limit === null || limit === undefined) return
  const monthStart = startOfMonthUtc()
  const used = await db.aiUsageLog.aggregate({
    _sum: { units: true },
    where: { orgId, userId, purpose: { startsWith: `${kind}.` }, createdAt: { gte: monthStart } }
  })
  const usedUnits = used._sum.units ?? 0
  if (usedUnits + units > limit) {
    throw httpError(
      429,
      'QUOTA_EXCEEDED',
      `本月${QUOTA_KIND_LABEL[kind]}配额不足：已用 ${usedUnits}/${limit}，本次需 ${units}。请联系主帐号调整配额`,
      )
  }
}

export interface UsageRecord {
  orgId: string
  userId: string
  provider: string
  model: string
  purpose: AiPurpose
  units: number
}

/** 用量记账（实际消耗） */
export async function recordUsage(db: PrismaClient, record: UsageRecord): Promise<void> {
  await db.aiUsageLog.create({
    data: {
      orgId: record.orgId,
      userId: record.userId,
      provider: record.provider,
      model: record.model,
      purpose: record.purpose,
      units: Math.max(1, Math.round(record.units))
    }
  })
}
