/**
 * 零度API（api000.com）HTTP 转发共享 helper。
 *
 * 给主进程内多个 Linduo 服务类（LinduoLoginService / LinduoChatModelService / 未来）
 * 共享"Bearer + AbortController + 统一错误处理"调用模式，避免每个 service 自己写一份 fetch。
 */
import { readServerUrl } from '../serverConfig'

export function resolveBaseUrl(): string {
  return readServerUrl().replace(/\/+$/, '')
}

export function ensureToken(accessToken: string | null | undefined): string {
  if (!accessToken || typeof accessToken !== 'string') {
    throw new Error('未登录：请先在登录页完成认证')
  }
  return accessToken
}

export async function parseError(response: Response): Promise<Error> {
  let payload: { error?: string; message?: string } = {}
  try { payload = await response.json() } catch { /* 响应非 JSON */ }
  const message = payload.message || payload.error || `零度API 网关错误（HTTP ${response.status}）`
  return new Error(message)
}

/**
 * 转发请求到 `${serverUrl}/api/linduo${path}`，自动加 Bearer + AbortController timeout。
 * 204 直接返回 undefined，其它按 JSON 反序列化。
 */
export async function callLinduo<T>(
  accessToken: string,
  path: string,
  init: RequestInit,
  timeoutMs: number
): Promise<T> {
  const url = `${resolveBaseUrl()}/api/linduo${path}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(init.headers || {})
      },
      signal: controller.signal
    })
    if (!response.ok) throw await parseError(response)
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  } finally {
    clearTimeout(timer)
  }
}
