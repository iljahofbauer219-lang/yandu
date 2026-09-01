import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * 阿里百炼（通义千问）模型广场：浏览 24 个百炼大模型。
 *
 * 与 LinduoModelMallPage 的差异：
 * - 单一供应商（bailian），无供应商筛选；改为「能力」9 个筛选。
 * - 不抓价格（百炼价格由 BailianImageService 在主进程固定，无 api000 那种抓取路径）。
 * - 生图模型用 costLabel（¥/张），其他模型展示「暂无」占位。
 *
 * 数据来源：
 * - 文本/视觉 11 个：阿里云百炼官方模型市场（2026-08-26 调研，含 3.7/3.8 新系列）
 * - 生图 6 个：BailianImageService.ts 4-9 行（已接入 eBay 优化链路）
 * - 翻译 1 个：BailianTranslationService.ts 90 行（已接入 Listing 本地化）
 * - 嵌入 1 个：text-embedding-v3
 * - 语音 2 个：qwen-audio / qwen-audio-asr
 */

type BailianCapability = 'CHAT' | 'VISION' | 'IMAGE' | 'TRANSLATION' | 'EMBEDDING' | 'AUDIO' | 'CODE' | 'REASONING' | 'OMNI'

interface BailianModelEntry {
  id: string
  name: string
  /** 模型所在能力分类；用于「分类」筛选与默认标签 */
  primaryCategory: BailianCapability
  /** 复合能力集合；用于「能力」筛选与多 chip 渲染 */
  capabilities: BailianCapability[]
  description: string
  /** 选型口诀：1 句话告诉用户"这个模型在哪个场景下用 / 不要用"（紫色 chip 渲染） */
  briefRating: string
  /** 上下文长度或参照图数量等标签，仅展示用 */
  contextLabel?: string
  /** 生图模型价格（来自 BailianImageService）；其他模型省略 */
  costLabel?: string
}

const CAPABILITY_META: Record<BailianCapability, { label: string; color: string }> = {
  CHAT:        { label: '对话',     color: '#2563eb' },
  VISION:      { label: '视觉',     color: '#0891b2' },
  IMAGE:       { label: '生图',     color: '#9333ea' },
  TRANSLATION: { label: '翻译',     color: '#0d9488' },
  EMBEDDING:   { label: '嵌入',     color: '#475569' },
  AUDIO:       { label: '语音',     color: '#0d9488' },
  CODE:        { label: '代码',     color: '#0f766e' },
  REASONING:   { label: '推理',     color: '#d97706' },
  OMNI:        { label: '多模态',   color: '#7c3aed' }
}

