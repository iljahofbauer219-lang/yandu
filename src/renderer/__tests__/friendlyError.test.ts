import { describe, expect, it } from 'vitest'
import { friendlySupplyError, friendlyUpdateError, unwrapIpcError } from '../friendlyError'

describe('unwrapIpcError', () => {
  it('剥离 IPC 包装与 Error 前缀（可嵌套多层）', () => {
    const raw = "Error invoking remote method 'warehouse:download': Error: 大健云仓当前为未登录态：商品页价格/规格/文件区被登录墙遮挡"
    expect(unwrapIpcError(raw)).toBe('大健云仓当前为未登录态：商品页价格/规格/文件区被登录墙遮挡')
    expect(unwrapIpcError("Error invoking remote method 'browser:supply:activate': Error: ERR_NETWORK_CHANGED (-21) loading 'https://www.gigab2b.com/index.php?route=common/home'")).toContain('ERR_NETWORK_CHANGED')
  })

  it('无包装消息原样返回', () => {
    expect(unwrapIpcError('图片全部下载失败')).toBe('图片全部下载失败')
    expect(unwrapIpcError('')).toBe('')
  })
})

describe('friendlySupplyError', () => {
  it('未登录闸口消息（带 IPC 包装）→ 中文登录提示 + login', () => {
    const raw = "Error invoking remote method 'warehouse:download': Error: 大健云仓当前为未登录态：商品页价格/规格/文件区被登录墙遮挡（掩码或 Login To See Price），继续下载只会得到残缺详情页。请先在 IE浏览 中登录大健云仓后重试"
    const out = friendlySupplyError(raw)
    expect(out.kind).toBe('login')
    expect(out.brief).toBe('需要登录才能完整下载')
    expect(out.text).toContain('需要登录')
    expect(out.text).toContain('登录后数据下载才完整')
    expect(out.text).not.toContain('Error invoking')
  })

  it('ERR_NETWORK_CHANGED（图2 原串）→ 中文网络提示 + network', () => {
    const raw = "Error invoking remote method 'browser:supply:activate': Error: ERR_NETWORK_CHANGED (-21) loading 'https://www.gigab2b.com/index.php?route=common/home'"
    const out = friendlySupplyError(raw, '大健云仓')
    expect(out.kind).toBe('network')
    expect(out.brief).toBe('网络波动，连接失败')
    expect(out.text).toBe('网络波动，连接大健云仓失败，请检查网络后重试。')
    expect(out.text).not.toContain('ERR_')
  })

  it('会话过期 → session 文案与摘要', () => {
    expect(friendlySupplyError('SERVER_SESSION_EXPIRED').kind).toBe('session')
    expect(friendlySupplyError('SERVER_SESSION_EXPIRED').brief).toBe('会话已过期')
    expect(friendlySupplyError("Error invoking remote method 'warehouse:download': Error: 登录会话已过期，请重新登录后重试").kind).toBe('session')
  })

  it('安全验证 → verify 文案与摘要', () => {
    const out = friendlySupplyError('大健云仓要求安全验证，请先在 IE浏览 中打开该商品页人工完成验证后重试')
    expect(out.kind).toBe('verify')
    expect(out.brief).toBe('需要安全验证')
  })

  it('登录失效哨兵消息归入 login 而非 other', () => {
    expect(friendlySupplyError('大健云仓登录状态已失效，请先在 IE浏览 中登录大健云仓后重试').kind).toBe('login')
  })

  it('未知错误保留原文并加前缀，不静默吞错', () => {
    const out = friendlySupplyError("Error invoking remote method 'warehouse:download': Error: 商品不存在、已归档或已下架")
    expect(out.kind).toBe('other')
    expect(out.text).toBe('操作失败：商品不存在、已归档或已下架')
    expect(out.brief).toBe('商品不存在、已归档或已下架')
  })

  it('仓名可替换（1688）', () => {
    expect(friendlySupplyError('ERR_NAME_NOT_RESOLVED', '1688').text).toBe('网络波动，连接1688失败，请检查网络后重试。')
  })
})

describe('friendlyUpdateError（右下角自动更新）', () => {
  it('断网原串 → 中文网络文案，英文码只留在详情里', () => {
    const raw = "net::ERR_INTERNET_DISCONNECTED (-106) loading 'https://yandu-download.oss-cn-hangzhou.aliyuncs.com/latest-mac.yml'"
    const out = friendlyUpdateError(raw)
    expect(out.text).toBe('自动更新暂停：网络连接不可用，稍后自动重试')
    expect(out.text).not.toMatch(/ERR_|net::|https:\/\//)
    expect(out.detail).toContain('ERR_INTERNET_DISCONNECTED')
  })

  it('fetch failed 归网络类', () => {
    expect(friendlyUpdateError('fetch failed').text).toContain('网络连接不可用')
  })

  it('TimeoutError / HTTP 403 等未知英文串降级为中文，不外露技术码', () => {
    for (const raw of ['TimeoutError: Timeout was exceeded', 'HTTP 403', 'Certificate validation failed: unable to verify the first certificate']) {
      const out = friendlyUpdateError(raw)
      expect(out.text).toBe('自动更新未完成，稍后会自动重试')
      expect(out.detail).toBe(raw)
    }
  })

  it('主进程已中文化的磁盘空间文案原样保留，不重复加工', () => {
    const raw = '磁盘空间不足：安装更新至少需要 5GB 可用空间，请清理后重试'
    expect(friendlyUpdateError(raw)).toEqual({ text: raw, detail: raw })
  })

  it('空消息不显示空白条', () => {
    expect(friendlyUpdateError(undefined).text).toBe('未知错误')
    expect(friendlyUpdateError("Error invoking remote method 'app:x': Error: ").text).toBe('未知错误')
  })
})
