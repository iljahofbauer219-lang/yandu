import type { ImageGenerationRequest, ImageGenerationResult, ImageModelConnection, ImageModelProfile } from '../../shared/contracts'

const supportedModels: Record<string, Omit<ImageModelProfile, 'id'>> = {
  'wan2.7-image-pro': { name: '万相 2.7 Pro', description: '高质量商品图、文字与品牌色控制，参照图上限8张' },
  'wan2.7-image': { name: '万相 2.7', description: '质量与生成速度平衡，参照图上限8张' },
  'qwen-image-2.0-pro': { name: '千问 Image 2.0 Pro', description: '文字渲染与复杂指令表现更强，参照图上限3张' },
  'qwen-image-2.0': { name: '千问 Image 2.0', description: '快速生成与图片编辑' },
  'qwen-image-edit-plus': { name: '千问 Image Edit Plus', description: '多图参照编辑，适合保持商品结构与材质' },
  'qwen-image-edit-max': { name: '千问 Image Edit Max', description: '高保真多图编辑，适合复杂商品细节' },
  'z-image-turbo': { name: 'Z-Image Turbo', description: '快速低成本，适合写实商品图' }
}

const NEGATIVE_PROMPT = 'Do not change the referenced product identity, structure, proportions, color, material, included accessories, packaging, logo, text, measurement labels, or verified facts. No watermark, promotional badge, border, invented parts, invented claims, distorted geometry, or AI artifacts.'

/** 通用的内容提取工具：从 choices 中提取 image URL */
function extractImageUrls(choices: unknown): string[] {
  if (!Array.isArray(choices)) return []
  const urls: string[] = []
  for (const choice of choices) {
    const msg = (choice as Record<string, unknown>)?.message as Record<string, unknown> | undefined
    if (!msg) continue
    const content = msg.content
    if (Array.isArray(content)) {
      for (const item of content) {
        const img = (item as Record<string, unknown>)?.image
        if (typeof img === 'string' && /^https?:\/\//i.test(img)) urls.push(img)
      }
    }
    // 某些模型 content 可能直接是字符串
    if (typeof content === 'string' && /^https?:\/\//i.test(content)) {
      urls.push(content)
    }
  }
  return urls
}

/** 从 results 中提取图片 URL（异步模式） */
function extractResultUrls(results: unknown): string[] {
  if (!Array.isArray(results)) return []
  return results
    .map(r => (r as Record<string, unknown>)?.url)
    .filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))
}

/** 轮询异步任务直到完成 */
async function pollTask(host: string, taskId: string, apiKey: string): Promise<string[]> {
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  const pollUrl = `${host}/api/v1/tasks/${taskId}`
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const resp = await fetch(pollUrl, { headers })
    if (!resp.ok) continue
    const data = await resp.json() as { output?: Record<string, unknown> }
    const output = data.output || {}
    const status = (output.task_status as string) || ''
    if (status === 'FAILED') {
      throw new Error(`生图失败：${(output.message as string) || '未知错误'}`)
    }
    if (status === 'SUCCEEDED' || status === 'SUCCESS') {
      const urls = [
        ...extractImageUrls(output.choices),
        ...extractResultUrls(output.results)
      ]
      if (urls.length > 0) return urls
    }
  }
  throw new Error('生图等待超时')
}

export class BailianImageService {
  constructor(private readonly apiKey: string, private readonly baseUrl: string) {}

  async connection(): Promise<ImageModelConnection> {
    if (!this.apiKey) return { connected:false, models:[], message:'未配置百炼 API Key' }
    const response = await fetch(`${this.baseUrl}/models`, { headers:{ Authorization:`Bearer ${this.apiKey}` } })
    const payload = await response.json() as { data?: { id: string }[]; error?: { message?: string }; message?: string }
    if (!response.ok) throw new Error(payload.error?.message || payload.message || `百炼连接失败（HTTP ${response.status}）`)
    const available = new Set((payload.data || []).map(item => item.id))
    const models = Object.entries(supportedModels).filter(([id]) => available.has(id)).map(([id, profile]) => ({ id, ...profile }))
    return { connected:true, models, message:`百炼已连接 · ${models.length} 个生图模型可用` }
  }

  private resolveSize(size: string): string {
    if (size === '2K') return '2048*2048'
    if (size === '1K') return '1024*1024'
    if (/^\d+\*\d+$/.test(size)) return size
    return '1024*1024'
  }

