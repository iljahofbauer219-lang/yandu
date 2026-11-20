import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 用户口径（2026-11-20 截图红/黄/绿框，推翻 2026-11-14 左栏决策）：
 * 顶栏市场数据 chip 删除；全部信息提示（notice/error/loginBanner/toast）移顶栏右单一渲染点；
 * 左栏底槽不再渲染；提示按栏目归属——写入时记录来源页签、仅同页签可见（跨页签流程显式传目标页签），
 * loginBanner 仅店铺浏览。内容与关闭/重试交互不变。
 */
const appSource = readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8')
const cssSource = readFileSync(path.join(__dirname, '..', 'image-studio.css'), 'utf8')

describe('信息提示顶栏归位 · 渲染点', () => {
  it('信息 fragment 含登录横幅/notice/error/toast 四者', () => {
    const start = appSource.indexOf('const ebayInfoBoxes=')
    expect(start).toBeGreaterThan(-1)
    const body = appSource.slice(start, appSource.indexOf('return <section className="ebay-platform-page">', start))
    expect(body).toContain('{loginBanner}')
    expect(body).toContain('ebay-success-notice')
    expect(body).toContain('ebay-error-notice')
    expect(body).toContain('ebay-download-toast')
  })
  it('顶栏右单一渲染点，左栏槽与 ebayInfoInAside 全删', () => {
    expect(appSource.split('{ebayInfoBoxes}').length - 1).toBe(1)
    expect(appSource).toContain('<div className="ebay-head-info">{ebayInfoBoxes}</div>')
    expect(appSource).not.toContain('ebay-workbench-info')
    expect(appSource).not.toContain('ebayInfoInAside')
  })
  it('市场数据 chip 内容删除', () => {
    expect(appSource).not.toContain('ebay-omkar-chip')
    expect(appSource).not.toContain('已成交市场数据：eBay 登录态研究页')
    expect(cssSource).not.toContain('ebay-omkar-chip')
  })
})

describe('信息提示顶栏归位 · 按栏目归属', () => {
  it('notice/error/toast 均为来源页签记录＋同签渲染', () => {
    expect(appSource).toContain('const [noticeByTab,setNoticeByTab]=useState<Partial<Record<EbayWorkspaceTab,string>>>({})')
    expect(appSource).toContain('const [ebayErrorByTab,setEbayErrorByTab]=useState<Partial<Record<EbayWorkspaceTab,string>>>({})')
    expect(appSource).toContain('const [downloadToastByTab,setDownloadToastByTab]=useState<Partial<Record<EbayWorkspaceTab,EbayInfoToast>>>({})')
    expect(appSource).toContain('const notice=noticeByTab[activeTab]||')
    expect(appSource).toContain('const ebayError=ebayErrorByTab[activeTab]||')
    expect(appSource).toContain('const downloadToast=downloadToastByTab[activeTab]??null')
    expect(appSource).toContain('const setNotice=(next:string|((cur:string)=>string),tab?:EbayWorkspaceTab)=>{const key=tab??activeTabRef.current;')
    expect(appSource).toContain('const setEbayError=(text:string,tab?:EbayWorkspaceTab)=>setEbayErrorByTab(cur=>({...cur,[tab??activeTabRef.current]:text}))')
  })
  it('调度/转出/对账跨页签流程显式归 publish，打回优品归 premium', () => {
    const due = appSource.split('dueScheduledPublish(scheduledPublishRef.current')[1]?.split('},15000)')[0] ?? ''
    expect(due).toContain("跳过重复自动发布：${product.title.slice(0,40)}。`,'publish')")
    expect(due).toContain("setEbayError(lastError,'publish')")
    expect(appSource).toContain("草稿图用服务器原图。`,'premium')")
    expect(appSource).toContain("已移出线上发布并同步到线上产品·产品目录。`,'publish')")
  })
  it('loginBanner 仅店铺浏览页签', () => {
    expect(appSource).toContain("const loginBanner=activeTab==='browser'&&activeStore?")
  })
})

describe('信息提示顶栏归位 · 顶栏槽样式', () => {
  it('顶栏槽右对齐可堆叠换行，toast 静态不遮罩', () => {
    expect(cssSource).toContain('.ebay-head-info{margin-left:auto;display:grid;gap:6px;align-content:start;max-width:min(560px,44vw);min-width:0}')
    const start = cssSource.indexOf('.ebay-head-info .ebay-download-toast{')
    expect(start).toBeGreaterThan(-1)
    expect(cssSource.slice(start, cssSource.indexOf('}', start))).toContain('position:static')
    const n = cssSource.indexOf('.ebay-head-info .ebay-success-notice')
    expect(n).toBeGreaterThan(-1)
    const block = cssSource.slice(n, cssSource.indexOf('}', n))
    expect(block).toContain('align-items:flex-start')
    expect(block).toContain('font-size:11px')
    expect(block).toContain('white-space:normal')
  })
  it('store-bar 高度自适应信息堆叠', () => {
    expect(cssSource).toContain('.ebay-store-bar { min-height:64px;')
  })
})