import { useCallback, useEffect, useMemo, useState } from 'react'
import { getTokens } from './serverApi'
import type { LinduoLoginStatus, LinduoModelPricing } from '../shared/contracts'

/**
 * 零度API 模型广场：浏览 45 个聚合大模型（OpenAI 22 / Google 10 / Anthropic 10 / Vidu 3）。
 *
 * 设计要点：
 * - 模型元数据内置（45 个模型 id + 名称 + 能力），无需调用 /v1/models；接入 Key 状态通过 llm-keys:list 读取。
 * - 左侧筛选：供应商（OpenAI / Google / Anthropic / Vidu）与能力（生图 / 视频 / 对话 / 多模态）。
 * - 顶部搜索按 id / 名称 / 描述模糊匹配。
 * - 价格行：每张卡片底部展示输入/输出/缓存价（USD/1M tokens），图片/视频模型用 pricePerUnit + unitLabel。
 *   价签来自 linduo-pricing:list（DB → fallback），陈旧价右上角加 ⚠️ 标记。
 * - 手动刷新：顶栏「立即抓取价格」触发 linduo-pricing:refresh；执行中禁用按钮。
 * - 卡片复用 .ai-crossborder-card 样式，扩展 .linduo-mall-* 类做细节。
 */

type LinduoCapability = 'IMAGE' | 'VIDEO' | 'CHAT' | 'VISION' | 'EMBEDDING' | 'AUDIO'

type LinduoVendor = 'openai' | 'google' | 'anthropic' | 'vidu'

interface LinduoModelEntry {
  id: string
  name: string
  vendor: LinduoVendor
  /** 模型原生能力；用于筛选与标签 */
  capabilities: LinduoCapability[]
  description: string
  /** 上下文长度标签，如 "128K" / "200K" / "1M"，仅展示用 */
  contextLabel?: string
  /** 是否已对接 AI 美工链路（仅 IMAGE 能力的部分模型） */
  wiredToImageStudio?: boolean
}

const VENDOR_META: Record<LinduoVendor, { label: string; color: string; icon: string }> = {
  openai:    { label: 'OpenAI',    color: '#10a37f', icon: '◐' },
  google:    { label: 'Google',    color: '#4285f4', icon: '✦' },
  anthropic: { label: 'Anthropic', color: '#d97706', icon: '✜' },
  vidu:      { label: 'Vidu',      color: '#e11d48', icon: '▶' }
}

const CAPABILITY_META: Record<LinduoCapability, { label: string; color: string }> = {
  IMAGE:     { label: '生图',     color: '#9333ea' },
  VIDEO:     { label: '视频',     color: '#e11d48' },
  CHAT:      { label: '对话',     color: '#2563eb' },
  VISION:    { label: '视觉',     color: '#0891b2' },
  EMBEDDING: { label: '嵌入',     color: '#475569' },
  AUDIO:     { label: '语音',     color: '#0d9488' }
}

