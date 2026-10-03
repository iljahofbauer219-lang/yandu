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
 * 配额判定（纯函数，单测载体）：limit 为 null/undefined 视为不限；否则已用+本次不得超过上限。
 * 注意 limit=0 表示完全禁止（任何 units>=1 的调用都会被拒）。
 */
export function decideQuota(limit: number | null | undefined, usedUnits: number, units: number): boolean {
  if (limit === null || limit === undefined) return true
  return usedUnits + units <= limit
}

/**
 * 配额预占凭据：id 非空表示已在 ai_usage_logs 中写入一条 provider/model='pending' 的预占行，
 * 生成成功后由 recordUsage 落定为实际消耗，生成失败由 releaseQuota 释放。
 * id 为 null 表示该用户不受限（无配额记录或 limit=null），无需预占，recordUsage 直接追加流水。
 */
export interface QuotaReservation {
  id: string | null
  purpose: AiPurpose
  units: number
}

/**
 * 配额拦截 + 原子预占：预计消耗 units 前调用。超限抛 429 QUOTA_EXCEEDED。
 * 主帐号本人同样受配额约束（若配置了配额），无记录/null 则放行。
 *
 * 并发防超卖（plan frosty-wood-gudgeon #5）：受限时在单个事务内先对 ai_quotas 行
 * SELECT ... FOR UPDATE 加锁，再「汇总当月已用 → 判定 → 写入预占流水」，
 * 使同一 (org,user) 的并发请求在配额行上串行化，后到者必然看到先到者已提交的预占，
 * 消除旧实现「先查后扣、查扣分离」的竞态窗口。
 */
export async function assertQuota(
  db: PrismaClient,
  orgId: string,
  userId: string,
  purpose: AiPurpose,
  units: number
): Promise<QuotaReservation> {
  const quota = await db.aiQuota.findUnique({ where: { orgId_userId: { orgId, userId } } })
  const kind = quotaKindOf(purpose)
  const limit = quota
    ? kind === 'image' ? quota.imageLimit : kind === 'video' ? quota.videoLimit : quota.textLimit
    : null
  if (limit === null || limit === undefined) return { id: null, purpose, units }
  const monthStart = startOfMonthUtc()
  const reservation = await db.$transaction(async tx => {
    // 锁住该用户的配额行，串行化同 (org,user) 的并发判定（PG/PGlite 均支持行级锁）
    await tx.$queryRaw`SELECT id FROM ai_quotas WHERE org_id = ${orgId} AND user_id = ${userId} FOR UPDATE`
    const used = await tx.aiUsageLog.aggregate({
      _sum: { units: true },
      where: { orgId, userId, purpose: { startsWith: `${kind}.` }, createdAt: { gte: monthStart } }
    })
    const usedUnits = used._sum.units ?? 0
    if (!decideQuota(limit, usedUnits, units)) {
      throw httpError(
        429,
        'QUOTA_EXCEEDED',
        `本月${QUOTA_KIND_LABEL[kind]}配额不足：已用 ${usedUnits}/${limit}，本次需 ${units}。请联系主帐号调整配额`,
      )
    }
    // 预占行：purpose 计入当月已用；provider/model 落定前为 'pending'
    return tx.aiUsageLog.create({
      data: { orgId, userId, provider: 'pending', model: 'pending', purpose, units: Math.max(1, Math.round(units)) }
    })
  })
  return { id: reservation.id, purpose, units }
}

/** 释放预占（生成失败时调用）；释放失败不掩盖调用方原始错误 */
export async function releaseQuota(db: PrismaClient, reservation: QuotaReservation | null): Promise<void> {
  if (!reservation?.id) return
  try {
    await db.aiUsageLog.deleteMany({ where: { id: reservation.id, provider: 'pending' } })
  } catch {
    // 预占释放失败不阻断错误传播；预占行继续计入用量（保守方向，不会超卖）
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

/**
 * 用量记账（实际消耗）。
 * 传入 assertQuota 返回的预占凭据时，把预占行落定为实际 provider/model/units（不重复计数）；
 * 无预占（不受限用户）时直接追加一条流水。
 */
export async function recordUsage(db: PrismaClient, record: UsageRecord, reservation?: QuotaReservation | null): Promise<void> {
  const units = Math.max(1, Math.round(record.units))
  if (reservation?.id) {
    await db.aiUsageLog.update({
      where: { id: reservation.id },
      data: { provider: record.provider, model: record.model, purpose: record.purpose, units }
    })
    return
  }
  await db.aiUsageLog.create({
    data: {
      orgId: record.orgId,
      userId: record.userId,
      provider: record.provider,
      model: record.model,
      purpose: record.purpose,
      units
    }
  })
}
