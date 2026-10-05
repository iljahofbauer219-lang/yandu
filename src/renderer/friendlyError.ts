/**
 * 供应仓链路错误的中文友好化：Electron IPC reject 会给消息加英文包装
 * （Error invoking remote method 'xxx': Error: …），原生网络错误也是英文 ERR_ 码，
 * 直接展示会让用户误以为网站坏了。这里统一剥包装并按语义映射中文文案。
 */
export type FriendlyErrorKind = 'login' | 'network' | 'verify' | 'session' | 'other'

export interface FriendlyError {
  text: string
  kind: FriendlyErrorKind
  /** 行内单行区可完整显示的短摘要；模态弹窗展示 text 全文 */
  brief: string
}

const IPC_WRAPPER = /^Error invoking remote method '[^']+':\s*/
const ERROR_PREFIX = /^(?:Uncaught\s+)?(?:TypeError|RangeError|Error):\s*/

export function unwrapIpcError(raw: string): string {
  let text = (raw || '').trim()
  for (let pass = 0; pass < 3; pass += 1) {
    const next = text.replace(IPC_WRAPPER, '').replace(ERROR_PREFIX, '').trim()
    if (next === text) break
    text = next
  }
  return text
}

export function friendlySupplyError(raw: string, warehouseName = '大健云仓'): FriendlyError {
  const text = unwrapIpcError(raw)
  if (/SERVER_SESSION_EXPIRED|登录会话已过期|会话已过期|重新登录后重试/.test(text)) {
    return { kind: 'session', brief: '会话已过期', text: '应用登录会话已过期，请重新登录砚都跨境后重试。' }
  }
  if (/SUPPLY_LOGIN_REQUIRED|未登录态|登录后查看|登录可见|Login To See Price|登录状态已失效|请先在 IE浏览 中登录/.test(text)) {
    return { kind: 'login', brief: '需要登录才能完整下载', text: `${warehouseName}需要登录，登录后数据下载才完整。点「去登录」在供应浏览器完成登录后重试。` }
  }
  if (/VERIFY|安全验证|滑块|验证码|访问频繁|操作异常|请求过于频繁/.test(text)) {
    return { kind: 'verify', brief: '需要安全验证', text: `${warehouseName}要求安全验证，请在 IE浏览 中打开该商品页人工完成验证后重试。` }
  }
  if (/ERR_NETWORK_CHANGED|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_TIMED_OUT|ERR_ADDRESS|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|net::|网络连接|fetch failed/i.test(text)) {
    return { kind: 'network', brief: '网络波动，连接失败', text: `网络波动，连接${warehouseName}失败，请检查网络后重试。` }
  }
  return { kind: 'other', brief: text || '操作失败，请重试。', text: text ? `操作失败：${text}` : '操作失败，请重试。' }
}
