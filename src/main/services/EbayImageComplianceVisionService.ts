import fs from 'node:fs/promises'
import type { EbayImageVisualImageResult, EbayImageVisualInspectionReport, EbayImageVisualResultStatus, EbayImageVisualRuleCode, EbayImageVisualRuleResult, EbayLocalProductMedia } from '../../shared/contracts'
import { EBAY_COMPLIANCE_KNOWLEDGE_VERSION } from '../../shared/ebayComplianceKnowledge'

/** eBay 图片视觉规则（新增 RESOLUTION 规则） */
const labels: Record<EbayImageVisualRuleCode, string> = {
  PRODUCT_ACCURACY: '商品呈现准确',
  NO_BORDER: '无额外边框',
  NO_ADDED_TEXT: '无附加文字或营销图形',
  NO_WATERMARK: '无水印'
}

type ModelRule = { status?: string; confidence?: number; evidence?: string }
type ModelImage = {
  index?: number
  productAccuracy?: ModelRule
  noBorder?: ModelRule
  noAddedText?: ModelRule
  noWatermark?: ModelRule
  summary?: string
}

function normalizedStatus(value: unknown): EbayImageVisualResultStatus {
  const status = String(value || '').toUpperCase()
  if (status === 'PASS' || status === 'PASSED') return 'PASSED'
  if (status === 'FAIL' || status === 'FAILED' || status === 'BLOCKED') return 'FAILED'
  return 'REVIEW'
}

function normalizedConfidence(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0
}

function overallStatus(rules: EbayImageVisualRuleResult[]): EbayImageVisualResultStatus {
  if (rules.some(r => r.status === 'FAILED')) return 'FAILED'
  if (rules.some(r => r.status === 'REVIEW')) return 'REVIEW'
  return 'PASSED'
}

function fallbackImage(media: EbayLocalProductMedia, summary: string): EbayImageVisualImageResult {
  const rules = (Object.keys(labels) as EbayImageVisualRuleCode[]).map(rule => ({
    rule,
    label: labels[rule],
    status: 'REVIEW' as const,
    confidence: 0,
    evidence: summary
  }))
  return { mediaId: media.id, sortOrder: media.sortOrder, status: 'REVIEW', summary, rules }
}

/**
 * 从 LLM 响应中提取第一个完整的 JSON 对象（支持嵌套大括号）。
 */
function extractJson(text: string) {
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
        try { return JSON.parse(cleaned.slice(start, i + 1)) as { images?: ModelImage[] } }
        catch { start = -1 }
      }
    }
  }
  throw new Error('视觉模型没有返回可解析的结构化结果')
}

/** 检查图片分辨率和宽高比是否符合 eBay 基本要求 */
function checkResolution(media: EbayLocalProductMedia): EbayImageVisualRuleResult[] {
  const results: EbayImageVisualRuleResult[] = []
  const longEdge = Math.max(media.width, media.height)
  const shortEdge = Math.min(media.width, media.height)

  // eBay 要求：最长边至少 500px，建议 1600px 以上
  if (longEdge < 500) {
    results.push({
      rule: 'PRODUCT_ACCURACY' as EbayImageVisualRuleCode,
      label: '图片分辨率',
      status: 'FAILED',
      confidence: 1,
      evidence: `图片最长边仅 ${longEdge}px，低于 eBay 要求的最低 500px`
    })
  } else if (longEdge < 1000) {
    results.push({
      rule: 'PRODUCT_ACCURACY' as EbayImageVisualRuleCode,
      label: '图片分辨率',
      status: 'REVIEW',
      confidence: 0.85,
      evidence: `图片最长边 ${longEdge}px，建议提升至 1600px 以上以获得更好的搜索排名`
    })
  }

  // 宽高比检查：应在 1:1 附近，不要过于极端
  if (shortEdge > 0 && longEdge / shortEdge > 3) {
    results.push({
      rule: 'PRODUCT_ACCURACY' as EbayImageVisualRuleCode,
      label: '图片宽高比',
      status: 'REVIEW',
      confidence: 0.9,
      evidence: `图片宽高比 ${Math.round(longEdge / shortEdge * 10) / 10}:1，建议裁剪为接近 1:1`
    })
  }

  return results
}

