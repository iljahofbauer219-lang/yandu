/**
 * AI 服务商真实 HTTP 调用层：移植自 Electron 主进程服务
 * （BailianImageService / VolcImageService / OpenAIImageService / BailianTranslationService /
 *   DeepSeekCommandService / ArkVideoService 的网络部分）。
 * 密钥只从服务端 config 读取，绝不下发客户端；base URL 均可通过 env 覆盖（便于部署网关与验收 mock）。
 */
import { config } from '../../config.js'
import { httpError } from '../../lib/errors.js'
import type { AiImageModelProfile, AiProviderId } from './catalog.js'
import { TRANSLATE_MODEL } from './catalog.js'

const REQUEST_TIMEOUT_MS = 120_000

export interface AiImageGenerateInput {
  model: string
  prompt: string
  promptExtend?: boolean
  referenceImageUrls?: string[]
  size: '1K' | '2K'
  count: number
}

export interface AiImageGenerateOutput {
  provider: AiProviderId
  model: string
  taskId: string
  imageUrls: string[]
}

const NEGATIVE_PROMPT = 'Do not change the referenced product identity, structure, proportions, color, material, included accessories, packaging, logo, text, measurement labels, or verified facts. No watermark, promotional badge, border, invented parts, invented claims, distorted geometry, or AI artifacts.'

function ensureKey(key: string, label: string): void {
  if (!key) throw httpError(503, 'AI_NOT_CONFIGURED', `服务端未配置${label}，请联系管理员`)
}

function dedupReferences(urls: string[] | undefined, limit: number): string[] {
  const all = (urls ?? []).filter(url => Boolean(url) && /^https?:\/\//i.test(url))
  return [...new Set(all)].slice(0, limit)
}

// ---------------------------------------------------------------- 百炼生图

/** 从 choices 结构中提取图片 URL（多模态同步响应） */
function extractImageUrls(choices: unknown): string[] {
  if (!Array.isArray(choices)) return []
  const urls: string[] = []
  for (const choice of choices) {
    const msg = (choice as Record<string, unknown>)?.message as Record<string, unknown> | undefined
    if (!msg) continue
    const content = msg.content
    if (Array.isArray(content)) {
      for (const item of content) {
        const img = (item as Record<string, unknown>)?.image
        if (typeof img === 'string' && /^https?:\/\//i.test(img)) urls.push(img)
      }
    }
    if (typeof content === 'string' && /^https?:\/\//i.test(content)) urls.push(content)
  }
  return urls
}

/** 从 results 结构中提取图片 URL（异步任务响应） */
function extractResultUrls(results: unknown): string[] {
  if (!Array.isArray(results)) return []
  return results
    .map(r => (r as Record<string, unknown>)?.url)
    .filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))
}

async function pollBailianTask(host: string, taskId: string, apiKey: string): Promise<string[]> {
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  const pollUrl = `${host}/api/v1/tasks/${taskId}`
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const resp = await fetch(pollUrl, { headers })
    if (!resp.ok) continue
    const data = await resp.json() as { output?: Record<string, unknown> }
    const output = data.output || {}
    const status = (output.task_status as string) || ''
    if (status === 'FAILED') {
      throw httpError(502, 'AI_PROVIDER_ERROR', `生图失败：${(output.message as string) || '未知错误'}`)
    }
    if (status === 'SUCCEEDED' || status === 'SUCCESS') {
      const urls = [...extractImageUrls(output.choices), ...extractResultUrls(output.results)]
      if (urls.length > 0) return urls
    }
  }
  throw httpError(504, 'AI_PROVIDER_TIMEOUT', '生图等待超时')
}

function bailianHost(): string {
  return config.bailianBaseUrl.replace(/\/compatible-mode\/v1\/?$/, '').replace(/\/+$/, '')
}

function bailianSize(size: string): string {
  if (size === '2K') return '2048*2048'
  if (/^\d+\*\d+$/.test(size)) return size
  return '1024*1024'
}

