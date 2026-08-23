import { useEffect, useRef, useState } from 'react'
import type { EbayImageStage, EbayImageStageStep, EbayStageFactCard, EbayStageStoryboardCard, ImageModelProfile, RealShiftProfile, RealShiftResult } from '../shared/contracts'

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

const STAGES: EbayImageStage[] = ['HERO', 'PRODUCT', 'PAIN_POINT', 'SCENE', 'NATURALIZE']
const STAGE_LABELS: Record<EbayImageStage, string> = {
  HERO: '主图生成', PRODUCT: '产品图生成',
  PAIN_POINT: '痛点图生成', SCENE: '场景图生成', NATURALIZE: '自然化处理'
}
const STAGE_COLORS: Record<EbayImageStage, string> = {
  HERO: '#e74c3c', PRODUCT: '#27ae60',
  PAIN_POINT: '#1abc9c', SCENE: '#3498db', NATURALIZE: '#9b59b6'
}
// 各阶段推荐模型时匹配 strengths/description 的关键词
const STAGE_MODEL_KEYWORDS: Record<EbayImageStage, string[]> = {
  HERO: ['主图', '白底', '保真'],
  PRODUCT: ['主图', '正面', '细节', '材质', '特写', '保真'],
  PAIN_POINT: ['痛点', '场景', '叙事'],
  SCENE: ['场景', '环境', '融合'],
  NATURALIZE: []
}

