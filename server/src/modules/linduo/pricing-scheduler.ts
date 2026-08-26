import { config } from '../../config.js'
import { scrapeAndPersist, markAllStale } from './pricing-scraper.js'

/**
 * 零度API 价格抓取调度器：
 * - 服务端启动 30 秒后自动触发一次（首启兜底：把 fallback 写入 DB）
 * - 之后每天 06:00 触发一次（时区遵循 process.env.TZ，缺省 UTC）
 * - 抓取失败时把所有现存行标记 stale=true，但保留旧数据
 * - 抓取成功时只更新数据，把 stale 复位为 false
 *
 * 停止：调用 stopLinduoPricingScheduler() 即可。
 */

let timer: NodeJS.Timeout | null = null
let running = false
let started = false

const FIRST_RUN_DELAY_MS = 30_000

function nextRunAt(hour: number): Date {
  const now = new Date()
  const next = new Date(now)
  next.setHours(hour, 0, 0, 0)
  if (next.getTime() <= now.getTime() + 60_000) {
    next.setDate(next.getDate() + 1)
  }
  return next
}

async function tick(): Promise<void> {
  if (running) return
  running = true
  try {
    const result = await scrapeAndPersist()
    if (result.fromFallback) {
      console.log('[linduo-pricing] 本次使用兜底价格（cookie 失效或抓取失败）')
    } else {
      console.log(`[linduo-pricing] 刷新 ${result.items.length} 个模型价格${result.loggedInJustNow ? '（已自动重登）' : ''}`)
    }
  } catch (err) {
    console.error('[linduo-pricing] 调度失败：', err instanceof Error ? err.message : err)
    await markAllStale().catch(() => undefined)
  } finally {
    running = false
    schedule()
  }
}

function schedule(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  const next = nextRunAt(config.linduoPricingRefreshHour)
  const delay = Math.max(next.getTime() - Date.now(), 60_000)
  timer = setTimeout(() => {
    void tick()
  }, delay)
  console.log(`[linduo-pricing] 下次抓取：${next.toISOString()}（${Math.round(delay / 1000)}s 后）`)
}

export function startLinduoPricingScheduler(): void {
  if (started) return
  started = true
  console.log(`[linduo-pricing] 调度器启动：${FIRST_RUN_DELAY_MS / 1000}s 后首次抓取`)
  // 首次触发：启动后 30s
  setTimeout(() => { void tick() }, FIRST_RUN_DELAY_MS)
}

export function stopLinduoPricingScheduler(): void {
  started = false
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}
