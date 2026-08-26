/**
 * Linduo 聊天模型选用 + 授权 IPC 桥（M1）。
 *
 * 与 server/src/modules/linduo/chat-models-routes.ts 对应的 8 个端点：
 * - listChatModels(accessToken)              → GET    /api/linduo/chat-models
 * - listAllChatModels(accessToken)           → GET    /api/linduo/chat-models/all
 * - setChatModelEnabled(accessToken, id, on) → PATCH  /api/linduo/chat-models/:id/enabled
 * - listGrants(accessToken)                  → GET    /api/linduo/grants
 * - setGrant(accessToken, userId, modelId)   → POST   /api/linduo/grants
 * - revokeGrant(accessToken, userId, modelId)→ DELETE /api/linduo/grants
 * - getPreferredModel(accessToken)           → GET    /api/linduo/preferred-model
 * - setPreferredModel(accessToken, modelId)  → PUT    /api/linduo/preferred-model
 *
 * 所有方法都经 callLinduo 统一加 Bearer + AbortController + 错误处理。
 */
import type { LinduoChatModelView, UserLinduoGrantView } from '../../shared/contracts'
import { callLinduo, ensureToken } from './linduoHttp.js'

const TIMEOUT_MS = 30_000

export interface UserLinduoGrantWithUserName extends UserLinduoGrantView {
  userName: string
}

export interface LinduoGrantMutationResult {
  userId: string
  modelId: string
  grantedBy: string
  grantedAt: string
}

export interface LinduoPreferredModelResult {
  modelId: string | null
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

  /** 拉取用户授权表（带 userName 扩展） */
  async listGrants(accessToken: string | null | undefined): Promise<UserLinduoGrantWithUserName[]> {
    const token = ensureToken(accessToken)
    return callLinduo<UserLinduoGrantWithUserName[]>(token, '/grants', { method: 'GET' }, TIMEOUT_MS)
  }

  /** 授予某用户某模型 */
  async setGrant(
    accessToken: string | null | undefined,
    userId: string,
    modelId: string
  ): Promise<LinduoGrantMutationResult> {
    const token = ensureToken(accessToken)
    return callLinduo<LinduoGrantMutationResult>(
      token,
      '/grants',
      { method: 'POST', body: JSON.stringify({ userId, modelId }) },
      TIMEOUT_MS
    )
  }

  /** 撤销某用户某模型授权 */
  async revokeGrant(
    accessToken: string | null | undefined,
    userId: string,
    modelId: string
  ): Promise<{ ok: true }> {
    const token = ensureToken(accessToken)
    return callLinduo<{ ok: true }>(
      token,
      '/grants',
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
}
