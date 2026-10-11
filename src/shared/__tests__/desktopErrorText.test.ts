import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { describeDesktopError } from '../desktopErrorText'

describe('IPC 错误中文化', () => {
  it('No handler registered 技术串转中文全文并带通道名与重启指引', () => {
    const text = describeDesktopError(new Error("Error invoking remote method 'warehouse:delisted-pallet': Error: No handler registered for 'warehouse:delisted-pallet'"), '下架产品加载')
    expect(text).toContain('下架产品加载失败')
    expect(text).toContain('warehouse:delisted-pallet')
    expect(text).toContain('未注册')
    expect(text).toContain('重启')
    expect(text).not.toContain('Error invoking')
    expect(text).not.toContain('No handler registered')
  })

  it('超时与会话过期各有中文口径', () => {
    expect(describeDesktopError(new Error('request timeout'), '入库队列加载')).toContain('超时')
    expect(describeDesktopError(new Error('SERVER_SESSION_EXPIRED'), '保存')).toContain('会话已过期')
  })

  it('中文原义错误保留原文并补动作指引', () => {
    const text = describeDesktopError(new Error('数据库尚未初始化'), '删除')
    expect(text).toContain('数据库尚未初始化')
    expect(text).toContain('重试')
  })

  it('空错误走未知错误兜底', () => {
    expect(describeDesktopError({}, '我的货盘加载')).toContain('未知错误')
  })

  it('源码守卫：货盘页面不直显 reason.message', () => {
    const page = readFileSync(path.resolve(process.cwd(), 'src/renderer/erp/PalletWarehousePage.tsx'), 'utf8')
    expect(page).not.toContain('reason.message')
    expect(page).toContain('describeDesktopError')
  })
})
