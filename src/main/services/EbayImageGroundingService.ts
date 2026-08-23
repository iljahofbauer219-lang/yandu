import type { EbayImageCandidateReview, EbayImageCandidateReviewRequest, EbayImageGenerationPurpose, EbayImageGroundingPlan, EbayImageGroundingRequest, EbayImageGroundingSource, EbayImageRoleSuggestionRequest, EbayImageRoleSuggestionResult, EbayImageSourceRoleSuggestion, EbayImageStage, EbayStageFactCard, EbayStageGroundingRequest, EbayStageModelRecommendation, EbayStageStoryboardCard, EbayStageStoryboardRequest, ImagePackageTextExtractionRequest, ImagePackageTextExtractionResult, ImagePackageTextField, ImagePackageTextObservation } from '../../shared/contracts'
import { ImageHashService } from './ImageHashService'

const purposes: EbayImageGenerationPurpose[] = ['HERO', 'PRODUCT', 'PAIN_POINT', 'SCENE']

const sourceRoleSuggestionValues: EbayImageSourceRoleSuggestion[] = ['HERO', 'FRONT', 'SIDE', 'BACK', 'DETAIL', 'INSTALLATION', 'SIZE', 'PAIN_POINT', 'SCENE']

// 按用途的角色偏好排序表：HERO/PRODUCT 优先（最能体现产品外形），与前端 ebayImageReferenceRolePreferences 保持一致
const referenceRolePreferences: Record<EbayImageGenerationPurpose, string[]> = {
  HERO: ['主图', '正面', '侧面', '细节'],
  PRODUCT: ['正面', '细节', '主图', '侧面', '材质', '特写', '背面', '安装/结构', '尺寸参照'],
  PAIN_POINT: ['主图', '正面', '痛点依据', '细节', '尺寸参照', '安装/结构'],
  SCENE: ['主图', '正面', '应用场景', '细节', '侧面']
}

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

function uniqueImageUrls(images: string[], limit = 12) {
  return [...new Set(images)]
    .filter(url => Boolean(url) && /^(https?:|data:image\/)/i.test(url))
    .slice(0, limit)
}

function uniqueImageReferences(images: string[], labels: string[] = [], limit = 12) {
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
  if (purpose === 'PRODUCT') return ['正面', '细节', '主图', '侧面', '背面', '结构', '尺寸', '材质', '特写', '商品全貌'].some(v => normalized.includes(v))
  if (purpose === 'PAIN_POINT') return ['痛点', '问题', '对比', '安装'].some(v => normalized.includes(v))
  return ['场景', '应用', '主图', '正面'].some(v => normalized.includes(v))
}

function eligibleReferenceIndices(images: string[], labels: string[], purpose: EbayImageGenerationPurpose) {
  const direct = images.map((_, i) => i).filter(i => labelMatchesPurpose(labels[i] || '', purpose))
  return direct.length ? direct : images.map((_, i) => i)
}

