import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (...parts: string[]) => readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8')
const workspaceSource = read('main', 'browser', 'BrowserWorkspace.ts')
const mainSource = read('main', 'main.ts')
const preloadSource = read('preload', 'preload.ts')
const appSource = read('renderer', 'App.tsx')
const cssSource = read('renderer', 'image-studio.css')
const contractSource = read('shared', 'contracts.ts')

const slice = (source: string, from: string, to: string) => {
  const start = source.indexOf(from)
  expect(start, `${from} 必须存在`).toBeGreaterThan(-1)
  const rest = source.slice(start)
  const end = rest.indexOf(to, from.length)
  return end === -1 ? rest : rest.slice(0, end)
}

describe('收货地二选一 · 主进程只走 eBay 官方偏好接口', () => {
  const method = () => slice(workspaceSource, 'async setEbayDeliveryCountry', '\n  private ')

  it('POST /gh/setuserpreference，body 用 userPreferedCountry 三位码', () => {
    expect(method()).toContain('/gh/setuserpreference')
    expect(method()).toContain('userPreferedCountry')
    expect(method()).toContain("credentials:'include'")
    expect(method()).toContain('ebayDeliveryAlpha3')
  })

  it('只作用于当前已附加页签，不另开隐藏窗口、不新建会话', () => {
    expect(method()).toContain('this.attached')
    expect(method()).not.toMatch(/new WebContentsView|new BaseWindow|fromPartition/)
  })

  it('页内异步脚本必须是已调用的 IIFE：回传函数对象会克隆失败', () => {
    const bodies = [...method().matchAll(/executeJavaScript\(`([\s\S]*?)`,true\)/g)].map(m => m[1])
    expect(bodies.length).toBeGreaterThan(0)
    for (const body of bodies) {
      if (body.trimStart().startsWith('(async()=>{')) expect(body.trimEnd().endsWith('})()')).toBe(true)
    }
  })

  it('页面回传走 JSON 字符串再解析，不直接回传页面对象（上下文销毁时对象无法克隆）', () => {
    expect(method()).toContain('return JSON.stringify({status:res.status,accepted})')
    expect(method()).toContain('parseEbayPreferencePost')
    expect(method()).not.toMatch(/return \{status:res\.status,accepted\}/)
  })

  it('结果判定交给 shared 纯函数，不在主进程另抄文案', () => {
    expect(method()).toContain('resolveEbayDeliveryCountry')
    expect(workspaceSource).toMatch(/from '[^']*shared\/ebayDeliveryCountry'/)
  })

  it('刊登编辑页不自动刷新，其它页面刷新后读回 GHpre.shipToLocation', () => {
    expect(method()).toContain('isEbayListingFormUrl')
    expect(method()).toContain('reloadAndReadShipToLocation')
    const helper = slice(workspaceSource, 'private async reloadAndReadShipToLocation', '\n  private ')
    expect(helper).toContain('shipToLocation')
    expect(helper).toMatch(/reload\(\)/)
  })

  it('切换前先读邮编并快照当前店铺会话的 nonsession，不新建会话', () => {
    const body = method()
    expect(body).toContain('readEbayDeliveryPostal')
    expect(body.indexOf('readEbayDeliveryPostal')).toBeLessThan(body.indexOf('/gh/setuserpreference'))
    expect(body).toContain("cookies.get({name:'nonsession'})")
    expect(body).toContain('session.cookies.set(')
    expect(body).toContain('postalBefore')
  })

  it('只在邮编被清空时回写快照，读回是别的非空邮编不覆盖', () => {
    expect(method()).toContain("readEbayDeliveryPostal(header.shipToLocation)===''")
  })

  it('邮编记忆按店铺会话跨调用保存，回程不重新捕获已清空的邮编', () => {
    expect(method()).toContain('resolvePostalRetention')
    expect(method()).toContain('const session=view.webContents.session')
    expect(method()).toContain('this.ebayDeliveryPostalSnapshots.get(session)')
    expect(method()).toContain('this.ebayDeliveryPostalSnapshots')
    expect(workspaceSource).toContain('private ebayDeliveryPostalSnapshots=new Map')
  })

  it('旧的「找控件点一下」能力已删除，不留双入口', () => {
    expect(workspaceSource).not.toContain('openEbayDeliveryLocation')
    expect(mainSource).not.toContain('ebay-delivery-location:open')
    expect(preloadSource).not.toContain('openEbayDeliveryLocation')
    expect(appSource).not.toContain('openEbayDeliveryLocation')
    expect(contractSource).not.toContain('EbayDeliveryLocationResult')
  })
})

