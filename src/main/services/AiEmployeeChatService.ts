/**
 * AI员工对话服务：附件上传（图片/文档）+ 大模型选择路由。
 * - 选品 / Listing / 守卫：统一走 MaxKB 5 application（maxkbChat 直连）
 * - 直连模型（百炼 / DeepSeek）：OpenAI 兼容 chat/completions，失败或缺 key 时回退 MaxKB
 * - 30 天回退（2026-09-23 停服）：RAGFlow 智能体链路仍保留为 ragflow-agent / listing-agent 可选项
 * - 不支持视觉的目标模型：图片先经百炼视觉模型转成中文描述再并入文本
 */
import { dialog, nativeImage } from 'electron'
import iconv from 'iconv-lite'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { readServerUrl } from '../serverConfig'
import { materializeGeneratedMarkdownReply } from './generatedReportArtifact'
import type { AiEmployeeAskRequest, AiEmployeeAttachment, AiEmployeeChatModelProfile, AiEmployeePickResult } from '../../shared/aiEmployee'
import type { AmazonSearchIntent, AmazonListingEvidence, AmazonReviewEvidence } from '../../shared/amazonScraper'
import { SAMPLE_LIBRARY_KB_REFERENCE_PROMPT } from '../../shared/sampleLibraryKbIngest'
import type { ExecutionEvent, ExecutionStepType, ExecutionEventHandler } from '../../shared/executionEvent'
// 供既有引用（main.ts / preload / ExecutionPanel）继续使用原模块路径
export type { ExecutionEvent, ExecutionStepType, ExecutionEventHandler }

const RAGFLOW_AGENT_DEFAULT_ID = '8563cdb690e611f1b36bf39ef484774d'
const RAGFLOW_LISTING_AGENT_ID = 'a80d0348932d11f1b36bf39ef484774d'
// MaxKB v2.10.5-lts CE application 路由表（5 个 application）
// 启用 Maxkb 智体调用 secret_key 直接 Bearer，不再依赖 /chat/api/auth/anonymous
const MAXKB_AMAZON_SKILLS_APPLICATION_ID = '01a005f0-a471-7403-9d78-8702d5765816'
// ── 选品调研员Agent（父智能体，高级工作流：六部分 11 表）──
// 注意：父智能体只接受 access_token 走公共频道 SSE（/chat/api/auth/anonymous → /chat/api/open → /chat/api/chat_message/{chatId}），
// secret_key 调 /chat/api/{app}/chat/completions 会返回 1002 身份验证失败。
// 因此桌面端默认走 maxkbPublicChat 协议，子智能体（01a005f0）作为手动切换的备用通道。
const MAXKB_SELECTION_RESEARCHER_APPLICATION_ID = '01a043e0-d19b-7f20-8420-cfe8dad604a0'
const MAXKB_SOURCING_APPLICATION_ID = '01a02f8c-66d2-7803-b02b-e67d1cc6e02b'
const MAXKB_LISTING_APPLICATION_ID = '01a02f8c-917e-7232-b62f-f087f70af6b2'
const MAXKB_GUARDIAN_APPLICATION_ID = '01a02f8c-9210-7ec1-902b-87e07315ba57'
const MAXKB_DEFAULT_APPLICATION_ID = '01a00100-09be-7320-94e7-d4998db7df2b'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const DOC_EXTENSIONS = new Set(['.pdf', '.docx', '.txt', '.md'])
const IMAGE_MAX_COUNT = 4
const IMAGE_MAX_BYTES = 7 * 1024 * 1024
const DOC_MAX_COUNT = 3
const DOC_MAX_BYTES = 20 * 1024 * 1024
const IMAGE_MAX_EDGE = 1280
const DOC_CHAR_LIMIT = 12000
const TOTAL_TEXT_BUDGET = 30000
const CHAT_TIMEOUT_MS = 240_000
// Listing 包为六段长文（多语版本），生成耗时显著高于选品报告
const LISTING_TIMEOUT_MS = 360_000
const VISION_TIMEOUT_MS = 60_000

const MIME_BY_EXTENSION: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

function ragflowAgentBaseUrl() {
  try {
    const base = new URL(readServerUrl())
    base.port = '8090'
    base.pathname = '/'
    return base.toString().replace(/\/+$/, '')
  } catch {
    return null
  }
}

function maxkbBaseUrl(): string {
  const explicit = String(process.env.MAXKB_BASE_URL || '').trim()
  if (explicit) return explicit.replace(/\/+$/, '')
  // 回退：使用 readServerUrl() + 8080 端口（与旧版服务路由一致）
  const base = new URL(readServerUrl())
  base.port = '8080'
  base.pathname = '/'
  return base.toString().replace(/\/+$/, '')
}

function bailianBaseUrl(): string {
  return (process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, '')
}

function deepseekBaseUrl(): string {
  return (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '')
}

// ─── Amazon 差异化/合规证据提炼：阶段 4 接入，只拼 prompt + 调模型，状态由调用方写回 extracted。 ───
const INFERENCE_TIMEOUT_MS = 25_000
const INFERENCE_RESULT_MAX_CHARS = 800
const INFERENCE_BULLET_LIMIT = 5
const INFERENCE_BULLET_CHARS = 200
const INFERENCE_REVIEW_LIMIT = 3
const INFERENCE_REVIEW_BODY_CHARS = 300

export interface AmazonInferenceEvidenceInput {
  intent: AmazonSearchIntent
  listingEvidence: AmazonListingEvidence[]
  reviewEvidence: AmazonReviewEvidence[]
  sourceText: {
    title: string
    productForm: string
    useMethod: string
    targetObject: string
    attributes: string[]
    detailText: string
  }
}

