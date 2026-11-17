// 本地定时发布：每商品一条 {enabled, at} 调度记录；纯函数供渲染器持久化/到点判定复用。
// 双模式：once=自选一次性（at 为本地墙钟）；daily=固定时间（店铺级统一目标时区+当地窗口，IANA 换算 DST 自适应）。
export type EbayScheduledPublishEntry = { enabled: boolean; at: string; mode?: 'once' | 'daily'; tz?: string; start?: string; end?: string; lastRunAt?: string; lastSkippedAt?: string; lastFailedAt?: string; lastError?: string }
export type EbayScheduledPublishMap = Record<string, EbayScheduledPublishEntry>

export const SCHEDULE_TZ_OPTIONS: Array<{ tz: string; label: string }> = [
  { tz: 'America/New_York', label: '美东' },
  { tz: 'America/Chicago', label: '美中' },
  { tz: 'America/Los_Angeles', label: '美西' },
]
export const DEFAULT_SCHEDULE_TZ = 'America/New_York'
export const DEFAULT_SCHEDULE_START = '19:00'
export const DEFAULT_SCHEDULE_END = '21:00'

export const normalizeScheduledPublish = (raw: unknown): EbayScheduledPublishMap => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: EbayScheduledPublishMap = {}
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const entry = value as { enabled?: unknown; at?: unknown; mode?: unknown; tz?: unknown; start?: unknown; end?: unknown; lastRunAt?: unknown; lastSkippedAt?: unknown; lastFailedAt?: unknown; lastError?: unknown }
    if (typeof entry.enabled !== 'boolean' || typeof entry.at !== 'string') continue
    const next: EbayScheduledPublishEntry = { enabled: entry.enabled, at: entry.at }
    if (entry.mode === 'daily' || entry.mode === 'once') next.mode = entry.mode
    if (typeof entry.tz === 'string' && entry.tz) next.tz = entry.tz
    if (typeof entry.start === 'string' && entry.start) next.start = entry.start
    if (typeof entry.end === 'string' && entry.end) next.end = entry.end
    if (typeof entry.lastRunAt === 'string' && entry.lastRunAt) next.lastRunAt = entry.lastRunAt
    if (typeof entry.lastSkippedAt === 'string' && entry.lastSkippedAt) next.lastSkippedAt = entry.lastSkippedAt
    if (typeof entry.lastFailedAt === 'string' && entry.lastFailedAt) next.lastFailedAt = entry.lastFailedAt
    if (typeof entry.lastError === 'string' && entry.lastError) next.lastError = entry.lastError
    out[id] = next
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
  // 保留 mode/tz/start/end/lastRunAt：开关只改 enabled/at，不得抹掉固定时间配置
  return { ...map, [id]: { ...prev, enabled, at: nextAt } }
}

// 失败留痕：供行内「发布失败」小通知渲染；随 scoped localStorage 持久化，跨重启可见
// 下一次自动发布的北京时间（日/时/分）：daily 按批次行窗口起点（IANA 换算 DST 自适应），once 按 at（本地墙钟即北京）
// 模拟真人不规则到点：窗口分钟数（跨 midnight 取模）与确定性分钟偏移（同产品同目标日稳定、跨产品/跨日不同）
export const windowMinutes = (start: string, end: string): number => {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  return ((eh * 60 + em) - (sh * 60 + sm) + 1440) % 1440
}
export const jitterMinutes = (productId: string, dayKey: string, window: number): number => {
  if (window <= 0) return 0
  let h = 2166136261
  const s = productId + '|' + dayKey
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0) % window
}

