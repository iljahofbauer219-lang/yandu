// 零度API 聊天补全服务。
// 假定 api000.com 走 OpenAI Chat Completions 协议（与 LinduoImageService 一致）。
//
// M1 范围：
// - 仅纯文本对话
// - 不传 tools 字段
// - 不处理 vision message（即使 caller 传了图片描述，只发文本）
// - SSE 流式解析
//
// 错误码：
// - LINDUO_KEY_MISSING     未配置 LINDUO_API_KEY
// - LINDUO_KEY_INVALID     401 / 403
// - LINDUO_MODEL_NOT_FOUND 404 → 同步软关对应 modelId
// - LINDUO_RATE_LIMITED    429
// - LINDUO_UPSTREAM_ERROR  其他 5xx / 网络异常

import { config } from '../../config.js'
import { prisma } from '../../lib/prisma.js'

export type LinduoChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }
  | { type: 'error'; message: string }

export interface LinduoChatRequest {
  modelId: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  signal?: AbortSignal
}

export class LinduoChatService {
  private readonly apiKey: string
  private readonly baseUrl: string
  private static readonly TIMEOUT_MS = 120_000

  constructor(apiKey: string, baseUrl: string) {
    this.apiKey = apiKey
    this.baseUrl = (baseUrl || 'https://api000.com/v1').replace(/\/+$/, '')
  }

  /** 服务端单例获取：从 config 读 LINDUO_API_KEY / LINDUO_BASE_URL */
  static fromConfig(): LinduoChatService {
    const key = config.linduoApiKey
    const base = config.linduoBaseUrl
    if (!key) throw new Error('LINDUO_KEY_MISSING')
    return new LinduoChatService(key, base)
  }

  async *streamChat(request: LinduoChatRequest): AsyncGenerator<LinduoChatEvent> {
    const body = {
      model: request.modelId,
      messages: request.messages,
      stream: true,
      // 让 OpenAI 在最后一个 chunk 附带 usage（prompt/completion tokens），
      // 否则 done.usage 只能依赖 chunk 计数粗略估算（M1 已知限制）。
      stream_options: { include_usage: true }
      // M1 兜底：不传 tools
      // M1 兜底：不传 temperature/max_tokens，使用模型默认
    }

    // 同时尊重 caller signal + internal timeout，二者任一触发即 abort。
    // 用 AbortSignal.any 而非 `??`：caller 传了 AbortSignal 仍保有 120s 上限。
    const timeoutSignal = AbortSignal.timeout(LinduoChatService.TIMEOUT_MS)
    const combinedSignal = request.signal
      ? AbortSignal.any([request.signal, timeoutSignal])
      : timeoutSignal

    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: combinedSignal
      })
    } catch (err) {
      const detail = err instanceof Error ? err.message : '网络异常'
      yield { type: 'error', message: `LINDUO_UPSTREAM_ERROR: ${detail}` }
      return
    }

    if (response.status === 401 || response.status === 403) {
      yield { type: 'error', message: 'LINDUO_KEY_INVALID' }
      return
    }
    if (response.status === 404) {
      // 模型不存在 → 软关。失败仅 warn 留痕,不阻塞 caller 拿错误码。
      await this.softDisableModel(request.modelId).catch((err: unknown) => {
        console.warn('[linduo-chat] softDisableModel failed', {
          modelId: request.modelId,
          err: err instanceof Error ? err.message : String(err)
        })
      })
      yield { type: 'error', message: 'LINDUO_MODEL_NOT_FOUND' }
      return
    }
    if (response.status === 429) {
      yield { type: 'error', message: 'LINDUO_RATE_LIMITED' }
      return
    }
    if (!response.ok) {
      // 错误消息中 redact 任何形如 sk-xxx / Bearer xxx / 长 base64 的敏感串，
      // 并把上游 body 截断到 80 字避免泄漏内部堆栈/合作伙伴 key/用户 PII。
      // 完整 body 仅写 server log（调用方可另行抓取）。
      const rawText = await response.text().catch(() => '')
      const redacted = rawText
        .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, 'sk-***REDACTED***')
        .replace(/\bBearer\s+[A-Za-z0-9_.-]{16,}\b/gi, 'Bearer ***REDACTED***')
        .slice(0, 80)
      yield {
        type: 'error',
        message: `LINDUO_UPSTREAM_ERROR: HTTP ${response.status} ${redacted}`
      }
      return
    }

    if (!response.body) {
      yield { type: 'error', message: 'LINDUO_UPSTREAM_ERROR: empty body' }
      return
    }

    // SSE 解析
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let totalPrompt = 0
    let totalCompletion = 0
    let finishReason: string | null = null

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // 按 \n\n 切分事件
        let idx: number
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const event = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          const line = event.split('\n').find(l => l.startsWith('data:'))
          if (!line) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]') {
            finishReason = 'stop'
            continue
          }
          let parsed: any
          try {
            parsed = JSON.parse(data)
          } catch {
            continue
          }
          const choice = parsed?.choices?.[0]
          if (!choice) continue
          const delta = choice.delta?.content
          if (typeof delta === 'string' && delta.length > 0) {
            // chunk 计数；OpenAI 不带 usage 时的兜底估算。带 usage 的会下面被覆盖。
            totalCompletion += 1
            yield { type: 'delta', text: delta }
          }
          if (choice.finish_reason) finishReason = choice.finish_reason
          if (parsed.usage) {
            totalPrompt = parsed.usage.prompt_tokens ?? 0
            totalCompletion = parsed.usage.completion_tokens ?? 0
          }
        }
      }
      // 循环结束后 flush decoder，兜底 chunk 边界被切断的 UTF-8 多字节字符。
      buffer += decoder.decode()
    } catch (err) {
      const detail = err instanceof Error ? err.message : '流式读取失败'
      yield { type: 'error', message: `LINDUO_UPSTREAM_ERROR: ${detail}` }
      return
    } finally {
      try { reader.releaseLock() } catch {}
    }

    yield {
      type: 'done',
      usage: { promptTokens: totalPrompt, completionTokens: totalCompletion, totalTokens: totalPrompt + totalCompletion }
    }
    // finishReason 当前未透传,保留以备未来用
    void finishReason
  }

  private async softDisableModel(modelId: string): Promise<void> {
    await prisma.linduoChatModel.updateMany({
      where: { modelId },
      data: { enabled: false }
    })
  }
}
