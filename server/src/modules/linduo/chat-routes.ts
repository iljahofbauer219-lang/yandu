/**
 * Linduo 聊天补全 SSE 端点（M1）：
 * - POST /api/linduo/chat
 *   request body  : { modelId: string, messages: Array<{role,content}> }
 *   response      : text/event-stream, 每个事件 data: <LinduoChatEvent JSON>\n\n
 *   错误码        : LINDUO_KEY_MISSING / LINDUO_KEY_INVALID / LINDUO_MODEL_NOT_FOUND
 *                   LINDUO_MODEL_NOT_GRANTED / LINDUO_MODEL_DISABLED
 *                   LINDUO_RATE_LIMITED / LINDUO_UPSTREAM_ERROR
 *
 * 鉴权:
 * - 当前用户必须对 modelId 有 grant（UserLinduoGrant），否则 403 LINDUO_MODEL_NOT_GRANTED
 * - 模型必须 enabled，否则 403 LINDUO_MODEL_DISABLED
 * - 不强制要求 isOwner —— 普通成员经管理员授权的模型也能用
 *
 * 客户端 abort 语义:
 * - request.raw.on('close'|'aborted') 触发 AbortController.abort()
 * - signal 透传给 LinduoChatService.streamChat，后者用 AbortSignal.any 合并 internal timeout
 * - 客户端断开后 generator 收到 abort，会从 fetch 抛出 → service yield { type: 'error', ... } → 我们不再写
 *   （因为 reply.raw 已 end/closed），直接 return。
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { LinduoChatService } from './chat-service.js'
import type { LinduoChatEvent } from './chat-service.js'

const chatSchema = z.object({
  modelId: z.string().min(1),
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string().min(1)
      })
    )
    .min(1)
    .max(64)
})

function sseHeaders(): Record<string, string> {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // 防止 nginx 反向代理缓冲,确保事件实时到达
    'X-Accel-Buffering': 'no'
  }
}

function writeSseEvent(raw: NodeJS.WritableStream, event: LinduoChatEvent): void {
  raw.write(`data: ${JSON.stringify(event)}\n\n`)
}

export async function linduoChatRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  app.post('/chat', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = chatSchema.parse(request.body)
    const userId = request.user.sub

    // 1) 查模型（modelId 是零度API 字符串，如 "gpt-4o"），拿 LinduoChatModel row（拿到 db id 给 grant 校验用）
    const model = await prisma.linduoChatModel.findUnique({ where: { modelId: body.modelId } })
    if (!model) {
      // 模型不在白名单 → 视作 404,但走 SSE 错误事件而非 4xx 响应,
      // 这样客户端能继续走标准的 SSE 错误处理路径
      reply.raw.writeHead(200, sseHeaders())
      writeSseEvent(reply.raw, { type: 'error', message: 'LINDUO_MODEL_NOT_FOUND' })
      reply.raw.end()
      return reply
    }
    if (!model.enabled) {
      reply.raw.writeHead(200, sseHeaders())
      writeSseEvent(reply.raw, { type: 'error', message: 'LINDUO_MODEL_DISABLED' })
      reply.raw.end()
      return reply
    }

    // 2) 校验 grant：当前用户对该 LinduoChatModel.id 有授权
    const grant = await prisma.userLinduoGrant.findUnique({
      where: { userId_modelId: { userId, modelId: model.id } }
    })
    if (!grant) {
      reply.raw.writeHead(200, sseHeaders())
      writeSseEvent(reply.raw, { type: 'error', message: 'LINDUO_MODEL_NOT_GRANTED' })
      reply.raw.end()
      return reply
    }

    // 3) 创建 service + AbortController
    let service: LinduoChatService
    try {
      service = LinduoChatService.fromConfig()
    } catch (err) {
      // LINDUO_KEY_MISSING（config 没配 LINDUO_API_KEY）
      request.log.error({ err }, '[linduo-chat] service init failed')
      reply.raw.writeHead(200, sseHeaders())
      writeSseEvent(reply.raw, {
        type: 'error',
        message: `LINDUO_KEY_MISSING${err instanceof Error && err.message ? `: ${err.message}` : ''}`
      })
      reply.raw.end()
      return reply
    }
    const controller = new AbortController()
    const onClose = () => {
      if (!controller.signal.aborted) controller.abort()
    }
    request.raw.on('close', onClose)
    request.raw.on('aborted', onClose)

    // 4) 写 200 + SSE 头
    reply.raw.writeHead(200, sseHeaders())
    // Fastify 看到我们直接操作 reply.raw，需要告诉它不要再包装响应
    reply.hijack()

    // 5) 迭代 generator，转写事件。过程中不做 try/catch 抛错(plan 要求不在流中间 throw)；
    //    service 内部已经 try/catch + yield error 事件。
    let clientGone = false
    try {
      for await (const event of service.streamChat({
        modelId: body.modelId,
        messages: body.messages,
        signal: controller.signal
      })) {
        if (clientGone) break
        // raw.write 失败 → 客户端已断，停止继续读
        try {
          writeSseEvent(reply.raw, event)
        } catch {
          clientGone = true
          controller.abort()
          break
        }
      }
    } finally {
      // 解绑 close 监听（防止 listener 累积）
      request.raw.off('close', onClose)
      request.raw.off('aborted', onClose)
      // 写 SSE 结束标记，让 fetch 端的 reader.read() 自然 done
      if (!clientGone) {
        try { reply.raw.end() } catch { /* 已经关了，忽略 */ }
      }
    }
    return reply
  })
}
