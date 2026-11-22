import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 原商品打开链落地判断：eBay 瞬时错误页（Error Page | eBay／Something went wrong on our end）
 * 自动有界刷新（3 次退避）直至商品页真特征就绪；captcha/splashui 验证页不刷新（人工口径不变）；
 * 重试耗尽主进程抛中文错、渲染端挂「重试」动作重新打开，不留错误页静默。
 */
const read = (...parts: string[]) => readFileSync(path.join(__dirname, '..', '..', '..', ...parts), 'utf8')
const ws = read('main', 'browser', 'BrowserWorkspace.ts')
const main = read('main', 'main.ts')
const app = read('renderer', 'App.tsx')

describe('ensureEbayProductTabLanded · 错误页有界重试', () => {
  const start = ws.indexOf('async ensureEbayProductTabLanded(')
  const body = ws.slice(start, start + 2600)
  it('错误页签名：标题 Error Page 或正文 Something went wrong on our end', () => {
    expect(start).toBeGreaterThan(-1)
    expect(body).toContain('Something went wrong on our end')
    expect(body).toContain('Error Page')
  })
  it('验证页（captcha/splashui）不刷新直接返回，人工口径不变', () => {
    expect(body).toMatch(/captcha\|splashui/)
    expect(body).toContain('verification:true')
  })
  it('有界 3 次＋退避＋reload；成功判据用商品页真特征（h1 标题）', () => {
    expect(body).toContain('attempt<3')
    expect(body).toContain('view.webContents.reload()')
    expect(body).toContain('document.querySelector(\'h1\')')
  })
})

describe('openEbayProductTab · 打开后落地判断', () => {
  const start = main.indexOf('async function openEbayProductTab(')
  const body = main.slice(start, start + 1200)
  it('open 成功后调 ensureEbayProductTabLanded；耗尽抛中文错', () => {
    expect(start).toBeGreaterThan(-1)
    expect(body).toContain('workspace!.ensureEbayProductTabLanded(')
    expect(body).toContain('eBay 商品页多次刷新仍返回错误页')
  })
})

describe('渲染端 · 耗尽挂重试动作', () => {
  const start = app.indexOf('const openPendingOriginalProduct=')
  const body = app.slice(start, start + 1200)
  it('catch 里设「重试」动作重开原商品，错误中文全文', () => {
    expect(start).toBeGreaterThan(-1)
    expect(body).toContain("setEbayErrorAction({label:'重试'")
    expect(body).toContain('pendingOriginalProduct.current=item')
    expect(body).toContain("readableError(reason,'原商品打开失败')")
  })
})