/** 45 个零度API 旗下模型；按 OpenAI 22 / Google 10 / Anthropic 10 / Vidu 3 编排。 */
const LINDUO_MODELS: LinduoModelEntry[] = [
  // OpenAI 14
  { id: 'gpt-4o',                  name: 'GPT-4o',                  vendor: 'openai',    capabilities: ['CHAT', 'VISION'],        description: 'OpenAI 多模态旗舰，对话与视觉理解均突出',         contextLabel: '128K', wiredToImageStudio: false },
  { id: 'gpt-4o-mini',             name: 'GPT-4o mini',             vendor: 'openai',    capabilities: ['CHAT', 'VISION'],        description: '轻量多模态，成本低、速度快',                       contextLabel: '128K' },
  { id: 'gpt-4-turbo',             name: 'GPT-4 Turbo',             vendor: 'openai',    capabilities: ['CHAT'],                  description: '高上下文对话模型，复杂指令表现稳定',               contextLabel: '128K' },
  { id: 'gpt-3.5-turbo',           name: 'GPT-3.5 Turbo',           vendor: 'openai',    capabilities: ['CHAT'],                  description: '经典对话模型，性价比首选',                         contextLabel: '16K' },
  { id: 'o1',                      name: 'o1',                       vendor: 'openai',    capabilities: ['CHAT'],                  description: 'OpenAI 推理模型，链式思考能力强',                   contextLabel: '200K' },
  { id: 'o1-mini',                 name: 'o1 mini',                  vendor: 'openai',    capabilities: ['CHAT'],                  description: '轻量推理模型，速度更快',                           contextLabel: '128K' },
  { id: 'o3-mini',                 name: 'o3 mini',                  vendor: 'openai',    capabilities: ['CHAT'],                  description: '高性价比推理模型，复杂任务表现优',                 contextLabel: '200K' },
  { id: 'gpt-4.1',                 name: 'GPT-4.1',                  vendor: 'openai',    capabilities: ['CHAT', 'VISION'],        description: 'GPT-4 系列升级，编码与指令遵循更强',               contextLabel: '1M' },
  { id: 'gpt-4.1-mini',            name: 'GPT-4.1 mini',             vendor: 'openai',    capabilities: ['CHAT', 'VISION'],        description: '轻量 GPT-4.1，速度与成本平衡',                     contextLabel: '1M' },
  { id: 'gpt-image-1',             name: 'GPT-Image-1',              vendor: 'openai',    capabilities: ['IMAGE'],                 description: 'OpenAI 图像生成模型，文字渲染与细节突出',          wiredToImageStudio: true },
  { id: 'dall-e-3',                name: 'DALL·E 3',                 vendor: 'openai',    capabilities: ['IMAGE'],                 description: 'OpenAI 文生图模型，创意构图表现强',                 wiredToImageStudio: true },
  { id: 'whisper-1',               name: 'Whisper',                  vendor: 'openai',    capabilities: ['AUDIO'],                 description: '语音转文字模型，多语种支持',                       contextLabel: '25MB' },
  { id: 'tts-1',                   name: 'TTS-1',                    vendor: 'openai',    capabilities: ['AUDIO'],                 description: 'OpenAI 文字转语音模型，6 种音色',                   contextLabel: '4096' },
  { id: 'text-embedding-3-large',  name: 'Embedding 3 Large',        vendor: 'openai',    capabilities: ['EMBEDDING'],             description: 'OpenAI 向量嵌入大模型，3072 维',                    contextLabel: '8K' },
  { id: 'gpt-5.4',                 name: 'GPT-5.4',                  vendor: 'openai',    capabilities: ['CHAT', 'VISION'],        description: 'GPT-5 主力对话模型，复杂任务与多模态表现稳',       contextLabel: '128K' },
  { id: 'gpt-5.4-mini',            name: 'GPT-5.4 mini',             vendor: 'openai',    capabilities: ['CHAT'],                  description: '轻量 GPT-5.4，速度更快、成本更低',                 contextLabel: '128K' },
  { id: 'gpt-5.5',                 name: 'GPT-5.5',                  vendor: 'openai',    capabilities: ['CHAT', 'VISION'],        description: 'GPT-5.5 多模态升级，推理与视觉更稳',               contextLabel: '128K' },
  { id: 'gpt-5.6-luna',            name: 'GPT-5.6 Luna',             vendor: 'openai',    capabilities: ['CHAT'],                  description: 'GPT-5.6 入门款，价格最便宜',                       contextLabel: '128K' },
  { id: 'gpt-5.6-sol',             name: 'GPT-5.6 Sol',              vendor: 'openai',    capabilities: ['CHAT', 'VISION'],        description: 'GPT-5.6 旗舰款，复杂任务首选',                     contextLabel: '128K' },
  { id: 'gpt-5.6-terra',           name: 'GPT-5.6 Terra',            vendor: 'openai',    capabilities: ['CHAT', 'VISION'],        description: 'GPT-5.6 均衡款，性能与价格平衡',                   contextLabel: '128K' },
  { id: 'gpt-image-2',             name: 'GPT-Image-2',              vendor: 'openai',    capabilities: ['IMAGE'],                 description: 'OpenAI 图像生成 v2，文字渲染与细节更稳',          wiredToImageStudio: true },
  { id: 'gpt-image-2-all',         name: 'GPT-Image-2 All',          vendor: 'openai',    capabilities: ['CHAT', 'VISION', 'IMAGE'], description: 'GPT-Image-2 全模态版本，多模态对话 + 图像生成', wiredToImageStudio: true },
  // Google 10
  { id: 'gemini-2.5-pro',                 name: 'Gemini 2.5 Pro',                 vendor: 'google',    capabilities: ['CHAT', 'VISION'],        description: 'Google 旗舰多模态模型，推理与代码表现强',         contextLabel: '1M' },
  { id: 'gemini-2.5-flash',               name: 'Gemini 2.5 Flash',               vendor: 'google',    capabilities: ['CHAT', 'VISION'],        description: '轻量多模态，速度与成本平衡',                       contextLabel: '1M' },
  { id: 'gemini-2.5-flash-image-preview', name: 'Gemini 2.5 Flash Image',         vendor: 'google',    capabilities: ['IMAGE'],                 description: 'Google 多模态生图，支持参照图',                     wiredToImageStudio: true },
  { id: 'imagen-4.0',                     name: 'Imagen 4.0',                     vendor: 'google',    capabilities: ['IMAGE'],                 description: 'Google 旗舰生图模型，品牌色与主图表现优',         wiredToImageStudio: true },
  { id: 'gemini-2.0-pro',                 name: 'Gemini 2.0 Pro',                 vendor: 'google',    capabilities: ['CHAT', 'VISION'],        description: '上一代 Pro 多模态模型',                            contextLabel: '2M' },
  { id: 'gemini-2.0-flash',               name: 'Gemini 2.0 Flash',               vendor: 'google',    capabilities: ['CHAT', 'VISION'],        description: '上一代 Flash 模型，结构化输出稳定',                 contextLabel: '1M' },
  { id: 'gemini-1.5-pro',                 name: 'Gemini 1.5 Pro',                 vendor: 'google',    capabilities: ['CHAT', 'VISION'],        description: '经典 Gemini Pro 长上下文模型',                      contextLabel: '2M' },
  { id: 'gemini-1.5-flash',               name: 'Gemini 1.5 Flash',               vendor: 'google',    capabilities: ['CHAT', 'VISION'],        description: '轻量 Gemini，延迟更低',                             contextLabel: '1M' },
  { id: 'text-embedding-004',             name: 'Embedding 004',                  vendor: 'google',    capabilities: ['EMBEDDING'],             description: 'Google 文本嵌入模型，768 维',                       contextLabel: '2K' },
  { id: 'gemini-embedding-exp',           name: 'Gemini Embedding (实验)',        vendor: 'google',    capabilities: ['EMBEDDING'],             description: 'Gemini 系列嵌入实验版',                             contextLabel: '8K' },
  // Anthropic 10
  { id: 'claude-opus-4-5-20251101',  name: 'Claude Opus 4.5',          vendor: 'anthropic', capabilities: ['CHAT', 'VISION'],        description: 'Anthropic 顶级模型，复杂任务首选',                   contextLabel: '200K' },
  { id: 'claude-sonnet-4-5-20251101',name: 'Claude Sonnet 4.5',        vendor: 'anthropic', capabilities: ['CHAT', 'VISION'],        description: '平衡性能与成本的 Anthropic 主力模型',               contextLabel: '200K' },
  { id: 'claude-haiku-4-5-20251101', name: 'Claude Haiku 4.5',         vendor: 'anthropic', capabilities: ['CHAT'],                  description: '轻量 Claude，速度与成本最优',                       contextLabel: '200K' },
  { id: 'claude-opus-4-1-20250805',  name: 'Claude Opus 4.1',          vendor: 'anthropic', capabilities: ['CHAT', 'VISION'],        description: '前代 Opus，适合高精度长文档分析',                   contextLabel: '200K' },
  { id: 'claude-sonnet-4-20250514',  name: 'Claude Sonnet 4',          vendor: 'anthropic', capabilities: ['CHAT', 'VISION'],        description: '前代 Sonnet，工具调用稳定',                         contextLabel: '200K' },
  { id: 'claude-3-7-sonnet',         name: 'Claude 3.7 Sonnet',        vendor: 'anthropic', capabilities: ['CHAT', 'VISION'],        description: '混合推理模式，可控思考深度',                       contextLabel: '200K' },
  { id: 'claude-3-5-sonnet',         name: 'Claude 3.5 Sonnet',        vendor: 'anthropic', capabilities: ['CHAT', 'VISION'],        description: '前代主力 Sonnet，编程与写作表现优',                 contextLabel: '200K' },
  { id: 'claude-3-5-haiku',          name: 'Claude 3.5 Haiku',         vendor: 'anthropic', capabilities: ['CHAT'],                  description: '轻量 Claude，适合日常对话',                         contextLabel: '200K' },
  { id: 'claude-3-opus',             name: 'Claude 3 Opus',            vendor: 'anthropic', capabilities: ['CHAT', 'VISION'],        description: '经典 Opus，长文档与复杂推理',                       contextLabel: '200K' },
  { id: 'claude-3-haiku',            name: 'Claude 3 Haiku',           vendor: 'anthropic', capabilities: ['CHAT'],                  description: '前代轻量模型，低延迟低成本',                       contextLabel: '200K' },
  // Vidu 3
  { id: 'vidu-q1',          name: 'Vidu Q1',           vendor: 'vidu',      capabilities: ['VIDEO'],  description: 'Vidu 旗舰视频生成模型，1080P 5 秒',          contextLabel: '5s/1080P' },
  { id: 'vidu-2.0',         name: 'Vidu 2.0',          vendor: 'vidu',      capabilities: ['VIDEO'],  description: 'Vidu 主力视频生成模型，主体一致性突出',       contextLabel: '4s/720P' },
  { id: 'vidu-1.5',         name: 'Vidu 1.5',          vendor: 'vidu',      capabilities: ['VIDEO'],  description: 'Vidu 入门视频生成模型，性价比首选',           contextLabel: '4s/540P' }
]