function fallbackReferences(images: string[], labels: string[] = []) {
  const preferred: Record<EbayImageGenerationPurpose, number[]> = {
    HERO: [0, 1, 2], PRODUCT: [0, 1, 2, 3, 5, 6], PAIN_POINT: [3, 4, 1, 2], SCENE: [0, 7, 3, 4]
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
      PRODUCT: '基于能清晰展示商品正面与细节的原图，生成完整的产品展示图。',
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
  return normalized.length ? normalized : ['PRODUCT']
}

export class EbayImageGroundingService {
  private readonly hashService = new ImageHashService()

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly model: string
  ) {}

  async extractPackageText(request:ImagePackageTextExtractionRequest):Promise<ImagePackageTextExtractionResult> {
    const sourceImages=uniqueImageUrls(request.sourceImages).slice(0,12),labels=request.sourceLabels||[],analyzedAt=new Date().toISOString()
    const empty=(warning:string):ImagePackageTextExtractionResult=>({model:this.model,observations:[],conflicts:[],combinedText:'',warnings:[warning],analyzedAt})
    if(!sourceImages.length)return empty('没有可识别的参考图')
    if(!this.apiKey)return empty('未配置视觉模型，无法执行包装OCR')
    const prompt=`你是商品图片事实核验员。逐张读取包装上真实可见的文字，不推测、不补全模糊内容；同时根据多张图片判断商品形态和用途。分别提取品牌、品名、型号、规格尺寸、数量、条码和其他可辨文字。相同商品可能有不同规格，必须按图片分别返回，不能混合。产品形态只能从液体精华、湿巾、喷雾、泡沫、粉末、膏体、固体、套装、无法判断中选择；看不清时返回无法判断并降低置信度。输出JSON：{"productForm":"液体精华","useMethod":"免洗擦浴","targetObject":"猫狗","visualConfidence":0-100,"observations":[{"sourceIndex":0,"rawText":"按阅读顺序完整转写","brand":"","productName":"","model":"","specification":"","quantity":"","barcode":"","otherText":"","confidence":0-100}]}`
    const content:Array<Record<string,unknown>>=[{type:'text',text:prompt}]
    sourceImages.forEach((url,index)=>content.push({type:'text',text:`参考图 ${index+1}${labels[index]?`（${labels[index]}）`:''}`},{type:'image_url',image_url:{url}}))
    try{
      const parsed=await this.chat(content)
      if(process.env.CODEX_PACKAGE_OCR_DEBUG==='1')console.log('[package-ocr-debug]',JSON.stringify(parsed))
      const rows=Array.isArray(parsed.observations)?parsed.observations:Array.isArray(parsed.images)?parsed.images:Array.isArray(parsed.results)?parsed.results:[],fieldNames:ImagePackageTextField[]=['brand','productName','model','specification','quantity','barcode','otherText']
      const observations:ImagePackageTextObservation[]=rows.flatMap(row=>{if(!row||typeof row!=='object')return[];const item=row as Record<string,unknown>,sourceIndex=Math.floor(Number(item.sourceIndex));if(!Number.isInteger(sourceIndex)||sourceIndex<0||sourceIndex>=sourceImages.length)return[];const fields:Partial<Record<ImagePackageTextField,string>>={};for(const field of fieldNames){const value=String(item[field]||'').replace(/\s+/g,' ').trim();if(value)fields[field]=value}const rawText=String(item.rawText||'').trim();if(!rawText&&!Object.keys(fields).length)return[];return[{sourceIndex,rawText,fields,confidence:clampScore(item.confidence,0)}]})
      const normalized=(value:string)=>value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu,'')
      const conflicts=fieldNames.filter(field=>new Set(observations.map(item=>item.fields[field]||'').filter(Boolean).map(normalized)).size>1)
      const combinedText=observations.map(item=>`图${item.sourceIndex+1}：${item.rawText||Object.entries(item.fields).map(([key,value])=>`${key}=${value}`).join('；')}`).join('\n')
      const productForm=String(parsed.productForm||'').trim()
      const useMethod=String(parsed.useMethod||'').trim()
      const targetObject=String(parsed.targetObject||'').trim()
      const visualConfidence=clampScore(parsed.visualConfidence,0)
      const warnings=[...(!observations.length?['没有识别到可靠包装文字']:[]),...(conflicts.length?[`不同参考图存在字段冲突：${conflicts.join('、')}，必须人工选择正确规格`]:[]),...(observations.some(item=>item.confidence<70)?['部分包装文字识别置信度低于70%，必须人工核对']:[]),...(visualConfidence<70||!productForm||productForm==='无法判断'?['产品形态识别置信度不足，必须人工确认']:[])]
      return{model:this.model,observations,conflicts,combinedText,warnings,productForm,useMethod,targetObject,visualConfidence,analyzedAt}
    }catch(reason){return empty(`${reason instanceof Error?reason.message:'包装OCR失败'}；请人工填写包装原文`)}
  }

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
   - HERO（主图）：优先选带“主图/正面/商品全貌”标签的
   - PRODUCT（产品图）：优先选带“正面/细节/主图/侧面/材质/特写”标签的
   - PAIN_POINT（痛点图）：优先选带“痛点/问题/对比/安装”标签的
   - SCENE（场景图）：优先选带“场景/应用”标签的
5. 每个用途写一句简短的生成指令（purposeInstructions）

