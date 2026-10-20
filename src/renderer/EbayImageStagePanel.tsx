import { useEffect, useRef, useState } from 'react'
import type { ImageModelProfile } from '../shared/contracts'
import {
  DEFAULT_EBAY_IMAGE_CATEGORY_COUNTS,
  EBAY_IMAGE_CATEGORY_COUNT_MAX,
  EBAY_IMAGE_CATEGORY_COUNT_MIN,
  MARKETING_FACTS_VERSION,
  buildCategoryGenerationPrompt,
  buildCategoryShotCards,
  buildMarketingFactRows,
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
import {
  DEFAULT_EBAY_IMAGE_MODEL_PRESENCE,
  DEFAULT_EBAY_IMAGE_RULES,
  EBAY_IMAGE_MODEL_PRESENCE_OPTIONS,
  EBAY_IMAGE_RULES,
  describeActiveEbayImageRules,
  normalizeEbayImageModelPresence,
  normalizeEbayImageRules,
  type EbayImageModelPresence,
  type EbayImageRuleState
} from '../shared/ebayImageRules'
import { findDuplicateGroups } from '../shared/imageSimilarity'
import {
  SIMPLE_CATEGORY_COUNT_MIN,
  mergeSimpleGalleryOrder,
  normalizeSimpleCategoryCounts,
  normalizeSimpleOrder,
  simpleSourceCategory,
  triageSimpleSources,
  withSimpleCategoryCount,
  type EbaySimpleBackground,
  type EbaySimpleGalleryMember,
  type EbaySimpleSourceCheck,
  type EbaySimpleTriage
} from '../shared/ebayImageSimpleLane'

// 简化流程：合规内置 → 原图 → 事实卡自动 → 模型+出图模式 → 生图规则勾选 → 一键生成四类图 → 逐图采纳/单张重生 → 保留回显
const CATEGORIES: EbayImageCategory[] = ['HERO', 'PRODUCT', 'PAIN_POINT', 'SCENE']
/** 零度API 整链无通道时自动跨厂商改用的模型（参照上限按其元数据重算） */
const CROSS_VENDOR_MODEL = 'wan2.7-image-pro'
// 四类配色：数量输入标签与「⑥ 审核与采纳」分组标题共用，便于对应
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
  /** 主进程算出的 64 位感知指纹（同类雷同检测用；取不到为空串，不参与判定） */
  hash?: string
  /** 与同类哪张雷同（每组保留第一张，其余标记出来供自动换参照重出/人工处理） */
  dupeOf?: string
}

interface PersistedState {
  mode: EbayImageOutputMode
  counts: EbayImageCategoryCounts
  rules: EbayImageRuleState
  presence: EbayImageModelPresence
  facts: EbayMarketingFacts | null
  generated: GeneratedImage[]
  keptByCategory: Partial<Record<EbayImageCategory, string[]>>
  lane?: 'simple' | 'model'
  simpleCounts?: EbayImageCategoryCounts
  simpleTriage?: EbaySimpleTriage | null
  simpleRegen?: Record<string, { url: string; model?: string }>
  simpleGenerated?: GeneratedImage[]
  simpleOrder?: string[]
  simpleDeleted?: string[]
}

interface Props {
  listingId: string
  sourceImages: string[]
  sourceLabels: string[]
  title: string
  description: string
  itemSpecifics: Array<{ name: string; value: string }>
  /** 事实卡「核心商品词」与标题优化环节同源，不进大模型 */
  coreTerm: string
  /** 事实卡「搜索长尾词」取标题优化已确认市场词中最主要的 5 个，不进大模型 */
  searchTerms: string[]
  /** 每张原图的角色（主图/细节/场景…），简版档排序按类回传下游用 */
  sourceRoles: string[]
  /** 每张原图的合规事实（尺寸+视觉规则），由 App 侧既有快照与缓存报告算出 */
  sourceChecks: EbaySimpleSourceCheck[]
  imageModels: ImageModelProfile[]
  onAllStagesConfirmed: (images: Record<string, string[]>) => void
  /** 可选：从原图选区剔除某张（简版档「非图文页图集」或尺寸不合格时提供） */
  onRemoveFromSelection?: (url: string) => void
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
    return { mode: parsed.mode === 'TEXT_COMBO' ? 'TEXT_COMBO' : 'PURE', counts, rules: normalizeEbayImageRules(parsed.rules), presence: normalizeEbayImageModelPresence(parsed.presence), facts: parsed.facts || null, generated: Array.isArray(parsed.generated) ? parsed.generated : [], keptByCategory: parsed.keptByCategory || {}, lane: parsed.lane === 'simple' ? 'simple' : 'model', simpleCounts: parsed.simpleCounts && typeof parsed.simpleCounts === 'object' ? normalizeSimpleCategoryCounts(parsed.simpleCounts) : undefined, simpleTriage: parsed.simpleTriage || null, simpleRegen: parsed.simpleRegen && typeof parsed.simpleRegen === 'object' ? parsed.simpleRegen : {}, simpleGenerated: Array.isArray(parsed.simpleGenerated) ? parsed.simpleGenerated : [], simpleOrder: Array.isArray(parsed.simpleOrder) ? parsed.simpleOrder : [], simpleDeleted: Array.isArray(parsed.simpleDeleted) ? parsed.simpleDeleted : [] }
  } catch {
    return null
  }
}

