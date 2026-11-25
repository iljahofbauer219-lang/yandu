/**
 * 顶栏 IP chip 的出口顺序与响应解析：Node https 不跟随系统代理，在「代理在用、直连不通」的机器上
 * 芯片会长期显示「未知」，故先走 Chromium 网络栈（跟随系统代理），失败才回落直连。
 */
export interface PublicIpInfo { ip: string; country: string; org: string; isVpn: boolean }

export const PUBLIC_IP_PROBE_URL = 'https://myip.ipip.net/'
export const PUBLIC_IP_TRANSPORTS = ['chromium', 'direct'] as const
export type PublicIpTransport = (typeof PUBLIC_IP_TRANSPORTS)[number]
// 代理出口实测 1~10s（拥塞时更久）故给 8s；直连沿用原 4s，两路都拿不到才显示「未知」
export const PUBLIC_IP_PROBE_TIMEOUT_MS: Record<PublicIpTransport, number> = { chromium: 8000, direct: 4000 }

export function parsePublicIpBody(body: string): PublicIpInfo | null {
  // 响应格式："当前 IP：1.2.3.4  来自于：中国 广东 深圳  电信"
  const match = body.match(/当前 IP[：:]\s*(\S+)\s*来自于[：:]\s*(\S+)(?:\s+\S+)*\s+(\S+)/)
  if (!match) return null
  const [, ip, country, org] = match
  return { ip, country, org, isVpn: /vpn|proxy|hosting|datacenter|机房|数据中心/i.test(org) }
}