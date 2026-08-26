import { useCallback, useEffect, useMemo, useState } from 'react'
import { getTokens } from './serverApi'
import type { LinduoLoginStatus, LinduoModelPricing } from '../shared/contracts'
import {
  LINDUO_MODELS,
  VENDOR_META,
  CAPABILITY_META,
  VENDORS,
  CAPABILITIES,
  type LinduoModelEntry,
  type LinduoCapability,
  type LinduoVendor
} from '../shared/linduoCatalog'

/**
 * 零度API 模型广场：浏览 37 个聚合大模型（OpenAI 14 / Google 10 / Anthropic 10 / Vidu 3）。
 * 模型目录与元数据抽离到 src/shared/linduoCatalog.ts，主进程 + 渲染层共用。
 *
 * 设计要点：
 * - 模型元数据内置（37 个模型 id + 名称 + 能力），无需调用 /v1/models；接入 Key 状态通过 llm-keys:list 读取。
 * - 左侧筛选：供应商（OpenAI / Google / Anthropic / Vidu）与能力（生图 / 视频 / 对话 / 多模态）。
 * - 顶部搜索按 id / 名称 / 描述模糊匹配。
 * - 价格行：每张卡片底部展示输入/输出/缓存价（USD/1M tokens），图片/视频模型用 pricePerUnit + unitLabel。
 *   价签来自 linduo-pricing:list（DB → fallback），陈旧价右上角加 ⚠️ 标记。
 * - 手动刷新：顶栏「立即抓取价格」触发 linduo-pricing:refresh；执行中禁用按钮。
 * - 卡片复用 .ai-crossborder-card 样式，扩展 .linduo-mall-* 类做细节。
 */

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
