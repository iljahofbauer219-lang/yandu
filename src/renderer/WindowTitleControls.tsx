import { useEffect, useState } from 'react'
import { getUiPlatform } from './uiPlatform'

// Windows/Linux 无边框窗口的自绘最小化/最大化/关闭按钮组；macOS 使用原生红绿灯，不渲染
export default function WindowTitleControls({ className = '' }: { className?: string }) {
  const isMac = getUiPlatform() === 'darwin'
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (isMac) return
    let disposed = false
    void window.desktop.windowControls.isMaximized().then(value => { if (!disposed) setMaximized(value) }).catch(() => {})
    const off = window.desktop.windowControls.onMaximized(value => setMaximized(value))
    return () => { disposed = true; off() }
  }, [isMac])

  if (isMac) return null

  return (
    <div className={`win-window-controls${className ? ` ${className}` : ''}`}>
      <button type="button" title="最小化" aria-label="最小化" onClick={() => void window.desktop.windowControls.minimize()}>
        <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 5h8" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>
      </button>
      <button type="button" title={maximized ? '向下还原' : '最大化'} aria-label={maximized ? '向下还原' : '最大化'} onClick={() => void window.desktop.windowControls.toggleMaximize()}>
        {maximized ? (
          <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 3.5v-2h5v5h-2" fill="none" stroke="currentColor" strokeWidth="1.2"/><rect x="1.5" y="3.5" width="5" height="5" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>
        ) : (
          <svg viewBox="0 0 10 10" aria-hidden="true"><rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>
        )}
      </button>
      <button type="button" className="win-close" title="关闭" aria-label="关闭" onClick={() => void window.desktop.windowControls.close()}>
        <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>
      </button>
    </div>
  )
}