const VENDORS: LinduoVendor[] = ['openai', 'google', 'anthropic', 'vidu']
const CAPABILITIES: LinduoCapability[] = ['IMAGE', 'VIDEO', 'CHAT', 'VISION', 'EMBEDDING', 'AUDIO']

export function LinduoModelMallPage({ onBack, onOpenLlmKeys }: { onBack: () => void; onOpenLlmKeys: () => void }) {
  const [vendorFilter, setVendorFilter] = useState<Set<LinduoVendor>>(new Set(VENDORS))
  const [capabilityFilter, setCapabilityFilter] = useState<Set<LinduoCapability>>(new Set(CAPABILITIES))
  const [keyword, setKeyword] = useState('')
  const [linduoConfigured, setLinduoConfigured] = useState<boolean | null>(null)
  const [pricings, setPricings] = useState<Record<string, LinduoModelPricing>>({})
  const [pricingRefreshedAt, setPricingRefreshedAt] = useState<string | null>(null)
  const [pricingAllStale, setPricingAllStale] = useState(false)
  const [loginStatus, setLoginStatus] = useState<LinduoLoginStatus | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState('')

  const callWithToken = useCallback(async <T,>(fn: (token: string) => Promise<T>): Promise<T> => {
    const tokens = getTokens()
    if (!tokens?.accessToken) throw new Error('请先在登录页完成砚都认证')
    return fn(tokens.accessToken)
  }, [])

  const refreshKeyStatus = useCallback(() => {
    window.desktop.llmKeys.list()
      .then(items => {
        const target = items.find(item => item.id === 'linduo')
        setLinduoConfigured(Boolean(target?.configured))
      })
      .catch(() => setLinduoConfigured(false))
  }, [])

  const loadPricing = useCallback(() => {
    if (!linduoConfigured) {
      setPricings({})
      setPricingRefreshedAt(null)
      setPricingAllStale(false)
      return
    }
    callWithToken(token => window.desktop.linduoLogin.listPricing(token))
      .then(payload => {
        const map: Record<string, LinduoModelPricing> = {}
        for (const item of payload.items) map[item.modelId] = item
        setPricings(map)
        setPricingRefreshedAt(payload.refreshedAt)
        setPricingAllStale(payload.allStale)
      })
      .catch(() => {
        setPricings({})
        setPricingRefreshedAt(null)
        setPricingAllStale(false)
      })
  }, [callWithToken, linduoConfigured])

  const loadLoginStatus = useCallback(() => {
    if (!linduoConfigured) {
      setLoginStatus(null)
      return
    }
    callWithToken(token => window.desktop.linduoLogin.getStatus(token))
      .then(setLoginStatus)
      .catch(() => setLoginStatus(null))
  }, [callWithToken, linduoConfigured])

  useEffect(() => { refreshKeyStatus() }, [refreshKeyStatus])
  useEffect(() => {
    loadPricing()
    loadLoginStatus()
  }, [loadPricing, loadLoginStatus])

  const triggerPricingRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    setRefreshError('')
    try {
      const credentials = loginStatus?.loggedIn ? undefined : undefined
      const result = await callWithToken(token => window.desktop.linduoLogin.refreshPricing(token, credentials))
      if (!result.ok) {
        setRefreshError(result.error || '抓取失败')
      } else {
        setRefreshError('')
      }
      loadPricing()
      loadLoginStatus()
    } catch (reason) {
      setRefreshError(reason instanceof Error ? reason.message : '抓取失败')
    } finally {
      setRefreshing(false)
    }
  }

  const vendorCount = useMemo(() => {
    const map: Record<LinduoVendor, number> = { openai: 0, google: 0, anthropic: 0, vidu: 0 }
    for (const model of LINDUO_MODELS) map[model.vendor] += 1
    return map
  }, [])

  const filtered = useMemo(() => {
    const lower = keyword.trim().toLowerCase()
    return LINDUO_MODELS.filter(model => {
      if (!vendorFilter.has(model.vendor)) return false
      if (!model.capabilities.some(cap => capabilityFilter.has(cap))) return false
      if (!lower) return true
      return model.id.toLowerCase().includes(lower)
        || model.name.toLowerCase().includes(lower)
        || model.description.toLowerCase().includes(lower)
    })
  }, [vendorFilter, capabilityFilter, keyword])

  const toggleVendor = (vendor: LinduoVendor) => {
    setVendorFilter(previous => {
      const next = new Set(previous)
      if (next.has(vendor)) next.delete(vendor); else next.add(vendor)
      return next
    })
  }
  const toggleCapability = (cap: LinduoCapability) => {
    setCapabilityFilter(previous => {
      const next = new Set(previous)
      if (next.has(cap)) next.delete(cap); else next.add(cap)
      return next
    })
  }

  return <section className="linduo-mall-page">
    <div className="page-toolbar">
      <div>
        <b>零度API 模型广场</b>
        <small>{LINDUO_MODELS.length} 个大模型聚合 · 按供应商与能力筛选；模型元数据内置，连接状态由零度API 探测</small>
        {linduoConfigured && pricingRefreshedAt && <small className="linduo-mall-pricing-meta">
          {pricingAllStale ? '⚠️ 上次抓取失败，展示陈旧价 · ' : '价格更新于 '}
          {new Date(pricingRefreshedAt).toLocaleString()}
          {loginStatus?.loggedIn === false && ' · 未登录零度API（先去大模型API Key 页登录）'}
        </small>}
      </div>
      <div className="linduo-mall-toolbar-actions">
        <span className={`linduo-mall-status ${linduoConfigured === true ? 'ready' : linduoConfigured === false ? 'pending' : ''}`}>
          {linduoConfigured === null
            ? '正在读取 Key 状态…'
            : linduoConfigured ? '已配置 LINDUO_API_KEY' : '未配置 LINDUO_API_KEY'}
        </span>
        <button type="button" onClick={() => void triggerPricingRefresh()} disabled={!linduoConfigured || refreshing}>
          {refreshing ? '抓取中…' : '立即抓取价格'}
        </button>
        <button type="button" onClick={onOpenLlmKeys}>配置 Key</button>
        <button type="button" onClick={onBack}>返回 AI总部</button>
      </div>
    </div>
    {refreshError && <div className="linduo-mall-pricing-error" role="status">价格抓取失败：{refreshError}</div>}
    <div className="linduo-mall-layout">
      <aside className="linduo-mall-filter">
        <div className="linduo-mall-filter-section">
          <b>搜索</b>
          <input
            type="search"
            placeholder="按 id / 名称 / 描述搜索"
            value={keyword}
            onChange={event => setKeyword(event.target.value)}
          />
        </div>
        <div className="linduo-mall-filter-section">
          <b>供应商</b>
          {VENDORS.map(vendor => {
            const meta = VENDOR_META[vendor]
            const active = vendorFilter.has(vendor)
            return <button
              key={vendor}
              type="button"
              className={`linduo-mall-chip ${active ? 'active' : ''}`}
              style={active ? { color: meta.color, borderColor: meta.color, background: `${meta.color}14` } : undefined}
              onClick={() => toggleVendor(vendor)}
            >
              <span className="linduo-mall-chip-icon" style={{ color: meta.color }}>{meta.icon}</span>
              {meta.label}
              <em>{vendorCount[vendor]}</em>
            </button>
          })}
        </div>
        <div className="linduo-mall-filter-section">
          <b>能力</b>
          {CAPABILITIES.map(cap => {
            const meta = CAPABILITY_META[cap]
            const active = capabilityFilter.has(cap)
            return <button
              key={cap}
              type="button"
              className={`linduo-mall-chip ${active ? 'active' : ''}`}
              style={active ? { color: meta.color, borderColor: meta.color, background: `${meta.color}14` } : undefined}
              onClick={() => toggleCapability(cap)}
            >
              {meta.label}
            </button>
          })}
        </div>
        <div className="linduo-mall-filter-hint">
          命中 {filtered.length} / {LINDUO_MODELS.length} 个模型
        </div>
      </aside>
      <div className="linduo-mall-grid">
        {filtered.length === 0
          ? <div className="linduo-mall-empty">没有匹配的模型，请调整筛选条件</div>
          : filtered.map(model => <LinduoModelCard
              key={model.id}
              model={model}
              linduoConfigured={linduoConfigured === true}
              pricing={pricings[model.id] || null}
              pricingAllStale={pricingAllStale}
            />)}
      </div>
    </div>
  </section>
}

