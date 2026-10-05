/**
 * 产品详情页模块（正式入库「下载产品」）：客户端静默抓取源页与图片后一次性提交，
 * 服务端按商品生成公开只读详情页（index.html + assets/ + meta.json），页面内容与采集源高度一致。
 *
 * 安全边界：源页 HTML 是不可信的第三方输入，而公开详情页与 /api/* 同源
 * （nginx `location /` 反代 127.0.0.1:8787）。因此：
 * - 落盘前经 sanitizeProductPageHtml 白名单净化（剥除 script/事件属性/iframe/meta refresh/base 等）；
 * - 公开响应带 CSP `script-src 'none'` + `sandbox`，即使净化漏了载荷也不会执行、且拿不到本站源特权；
 * - pageId 由服务端随机生成而非从 warehouseProductId 推导，避免跨组织互撞与公开 URL 枚举；
 * - 覆盖已有页面时校验 meta.orgId，列表只返回本组织条目。
 *
 * - POST /api/product-pages              提交/覆盖产品页（登录 + product.edit，bodyLimit 64MB）
 * - GET  /api/product-pages              列表（登录，仅本组织）
 * - GET  /product-pages/:pageId          公共详情页（无需登录，产品信息公开只读）
 * - GET  /product-pages/:pageId/assets/* 公共静态资源（无需登录）
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { config } from '../../config.js'
import { writeAudit } from '../../lib/audit.js'
import { httpError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { newPageId } from './pageId.js'
import { renderProductPageDocument, type ProductPageMetaView } from './render.js'
import { applyProductPageSecurityHeaders, sanitizeProductPageHtml } from './sanitize.js'

// 约 24 张常规商品图 + 描述图 + 视频 base64 上限（4/3 膨胀后）
const MAX_BODY_BYTES = 256 * 1024 * 1024
// 净化是同步 CPU 操作，HTML 单独设上限，避免 64MB 极端 body 卡住事件循环
const MAX_HTML_CHARS = 8 * 1024 * 1024
const MAX_IMAGES = 60
const ASSET_NAME_PATTERN = /^(?:\d{2}|d-\d{2})\.(jpg|jpeg|png|webp|gif|avif)$/
const VIDEO_NAME_PATTERN = /^v-\d{2}\.mp4$/
const FILE_ASSET_NAME_PATTERN = /^f-\d{2}\.(pdf|txt|zip|rar|xlsx|xls|docx|doc|png|jpg|jpeg)$/
const PACK_ASSET_NAME_PATTERN = /^m-\d{2}\.zip$/
// 公开页文件/素材包自托管相对路径白名单：杜绝借 meta 注入路径或协议
const SELF_HOSTED_FILE_URL = /^assets\/(?:f-\d{2}\.(?:pdf|txt|zip|rar|xlsx|xls|docx|doc|png|jpg|jpeg)|m-\d{2}\.zip)$/
const PAGE_ID_PATTERN = /^[A-Za-z0-9._-]{1,120}$/
const PAGE_ID_MAX_ATTEMPTS = 8

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.zip': 'application/zip',
  '.rar': 'application/vnd.rar', '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8'
}

const imageSchema = z.object({
  name: z.string().regex(ASSET_NAME_PATTERN, '图片名须为 nn.ext 或 d-nn.ext 序列'),
  contentType: z.string().min(3).max(100),
  dataBase64: z.string().min(4)
})

const videoSchema = z.object({
  name: z.string().regex(VIDEO_NAME_PATTERN, '视频名须为 v-nn.mp4 序列'),
  contentType: z.string().min(3).max(100),
  dataBase64: z.string().min(4)
})

const fileAssetSchema = z.object({
  name: z.string().regex(FILE_ASSET_NAME_PATTERN, '文件名须为 f-nn.ext 序列'),
  contentType: z.string().min(3).max(100),
  dataBase64: z.string().min(4)
})

const packAssetSchema = z.object({
  name: z.string().regex(PACK_ASSET_NAME_PATTERN, '素材包名须为 m-nn.zip 序列'),
  contentType: z.string().min(3).max(100),
  dataBase64: z.string().min(4)
})

const createSchema = z.object({
  warehouseProductId: z.string().min(1).max(120),
  warehouseCode: z.string().min(1).max(40),
  sourceUrl: z.string().min(1).max(2000),
  finalUrl: z.string().max(2000).default(''),
  title: z.string().max(2000).default(''),
  price: z.string().max(500).default(''),
  specs: z.array(z.object({ key: z.string(), value: z.string() })).default([]),
  descriptionText: z.string().default(''),
  html: z.string().min(1).max(MAX_HTML_CHARS),
  images: z.array(imageSchema).max(MAX_IMAGES).default([]),
  descriptionImages: z.array(imageSchema).max(MAX_IMAGES).default([]),
  videos: z.array(videoSchema).max(8).default([]),
  category: z.string().max(500).default(''),
  itemCode: z.string().max(120).default(''),
  firstStockAt: z.string().max(120).default(''),
  returnRate: z.string().max(120).default(''),
  sellableInventory: z.string().max(120).default(''),
  unitPrice: z.string().max(120).default(''),
  packingFee: z.string().max(120).default(''),
  freightFee: z.string().max(120).default(''),
  shippingFee: z.string().max(120).default(''),
  estimatedTotal: z.string().max(200).default(''),
  dropshipLeadTime: z.string().max(120).default(''),
  gigaIndex: z.string().max(60).default(''),
  materialPackUrl: z.string().regex(/^(?:https?:\/\/[^\s"'<>]{1,1900}|assets\/m-\d{2}\.zip)?$/).default(''),
  materialPackDownloads: z.string().max(60).default(''),
  fileAssets: z.array(fileAssetSchema).max(20).default([]),
  packAsset: packAssetSchema.optional(),
  features: z.array(z.string().min(1).max(2000)).max(40).default([]),
  descriptionFlow: z.array(z.object({
    kind: z.enum(['t', 'img']),
    text: z.string().max(6000).default(''),
    i: z.number().int().min(-1).max(59).default(-1)
  })).max(200).default([]),
  // 文件条目：url 空=降级提示；https=源站直链；assets/f-nn.ext|assets/m-nn.zip=本站重托管免登录下载
  files: z.array(z.object({
    name: z.string().min(1).max(300),
    url: z.string().regex(/^(?:https?:\/\/[^\s"'<>]{1,1900}|assets\/(?:f-\d{2}\.(?:pdf|txt|zip|rar|xlsx|xls|docx|doc|png|jpg|jpeg)|m-\d{2}\.zip))?$/).default(''),
    label: z.string().max(120).default('')
  })).max(20).default([]),
  // 重下载覆盖同页时回传上一次的 pageId；服务端校验其归属后才允许覆盖
  pageId: z.string().regex(PAGE_ID_PATTERN).optional()
})

function pagesRoot(): string {
  return path.resolve(config.productPagesDir)
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fsp.access(target)
    return true
  } catch {
    return false
  }
}

function assertPageId(pageId: string): string {
  if (!PAGE_ID_PATTERN.test(pageId)) throw httpError(400, 'INVALID_PAGE_ID', 'pageId 不合法')
  const dir = path.resolve(pagesRoot(), pageId)
  if (!dir.startsWith(pagesRoot() + path.sep)) throw httpError(400, 'INVALID_PAGE_ID', 'pageId 不合法')
  return dir
}

async function readMeta(dir: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fsp.readFile(path.join(dir, 'meta.json'), 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

async function allocatePageId(): Promise<string> {
  for (let attempt = 0; attempt < PAGE_ID_MAX_ATTEMPTS; attempt += 1) {
    const candidate = newPageId()
    if (!(await pathExists(path.join(pagesRoot(), candidate)))) return candidate
  }
  throw httpError(500, 'PAGE_ID_EXHAUSTED', '生成产品页标识失败，请重试')
}

function contentTypeOf(file: string): string {
  return CONTENT_TYPE_BY_EXT[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}

/** meta.json 为历史数据，字段可能缺失或类型不符；统一 coerce 成模板视图，缺字段由模板优雅降级。 */
function metaViewOf(meta: Record<string, unknown>): ProductPageMetaView {
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  const specs = Array.isArray(meta.specs)
    ? (meta.specs as unknown[]).flatMap(entry => {
        const row = entry as { key?: unknown; value?: unknown } | null
        return row && typeof row.key === 'string' && typeof row.value === 'string' ? [{ key: row.key, value: row.value }] : []
      })
    : []
  const images = Array.isArray(meta.images)
    ? (meta.images as unknown[]).flatMap(entry => {
        const row = entry as { name?: unknown; contentType?: unknown } | null
        // 名称必须匹配落盘序列模式，杜绝借 meta 注入路径或引号
        return row && typeof row.name === 'string' && ASSET_NAME_PATTERN.test(row.name)
          ? [{ name: row.name, contentType: typeof row.contentType === 'string' ? row.contentType : '' }]
          : []
      })
    : []
  return {
    title: text(meta.title),
    price: text(meta.price),
    specs,
    images,
    sourceUrl: text(meta.sourceUrl),
    finalUrl: text(meta.finalUrl),
    warehouseCode: text(meta.warehouseCode),
    capturedAt: text(meta.capturedAt),
    category: text(meta.category),
    itemCode: text(meta.itemCode),
    firstStockAt: text(meta.firstStockAt),
    returnRate: text(meta.returnRate),
    sellableInventory: text(meta.sellableInventory),
    unitPrice: text(meta.unitPrice),
    packingFee: text(meta.packingFee),
    freightFee: text(meta.freightFee),
    shippingFee: text(meta.shippingFee),
    estimatedTotal: text(meta.estimatedTotal),
    dropshipLeadTime: text(meta.dropshipLeadTime),
    gigaIndex: text(meta.gigaIndex),
    materialPackUrl: typeof meta.materialPackUrl === 'string' && (/^https?:\/\//i.test(meta.materialPackUrl) || SELF_HOSTED_FILE_URL.test(meta.materialPackUrl)) ? meta.materialPackUrl : '',
    materialPackDownloads: text(meta.materialPackDownloads),
    features: Array.isArray(meta.features)
      ? (meta.features as unknown[]).flatMap(entry => (typeof entry === 'string' && entry.trim() ? [entry.trim().slice(0, 2000)] : []))
      : [],
    descriptionFlow: Array.isArray(meta.descriptionFlow)
      ? (meta.descriptionFlow as unknown[]).flatMap((entry): Array<{ kind: 't' | 'img'; text: string; i: number }> => {
          const row = entry as { kind?: unknown; text?: unknown; i?: unknown } | null
          if (!row || row.kind === 't') return row && typeof row.text === 'string' && row.text.trim() ? [{ kind: 't' as const, text: row.text.trim().slice(0, 6000), i: -1 }] : []
          if (row.kind === 'img') return typeof row.i === 'number' && Number.isInteger(row.i) && row.i >= 0 ? [{ kind: 'img' as const, text: '', i: row.i }] : []
          return []
        })
      : [],
    descriptionText: text(meta.descriptionText),
    videos: Array.isArray(meta.videos)
      ? (meta.videos as unknown[]).flatMap(entry => {
          const row = entry as { name?: unknown; contentType?: unknown } | null
          return row && typeof row.name === 'string' && VIDEO_NAME_PATTERN.test(row.name)
            ? [{ name: row.name, contentType: typeof row.contentType === 'string' ? row.contentType : '' }]
            : []
        })
      : [],
    files: Array.isArray(meta.files)
      ? (meta.files as unknown[]).flatMap(entry => {
          const row = entry as { name?: unknown; url?: unknown; label?: unknown } | null
          if (!row || typeof row.name !== 'string' || !row.name.trim()) return []
          // 历史 meta 里的 url 可能缺失/非 http(s)/非自托管白名单：一律降级为空串，由模板渲染成纯文件名
          const url = typeof row.url === 'string' && (/^https?:\/\//i.test(row.url) || SELF_HOSTED_FILE_URL.test(row.url)) ? row.url : ''
          return [{ name: row.name, url, label: typeof row.label === 'string' ? row.label : '' }]
        })
      : [],
    descriptionImages: Array.isArray(meta.descriptionImages)
      ? (meta.descriptionImages as unknown[]).flatMap(entry => {
          const row = entry as { name?: unknown; contentType?: unknown } | null
          return row && typeof row.name === 'string' && ASSET_NAME_PATTERN.test(row.name)
            ? [{ name: row.name, contentType: typeof row.contentType === 'string' ? row.contentType : '' }]
            : []
        })
      : []
  }
}

/** 登录态路由：提交/覆盖产品页 + 列表 */
export async function productPageRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)
  await fsp.mkdir(pagesRoot(), { recursive: true })

  app.post('/', {
    bodyLimit: MAX_BODY_BYTES,
    preHandler: [app.requirePermission('product.edit')]
  }, async request => {
    const body = createSchema.parse(request.body)
    const orgId = request.currentUser.orgId
    let pageId: string
    if (body.pageId) {
      const existingMeta = await readMeta(assertPageId(body.pageId))
      if (!existingMeta || existingMeta.orgId !== orgId) {
        throw httpError(403, 'PAGE_ID_FORBIDDEN', '无权覆盖该产品页')
      }
      pageId = body.pageId
    } else {
      pageId = await allocatePageId()
    }
    const dir = assertPageId(pageId)
    // 重下载语义：同商品整目录覆盖（pageId 已确认归属本组织）
    await fsp.rm(dir, { recursive: true, force: true })
    await fsp.mkdir(path.join(dir, 'assets'), { recursive: true })
    for (const image of body.images) {
      await fsp.writeFile(path.join(dir, 'assets', image.name), Buffer.from(image.dataBase64, 'base64'))
    }
    for (const image of body.descriptionImages) {
      await fsp.writeFile(path.join(dir, 'assets', image.name), Buffer.from(image.dataBase64, 'base64'))
    }
    for (const video of body.videos) {
      await fsp.writeFile(path.join(dir, 'assets', video.name), Buffer.from(video.dataBase64, 'base64'))
    }
    for (const fileAsset of body.fileAssets) {
      await fsp.writeFile(path.join(dir, 'assets', fileAsset.name), Buffer.from(fileAsset.dataBase64, 'base64'))
    }
    if (body.packAsset) {
      await fsp.writeFile(path.join(dir, 'assets', body.packAsset.name), Buffer.from(body.packAsset.dataBase64, 'base64'))
    }
    await fsp.writeFile(path.join(dir, 'index.html'), sanitizeProductPageHtml(body.html), 'utf8')
    const meta = {
      pageId,
      capturedAt: new Date().toISOString(),
      orgId,
      warehouseProductId: body.warehouseProductId,
      warehouseCode: body.warehouseCode,
      sourceUrl: body.sourceUrl,
      finalUrl: body.finalUrl,
      title: body.title,
      price: body.price,
      specs: body.specs,
      descriptionText: body.descriptionText,
      images: body.images.map(image => ({ name: image.name, contentType: image.contentType })),
      descriptionImages: body.descriptionImages.map(image => ({ name: image.name, contentType: image.contentType })),
      videos: body.videos.map(video => ({ name: video.name, contentType: video.contentType })),
      category: body.category,
      itemCode: body.itemCode,
      firstStockAt: body.firstStockAt,
      returnRate: body.returnRate,
      sellableInventory: body.sellableInventory,
      unitPrice: body.unitPrice,
      packingFee: body.packingFee,
      freightFee: body.freightFee,
      shippingFee: body.shippingFee,
      estimatedTotal: body.estimatedTotal,
      dropshipLeadTime: body.dropshipLeadTime,
      gigaIndex: body.gigaIndex,
      materialPackUrl: body.materialPackUrl,
      materialPackDownloads: body.materialPackDownloads,
      features: body.features,
      descriptionFlow: body.descriptionFlow,
      files: body.files
    }
    await fsp.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')
    await writeAudit(prisma, {
      orgId,
      userId: request.currentUser.id,
      action: 'product-page.publish',
      targetType: 'product-page',
      targetId: pageId,
      detail: { images: body.images.length, sourceUrl: body.sourceUrl },
      ip: request.ip
    })
    return { pageId, url: `/product-pages/${pageId}` }
  })

  app.get('/', async request => {
    const root = pagesRoot()
    if (!(await pathExists(root))) return { items: [] }
    const canViewSource = request.currentUser.isOwner || request.currentUser.permissions.has('erp.source.view')
    const entries = await fsp.readdir(root, { withFileTypes: true })
    const items: Array<Record<string, unknown>> = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !PAGE_ID_PATTERN.test(entry.name)) continue
      const meta = await readMeta(path.join(root, entry.name))
      if (!meta || meta.orgId !== request.currentUser.orgId) continue
      // 货盘源链属 erp.source.view 才可见的字段，与 erp/projection.ts 的裁剪口径保持一致
      if (!canViewSource) {
        delete meta.sourceUrl
        delete meta.finalUrl
      }
      items.push(meta)
    }
    items.sort((a, b) => String(b.capturedAt ?? '').localeCompare(String(a.capturedAt ?? '')))
    return { items }
  })
}

