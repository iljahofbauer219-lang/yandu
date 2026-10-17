import { useEffect, useRef, useState } from 'react'
import type { ImageModelProfile } from '../shared/contracts'
import {
  DEFAULT_EBAY_IMAGE_CATEGORY_COUNTS,
  EBAY_IMAGE_CATEGORY_COUNT_MAX,
  EBAY_IMAGE_CATEGORY_COUNT_MIN,
  buildCategoryGenerationPrompt,
  buildCategoryShotCards,
  describeEbayImageCategoryCounts,
  ebayImageCountsFromLegacyPerCount,
  marketingFactCategoryLabel,
  marketingFactCategoryShortLabel,
  normalizeEbayImageCategoryCounts,
  selectCategoryReferences,
  withEbayImageCategoryCount,
  type EbayCategoryShotCard,
  type EbayImageCategory,
  type EbayImageCategoryCounts,
  type EbayImageOutputMode,
  type EbayMarketingFacts
} from '../shared/ebayImageCategoryPlan'
import { humanizeLinduoImageError, isLinduoNoChannelError } from '../shared/linduoImageFallback'

// 简化七步：合规内置 → 原图 → 事实卡自动 → 模型+出图模式 → 一键生成四类图 → 逐图采纳/单张重生 → 保留回显
const CATEGORIES: EbayImageCategory[] = ['HERO', 'PRODUCT', 'PAIN_POINT', 'SCENE']
/** 零度API 整链无通道时自动跨厂商改用的模型（参照上限按其元数据重算） */
const CROSS_VENDOR_MODEL = 'wan2.7-image-pro'
// 四类配色：数量输入标签与「⑤ 审核与采纳」分组标题共用，便于对应
const CATEGORY_COLORS: Record<EbayImageCategory, string> = {
  HERO: '#e74c3c', PRODUCT: '#27ae60', PAIN_POINT: '#1abc9c', SCENE: '#3498db'
}

interface GeneratedImage {
  cardId: string
  category: EbayImageCategory
  title: string
  url: string
  /** 实际出图模型（零度降级时与所选模型不同） */
  model?: string
}

interface PersistedState {
  mode: EbayImageOutputMode
  counts: EbayImageCategoryCounts
  facts: EbayMarketingFacts | null
  generated: GeneratedImage[]
  keptByCategory: Partial<Record<EbayImageCategory, string[]>>
}

interface Props {
  listingId: string
  sourceImages: string[]
  sourceLabels: string[]
  title: string
  description: string
  itemSpecifics: Array<{ name: string; value: string }>
  imageModels: ImageModelProfile[]
  onAllStagesConfirmed: (images: Record<string, string[]>) => void
}

async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>, onProgress?: (done: number, total: number) => void): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  let done = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
      done++
      onProgress?.(done, items.length)
    }
  })
  await Promise.all(workers)
  return results
}

