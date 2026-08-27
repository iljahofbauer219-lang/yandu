/**
 * 渲染层服务端 API（多人化改造阶段 4）。
 * HTTP 核心在 src/shared/serverHttp.ts（与 preload 共用，token 经 localStorage 跨世界同步）；
 * 本模块只保留认证高级 API 与权限工具。
 */
import type { AuthTokens, UserProfile } from '../shared/serverHttp'
import { ApiError, apiFetch, clearSession, getTokens, saveProfile, saveTokens } from '../shared/serverHttp'
import type { DashboardSummary } from '../shared/dashboard'
import type { LinduoChatModelView, LinduoMemberTierView, LinduoModelTierView, UserLinduoExceptionView } from '../shared/contracts'

export {
  ApiError,
  SESSION_EXPIRED_EVENT,
  apiFetch,
  clearSession,
  getCachedProfile,
  getServerBaseUrl,
  getStoredServerUrl,
  getTokens,
  setServerBaseUrl
} from '../shared/serverHttp'
export type { AuthTokens, SessionStore, UserProfile } from '../shared/serverHttp'

export async function login(email: string, password: string): Promise<UserProfile> {
  const data = await apiFetch<{ tokens: AuthTokens; user: UserProfile }>('/api/auth/login', {
    body: { email, password },
    auth: false
  })
  saveTokens(data.tokens)
  saveProfile(data.user)
  return data.user
}

export interface RegisterResult {
  /** true=注册申请已提交待审核；false/undefined=首次安装主帐号直接登录 */
  pending?: boolean
  message?: string
  profile?: UserProfile
}

export async function registerOrg(input: { name: string; email: string; password: string }): Promise<RegisterResult> {
  const data = await apiFetch<{ tokens?: AuthTokens; user?: UserProfile; pending?: boolean; message?: string }>('/api/auth/register', {
    body: input,
    auth: false
  })
  if (data.pending) return { pending: true, message: data.message }
  if (data.tokens && data.user) {
    saveTokens(data.tokens)
    saveProfile(data.user)
    return { pending: false, profile: data.user }
  }
  throw new ApiError(500, 'BAD_RESPONSE', '注册响应异常')
}

export async function logout(): Promise<void> {
  const tokens = getTokens()
  try {
    if (tokens) {
      await apiFetch('/api/auth/logout', { body: { refreshToken: tokens.refreshToken } })
    }
  } catch { /* 网络失败也本地登出 */ }
  clearSession()
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  await apiFetch('/api/auth/change-password', { body: { oldPassword, newPassword } })
  // 服务端吊销全部刷新令牌，本地需重新登录
  clearSession()
}

/** 拉取最新本人信息（权限/店铺授权可能已被主帐号调整）；401 会走刷新，仍失败则由调用方回登录页 */
export async function fetchProfile(): Promise<UserProfile> {
  const profile = await apiFetch<UserProfile>('/api/auth/me', { method: 'GET' })
  saveProfile(profile)
  return profile
}

export function hasPermission(profile: UserProfile | null | undefined, code: string): boolean {
  if (!profile) return false
  if (profile.isOwner || profile.permissions === 'ALL') return true
  return profile.permissions.includes(code)
}

// ---------------------------------------------------------------- 成员管理 API

export interface MemberView {
  id: string
  email: string
  name: string
  isOwner: boolean
  status: string
  mustChangePassword: boolean
  lastLoginAt: string | null
  createdAt: string
  roles: { id: string; key: string | null; name: string }[]
  stores: { id: string; name: string; marketplaceId: string }[]
}

export interface RoleView {
  id: string
  key: string | null
  name: string
  isSystem: boolean
  permissions: string[]
  memberCount: number
  createdAt: string
}

export async function fetchMembers(): Promise<MemberView[]> {
  return apiFetch<MemberView[]>('/api/members', { method: 'GET' })
}

export async function createMember(input: { email: string; name: string; password: string; roleIds?: string[]; permissions?: string[]; storeIds?: string[] }): Promise<MemberView> {
  return apiFetch<MemberView>('/api/members', { body: input })
}

export async function updateMember(id: string, input: { name?: string; roleIds?: string[]; status?: 'ACTIVE' | 'DISABLED' }): Promise<MemberView> {
  return apiFetch<MemberView>(`/api/members/${id}`, { method: 'PATCH', body: input })
}

export async function resetMemberPassword(id: string, password: string): Promise<void> {
  await apiFetch(`/api/members/${id}/reset-password`, { body: { password } })
}

export async function updateMemberPermissions(id: string, permissions: string[]): Promise<void> {
  await apiFetch(`/api/members/${id}/permissions`, { method: 'PUT', body: { permissions } })
}

export async function deleteMember(id: string): Promise<void> {
  await apiFetch(`/api/members/${id}`, { method: 'DELETE' })
}