输出 JSON 格式：
{"productIdentity":"...","protectedAttributes":["..."],"verifiedFacts":["..."],"warnings":["..."],"sources":[{"sourceIndex":0,"roles":["HERO","PRODUCT"],"quality":"KEEP|IMPROVE|EXCLUDE"}],"purposeReferences":{"HERO":[0],"PRODUCT":[1],"PAIN_POINT":[2],"SCENE":[3]},"purposeInstructions":{"HERO":"...","PRODUCT":"...","PAIN_POINT":"...","SCENE":"..."}}`

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

  /** 为已保留原图批量预选用途角色；无 apiKey、无可用 http 图或模型失败时返回空 suggestions，由前端降级保留默认/人工角色。 */
  async suggestRoles(request: EbayImageRoleSuggestionRequest): Promise<EbayImageRoleSuggestionResult> {
    const sourceImages = [...new Set(request.sourceImages)].filter(url => /^https?:\/\//i.test(url)).slice(0, 12)
    if (!this.apiKey || !sourceImages.length) return { suggestions: {}, model: this.model }

    const prompt = `你是跨境电商商品图分类专家。
${request.title ? `商品标题：${request.title}\n` : ''}${request.productIdentity ? `商品主体：${request.productIdentity}\n` : ''}请为下面 ${sourceImages.length} 张原图各选择一个最合适的用途角色，角色定义：
- HERO（主图）：商品完整、正面居中展示，最能代表商品全貌
- FRONT（正面）：商品正面视角，但不是主图构图
- SIDE（侧面）：商品侧面视角
- BACK（背面）：商品背面视角
- DETAIL（细节）：材质、工艺、接缝、局部结构特写
- INSTALLATION（安装/结构）：安装方式、组装步骤、拆解结构或配件清单
- SIZE（尺寸参照）：带尺寸标注或比例参照物
- PAIN_POINT（痛点依据）：展示解决的问题、功能演示或使用依据
- SCENE（应用场景）：商品置于真实使用环境中

要求：每张图只输出一个角色；只能使用上述 9 个英文角色值；按图片序号输出 JSON，例如：
{"1":"HERO","2":"SIDE","3":"DETAIL"}`

    const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }]
    for (const [index, url] of sourceImages.entries()) {
      content.push({ type: 'text', text: `原图 ${index + 1}` }, { type: 'image_url', image_url: { url } })
    }

    try {
      const parsed = await this.chat(content)
      const entries = (parsed.suggestions && typeof parsed.suggestions === 'object' ? parsed.suggestions : parsed) as Record<string, unknown>
      const suggestions: Record<string, EbayImageSourceRoleSuggestion> = {}
      for (const [key, value] of Object.entries(entries)) {
        const index = Number(key) - 1
        const role = String(value || '').toUpperCase() as EbayImageSourceRoleSuggestion
        if (Number.isInteger(index) && index >= 0 && index < sourceImages.length && sourceRoleSuggestionValues.includes(role)) {
          suggestions[sourceImages[index]] = role
        }
      }
      return { suggestions, model: this.model }
    } catch {
      // 角色预选属于增强能力，失败时返回空建议，不阻塞主流程
      return { suggestions: {}, model: this.model }
    }
  }

  async reviewCandidate(request: EbayImageCandidateReviewRequest): Promise<EbayImageCandidateReview> {
    const sourceImages = uniqueImageUrls(request.sourceImages)
    const sourceLabels = request.sourceLabels || []
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

    // 智能截断：按角色偏好排序后取前 8 张，主图/产品图（HERO/PRODUCT）优先，与当前用途匹配度高的优先
    const rolePrefs = referenceRolePreferences[request.purpose] || []
    const refsRaw = request.referenceIndices
      .map((i, order) => ({ index: i, url: sourceImages[i], order, label: sourceLabels[i] || '' }))
      .filter(item => Boolean(item.url))
    const refsSorted = refsRaw
      .sort((a, b) => {
        const aPref = rolePrefs.findIndex(r => a.label.includes(r))
        const bPref = rolePrefs.findIndex(r => b.label.includes(r))
        const aScore = aPref === -1 ? 999 : aPref
        const bScore = bPref === -1 ? 999 : bPref
        return aScore - bScore || a.order - b.order
      })
      .slice(0, 8)
    // 按原始顺序还原，保证参照图顺序与前端一致
    const refsSelected = refsSorted.sort((a, b) => a.order - b.order).map(item => item.url!)

    if (!refsSelected.length) {
      return fallback('未找到对应的原图参照，需人工确认后采用。')
    }

    // 感知哈希预检：与任一已生成草稿（含跨用途对比图）像素级雷同时直接拦截，不再消耗一次视觉模型调用
    const comparisonUrls = (request.comparisonCandidateUrls || []).filter(u => /^https?:\/\//i.test(u)).slice(0, 8)
    const duplicate = await this.findNearDuplicate(request.candidateUrl, comparisonUrls)
    if (duplicate) {
      return {
        candidateUrl: request.candidateUrl,
        purpose: request.purpose,
        status: 'REJECTED',
        identityScore: 0,
        structuralScore: 0,
        factScore: 0,
        purposeScore: 0,
        diversityScore: 20,
        reason: `与已生成草稿像素级雷同（感知哈希距离 ${duplicate.distance}），已自动拦截。`,
        referenceIndices: request.referenceIndices
      }
    }

    // 简化版prompt — 降低截断风险；结构清点为强制步骤，防止幻觉结构通过审核
    const prompt = `你是商品图质量审核员。
