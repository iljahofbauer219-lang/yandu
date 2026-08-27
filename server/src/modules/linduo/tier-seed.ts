/**
 * Linduo 模型等级 (LinduoModelTier) 启动 seed —— R-2 核心。
 *
 * 职责：
 * - 给每个 Organization 预置 3 个系统 tier：basic / advanced / full
 * - 'full' tier 的 LinduoTierGrant 与 enabled LinduoChatModel 保持同步（新增模型自动开）
 * - 给所有 isOwner=true 的用户自动分配 'full' tier（核心"OWNER 全可见"承诺）
 *
 * 幂等性：
 * - LinduoModelTier@@unique([orgId,key]) → upsert 多次跑安全
 * - LinduoTierGrant@@id([tierId,modelId]) → upsert 多次跑安全
 * - User.linduoTierId onDelete SetNull → 上层重置安全
 *
 * 调用时机：
 * - server/src/index.ts 启动 listen 之后立即调用（顺序：syncLinduoChatModels → seedDefaultLinduoTiers → assignOwnerLinduoTiers → ensureOwnerLinduoExceptions）
 * - 后续若有"修改 OWNER 权限"动作，调用 assignOwnerLinduoTiers 重新对齐
 */
import { prisma } from '../../lib/prisma.js'

/** R-2 预置的 3 个系统 tier 元数据 */
export const DEFAULT_LINDUO_TIERS = [
  {
    key: 'basic' as const,
    name: '基础组',
    description: '默认无模型；admin 可按需为成员单独分配例外或升级到进阶组',
    displayOrder: 0,
    isSystem: true
  },
  {
    key: 'advanced' as const,
    name: '进阶组',
    description: '默认开放 Gemini 2.0 Flash + GPT-4o-mini 两个常用中端模型',
    displayOrder: 1,
    isSystem: true
  },
  {
    key: 'full' as const,
    name: '全开组',
    description: '默认开放所有已启用的 Linduo 聊天模型（OWNER 默认归属）',
    displayOrder: 2,
    isSystem: true
  }
]

export interface LinduoTierSeedResult {
  orgCount: number
  tierCount: number
  /** full tier 的 LinduoTierGrant 行数（每次 seed 都会全量重算） */
  fullGrants: number
}

/**
 * 给所有 org seed 3 个系统 tier（basic/advanced/full），并把 'full' 同步到所有 enabled CHAT 模型。
 */
export async function seedDefaultLinduoTiers(): Promise<LinduoTierSeedResult> {
  const orgs = await prisma.organization.findMany({ select: { id: true } })
  let tierCount = 0
  let fullGrants = 0

  for (const org of orgs) {
    // 1) upsert 3 个系统 tier
    for (const def of DEFAULT_LINDUO_TIERS) {
      await prisma.linduoModelTier.upsert({
        where: { orgId_key: { orgId: org.id, key: def.key } },
        create: {
          orgId: org.id,
          key: def.key,
          name: def.name,
          description: def.description,
          displayOrder: def.displayOrder,
          isSystem: def.isSystem
        },
        // 系统 tier 的元数据始终覆盖（保持与代码常量一致）
        // 自定义 tier（isSystem=false）不会被这段 update 命中
        update: {
          name: def.name,
          description: def.description,
          displayOrder: def.displayOrder,
          isSystem: def.isSystem
        }
      })
      tierCount += 1
    }

    // 2) 'full' tier 同步所有 enabled CHAT 模型（添加缺失的；不主动删除，避免破坏 admin 手动开/关）
    const fullTier = await prisma.linduoModelTier.findUnique({
      where: { orgId_key: { orgId: org.id, key: 'full' } }
    })
    if (!fullTier) continue
    const enabledModels = await prisma.linduoChatModel.findMany({
      where: { enabled: true },
      select: { id: true }
    })
    for (const model of enabledModels) {
      await prisma.linduoTierGrant.upsert({
        where: { tierId_modelId: { tierId: fullTier.id, modelId: model.id } },
        create: { tierId: fullTier.id, modelId: model.id },
        update: {}
      })
      fullGrants += 1
    }
  }

  return { orgCount: orgs.length, tierCount, fullGrants }
}

/**
 * 给所有 isOwner=true 的用户分配 'full' tier（核心"OWNER 全可见"承诺）。
 * 幂等：linduoTierId 已为 full 时 update 0 行。
 */
export async function assignOwnerLinduoTiers(): Promise<number> {
  const orgs = await prisma.organization.findMany({ select: { id: true } })
  let count = 0
  for (const org of orgs) {
    const fullTier = await prisma.linduoModelTier.findUnique({
      where: { orgId_key: { orgId: org.id, key: 'full' } }
    })
    if (!fullTier) continue
    const result = await prisma.user.updateMany({
      where: { orgId: org.id, isOwner: true, OR: [{ linduoTierId: null }, { linduoTierId: { not: fullTier.id } }] },
      data: { linduoTierId: fullTier.id }
    })
    count += result.count
  }
  return count
}
