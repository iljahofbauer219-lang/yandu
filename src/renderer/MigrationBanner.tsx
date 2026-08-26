/**
 * 30 天迁移公告 banner：提示用户把 AI 员工工作流从 RAGFlow 切到 MaxKB
 * - 截止日期：2026-09-23（RAGFlow 兼容回退窗口到期）
 * - 显示规则：截止前 30 天（2026-08-24 起）显示；过期自动隐藏
 * - 可关闭：关闭后 24 小时内不再显示（localStorage 记忆）
 * - 不阻塞主流程：position: relative，仅占主区域顶部约 44px
 */
import { useEffect, useState } from 'react'

const SUNSET_AT = new Date('2026-09-23T23:59:59+08:00').getTime()
const SHOW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000 // 30 天
const DISMISS_KEY = 'yandu.migrationBanner.dismissedAt'
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000 // 关闭后 24 小时内不再显示

function daysUntil(target: number, now: number): number {
  return Math.max(0, Math.ceil((target - now) / (24 * 60 * 60 * 1000)))
}

export function MigrationBanner() {
  const [now, setNow] = useState(() => Date.now())
  const [dismissed, setDismissed] = useState(true) // 初始 true 避免 SSR / 首屏闪

  useEffect(() => {
    setNow(Date.now())
    try {
      const raw = localStorage.getItem(DISMISS_KEY)
      if (raw) {
        const at = Number(raw)
        if (Number.isFinite(at) && Date.now() - at < DISMISS_TTL_MS) return
      }
      setDismissed(false)
    } catch { /* ignore */ }
    const timer = window.setInterval(() => setNow(Date.now()), 60 * 60 * 1000) // 每小时更新一次天数
    return () => window.clearInterval(timer)
  }, [])

  if (dismissed) return null
  if (now >= SUNSET_AT) return null
  if (SUNSET_AT - now > SHOW_WINDOW_MS) return null

  const days = daysUntil(SUNSET_AT, now)

  const handleDismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* ignore */ }
    setDismissed(true)
  }

  return (
    <div className="migration-banner" role="status" aria-live="polite" data-testid="migration-banner">
      <div className="migration-banner-icon" aria-hidden="true">⚡</div>
      <div className="migration-banner-text">
        <strong>AI 员工已迁移到 MaxKB 智体</strong>
        <span>
          RAGFlow 兼容回退还有 <b>{days}</b> 天停服（{new Date(SUNSET_AT).toLocaleDateString('zh-CN')}），
          请把工作流切到 MaxKB（选品 / Listing / 守卫 / Amazon Skills 共 5 个智体）。
        </span>
      </div>
      <button
        type="button"
        className="migration-banner-action"
        onClick={() => window.open('https://114.55.149.192:8080/admin', '_blank', 'noopener')}
      >
        打开 MaxKB
      </button>
      <button type="button" className="migration-banner-close" aria-label="关闭公告" onClick={handleDismiss}>
        ×
      </button>
    </div>
  )
}