商品标题：${request.title}
必须保留的特征：${request.protectedAttributes.join('；')}
关键事实：${request.verifiedFacts.join('；')}
本张图的镜头任务：${request.shotInstruction || request.purpose}

先展示原图参照，再展示AI候选图。按以下步骤强制执行：
第一步·结构清点：逐项列出所有原图参照中商品的可见结构部件（绑带、扣眼、缝线、拉链、标签、接缝、支撑结构、配件等）。
第二步·逐项核对候选图：列出 newStructures（候选图中出现、但任何一张原图角度都不存在的结构）与 missingStructures（原图关键结构在候选图中缺失）；两者都没有则输出空数组。只要 newStructures 非空，identityScore 不得高于 60。
第三步：判断候选图是否仍是同一个可售商品，并判断镜头任务完成度。
第四步·轮廓几何比对：即使拍摄角度与原图参照不同，也必须逐项判断候选图中产品的整体外形轮廓（silhouette/contour/弧形/曲线/外形线、凹凸起伏、边角弧度）是否与原图参照保持一致。如果候选图的产品外形/轮廓/几何形态与原图明显不同（例如枕头的弧形凹槽被压扁、整体外形线变化、曲面曲率差异明显、关键凸起/凹陷消失或位移），即使没有新增任何结构部件，也必须判定为轮廓失真。
第五步·包装文字逐字核对：先输出packageTextVisible。只要候选图展示商品包装，就必须将包装上的品牌、品名、型号、规格、数量、条码和说明文字与原图逐项比较，并输出packageTextScore。包装文字模糊成伪字、乱码、错字、改变品牌/规格/数量、混用不同参考图包装内容，均属于商品事实错误，packageTextScore和factScore不得高于60并必须REJECTED。不能因为文字属于“包装原文”就忽略其准确性；“允许保留包装原文”只表示不要求翻译，绝不允许改写或伪造。已人工确认的包装原文：${request.verifiedPackageTexts?.join('；')||'未提供；候选图若展示包装，只能进入人工复核，不能自动通过'}。
${request.styleInstruction?`第六步·风格命中检查：逐项检查候选图是否真实可见地满足以下 Style Lock，而不是仅出现相近背景色。Style Lock：${request.styleInstruction}`:''}
${request.targetLanguage?(request.baseImageNoMarketingText?`第七步·语言与底图检查：本图是后续正式排版使用的无营销文字底图。检查是否出现AI生成的标题、卖点、促销词、乱码或伪文字；这些内容出现时languageScore不得高于50。商品包装、商标和型号原文允许保持原样且必须与参照一致，不应被当作营销文字。后续排版目标语言为${request.targetLanguage}。`:`第七步·语言与排版检查：检查后期营销标题、卖点和说明是否使用${request.targetLanguage}且没有乱码、伪文字、截断或覆盖商品；商品包装、商标和型号原文允许保持原样但必须与参照一致。语言错误或排版破坏时languageScore不得高于50。`):''}
${comparisonUrls.length ? '同时与已生成候选图（含同用途与其他用途）对比，判断是否有足够差异。若候选图与任一对比图仅背景/光线/色调不同而镜头任务、拍摄角度、展示焦点相同，diversityScore 必须低于 40；与不同用途的对比图也必须保持构图、机位、景别的明显差异，不得拍成同一类画面。' : ''}

输出 JSON：
{"newStructures":["候选图新增的结构"],"missingStructures":["原图关键结构缺失"],"identityScore":0-100,"structuralScore":0-100,"factScore":0-100,"purposeScore":0-100,"diversityScore":0-100,"geometryScore":0-100,"styleScore":0-100,"languageScore":0-100,"packageTextVisible":false,"packageTextScore":0-100,"geometryMismatch":false,"status":"PASSED|REJECTED","reason":"简短原因"}