export const nextRunBeijingText = (opts: { mode?: 'once' | 'daily'; at?: string; tz?: string; start?: string; end?: string; productId?: string }, nowIso: string): string => {
  let instant: number
  if (opts.mode === 'daily') {
    const tz = opts.tz || DEFAULT_SCHEDULE_TZ
    const start = opts.start || DEFAULT_SCHEDULE_START
    const base = nextDailyRunUtc(tz, start, nowIso)
    const day = zonedParts(tz, base)
    instant = base + jitterMinutes(opts.productId || '', `${day.y}-${day.m}-${day.d}`, windowMinutes(start, opts.end || start)) * 60000
  } else {
    instant = new Date(opts.at || '').getTime()
    if (!Number.isFinite(instant)) return ''
  }
  const p = zonedParts('Asia/Shanghai', instant)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${p.d}日 ${pad(p.h)}:${pad(p.mi)}`
}

// 状态位口径（2026-11-17 拍板）：失败留痕＝发布失败；enabled 等待＝待发布中；其余不显示。
// 真正上架成功的产品会离开本地定时发布转入线上产品，故无 success 态。
export function scheduleStatus(entry: { enabled?: boolean; lastFailedAt?: string; lastSkippedAt?: string }): 'failed' | 'skipped' | 'waiting' | 'idle' {
  if (entry.lastFailedAt) return 'failed'
  if (entry.lastSkippedAt) return 'skipped'
  if (entry.enabled) return 'waiting'
  return 'idle'
}

export const markScheduleFailure = (map: EbayScheduledPublishMap, id: string, nowIso: string, message: string): EbayScheduledPublishMap => {
  const prev = map[id]
  if (!prev) return map
  return { ...map, [id]: { ...prev, lastFailedAt: nowIso, lastError: message } }
}

// 再次发布成功才清除失败留痕
export const clearScheduleFailure = (map: EbayScheduledPublishMap, id: string): EbayScheduledPublishMap => {
  const prev = map[id]
  if (!prev || (!prev.lastFailedAt && !prev.lastError)) return map
  const next = { ...prev }
  delete next.lastFailedAt
  delete next.lastError
  return { ...map, [id]: next }
}

export const dueScheduledPublish = (map: EbayScheduledPublishMap, nowIso: string, plan?: EbaySchedulePlan): string[] => {
  const now = new Date(nowIso).getTime()
  const enabledIds = Object.entries(map).filter(([, e]) => e.enabled).map(([id]) => id)
  const allocation = plan ? allocateBatches(enabledIds, plan, nowIso.slice(0, 10)) : {}
  return Object.entries(map)
    .filter(([id, e]) => {
      if (!e.enabled) return false
      const row = allocation[id]
      const tz = row?.tz || e.tz
      const start = row?.start || e.start
      const end = row?.end || e.end
      if (e.mode === 'daily' && tz && start) {
        const p = zonedParts(tz, now)
        const [sh, sm] = start.split(':').map(Number)
        const win = windowMinutes(start, end || start)
        const todayRun = zonedWallClockToUtc(tz, p.y, p.m, p.d, sh, sm) + jitterMinutes(id, `${p.y}-${p.m}-${p.d}`, win) * 60000
        if (todayRun > now) return false
        // 过窗跳过等次日：窗口终点（跨 midnight 时落到目标时区次日）之后不再补跑
        const [eh, em] = (end || start).split(':').map(Number)
        let endRun = zonedWallClockToUtc(tz, p.y, p.m, p.d, eh, em)
        if (endRun <= todayRun) endRun = zonedWallClockToUtc(tz, ...nextDayParts(p.y, p.m, p.d), eh, em)
        if (now > endRun) return false
        // 同一目标时区日只跑一次
        if (e.lastRunAt) {
          const lr = zonedParts(tz, new Date(e.lastRunAt).getTime())
          if (lr.y === p.y && lr.m === p.m && lr.d === p.d) return false
        }
        return true
      }
      return Boolean(e.at) && new Date(e.at).getTime() <= now
    })
    .map(([id]) => id)
}

// —— 固定时间模式：目标时区墙钟 ↔ UTC ↔ 北京预览（IANA 单一真值，DST 自适应，不写死小时差） ——

const zonedParts = (tz: string, ms: number) => {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  const p: Record<string, string> = {}
  for (const part of fmt.formatToParts(ms)) if (part.type !== 'literal') p[part.type] = part.value
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute) }
}

const nextDayParts = (y: number, m: number, d: number): [number, number, number] => {
  const nd = new Date(Date.UTC(y, m - 1, d) + 86400_000)
  return [nd.getUTCFullYear(), nd.getUTCMonth() + 1, nd.getUTCDate()]
}

// 目标时区墙钟 → UTC 瞬间：guess-offset 收敛两步，DST 切换日亦收敛
export const zonedWallClockToUtc = (tz: string, y: number, m: number, d: number, hh: number, mm: number): number => {
  const target = Date.UTC(y, m - 1, d, hh, mm)
  let guess = target
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(tz, guess)
    const offset = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - guess
    const next = target - offset
    if (next === guess) break
    guess = next
  }
  return guess
}

// 下一次每日执行瞬间（目标时区今日窗口起点已过则取明日）
export const nextDailyRunUtc = (tz: string, start: string, nowIso: string): number => {
  const now = new Date(nowIso).getTime()
  const p = zonedParts(tz, now)
  const [hh, mm] = start.split(':').map(Number)
  const today = zonedWallClockToUtc(tz, p.y, p.m, p.d, hh, mm)
  if (today > now) return today
  return zonedWallClockToUtc(tz, ...nextDayParts(p.y, p.m, p.d), hh, mm)
}

// 预览行：只以美国当地作息为准，北京按当日冬/夏自动换算；跨 midnight 标「次日」
export const scheduleBeijingText = (tz: string, start: string, end: string, nowIso: string): string => {
  const p = zonedParts(tz, new Date(nowIso).getTime())
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const sUtc = zonedWallClockToUtc(tz, p.y, p.m, p.d, sh, sm)
  let eUtc = zonedWallClockToUtc(tz, p.y, p.m, p.d, eh, em)
  if (eUtc <= sUtc) eUtc = zonedWallClockToUtc(tz, ...nextDayParts(p.y, p.m, p.d), eh, em)
  const bs = zonedParts('Asia/Shanghai', sUtc)
  const be = zonedParts('Asia/Shanghai', eUtc)
  const pad = (n: number) => String(n).padStart(2, '0')
  const dayOffset = (Date.UTC(bs.y, bs.m - 1, bs.d) - Date.UTC(p.y, p.m - 1, p.d)) / 86400_000
  const prefix = dayOffset === 1 ? '次日 ' : ''
  const endPrefix = (Date.UTC(be.y, be.m - 1, be.d) - Date.UTC(bs.y, bs.m - 1, bs.d)) / 86400_000 === 1 ? '次日 ' : ''
  return `${prefix}${pad(bs.h)}:${pad(bs.mi)}–${endPrefix}${pad(be.h)}:${pad(be.mi)}`
}

export const schedulePreviewText = (tz: string, start: string, end: string, nowIso: string): string => {
  const label = SCHEDULE_TZ_OPTIONS.find(o => o.tz === tz)?.label || tz
  return `${label} ${start}–${end} → 北京 ${scheduleBeijingText(tz, start, end, nowIso)}`
}

// 全店统一写回时间配置（保留各商品 enabled 与 once 的 at 兜底）
export const applyScheduleConfigToAll = (
  map: EbayScheduledPublishMap, ids: string[],
  cfg: { mode: 'once' | 'daily'; at?: string; tz?: string; start?: string; end?: string }, nowIso: string
): EbayScheduledPublishMap => {
  const next = { ...map }
  for (const id of ids) {
    const prev = next[id] || { enabled: false, at: '' }
    next[id] = {
      ...prev,
      mode: cfg.mode,
      at: cfg.mode === 'once' ? (cfg.at || prev.at || defaultScheduleAt(nowIso)) : prev.at,
      tz: cfg.tz, start: cfg.start, end: cfg.end,
      ...(cfg.mode === 'daily' ? { lastRunAt: '' } : {}),
    }
  }
  return next
}

// —— 固定时间三行批次计划：选取 + 目标时区 + 当地时间 + 北京时间预览 + 发布% ——

export type EbayScheduleBatchRow = { tz: string; start: string; end: string; ratio: number; selected: boolean }
export type EbaySchedulePlan = { rows: EbayScheduleBatchRow[]; custom?: { selected: boolean; minutes: number } }

export const DEFAULT_SCHEDULE_PLAN: EbaySchedulePlan = {
  rows: [
    { tz: 'America/New_York', start: '19:00', end: '21:00', ratio: 60, selected: true },
    { tz: 'America/Chicago', start: '18:00', end: '20:00', ratio: 10, selected: true },
    { tz: 'America/Los_Angeles', start: '18:00', end: '20:00', ratio: 30, selected: true },
  ],
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

export const normalizeSchedulePlan = (raw: unknown): EbaySchedulePlan => {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { rows?: unknown }).rows)) return { rows: DEFAULT_SCHEDULE_PLAN.rows.map(r => ({ ...r })) }
  const rows: EbayScheduleBatchRow[] = []
  for (const item of (raw as { rows: unknown[] }).rows) {
    if (!item || typeof item !== 'object') continue
    const r = item as Partial<EbayScheduleBatchRow>
    if (typeof r.tz !== 'string' || !SCHEDULE_TZ_OPTIONS.some(o => o.tz === r.tz)) continue
    rows.push({
      tz: r.tz,
      start: typeof r.start === 'string' && HHMM.test(r.start) ? r.start : '19:00',
      end: typeof r.end === 'string' && HHMM.test(r.end) ? r.end : '21:00',
      ratio: typeof r.ratio === 'number' && Number.isFinite(r.ratio) ? Math.max(0, Math.min(100, Math.round(r.ratio))) : 0,
      selected: Boolean(r.selected),
    })
  }
  const rawCustom = (raw as { custom?: unknown }).custom
  const custom = rawCustom && typeof rawCustom === 'object' ? { selected: Boolean((rawCustom as { selected?: unknown }).selected), minutes: Math.max(0, Math.round(Number((rawCustom as { minutes?: unknown }).minutes) || 0)) } : undefined
  if (!rows.length) return { rows: DEFAULT_SCHEDULE_PLAN.rows.map(r => ({ ...r })), ...(custom ? { custom } : {}) }
  return { rows, ...(custom ? { custom } : {}) }
}

// 校验：至少选一行；选中行比例和=100；选中行窗口起止合法。返回中文错误串或 null
export const validateSchedulePlan = (plan: EbaySchedulePlan): string | null => {
  if (plan.custom?.selected) {
    if (!Number.isFinite(plan.custom.minutes) || plan.custom.minutes <= 0) return '自行设置的发布分钟须大于 0'
    return null
  }
  const selected = plan.rows.filter(r => r.selected)
  if (!selected.length) return '请至少选取一个目标时区行'
  const sum = selected.reduce((s, r) => s + r.ratio, 0)
  if (sum !== 100) return `选中行的发布%合计须为 100（当前 ${sum}）`
  for (const r of selected) {
    if (!HHMM.test(r.start) || !HHMM.test(r.end)) return `${SCHEDULE_TZ_OPTIONS.find(o => o.tz === r.tz)?.label || r.tz} 的当地时间起止不完整`
  }
  return null
}

// 自行设置：now+分钟 的一次性发布时刻（UTC ISO）；双时区展示同一时刻。
export const customRunIso = (minutes: number, nowIso: string): string => new Date(new Date(nowIso).getTime() + minutes * 60000).toISOString()
export const zonedDisplay = (iso: string, tz: string): string => new Intl.DateTimeFormat('zh-CN', { timeZone: tz, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))

// 比例分配：当日待跑集合按选中行比例用最大余数法分批；ids 排序+行序固定 → 同日稳定
export const allocateBatches = (ids: string[], plan: EbaySchedulePlan, dayKey: string): Record<string, EbayScheduleBatchRow> => {
  void dayKey
  const selected = plan.rows.filter(r => r.selected)
  const out: Record<string, EbayScheduleBatchRow> = {}
  if (!selected.length || !ids.length) return out
  const sorted = [...ids].sort()
  const total = selected.reduce((s, r) => s + r.ratio, 0) || 100
  const quota = selected.map(r => (sorted.length * r.ratio) / total)
  const counts = quota.map(q => Math.floor(q))
  let left = sorted.length - counts.reduce((s, c) => s + c, 0)
  const order = quota.map((q, i) => ({ i, frac: q - Math.floor(q) })).sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const { i } of order) { if (left <= 0) break; counts[i] += 1; left -= 1 }
  let cursor = 0
  selected.forEach((r, i) => {
    for (let k = 0; k < counts[i]; k++) out[sorted[cursor++]] = r
  })
  return out
}