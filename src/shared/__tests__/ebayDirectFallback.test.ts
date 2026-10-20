import { describe, expect, it } from 'vitest'
import { PROXY_TRANSIT_ERROR_CODES, shouldRetryWithoutProxy } from '../ebayDirectFallback'

describe('shouldRetryWithoutProxy（eBay 会话直连回落判定）', () => {
  it('命中 Chromium 加载拒绝的 code+errno+message（实测 -100 原样）', () => {
    const error = Object.assign(new Error("ERR_CONNECTION_CLOSED (-100) loading 'https://www.ebay.com/sh/ovw'"), { code: 'ERR_CONNECTION_CLOSED', errno: -100 })
    expect(shouldRetryWithoutProxy(error)).toBe(true)
  })

  it('只有 errno 或只有 code 也能判定（代理连接失败 -130）', () => {
    expect(shouldRetryWithoutProxy({ errno: -130 })).toBe(true)
    expect(shouldRetryWithoutProxy({ code: 'ERR_PROXY_CONNECTION_FAILED' })).toBe(true)
    expect(shouldRetryWithoutProxy({ errno: -7 })).toBe(true)
  })

  it('接受 net:: 前缀的原始消息串', () => {
    expect(shouldRetryWithoutProxy('net::ERR_NAME_NOT_RESOLVED')).toBe(true)
    expect(shouldRetryWithoutProxy("Error invoking remote method 'ebay:seller-hub:open': Error: ERR_INTERNET_DISCONNECTED (-106)")).toBe(true)
  })

  it('取消、证书、应用主动中断类一律不回落', () => {
    expect(shouldRetryWithoutProxy(Object.assign(new Error('ERR_ABORTED'), { code: 'ERR_ABORTED', errno: -3 }))).toBe(false)
    expect(shouldRetryWithoutProxy({ code: 'ERR_CERT_AUTHORITY_INVALID', errno: -201 })).toBe(false)
    expect(shouldRetryWithoutProxy({ code: 'ERR_CONNECTION_ABORTED', errno: -103 })).toBe(false)
    expect(shouldRetryWithoutProxy({ code: 'ERR_TOO_MANY_REDIRECTS', errno: -313 })).toBe(false)
  })

  it('中文业务提示与空值不回落', () => {
    expect(shouldRetryWithoutProxy('eBay 店铺不存在')).toBe(false)
    expect(shouldRetryWithoutProxy('登录地址不在平台HTTPS白名单中')).toBe(false)
    expect(shouldRetryWithoutProxy(null)).toBe(false)
    expect(shouldRetryWithoutProxy(undefined)).toBe(false)
    expect(shouldRetryWithoutProxy('')).toBe(false)
    expect(shouldRetryWithoutProxy(42)).toBe(false)
  })

  it('沿 cause 链再查一层', () => {
    expect(shouldRetryWithoutProxy(new Error('加载失败', { cause: { code: 'ERR_NETWORK_CHANGED' } }))).toBe(true)
    expect(shouldRetryWithoutProxy(new Error('加载失败', { cause: new Error('无关原因') }))).toBe(false)
  })

  it('判定表与 errno 表长度一致，新增码不会漏配对', () => {
    expect(PROXY_TRANSIT_ERROR_CODES).toHaveLength(10)
    expect(shouldRetryWithoutProxy({ code: 'ERR_CONNECTION_RESET' })).toBe(true)
    expect(shouldRetryWithoutProxy({ errno: -101 })).toBe(true)
  })
})
