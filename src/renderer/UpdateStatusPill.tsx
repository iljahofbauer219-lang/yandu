import { useEffect, useState } from 'react'
import { friendlyUpdateError } from './friendlyError'

// 自动更新状态悬浮提示（右下角）：下载中显示百分比，失败显示中文原因并可重试，下载完成可一键重启安装；
// 状态由主进程 app:update-status 推送（见 main.ts initAutoUpdate），'info' 为渲染层本地态（手动检查结果）
type UpdatePillStatus = { phase: 'downloading' | 'downloaded' | 'error' | 'info'; version: string; percent?: number; message?: string }

export function UpdateStatusPill() {
  const [status, setStatus] = useState<UpdatePillStatus | null>(null)
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    return window.desktop.appInfo.onUpdateStatus(next => {
      setDismissed(false)
      setStatus(next)
    })
  }, [])
  // 失败与信息态不常驻：主进程每 5 分钟自动补查一次并会重推状态，红条没必要一直挂着；信息态只停留 8 秒
  useEffect(() => {
    if (!status || dismissed) return
    const ttl = status.phase === 'error' ? 30_000 : status.phase === 'info' ? 8_000 : 0
    if (!ttl) return
    const timer = window.setTimeout(() => setDismissed(true), ttl)
    return () => window.clearTimeout(timer)
  }, [status, dismissed])
  const retryUpdate = async () => {
    setDismissed(false)
    setStatus({ phase: 'info', version: status?.version ?? '', message: '正在检查更新…' })
    try {
      const result = await window.desktop.appInfo.checkUpdateNow()
      if (result.error) setStatus({ phase: 'error', version: result.current, message: result.error })
      else if (result.isLatest) setStatus({ phase: 'info', version: result.latest, message: `已是最新版本 v${result.latest}` })
      // 有新版本时主进程随即推送 downloading 状态，此处不抢先覆盖
    } catch (error) {
      setStatus({ phase: 'error', version: status?.version ?? '', message: error instanceof Error ? error.message : String(error) })
    }
  }
  if (!status || dismissed) return null
  const failure = status.phase === 'error' ? friendlyUpdateError(status.message) : null
  return <div className={`update-pill update-pill--${status.phase}`} role="status" aria-live="polite">
    {status.phase === 'downloading' && <span>正在下载新版本 v{status.version} · {status.percent ?? 0}%</span>}
    {status.phase === 'downloaded' && <>
      <span>新版本 v{status.version} 已下载完成</span>
      <button type="button" className="update-pill-action" onClick={() => void window.desktop.appInfo.installUpdate()}>重启安装</button>
    </>}
    {status.phase === 'info' && <span>{status.message}</span>}
    {failure && <>
      <span title={failure.detail}>{failure.text}</span>
      <button type="button" className="update-pill-action" onClick={() => void retryUpdate()}>重试</button>
    </>}
    <button type="button" className="update-pill-close" aria-label="关闭提示" onClick={() => setDismissed(true)}>×</button>
  </div>
}
