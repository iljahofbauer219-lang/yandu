/**
 * eBay 内嵌会话的「代理出口 transit 失败」判定。
 * 系统代理节点半死时 Chromium 抛的是连接类错误（实测 ERR_CONNECTION_CLOSED (-100)），
 * 而 eBay 在国内可直连，故这类失败值得一次直连重试；认证/证书/取消类不属此列。
 */
export const PROXY_TRANSIT_ERROR_CODES = [
  'ERR_TIMED_OUT',
  'ERR_CONNECTION_CLOSED',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_REFUSED',
  'ERR_NAME_NOT_RESOLVED',
  'ERR_INTERNET_DISCONNECTED',
  'ERR_NETWORK_CHANGED',
  'ERR_ADDRESS_UNREACHABLE',
  'ERR_CONNECTION_TIMED_OUT',
  'ERR_PROXY_CONNECTION_FAILED',
] as const

export const PROXY_TRANSIT_ERROR_ERRNOS = [-7, -100, -101, -102, -105, -106, -107, -109, -118, -130] as const

const CODE_IN_TEXT = new RegExp(`\\b(${PROXY_TRANSIT_ERROR_CODES.join('|')})\\b`)

/** 接受 Error、{code,errno} 或原始消息串；非连接类失败一律 false */
export function shouldRetryWithoutProxy(error: unknown): boolean {
  if (typeof error === 'string') return CODE_IN_TEXT.test(error)
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; errno?: unknown; message?: unknown; cause?: unknown }
  if (typeof candidate.code === 'string' && CODE_IN_TEXT.test(candidate.code)) return true
  if (typeof candidate.errno === 'number' && (PROXY_TRANSIT_ERROR_ERRNOS as readonly number[]).includes(candidate.errno)) return true
  if (typeof candidate.message === 'string' && CODE_IN_TEXT.test(candidate.message)) return true
  return Boolean(candidate.cause) && candidate.cause !== error && shouldRetryWithoutProxy(candidate.cause)
}
