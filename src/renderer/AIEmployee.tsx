import { Component, FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import AIMessageContent from './AIMessageContent'
import AiEmployeeModelPicker from './AiEmployeeModelPicker'
import ListingWorkbench from './ListingWorkbench'
import WorkbenchSkillConfig from './WorkbenchSkillConfig'
import ProductLibraryDrawer from './ProductLibraryDrawer'
import ExecutionPanel from './ExecutionPanel'
import { addProductItem, type ProductLibraryItem } from '../shared/productLibrary'
import type { AiEmployeeAttachment, AiEmployeeChatModelProfile } from '../shared/aiEmployee'
import { SELECTION_ANALYSIS_REQUEST, applyAmazonFinancialPreset, applyCnyPurchasePriceUsd, applyPlatformToRequest, assessExtractionEvidence, buildAmazonFinancialPreset, buildProductBasicsBlock, buildProductIdentityLock, buildSelectionInfoText, extractSupplyFacts, normalizeSelectionReport, reportPlatform, sanitizeSelectionReportEvidence, selectionGenerationGate, userEditedProfitFieldMeta, validateSelectionReportEvidence, validateSelectionReportIdentity, validateSelectionReportPlatform, type ExtractedProductInfo, type ProfitFieldKey } from '../shared/selectionExtract'
import { buildAmazonEntryDecisionFactBlock, buildAmazonFullCostProfitFactBlock, buildAmazonQuickMarketProfitFactBlock, buildAmazonSearchIntent, buildComparableMarketFactBlock, buildCompetitorListingSummary, buildCompetitorReviewInsights, classifyAmazonSamples, estimateFbaFulfillmentFee, evaluateAmazonEntryDecision, meetsAmazonResearchSampleBaseline, normalizeAmazonKeywordPlan, sanitizeAmazonMarketClaims, validateAmazonEntryDecisionClaim, validateAmazonMarketClaims, type AmazonCostRange, type AmazonEntryDecisionInput, type AmazonFullCostInput, type AmazonListingEvidence, type AmazonMarketSample, type AmazonReviewEvidence, type AmazonSampleAudit, type AmazonQuickMarketProfitInput } from '../shared/amazonScraper'
import { buildSelectionReportCollaborationPrompt } from '../shared/selectionReportWorkflow'
import { createSelectionReportPayload, selectionReportPayloadFactBlock, validateSelectionReportPayload } from '../shared/selectionReportPayload'
import { rankSelectionReportCandidates, selectionReportConsensusInstruction } from '../shared/selectionReportConsensus'
import { renderSelectionReportFallback, renderSelectionReportMarkdown, validateRenderedSelectionReport } from '../shared/selectionReportRenderer'
import { parseSelectionReportEnrichment, selectionReportEnrichmentPrompt } from '../shared/selectionReportEnrichment'
import './ai-employee.css'

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  attachments?: Array<{ id: string; name: string; kind: 'image' | 'doc'; size: number }>
  /** 本次请求固化的平台；禁止由会话历史或模型输出反推。 */
  targetPlatform?: string
}
type Tab = 'home' | 'process' | 'archive' | 'browser' | 'workbench'

type HistoryItem = {
  id: string
  title: string
  roleName: string
  createdAt: number
  messages: ChatMessage[]
}

type MessageRenderBoundaryProps = {
  content: string
  children: ReactNode
}

type MessageRenderBoundaryState = { failed: boolean }

/** 历史报告可能来自旧版模型或旧版导出；单条渲染失败时只降级该条，绝不让整个工作台白屏。 */
class MessageRenderBoundary extends Component<MessageRenderBoundaryProps, MessageRenderBoundaryState> {
  state: MessageRenderBoundaryState = { failed: false }

  static getDerivedStateFromError(): MessageRenderBoundaryState {
    return { failed: true }
  }

  componentDidUpdate(previous: MessageRenderBoundaryProps) {
    if (previous.content !== this.props.content && this.state.failed) this.setState({ failed: false })
  }

  render() {
    if (!this.state.failed) return this.props.children
    return <div className="ai-employee-message-recovery" role="alert">
      <b>该历史文档的增强排版未能加载，已切换为安全原文视图。</b>
      <pre>{this.props.content}</pre>
    </div>
  }
}

// 员工岗位定义：独立工作台的徽章颜色/图标/默认模型由此查询（界面内角色切换 chips 已移除）
// 知识库守卫：独立工作台复用聊天壳，P1 对话接直连模型；技能配置在知识库页「守卫技能」区
const AGENTS = [
  { name: '选品调研员', role: '1688 商品机会评估 · Amazon-Skills 选品分析', color: '#0ea5e9', ready: true, modelId: 'amazon-skills-agent', icon: '调' },
  { name: '知识库守卫', role: '知识库自动收集 · 增量更新守卫', color: '#14b8a6', ready: true, modelId: 'qwen3.6-flash', icon: '卫' },
  { name: '竞品分析员', role: '竞品对比 · 差异化卖点挖掘', color: '#10b981', ready: false, modelId: '', icon: '竞' },
  { name: '产品定价员', role: '成本核算 · 定价策略', color: '#f59e0b', ready: false, modelId: '', icon: '定' },
  { name: '类目优选员', role: '类目机会 · 蓝海发现', color: '#8b5cf6', ready: false, modelId: '', icon: '类' }
]

// 跨境平台快捷选择：点选后发送时自动附加「目标平台」
const PLATFORMS = ['Amazon', 'eBay', 'Ozon', 'Temu', 'TikTok', 'eMAG', 'Lazada']

// 示例问题 chips（工作处理空态）
const SAMPLE_QUESTIONS = [
  '帮我分析一款宠物用品在亚马逊的市场机会',
  '如何判断一个产品在 1688 上的竞争程度？',
  '跨境电商选品有哪些常见误区？',
  '亚马逊 FBA 和 FBM 的区别是什么？',
  '如何评估一款产品的利润空间？',
  '1688 上如何找到靠谱的供应商？'
]

// 独立工作台首页示例提问：按岗位定制，未配置岗位回退选品分析师示例
const POSITION_SUGGESTIONS: Record<string, string[]> = {
  知识库守卫: [
    '知识库里目前有哪些内容？',
    '如何为智能体补充新的知识文档？',
    '知识库的增量更新是如何触发的？',
    '哪些知识文档长期没有被命中？',
    '怎样把一篇运营经验沉淀进知识库？',
    '知识库守卫能帮我做什么？'
  ]
}
// 输入栏占位示例：按岗位定制
const POSITION_EXAMPLE: Record<string, string> = {
  知识库守卫: '帮我看看知识库最近新增了哪些内容…'
}

const STORAGE_KEY = 'yd.aiEmployee.history'
const ACTIVE_HISTORY_KEY = 'yd.aiEmployee.activeHistoryId'
const CHAT_MODEL_KEY = 'yd.aiEmployee.chatModel'
const EXTRACTION_STORAGE_KEY = 'yd.aiEmployee.extractedByConversation:v1'
const DRAFT_EXTRACTION_ID = '__draft__'
const DEFAULT_MODEL_ID = 'amazon-skills-agent'
const MAX_HISTORY = 50
// 累计附件上限（与主进程单次选择上限一致）
const ATTACHMENT_LIMITS: Record<'image' | 'doc', number> = { image: 4, doc: 3 }
// 选品调研员的报告交付法则：主模型失败或质量门禁失败时，必须并行调用可用修正模型；
// 再失败则交付系统事实驱动的预备报告，而不能只停留在错误提示。
const REPORT_REPAIR_MODEL_IDS = ['deepseek-chat', 'qwen-plus'] as const

/** OmkarCloud 为主证据；同 ASIN 的页面样本只能补空字段，不能覆盖 API 已返回的实际值。 */
function mergeAmazonSamples(apiSamples: AmazonMarketSample[], browserSamples: AmazonMarketSample[], query: string): AmazonMarketSample[] {
  const merged = new Map<string, AmazonMarketSample>()
  const keyOf = (sample: AmazonMarketSample, index: number) => sample.asin.trim().toUpperCase() || `__missing_${index}`
  apiSamples.forEach((sample, index) => merged.set(keyOf(sample, index), { ...sample, query, source: 'api' }))
  browserSamples.forEach((browser, index) => {
    const key = keyOf(browser, index)
    const api = merged.get(key)
    if (!api) {
      merged.set(key, { ...browser, query, source: 'browser' })
      return
    }
    merged.set(key, {
      ...browser,
      ...api,
      title: api.title || browser.title,
      price: api.price ?? browser.price,
      rating: api.rating ?? browser.rating,
      reviews: api.reviews ?? browser.reviews,
      salesVolume: api.salesVolume ?? browser.salesVolume,
      bsr: api.bsr ?? browser.bsr,
      page: api.page ?? browser.page,
      sponsored: api.sponsored ?? browser.sponsored,
      query,
      source: 'hybrid'
    })
  })
  return [...merged.values()]
}

type StoredExtractionState = {
  info: ExtractedProductInfo
  collapsed: boolean
  confirmed: boolean
  confirmedAt?: string
  updatedAt: string
}

type IdentityDraft = {
  productName: string
  productForm: string
  useMethod: string
  targetObject: string
  note: string
}

type MarketAuditView = {
  keywords: string[]
  audit: AmazonSampleAudit
  source: 'model' | 'deterministic'
  samples: ReturnType<typeof classifyAmazonSamples>['samples']
  listingEvidence: AmazonListingEvidence[]
  reviewEvidence: AmazonReviewEvidence[]
}

function loadExtractionMap(): Record<string, StoredExtractionState> {
  try {
    const raw = localStorage.getItem(EXTRACTION_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) as Record<string, StoredExtractionState> : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function loadExtractionState(id: string): StoredExtractionState | null {
  const state = loadExtractionMap()[id]
  if (!state?.info || typeof state.info !== 'object') return null
  const info = applyAmazonFinancialPreset(state.info)
  return state.confirmed && selectionGenerationGate(info, true)
    ? { ...state, info, confirmed: false, confirmedAt: undefined }
    : { ...state, info }
}

function saveExtractionState(id: string, state: StoredExtractionState | null) {
  try {
    const map = loadExtractionMap()
    if (state) map[id] = state
    else delete map[id]
    localStorage.setItem(EXTRACTION_STORAGE_KEY, JSON.stringify(map))
  } catch {
    // localStorage 不可用或超限时保留当前界面状态
  }
}

function comparableProductUrl(value?: string): string {
  if (!value) return ''
  try {
    const parsed = new URL(value)
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return value.trim()
  }
}

// 附件大小格式化：B / KB / MB，保留一位小数
function formatSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function conversationTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find(message => message.role === 'user')
  const lastAssistant = [...messages].reverse().find(message => message.role === 'assistant')
  const heading = lastAssistant?.content.match(/^#\s+(.+)$/m)?.[1]?.trim()
  return heading || firstUser?.content.trim().slice(0, 30) || '新对话'
}

function normalizeHistoryItem(item: HistoryItem): HistoryItem {
  // 新消息保存固化平台；旧历史仅用紧邻 user 消息兜底，绝不读取整段会话。
  let lastUserText = ''
  let lastUserPlatform = ''
  const id = typeof item?.id === 'string' ? item.id : `recovered-${Date.now()}`
  const confirmedProductName = loadExtractionMap()[id]?.info?.confirmedProductName
  const sourceMessages = Array.isArray(item?.messages) ? item.messages : []
  const messages = sourceMessages.flatMap(message => {
    if (!message || (message.role !== 'user' && message.role !== 'assistant')) return []
    const content = typeof message.content === 'string'
      ? message.content
      : message.content == null ? '' : JSON.stringify(message.content)
    const safeMessage: ChatMessage = {
      role: message.role,
      content: content.slice(0, 500_000),
      attachments: Array.isArray(message.attachments) ? message.attachments : undefined,
      targetPlatform: typeof message.targetPlatform === 'string' ? message.targetPlatform : undefined
    }
    if (safeMessage.role === 'user') {
      lastUserText = safeMessage.content
      lastUserPlatform = safeMessage.targetPlatform || reportPlatform(safeMessage.content)
      return [safeMessage]
    }
    const targetPlatform = safeMessage.targetPlatform || lastUserPlatform || reportPlatform(safeMessage.content)
    return [{ ...safeMessage, targetPlatform, content: normalizeSelectionReport(safeMessage.content, targetPlatform, confirmedProductName, lastUserText) }]
  })
  return {
    id,
    title: conversationTitle(messages),
    roleName: typeof item?.roleName === 'string' ? item.roleName : '选品调研员',
    createdAt: Number.isFinite(item?.createdAt) ? item.createdAt : Date.now(),
    messages
  }
}

function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const items: HistoryItem[] = raw ? JSON.parse(raw) : []
    const normalized = items.map(normalizeHistoryItem)
    if (raw && JSON.stringify(normalized) !== raw) saveHistoryToStorage(normalized)
    return normalized
  } catch {
    return []
  }
}

function saveHistoryToStorage(items: HistoryItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // ignore quota errors
  }
}

function readableError(reason: unknown, fallback = '请求失败'): string {
  if (reason instanceof Error) {
    const message = reason.message
      .replace(/^Error invoking remote method '[^']+': Error:\s*/, '')
      .replace(/^Error:\s*/, '')
    return message || fallback
  }
  return fallback
}

/**
 * 最后一层可交付兜底：只拼装系统已经锁定或抓取到的事实块。
 * 它不是以模型记忆填充的数据报告；任何未知经营/合规项均明确保留为“待验证”。
 */
