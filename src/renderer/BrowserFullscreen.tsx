import { useEffect, useState, type RefObject } from 'react'

// 内嵌浏览器全屏：容器加 browser-fullscreen 铺满窗口，标题行加 browser-fullscreen-bar 让出红绿灯拖动区。
// 内嵌页面是主进程 WebContentsView，边界跟随插槽矩形；切 class 不保证触发 ResizeObserver，故显式重报一次。
export function useBrowserFullscreen<T extends HTMLElement>(slot: RefObject<T | null>, visible: boolean) {
  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => { if (!visible && fullscreen) setFullscreen(false) }, [fullscreen, visible])
  useEffect(() => {
    if (!visible || !fullscreen) return
    const rect = slot.current?.getBoundingClientRect()
    if (rect && rect.width > 0) void window.desktop.browser.setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
  }, [fullscreen, visible])
  return { fullscreen, toggleFullscreen: () => setFullscreen(value => !value) }
}

export function BrowserFullscreenToggle({ fullscreen, onToggle }: { fullscreen: boolean; onToggle: () => void }) {
  return <button type="button" className="browser-fullscreen-toggle" aria-pressed={fullscreen} title={fullscreen ? '恢复原来界面' : '浏览器铺满整个界面'} onClick={onToggle}>{fullscreen ? '正常' : '全屏'}</button>
}
