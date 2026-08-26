// IE浏览：独立浏览器工作区
// 复用共享 web BrowserView 机制（与 eBay 平台、采集工作台、标题优化页同源），
// 提供地址栏、采集插件、Qwen-MT 翻译、多标签四大能力，**不依赖** eBay 平台店铺会话（activeStore）。
// 设计原则：
// - 与 EbayPlatformWorkspace 的浏览器区域共享 IPC 协议（window.desktop.browser.*）与 CSS 类名（ebay-browser-*）
// - 默认页 = 独立部署的“砚都跨境导航”站点（http://114.55.149.192/nav/），作为 IE 浏览页的起始页
// - 关闭所有标签后自动重建一个 about:blank 占位标签，避免 slot 消失/页面变空白
// - 采集插件在 IE浏览 中**只读模式**（开启/识别/选取），不接 confirm 流程（提示用户到 eBay 平台完成）
// - 翻译范围 = 任何网页（不限制域名）
import { FormEvent, useEffect, useRef, useState } from 'react'
import type { BrowserState, BrowserTab, BrowserTranslationMode, EbayCollectedProduct } from '../shared/contracts'

const initialAddress = ''

// IE 浏览页：
// - 「首次自动打开默认 nav 站点」逻辑已迁移到主进程 BrowserWorkspace.openDefaultNavIfNeeded()，
//   避免 React StrictMode 双调用 + App.tsx IIFE 路由 remount 导致 renderer 端 useEffect 重跑问题。
// - 本组件只负责：tab 订阅渲染、地址栏、采集插件、翻译、主动关闭兜底。

