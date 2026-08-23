import { CookieJar } from './gatewayCookie'

export type AdvisorRemoteSession = {
  url: string
  message: string
  expiresAt: number
}

export type HarnessConnectOptions = {
  force?: boolean
}

export type HarnessClientConfig = {
  appServerBaseUrl: string
  gatewayBaseUrl: string
  ticketExpiresInMs?: number
  renewBeforeMs?: number
  /** 由 AdvisorRuntime 注入，提供当前登录用户的 JWT */
  getAccessToken: () => Promise<string>
}

type HarnessEvent = 'unavailable' | 'expired'
type EventHandler = (err: Error) => void

/**
 * 主进程轻量代理，封装 harness gateway 连接：
 * - access-ticket 获取（app server）
 * - gateway /session 创建（带 ticket 鉴权）
 * - set-cookie 缓存
 * - 提前 renewBeforeMs 自动续约
 * - 并发 connect 收敛到单次 in-flight 请求
 * - unavailable / expired 事件订阅
 *
 * 不处理业务逻辑：业务流拿到 workerOrigin + cookieHeader 后自行 fetch。
 */
export class HarnessGatewayClient {
  private cached: AdvisorRemoteSession | null = null
  private readonly cookieJar = new CookieJar()
  private readonly listeners = new Map<HarnessEvent, Set<EventHandler>>()
  private connectPromise: Promise<AdvisorRemoteSession> | null = null
  private renewTimer: ReturnType<typeof setTimeout> | null = null
  private readonly ticketExpiresInMs: number
  private readonly renewBeforeMs: number

  constructor(private readonly config: HarnessClientConfig) {
    this.ticketExpiresInMs = config.ticketExpiresInMs ?? 5 * 60_000
    this.renewBeforeMs = config.renewBeforeMs ?? 30_000
  }

  async connect(opts: HarnessConnectOptions = {}): Promise<AdvisorRemoteSession> {
    if (this.connectPromise) return this.connectPromise
    if (!opts.force && this.cached && this.cached.expiresAt > Date.now()) {
      return this.cached
    }
    const promise = this.doConnect()
      .finally(() => {
        if (this.connectPromise === promise) this.connectPromise = null
      })
    this.connectPromise = promise
    return promise
  }

  private async doConnect(): Promise<AdvisorRemoteSession> {
    const ticket = await this.fetchAccessTicket()

    const cookie = await this.openGatewaySession(ticket)
    const workerOrigin = this.config.gatewayBaseUrl

    const session: AdvisorRemoteSession = {
      url: workerOrigin,
      message: '受限隔离执行器已就绪',
      expiresAt: Date.now() + this.ticketExpiresInMs
    }
    this.cached = session
    this.scheduleRenew()
    return session
  }

  private async fetchAccessTicket(): Promise<string> {
    let accessToken: string
    try {
      accessToken = await this.config.getAccessToken()
    } catch (err) {
      throw new Error(`ADVISOR_UNAUTHORIZED: ${err instanceof Error ? err.message : String(err)}`)
    }
    let res: Response
    try {
      res = await fetch(`${this.config.appServerBaseUrl}/api/codex-harness/access-ticket`, {
        method: 'GET',
        headers: { authorization: `Bearer ${accessToken}` }
      })
    } catch (err) {
      throw new Error(`ADVISOR_TICKET_FAILED: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (res.status === 403) throw new Error('ADVISOR_FORBIDDEN: 无在线参谋权限')
    if (res.status === 401) throw new Error('ADVISOR_UNAUTHORIZED: 登录已过期')
    if (!res.ok) throw new Error(`ADVISOR_TICKET_FAILED: HTTP ${res.status}`)
    const data = await res.json() as { ticket: string }
    if (!data.ticket) throw new Error('ADVISOR_TICKET_FAILED: 响应缺少 ticket')
    return data.ticket
  }

  private async openGatewaySession(ticket: string): Promise<string> {
    let res: Response
    try {
      res = await fetch(`${this.config.gatewayBaseUrl}/session`, {
        method: 'POST',
        headers: { authorization: `Bearer ${ticket}` }
      })
    } catch (err) {
      const wrapped = new Error(`HARNESS_UNAVAILABLE: ${err instanceof Error ? err.message : String(err)}`)
      this.emit('unavailable', wrapped)
      throw wrapped
    }
    if (res.status === 401) throw new Error('HARNESS_AUTH_FAILED')
    if (!res.ok) {
      const wrapped = new Error(`HARNESS_UNAVAILABLE: HTTP ${res.status}`)
      this.emit('unavailable', wrapped)
      throw wrapped
    }
    this.cookieJar.setFromSetCookieHeader(res.headers.get('set-cookie') ?? undefined)
    return this.cookieJar.getCookieHeader()
  }

  getWorkerOrigin(): string {
    if (!this.cached) throw new Error('ADVISOR_NOT_CONNECTED')
    return this.cached.url
  }

  getCookieHeader(): string {
    return this.cookieJar.getCookieHeader()
  }

  getStatus(): { connected: boolean; expiresAt: number | null } {
    return {
      connected: !!this.cached && this.cached.expiresAt > Date.now(),
      expiresAt: this.cached?.expiresAt ?? null
    }
  }

  async disconnect(): Promise<void> {
    this.cached = null
    this.cookieJar.clear()
    if (this.renewTimer) {
      clearTimeout(this.renewTimer)
      this.renewTimer = null
    }
  }

  on(event: HarnessEvent, handler: EventHandler): () => void {
    let bucket = this.listeners.get(event)
    if (!bucket) {
      bucket = new Set()
      this.listeners.set(event, bucket)
    }
    bucket.add(handler)
    return () => {
      bucket?.delete(handler)
    }
  }

  private emit(event: HarnessEvent, err: Error): void {
    const bucket = this.listeners.get(event)
    if (!bucket) return
    bucket.forEach(h => {
      try { h(err) } catch { /* 监听器内部异常不向上传播 */ }
    })
  }

  private scheduleRenew(): void {
    if (this.renewTimer) clearTimeout(this.renewTimer)
    const delay = Math.max(1000, this.ticketExpiresInMs - this.renewBeforeMs)
    this.renewTimer = setTimeout(() => {
      this.connect({ force: true }).catch(err => this.emit('expired', err instanceof Error ? err : new Error(String(err))))
    }, delay)
    this.renewTimer.unref?.()
  }
}
