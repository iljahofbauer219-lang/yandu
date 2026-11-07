/**
 * eBay 域名白名单（单一真值源）。
 * eBay 各国站点是各自独立的顶级域（ebay.de / ebay.co.uk / ebay.cn …），只认 ebay.com
 * 会把「在 eBay 浏览器里打开德国站」误判成越权访问。
 * 但卖家后台、登录页与店铺身份接口只存在于 ebay.com，那类业务校验必须继续用
 * isEbayDotComHost，不能拿本站白名单顶替。
 */
export const EBAY_SITE_ROOT_DOMAINS: string[] = [
  'ebay.com',      // 美国
  'ebay.ca',       // 加拿大
  'ebay.co.uk',    // 英国
  'ebay.ie',       // 爱尔兰
  'ebay.de',       // 德国
  'ebay.fr',       // 法国
  'ebay.it',       // 意大利
  'ebay.es',       // 西班牙
  'ebay.com.au',   // 澳大利亚
  'ebay.co.jp',    // 日本
  'ebay.cn',       // 中国
  'ebay.sg',       // 新加坡
  'ebay.com.hk',   // 中国香港
  'ebay.com.my',   // 马来西亚
  'ebay.ph',       // 菲律宾
  'ebay.co.kr',    // 韩国
  'ebay.in',       // 印度
  'ebay.ae'        // 阿联酋
]

export const EBAY_SITE_ALLOWED_MESSAGE =
  'eBay浏览器只能访问 eBay 各国官方站点（如 ebay.com、ebay.de、ebay.co.uk、ebay.cn），其它网址已被阻止'

/** 主机名是否属于 eBay 官方站点（含其子域，如 www.ebay.de、motors.ebay.com） */
export function isEbaySiteHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return EBAY_SITE_ROOT_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`))
}

/** 仅 ebay.com 及其子域：卖家后台、登录、店铺身份等业务链路专用 */
export function isEbayDotComHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'ebay.com' || host.endsWith('.ebay.com')
}

export function isEbaySiteUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'https:' && isEbaySiteHost(url.hostname)
  } catch {
    return false
  }
}
