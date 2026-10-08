export const CANDIDATE_VIEW_SESSION_KEY = 'yd:candidate-view'

export interface CandidateViewSession {
  area: 'SUPPLY' | 'MARKET'
  platform: string
}

// 采集候选页区域/平台选择的会话级持久化：顶栏刷新为整窗 reload，未持久化时选择会被挂载恢复硬编码覆盖
export function readCandidateViewSession(getItem: (key: string) => string | null): CandidateViewSession | null {
  let raw: string | null = null
  try { raw = getItem(CANDIDATE_VIEW_SESSION_KEY) } catch { return null }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { area?: unknown; platform?: unknown }
    if ((parsed.area === 'SUPPLY' || parsed.area === 'MARKET') && typeof parsed.platform === 'string' && parsed.platform.trim()) {
      return { area: parsed.area, platform: parsed.platform }
    }
    return null
  } catch { return null }
}

export function writeCandidateViewSession(setItem: (key: string, value: string) => void, view: CandidateViewSession): void {
  try { setItem(CANDIDATE_VIEW_SESSION_KEY, JSON.stringify(view)) } catch { /* 忽略配额/隐私模式 */ }
}