/** 公共只读路由：详情页与静态资源（无需登录） */
export async function productPagePublicRoutes(app: FastifyInstance) {
  const servePage = async (request: FastifyRequest, reply: FastifyReply) => {
    const { pageId } = request.params as { pageId: string }
    const dir = assertPageId(pageId)
    const meta = await readMeta(dir)
    if (!meta) throw httpError(404, 'NOT_FOUND', '产品页不存在')
    applyProductPageSecurityHeaders((name, value) => reply.header(name, value))
    reply.header('content-type', 'text/html; charset=utf-8')
    // no-cache（而非 max-age）：重下载会复用同一 pageId 覆盖内容，缓存会让用户看到过期页面
    reply.header('cache-control', 'no-cache')
    return reply.send(renderProductPageDocument(pageId, metaViewOf(meta)))
  }
  app.get('/product-pages/:pageId', servePage)
  app.get('/product-pages/:pageId/', servePage)

  app.get('/product-pages/:pageId/assets/*', async (request, reply) => {
    const { pageId, '*': asset } = request.params as { pageId: string; '*': string }
    const assetsRoot = path.join(assertPageId(pageId), 'assets')
    const file = path.resolve(assetsRoot, asset)
    if (!file.startsWith(assetsRoot + path.sep) || !(await pathExists(file))) {
      throw httpError(404, 'NOT_FOUND', '资源不存在')
    }
    applyProductPageSecurityHeaders((name, value) => reply.header(name, value))
    reply.header('content-type', contentTypeOf(file))
    // 同名 assets/nn.ext 在重下载后内容会变，必须回源校验，不能吃长缓存
    reply.header('cache-control', 'no-cache')
    return reply.send(await fsp.readFile(file))
  })
}