describe('收货地二选一 · IPC 与 preload 带国家参数', () => {
  it('主进程注册 set 通道并把国家透传给能力', () => {
    expect(mainSource).toContain("ipcMain.handle('browser:ebay-delivery-country:set'")
    const handler = slice(mainSource, "ipcMain.handle('browser:ebay-delivery-country:set'", '\n')
    expect(handler).toContain('setEbayDeliveryCountry')
    expect(handler).toMatch(/country/)
  })

  it('preload 暴露带参方法，契约声明国家联合类型', () => {
    expect(preloadSource).toContain("setEbayDeliveryCountry: (country: EbayDeliveryCountry)")
    expect(preloadSource).toContain("'browser:ebay-delivery-country:set', country")
    expect(contractSource).toContain("export type EbayDeliveryCountry = 'US' | 'CN'")
    expect(contractSource).toContain('export interface EbayDeliveryCountryResult')
  })
})

describe('收货地二选一 · 渲染端两项菜单沿用工具栏样式', () => {
  const portal = () => slice(appSource, 'const ebayDeliveryButton', 'return <section className="ebay-platform-page">')

  it('菜单里只有美国与中国两个选项，选中项高亮', () => {
    expect(portal()).toContain('EBAY_DELIVERY_OPTIONS')
    expect(portal()).toContain('ebay-delivery-menu')
    expect(portal()).toMatch(/option\.code===ebayDeliveryCountry\?'active':''/)
  })

  it('按钮文案跟随所选国家，切换中禁用', () => {
    expect(portal()).toContain('ebay-delivery-trigger')
    expect(portal()).toContain('ebayDeliveryLabel')
    expect(portal()).toContain('disabled={ebayDeliverySwitching}')
  })

  it('失败给可点手动出口，要求刷新时给刷新按钮', () => {
    const handler = slice(appSource, 'const switchEbayDeliveryCountry', 'const translateEbayPage')
    expect(handler).toContain('setEbayDeliveryCountry')
    expect(handler).toContain('result.manualUrl')
    expect(handler).toContain('result.refreshRequired')
    expect(handler).toContain('setEbayErrorAction')
  })

  it('主进程走原生语言序列：构造 dp1、带 lang 参数导航、调 UpdateUserInfo', () => {
    const body = slice(workspaceSource, 'async setEbayDeliveryCountry', '\n  private ')
    expect(body).toContain('buildNativeLanguageDp1')
    expect(body).toContain("searchParams.set('lang'")
    expect(body).toContain('UpdateUserInfo')
    expect(body).toContain('session.fetch(')
    expect(body).toContain('ebayNativeLanguage')
  })

  it('渲染端不再联动 Qwen-MT 翻译，翻译按钮保留为独立手动功能', () => {
    const handler = slice(appSource, 'const switchEbayDeliveryCountry', 'const translateEbayPage')
    expect(handler).not.toContain('translateEbayPage')
    expect(handler).not.toContain('restoreEbayTranslation')
    expect(appSource).not.toContain('resolveDeliveryTranslationLink')
    expect(appSource).toContain('translation-trigger')
  })

  it('语言态以页签读回为准：onState 与进页签时同步，重启先读兜底', () => {
    expect(appSource).toContain('getEbayDeliveryLanguage')
    expect(appSource).toContain('ebayDeliveryCountryFromLanguage')
    expect(appSource).toContain('parseStoredEbayDeliveryCountry(localStorage.getItem(')
    expect(appSource).toContain('localStorage.setItem(ebayDeliveryCountryStorageKey(')
    const onState = slice(appSource, 'window.desktop.browser.onState(', '),[])')
    expect(onState).toContain('syncEbayDeliveryLanguage')
  })

  it('兜底初始化不依赖浏览器页签：直进线上发布也能恢复语言态', () => {
    const effect = slice(appSource, 'useEffect(()=>{if(!activeStore)return;const stored=', '},[activeStore?.id])')
    expect(effect).toContain('parseStoredEbayDeliveryCountry')
    expect(effect).not.toContain('activeTab')
  })

  it('主进程只读读回 lng，不刷新不清探针', () => {
    const getter = slice(workspaceSource, 'async getEbayDeliveryLanguage', '\n  private ')
    expect(getter).toContain('window.GH')
    expect(getter).toContain('.lng')
    expect(getter).not.toMatch(/reload\(\)|__crossBorderDeliveryProbe/)
    expect(mainSource).toContain("ipcMain.handle('browser:ebay-delivery-language:get'")
    expect(preloadSource).toContain('getEbayDeliveryLanguage')
  })

  it('不再宣称「仅保存在当前店铺会话」这类不实文案', () => {
    expect(appSource).not.toContain('设置会仅保存在当前店铺会话中')
  })

  it('两项菜单有自己的样式块，不套用翻译菜单的五列网格', () => {
    expect(cssSource).toContain('.ebay-delivery-menu')
    const menu = slice(cssSource, '.ebay-delivery-menu {', '}')
    expect(menu).not.toContain('repeat(4,1fr)')
    expect(cssSource).toContain('.ebay-delivery {')
  })
})