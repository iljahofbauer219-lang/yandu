/**
 * Linduo 聊天模型选用 + 例外 + Tier IPC 桥 (M1/R-2)。
 *
 * 与 server/src/modules/linduo/chat-models-routes.ts 对应的 13 个端点：
 *
 * 原 8 个：
 * - listChatModels(accessToken)              → GET    /api/linduo/chat-models
 * - listAllChatModels(accessToken)           → GET    /api/linduo/chat-models/all
 * - setChatModelEnabled(accessToken, id, on) → PATCH  /api/linduo/chat-models/:id/enabled
 * - listExceptions(accessToken)               → GET    /api/linduo/exceptions
 * - setException(accessToken, userId, modelId, kind) → POST   /api/linduo/exceptions
 * - revokeException(accessToken, userId, modelId)   → DELETE /api/linduo/exceptions
 * - getPreferredModel(accessToken)           → GET    /api/linduo/preferred-model
 * - setPreferredModel(accessToken, modelId)  → PUT    /api/linduo/preferred-model
 *
 * R-2 新增 5 个：
 * - listTiers(accessToken)                                       → GET    /api/linduo/tiers
 * - getTierModels(accessToken, tierId)                           → GET    /api/linduo/tiers/:id/models
 * - setTierModels(accessToken, tierId, modelIds)                 → PUT    /api/linduo/tiers/:id/models
 * - getMemberTierAndExceptions(accessToken, memberId)            → GET    /api/linduo/members/:id/tier-and-exceptions
 * - setMemberTier(accessToken, memberId, tierId)                 → PUT    /api/linduo/members/:id/tier
 * - getMyTierAndExceptions(accessToken)                         → GET    /api/linduo/me/tier-and-exceptions
 *
 * 所有方法都经 callLinduo 统一加 Bearer + AbortController + 错误处理。
 */
import type {
  LinduoChatModelView,
  LinduoMemberTierView,
  LinduoModelTierView,
  UserLinduoExceptionView
} from '../../shared/contracts'
import { callLinduo, ensureToken } from './linduoHttp.js'

const TIMEOUT_MS = 30_000

export interface UserLinduoExceptionWithUserName extends UserLinduoExceptionView {
  userName: string
}

export interface LinduoExceptionMutationResult {
  userId: string
  modelId: string
  kind: 'GRANT' | 'REVOKE'
  grantedBy: string
  grantedAt: string
}

export interface LinduoPreferredModelResult {
  modelId: string | null
}

export interface LinduoTierWithModelsResult {
  tier: LinduoModelTierView
  models: LinduoChatModelView[]
}

export class LinduoChatModelService {
  /** 当前用户的可见模型列表（受 enabled + grants 过滤） */
  async listChatModels(accessToken: string | null | undefined): Promise<LinduoChatModelView[]> {
    const token = ensureToken(accessToken)
    return callLinduo<LinduoChatModelView[]>(token, '/chat-models', { method: 'GET' }, TIMEOUT_MS)
  }

  /** 全量模型列表（管理视图，admin 可见全部） */
  async listAllChatModels(accessToken: string | null | undefined): Promise<LinduoChatModelView[]> {
    const token = ensureToken(accessToken)
    return callLinduo<LinduoChatModelView[]>(token, '/chat-models/all', { method: 'GET' }, TIMEOUT_MS)
  }

  /** 切换单模型启用/禁用（admin） */
  async setChatModelEnabled(
    accessToken: string | null | undefined,
    id: string,
    enabled: boolean
  ): Promise<LinduoChatModelView> {
    const token = ensureToken(accessToken)
    return callLinduo<LinduoChatModelView>(
      token,
      `/chat-models/${encodeURIComponent(id)}/enabled`,
      { method: 'PATCH', body: JSON.stringify({ enabled }) },
      TIMEOUT_MS
    )
  }

  /** 拉取用户例外表（带 userName 扩展）—— R-2 后包含 kind=GRANT/REVOKE */
  async listExceptions(accessToken: string | null | undefined): Promise<UserLinduoExceptionWithUserName[]> {
    const token = ensureToken(accessToken)
    return callLinduo<UserLinduoExceptionWithUserName[]>(token, '/exceptions', { method: 'GET' }, TIMEOUT_MS)
  }

