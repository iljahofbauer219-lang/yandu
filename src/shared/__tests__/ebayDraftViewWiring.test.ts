import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (...parts: string[]) => readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8')
const appSource = read('renderer', 'App.tsx')
const targetSource = read('shared', 'ebayListingTarget.ts')

const slice = (source: string, from: string, to: string) => {
  const start = source.indexOf(from)
  expect(start, `${from} 必须存在`).toBeGreaterThan(-1)
  const rest = source.slice(start)
  const end = rest.indexOf(to, from.length)
  return end === -1 ? rest : rest.slice(0, end)
}

describe('草稿查看直链继续完成草稿 · 渲染端接线', () => {
  it('viewPublishDraft 的 draft 分支走共享构造器，navigate 与库存回写链保留', () => {
    const body = slice(appSource, 'const viewPublishDraft=', 'const openSavedDraftForRun=')
    expect(body).toContain("ref.kind==='draft'?buildEbayDraftContinueUrl(ref.id):")
    expect(body).toContain("window.desktop.browser.navigate('web',url)")
    expect(body).toContain('readDraftQuantity(')
    expect(body).toContain('setLocalProductMeta(')
  })

  it('后台轻量开草稿与草稿查看同构造器＋loadURL 不附着＋等标题就绪（主进程 workspace）', () => {
    const ws = readFileSync(path.join(__dirname, '..', '..', 'main', 'browser', 'BrowserWorkspace.ts'), 'utf8')
    const start = ws.indexOf('async openEbaySavedDraftForRun(')
    expect(start).toBeGreaterThan(-1)
    const body = ws.slice(start, start + 1200)
    expect(body).toContain('buildEbayDraftContinueUrl(draftId)')
    expect(body).toContain('tab.view.webContents.loadURL(')
    expect(body).not.toContain('this.show(')
    expect(body).toContain('readEbayCurrentTitle()')
  })

  it('viewPublishDraft 先附着店铺会话页签再 navigate（防落通用罐被 splashui 当匿名拦）', () => {
    const body = slice(appSource, 'const viewPublishDraft=', 'const openSavedDraftForRun=')
    const showAt = body.indexOf("await window.desktop.browser.show('web',ebayOwnTabId.current)")
    const navAt = body.indexOf("window.desktop.browser.navigate('web',url)")
    expect(showAt, 'viewPublishDraft 必须先 show 附着店铺页签').toBeGreaterThan(-1)
    expect(navAt).toBeGreaterThan(-1)
    expect(showAt).toBeLessThan(navAt)
  })

  it('后台轻量开草稿不附着视图（主进程调度不扰用户当前页）＋loadURL 续作页', () => {
    const ws = readFileSync(path.join(__dirname, '..', '..', 'main', 'browser', 'BrowserWorkspace.ts'), 'utf8')
    const body = ws.slice(ws.indexOf('async openEbaySavedDraftForRun('), ws.indexOf('async openEbaySavedDraftForRun(') + 1200)
    expect(body).toContain('tab.view.webContents.loadURL(buildEbayDraftContinueUrl(draftId))')
    expect(body).not.toContain('this.show(')
    expect(body).not.toContain('attachView')
  })

  it('App.tsx 不再留内联 lstng?draftId 模板，路由单一真值', () => {
    expect(appSource).not.toContain('lstng?draftId=')
  })

  it('import 登记共享构造器', () => {
    expect(appSource).toMatch(/import \{[^}]*buildEbayDraftContinueUrl[^}]*\} from '\.\.\/shared\/ebayListingTarget'/)
  })
})

describe('草稿查看直链继续完成草稿 · 共享构造器单一真值', () => {
  it('ReturnURL 常量指草稿栏，resolver 草稿分支引用构造器', () => {
    expect(targetSource).toContain("const DRAFT_RETURN_URL = 'https://www.ebay.com/sh/lst/drafts'")
    expect(targetSource).toContain('url: buildEbayDraftContinueUrl(ref.id)')
  })
})