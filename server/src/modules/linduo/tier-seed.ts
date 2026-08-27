import { prisma } from '../../lib/prisma.js'
import { writeAudit } from '../../lib/audit.js'

// ─── Tier 定义与默认模型集 ───

interface TierDef { key: 'basic' | 'advanced' | 'full'; name: string; description: string; isSystem: boolean }

const TIER_DEFS: TierDef[] = [
  { key: 'basic', name: '基础组', description: '轻量模型,适合简单问答与草稿', isSystem: true },
  { key: 'advanced', name: '进阶组', description: '中阶模型,适合日常运营(选品/Listing/分析)', isSystem: true },
  { key: 'full', name: '全开组', description: '全部启用对话模型,主账号默认', isSystem: true }
]

/** 进阶组默认 13 模型（中阶日常运营：轻量批量 + 主力写作；旗舰/高价款留给全开组）。
 * 依据 2026-08 新 catalog（37 模型）选型，旧 catalog 的 gpt-4-turbo/claude-3.5/gemini-1.5 等已下架。
 * 仅首次建 tier 时灌入，之后尊重管理员调整。 */
const ADVANCED_DEFAULT_MODEL_IDS = [
  // OpenAI 6：多模态主力 + 低成本批量款
  'gpt-4o', 'gpt-4o-mini', 'gpt-5', 'gpt-5-mini', 'gpt-5.4-mini', 'gpt-5.6-luna',
  // Google 4：轻量高性价比款
  'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.1-flash', 'gemini-3.1-flash-lite',
  // Anthropic 3：分类打标 + Listing 写作主力
  'claude-haiku-4-5', 'claude-sonnet-4', 'claude-sonnet-4-5'
] as const

// ─── 公开入口 ───

/** 幂等（spec §4.2）：为全部现存组织逐家种子三组。启动时调用。 */
export async function seedDefaultLinduoTiers(): Promise<{ orgCount: number; tierCount: number; fullGrants: number }> {
  const orgs = await prisma.organization.findMany({ select: { id: true } })
  let tierCount = 0
  let fullGrants = 0
  for (const org of orgs) {
    const result = await ensureOrgDefaultTiers(org.id)
    tierCount += result.tiersCreated
    fullGrants += result.grantsSynced
  }
  return { orgCount: orgs.length, tierCount, fullGrants }
}

/**
 * 为单个组织种子三组 + 回填用户等级。注册新组织 / 启动兜底都走这里。
 *
 * - 三组按 (orgId, key) upsert；
 * - 进阶组 13 个默认授权只在「首次建 tier」时灌入（避免覆盖管理员手工调整）；
 * - 全开组每次启动「补缺不删」同步全部启用模型；
 * - OWNER 每次强制进全开组（spec §12，幂等）；
 * - 非 OWNER 仅在组织「首次种子」时回填 null → 进阶组（尊重管理员后续改「无组」）。
 *
 * @returns tiersCreated=本次新建的 tier 数，grantsSynced=本次灌入的 grant 数
 */
export async function ensureOrgDefaultTiers(orgId: string): Promise<{ tiersCreated: number; grantsSynced: number }> {
  const existingTierCount = await prisma.linduoModelTier.count({ where: { orgId } })
  const firstSeed = existingTierCount === 0
  let tiersCreated = 0
  let grantsSynced = 0

  for (const def of TIER_DEFS) {
    const existing = await prisma.linduoModelTier.findUnique({
      where: { orgId_key: { orgId, key: def.key } }
    })
    if (!existing) {
      const tier = await prisma.linduoModelTier.create({
        data: { orgId, key: def.key, name: def.name, description: def.description, isSystem: def.isSystem }
      })
      if (def.key === 'advanced') grantsSynced += await seedAdvancedGrants(tier.id, orgId)
      tiersCreated++
    } else {
      await prisma.linduoModelTier.update({
        where: { id: existing.id },
        data: { name: def.name, description: def.description }
      })
      if (def.key === 'full') grantsSynced += await syncFullGrants(existing.id, orgId)
    }
  }

  await forceOwnersToFull(orgId)

  if (firstSeed) {
    const backfilled = await backfillNonOwnersToAdvanced(orgId)
    if (backfilled > 0) {
      await writeAudit(prisma, {
        orgId, userId: 'system', action: 'linduo.tier.seed',
        targetType: 'user', targetId: orgId,
        detail: { kind: 'tier-backfill', count: backfilled }
      })
    }
  }
  return { tiersCreated, grantsSynced }
}

