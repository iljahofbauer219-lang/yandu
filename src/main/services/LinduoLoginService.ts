/**
 * 零度API（api000.com）登录与价格抓取 IPC 桥。
 *
 * 设计：
 * - 渲染层持有访问令牌（存于 localStorage 的 sourcing.auth.tokens:v1），调用本服务时把 accessToken 作为首参传入
 * - 主进程依据 serverConfig 读取当前 Fastify 服务地址，统一加 Bearer 后调用 /api/linduo/*
 * - 价格抓取（playwright）跑在 Fastify 服务端，主进程只做 HTTP 转发，不本地启动浏览器
 * - 渲染层已登录（apiFetch 自动处理 401 + 刷新）后再调用本桥；token 失效由 Fastify 401 透传回 ApiError
 *
 * 入口（与 pricing-routes.ts 对应）：
 * - getLoginStatus(accessToken)               → GET  /api/linduo/login/status
 * - login(accessToken, username, password)   → POST /api/linduo/login
 * - logout(accessToken)                      → POST /api/linduo/logout
 * - getPricing(accessToken)                  → GET  /api/linduo/pricing
 * - refreshPricing(accessToken, credentials?)→ POST /api/linduo/pricing/refresh
 */
import type {
  LinduoLoginStatus,
  LinduoModelPricing,
  LinduoPricingListResponse,
  LinduoPricingRefreshResult
} from '../../shared/contracts'
import { callLinduo, ensureToken } from './linduoHttp.js'

const REFRESH_TIMEOUT_MS = 180_000
/** GET 状态/价格一般几十毫秒，但留 30s 防网络抖动 */
const NORMAL_TIMEOUT_MS = 30_000

export class LinduoLoginService {
  /** 当前零度API 价格抓取登录态（是否已登录、用户名、cookie 过期时间等） */
  async getLoginStatus(accessToken: string | null | undefined): Promise<LinduoLoginStatus> {
    const token = ensureToken(accessToken)
    return callLinduo<LinduoLoginStatus>(token, '/login/status', { method: 'GET' }, NORMAL_TIMEOUT_MS)
  }

  /** 用户名密码登录：成功后服务端把 cookie + AES-256-GCM 加密的密码写回 DB */
  async login(
    accessToken: string | null | undefined,
    username: string,
    password: string
  ): Promise<{ ok: true; expiresAt: string | null }> {
    const token = ensureToken(accessToken)
    const trimmedUser = String(username || '').trim()
    if (!trimmedUser) throw new Error('请输入零度API 用户名')
    if (!password) throw new Error('请输入零度API 密码')
    return callLinduo<{ ok: true; expiresAt: string | null }>(
      token,
      '/login',
      { method: 'POST', body: JSON.stringify({ username: trimmedUser, password }) },
      60_000
    )
  }

  /** 清除登录态（仅服务端 DB，不会清浏览器/账号） */
  async logout(accessToken: string | null | undefined): Promise<{ ok: true }> {
    const token = ensureToken(accessToken)
    return callLinduo<{ ok: true }>(token, '/logout', { method: 'POST' }, NORMAL_TIMEOUT_MS)
  }

  /** 拉取 37 个模型最新价格（DB → fallback）；不触发抓取 */
  async getPricing(accessToken: string | null | undefined): Promise<{
    items: LinduoModelPricing[]
    refreshedAt: string | null
    allStale: boolean
  }> {
    const token = ensureToken(accessToken)
    return callLinduo<LinduoPricingListResponse>(token, '/pricing', { method: 'GET' }, NORMAL_TIMEOUT_MS)
  }

  /**
   * 立即触发一次价格抓取（最长 3 分钟，等 playwright 跑完）。
   * 第一次需要先在 LlmApiKeysPage 完成用户名密码登录；后续服务端会自动用加密保存的密码重登。
   * credentials 可选：用于 cookie 完全失效时由用户重新输入凭据。
   */
  async refreshPricing(
    accessToken: string | null | undefined,
    credentials?: { username?: string; password?: string }
  ): Promise<LinduoPricingRefreshResult> {
    const token = ensureToken(accessToken)
    const body: { credentials?: { username: string; password: string } } = {}
    if (credentials?.username && credentials?.password) {
      body.credentials = { username: credentials.username, password: credentials.password }
    }
    return callLinduo<LinduoPricingRefreshResult>(
      token,
      '/pricing/refresh',
      { method: 'POST', body: JSON.stringify(body) },
      REFRESH_TIMEOUT_MS
    )
  }
}
