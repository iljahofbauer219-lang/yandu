/**
 * AI 资产转存端点（AI 生成图 / AI 生成视频永久托管）：
 * 桌面端在「确认并存入优品仓库」与 15 秒视频生成成功这两个最终保存时刻，
 * 把临时 URL / 本地文件字节上传至此处，换回 /ai-assets/{id}/{name} 永久 URL，
 * 使优品草稿与发布任务不再持有会过期的签名 OSS 链接或仅存本地的路径。
 *
 * 安全边界：与 /api/* 同源（nginx location / 反代 127.0.0.1:8787），公开托管沿用产品页的
 * CSP+sandbox 安全头；id 由服务端随机生成（不可枚举），文件名由服务端按序分配
 * （nn.ext，客户端无法借名注入路径）；id 允许 `..` 字符故读取时必须做 startsWith 越界防护。
 * 每次上传生成新 id 且内容永不覆盖，公开响应可放心 immutable 缓存。
 *
 * - POST /api/ai-assets        批量转存（登录 + product.edit）
 * - GET  /ai-assets/:id/:name  公开只读（无需登录）
 */
import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { config } from '../../config.js'
import { writeAudit } from '../../lib/audit.js'
import { httpError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { applyProductPageSecurityHeaders } from '../product-pages/sanitize.js'

const MAX_BODY_BYTES = 256 * 1024 * 1024
const MAX_ASSETS = 40
// 单资产 base64 上限：15 秒 1080p mp4 约 30MB，base64 膨胀 4/3 后留余量
const MAX_ASSET_BASE64_CHARS = 64 * 1024 * 1024

// base64url 字符集落在白名单内；注意 `..` 也在白名单内，读取端必须做 startsWith 越界防护
const ASSET_ID_PATTERN = /^[A-Za-z0-9._-]{1,120}$/
const ASSET_NAME_PATTERN = /^\d{2}\.(?:jpg|jpeg|png|webp|gif|avif|mp4)$/

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'video/mp4': 'mp4'
}

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
  '.mp4': 'video/mp4'
}

const uploadSchema = z.object({
  assets: z.array(z.object({
    contentType: z.string().refine(value => Object.hasOwn(EXTENSION_BY_CONTENT_TYPE, value.toLowerCase()), 'contentType 仅支持 jpg/png/webp/gif/avif/mp4'),
    dataBase64: z.string().min(4).max(MAX_ASSET_BASE64_CHARS)
  })).min(1).max(MAX_ASSETS)
})

function assetsRoot(): string {
  return path.resolve(config.aiAssetsDir)
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fsp.access(target)
    return true
  } catch {
    return false
  }
}

async function allocateAssetId(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = crypto.randomBytes(12).toString('base64url')
    if (!(await pathExists(path.join(assetsRoot(), candidate)))) return candidate
  }
  throw httpError(500, 'ASSET_ID_EXHAUSTED', '生成资产标识失败，请重试')
}

/** 登录态路由：AI 生成图/视频最终保存时的批量转存 */
export async function aiAssetRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)
  await fsp.mkdir(assetsRoot(), { recursive: true })

  app.post('/', {
    bodyLimit: MAX_BODY_BYTES,
    preHandler: [app.requirePermission('product.edit')]
  }, async request => {
    const body = uploadSchema.parse(request.body)
    const orgId = request.currentUser.orgId
    const id = await allocateAssetId()
    const dir = path.join(assetsRoot(), id)
    await fsp.mkdir(dir, { recursive: true })
    const items: Array<{ name: string; contentType: string; sizeBytes: number; url: string }> = []
    try {
      let index = 0
      for (const asset of body.assets) {
        const ext = EXTENSION_BY_CONTENT_TYPE[asset.contentType.toLowerCase()]
        const name = `${String(++index).padStart(2, '0')}.${ext}`
        const buffer = Buffer.from(asset.dataBase64, 'base64')
        if (!buffer.length) throw httpError(400, 'INVALID_ASSET', '资产内容为空')
        await fsp.writeFile(path.join(dir, name), buffer)
        items.push({ name, contentType: asset.contentType, sizeBytes: buffer.length, url: `/ai-assets/${id}/${name}` })
      }
      await fsp.writeFile(path.join(dir, 'meta.json'), JSON.stringify({
        id, orgId, userId: request.currentUser.id, uploadedAt: new Date().toISOString(), assets: items
      }, null, 2), 'utf8')
    } catch (error) {
      await fsp.rm(dir, { recursive: true, force: true })
      throw error
    }
    await writeAudit(prisma, {
      orgId,
      userId: request.currentUser.id,
      action: 'ai-asset.upload',
      targetType: 'ai-asset',
      targetId: id,
      detail: { count: items.length, sizeBytes: items.reduce((sum, item) => sum + item.sizeBytes, 0) },
      ip: request.ip
    })
    return { id, items }
  })
}

/** 公共只读路由：AI 资产静态托管（无需登录） */
export async function aiAssetPublicRoutes(app: FastifyInstance) {
  app.get('/ai-assets/:id/:name', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, name } = request.params as { id: string; name: string }
    const file = path.resolve(assetsRoot(), id, name)
    if (!ASSET_ID_PATTERN.test(id) || !ASSET_NAME_PATTERN.test(name)
      || !file.startsWith(assetsRoot() + path.sep) || !(await pathExists(file))) {
      throw httpError(404, 'NOT_FOUND', '资源不存在')
    }
    applyProductPageSecurityHeaders((header, value) => reply.header(header, value))
    reply.header('content-type', CONTENT_TYPE_BY_EXT[path.extname(name).toLowerCase()] ?? 'application/octet-stream')
    // id 一次性分配且内容永不覆盖，可放心 immutable；nosniff 由安全头统一携带
    reply.header('cache-control', 'public, max-age=31536000, immutable')
    return reply.send(await fsp.readFile(file))
  })
}
