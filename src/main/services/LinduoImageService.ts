import type { ImageGenerationRequest, ImageGenerationResult, ImageModelConnection, ImageModelProfile } from '../../shared/contracts'

/**
 * 零度API（api000.com）生图服务。
 * 兼容 OpenAI /v1/images/generations 协议；由零度API 代理 OpenAI / Google / Anthropic / Vidu 等大模型。
 * 一个 Key 解锁 37 个模型（详见 LinduoModelMallPage 静态目录）。
 *
 * 注意：零度API 是国内聚合代理，自身已处理跨境访问；本服务直连 https://api000.com/v1 即可，
 * 不复用 IMAGE_PROXY_URL。
 */

/** 零度API 旗下生图模型元数据；模型 id 需与 api000.com /v1/models 探测返回一致 */
const supportedModels: Record<string, Omit<ImageModelProfile, 'id'>> = {
  'gpt-image-1': {
    name: 'GPT-Image-1',
    description: 'OpenAI gpt-image-1（经零度API 代理），纯文生图，文字渲染与细节表现俱佳',
    maxReferenceImages: 0,
    provider: 'linduo',
    strengths: '文字渲染·细节·创意构图',
    costLabel: '按量计费'
  },
  'gemini-2.5-flash-image-preview': {
    name: 'Gemini 2.5 Flash Image',
    description: 'Google Gemini 2.5 Flash 多模态生图（经零度API 代理），支持参照图',
    maxReferenceImages: 4,
    provider: 'linduo',
    strengths: '多模态·速度快·参照图',
    costLabel: '按量计费'
  },
  'imagen-4.0': {
    name: 'Imagen 4.0',
    description: 'Google Imagen 4.0（经零度API 代理），高质量商品图与品牌色控制',
    maxReferenceImages: 0,
    provider: 'linduo',
    strengths: '高质量·品牌色·主图',
    costLabel: '按量计费'
  }
}

const REQUEST_TIMEOUT_MS = 120_000

export class LinduoImageService {
  constructor(private readonly apiKey: string, private readonly baseUrl: string) {}

  /** 零度API 端点已含 /v1，去掉尾部斜杠避免拼接出重复路径 */
  private resolveHost(): string {
    return (this.baseUrl || 'https://api000.com/v1').replace(/\/+$/, '')
  }

  /**
   * 连接探测：调 /v1/models 返回 200 即认为 Key 有效；同时返回本服务已声明的生图模型元数据。
   * 探测失败不影响模型列表展示（沿用现有 VolcImageService.connection 的容错约定）。
   */
  async connection(): Promise<ImageModelConnection> {
    if (!this.apiKey) {
      return { connected: false, models: [], message: '未配置 LINDUO_API_KEY' }
    }
    const models = Object.entries(supportedModels).map(([id, profile]) => ({ id, ...profile }))
    try {
      const response = await fetch(`${this.resolveHost()}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(10_000)
      })
      if (!response.ok) {
        return {
          connected: false,
          models,
          message: `零度API 探测失败（HTTP ${response.status}），请检查 Key 与网络，但模型元数据仍展示`
        }
      }
      return {
        connected: true,
        models,
        message: `零度API 已连接 · ${models.length} 个生图模型可用`
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : '未知错误'
      return {
        connected: false,
        models,
        message: `零度API 探测异常：${detail}`
      }
    }
  }

  private resolveSize(size: string, modelId: string): string {
    // 与现有 ark/openai 行为保持一致：2K / 1K / 显式 WxH，否则按模型默认值
    if (size === '2K') return '1024x1024'
    if (size === '1K') return '1024x1024'
    if (/^\d+x\d+$/.test(size)) return size
    // Gemini Flash Image 默认支持 1024x1024；其它模型回退到 1024x1024
    return '1024x1024'
  }

  private dedupReferences(request: ImageGenerationRequest, limit: number): string[] {
    if (limit <= 0) return []
    const all = [...(request.referenceImageUrls || []), request.referenceImageUrl || '']
      .filter(url => Boolean(url) && /^(https?:\/\/|data:image\/(?:jpeg|png|webp);base64,)/i.test(url))
    return [...new Set(all)].slice(0, limit)
  }

  async generate(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    if (!this.apiKey) throw new Error('未配置 LINDUO_API_KEY')
    const profile = supportedModels[request.model]
    if (!profile) throw new Error(`未在零度API 生图模型目录中：${request.model}`)

    const endpoint = `${this.resolveHost()}/images/generations`
    const referenceLimit = profile.maxReferenceImages ?? 0
    const references = this.dedupReferences(request, referenceLimit)

    const body: Record<string, unknown> = {
      model: request.model,
      prompt: request.prompt,
      size: this.resolveSize(request.size, request.model),
      n: Math.max(1, Math.min(4, request.count)),
      response_format: 'url'
    }
    // 零度API 的 OpenAI 兼容层：参照图通过 image 字段（数组）传入，与火山方舟语义一致
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
      data?: Array<{ url?: string; b64_json?: string }>
      error?: { message?: string; code?: string }
      message?: string
    }
    if (!response.ok) {
      const detail = payload.error?.message || payload.message || payload.error?.code || response.statusText
      throw new Error(`${request.model} 零度API 生图失败（HTTP ${response.status}）：${detail}`)
    }

    const imageUrls = (payload.data || [])
      .map(item => item?.url || (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : ''))
      .filter(url => Boolean(url))
    if (imageUrls.length === 0) throw new Error(`${request.model} 零度API 生图失败：未返回图片结果`)

    return { taskId: `linduo-${Date.now()}`, imageUrls }
  }
}
