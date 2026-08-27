/**
 * Linduo 模型白名单解析器 —— R-2 核心公式
 *
 * getAvailableModelIdsForUser(userId):
 *   = (user.tier.grants ∪ { modelId | UserLinduoException(userId, modelId, 'GRANT') })
 *     − { modelId | UserLinduoException(userId, modelId, 'REVOKE') }
 *   （注：enabled 过滤由调用方决定，本函数返回纯 modelId Set）
 *
 * 使用方：
 * - server/src/modules/linduo/chat-routes.ts    → 校验 user 能否用 modelId 发起 chat
 * - server/src/modules/linduo/chat-models-routes.ts → /chat-models 端点返回当前用户可用模型
 * - 后续 audit / 计费 也可用本函数做"是否在白名单内"判断
 *
 * 性能：
 * - 1 次 user 查询 + 1 次 tier.grants 查询 + 1 次 user.exceptions 解析
 * - 不预热、无缓存：tier 与 exception 都很小，简化逻辑优先
 */
import type { LinduoChatModel } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'

/**
 * 返回 user 在 Linduo 模型白名单内可用的 LinduoChatModel.id 集合（未过滤 enabled）。
 */
export async function getAvailableModelIdsForUser(userId: string): Promise<Set<string>> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      linduoTierId: true,
      linduoExceptions: {
        select: { modelId: true, kind: true }
      }
    }
  })
  if (!user) return new Set()

  // 1) tier 默认 grant
  const tierGrantIds = new Set<string>()
  if (user.linduoTierId) {
    const tierGrants = await prisma.linduoTierGrant.findMany({
      where: { tierId: user.linduoTierId },
      select: { modelId: true }
    })
    for (const g of tierGrants) tierGrantIds.add(g.modelId)
  }

  // 2) user exceptions
  const grantAdd = new Set<string>()
  const revokeRemove = new Set<string>()
  for (const e of user.linduoExceptions) {
    if (e.kind === 'GRANT') grantAdd.add(e.modelId)
    else if (e.kind === 'REVOKE') revokeRemove.add(e.modelId)
  }

  // 3) 合并 + 排除
  const result = new Set<string>(tierGrantIds)
  for (const id of grantAdd) result.add(id)
  for (const id of revokeRemove) result.delete(id)

  return result
}

/**
 * 返回 user 在白名单内可用的 LinduoChatModel 完整对象（含 enabled 过滤、modelId 升序）。
 * 给 /chat-models 端点用，调用方拿到的是已经过完整白名单 + enabled 双重过滤的列表。
 */
export async function getAvailableModelsForUser(userId: string): Promise<LinduoChatModel[]> {
  const ids = await getAvailableModelIdsForUser(userId)
  if (ids.size === 0) return []
  return prisma.linduoChatModel.findMany({
    where: { id: { in: Array.from(ids) }, enabled: true },
    orderBy: { modelId: 'asc' }
  })
}

/**
 * 单点校验：user 是否能使用指定 modelId 发起 chat。
 * 给 chat-routes 用（替代 R-2 quick check 的"kind='GRANT' 例外"判断）。
 */
export async function userCanUseModel(userId: string, modelId: string): Promise<boolean> {
  const ids = await getAvailableModelIdsForUser(userId)
  return ids.has(modelId)
}
