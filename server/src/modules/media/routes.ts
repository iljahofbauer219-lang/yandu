/**
 * 媒体模块路由：
 * - POST   /api/media/uploads        服务端直传（local 驱动落盘；≤25MB，base64），权限 product.edit
 * - POST   /api/media/sign-upload    预签名上传 URL（OSS 客户端直传；local 返回 null 走服务端上传），权限 product.edit
 * - POST   /api/media/sign-download  预签名下载 URL（限本组织 key），登录即可
 * - DELETE /api/media/objects        删除对象（限本组织 key），权限 product.edit
 * - GET    /media/*                  公共下载（仅 local 驱动；HMAC 签名即授权，无需登录）
 */
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { writeAudit } from '../../lib/audit.js'
import { httpError } from '../../lib/errors.js'
import { createMediaStorage } from '../../lib/media/storage.js'
import { prisma } from '../../lib/prisma.js'

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
// base64 膨胀系数 4/3，25MB 二进制 ≈ 33.4MB base64
const MAX_BASE64_CHARS = 36_000_000

const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime'
])

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.mov': 'video/quicktime'
}

const prefixSchema = z.string().regex(/^[a-z0-9-]{1,40}$/, 'prefix 仅允许小写字母/数字/中划线').default('uploads')

const uploadSchema = z.object({
  fileName: z.string().min(1).max(200),
  contentType: z.string().min(3).max(100),
  dataBase64: z.string().min(8).max(MAX_BASE64_CHARS),
  prefix: prefixSchema
})

const signUploadSchema = z.object({
  fileName: z.string().min(1).max(200),
  prefix: prefixSchema,
  ttlSeconds: z.number().int().min(60).max(3600).default(600)
})

const signDownloadSchema = z.object({
  key: z.string().min(1).max(512),
  ttlSeconds: z.number().int().min(60).max(86400).default(3600)
})

/** 组织隔离的 key 生成：org-<orgId>/<prefix>/<uuid><ext>，扩展名净化 */
function buildKey(orgId: string, prefix: string, fileName: string): string {
  const ext = path.extname(fileName).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10)
  return `org-${orgId}/${prefix}/${randomUUID()}${ext}`
}

/** 只能操作本组织命名空间下的 key，防止跨组织签名/删除 */
function assertOrgKey(orgId: string, key: string): void {
  if (!key.startsWith(`org-${orgId}/`)) {
    throw httpError(403, 'FORBIDDEN', '只能访问本组织的媒体对象')
  }
}

function contentTypeOf(key: string): string {
  return CONTENT_TYPE_BY_EXT[path.extname(key).toLowerCase()] ?? 'application/octet-stream'
}

export async function mediaRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  const storage = createMediaStorage()

  app.post('/uploads', {
    bodyLimit: MAX_BASE64_CHARS + 4096,
    preHandler: [app.requirePermission('product.edit')]
  }, async request => {
    const body = uploadSchema.parse(request.body)
    if (!ALLOWED_CONTENT_TYPES.has(body.contentType)) {
      throw httpError(400, 'UNSUPPORTED_CONTENT_TYPE', `不支持的文件类型：${body.contentType}`)
    }
    const data = Buffer.from(body.dataBase64, 'base64')
    if (data.length === 0 || data.length > MAX_UPLOAD_BYTES) {
      throw httpError(400, 'INVALID_SIZE', '文件为空或超过 25MB 上限')
    }
    if (storage.driver !== 'local') {
      throw httpError(409, 'USE_SIGNED_UPLOAD', '当前存储驱动请使用 sign-upload 预签名直传')
    }
    const key = buildKey(request.currentUser.orgId, body.prefix, body.fileName)
    const result = await storage.put(key, data, body.contentType)
    await writeAudit(prisma, {
      orgId: request.currentUser.orgId,
      userId: request.currentUser.id,
      action: 'media.upload',
      targetType: 'media',
      targetId: key,
      detail: { size: result.size, contentType: body.contentType, fileName: body.fileName, driver: storage.driver },
      ip: request.ip
    })
    return { ...result, driver: storage.driver }
  })

  app.post('/sign-upload', { preHandler: [app.requirePermission('product.edit')] }, async request => {
    const body = signUploadSchema.parse(request.body)
    const key = buildKey(request.currentUser.orgId, body.prefix, body.fileName)
    const uploadUrl = storage.getUploadUrl(key, body.ttlSeconds)
    await writeAudit(prisma, {
      orgId: request.currentUser.orgId,
      userId: request.currentUser.id,
      action: 'media.sign-upload',
      targetType: 'media',
      targetId: key,
      detail: { fileName: body.fileName, driver: storage.driver },
      ip: request.ip
    })
    // uploadUrl 为 null 表示 local 驱动，客户端应走 POST /api/media/uploads
    return { key, uploadUrl, method: uploadUrl ? 'PUT' : null, driver: storage.driver }
  })

  app.post('/sign-download', async request => {
    const body = signDownloadSchema.parse(request.body)
    assertOrgKey(request.currentUser.orgId, body.key)
    const url = storage.getSignedUrl(body.key, body.ttlSeconds)
    return { url, expiresIn: body.ttlSeconds, driver: storage.driver }
  })

  app.delete('/objects', { preHandler: [app.requirePermission('product.edit')] }, async request => {
    const { key } = z.object({ key: z.string().min(1).max(512) }).parse(request.query)
    assertOrgKey(request.currentUser.orgId, key)
    await storage.remove(key)
    await writeAudit(prisma, {
      orgId: request.currentUser.orgId,
      userId: request.currentUser.id,
      action: 'media.remove',
      targetType: 'media',
      targetId: key,
      detail: { driver: storage.driver },
      ip: request.ip
    })
    return { ok: true, key }
  })
}

/** 公共下载路由（无需登录，签名即授权）。仅 local 驱动有效；OSS 对象由 CDN/OSS 直接承载 */
export async function mediaPublicRoutes(app: FastifyInstance) {
  const storage = createMediaStorage()

  app.get('/media/*', async (request, reply) => {
    if (storage.driver !== 'local' || !storage.verifyDownloadSignature || !storage.openReadStream) {
      throw httpError(404, 'NOT_FOUND', '媒体不存在')
    }
    const key = (request.params as { '*': string })['*']
    const query = z.object({
      expires: z.coerce.number().int(),
      signature: z.string().min(1).max(256)
    }).parse(request.query)
    if (!storage.verifyDownloadSignature(key, query.expires, query.signature)) {
      throw httpError(403, 'INVALID_SIGNATURE', '签名无效或已过期')
    }
    const opened = storage.openReadStream(key)
    if (!opened) {
      throw httpError(404, 'NOT_FOUND', '媒体不存在')
    }
    reply.header('content-type', contentTypeOf(key))
    reply.header('content-length', String(opened.size))
    reply.header('cache-control', 'private, max-age=60')
    return reply.send(opened.stream)
  })
}
