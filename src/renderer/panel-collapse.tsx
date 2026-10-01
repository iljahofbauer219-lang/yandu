// 全局侧面板收起/展开：按区域独立状态（localStorage 持久化）+ 标题栏统一开关 + 面板内收起按钮与收起后展开轨。
import { useEffect, useSyncExternalStore } from 'react'
import './panel-collapse.css'

const STORAGE_KEY = 'app-panel-collapse:v1'
// 小屏（<1280）首次进入默认收起，保证右侧操作空间；用户手动切换后以存档为准
const SMALL_SCREEN_DEFAULT = typeof window !== 'undefined' && window.innerWidth < 1280

type CollapseMap = Record<string, boolean>

const readStored = (): CollapseMap => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as CollapseMap : {}
  } catch { return {} }
}

let collapsedMap: CollapseMap = readStored()
const stateListeners = new Set<() => void>()
const subscribeState = (listener: () => void) => { stateListeners.add(listener); return () => { stateListeners.delete(listener) } }
const emitState = () => stateListeners.forEach(listener => listener())
const isCollapsed = (key: string) => collapsedMap[key] ?? SMALL_SCREEN_DEFAULT
const setCollapsed = (key: string, collapsed: boolean) => {
  collapsedMap = { ...collapsedMap, [key]: collapsed }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsedMap)) } catch { /* ignore quota */ }
  emitState()
}

// 主面板注册表：标题栏开关作用于栈顶（即当前页面的主左面板）
let primaryStack: string[] = []
const registryListeners = new Set<() => void>()
const subscribeRegistry = (listener: () => void) => { registryListeners.add(listener); return () => { registryListeners.delete(listener) } }
const emitRegistry = () => registryListeners.forEach(listener => listener())
const readActiveKey = () => (primaryStack.length ? primaryStack[primaryStack.length - 1] : null)

export interface PanelCollapseControl {
  key: string
  collapsed: boolean
  side: 'left' | 'right'
  toggle: () => void
}

export function usePanelCollapse(key: string, options?: { primary?: boolean; side?: 'left' | 'right'; active?: boolean }): PanelCollapseControl {
  const primary = options?.primary !== false
  const side = options?.side || 'left'
  const active = options?.active !== false
  const collapsed = useSyncExternalStore(subscribeState, () => isCollapsed(key), () => SMALL_SCREEN_DEFAULT)
  useEffect(() => {
    if (!primary || !active) return
    primaryStack = [...primaryStack, key]
    emitRegistry()
    return () => { primaryStack = primaryStack.filter(item => item !== key); emitRegistry() }
  }, [key, primary, active])
  return { key, collapsed, side, toggle: () => setCollapsed(key, !isCollapsed(key)) }
}

const CollapseIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path d="m15 9-3 3 3 3"/></svg>
const ExpandIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path d="m12 9 3 3-3 3"/></svg>

// 面板内右上角收起按钮：作为 aside 第一个子节点，sticky 固定且滚动时保持可见
export function PanelCollapseButton({ panel }: { panel: PanelCollapseControl }) {
  return <button type="button" className="panel-collapse-toggle" title="收起面板" aria-label="收起面板" onClick={panel.toggle}><CollapseIcon/></button>
}

// 收起后显示的展开轨：占据 32px 轨道（左面板=首子节点，右面板=末子节点）
export function PanelExpandRail({ panel, label }: { panel: PanelCollapseControl; label: string }) {
  const right = panel.side === 'right'
  return <button type="button" className={`panel-expand-rail${right ? ' right' : ''}`} title={`展开${label}`} aria-label={`展开${label}`} onClick={panel.toggle}>
    <svg viewBox="0 0 24 24" aria-hidden="true">{right ? <><path d="m11 6-3 6 3 6"/><path d="m16 6-3 6 3 6"/></> : <><path d="m8 6 3 6-3 6"/><path d="m13 6 3 6-3 6"/></>}</svg>
  </button>
}

// 标题栏统一开关：作用于当前页面的主左面板；无主面板挂载时不渲染
export function TitlebarPanelToggle() {
  const key = useSyncExternalStore(subscribeRegistry, readActiveKey, () => null)
  const collapsed = useSyncExternalStore(subscribeState, () => (key ? isCollapsed(key) : false), () => false)
  if (!key) return null
  const label = collapsed ? '展开' : '收起'
  return <button type="button" title={`${label}面板`} aria-label={`${label}面板`} onClick={() => setCollapsed(key, !collapsed)}>
    {collapsed ? <ExpandIcon/> : <CollapseIcon/>}{label}
  </button>
}