/** 24 个阿里百炼模型；按"文本对话 → 视觉多模态 → 翻译嵌入 → 生图 → 语音"分组排序 */
const BAILIAN_MODELS: BailianModelEntry[] = [
  // 文本对话 11（含 3.8 / 3.7 新系列）
  { id: 'qwen3.8-max',          name: '通义千问 3.8 Max',     primaryCategory: 'CHAT', capabilities: ['CHAT'],           description: '当前旗舰，最高质量，成本最高',                  briefRating: '当前旗舰，最高质量（成本最高）', contextLabel: '1M' },
  { id: 'qwen3.7-max',          name: '通义千问 3.7 Max',     primaryCategory: 'CHAT', capabilities: ['CHAT'],           description: '3.7 代顶级，强于 3.6 Max',                      briefRating: '3.7 代顶级，强于 3.6 Max',     contextLabel: '1M' },
  { id: 'qwen3.7-plus',         name: '通义千问 3.7 Plus',    primaryCategory: 'CHAT', capabilities: ['CHAT'],           description: '3.7 代主力，Plus 升级版',                       briefRating: '3.7 代主力，Plus 升级版（性价比新首选）', contextLabel: '1M' },
  { id: 'qwen3.6-flash',        name: '通义千问 3.6 Flash',   primaryCategory: 'CHAT', capabilities: ['CHAT', 'VISION'], description: '阿里百炼视觉对话主力，支持图片理解',           briefRating: '视觉对话主力，多模态首选',     contextLabel: '1M' },
  { id: 'qwen-turbo',           name: '通义千问 Turbo',        primaryCategory: 'CHAT', capabilities: ['CHAT'],           description: '轻量快速，成本最低',                            briefRating: '轻量快，海量打标首选',         contextLabel: '1M' },
  { id: 'qwen-plus',            name: '通义千问 Plus',         primaryCategory: 'CHAT', capabilities: ['CHAT'],           description: '综合主力，长文本首选',                          briefRating: '综合主力，长文本首选',         contextLabel: '1M' },
  { id: 'qwen-max',             name: '通义千问 Max',          primaryCategory: 'CHAT', capabilities: ['CHAT'],           description: '顶级质量，成本高',                              briefRating: '顶级质量（成本高）',           contextLabel: '32K' },
  { id: 'qwen-max-longcontext', name: '通义千问 Max Long',     primaryCategory: 'CHAT', capabilities: ['CHAT'],           description: '长文本顶级，文档分析',                          briefRating: '长文本顶级，文档分析',         contextLabel: '1M' },
  { id: 'qwen-long',            name: '通义千问 Long',         primaryCategory: 'CHAT', capabilities: ['CHAT'],           description: '1000万字超长上下文',                            briefRating: '1000万字超长上下文',           contextLabel: '10M' },
  { id: 'qwq-plus',             name: '通义千问 QwQ Plus',     primaryCategory: 'REASONING', capabilities: ['CHAT', 'REASONING'], description: '推理强，复杂长链规划',                    briefRating: '推理强，复杂长链',             contextLabel: '128K' },
  { id: 'qwen-coder-plus',      name: '通义千问 Coder Plus',   primaryCategory: 'CODE',  capabilities: ['CHAT', 'CODE'],  description: '代码生成与重构',                                briefRating: '代码生成与重构',               contextLabel: '128K' },
  // 视觉/多模态 4
  { id: 'qwen-vl-plus',         name: '通义千问 VL Plus',      primaryCategory: 'VISION', capabilities: ['VISION', 'CHAT'], description: '视觉对话性价比',                                briefRating: '视觉对话性价比',               contextLabel: '32K' },
  { id: 'qwen-vl-max',          name: '通义千问 VL Max',       primaryCategory: 'VISION', capabilities: ['VISION', 'CHAT'], description: '视觉理解顶级',                                  briefRating: '视觉理解顶级',                 contextLabel: '32K' },
  { id: 'qwen-omni-turbo',      name: '通义千问 Omni Turbo',   primaryCategory: 'OMNI',   capabilities: ['OMNI'],          description: '全模态（视/听/文）',                            briefRating: '全模态（视/听/文）',           contextLabel: '128K' },
  { id: 'qwen-audio-asr',       name: '通义千问 Audio ASR',    primaryCategory: 'AUDIO',  capabilities: ['AUDIO'],         description: '语音转文字',                                    briefRating: '语音转文字',                   contextLabel: '—' },
  // 翻译 / 嵌入 2
  { id: 'qwen-mt-flash',        name: '通义千问 MT Flash',     primaryCategory: 'TRANSLATION', capabilities: ['TRANSLATION'], description: '翻译首选，Listing 本地化',                  briefRating: '翻译首选，Listing 本地化',     contextLabel: '—' },
  { id: 'text-embedding-v3',    name: '通义千问 Embedding v3', primaryCategory: 'EMBEDDING',   capabilities: ['EMBEDDING'],   description: '向量化首选，RAG 与语义检索',               briefRating: '向量化首选',                   contextLabel: '—' },
  // 生图 6（与 BailianImageService.ts 注册元数据一一对应）
  { id: 'wan2.7-image-pro',      name: '万相 2.7 Pro',          primaryCategory: 'IMAGE', capabilities: ['IMAGE'],         description: '高质量商品主图，文字与品牌色控制，参照图上限 8 张', briefRating: '商品主图高质量，参照图8张', contextLabel: '8图', costLabel: '¥0.16/张' },
  { id: 'wan2.7-image',          name: '万相 2.7',              primaryCategory: 'IMAGE', capabilities: ['IMAGE'],         description: '质量与生成速度平衡',                          briefRating: '质量与速度平衡',               contextLabel: '8图', costLabel: '¥0.08/张' },
  { id: 'qwen-image-2.0-pro',   name: '千问 Image 2.0 Pro',   primaryCategory: 'IMAGE', capabilities: ['IMAGE'],         description: '纯文生图，文字渲染与复杂指令表现更强',        briefRating: '文字渲染强，纯文生图',         contextLabel: '纯文', costLabel: '¥0.20/张' },
  { id: 'qwen-image-2.0',       name: '千问 Image 2.0',       primaryCategory: 'IMAGE', capabilities: ['IMAGE'],         description: '纯文生图，生成速度快',                        briefRating: '快速生图，纯文生图',           contextLabel: '纯文', costLabel: '¥0.10/张' },
  { id: 'qwen-image-edit-plus', name: '千问 Image Edit Plus',  primaryCategory: 'IMAGE', capabilities: ['IMAGE'],         description: '多图参照编辑，保持商品结构与材质',            briefRating: '多图改图，结构保持',           contextLabel: '3图', costLabel: '¥0.12/张' },
  { id: 'qwen-image-edit-max',  name: '千问 Image Edit Max',   primaryCategory: 'IMAGE', capabilities: ['IMAGE'],         description: '高保真多图编辑，复杂商品细节',                briefRating: '高保真编辑，细节还原',         contextLabel: '3图', costLabel: '¥0.20/张' },
  // 语音 1
  { id: 'qwen-audio',           name: '通义千问 Audio',        primaryCategory: 'AUDIO',  capabilities: ['AUDIO'],         description: '语音合成 TTS',                                 briefRating: '语音合成 TTS',                 contextLabel: '—' }
]

