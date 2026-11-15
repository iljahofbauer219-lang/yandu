import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  const contents = () => ({
    getURL: () => 'https://www.gigab2b.com/index.php?route=common/home',
    loadURL: async () => undefined,
    isDestroyed: () => false,
    destroy: () => undefined,
    close: () => undefined,
    getUserAgent: () => 'Mozilla/5.0 Electron/43.0.0 cross-border-sourcing-desktop/1.0',
    setUserAgent: () => undefined,
    setWindowOpenHandler: () => undefined,
    on: () => undefined,
    session: {
      setUserAgent: async () => undefined,
      setProxy: async () => undefined,
      closeAllConnections: async () => undefined
    }
  })
  class FakeWebContentsView {
    webContents = contents()
    setBackgroundColor = () => undefined
    setBounds = () => undefined
  }
  return {
    BaseWindow: class {},
    BrowserWindow: class {},
    WebContentsView: FakeWebContentsView,
    WebContents: class {},
    clipboard: { readText: () => '', writeText: () => undefined }
  }
})

import { BrowserWorkspace } from '../BrowserWorkspace'

type Host = Record<string, unknown> & { detailTabs: Map<string, FakeTab> }
type FakeView = {
  closedTimes: number
  setBackgroundColor: () => void
  setBounds: () => void
  webContents: {
    close: () => void
    getURL: () => string
    loadURL: () => Promise<void>
    isDestroyed: () => boolean
    on: () => void
    setUserAgent: () => void
    setWindowOpenHandler: () => void
  }
}
type FakeTab = {
  id: string
  platform: string
  title: string
  view: FakeView
  closable: boolean
  generic?: boolean
  scopeId?: string
}

const prototype = BrowserWorkspace.prototype as unknown as object
const methods = prototype as Record<string, unknown>
const showMethod = methods.show as (platform: string, tabId?: string) => Promise<void>
const activateSupplyMethod = methods.activateSupplyPlatform as (platformCode: '1688' | 'GIGACLOUD') => Promise<number | null>
const activateMarketplaceMethod = methods.activateMarketplace as (platformCode: string, accountId: string, strategy: string) => Promise<void>

function makeView(url = ''): FakeView {
  const view: FakeView = {
    closedTimes: 0,
    setBackgroundColor: () => undefined,
    setBounds: () => undefined,
    webContents: {
      close: () => { view.closedTimes += 1 },
      getURL: () => url,
      loadURL: async () => undefined,
      isDestroyed: () => false,
      on: () => undefined,
      setUserAgent: () => undefined,
      setWindowOpenHandler: () => undefined
    }
  }
  return view
}

function makeTab(id: string, options: { platform?: string; scopeId?: string; url?: string } = {}): FakeTab {
  const tab: FakeTab = { id, platform: options.platform || 'web', title: id, view: makeView(options.url), closable: true }
  if (options.scopeId) tab.scopeId = options.scopeId
  return tab
}

/**
 * 走真实原型链：show / get / switchTab / attachView / closeDetailTabs 用的都是生产代码本身，
 * 只替换掉推给外壳与渲染进程的副作用（emitState / emitTabs / addChildView）。
 */
function makeHost(tabs: FakeTab[], activeTabId: string) {
  const detailTabs = new Map<string, FakeTab>()
  for (const tab of tabs) detailTabs.set(tab.id, tab)
  const host = Object.create(prototype) as Host
  Object.assign(host, {
    detailTabs,
    activeTabId,
    active: 'web',
    views: new Map<string, FakeView>(),
    supplyViews: new Map<string, FakeView>(),
    builtInCollectorProducts: new Map<string, unknown>(),
    activationVersion: 0,
    supplyPlatformCode: '',
    browserVisible: true,
    attached: null,
    bounds: { x: 0, y: 0, width: 1200, height: 800 },
    credentialDomains: [],
    window: { contentView: { addChildView: () => undefined, removeChildView: () => undefined } },
    emitState: () => undefined,
    emitTabs: () => undefined,
    newTab: vi.fn(async () => tabs[0]?.id || 'fresh'),
    createView: () => makeView('https://www.gigab2b.com/index.php?route=common/home'),
    configureNetworkAndLoad: async () => undefined,
    isActivationCurrent: () => true
  })
  return host
}

const EBAY_TAB = 'login-ebay:s1'
const GENERIC_TAB = 'web-generic'