  /** 提交某用户某模型例外(GRANT=额外开 / REVOKE=额外关) */
  async setException(
    accessToken: string | null | undefined,
    userId: string,
    modelId: string,
    kind: 'GRANT' | 'REVOKE'
  ): Promise<LinduoExceptionMutationResult> {
    const token = ensureToken(accessToken)
    return callLinduo<LinduoExceptionMutationResult>(
      token,
      '/exceptions',
      { method: 'POST', body: JSON.stringify({ userId, modelId, kind }) },
      TIMEOUT_MS
    )
  }

  /** 撤销某用户某模型例外 */
  async revokeException(
    accessToken: string | null | undefined,
    userId: string,
    modelId: string
  ): Promise<{ ok: true }> {
    const token = ensureToken(accessToken)
    return callLinduo<{ ok: true }>(
      token,
      '/exceptions',
      { method: 'DELETE', body: JSON.stringify({ userId, modelId }) },
      TIMEOUT_MS
    )
  }

  /** 拉取当前用户的偏好模型（默认选择） */
  async getPreferredModel(accessToken: string | null | undefined): Promise<LinduoPreferredModelResult> {
    const token = ensureToken(accessToken)
    return callLinduo<LinduoPreferredModelResult>(token, '/preferred-model', { method: 'GET' }, TIMEOUT_MS)
  }

  /** 设置当前用户的偏好模型（null 表示清除） */
  async setPreferredModel(
    accessToken: string | null | undefined,
    modelId: string | null
  ): Promise<LinduoPreferredModelResult> {
    const token = ensureToken(accessToken)
    return callLinduo<LinduoPreferredModelResult>(
      token,
      '/preferred-model',
      { method: 'PUT', body: JSON.stringify({ modelId }) },
      TIMEOUT_MS
    )
  }

  // ============ R-2 新增：Tier 端点 ============

  /** 列出 org 下的所有 LinduoModelTier(admin) */
  async listTiers(accessToken: string | null | undefined): Promise<LinduoModelTierView[]> {
    const token = ensureToken(accessToken)
    return callLinduo<LinduoModelTierView[]>(token, '/tiers', { method: 'GET' }, TIMEOUT_MS)
  }

  /** 拉取指定 tier 的模型详情(admin) */
  async getTierModels(
    accessToken: string | null | undefined,
    tierId: string
  ): Promise<LinduoTierWithModelsResult> {
    const token = ensureToken(accessToken)
    return callLinduo<LinduoTierWithModelsResult>(
      token,
      `/tiers/${encodeURIComponent(tierId)}/models`,
      { method: 'GET' },
      TIMEOUT_MS
    )
  }

  /** 设置 tier 的模型列表(全量覆盖,admin) */
  async setTierModels(
    accessToken: string | null | undefined,
    tierId: string,
    modelIds: string[]
  ): Promise<LinduoModelTierView> {
    const token = ensureToken(accessToken)
    return callLinduo<LinduoModelTierView>(
      token,
      `/tiers/${encodeURIComponent(tierId)}/models`,
      { method: 'PUT', body: JSON.stringify({ modelIds }) },
      TIMEOUT_MS
    )
  }

  /** 拉取成员的 tier + exceptions 汇总(admin,用于 LinduoAssignmentModal) */
  async getMemberTierAndExceptions(
    accessToken: string | null | undefined,
    memberId: string
  ): Promise<LinduoMemberTierView> {
    const token = ensureToken(accessToken)
    return callLinduo<LinduoMemberTierView>(
      token,
      `/members/${encodeURIComponent(memberId)}/tier-and-exceptions`,
      { method: 'GET' },
      TIMEOUT_MS
    )
  }

  /** 设置成员的 tier(null = 清除,仅依赖 exceptions;admin) */
  async setMemberTier(
    accessToken: string | null | undefined,
    memberId: string,
    tierId: string | null
  ): Promise<LinduoMemberTierView> {
    const token = ensureToken(accessToken)
    return callLinduo<LinduoMemberTierView>(
      token,
      `/members/${encodeURIComponent(memberId)}/tier`,
      { method: 'PUT', body: JSON.stringify({ tierId }) },
      TIMEOUT_MS
    )
  }

  /** 拉取当前用户自己的 tier + exceptions 汇总(无需 admin,供 LinduoPreferenceModal) */
  async getMyTierAndExceptions(
    accessToken: string | null | undefined
  ): Promise<LinduoMemberTierView> {
    const token = ensureToken(accessToken)
    return callLinduo<LinduoMemberTierView>(
      token,
      '/me/tier-and-exceptions',
      { method: 'GET' },
      TIMEOUT_MS
    )
  }
}
