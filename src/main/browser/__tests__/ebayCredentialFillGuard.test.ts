import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 根因（2026-11-16 现网取证）：草稿页标题被写成店铺用户名 cnyandu。
 * fillActiveLogin 仅按域名放行，eBay 刊登/草稿页同属 ebay.com；其 username 兜底选择器
 * input[type="text"] 命中草稿页第一个可见文本框＝标题框，把用户名写进标题覆盖原标题。
 * 修复：填充前先判登录页（#userid/#pass/password 输入或 signin/login/reg 路径），非登录页拒绝填充并报错，
 * 绝不把凭据写进刊登/草稿表单。
 */
const ws = readFileSync(path.resolve(process.cwd(), 'src/main/browser/BrowserWorkspace.ts'), 'utf8')

describe('凭据填充 · 登录页门卫', () => {
  const seg = ws.split('async fillActiveLogin(')[1]?.split('async fillEbay')[0] ?? ws.split('async fillActiveLogin(')[1] ?? ''
  it('fillActiveLogin 填充前先判登录页，非登录页拒绝并中文报错', () => {
    expect(seg).toContain('const isLoginPage =')
    expect(seg).toContain('if(!isLoginPage)throw new Error(')
    expect(seg).toContain('当前页面不是登录页，已拒绝填充凭据')
  })
  it('登录页判定认 userid/pass/password 控件或 signin/login/reg 路径', () => {
    expect(seg).toContain('#userid,#pass,input[type="password"]')
    expect(seg).toMatch(/signin\|.*login\|.*reg|signin.*login.*reg/)
  })
  it('门卫位于实际填充（usernameFilled=set）之前', () => {
    expect(seg.indexOf('if(!isLoginPage)throw')).toBeLessThan(seg.indexOf('usernameFilled=set'))
  })
})