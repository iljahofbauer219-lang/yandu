import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 用户口径（2026-11-20 19:31 红框，撤销同日删除决策）：汇报信息放回各页签左栏底槽，
 * 每栏只报自己的信息（按页签归属保留）；顶栏信息槽移除。
 * 有左栏的五页签 browser/library/local/premium/optimize 各一槽（折叠不渲染，同 11-14 口径）；
 * 线上发布无左栏，沿用面板内 notice/error 渲染；登录横幅仅店铺浏览。
 */
const appSource = readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8')
const cssSource = readFileSync(path.join(__dirname, '..', 'image-studio.css'), 'utf8')

describe('汇报信息左栏底 · 渲染点', () => {
  it('信息 fragment 含登录横幅/notice/error/toast 四者', () => {
    const start = appSource.indexOf('const ebayInfoBoxes=')
    expect(start).toBeGreaterThan(-1)
    const body = appSource.slice(start, appSource.indexOf('const ebayInfoInAside=', start))
    expect(body).toContain('{loginBanner}')
    expect(body).toContain('ebay-success-notice')
    expect(body).toContain('ebay-error-notice')
    expect(body).toContain('ebay-download-toast')
  })
  it('五左栏槽各一＋顶栏槽删除', () => {
    expect(appSource.split('className="ebay-workbench-info"').length - 1).toBe(5)
    expect(appSource.split('{ebayInfoBoxes}').length - 1).toBe(5)
    expect(appSource).not.toContain('ebay-head-info')
    expect(cssSource).not.toContain('ebay-head-info')
  })
  it('ebayInfoInAside 五页签条件（折叠不渲染）', () => {
    expect(appSource).toContain("const ebayInfoInAside=(activeTab==='browser'&&Boolean(activeStore)&&!ebayWorkbenchPanel.collapsed)||(activeTab==='library'&&!ebayCatalogPanel.collapsed)||(activeTab==='local'&&!ebayCatalogPanel.collapsed)||(activeTab==='premium'&&!ebayCatalogPanel.collapsed)||(activeTab==='optimize'&&!lockTitleMode)")
  })
  it('线上发布面板内 notice/error 保留（无左栏页签的汇报位）', () => {
    const seg = appSource.split("{activeTab==='publish'&&<div className=\"ebay-stage-panel ebay-publish-stage\">")[1]?.split('本地定时发布')[0] ?? ''
    expect(seg).toContain('{notice&&<div className="ebay-success-notice">')
    expect(seg).toContain('{ebayError&&<div className="ebay-error-notice">')
  })
})

describe('汇报信息左栏底 · 按栏目归属保留', () => {
  it('notice/error/toast 来源页签记录＋同签渲染', () => {
    expect(appSource).toContain('const [noticeByTab,setNoticeByTab]=useState<Partial<Record<EbayWorkspaceTab,string>>>({})')
    expect(appSource).toContain('const notice=noticeByTab[activeTab]||')
    expect(appSource).toContain('const ebayError=ebayErrorByTab[activeTab]||')
    expect(appSource).toContain('const downloadToast=downloadToastByTab[activeTab]??null')
  })
  it('loginBanner 仅店铺浏览', () => {
    expect(appSource).toContain("const loginBanner=activeTab==='browser'&&activeStore?")
  })
})

describe('汇报信息左栏底 · 槽样式', () => {
  it('槽堆叠网格、toast 静态、窄栏换行 11px、通知 static 去最小高', () => {
    expect(cssSource).toContain('.ebay-workbench-info{display:grid;gap:8px;margin-top:10px;align-content:start}')
    const t = cssSource.indexOf('.ebay-workbench-info .ebay-download-toast{')
    expect(t).toBeGreaterThan(-1)
    expect(cssSource.slice(t, cssSource.indexOf('}', t))).toContain('position:static')
    const n = cssSource.indexOf('.ebay-workbench-info .ebay-success-notice')
    expect(n).toBeGreaterThan(-1)
    const block = cssSource.slice(n, cssSource.indexOf('}', n))
    expect(block).toContain('align-items:flex-start')
    expect(block).toContain('font-size:11px')
    expect(block).toContain('white-space:normal')
    expect(block).toContain('position:static')
    expect(block).toContain('min-height:0')
  })
})