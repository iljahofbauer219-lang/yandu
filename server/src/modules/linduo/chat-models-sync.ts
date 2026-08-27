// Linduo 聊天模型白名单启动同步（M1）：
// - 静态目录（linduoCatalog.ts 的 LINDUO_MODELS）新增的 modelId → INSERT enabled=true
// - 静态已有但 displayName / description / contextLabel / capabilities / vendor 变化 → UPDATE
//   （注意：enabled 不在这里改，保留管理员手动开关）
// - 静态移除的 modelId → UPDATE enabled=false（软关，保留 grants 历史）
//
// 启动时由 src/index.ts 在 app.listen() 之后调用；
// 失败仅 log.error（见 IIFE catch），不抛（不拖垮主服务）。

import { prisma } from '../../lib/prisma.js'
import { getLinduoChatModels } from './linduoCatalog.js'

export interface LinduoChatModelSyncResult {
  inserted: number
  updated: number
  disabled: number
}

/**
 * 启动时把静态 Linduo 目录里的 CHAT 模型同步进 DB。
 * - 新增 → INSERT
 * - 字段变化 → UPDATE（不动 enabled）
 * - 缺失 → 软关 enabled=false
 */
export async function syncLinduoChatModels(): Promise<LinduoChatModelSyncResult> {
  const target = getLinduoChatModels()
  const existing = await prisma.linduoChatModel.findMany()
  const existingById = new Map(existing.map(m => [m.modelId, m]))

  let inserted = 0
  let updated = 0
  let disabled = 0

  // 1. 处理 target 里的：新增 + 字段变化
  for (const model of target) {
    const row = existingById.get(model.id)
    if (!row) {
      await prisma.linduoChatModel.create({
        data: {
          modelId: model.id,
          vendor: model.vendor,
          displayName: model.name,
          description: model.description,
          contextLabel: model.contextLabel ?? null,
          capabilities: JSON.stringify(model.capabilities),
          effort: 'medium',
          enabled: true
        }
      })
      inserted += 1
      continue
    }
    const nextCapabilities = JSON.stringify(model.capabilities)
    const needUpdate =
      row.vendor !== model.vendor ||
      row.displayName !== model.name ||
      row.description !== model.description ||
      (row.contextLabel ?? null) !== (model.contextLabel ?? null) ||
      row.capabilities !== nextCapabilities
    if (needUpdate) {
      await prisma.linduoChatModel.update({
        where: { id: row.id },
        data: {
          vendor: model.vendor,
          displayName: model.name,
          description: model.description,
          contextLabel: model.contextLabel ?? null,
          capabilities: nextCapabilities
          // 注意：enabled 不在这里改，保留管理员手动开关
        }
      })
      updated += 1
    }
  }

  // 2. 处理 existing 但不在 target 的：软关（保留 grants 历史）
  const targetIds = new Set(target.map(m => m.id))
  for (const row of existing) {
    if (!targetIds.has(row.modelId) && row.enabled) {
      await prisma.linduoChatModel.update({
        where: { id: row.id },
        data: { enabled: false }
      })
      disabled += 1
    }
  }

  return { inserted, updated, disabled }
}

/**
 * 启动时给所有 isOwner=true 的用户自动加 kind=GRANT 的 UserLinduoException,
 * 覆盖所有 enabled LinduoChatModel(R-2 兼容旧 ensureOwnerLinduoGrants 行为)。
 * 幂等：upsert 多次跑也安全(UserLinduoException 复合主键 userId_modelId)。
 *
 * 注意：Task 2 引入 LinduoModelTier 'full' 后,OWNER 默认走 tier='full' 自动包含全部 enabled 模型,
 * 此函数可保留作为历史 fallback(seed 已建过 tier 时 no-op),也可在 Task 3 中改为幂等不重复写。
 */
export async function ensureOwnerLinduoExceptions(): Promise<number> {
  const owners = await prisma.user.findMany({
    where: { isOwner: true },
    select: { id: true }
  })
  const enabled = await prisma.linduoChatModel.findMany({
    where: { enabled: true },
    select: { id: true }
  })
  let count = 0
  for (const owner of owners) {
    for (const model of enabled) {
      await prisma.userLinduoException.upsert({
        where: { userId_modelId: { userId: owner.id, modelId: model.id } },
        create: { userId: owner.id, modelId: model.id, kind: 'GRANT' },
        update: { kind: 'GRANT' }
      })
      count += 1
    }
  }
  return count
}
