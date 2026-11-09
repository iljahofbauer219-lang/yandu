/**
 * 页面就绪轮询：替代隐藏采集窗口里的固定盲等。
 * 口径约定：timeoutMs 一律沿用被替换掉的那次 sleep 时长，故最坏耗时不变，只是常见情况下更早取数。
 * 判定脚本抛错（导航中断、上下文销毁）只算「这次没就绪」——固定 sleep 原本不会抛，
 * 若让它冒泡就会把「慢页面」变成新的用户可见失败。
 */
export interface PagePollOptions {
  intervalMs: number
  timeoutMs: number
  /** 需要连续成立多少次才算就绪；1 = 一次即走，>1 用于防在 DOM 刷新中途取数 */
  stableHits?: number
}

export interface PagePollResult {
  ready: boolean
  elapsedMs: number
  polls: number
  lastError?: string
}

export async function pollUntil(probe: () => Promise<boolean>, options: PagePollOptions): Promise<PagePollResult> {
  const { intervalMs, timeoutMs, stableHits = 1 } = options
  const startedAt = Date.now()
  let polls = 0
  let stable = 0
  let lastError: string | undefined
  for (;;) {
    polls += 1
    try {
      if (await probe()) {
        stable += 1
        if (stable >= stableHits) return { ready: true, elapsedMs: Date.now() - startedAt, polls, lastError }
      } else {
        stable = 0
      }
    } catch (error) {
      stable = 0
      lastError = error instanceof Error ? error.message : String(error)
    }
    const elapsed = Date.now() - startedAt
    if (elapsed >= timeoutMs) return { ready: false, elapsedMs: elapsed, polls, lastError }
    await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, timeoutMs - elapsed)))
  }
}
