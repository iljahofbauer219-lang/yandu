// 本地定时发布：每商品一条 {enabled, at} 调度记录；纯函数供渲染器持久化/到点判定复用。
export type EbayScheduledPublishEntry = { enabled: boolean; at: string }
export type EbayScheduledPublishMap = Record<string, EbayScheduledPublishEntry>

export const normalizeScheduledPublish = (raw: unknown): EbayScheduledPublishMap => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: EbayScheduledPublishMap = {}
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const entry = value as { enabled?: unknown; at?: unknown }
    if (typeof entry.enabled !== 'boolean' || typeof entry.at !== 'string') continue
    out[id] = { enabled: entry.enabled, at: entry.at }
  }
  return out
}

// datetime-local 值（本地时区 YYYY-MM-DDTHH:mm）：默认 now+1h
export const defaultScheduleAt = (nowIso: string): string => {
  const d = new Date(new Date(nowIso).getTime() + 3600_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const toggleScheduledPublish = (
  map: EbayScheduledPublishMap, id: string, enabled: boolean, at: string, nowIso: string
): EbayScheduledPublishMap => {
  const prev = map[id]
  const nextAt = enabled ? (at || prev?.at || defaultScheduleAt(nowIso)) : (at || prev?.at || '')
  return { ...map, [id]: { enabled, at: nextAt } }
}

export const dueScheduledPublish = (map: EbayScheduledPublishMap, nowIso: string): string[] => {
  const now = new Date(nowIso).getTime()
  return Object.entries(map)
    .filter(([, e]) => e.enabled && e.at && new Date(e.at).getTime() <= now)
    .map(([id]) => id)
}