import { describe, expect, it } from 'vitest'
import { PUBLIC_IP_PROBE_TIMEOUT_MS, PUBLIC_IP_PROBE_URL, PUBLIC_IP_TRANSPORTS, parsePublicIpBody } from '../publicIpProbe'

describe('顶栏公网 IP 探测出口顺序', () => {
  it('先 Chromium（跟随系统代理）后直连回落，顺序不可颠倒', () => {
    expect([...PUBLIC_IP_TRANSPORTS]).toEqual(['chromium', 'direct'])
  })

  it('代理路超时留足拥塞余量（实测代理 1~10s），直连保持原 4s 口径', () => {
    expect(PUBLIC_IP_PROBE_TIMEOUT_MS.chromium).toBeGreaterThanOrEqual(6000)
    expect(PUBLIC_IP_PROBE_TIMEOUT_MS.direct).toBe(4000)
  })

  it('探测地址仍是 ipip.net，不因换出口而换数据源', () => {
    expect(PUBLIC_IP_PROBE_URL).toBe('https://myip.ipip.net/')
  })
})

describe('parsePublicIpBody（从 main 内联原样搬运，零口径变更）', () => {
  it('成功解析 ipip.net 响应（国内）', () => {
    expect(parsePublicIpBody('当前 IP：1.2.3.4  来自于：中国 广东 深圳  电信')).toEqual({
      ip: '1.2.3.4',
      country: '中国',
      org: '电信',
      isVpn: false
    })
  })

  it('成功解析 IPv6 地址', () => {
    const result = parsePublicIpBody('当前 IP：240e:47c:82d8:1b51::1  来自于：中国 北京  联通')
    expect(result?.ip).toBe('240e:47c:82d8:1b51::1')
    expect(result?.country).toBe('中国')
  })

  it('识别数据中心/机房出口', () => {
    expect(parsePublicIpBody('当前 IP：5.6.7.8  来自于：美国 加州 洛杉矶  数据中心')?.isVpn).toBe(true)
  })

  it('识别 VPN 出口', () => {
    expect(parsePublicIpBody('当前 IP：9.9.9.9  来自于：荷兰 阿姆斯特丹  VPN')?.isVpn).toBe(true)
  })

  it('无法解析的响应返回 null（交由下一条出口重试）', () => {
    expect(parsePublicIpBody('<html>error</html>')).toBeNull()
  })

  it('空响应返回 null', () => {
    expect(parsePublicIpBody('')).toBeNull()
  })
})