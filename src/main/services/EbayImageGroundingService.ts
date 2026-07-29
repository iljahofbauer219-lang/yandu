import type { EbayImageCandidateReview, EbayImageCandidateReviewRequest, EbayImageGenerationPurpose, EbayImageGroundingPlan, EbayImageGroundingRequest, EbayImageGroundingSource } from '../../shared/contracts'

const purposes: EbayImageGenerationPurpose[] = ['HERO', 'DETAIL', 'PAIN_POINT', 'SCENE']

function clampScore(value: unknown, fallback: number) {
  const score = Number(value)
  return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : fallback
}

/**
 * 从 LLM 响应中提取第一个完整的 JSON 对象。
 * 比简单的 find-first-{ find-last-} 更可靠，能处理嵌套大括号和截断。
 */
function extractJson(text: string): Record<string, unknown> {
  const cleaned = text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')

  let depth = 0
  let start = -1
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i]
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1)) as Record<string, unknown>
        } catch {
          // 解析失败，继续尝试找更完整的内容
          start = -1
        }
      }
    }
  }
  throw new Error('视觉模型没有返回可解析的结构化结果')
}

function uniqueImageUrls(images: string[], limit = 8) {
  return [...new Set(images)]
    .filter(url => Boolean(url) && /^(https?:|data:image\/)/i.test(url))
    .slice(0, limit)
}

function uniqueImageReferences(images: string[], labels: string[] = [], limit = 8) {
  const seen = new Set<string>()
  return images.flatMap((url, index) => {
    if (!url || seen.has(url) || !/^(https?:|data:image\/)/i.test(url)) return []
    seen.add(url)
    return [{ url, label: labels[index]?.trim() || '未标注' }]
  }).slice(0, limit)
}

function labelMatchesPurpose(label: string, purpose: EbayImageGenerationPurpose) {
  const normalized = label.trim().toLowerCase()
  if (purpose === 'HERO') return ['主图', '正面', '商品全貌'].some(v => normalized.includes(v))
  if (purpose === 'DETAIL') return ['细节', '侧面', '背面', '结构', '尺寸', '材质'].some(v => normalized.includes(v))
  if (purpose === 'PAIN_POINT') return ['痛点', '问题', '对比', '安装'].some(v => normalized.includes(v))
  return ['场景', '应用', '主图', '正面'].some(v => normalized.includes(v))
}

function eligibleReferenceIndices(images: string[], labels: string[], purpose: EbayImageGenerationPurpose) {
  const direct = images.map((_, i) => i).filter(i => labelMatchesPurpose(labels[i] || '', purpose))
  return direct.length ? direct : images.map((_, i) => i)
}

function fallbackReferences(images: string[], labels: string[] = []) {
  const preferred: Record<EbayImageGenerationPurpose, number[]> = {
    HERO: [0, 1, 2], DETAIL: [1, 2, 3, 5, 6], PAIN_POINT: [3, 4, 1, 2], SCENE: [0, 7, 3, 4]
  }
  return Object.fromEntries(purposes.map(purpose => {
    const eligible = eligibleReferenceIndices(images, labels, purpose)
    const selected = (preferred[purpose] || []).filter(i => eligible.includes(i)).slice(0, 5)
    return [purpose, selected.length ? selected : eligible.slice(0, 5)]
  })) as Record<EbayImageGenerationPurpose, number[]>
}

function fallbackPlan(request: EbayImageGroundingRequest, model: string, warning: string): EbayImageGroundingPlan {
  const refs = fallbackReferences(request.sourceImages, request.sourceLabels)
  const facts = [request.title, ...request.itemSpecifics.slice(0, 8).map(item => `${item.name}: ${item.value}`)].filter(Boolean)
  return {
    model,
    productIdentity: request.title || '待人工确认的商品主体',
    protectedAttributes: request.itemSpecifics.slice(0, 8).map(item => `${item.name}: ${item.value}`),
    verifiedFacts: facts,
    warnings: warning ? [warning] : [],
    sources: request.sourceImages.map((_, sourceIndex) => ({
      sourceIndex, roles: purposes,
      facts: sourceIndex === 0 ? facts.slice(0, 4) : [],
      quality: 'IMPROVE' as const
    })),
    purposeReferences: refs,
    purposeInstructions: {
      HERO: '基于能清晰展示商品主体的原图，生成干净的白底主图。',
      DETAIL: '基于原图真实结构和材质，生成细节展示图。',
      PAIN_POINT: '用已核实的购买理由，生成产品解决方案展示图。',
      SCENE: '在不改变商品本体、结构和配件的前提下，生成真实应用场景图。'
    },
    analyzedAt: new Date().toISOString()
  }
}

