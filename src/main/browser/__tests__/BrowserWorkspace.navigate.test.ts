import { describe, expect, it, vi } from 'vitest'
import { EBAY_SITE_ROOT_DOMAINS } from '../../../shared/ebaySites'

vi.mock('electron', () => ({
  BaseWindow: class {},
  BrowserWindow: class {},
  WebContentsView: class {},
  WebContents: class {},
  clipboard: { readText: () => '', writeText: () => undefined }
}))

import { BrowserWorkspace } from '../BrowserWorkspace'

type LoadFailure = Error & { code?: string; errno?: number }
type NavigateMethod = (platform: string, rawUrl: string) => Promise<void>
type WorkspaceHost = Record<string, unknown>

const prototype = BrowserWorkspace.prototype as unknown as WorkspaceHost
const navigateMethod = prototype.navigate as NavigateMethod
const isAllowedUrlMethod = prototype.isAllowedUrl as (platform: string, rawUrl: string) => boolean

function makeWorkspace(landedUrl: string, failure?: LoadFailure) {
  const loadURL = vi.fn(async () => {
    if (failure) throw failure
  })
  const host: WorkspaceHost = {
    detailTabs: new Map(),
    activeTabId: 'home-1688',
    emitTabs: () => undefined,
    getCurrentView: () => ({
      webContents: { loadURL, isDestroyed: () => false, getURL: () => landedUrl }
    }),
    isAllowedUrl: isAllowedUrlMethod
  }
  return { host, loadURL }
}

const GIGA_LOGIN = 'https://www.gigab2b.com/index.php?route=account/login'

describe('BrowserWorkspace.navigate 加载失败处理', () => {
  it('目标页自身跳转导致的 ERR_ABORTED(-3) 不报错', async () => {
    const failure = Object.assign(new Error(`ERR_ABORTED (-3) loading '${GIGA_LOGIN}'`), { code: 'ERR_ABORTED', errno: -3 })
    const { host } = makeWorkspace(GIGA_LOGIN, failure)
    await expect(navigateMethod.call(host, '1688', GIGA_LOGIN)).resolves.toBeUndefined()
  })

  it('仅有 errno -3 没有 code 时同样按跳转容错', async () => {
    const failure = Object.assign(new Error(`ERR_ABORTED (-3) loading '${GIGA_LOGIN}'`), { errno: -3 })
    const { host } = makeWorkspace('https://www.gigab2b.com/index.php?route=common/home', failure)
    await expect(navigateMethod.call(host, '1688', GIGA_LOGIN)).resolves.toBeUndefined()
  })

  it('ERR_ABORTED 但页面没有落到白名单内时仍抛中文错误并保留技术串', async () => {
    const failure = Object.assign(new Error(`ERR_ABORTED (-3) loading '${GIGA_LOGIN}'`), { code: 'ERR_ABORTED', errno: -3 })
    const { host } = makeWorkspace('', failure)
    await expect(navigateMethod.call(host, '1688', GIGA_LOGIN))
      .rejects
      .toThrow(/打开「https:\/\/www\.gigab2b\.com\/index\.php\?route=account\/login」失败：.*ERR_ABORTED \(-3\)/)
  })

  it('域名不可解析等真实失败仍抛错，不被跳转容错吞掉', async () => {
    const failure = Object.assign(new Error(`ERR_NAME_NOT_RESOLVED (-105) loading '${GIGA_LOGIN}'`), { code: 'ERR_NAME_NOT_RESOLVED', errno: -105 })
    const { host } = makeWorkspace(GIGA_LOGIN, failure)
    await expect(navigateMethod.call(host, '1688', GIGA_LOGIN)).rejects.toThrow(/打开「.*」失败：ERR_NAME_NOT_RESOLVED \(-105\)/)
  })

  it('白名单外域名同步抛错且不触发加载', () => {
    const { host, loadURL } = makeWorkspace('')
    expect(() => navigateMethod.call(host, '1688', 'https://evil.example.com/login')).toThrow('当前标签只允许访问对应平台域名')
    expect(loadURL).not.toHaveBeenCalled()
  })
})

function makeEbayTabHost(landedUrl = '') {
  const loadURL = vi.fn(async () => undefined)
  const host: WorkspaceHost = {
    detailTabs: new Map([['login-ebay:s1', { domains: EBAY_SITE_ROOT_DOMAINS }]]),
    activeTabId: 'login-ebay:s1',
    emitTabs: () => undefined,
    getCurrentView: () => ({ webContents: { loadURL, isDestroyed: () => false, getURL: () => landedUrl } }),
    isAllowedUrl: isAllowedUrlMethod
  }
  return { host, loadURL }
}

describe('eBay 浏览器标签放行各国官方站点', () => {
  it.each(['https://www.ebay.com/itm/123456789012', 'https://www.ebay.de/sch/i.html?_nkw=bag', 'https://www.ebay.cn/', 'https://www.ebay.co.uk/'])('%s 可打开', async url => {
    const { host, loadURL } = makeEbayTabHost(url)
    await navigateMethod.call(host, 'web', url)
    expect(loadURL).toHaveBeenCalledWith(url)
  })

  it('ebay 形近域与后缀拼接域仍被阻止', () => {
    const { host, loadURL } = makeEbayTabHost('')
    ;['https://evil-ebay.com/', 'https://ebay.de.attacker.net/'].forEach(url => {
      expect(() => navigateMethod.call(host, 'web', url)).toThrow('当前标签只允许访问对应平台域名')
    })
    expect(loadURL).not.toHaveBeenCalled()
  })
})