评分标准（任一项不达标即 REJECTED）：
- newStructures 必须为空：候选图不得出现原图不存在的结构
- geometryScore ≥ 80：产品外形/轮廓/几何形态一致性（从对应视角看必须与原图一致）
- 若 geometryMismatch 为 true（候选图产品外形/轮廓与原图明显不同），直接 REJECTED
- identityScore ≥ 80：商品一致性
- structuralScore ≥ 78：结构保留
- factScore ≥ 78：事实准确
- 包装文字必须与原图一致：出现伪字、乱码、错字、规格/数量/品牌变化时 factScore ≤ 60 并直接 REJECTED
- purposeScore ≥ 75：镜头任务完成度
${request.styleInstruction?'- styleScore ≥ 75：必须明显命中指定灯光、环境色、材质、构图和氛围；只有背景颜色接近但缺少风格特征不得通过':''}
${request.targetLanguage?(request.baseImageNoMarketingText?'- languageScore ≥ 80：不得出现AI生成的营销文字、乱码或伪文字；商品包装原文允许保留':`- languageScore ≥ 80：营销文案必须为${request.targetLanguage}且无乱码、截断、遮挡；商品包装原文允许保留`):''}
${comparisonUrls.length ? '- diversityScore ≥ 75：与其他已生成图（含不同用途）有足够差异（镜头任务、角度或焦点必须明显不同）' : ''}
全部达标则 PASSED，否则 REJECTED。不确定时输出 REVIEW。`

    const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }]
    for (const [i, url] of refsSelected.entries()) {
      content.push({ type: 'text', text: `原图参照 ${i + 1}` }, { type: 'image_url', image_url: { url } })
    }
    content.push({ type: 'text', text: 'AI 候选图' }, { type: 'image_url', image_url: { url: request.candidateUrl } })
    for (const [i, url] of comparisonUrls.entries()) {
      content.push({ type: 'text', text: `已生成候选图 ${i + 1}（同用途或其他用途）` }, { type: 'image_url', image_url: { url } })
    }

    try {
      const result = await this.chat(content)
      const identityScore = clampScore(result.identityScore, 0)
      const structuralScore = clampScore(result.structuralScore, 0)
      const factScore = clampScore(result.factScore, 0)
      const purposeScore = clampScore(result.purposeScore, 0)
      const hasComparisons = comparisonUrls.length > 0
      // 首张（无对比图）确实无从比较，按 100 计；有对比图时模型缺字段一律按 0 拦截
      const diversityScore = clampScore(result.diversityScore, hasComparisons ? 0 : 100)
      const toStructureList = (value: unknown) => Array.isArray(value) ? value.map(String).map(s => s.trim()).filter(Boolean).slice(0, 10) : []
      const newStructures = toStructureList(result.newStructures)
      const missingStructures = toStructureList(result.missingStructures)
      const geometryScore = clampScore(result.geometryScore, 0)
      const styleScore = request.styleInstruction?clampScore(result.styleScore,0):undefined
      const languageScore=request.targetLanguage?clampScore(result.languageScore,0):undefined
      const packageTextVisible=Boolean(result.packageTextVisible),packageTextScore=packageTextVisible?clampScore(result.packageTextScore,0):undefined
      const geometryMismatch = Boolean(result.geometryMismatch)

      // 与前端"自动质量门槛"展示一致的硬性阈值
      const passed = identityScore >= 80 && structuralScore >= 78 && factScore >= 78 &&
        purposeScore >= 75 && geometryScore >= 80 && (!hasComparisons || diversityScore >= 75) && (styleScore===undefined||styleScore>=75) && (languageScore===undefined||languageScore>=80)

      const requestedStatus = String(result.status || 'REVIEW').toUpperCase()
      let status: EbayImageCandidateReview['status'] = (requestedStatus === 'PASSED' && passed) ? 'PASSED' : 'REVIEW'
      let reason = String(result.reason || '视觉模型未提供具体原因。')
      // 结构清点一票否决：候选图出现原图不存在的结构时，无论分数多高都拦截；关键结构缺失时至少降为人工复核
      if (newStructures.length) {
        status = 'REJECTED'
        reason = `候选图出现原图不存在的结构：${newStructures.join('、')}。${reason}`
      } else if (missingStructures.length && status === 'PASSED') {
        status = 'REVIEW'
        reason = `原图关键结构在候选图中缺失：${missingStructures.join('、')}，需人工确认。${reason}`
      }
      if (geometryMismatch && status !== 'REJECTED') {
        status = 'REJECTED'
        reason = `候选图产品外形/轮廓与原图不一致：${(reason || '').replace(/^候选图出现原图不存在的结构：[^。]*[。]?/, '')}`.trim()
      }
      if(styleScore!==undefined&&styleScore<75&&status!=='REJECTED'){
        status=styleScore<55?'REJECTED':'REVIEW'
        reason=`Style Lock 命中不足（${styleScore}/100）：${reason}`
      }
      if(languageScore!==undefined&&languageScore<80&&status!=='REJECTED'){
        status=languageScore<60?'REJECTED':'REVIEW'
        reason=`无字底图/语言检查不足（${languageScore}/100）：${reason}`
      }
      if(packageTextVisible&&packageTextScore!==undefined&&packageTextScore<78){status='REJECTED';reason=`包装文字与原图不一致（${packageTextScore}/100）：${reason}`}
      else if(packageTextVisible&&!request.verifiedPackageTexts?.length&&status==='PASSED'){status='REVIEW';reason=`候选图包含包装文字，但商品事实卡没有已确认的包装原文，必须人工逐字复核。${reason}`}

      return {
        candidateUrl: request.candidateUrl,
        purpose: request.purpose,
        status,
        identityScore, structuralScore, factScore, purposeScore, diversityScore, geometryScore, styleScore,languageScore,packageTextVisible,packageTextScore,
        reason,
        referenceIndices: request.referenceIndices,
        newStructures,
        missingStructures,
        geometryMismatch
      }
    } catch (reason) {
      return fallback(`${reason instanceof Error ? reason.message : '视觉一致性检查失败'}；需人工确认后采用。`)
    }
  }

  /** 感知哈希比对：候选图与任一对比图汉明距离 ≤10（64 位）视为近重复；哈希失败降级为跳过。 */
  private async findNearDuplicate(candidateUrl: string, comparisonUrls: string[]) {
    if (!comparisonUrls.length) return null
    const candidateHash = await this.hashService.computeHash(candidateUrl)
    if (!candidateHash) return null
    for (const url of comparisonUrls) {
      const hash = await this.hashService.computeHash(url)
      if (!hash) continue
      const distance = this.hashService.hammingDistance(candidateHash, hash)
      if (distance <= 10) return { url, distance }
    }
    return null
  }

  // ─── 阶段式图片优化（新框架） ──────────────────────────────────────────────

  /** 为单个阶段生成事实卡 */
  async stageGround(request: EbayStageGroundingRequest): Promise<EbayStageFactCard> {
    const stageLabels: Record<EbayImageStage, string> = {
      HERO: '主图', PRODUCT: '产品图', PAIN_POINT: '痛点图', SCENE: '场景图', NATURALIZE: '自然化'
    }
    const stageLabel = stageLabels[request.stage] || request.stage
    const sourceImages = uniqueImageUrls(request.sourceImages)
    const sourceLabels = request.sourceLabels || []

    const fallback: EbayStageFactCard = {
      stage: request.stage,
      productIdentity: request.previousFactCard?.productIdentity || request.title || '待人工确认的商品主体',
      protectedAttributes: request.previousFactCard?.protectedAttributes || request.itemSpecifics.slice(0, 8).map(i => `${i.name}: ${i.value}`),
      verifiedFacts: request.previousFactCard?.verifiedFacts || [request.title].filter(Boolean),
      stageInstruction: `基于原图生成${stageLabel}。`,
      warnings: ['未能执行视觉分析，请人工确认事实卡内容。'],
      model: this.model,
      analyzedAt: new Date().toISOString()
    }

    if (!this.apiKey || !sourceImages.length) return fallback

    const productInfo = [
      `商品标题：${request.title}`,
      `商品属性：${request.itemSpecifics.map(i => `${i.name}=${i.value}`).join('；')}`,
      request.description ? `英文详情：${request.description.slice(0, 2000)}` : ''
    ].filter(Boolean).join('\n')

    const imageList = sourceImages.map((_, i) => `原图 ${i + 1}${sourceLabels[i] ? `（标签：${sourceLabels[i]}）` : ''}`).join('、')
    const inheritNote = request.previousFactCard
      ? `已有全局事实卡（商品主体：${request.previousFactCard.productIdentity}；保护属性：${request.previousFactCard.protectedAttributes.join('；')}），请在此基础上补充该阶段特有事实，不要重复全局信息。`
      : ''

    const prompt = `你是跨境电商商品图分析专家。
