import type { EbayDeliveryCountry, EbayDeliveryCountryResult } from './contracts'
import { isEbayDotComHost } from './ebaySites'

/**
 * eBay 收货地国家开关。
 * 写入走 eBay 全球顶栏自己的偏好接口 POST /gh/setuserpreference，与人工在官方
 * 收货地对话框里点「完成」是同一个写操作；它改的是 eBay 侧偏好，不是本地会话状态。
 * 顶栏语言（简体中文）与邮编由 eBay 账号设置决定，本开关不承诺、也不改写。
 */
export const EBAY_DELIVERY_MANUAL_URL = 'https://accountsettings.ebay.com/uas/addresses'

export const EBAY_DELIVERY_OPTIONS: readonly { code: EbayDeliveryCountry; label: string; alpha3: string }[] = [
  { code: 'US', label: '美国', alpha3: 'USA' },
  { code: 'CN', label: '中国', alpha3: 'CHN' }
]

const ALPHA3: Record<string, EbayDeliveryCountry> = { USA: 'US', CHN: 'CN' }

export function ebayDeliveryOption(code: EbayDeliveryCountry) {
  const option = EBAY_DELIVERY_OPTIONS.find(item => item.code === code)
  if (!option) throw new Error(`不支持的收货地选项：${String(code)}`)
  return option
}

export function ebayDeliveryAlpha3(code: EbayDeliveryCountry): string {
  return ebayDeliveryOption(code).alpha3
}

export function ebayDeliveryLabel(country: EbayDeliveryCountry | null): string {
  return country ? ebayDeliveryOption(country).label : '收货地'
}

/** 读回 eBay 服务端渲染的 GHpre.shipToLocation（形如 "91789%2CUSA" / "%2CCHN"） */
export function readEbayDeliveryCountry(shipToLocation: string | null | undefined): EbayDeliveryCountry | null {
  if (!shipToLocation) return null
  let decoded = shipToLocation
  try {
    decoded = decodeURIComponent(shipToLocation)
  } catch {
    return null
  }
  const segments = decoded.split(',').map(part => part.trim().toUpperCase()).filter(Boolean)
  const last = segments.at(-1)
  return last ? ALPHA3[last] ?? null : null
}

/** 页面上下文可能在回传途中被销毁，对象无法结构化克隆；边界只收 JSON 字符串 */
export function parseEbayPreferencePost(raw: string | null | undefined): { status: number; accepted: boolean } {
  if (!raw) return { status: 0, accepted: false }
  try {
    const parsed = JSON.parse(raw) as { status?: unknown; accepted?: unknown }
    const status = typeof parsed.status === 'number' ? parsed.status : 0
    return { status, accepted: status > 0 && parsed.accepted === true }
  } catch {
    return { status: 0, accepted: false }
  }
}

/** 读回邮编：GHpre.shipToLocation 形如 "91789%2CUSA"，逗号前即邮编；被清空时为空串 */
export function readEbayDeliveryPostal(shipToLocation: string | null | undefined): string {
  if (!shipToLocation) return ''
  let decoded = shipToLocation
  try {
    decoded = decodeURIComponent(shipToLocation)
  } catch {
    return ''
  }
  const segments = decoded.split(',')
  return segments.length > 1 ? segments[0].trim() : ''
}

/** 刊登编辑页带着未保存内容，切换收货地后不能自动刷新把它冲掉 */
export function isEbayListingFormUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return isEbayDotComHost(url.hostname) && url.pathname.startsWith('/lstng')
  } catch {
    return false
  }
}

/** 去程切换会把邮编清掉，回程当前值已空；邮编记忆必须跨调用保留 */
export function resolvePostalRetention(input: { currentPostal: string; rememberedPostal?: string | null }): { postalBefore: string; shouldSnapshot: boolean } {
  const current = (input.currentPostal || '').trim()
  if (current) return { postalBefore: current, shouldSnapshot: true }
  return { postalBefore: (input.rememberedPostal || '').trim(), shouldSnapshot: false }
}

export interface EbayDeliveryCountryFacts {
  requested: EbayDeliveryCountry
  hasEbayView: boolean
  postAccepted?: boolean
  postStatus?: number
  listingForm?: boolean
  shipToLocation?: string | null
  postalBefore?: string | null
}

export function resolveEbayDeliveryCountry(facts: EbayDeliveryCountryFacts): EbayDeliveryCountryResult {
  const wanted = ebayDeliveryLabel(facts.requested)
  const manualUrl = EBAY_DELIVERY_MANUAL_URL
  const failed = (country: EbayDeliveryCountry | null, reason: string): EbayDeliveryCountryResult =>
    ({ ok: false, country, label: ebayDeliveryLabel(country), reason, manualUrl, refreshRequired: false })

  if (!facts.hasEbayView) {
    return failed(null, '当前没有打开的 eBay 页面，收货地未改动。请先在「店铺采集」打开 eBay 页面，或点「去 eBay 收货地址设置」手动修改。')
  }
  if (!facts.postAccepted) {
    return failed(null, facts.postStatus
      ? `eBay 拒绝了收货地修改（HTTP ${facts.postStatus}），收货地未改动。请点「去 eBay 收货地址设置」手动修改。`
      : 'eBay 收货地接口没有回应，收货地未改动。请确认店铺登录态后重试，或点「去 eBay 收货地址设置」手动修改。')
  }
  if (facts.listingForm) {
    return {
      ok: true,
      country: facts.requested,
      label: wanted,
      reason: `收货地已设为${wanted}。当前是刊登编辑页，为避免丢失未保存内容没有自动刷新，点「刷新页面」后生效。`,
      manualUrl,
      refreshRequired: true
    }
  }
  const actual = readEbayDeliveryCountry(facts.shipToLocation)
  if (actual !== facts.requested) {
    return failed(actual, `eBay 已接受修改，但刷新后读回的收货地是${actual ? ebayDeliveryLabel(actual) : '空'}，不是${wanted}。请点「去 eBay 收货地址设置」手动确认。`)
  }
  const postalBefore = (facts.postalBefore || '').trim()
  const postalAfter = readEbayDeliveryPostal(facts.shipToLocation)
  if (actual === 'US' && postalBefore && !postalAfter) {
    return failed(actual, `收货地已切到美国，但原邮编 ${postalBefore} 未能恢复。请点「去 eBay 收货地址设置」手动补填邮编。`)
  }
  const keptPostal = actual === 'US' && postalBefore && postalAfter === postalBefore
  return {
    ok: true,
    country: actual,
    label: wanted,
    reason: actual === 'CN'
      ? '收货地已切到中国大陆，页面已刷新。顶栏语言与邮编由 eBay 账号设置决定，本开关不改写。'
      : keptPostal
        ? `收货地已切到美国，页面已刷新，原邮编 ${postalBefore} 已保留。`
        : '收货地已切到美国，页面已刷新。',
    manualUrl,
    refreshRequired: false
  }
}