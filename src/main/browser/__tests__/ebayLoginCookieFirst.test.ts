import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  const contents = () => ({
    getURL: () => 'https://www.ebay.com/',
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

/**
 * 根因（2026-11-18 凌晨取证）：prepare 被 eBay 风控踢到 signin 的页签成为陈旧「登录或注册」页；
 * 用户在别的页签登录成功后 cookie 已有效，但 ensureEbayLogin/inspectEbayLogin 只按活动页签 DOM 判登录态，
 * 陈旧 signin 页被判「未登录」→ 一键登录在旧页重填凭据再提交＝真的又登录一次（00:40:26 totp cookie 佐证）。
 * 修复 A：判未登录前先查分区会话 cookie（nonsession），有效则只刷新当前页签复检，绝不重填凭据；
 * 修复 B：登录成功（ONLINE）后把同分区仍停在 signin.ebay.com 的其它页签刷回 Seller Hub；
 * splashui 验证中页签不动（保守口径，避免毁掉正在进行的人工验证）。
 */

type FakePage = { phase: 'ONLINE' | 'ERROR' | 'VERIFICATION' | 'PASSWORD' | 'USERNAME' | 'OFFLINE' | 'UNKNOWN'; url: string }
type FakeCookie = { name: string; domain: string; expirationDate?: number }
type FakeView = {
  page: FakePage
  loads: string[]
  submissions: string[]
  cookies: FakeCookie[]
  serverAcceptsRefresh: boolean
  setBackgroundColor: () => void
  setBounds: () => void
  webContents: {
    getURL: () => string
    loadURL: (url: string) => Promise<void>
    isDestroyed: () => boolean
    close: () => void
    on: () => void
    setUserAgent: () => void
    setWindowOpenHandler: () => void
    executeJavaScript: (script: string) => Promise<unknown>
    isLoading: () => boolean
    session: { cookies: { get: (filter: { name?: string }) => Promise<FakeCookie[]> } }
  }
}
type FakeTab = { id: string; platform: string; title: string; view: FakeView; closable: boolean; generic?: boolean; scopeId?: string }

const SIGNIN_URL = 'https://signin.ebay.com/ws/eBayISAPI.dll?SignIn&ru=https%3A%2F%2Fwww.ebay.com%2Fsh%2Fovw'
const HUB_URL = 'https://www.ebay.com/sh/ovw'

function makeView(page: FakePage, opts: { cookies?: FakeCookie[]; serverAcceptsRefresh?: boolean } = {}): FakeView {
  const view: FakeView = {
    page,
    loads: [],
    submissions: [],
    cookies: opts.cookies ?? [],
    serverAcceptsRefresh: opts.serverAcceptsRefresh ?? true,
    setBackgroundColor: () => undefined,
    setBounds: () => undefined,
    webContents: {
      getURL: () => view.page.url,
      loadURL: async (url: string) => {
        view.loads.push(url)
        if (view.serverAcceptsRefresh && view.cookies.length && url.includes('/sh/ovw')) {
          view.page = { phase: 'ONLINE', url: HUB_URL }
        }
      },
      isDestroyed: () => false,
      isLoading: () => false,
      close: () => undefined,
      on: () => undefined,
      setUserAgent: () => undefined,
      setWindowOpenHandler: () => undefined,
      executeJavaScript: async (script: string) => {
        if (script.includes('signedInLink')) {
          return { phase: view.page.phase, url: view.page.url, errorMessage: view.page.phase === 'ERROR' ? 'eBay提示密码不正确' : '' }
        }
        if (script.includes('usernameFilled')) {
          if (view.page.phase === 'USERNAME') {
            view.submissions.push('USERNAME')
            view.page = { phase: 'PASSWORD', url: view.page.url }
            return { usernameFilled: true, passwordFilled: false, submitted: true, url: view.page.url }
          }
          if (view.page.phase === 'PASSWORD') {
            view.submissions.push('PASSWORD')
            view.page = { phase: 'ONLINE', url: HUB_URL }
            return { usernameFilled: false, passwordFilled: true, submitted: true, url: view.page.url }
          }
          return { usernameFilled: false, passwordFilled: false, submitted: false, url: view.page.url }
        }
        return {}
      },
      session: {
        cookies: {
          get: async (filter: { name?: string }) => view.cookies.filter(cookie => !filter.name || cookie.name === filter.name)
        }
      }
    }
  }
  return view
}

function makeTab(id: string, view: FakeView, scopeId?: string): FakeTab {
  const tab: FakeTab = { id, platform: 'web', title: id, view, closable: true, generic: true }
  if (scopeId) tab.scopeId = scopeId
  return tab
}

const prototype = BrowserWorkspace.prototype as unknown as Record<string, unknown>
const ensureMethod = prototype.ensureEbayLogin as (accountId: string, username: string, password: string, allowAutoLogin: boolean) => Promise<{ status: string; message: string; url: string; autoLoginAttempted: boolean }>

const ACCOUNT = 'ebay:s1'
const aliveCookies: FakeCookie[] = [
  { name: 'nonsession', domain: '.ebay.com', expirationDate: Date.now() / 1000 + 86400 },
  { name: 'dp1', domain: '.ebay.com', expirationDate: Date.now() / 1000 + 86400 }
]

function makeHost(tabs: FakeTab[], activeTabId: string) {
  const detailTabs = new Map<string, FakeTab>()
  for (const tab of tabs) detailTabs.set(tab.id, tab)
  const active = detailTabs.get(activeTabId)!
  const host = Object.create(prototype) as Record<string, unknown>
  Object.assign(host, {
    detailTabs,
    activeTabId,
    activationVersion: 0,
    browserVisible: true,
    attached: active.view,
    ebayAutoLoginAttemptedAt: new Map<string, number>(),
    ebayFreshLoadUntil: new Map<unknown, number>(),
    credentialLoadFailures: new Map<unknown, string>(),
    sleep: async () => undefined
  })
  return host
}

describe('一键登录 · cookie 优先于陈旧 signin DOM（修复 A）', () => {
  it('分区会话 cookie 有效＋活动页签是陈旧 signin：只刷新复检，绝不重填凭据', async () => {
    const stale = makeView({ phase: 'USERNAME', url: SIGNIN_URL }, { cookies: aliveCookies })
    const host = makeHost([makeTab(`login-${ACCOUNT}`, stale, ACCOUNT)], `login-${ACCOUNT}`)
    const result = await ensureMethod.call(host, ACCOUNT, 'cnyandu', 'secret', true)
    expect(result.status).toBe('ONLINE')
    expect(stale.submissions, '会话有效时不得提交任何凭据').toEqual([])
    expect(stale.loads.some(url => url.includes('/sh/ovw')), '应刷新陈旧页签而非原地重登').toBe(true)
    expect(result.autoLoginAttempted).toBe(false)
  })

  it('cookie 有效但刷新后仍落 signin（服务端真失效）：回落自动填写，不无限轮询', async () => {
    const dead = makeView({ phase: 'USERNAME', url: SIGNIN_URL }, { cookies: aliveCookies, serverAcceptsRefresh: false })
    const host = makeHost([makeTab(`login-${ACCOUNT}`, dead, ACCOUNT)], `login-${ACCOUNT}`)
    const result = await ensureMethod.call(host, ACCOUNT, 'cnyandu', 'secret', true)
    expect(dead.loads.some(url => url.includes('/sh/ovw')), '先尝试刷新复检').toBe(true)
    expect(dead.submissions, '服务端真失效时仍走原自动填写').toEqual(['USERNAME', 'PASSWORD'])
    expect(result.status).toBe('ONLINE')
    expect(result.autoLoginAttempted).toBe(true)
  })

  it('无会话 cookie：原自动填写流程不变', async () => {
    const offline = makeView({ phase: 'USERNAME', url: SIGNIN_URL }, { cookies: [] })
    const host = makeHost([makeTab(`login-${ACCOUNT}`, offline, ACCOUNT)], `login-${ACCOUNT}`)
    const result = await ensureMethod.call(host, ACCOUNT, 'cnyandu', 'secret', true)
    expect(offline.submissions).toEqual(['USERNAME', 'PASSWORD'])
    expect(result.status).toBe('ONLINE')
    expect(result.autoLoginAttempted).toBe(true)
  })

  it('会话 cookie 已过期：视同无 cookie，走自动填写', async () => {
    const expired = makeView({ phase: 'USERNAME', url: SIGNIN_URL }, {
      cookies: [{ name: 'nonsession', domain: '.ebay.com', expirationDate: Date.now() / 1000 - 3600 }]
    })
    const host = makeHost([makeTab(`login-${ACCOUNT}`, expired, ACCOUNT)], `login-${ACCOUNT}`)
    const result = await ensureMethod.call(host, ACCOUNT, 'cnyandu', 'secret', true)
    expect(expired.submissions).toEqual(['USERNAME', 'PASSWORD'])
    expect(result.status).toBe('ONLINE')
  })

  it('活动页签本就 ONLINE：不刷新不提交，直接返回会话有效', async () => {
    const online = makeView({ phase: 'ONLINE', url: HUB_URL }, { cookies: aliveCookies })
    const host = makeHost([makeTab(`login-${ACCOUNT}`, online, ACCOUNT)], `login-${ACCOUNT}`)
    const result = await ensureMethod.call(host, ACCOUNT, 'cnyandu', 'secret', true)
    expect(result.status).toBe('ONLINE')
    expect(online.submissions).toEqual([])
    expect(online.loads).toEqual([])
  })
})

describe('一键登录 · 复检失败不空转（卡顿修复）', () => {
  const timedHost = (tabs: FakeTab[], activeTabId: string) => {
    const host = makeHost(tabs, activeTabId)
    const clock = { ms: 0 }
    host.sleep = async (ms: number) => { clock.ms += ms }
    return { host, clock }
  }

  it('cookie 有效但服务端真失效：刷新复检落登录表单即回落，轮询耗时≤2s（原 20×500ms 空转 10s）', async () => {
    const dead = makeView({ phase: 'USERNAME', url: SIGNIN_URL }, { cookies: aliveCookies, serverAcceptsRefresh: false })
    const { host, clock } = timedHost([makeTab(`login-${ACCOUNT}`, dead, ACCOUNT)], `login-${ACCOUNT}`)
    const result = await ensureMethod.call(host, ACCOUNT, 'cnyandu', 'secret', true)
    expect(result.status).toBe('ONLINE')
    expect(dead.submissions).toEqual(['USERNAME', 'PASSWORD'])
    expect(clock.ms, `复检空转耗时 ${clock.ms}ms`).toBeLessThanOrEqual(2000)
  })

  it('cookie 有效且服务端接受刷新：复检一次即 ONLINE，不提交不空转', async () => {
    const alive = makeView({ phase: 'USERNAME', url: SIGNIN_URL }, { cookies: aliveCookies })
    const { host, clock } = timedHost([makeTab(`login-${ACCOUNT}`, alive, ACCOUNT)], `login-${ACCOUNT}`)
    const result = await ensureMethod.call(host, ACCOUNT, 'cnyandu', 'secret', true)
    expect(result.status).toBe('ONLINE')
    expect(alive.submissions).toEqual([])
    expect(clock.ms).toBeLessThanOrEqual(500)
  })

  it('提交后导航销毁执行上下文：复检抛错不中断整链，下一轮继续直至 ONLINE', async () => {
    const view = makeView({ phase: 'USERNAME', url: SIGNIN_URL }, { cookies: [] })
    let thrown = false
    const original = view.webContents.executeJavaScript
    view.webContents.executeJavaScript = async (script: string) => {
      if (script.includes('signedInLink') && view.submissions.includes('PASSWORD') && !thrown) {
        thrown = true
        throw new Error('Execution context was destroyed.')
      }
      return original(script)
    }
    const host = makeHost([makeTab(`login-${ACCOUNT}`, view, ACCOUNT)], `login-${ACCOUNT}`)
    const result = await ensureMethod.call(host, ACCOUNT, 'cnyandu', 'secret', true)
    expect(thrown, '应真的经历过一次上下文销毁').toBe(true)
    expect(result.status).toBe('ONLINE')
    expect(view.submissions).toEqual(['USERNAME', 'PASSWORD'])
  })
})

describe('登录成功后陈旧 signin 页签自愈（修复 B）', () => {
  it('自动登录成功：同分区停在 signin 的其它页签刷回 Seller Hub；splashui 验证页与他店页签不动', async () => {
    const active = makeView({ phase: 'USERNAME', url: SIGNIN_URL }, { cookies: [] })
    const staleSignin = makeView({ phase: 'USERNAME', url: SIGNIN_URL }, { cookies: [] })
    const challenging = makeView({ phase: 'VERIFICATION', url: 'https://www.ebay.com/splashui/challenge?ap=1&appName=orch' }, { cookies: [] })
    const otherStore = makeView({ phase: 'USERNAME', url: SIGNIN_URL }, { cookies: [] })
    const host = makeHost([
      makeTab(`login-${ACCOUNT}`, active, ACCOUNT),
      makeTab(`ebay-${ACCOUNT}-stale`, staleSignin, ACCOUNT),
      makeTab(`ebay-${ACCOUNT}-challenge`, challenging, ACCOUNT),
      makeTab('login-ebay:s2', otherStore, 'ebay:s2')
    ], `login-${ACCOUNT}`)
    const result = await ensureMethod.call(host, ACCOUNT, 'cnyandu', 'secret', true)
    expect(result.status).toBe('ONLINE')
    expect(staleSignin.loads.some(url => url.includes('/sh/ovw')), '陈旧 signin 页签应被刷回').toBe(true)
    expect(challenging.loads, 'splashui 人工验证进行中的页签不得被刷新').toEqual([])
    expect(otherStore.loads, '其它店铺的页签不得被触碰').toEqual([])
  })

  it('cookie 恢复路径同样自愈陈旧兄弟页签', async () => {
    const active = makeView({ phase: 'USERNAME', url: SIGNIN_URL }, { cookies: aliveCookies })
    const staleSignin = makeView({ phase: 'USERNAME', url: SIGNIN_URL }, { cookies: aliveCookies })
    const host = makeHost([
      makeTab(`login-${ACCOUNT}`, active, ACCOUNT),
      makeTab(`ebay-${ACCOUNT}-stale`, staleSignin, ACCOUNT)
    ], `login-${ACCOUNT}`)
    const result = await ensureMethod.call(host, ACCOUNT, 'cnyandu', 'secret', true)
    expect(result.status).toBe('ONLINE')
    expect(active.submissions).toEqual([])
    expect(staleSignin.loads.some(url => url.includes('/sh/ovw'))).toBe(true)
  })

  it('手动登录后点一键登录（直接 ONLINE）也自愈陈旧兄弟页签', async () => {
    const active = makeView({ phase: 'ONLINE', url: HUB_URL }, { cookies: aliveCookies })
    const staleSignin = makeView({ phase: 'USERNAME', url: SIGNIN_URL }, { cookies: aliveCookies })
    const host = makeHost([
      makeTab(`login-${ACCOUNT}`, active, ACCOUNT),
      makeTab(`ebay-${ACCOUNT}-stale`, staleSignin, ACCOUNT)
    ], `login-${ACCOUNT}`)
    const result = await ensureMethod.call(host, ACCOUNT, 'cnyandu', 'secret', true)
    expect(result.status).toBe('ONLINE')
    expect(staleSignin.loads.some(url => url.includes('/sh/ovw'))).toBe(true)
    expect(active.loads, '当前 ONLINE 页签自身不被自愈刷新').toEqual([])
  })
})

describe('打开即加载态 · 免二次导航（空白修复）', () => {
  it('C：新鲜加载窗口内 signin+cookie 有效：跳过复检重载直接自动填写', async () => {
    const view = makeView({ phase: 'USERNAME', url: SIGNIN_URL }, { cookies: aliveCookies, serverAcceptsRefresh: false })
    const host = makeHost([makeTab(`login-${ACCOUNT}`, view, ACCOUNT)], `login-${ACCOUNT}`)
    ;(host.ebayFreshLoadUntil as Map<unknown, number>).set(view, Date.now() + 20000)
    const result = await ensureMethod.call(host, ACCOUNT, 'cnyandu', 'secret', true)
    expect(result.status).toBe('ONLINE')
    expect(view.loads, '新鲜窗口内不得二次导航').toEqual([])
    expect(view.submissions).toEqual(['USERNAME', 'PASSWORD'])
  })

  it('B：首载在途时复检抛错：等载定再继续，不中断整链', async () => {
    const view = makeView({ phase: 'USERNAME', url: SIGNIN_URL }, { cookies: [] })
    let loadingChecks = 0
    view.webContents.isLoading = () => { loadingChecks += 1; return loadingChecks <= 2 }
    const original = view.webContents.executeJavaScript
    view.webContents.executeJavaScript = async (script: string) => {
      if (script.includes('signedInLink') && view.webContents.isLoading()) throw new Error('Execution context was destroyed.')
      return original(script)
    }
    const host = makeHost([makeTab(`login-${ACCOUNT}`, view, ACCOUNT)], `login-${ACCOUNT}`)
    const result = await ensureMethod.call(host, ACCOUNT, 'cnyandu', 'secret', true)
    expect(result.status).toBe('ONLINE')
    expect(view.submissions).toEqual(['USERNAME', 'PASSWORD'])
  })

  it('B：后台加载失败且仍 about:blank：回中文错误，不进填写循环', async () => {
    const view = makeView({ phase: 'OFFLINE', url: 'about:blank' }, { cookies: [] })
    const host = makeHost([makeTab(`login-${ACCOUNT}`, view, ACCOUNT)], `login-${ACCOUNT}`)
    ;(host.credentialLoadFailures as Map<unknown, string>).set(view, 'ERR_PROXY_CONNECTION_FAILED')
    const result = await ensureMethod.call(host, ACCOUNT, 'cnyandu', 'secret', true)
    expect(result.status).toBe('ERROR')
    expect(result.message).toContain('打开失败')
    expect(view.submissions).toEqual([])
  })

  it('D：真机口径新视图初始 URL 为空串：占位仍须注入（守卫不得只认 about:blank）', async () => {
    const calls: string[] = []
    const view = { webContents: { getURL: () => '', executeJavaScript: (script: string) => { calls.push(script); return Promise.resolve(true) } } }
    const host = Object.create(prototype) as Record<string, unknown>
    ;(prototype.splashEbayLoading as (v: unknown) => void).call(host, view)
    await new Promise(r => setTimeout(r, 0))
    expect(calls.length, '空串初始 URL 必须注入占位').toBe(1)
    expect(calls[0]).toContain('正在打开 eBay 店铺')
  })

  it('A/B 源码守卫：占位先于加载注入、加载转后台、加载成功写新鲜窗口', () => {
    const source = readFileSync(path.join(__dirname, '..', 'BrowserWorkspace.ts'), 'utf8')
    const start = source.indexOf('async openCredentialLogin')
    const body = source.slice(start, source.indexOf('async newEbayTab', start))
    expect(body).toContain('splashEbayLoading(view)')
    expect(body.indexOf('splashEbayLoading(view)')).toBeLessThan(body.indexOf('void loadCredentialUrl(view)'))
    expect(body).toContain('loadInBackground(previous.view)')
    expect(body).not.toMatch(/await loadCredentialUrl\(/)
    expect(body).toContain('ebayFreshLoadUntil.set(view')
    const splash = source.slice(source.indexOf('private splashEbayLoading'), source.indexOf('private async waitEbayViewReady'))
    expect(splash).toContain("url!=='about:blank'&&url!==''")
    expect(splash).toContain('正在打开 eBay 店铺')
  })
})