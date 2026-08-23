import { session } from 'electron'
import type { ImageGenerationRequest, ImageGenerationResult, ImageModelConnection, ImageModelProfile } from '../../shared/contracts'

/** OpenAI gpt-image-2 元数据：首版仅支持文生图（generations JSON 接口不接受参照图 URL），后续再接 edits 图生图 */
const supportedModels: Record<string, Omit<ImageModelProfile, 'id'>> = {
  'gpt-image-2': {
    name: 'GPT-Image-2',
    description: 'OpenAI 生图模型，痛点表达与创意构图突出；当前仅支持文生图，不支持参照商品原图',
    maxReferenceImages: 0,
    provider: 'openai',
    strengths: '痛点表达·创意构图·英文场景',
    costLabel: '¥0.04-1.5/张',
    requiresProxy: true
  }
}

const OPENAI_IMAGES_ENDPOINT = 'https://api.openai.com/v1/images/generations'
const PROXY_PARTITION = 'openai-image-proxy'
const REQUEST_TIMEOUT_MS = 120_000

export class OpenAIImageService {
  private proxyReady: Promise<void> | null = null

  constructor(private readonly apiKey: string, private readonly proxyUrl: string) {}

  async connection(): Promise<ImageModelConnection> {
    if (!this.apiKey) return { connected: false, models: [], message: '未配置 OPENAI_IMAGE_API_KEY' }
    const models = Object.entries(supportedModels).map(([id, profile]) => ({ id, ...profile }))
    const proxyHint = this.proxyUrl ? `代理 ${this.proxyUrl}` : '尚未配置 IMAGE_PROXY_URL，生成时将无法访问'
    return { connected: true, models, message: `OpenAI 已配置 · ${models.length} 个生图模型可用 · ${proxyHint}` }
  }

  /** 通过独立 session 走 IMAGE_PROXY_URL 代理请求 OpenAI；代理规则只需设置一次 */
  private async proxiedFetch(url: string, init: RequestInit): Promise<Response> {
    const proxySession = session.fromPartition(PROXY_PARTITION)
    if (!this.proxyReady) {
      const proxyRules = this.proxyUrl.replace(/^https?:\/\//i, '')
      this.proxyReady = proxySession.setProxy({ proxyRules })
    }
    await this.proxyReady
    return proxySession.fetch(url, init)
  }

  private resolveSize(size: string): string {
    if (size === '2K') return '1536x1024'
    if (size === '1K') return '1024x1024'
    if (/^\d+x\d+$/.test(size)) return size
    return '1024x1024'
  }

  async generate(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    if (!this.apiKey) throw new Error('未配置 OPENAI_IMAGE_API_KEY')
    if (!supportedModels[request.model]) throw new Error('请选择可用的 OpenAI 生图模型')
    if (!this.proxyUrl) throw new Error('GPT-Image-2 需要代理访问：请在 .env.local 配置 IMAGE_PROXY_URL（如 http://127.0.0.1:7890）')

    const body = {
      model: request.model,
      prompt: request.prompt,
      n: Math.max(1, Math.min(4, request.count)),
      size: this.resolveSize(request.size)
    }

    let response: Response
    try {
      response = await this.proxiedFetch(OPENAI_IMAGES_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`无法连接 OpenAI：请确认 IMAGE_PROXY_URL（${this.proxyUrl}）代理可用。原始错误：${detail}`)
    }

    const payload = await response.json().catch(() => ({})) as {
      data?: Array<{ url?: string; b64_json?: string }>
      error?: { message?: string; code?: string }
    }
    if (!response.ok) {
      const detail = payload.error?.message || payload.error?.code || response.statusText
      throw new Error(`${request.model} 生图失败（HTTP ${response.status}）：${detail}`)
    }

    const imageUrls = (payload.data || [])
      .map(item => item?.url || (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : ''))
      .filter(url => Boolean(url))
    if (imageUrls.length === 0) throw new Error(`${request.model} 生图失败：API未返回图片结果`)

    return { taskId: `openai-${Date.now()}`, imageUrls }
  }
}