const CAPABILITIES: BailianCapability[] = ['CHAT', 'VISION', 'IMAGE', 'TRANSLATION', 'EMBEDDING', 'AUDIO', 'CODE', 'REASONING', 'OMNI']

export function BailianModelMallPage({ onBack }: { onBack: () => void }) {
  const [capabilityFilter, setCapabilityFilter] = useState<Set<BailianCapability>>(new Set(CAPABILITIES))
  const [keyword, setKeyword] = useState('')
  const [bailianConfigured, setBailianConfigured] = useState<boolean | null>(null)

  const refreshKeyStatus = useCallback(() => {
    window.desktop.llmKeys.list()
      .then(items => {
        const target = items.find(item => item.id === 'bailian')
        setBailianConfigured(Boolean(target?.configured))
      })
      .catch(() => setBailianConfigured(false))
  }, [])

  useEffect(() => {
    refreshKeyStatus()
  }, [refreshKeyStatus])

  const toggleCapability = (cap: BailianCapability) => {
    setCapabilityFilter(prev => {
      const next = new Set(prev)
      if (next.has(cap)) next.delete(cap)
      else next.add(cap)
      return next
    })
  }

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return BAILIAN_MODELS.filter(model => {
      // 能力筛选：模型至少有一个能力命中
      const capOk = model.capabilities.some(cap => capabilityFilter.has(cap))
      if (!capOk) return false
      if (!kw) return true
      return model.id.toLowerCase().includes(kw)
        || model.name.toLowerCase().includes(kw)
        || model.description.toLowerCase().includes(kw)
        || model.briefRating.toLowerCase().includes(kw)
    })
  }, [capabilityFilter, keyword])

  const capabilityCount = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const cap of CAPABILITIES) counts[cap] = 0
    for (const m of BAILIAN_MODELS) for (const cap of m.capabilities) counts[cap] = (counts[cap] || 0) + 1
    return counts
  }, [])

  return <section className="bailian-mall-page">
    <div className="bailian-mall-toolbar">
      <div className="bailian-mall-toolbar-text">
        <b>阿里百炼 模型广场</b>
        <small>{BAILIAN_MODELS.length} 个大模型聚合 · 按能力筛选；元数据内置，价格以百炼控制台为准</small>
      </div>
      <div className="bailian-mall-toolbar-actions">
        <span className={`bailian-mall-status ${bailianConfigured === true ? 'ready' : bailianConfigured === false ? 'pending' : ''}`}>
          {bailianConfigured === null
            ? '正在读取 Key 状态…'
            : bailianConfigured ? '已配置 BAILIAN_API_KEY' : '未配置 BAILIAN_API_KEY'}
        </span>
        <button type="button" onClick={onBack}>返回 AI总部</button>
      </div>
    </div>
    <div className="bailian-mall-layout">
      <aside className="bailian-mall-filter">
        <div className="bailian-mall-filter-section">
          <b>搜索</b>
          <input
            type="search"
            placeholder="按 id / 名称 / 描述搜索"
            value={keyword}
            onChange={event => setKeyword(event.target.value)}
          />
        </div>
        <div className="bailian-mall-filter-section">
          <b>能力</b>
          {CAPABILITIES.map(cap => {
            const meta = CAPABILITY_META[cap]
            const active = capabilityFilter.has(cap)
            return <button
              key={cap}
              type="button"
              className={`bailian-mall-chip ${active ? 'active' : ''}`}
              style={active ? { color: meta.color, borderColor: meta.color, background: `${meta.color}14` } : undefined}
              onClick={() => toggleCapability(cap)}
            >
              {meta.label}
              <em>{capabilityCount[cap] || 0}</em>
            </button>
          })}
        </div>
        <div className="bailian-mall-filter-hint">
          命中 {filtered.length} / {BAILIAN_MODELS.length} 个模型
        </div>
      </aside>
      <div className="bailian-mall-grid">
        {filtered.length === 0
          ? <div className="bailian-mall-empty">没有匹配的模型，请调整筛选条件</div>
          : filtered.map(model => <BailianModelCard
              key={model.id}
              model={model}
              bailianConfigured={bailianConfigured === true}
            />)}
      </div>
    </div>
  </section>
}