export class EbayImageComplianceVisionService {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly model: string
  ) {}

  private async imageContent(media: EbayLocalProductMedia) {
    const maxBase64RawBytes = 7 * 1024 * 1024
    if (media.localPath && media.fileSize > 0 && media.fileSize <= maxBase64RawBytes) {
      const data = await fs.readFile(media.localPath)
      return `data:${media.mimeType || 'image/jpeg'};base64,${data.toString('base64')}`
    }
    if (/^https?:\/\//i.test(media.remoteUrl)) return media.remoteUrl
    throw new Error('图片过大且没有可访问的原始网址')
  }

  async inspect(
    title: string,
    media: EbayLocalProductMedia[]
  ): Promise<EbayImageVisualInspectionReport> {
    const checkedAt = new Date().toISOString()
    const downloaded = media
      .filter(item => item.downloadStatus === 'DOWNLOADED')
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .slice(0, 24)

    if (!downloaded.length) {
      return {
        checkedAt, model: this.model, ruleSetVersion: EBAY_COMPLIANCE_KNOWLEDGE_VERSION,
        status: 'REVIEW', checkedImageCount: 0, passed: 0, failed: 0, review: 0,
        message: '没有可供视觉检查的本地图片。', images: []
      }
    }

    if (!this.apiKey) {
      return {
        checkedAt, model: this.model, ruleSetVersion: EBAY_COMPLIANCE_KNOWLEDGE_VERSION,
        status: 'REVIEW', checkedImageCount: downloaded.length, passed: 0, failed: 0,
        review: downloaded.length,
        message: '未配置百炼视觉模型，全部图片需人工复核。',
        images: downloaded.map(item => fallbackImage(item, '视觉模型未配置，未自动作出通过结论。'))
      }
    }

    const imageResults: EbayImageVisualImageResult[] = []

    for (let offset = 0; offset < downloaded.length; offset += 6) {
      const chunk = downloaded.slice(offset, offset + 6)
      const content: Array<Record<string, unknown>> = [{
        type: 'text',
        text: `商品标题：${title}\n以下图片按编号检查。`
      }]
      const accepted: EbayLocalProductMedia[] = []

      for (const item of chunk) {
        try {
          const url = await this.imageContent(item)
          content.push(
            { type: 'text', text: `图片 ${item.sortOrder + 1}` },
            { type: 'image_url', image_url: { url } }
          )
          accepted.push(item)
        } catch (reason) {
          imageResults.push(
            fallbackImage(item, reason instanceof Error ? reason.message : '图片无法提交视觉模型')
          )
        }
      }

      if (!accepted.length) continue

      content.push({
        type: 'text',
        text: `你是 eBay 图片政策检查器，只判断以下四条规则，不评价美观或营销效果：
1. productAccuracy：图片是否与商品标题呈现同一商品
2. noBorder：整张图片外围是否没有人为添加的边框
3. noAddedText：是否没有卖家后加的促销文字或营销图形
4. noWatermark：是否没有覆盖在画面上的水印

每条返回 PASS/FAIL/REVIEW。只有清楚看到证据才 FAIL；不确定必须 REVIEW。
confidence 0-1。evidence 用简短中文说明。

输出 JSON 格式：
{"images":[{"index":图片编号,"productAccuracy":{"status":"PASS|FAIL|REVIEW","confidence":0.0,"evidence":""},"noBorder":{},"noAddedText":{},"noWatermark":{},"summary":""}]}`
      })

      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 90000)
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
        ).finally(() => clearTimeout(timeout))

        const payload = await response.json() as {
          choices?: { message?: { content?: string } }[]
          error?: { message?: string }
          message?: string
        }
        if (!response.ok) {
          throw new Error(payload.error?.message || payload.message || `视觉检查失败（HTTP ${response.status}）`)
        }

        const parsed = extractJson(payload.choices?.[0]?.message?.content || '')

        for (const item of accepted) {
          const modelResult = parsed.images?.find(
            (entry: ModelImage) => Number(entry.index) === item.sortOrder + 1
          )

          if (!modelResult) {
            imageResults.push(fallbackImage(item, '视觉模型未返回这张图片的结果，需人工复核。'))
            continue
          }

          // 基础视觉规则检查
          const rulePairs: [EbayImageVisualRuleCode, ModelRule | undefined][] = [
            ['PRODUCT_ACCURACY', modelResult.productAccuracy],
            ['NO_BORDER', modelResult.noBorder],
            ['NO_ADDED_TEXT', modelResult.noAddedText],
            ['NO_WATERMARK', modelResult.noWatermark]
          ]

          const rules = rulePairs.map(([rule, result]) => {
            const confidence = normalizedConfidence(result?.confidence)
            const modelStatus = normalizedStatus(result?.status)
            // 置信度≥0.7才自动判定，否则REVIEW
            const status: EbayImageVisualResultStatus =
              confidence >= 0.7 ? modelStatus : 'REVIEW'
            const evidence = String(result?.evidence || '模型未提供明确证据，需人工复核。')
            return {
              rule,
              label: labels[rule],
              status,
              confidence,
              evidence:
                status === 'REVIEW' && modelStatus !== 'REVIEW'
                  ? `${evidence}（置信度 ${Math.round(confidence * 100)}%，未自动判定。）`
                  : evidence
            }
          })

          // 额外分辨率检查
          const resolutionRules = checkResolution(item)
          rules.push(...resolutionRules)

          const status = overallStatus(rules)
          imageResults.push({
            mediaId: item.id,
            sortOrder: item.sortOrder,
            status,
            summary: String(
              modelResult.summary ||
              rules.find(r => r.status !== 'PASSED')?.evidence ||
              '四项视觉规则已检查。'
            ),
            rules
          })
        }
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : '视觉模型检查失败'
        imageResults.push(
          ...accepted.map(item => fallbackImage(item, `${message}；未自动作出通过结论。`))
        )
      }
    }

    imageResults.sort((a, b) => a.sortOrder - b.sortOrder)
    const failed = imageResults.filter(i => i.status === 'FAILED').length
    const review = imageResults.filter(i => i.status === 'REVIEW').length
    const passed = imageResults.filter(i => i.status === 'PASSED').length
    const status: EbayImageVisualResultStatus = failed ? 'FAILED' : review ? 'REVIEW' : 'PASSED'

    return {
      checkedAt,
      model: this.model,
      ruleSetVersion: EBAY_COMPLIANCE_KNOWLEDGE_VERSION,
      status,
      checkedImageCount: imageResults.length,
      passed, failed, review,
      message: failed
        ? `${failed} 张图片发现 eBay 视觉规则问题。`
        : review
          ? `${review} 张图片需要人工复核。`
          : '全部图片通过四项 eBay 视觉规则检查。',
      images: imageResults
    }
  }
}