export async function fetchRoles(): Promise<RoleView[]> {
  return apiFetch<RoleView[]>('/api/roles', { method: 'GET' })
}

export async function fetchPendingMembers(): Promise<MemberView[]> {
  return apiFetch<MemberView[]>('/api/members/pending', { method: 'GET' })
}

export async function approveMember(id: string, permissions: string[]): Promise<MemberView> {
  return apiFetch<MemberView>(`/api/members/${id}/approve`, { body: { permissions } })
}

export async function rejectMember(id: string): Promise<void> {
  await apiFetch(`/api/members/${id}/reject`, { body: {} })
}

// K 阶段新增：团队工作台聚合接口
// - OWNER / OPERATOR：返回完整 kpis + myTodos + teamActivities
// - PUBLISHER：仅自己的 kpis + myTodos，无 teamActivities
// - VIEWER：仅 kpis（隐藏 myTodos / teamActivities）
export async function fetchDashboardSummary(): Promise<DashboardSummary> {
  return apiFetch<DashboardSummary>('/api/dashboard/summary', { method: 'GET' })
}

// ===================== Linduo 聊天模型选用 (M1) =====================

export async function fetchLinduoChatModels(): Promise<LinduoChatModelView[]> {
  return apiFetch<LinduoChatModelView[]>('/api/linduo/chat-models', { method: 'GET' })
}

export async function fetchAllLinduoChatModels(): Promise<LinduoChatModelView[]> {
  return apiFetch<LinduoChatModelView[]>('/api/linduo/chat-models/all', { method: 'GET' })
}

export async function setLinduoChatModelEnabled(id: string, enabled: boolean): Promise<LinduoChatModelView> {
  return apiFetch<LinduoChatModelView>(`/api/linduo/chat-models/${encodeURIComponent(id)}/enabled`, {
    method: 'PATCH',
    body: { enabled }
  })
}

export async function fetchLinduoExceptions(): Promise<Array<UserLinduoExceptionView & { userName: string }>> {
  return apiFetch<Array<UserLinduoExceptionView & { userName: string }>>('/api/linduo/exceptions', { method: 'GET' })
}

export async function setLinduoException(userId: string, modelId: string, kind: 'GRANT' | 'REVOKE'): Promise<void> {
  await apiFetch('/api/linduo/exceptions', { method: 'POST', body: { userId, modelId, kind } })
}

export async function revokeLinduoException(userId: string, modelId: string): Promise<void> {
  await apiFetch('/api/linduo/exceptions', { method: 'DELETE', body: { userId, modelId } })
}

// ---- Linduo Tier 端点 (R-2) ----

export async function fetchLinduoTiers(): Promise<LinduoModelTierView[]> {
  return apiFetch<LinduoModelTierView[]>('/api/linduo/tiers', { method: 'GET' })
}

export async function fetchLinduoTierModels(tierId: string): Promise<{ tier: LinduoModelTierView; models: LinduoChatModelView[] }> {
  return apiFetch<{ tier: LinduoModelTierView; models: LinduoChatModelView[] }>(`/api/linduo/tiers/${encodeURIComponent(tierId)}/models`, { method: 'GET' })
}

export async function setLinduoTierModels(tierId: string, modelIds: string[]): Promise<LinduoModelTierView> {
  return apiFetch<LinduoModelTierView>(`/api/linduo/tiers/${encodeURIComponent(tierId)}/models`, {
    method: 'PUT',
    body: { modelIds }
  })
}

export async function fetchLinduoMemberTier(memberId: string): Promise<LinduoMemberTierView> {
  return apiFetch<LinduoMemberTierView>(`/api/linduo/members/${encodeURIComponent(memberId)}/tier-and-exceptions`, { method: 'GET' })
}

export async function setLinduoMemberTier(memberId: string, tierId: string | null): Promise<LinduoMemberTierView> {
  return apiFetch<LinduoMemberTierView>(`/api/linduo/members/${encodeURIComponent(memberId)}/tier`, {
    method: 'PUT',
    body: { tierId }
  })
}

export async function fetchLinduoMyTierAndExceptions(): Promise<LinduoMemberTierView> {
  return apiFetch<LinduoMemberTierView>('/api/linduo/me/tier-and-exceptions', { method: 'GET' })
}

export async function fetchLinduoPreferredModel(): Promise<{ modelId: string | null }> {
  return apiFetch<{ modelId: string | null }>('/api/linduo/preferred-model', { method: 'GET' })
}

export async function setLinduoPreferredModel(modelId: string | null): Promise<{ modelId: string | null }> {
  return apiFetch<{ modelId: string | null }>('/api/linduo/preferred-model', { method: 'PUT', body: { modelId } })
}
