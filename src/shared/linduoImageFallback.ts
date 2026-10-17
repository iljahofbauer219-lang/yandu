/** 零度API（api000）生图失败处置：瞬时性判定、全链降级顺序、无通道缓存、红条中文化 */

export interface LinduoImageModelCapability {
  id: string
  name: string
  maxReferenceImages: number
}

/** 错误文案携带该标记即「零度整链无通道」，渲染器据此自动跨厂商恢复而不是弹红条 */
export const LINDUO_NO_CHANNEL_MARKER = '[[LINDUO_NO_CHANNEL]]'
/** 进程级无通道缓存 TTL：同批分镜卡不重复探测已确认无库存的模型 */
export const LINDUO_NO_CHANNEL_CACHE_TTL_MS = 10 * 60 * 1000

const TRANSIENT_STATUS = new Set([500, 502, 503, 429])
const TRANSIENT_PATTERNS = [/no available channel/i, /timeout/i, /overloaded/i, /rate limit/i, /too many requests/i, /响应读取中断/, /超时/]
const NO_CHANNEL_TEXT_PATTERNS = [/no available channel/i, /零度API 当前没有可用生图通道/, /零度API 生图模型均无可用通道/, /零度API 当前无可用生图通道/]
/** 上游确定性拦截（内容安全/背诵/超出长度）：重试与换模型都无意义 */
const DETERMINISTIC_BLOCK_PATTERNS = [/SAFETY/i, /PROHIBITED/i, /BLOCKLIST/i, /RECITATION/i, /MAX_TOKENS/i]

/**
 * 零度 Banana 通道偶发把带参照的请求交给纯文本模型：HTTP 200、finishReason STOP，只有中文拒绝文案没有图片
 * （实测同一请求重试 5/5 通过，故按瞬时处理）。内容安全等确定性拦截除外。
 */
export function isLinduoTextOnlyRefusal(status: number, detail: string): boolean {
  if (status !== 200 || !/未返回图片结果/.test(detail || '')) return false
  return !DETERMINISTIC_BLOCK_PATTERNS.some(pattern => pattern.test(detail || ''))
}

/** 瞬时性错误（分销通道轮换/过载）：请求体不变可幂等重试 */
export function isTransientLinduoFailure(status: number, detail: string): boolean {
  if (TRANSIENT_STATUS.has(status)) return true
  if (isLinduoTextOnlyRefusal(status, detail)) return true
  return TRANSIENT_PATTERNS.some(pattern => pattern.test(detail || ''))
}

/**
 * 上游分销组无通道，或该模型被零度临时下架维修（实测 HTTP 400「该模型修复中」）：
 * 同模型重发无意义，重试耗尽后应走同厂商降级。
 */
export function isNoChannelFailure(status: number, detail: string): boolean {
  return status === 503 || /no available channel/i.test(detail || '') || /该模型修复中|模型正在修复|under repair/i.test(detail || '')
}

/** 判定一条（可能已被 IPC 包装或已中文化的）错误文本是否为零度无通道 */
export function isLinduoNoChannelError(raw: string): boolean {
  const text = String(raw || '')
  if (text.includes(LINDUO_NO_CHANNEL_MARKER)) return true
  return NO_CHANNEL_TEXT_PATTERNS.some(pattern => pattern.test(text))
}

/**
 * 零度链内完整降级顺序：先保留参照能力的候选（按与原档位就近），再按参照能力从多到少兜底。
 * 参照需求无法满足时也遍历到底——宁可少传参照出图，也不给使用者留红条。
 */
export function listLinduoFallbackChain(models: LinduoImageModelCapability[], currentId: string, needReferences: number): string[] {
  const currentRefs = models.find(item => item.id === currentId)?.maxReferenceImages ?? 0
  const others = models.filter(item => item.id !== currentId)
  const preferred = others
    .filter(item => item.maxReferenceImages >= needReferences)
    .sort((a, b) => Math.abs(a.maxReferenceImages - currentRefs) - Math.abs(b.maxReferenceImages - currentRefs))
  const bestEffort = others
    .filter(item => item.maxReferenceImages < needReferences)
    .sort((a, b) => b.maxReferenceImages - a.maxReferenceImages)
  return [...preferred, ...bestEffort].map(item => item.id)
}

/** 零度整链无通道的中文说明（带标记前缀，渲染器识别后自动改用其他厂商） */
export function linduoNoChannelErrorMessage(attempted: string[], skipped: string[]): string {
  const parts = ['零度API 生图模型均无可用通道：上游分销组暂时无库存']
  if (attempted.length) parts.push(`已逐个自动重试仍失败（${attempted.join('、')}）`)
  if (skipped.length) parts.push(`其中 ${skipped.join('、')} 10 分钟内已确认无通道，本次跳过探测`)
  return `${LINDUO_NO_CHANNEL_MARKER}${parts.join('；')}。`
}

/** 进程内无通道缓存：markDead 后 TTL 内判死，超时后自动放行重探 */
export function createLinduoNoChannelCache(ttlMs: number = LINDUO_NO_CHANNEL_CACHE_TTL_MS, now: () => number = () => Date.now()) {
  const deadAt = new Map<string, number>()
  const isDead = (modelId: string): boolean => {
    const markedAt = deadAt.get(modelId)
    if (markedAt === undefined) return false
    if (now() - markedAt >= ttlMs) {
      deadAt.delete(modelId)
      return false
    }
    return true
  }
  return {
    isDead,
    markDead: (modelId: string) => { deadAt.set(modelId, now()) },
    deadIds: () => [...deadAt.keys()].filter(id => isDead(id))
  }
}

export type LinduoNoChannelCache = ReturnType<typeof createLinduoNoChannelCache>

/** 红条中文化：剥离 IPC 前缀；无通道语义转中文全文；request id 截断展示 */
export function humanizeLinduoImageError(raw: string): string {
  let text = String(raw || '').trim()
  text = text.replace(LINDUO_NO_CHANNEL_MARKER, '')
  text = text.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '')
  text = text.trim()
  if (!text) return '生图失败：上游未返回错误详情，请重试或更换生图模型。'
  const requestId = (text.match(/request id:\s*([A-Za-z0-9-]+)/i) || [])[1] || ''
  const suffix = requestId ? `（request id: ${requestId.slice(0, 12)}…）` : ''
  if (/no available channel/i.test(text)) {
    const model = (text.match(/^(\S+)\s+零度API/) || [])[1] || ''
    return `零度API 当前没有可用生图通道${model ? `（${model}）` : ''}：上游分销组暂时无库存，已自动重试仍失败；请稍后重试，或改用其他生图模型完成本次生成。${suffix}`
  }
  if (/零度API/.test(text)) return `${text}${suffix && /request id/i.test(text) ? '' : suffix}`
  return `生图失败：${text}${suffix}`
}