function BailianModelCard({ model, bailianConfigured }: {
  model: BailianModelEntry
  bailianConfigured: boolean
}) {
  return <article className="bailian-mall-card">
    <header className="bailian-mall-card-head" style={{ background: '#2563eb14', borderColor: '#2563eb30' }}>
      <span className="bailian-mall-card-vendor" style={{ color: '#2563eb' }}>
        <span className="bailian-mall-card-vendor-icon">☁</span>
        阿里百炼
      </span>
      {model.contextLabel && <span className="bailian-mall-card-context">{model.contextLabel}</span>}
    </header>
    <div className="bailian-mall-card-body">
      <h3 className="bailian-mall-card-name">{model.name}</h3>
      <code className="bailian-mall-card-id">{model.id}</code>
      <p className="bailian-mall-card-desc">{model.description}</p>
      {(() => {
        const rating = model.briefRating
        const isWarn = /^(✗|⚠)/.test(rating) || rating.includes('慎用') || rating.includes('不推荐')
        return <div className={`bailian-mall-card-rating ${isWarn ? 'bailian-mall-card-rating-warn' : ''}`} title="选型口诀">{rating}</div>
      })()}
      <div className="bailian-mall-card-tags">
        {model.capabilities.map(cap => {
          const meta = CAPABILITY_META[cap]
          return <span key={cap} className="bailian-mall-card-tag" style={{ color: meta.color, background: `${meta.color}14`, borderColor: `${meta.color}30` }}>{meta.label}</span>
        })}
        {model.primaryCategory === 'IMAGE' && <span className="bailian-mall-card-tag bailian-mall-card-tag-wired">已接入 AI 美工</span>}
      </div>
    </div>
    <BailianModelPricingRow model={model} />
    <footer className="bailian-mall-card-foot">
      {bailianConfigured
        ? <em className="ready">可用</em>
        : <em className="bailian-mall-card-pending">需先配置 BAILIAN_API_KEY</em>}
    </footer>
  </article>
}

function BailianModelPricingRow({ model }: { model: BailianModelEntry }) {
  // 生图模型显示 costLabel；其他模型显示「暂无」占位（百炼无标准价格展示接口）
  if (model.costLabel) {
    return <div className="bailian-mall-pricing">
      <div className="bailian-mall-pricing-grid">
        <div className="bailian-mall-pricing-cell">
          <span className="bailian-mall-pricing-label">单价</span>
          <span className="bailian-mall-pricing-value">{model.costLabel}</span>
        </div>
      </div>
    </div>
  }
  return <div className="bailian-mall-pricing bailian-mall-pricing-empty">— 暂无 —</div>
}

export default BailianModelMallPage