function buildGuaranteedPreliminaryReport(info: ExtractedProductInfo, market: MarketAuditView | null, targetPlatform: string, repairErrors: string[]): string {
  const intent = buildAmazonSearchIntent(info)
  const samples = market?.samples || []
  const audit = market?.audit
  const decision = audit
    ? evaluateAmazonEntryDecision(intent, samples, audit, info.quickMarketProfit, info.fullCostProfit, info.entryDecision, info.profitFieldMeta)
    : { decision: '❓ 数据不足，不能判定' as const, reasons: ['Amazon 市场样本未能完成抓取，无法判断市场竞争力。'] }
  const direct = samples.filter(sample => sample.comparisonClass === 'DIRECT').slice(0, 10)
  const safe = (value: unknown, fallback = '待验证') => String(value ?? '').replace(/[|\n\r]/g, ' ').trim() || fallback
  const sampleRows = direct.length
    ? direct.map(sample => `| ${safe(sample.asin)} | ${safe(sample.title)} | ${sample.price == null ? '待验证' : `$${sample.price.toFixed(2)}`} | ${sample.rating == null ? '待验证' : sample.rating.toFixed(1)} | ${sample.reviews == null ? '待验证' : sample.reviews} | 系统抓取 |`).join('\n')
    : '| 待验证 | 未取得 DIRECT 样本 | 待验证 | 待验证 | 待验证 | 待验证 |'
  const lines = [
    `# ${safe(info.confirmedProductName || info.title, '待命名产品')} · ${reportPlatform(targetPlatform)}选品分析报告`,
    '',
    '> 自动兜底预备报告：主模型与自动修正模型未能交付通过质量门禁的正文。本报告仅使用当前锁定商品、OmkarCloud/Amazon 已抓取样本和已录入成本字段；未知项均为“待验证”。',
    '',
    `- 分析日期：${safe(info.analysisDate, new Date().toISOString().slice(0, 10))}`,
    `- 目标平台：${reportPlatform(targetPlatform)}`,
    '- 履约方式：FBA（待验证）',
    '- 币种：USD',
    '',
    '## 第一部分：本品基础信息解析',
    '| 字段 | 当前事实 | 证据等级/来源 |',
    '|---|---|---|',
    `| 商品名称 | ${safe(info.confirmedProductName || info.title)} | 事实/1688 商品页或人工锁定 |`,
    `| 商品链接 | ${safe(info.url)} | 事实/1688 商品页 |`,
    `| 产品形态 | ${safe(info.confirmedProductForm || info.visualProductForm)} | ${info.confirmedProductForm ? '事实/人工锁定' : '待验证'} |`,
    `| 采购价 | ${info.quickMarketProfit?.purchaseCostUsd == null ? '待验证' : `$${info.quickMarketProfit.purchaseCostUsd.toFixed(2)}`} | ${safe(info.profitFieldMeta?.purchaseCostUsd?.origin)} |`,
    '',
    '## 第二部分：目标平台细分市场调研',
    `- 三组检索词：${market?.keywords.join('；') || '待验证'}。`,
    `- DIRECT 样本：${audit?.directCount ?? 0}；样本完整率：${audit?.coveragePercent ?? 0}%；核心字段覆盖：${audit?.fieldCoveragePercent ?? 0}%。`,
    `- 市场样本结论：${audit ? (meetsAmazonResearchSampleBaseline(audit) ? '已满足研究样本基线，可继续评估竞争力。' : '未满足研究样本基线，仅作方向参考。') : '待验证（未取得有效市场样本）。'}`,
    '',
    '## 第三部分：本品与核心竞品多维对比',
    '| ASIN | 标题 | 售价 | 评分 | 评论量 | 来源 |',
    '|---|---|---:|---:|---:|---|',
    sampleRows,
    '',
    '## 第四部分：价格、成本与单位经济',
    buildAmazonQuickMarketProfitFactBlock(intent, samples, info.quickMarketProfit, info.profitFieldMeta),
    '',
    buildAmazonFullCostProfitFactBlock(intent, samples, info.quickMarketProfit, info.fullCostProfit, info.profitFieldMeta),
    '',
    '## 第五部分：合规、知识产权与差异化核验',
    `- 差异化核验依据：${safe(info.entryDecision?.differentiationEvidence)}。`,
    `- 合规/IP 核验依据：${safe(info.entryDecision?.complianceIpEvidence)}。`,
    '- 未完成官方法规、标签、危险品、商标、专利及侵权检索；不得据此作出合规或 IP 通过结论。',
    '',
    '## 第六部分：入场结论与30天验证计划',
    `- 最终结论：${decision.decision}。`,
    `- 门禁依据：${decision.reasons.join('；')}`,
    '- 30天验证：补齐包装尺寸/毛重、官方 FBA 履约费、货代全成本区间、合规/IP 检索记录；以同一核心用途、同一形态、同一对象的 DIRECT 样本复算价格带和全成本贡献利润。',
    `- 自动修正失败记录：${repairErrors.length ? repairErrors.join('；') : '模型正文未通过质量门禁。'}`,
    '',
    '## 数据来源、假设与待验证清单',
    '- 1688 商品页：本品身份、原始采购信息；Amazon/OmkarCloud：DIRECT 样本字段；未抓取数据一律待验证。'
  ]
  return normalizeSelectionReport(lines.join('\n'), targetPlatform, info.confirmedProductName, '', true)
}

