import { describe, expect, it } from 'vitest'

// 测试 IP 响应解析逻辑（不依赖网络）
function parseIpResponse(body: string): { ip: string; country: string; org: string; isVpn: boolean } | null {
  try {
    // 响应格式："当前 IP：1.2.3.4  来自于：中国 广东 深圳  电信"
    const match = body.match(/当前 IP[：:]\s*(\S+)\s*来自于[：:]\s*(\S+)(?:\s+\S+)*\s+(\S+)/)
    if (match) {
      const ip = match[1]
      const country = match[2]
      const isp = match[3]
      return {
        ip,
        country,
        org: isp,
        isVpn: /vpn|proxy|hosting|datacenter|机房|数据中心/i.test(isp)
      }
    }
    return null
  } catch {
    return null
  }
}

describe('app:public-ip 响应解析', () => {
  it('成功解析 ipip.net 响应（国内）', () => {
    const body = '当前 IP：1.2.3.4  来自于：中国 广东 深圳  电信'
    const result = parseIpResponse(body)
    expect(result).toEqual({
      ip: '1.2.3.4',
      country: '中国',
      org: '电信',
      isVpn: false
    })
  })

  it('成功解析 IPv6 地址', () => {
    const body = '当前 IP：240e:47c:82d8:1b51::1  来自于：中国 北京  联通'
    const result = parseIpResponse(body)
    expect(result?.ip).toBe('240e:47c:82d8:1b51::1')
    expect(result?.country).toBe('中国')
  })

  it('识别数据中心/机房出口', () => {
    const body = '当前 IP：5.6.7.8  来自于：美国 加州 洛杉矶  数据中心'
    const result = parseIpResponse(body)
    expect(result?.isVpn).toBe(true)
  })

  it('识别 VPN 出口', () => {
    const body = '当前 IP：9.9.9.9  来自于：荷兰 阿姆斯特丹  VPN'
    const result = parseIpResponse(body)
    expect(result?.isVpn).toBe(true)
  })

  it('无法解析的响应返回 null', () => {
    const body = '<html>error</html>'
    const result = parseIpResponse(body)
    expect(result).toBeNull()
  })

  it('空响应返回 null', () => {
    const body = ''
    const result = parseIpResponse(body)
    expect(result).toBeNull()
  })
})
