import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * lstng/sl/list 刊登编辑页满是文本输入框，inspectEbayLogin 的 input[type="text"] 兜底会把它误判成
 * USERNAME 登录表单；ensureEbayLogin 的 cookies-alive 分支随即 loadURL sh/ovw，把「草稿查看」刚打开的
 * 继续完成草稿页拉走。eBay 对刊登表单强制服务端鉴权：未登录会被重定向到 signin，能落在表单页即会话有效。
 * 钉住：已落地且无验证挑战的刊登表单页判 ONLINE；signin/login 页与验证页不受此豁免。
 */
const source = readFileSync(path.resolve(process.cwd(), 'src/main/browser/BrowserWorkspace.ts'), 'utf8')
const start = source.indexOf('private async inspectEbayLogin(')
const body = source.slice(start, source.indexOf('private async submitEbayLoginStep(', start))

describe('inspectEbayLogin · 刊登编辑页不误判为登录表单', () => {
  it('listingForm 判定：lstng/sl/list 路径＋排除 signin/login＋排除验证挑战', () => {
    expect(start).toBeGreaterThan(-1)
    expect(body).toContain("const listingForm=!lowerUrl.includes('signin')&&!lowerUrl.includes('login')&&!securityPage&&/\\\\/(lstng|sl\\\\/list)/i.test(new URL(url).pathname)")
  })
  it('ONLINE 分支纳入 listingForm，原 sellerHub/signedInLink 判据保留', () => {
    expect(body).toContain("if(sellerHub||signedInLink||listingForm)phase='ONLINE'")
  })
  it('cookies-alive 分支的 loadURL ovw 与自动填写链不动（只修分类，不改登录流程）', () => {
    const ensure = source.slice(source.indexOf('async ensureEbayLogin('), source.indexOf('async ensureEbayLogin(') + 4200)
    expect(ensure).toContain("await view.webContents.loadURL('https://www.ebay.com/sh/ovw')")
    expect(ensure).toContain('已恢复原有eBay登录会话')
  })
})