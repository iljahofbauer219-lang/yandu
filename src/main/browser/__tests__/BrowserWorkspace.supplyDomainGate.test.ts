import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BaseWindow: class {},
  BrowserWindow: class {},
  WebContentsView: class {},
  WebContents: class {},
  clipboard: { readText: () => '', writeText: () => undefined }
}))

import { BrowserWorkspace } from '../BrowserWorkspace'
import { platformDomainsForCode, hostAllowedForDomains } from '../../../shared/supplyPlatformSessions'

type WorkspaceHost = Record<string, unknown>
const prototype = BrowserWorkspace.prototype as unknown as WorkspaceHost
const fillMethod = prototype.fillActiveLogin as (username: string, password: string, submit?: boolean, targetView?: unknown) => Promise<unknown>
const startMethod = prototype.startBuiltInCollector as () => Promise<unknown>

function makeView(url: string) {
  return {
    webContents: {
      isDestroyed: () => false,
      getURL: () => url,
      executeJavaScript: vi.fn(async () => false)
    }
  }
}

function makeHost(url: string, group?: string) {
  const view = makeView(url)
  const host: WorkspaceHost = {
    attached: view,
    active: 'web',
    activeTabId: 't1',
    detailTabs: new Map([['t1', { id: 't1', view, group }]]),
    credentialDomains: ['gigab2b.com'],
    marketplaceDomains: ['ozon.ru'],
    supplyPlatformCode: 'GIGACLOUD',
    isGigaCloudView: prototype.isGigaCloudView,
    viewPlatformDomains: prototype.viewPlatformDomains,
    isCollectorAllowedView: prototype.isCollectorAllowedView,
    builtInCollectorProducts: new Map(),
    collectedUrlProvider: () => [],
    getBuiltInCollectorState: async () => ({ active: true, platformCode: 'GIGACLOUD', recognizedCount: 0, products: [] }),
    getGigaCloudViews: () => [],
    getCollectorViews: () => [view],
    injectBuiltInCollector: async () => undefined
  }
  return { host, view }
}

describe('货盘平台域名放行：shared 口径', () => {
  it('按平台入口码取自身注册域（含区域变体同域）', () => {
    expect(platformDomainsForCode('SALEYEE_NA')).toEqual(['saleyee.com'])
    expect(platformDomainsForCode('SALEYEE_EU')).toEqual(['saleyee.com'])
    expect(platformDomainsForCode('KJDS')).toEqual(['kjds.com'])
    expect(platformDomainsForCode('XIZHIYUE_NA')).toEqual(['westmonth.com'])
    expect(platformDomainsForCode('GIGACLOUD')).toEqual(['gigab2b.com'])
    expect(platformDomainsForCode('1688')).toEqual(['1688.com'])
    expect(platformDomainsForCode('NOT_A_PLATFORM')).toEqual([])
  })
  it('子域匹配与坏域名拒绝', () => {
    expect(hostAllowedForDomains('global.saleyee.com', ['saleyee.com'])).toBe(true)
    expect(hostAllowedForDomains('saleyee.com', ['saleyee.com'])).toBe(true)
    expect(hostAllowedForDomains('evil-saleyee.com', ['saleyee.com'])).toBe(false)
    expect(hostAllowedForDomains('saleyee.com.evil.com', ['saleyee.com'])).toBe(false)
  })
})

describe('采集链路域名闸按当前货盘平台放行', () => {
  it('赛盈页凭据填充过域名闸（不再只认大健云仓），落到登录页门卫', async () => {
    const { host } = makeHost('https://global.saleyee.com/', 'SALEYEE_NA')
    await expect(fillMethod.call(host, 'qa@example.test', 'pw', false)).rejects.toThrow(/当前页面不是登录页/)
  })
  it('非登记域页仍拒绝且报错点名平台与期望域名', async () => {
    const { host } = makeHost('https://example.com/', 'SALEYEE_NA')
    await expect(fillMethod.call(host, 'qa@example.test', 'pw', false)).rejects.toThrow(/当前页面不是已允许的平台域名.*saleyee\.com/)
  })
  it('无组登录视图沿用 credentialDomains（零回归）', async () => {
    const { host } = makeHost('https://www.gigab2b.com/index.php?route=account/login', undefined)
    await expect(fillMethod.call(host, 'qa@example.test', 'pw', false)).rejects.toThrow(/当前页面不是登录页/)
  })
  it('赛盈页可启动内置采集器（域名闸放行）', async () => {
    const { host } = makeHost('https://global.saleyee.com/', 'SALEYEE_NA')
    await expect(startMethod.call(host)).resolves.toBeTruthy()
  })
  it('非登记域页启动采集器仍中文拒绝并点名平台', async () => {
    const { host } = makeHost('https://example.com/', 'SALEYEE_NA')
    await expect(startMethod.call(host)).rejects.toThrow(/SALEYEE_NA|saleyee\.com/)
  })
  it('大健云仓自愈填充走自身视图：附着赛盈页也不误报域名错', async () => {
    const { host } = makeHost('https://global.saleyee.com/', 'SALEYEE_NA')
    const gigaView = makeView('https://www.gigab2b.com/index.php?route=account/login')
    await expect(fillMethod.call(host, 'qa@example.test', 'pw', true, gigaView)).rejects.toThrow(/当前页面不是登录页/)
  })
  it('大健云仓页启动采集器零回归', async () => {
    const { host } = makeHost('https://www.gigab2b.com/index.php?route=common/home', undefined)
    await expect(startMethod.call(host)).resolves.toBeTruthy()
  })
})