/** 启动兜底：确保所有组织的 OWNER 都在全开组（spec §12）。返回调整人数。 */
export async function assignOwnerLinduoTiers(): Promise<number> {
  const orgs = await prisma.organization.findMany({ select: { id: true } })
  let count = 0
  for (const org of orgs) {
    count += await forceOwnersToFull(org.id)
  }
  return count
}

/** 新成员审核通过后默认进进阶组（spec §10 验收 #4）。找不到进阶组时返回 null。 */
export async function assignDefaultTierToNewUser(userId: string, orgId: string): Promise<string | null> {
  const advanced = await prisma.linduoModelTier.findFirst({
    where: { orgId, key: 'advanced' }, select: { id: true }
  })
  if (!advanced) return null
  await prisma.user.update({ where: { id: userId }, data: { linduoTierId: advanced.id } })
  return advanced.id
}

// ─── 内部实现 ───

/** 全开组同步：把全局全部启用模型灌进 grants；管理员移除过的不补回（幂等补缺不删）。返回新增数。 */
async function syncFullGrants(tierId: string, orgId: string): Promise<number> {
  const enabledModels = await prisma.linduoChatModel.findMany({
    where: { enabled: true },
    select: { id: true }
  })
  if (enabledModels.length === 0) return 0

  const existing = await prisma.linduoTierGrant.findMany({
    where: { tierId },
    select: { modelId: true }
  })
  const existingSet = new Set(existing.map(g => g.modelId))
  const missing = enabledModels.filter(m => !existingSet.has(m.id))
  if (missing.length === 0) return 0

  await prisma.linduoTierGrant.createMany({
    data: missing.map(m => ({ orgId, tierId, modelId: m.id }))
  })
  return missing.length
}

/** 进阶组默认 13 授权灌入（仅首次建 tier 时调用，且只灌当前 enabled 的）。返回灌入数。 */
async function seedAdvancedGrants(tierId: string, orgId: string): Promise<number> {
  const models = await prisma.linduoChatModel.findMany({
    where: { modelId: { in: [...ADVANCED_DEFAULT_MODEL_IDS] }, enabled: true },
    select: { id: true }
  })
  if (models.length === 0) return 0
  await prisma.linduoTierGrant.createMany({
    data: models.map(m => ({ orgId, tierId, modelId: m.id }))
  })
  return models.length
}

/** OWNER 强制进全开组（幂等；OWNER 的 tier 不允许手工改，见 spec §12）。 */
async function forceOwnersToFull(orgId: string): Promise<number> {
  const fullTier = await prisma.linduoModelTier.findFirst({
    where: { orgId, key: 'full' }, select: { id: true }
  })
  if (!fullTier) return 0
  const result = await prisma.user.updateMany({
    where: {
      orgId,
      isOwner: true,
      OR: [{ linduoTierId: null }, { linduoTierId: { not: fullTier.id } }]
    },
    data: { linduoTierId: fullTier.id }
  })
  return result.count
}

/** 非 OWNER 且无组的用户回填进进阶组（仅组织首次种子时调用）。 */
async function backfillNonOwnersToAdvanced(orgId: string): Promise<number> {
  const advanced = await prisma.linduoModelTier.findFirst({
    where: { orgId, key: 'advanced' }, select: { id: true }
  })
  if (!advanced) return 0
  const result = await prisma.user.updateMany({
    where: { orgId, isOwner: false, linduoTierId: null },
    data: { linduoTierId: advanced.id }
  })
  return result.count
}
