/**
 * 极简 cookie 解析，仅服务 harness gateway：
 * - 仅解析 Set-Cookie 头中的 name=value 段
 * - 不处理 Expires/Max-Age/HttpOnly/Secure/SameSite 等属性（gateway 不下发过期）
 * - 过期由 ticket 控制，不在此层关注
 */
export class CookieJar {
  private cookies = new Map<string, string>()

  setFromSetCookieHeader(header: string | string[] | undefined): void {
    if (!header) return
    const lines = Array.isArray(header) ? header : [header]
    for (const line of lines) {
      for (const piece of line.split(',')) {
        const trimmed = piece.trim()
        if (!trimmed) continue
        const [pair] = trimmed.split(';')
        const eq = pair.indexOf('=')
        if (eq < 0) continue
        const name = pair.slice(0, eq).trim()
        const value = pair.slice(eq + 1).trim()
        if (name) this.cookies.set(name, value)
      }
    }
  }

  getCookieHeader(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
  }

  clear(): void {
    this.cookies.clear()
  }
}