function LinduoModelCard({ model, linduoConfigured, pricing, pricingAllStale }: {
  model: LinduoModelEntry
  linduoConfigured: boolean
  pricing: LinduoModelPricing | null
  pricingAllStale: boolean
}) {
  const vendor = VENDOR_META[model.vendor]
  return <article className="linduo-mall-card">
    <header className="linduo-mall-card-head" style={{ background: `${vendor.color}14`, borderColor: `${vendor.color}30` }}>
      <span className="linduo-mall-card-vendor" style={{ color: vendor.color }}>
        <span className="linduo-mall-card-vendor-icon">{vendor.icon}</span>
        {vendor.label}
      </span>
      {model.contextLabel && <span className="linduo-mall-card-context">{model.contextLabel}</span>}
    </header>
    <div className="linduo-mall-card-body">
      <h3 className="linduo-mall-card-name">{model.name}</h3>
      <code className="linduo-mall-card-id">{model.id}</code>
      <p className="linduo-mall-card-desc">{model.description}</p>
      <div className="linduo-mall-card-tags">
        {model.capabilities.map(cap => {
          const meta = CAPABILITY_META[cap]
          return <span key={cap} className="linduo-mall-card-tag" style={{ color: meta.color, background: `${meta.color}14`, borderColor: `${meta.color}30` }}>{meta.label}</span>
        })}
        {model.wiredToImageStudio && <span className="linduo-mall-card-tag linduo-mall-card-tag-wired">已接入 AI 美工</span>}
      </div>
    </div>
    <LinduoModelPricingRow pricing={pricing} pricingAllStale={pricingAllStale} />
    <footer className="linduo-mall-card-foot">
      {linduoConfigured
        ? <em className="ready">可用</em>
        : <em className="linduo-mall-card-pending">需先配置 LINDUO_API_KEY</em>}
    </footer>
  </article>
}

