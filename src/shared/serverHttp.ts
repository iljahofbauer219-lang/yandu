/**
 * 中心服务端 HTTP 核心（多人化改造阶段 4）。
 * 同时被渲染层（vite/ESM）与 preload（tsc/CJS）引用，只用 Web API，零 Electron/Node 依赖。
 *
 * 设计要点：
 * - token 存 localStorage：contextIsolation 下 preload 世界与渲染世界按 origin 共享，天然同步
 * - 401 → 刷新 → 重放一次；刷新用 localStorage 锁做跨世界单 flight（两个隔离世界可能同时 401，
 *   而服务端刷新令牌是旋转的，并发刷新必有一方拿到已吊销的旧令牌被误判"会话过期"）
 * - 刷新失败：清空会话并广播 SESSION_EXPIRED_EVENT（DOM 事件跨隔离世界传播），SessionGate 回登录页
 */

export interface AuthTokens {
  accessToken: string
  refreshToken: string
  refreshTokenExpiresAt: string
}

export interface SessionStore {
  id: string
  name: string
  marketplaceId: string
}

export interface UserProfile {
  id: string
  email: string
  name: string
  isOwner: boolean
  status: string
  mustChangePassword: boolean
  lastLoginAt: string | null
  org: { id: string; name: string }
  roles: Array<{ id: string; key: string; name: string }>
  permissions: 'ALL' | string[]
  stores: SessionStore[] | null
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public issues?: Array<{ path: string; message: string }>
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const TOKENS_KEY = 'sourcing.auth.tokens:v1'
const PROFILE_KEY = 'sourcing.auth.profile:v1'
const SERVER_URL_KEY = 'sourcing.server-url:v1'
const REFRESH_LOCK_KEY = 'sourcing.auth.refresh-lock:v1'
const REFRESH_LOCK_TTL_MS = 20_000
// 默认指向中央服务器（S2 远程模式）；本机开发可在登录页「服务器」折叠区改回 http://127.0.0.1:8787
const DEFAULT_SERVER_URL = 'https://114.55.149.192'

export const SESSION_EXPIRED_EVENT = 'sourcing:session-expired'

export function getServerBaseUrl(): string {
  return (getStoredServerUrl() || DEFAULT_SERVER_URL).replace(/\/+$/, '')
}

/** localStorage 中显式保存过的服务器地址；未保存返回空串（不含默认值） */
export function getStoredServerUrl(): string {
  try { return (localStorage.getItem(SERVER_URL_KEY) ?? '').trim() } catch { return '' }
}

export function setServerBaseUrl(url: string) {
  try {
    const trimmed = url.trim().replace(/\/+$/, '')
    if (trimmed) localStorage.setItem(SERVER_URL_KEY, trimmed)
    else localStorage.removeItem(SERVER_URL_KEY)
  } catch { /* 忽略持久化失败 */ }
}

export function getTokens(): AuthTokens | null {
  try {
    const raw = localStorage.getItem(TOKENS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AuthTokens
    return parsed && typeof parsed.accessToken === 'string' && typeof parsed.refreshToken === 'string' ? parsed : null
  } catch {
    return null
  }
}

export function saveTokens(tokens: AuthTokens) {
  try { localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens)) } catch { /* 忽略 */ }
}

export function getCachedProfile(): UserProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as UserProfile
    return parsed && typeof parsed.id === 'string' ? parsed : null
  } catch {
    return null
  }
}

export function saveProfile(profile: UserProfile | null) {
  try {
    if (profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
    else localStorage.removeItem(PROFILE_KEY)
  } catch { /* 忽略 */ }
}

export function clearSession() {
  try {
    localStorage.removeItem(TOKENS_KEY)
    localStorage.removeItem(PROFILE_KEY)
  } catch { /* 忽略 */ }
}

function notifySessionExpired() {
  clearSession()
  try { window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT)) } catch { /* 非 DOM 环境忽略 */ }
}

// ---------------------------------------------------------------- 跨世界刷新锁

