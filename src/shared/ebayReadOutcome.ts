/**
 * eBay 发布链路「读页面」的成败判定与失败文案。
 *
 * 口径：did-finish-load 未在预算内触发不算失败（eBay / Seller Hub 有长连接是常态），
 * 成败只由内容轮询决定；最终失败文案要说清「卡在哪」，不得把责任推给网络，也不得直出 net::/ERR_ 技术串。
 */
export type EbayReadVerdict = 'LOGIN' | 'VERIFY' | 'READY' | 'WAIT'

export interface EbayReadProbeFlags {
  login?: boolean
  verification?: boolean
}

export function decideEbayReadOutcome<T extends EbayReadProbeFlags>(probe: T | null, isReady: (probe: T) => boolean): EbayReadVerdict {
  if (!probe) return 'WAIT'
  if (probe.login) return 'LOGIN'
  if (probe.verification) return 'VERIFY'
  return isReady(probe) ? 'READY' : 'WAIT'
}

export interface EbayReadFailureInput {
  pageLabel: string
  loadEventSettled: boolean
  sawContent: boolean
}

export function ebayReadFailureMessage({ pageLabel, loadEventSettled, sawContent }: EbayReadFailureInput): string {
  if (sawContent) {
    return `${pageLabel}已打开${loadEventSettled ? '' : '（加载事件未在预算内结束，长连接页面常见）'}，但价格、描述等字段在等待预算内没读全。可稍后重试；反复失败请在店铺采集浏览器中人工核对该商品页。`
  }
  return `${pageLabel}在等待预算内${loadEventSettled ? '加载结束但' : ''}始终没渲染出内容，多为登录会话失效或要求安全验证。请先在店铺采集浏览器完成登录或人工验证后重试。`
}