function LinduoModelPricingRow({ pricing, pricingAllStale }: { pricing: LinduoModelPricing | null; pricingAllStale: boolean }) {
  if (!pricing) {
    return <div className="linduo-mall-pricing linduo-mall-pricing-empty">— 暂无价格 —</div>
  }
  const unit = pricing.unitLabel || '1M tokens'
  const isToken = pricing.billingType === 'TOKEN'
  const stale = pricing.stale || pricingAllStale
  return <div className={`linduo-mall-pricing ${stale ? 'linduo-mall-pricing-stale' : ''}`}>
    {stale && <span className="linduo-mall-pricing-stale-tag" title="上次抓取失败，价为上次成功值">陈旧</span>}
    {isToken
      ? <div className="linduo-mall-pricing-grid">
          <div className="linduo-mall-pricing-cell">
            <span className="linduo-mall-pricing-label">输入</span>
            <span className="linduo-mall-pricing-value">{formatUsd(pricing.inputPrice)}<small>/{unit}</small></span>
          </div>
          <div className="linduo-mall-pricing-cell">
            <span className="linduo-mall-pricing-label">输出</span>
            <span className="linduo-mall-pricing-value">{formatUsd(pricing.outputPrice)}<small>/{unit}</small></span>
          </div>
          {pricing.cachePrice != null && <div className="linduo-mall-pricing-cell">
            <span className="linduo-mall-pricing-label">缓存读</span>
            <span className="linduo-mall-pricing-value">{formatUsd(pricing.cachePrice)}<small>/{unit}</small></span>
          </div>}
        </div>
      : <div className="linduo-mall-pricing-grid">
          <div className="linduo-mall-pricing-cell">
            <span className="linduo-mall-pricing-label">{billingLabel(pricing.billingType)}</span>
            <span className="linduo-mall-pricing-value">{formatUsd(pricing.pricePerUnit ?? pricing.inputPrice)}<small>/{unit}</small></span>
          </div>
        </div>}
  </div>
}

function billingLabel(type: LinduoModelPricing['billingType']): string {
  if (type === 'IMAGE') return '单价'
  if (type === 'VIDEO') return '单价'
  if (type === 'REQUEST') return '单价'
  return '输入'
}

function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (value === 0) return '$0'
  if (value < 0.01) return `$${value.toFixed(4)}`
  if (value < 1) return `$${value.toFixed(3)}`
  return `$${value.toFixed(2)}`
}

export default LinduoModelMallPage