export function IEBrowserPanel() {
  const [browserState, setBrowserState] = useState<BrowserState | null>(null)
  const [tabs, setTabs] = useState<BrowserTab[]>([])
  const [address, setAddress] = useState(initialAddress)
  const [pluginActive, setPluginActive] = useState(false)
  const [pluginRecognized, setPluginRecognized] = useState(0)
  const [pluginSelected, setPluginSelected] = useState(0)
  const [pluginProducts, setPluginProducts] = useState<EbayCollectedProduct[]>([])
  const [translationActive, setTranslationActive] = useState(false)
  const [translationMode, setTranslationMode] = useState<BrowserTranslationMode>('BILINGUAL')
  const [translationCount, setTranslationCount] = useState(0)
  const [translationMenuOpen, setTranslationMenuOpen] = useState(false)
  const [translating, setTranslating] = useState(false)
  const slotRef = useRef<HTMLDivElement>(null)
  const translationRunningRef = useRef(false)
  // 记录上一次 tabs 数量：用于区分「用户主动关闭最后一个 tab」与「remount 初始为空」，
  // 避免切回 IE 浏览时（remount 触发 onTabs 订阅补齐前）兜底逻辑误建一个 about:blank。
  const prevTabsLengthRef = useRef(0)

  useEffect(() => {
    const unsubscribe = window.desktop.browser.onState((next) => {
      if (next.platform === 'web') {
        setBrowserState(next)
        setAddress(next.url)
      }
    })
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.desktop.browser.onTabs((next) => setTabs(next.filter((tab) => tab.platform === 'web' && !tab.scopeId)))
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!pluginActive) return
    const refresh = () => {
      void window.desktop.browser
        .ebayPluginState()
        .then((state) => {
          setPluginActive(state.active)
          setPluginRecognized(state.recognizedCount)
          setPluginSelected(state.selectedCount)
          setPluginProducts(state.products)
        })
        .catch(() => undefined)
    }
    refresh()
    const timer = window.setInterval(refresh, 700)
    return () => window.clearInterval(timer)
  }, [pluginActive])

  useEffect(() => {
    if (!translationActive) return
    const timer = window.setInterval(() => {
      void translatePage(translationMode, true)
    }, 5000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translationActive, translationMode])

  useEffect(() => {
    // 依赖 tabs.length：slot 只在存在 web 标签页时才挂载。
    // 首次进页面 tabs 为空，slot 不渲染，不出现「正在打开网页…」placeholder；
    // 用户点击导航卡片或地址栏提交后 tabs 增加，slot 才出现并填充 WebContentsView。
    const update = () => {
      const rect = slotRef.current?.getBoundingClientRect()
      if (rect) void window.desktop.browser.setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
    }
    update()
    // 通知 BrowserWorkspace：用户进入 web 浏览器区域，触发 attachView。
    // 必须在 update() 之后调用，否则 attachView 拿不到有效 bounds。
    void window.desktop.browser.show('web')
    const observer = new ResizeObserver(update)
    if (slotRef.current) observer.observe(slotRef.current)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [tabs.length])

  const navigate = async (event: FormEvent) => {
    event.preventDefault()
    const raw = address.trim()
    if (!raw) return
    let target: URL
    try {
      target = new URL(raw.startsWith('http') ? raw : `https://${raw}`)
    } catch {
      return
    }
    try {
      // 首次访问：当前没有 web 标签页时自动建一个，避免 navigate 抛 “通用网页标签不存在”
      if (tabs.length === 0) {
        await window.desktop.browser.newTab()
        // 等待主进程 emit 推送新 tab（跨 IPC + React 渲染需要几十毫秒）
        await new Promise((resolve) => window.setTimeout(resolve, 120))
      }
      // 强制调一次 show('web')：确保 attachView 被触发，把 view 实际加进 BrowserWindow。
      // attachView 内部受 browserVisible 保护，必须 show 才会 addChildView。
      // show 在有 web tab 时是幂等的，可安全重复调。
      await window.desktop.browser.show('web')
      await window.desktop.browser.navigate('web', target.toString())
    } catch (reason) {
      window.alert(`打开网页失败：${reason instanceof Error ? reason.message : String(reason)}`)
    }
  }

  const createTab = async () => {
    try {
      await window.desktop.browser.newTab()
      // 强制触发 attachView，让新 tab 的 view 实际可见
      await window.desktop.browser.show('web')
    } catch (reason) {
      window.alert(`新建标签失败：${reason instanceof Error ? reason.message : String(reason)}`)
    }
  }

  const activateTab = async (tab: BrowserTab) => {
    try {
      // 强制触发 attachView，确保切换标签后 view 可见
      await window.desktop.browser.show('web')
      await window.desktop.browser.switchTab(tab.id)
      const next = await window.desktop.browser.getState('web')
      setBrowserState(next)
      if (next) setAddress(next.url)
    } catch (reason) {
      window.alert(`切换标签失败：${reason instanceof Error ? reason.message : String(reason)}`)
    }
  }

  const closeTab = async (tabId: string) => {
    try {
      await window.desktop.browser.closeTab(tabId)
    } catch (reason) {
      window.alert(`关闭标签失败：${reason instanceof Error ? reason.message : String(reason)}`)
    }
  }

  const startPlugin = async () => {
    try {
      const state = await window.desktop.browser.startEbayPlugin()
      setPluginActive(state.active)
      setPluginRecognized(state.recognizedCount)
      setPluginSelected(state.selectedCount)
      setPluginProducts(state.products)
    } catch (reason) {
      window.alert(`采集插件启动失败：${reason instanceof Error ? reason.message : String(reason)}`)
    }
  }

  const translatePage = async (mode: BrowserTranslationMode, silent = false) => {
    if (translationRunningRef.current) return
    translationRunningRef.current = true
    if (!silent) setTranslating(true)
    try {
      const status = await window.desktop.browser.translate(mode)
      setTranslationCount((current) => current + status.translated)
      setTranslationActive(true)
      setTranslationMode(mode)
    } catch (reason) {
      if (!silent) window.alert(`网页翻译失败：${reason instanceof Error ? reason.message : String(reason)}`)
    } finally {
      translationRunningRef.current = false
      if (!silent) setTranslating(false)
    }
  }

  const restoreTranslation = async () => {
    try {
      await window.desktop.browser.restoreTranslation()
      setTranslationActive(false)
      setTranslationCount(0)
      setTranslationMenuOpen(false)
    } catch (reason) {
      window.alert(`恢复原网页失败：${reason instanceof Error ? reason.message : String(reason)}`)
    }
  }

  const onPluginConfirmHint = () => {
    window.alert('此功能需在「AI 跨境 → eBay 平台」工作台完成。')
  }

  // tabs 为空时（用户全部关闭了）自动重建一个 about:blank 占位标签。
  // 原因：IE 浏览页必须始终至少有 1 个 web tab，否则 slot 区域消失、面板高度异常。
  // 关键：通过 prevTabsLengthRef 区分两种「空」：
  //   - 用户主动关闭最后一个 tab（prev > 0 → 0）→ 需要兜底
  //   - remount 初始空（prev === 0 → 0）→ 不要兜底，避免切回 IE 浏览时多建一个 tab
  useEffect(() => {
    if (tabs.length !== 0) {
      prevTabsLengthRef.current = tabs.length
      return
    }
    if (prevTabsLengthRef.current === 0) return
    prevTabsLengthRef.current = 0
    let cancelled = false
    const spawn = async () => {
      try {
        await new Promise((resolve) => window.setTimeout(resolve, 80))
        if (cancelled) return
        await window.desktop.browser.newTab()
        await new Promise((resolve) => window.setTimeout(resolve, 80))
        if (cancelled) return
        await window.desktop.browser.show('web')
        await window.desktop.browser.navigate('web', 'about:blank')
      } catch (reason) {
        if (!cancelled) console.warn('IE浏览空白占位标签创建失败：', reason)
      }
    }
    void spawn()
    return () => { cancelled = true }
  }, [tabs.length])

  // 组件卸载时关闭 BrowserView，避免退出登录后浏览器视图残留在 BrowserWindow。
  // 关键：必须用独立 useEffect（依赖 []），不能挂在已有 useEffect(..., [tabs.length]) 的 cleanup 上，
  // 否则关闭/新建 tab 时会触发 hide() 导致视图闪烁。
  // 参考：EbayPlatformWorkspace（App.tsx:2448-2449）的同款清理模式。
  useEffect(() => {
    return () => {
      void window.desktop.browser.hide()
    }
  }, [])

  return (
    <section className="ie-browser-page">
      <div className="ebay-browser-panel">
        <div className="tabs ebay-browser-tabs">
          <div className="tab-scroll">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={tab.active ? 'active' : ''}
                onClick={() => void activateTab(tab)}
                title={tab.title}
              >
                <span className={`ebay-tab-icon${tab.faviconUrl ? ' has-site-logo' : ''}`}>
                  {tab.faviconUrl ? (
                    <img
                      src={tab.faviconUrl}
                      alt=""
                      onError={(event) => {
                        event.currentTarget.hidden = true
                      }}
                    />
                  ) : (
                    'e'
                  )}
                </span>
                <b>{tab.title}</b>
                {tab.closable && (
                  <i
                    onClick={(event) => {
                      event.stopPropagation()
                      void closeTab(tab.id)
                    }}
                  >
                    ×
                  </i>
                )}
              </button>
            ))}
          </div>
          <button
            className="new-browser-tab"
            type="button"
            title="新建浏览页"
            aria-label="新建浏览页"
            onClick={() => void createTab()}
          >
            ＋
          </button>
          {browserState?.loading && (
            <span className="run-state loading">
              <i />
              页面加载中
            </span>
          )}
        </div>

        <form className="address-bar ebay-address-bar" onSubmit={navigate}>
          <button
            type="button"
            title="后退"
            disabled={!browserState?.canGoBack}
            onClick={() => void window.desktop.browser.back('web')}
          >
            ←
          </button>
          <button
            type="button"
            title="前进"
            disabled={!browserState?.canGoForward}
            onClick={() => void window.desktop.browser.forward('web')}
          >
            →
          </button>
          <button type="button" title="刷新" onClick={() => void window.desktop.browser.reload('web')}>
            ↻
          </button>
          <input aria-label="网页地址" placeholder="输入网址并访问（首次访问会自动新建标签）" value={address} onChange={(event) => setAddress(event.target.value)} />
          <button className="address-go" type="submit">
            打开 <span>↗</span>
          </button>
          <button
            type="button"
            title="eBay 页面商品识别插件（仅识别与选取，确认采集请到 eBay 平台工作台）"
            className={`built-in-collector-trigger address-extra-btn${pluginActive ? ' active' : ''}`}
            onClick={() => (pluginActive ? onPluginConfirmHint() : void startPlugin())}
          >
            {pluginActive
              ? `🤖 采集插件 · 已开启 · 已选 ${pluginSelected} / 当前页识别 ${pluginRecognized}`
              : '🤖 启用采集插件'}
          </button>
          <div className="browser-translation address-extra-btn">
            <button
              type="button"
              className={`translation-trigger ${translationActive ? 'active' : ''}`}
              disabled={translating}
              onClick={() => (translationActive ? setTranslationMenuOpen((open) => !open) : void translatePage('BILINGUAL'))}
            >
              <span>
                {translating
                  ? '翻译中…'
                  : translationActive
                    ? `中文 ✓${translationCount ? ` · ${translationCount}` : ''}`
                    : '译 · 中文'}
              </span>
              <i>{translationMenuOpen ? '⌃' : '⌄'}</i>
            </button>
            {translationMenuOpen && (
              <div className="translation-menu">
                <b>网页翻译</b>
                <small>Qwen-MT Flash · 自动识别语种</small>
                <button
                  type="button"
                  className={translationMode === 'BILINGUAL' ? 'active' : ''}
                  onClick={() => {
                    setTranslationMenuOpen(false)
                    void translatePage('BILINGUAL')
                  }}
                >
                  <span>原文 + 中文</span>
                  <em>推荐</em>
                </button>
                <button
                  type="button"
                  className={translationMode === 'CHINESE' ? 'active' : ''}
                  onClick={() => {
                    setTranslationMenuOpen(false)
                    void translatePage('CHINESE')
                  }}
                >
                  <span>仅显示中文</span>
                </button>
                <button type="button" onClick={() => void translatePage(translationMode)}>
                  <span>翻译新增内容</span>
                </button>
                <button type="button" className="restore" onClick={() => void restoreTranslation()}>
                  <span>恢复原网页</span>
                </button>
              </div>
            )}
          </div>
        </form>

        <div ref={slotRef} className="browser-slot ebay-browser-slot" />
      </div>
    </section>
  )
}
