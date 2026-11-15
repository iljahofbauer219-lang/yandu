import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  KEEP_ALIVE_PAGES,
  activeTabIdOf,
  createKeepAliveRegistry,
  ebayBrowserLaunchKey,
  pageFrameClassName,
} from '../pageKeepAlive'

const appSource = readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8')
const ieSource = readFileSync(path.join(__dirname, '..', 'IEBrowserPanel.tsx'), 'utf8')
const crawlerSource = readFileSync(path.join(__dirname, '..', 'ArticleCrawlerPanel.tsx'), 'utf8')
const stylesSource = readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8')
const panelSource = readFileSync(path.join(__dirname, '..', 'panel-collapse.tsx'), 'utf8')
const pageFrameSource = readFileSync(path.join(__dirname, '..', 'PageFrame.tsx'), 'utf8')
const llmKeysSource = readFileSync(path.join(__dirname, '..', 'LlmApiKeysPage.tsx'), 'utf8')

/** 页面挂载点 = 独占一行、以 `{page==='X' &&` 开头的顶层条件渲染；导航条里的 `{page==='X'&&<button` 不算。 */
const mountLines = (key: string) => {
  const pattern = new RegExp(`^\\s*\\{\\s*page\\s*===\\s*'${key}'\\s*&&`)
  return appSource.split('\n').filter(line => pattern.test(line))
}

/**
 * 用户口径（2026-11-15 两张截图）：侧栏栏目切走再切回，栏目里「正在打开/正在运行」的内容必须原样还在，
 * 不能又变成新内容。根因是每个栏目都是 `{page===X&&<Comp/>}` 条件挂载——切栏目即卸载组件，
 * 页面内状态清零，内嵌浏览器还会在重挂载时重新发起进入店铺（把用户正在看的页签顶回店铺首页）。
 * 因此保活策略 = 首次访问后常驻挂载 + 只隐藏；同一屏只允许当前可见栏目持有内嵌浏览器视图。
 */
describe('栏目保活注册表', () => {
  it('未访问过的栏目不挂载，访问后才常驻', () => {
    const registry = createKeepAliveRegistry(['ebay'])
    expect(registry.alive('ebay')).toBe(true)
    expect(registry.alive('image-studio')).toBe(false)
    registry.visit('image-studio')
    expect(registry.alive('image-studio')).toBe(true)
  })

  it('重复进入同一栏目不增加记录，访问顺序即常驻顺序', () => {
    const registry = createKeepAliveRegistry()
    registry.visit('tasks')
    registry.visit('online-advisor')
    registry.visit('tasks')
    expect(registry.visited()).toEqual(['tasks', 'online-advisor'])
  })

  it('保活清单覆盖用户点名的栏目，且不含无状态的卡片入口页', () => {
    for (const key of ['ebay', 'ebay-search-collect', 'ie-browser', 'article-crawler', 'tasks', 'online-advisor', 'image-studio']) {
      expect(KEEP_ALIVE_PAGES, `保活清单缺少 ${key}`).toContain(key)
    }
    // hub 页只有卡片与文案，无页面内状态，切走重建与保活等价，不进清单以免白白常驻
    for (const key of ['ai-crossborder', 'ai-hq', 'ai-planet', 'ai-art', 'ai-collect', 'ai-search-collect']) {
      expect(KEEP_ALIVE_PAGES, `${key} 是纯卡片入口，不该保活`).not.toContain(key)
    }
  })
})

describe('保活容器可见性', () => {
  it('可见与隐藏都带基类，隐藏另加 hidden 修饰', () => {
    expect(pageFrameClassName(true)).toBe('yd-page-frame')
    expect(pageFrameClassName(false)).toBe('yd-page-frame yd-page-frame-hidden')
  })

  it('styles.css 里可见态对布局完全透明、隐藏态整棵子树不渲染', () => {
    expect(stylesSource, '可见栏目必须 display:contents，否则多套一层盒子会改布局').toMatch(/\.yd-page-frame\s*\{[^}]*display:\s*contents/)
    expect(stylesSource, '隐藏栏目必须 display:none，做到不可见不可点').toMatch(/\.yd-page-frame-hidden\s*\{[^}]*display:\s*none/)
  })
})