async function bailianGenerate(profile: AiImageModelProfile, input: AiImageGenerateInput): Promise<AiImageGenerateOutput> {
  ensureKey(config.bailianApiKey, '百炼 API Key（BAILIAN_API_KEY）')
  const host = bailianHost()
  const isQwenImage = input.model.startsWith('qwen-image')
  const isWan = input.model.startsWith('wan2.7')
  const isZImage = input.model === 'z-image-turbo'
  // 多模态生成（同步返回图片）：qwen-image*, z-image-turbo；图片生成（异步 task_id）：wan2.7*
  const isMultimodal = isQwenImage || isZImage
  const endpoint = isMultimodal
    ? `${host}/api/v1/services/aigc/multimodal-generation/generation`
    : `${host}/api/v1/services/aigc/image-generation/generation`

  const resolvedSize = bailianSize(input.size)
  const count = Math.max(1, Math.min(isQwenImage ? 6 : 4, input.count))
  // maxReferenceImages 为 0 表示纯文生图模型，不传任何参照图字段
  const referenceLimit = profile.maxReferenceImages
  const references = referenceLimit > 0 ? dedupReferences(input.referenceImageUrls, referenceLimit) : []

  const content: Array<Record<string, unknown>> = []
  if (referenceLimit > 0 && (isQwenImage || isWan) && references.length > 0) {
    for (const url of references) content.push({ image: url })
  }
  content.push({ text: input.prompt })

  const parameters: Record<string, unknown> = { size: resolvedSize, n: count, watermark: false }
  if (!isZImage) {
    parameters.prompt_extend = input.promptExtend ?? true
    parameters.negative_prompt = NEGATIVE_PROMPT
  }

  const baseHeaders = { Authorization: `Bearer ${config.bailianApiKey}`, 'Content-Type': 'application/json' }
  const bodyPayload = { model: input.model, input: { messages: [{ role: 'user', content }] }, parameters }

  if (isMultimodal) {
    const response = await fetch(endpoint, {
      method: 'POST', headers: baseHeaders, body: JSON.stringify(bodyPayload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    const result = await response.json().catch(() => ({})) as Record<string, unknown>
    const output = result?.output as Record<string, unknown> | undefined
    const imageUrls = extractImageUrls(output?.choices)
    if (!response.ok || imageUrls.length === 0) {
      const detail = (result.message as string) || (result.code as string) || '接口没有返回图片'
      throw httpError(502, 'AI_PROVIDER_ERROR', `${input.model} 生图失败（HTTP ${response.status}）：${detail}`)
    }
    return { provider: 'bailian', model: input.model, taskId: `sync-${Date.now()}`, imageUrls }
  }

  // Wan 生图：先异步（轮询），失败回退同步
  const asyncResp = await fetch(endpoint, {
    method: 'POST',
    headers: { ...baseHeaders, 'X-DashScope-Async': 'enable' },
    body: JSON.stringify(bodyPayload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  if (asyncResp.ok) {
    const asyncData = await asyncResp.json().catch(() => ({})) as Record<string, unknown>
    const output = asyncData?.output as Record<string, unknown> | undefined
    const taskId = output?.task_id as string | undefined
    if (taskId) {
      const imageUrls = await pollBailianTask(host, taskId, config.bailianApiKey)
      return { provider: 'bailian', model: input.model, taskId, imageUrls }
    }
  }

  const syncResp = await fetch(endpoint, {
    method: 'POST', headers: baseHeaders, body: JSON.stringify(bodyPayload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  const syncData = await syncResp.json().catch(() => ({})) as Record<string, unknown>
  if (!syncResp.ok) {
    const detail = (syncData.message as string) || (syncData.code as string) || syncResp.statusText
    throw httpError(502, 'AI_PROVIDER_ERROR', `${input.model} 生图失败（HTTP ${syncResp.status}）：${detail}`)
  }
  const output = syncData?.output as Record<string, unknown> | undefined
  const urls = [...extractImageUrls(output?.choices), ...extractResultUrls(output?.results)]
  if (urls.length > 0) return { provider: 'bailian', model: input.model, taskId: `sync-${Date.now()}`, imageUrls: urls }
  const syncTaskId = output?.task_id as string | undefined
  if (syncTaskId) {
    const imageUrls = await pollBailianTask(host, syncTaskId, config.bailianApiKey)
    return { provider: 'bailian', model: input.model, taskId: syncTaskId, imageUrls }
  }
  throw httpError(502, 'AI_PROVIDER_ERROR', `${input.model} 生图失败：API 未返回图片结果`)
}

// ---------------------------------------------------------------- 火山 Seedream 生图

function volcSize(size: string): string {
  if (size === '2K') return '2048x2048'
  if (/^\d+x\d+$/.test(size)) return size
  return '1024x1024'
}

async function volcGenerate(profile: AiImageModelProfile, input: AiImageGenerateInput): Promise<AiImageGenerateOutput> {
  ensureKey(config.arkApiKey, '火山方舟 ARK_API_KEY')
  const endpoint = `${config.arkBaseUrl.replace(/\/+$/, '')}/images/generations`
  const references = profile.maxReferenceImages > 0 ? dedupReferences(input.referenceImageUrls, profile.maxReferenceImages) : []
  const body: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt,
    size: volcSize(input.size),
    n: Math.max(1, Math.min(4, input.count)),
    response_format: 'url',
    watermark: false
  }
  if (references.length > 0) body.image = references

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.arkApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  const payload = await response.json().catch(() => ({})) as {
    data?: Array<{ url?: string }>
    error?: { message?: string; code?: string }
    message?: string
  }
  if (!response.ok) {
    const detail = payload.error?.message || payload.message || payload.error?.code || response.statusText
    throw httpError(502, 'AI_PROVIDER_ERROR', `${input.model} 生图失败（HTTP ${response.status}）：${detail}`)
  }
  const imageUrls = (payload.data || [])
    .map(item => item?.url)
    .filter((url): url is string => typeof url === 'string' && /^https?:\/\//i.test(url))
  if (imageUrls.length === 0) throw httpError(502, 'AI_PROVIDER_ERROR', `${input.model} 生图失败：API 未返回图片结果`)
  return { provider: 'volc', model: input.model, taskId: `volc-${Date.now()}`, imageUrls }
}

// ---------------------------------------------------------------- OpenAI 生图

function openaiSize(size: string): string {
  if (size === '2K') return '1536x1024'
  if (/^\d+x\d+$/.test(size)) return size
  return '1024x1024'
}

async function openaiGenerate(_profile: AiImageModelProfile, input: AiImageGenerateInput): Promise<AiImageGenerateOutput> {
  ensureKey(config.openaiImageApiKey, 'OPENAI_IMAGE_API_KEY')
  const endpoint = `${config.openaiImageBaseUrl.replace(/\/+$/, '')}/images/generations`
  const body = {
    model: input.model,
    prompt: input.prompt,
    n: Math.max(1, Math.min(4, input.count)),
    size: openaiSize(input.size)
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openaiImageApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  const payload = await response.json().catch(() => ({})) as {
    data?: Array<{ url?: string; b64_json?: string }>
    error?: { message?: string; code?: string }
  }
  if (!response.ok) {
    const detail = payload.error?.message || payload.error?.code || response.statusText
    throw httpError(502, 'AI_PROVIDER_ERROR', `${input.model} 生图失败（HTTP ${response.status}）：${detail}`)
  }
  const imageUrls = (payload.data || [])
    .map(item => item?.url || (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : ''))
    .filter(url => Boolean(url))
  if (imageUrls.length === 0) throw httpError(502, 'AI_PROVIDER_ERROR', `${input.model} 生图失败：API 未返回图片结果`)
  return { provider: 'openai', model: input.model, taskId: `openai-${Date.now()}`, imageUrls }
}

/** 生图统一入口：按模型目录分发到对应服务商 */
export async function generateImage(profile: AiImageModelProfile, input: AiImageGenerateInput): Promise<AiImageGenerateOutput> {
  switch (profile.provider) {
    case 'bailian': return bailianGenerate(profile, input)
    case 'volc': return volcGenerate(profile, input)
    case 'openai': return openaiGenerate(profile, input)
    case 'linduo': return linduoGenerate(profile, input)
  }
}

// ---------------------------------------------------------------- 零度API（api000.com）生图

function linduoSize(size: string): string {
  if (size === '2K') return '1024x1024'
  if (size === '1K') return '1024x1024'
  if (/^\d+x\d+$/.test(size)) return size
  return '1024x1024'
}

async function linduoGenerate(profile: AiImageModelProfile, input: AiImageGenerateInput): Promise<AiImageGenerateOutput> {
  ensureKey(config.linduoApiKey, '零度API LINDUO_API_KEY')
  const endpoint = `${(config.linduoBaseUrl || 'https://api000.com/v1').replace(/\/+$/, '')}/images/generations`
  const referenceLimit = profile.maxReferenceImages
  const references = referenceLimit > 0 ? dedupReferences(input.referenceImageUrls, referenceLimit) : []
  const body: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt,
    size: linduoSize(input.size),
    n: Math.max(1, Math.min(4, input.count)),
    response_format: 'url'
  }
  // 零度API 的 OpenAI 兼容层：参照图通过 image 字段（数组）传入，与火山方舟语义一致
  if (references.length > 0) body.image = references

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.linduoApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  const payload = await response.json().catch(() => ({})) as {
    data?: Array<{ url?: string; b64_json?: string }>
    error?: { message?: string; code?: string }
    message?: string
  }
  if (!response.ok) {
    const detail = payload.error?.message || payload.message || payload.error?.code || response.statusText
    throw httpError(502, 'AI_PROVIDER_ERROR', `${input.model} 零度API 生图失败（HTTP ${response.status}）：${detail}`)
  }
  const imageUrls = (payload.data || [])
    .map(item => item?.url || (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : ''))
    .filter(url => Boolean(url))
  if (imageUrls.length === 0) throw httpError(502, 'AI_PROVIDER_ERROR', `${input.model} 零度API 生图失败：API 未返回图片结果`)
  return { provider: 'linduo', model: input.model, taskId: `linduo-${Date.now()}`, imageUrls }
}

/** 百炼模型列表探测（/models 过滤可用生图模型；与原版 connection() 行为一致） */
export async function bailianAvailableModelIds(): Promise<Set<string> | null> {
  if (!config.bailianApiKey) return null
  try {
    const response = await fetch(`${config.bailianBaseUrl.replace(/\/+$/, '')}/models`, {
      headers: { Authorization: `Bearer ${config.bailianApiKey}` },
      signal: AbortSignal.timeout(20_000)
    })
    if (!response.ok) return null
    const payload = await response.json().catch(() => ({})) as { data?: Array<{ id?: unknown }> }
    if (!Array.isArray(payload.data)) return null
    return new Set(payload.data.map(item => (typeof item.id === 'string' ? item.id : '')).filter(Boolean))
  } catch {
    return null
  }
}

/** 零度API 模型列表探测（/v1/models）：用于服务端的 /api/ai/models 聚合返回 */
export async function linduoAvailableModelIds(): Promise<Set<string> | null> {
  if (!config.linduoApiKey) return null
  try {
    const response = await fetch(`${(config.linduoBaseUrl || 'https://api000.com/v1').replace(/\/+$/, '')}/models`, {
      headers: { Authorization: `Bearer ${config.linduoApiKey}` },
      signal: AbortSignal.timeout(10_000)
    })
    if (!response.ok) return null
    const payload = await response.json().catch(() => ({})) as { data?: Array<{ id?: unknown }> }
    if (!Array.isArray(payload.data)) return null
    return new Set(payload.data.map(item => (typeof item.id === 'string' ? item.id : '')).filter(Boolean))
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- 百炼翻译

const TRANSLATE_BATCH_SIZE = 8
const TRANSLATE_MIN_INTERVAL_MS = 1_100
const TRANSLATE_RETRY_DELAYS_MS = [2_000, 5_000, 10_000]

const translationCache = new Map<string, string>()
let translationQueue: Promise<void> = Promise.resolve()
let lastTranslationStartedAt = 0

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

interface TranslationPayload {
  choices?: { message?: { content?: string } }[]
  error?: { message?: string }
  message?: string
}

async function requestTranslationWithRetry(text: string): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    const waitForRateSlot = Math.max(0, lastTranslationStartedAt + TRANSLATE_MIN_INTERVAL_MS - Date.now())
    if (waitForRateSlot) await delay(waitForRateSlot)
    lastTranslationStartedAt = Date.now()

    const response = await fetch(`${config.bailianBaseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.bailianApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: TRANSLATE_MODEL,
        messages: [{ role: 'user', content: text }],
        translation_options: {
          source_lang: 'auto',
          target_lang: 'Chinese',
          domains: '跨境电商商品页面。保留品牌名、型号、SKU、货币符号、产品编号、平台专有名称以及所有 translate_N XML 标签。'
        }
      }),
      signal: AbortSignal.timeout(60_000)
    })
    const payload = await response.json().catch(() => ({})) as TranslationPayload
    if (response.ok) return payload.choices?.[0]?.message?.content?.trim() || text

    const message = payload.error?.message || payload.message || `HTTP ${response.status}`
    const rateLimited = response.status === 429 || /rate limit|too many requests|request rate/i.test(message)
    if (rateLimited && attempt < TRANSLATE_RETRY_DELAYS_MS.length) {
      await delay(TRANSLATE_RETRY_DELAYS_MS[attempt] ?? 10_000)
      continue
    }
    if (rateLimited) throw httpError(502, 'AI_PROVIDER_ERROR', '翻译服务请求过于频繁，百炼正在限流，请稍后再试')
    if (/quota|billing|balance/i.test(message)) throw httpError(502, 'AI_PROVIDER_ERROR', '百炼翻译额度不足，请检查模型额度或账户余额')
    throw httpError(502, 'AI_PROVIDER_ERROR', `翻译失败：${message}`)
  }
}

function requestTranslation(text: string): Promise<string> {
  const scheduled = translationQueue.then(() => requestTranslationWithRetry(text))
  translationQueue = scheduled.then(() => undefined, () => undefined)
  return scheduled
}

async function translateBatch(texts: string[]): Promise<string[]> {
  if (texts.length === 1) return [await requestTranslation(texts[0] as string)]
  const source = texts.map((text, index) => `<translate_${index}>${text}</translate_${index}>`).join('\n')
  const combined = await requestTranslation(source)
  const translated = new Map<number, string>()
  const pattern = /<translate_(\d+)>\s*([\s\S]*?)\s*<\/translate_\1>/gi
  for (const match of combined.matchAll(pattern)) translated.set(Number(match[1]), match[2]?.trim() ?? '')
  if (translated.size === texts.length) return texts.map((text, index) => translated.get(index) || text)
  // 部分模型响应可能没有保留分段标签；串行回退避免错配
  const fallback: string[] = []
  for (const text of texts) fallback.push(await requestTranslation(text))
  return fallback
}

export interface AiTranslateOutput {
  model: string
  translations: Record<string, string>
  /** 实际参与计费的文本条数（去重后） */
  units: number
}

export async function translateTexts(texts: string[]): Promise<AiTranslateOutput> {
  ensureKey(config.bailianApiKey, '百炼 API Key（BAILIAN_API_KEY）')
  const unique = [...new Set(texts.map(text => text.trim()).filter(Boolean))]
  const result = new Map<string, string>()
  const pending = unique.filter(text => {
    const cached = translationCache.get(text)
    if (cached) result.set(text, cached)
    return !cached
  })
  for (let offset = 0; offset < pending.length; offset += TRANSLATE_BATCH_SIZE) {
    const batch = pending.slice(offset, offset + TRANSLATE_BATCH_SIZE)
    const translated = await translateBatch(batch)
    batch.forEach((source, index) => {
      const target = translated[index] ?? source
      translationCache.set(source, target)
      result.set(source, target)
    })
  }
  return { model: TRANSLATE_MODEL, translations: Object.fromEntries(result), units: unique.length }
}

// ---------------------------------------------------------------- 通用 chat 代理（复合 AI 工作流：grounding / 视觉检查 / 标题优化等）

export type AiChatProvider = 'bailian' | 'deepseek'

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<Record<string, unknown>>
}

export interface AiChatInput {
  provider: AiChatProvider
  model?: string
  messages: AiChatMessage[]
  temperature?: number
  maxTokens?: number
  responseFormat?: 'json_object' | 'text'
  thinkingDisabled?: boolean
}

export interface AiChatOutput {
  provider: AiChatProvider
  model: string
  content: string
}

/** 模型白名单：防止客户端任意指定高成本模型；bailian 默认走视觉模型（grounding/检查/评审共用） */
function resolveChatModel(provider: AiChatProvider, requested: string | undefined): string {
  if (provider === 'bailian') {
    const allowed = new Set(['qwen3.6-flash', 'qwen-mt-flash', config.bailianVisionModel].filter(Boolean))
    const model = requested?.trim() || config.bailianVisionModel
    if (!allowed.has(model)) throw httpError(400, 'UNKNOWN_MODEL', `不允许的百炼 chat 模型：${model}`)
    return model
  }
  const model = requested?.trim() || config.deepseekModel
  if (model !== config.deepseekModel) throw httpError(400, 'UNKNOWN_MODEL', `不允许的 DeepSeek chat 模型：${model}`)
  return model
}

function chatContentToString(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(item => {
        const text = (item as Record<string, unknown>)?.text
        return typeof text === 'string' ? text : ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

/** 通用 chat completions 代理：prompt 编排留在客户端，密钥/配额/审计在服务端 */
export async function chatCompletion(input: AiChatInput): Promise<AiChatOutput> {
  const model = resolveChatModel(input.provider, input.model)
  const isBailian = input.provider === 'bailian'
  const apiKey = isBailian ? config.bailianApiKey : config.deepseekApiKey
  ensureKey(apiKey, isBailian ? '百炼 API Key（BAILIAN_API_KEY）' : 'DEEPSEEK_API_KEY')
  const baseUrl = (isBailian ? config.bailianBaseUrl : config.deepseekBaseUrl).replace(/\/+$/, '')
  const body: Record<string, unknown> = {
    model,
    messages: input.messages,
    temperature: input.temperature ?? 0.2,
    max_tokens: Math.max(1, Math.min(8192, input.maxTokens ?? 2000))
  }
  if (input.responseFormat === 'json_object') body.response_format = { type: 'json_object' }
  if (input.thinkingDisabled) body.thinking = { type: 'disabled' }
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  const payload = await response.json().catch(() => ({})) as {
    choices?: Array<{ message?: { content?: unknown } }>
    error?: { message?: string }
    message?: string
  }
  if (!response.ok) {
    const detail = payload.error?.message || payload.message || `HTTP ${response.status}`
    throw httpError(502, 'AI_PROVIDER_ERROR', `chat 调用失败：${detail}`)
  }
  const content = chatContentToString(payload.choices?.[0]?.message?.content)
  if (!content.trim()) throw httpError(502, 'AI_PROVIDER_ERROR', 'chat 模型未返回有效内容')
  return { provider: input.provider, model, content }
}

// ---------------------------------------------------------------- DeepSeek 指令解析

export type AiCommand =
  | { action: 'collect'; platform: 'OZON' | '1688'; keyword: string; maxProducts: number }
  | { action: 'status' }
  | { action: 'help' }
  | { action: 'unknown'; clarification: string }

const COMMAND_SYSTEM_PROMPT = `你是跨境电商任务指令解析器。将用户的中英文自然语言转换为 JSON，不要执行任务。
只允许以下 action：collect、status、help、unknown。
可用采集平台只有 OZON 和 1688。用户说“俄罗斯平台”、“欧众”或“Ozon”都映射为 OZON；阿里巴巴批发、国内货源可在明确语境下映射为 1688。
采集数量未说时默认 50；OZON 限制 1-500，1688 限制 1-300。
不要猜测未说的平台或商品关键词；缺失时返回 unknown 并用 clarification 提一个简短问题。
输出 JSON 格式示例：
{"action":"collect","platform":"OZON","keyword":"家用电器","maxProducts":100}
{"action":"status"}
{"action":"help"}
{"action":"unknown","clarification":"请告诉我要从 Ozon 还是 1688 采集。"}`

function validateCommand(value: Record<string, unknown>): AiCommand {
  if (value.action === 'status' || value.action === 'help') return { action: value.action }
  if (value.action === 'collect') {
    const platform = value.platform === 'OZON' || value.platform === '1688' ? value.platform : null
    const keyword = typeof value.keyword === 'string' ? value.keyword.normalize('NFKC').trim().slice(0, 120) : ''
    if (!platform || !keyword) return { action: 'unknown', clarification: '请告诉我采集平台（Ozon 或 1688）和商品关键词。' }
    const requested = Number(value.maxProducts)
    const maximum = platform === 'OZON' ? 500 : 300
    const maxProducts = Math.max(1, Math.min(Number.isFinite(requested) ? Math.round(requested) : 50, maximum))
    return { action: 'collect', platform, keyword, maxProducts }
  }
  const clarification = typeof value.clarification === 'string' && value.clarification.trim()
    ? value.clarification.trim().slice(0, 200)
    : '请告诉我要从 Ozon 还是 1688 采集、商品关键词和数量。'
  return { action: 'unknown', clarification }
}

export async function understandCommand(text: string): Promise<{ model: string; command: AiCommand }> {
  ensureKey(config.deepseekApiKey, 'DEEPSEEK_API_KEY')
  const response = await fetch(`${config.deepseekBaseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.deepseekApiKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      model: config.deepseekModel,
      temperature: 0,
      max_tokens: 220,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: COMMAND_SYSTEM_PROMPT },
        { role: 'user', content: text }
      ]
    })
  })
  const payload = await response.json().catch(() => ({})) as {
    choices?: Array<{ message?: { content?: string | null } }>
    error?: { message?: string }
  }
  if (!response.ok) {
    throw httpError(502, 'AI_PROVIDER_ERROR', payload.error?.message || `DeepSeek 请求失败：${response.status}`)
  }
  const content = payload.choices?.[0]?.message?.content
  if (!content) throw httpError(502, 'AI_PROVIDER_ERROR', 'DeepSeek 未返回指令解析结果')
  try {
    return { model: config.deepseekModel, command: validateCommand(JSON.parse(content) as Record<string, unknown>) }
  } catch {
    throw httpError(502, 'AI_PROVIDER_ERROR', 'DeepSeek 返回的指令解析结果不是有效 JSON')
  }
}

// ---------------------------------------------------------------- 方舟视频

function arkVideoUrlOf(payload: unknown): string {
  const value = payload as Record<string, unknown>
  const content = value.content as Record<string, unknown> | undefined
  const result = value.result as Record<string, unknown> | undefined
  const candidates = [
    content?.video_url,
    (content?.video as Record<string, unknown> | undefined)?.url,
    result?.video_url,
    (result?.video as Record<string, unknown> | undefined)?.url,
    value.video_url,
    value.url
  ]
  return (candidates.find(item => typeof item === 'string' && (item as string).startsWith('http')) as string) || ''
}

function arkTaskStatus(payload: unknown): string {
  return String((payload as Record<string, unknown>).status || (payload as Record<string, unknown>).state || '').toLowerCase()
}

function arkTaskError(payload: unknown): string {
  const value = payload as Record<string, unknown>
  const error = value.error as Record<string, unknown> | string | undefined
  if (typeof error === 'string') return error
  return String(error?.message || value.message || '方舟视频任务生成失败')
}

export interface AiVideoTaskSubmitInput {
  prompt: string
  /** 参照图：公网可访问 http(s) URL 或 data: URL，原样透传方舟 */
  imageUrls?: string[]
  model?: string
}

export interface AiVideoTaskSubmitOutput {
  provider: 'ark'
  model: string
  taskId: string
}

export async function createVideoTask(input: AiVideoTaskSubmitInput): Promise<AiVideoTaskSubmitOutput> {
  ensureKey(config.arkApiKey, '火山方舟 ARK_API_KEY')
  const model = input.model?.trim() || config.arkVideoModel
  if (!model) throw httpError(503, 'AI_NOT_CONFIGURED', '服务端未配置方舟视频模型（ARK_VIDEO_MODEL），请联系管理员')
  const imageContent = (input.imageUrls ?? [])
    .filter(url => /^(https?:|data:)/i.test(url))
    .slice(0, 10)
    .map(url => ({ type: 'image_url', image_url: { url } }))
  const response = await fetch(`${config.arkBaseUrl.replace(/\/+$/, '')}/contents/generations/tasks`, {
    method: 'POST',
    signal: AbortSignal.timeout(60_000),
    headers: { Authorization: `Bearer ${config.arkApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, content: [{ type: 'text', text: input.prompt }, ...imageContent] })
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw httpError(502, 'AI_PROVIDER_ERROR', `方舟任务提交失败（HTTP ${response.status}）：${arkTaskError(payload)}`)
  const taskId = String((payload as Record<string, unknown>).id || (payload as Record<string, unknown>).task_id || '')
  if (!taskId) throw httpError(502, 'AI_PROVIDER_ERROR', '方舟任务未返回任务ID')
  return { provider: 'ark', model, taskId }
}

export interface AiVideoTaskStatus {
  taskId: string
  /** queued | running | succeeded | failed */
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  videoUrl?: string
  error?: string
}

export async function getVideoTask(taskId: string): Promise<AiVideoTaskStatus> {
  ensureKey(config.arkApiKey, '火山方舟 ARK_API_KEY')
  const response = await fetch(`${config.arkBaseUrl.replace(/\/+$/, '')}/contents/generations/tasks/${encodeURIComponent(taskId)}`, {
    signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${config.arkApiKey}` }
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw httpError(502, 'AI_PROVIDER_ERROR', `方舟任务查询失败（HTTP ${response.status}）：${arkTaskError(payload)}`)
  const rawStatus = arkTaskStatus(payload)
  const videoUrl = arkVideoUrlOf(payload)
  if (videoUrl) return { taskId, status: 'succeeded', videoUrl }
  if (['failed', 'error', 'cancelled', 'canceled', 'expired'].includes(rawStatus)) {
    return { taskId, status: 'failed', error: arkTaskError(payload) }
  }
  if (['succeeded', 'success', 'done'].includes(rawStatus)) {
    return { taskId, status: 'succeeded', videoUrl: videoUrl || undefined }
  }
  return { taskId, status: rawStatus === 'queued' || rawStatus === 'pending' ? 'queued' : 'running' }
}