  private dedupReferences(request: ImageGenerationRequest, limit: number): string[] {
    const all = [...(request.referenceImageUrls || []), request.referenceImageUrl || '']
      .filter(url => Boolean(url) && /^https?:\/\//i.test(url))
    return [...new Set(all)].slice(0, limit)
  }

  async generate(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    if (!this.apiKey) throw new Error('未配置百炼 API Key')
    if (!supportedModels[request.model]) throw new Error('请选择可用的百炼生图模型')

    const host = this.baseUrl.replace(/\/compatible-mode\/v1\/?$/, '')
    const isQwenImage = request.model.startsWith('qwen-image')
    const isWan = request.model.startsWith('wan2.7')
    const isZImage = request.model === 'z-image-turbo'

    // 选择正确的 endpoint：
    // - 多模态生成（同步返回图片）：qwen-image*, z-image-turbo
    // - 图片生成（异步返回task_id）：wan2.7*
    const isMultimodal = isQwenImage || isZImage
    const endpoint = isMultimodal
      ? `${host}/api/v1/services/aigc/multimodal-generation/generation`
      : `${host}/api/v1/services/aigc/image-generation/generation`

    const resolvedSize = this.resolveSize(request.size)
    const count = Math.max(1, Math.min(isQwenImage ? 6 : 4, request.count))
    const referenceLimit = isWan ? 8 : (isQwenImage ? 3 : 1)
    const references = this.dedupReferences(request, referenceLimit)

    // 构建 content 数组
    const content: Array<Record<string, unknown>> = []
    // 参考图仅支持 qwen-image 和 wan
    if ((isQwenImage || isWan) && references.length > 0) {
      for (const url of references) content.push({ image: url })
    }
    content.push({ text: request.prompt })

    // 构建 parameters
    const parameters: Record<string, unknown> = {
      size: resolvedSize,
      n: count,
      watermark: false
    }
    // prompt_extend 和 negative_prompt：qwen-image 和 wan 支持，z-image-turbo 不支持
    if (!isZImage) {
      parameters.prompt_extend = request.promptExtend ?? true
      parameters.negative_prompt = NEGATIVE_PROMPT
    }

    const baseHeaders = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    }

    // === 多模态生成（同步） ===
    if (isMultimodal) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: baseHeaders,
        body: JSON.stringify({
          model: request.model,
          input: { messages: [{ role: 'user', content }] },
          parameters
        })
      })
      const result = await response.json() as Record<string, unknown>
      const output = result?.output as Record<string, unknown> | undefined
      const imageUrls = extractImageUrls(output?.choices)
      if (!response.ok || imageUrls.length === 0) {
        const detail = (result.message as string) || (result.code as string) || JSON.stringify(output || '接口没有返回图片')
        throw new Error(`${request.model} 生图失败（HTTP ${response.status}）：${detail}`)
      }
      return { taskId: `sync-${Date.now()}`, imageUrls }
    }

    // === Wan 生图（异步+轮询） ===
    const bodyPayload = {
      model: request.model,
      input: { messages: [{ role: 'user', content }] },
      parameters
    }

    // 先尝试异步
    const asyncResp = await fetch(endpoint, {
      method: 'POST',
      headers: { ...baseHeaders, 'X-DashScope-Async': 'enable' },
      body: JSON.stringify(bodyPayload)
    })

    if (asyncResp.ok) {
      const asyncData = await asyncResp.json() as Record<string, unknown>
      const output = asyncData?.output as Record<string, unknown> | undefined
      const taskId = output?.task_id as string | undefined
      if (taskId) {
        const imageUrls = await pollTask(host, taskId, this.apiKey)
        return { taskId, imageUrls }
      }
    }

    // 异步失败，回退同步
    const syncResp = await fetch(endpoint, {
      method: 'POST',
      headers: baseHeaders,
      body: JSON.stringify(bodyPayload)
    })

    if (!syncResp.ok) {
      const errData = await syncResp.json().catch(() => ({})) as Record<string, unknown>
      throw new Error(`${request.model} 生图失败（HTTP ${syncResp.status}）：${(errData.message as string) || (errData.code as string) || syncResp.statusText}`)
    }

    const syncData = await syncResp.json() as Record<string, unknown>
    const output = syncData?.output as Record<string, unknown> | undefined

    // 同步响应可能直接有结果
    const urls = [
      ...extractImageUrls(output?.choices),
      ...extractResultUrls(output?.results)
    ]
    if (urls.length > 0) return { taskId: `sync-${Date.now()}`, imageUrls: urls }

    // 同步响应返回 task_id
    const syncTaskId = output?.task_id as string | undefined
    if (syncTaskId) {
      const imageUrls = await pollTask(host, syncTaskId, this.apiKey)
      return { taskId: syncTaskId, imageUrls }
    }

    throw new Error(`${request.model} 生图失败：API未返回图片结果`)
  }
}

export { NEGATIVE_PROMPT }