function readRefreshLock(): { token: string; expires: number } | null {
  try {
    const raw = localStorage.getItem(REFRESH_LOCK_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { token?: unknown; expires?: unknown }
    return typeof parsed.token === 'string' && typeof parsed.expires === 'number' ? { token: parsed.token, expires: parsed.expires } : null
  } catch {
    return null
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * 刷新会话（旋转刷新令牌）。跨世界单 flight：
 * 1) 若其它世界持锁，等其完成（锁带 TTL 防死锁），完成后本世界 re-read token 已变即视为成功
 * 2) 本世界抢锁后二次确认 token 未变（可能等待期间其它世界已完成），再真正请求 /auth/refresh
 */
async function doRefreshShared(staleAccessToken: string): Promise<boolean> {
  for (let waited = 0; waited < REFRESH_LOCK_TTL_MS; waited += 400) {
    const lock = readRefreshLock()
    if (!lock || lock.expires < Date.now()) break
    await sleep(400)
  }
  if (getTokens()?.accessToken !== staleAccessToken) return true
  const lockId = `${Date.now()}:${Math.random()}`
  try {
    localStorage.setItem(REFRESH_LOCK_KEY, JSON.stringify({ token: lockId, expires: Date.now() + REFRESH_LOCK_TTL_MS }))
  } catch { /* 忽略 */ }
  try {
    // 抢锁后二次确认
    if (getTokens()?.accessToken !== staleAccessToken) return true
    const tokens = getTokens()
    if (!tokens) return false
    const response = await fetch(`${getServerBaseUrl()}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refreshToken })
    })
    if (!response.ok) return false
    const data = await response.json() as { tokens?: AuthTokens }
    if (!data.tokens?.accessToken) return false
    saveTokens(data.tokens)
    return true
  } catch {
    return false
  } finally {
    try {
      const lock = readRefreshLock()
      if (lock?.token === lockId) localStorage.removeItem(REFRESH_LOCK_KEY)
    } catch { /* 忽略 */ }
  }
}

// 世界内单 flight（同世界并发 401 只刷一次）
let refreshPromise: Promise<boolean> | null = null

export function refreshSession(staleAccessToken: string): Promise<boolean> {
  refreshPromise ??= doRefreshShared(staleAccessToken).finally(() => { refreshPromise = null })
  return refreshPromise
}

// ---------------------------------------------------------------- apiFetch

async function parseError(response: Response): Promise<ApiError> {
  let payload: { error?: string; message?: string; issues?: Array<{ path: string; message: string }> } = {}
  try { payload = await response.json() } catch { /* 非 JSON 响应 */ }
  return new ApiError(
    response.status,
    payload.error ?? `HTTP_${response.status}`,
    payload.message ?? `请求失败（HTTP ${response.status}）`,
    payload.issues
  )
}

export interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  /** 默认 true：携带 Authorization，401 时刷新后重放一次 */
  auth?: boolean
  /** query 参数（undefined 值忽略） */
  query?: Record<string, string | number | boolean | undefined>
}

export async function apiFetch<T = unknown>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { method = options.body === undefined ? 'GET' : 'POST', body, auth = true, query } = options
  const send = async (accessToken: string | null) => {
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (auth) {
      if (!accessToken) throw new ApiError(401, 'UNAUTHORIZED', '未登录')
      headers.authorization = `Bearer ${accessToken}`
    }
    const search = query
      ? Object.entries(query).filter(([, value]) => value !== undefined && value !== '')
          .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&')
      : ''
    return fetch(`${getServerBaseUrl()}${path}${search ? `?${search}` : ''}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  }
  let tokens = getTokens()
  let response = await send(tokens?.accessToken ?? null)
  if (response.status === 401 && auth && tokens) {
    const refreshed = await refreshSession(tokens.accessToken)
    if (!refreshed) {
      notifySessionExpired()
      throw new ApiError(401, 'SESSION_EXPIRED', '登录已过期，请重新登录')
    }
    tokens = getTokens()
    response = await send(tokens?.accessToken ?? null)
    if (response.status === 401) {
      notifySessionExpired()
      throw await parseError(response)
    }
  }
  if (!response.ok) throw await parseError(response)
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}