export interface AmazonInferenceEvidenceResult {
  differentiation: string
  compliance: string
  /** 哪个模型返回的输出，用于在 profitFieldMeta.source 留痕。 */
  model: string
  /** 本次提炼使用的 API 供应商（bailian/deepseek），便于排查。 */
  provider: string
}

/**
 * 执行步骤事件（5 类）：P2 阶段供渲染端 ExecutionPanel 订阅。
 * 真实类型见 shared/executionEvent.ts（保持单一来源）。
 */

function trimChars(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 1))}…`
}

function buildInferencePayload(input: AmazonInferenceEvidenceInput): string {
  const bullets = input.listingEvidence
    .flatMap(item => item.bulletPoints || [])
    .slice(0, INFERENCE_BULLET_LIMIT)
    .map(line => trimChars(line.replace(/\s+/g, ' ').trim(), INFERENCE_BULLET_CHARS))
    .filter(Boolean)
  const reviewSnippets = input.reviewEvidence
    .flatMap(item => (item.snippets || []).map(snippet => ({ rating: snippet.rating, body: trimChars((snippet.body || '').replace(/\s+/g, ' ').trim(), INFERENCE_REVIEW_BODY_CHARS) })))
    .filter(item => item.body)
    .slice(0, INFERENCE_REVIEW_LIMIT)
  return [
    '你是一名严谨的 Amazon 美国站品类顾问，需要从已抓取证据提炼两项中文结论，每项 1-3 句话，不超过 200 字。',
    '严禁：',
    '- 编造未在证据中出现的品牌、ASIN、检测机构、监管证书、专利号。',
    '- 输出"建议入场/不建议入场"或任何利润率/费用数字（这些字段由其他阶段负责）。',
    '- 使用 Markdown 围栏、分点符号、引号、换行以外的特殊格式。',
    '允许：',
    '- 引用证据中的产品形态、成分、买家反馈关键词。',
    '- 指出明确的合规风险（液体/喷雾/电池/食品接触/儿童使用）以及需要人工核验的项。',
    '',
    '## 本品身份',
    `- 名称：${input.intent.productName}`,
    `- 形态：${input.intent.productForm}`,
    `- 使用方式：${input.intent.useMethod}`,
    `- 适用对象：${input.intent.targetObject}`,
    '',
    '## 1688 页面证据',
    `- 标题：${input.sourceText.title}`,
    `- 形态（人工确认）：${input.sourceText.productForm}`,
    `- 使用方式：${input.sourceText.useMethod}`,
    `- 适用对象：${input.sourceText.targetObject}`,
    `- 属性（前 8 条）：${input.sourceText.attributes.slice(0, 8).join('；') || '无'}`,
    `- 详情文字：${trimChars(input.sourceText.detailText, 600)}`,
    '',
    '## Amazon 详情页 bullet points',
    bullets.length ? bullets.map((line, idx) => `${idx + 1}. ${line}`).join('\n') : '（未抓到 bullet points）',
    '',
    '## Amazon 详情页标题样本',
    input.listingEvidence.slice(0, 3).map(item => trimChars(item.title || '', 120)).filter(Boolean).join('\n') || '（未抓到详情页）',
    '',
    '## Amazon 评论页样本',
    reviewSnippets.length
      ? reviewSnippets.map((snippet, idx) => `${idx + 1}. ${snippet.rating ? `[${snippet.rating}★] ` : ''}${snippet.body}`).join('\n')
      : '（未抓到评论样本）',
    '',
    '## 输出格式（严格 JSON，无 Markdown 围栏）',
    '{"differentiation":"<差异化结论，中文>","compliance":"<合规/IP 核验结论，中文>"}'
  ].join('\n')
}

function parseInferenceJson(raw: string): { differentiation: string; compliance: string } | null {
  const cleaned = String(raw || '').replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()
  if (!cleaned) return null
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0])
    const differentiation = String(parsed?.differentiation || '').trim()
    const compliance = String(parsed?.compliance || '').trim()
    if (!differentiation || !compliance) return null
    if (differentiation.length < 8 || compliance.length < 8) return null
    return { differentiation, compliance }
  } catch {
    return null
  }
}

export class AiEmployeeChatService {
  // ─── 进行中请求跟踪：供 ai-employee:cancel-ask IPC 主动中断上游 fetch ─────────
  // requestId → AbortController；set on enter, delete on finally.
  // 上游连接被 abort 后，本方法 Promise 异常退出，渲染端 catching 路径会重置 sending 状态。
  private readonly activeChats = new Map<string, AbortController>()

  /** 主进程主动中断某次 in-flight chat；返回是否命中并 abort。 */
  cancelChat(requestId: string, reason: string = 'user-cancel'): boolean {
    const controller = this.activeChats.get(requestId)
    if (!controller) return false
    try { controller.abort(reason) } catch { /* already aborted */ }
    return true
  }

  // ─── 模型目录（v1 静态注册表） ─────────────────────────────────────────────
  // 按岗位白名单过滤：每个工作台只暴露一个对应模型（其余的 9 个去杂隐藏）。
  // - 选品调研员 → 选品调研员Agent（父智能体，已配置）
  // - Listing精造师 → Listing 精造师（MaxKB）子智能体（待日后配置父智能体后改）
  // - 知识库守卫 → 通义千问 3.6 Flash 直连（待日后配置父智能体后改）
  // - 竞品分析员/产品定价员/类目优选员：ready:false 不在白名单 → 返回 []
  // 注意：自动回退链（父智能体 → 子智能体 → RAGFlow）仍由 chat() 内部完成，
  // 不在 UI 暴露（符合「简洁」诉求）。
  private static readonly POSITION_MODEL_WHITELIST: Record<string, readonly string[]> = {
    '选品调研员': ['amazon-skills-agent'],
    'Listing精造师': ['maxkb-listing'],
    '知识库守卫': ['qwen3.6-flash']
  }

  listModels(position?: string): AiEmployeeChatModelProfile[] {
    const hasBailian = Boolean(process.env.BAILIAN_API_KEY)
    const hasDeepseek = Boolean(process.env.DEEPSEEK_API_KEY)
    const hasSelectionResearcher = Boolean(process.env.MAXKB_SELECTION_RESEARCHER_TOKEN)
    const hasMaxkbSourcing = Boolean(process.env.MAXKB_SOURCING_TOKEN)
    const hasMaxkbListing = Boolean(process.env.MAXKB_LISTING_TOKEN)
    const hasMaxkbGuardian = Boolean(process.env.MAXKB_GUARDIAN_TOKEN)
    const all: AiEmployeeChatModelProfile[] = [
      // 默认走选品调研员Agent（高级父智能体，六部分 11 表），对齐记忆选品调研员命名
      { id: 'amazon-skills-agent', name: '选品调研员Agent', hint: '默认智能体 · 高级工作流 · 六部分 11 表', provider: 'maxkb', supportsVision: false, available: hasSelectionResearcher },
      { id: 'maxkb-sourcing', name: '选品调研员（MaxKB）', hint: '选品评估 · 含跨境运营知识库', provider: 'maxkb', supportsVision: false, available: hasMaxkbSourcing },
      { id: 'maxkb-listing', name: 'Listing 精造师（MaxKB）', hint: '多平台 Listing 文案 · 六段长文', provider: 'maxkb', supportsVision: false, available: hasMaxkbListing },
      { id: 'maxkb-guardian', name: '知识库守卫（MaxKB）', hint: 'KB 状态监控 · 补充 · 重平衡', provider: 'maxkb', supportsVision: false, available: hasMaxkbGuardian },
      { id: 'ragflow-agent', name: '选品调研员（RAGFlow·30天回退）', hint: '30天兼容回退 · 2026-09-23 停服', provider: 'ragflow', supportsVision: false, available: Boolean(process.env.RAGFLOW_FALLBACK_ENABLED === 'true' && process.env.RAGFLOW_API_KEY) },
      { id: 'listing-agent', name: 'Listing精造师（RAGFlow·30天回退）', hint: '30天兼容回退 · 2026-09-23 停服', provider: 'ragflow', supportsVision: false, available: Boolean(process.env.RAGFLOW_FALLBACK_ENABLED === 'true' && process.env.RAGFLOW_API_KEY) },
      { id: 'qwen3.6-flash', name: '通义千问 3.6 Flash', hint: '直连 · 支持图片理解', provider: 'bailian', supportsVision: true, available: hasBailian },
      { id: 'qwen-plus', name: '通义千问 Plus', hint: '直连 · 长文本', provider: 'bailian', supportsVision: false, available: hasBailian },
      { id: 'deepseek-chat', name: 'DeepSeek Chat', hint: '直连 · 推理强', provider: 'deepseek', supportsVision: false, available: hasDeepseek }
    ]
    if (!position) return all
    const whitelist = AiEmployeeChatService.POSITION_MODEL_WHITELIST[position]
    if (!whitelist || whitelist.length === 0) return []
    return all.filter(model => whitelist.includes(model.id))
  }

  // ─── 附件选择与预处理 ─────────────────────────────────────────────────────
  async pickAttachments(): Promise<AiEmployeePickResult> {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '产品图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
        { name: '文档', extensions: ['pdf', 'docx', 'txt', 'md'] }
      ]
    })
    if (result.canceled || !result.filePaths.length) return { ok: false, attachments: [] }

    const attachments: AiEmployeeAttachment[] = []
    let imageCount = 0
    let docCount = 0
    let limitSkipped = 0
    let readFailed = 0
    const stamp = Date.now()
    let seq = 0

    for (const filePath of result.filePaths) {
      const extension = path.extname(filePath).toLowerCase()
      const name = path.basename(filePath)
      const id = `att-${stamp}-${++seq}`
      try {
        if (IMAGE_EXTENSIONS.has(extension)) {
          if (imageCount >= IMAGE_MAX_COUNT) { limitSkipped += 1; continue }
          const stats = await fsp.stat(filePath)
          if (stats.size > IMAGE_MAX_BYTES) { limitSkipped += 1; continue }
          const buffer = await fsp.readFile(filePath)
          const image = nativeImage.createFromBuffer(buffer)
          if (image.isEmpty()) { readFailed += 1; continue }
          imageCount += 1
          const { width, height } = image.getSize()
          const longEdge = Math.max(width, height)
          if (longEdge > IMAGE_MAX_EDGE) {
            const scale = IMAGE_MAX_EDGE / longEdge
            const resized = image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) })
            const encoded = this.encodeJpegWhiteBackground(resized)
            attachments.push({ id, name, kind: 'image', mimeType: 'image/jpeg', size: encoded.length, dataUrl: `data:image/jpeg;base64,${encoded.toString('base64')}` })
          } else {
            const mimeType = MIME_BY_EXTENSION[extension] || 'image/jpeg'
            attachments.push({ id, name, kind: 'image', mimeType, size: buffer.length, dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}` })
          }
        } else if (DOC_EXTENSIONS.has(extension)) {
          if (docCount >= DOC_MAX_COUNT) { limitSkipped += 1; continue }
          const stats = await fsp.stat(filePath)
          if (stats.size > DOC_MAX_BYTES) { limitSkipped += 1; continue }
          docCount += 1
          const buffer = await fsp.readFile(filePath)
          let text = ''
          if (extension === '.txt' || extension === '.md') {
            const utf8 = buffer.toString('utf8')
            text = utf8.includes('\uFFFD') ? iconv.decode(buffer, 'gbk') : utf8
          } else if (extension === '.pdf') {
            // 扫描版 PDF 提取为空 → text 留空字符串，不报错
            try {
              const mod = await import('pdf-parse')
              const pdfParse = (mod as any).default || mod
              const parsed = await pdfParse(buffer)
              text = parsed.text
            } catch { text = '' }
          } else if (extension === '.docx') {
            try {
              const mammoth = await import('mammoth')
              const r = await mammoth.extractRawText({ buffer })
              text = r.value
            } catch { text = '' }
          }
          text = String(text || '').trim()
          let truncated = false
          if (text.length > DOC_CHAR_LIMIT) { text = text.slice(0, DOC_CHAR_LIMIT); truncated = true }
          attachments.push({ id, name, kind: 'doc', mimeType: extension === '.pdf' ? 'application/pdf' : extension === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/plain', size: stats.size, text, truncated })
        } else {
          readFailed += 1
        }
      } catch {
        readFailed += 1
      }
    }

    // 附件文本总量预算：超出部分继续截断
    let budget = TOTAL_TEXT_BUDGET
    for (const attachment of attachments) {
      if (attachment.kind !== 'doc') continue
      const current = attachment.text || ''
      if (current.length > budget) {
        attachment.text = current.slice(0, budget)
        attachment.truncated = true
      }
      budget = Math.max(0, budget - (attachment.text || '').length)
    }

    const skipReasons: string[] = []
    if (limitSkipped > 0) skipReasons.push(`${limitSkipped} 个文件超出大小/数量限制`)
    if (readFailed > 0) skipReasons.push(`${readFailed} 个文件读取失败或格式不支持`)
    return {
      ok: true,
      attachments,
      message: skipReasons.length ? `已跳过 ${limitSkipped + readFailed} 个文件：${skipReasons.join('；')}` : undefined
    }
  }

  // 编码 JPEG；带透明通道的先逐像素合成白底（反预乘→白底合成→alpha=255），避免黑底
  private encodeJpegWhiteBackground(image: Electron.NativeImage): Buffer {
    const bitmap = image.toBitmap()
    let hasAlpha = false
    for (let i = 3; i < bitmap.length; i += 4) { if (bitmap[i] < 255) { hasAlpha = true; break } }
    if (!hasAlpha) return image.toJPEG(80)
    const flat = Buffer.from(bitmap)
    for (let i = 0; i < flat.length; i += 4) {
      const alpha = flat[i + 3]
      if (alpha >= 255) continue
      const a = alpha / 255
      for (const offset of [0, 1, 2]) {
        const unpremul = alpha > 0 ? Math.min(255, Math.round((flat[i + offset] * 255) / alpha)) : 0
        flat[i + offset] = Math.round(unpremul * a + 255 * (1 - a))
      }
      flat[i + 3] = 255
    }
    const { width, height } = image.getSize()
    return nativeImage.createFromBitmap(flat, { width, height }).toJPEG(80)
  }

  // ─── 对话路由 ──────────────────────────────────────────────────────────────
  async chat(request: AiEmployeeAskRequest, options?: { onEvent?: ExecutionEventHandler; requestId?: string; signal?: AbortSignal }): Promise<{ ok: true; content: string }> {
    const emit = (event: Omit<ExecutionEvent, 'requestId' | 'at'>) => {
      try { options?.onEvent?.({ ...event, requestId: options.requestId || 'unknown', at: Date.now() }) } catch { /* ignore handler errors */ }
    }
    const startedAt = Date.now()
    emit({ type: 'queued', label: '已接收任务' })
    // 上游中止控制器：渲染端 cancel-ask 调 cancelChat() 时此 controller 被 abort，
    // 所有子 fetch 都会因 signal abort 报错跳出。主进程 chat() Promise reject 后，
    // IPC 会把 AbortError 回传渲染端，send() 的 catch 重置 sending 状态。
    const upstreamController = new AbortController()
    const onExternalAbort = () => upstreamController.abort()
    if (options?.signal) options.signal.addEventListener('abort', onExternalAbort)
    if (options?.requestId) this.activeChats.set(options.requestId, upstreamController)
    const attachments = request.attachments || []
    const docs = attachments.filter(item => item.kind === 'doc')
    const images = attachments.filter(item => item.kind === 'image' && item.dataUrl)
    const docBlocks = docs.map(item => item.text
      ? `【附件《${item.name}》内容${item.truncated ? '（已截断）' : ''}】\n${item.text}`
      : `【附件《${item.name}》未提取到文本】`)
    const modelId = (request.modelId || '').trim()
    // I.4 阶段新增：报告样例库 KB 引用提示词注入（仅 RAGFlow 智能体链路生效；直连模型不注入）
    const withKbReference = (content: string) => request.useSampleLibrary
      ? `${content}\n\n${SAMPLE_LIBRARY_KB_REFERENCE_PROMPT}`
      : content

    // 完成事件统一收口
    const finish = (status: 'success' | 'error') => {
      emit({ type: 'done', status, durationMs: Date.now() - startedAt })
    }

    try {
      // 默认（空 / amazon-skills-agent）路径：优先调选品调研员Agent（高级父智能体，六部分 11 表），
      // 失败回退到 Amazon-Skills 子智能体（01a0050-...），最后回退 RAGFlow 30 天窗。
      if (!modelId || modelId === 'amazon-skills-agent') {
        emit({ type: 'analyzing', label: '解析图片与路由' })
        const descriptionBlocks = await this.describeImages(images)
        const content = withKbReference([request.query, ...docBlocks, ...descriptionBlocks].join('\n\n'))
        try {
          emit({ type: 'reasoning', label: '选品调研员Agent 推理（高级工作流）' })
          const result = await this.maxkbPublicChat(request, content, undefined, upstreamController.signal)
          emit({ type: 'finalizing', label: '渲染报告' })
          finish('success')
          return result
        }
        catch (parentError) {
          // 回退1：Amazon-Skills 子智能体（手动备用通道）
          try {
            emit({ type: 'reasoning', label: 'Amazon-Skills 备用通道' })
            const result = await this.maxkbChat(request, content, MAXKB_AMAZON_SKILLS_APPLICATION_ID, CHAT_TIMEOUT_MS, undefined, upstreamController.signal)
            emit({ type: 'finalizing', label: '渲染报告' })
            finish('success')
            return result
          }
          catch (subError) {
            // 回退2：RAGFlow 30天回退（2026-09-23 停服）
            if (process.env.RAGFLOW_FALLBACK_ENABLED === 'true') {
              const fallback = await this.ragflowChat(request, content, CHAT_TIMEOUT_MS, upstreamController.signal)
              const result = { ok: true as const, content: `⚠️ MaxKB 选品调研员暂不可用，已切换 RAGFlow 30天回退分析通道。\n\n${fallback.content}` }
              finish('success')
              return result
            }
            throw subError instanceof Error ? subError : new Error(parentError instanceof Error ? parentError.message : '选品调研员调用失败')
          }
        }
      }

      // MaxKB 多应用路由（v2.10.5-lts 阶段 1.4 启用）
      const maxkbRoute: Record<string, { appId: string; label: string; timeoutMs: number; tokenEnv: string }> = {
        'maxkb-sourcing': { appId: MAXKB_SOURCING_APPLICATION_ID, label: '选品调研员（MaxKB）推理', timeoutMs: CHAT_TIMEOUT_MS, tokenEnv: 'MAXKB_SOURCING_TOKEN' },
        'maxkb-listing': { appId: MAXKB_LISTING_APPLICATION_ID, label: 'Listing 精造师（MaxKB）推理', timeoutMs: LISTING_TIMEOUT_MS, tokenEnv: 'MAXKB_LISTING_TOKEN' },
        'maxkb-guardian': { appId: MAXKB_GUARDIAN_APPLICATION_ID, label: '知识库守卫（MaxKB）推理', timeoutMs: CHAT_TIMEOUT_MS, tokenEnv: 'MAXKB_GUARDIAN_TOKEN' },
        'maxkb-default': { appId: MAXKB_DEFAULT_APPLICATION_ID, label: 'MaxKB 智体推理', timeoutMs: CHAT_TIMEOUT_MS, tokenEnv: 'MAXKB_DEFAULT_TOKEN' }
      }
      const route = maxkbRoute[modelId]
      if (route) {
        emit({ type: 'analyzing', label: '解析图片与路由' })
        const descriptionBlocks = await this.describeImages(images)
        const content = withKbReference([request.query, ...docBlocks, ...descriptionBlocks].join('\n\n'))
        emit({ type: 'reasoning', label: route.label })
        const result = await this.maxkbChat(request, content, route.appId, route.timeoutMs, route.tokenEnv, upstreamController.signal)
        emit({ type: 'finalizing', label: '渲染报告' })
        finish('success')
        return result
      }

      if (modelId === 'ragflow-agent') {
        if (process.env.RAGFLOW_FALLBACK_ENABLED !== 'true') throw new Error('RAGFlow 已超出 30 天回退窗口（2026-09-23 停服）')
        emit({ type: 'analyzing', label: '解析图片与路由' })
        const descriptionBlocks = await this.describeImages(images)
        const content = withKbReference([request.query, ...docBlocks, ...descriptionBlocks].join('\n\n'))
        emit({ type: 'reasoning', label: 'RAGFlow 智能体推理（30天回退）' })
        const result = await this.ragflowChat(request, content, CHAT_TIMEOUT_MS, upstreamController.signal)
        finish('success')
        return result
      }

      // Listing精造师：固定路由到 Listing 智能体，长文生成放宽超时
      if (modelId === 'listing-agent') {
        if (process.env.RAGFLOW_FALLBACK_ENABLED !== 'true') throw new Error('RAGFlow 已超出 30 天回退窗口（2026-09-23 停服）')
        emit({ type: 'analyzing', label: '解析图片与路由' })
        const descriptionBlocks = await this.describeImages(images)
        const content = withKbReference([request.query, ...docBlocks, ...descriptionBlocks].join('\n\n'))
        emit({ type: 'reasoning', label: 'Listing 精造师推理（30天回退）' })
        const result = await this.ragflowChat({ ...request, agentId: RAGFLOW_LISTING_AGENT_ID }, content, LISTING_TIMEOUT_MS, upstreamController.signal)
        emit({ type: 'finalizing', label: '六段长文后处理' })
        finish('success')
        return result
      }

      const profile = this.listModels().find(item => item.id === modelId)

      const fallback = async (): Promise<{ ok: true; content: string }> => {
        emit({ type: 'analyzing', label: '回退路由' })
        const descriptionBlocks = await this.describeImages(images)
        const content = withKbReference([request.query, ...docBlocks, ...descriptionBlocks].join('\n\n'))
        emit({ type: 'reasoning', label: 'RAGFlow 回退推理' })
        const result = await this.ragflowChat(request, content, CHAT_TIMEOUT_MS, upstreamController.signal)
        return { ok: true, content: `⚠️ 所选模型不可用，已切换默认模型。\n\n${result.content}` }
      }

      // 未知 modelId 或所选模型不可用 → 视同 available=false，走回退路径（不抛错、不尝试直连）
      if (!profile || profile.provider === 'ragflow' || !profile.available) {
        const result = await fallback()
        finish('success')
        return result
      }

      try {
        // 非视觉模型 + 图片：先经视觉模型转描述并入文本，避免图片被静默丢弃
        emit({ type: 'analyzing', label: profile.supportsVision ? '路由与上下文拼装' : '视觉转文字' })
        const descriptionBlocks = (!profile.supportsVision && images.length) ? await this.describeImages(images) : []
        emit({ type: 'reasoning', label: `${profile.name} 推理` })
        const result = await this.directChat(profile, request, docBlocks, images, descriptionBlocks, upstreamController.signal)
        finish('success')
        return result
      } catch (directError) {
        try {
          const result = await fallback()
          finish('success')
          return result
        } catch {
          finish('error')
          throw directError instanceof Error ? directError : new Error('分析请求失败')
        }
      }
    } catch (err) {
      finish('error')
      throw err
    } finally {
      if (options?.signal) options.signal.removeEventListener('abort', onExternalAbort)
      if (options?.requestId) this.activeChats.delete(options.requestId)
    }
  }

  // MaxKB 智体调用：secret_key 直接作 Bearer（v2.10.5-lts 不用 /auth/anonymous 中转）
  // - applicationId：可显式指定，缺省走 amazon-skills-agent（阶段 1.4 后多 application 路由）
  // - tokenEnv：指定 .env 变量名；不传时按 applicationId 反查（兼容旧调用）
  // - timeoutMs：默认 240s，Listing 走 360s
  private async maxkbChat(
    request: AiEmployeeAskRequest,
    content: string,
    applicationId: string = MAXKB_AMAZON_SKILLS_APPLICATION_ID,
    timeoutMs: number = CHAT_TIMEOUT_MS,
    tokenEnv?: string,
    externalSignal?: AbortSignal
  ): Promise<{ ok: true; content: string }> {
    // 优先：显式 tokenEnv → agent-* secret_key；回退：MAXKB_AMAZON_SKILLS_TOKEN（access_token 兼容模式）
    const envName = tokenEnv || (applicationId === MAXKB_AMAZON_SKILLS_APPLICATION_ID ? 'MAXKB_AMAZON_SKILLS_TOKEN' : '')
    const token = String(envName ? process.env[envName] : process.env.MAXKB_AMAZON_SKILLS_TOKEN || '').trim()
    if (!token) throw new Error(`MaxKB 智体访问令牌未配置（${envName || 'MAXKB_AMAZON_SKILLS_TOKEN'}）`)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    // 外部取消信号：与内部超时合并，任一触发都中断 fetch
    const onExternalAbort = () => controller.abort()
    if (externalSignal) externalSignal.addEventListener('abort', onExternalAbort)
    try {
      const messages = [...(request.history || []).slice(-10), { role: 'user', content }]
      const response = await fetch(`${maxkbBaseUrl()}/chat/api/${applicationId}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages, stream: false }),
        signal: controller.signal
      })
      const body = await response.json().catch(() => ({}))
      const reply = body?.choices?.[0]?.message?.content
      if (!response.ok || !reply) throw new Error(body?.message || body?.data?.message || `MaxKB 未返回内容（HTTP ${response.status}）`)
      return { ok: true, content: (await materializeGeneratedMarkdownReply(reply)).content }
    } finally {
      clearTimeout(timer)
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort)
    }
  }

  // ─── 公共频道 MaxKB 智能体（access_token + SSE 流式） ─────────────────
  // 选品调研员Agent（01a043e0-...）只接受发布页 access_token 走公共频道协议：
  //   1. POST /chat/api/auth/anonymous    { access_token } → JWT
  //   2. GET  /chat/api/open               → chatId
  //   3. POST /chat/api/chat_message/{chatId} { message, stream: true, form_data, image_list } → SSE
  // SSE 事件格式：`data: {...}\n\n`；content 累加条件同 tools/verify-public-chat.mjs：
  //   - ev.event === 'message'，或
  //   - ev.content !== undefined && ev.chat_id 存在
  private async maxkbPublicChat(
    request: AiEmployeeAskRequest,
    content: string,
    accessToken: string = String(process.env.MAXKB_SELECTION_RESEARCHER_TOKEN || '').trim(),
    externalSignal?: AbortSignal
  ): Promise<{ ok: true; content: string }> {
    if (!accessToken) throw new Error('MaxKB 选品调研员访问令牌未配置（MAXKB_SELECTION_RESEARCHER_TOKEN）')
    const baseUrl = maxkbBaseUrl()
    const controller = new AbortController()
    // 父智能体六部分 11 表报告实测 90–120s，4 分钟超时足够
    const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS)
    const onExternalAbort = () => controller.abort()
    if (externalSignal) externalSignal.addEventListener('abort', onExternalAbort)
    try {
      // 1. 匿名认证拿 JWT
      const authResp = await fetch(`${baseUrl}/chat/api/auth/anonymous`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: accessToken }), signal: controller.signal
      })
      const authBody = await authResp.json().catch(() => ({}))
      if (authResp.status !== 200 || authBody.code !== 200 || !authBody.data) {
        throw new Error(`MaxKB 匿名认证失败：HTTP ${authResp.status} code=${authBody.code} message=${authBody.message || 'unknown'}`)
      }
      const jwt = String(authBody.data).trim()
      if (!jwt) throw new Error('MaxKB 匿名认证返回空 JWT')
      const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` }

      // 2. 打开会话拿 chatId
      const openResp = await fetch(`${baseUrl}/chat/api/open`, { method: 'GET', headers: H, signal: controller.signal })
      const openBody = await openResp.json().catch(() => ({}))
      if (openResp.status !== 200 || openBody.code !== 200) {
        throw new Error(`MaxKB 打开会话失败：HTTP ${openResp.status} code=${openBody.code} message=${openBody.message || 'unknown'}`)
      }
      const chatId = openBody.data?.id || openBody.data?.chat_id || openBody.data
      if (!chatId) throw new Error('MaxKB 打开会话未返回 chatId')

      // 3. 发消息并解析 SSE
      const msgResp = await fetch(`${baseUrl}/chat/api/chat_message/${chatId}`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ message: content, stream: true, re_chat: false, form_data: {}, image_list: [] }),
        signal: controller.signal
      })
      if (!msgResp.ok || !msgResp.body) throw new Error(`MaxKB 消息通道失败：HTTP ${msgResp.status}`)
      const reader = (msgResp.body as ReadableStream<Uint8Array>).getReader()
      const dec = new TextDecoder()
      let buf = '', answer = '', stopped = false
      while (!stopped) {
        const { value, done: streamDone } = await reader.read()
        if (streamDone) break
        buf += dec.decode(value, { stream: true })
        let idx
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const raw = buf.slice(0, idx); buf = buf.slice(idx + 2)
          for (const line of raw.split('\n')) {
            if (!line.startsWith('data:')) continue
            try {
              const ev = JSON.parse(line.slice(5))
              if (ev.event === 'message' || (ev.content !== undefined && ev.chat_id)) {
                answer += ev.content || ''
              }
              if (ev.is_stop) stopped = true
            } catch { /* 忽略非 JSON 帧 */ }
          }
        }
      }
      if (!answer.trim()) throw new Error('MaxKB 选品调研员未返回内容')
      return { ok: true, content: (await materializeGeneratedMarkdownReply(answer)).content }
    } finally {
      clearTimeout(timer)
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort)
    }
  }

  // ─── RAGFlow 智能体（fetch 逻辑与原 main.ts 逐字一致） ─────────────────────
  private async ragflowChat(request: AiEmployeeAskRequest, content: string, timeoutMs = CHAT_TIMEOUT_MS, externalSignal?: AbortSignal): Promise<{ ok: true; content: string }> {
    // RAGFlow API Key 外置到 .env.local（RAGFLOW_API_KEY）：不能在模块顶层读 process.env（import 早于 loadLocalEnvironment），只能在此方法内懒读取
    const base = ragflowAgentBaseUrl()
    if (!base) throw new Error('服务器地址无效，请检查配置')
    const apiKey = String(process.env.RAGFLOW_API_KEY || '').trim()
    if (!apiKey) throw new Error('未配置 RAGFLOW_API_KEY：请在「大模型API Key」页设置')
    const agentId = request.agentId || RAGFLOW_AGENT_DEFAULT_ID
    const messages: Array<{ role: string; content: string }> = [
      ...(request.history || []).filter(item => item.role === 'user' || item.role === 'assistant').slice(-10).map(item => ({ role: item.role, content: item.content })),
      { role: 'user', content }
    ]
    const controller = new AbortController()
    // 六部分选品报告包含多张竞品与利润表，完整生成可超过 120 秒。
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const onExternalAbort = () => controller.abort()
    if (externalSignal) externalSignal.addEventListener('abort', onExternalAbort)
    try {
      const response = await fetch(`${base}/api/v1/agents/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ agent_id: agentId, messages, 'openai-compatible': true, stream: false }),
        signal: controller.signal
      })
      const body = await response.json().catch(() => ({ message: '响应解析失败' }))
      if (!response.ok) throw new Error(body?.message || `分析请求失败（${response.status}）`)
      const reply = body?.choices?.[0]?.message?.content
      if (!reply) throw new Error('智能体未返回内容')
      return { ok: true, content: (await materializeGeneratedMarkdownReply(reply)).content }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error(`分析超时（${Math.round(timeoutMs / 1000)}秒），请稍后重试`)
      throw error instanceof Error ? error : new Error('分析请求失败')
    } finally {
      clearTimeout(timer)
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort)
    }
  }

  // ─── 直连模型（百炼 / DeepSeek，OpenAI 兼容 chat/completions） ─────────────
  private async directChat(
    profile: AiEmployeeChatModelProfile,
    request: AiEmployeeAskRequest,
    docBlocks: string[],
    images: AiEmployeeAttachment[],
    descriptionBlocks: string[],
    externalSignal?: AbortSignal
  ): Promise<{ ok: true; content: string }> {
    let apiKey = ''
    let endpoint = ''
    if (profile.provider === 'bailian') {
      apiKey = process.env.BAILIAN_API_KEY || ''
      endpoint = `${bailianBaseUrl()}/chat/completions`
    } else {
      apiKey = process.env.DEEPSEEK_API_KEY || ''
      endpoint = `${deepseekBaseUrl()}/chat/completions`
    }
    if (!apiKey) throw new Error(`${profile.name} 未配置 API Key`)

    const text = [request.query, ...docBlocks, ...descriptionBlocks].join('\n\n')
    let content: string | Array<Record<string, unknown>> = text
    if (profile.supportsVision && images.length) {
      content = [
        { type: 'text', text },
        ...images.map(item => ({ type: 'image_url', image_url: { url: item.dataUrl } }))
      ]
    }
    const messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }> = [
      ...(request.history || []).filter(item => item.role === 'user' || item.role === 'assistant').slice(-10).map(item => ({ role: item.role, content: item.content })),
      { role: 'user', content }
    ]

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS)
    const onExternalAbort = () => controller.abort()
    if (externalSignal) externalSignal.addEventListener('abort', onExternalAbort)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: profile.id, messages }),
        signal: controller.signal
      })
      const body = await response.json().catch(() => ({ message: '响应解析失败' }))
      if (!response.ok) throw new Error(body?.error?.message || body?.message || `分析请求失败（${response.status}）`)
      const reply = body?.choices?.[0]?.message?.content
      const replyText = typeof reply === 'string'
        ? reply
        : Array.isArray(reply)
          ? reply.map((part: { text?: unknown }) => (typeof part?.text === 'string' ? part.text : '')).join('\n')
          : ''
      if (!replyText) throw new Error('模型未返回内容')
      return { ok: true, content: (await materializeGeneratedMarkdownReply(replyText)).content }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('分析超时（240秒），请稍后重试')
      throw error instanceof Error ? error : new Error('分析请求失败')
    } finally {
      clearTimeout(timer)
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort)
    }
  }

  // ─── 图片转描述（目标模型不支持视觉时） ────────────────────────────────────
  private async describeImages(images: AiEmployeeAttachment[]): Promise<string[]> {
    if (!images.length) return []
    const apiKey = process.env.BAILIAN_API_KEY || ''
    const model = process.env.BAILIAN_VISION_MODEL || 'qwen3.6-flash'
    const blocks: string[] = []
    for (const item of images) {
      if (!apiKey || !item.dataUrl) {
        blocks.push(`【图片附件《${item.name}》描述失败】`)
        continue
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS)
      try {
        const response = await fetch(`${bailianBaseUrl()}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: '请用中文简要描述这张产品图：外观、颜色、材质、形态、可见卖点' },
                { type: 'image_url', image_url: { url: item.dataUrl } }
              ]
            }]
          }),
          signal: controller.signal
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body?.message || `HTTP ${response.status}`)
        const description = body?.choices?.[0]?.message?.content
        if (!description) throw new Error('视觉模型未返回描述')
        blocks.push(`【图片附件《${item.name}》描述】\n${description}`)
      } catch {
        blocks.push(`【图片附件《${item.name}》描述失败】`)
      } finally {
        clearTimeout(timer)
      }
    }
    return blocks
  }

  // ─── Amazon 检索词推导：只读取已锁定的本品身份，输出三组买家意图词；调用方仍会执行禁用词清洗和确定性回退。 ───
  async deriveAmazonKeywords(intent: AmazonSearchIntent): Promise<string[]> {
    const productName = String(intent?.productName || '').replace(/\s+/g, ' ').trim()
    if (!productName || !intent?.productForm) return []
    const models = this.listModels()
    const profile = models.find(item => item.id === 'qwen3.6-flash' && item.available)
      || models.find(item => (item.provider === 'bailian' || item.provider === 'deepseek') && item.available)
    if (!profile) return []
    const apiKey = profile.provider === 'bailian' ? process.env.BAILIAN_API_KEY || '' : process.env.DEEPSEEK_API_KEY || ''
    const endpoint = profile.provider === 'bailian' ? `${bailianBaseUrl()}/chat/completions` : `${deepseekBaseUrl()}/chat/completions`
    if (!apiKey) return []
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20000)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: profile.id,
          messages: [{ role: 'user', content: [
            '根据已确认的本品身份，生成 3 个 Amazon 美国站买家检索词。',
            '每行一个英文检索词，每个 2-7 个单词；使用通用品类词，不含品牌、标点、营销词或解释。',
            `产品名称：${productName}`,
            `产品形态：${intent.productForm}`,
            `使用方式：${intent.useMethod}`,
            `适用对象：${intent.targetObject}`,
            `禁止出现：${intent.excludedTerms.join('、') || '无'}`
          ].join('\n') }]
        }),
        signal: controller.signal
      })
      const body = await response.json().catch(() => ({}))
      return String(body?.choices?.[0]?.message?.content || '')
        .split(/\n+/)
        .map((line: string) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').replace(/["'`*#.,!。！]/g, ' ').replace(/\s+/g, ' ').trim())
        .filter((line: string) => Boolean(line) && !/[\u4e00-\u9fff]/.test(line))
        .slice(0, 6)
    } catch {
      return []
    } finally {
      clearTimeout(timer)
    }
  }

  // ─── Amazon 差异化/合规证据提炼：deepseek-chat 优先、qwen3.6-flash 回退。失败/超时/JSON 坏值 → 返回 null，调用方保留 1688 原措辞。 ───
  async inferDifferentiationAndCompliance(input: AmazonInferenceEvidenceInput): Promise<AmazonInferenceEvidenceResult | null> {
    if (!input?.intent?.productName) return null
    const models = this.listModels()
    // 优先 deepseek（推理强、输出干净），无 key 时回退 qwen3.6-flash（视觉兼描述）
    const profiles = [
      models.find(item => item.id === 'deepseek-chat' && item.available),
      models.find(item => item.id === 'qwen3.6-flash' && item.available)
    ].filter((item): item is AiEmployeeChatModelProfile => Boolean(item))
    if (!profiles.length) return null
    const payload = buildInferencePayload(input)
    for (const profile of profiles) {
      const apiKey = profile.provider === 'bailian' ? process.env.BAILIAN_API_KEY || '' : process.env.DEEPSEEK_API_KEY || ''
      if (!apiKey) continue
      const endpoint = profile.provider === 'bailian' ? `${bailianBaseUrl()}/chat/completions` : `${deepseekBaseUrl()}/chat/completions`
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), INFERENCE_TIMEOUT_MS)
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: profile.id,
            temperature: 0.2,
            max_tokens: 600,
            messages: [{ role: 'user', content: payload }]
          }),
          signal: controller.signal
        })
        if (!response.ok) continue
        const body = await response.json().catch(() => ({}))
        const raw = String(body?.choices?.[0]?.message?.content || '')
        const parsed = parseInferenceJson(raw)
        if (!parsed) continue
        return {
          differentiation: trimChars(parsed.differentiation, INFERENCE_RESULT_MAX_CHARS),
          compliance: trimChars(parsed.compliance, INFERENCE_RESULT_MAX_CHARS),
          model: profile.id,
          provider: profile.provider
        }
      } catch {
        // 超时/网络错误/JSON 坏值 → 继续尝试下一个 profile
        continue
      } finally {
        clearTimeout(timer)
      }
    }
    return null
  }
}