function normalizePurpose(value: unknown): EbayImageGenerationPurpose[] {
  const values = Array.isArray(value) ? value : [value]
  const normalized = values.map(item => String(item || '').toUpperCase())
    .filter((item): item is EbayImageGenerationPurpose => purposes.includes(item as EbayImageGenerationPurpose))
  return normalized.length ? normalized : ['DETAIL']
}

export class EbayImageGroundingService {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly model: string
  ) {}

  private async chat(content: Array<Record<string, unknown>>) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 90000)
    try {
      const response = await fetch(
        `${this.baseUrl.replace(/\/$/, '')}/chat/completions`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: this.model,
            messages: [{ role: 'user', content }],
            temperature: 0,
            response_format: { type: 'json_object' }
          })
        }
      )
      const payload = await response.json() as {
        choices?: { message?: { content?: string } }[]
        error?: { message?: string }
        message?: string
      }
      if (!response.ok) {
        throw new Error(payload.error?.message || payload.message || `视觉分析失败（HTTP ${response.status}）`)
      }
      return extractJson(payload.choices?.[0]?.message?.content || '')
    } finally {
      clearTimeout(timeout)
    }
  }

  async ground(request: EbayImageGroundingRequest): Promise<EbayImageGroundingPlan> {
    const references = uniqueImageReferences(request.sourceImages, request.sourceLabels)
    const sourceImages = references.map(r => r.url)
    const sourceLabels = references.map(r => r.label)

    if (!sourceImages.length) {
      return fallbackPlan(
        { ...request, sourceImages, sourceLabels },
        this.model,
        '没有可供分析的原商品图片，请先重新读取 eBay 原图。'
      )
    }

    if (!this.apiKey) {
      return fallbackPlan(
        { ...request, sourceImages, sourceLabels },
        this.model,
        '未配置百炼视觉模型，已采用保守的多图参照方案，请人工核对商品主体。'
      )
    }

    // 简化版的 prompt — 更短、更清晰，减少模型截断风险
    const productInfo = [
      `商品标题：${request.title}`,
      `商品属性：${request.itemSpecifics.map(i => `${i.name}=${i.value}`).join('；')}`,
      `英文详情：${request.description.slice(0, 3000)}`
    ].join('\n')

    const imageList = sourceImages.map((_, i) =>
      `原图 ${i + 1}${sourceLabels[i] ? `（标签：${sourceLabels[i]}）` : ''}`
    ).join('、')

    const prompt = `你是跨境电商商品图分析专家。
${productInfo}

可用原图：${imageList}

请分析：
1. 商品主体（productIdentity）— 真正出售的商品是什么
2. 保护属性（protectedAttributes）— 哪些商品特征绝对不能改变
3. 每张原图的质量评级（KEEP=可直接使用, IMPROVE=需优化, EXCLUDE=不适用）
4. 为以下四种用途各选最多3张最合适的原图作为参考：
   - HERO（主图）：优先选带"主图/正面/商品全貌"标签的
   - DETAIL（细节图）：优先选带"细节/侧面/背面/结构/尺寸"标签的
   - PAIN_POINT（痛点图）：优先选带"痛点/问题/对比/安装"标签的
   - SCENE（场景图）：优先选带"场景/应用"标签的
5. 每个用途写一句简短的生成指令（purposeInstructions）

输出 JSON 格式：
{"productIdentity":"...","protectedAttributes":["..."],"verifiedFacts":["..."],"warnings":["..."],"sources":[{"sourceIndex":0,"roles":["HERO","DETAIL"],"quality":"KEEP|IMPROVE|EXCLUDE"}],"purposeReferences":{"HERO":[0],"DETAIL":[1],"PAIN_POINT":[2],"SCENE":[3]},"purposeInstructions":{"HERO":"...","DETAIL":"...","PAIN_POINT":"...","SCENE":"..."}}`

    const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }]
    for (const [index, url] of sourceImages.entries()) {
      content.push(
        { type: 'text', text: `原图 ${index + 1}` },
        { type: 'image_url', image_url: { url } }
      )
    }

    try {
      const parsed = await this.chat(content)

      // 安全提取参考图索引
      const allowedRefs = (values: unknown, limit = 3) => {
        if (!Array.isArray(values)) return []
        return [...new Set(
          values.map(Number)
            .filter(i => Number.isInteger(i) && i >= 0 && i < sourceImages.length)
        )].slice(0, limit)
      }

      const fallback = fallbackReferences(sourceImages, sourceLabels)

      // 解析 sources
      const sourceRows = Array.isArray(parsed.sources) ? parsed.sources : []
      const sources: EbayImageGroundingSource[] = sourceImages.map((_, sourceIndex) => {
        const row = sourceRows.find(
          (r: unknown) => Number((r as Record<string, unknown>)?.sourceIndex) === sourceIndex
        ) as Record<string, unknown> | undefined
        return {
          sourceIndex,
          roles: normalizePurpose(row?.roles),
          facts: Array.isArray(row?.facts) ? (row.facts as unknown[]).map(String).filter(Boolean).slice(0, 8) : [],
          quality: (['KEEP', 'EXCLUDE'] as const).includes((row?.quality as string)?.toUpperCase() as 'KEEP' | 'EXCLUDE')
            ? (row!.quality as string).toUpperCase() as 'KEEP' | 'EXCLUDE'
            : 'IMPROVE'
        }
      })

      // 解析 purposeReferences
      const rawRefs = (parsed.purposeReferences || {}) as Record<string, unknown>
      const purposeReferences = Object.fromEntries(
        purposes.map(purpose => {
          const eligible = eligibleReferenceIndices(sourceImages, sourceLabels, purpose)
          const selected = allowedRefs(rawRefs[purpose]).filter(i => eligible.includes(i))
          return [purpose, selected.length ? selected : fallback[purpose]]
        })
      ) as Record<EbayImageGenerationPurpose, number[]>

      // 解析 purposeInstructions
      const rawInstructions = (parsed.purposeInstructions || {}) as Record<string, unknown>
      const base = fallbackPlan({ ...request, sourceImages, sourceLabels }, this.model, '')
      const purposeInstructions = Object.fromEntries(
        purposes.map(purpose => [
          purpose,
          String(rawInstructions[purpose] || base.purposeInstructions[purpose]).slice(0, 500)
        ])
      ) as Record<EbayImageGenerationPurpose, string>

      return {
        model: this.model,
        productIdentity: String(parsed.productIdentity || request.title || '待人工确认的商品主体').slice(0, 500),
        protectedAttributes: Array.isArray(parsed.protectedAttributes)
          ? parsed.protectedAttributes.map(String).filter(Boolean).slice(0, 20)
          : base.protectedAttributes,
        verifiedFacts: Array.isArray(parsed.verifiedFacts)
          ? parsed.verifiedFacts.map(String).filter(Boolean).slice(0, 30)
          : base.verifiedFacts,
        warnings: [
          ...(Array.isArray(parsed.warnings) ? parsed.warnings.map(String).filter(Boolean).slice(0, 10) : []),
          ...purposes.flatMap(p =>
            sourceLabels.some(l => labelMatchesPurpose(l, p)) ? [] :
              [`未标注适合"${p}"的原图，已使用保守参照。`]
          )
        ],
        sources,
        purposeReferences,
        purposeInstructions,
        analyzedAt: new Date().toISOString()
      }
    } catch (reason) {
      return fallbackPlan(
        { ...request, sourceImages, sourceLabels },
        this.model,
        `${reason instanceof Error ? reason.message : '视觉分析失败'}；已切换到保守多图参照，请人工核对。`
      )
    }
  }

  async reviewCandidate(request: EbayImageCandidateReviewRequest): Promise<EbayImageCandidateReview> {
    const sourceImages = uniqueImageUrls(request.sourceImages)
    const fallback = (reason: string): EbayImageCandidateReview => ({
      candidateUrl: request.candidateUrl,
      purpose: request.purpose,
      status: 'REVIEW',
      identityScore: 0,
      structuralScore: 0,
      factScore: 0,
      purposeScore: 0,
      diversityScore: 0,
      reason,
      referenceIndices: request.referenceIndices
    })

    if (!this.apiKey || !/^https?:\/\//i.test(request.candidateUrl)) {
      return fallback('未能提交视觉一致性检查，需人工确认后采用。')
    }

    const refs = request.referenceIndices
      .map(i => sourceImages[i])
      .filter(Boolean)
      .slice(0, 5)

    if (!refs.length) {
      return fallback('未找到对应的原图参照，需人工确认后采用。')
    }

    // 简化版prompt — 降低截断风险
    const prompt = `你是商品图质量审核员。
商品标题：${request.title}
必须保留的特征：${request.protectedAttributes.join('；')}
关键事实：${request.verifiedFacts.join('；')}
本张图的镜头任务：${request.shotInstruction || request.purpose}

先展示原图参照，再展示AI候选图。判断候选图是否仍是同一个可售商品，并判断镜头任务完成度。
${(request.comparisonCandidateUrls || []).length ? '同时与同用途的已生成候选图对比，判断是否有足够差异。' : ''}

输出 JSON：
{"identityScore":0-100,"structuralScore":0-100,"factScore":0-100,"purposeScore":0-100,"diversityScore":0-100,"status":"PASSED|REJECTED","reason":"简短原因"}

评分标准（分数越低要求越宽松）：
- identityScore ≥ 75：商品一致性
- structuralScore ≥ 72：结构保留
- factScore ≥ 72：事实准确
- purposeScore ≥ 70：镜头任务完成度
${(request.comparisonCandidateUrls || []).length ? '- diversityScore ≥ 60：与同用途其他图有足够差异' : ''}
全部达标则 PASSED，否则 REJECTED。不确定时输出 REVIEW。`

    const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }]
    for (const [i, url] of refs.entries()) {
      content.push({ type: 'text', text: `原图参照 ${i + 1}` }, { type: 'image_url', image_url: { url } })
    }
    content.push({ type: 'text', text: 'AI 候选图' }, { type: 'image_url', image_url: { url: request.candidateUrl } })
    for (const [i, url] of (request.comparisonCandidateUrls || []).filter(u => /^https?:\/\//i.test(u)).slice(-3).entries()) {
      content.push({ type: 'text', text: `同用途已生成候选图 ${i + 1}` }, { type: 'image_url', image_url: { url } })
    }

    try {
      const result = await this.chat(content)
      const identityScore = clampScore(result.identityScore, 0)
      const structuralScore = clampScore(result.structuralScore, 0)
      const factScore = clampScore(result.factScore, 0)
      const purposeScore = clampScore(result.purposeScore, 0)
      const diversityScore = clampScore(result.diversityScore, (request.comparisonCandidateUrls || []).length ? 0 : 100)
      const hasComparisons = (request.comparisonCandidateUrls || []).length > 0

      // 调整后的宽松阈值
      const passed = identityScore >= 75 && structuralScore >= 72 && factScore >= 72 &&
        purposeScore >= 70 && (!hasComparisons || diversityScore >= 60)

      const requestedStatus = String(result.status || 'REVIEW').toUpperCase()
      const status = (requestedStatus === 'PASSED' && passed) ? 'PASSED' as const : 'REVIEW' as const

      return {
        candidateUrl: request.candidateUrl,
        purpose: request.purpose,
        status,
        identityScore, structuralScore, factScore, purposeScore, diversityScore,
        reason: String(result.reason || '视觉模型未提供具体原因。'),
        referenceIndices: request.referenceIndices
      }
    } catch (reason) {
      return fallback(`${reason instanceof Error ? reason.message : '视觉一致性检查失败'}；需人工确认后采用。`)
    }
  }
}