${productInfo}

可用原图：${imageList}
当前阶段：${stageLabel}（${request.stage}）
${inheritNote}

请分析：
1. 商品主体（productIdentity）— 真正出售的商品是什么
2. 保护属性（protectedAttributes）— 哪些商品特征绝对不能改变，每条必须用“英文；中文”中英对照格式（如 "Green color；绿色"）
3. 从原图中核实的事实（verifiedFacts）— 与${stageLabel}相关的具体事实，每条必须用“English sentence. 中文句子。”中英对照格式
4. 针对${stageLabel}的生成指令（stageInstruction）— 必须纯中文，一句话，不得出现任何英文单词
5. 警告（warnings）— 任何需要注意的问题，必须纯中文，不得出现任何英文单词

输出 JSON 格式：
{"productIdentity":"...","protectedAttributes":["英文；中文"],"verifiedFacts":["English. 中文。"],"stageInstruction":"纯中文指令","warnings":["纯中文警告"]}`

    const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }]
    for (const [index, url] of sourceImages.entries()) {
      content.push({ type: 'text', text: `原图 ${index + 1}` }, { type: 'image_url', image_url: { url } })
    }

    try {
      const parsed = await this.chat(content)
      return {
        stage: request.stage,
        productIdentity: String(parsed.productIdentity || fallback.productIdentity).slice(0, 500),
        protectedAttributes: Array.isArray(parsed.protectedAttributes) ? parsed.protectedAttributes.map(String).filter(Boolean).slice(0, 20) : fallback.protectedAttributes,
        verifiedFacts: Array.isArray(parsed.verifiedFacts) ? parsed.verifiedFacts.map(String).filter(Boolean).slice(0, 30) : fallback.verifiedFacts,
        stageInstruction: String(parsed.stageInstruction || fallback.stageInstruction).slice(0, 500),
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String).filter(Boolean).slice(0, 10) : [],
        model: this.model,
        analyzedAt: new Date().toISOString()
      }
    } catch (reason) {
      return {
        ...fallback,
        warnings: [`${reason instanceof Error ? reason.message : '视觉分析失败'}；已使用保守默认值，请人工核对。`]
      }
    }
  }

  /** 为单个阶段生成分镜卡：优先基于事实卡 AI 生成（内容与事实卡严格一致、不强制白底正面），失败时回退到事实卡驱动的确定性卡片 */
  async generateStageStoryboard(request: EbayStageStoryboardRequest): Promise<EbayStageStoryboardCard[]> {
    const stageLabels: Record<EbayImageStage, string> = {
      HERO: '主图', PRODUCT: '产品图', PAIN_POINT: '痛点图', SCENE: '场景图', NATURALIZE: '自然化'
    }
    const stageLabel = stageLabels[request.stage] || request.stage
    const count = Math.max(1, Math.min(8, request.count || 1))

    try {
      const aiCards = await this.storyboardFromFactCard(request, count, stageLabel)
      if (aiCards.length) return aiCards
    } catch {
      // AI 生成失败时回退到事实卡驱动的确定性卡片（同样不硬编码白底正面）
    }
    return this.storyboardFallbackCards(request, count, stageLabel)
  }

  /** 基于事实卡调用模型生成分镜卡（纯文本输入，不重复传原图；要求内容与事实卡一致、不强制白底） */
  private async storyboardFromFactCard(request: EbayStageStoryboardRequest, count: number, stageLabel: string): Promise<EbayStageStoryboardCard[]> {
    const factCard = request.factCard
    const prompt = `你是跨境电商商品摄影分镜策划专家。