export default function EbayImageStagePanel(props: Props) {
  const persisted = useRef<PersistedState | null | undefined>(undefined)
  if (persisted.current === undefined) persisted.current = readPersisted(props.listingId)
  const [mode, setMode] = useState<EbayImageOutputMode>(persisted.current?.mode || 'PURE')
  const [counts, setCounts] = useState<EbayImageCategoryCounts>(persisted.current?.counts || { ...DEFAULT_EBAY_IMAGE_CATEGORY_COUNTS })
  const [rules, setRules] = useState<EbayImageRuleState>(persisted.current?.rules || { ...DEFAULT_EBAY_IMAGE_RULES })
  const [presence, setPresence] = useState<EbayImageModelPresence>(persisted.current?.presence || DEFAULT_EBAY_IMAGE_MODEL_PRESENCE)
  const [facts, setFacts] = useState<EbayMarketingFacts | null>(persisted.current?.facts || null)
  const [factsBusy, setFactsBusy] = useState(false)
  const [factsError, setFactsError] = useState('')
  const [modelId, setModelId] = useState('')
  // 优化档位：简版优化（原图优化→多生图片→图片排序）/ 模型优化（事实卡→规则→生成→采纳全链），默认模型优化保持老用户所见不变
  const [lane, setLane] = useState<'simple' | 'model'>(persisted.current?.lane === 'simple' ? 'simple' : 'model')
  const [generated, setGenerated] = useState<GeneratedImage[]>(persisted.current?.generated || [])
  const [keptByCategory, setKeptByCategory] = useState<Partial<Record<EbayImageCategory, string[]>>>(persisted.current?.keptByCategory || {})
  const [simpleCounts, setSimpleCounts] = useState<EbayImageCategoryCounts>(persisted.current?.simpleCounts || { ...DEFAULT_EBAY_IMAGE_CATEGORY_COUNTS })
  const [simpleTriage, setSimpleTriage] = useState<EbaySimpleTriage | null>(persisted.current?.simpleTriage || null)
  const [simpleRegen, setSimpleRegen] = useState<Record<string, { url: string; model?: string }>>(persisted.current?.simpleRegen || {})
  const [simpleGenerated, setSimpleGenerated] = useState<GeneratedImage[]>(persisted.current?.simpleGenerated || [])
  const [simpleOrder, setSimpleOrder] = useState<string[]>(persisted.current?.simpleOrder || [])
  const [simpleDeleted, setSimpleDeleted] = useState<string[]>(persisted.current?.simpleDeleted || [])
  const [triageBusy, setTriageBusy] = useState(false)
  const [regenBusyUrl, setRegenBusyUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [regeneratingCardId, setRegeneratingCardId] = useState('')
  const [error, setError] = useState('')
  /** 主进程重试/降级的中文说明（提示条展示） */
  const [genNotice, setGenNotice] = useState('')
  const lastRunRef = useRef<{ cards: EbayCategoryShotCard[]; replace: boolean }>({ cards: [], replace: true })
  const rotateRef = useRef<Record<string, number>>({})

  const keptUrls = new Set(Object.values(keptByCategory).flat())
  const generatedRef = useRef(generated)
  useEffect(() => { generatedRef.current = generated }, [generated])

  const persist = (next: { mode?: EbayImageOutputMode; counts?: EbayImageCategoryCounts; rules?: EbayImageRuleState; presence?: EbayImageModelPresence; facts?: EbayMarketingFacts | null; generated?: GeneratedImage[]; keptByCategory?: Partial<Record<EbayImageCategory, string[]>>; lane?: 'simple' | 'model'; simpleCounts?: EbayImageCategoryCounts; simpleTriage?: EbaySimpleTriage | null; simpleRegen?: Record<string, { url: string; model?: string }>; simpleGenerated?: GeneratedImage[]; simpleOrder?: string[]; simpleDeleted?: string[] }) => {
    const state: PersistedState = {
      mode: next.mode ?? mode,
      counts: next.counts ?? counts,
      rules: next.rules ?? rules,
      presence: next.presence ?? presence,
      facts: next.facts !== undefined ? next.facts : facts,
      generated: next.generated ?? generated,
      keptByCategory: next.keptByCategory ?? keptByCategory,
      lane: next.lane ?? lane,
      simpleCounts: next.simpleCounts ?? simpleCounts,
      simpleTriage: next.simpleTriage !== undefined ? next.simpleTriage : simpleTriage,
      simpleRegen: next.simpleRegen ?? simpleRegen,
      simpleGenerated: next.simpleGenerated ?? simpleGenerated,
      simpleOrder: next.simpleOrder ?? simpleOrder,
      simpleDeleted: next.simpleDeleted ?? simpleDeleted
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

  // 进入环节回显：已保留图片直接接入下游（视频/终检链）；简版档有排序存档时以排序为准，不重复回显模型档采纳
  const emittedOnMount = useRef(false)
  useEffect(() => {
    if (emittedOnMount.current) return
    emittedOnMount.current = true
    if ((persisted.current?.simpleOrder || []).length) return
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
      const result = await window.desktop.image.marketingFacts({ title: props.title, description: props.description, itemSpecifics: props.itemSpecifics, listingId: props.listingId })
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

  // 旧口径存档（无版本戳或版本落后）：挂载后自动重生成一次，版本戳写入后不再触发，避免循环
  const staleFactsRefreshed = useRef(false)
  useEffect(() => {
    if (!facts || staleFactsRefreshed.current || facts.factsVersion === MARKETING_FACTS_VERSION) return
    staleFactsRefreshed.current = true
    void loadFacts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facts])

  // 参照上限优先读模型元数据（0=纯文生图不传参照），缺失按模型族回退，与主进程裁剪规则一致；按实际出图模型取值（降级/切换时不用旧选中值）
  const referenceLimitFor = (id: string): number => {
    const profile = props.imageModels.find(model => model.id === id)
    if (typeof profile?.maxReferenceImages === 'number') return profile.maxReferenceImages
    return id.startsWith('wan2.7') ? 8 : id === 'z-image-turbo' ? 1 : 3
  }
  const shotContext = { title: props.title, description: props.description, itemSpecifics: props.itemSpecifics }

  const modelLabel = (id: string) => props.imageModels.find(model => model.id === id)?.name || id

  /** 一批分镜在指定模型下出图（rotationOffset 让重出时换一组参照） */
  const generateForCards = async (cards: EbayCategoryShotCard[], activeModel: string, rotationOffset: number): Promise<{
    fresh: GeneratedImage[]
    failed: Array<{ cardId: string; message: string; noChannel: boolean }>
    notices: string[]
    modelsUsed: string[]
    aborted: { message: string; noChannel: boolean } | null
  }> => {
    const referenceLimit = referenceLimitFor(activeModel)
    const notices: string[] = []
    const modelsUsed: string[] = []
    try {
      const groups = await mapWithLimit(cards, 2, async card => {
        // 逐卡按角色挑参照：细节卡用细节/尺寸原图、场景卡用场景原图；同类第 N 张锚定第 N 个机位，不再全卡共用同一组参照
        // 简版档「原图整改」以被整改原图为唯一参照（至少 1 张，纯文生图模型也强制带上）
        const references = card.referenceUrls && card.referenceUrls.length
          ? card.referenceUrls.slice(0, Math.max(1, referenceLimit))
          : selectCategoryReferences(props.sourceImages, props.sourceLabels, card.category, referenceLimit, (card.siblingIndex ?? 0) + rotationOffset)
        try {
          const result = await window.desktop.image.generate({
            model: activeModel,
            referenceImageUrls: references,
            promptExtend: false,
            size: card.category === 'HERO' || card.category === 'PRODUCT' ? '2K' : '1K',
            count: card.variations,
            prompt: buildCategoryGenerationPrompt(card, facts as EbayMarketingFacts, mode, { rules, presence })
          })
          if (result.notice) notices.push(result.notice)
          modelsUsed.push(result.model || activeModel)
          return { failed: false, noChannel: false, cardId: card.id, images: result.imageUrls.map(url => ({ cardId: card.id, category: card.category, title: card.title, url, model: result.model || activeModel })), message: '' }
        } catch (reason) {
          // 单个分镜失败不再销毁其余已出图的分类：缺的那张走卡上「↻ 重新生成」
          const raw = reason instanceof Error ? reason.message : '图片生成失败'
          return { failed: true, noChannel: isLinduoNoChannelError(raw), cardId: card.id, images: [], message: humanizeLinduoImageError(raw) }
        }
      }, (done, total) => setProgress(`正在生成 ${done}/${total} 组分镜…`))
      return {
        fresh: groups.flatMap(group => group.images),
        failed: groups.filter(group => group.failed).map(group => ({ cardId: group.cardId, message: group.message, noChannel: group.noChannel })),
        notices, modelsUsed, aborted: null
      }
    } catch (reason) {
      const raw = reason instanceof Error ? reason.message : '图片生成失败'
      return { fresh: [], failed: [], notices: [], modelsUsed: [], aborted: { message: humanizeLinduoImageError(raw), noChannel: isLinduoNoChannelError(raw) } }
    }
  }

  /**
   * 规则「同类不重复」的落地：主进程算 64 位感知指纹，同类汉明距离 ≤阈值的并成一组。
   * 每组保留第一张，其余打上「与谁雷同」标记返回给调用方自动换参照重出。指纹取不到时不判雷同。
   */
  const markDuplicates = async (images: GeneratedImage[]): Promise<{ marked: GeneratedImage[]; dupes: GeneratedImage[] }> => {
    if (images.length < 2 || !window.desktop?.image?.fingerprints) return { marked: images, dupes: [] }
    let hashByUrl: Map<string, string>
    try {
      const result = await window.desktop.image.fingerprints(images.map(image => image.url))
      hashByUrl = new Map(result.map(item => [item.url, item.hash]))
    } catch {
      return { marked: images, dupes: [] }
    }
    const marked = images.map(image => ({ ...image, hash: hashByUrl.get(image.url) ?? image.hash ?? '' }))
    for (const category of CATEGORIES) {
      const sameCategory = marked.filter(image => image.category === category && image.hash)
      if (sameCategory.length < 2) continue
      for (const group of findDuplicateGroups(sameCategory.map(image => ({ id: image.url, hash: image.hash })))) {
        const keeper = marked.find(image => image.url === group[0])
        for (const url of group.slice(1)) {
          const target = marked.find(image => image.url === url)
          if (target) target.dupeOf = keeper?.title || '同类另一张'
        }
      }
    }
    return { marked, dupes: marked.filter(image => image.dupeOf) }
  }

  const commit = (next: GeneratedImage[]) => {
    generatedRef.current = next
    setGenerated(next)
    persist({ generated: next })
  }

  /** 出图落点：模型档走 generated/采纳链，简版档走 simpleGenerated/排序链 */
  type GenerationSink = 'model' | 'simple'
  const simpleGeneratedRef = useRef(simpleGenerated)
  useEffect(() => { simpleGeneratedRef.current = simpleGenerated }, [simpleGenerated])
  const commitTo = (sink: GenerationSink, next: GeneratedImage[]) => {
    if (sink === 'simple') {
      simpleGeneratedRef.current = next
      setSimpleGenerated(next)
      persist({ simpleGenerated: next })
      return
    }
    commit(next)
  }
  const currentOf = (sink: GenerationSink) => (sink === 'simple' ? simpleGeneratedRef.current : generatedRef.current)

  /** 一批分镜出图 + 同类雷同自动换参照重出（只兜一次，避免循环烧额度） */
  const runBatch = async (cards: EbayCategoryShotCard[], replace: boolean, activeModel: string, prelude: string, rotationOffset = 0, sink: GenerationSink = 'model'): Promise<{ ok: boolean; noChannel: boolean; message: string }> => {
    const outcome = await generateForCards(cards, activeModel, rotationOffset)
    const notices: string[] = prelude ? [prelude] : []
    if (outcome.aborted) return { ok: false, noChannel: outcome.aborted.noChannel, message: outcome.aborted.message }
    if (!outcome.fresh.length) {
      return { ok: false, noChannel: outcome.failed.length > 0 && outcome.failed.every(item => item.noChannel), message: outcome.failed[0]?.message || '模型未返回图片，请更换模型或重试' }
    }
    // 零度链内降级：把下拉框切到实际出图模型，避免用户停留在已无通道的模型上
    const actual = outcome.modelsUsed.find(id => id !== activeModel) || activeModel
    if (actual !== activeModel) setModelId(actual)
    notices.push(...outcome.notices)
    if (outcome.failed.length) notices.push(`${outcome.failed.length} 个分镜本次未出图（${outcome.failed[0].message || '上游未返回图片'}），可在该分镜卡上单独重新生成。`)
    const cardIds = new Set(cards.map(card => card.id))
    commitTo(sink, [...(replace ? [] : currentOf(sink).filter(image => !cardIds.has(image.cardId))), ...outcome.fresh])
    const checked = await markDuplicates(currentOf(sink))
    const retry = checked.dupes.filter(image => cardIds.has(image.cardId))
    if (retry.length) {
      const retryCardIds = new Set(retry.map(image => image.cardId))
      const kept = checked.marked.filter(image => !retryCardIds.has(image.cardId) || !image.dupeOf)
      commitTo(sink, kept)
      const back = await generateForCards(cards.filter(card => retryCardIds.has(card.id)), activeModel, rotationOffset + Math.max(1, cards.length))
      const merged = [...kept, ...back.fresh]
      const final = await markDuplicates(merged)
      commitTo(sink, final.marked)
      notices.push(`${retry.length} 张同类图片雷同，已按「同类不重复」规则自动换参照重出。` + (final.dupes.some(image => retryCardIds.has(image.cardId)) ? '重出后仍有雷同，可在该分镜卡上单独重新生成或换模型。' : ''))
    } else {
      commitTo(sink, checked.marked)
    }
    setGenNotice([...new Set(notices)].join(' '))
    return { ok: true, noChannel: false, message: '' }
  }

  const generateCards = async (cards: EbayCategoryShotCard[], replace: boolean, rotationOffset = 0, sink: GenerationSink = 'model') => {
    const activeModel = modelId
    if (!activeModel) { setError('请先选择图片生成大模型'); return }
    lastRunRef.current = { cards, replace }
    setBusy(true)
    setError('')
    setGenNotice('')
    setProgress('')
    let outcome = await runBatch(cards, replace, activeModel, '', rotationOffset, sink)
    if (!outcome.ok && outcome.noChannel && activeModel !== CROSS_VENDOR_MODEL) {
      // 零度整链无通道：自动改用万相重跑同一批分镜（本会话内只兜一次，避免循环）
      const notice = `零度API 当前无可用生图通道，已自动改用 ${modelLabel(CROSS_VENDOR_MODEL)} 完成本次生成。`
      setModelId(CROSS_VENDOR_MODEL)
      outcome = await runBatch(cards, replace, CROSS_VENDOR_MODEL, notice, rotationOffset, sink)
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
    // 每次点 ↻ 都把参照往前挪一格，避免同一张卡反复拿到同一组原图导致又出雷同图
    const rotation = (rotateRef.current[cardId] || 0) + 1
    rotateRef.current[cardId] = rotation
    void generateCards([card], false, rotation).finally(() => setRegeneratingCardId(''))
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

  // ─── 简版档：① 原图优化 → ② 多生图片 → ③ 图片排序 ────────────────────────────
  const persistLane = (next: 'simple' | 'model') => { setLane(next); persist({ lane: next }) }

  /** 逐张判定原图：尺寸/视觉规则取既有事实，主图白底走指纹 IPC 的本地像素探测（不新增外网抓取） */
  const runSimpleTriage = async () => {
    if (!props.sourceImages.length) return
    setTriageBusy(true)
    setError('')
    try {
      const probes = await window.desktop.image.fingerprints(props.sourceImages)
      const backgrounds: Record<string, EbaySimpleBackground> = {}
      probes.forEach(probe => { backgrounds[probe.url] = probe.background || 'UNKNOWN' })
      const outcome = triageSimpleSources(props.sourceChecks, backgrounds)
      const next: EbaySimpleTriage = { checkedAt: new Date().toISOString(), keep: outcome.keep, regen: outcome.regen }
      setSimpleTriage(next)
      persist({ simpleTriage: next })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '原图检查未完成，请重试')
    } finally {
      setTriageBusy(false)
    }
  }

  // 进入简版档且从未检查过：自动跑一次分诊（合规原图直接沿用，不产生生成费用）
  const simpleTriageStarted = useRef(false)
  useEffect(() => {
    if (lane !== 'simple' || simpleTriage || triageBusy || simpleTriageStarted.current || !props.sourceImages.length) return
    simpleTriageStarted.current = true
    void runSimpleTriage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lane, simpleTriage, triageBusy, props.sourceImages.length])

  /** 分诊只是建议：用户可把待整改原图改判为沿用 */
  const keepOriginal = (url: string) => {
    setSimpleTriage(current => {
      if (!current || !current.regen.some(item => item.url === url)) return current
      const next = { ...current, keep: [...current.keep, url], regen: current.regen.filter(item => item.url !== url) }
      persist({ simpleTriage: next })
      return next
    })
  }

  const clearSimpleRegen = (url: string) => {
    setSimpleRegen(current => {
      const next = { ...current }
      delete next[url]
      persist({ simpleRegen: next })
      return next
    })
  }

  /** 不合规原图整改：以原图为唯一参照重出一张，落「已重生成」标识 */
  const regenSimpleSource = (url: string, index: number) => {
    if (!modelId) { setError('请先选择图片生成大模型'); return }
    const category = simpleSourceCategory(props.sourceRoles[index] || 'DETAIL')
    const card: EbayCategoryShotCard = {
      id: `SIMPLE-REG-${index + 1}`,
      category,
      title: '原图整改',
      instruction: '以参照图为唯一商品依据重新出图：商品外观、颜色、材质、结构与配件保持完全一致，仅纠正尺寸、背景与水印/边框/角标问题，使其符合 eBay 图片规则。',
      variations: 1,
      referenceUrls: [url]
    }
    setRegenBusyUrl(url)
    setError('')
    void generateForCards([card], modelId, 0).then(outcome => {
      if (outcome.aborted) { setError(outcome.aborted.message); return }
      if (!outcome.fresh.length) { setError(outcome.failed[0]?.message || '重生成未完成，请重试或更换模型'); return }
      const image = outcome.fresh[0]
      setSimpleRegen(current => {
        const next = { ...current, [url]: { url: image.url, model: image.model } }
        persist({ simpleRegen: next })
        return next
      })
      if (outcome.notices.length) setGenNotice([...new Set(outcome.notices)].join(' '))
    }).finally(() => setRegenBusyUrl(''))
  }

  const runSimpleGenerate = () => {
    if (!facts) { setError('事实卡尚未生成，请稍候或点击“重新生成事实卡”'); return }
    const cards = buildCategoryShotCards(facts, simpleCounts, shotContext, SIMPLE_CATEGORY_COUNT_MIN)
    if (!cards.length) { setError('四类张数均为 0，无需生成；需要补图请把对应张数调大于 0。'); return }
    void generateCards(cards, true, 0, 'simple')
  }

  const onSimpleCount = (category: EbayImageCategory, raw: string) => {
    const next = withSimpleCategoryCount(simpleCounts, category, raw)
    setSimpleCounts(next)
    persist({ simpleCounts: next })
  }

  /** 排序池：沿用原图 + 已重生成替换图 + 多生图片；待整改未重生成的原图不进图集 */
  const simpleMembers: EbaySimpleGalleryMember[] = []
  props.sourceImages.forEach((url, index) => {
    const category = simpleSourceCategory(props.sourceRoles[index] || 'DETAIL')
    const flagged = (simpleTriage?.regen || []).some(item => item.url === url)
    const replaced = simpleRegen[url]
    if (replaced) simpleMembers.push({ url: replaced.url, category, kind: 'REGENERATED' })
    else if (!flagged) simpleMembers.push({ url, category, kind: 'ORIGINAL' })
  })
  simpleGenerated.forEach(image => simpleMembers.push({ url: image.url, category: image.category, kind: 'GENERATED' }))
  const simpleOrderEffective = normalizeSimpleOrder(simpleOrder, simpleMembers, simpleDeleted)
  const simpleOrderKey = simpleOrderEffective.join('|')
  const simpleMembersKey = simpleMembers.map(member => `${member.url}:${member.kind}`).join('|')

  // 排序即最终图集：同类内顺序=上传顺序，类间按主图→细节→痛点→场景回传下游
  useEffect(() => {
    if (lane !== 'simple' || !simpleOrderKey) return
    persist({ simpleOrder: simpleOrderEffective })
    emit(mergeSimpleGalleryOrder(simpleOrderEffective, simpleMembers))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simpleOrderKey, simpleMembersKey, lane])

  const moveSimpleOrder = (url: string, delta: number) => {
    const list = [...simpleOrderEffective]
    const from = list.indexOf(url)
    const to = from + delta
    if (from < 0 || to < 0 || to >= list.length) return
    list.splice(from, 1)
    list.splice(to, 0, url)
    setSimpleOrder(list)
  }

  const removeSimpleOrder = (url: string) => {
    setSimpleOrder(simpleOrderEffective.filter(item => item !== url))
    setSimpleDeleted(current => {
      const next = current.includes(url) ? current : [...current, url]
      persist({ simpleDeleted: next })
      return next
    })
  }

  const restoreSimpleOrder = (url: string) => {
    setSimpleDeleted(current => {
      const next = current.filter(item => item !== url)
      persist({ simpleDeleted: next })
      return next
    })
    setSimpleOrder([...simpleOrderEffective, url])
  }

  const onModelCount = (category: EbayImageCategory, raw: string) => {
    const next = withEbayImageCategoryCount(counts, category, raw)
    setCounts(next)
    persist({ counts: next })
  }

  /** 模型与出图模式区块：两档共用同一套控件，仅张数下限不同（简版档允许 0） */
  const renderModelMode = (minCount: number, value: EbayImageCategoryCounts, onCount: (category: EbayImageCategory, raw: string) => void) => (
    <>
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
              <input aria-label={`${marketingFactCategoryShortLabel(category)}图片数`} type="number" min={minCount} max={EBAY_IMAGE_CATEGORY_COUNT_MAX}
                value={value[category]}
                onChange={event => onCount(category, event.target.value)} />
            </label>
          ))}
        </div>
      </div>
      <div className="ebay-stage-naturalize-profile">
        <span>出图模式：</span>
        <label><input type="radio" name="image-output-mode" checked={mode === 'PURE'} onChange={() => { setMode('PURE'); persist({ mode: 'PURE' }) }} /> 纯图片（适合 eBay）</label>
        <label><input type="radio" name="image-output-mode" checked={mode === 'TEXT_COMBO'} onChange={() => { setMode('TEXT_COMBO'); persist({ mode: 'TEXT_COMBO' }) }} /> 图片和文字结合（适合亚马逊）</label>
      </div>
    </>
  )

  /** 生图规则确认区块：两档共用 */
  const renderRules = () => (
    <>
      <div className="ebay-stage-rule-grid">
        {EBAY_IMAGE_RULES.map(rule => (
          <label className={`ebay-stage-rule-item${rule.locked ? ' locked' : ''}`} key={rule.id}>
            <input type="checkbox" checked={rules[rule.id]} disabled={rule.locked}
              onChange={event => { const next = { ...rules, [rule.id]: event.target.checked }; setRules(next); persist({ rules: next }) }} />
            <span className="ebay-stage-rule-item-body">
              <span className="ebay-stage-rule-item-label">{rule.label}{rule.locked && <em className="ebay-stage-rule-lock">必守</em>}</span>
              <span className="ebay-stage-rule-item-detail">{rule.detail}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="ebay-stage-presence-row">
        <span className="ebay-stage-count-grid-title">痛点图 / 场景图模特：</span>
        {EBAY_IMAGE_MODEL_PRESENCE_OPTIONS.map(option => (
          <label key={option.id} title={option.detail}>
            <input type="radio" name="ebay-image-model-presence" checked={presence === option.id}
              onChange={() => { setPresence(option.id); persist({ presence: option.id }) }} /> {option.label}
          </label>
        ))}
      </div>
      <p className="ebay-stage-rule-summary">{describeActiveEbayImageRules(rules, presence, mode)}（主图与细节图任何选择下都不出现人物或动物）</p>
    </>
  )

  return <div className="ebay-stage-panel">
    <div className="ebay-stage-header" style={{ borderLeftColor: '#1abc9c' }}>
      <b>图片优化 · 简化流程</b>
      <small>合规规则内置于生图提示词 → 读取产品原图 → 事实卡自动 → 选模型与出图模式 → 勾选生图规则与模特 → 一键生成 → 同类雷同自动换参照重出 → 逐图采纳/单张重生 → 保留回显</small>
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
            {buildMarketingFactRows(facts, { coreTerm: props.coreTerm, searchTerms: props.searchTerms }).map(row => (
              <p key={row.label}><b>{row.label}：</b>{row.text}</p>
            ))}
          </div>
        </div>
      ) : factsBusy ? <p className="ebay-stage-placeholder">正在根据产品详情页内容生成事实卡…</p>
        : <p className="ebay-stage-placeholder">{factsError || '等待事实卡生成（依据产品详情页描述与属性）'}</p>}
    </section>

    <section className="ebay-stage-section ebay-stage-lane-section">
      <div className="ebay-stage-lane-row" role="group" aria-label="图片优化方式">
        <button type="button" className={lane === 'simple' ? 'ebay-stage-lane-btn active' : 'ebay-stage-lane-btn'} onClick={() => persistLane('simple')}>简版优化</button>
        <button type="button" className={lane === 'model' ? 'ebay-stage-lane-btn active' : 'ebay-stage-lane-btn'} onClick={() => persistLane('model')}>模型优化</button>
      </div>
    </section>

    {lane === 'simple' && <>
    <section className="ebay-stage-section">
      <header>
        <b>① 原图优化</b>
        <small>符合平台规则的原图直接沿用、不生成；不合规的重生成并标「已重生成」</small>
        <button className="yd-button yd-button--secondary" disabled={triageBusy || !props.sourceImages.length} onClick={() => void runSimpleTriage()}>
          {triageBusy ? '检查中…' : simpleTriage ? '重新检查原图' : '开始检查原图'}
        </button>
      </header>
      {triageBusy ? <p className="ebay-stage-placeholder">正在逐张读取原图并按平台规则判定（尺寸、视觉规则、主图白底）…</p>
        : !simpleTriage ? <p className="ebay-stage-placeholder">点击「开始检查原图」：合规原图直接沿用、不产生生成费用，个别不合规的才重生成。</p>
          : (
            <div className="ebay-stage-source-grid">
              {props.sourceImages.map((url, index) => {
                const regenItem = simpleTriage.regen.find(item => item.url === url)
                const replaced = simpleRegen[url]
                const check = props.sourceChecks.find(item => item.url === url)
                return (
                  <div className={`ebay-stage-source-item${replaced || !regenItem ? ' selected' : ''}`} key={url}>
                    <img src={replaced ? replaced.url : url} alt={`原图 ${index + 1}`} />
                    <span>{props.sourceLabels[index] || `原图 ${index + 1}`}</span>
                    {check?.extraToPage && <em className="ebay-stage-simple-chip warn" title="该图不在产品下载图文页图集中">非图文页图集</em>}
                    {replaced ? <em className="ebay-stage-simple-chip regen">已重生成</em>
                      : regenItem ? <em className="ebay-stage-simple-chip warn">待整改</em>
                        : <em className="ebay-stage-simple-chip ok">沿用</em>}
                    {regenItem && !replaced && <em className="ebay-stage-simple-reasons">{regenItem.reasons.join('；')}</em>}
                    {regenItem && !replaced ? (
                      <span className="ebay-stage-simple-actions">
                        <button type="button" className="yd-button yd-button--primary" disabled={busy || regenBusyUrl === url || !modelId} onClick={() => regenSimpleSource(url, index)}>
                          {regenBusyUrl === url ? '生成中…' : '重生成这张'}
                        </button>
                        <button type="button" className="yd-button yd-button--secondary" onClick={() => keepOriginal(url)}>沿用原图</button>
                        {props.onRemoveFromSelection && <button type="button" className="yd-button yd-button--secondary" onClick={() => props.onRemoveFromSelection?.(url)}>从选区剔除</button>}
                      </span>
                    ) : replaced ? (
                      <span className="ebay-stage-simple-actions">
                        <button type="button" className="yd-button yd-button--secondary" onClick={() => clearSimpleRegen(url)}>撤销重生成</button>
                      </span>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
    </section>

    <section className="ebay-stage-section">
      <header><b>② 多生图片</b><small>张数可设 0 代表该类不生成；模型与规则勾选与模型档同一套</small></header>
      {renderModelMode(SIMPLE_CATEGORY_COUNT_MIN, simpleCounts, onSimpleCount)}
      {renderRules()}
      <div className="ebay-stage-simple-generate-row">
        <button className={`yd-button ${simpleGenerated.length ? 'yd-button--secondary' : 'yd-button--primary'}`} disabled={!facts || !modelId || busy} onClick={runSimpleGenerate}>
          {busy ? progress || '生成中…' : simpleGenerated.length ? `重新生成多生图片（${describeEbayImageCategoryCounts(simpleCounts)}）` : `生成多生图片（${describeEbayImageCategoryCounts(simpleCounts)}）`}
        </button>
        {simpleGenerated.length > 0 && <em className="ebay-stage-simple-chip ok">已出 {simpleGenerated.length} 张，到「③ 图片排序」调整顺序</em>}
      </div>
      {genNotice && <div className="ebay-stage-gen-notice" role="status">{genNotice}</div>}
      {error && (
        <div className="ebay-stage-error" role="alert">
          <b>生成未完成</b>
          <span>{error}</span>
        </div>
      )}
    </section>

    <section className="ebay-stage-section">
      <header><b>③ 图片排序</b><small>顺序即上传 eBay 图片库顺序：同类内按此顺序，类间按主图→细节→痛点→场景</small></header>
      {simpleOrderEffective.length === 0 ? (
        <p className="ebay-stage-placeholder">暂无可排序图片：请先在「① 原图优化」沿用原图，或在「② 多生图片」出图。</p>
      ) : (
        <div className="ebay-stage-order-list">
          {simpleOrderEffective.map((url, position) => {
            const member = simpleMembers.find(item => item.url === url)
            if (!member) return null
            return (
              <div className="ebay-stage-order-row" key={url}>
                <span className="ebay-stage-order-index">{position + 1}</span>
                <img src={url} alt={`排序第 ${position + 1} 张`} />
                <span className="ebay-stage-order-tags">
                  <em className={member.kind === 'GENERATED' ? 'gen' : member.kind === 'REGENERATED' ? 'regen' : 'keep'}>
                    {member.kind === 'GENERATED' ? '多生图片' : member.kind === 'REGENERATED' ? '已重生成' : '沿用原图'}
                  </em>
                  <em>{marketingFactCategoryLabel(member.category)}</em>
                </span>
                <span className="ebay-stage-order-actions">
                  <button type="button" className="yd-button yd-button--secondary" disabled={position === 0} onClick={() => moveSimpleOrder(url, -1)}>前移</button>
                  <button type="button" className="yd-button yd-button--secondary" disabled={position === simpleOrderEffective.length - 1} onClick={() => moveSimpleOrder(url, 1)}>后移</button>
                  <button type="button" className="yd-button yd-button--secondary" onClick={() => removeSimpleOrder(url)}>删除</button>
                </span>
              </div>
            )
          })}
        </div>
      )}
      {simpleDeleted.length > 0 && (
        <div className="ebay-stage-order-restore">
          <span>已删除（可恢复）：</span>
          {simpleDeleted.map(url => {
            const member = simpleMembers.find(item => item.url === url)
            if (!member) return null
            return <button type="button" key={url} className="yd-button yd-button--secondary" onClick={() => restoreSimpleOrder(url)}>恢复{marketingFactCategoryLabel(member.category)}</button>
          })}
        </div>
      )}
    </section>
    </>}

    {lane === 'model' && <>
    <section className="ebay-stage-section">
      <header><b>③ 模型与出图模式</b><small>eBay 模式严禁附加文字；亚马逊模式允许简洁卖点文字图层</small></header>
      {renderModelMode(EBAY_IMAGE_CATEGORY_COUNT_MIN, counts, onModelCount)}
    </section>

    <section className="ebay-stage-section">
      <header>
        <b>④ 生图规则确认（生成前勾选）</b>
        <small>勾选的规则逐条写入本次生图提示词；标「必守」的三条关掉就等于出违规图，不可取消</small>
      </header>
      {renderRules()}
    </section>

    <section className="ebay-stage-section">
      <header>
        <b>⑤ 一键生成四类图</b>
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
        <header><b>⑥ 审核与采纳</b><small>点击图采纳/取消；↻ 单张重生成（每次换一组参照）；已采纳 {keptCount} 张</small></header>
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
                  {image.dupeOf && <em className="ebay-stage-gen-dupe-tag">与「{image.dupeOf}」雷同，建议换参照重出</em>}
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
        <header><b>⑦ 已保留图片</b><small>按商品持久化保存，下次进入本环节自动回显并接入视频与终检链</small></header>
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
    </>}
  </div>
}
