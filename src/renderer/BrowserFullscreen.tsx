import { useEffect, type RefObject } from 'react'

// APP 内每一个内嵌浏览器界面都共用顶栏这同一个「全屏」开关。
// 界面同一时刻只有一个可见，故用一个「当前界面」登记位：面板显示时登记自己、隐藏时注销，
// 开关只对登记中的那个界面生效，注销即退出全屏。
export type BrowserSurface = 'collector' | 'ebay' | 'ie' | 'crawler'

// report 必须是稳定引用（App 直接传 useState 的 setter），否则每次重渲染都会注销再登记，全屏会被自己打断。
export function useBrowserSurfaceRegistration(surface: BrowserSurface | null, report: (next: BrowserSurface | null) => void) {
  useEffect(() => {
    if (!surface) return
    report(surface)
    return () => report(null)
  }, [surface, report])
}

// 内嵌页面是主进程 WebContentsView，边界跟随插槽矩形。
// 切 class 不保证触发 ResizeObserver（插槽尺寸可能不变、只挪了位置），故同步补报一次 + 下一帧再补一次。
export function useBrowserFullscreenBounds(slot: RefObject<HTMLElement | null>, visible: boolean, fullscreen: boolean) {
  useEffect(() => {
    if (!visible || !fullscreen) return
    const update = () => {
      const rect = slot.current?.getBoundingClientRect()
      if (rect && rect.width > 0) void window.desktop.browser.setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
    }
    update()
    const frame = window.requestAnimationFrame(update)
    return () => window.cancelAnimationFrame(frame)
  }, [slot, visible, fullscreen])
}

export function BrowserFullscreenToggle({ fullscreen, onToggle }: { fullscreen: boolean; onToggle: () => void }) {
  return <button type="button" aria-pressed={fullscreen} title={fullscreen ? '恢复原来界面' : '浏览器铺满顶栏以下的整个窗口'} onClick={onToggle}>
    <svg viewBox="0 0 24 24" aria-hidden="true">{fullscreen
      ? <><path d="M9 4v5H4" /><path d="M15 4v5h5" /><path d="M9 20v-5H4" /><path d="M15 20v-5h5" /></>
      : <><path d="M4 9V4h5" /><path d="M20 9V4h-5" /><path d="M4 15v5h5" /><path d="M20 15v5h-5" /></>}</svg>
    {fullscreen ? '退出全屏' : '全屏'}
  </button>
}
