import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  const contents = () => ({
    getURL: () => 'https://example.com/',
    loadURL: async () => undefined,
    isDestroyed: () => false,
    destroy: () => undefined,
    close: () => undefined,
    getUserAgent: () => 'Mozilla/5.0 Electron/43.0.0',
    setUserAgent: () => undefined,
    setWindowOpenHandler: () => undefined,
    on: () => undefined,
    session: { setUserAgent: async () => undefined, setProxy: async () => undefined, closeAllConnections: async () => undefined }
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

/**
 * 栏目保活后，供应/市场平台激活不再销毁其它栏目的页签，于是「全局 8 枚」会跨栏目累加：
 * 用户在 AI跨境 只看见 2 枚页签，却被要求去关一些当前页签条根本不显示的页签
 * （页签条按 scopeId / platform 过滤）。口径改为：8 枚只算本栏目，另设全局硬顶 24 防内存失控，
 * 硬顶文案必须点名各栏目占用数，让提示可操作。
 */
type FakeTab = { id: string; platform: string; scopeId?: string }
type Host = { detailTabs: Map<string, FakeTab>; supplyTabVisible: boolean; marketplaceTabVisible: boolean }

const methods = BrowserWorkspace.prototype as unknown as Record<string, unknown>
const assertCapacity = methods.assertTabCapacity as (this: Host, platform: string, scopeId?: string) => void
const groupCount = methods.groupTabCount as (this: Host, platform: string, scopeId?: string) => number
const totalCount = methods.totalTabCount as (this: Host) => number

function makeHost(tabs: Array<{ platform: string; scopeId?: string }> = [], supply = false, marketplace = false): Host {
  const detailTabs = new Map<string, FakeTab>()
  tabs.forEach((tab, index) => detailTabs.set(`t${index}`, { id: `t${index}`, ...tab }))
  // 继承原型：被测方法之间会互相调用（assertTabCapacity → groupTabCount/totalTabCount/tabCensus）
  return Object.assign(Object.create(BrowserWorkspace.prototype), { detailTabs, supplyTabVisible: supply, marketplaceTabVisible: marketplace }) as Host
}
const fill = (n: number, platform: string, scopeId?: string) => Array.from({ length: n }, () => ({ platform, scopeId }))
const run = (host: Host, platform: string, scopeId?: string) => () => assertCapacity.call(host, platform, scopeId)

describe('页签额度按栏目计数', () => {
  it('本栏目 7 枚时放行', () => {
    expect(run(makeHost(fill(7, 'web')), 'web')).not.toThrow()
  })

  it('本栏目满 8 枚时拦住，文案限定「当前栏目」', () => {
    expect(run(makeHost(fill(8, 'web')), 'web')).toThrow('当前栏目最多同时打开8个浏览标签，请先关闭不需要的标签')
  })

  it('别的栏目占满 8 枚不占本栏目额度', () => {
    const host = makeHost([...fill(8, 'ie'), ...fill(8, 'web', 'ebay:store-a')])
    expect(run(host, 'web')).not.toThrow()
    expect(groupCount.call(host, 'web')).toBe(0)
  })

  it('eBay 两个店铺各自计数：A 店满 8 枚不影响 B 店', () => {
    const host = makeHost(fill(8, 'web', 'ebay:store-a'))
    expect(run(host, 'web', 'ebay:store-b')).not.toThrow()
    expect(run(host, 'web', 'ebay:store-a')).toThrow('当前栏目')
    expect(groupCount.call(host, 'web', 'ebay:store-a')).toBe(8)
  })

  it('IE浏览 与通用网页互不占额度', () => {
    const host = makeHost(fill(8, 'ie'))
    expect(run(host, 'web')).not.toThrow()
    expect(run(host, 'ie')).toThrow('当前栏目')
  })

  it('供应视图计入 1688 组、市场视图计入 ozon 组', () => {
    expect(run(makeHost(fill(7, '1688'), true, false), '1688')).toThrow('当前栏目')
    expect(run(makeHost(fill(7, 'ozon'), false, true), 'ozon')).toThrow('当前栏目')
    expect(run(makeHost(fill(7, 'web'), true, true), 'web')).not.toThrow()
  })
})

describe('全局硬顶防内存失控', () => {
  it('合计 23 枚且本栏目未满时放行', () => {
    const host = makeHost([...fill(8, 'ie'), ...fill(8, 'web', 'ebay:a'), ...fill(7, 'web', 'ebay:b')])
    expect(totalCount.call(host)).toBe(23)
    expect(run(host, 'web')).not.toThrow()
  })

  it('合计 24 枚时拦住，文案点名各栏目占用数', () => {
    const host = makeHost([...fill(8, 'ie'), ...fill(8, 'web', 'ebay:a'), ...fill(8, 'web', 'ebay:b')])
    expect(totalCount.call(host)).toBe(24)
    expect(run(host, 'web')).toThrow('全部栏目合计已打开24个浏览标签')
    expect(run(host, 'web')).toThrow('IE浏览 8 枚')
    expect(run(host, 'web')).toThrow('eBay 店铺 16 枚')
  })

  it('本栏目额度先于全局硬顶判定：本栏目满 8 枚时报当前栏目而不是合计', () => {
    const host = makeHost([...fill(8, 'web'), ...fill(8, 'ie'), ...fill(8, 'web', 'ebay:a')])
    expect(run(host, 'web')).toThrow('当前栏目最多同时打开8个浏览标签')
  })
})
