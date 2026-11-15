/**
 * 栏目保活：侧栏栏目切走时不再卸载组件，只隐藏，切回时页面内状态原样还在。
 * 清单里只放「页面内有自己的状态或进行中任务」的界面；纯卡片入口的 hub 页每次渲染都是
 * 同一份 App 级状态的投影，切走重建与保活等价，没必要常驻。
 */
export const KEEP_ALIVE_PAGES = [
  'ebay', 'ebay-search-collect', 'ie-browser', 'article-crawler',
  'ai-hub-warehouse', 'ai-hub-my-pallet', 'erp-collect',
  'online-advisor', 'ai-employee-workspace', 'ai-employee-listing', 'ai-employee-guardian',
  'ai-sample-library', 'compliance-knowledge', 'ops-knowledge', 'system-admin',
  'tasks', 'ozon', 'sourcing', 'comparison', 'eliminated', 'review', 'catalog',
  'image-studio', 'realshift', 'publishing', 'ai-support', 'feishu',
  'amazon-data-source', 'llm-keys', 'linduo-mall', 'bailian-mall',
  'ai-video-watch', 'ai-video-resource'
] as const

export type KeepAlivePage = (typeof KEEP_ALIVE_PAGES)[number]

export interface KeepAliveRegistry {
  visit(key: string): void
  alive(key: string): boolean
  visited(): string[]
}

export function createKeepAliveRegistry(initial: readonly string[] = []): KeepAliveRegistry {
  const visited = new Set<string>(initial)
  return {
    visit: key => { visited.add(key) },
    alive: key => visited.has(key),
    visited: () => [...visited]
  }
}

/**
 * 本栏目那组页签里当前活动的一枚。
 * 'web' 罐被多个栏目共用（AI跨境/搜索采集 用 eBay 会话页签，货盘采集/文章抓取 用通用页签），
 * 只按平台名附着会拿到别人家的页签，所以栏目要在可见期间记住自己的 id，切回来时点名要它。
 * 切走期间没有页签推送、或本栏目一枚都不活动时会返回 null，由调用方退回平台默认页签。
 */
export function activeTabIdOf(tabs: readonly { id: string; active?: boolean }[]): string | null {
  return tabs.find(tab => tab.active)?.id ?? null
}

/** 可见态用 display:contents 让保活壳对父级布局完全透明；隐藏态整棵子树脱离渲染，既不可见也不可点。 */
export function pageFrameClassName(show: boolean): string {
  return show ? 'yd-page-frame' : 'yd-page-frame yd-page-frame-hidden'
}

/**
 * eBay 浏览器「发起进入店铺」的去重键。
 * 只随店铺、工作区（含标题优化独占视图）和手动重试次数变化：切页签、开合表单、切栏目都不进键，
 * 否则每次回到浏览器页签都会重新走一遍 openSellerHub，主进程会把活动页签顶回店铺首页，用户正在看的内容被换掉。
 */
export type EbayBrowserLaunchMode = 'workspace' | 'search-collect' | 'title'
export function ebayBrowserLaunchKey(storeId: string, mode: EbayBrowserLaunchMode, relaunchNonce: number): string {
  return `${storeId}|${mode}|${relaunchNonce}`
}
