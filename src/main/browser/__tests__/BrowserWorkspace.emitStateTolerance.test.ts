import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 用户口径（2026-11-23 23:39 绿框弹框）：主进程未捕获异常「通用网页标签不存在」。
 * 链：emitState→getState→getCurrentView→get('web') throw；触发＝凭据登录后台加载在通用页签建立前发射状态。
 * 权限门（e53e89c）阻止附着后 attached 为空使 getCurrentView 落 get throw，属该轮回归；
 * 修复：emitState 对 getState try/catch、缺失跳过本次发射（不改 get 的 throw 语义，免伤 attach 调用方）。
 */
const ws = readFileSync(path.resolve(process.cwd(), 'src/main/browser/BrowserWorkspace.ts'), 'utf8')

describe('emitState 容忍通用页签缺失', () => {
  it('getState 抛错即跳过发射，不再冒泡成主进程崩溃弹框', () => {
    const seg = ws.split('  private emitState(platform: Platform) {')[1]?.split('\n  private emitTabs')[0] ?? ''
    expect(seg).toContain('try { state = this.getState(platform) } catch { return }')
    expect(seg).toContain("this.shellContents.send('browser:state', state)")
  })
  it('get 的 throw 语义保留（attach 调用方依赖）', () => {
    expect(ws).toContain("throw new Error('通用网页标签不存在')")
  })
})