export default function AIEmployee({ initialTab, position = '选品调研员', onBackToHub, onSelfLink, onNavigatePosition }: { initialTab?: Tab; position?: string; onBackToHub?: () => void; onSelfLink?: () => void; onNavigatePosition?: (name: string) => void } = {}) {
  const [initialHistory] = useState<HistoryItem[]>(() => loadHistory())
  const [initialExtraction] = useState<StoredExtractionState | null>(() => position === '选品调研员' ? loadExtractionState(DRAFT_EXTRACTION_ID) : null)
  // ─── Tab ─────────────────────────────────────────────
  // 进入 AI员工 默认定位提问首页；发出首条提问后自动切到工作处理
  const [activeTab, setActiveTab] = useState<Tab>(initialTab ?? 'home')

  // ─── Chat ────────────────────────────────────────────
  // 独立工作台：岗位由入口 position 固定（颜色/图标/默认模型查 AGENTS，Listing精造师 回退绿/精）
  const positionAgent = AGENTS.find(item => item.name === position)
  const positionDefaultModel = positionAgent?.modelId || DEFAULT_MODEL_ID
  // 独立工作台操作裁剪：各岗位操作不一样，Tab 栏与输入栏快捷操作按岗位渲染
  const showWorkbenchTab = position === 'Listing精造师'
  const showBrowserTab = position === '选品调研员'
  const showSelectionTools = position === '选品调研员' // 1688 提取 + 平台快捷选择
  // 独立工作台：会话角色固定为入口岗位，不随历史会话切换
  const agentName = position
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [extracted, setExtracted] = useState<ExtractedProductInfo | null>(initialExtraction?.info ?? null)
  const [extractedCollapsed, setExtractedCollapsed] = useState(initialExtraction?.collapsed ?? false)
  const [extractedConfirmed, setExtractedConfirmed] = useState(initialExtraction?.confirmed ?? false)
  const [extractedConfirmedAt, setExtractedConfirmedAt] = useState(initialExtraction?.confirmedAt ?? '')
  const [identityEditorOpen, setIdentityEditorOpen] = useState(false)
  const [identityDraft, setIdentityDraft] = useState<IdentityDraft>({ productName: '', productForm: '', useMethod: '', targetObject: '', note: '' })
  const [platform, setPlatform] = useState('')
  const [notice, setNotice] = useState('')
  const [marketAudit, setMarketAudit] = useState<MarketAuditView | null>(null)
  // P1-B 阶段:商品库抽屉状态
  const [showProductDrawer, setShowProductDrawer] = useState(false)
  // P2 阶段:执行步骤面板的请求 id + 重置信号
  const [execRequestId, setExecRequestId] = useState<string>('')
  const [execResetSignal, setExecResetSignal] = useState(0)
  // 三件套护栏：send 进行中时记录起始时间戳，并维护一个 1s 递增的「已等待 Xs」计数。
  // - sendingStartedAt:每次 setSending(true) 时拍下 Date.now();setSending(false) 时清空。
  // - sendingElapsed:useEffect 里 setInterval 每秒重算，供按钮文案和提示使用。
  const [sendingStartedAt, setSendingStartedAt] = useState<number | null>(null)
  const [sendingElapsed, setSendingElapsed] = useState(0)
  // 60s 保险：超时只重置 UI（不强行 abort 上游）；避免上游慢响应时按钮卡在「思考中…」无法恢复。
  const SENDING_HARD_TIMEOUT_MS = 60_000

  // ─── 附件与大模型选择 ────────────────────────────────
  const [attachments, setAttachments] = useState<AiEmployeeAttachment[]>([])
  const [models, setModels] = useState<AiEmployeeChatModelProfile[]>([])
  const [modelId, setModelId] = useState<string>(() => {
    try {
      return localStorage.getItem(`${CHAT_MODEL_KEY}:${position}`) || positionDefaultModel
    } catch {
      return positionDefaultModel
    }
  })
  const [picking, setPicking] = useState(false)

  // I.4 阶段新增：报告样例库 KB 引用开关（按岗位持久化到 localStorage）
  // 默认：选品调研员 / Listing精造师 ON；其余岗位 OFF。
  // 开关 ON 后主进程 chat() 会在 user content 末尾注入 SAMPLE_LIBRARY_KB_REFERENCE_PROMPT，
  // 提示 MaxKB 智能体主动检索「选品分析师」KB 中已入库的 4 样例 + 决策门禁 + 可追溯约束。
  const SAMPLE_LIB_DEFAULT_BY_POSITION: Record<string, boolean> = {
    选品调研员: true,
    'Listing精造师': true,
    知识库守卫: false,
    竞品分析员: false,
    产品定价员: false,
    类目优选员: false
  }
  const SAMPLE_LIB_STORAGE_KEY = `aiEmployee:useSampleLibrary:${position}`
  const [useSampleLibrary, setUseSampleLibrary] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(SAMPLE_LIB_STORAGE_KEY)
      if (stored === '1') return true
      if (stored === '0') return false
    } catch { /* ignore storage errors */ }
    return SAMPLE_LIB_DEFAULT_BY_POSITION[position] ?? false
  })
  const handleToggleUseSampleLibrary = (next: boolean) => {
    setUseSampleLibrary(next)
    try { localStorage.setItem(SAMPLE_LIB_STORAGE_KEY, next ? '1' : '0') } catch { /* ignore quota errors */ }
  }

  // ─── History ─────────────────────────────────────────
  const [history, setHistory] = useState<HistoryItem[]>(initialHistory)
  const [historyId, setHistoryId] = useState<string | null>(null)
  const [exportNotice, setExportNotice] = useState('')

  // ─── Browser ─────────────────────────────────────────
  const [browserVisible, setBrowserVisible] = useState(false)
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)

  const browserHostRef = useRef<HTMLDivElement>(null)
  const visibleRef = useRef(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const noticeRef = useRef<HTMLDivElement>(null)
  // 会话切换竞态守卫：send() 长请求返回时比对当前会话
  const historyIdRef = useRef<string | null>(historyId)
  // 对旧会话只尝试一次：文件不存在或内容不合格时保留原始回复，避免循环 IPC。
  const materializedHistoryMessagesRef = useRef(new Set<string>())

  useEffect(() => {
    historyIdRef.current = historyId
  }, [historyId])

  // P0 阶段:Hub 主页跳转过来时可携带 prefillQuery,通过 sessionStorage 暂存
  // 消费规则：进入时填入 draft,保持 home tab,并清空暂存(避免下次刷新时重复填充)
  useEffect(() => {
    try {
      const pending = sessionStorage.getItem('aiEmployee.hubPrefill')
      if (pending && pending.trim()) {
        setDraft(pending.trim())
        // 始终切到首页,让用户确认后再发送(避免误触发)
        setActiveTab('home')
      }
      if (pending) sessionStorage.removeItem('aiEmployee.hubPrefill')
    } catch { /* ignore quota / private mode */ }
    // 仅在 mount 时消费一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 兼容此前已经保存的“完整 Markdown 报告已输出至 /tmp/...”回复：
  // 恢复正文后重新保存历史条目，因此当前页面和「工作档案」同步可见完整报告。
  useEffect(() => {
    for (const item of history) {
      item.messages.forEach((message, index) => {
        if (message.role !== 'assistant') return
        const key = `${item.id}:${index}:${message.content}`
        if (materializedHistoryMessagesRef.current.has(key)) return
        materializedHistoryMessagesRef.current.add(key)
        void window.desktop.aiEmployee.materializeMarkdownReport(message.content).then(result => {
          if (!result.materialized || !result.content || result.content === message.content) return
          setHistory(previous => {
            let changed = false
            const next = previous.map(current => {
              if (current.id !== item.id) return current
              const messages = current.messages.map((candidate, messageIndex) => {
                if (messageIndex !== index || candidate.content !== message.content) return candidate
                changed = true
                return { ...candidate, content: result.content }
              })
              return changed ? { ...current, title: conversationTitle(messages), messages } : current
            })
            if (changed) saveHistoryToStorage(next)
            return changed ? next : previous
          })
          if (historyIdRef.current === item.id) {
            setMessages(previous => previous.map((candidate, messageIndex) => (
              messageIndex === index && candidate.content === message.content
                ? { ...candidate, content: result.content }
                : candidate
            )))
          }
        }).catch(() => undefined)
      })
    }
  }, [history])

  // 兼容阶段 4 前保存的旧提取卡：仅当采购价仍为空时再请求汇率并补填，绝不覆盖用户值。
  useEffect(() => {
    if (position !== '选品调研员' || !extracted || extracted.quickMarketProfit?.purchaseCostUsd != null) return
    const facts = extracted.supplyFacts || extractSupplyFacts(extracted)
    if (!facts.purchasePriceCny) return
    let cancelled = false
    void window.desktop.aiEmployee.cnyUsdRate().then(rate => {
      if (cancelled || !rate) return
      setExtracted(current => {
        if (!current || current.quickMarketProfit?.purchaseCostUsd != null) return current
        return applyCnyPurchasePriceUsd({ ...current, supplyFacts: current.supplyFacts || facts }, rate)
      })
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [position, extracted?.url, extracted?.quickMarketProfit?.purchaseCostUsd])

  useEffect(() => {
    visibleRef.current = browserVisible
  }, [browserVisible])

  useEffect(() => {
    if (notice) noticeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [notice])

  // 加载可用模型列表；按当前工作台 position 过滤（per-position 白名单，下拉只显示岗位对应模型）
  useEffect(() => {
    let cancelled = false
    window.desktop.aiEmployee.models(position).then(list => {
      if (cancelled) return
      setModels(list)
      setModelId(current => {
        // 将旧版默认 RAGFlow 选择一次性迁移到 Amazon-Skills；用户后续仍可手动切回备用通道。
        if (position === '选品调研员' && current === 'ragflow-agent') {
          try { localStorage.setItem(`${CHAT_MODEL_KEY}:${position}`, positionDefaultModel) } catch { /* ignore quota errors */ }
          return positionDefaultModel
        }
        const hit = list.find(item => item.id === current)
        if (hit && hit.available) return current
        // 白名单过滤后列表为空（如未就绪岗位）→ 保留 current 等待后续扩展；否则回退到 positionDefaultModel
        if (list.length === 0) return current
        try { localStorage.setItem(`${CHAT_MODEL_KEY}:${position}`, positionDefaultModel) } catch { /* ignore quota errors */ }
        return positionDefaultModel
      })
    }).catch(() => { /* 模型列表加载失败时保留当前选择 */ })
    return () => { cancelled = true }
  }, [position])

  // 订阅浏览器 URL / 加载状态；占位区域尺寸变化时同步原生视图边界；卸载时隐藏视图
  useEffect(() => {
    const offUrl = window.desktop.aiEmployee.onBrowserUrl(next => setUrl(next))
    const offLoading = window.desktop.aiEmployee.onBrowserLoading(next => setLoading(next))
    const syncBounds = () => {
      const el = browserHostRef.current
      if (!el || !visibleRef.current) return
      const rect = el.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      void window.desktop.aiEmployee.browserShow({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
    }
    const observer = new ResizeObserver(syncBounds)
    if (browserHostRef.current) observer.observe(browserHostRef.current)
    window.addEventListener('resize', syncBounds)
    return () => {
      offUrl()
      offLoading()
      observer.disconnect()
      window.removeEventListener('resize', syncBounds)
      void window.desktop.aiEmployee.browserHide()
    }
  }, [])

  // 切换 tab 时同步原生浏览器视图显隐
  useEffect(() => {
    if (activeTab === 'browser' && visibleRef.current) {
      const timer = setTimeout(() => {
        const el = browserHostRef.current
        if (el) {
          const rect = el.getBoundingClientRect()
          if (rect.width > 0 && rect.height > 0) {
            void window.desktop.aiEmployee.browserShow({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
          }
        }
      }, 60)
      return () => clearTimeout(timer)
    }
    if (activeTab !== 'browser') {
      void window.desktop.aiEmployee.browserHide()
    }
  }, [activeTab])

  useEffect(() => {
    if (activeTab === 'process' || activeTab === 'home') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [messages, sending, activeTab])

  // 三件套护栏 #1：send 进行中时每 1s 刷新「已等待 Xs」显示。
  // 三件套护栏 #3：sending=true 超过 60s 后强制重置 UI 状态，避免按钮卡在「思考中…」。
  // 强化：60s 保险不再只重置 UI，还主动调 cancelChat 中断上游 fetch；
  //      避免上游占着主进程 240s CHAT_TIMEOUT_MS 浪费连接、避免用户取消按钮“未命中”现象。
  useEffect(() => {
    if (!sending) {
      setSendingElapsed(0)
      setSendingStartedAt(null)
      return undefined
    }
    const start = Date.now()
    setSendingElapsed(0)
    setSendingStartedAt(start)
    const tick = setInterval(() => {
      setSendingElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)))
    }, 1000)
    const hard = setTimeout(() => {
      // 超时同时中断上游 + 重置 UI；不抹掉「正在依据本品身份锁…」等业务提示。
      const id = execRequestId
      if (id) {
        void window.desktop.aiEmployee.cancelAsk(id).catch(() => { /* 主进程未命中时静默 */ })
      }
      setSending(false)
      setSendingStartedAt(null)
      setNotice((prev) => prev
        ? `${prev}（已等待 60s，UI 状态已自动恢复，上游已主动中断）`
        : '请求等待超过 60 秒，UI 状态已自动恢复，上游已主动中断；如需重试请点发送')
    }, SENDING_HARD_TIMEOUT_MS)
    return () => {
      clearInterval(tick)
      clearTimeout(hard)
    }
  }, [sending, execRequestId])

  // 关键 UX 修复:send 触发后立即折叠 extracted 卡片,避免 floating-composer 内容撑高覆盖 stage。
  // 之前 setExtractedCollapsed(true) 写在 send() 流程 line 1270 (payloadIssues check 之后),
  // 但市场抓取 (line 1054-1097) + enrichment (line 1303-1359) 可能持续 10-60s,期间 extracted
  // 保持展开 (来自 startExtraction line 911 setExtractedCollapsed(false)),浮动输入栏内
  // quick-profit + full-cost + entry-decision 高度 ≈ 800-1000px,几乎覆盖整个 stage,用户看不到任何报告。
  // 用 useEffect 绑定 [sending] → 折叠; sending=false 不重置 (保留用户手动 toggle 的状态)。
  // useState 闭包: 提取 floating-composer 高度也用此 hook 同步 (line 1816 的 with-floating-composer)。
  useEffect(() => {
    if (sending) {
      setExtractedCollapsed(true)
    }
  }, [sending])

  // 主动取消 send：调主进程 cancelAsk 中断上游 fetch，同时重置 UI。
  // 渲染端状态与上游 abort 解耦：cancelAsk 即便未命中（请求已自然完成）也无副作用。
  const cancelSend = useCallback(() => {
    const id = execRequestId
    if (id) {
      void window.desktop.aiEmployee.cancelAsk(id).catch(() => { /* 主进程未命中时静默 */ })
    }
    setSending(false)
    setSendingStartedAt(null)
    setSendingElapsed(0)
    setNotice((prev) => prev ? `${prev}（已主动取消）` : '已取消当前请求')
  }, [execRequestId])

  // ─── History helpers ─────────────────────────────────
  const persistConversation = useCallback((msgs: ChatMessage[], id: string) => {
    if (msgs.length < 1) return
    const title = conversationTitle(msgs)
    const now = Date.now()
    setHistory(prev => {
      const existing = prev.find(h => h.id === id)
      const item: HistoryItem = {
        id,
        title,
        roleName: agentName,
        createdAt: existing ? existing.createdAt : now,
        messages: msgs
      }
      const next = [item, ...prev.filter(h => h.id !== id)].slice(0, MAX_HISTORY)
      saveHistoryToStorage(next)
      try { localStorage.setItem(ACTIVE_HISTORY_KEY, id) } catch { /* ignore quota errors */ }
      return next
    })
  }, [position])

  const restoreExtraction = (id: string) => {
    const state = loadExtractionState(id)
    setExtracted(state?.info ?? null)
    setExtractedCollapsed(state?.collapsed ?? false)
    setExtractedConfirmed(state?.confirmed ?? false)
    setExtractedConfirmedAt(state?.confirmedAt ?? '')
    setIdentityEditorOpen(false)
    setMarketAudit(null)
  }

  const loadConversation = (item: HistoryItem) => {
    setMessages(item.messages)
    setHistoryId(item.id)
    restoreExtraction(item.id)
    try { localStorage.setItem(ACTIVE_HISTORY_KEY, item.id) } catch { /* ignore quota errors */ }
    setActiveTab('process')
  }

  const deleteHistoryItem = (id: string) => {
    setHistory(prev => {
      const next = prev.filter(h => h.id !== id)
      saveHistoryToStorage(next)
      return next
    })
    saveExtractionState(id, null)
    if (historyId === id) {
      setHistoryId(null)
      setExtracted(null)
      setExtractedCollapsed(false)
      setExtractedConfirmed(false)
      setExtractedConfirmedAt('')
      setIdentityEditorOpen(false)
      setMarketAudit(null)
    }
  }

  const openKnowledgeHome = () => {
    setActiveTab('home')
    setMessages([])
    setHistoryId(null)
    setDraft('')
    setAttachments([])
    setExtracted(null)
    setExtractedCollapsed(false)
    setExtractedConfirmed(false)
    setExtractedConfirmedAt('')
    setIdentityEditorOpen(false)
    setMarketAudit(null)
    setNotice('')
    try { localStorage.removeItem(ACTIVE_HISTORY_KEY) } catch { /* ignore storage errors */ }
  }

  const exportHistoryItem = async (item: HistoryItem, format: 'word' | 'pdf' | 'markdown') => {
    setExportNotice('')
    try {
      const result = await window.desktop.aiEmployee.exportDocument({ ...item, format })
      if (!result.canceled) setExportNotice(`已下载：${result.filePath || item.title}`)
    } catch (reason) {
      setExportNotice(readableError(reason, '文档下载失败'))
    }
  }

  // F 阶段新增：导出单条 assistant 报告为真 .docx（走 OOXML + JSZip 路径，区别于 ai-employee:export-document 的 HTML 转 .doc）
  const exportCurrentReportAsWord = async (content: string, fallbackTitle: string) => {
    if (!content || !content.trim()) {
      setExportNotice('当前消息没有可导出的报告内容')
      return
    }
    setExportNotice('')
    try {
      const result = await window.desktop.aiEmployee.exportWordReport({ title: fallbackTitle, markdown: content, roleName: agentName })
      if (result.canceled) return
      if (result.error) {
        setExportNotice(`Word 导出失败：${result.error}`)
        return
      }
      setExportNotice(`已下载 Word：${result.filePath || fallbackTitle}${result.byteSize ? `（${(result.byteSize / 1024).toFixed(1)} KB）` : ''}`)
    } catch (reason) {
      setExportNotice(readableError(reason, 'Word 导出失败'))
    }
  }

  // ─── Browser handlers ────────────────────────────────
  const toggleBrowser = () => {
    if (visibleRef.current) {
      visibleRef.current = false
      setBrowserVisible(false)
      void window.desktop.aiEmployee.browserHide()
      return
    }
    visibleRef.current = true
    setBrowserVisible(true)
    if (activeTab !== 'browser') setActiveTab('browser')
    setTimeout(() => {
      const el = browserHostRef.current
      if (el) {
        const rect = el.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) {
          void window.desktop.aiEmployee.browserShow({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
        }
      }
    }, 60)
  }

  const navigate = (event: FormEvent) => {
    event.preventDefault()
    const raw = url.trim()
    if (!raw) return
    void window.desktop.aiEmployee.browserNavigate(raw)
  }

  // ─── 附件 / 模型 ────────────────────────────────────
  const pickFiles = async () => {
    setPicking(true)
    try {
      const result = await window.desktop.aiEmployee.pickAttachments()
      let mergeSkipped = 0
      if (result.ok) {
        // 合并时按 kind 统计累计数量与 name+size 去重，超限/重复的跳过并计数
        const counts: Record<'image' | 'doc', number> = {
          image: attachments.filter(item => item.kind === 'image').length,
          doc: attachments.filter(item => item.kind === 'doc').length
        }
        const existingKeys = new Set(attachments.map(item => `${item.name}|${item.size}`))
        const accepted: AiEmployeeAttachment[] = []
        for (const item of result.attachments) {
          const key = `${item.name}|${item.size}`
          if (existingKeys.has(key) || counts[item.kind] >= ATTACHMENT_LIMITS[item.kind]) { mergeSkipped += 1; continue }
          counts[item.kind] += 1
          existingKeys.add(key)
          accepted.push(item)
        }
        if (accepted.length) setAttachments(prev => [...prev, ...accepted])
      }
      const notices = [result.message, mergeSkipped > 0 ? `已有附件达到上限或重复，跳过 ${mergeSkipped} 个` : ''].filter(Boolean)
      if (notices.length) setNotice(notices.join('；'))
    } catch (reason) {
      setNotice(readableError(reason, '读取附件失败'))
    } finally {
      setPicking(false)
    }
  }

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(item => item.id !== id))
  }

  const handleSelectModel = (id: string) => {
    setModelId(id)
    try { localStorage.setItem(`${CHAT_MODEL_KEY}:${position}`, id) } catch { /* ignore quota errors */ }
  }

  // P1-B 阶段:从商品库抽屉选中商品后预填 draft
  const handleSelectProduct = (item: ProductLibraryItem) => {
    const prefix = item.source === '1688' ? '1688' : item.source === 'local' ? '本地' : '草稿'
    const note = item.url ? `\n\n(来源：${prefix} · ${item.url})` : ''
    setDraft(`请基于已选商品「${item.title}」分析跨境市场机会。${note}`)
    setShowProductDrawer(false)
    setActiveTab('home')
  }

  // P1-B 阶段:从 1688 提取后写入商品库(供后续复用)
  const extractAndSaveToLibrary = async () => {
    setShowProductDrawer(false)
    await extract()
    // extract 成功后 extracted 已被 setExtracted 设置,此时尝试写入
    // 由于 extract 是异步且状态不可即时读取,这里用 historyId 关联的存储再次读取
    setTimeout(() => {
      try {
        const stored = JSON.parse(localStorage.getItem(EXTRACTION_STORAGE_KEY) || '{}') as Record<string, StoredExtractionState>
        const state = stored[historyId || DRAFT_EXTRACTION_ID]
        if (!state?.info) return
        const info = state.info
        addProductItem({
          source: '1688',
          title: info.title || info.url || '未命名 1688 商品',
          url: info.url,
          thumbnail: Array.isArray(info.images) && info.images[0] ? info.images[0] : undefined,
          price: info.price,
          summary: [info.seller, info.moq ? `MOQ ${info.moq}` : ''].filter(Boolean).join(' · '),
          payload: info
        })
        setNotice('已提取并加入商品库。')
      } catch { /* ignore write errors */ }
    }, 800)
  }

  const extract = async () => {
    setExtracting(true)
    setNotice('')
    try {
      const result = await window.desktop.aiEmployee.extractCurrent()
      if (result.ok) {
        let info = { ...(result.info || {}) } as ExtractedProductInfo
        if (Array.isArray(info.images) && info.images.length) {
          setNotice('正在读取商品图片文字…')
          try {
            const labels = info.images.map((image, index) => {
              const evidence = info.imageEvidence?.find(item => item.url === image)
              return evidence ? `${evidence.role}${index + 1}（${evidence.source}）` : `1688商品图片${index + 1}`
            })
            const ocr = await window.desktop.image.extractPackageText({ sourceImages: info.images, sourceLabels: labels })
            if (ocr.combinedText) info.imageOcrText = ocr.combinedText
            if (ocr.warnings?.length) info.imageOcrWarnings = ocr.warnings
            info.visualProductForm = ocr.productForm
            info.visualUseMethod = ocr.useMethod
            info.visualTargetObject = ocr.targetObject
            info.visualConfidence = ocr.visualConfidence
          } catch (error) {
            info.imageOcrWarnings = [error instanceof Error ? error.message : '图片OCR失败，请人工核对包装文字']
          }
        }
        info.supplyFacts = extractSupplyFacts(info)
        const exchangeRate = await window.desktop.aiEmployee.cnyUsdRate().catch(() => null)
        info = applyCnyPurchasePriceUsd(info, exchangeRate)
        info.amazonFinancialPreset = buildAmazonFinancialPreset(info)
        const prefilledInfo = applyAmazonFinancialPreset(info)
        const previousUrl = comparableProductUrl(extracted?.url)
        const nextUrl = comparableProductUrl(info.url)
        if (previousUrl && nextUrl && previousUrl !== nextUrl) {
          const replace = window.confirm(`当前会话已保留另一款商品：\n${extracted?.title || previousUrl}\n\n新提取商品：\n${info.title || nextUrl}\n\n是否用新商品替换当前商品事实？`)
          if (!replace) {
            setNotice('已取消替换，当前会话仍保留原商品信息。')
            return
          }
        }
        const stored: StoredExtractionState = {
          info: prefilledInfo,
          collapsed: false,
          confirmed: false,
          updatedAt: new Date().toISOString()
        }
        setExtracted(prefilledInfo)
        setExtractedCollapsed(false)
        setExtractedConfirmed(false)
        setExtractedConfirmedAt('')
        setIdentityEditorOpen(false)
        setMarketAudit(null)
        saveExtractionState(historyId || DRAFT_EXTRACTION_ID, stored)
        // 输入框只预填分析要求；完整商品信息在提取卡整全展示、发送时自动组装
        setDraft(SELECTION_ANALYSIS_REQUEST)
        const evidence = assessExtractionEvidence(prefilledInfo)
        const supplyFactConflicts = prefilledInfo.supplyFacts?.conflicts || []
        const supplyFactNotice = supplyFactConflicts.length ? `；供货信息需人工核对：${supplyFactConflicts.join('；')}` : ''
        const presetNotice = prefilledInfo.amazonFinancialPreset?.candidateCategory
          ? `；已自动预填 ${prefilledInfo.amazonFinancialPreset.candidateCategory} 的费用候选值，请核验带“暂缺填零”的项目`
          : '；未能确定 Amazon 候选类目，佣金保持待确认'
        setNotice((evidence.level === 'COMPLETE'
          ? '商品详情、图片OCR与视觉形态均已提取，证据完整。'
          : `${evidence.label}：${[...evidence.missing, ...evidence.warnings, ...evidence.conflicts].join('；') || '请人工核对商品事实。'}`) + supplyFactNotice + presetNotice)
      } else {
        setNotice(result.message || '提取失败，请确认已打开 1688 商品详情页')
      }
    } catch (reason) {
      setNotice(readableError(reason, '提取失败'))
    } finally {
      setExtracting(false)
    }
  }

  const toggleExtracted = () => {
    if (!extracted) return
    const collapsed = !extractedCollapsed
    setExtractedCollapsed(collapsed)
    saveExtractionState(historyId || DRAFT_EXTRACTION_ID, {
      info: extracted,
      collapsed,
      confirmed: extractedConfirmed,
      confirmedAt: extractedConfirmedAt || undefined,
      updatedAt: new Date().toISOString()
    })
  }

  const confirmExtracted = () => {
    if (!extracted || extractedConfirmed) return
    const evidence = assessExtractionEvidence(extracted)
    if (evidence.level !== 'COMPLETE') {
      setIdentityDraft({
        productName: extracted.confirmedProductName || extracted.title || '',
        productForm: extracted.confirmedProductForm || '',
        useMethod: extracted.confirmedUseMethod || extracted.visualUseMethod || '',
        targetObject: extracted.confirmedTargetObject || extracted.visualTargetObject || '',
        note: extracted.identityResolutionNote || ''
      })
      setIdentityEditorOpen(true)
      setExtractedCollapsed(false)
      setNotice('当前证据存在冲突或不足，请人工确认本品身份后再锁定。')
      return
    }
    const confirmedAt = new Date().toISOString()
    setExtractedConfirmed(true)
    setExtractedConfirmedAt(confirmedAt)
    saveExtractionState(historyId || DRAFT_EXTRACTION_ID, {
      info: extracted,
      collapsed: extractedCollapsed,
      confirmed: true,
      confirmedAt,
      updatedAt: confirmedAt
    })
    setNotice('当前商品事实已确认并锁定；重新提取新商品时会先要求确认替换。')
  }

  const confirmManualIdentity = (event: FormEvent) => {
    event.preventDefault()
    if (!extracted) return
    const productName = identityDraft.productName.trim()
    const productForm = identityDraft.productForm.trim()
    if (!productName || !productForm) {
      setNotice('人工确认必须填写产品名称并选择产品形态。')
      return
    }
    const confirmedAt = new Date().toISOString()
    const resolved: ExtractedProductInfo = {
      ...extracted,
      confirmedProductName: productName,
      confirmedProductForm: productForm,
      confirmedUseMethod: identityDraft.useMethod.trim(),
      confirmedTargetObject: identityDraft.targetObject.trim(),
      identityResolutionNote: identityDraft.note.trim()
    }
    setExtracted(resolved)
    setExtractedConfirmed(true)
    setExtractedConfirmedAt(confirmedAt)
    setIdentityEditorOpen(false)
    saveExtractionState(historyId || DRAFT_EXTRACTION_ID, {
      info: resolved,
      collapsed: false,
      confirmed: true,
      confirmedAt,
      updatedAt: confirmedAt
    })
    setNotice('人工身份裁决已保存并锁定；原始标题、详情、OCR和视觉冲突仍保留供追溯。')
  }

  const clearExtracted = () => {
    if (!extracted) return
    if (extractedConfirmed && !window.confirm('当前商品事实已经确认锁定。确定清除本次提取信息吗？')) return
    saveExtractionState(historyId || DRAFT_EXTRACTION_ID, null)
    setExtracted(null)
    setExtractedCollapsed(false)
    setExtractedConfirmed(false)
    setExtractedConfirmedAt('')
    setIdentityEditorOpen(false)
    setMarketAudit(null)
    setNotice('已清除当前会话的提取商品信息。')
  }

  // ─── Send ────────────────────────────────────────────
  const send = async () => {
    const requirement = draft.trim()
    if (!requirement || sending) return
    // P2 阶段:为本次请求生成 requestId,让 ExecutionPanel 隔离多轮任务
    // 三件套护栏:同一 requestId 同步到上游(cancelAsk 命中点)和渲染端(三件套按钮的取消动作)。
    const newRequestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    setExecRequestId(newRequestId)
    setExecResetSignal(s => s + 1)
    const gateMessage = selectionGenerationGate(extracted, extractedConfirmed)
    if (gateMessage) {
      setNotice(gateMessage)
      setExtractedCollapsed(false)
      return
    }
    setNotice('')
    setMarketAudit(null)
    // 提取卡在：发送前由身份锁生成多组检索词；跨词抓取后先去重、分层，仅 DIRECT 进入核心统计。
    let marketBlock = ''
    let marketDataNotice = ''
    let currentMarketAudit: MarketAuditView | null = null
    // 阶段 3+ 推算结果用闭包变量透传到阶段 4 的事实块；未取得时回退到原始 extracted 值。
    let prefilledQuickProfit: ExtractedProductInfo['quickMarketProfit'] = extracted?.quickMarketProfit
    let prefilledProfitFieldMeta: ExtractedProductInfo['profitFieldMeta'] = extracted?.profitFieldMeta
    if (extracted) {
      setSending(true)
      setNotice('正在依据本品身份锁生成 Amazon 检索词…')
      try {
        const intent = buildAmazonSearchIntent(extracted)
        const derived = await window.desktop.aiEmployee.deriveAmazonKeywords(intent)
        const plan = normalizeAmazonKeywordPlan(intent, derived)
        const collected: AmazonMarketSample[] = []
        const errors: string[] = []
        let keywordsSucceeded = 0
        for (let index = 0; index < plan.keywords.length; index += 1) {
          const keyword = plan.keywords[index]
          setNotice(`正在通过 OmkarCloud 抓取 Amazon 市场样本（${index + 1}/${plan.keywords.length}）：${keyword}`)
          const apiResult = await window.desktop.aiEmployee.amazonDataSource.search(keyword)
          const apiSamples = apiResult.samples || []
          setNotice(`正在通过 Amazon 页面补充样本（${index + 1}/${plan.keywords.length}）：${keyword}`)
          let browserSamples: AmazonMarketSample[] = []
          try {
            browserSamples = await window.desktop.aiEmployee.amazonMarketStats(keyword) || []
          } catch (error) {
            errors.push(`${keyword}：Amazon 页面补充失败（${error instanceof Error ? error.message : '未知错误'}）`)
          }
          if (apiResult.error) errors.push(`${keyword}：${apiResult.error}`)
          const samples = mergeAmazonSamples(apiSamples, browserSamples, keyword)
          if (samples?.length) {
            keywordsSucceeded += 1
            collected.push(...samples)
          }
        }
        const classified = classifyAmazonSamples(intent, collected, { keywordsRequested: plan.keywords.length, keywordsSucceeded })
        const directAsins = classified.samples.filter(sample => sample.comparisonClass === 'DIRECT').slice(0, 8).map(sample => sample.asin)
        let listingEvidence: AmazonListingEvidence[] = []
        if (directAsins.length) {
          setNotice(`正在读取 ${directAsins.length} 个 DIRECT 商品详情页证据…`)
          try {
            listingEvidence = await window.desktop.aiEmployee.amazonListingEvidence(directAsins)
          } catch (error) {
            errors.push(`Amazon 商品详情页取证失败（${error instanceof Error ? error.message : '未知错误'}）`)
          }
        }
        let reviewEvidence: AmazonReviewEvidence[] = []
        if (directAsins.length) {
          setNotice(`正在读取 ${Math.min(directAsins.length, 5)} 个 DIRECT 商品评论页样本…`)
          try {
            reviewEvidence = await window.desktop.aiEmployee.amazonReviewEvidence(directAsins)
          } catch (error) {
            errors.push(`Amazon 商品评论页取证失败（${error instanceof Error ? error.message : '未知错误'}）`)
          }
        }
        // 阶段 3+：用 DIRECT 详情页中第一个带重量/尺寸的样本推算 FBA 履约费，预填给阶段 4。
        // 已有用户修改（origin==='用户修改'）不覆盖；只有“系统预设/暂缺填零”才被替换。
        const weightedListing = listingEvidence.find(item => item.itemWeightGrams || item.packageDimensionsCm)
        if (weightedListing) {
          const estimate = estimateFbaFulfillmentFee({
            weightGrams: weightedListing.itemWeightGrams ?? null,
            dimensionsCm: weightedListing.packageDimensionsCm ?? null,
            sizeTier: weightedListing.sizeTierGuess ?? null,
            priceUsd: weightedListing.price ?? null
          })
          const fbaMeta = extracted.profitFieldMeta?.fbaFulfillmentFeeUsd
          if (estimate.feeUsd != null && fbaMeta?.origin !== '用户修改') {
            prefilledQuickProfit = { ...extracted.quickMarketProfit, fbaFulfillmentFeeUsd: Number(estimate.feeUsd.toFixed(2)) }
            prefilledProfitFieldMeta = {
              ...extracted.profitFieldMeta,
              fbaFulfillmentFeeUsd: {
                origin: '系统预设',
                evidenceLevel: '分析假设',
                source: `${estimate.source}；证据来源 Amazon 详情页 ${weightedListing.asin}（${weightedListing.title?.slice(0, 40) || weightedListing.url}，采买日期 ${weightedListing.capturedAt.slice(0, 10)}）`,
                updatedAt: new Date().toISOString(),
                decisionEligible: false,
                note: '使用 Amazon US 2024-09 生效费率表推算，须以 Amazon Revenue Calculator 复核；不同类目（Apparel/Dangerous Goods）会加价'
              }
            }
            setExtracted(current => current ? { ...current, quickMarketProfit: prefilledQuickProfit, profitFieldMeta: prefilledProfitFieldMeta } : current)
            saveExtractionState(historyId || DRAFT_EXTRACTION_ID, { info: { ...extracted, quickMarketProfit: prefilledQuickProfit, profitFieldMeta: prefilledProfitFieldMeta }, collapsed: extractedCollapsed, confirmed: extractedConfirmed, confirmedAt: extractedConfirmedAt || undefined, updatedAt: new Date().toISOString() })
            if (estimate.warnings.length) errors.push(`FBA 推算：${estimate.warnings.join('；')}`)
          } else if (estimate.feeUsd == null) {
            errors.push(`FBA 推算未命中（${estimate.warnings.join('；')}）；已保持“暂缺填零”，阶段 5 结论不会因 FBA 费用被算作入场依据`)
          }
        }
        // 阶段 3+：大模型提炼差异化与合规/IP 核验依据。已有人工修改的字段不覆盖；失败/超时/JSON 坏值 → 保留 1688 页面原措辞。
        if (listingEvidence.length || reviewEvidence.length) {
          setNotice('正在用大模型提炼差异化与合规/IP 核验依据…')
          let inferResult: { differentiation: string; compliance: string; model: string; provider: string } | null = null
          try {
            const raw = await window.desktop.aiEmployee.inferEvidence({
              intent,
              listingEvidence,
              reviewEvidence,
              sourceText: {
                title: extracted.title || '',
                productForm: extracted.confirmedProductForm || extracted.visualProductForm || '',
                useMethod: extracted.confirmedUseMethod || extracted.visualUseMethod || '',
                targetObject: extracted.confirmedTargetObject || extracted.visualTargetObject || '',
                attributes: extracted.attributes || [],
                detailText: extracted.detailText || ''
              }
            })
            if (raw && typeof raw === 'object' && 'differentiation' in raw && 'compliance' in raw) {
              const r = raw as { differentiation: string; compliance: string; model?: string; provider?: string }
              if (typeof r.differentiation === 'string' && typeof r.compliance === 'string' && r.differentiation.length >= 8 && r.compliance.length >= 8) {
                inferResult = { differentiation: r.differentiation, compliance: r.compliance, model: r.model || 'unknown', provider: r.provider || 'unknown' }
              }
            }
          } catch (inferError) {
            errors.push(`大模型提炼调用失败（${inferError instanceof Error ? inferError.message : '未知错误'}）`)
          }
          if (inferResult) {
            const differentiationMeta = extracted.profitFieldMeta?.differentiationEvidence
            const complianceMeta = extracted.profitFieldMeta?.complianceIpEvidence
            const inferenceSource = `${inferResult.model}（${inferResult.provider}）提炼自 ${listingEvidence.length} 条 Amazon 详情页 + ${reviewEvidence.length} 条评论样本`
            const nextEntryDecision = { ...(extracted.entryDecision || {}) }
            const nextMeta = { ...prefilledProfitFieldMeta }
            let updated = 0
            if (differentiationMeta?.origin !== '用户修改' && (nextEntryDecision.differentiationEvidence || '').trim().length < 8) {
              nextEntryDecision.differentiationEvidence = inferResult.differentiation
              nextMeta.differentiationEvidence = {
                origin: '系统预设',
                evidenceLevel: '分析假设',
                source: inferenceSource,
                updatedAt: new Date().toISOString(),
                decisionEligible: true
              }
              updated += 1
            }
            if (complianceMeta?.origin !== '用户修改' && (nextEntryDecision.complianceIpEvidence || '').trim().length < 8) {
              nextEntryDecision.complianceIpEvidence = inferResult.compliance
              nextMeta.complianceIpEvidence = {
                origin: '系统预设',
                evidenceLevel: '分析假设',
                source: inferenceSource,
                updatedAt: new Date().toISOString(),
                decisionEligible: true
              }
              updated += 1
            }
            if (updated > 0) {
              prefilledProfitFieldMeta = nextMeta
              const nextExtracted = { ...extracted, entryDecision: nextEntryDecision, profitFieldMeta: nextMeta }
              setExtracted(current => current ? { ...current, entryDecision: nextEntryDecision, profitFieldMeta: nextMeta } : current)
              saveExtractionState(historyId || DRAFT_EXTRACTION_ID, { info: nextExtracted, collapsed: extractedCollapsed, confirmed: extractedConfirmed, confirmedAt: extractedConfirmedAt || undefined, updatedAt: new Date().toISOString() })
              errors.push(`差异化/合规已由 ${inferResult.model} 提炼（${updated} 项）`)
            } else {
              errors.push('大模型提炼已返回但用户已手动填写相应字段，未覆盖')
            }
          } else {
            errors.push('大模型提炼差异化/合规未命中（超时/JSON 坏值/未配置 key）；已保留 1688 页面原措辞，仅供人工核验')
          }
        }
        currentMarketAudit = { keywords: plan.keywords, audit: classified.audit, source: plan.source, samples: classified.samples, listingEvidence, reviewEvidence }
        marketDataNotice = errors.length ? errors.join('；') : 'OmkarCloud API 优先；Amazon 页面仅补充缺失字段'
        setMarketAudit(currentMarketAudit)
        marketBlock = `${extracted ? buildProductBasicsBlock(extracted) + '\n\n' : ''}${buildComparableMarketFactBlock(intent, plan, classified.samples, classified.audit)}\n\n${buildCompetitorReviewInsights(classified.samples, reviewEvidence)}\n\n${buildCompetitorListingSummary(classified.samples, listingEvidence)}\n\n${buildAmazonQuickMarketProfitFactBlock(intent, classified.samples, prefilledQuickProfit, prefilledProfitFieldMeta)}\n\n${buildAmazonFullCostProfitFactBlock(intent, classified.samples, prefilledQuickProfit, extracted.fullCostProfit, prefilledProfitFieldMeta)}\n\n${buildAmazonEntryDecisionFactBlock(intent, classified.samples, classified.audit, prefilledQuickProfit, extracted.fullCostProfit, extracted.entryDecision, prefilledProfitFieldMeta)}`
        if (!classified.audit.rawCount) {
          const detail = errors.length ? `（${errors.join('；')}）` : '（接口未返回有效样本）'
          // 空样本仍需生成受事实块约束的“数据不足”报告，列清补数任务，
          // 而不是中断会话或把空样本伪装成可决策结论。
          setNotice(`Amazon 市场数据未取得${detail}；将生成“数据不足，不能判定”报告并列出补数任务`)
        }
        else setNotice(`Amazon 样本已审计：直接竞品 ${classified.audit.directCount}，详情页证据 ${listingEvidence.length} 条，评论页样本 ${reviewEvidence.length} 条，替代方案 ${classified.audit.adjacentCount}，排除 ${classified.audit.excludedCount}`)
      } catch (error) {
        const reason = error instanceof Error ? error.message : '未知错误'
        // 调研员的交付不能因市场数据源整体不可用而中断：继续生成结构完整的预备报告，
        // 并把未取得的数据明确标为“待验证”。非调研员请求仍保持原来的中断行为。
        if (position === '选品调研员') {
          const basicsBlock = extracted ? buildProductBasicsBlock(extracted) + '\n\n' : ''
          marketBlock = `${basicsBlock}【Amazon 市场数据抓取状态】\n本次抓取失败：${reason}\n销量、销售额、BSR、趋势、竞品样本与平台费用均为待验证；请在报告中列为补数任务，不得推断或编造。`
          marketDataNotice = `市场抓取失败：${reason}`
          setNotice(`Amazon市场数据抓取失败：${reason}；将继续生成并保存“数据不足，不能判定”的预备报告`)
        } else {
          setSending(false)
          setNotice(`Amazon市场数据抓取失败，已阻止生成不完整报告：${reason}`)
          return
        }
      }
    }
    // 当前选品调研员的市场数据与六部分报告合同仅支持 Amazon 美国站。
    // 不能让曾点过的 eBay 等快捷按钮覆盖已抓取的 Amazon 事实块，否则会出现
    // “Amazon 样本 + eBay 标题校验”的跨平台矛盾。
    const targetPlatform = extracted ? 'Amazon美国站' : reportPlatform(platform || requirement)
    // 将唯一、固化的平台显式写入本次请求；后续标题、元数据和保存校验均使用同一值。
    // 阶段 3+ 推算出的 FBA 履约费通过 prefilledInfo 透传给 reportPayload，保证事实包与用户界面一致。
    const prefilledInfo = extracted ? { ...extracted, quickMarketProfit: prefilledQuickProfit, profitFieldMeta: prefilledProfitFieldMeta } : null
    const entryDecision = extracted && currentMarketAudit
      ? evaluateAmazonEntryDecision(buildAmazonSearchIntent(extracted), currentMarketAudit.samples, currentMarketAudit.audit, prefilledQuickProfit, extracted.fullCostProfit, extracted.entryDecision, prefilledProfitFieldMeta).decision
      : '❓ 数据不足，不能判定' as const
    const reportPayload = prefilledInfo
      ? createSelectionReportPayload({ info: prefilledInfo, targetPlatform, keywords: currentMarketAudit?.keywords, audit: currentMarketAudit?.audit, samples: currentMarketAudit?.samples, listingEvidence: currentMarketAudit?.listingEvidence, reviewEvidence: currentMarketAudit?.reviewEvidence, decision: entryDecision, marketDataNotice })
      : null
    const payloadIssues = reportPayload ? validateSelectionReportPayload(reportPayload) : []
    // 结构事实包不能有错列、丢表或空行；失败时不向模型发送损坏合同。
    if (payloadIssues.length) {
      setSending(false)
      setNotice(`报告结构事实包校验失败：${payloadIssues.join('；')}`)
      return
    }
    const factPackage = `${prefilledInfo ? `${buildProductIdentityLock(prefilledInfo)}
${buildSelectionInfoText(prefilledInfo)}
${requirement}` : requirement}${marketBlock ? `
${marketBlock}` : ''}${reportPayload ? `
${selectionReportPayloadFactBlock(reportPayload)}` : ''}`
    // 阶段2：两岗位只通过同一份事实包协作，报告结构来自阶段1格式合同。
    const text = extracted && position === '选品调研员'
      ? buildSelectionReportCollaborationPrompt(factPackage, targetPlatform)
      : `${factPackage}\n目标平台：${targetPlatform}\n交付要求：完整 Markdown 报告必须直接写入本次聊天回复，不得只返回 /tmp 等本地文件路径。`
    const outgoingAttachments = attachments
    // 本品身份、三组检索词、DIRECT 样本和目标平台均已在本次请求中固化。
    // 正式 Amazon 报告不携带旧助手报告，避免历史 eBay 标题/元数据污染模型输出。
    const prevHistory = extracted ? [] : messages.slice(-10).map(item => ({ role: item.role, content: item.content }))
    const nextMessages: ChatMessage[] = [...messages, {
      role: 'user',
      content: text,
      targetPlatform,
      attachments: outgoingAttachments.length > 0
        ? outgoingAttachments.map(item => ({ id: item.id, name: item.name, kind: item.kind, size: item.size }))
        : undefined
    }]
    setMessages(nextMessages)
    // 首页发出首条提问后进入工作处理：会话归属工作处理，员工大全按钮恢复未选中
    setActiveTab(tab => (tab === 'home' ? 'process' : tab))
    setDraft('')
    setExtractedCollapsed(true)
    setPlatform('')
    setSending(true)
    // 请求发出后清空待发送附件
    setAttachments([])
    // 图片附件 + 非视觉模型：提示将由千问视觉模型描述后并入提问
    const selectedModel = models.find(item => item.id === modelId)
    if (outgoingAttachments.some(item => item.kind === 'image') && !(selectedModel?.supportsVision)) {
      setNotice('图片附件将由千问视觉模型描述后并入提问')
    }

    // 首次发送创建会话 ID
    const convId = historyId || `conv-${Date.now()}`
    if (!historyId) {
      setHistoryId(convId)
      // 模型可能立即返回；同步引用，避免首条回复只写入档案而不显示在当前会话。
      historyIdRef.current = convId
    }
    if (extracted) {
      saveExtractionState(convId, {
        info: extracted,
        collapsed: true,
        confirmed: extractedConfirmed,
        confirmedAt: extractedConfirmedAt || undefined,
        updatedAt: new Date().toISOString()
      })
      if (!historyId) saveExtractionState(DRAFT_EXTRACTION_ID, null)
    }
    // 请求发出前先保存用户消息；即使等待期间界面重载，也不会整段会话消失。
    persistConversation(nextMessages, convId)

    // 阶段6：报告结构仍由系统事实包确定性渲染。模型只能返回经 JSON 校验的“待验证假设/验证任务”；
    // 任意模型失败、输出自由 Markdown 或越过事实边界时，立即丢弃其内容并回退基础报告。
    if (extracted && position === '选品调研员' && reportPayload) {
      try {
        let enrichment = null
        const enrichmentModelIds = [...new Set([modelId, ...REPORT_REPAIR_MODEL_IDS])]
          .filter(id => id === modelId || models.some(model => model.id === id && model.available))
        const requestEnrichment = async (enrichmentModelId: string) => {
          try {
            setNotice(`正在由 ${enrichmentModelId} 生成受控分析补充…`)
            const result = await window.desktop.aiEmployee.ask({
              query: selectionReportEnrichmentPrompt(reportPayload),
              history: [],
              modelId: enrichmentModelId,
              attachments: [],
              // I.4 阶段新增：报告增强同样让 MaxKB 智能体可参考 4 样例 + 门禁
              useSampleLibrary,
              // 三件套护栏：共享 send() 的 requestId，让 cancelSend 能取消 enrich 路径的上游。
              requestId: newRequestId
            })
            return parseSelectionReportEnrichment(result.content, enrichmentModelId, reportPayload.listingEvidence?.map(item => item.asin) || [])
          } catch {
            return null
          }
        }
        const primaryModelId = enrichmentModelIds[0]
        if (primaryModelId) enrichment = await requestEnrichment(primaryModelId)
        // 主模型发生错误或越过事实边界时，同时请求 DeepSeek 等修正模型；
        // 无论修正是否成功，后续都必须交付系统固定模板的报告。
        if (!enrichment) {
          const repairModels = enrichmentModelIds.slice(1)
          const repairResults = await Promise.all(repairModels.map(requestEnrichment))
          enrichment = repairResults.find(Boolean) || null
        }
        const deterministicContent = renderSelectionReportMarkdown(reportPayload, enrichment)
        const renderIssues = [
          ...validateRenderedSelectionReport(deterministicContent),
          ...validateSelectionReportPlatform(deterministicContent, targetPlatform)
        ]
        if (renderIssues.length) throw new Error(`确定性报告渲染校验失败：${renderIssues.join('；')}`)
        const withResponse: ChatMessage[] = [...nextMessages, { role: 'assistant', content: deterministicContent, targetPlatform }]
        if (historyIdRef.current === convId) setMessages(withResponse)
        persistConversation(withResponse, convId)
        const enrichmentNotice = enrichment ? `；已附加 ${enrichment.sourceModelId} 的受控待验证建议` : '；模型补充未通过边界校验，已保留基础事实报告'
        setNotice((reportPayload.status === '正式' ? '标准分析报告已按固定模板生成并保存。' : '预备分析报告已按固定模板生成并保存；待验证项已保留在对应表格中。') + enrichmentNotice)
      } catch {
        const fallbackContent = renderSelectionReportFallback(reportPayload.productName, targetPlatform)
        const fallbackIssues = [
          ...validateRenderedSelectionReport(fallbackContent),
          ...validateSelectionReportPlatform(fallbackContent, targetPlatform)
        ]
        const withFallback: ChatMessage[] = [...nextMessages, { role: 'assistant', content: fallbackContent, targetPlatform }]
        if (historyIdRef.current === convId) setMessages(withFallback)
        persistConversation(withFallback, convId)
        setNotice(`报告生成遇到异常，已按固定模板保存预备报告；待验证项需重新核验。${fallbackIssues.length ? '模板兜底校验异常已记录，禁止据此作入场决策。' : ''}`)
      } finally {
        setSending(false)
      }
      return
    }

    try {
      const result = await window.desktop.aiEmployee.ask({ query: text, history: prevHistory, modelId, attachments: outgoingAttachments, useSampleLibrary, requestId: newRequestId })
      // 报告已返回，清除抓取阶段提示；抓取失败时的提示仍会在请求阶段保留。
      setNotice('')
      const validateReport = (content: string) => [
        ...(extracted ? validateSelectionReportIdentity(content, extracted) : []),
        ...(extracted ? validateSelectionReportEvidence(content, extracted) : []),
        ...(currentMarketAudit ? validateAmazonMarketClaims(content, currentMarketAudit.audit) : []),
        ...(currentMarketAudit && extracted ? validateAmazonEntryDecisionClaim(content, evaluateAmazonEntryDecision(buildAmazonSearchIntent(extracted), currentMarketAudit.samples || [], currentMarketAudit.audit, extracted.quickMarketProfit, extracted.fullCostProfit, extracted.entryDecision, extracted.profitFieldMeta).decision) : [])
      ]
      let candidateContent = result.content
      let qualityIssues = validateReport(candidateContent)
      let repairError = ''
      // 报告交付法则：当前模型失败后，同时请求 DeepSeek Chat、通义中可用者。
      // 修正模型只能重写基于当前事实的报告，不能继承旧助手报告或用记忆补全未知字段。
      for (let repairAttempt = 1; qualityIssues.length && repairAttempt <= 2; repairAttempt += 1) {
        const repairModelIds = [...new Set([modelId, ...REPORT_REPAIR_MODEL_IDS])].filter(id => id === modelId || models.some(model => model.id === id && model.available))
        setNotice(`报告第 ${repairAttempt} 次校验未通过，正在并行调用 ${repairModelIds.join('、')} 自动修正…`)
        const repairQuery = [
          '【报告自动质量修正】',
          `这是第 ${repairAttempt} 次修正。上一版报告未通过系统校验。请输出完整重写后的 Markdown 报告，不要解释修改过程，不得缩减原有六部分和固定表格。必须直接输出完整 Markdown 正文，不得仅将报告写入 /tmp 或返回本地文件路径。`,
          selectionReportConsensusInstruction(),
          currentMarketAudit?.audit.salesSignalCount
            ? `系统仅提供 ${currentMarketAudit.audit.salesSignalCount} 个 DIRECT 样本的 Amazon 搜索页“过去一个月购买量”徽标，下限合计 ${currentMarketAudit.audit.salesSignalLowerBound.toLocaleString('en-US')}+。这只能写成“Amazon 搜索页购买徽标下限/购买信号”，不得改写为精确月销量或完整市场销量；销售额、BSR、趋势、CPC、上架时间、合规或专利结论仍一律写“待验证”。`
            : '系统未提供的销量、销售额、BSR、趋势、CPC、上架时间、合规或专利结论一律写“待验证”，禁止用约数、区间或模型记忆补齐。',
          '系统没有抓取评论正文，不得生成高频好评、高频差评、评论引语或据此推导痛点；系统没有完成官方合规、知识产权、HTS编码或FBA计算器核验，不得写确定性结论、办理成本与周期。',
          '当前 Amazon 数据是3个搜索词下的 DIRECT 搜索样本，不是叶子类目完整TOP50。所有表格与结论必须改称“DIRECT样本”；不得出现“TOP50均价/销量/销售额”等已验证数值。',
          '竞品的认证、专利、兽医背书、A+内容、退货率、配送稳定性等未被系统抓取的属性同样必须写“待验证”，不得按品牌常识补全。',
          '单位经济必须逐列复算：毛利润=实收收入-采购包装质检-国内物流头程关税；贡献利润=实收收入-单件综合总成本，若广告已经计入综合总成本不得再次扣除。',
          '若本品事实中缺少包装尺寸或毛重，FBA费用不可复算，最终入场结论必须选择“❓ 数据不足，不能判定”，并列出补数任务。',
          '只有系统明确标注的 DIRECT 样本可进入本品核心竞品统计；ADJACENT 只能作为替代方案，不得改写本品形态。',
          `未通过项：\n${qualityIssues.map(issue => `- ${issue}`).join('\n')}`,
          `本次用户要求与系统事实：\n${text}`
       ].join('\n\n')
        const repaired = await Promise.allSettled(repairModelIds.map(repairModelId => window.desktop.aiEmployee.ask({ query: repairQuery, history: [], modelId: repairModelId, attachments: [], requestId: newRequestId })))
        const candidates = repaired.flatMap((result, index) => result.status === 'fulfilled'
          ? [{ content: result.value.content, modelId: repairModelIds[index], issues: validateReport(result.value.content) }]
          : [])
        const rankedCandidates = rankSelectionReportCandidates(candidates, repairModelIds)
        const accepted = rankedCandidates.find(candidate => candidate.issues.length === 0)
        if (accepted) {
          candidateContent = accepted.content
          qualityIssues = []
          break
        }
        const best = rankedCandidates[0]
        if (best) {
          candidateContent = best.content
          qualityIssues = best.issues
        }
        const errors = repaired.flatMap((result, index) => result.status === 'rejected' ? [`${repairModelIds[index]}：${readableError(result.reason)}`] : [])
        repairError = [...errors, ...candidates.map(candidate => `${candidate.modelId}：${candidate.issues.length} 项质量问题`)].join('；') || '所有自动修正模型均未返回可用报告'
      }
      if (qualityIssues.length && extracted) {
        let sanitized = candidateContent
        for (let pass = 0; pass < 2; pass += 1) {
          const next = sanitizeAmazonMarketClaims(sanitizeSelectionReportEvidence(sanitized, extracted, targetPlatform), currentMarketAudit?.audit)
          if (next === sanitized) break
          sanitized = next
        }
        const sanitizedIssues = validateReport(sanitized)
        candidateContent = sanitized
        qualityIssues = sanitizedIssues
      }
      let normalizedContent = qualityIssues.length
        ? extracted && position === '选品调研员'
          ? buildGuaranteedPreliminaryReport(extracted, currentMarketAudit, targetPlatform, [...qualityIssues, repairError].filter(Boolean))
          : `⚠️ 报告未通过正式报告质量校验。\n\n${qualityIssues.map(issue => `- ${issue}`).join('\n')}${repairError ? `\n- 自动修正请求失败：${repairError}` : ''}`
        // 质量门禁已通过时，标题和目标平台属于系统所有字段，不能再让模型文本决定。
        // force=true 覆盖模型的 eBay/旧标题，即便其章节名称不符合旧版固定模板。
        : normalizeSelectionReport(candidateContent, targetPlatform, extracted?.confirmedProductName, text, true)
      if (!qualityIssues.length) {
        const platformIssues = validateSelectionReportPlatform(normalizedContent, targetPlatform)
        if (platformIssues.length) {
          normalizedContent = `⚠️ 报告未通过平台一致性校验，未保存为正式报告。\n\n${platformIssues.map(issue => `- ${issue}`).join('\n')}`
          qualityIssues = platformIssues
        }
      }
      if (qualityIssues.length) setNotice(extracted && position === '选品调研员'
        ? '自动修正模型均未通过质量门禁，已交付并保存系统事实驱动的预备分析报告。'
        : `报告自动修正后仍未通过：${qualityIssues.join('；')}`)
      else setNotice('')
      const withResponse: ChatMessage[] = [...nextMessages, { role: 'assistant', content: normalizedContent, targetPlatform }]
      if (historyIdRef.current === convId) {
        setMessages(withResponse)
        persistConversation(withResponse, convId)
      } else {
        // 等待期间已切换到其它会话：仅持久化原会话，不覆盖当前界面
        persistConversation(withResponse, convId)
      }
    } catch (reason) {
      const withError: ChatMessage[] = [...nextMessages, { role: 'assistant', content: '⚠️ ' + readableError(reason), targetPlatform }]
      if (historyIdRef.current === convId) {
        setMessages(withError)
        persistConversation(withError, convId)
      } else {
        persistConversation(withError, convId)
      }
    } finally {
      setSending(false)
    }
  }

  // 平台快捷选择：点选时实时替换输入框「在 XX」处的平台名（站点部分由用户人工编辑），取消选择回亚马逊
  const selectPlatform = (item: string) => {
    const next = platform === item ? '' : item
    setDraft(current => applyPlatformToRequest(current, next))
    setPlatform(next)
  }

  const extractedText = (key: 'title' | 'price' | 'seller' | 'moq' | 'shipFrom' | 'deals' | 'analysisDate') => {
    const value = extracted?.[key]
    return value ? String(value) : '—'
  }
  const extractedAttributes = extracted && Array.isArray(extracted.attributes) ? extracted.attributes : []
  const extractedUrl = extracted?.url ? String(extracted.url) : ''
  const extractedImageCount = extracted && Array.isArray(extracted.images) ? extracted.images.length : 0
  const extractedEvidence = extracted ? assessExtractionEvidence(extracted) : null
  const extractedImageEvidence = extracted?.images?.map((url, index) => {
    const evidence = extracted.imageEvidence?.find(item => item.url === url)
    return evidence || { url, role: index === 0 ? '主图' as const : '详情图' as const, source: '1688商品页' }
  }) || []
  const quickProfit = extracted?.quickMarketProfit || {}
  const fullCostProfit = extracted?.fullCostProfit || {}
  const entryDecision = extracted?.entryDecision || {}
  const profitFieldMeta = extracted?.profitFieldMeta || {}
  const profitFieldHint = (key: ProfitFieldKey) => {
    const meta = profitFieldMeta[key]
    return meta ? `${meta.origin}｜${meta.evidenceLevel}${meta.decisionEligible ? '' : '｜不可作为正向入场依据'}` : '待填写'
  }
  const updateQuickProfit = (field: keyof AmazonQuickMarketProfitInput, value: string) => {
    if (!extracted) return
    const parsed = value.trim() === '' ? undefined : Number(value)
    const next: ExtractedProductInfo = { ...extracted, quickMarketProfit: { ...quickProfit, [field]: Number.isFinite(parsed) ? parsed : undefined }, profitFieldMeta: { ...extracted.profitFieldMeta, [field]: userEditedProfitFieldMeta() } }
    setExtracted(next)
    saveExtractionState(historyId || DRAFT_EXTRACTION_ID, { info: next, collapsed: extractedCollapsed, confirmed: extractedConfirmed, confirmedAt: extractedConfirmedAt || undefined, updatedAt: new Date().toISOString() })
  }
  const updateFullCost = (field: keyof AmazonFullCostInput, range: keyof AmazonCostRange, value: string) => {
    if (!extracted) return
    const parsed = value.trim() === '' ? undefined : Number(value)
    const metaKey = `${field}.${range}` as ProfitFieldKey
    const next: ExtractedProductInfo = { ...extracted, fullCostProfit: { ...fullCostProfit, [field]: { ...(fullCostProfit[field] || {}), [range]: Number.isFinite(parsed) ? parsed : undefined } }, profitFieldMeta: { ...extracted.profitFieldMeta, [metaKey]: userEditedProfitFieldMeta() } }
    setExtracted(next)
    saveExtractionState(historyId || DRAFT_EXTRACTION_ID, { info: next, collapsed: extractedCollapsed, confirmed: extractedConfirmed, confirmedAt: extractedConfirmedAt || undefined, updatedAt: new Date().toISOString() })
  }
  const updateEntryDecision = (field: keyof AmazonEntryDecisionInput, value: string) => {
    if (!extracted) return
    const nextValue = field === 'targetContributionMargin' ? (value === '' ? undefined : Number(value)) : value
    const next: ExtractedProductInfo = { ...extracted, entryDecision: { ...entryDecision, [field]: nextValue }, profitFieldMeta: { ...extracted.profitFieldMeta, [field]: userEditedProfitFieldMeta() } }
    setExtracted(next)
    saveExtractionState(historyId || DRAFT_EXTRACTION_ID, { info: next, collapsed: extractedCollapsed, confirmed: extractedConfirmed, confirmedAt: extractedConfirmedAt || undefined, updatedAt: new Date().toISOString() })
  }

  // 工作档案按岗位隔离：独立工作台只展示本岗位的历史会话
  const visibleHistory = history.filter(item => item.roleName === position)

  // 浮动输入栏：顶部角色行恢复为图标+名称导航（当前岗位高亮，点其它可用员工跳转其独立工作台）
  const renderComposer = () => (
    <div className="ai-employee-floating-composer">
      {/* 角色行：当前岗位高亮；占位员工灰态不可点；可用员工各有独立工作台不互列（跨台走员工大全） */}
      <div className="ai-employee-role-chips">
        {AGENTS.filter(agent => agent.name === position || !agent.ready).map(agent => (
          <button
            key={agent.name}
            type="button"
            className={`ai-employee-role-chip${agent.name === position ? ' active' : ''}${agent.ready ? '' : ' disabled'}`}
            disabled={!agent.ready}
            onClick={() => { if (agent.name !== position) onNavigatePosition?.(agent.name) }}
          >
            <i style={{ background: agent.color }}>{agent.icon}</i>
            <b>{agent.name}</b>
          </button>
        ))}
      </div>
      {/* 提取结果卡（条件显示） */}
      {notice && <div ref={noticeRef} className="ai-employee-notice">{notice}{sending && sendingElapsed > 0 ? `（已等待 ${sendingElapsed}s）` : ''}</div>}
      {marketAudit && (
        <section className="ai-employee-market-audit" aria-label="Amazon 样本可比性审计">
          <header><b>Amazon 样本可比性</b><span className={`confidence ${marketAudit.audit.confidence === '可决策' ? 'high' : marketAudit.audit.confidence === '中等' ? 'medium' : 'low'}`}>结论置信度：{marketAudit.audit.confidence}</span></header>
          <div className="ai-employee-market-audit-counts">
            <span>原始样本 <b>{marketAudit.audit.rawCount}</b></span>
            <span>自然位 <b>{marketAudit.audit.organicCount}</b></span>
            <span className="sponsored">赞助位 <b>{marketAudit.audit.sponsoredCount}</b></span>
            <span>ASIN 去重 <b>{marketAudit.audit.uniqueCount}</b></span>
            <span className="direct">DIRECT <b>{marketAudit.audit.directCount}</b></span>
            <span className="adjacent">ADJACENT <b>{marketAudit.audit.adjacentCount}</b></span>
            <span className="excluded">已排除 <b>{marketAudit.audit.excludedCount}</b></span>
          </div>
          <div className="ai-employee-market-audit-coverage">
            <span>样本完整率 <b>{marketAudit.audit.coveragePercent}%</b></span>
            <span>检索词成功 <b>{marketAudit.audit.keywordsSucceeded}/{marketAudit.audit.keywordsRequested}</b></span>
            <span>核心字段覆盖 <b>{marketAudit.audit.fieldCoveragePercent}%</b></span>
            <span>研究样本 <b>{meetsAmazonResearchSampleBaseline(marketAudit.audit) ? '已达标，可评估竞争力' : '需补数'}</b></span>
          </div>
          <div className="ai-employee-market-audit-keywords">
            <small>{marketAudit.source === 'model' ? '模型生成并经身份规则清洗' : '身份规则确定性生成'}</small>
            {marketAudit.keywords.map(keyword => <span key={keyword}>{keyword}</span>)}
          </div>
          {marketAudit.audit.confidence === '低' && <p>DIRECT 少于 15 个：仅作方向性参考，不得写成 TOP50 或完整市场结论。</p>}
        </section>
      )}
      {extracted && (
        <div className="ai-employee-extracted">
          <header>
            <div className="ai-employee-extracted-heading">
              <b>已提取商品信息</b>
              <span className={extractedConfirmed ? 'confirmed' : 'pending'}>{extractedConfirmed ? '已确认锁定' : '待确认'}</span>
              {extractedEvidence && <span className={`evidence ${extractedEvidence.level.toLowerCase()}`}>{extractedEvidence.label}</span>}
            </div>
            <div className="ai-employee-extracted-actions">
              <button type="button" disabled={extractedConfirmed} onClick={confirmExtracted}>{extractedConfirmed ? '已确认' : '确认并锁定'}</button>
              <button type="button" disabled={extracting} onClick={() => void extract()}>{extracting ? '提取中…' : '重新提取'}</button>
              <button type="button" className="danger" onClick={clearExtracted}>清除</button>
              <button type="button" onClick={toggleExtracted}>{extractedCollapsed ? '展开' : '收起'}</button>
            </div>
          </header>
          {!extractedCollapsed && identityEditorOpen && (
            <form className="ai-employee-identity-editor" onSubmit={confirmManualIdentity}>
              <div className="ai-employee-identity-editor-heading">
                <b>人工确认本品身份</b>
                <span>只裁决本品身份，不覆盖原始提取证据</span>
              </div>
              <div className="ai-employee-identity-fields">
                <label>产品名称<input aria-label="人工确认产品名称" value={identityDraft.productName} onChange={event => setIdentityDraft(current => ({ ...current, productName: event.target.value }))} required /></label>
                <label>产品形态<select aria-label="人工确认产品形态" value={identityDraft.productForm} onChange={event => setIdentityDraft(current => ({ ...current, productForm: event.target.value }))} required>
                  <option value="">请选择</option><option>液体精华</option><option>湿巾</option><option>泡沫</option><option>喷雾</option><option>膏体</option><option>粉末</option><option>固体</option><option>其他</option>
                </select></label>
                <label>使用方式<input aria-label="人工确认使用方式" value={identityDraft.useMethod} onChange={event => setIdentityDraft(current => ({ ...current, useMethod: event.target.value }))} /></label>
                <label>适用对象<input aria-label="人工确认适用对象" value={identityDraft.targetObject} onChange={event => setIdentityDraft(current => ({ ...current, targetObject: event.target.value }))} /></label>
                <label className="wide">裁决说明<input aria-label="人工确认裁决说明" value={identityDraft.note} onChange={event => setIdentityDraft(current => ({ ...current, note: event.target.value }))} placeholder="例如：以包装袋出液口、详情说明和实物样品为准" /></label>
              </div>
              <div className="ai-employee-identity-editor-actions">
                <button type="button" onClick={() => setIdentityEditorOpen(false)}>取消</button>
                <button type="submit" className="primary">保存并锁定身份</button>
              </div>
            </form>
          )}
          {!extractedCollapsed && <dl>
            <div className="wide"><dt>1688商品URL</dt><dd>{extractedUrl ? (
              <a href={extractedUrl} onClick={event => { event.preventDefault(); void window.desktop.browser.openTab('web', extractedUrl, '1688 商品页').catch(() => undefined) }}>{extractedUrl}</a>
            ) : '—'}</dd></div>
            <div className="wide"><dt>标题</dt><dd title={extractedText('title')}>{extractedText('title')}</dd></div>
            <div><dt>价格</dt><dd>{extractedText('price')}</dd></div>
            <div><dt>分析日期</dt><dd>{extractedText('analysisDate')}</dd></div>
            <div><dt>供应商</dt><dd title={extractedText('seller')}>{extractedText('seller')}</dd></div>
            <div><dt>图片</dt><dd>{extractedImageCount > 0 ? `${extractedImageCount} 张` : '—'}</dd></div>
            <div><dt>起订量</dt><dd>{extractedText('moq')}</dd></div>
            <div><dt>发货地</dt><dd>{extractedText('shipFrom')}</dd></div>
            <div><dt>成交</dt><dd>{extractedText('deals')}</dd></div>
            {extracted?.detailText && <div className="wide"><dt>详情页文字{extracted.detailSource ? ` · ${extracted.detailSource}` : ''}</dt><dd title={String(extracted.detailText)}>{String(extracted.detailText).slice(0, 600)}{String(extracted.detailText).length > 600 ? '…' : ''}</dd></div>}
            {extracted?.imageOcrText && <div className="wide"><dt>图片OCR</dt><dd title={String(extracted.imageOcrText)}>{String(extracted.imageOcrText).slice(0, 600)}{String(extracted.imageOcrText).length > 600 ? '…' : ''}</dd></div>}
            <div className="wide"><dt>视觉识别</dt><dd>{extractedEvidence?.hasReliableVisual ? `${String(extracted?.visualProductForm)} · ${String(extracted?.visualUseMethod || '用途待确认')} · 置信度 ${String(extracted?.visualConfidence ?? 0)}%` : '未取得可靠视觉形态，必须人工确认'}</dd></div>
            {extractedConfirmedAt && <div className="wide"><dt>事实确认</dt><dd>用户确认锁定 · {new Date(extractedConfirmedAt).toLocaleString('zh-CN')}</dd></div>}
            {extracted?.confirmedProductForm && <div className="wide"><dt>人工身份裁决</dt><dd>{extracted.confirmedProductName || extracted.title || '待命名产品'} · {extracted.confirmedProductForm} · {extracted.confirmedUseMethod || '用途待确认'} · {extracted.confirmedTargetObject || '对象待确认'}{extracted.identityResolutionNote ? ` · ${extracted.identityResolutionNote}` : ''}</dd></div>}
          </dl>}
          {!extractedCollapsed && extractedEvidence && (
            <div className="ai-employee-extracted-evidence">
              <b>证据覆盖</b>
              <div>
                <span className={extractedEvidence.hasTitle ? 'ok' : 'missing'}>标题 {extractedEvidence.hasTitle ? '✓' : '缺失'}</span>
                <span className={extractedEvidence.hasDetail ? 'ok' : 'missing'}>详情页 {extractedEvidence.hasDetail ? '✓' : '缺失'}</span>
                <span className={extractedEvidence.imageCount ? 'ok' : 'missing'}>商品图 {extractedEvidence.imageCount || '缺失'}</span>
                <span className={extractedEvidence.hasOcr ? 'ok' : 'missing'}>OCR {extractedEvidence.hasOcr ? '✓' : '缺失'}</span>
                <span className={extractedEvidence.hasReliableVisual ? 'ok' : 'missing'}>视觉 {extractedEvidence.hasReliableVisual ? `${extracted?.visualConfidence}%` : '待确认'}</span>
              </div>
              {(extractedEvidence.warnings.length > 0 || extractedEvidence.conflicts.length > 0) && (
                <ul>
                  {extractedEvidence.warnings.map(item => <li key={`warning-${item}`}>OCR提示：{item}</li>)}
                  {extractedEvidence.conflicts.map(item => <li className="conflict" key={`conflict-${item}`}>身份冲突：{item}</li>)}
                </ul>
              )}
            </div>
          )}
          {!extractedCollapsed && extractedImageEvidence.length > 0 && (
            <div className="ai-employee-extracted-images">
              <b>商品图片证据</b>
              <div>{extractedImageEvidence.slice(0, 6).map((item, index) => (
                <figure key={`${item.url}-${index}`}>
                  <img src={item.url} alt={`${item.role}${index + 1}`} onError={event => { event.currentTarget.hidden = true }} />
                  <figcaption>{item.role} · {item.source}</figcaption>
                </figure>
              ))}</div>
            </div>
          )}
          {!extractedCollapsed && extractedAttributes.length > 0 && <div className="ai-employee-extracted-attrs">{extractedAttributes.map(item => <span key={item}>{item}</span>)}</div>}
          {!extractedCollapsed && <section className="ai-employee-quick-profit" aria-label="快速市场利润参数">
            <header><b>快速市场利润参数（USD）</b><small>六项齐全才计算；系统预填值可修改，“暂缺填零”不可作为正向入场依据。</small></header>
            <div>
              {([
                ['purchaseCostUsd', '采购价（USD）'], ['referralFeeRate', 'Amazon佣金（%）'], ['fbaFulfillmentFeeUsd', 'FBA履约费（USD）'],
                ['returnLossRate', '退货损耗（%）'], ['advertisingRate', '广告费率（%）'], ['couponCostUsd', '优惠券（USD）']
              ] as Array<[keyof AmazonQuickMarketProfitInput, string]>).map(([field, label]) => <label key={field}>{label}<small title={profitFieldMeta[field]?.source}>{profitFieldHint(field)}</small><input aria-label={label} type="number" min="0" max={field.endsWith('Rate') ? 100 : undefined} step="0.01" value={quickProfit[field] ?? ''} onChange={event => updateQuickProfit(field, event.target.value)} /></label>)}
            </div>
          </section>}
          {!extractedCollapsed && <section className="ai-employee-full-cost" aria-label="全成本落地利润区间">
            <header><b>全成本区间（每件 USD）</b><small>低/基准/高均须填写；暂缺项预填 0 仅作占位，需补齐报价后才能支持“建议入场”。</small></header>
            <div className="ai-employee-full-cost-head"><span>成本项</span><span>低</span><span>基准</span><span>高</span></div>
            {([
              ['packagingQcUsd', '包装/质检'], ['domesticFreightUsd', '国内物流'], ['firstLegFreightUsd', '头程'], ['dutyUsd', '关税'], ['customsClearanceUsd', '清关'], ['inboundUsd', '入仓'], ['storageUsd', '仓储']
            ] as Array<[keyof AmazonFullCostInput, string]>).map(([field, label]) => <div className="ai-employee-full-cost-row" key={field}><b title={profitFieldMeta[`${field}.base` as ProfitFieldKey]?.source}>{label}<small>{profitFieldHint(`${field}.base` as ProfitFieldKey)}</small></b>{(['low', 'base', 'high'] as Array<keyof AmazonCostRange>).map(range => <input key={range} aria-label={`${label}${range === 'low' ? '低' : range === 'base' ? '基准' : '高'}成本`} title={profitFieldHint(`${field}.${range}` as ProfitFieldKey)} type="number" min="0" step="0.01" value={fullCostProfit[field]?.[range] ?? ''} onChange={event => updateFullCost(field, range, event.target.value)} />)}</div>)}
          </section>}
          {!extractedCollapsed && <section className="ai-employee-entry-decision" aria-label="入场决策门禁">
            <header><b>阶段5：入场决策门禁</b><small>不选择目标利润率，系统不会输出“建议入场”。</small></header>
            <fieldset className="ai-employee-target-margin"><legend>目标贡献利润率<small title={profitFieldMeta.targetContributionMargin?.source}>{profitFieldHint('targetContributionMargin')}</small></legend><div className="ai-employee-target-margin-buttons" role="radiogroup" aria-label="目标贡献利润率">{[10, 15, 20, 25].map(value => { const active = entryDecision.targetContributionMargin === value; return <button key={value} type="button" role="radio" aria-checked={active} className={active ? 'active' : ''} onClick={() => updateEntryDecision('targetContributionMargin', String(value))}>{value}%</button> })}<button type="button" role="radio" aria-checked={entryDecision.targetContributionMargin == null} className={entryDecision.targetContributionMargin == null ? 'active' : ''} onClick={() => updateEntryDecision('targetContributionMargin', '')}>不选</button></div></fieldset>
            <label>差异化核验依据<small title={profitFieldMeta.differentiationEvidence?.source}>{profitFieldHint('differentiationEvidence')}</small><textarea aria-label="差异化核验依据" value={entryDecision.differentiationEvidence || ''} onChange={event => updateEntryDecision('differentiationEvidence', event.target.value)} placeholder="填写样品、竞品对比、专利/结构或买家需求证据编号" /></label>
            <label>合规/IP核验依据<small title={profitFieldMeta.complianceIpEvidence?.source}>{profitFieldHint('complianceIpEvidence')}</small><textarea aria-label="合规IP核验依据" value={entryDecision.complianceIpEvidence || ''} onChange={event => updateEntryDecision('complianceIpEvidence', event.target.value)} placeholder="填写官方查询、检测/标签、商标或专利检索记录" /></label>
          </section>}
        </div>
      )}

      {/* 输入区 */}
      <div className="ai-employee-composer-body">
        {attachments.length > 0 && (
          <div className="ai-employee-attachments">
            {attachments.map(attachment => (
              <span key={attachment.id} className="ai-employee-attachment">
                {attachment.kind === 'image' && attachment.dataUrl
                  ? <img src={attachment.dataUrl} alt="" />
                  : <i aria-hidden="true">📄</i>}
                <b title={attachment.name}>{attachment.name}</b>
                <small>{formatSize(attachment.size)}</small>
                <button type="button" aria-label={`移除 ${attachment.name}`} onClick={() => removeAttachment(attachment.id)}>×</button>
              </span>
            ))}
          </div>
        )}
        <textarea
          rows={2}
          placeholder={useSampleLibrary
            ? `向 ${agentName} 提问（已启用报告样例库参考）·例如：${POSITION_EXAMPLE[position] ?? '帮我分析这款产品在亚马逊是否有机会…'}`
            : `向 ${agentName} 提问，例如：${POSITION_EXAMPLE[position] ?? '帮我分析这款产品在亚马逊是否有机会…'}`}
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }}
        />
        <div className="ai-employee-composer-footer">
          <div className="ai-employee-quick-actions">
            {showSelectionTools && (
              <button type="button" className="ai-employee-extract-btn" disabled={extracting} data-tip="从 1688 商品详情页提取标题、价格、供应商等信息" onClick={() => void extract()}>
                {extracting ? '提取中…' : '⇩ 提取'}
              </button>
            )}
            <button type="button" disabled={picking} data-tip="上传本地产品图片或文档（png/jpg/webp/pdf/docx/txt/md）" onClick={() => void pickFiles()}>
              {picking ? '读取中…' : '📎 上传'}
            </button>
            {showSelectionTools && PLATFORMS.map(item => (
              <button
                key={item}
                type="button"
                className={`ai-employee-platform-chip${platform === item ? ' active' : ''}`}
                data-tip={platform === item ? `取消选择 ${item}` : `分析目标平台：${item}`}
                onClick={() => selectPlatform(item)}
              >
                {item}
              </button>
            ))}
            {/* I.4 阶段新增：报告样例库 KB 引用开关 */}
            <label
              className={`ai-employee-sample-lib-toggle${useSampleLibrary ? ' on' : ''}`}
              title={useSampleLibrary
                ? '已启用：本次问询将提示 MaxKB 智能体参考「选品分析师」知识库中的 4 样例 + 决策门禁 + 可追溯约束'
                : '未启用：本次问询不会主动参考报告样例库'}
            >
              <input
                type="checkbox"
                checked={useSampleLibrary}
                onChange={event => handleToggleUseSampleLibrary(event.target.checked)}
                aria-label="引用报告样例库"
              />
              <span className="ai-employee-sample-lib-switch" aria-hidden="true" />
              <span className="ai-employee-sample-lib-label">
                <b>📚 引用报告样例库</b>
                <small>参考 4 样例 + 决策门禁 + 可追溯约束</small>
              </span>
            </label>
          </div>
          <div className="ai-employee-composer-right">
            <AiEmployeeModelPicker models={models} selectedId={modelId} onSelect={handleSelectModel} />
            <button
              type="button"
              className={`ai-employee-send-btn ${sending ? 'cancel' : 'primary'}`}
              disabled={sending ? false : !draft.trim()}
              onClick={sending ? cancelSend : () => void send()}
              title={sending ? '主动取消本次问询（中断上游 fetch）' : '发送'}
            >
              {sending ? `取消（${sendingElapsed}s）` : '发送'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  // ─── Render ───────────────────────────────────────────
  return (
    <section className="ai-employee-page">
      {/* 顶部 Tab 栏 */}
      <div className="ai-employee-tab-bar">
        <button type="button" className="ai-employee-tab" onClick={onBackToHub ?? openKnowledgeHome}>⌂ 员工大全</button>
        {/* 位置徽章：按入口 position 区分；点击回到该岗位的初始视图（不清空会话状态） */}
        <button type="button" className="ai-employee-position-badge" onClick={() => { onSelfLink?.(); setActiveTab(initialTab ?? 'home'); }} aria-label={`当前岗位：${position}（本页）`}>
          <i className="badge-icon" style={{ background: positionAgent?.color || '#10b981' }}>{positionAgent?.icon || '精'}</i>
          <b>{position}</b>
        </button>
        <button type="button" className={`ai-employee-tab${activeTab === 'process' ? ' active' : ''}`} onClick={() => setActiveTab('process')}>对话</button>
        {showWorkbenchTab && (
          <button type="button" className={`ai-employee-tab${activeTab === 'workbench' ? ' active' : ''}`} onClick={() => setActiveTab('workbench')}>报告</button>
        )}
        <button type="button" className={`ai-employee-tab${activeTab === 'archive' ? ' active' : ''}`} onClick={() => setActiveTab('archive')}>历史</button>
        {showBrowserTab && (
          <button type="button" className={`ai-employee-tab${activeTab === 'browser' ? ' active' : ''}`} onClick={() => setActiveTab('browser')}>商品</button>
        )}
        <span className="ai-employee-tab-bar-spacer" />
        <button
          type="button"
          className="ai-employee-tab ai-employee-tab-icon"
          onClick={() => setShowProductDrawer(true)}
          aria-label="打开商品库"
          title="商品库"
        >
          📦 商品库
        </button>
      </div>

      {/* P1-B 阶段:商品库抽屉(1688 提取 + 本地上传 + 三来源选择) */}
      <ProductLibraryDrawer
        open={showProductDrawer}
        onClose={() => setShowProductDrawer(false)}
        onSelectProduct={handleSelectProduct}
        onPickFiles={() => { setShowProductDrawer(false); void pickFiles() }}
        onExtract1688={extractAndSaveToLibrary}
      />

      {/* 内容区 */}
      <div className="ai-employee-stage">
        {/* 提问首页：单列布局（独立工作台，岗位由入口 position 固定） */}
        {activeTab === 'home' && (
          <div className="ai-employee-home-layout">
            <div className="ai-employee-home-main">
              <div className="ai-employee-stage-process">
                <div className="ai-employee-greeting">
                  <h2>有什么我能帮你的吗？</h2>
                  <div className="ai-employee-suggestions">
                    {(POSITION_SUGGESTIONS[position] ?? SAMPLE_QUESTIONS).map(q => (
                      <button key={q} type="button" onClick={() => setDraft(q)}>{q}</button>
                    ))}
                  </div>
                </div>
                {/* P1-A 阶段:工作台内嵌员工技能配置(默认折叠) */}
                <WorkbenchSkillConfig position={position} />
              </div>
              {renderComposer()}
            </div>
          </div>
        )}

        {/* 工作处理：会话工作区；无会话时显示空态并引导去首页/档案 */}
        {activeTab === 'process' && (
          <div className={`ai-employee-stage-process${messages.length > 0 ? ' with-floating-composer' : ''}`}>
            {messages.length === 0 ? (
              <div className="ai-employee-work-empty">
                <h2>暂无进行中的工作</h2>
                <p>去员工大全选择角色发起新提问，或从工作档案恢复历史会话。</p>
                <div className="ai-employee-work-empty-actions">
                  <button type="button" className="primary" onClick={onBackToHub ?? openKnowledgeHome}>去员工大全</button>
                  <button type="button" onClick={() => setActiveTab('archive')}>查看工作档案</button>
                </div>
              </div>
            ) : (
              <div className="ai-employee-messages">
                {messages.map((message, index) => (
                  <div key={index} className={`ai-employee-message ${message.role}`}>
                    <i>{message.role === 'assistant' ? 'AI' : '我'}</i>
                    <div className="ai-employee-bubble">
                      <MessageRenderBoundary content={message.content}>
                        <AIMessageContent content={message.content} tone={message.role === 'assistant' ? 'answer' : 'question'} onPrompt={message.role === 'assistant' ? prompt => setDraft(prompt) : undefined} />
                      </MessageRenderBoundary>
                      {message.role === 'assistant' && /#\s+/.test(message.content) && (
                        <div className="ai-employee-msg-actions">
                          <button type="button" data-tip="导出为真 Word (.docx)，含表格/章节/超链接，可直接发给工厂、客户与团队" onClick={() => void exportCurrentReportAsWord(message.content, conversationTitle([message]))}>⇩ 下载 .docx</button>
                        </div>
                      )}
                      {!!message.attachments?.length && (
                        <div className="ai-employee-msg-attachments">
                          {message.attachments.map(attachment => (
                            <span key={attachment.id} className="ai-employee-msg-attachment">
                              <i aria-hidden="true">{attachment.kind === 'image' ? '🖼' : '📄'}</i>
                              <b title={attachment.name}>{attachment.name}</b>
                              <small>{formatSize(attachment.size)}</small>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {sending && <ExecutionPanel enabled key={execRequestId} requestId={execRequestId} resetSignal={execResetSignal} />}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
        )}

        {/* Tab2: Listing 工作台（素材×平台×语言 → Listing 包） */}
        {activeTab === 'workbench' && <ListingWorkbench/>}

        {/* Tab3: 工作档案 */}
        {activeTab === 'archive' && (
          <div className="ai-employee-stage-archive">
            {visibleHistory.length === 0 ? (
              <div className="ai-employee-archive-empty">暂无历史记录</div>
            ) : (
              <div className="ai-employee-history">
                {exportNotice && <div className="ai-employee-export-notice" role="status">{exportNotice}</div>}
                {visibleHistory.map((item, index) => (
                  <div key={item.id} className="ai-employee-history-row">
                    <span className="ai-employee-history-index">{String(index + 1).padStart(2, '0')}</span>
                    <div className="ai-employee-history-item">
                      <button type="button" className="ai-employee-history-main" onClick={() => loadConversation(item)}>
                        <b title={item.title}>{item.title}</b>
                        <small>AI员工文档 · {item.roleName} · {new Date(item.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} · {item.messages.length} 条消息</small>
                      </button>
                      <details className="ai-employee-history-download">
                        <summary>⇩ 下载</summary>
                        <div>
                          <button type="button" onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); void exportHistoryItem(item, 'word') }}><i className="word">W</i>Word</button>
                          <button type="button" onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); void exportHistoryItem(item, 'pdf') }}><i className="pdf">P</i>PDF</button>
                          <button type="button" onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); void exportHistoryItem(item, 'markdown') }}><i className="markdown">M</i>Markdown</button>
                        </div>
                      </details>
                      <button type="button" className="ai-employee-history-del" onClick={() => deleteHistoryItem(item.id)}>×</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab4: 浏览器（仅选品分析师工作台挂载，保持 WebContentsView） */}
        {showBrowserTab && (
        <div className="ai-employee-stage-browser" style={{ display: activeTab === 'browser' ? 'flex' : 'none' }}>
          <form className="ai-employee-browser-bar" onSubmit={navigate}>
            <button type="button" title="后退" onClick={() => void window.desktop.aiEmployee.browserBack()}>←</button>
            <button type="button" title="前进" onClick={() => void window.desktop.aiEmployee.browserForward()}>→</button>
            <button type="button" title="刷新" disabled={loading} onClick={() => void window.desktop.aiEmployee.browserReload()}>↻</button>
            <input aria-label="网页地址" placeholder="输入网址，回车访问（默认 1688 采购站）" value={url} onChange={event => setUrl(event.target.value)} />
            {loading && <span className="ai-employee-loading">加载中…</span>}
            <button type="button" className={`ai-employee-browser-toggle${browserVisible ? ' active' : ''}`} onClick={toggleBrowser}>{browserVisible ? '收起浏览器' : '打开浏览器'}</button>
          </form>
          <div ref={browserHostRef} className="ai-employee-browser-host">
            {!browserVisible && (
              <div className="ai-employee-browser-empty">
                <span>🌐</span>
                <b>1688 商品浏览区</b>
                <small>点击「打开浏览器」后，此处将显示 1688 采购站页面。登录状态与采购浏览器共享，打开商品详情页后即可一键提取分析。</small>
                <button type="button" className="primary" onClick={toggleBrowser}>打开浏览器</button>
              </div>
            )}
          </div>
        </div>
        )}
      </div>

      {/* 浮动输入栏：工作处理有会话时显示（岗位由入口固定）；工作档案与浏览器保持纯浏览视图 */}
      {activeTab === 'process' && messages.length > 0 && renderComposer()}
    </section>
  )
}