describe('栏目保活后的浏览器页签归属', () => {
  it('show 带上栏目自己的页签 id 时，附着的就是那个页签', async () => {
    const ebay = makeTab(EBAY_TAB, { scopeId: 'ebay:s1' })
    const generic = makeTab(GENERIC_TAB)
    const host = makeHost([generic, ebay], GENERIC_TAB)
    await showMethod.call(host, 'web', EBAY_TAB)
    expect(host.attached).toBe(ebay.view)
    expect(host.activeTabId).toBe(EBAY_TAB)
  })

  it('show 不带 id 时不会占用别的栏目的 eBay 会话页签', async () => {
    const ebay = makeTab(EBAY_TAB, { scopeId: 'ebay:s1' })
    const generic = makeTab(GENERIC_TAB)
    // eBay 页签排在前面且仍是主进程记住的活动页签：切走 AI跨境 后 货盘采集/文章抓取 才更容易撞上它
    const host = makeHost([ebay, generic], EBAY_TAB)
    await showMethod.call(host, 'web')
    expect(host.attached, '通用界面只能落在无归属的通用页签上').toBe(generic.view)
  })

  it('页签 id 失效（用户已关闭）时退回平台默认页签，不报错也不新建', async () => {
    const generic = makeTab(GENERIC_TAB)
    const host = makeHost([generic], GENERIC_TAB)
    await showMethod.call(host, 'web', 'login-ebay:已被用户关闭')
    expect(host.attached).toBe(generic.view)
    expect(host.newTab).not.toHaveBeenCalled()
  })

  it('只有 eBay 会话页签的场合（无通用页签）仍回到 eBay 页签本身', async () => {
    const ebay = makeTab(EBAY_TAB, { scopeId: 'ebay:s1' })
    const host = makeHost([ebay], EBAY_TAB)
    await showMethod.call(host, 'web')
    expect(host.attached).toBe(ebay.view)
  })

  it('IE 浏览恢复自己上次选中的页签，而不是第一枚', async () => {
    const first = makeTab('ie-1', { platform: 'ie' })
    const second = makeTab('ie-2', { platform: 'ie' })
    const host = makeHost([first, second], 'ie-2')
    host.activeTabId = 'web-noise'
    await showMethod.call(host, 'ie', 'ie-2')
    expect(host.attached).toBe(second.view)
  })
})

describe('供应平台与市场平台激活不得销毁其它栏目的页签', () => {
  it('activateSupplyPlatform 之后 eBay 会话页签仍在，且没有被 close', async () => {
    const ebay = makeTab(EBAY_TAB, { scopeId: 'ebay:s1' })
    const ie = makeTab('ie-1', { platform: 'ie' })
    const host = makeHost([ebay, ie], EBAY_TAB)
    await activateSupplyMethod.call(host, 'GIGACLOUD')
    expect(host.detailTabs.has(EBAY_TAB), '切到货盘采集不应销毁 eBay 登录页签').toBe(true)
    expect(host.detailTabs.has('ie-1'), '切到货盘采集不应销毁 IE 浏览页签').toBe(true)
    expect(ebay.view.closedTimes, 'eBay 页签的 webContents 不得被关闭').toBe(0)
    expect(ie.view.closedTimes).toBe(0)
  })

  it('activateMarketplace 之后其它栏目的页签仍在，且没有被 close', async () => {
    const ebay = makeTab(EBAY_TAB, { scopeId: 'ebay:s1' })
    const generic = makeTab(GENERIC_TAB)
    const host = makeHost([ebay, generic], EBAY_TAB)
    await activateMarketplaceMethod.call(host, 'EBAY', 'acct-1', 'LOCAL_DIRECT')
    expect(host.detailTabs.has(EBAY_TAB), '切到市场平台不应销毁 eBay 登录页签').toBe(true)
    expect(host.detailTabs.has(GENERIC_TAB), '切到市场平台不应销毁通用页签').toBe(true)
    expect(ebay.view.closedTimes).toBe(0)
    expect(generic.view.closedTimes).toBe(0)
  })

  it('市场平台激活仍会重建并关闭自己的旧市场视图', async () => {
    const ebay = makeTab(EBAY_TAB, { scopeId: 'ebay:s1' })
    const host = makeHost([ebay], EBAY_TAB)
    const previousOzon = makeView('https://www.ozon.ru/')
    host.views = new Map([['ozon', previousOzon]])
    host.attached = previousOzon
    await activateMarketplaceMethod.call(host, 'AMAZON', 'acct-1', 'SYSTEM')
    expect(previousOzon.closedTimes, '旧市场视图仍按原逻辑关闭').toBe(1)
    expect(ebay.view.closedTimes).toBe(0)
    expect(host.detailTabs.has(EBAY_TAB)).toBe(true)
  })

  it('供应平台激活仍把大健云仓视图挂回界面', async () => {
    const ebay = makeTab(EBAY_TAB, { scopeId: 'ebay:s1' })
    const host = makeHost([ebay], EBAY_TAB)
    await expect(activateSupplyMethod.call(host, 'GIGACLOUD')).resolves.not.toBeNull()
    expect(host.attached, '激活后必须把供应视图挂上界面').toBeTruthy()
    expect(host.supplyTabVisible).toBe(true)
  })
})
