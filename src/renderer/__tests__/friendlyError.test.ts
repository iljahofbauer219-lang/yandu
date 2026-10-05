import { describe, expect, it } from 'vitest'
import { friendlySupplyError, unwrapIpcError } from '../friendlyError'

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