商品：${request.title}
当前阶段：${stageLabel}（需生成 ${count} 个镜头）

事实卡（由原图分析得出，分镜内容必须与它严格一致）：
- 商品主体：${factCard.productIdentity}
- 保护属性：${factCard.protectedAttributes.join('；')}
- 已核实事实：${factCard.verifiedFacts.join('；')}
- 生成指令：${factCard.stageInstruction}

要求：
1. 恰好生成 ${count} 个分镜，每个分镜的标题、拍摄指令、验收标准都必须与事实卡的生成指令和已核实事实一致。
2. 不要强制“白底正面”构图，除非事实卡的生成指令明确要求白底；事实卡描述的是场景或使用画面时，分镜保留该场景。
3. 多个分镜之间要有差异（角度、重点或场景不同），不要雷同。
4. 全部使用中文，简洁。

输出 JSON 格式：
{"cards":[{"title":"...","instruction":"...","acceptance":"...","prohibited":"..."}]}`

    const parsed = await this.chat([{ type: 'text', text: prompt }])
    const rawCards = Array.isArray(parsed.cards) ? parsed.cards : []
    const cards = rawCards.slice(0, count).map((raw, i) => {
      const item = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
      return this.buildStoryboardCard(request.stage, i + 1, {
        title: String(item.title || `${stageLabel} ${i + 1}`),
        instruction: String(item.instruction || factCard.stageInstruction),
        acceptance: String(item.acceptance || '与事实卡生成指令一致，商品事实不改变'),
        prohibited: String(item.prohibited || '禁止改变商品事实、虚构文字与促销元素')
      }, factCard)
    })
    // AI 返回数量不足时用事实卡驱动卡片补齐到 count
    while (cards.length < count) {
      cards.push(this.fallbackCard(request.stage, cards.length + 1, stageLabel, factCard))
    }
    return cards
  }

  /** 事实卡驱动的确定性分镜卡（AI 失败时的回退，不硬编码白底正面） */
  private storyboardFallbackCards(request: EbayStageStoryboardRequest, count: number, stageLabel: string): EbayStageStoryboardCard[] {
    return Array.from({ length: count }, (_, i) => this.fallbackCard(request.stage, i + 1, stageLabel, request.factCard))
  }

  private fallbackCard(stage: EbayImageStage, index: number, stageLabel: string, factCard: EbayStageFactCard): EbayStageStoryboardCard {
    return this.buildStoryboardCard(stage, index, {
      title: index === 1 ? `${stageLabel}·按事实卡还原` : `${stageLabel}·不同角度或场景 ${index}`,
      instruction: factCard.stageInstruction || `按事实卡还原${stageLabel}`,
      acceptance: '与事实卡生成指令和已核实事实一致，商品事实不改变',
      prohibited: '禁止改变商品事实、虚构文字或促销元素'
    }, factCard)
  }

  private buildStoryboardCard(stage: EbayImageStage, index: number, fields: { title: string; instruction: string; acceptance: string; prohibited: string }, factCard: EbayStageFactCard): EbayStageStoryboardCard {
    return {
      id: `${stage}-${String(index).padStart(2, '0')}`,
      stage,
      index,
      title: fields.title,
      instruction: fields.instruction,
      referenceIndices: [],
      evidence: factCard.stageInstruction,
      acceptance: fields.acceptance,
      prohibited: fields.prohibited,
      userNote: ''
    }
  }

  /** 为单个阶段推荐 AI 生图模型 */
  async recommendStageModels(stage: EbayImageStage): Promise<EbayStageModelRecommendation> {
    // 基于各模型的 strengths 字段和阶段类型做简单匹配
    // 实际推荐数据由前端读取模型列表后展示，这里返回推荐逻辑说明
    const stageModelHints: Record<EbayImageStage, { preferredTraits: string; reason: string }> = {
      HERO: { preferredTraits: '高保真白底图、细节还原', reason: '主图需要最高保真度和商品一致性' },
      PRODUCT: { preferredTraits: '高保真白底图、细节特写、材质还原', reason: '产品图需要精确还原商品正面特征与材质工艺' },
      PAIN_POINT: { preferredTraits: '场景理解、叙事能力', reason: '痛点图需要理解问题场景并生成解决方案画面' },
      SCENE: { preferredTraits: '场景生成、环境融合', reason: '场景图需要将商品自然融入使用环境' },
      NATURALIZE: { preferredTraits: '纹理自然化', reason: '自然化处理使用本地算法' }
    }

    const hint = stageModelHints[stage]
    return {
      stage,
      recommendations: []  // 前端根据模型 strengths 自行排序，此字段保留扩展
    }
  }
}
