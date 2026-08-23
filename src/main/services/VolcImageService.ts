import type { ImageGenerationRequest, ImageGenerationResult, ImageModelConnection, ImageModelProfile } from '../../shared/contracts'

/** 火山方舟 Seedream 生图模型元数据（OpenAI 兼容 images/generations 接口） */
const supportedModels: Record<string, Omit<ImageModelProfile, 'id'>> = {
  'doubao-seedream-5-0-pro-260628': {
    name: 'Seedream 5.0 Pro',
    description: '火山方舟旗舰生图模型，商品一致性与细节表现俱佳，参照图上限10张',
    maxReferenceImages: 10,
    provider: 'volc',
    strengths: '商品主图·细节还原·全场景适用',
    costLabel: '¥0.30/张'
  },
  'doubao-seedream-5-0-260128': {
    name: 'Seedream 5.0 Lite',
    description: '火山方舟高性价比生图模型，质量接近 Pro 且成本更低，参照图上限10张',
    maxReferenceImages: 10,
    provider: 'volc',
    strengths: '高性价比·质量接近Pro·速度快',
    costLabel: '¥0.22/张'
  }
}

const REQUEST_TIMEOUT_MS = 120_000

export class VolcImageService {
  constructor(private readonly apiKey: string, private readonly baseUrl: string) {}

  /** ARK_BASE_URL 已含 /api/v3，去掉尾部斜杠避免拼接出重复路径 */
  private resolveHost(): string {
    const base = (this.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '')
    return base
  }

  async connection(): Promise<ImageModelConnection> {
    if (!this.apiKey) return { connected: false, models: [], message: '未配置火山方舟 ARK_API_KEY' }
    const models = Object.entries(supportedModels).map(([id, profile]) => ({ id, ...profile }))
    return { connected: true, models, message: `火山方舟已配置 · ${models.length} 个 Seedream 生图模型可用` }
  }

  private resolveSize(size: string): string {
    if (size === '2K') return '2048x2048'
    // Seedream 5.0 currently requires at least 3,686,400 output pixels.
    // Keep the shared UI's compact "1K" quality option, but map it to the
    // smallest safe square output accepted by the provider.
    if (size === '1K') return '2048x2048'
    if (/^\d+x\d+$/.test(size)) return size
    return '1024x1024'
  }

  private dedupReferences(request: ImageGenerationRequest, limit: number): string[] {
    const all = [...(request.referenceImageUrls || []), request.referenceImageUrl || '']
      .filter(url => Boolean(url) && /^(https?:\/\/|data:image\/(?:jpeg|png|webp);base64,)/i.test(url))
    return [...new Set(all)].slice(0, limit)
  }

  async generate(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    if (!this.apiKey) throw new Error('未配置火山方舟 ARK_API_KEY')
    const profile = supportedModels[request.model]
    if (!profile) throw new Error('请选择可用的火山方舟 Seedream 生图模型')

    const endpoint = `${this.resolveHost()}/images/generations`
    const referenceLimit = profile.maxReferenceImages ?? 0
    const references = referenceLimit > 0 ? this.dedupReferences(request, referenceLimit) : []

    const body: Record<string, unknown> = {
      model: request.model,
      prompt: request.prompt,
      size: this.resolveSize(request.size),
      n: Math.max(1, Math.min(4, request.count)),
      response_format: 'url',
      watermark: false
    }
    if (references.length > 0) body.image = references

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })

    const payload = await response.json().catch(() => ({})) as {
      data?: Array<{ url?: string }>
      error?: { message?: string; code?: string }
      message?: string
    }
    if (!response.ok) {
      const detail = payload.error?.message || payload.message || payload.error?.code || response.statusText
      throw new Error(`${request.model} 生图失败（HTTP ${response.status}）：${detail}`)
    }

    const imageUrls = (payload.data || [])
      .map(item => item?.url)
      .filter((url): url is string => typeof url === 'string' && /^https?:\/\//i.test(url))
    if (imageUrls.length === 0) throw new Error(`${request.model} 生图失败：API未返回图片结果`)

    return { taskId: `volc-${Date.now()}`, imageUrls }
  }
}