describe('eBay 浏览器重进不重新导航', () => {
  it('去重键只随店铺、标题模式与手动重试变化', () => {
    const first = ebayBrowserLaunchKey('store-1', 'workspace', 0)
    expect(ebayBrowserLaunchKey('store-1', 'workspace', 0)).toBe(first)
    expect(ebayBrowserLaunchKey('store-2', 'workspace', 0)).not.toBe(first)
    expect(ebayBrowserLaunchKey('store-1', 'title', 0)).not.toBe(first)
    expect(ebayBrowserLaunchKey('store-1', 'workspace', 1)).not.toBe(first)
  })

  it('同键重进只重新附着视图，不再发起进入店铺', () => {
    expect(appSource, '要把去重键接进来，否则切回浏览器页签仍会重走 openSellerHub').toMatch(/launchKey\s*===\s*ebayBrowserLaunchedKey\.current/)
    const reattachBlock = /const reattach=async\(\)=>\{[\s\S]*?\n {6}\}/.exec(appSource)?.[0] || ''
    expect(reattachBlock, '要有一条只做重新附着并读回地址的路径').toContain("browser.getState('web')")
    expect(reattachBlock, '重新附着不得再走 openSellerHub，否则用户正在看的页签被顶回店铺首页').not.toContain('openSellerHub')
    expect(reattachBlock, '重新附着要带上本栏目自己的页签 id').toContain("browser.show('web', ebayOwnTabId.current)")
    expect(appSource, '真正发起过进入店铺才记下去重键').toContain('ebayBrowserLaunchedKey.current=launchKey')
    expect(appSource, '打开失败要清掉去重键，切回来才有重试机会').toMatch(/ebayBrowserLaunchedKey\.current=''/)
  })

  it('可见性守卫必须留在附着 effect 内部：漏到组件体会提前 return，少渲染 hooks 直接白屏（React #300）', () => {
    expect(appSource, '守卫要紧贴 launchVersion，且两者同属一个 useEffect').toContain('if(!active)return\n    const launchVersion=++ebayBrowserLaunchVersion.current')
    const before = appSource.split('const launchVersion=++ebayBrowserLaunchVersion.current')[0] ?? ''
    const between = before.slice(before.lastIndexOf('useEffect(()=>{'))
    expect(between, '守卫与 launchVersion 之间不得插入别的 effect').toContain('if(!active)return')
  })

  it('清去重键要在 catch 之后：塞进 catch 里会让成功路径不再重置，失败路径反而重置', () => {
    expect(appSource).not.toContain("} catch {\n        ebayBrowserLaunchedKey.current=''")
  })
})

describe('切回栏目附着自己的页签', () => {
  it('从本栏目那组页签里取当前活动页签 id', () => {
    expect(activeTabIdOf([{ id: 'a', active: false }, { id: 'b', active: true }])).toBe('b')
    expect(activeTabIdOf([{ id: 'a', active: false }])).toBeNull()
    expect(activeTabIdOf([])).toBeNull()
  })

  it('AI跨境 记住自己上次选中的页签，重进时按该页签附着', () => {
    expect(appSource, '要有一个记住本页 eBay 页签 id 的引用').toMatch(/const ebayOwnTabId=useRef<string\|null>\(null\)/)
    expect(appSource, '页签推送里要取本栏目那组页签中活动的一枚').toMatch(/activeTabIdOf\(\s*mine\s*\)/)
    expect(appSource, '切走期间主进程不再推送，拿到 null 时不得清空已记住的页签').toMatch(/if\s*\(\s*tabId\s*\)\s*ebayOwnTabId\.current\s*=\s*tabId/)
    expect(appSource, '重新附着要带上自己的页签 id，否则拿到别的栏目的页签').toMatch(/browser\.show\(\s*'web',\s*ebayOwnTabId\.current\s*\)/)
    expect(appSource, '首次进入店铺也要记住返回的页签 id').toMatch(/ebayOwnTabId\.current=tabId/)
  })

  it('IE 浏览按记住的页签恢复，而不是第一枚', () => {
    expect(ieSource, 'IE 浏览要订阅并记住自己的活动页签').toContain('activeTabIdOf(')
    expect(ieSource, 'show(\'ie\') 要带上自己的页签 id').toMatch(/browser\.show\(\s*'ie',\s*\w+\.current\s*\)/)
  })
})

describe('App 挂载策略已改为常驻', () => {
  it('App.tsx 接入保活模块与保活容器', () => {
    expect(appSource).toContain("from './pageKeepAlive'")
    expect(appSource).toContain('<PageFrame')
  })

  it('每个保活栏目都以 alive() 常驻挂载，并按当前栏目决定显隐', () => {
    for (const key of KEEP_ALIVE_PAGES) {
      expect(appSource, `${key} 必须改为 alive('${key}') 常驻挂载`).toContain(`{alive('${key}')`)
      expect(appSource, `${key} 必须包一层 PageFrame 并传 show={page==='${key}'}`).toContain(`show={page==='${key}'}`)
      expect(mountLines(key), `${key} 仍是从前的一进一出条件挂载，切走会被卸载`).toEqual([])
    }
  })

  it('IE浏览不再由路由 IIFE 一次性返回，改为常驻挂载', () => {
    expect(appSource, 'IE浏览留在 IIFE 里就仍会随栏目切换卸载重建').not.toContain(`if(page==='ie-browser')return <IEBrowserPanel`)
  })
})

