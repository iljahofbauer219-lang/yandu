import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { addressAfterPush } from '../addressDraft'

const appSource = readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8')
const ieSource = readFileSync(path.join(__dirname, '..', 'IEBrowserPanel.tsx'), 'utf8')

/**
 * 2026-11-15 栏目保活实机验收发现：三个带地址栏的浏览器面板都用 setAddress(next.url) 无条件跟随
 * 主进程状态推送，于是「敲了网址还没回车」就切栏目，切回来草稿被页面真实 URL 冲掉
 * （实测 IE浏览 输入 eBay 搜索串 → 切走 → 回来变成 nav 页地址）。
 * 口径：只有输入框仍显示上次推送的网址（或从未同步过、或为空）时才跟随；用户显式动作
 * （提交导航、切页签、切平台、进入店铺）照常覆盖，并把当前文本登记为新的跟随基准。
 */
describe('地址栏草稿保护（纯函数）', () => {
  it('从未同步过时跟随推送，不被初始默认网址卡住', () => {
    expect(addressAfterPush('https://www.ebay.com/', null, 'https://www.ebay.com/sh/ovw')).toBe('https://www.ebay.com/sh/ovw')
  })

  it('输入框为空时跟随推送', () => {
    expect(addressAfterPush('', 'https://www.ebay.com/', 'https://www.ebay.com/itm/1')).toBe('https://www.ebay.com/itm/1')
  })

  it('用户没改过输入框时跟随新推送', () => {
    expect(addressAfterPush('https://www.ebay.com/', 'https://www.ebay.com/', 'https://www.ebay.com/sh/ovw')).toBe('https://www.ebay.com/sh/ovw')
  })

  it('用户敲了还没回车的草稿不被推送覆盖', () => {
    const draft = 'https://www.ebay.com/sch/i.html?_nkw=car%20vacuum'
    expect(addressAfterPush(draft, 'http://114.55.149.192/nav/', 'http://114.55.149.192/nav/')).toBe(draft)
  })

  it('草稿期间页面自己跳了别的地址，也仍然保留草稿', () => {
    const draft = 'ebay.com/sch/i.html?_nkw=灯'
    expect(addressAfterPush(draft, 'https://www.ebay.com/', 'https://www.ebay.com/sh/ovw')).toBe(draft)
  })

  it('提交后把草稿登记为基准，下一次推送即可把简写规范化', () => {
    expect(addressAfterPush('ebay.com', 'ebay.com', 'https://www.ebay.com/')).toBe('https://www.ebay.com/')
  })
})

/**
 * React 的函数式更新是延迟执行的：updater 里读 ref.current 会读到「已被后续推送推进过」的基准，
 * 于是提交导航后的规范化推送被误判成草稿而丢弃（实机 G 用例：输入 ebay.com → 主进程已是
 * www.ebay.com，地址栏却停在 ebay.com）。因此基准必须在推送当刻快照成局部常量再交给 updater。
 */
const noLiveRefInUpdater = (source: string, label: string) => {
  expect(source, `${label}：updater 里不得直接读 ref.current，必须先快照基准`).not.toMatch(/addressAfterPush\(prev,\s*[A-Za-z]+(?:Ref)?\.current\s*,/)
}

describe('IE浏览 地址栏接线', () => {
  it('状态推送经草稿保护，基准先快照再推进', () => {
    expect(ieSource).toContain("import { addressAfterPush } from './addressDraft'")
    expect(ieSource).toContain('const basis = addressPushedUrlRef.current')
    expect(ieSource).toContain('setAddress(prev => addressAfterPush(prev, basis, next.url))')
    noLiveRefInUpdater(ieSource, 'IE浏览')
  })

  it('用户点页签是显式动作：覆盖地址栏并重置基准', () => {
    expect(ieSource).toContain('setAddress(next.url); addressPushedUrlRef.current = next.url')
  })

  it('回车提交后登记基准，让推送把简写网址规范化', () => {
    expect(ieSource).toContain('addressPushedUrlRef.current = address')
  })
})

describe('AI跨境 eBay 地址栏接线', () => {
  it('状态推送经草稿保护，基准先快照再推进', () => {
    expect(appSource).toContain("addressAfterPush } from './addressDraft'")
    expect(appSource).toContain('const basis=ebayAddressPushedUrl.current')
    expect(appSource).toContain('setEbayAddress(prev=>addressAfterPush(prev,basis,next.url))')
    noLiveRefInUpdater(appSource, 'AI跨境')
  })

  it('进入店铺与点页签是显式动作：覆盖地址栏并重置基准', () => {
    const hits = appSource.match(/setEbayAddress\(next\.url\);ebayAddressPushedUrl\.current=next\.url/g) ?? []
    expect(hits.length, '首次进入店铺与点页签两处显式同步都要登记基准').toBeGreaterThanOrEqual(2)
  })

  it('切回栏目只做重新附着、不导航，读回地址时同样不得冲掉草稿', () => {
    const reattach = appSource.split('const reattach=async()=>{')[1]?.split('void reattach()')[0] ?? ''
    expect(reattach, '重新附着读回地址要走草稿保护，且基准先快照').toContain('setEbayAddress(prev=>addressAfterPush(prev,basis,next.url))')
    expect(reattach).toContain('const basis=ebayAddressPushedUrl.current')
  })

  it('回车提交后登记基准', () => {
    expect(appSource).toContain('ebayAddressPushedUrl.current=ebayAddress')
  })

  it('「填入」两键的刊登页判据取真实页面地址，不取可能被草稿占用的地址栏', () => {
    expect(appSource).toContain(".test(ebayBrowserState?.url||'')")
    expect(appSource).not.toContain('.test(ebayAddress)')
  })
})

describe('采集工作台 地址栏接线', () => {
  it('状态推送经草稿保护，基准先快照再推进', () => {
    expect(appSource).toContain('const basis = collectorAddressPushedUrl.current')
    expect(appSource).toContain('setAddress(prev => addressAfterPush(prev, basis, next.url))')
    noLiveRefInUpdater(appSource, '采集工作台')
  })

  it('切平台是显式动作：覆盖并重置基准', () => {
    expect(appSource).toContain('collectorAddressPushedUrl.current = home')
  })

  it('切回采集工作台只挂回视图，读回地址时同样不得冲掉草稿', () => {
    const reattach = appSource.split('void window.desktop.browser.show(platform)')[1]?.split('}, [platform, page])')[0] ?? ''
    expect(reattach, '读回地址要走草稿保护，且基准先快照').toContain('setAddress(prev => addressAfterPush(prev, basis, next.url))')
    expect(reattach).toContain('const basis = collectorAddressPushedUrl.current')
  })

  it('回车提交后登记基准', () => {
    expect(appSource).toContain('collectorAddressPushedUrl.current = address')
  })
})