/** 有限并发地遍历 items 并保序返回结果；onProgress 在每项完成后回调（done 为已完成数） */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>, onProgress?: (done: number, total: number) => void): Promise<R[]> {
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

// ─── 并发设置（localStorage 持久化） ─────────────────────────────────────────
const ANALYSIS_CONCURRENCY_KEY = 'ebay-stage-concurrency:analysis:v1'
const GENERATION_CONCURRENCY_KEY = 'ebay-stage-concurrency:generation:v1'

function readConcurrency(key: string, fallback: number, max: number): number {
  const raw = Number(localStorage.getItem(key))
  return Number.isInteger(raw) && raw >= 1 && raw <= max ? raw : fallback
}

function recommendStageModelId(stage: EbayImageStage, models: ImageModelProfile[]): string {
  const keywords = STAGE_MODEL_KEYWORDS[stage] || []
  const matched = models.find(m => keywords.some(k => (m.strengths || '').includes(k) || (m.description || '').includes(k)))
  return (matched || models[0])?.id || ''
}

/** 生成结果图：记录归属的分镜卡，便于展示“这张图是哪张分镜卡生成的” */
interface GeneratedImage {
  cardId: string
  cardTitle: string
  url: string
}

interface StageState {
  step: EbayImageStageStep
  /** 与所选原图一一对齐的事实卡（每张原图 1 张） */
  factCards: EbayStageFactCard[]
  storyboardCards: EbayStageStoryboardCard[]
  selectedCardId: string
  modelId: string
  /** 每张分镜卡生成的变体数（默认 1：总分镜卡数 = 总图片数） */
  variationsPerCard: number
  generatedImages: GeneratedImage[]
  /** 多选选中的候选图 URL */
  selectedImageUrls: string[]
  /** 本阶段确认采用的多张图片 URL */
  confirmedImageUrls: string[]
  selectedSourceIndices: number[]
  busy: boolean
  /** 正在单独重新生成的分镜卡 ID（空字符串 = 无） */
  regeneratingCardId: string
  error: string
  /** 进度提示（分析原图 / 生成分镜 / 生成图片） */
  progress: string
}

interface Props {
  /** 所有已保留的原图 URL 列表 */
  sourceImages: string[]
  /** 原图标签（与 sourceImages 对齐） */
  sourceLabels: string[]
  /** 商品标题 */
  title: string
  /** 商品描述 */
  description: string
  /** 商品属性 */
  itemSpecifics: Array<{ name: string; value: string }>
  /** 可用的 AI 生图模型列表 */
  imageModels: ImageModelProfile[]
  /** 外部 busy 状态 */
  externalBusy: string
  /** 当所有 4 个生成阶段确认完成时回调（返回各阶段确认的多张图） */
  onAllStagesConfirmed: (images: Record<string, string[]>) => void
  /** 自然化处理完成回调（按 url 粒度收集：每张候选图携原图、处理后图与完整 RealShift 结果；失败时 result 为 null 并回退原图） */
  onNaturalizeComplete: (images: Record<string, { originalUrl: string; processedUrl: string; result: RealShiftResult | null }>) => void
}

function initialStageState(stage: EbayImageStage): StageState {
  return {
    step: 'PENDING', factCards: [], storyboardCards: [], selectedCardId: '',
    modelId: '', variationsPerCard: 1, generatedImages: [], selectedImageUrls: [], confirmedImageUrls: [],
    selectedSourceIndices: [], busy: false, regeneratingCardId: '', error: '', progress: ''
  }
}

// ─── 组件 ────────────────────────────────────────────────────────────────────

export default function EbayImageStagePanel(props: Props) {
  const [activeStage, setActiveStage] = useState<EbayImageStage>('HERO')
  const [stageStates, setStageStates] = useState<Record<EbayImageStage, StageState>>({
    HERO: initialStageState('HERO'),
    PRODUCT: initialStageState('PRODUCT'),
    PAIN_POINT: initialStageState('PAIN_POINT'),
    SCENE: initialStageState('SCENE'),
    NATURALIZE: initialStageState('NATURALIZE')
  })
  const [selectedIndices, setSelectedIndices] = useState<number[]>([])
  const [editingCardId, setEditingCardId] = useState<string | null>(null)
  // 并发设置：分析任务（事实卡/分镜卡）与 AI 生图分开控制，持久化到 localStorage
  const [analysisConcurrency, setAnalysisConcurrency] = useState(() => readConcurrency(ANALYSIS_CONCURRENCY_KEY, 3, 6))
  const [generationConcurrency, setGenerationConcurrency] = useState(() => readConcurrency(GENERATION_CONCURRENCY_KEY, 2, 4))
  const updateAnalysisConcurrency = (value: number) => {
    const next = Math.max(1, Math.min(6, value))
    setAnalysisConcurrency(next)
    localStorage.setItem(ANALYSIS_CONCURRENCY_KEY, String(next))
  }
  const updateGenerationConcurrency = (value: number) => {
    const next = Math.max(1, Math.min(4, value))
    setGenerationConcurrency(next)
    localStorage.setItem(GENERATION_CONCURRENCY_KEY, String(next))
  }
  const naturalizeRef = useRef<HTMLDivElement>(null)

  const current = stageStates[activeStage]
  const isNaturalize = activeStage === 'NATURALIZE'

  // 判断某阶段是否已确认
  const isStageConfirmed = (stage: EbayImageStage) => stageStates[stage].confirmedImageUrls.length > 0
  // 判断某阶段是否可进入（前一阶段已确认，或者是第一个阶段）
  const isStageUnlocked = (stage: EbayImageStage) => {
    const idx = STAGES.indexOf(stage)
    if (idx === 0) return true
    return isStageConfirmed(STAGES[idx - 1])
  }
  // 判断所有生成阶段是否已确认
  const allGenStagesConfirmed = STAGES.slice(0, 4).every(isStageConfirmed)

  // 进入某阶段时若尚未选模型，按阶段类型自动推荐一个（仍可手动切换）
  useEffect(() => {
    if (isNaturalize || current.modelId || !props.imageModels.length) return
    const recommended = recommendStageModelId(activeStage, props.imageModels)
    if (recommended) updateStage({ modelId: recommended })
  }, [activeStage, props.imageModels, isNaturalize, current.modelId])
  // 已确认的生成图（key = stage，value = 多张确认图）
  const confirmedImagesByStage = STAGES.slice(0, 4).reduce<Record<string, string[]>>((acc, stage) => {
    if (stageStates[stage].confirmedImageUrls.length) acc[stage] = stageStates[stage].confirmedImageUrls
    return acc
  }, {})
  // 所有确认图扁平化去重（供自然化处理）
  const confirmedImageUrls = [...new Set(Object.values(confirmedImagesByStage).flat())]

  // 当所有生成阶段确认时通知父组件
  useEffect(() => {
    if (allGenStagesConfirmed) props.onAllStagesConfirmed(confirmedImagesByStage)
  }, [allGenStagesConfirmed])

  // ── 原图选择 ──────────────────────────────────────────────────────────────
  const toggleSourceImage = (index: number) => {
    setSelectedIndices(current => {
      const next = current.includes(index) ? current.filter(i => i !== index) : [...current, index].sort((a, b) => a - b)
      updateStage({ selectedSourceIndices: next })
      return next
    })
  }

  // 切换阶段时恢复该阶段已选的原图下标，避免重复选择
  const switchStage = (stage: EbayImageStage) => {
    setActiveStage(stage)
    setSelectedIndices(stageStates[stage].selectedSourceIndices)
  }

  // ── 阶段状态更新 ──────────────────────────────────────────────────────────
  const updateStage = (patch: Partial<StageState>) => {
    setStageStates(current => ({ ...current, [activeStage]: { ...current[activeStage], ...patch } }))
  }

  // 将状态写回指定阶段：异步完成场景精确写回发起阶段（避免 await 期间用户切换阶段后，结果误写入当前活动阶段、原阶段卡死）
  const updateStageAt = (stage: EbayImageStage, patch: Partial<StageState>) => {
    setStageStates(prev => ({ ...prev, [stage]: { ...prev[stage], ...patch } }))
  }

  // ── 步骤 1: 选择原图 → 生成事实卡 ────────────────────────────────────────
  const runStageGrounding = async () => {
    if (!selectedIndices.length) { updateStage({ error: '请先选择至少 1 张原图' }); return }
    updateStage({ busy: true, error: '', step: 'GROUNDING', factCards: [], progress: '' })
    try {
      // 继承前一阶段的全局事实卡（如果存在）
      const stageIdx = STAGES.indexOf(activeStage)
      const prevCards = stageIdx > 0 ? stageStates[STAGES[stageIdx - 1]].factCards : []
      const prevFactCard = prevCards.length ? prevCards[0] : null
      const factCards = await mapWithConcurrency(selectedIndices, analysisConcurrency, async sourceIdx => {
        return window.desktop.image.stageGrounding({
          stage: activeStage,
          title: props.title,
          description: props.description,
          itemSpecifics: props.itemSpecifics,
          sourceImages: [props.sourceImages[sourceIdx]],
          sourceLabels: [props.sourceLabels[sourceIdx] || ''],
          previousFactCard: prevFactCard
        })
      }, (done, total) => updateStage({ progress: `正在分析原图 ${done}/${total}…` }))
      updateStage({ factCards, step: 'STORYBOARD', busy: false, progress: '' })
    } catch (reason) {
      updateStage({ error: reason instanceof Error ? reason.message : '事实卡生成失败', busy: false, progress: '' })
    }
  }

  // ── 步骤 2: 生成分镜卡 ────────────────────────────────────────────────────
  const runStageStoryboard = async () => {
    if (!current.factCards.length) { updateStage({ error: '请先生成事实卡' }); return }
    updateStage({ busy: true, error: '', progress: '' })
    try {
      const cards = await mapWithConcurrency(current.factCards, analysisConcurrency, async (factCard, i) => {
        const [card] = await window.desktop.image.stageStoryboard({
          stage: activeStage,
          title: props.title,
          description: props.description,
          itemSpecifics: props.itemSpecifics,
          sourceImages: [props.sourceImages[selectedIndices[i]]],
          sourceLabels: [props.sourceLabels[selectedIndices[i]] || ''],
          factCard,
          count: 1
        })
        // 绑定对应原图下标，供生图时只传该张原图作参照
        return { ...card, referenceIndices: [selectedIndices[i]] }
      }, (done, total) => updateStage({ progress: `正在生成分镜卡 ${done}/${total}…` }))
      updateStage({ storyboardCards: cards, selectedCardId: cards[0]?.id || '', step: 'STORYBOARD', busy: false, progress: '' })
    } catch (reason) {
      updateStage({ error: reason instanceof Error ? reason.message : '分镜卡生成失败', busy: false, progress: '' })
    }
  }

  // ── 步骤 3: 生成图片 ──────────────────────────────────────────────────────
  const runStageGeneration = async (retryDirective?: string) => {
    if (!current.storyboardCards.length) { updateStage({ error: '请先生成分镜卡' }); return }
    if (!current.modelId) { updateStage({ error: '请先选择 AI 生图模型' }); return }
    if (!current.factCards.length) { updateStage({ error: '请先生成事实卡' }); return }

    const stage = activeStage // 记录发起阶段：异步完成时精确写回该阶段（生成期间用户可能切换到其他阶段）
    updateStageAt(stage, { busy: true, error: '', step: 'GENERATING', generatedImages: [], selectedImageUrls: [], regeneratingCardId: '', progress: '' })
    try {
      const variations = Math.max(1, Math.min(4, current.variationsPerCard))
      const groups = await mapWithConcurrency(current.storyboardCards, generationConcurrency, async (card, i) => {
        const factCard = current.factCards[i] || current.factCards[0]
        // 只用该分镜卡对应的原图作参照，避免多参照图内容冲突导致失真
        const refIdx = card.referenceIndices[0] ?? selectedIndices[i]
        const referenceUrls = refIdx != null && props.sourceImages[refIdx] ? [props.sourceImages[refIdx]] : []
        const prompt = buildGenerationPrompt(card, factCard, retryDirective, referenceUrls.length > 0)
        const result = await window.desktop.image.generate({
          model: current.modelId,
          referenceImageUrls: referenceUrls,
          promptExtend: false,
          size: activeStage === 'HERO' || activeStage === 'PRODUCT' ? '2K' : '1K',
          count: variations,
          prompt
        })
        return result.imageUrls.map(url => ({ cardId: card.id, cardTitle: card.title, url }))
      }, (done, total) => updateStageAt(stage, { progress: `正在生成 ${done}/${total} 个分镜…` }))
      const generated = groups.flat()
      if (generated.length) {
        updateStageAt(stage, { generatedImages: generated, selectedImageUrls: generated.map(g => g.url), step: 'REVIEW', busy: false, progress: '' })
      } else {
        updateStageAt(stage, { error: '模型未返回图片', busy: false, progress: '' })
      }
    } catch (reason) {
      updateStageAt(stage, { error: reason instanceof Error ? reason.message : '图片生成失败', busy: false, progress: '' })
    }
  }

  // ── 构建生图提示词 ────────────────────────────────────────────────────────
  const buildGenerationPrompt = (card: EbayStageStoryboardCard, factCard: EbayStageFactCard, retryDirective?: string, hasReference?: boolean): string => {
    const stageLabels: Record<string, string> = {
      HERO: '主图', PRODUCT: '产品图（正面/细节）',
      PAIN_POINT: '痛点解决展示图', SCENE: '应用场景图'
    }
    // ── 有参照图：精简模式 ──
    // 参照图本身即是最强商品一致性保障，prompt 只负责"怎么改"；
    // 短 prompt 确保修改指令不被截断（qwen-image-edit-plus 800 token 上限），
    // 且避免大段 "preserve" 语言强化模型复制参照图的倾向
    if (hasReference) {
      return [
        card.userNote ? `IMPORTANT EDIT: ${card.userNote}.` : '',
        `Create eBay ${stageLabels[card.stage] || card.stage}: ${card.instruction}`,
        card.evidence ? `Context: ${card.evidence}` : '',
        retryDirective ? `Retry: ${retryDirective}` : '',
        'Keep the sellable product unchanged. Props, plants, background, model pose may differ freely.'
      ].filter(Boolean).join('\n')
    }
    // ── 无参照图（纯文生图）：完整合规约束 ──
    return `Create a compliant eBay product image: ${stageLabels[card.stage] || card.stage}.
Role: ${STAGE_LABELS[card.stage]} · ${card.title}
Required shot: ${card.instruction}
Content evidence: ${card.evidence}
Acceptance criteria: ${card.acceptance}
Prohibited: ${card.prohibited}
Product identity confirmed from original images: ${factCard.productIdentity}
Protected attributes: ${factCard.protectedAttributes.join('; ')}
Verified visual facts: ${factCard.verifiedFacts.join('; ')}
Purpose-specific instruction: ${factCard.stageInstruction}
${retryDirective ? `Retry directive: previous attempt was unsatisfactory. ${retryDirective}` : ''}
Strict truth constraints (scope: THE PRODUCT ONLY — the sellable item itself): preserve the product's identity, structure, proportions, color, material, logo and packaging exactly as in the reference images; the product's silhouette and outer contour must remain identical from every viewpoint. Everything NOT the product — props, plants, background, decor, model pose — is NOT frozen: adjust them freely per the Required shot above. Do not invent functions, parts, claims or packaging. No added text, measurement labels, watermark, border or promotional badge.
${card.userNote ? `FINAL OVERRIDE — Seller instruction (highest priority, must be visibly reflected in the output): ${card.userNote}` : ''}`
  }

  // ── 确认当前阶段 ──────────────────────────────────────────────────────────
  const toggleGeneratedImage = (url: string) => {
    const next = current.selectedImageUrls.includes(url)
      ? current.selectedImageUrls.filter(item => item !== url)
      : [...current.selectedImageUrls, url]
    updateStage({ selectedImageUrls: next })
  }

  const confirmStage = () => {
    // 兜底校验：只确认实际存在于当前生成网格的图片，过滤任何混入选区的幽灵 URL（防未确认图流入自然化）
    const visibleUrls = new Set(current.generatedImages.map(g => g.url))
    const toConfirm = current.selectedImageUrls.filter(u => visibleUrls.has(u))
    if (!toConfirm.length) { updateStage({ error: '请至少勾选一张生成的图片' }); return }
    updateStage({ confirmedImageUrls: toConfirm, selectedImageUrls: toConfirm, step: 'CONFIRMED', error: '' })
    // 自动进入下一阶段（恢复该阶段已选的原图下标）
    const idx = STAGES.indexOf(activeStage)
    if (idx < STAGES.length - 1) switchStage(STAGES[idx + 1])
  }

  // ── 重新生成当前分镜 ──────────────────────────────────────────────────────
  const regenerateStage = () => {
    updateStage({ step: 'STORYBOARD', generatedImages: [], selectedImageUrls: [], confirmedImageUrls: [], error: '' })
  }

  // ── 单独重新生成某张分镜卡的图片（其余生成图与勾选状态保持不变） ──────────
  const regenerateCard = async (cardId: string) => {
    const cardIndex = current.storyboardCards.findIndex(c => c.id === cardId)
    const card = current.storyboardCards[cardIndex]
    if (!card) return
    if (!current.modelId) { updateStage({ error: '请先选择 AI 生图模型' }); return }
    const factCard = current.factCards[cardIndex] || current.factCards[0]
    if (!factCard) { updateStage({ error: '请先生成事实卡' }); return }
    const stage = activeStage // 记录发起阶段，完成时写回该阶段
    updateStageAt(stage, { regeneratingCardId: cardId, error: '' })
    try {
      const variations = Math.max(1, Math.min(4, current.variationsPerCard))
      const refIdx = card.referenceIndices[0] ?? selectedIndices[cardIndex]
      const referenceUrls = refIdx != null && props.sourceImages[refIdx] ? [props.sourceImages[refIdx]] : []
      const result = await window.desktop.image.generate({
        model: current.modelId,
        referenceImageUrls: referenceUrls,
        promptExtend: false,
        size: activeStage === 'HERO' || activeStage === 'PRODUCT' ? '2K' : '1K',
        count: variations,
        prompt: buildGenerationPrompt(card, factCard, undefined, referenceUrls.length > 0)
      })
      const newImages: GeneratedImage[] = result.imageUrls.map(url => ({ cardId: card.id, cardTitle: card.title, url }))
      if (!newImages.length) { updateStageAt(stage, { error: `${card.id} 模型未返回图片`, regeneratingCardId: '' }); return }
      // 基于最新状态的函数式更新：await 前的快照不得覆盖等待期间用户的勾选操作；
      // 新图不自动勾选（勾选 = 用户显式意图），该卡旧图勾选同步清除
      setStageStates(prev => {
        const st = prev[stage]
        const oldUrls = new Set(st.generatedImages.filter(g => g.cardId === cardId).map(g => g.url))
        const nextImages: GeneratedImage[] = []
        let inserted = false
        for (const g of st.generatedImages) {
          if (g.cardId === cardId) {
            if (!inserted) { nextImages.push(...newImages); inserted = true }
          } else nextImages.push(g)
        }
        if (!inserted) nextImages.push(...newImages)
        const nextSelected = st.selectedImageUrls.filter(u => !oldUrls.has(u))
        return { ...prev, [stage]: { ...st, generatedImages: nextImages, selectedImageUrls: nextSelected, regeneratingCardId: '', error: '' } }
      })
    } catch (reason) {
      updateStageAt(stage, { error: reason instanceof Error ? reason.message : `${card.id} 重新生成失败`, regeneratingCardId: '' })
    }
  }

  // ── 编辑分镜卡 ────────────────────────────────────────────────────────────
  const updateCard = (cardId: string, patch: Partial<EbayStageStoryboardCard>) => {
    updateStage({
      storyboardCards: current.storyboardCards.map(c => c.id === cardId ? { ...c, ...patch } : c)
    })
  }

  // ── 自然化处理 ────────────────────────────────────────────────────────────
  // 逐张容错：某张失败不影响其他图，失败的回退为原图继续流程
  const [naturalizeProgress, setNaturalizeProgress] = useState('')
  const [naturalizeProfile, setNaturalizeProfile] = useState<RealShiftProfile>('balanced')
  const runNaturalize = async () => {
    if (!confirmedImageUrls.length) { updateStage({ error: '请先完成所有图片生成阶段' }); return }
    // 依赖预检：一次性校验 Python + Pillow/numpy，缺失时立即给出可操作提示，不逐张浪费时间
    const preflight = await window.desktop.image.realshiftPreflight()
    if (!preflight.ok) { updateStage({ error: preflight.message }); return }
    updateStage({ busy: true, error: '' })
    const results: Record<string, { originalUrl: string; processedUrl: string; result: RealShiftResult | null }> = {}
    const failed: string[] = []
    for (let index = 0; index < confirmedImageUrls.length; index += 1) {
      const imageUrl = confirmedImageUrls[index]
      setNaturalizeProgress(`正在处理 ${index + 1}/${confirmedImageUrls.length}`)
      try {
        const result = await window.desktop.image.realshift({
          imageUrl,
          productId: `ebay-stage-naturalize-${index}`,
          profile: naturalizeProfile
        })
        results[imageUrl] = { originalUrl: imageUrl, processedUrl: result.processedDataUrl || imageUrl, result }
      } catch (reason) {
        const detail = reason instanceof Error ? reason.message : String(reason)
        failed.push(`第 ${index + 1} 张（${detail.slice(0, 80)}）`)
        results[imageUrl] = { originalUrl: imageUrl, processedUrl: imageUrl, result: null }
      }
    }
    setNaturalizeProgress('')
    props.onNaturalizeComplete(results)
    updateStage({
      confirmedImageUrls: ['done'],
      step: 'CONFIRMED',
      busy: false,
      error: failed.length ? `${failed.join('、')}处理失败，已回退为原图继续` : ''
    })
  }

  // ── 渲染 ──────────────────────────────────────────────────────────────────

  const stageStep = (stage: EbayImageStage): EbayImageStageStep => stageStates[stage].step
  const stageStatus = (stage: EbayImageStage): 'done' | 'active' | 'locked' => {
    if (isStageConfirmed(stage)) return 'done'
    if (stage === activeStage) return 'active'
    return isStageUnlocked(stage) ? 'active' : 'locked'
  }

  const taskState = (() => {
    if (isNaturalize) {
      if (current.confirmedImageUrls.length) return { title: '自然化处理已完成', detail: '图片已进入后续视频生成流程。', state: 'done' as const }
      if (!allGenStagesConfirmed) return { title: '等待完成四类图片确认', detail: '主图、产品图、痛点图和场景图全部确认后才能进行自然化。', state: 'blocked' as const }
      return { title: '自然化全部已确认图片', detail: `当前共有 ${confirmedImageUrls.length} 张图片待处理，完成后进入视频生成。`, state: 'ready' as const }
    }
    if (current.busy) return { title: current.progress || 'AI 正在处理当前任务', detail: '完成前请勿重复提交；可以查看下方已有证据。', state: 'running' as const }
    if (!selectedIndices.length) return { title: '选择用于当前阶段的原图', detail: '至少选择 1 张与当前任务相关的原图。', state: 'ready' as const }
    if (!current.factCards.length) return { title: '生成并核对事实卡', detail: `已选择 ${selectedIndices.length} 张原图，下一步提取商品事实。`, state: 'ready' as const }
    if (!current.storyboardCards.length) return { title: '生成并检查分镜卡', detail: `已有 ${current.factCards.length} 张事实卡，生成前可核对保护属性与警告。`, state: 'ready' as const }
    if (!current.modelId) return { title: '选择 AI 生图模型', detail: '选择模型后才能按分镜生成图片。', state: 'blocked' as const }
    if (!current.generatedImages.length) return { title: '按分镜生成候选图片', detail: `已准备 ${current.storyboardCards.length} 张分镜卡。`, state: 'ready' as const }
    if (!current.selectedImageUrls.length) return { title: '选择要采用的候选图片', detail: `当前有 ${current.generatedImages.length} 张候选图，至少选择 1 张。`, state: 'blocked' as const }
    return { title: '确认图片并进入下一阶段', detail: `已选择 ${current.selectedImageUrls.length} 张候选图，确认后仍可返回撤回。`, state: 'ready' as const }
  })()

  const taskConditions = isNaturalize
    ? [
        { label: '四类图片均已确认', met: allGenStagesConfirmed },
        { label: `待处理图片 ${confirmedImageUrls.length} 张`, met: confirmedImageUrls.length > 0 }
      ]
    : [
        { label: `原图 ${selectedIndices.length} 张`, met: selectedIndices.length > 0 },
        { label: `事实卡 ${current.factCards.length} 张`, met: current.factCards.length > 0 },
        { label: `分镜卡 ${current.storyboardCards.length} 张`, met: current.storyboardCards.length > 0 },
        { label: current.modelId ? '模型已选择' : '模型未选择', met: Boolean(current.modelId) },
        { label: `候选图 ${current.generatedImages.length} 张`, met: current.generatedImages.length > 0 }
      ]

  return <div className="ebay-stage-panel">
    {/* ── 阶段进度条 ── */}
    <div className="ebay-stage-stepper">
      {STAGES.map((stage, index) => {
        const status = stageStatus(stage)
        return <button
          key={stage}
          className={`ebay-stage-step ${status} ${stage === activeStage ? 'current' : ''}`}
          disabled={status === 'locked'}
          aria-current={stage === activeStage ? 'step' : undefined}
          aria-label={`${STAGE_LABELS[stage]}，${status === 'done' ? '已完成' : status === 'locked' ? '尚未解锁' : stage === activeStage ? '当前阶段' : '可进入'}`}
          onClick={() => { if (status !== 'locked') switchStage(stage) }}
        >
          <span className="ebay-stage-number" style={{ background: status === 'done' ? STAGE_COLORS[stage] : undefined }}>
            {status === 'done' ? '✓' : index + 1}
          </span>
          <span className="ebay-stage-label">{STAGE_LABELS[stage]}</span>
        </button>
      })}
    </div>

    <section className={`ebay-stage-task ebay-stage-task--${taskState.state}`} aria-labelledby="ebay-stage-current-task">
      <div>
        <span>当前任务</span>
        <h3 id="ebay-stage-current-task">{taskState.title}</h3>
        <p>{taskState.detail}</p>
      </div>
      <ul aria-label="当前阶段完成条件">
        {taskConditions.map(condition => <li className={condition.met ? 'met' : ''} key={condition.label}><span aria-hidden="true">{condition.met ? '✓' : '○'}</span>{condition.label}</li>)}
      </ul>
    </section>

    <div className="ebay-stage-live" aria-live="polite" aria-atomic="true">{current.error || (current.busy ? taskState.title : '')}</div>

    {/* ── 高级参数 ── */}
    <details className="ebay-stage-advanced">
      <summary>高级设置 <span>分析并发 {analysisConcurrency} · 生图并发 {generationConcurrency}</span></summary>
      <div className="ebay-stage-concurrency-bar">
        <label className="ebay-stage-count-input">分析任务并发
          <input aria-label="分析任务并发数" type="number" min={1} max={6} value={analysisConcurrency} onChange={e => updateAnalysisConcurrency(Number(e.target.value) || 1)} />
        </label>
        <label className="ebay-stage-count-input">AI 生图并发
          <input aria-label="AI 生图并发数" type="number" min={1} max={4} value={generationConcurrency} onChange={e => updateGenerationConcurrency(Number(e.target.value) || 1)} />
        </label>
        <small>并发越低越省配额、越不易限流；越高越快</small>
      </div>
    </details>

    {/* ── 当前阶段标题 ── */}
    <div className="ebay-stage-header" style={{ borderLeftColor: STAGE_COLORS[activeStage] }}>
      <b>{STAGE_LABELS[activeStage]}</b>
      <small>{isNaturalize ? '对已生成的 AI 图片进行自然化处理' : '选择原图 → 生成事实卡 → 编辑分镜卡 → AI 生成 → 确认'}</small>
    </div>

    {/* ── 错误提示 ── */}
    {current.error && <div className="ebay-stage-error" role="alert"><b>当前任务未完成</b><span>{current.error}</span></div>}

    {/* ── 非自然化阶段的操作面板 ── */}
    {!isNaturalize && <>
      {/* 步骤 1: 选择原图 */}
      <section className="ebay-stage-section">
        <header><b>① 选择原图</b><small>从已同步的原商品图片中选择参照（不限张数），已选 {selectedIndices.length} 张</small></header>
        <div className="ebay-stage-source-grid">
          {props.sourceImages.map((url, index) => (
            <button
              key={url}
              type="button"
              className={`ebay-stage-source-item ${selectedIndices.includes(index) ? 'selected' : ''}`}
              onClick={() => toggleSourceImage(index)}
            >
              <img src={url} alt={`原图 ${index + 1}`} />
              <span>原图 {index + 1}</span>
              {selectedIndices.includes(index) && <em className="check">✓</em>}
            </button>
          ))}
        </div>
      </section>

      {/* 步骤 2: 事实卡（每张原图 1 张） */}
      <section className="ebay-stage-section">
        <header>
          <b>② 读取原图 → 生成事实卡</b>
          <button className="yd-button yd-button--secondary" disabled={!selectedIndices.length || current.busy} title={!selectedIndices.length ? '请先选择至少 1 张原图' : undefined} onClick={() => void runStageGrounding()}>
            {current.busy && current.step === 'GROUNDING' ? (current.progress || '分析中…') : current.factCards.length ? '重新分析' : '生成事实卡'}
          </button>
        </header>
        {current.factCards.length > 0 ? (
          <div className="ebay-stage-fact-cards">
            <div className="ebay-stage-fact-global">
              <p><b>商品主体：</b>{current.factCards[0].productIdentity}</p>
              <p><b>保护属性：</b>{current.factCards[0].protectedAttributes.join('；')}</p>
            </div>
            <div className="ebay-stage-fact-grid">
              {current.factCards.map((fc, i) => {
                const srcIdx = selectedIndices[i]
                return (
                  <div key={i} className="ebay-stage-fact-mini">
                    <img src={props.sourceImages[srcIdx]} alt={`原图 ${srcIdx + 1}`} />
                    <div className="ebay-stage-fact-mini-body">
                      <small className="ebay-stage-fact-mini-title"><b>原图 {srcIdx + 1}{props.sourceLabels[srcIdx] ? ` · ${props.sourceLabels[srcIdx]}` : ''}</b></small>
                      <small><b>已核实事实：</b>{fc.verifiedFacts.join('；')}</small>
                      <small><b>生成指令：</b>{fc.stageInstruction}</small>
                      {fc.warnings.map((w, wi) => <small key={wi} className="ebay-stage-fact-mini-warn">⚠ {w}</small>)}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : current.step === 'GROUNDING' ? (
          <p className="ebay-stage-placeholder">{current.progress || '正在分析原图…'}</p>
        ) : <p className="ebay-stage-placeholder">选择原图后点击“生成事实卡”（每张原图生成 1 张事实卡）</p>}
      </section>

      {/* 步骤 3: 分镜卡 */}
      <section className="ebay-stage-section">
        <header>
          <b>③ 分镜卡生成（可编辑）</b>
          <button className="yd-button yd-button--secondary" disabled={!current.factCards.length || current.busy} title={!current.factCards.length ? '请先生成事实卡' : undefined} onClick={() => void runStageStoryboard()}>
            {current.busy && !current.storyboardCards.length ? (current.progress || '生成中…') : current.storyboardCards.length ? '重新生成分镜卡' : '生成分镜卡'}
          </button>
        </header>
        {current.storyboardCards.length > 0 ? (
          <div className="ebay-stage-cards">
            {current.storyboardCards.map(card => (
              <article
                key={card.id}
                className={`ebay-stage-card ${current.selectedCardId === card.id ? 'selected' : ''}`}
                onClick={() => updateStage({ selectedCardId: card.id })}
              >
                <div className="ebay-stage-card-header">
                  <em>{card.id}</em>
                  <b>{card.title}</b>
                  <button type="button" className="edit-btn" onClick={e => { e.stopPropagation(); setEditingCardId(editingCardId === card.id ? null : card.id) }}>
                    {editingCardId === card.id ? '完成' : '编辑'}
                  </button>
                </div>
                {editingCardId === card.id ? (
                  <div className="ebay-stage-card-edit" onClick={e => e.stopPropagation()}>
                    <label>镜头描述：<textarea rows={2} value={card.instruction} onChange={e => updateCard(card.id, { instruction: e.target.value })} /></label>
                    <label>内容依据：<textarea rows={2} value={card.evidence} onChange={e => updateCard(card.id, { evidence: e.target.value })} /></label>
                    <label>验收标准：<textarea rows={2} value={card.acceptance} onChange={e => updateCard(card.id, { acceptance: e.target.value })} /></label>
                    <label>禁止事项：<textarea rows={2} value={card.prohibited} onChange={e => updateCard(card.id, { prohibited: e.target.value })} /></label>
                    <label>附加备注：<textarea rows={1} value={card.userNote} onChange={e => updateCard(card.id, { userNote: e.target.value })} placeholder="可选，将同步进入生图指令" /></label>
                  </div>
                ) : (
                  <div className="ebay-stage-card-preview">
                    <small><strong>镜头任务：</strong>{card.instruction}</small>
                    <small><strong>内容依据：</strong>{card.evidence}</small>
                    <small><strong>验收：</strong>{card.acceptance}</small>
                    <small className="prohibited"><strong>禁止：</strong>{card.prohibited}</small>
                    {card.userNote && <small><strong>备注：</strong>{card.userNote}</small>}
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : current.busy ? (
          <p className="ebay-stage-placeholder">{current.progress || '正在生成分镜卡…'}</p>
        ) : <p className="ebay-stage-placeholder">生成事实卡后点击“生成分镜卡”（每张事实卡生成 1 张分镜卡）</p>}
      </section>

      {/* 步骤 4: 模型选择 */}
      <section className="ebay-stage-section">
        <header><b>④ AI 生图模型</b><small>根据阶段类型自动推荐，也可手动切换</small></header>
        <div className="ebay-stage-model-select">
          <select value={current.modelId} onChange={e => updateStage({ modelId: e.target.value })} aria-label="AI 生图模型">
            <option value="">请选择模型</option>
            {props.imageModels.map(model => (
              <option key={model.id} value={model.id}>
                {model.name}{model.costLabel ? ` · ${model.costLabel}` : ''}{model.strengths ? ` · ${model.strengths}` : ''}
              </option>
            ))}
          </select>
          {current.modelId && <ModelRecommendBadge stage={activeStage} models={props.imageModels} selectedId={current.modelId} onSelect={modelId => updateStage({ modelId })} />}
        </div>
      </section>

      {/* 步骤 5: 生成图片 */}
      <section className="ebay-stage-section">
        <header>
          <b>⑤ AI 生成图片</b>
          <div className="ebay-stage-gen-actions">
            <label className="ebay-stage-count-input">每卡变体数
              <input type="number" min={1} max={4} value={current.variationsPerCard} onChange={e => updateStage({ variationsPerCard: Math.max(1, Math.min(4, Number(e.target.value) || 1)) })} />
            </label>
            <button className={`yd-button ${current.generatedImages.length ? 'yd-button--secondary' : 'yd-button--primary'}`} disabled={!current.storyboardCards.length || !current.modelId || current.busy || !!current.regeneratingCardId} title={!current.storyboardCards.length ? '请先生成分镜卡' : !current.modelId ? '请先选择 AI 生图模型' : undefined} onClick={() => void runStageGeneration()}>
              {current.busy && current.step === 'GENERATING' ? (current.progress || '生成中…') : current.generatedImages.length ? '重新生成全部' : `生成图片（${current.storyboardCards.length} 个分镜）`}
            </button>
            {current.generatedImages.length > 0 && (
              <button type="button" disabled={current.busy || !!current.regeneratingCardId} onClick={() => void runStageGeneration('Use a clearly different camera angle or composition from the previous attempt.')}>
                换角度重新生成全部
              </button>
            )}
          </div>
        </header>
        {current.generatedImages.length > 0 ? (
          <div className="ebay-stage-generated">
            <p className="ebay-stage-gen-hint">点击图片可多选，已选 {current.selectedImageUrls.length} 张</p>
            {current.generatedImages.map((g, i) => (
              <div key={g.url} className="ebay-stage-gen-cell">
                <button
                  type="button"
                  className={`ebay-stage-gen-item ${current.selectedImageUrls.includes(g.url) ? 'selected' : ''}`}
                  onClick={() => toggleGeneratedImage(g.url)}
                >
                  <img src={g.url} alt={`生成图 ${i + 1}`} />
                  <em className="ebay-stage-gen-card-tag">{g.cardId} · {g.cardTitle}</em>
                  <span>{current.selectedImageUrls.includes(g.url) ? '✓ 已选中' : '点击选择'}</span>
                </button>
                <button
                  type="button"
                  className="ebay-stage-gen-regen"
                  disabled={current.busy || !!current.regeneratingCardId}
                  onClick={() => void regenerateCard(g.cardId)}
                >
                  {current.regeneratingCardId === g.cardId ? '生成中…' : '↻ 重新生成'}
                </button>
              </div>
            ))}
          </div>
        ) : current.step === 'GENERATING' ? (
          <p className="ebay-stage-placeholder">{current.progress || '正在生成图片，请稍候…'}</p>
        ) : <p className="ebay-stage-placeholder">生成分镜卡并选择模型后点击“生成图片”，将按每张分镜卡各生成 1 张图</p>}
      </section>

      {/* 步骤 6: 确认 */}
      {current.generatedImages.length > 0 && !current.confirmedImageUrls.length && (
        <div className="ebay-stage-confirm-bar">
          <button className="yd-button yd-button--primary ebay-stage-confirm" disabled={!current.selectedImageUrls.length} title={!current.selectedImageUrls.length ? '请至少选择 1 张候选图片' : undefined} onClick={confirmStage}>
            确认采用所选 {current.selectedImageUrls.length} 张图片，进入下一阶段
          </button>
          <button type="button" onClick={regenerateStage}>不满意，重新调整分镜卡</button>
        </div>
      )}
      {current.confirmedImageUrls.length > 0 && (
        <div className="ebay-stage-confirmed">
          <div className="ebay-stage-confirmed-grid">
            {current.confirmedImageUrls.map(url => <img key={url} src={url} alt="已确认" />)}
          </div>
          <div>
            <b>✓ {STAGE_LABELS[activeStage]}已确认（{current.confirmedImageUrls.length} 张）</b>
            <button type="button" onClick={() => { updateStage({ confirmedImageUrls: [], step: 'REVIEW' }) }}>撤回确认</button>
          </div>
        </div>
      )}
    </>}

    {/* ── 自然化阶段 ── */}
    {isNaturalize && (
      <section className="ebay-stage-section" ref={naturalizeRef}>
        <header>
          <b>对已生成的 AI 图片进行自然化处理</b>
          <small>使 AI 生成图更接近实拍质感；确认后进入视频生成</small>
        </header>
        <div className="ebay-stage-naturalize-profile">
          <span>自然化档位：</span>
          <label><input type="radio" name="naturalize-profile" checked={naturalizeProfile === 'light'} onChange={() => setNaturalizeProfile('light')} /> 轻度</label>
          <label><input type="radio" name="naturalize-profile" checked={naturalizeProfile === 'balanced'} onChange={() => setNaturalizeProfile('balanced')} /> 均衡</label>
        </div>
        <div className="ebay-stage-naturalize-grid">
          {confirmedImageUrls.map(url => (
            <article key={url} className="ebay-stage-naturalize-item">
              <img src={url} alt="确认图" />
            </article>
          ))}
        </div>
        <div className="ebay-stage-confirm-bar">
          <button className="yd-button yd-button--primary ebay-stage-confirm" disabled={current.busy || !allGenStagesConfirmed} title={!allGenStagesConfirmed ? '请先确认主图、产品图、痛点图和场景图' : undefined} onClick={() => void runNaturalize()}>
            {current.busy ? (naturalizeProgress || '处理中…') : current.confirmedImageUrls.length ? '✓ 自然化已完成' : `一键自然化处理（全部 ${confirmedImageUrls.length} 张）`}
          </button>
        </div>
      </section>
    )}
  </div>
}

// ─── 模型推荐标签 ─────────────────────────────────────────────────────────────

function ModelRecommendBadge({ stage, models, selectedId, onSelect }: { stage: EbayImageStage; models: ImageModelProfile[]; selectedId: string; onSelect: (modelId: string) => void }) {
  // 根据阶段类型从模型 strengths 中提取推荐
  const keywords = STAGE_MODEL_KEYWORDS[stage] || []
  const recommended = models
    .filter(m => m.id !== selectedId)
    .filter(m => keywords.some(k => (m.strengths || '').includes(k) || (m.description || '').includes(k)))
    .slice(0, 2)

  if (!recommended.length) return null
  return (
    <div className="ebay-stage-model-recommend">
      <span>AI 推荐：</span>
      {recommended.map(m => (
        <button key={m.id} type="button" onClick={() => onSelect(m.id)}>
          {m.name}{m.costLabel ? ` · ${m.costLabel}` : ''}
        </button>
      ))}
    </div>
  )
}
