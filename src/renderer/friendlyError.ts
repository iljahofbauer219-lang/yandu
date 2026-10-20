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
// 网络类错误模式表：采集链路与自动更新共用一张，避免两处文案漂移
const NETWORK_ERROR = /ERR_NETWORK_CHANGED|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_TIMED_OUT|ERR_ADDRESS|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|net::|网络连接|fetch failed/i
// 仍是英文技术串的特征（TimeoutError / ERR_X / 堆栈行 / HTTP 状态），这类不外显给用户
const EN_TECH_SIGNAL = /[A-Za-z]+Error\b|net::|ERR_[A-Z_]{3,}|ECONN|ETIMEDOUT|ENOENT|ENOSPC|^\s*at\s|\(https?:\/\/|HTTP \d{3}/
const HAS_CJK = /[\u4e00-\u9fff]/

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
  if (NETWORK_ERROR.test(text)) {
    return { kind: 'network', brief: '网络波动，连接失败', text: `网络波动，连接${warehouseName}失败，请检查网络后重试。` }
  }
  return { kind: 'other', brief: text || '操作失败，请重试。', text: text ? `操作失败：${text}` : '操作失败，请重试。' }
}

export interface FriendlyUpdateError {
  /** 行内展示的中文短句，不外露英文技术码 */
  text: string
  /** 原始技术串，仅用于悬浮详情供排查 */
  detail: string
}

/**
 * 自动更新失败的中文文案：主进程推的是 electron-updater / net.fetch 的原始消息
 * （net::ERR_INTERNET_DISCONNECTED、TimeoutError、HTTP 403…），直出右下角会让用户以为程序坏了。
 * 主进程已中文化的消息（磁盘空间不足）原样保留；未知英文串一律降级为中文并留详情。
 */
export function friendlyUpdateError(raw: string | undefined): FriendlyUpdateError {
  const detail = unwrapIpcError(raw || '') || '未知错误'
  if (NETWORK_ERROR.test(detail)) {
    return { text: '自动更新暂停：网络连接不可用，稍后自动重试', detail }
  }
  if (!HAS_CJK.test(detail) || EN_TECH_SIGNAL.test(detail)) return { text: '自动更新未完成，稍后会自动重试', detail }
  return { text: detail, detail }
}

/**
 * eBay 内嵌浏览器/自动登录链路的失败文案：主进程把 Chromium 的加载错误原样抛出
 * （ERR_CONNECTION_CLOSED (-100) loading '…'），直出横幅会让用户以为店铺被封。
 * 判定与网络模式表沿用 friendlySupplyError 同一套常量，只有动作指引按 eBay 场景改写。
 */
export function friendlyEbayError(raw: string): FriendlyUpdateError {
  const detail = unwrapIpcError(raw) || '未知错误'
  if (NETWORK_ERROR.test(detail)) {
    return { text: '网络波动，连接eBay失败，请检查网络或代理后点「重试」。', detail }
  }
  if (!HAS_CJK.test(detail) || EN_TECH_SIGNAL.test(detail)) return { text: 'eBay页面打开失败，请点「重试」，或检查网络后再试。', detail }
  return { text: detail, detail }
}