describe('内嵌浏览器同屏唯一归属', () => {
  it('三个浏览器界面的顶栏全屏登记只在可见时占用', () => {
    expect(appSource, 'AI跨境/搜索采集 的 surface 登记要带 active').toMatch(/useBrowserSurfaceRegistration\(\s*active\s*&&\s*activeTab\s*===\s*'browser'\s*&&\s*activeStore\s*&&\s*showBrowser\s*\?\s*'ebay'\s*:\s*null\s*,\s*onBrowserSurface\)/)
    expect(ieSource, 'IE浏览 的 surface 登记要带 active').toMatch(/useBrowserSurfaceRegistration\(\s*active\s*\?\s*'ie'\s*:\s*null\s*,\s*onBrowserSurface\)/)
    expect(crawlerSource, '文章抓取 的 surface 登记要带 active').toMatch(/useBrowserSurfaceRegistration\(\s*active\s*\?\s*'crawler'\s*:\s*null\s*,\s*onBrowserSurface\)/)
  })

  it('隐藏中的界面不得再向主进程上报视图边界', () => {
    let guarded = 0
    for (const [name, source] of [['App.tsx', appSource], ['IEBrowserPanel.tsx', ieSource], ['ArticleCrawlerPanel.tsx', crawlerSource]] as const) {
      for (const match of source.matchAll(/getBoundingClientRect\(\)/g)) {
        const start = (match.index ?? 0) + match[0].length
        const tail = source.slice(start, start + 220)
        if (!tail.includes('browser.setBounds')) continue
        expect(tail, `${name} 里的 bounds 上报必须校验宽度，隐藏界面量到 0 宽会把视图缩成最小尺寸`).toMatch(/\.width\s*>\s*0/)
        guarded++
      }
    }
    expect(guarded, '一个 bounds 上报点都没扫到，说明守卫失效（现网应有 AI跨境/标题优化/采集/IE/文章抓取五处）').toBeGreaterThanOrEqual(5)
  })

  it('IE浏览与文章抓取的挂载/摘除跟随可见性', () => {
    expect(ieSource).toMatch(/if\s*\(!active\)\s*return/)
    expect(ieSource, 'show(\'ie\') 必须在可见性效果里，切回栏目要能重新挂回视图').toMatch(/show\('ie'\)[^]*?\[active/)
    expect(crawlerSource).toMatch(/if\s*\(!active\)\s*return/)
    expect(crawlerSource, "show('web') 必须在可见性效果里").toMatch(/show\('web'\)[^]*?\[active/)
  })

  it('App 主进程兜底 hide 不再误伤自管浏览器的文章抓取页', () => {
    expect(appSource, 'article-crawler 自管视图，App 兜底 hide 会把它刚挂的视图摘掉').toContain("page === 'article-crawler'")
  })

  it('eBay 工作台的浏览器订阅与轮询随可见性停歇', () => {
    expect(appSource, 'onState 订阅要随 active 重订阅，隐藏界面不得被别的界面事件改写地址栏').toContain("useEffect(()=>{if(!active)return;return window.desktop.browser.onState(")
    expect(appSource, '翻译轮询要带 active，否则隐藏界面会给当前视图重复注入翻译').toContain("!active||!ebayTranslationActive")
  })
})

describe('隐藏栏目不得影响可见栏目', () => {
  it('脱离保活容器的旧代码默认按可见处理', () => {
    expect(pageFrameSource, '可见性上下文默认值必须是 true，否则未接入保活容器的弹窗直接不显示').toMatch(/export const PageVisibilityContext = createContext\(true\)/)
  })

  it('栏目隐藏时，挂在 document.body 上的模态一起收起', () => {
    expect(pageFrameSource, '要有按可见性决定挂不挂 body 的门户组件').toMatch(/export function PagePortal\(/)
    expect(appSource, '合规知识库的添加文件弹窗还挂着裸 createPortal，切到别的栏目它会盖在上面').not.toMatch(/\{documentDraft&&createPortal\(/)
    expect(appSource, '合规知识库的类目模板弹窗还挂着裸 createPortal').not.toMatch(/\{templateDraft&&createPortal\(/)
    expect(appSource, '合规知识库的规则弹窗还挂着裸 createPortal').not.toMatch(/\{editing&&createPortal\(/)
    expect(llmKeysSource, '大模型API Key 的凭据弹窗还挂着裸 createPortal').not.toMatch(/modalOpen\s*&&\s*createPortal\(/)
    expect(llmKeysSource, '大模型API Key 的凭据弹窗要改用 PagePortal').toContain('<PagePortal')
  })

  it('标题栏主面板开关只作用于当前可见栏目', () => {
    expect(panelSource, '保活后隐藏栏目仍留在主面板栈里，顶栏开关会打到看不见的面板').toMatch(/useContext\(PageVisibilityContext\)/)
  })
})