function readPersisted(listingId: string): PersistedState | null {
  try {
    const raw = localStorage.getItem(`ebay-image-simplified:v1:${listingId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedState> & { perCount?: unknown }
    if (!parsed || typeof parsed !== 'object') return null
    // 旧版单一「每类图片数」自动迁移为四类同值
    const counts = parsed.counts && typeof parsed.counts === 'object'
      ? normalizeEbayImageCategoryCounts(parsed.counts)
      : ebayImageCountsFromLegacyPerCount(parsed.perCount)
    return { mode: parsed.mode === 'TEXT_COMBO' ? 'TEXT_COMBO' : 'PURE', counts, facts: parsed.facts || null, generated: Array.isArray(parsed.generated) ? parsed.generated : [], keptByCategory: parsed.keptByCategory || {} }
  } catch {
    return null
  }
}

export default function EbayImageStagePanel(props: Props) {
  const persisted = useRef<PersistedState | null | undefined>(undefined)
  if (persisted.current === undefined) persisted.current = readPersisted(props.listingId)
  const [mode, setMode] = useState<EbayImageOutputMode>(persisted.current?.mode || 'PURE')
  const [counts, setCounts] = useState<EbayImageCategoryCounts>(persisted.current?.counts || { ...DEFAULT_EBAY_IMAGE_CATEGORY_COUNTS })
  const [facts, setFacts] = useState<EbayMarketingFacts | null>(persisted.current?.facts || null)
  const [factsBusy, setFactsBusy] = useState(false)
  const [factsError, setFactsError] = useState('')
  const [modelId, setModelId] = useState('')
  const [generated, setGenerated] = useState<GeneratedImage[]>(persisted.current?.generated || [])
  const [keptByCategory, setKeptByCategory] = useState<Partial<Record<EbayImageCategory, string[]>>>(persisted.current?.keptByCategory || {})
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [regeneratingCardId, setRegeneratingCardId] = useState('')
  const [error, setError] = useState('')
  /** 主进程重试/降级的中文说明（提示条展示） */
  const [genNotice, setGenNotice] = useState('')
  const lastRunRef = useRef<{ cards: EbayCategoryShotCard[]; replace: boolean }>({ cards: [], replace: true })

  const keptUrls = new Set(Object.values(keptByCategory).flat())
  const generatedRef = useRef(generated)
  useEffect(() => { generatedRef.current = generated }, [generated])

  const persist = (next: { mode?: EbayImageOutputMode; counts?: EbayImageCategoryCounts; facts?: EbayMarketingFacts | null; generated?: GeneratedImage[]; keptByCategory?: Partial<Record<EbayImageCategory, string[]>> }) => {
    const state: PersistedState = {
      mode: next.mode ?? mode,
      counts: next.counts ?? counts,
      facts: next.facts !== undefined ? next.facts : facts,
      generated: next.generated ?? generated,
      keptByCategory: next.keptByCategory ?? keptByCategory
    }
    try { localStorage.setItem(`ebay-image-simplified:v1:${props.listingId}`, JSON.stringify(state)) } catch { /* 忽略配额错误 */ }
  }

  const emit = (kept: Partial<Record<EbayImageCategory, string[]>>) => {
    const mapped: Record<string, string[]> = {}
    for (const category of CATEGORIES) {
      const urls = (kept[category] || []).filter(Boolean)
      if (urls.length) mapped[category] = urls
    }
    props.onAllStagesConfirmed(mapped)
  }

  // 进入环节回显：已保留图片直接接入下游（视频/终检链）
  const emittedOnMount = useRef(false)
  useEffect(() => {
    if (emittedOnMount.current) return
    emittedOnMount.current = true
    if (Object.values(keptByCategory).some(urls => urls.length)) emit(keptByCategory)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 模型默认推荐：优先匹配主图/白底 strengths
  useEffect(() => {
    if (modelId || !props.imageModels.length) return
    const recommended = props.imageModels.find(model => ['主图', '白底', '保真'].some(keyword => (model.strengths || '').includes(keyword) || (model.description || '').includes(keyword))) || props.imageModels[0]
    if (recommended) setModelId(recommended.id)
  }, [props.imageModels, modelId])

  const loadFacts = async () => {
    setFactsBusy(true)
    setFactsError('')
    try {
      const result = await window.desktop.image.marketingFacts({ title: props.title, description: props.description, itemSpecifics: props.itemSpecifics })
      if (!result) throw new Error('事实卡生成失败：视觉模型未返回可用内容，请确认商品详情后重试')
      setFacts(result)
      persist({ facts: result })
    } catch (reason) {
      setFactsError(reason instanceof Error ? reason.message : '事实卡生成失败')
    } finally {
      setFactsBusy(false)
    }
  }

  // 事实卡自动产出（有详情或属性即可；失败可手动重试）
  useEffect(() => {
    if (facts || factsBusy || !props.sourceImages.length) return
    void loadFacts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facts, factsBusy, props.sourceImages.length, props.listingId])

  // 参照上限优先读模型元数据（0=纯文生图不传参照），缺失按模型族回退，与主进程裁剪规则一致；按实际出图模型取值（降级/切换时不用旧选中值）
  const referenceLimitFor = (id: string): number => {
    const profile = props.imageModels.find(model => model.id === id)
    if (typeof profile?.maxReferenceImages === 'number') return profile.maxReferenceImages
    return id.startsWith('wan2.7') ? 8 : id === 'z-image-turbo' ? 1 : 3
  }
  const shotContext = { title: props.title, description: props.description, itemSpecifics: props.itemSpecifics }

  const modelLabel = (id: string) => props.imageModels.find(model => model.id === id)?.name || id

  /** 一批分镜在指定模型下出图；返回是否成功、是否零度无通道、中文错误文案 */
  const runBatch = async (cards: EbayCategoryShotCard[], replace: boolean, activeModel: string, prelude: string): Promise<{ ok: boolean; noChannel: boolean; message: string }> => {
    const referenceLimit = referenceLimitFor(activeModel)
    try {
      const notices: string[] = prelude ? [prelude] : []
      const modelsUsed: string[] = []
      const groups = await mapWithLimit(cards, 2, async card => {
        // 逐卡按角色挑参照：细节卡用细节/尺寸原图、场景卡用场景原图，不再全卡共用前 3 张
        const references = selectCategoryReferences(props.sourceImages, props.sourceLabels, card.category, referenceLimit)
        try {
          const result = await window.desktop.image.generate({
            model: activeModel,
            referenceImageUrls: references,
            promptExtend: false,
            size: card.category === 'HERO' || card.category === 'PRODUCT' ? '2K' : '1K',
            count: card.variations,
            prompt: buildCategoryGenerationPrompt(card, facts as EbayMarketingFacts, mode)
          })
          if (result.notice) notices.push(result.notice)
          modelsUsed.push(result.model || activeModel)
          return { failed: false, images: result.imageUrls.map(url => ({ cardId: card.id, category: card.category, title: card.title, url, model: result.model || activeModel })), message: '' }
        } catch (reason) {
          // 单个分镜失败不再销毁其余已出图的分类：缺的那张走卡上「↻ 重新生成」
          const raw = reason instanceof Error ? reason.message : '图片生成失败'
          return { failed: true, noChannel: isLinduoNoChannelError(raw), images: [], message: humanizeLinduoImageError(raw) }
        }
      }, (done, total) => setProgress(`正在生成 ${done}/${total} 组分镜…`))
      const fresh = groups.flatMap(group => group.images)
      const failedCards = groups.filter(group => group.failed)
      if (!fresh.length) {
        return { ok: false, noChannel: groups.length > 0 && groups.every(group => group.noChannel), message: failedCards[0]?.message || '模型未返回图片，请更换模型或重试' }
      }
      if (failedCards.length) notices.push(`${failedCards.length} 个分镜本次未出图（${failedCards[0]?.message || '上游未返回图片'}），可在该分镜卡上单独重新生成。`)
      // 零度链内降级：把下拉框切到实际出图模型，避免用户停留在已无通道的模型上
      const actual = modelsUsed.find(id => id !== activeModel) || activeModel
      if (actual !== activeModel) setModelId(actual)
      setGenNotice([...new Set(notices)].join(' '))
      const cardIds = new Set(cards.map(card => card.id))
      const next = [...(replace ? [] : generatedRef.current.filter(image => !cardIds.has(image.cardId))), ...fresh]
      generatedRef.current = next
      setGenerated(next)
      persist({ generated: next })
      return { ok: true, noChannel: false, message: '' }
    } catch (reason) {
      const raw = reason instanceof Error ? reason.message : '图片生成失败'
      return { ok: false, noChannel: isLinduoNoChannelError(raw), message: humanizeLinduoImageError(raw) }
    }
  }

  const generateCards = async (cards: EbayCategoryShotCard[], replace: boolean) => {
    const activeModel = modelId
    if (!activeModel) { setError('请先选择图片生成大模型'); return }
    lastRunRef.current = { cards, replace }
    setBusy(true)
    setError('')
    setGenNotice('')
    setProgress('')
    let outcome = await runBatch(cards, replace, activeModel, '')
    if (!outcome.ok && outcome.noChannel && activeModel !== CROSS_VENDOR_MODEL) {
      // 零度整链无通道：自动改用万相重跑同一批分镜（本会话内只兜一次，避免循环）
      const notice = `零度API 当前无可用生图通道，已自动改用 ${modelLabel(CROSS_VENDOR_MODEL)} 完成本次生成。`
      setModelId(CROSS_VENDOR_MODEL)
      outcome = await runBatch(cards, replace, CROSS_VENDOR_MODEL, notice)
      setError(outcome.ok ? '' : `${notice}${outcome.message}`)
    } else if (!outcome.ok) {
      setError(outcome.message)
    }
    setBusy(false)
    setProgress('')
  }

  // 红条动作：原样重跑上一次的分镜集合
  const retryLastRun = () => {
    const last = lastRunRef.current
    if (!last?.cards.length) return
    void generateCards(last.cards, last.replace)
  }

  const runOneClick = () => {
    if (!facts) { setError('事实卡尚未生成，请稍候或点击“重新生成事实卡”'); return }
    void generateCards(buildCategoryShotCards(facts, counts, shotContext), true)
  }

  const regenerateCard = (cardId: string) => {
    if (!facts) return
    const sample = generatedRef.current.find(image => image.cardId === cardId)
    if (!sample) return
    const card: EbayCategoryShotCard = buildCategoryShotCards(facts, counts, shotContext).find(item => item.id === cardId)
      || { id: cardId, category: sample.category, title: sample.title, instruction: sample.title, variations: 1 }
    setRegeneratingCardId(cardId)
    void generateCards([card], false).finally(() => setRegeneratingCardId(''))
  }

  const toggleKept = (image: GeneratedImage) => {
    setKeptByCategory(current => {
      const list = current[image.category] || []
      const nextList = list.includes(image.url) ? list.filter(url => url !== image.url) : [...list, image.url]
      const next = { ...current, [image.category]: nextList }
      persist({ keptByCategory: next })
      emit(next)
      return next
    })
  }

  const unkeep = (category: EbayImageCategory, url: string) => {
    setKeptByCategory(current => {
      const next = { ...current, [category]: (current[category] || []).filter(item => item !== url) }
      persist({ keptByCategory: next })
      emit(next)
      return next
    })
  }

  const keptCount = keptUrls.size

  return <div className="ebay-stage-panel">
    <div className="ebay-stage-header" style={{ borderLeftColor: '#1abc9c' }}>
      <b>图片优化 · 简化流程</b>
      <small>合规规则内置于生图提示词 → 读取产品原图 → 事实卡自动 → 选模型与出图模式 → 一键生成 → 逐图采纳/单张重生 → 保留回显</small>
    </div>

    <section className="ebay-stage-section">
      <header><b>① 产品原图</b><small>来自『02 选择原图』，共 {props.sourceImages.length} 张（含服务器产品页图集）</small></header>
      <div className="ebay-stage-source-grid">
        {props.sourceImages.slice(0, 12).map((url, index) => (
          <div className="ebay-stage-source-item selected" key={url}>
            <img src={url} alt={`原图 ${index + 1}`} />
            <span>{props.sourceLabels[index] || `原图 ${index + 1}`}</span>
          </div>
        ))}
      </div>
    </section>

    <section className="ebay-stage-section">
      <header>
        <b>② 营销事实卡（自动）</b>
        <button className="yd-button yd-button--secondary" disabled={factsBusy} onClick={() => void loadFacts()}>
          {factsBusy ? '生成中…' : facts ? '重新生成事实卡' : '生成事实卡'}
        </button>
      </header>
      {facts ? (
        <div className="ebay-stage-fact-cards">
          <div className="ebay-stage-fact-global">
            <p><b>购买理由：</b>{facts.purchaseReason}</p>
            <p><b>痛点解决：</b>{facts.painPoints.join('；')}</p>
            <p><b>应用场景：</b>{facts.scenarios.join('；')}</p>
          </div>
        </div>
      ) : factsBusy ? <p className="ebay-stage-placeholder">正在根据产品详情页内容生成事实卡…</p>
        : <p className="ebay-stage-placeholder">{factsError || '等待事实卡生成（依据产品详情页描述与属性）'}</p>}
    </section>

    <section className="ebay-stage-section">
      <header><b>③ 模型与出图模式</b><small>eBay 模式严禁附加文字；亚马逊模式允许简洁卖点文字图层</small></header>
      <div className="ebay-stage-model-select">
        <select value={modelId} onChange={event => setModelId(event.target.value)} aria-label="图片生成大模型">
          <option value="">请选择模型</option>
          {props.imageModels.map(model => (
            <option key={model.id} value={model.id}>{model.name}{model.costLabel ? ` · ${model.costLabel}` : ''}</option>
          ))}
        </select>
        <div className="ebay-stage-count-grid">
          <span className="ebay-stage-count-grid-title">各类图片张数</span>
          {CATEGORIES.map(category => (
            <label className="ebay-stage-count-input" key={category}>
              <span className="ebay-stage-count-input-label" style={{ color: CATEGORY_COLORS[category] }}>{marketingFactCategoryShortLabel(category)}</span>
              <input aria-label={`${marketingFactCategoryShortLabel(category)}图片数`} type="number" min={EBAY_IMAGE_CATEGORY_COUNT_MIN} max={EBAY_IMAGE_CATEGORY_COUNT_MAX}
                value={counts[category]}
                onChange={event => { const next = withEbayImageCategoryCount(counts, category, event.target.value); setCounts(next); persist({ counts: next }) }} />
            </label>
          ))}
        </div>
      </div>
      <div className="ebay-stage-naturalize-profile">
        <span>出图模式：</span>
        <label><input type="radio" name="image-output-mode" checked={mode === 'PURE'} onChange={() => { setMode('PURE'); persist({ mode: 'PURE' }) }} /> 纯图片（适合 eBay）</label>
        <label><input type="radio" name="image-output-mode" checked={mode === 'TEXT_COMBO'} onChange={() => { setMode('TEXT_COMBO'); persist({ mode: 'TEXT_COMBO' }) }} /> 图片和文字结合（适合亚马逊）</label>
      </div>
    </section>

    <section className="ebay-stage-section">
      <header>
        <b>④ 一键生成四类图</b>
        <button className={`yd-button ${generated.length ? 'yd-button--secondary' : 'yd-button--primary'}`} disabled={!facts || !modelId || busy} onClick={runOneClick}>
          {busy ? progress || '生成中…' : generated.length ? `重新一键生成（${describeEbayImageCategoryCounts(counts)}）` : `一键生成（${describeEbayImageCategoryCounts(counts)}）`}
        </button>
      </header>
      <small>eBay 图片规则内置：商品呈现准确、无额外边框、无附加文字或营销图形、无水印；主图纯白底且商品占幅≥80%。采纳后系统自动执行最终图集检查。</small>
      {genNotice && <div className="ebay-stage-gen-notice" role="status">{genNotice}</div>}
      {error && (
        <div className="ebay-stage-error" role="alert">
          <b>生成未完成</b>
          <span>{error}</span>
          <div className="ebay-stage-error-actions">
            <button type="button" className="yd-button yd-button--secondary" disabled={busy || !lastRunRef.current.cards.length} onClick={retryLastRun}>重试</button>
          </div>
        </div>
      )}
    </section>

    {generated.length > 0 && (
      <section className="ebay-stage-section">
        <header><b>⑤ 审核与采纳</b><small>点击图采纳/取消；↻ 单张重生成；已采纳 {keptCount} 张</small></header>
        {CATEGORIES.map(category => {
          const images = generated.filter(image => image.category === category)
          if (!images.length) return null
          const fallbackModel = images.map(image => image.model).find(model => model && model !== modelId) || ''
          const fallbackName = fallbackModel ? (props.imageModels.find(model => model.id === fallbackModel)?.name || fallbackModel) : ''
          return <div key={category} className="ebay-stage-generated">
            <p className="ebay-stage-gen-hint" style={{ color: CATEGORY_COLORS[category], fontWeight: 600 }}>{marketingFactCategoryLabel(category)} · {images.length} 张{counts[category] > images.length ? `（设定 ${counts[category]}，受事实卡条数限制）` : ''}{fallbackName ? ` · 实际模型：${fallbackName}` : ''}</p>
            {images.map((image, index) => (
              <div key={image.url} className="ebay-stage-gen-cell">
                <button type="button" className={`ebay-stage-gen-item ${keptUrls.has(image.url) ? 'selected' : ''}`} onClick={() => toggleKept(image)}>
                  <img src={image.url} alt={`${image.title} ${index + 1}`} />
                  <em className="ebay-stage-gen-card-tag">{image.cardId} · {image.title}</em>
                  <span>{keptUrls.has(image.url) ? '✓ 已采纳' : '点击采纳'}</span>
                </button>
                <button type="button" className="ebay-stage-gen-regen" disabled={busy || regeneratingCardId === image.cardId} onClick={() => regenerateCard(image.cardId)}>
                  {regeneratingCardId === image.cardId ? '生成中…' : '↻ 重新生成'}
                </button>
              </div>
            ))}
          </div>
        })}
      </section>
    )}

    {keptCount > 0 && (
      <section className="ebay-stage-section">
        <header><b>⑥ 已保留图片</b><small>按商品持久化保存，下次进入本环节自动回显并接入视频与终检链</small></header>
        <div className="ebay-stage-confirmed-grid">
          {CATEGORIES.flatMap(category => (keptByCategory[category] || []).map(url => (
            <div className="ebay-stage-gen-cell" key={url}>
              <img src={url} alt={`已保留 ${marketingFactCategoryLabel(category)}`} />
              <button type="button" onClick={() => unkeep(category, url)}>移除</button>
            </div>
          )))}
        </div>
      </section>
    )}
  </div>
}
