/**
 * ERP AI 加工编排（规格 §6 / 方案 M3 + §3 数据流 3）。
 *
 * 红线（规格 §6.1）：
 *   - 产品本体一致性：图生图强制以「已入库原图」作参考图输入（referenceImageUrls），
 *     provider 侧 NEGATIVE_PROMPT 已禁止改变商品结构/材质/文字；本模块再叠加平台 image_rules。
 *   - 待选图人工定稿：AI 生成图以 imageType='AI' + isSelected=0 落库为「待选图」，绝不替换原图；
 *     仅当人工 select 后才置 isSelected=1（定稿）。
 *   - 三风格标题 + 平台字符上限：生成后按 ErpPlatformRule.titleCharLimit 强制截断校验。
 *   - 可换模型重试：model 为入参，重复调用以不同模型追加候选图。
 *
 * 状态流转：DOWNLOADED --(生成AI图)--> PROCESSING --(选图定稿 + 选定标题)--> READY。
 * 所有 AI/网络调用均可注入（deps），便于无密钥的确定性 e2e 验收。
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { createMediaStorage, type MediaStorage } from '../../lib/media/storage.js'
import { writeAudit } from '../../lib/audit.js'
import { httpError } from '../../lib/errors.js'
import type { CurrentUser } from '../../plugins/auth.js'
import {
  generateImage,
  chatCompletion,
  type AiImageGenerateInput,
  type AiImageGenerateOutput
} from '../ai/providers.js'
import { findImageModel, type AiImageModelProfile } from '../ai/catalog.js'
import { fetchImageWithRetry, storeDownloadedImage } from './download-worker.js'
import { isProcessedStatus } from './collect.js'

/** 三风格标题（规格 §6：卖点型 / 关键词型 / 场景型） */
export const TITLE_STYLES = ['卖点精炼型', '关键词覆盖型', '场景情感型'] as const

/** 默认图生图模型：千问 Image Edit Plus（多图参照编辑，保持商品结构与材质） */
export const DEFAULT_AI_IMAGE_MODEL = 'qwen-image-edit-plus'

/** 平台规则默认值（titleCharLimit + imageRules）；eBay 主图无文字为规格 §6 红线 */
export const DEFAULT_PLATFORM_RULES: Record<string, { titleCharLimit: number; imageRules: Record<string, unknown> }> = {
  ebay: { titleCharLimit: 80, imageRules: { mainImageNoText: true, minImages: 1 } },
  amazon: { titleCharLimit: 200, imageRules: { mainImageNoText: true, pureWhiteBackground: true } },
  ozon: { titleCharLimit: 200, imageRules: { mainImageNoText: false } }
}

export interface TitleLimitResult {
  title: string
  charCount: number
  truncated: boolean
}

/** 纯函数：标题字符上限强制（超限按字符截断并去尾空格），保证 charCount ≤ limit */
export function enforceTitleLimit(title: string, limit: number): TitleLimitResult {
  const clean = (title ?? '').trim().replace(/\s+/g, ' ')
  if (clean.length <= limit) return { title: clean, charCount: clean.length, truncated: false }
  const cut = clean.slice(0, limit).replace(/[\s,;|]+$/, '')
  return { title: cut, charCount: cut.length, truncated: true }
}

/** 纯函数：按平台 image_rules 叠加约束到生图 prompt（eBay 主图无文字等） */
export function buildImagePrompt(basePrompt: string, imageRules: Record<string, unknown>): string {
  const parts: string[] = [basePrompt.trim()]
  if (imageRules.mainImageNoText) {
    parts.push('Main image must contain absolutely no text, no letters, no numbers, no watermark, no logo, no promotional badge.')
  }
  if (imageRules.pureWhiteBackground) {
    parts.push('Main image background must be pure white (RGB 255,255,255).')
  }
  parts.push('Keep the exact product identity, structure, proportions, color, material and accessories from the reference photo.')
  return parts.filter(Boolean).join(' ')
}

/** 确保平台规则存在（不存在则按默认值创建），返回规则行。
 *  P1-13：upsert 消除 findFirst→create 并发竞态（撞 @@unique(orgId,platformCode) 抛 P2002） */
export async function ensurePlatformRule(orgId: string, platformCode: string) {
  const code = platformCode.toLowerCase()
  const defaults = DEFAULT_PLATFORM_RULES[code] ?? { titleCharLimit: 80, imageRules: {} }
  const now = new Date().toISOString()
  return prisma.erpPlatformRule.upsert({
    where: { orgId_platformCode: { orgId, platformCode: code } },
    create: {
      orgId, platformCode: code, titleCharLimit: defaults.titleCharLimit,
      imageRules: defaults.imageRules as Prisma.InputJsonValue, updatedAt: now
    },
    // 已存在则原样返回，绝不覆盖既有规则
    update: {}
  })
}

export async function getPlatformRules(user: CurrentUser) {
  return prisma.erpPlatformRule.findMany({ where: { orgId: user.orgId }, orderBy: { platformCode: 'asc' } })
}

export async function updatePlatformRule(
  user: CurrentUser,
  platformCode: string,
  patch: { titleCharLimit?: number; imageRules?: Record<string, unknown> }
) {
  const code = platformCode.toLowerCase()
  await ensurePlatformRule(user.orgId, code)
  const data: Prisma.ErpPlatformRuleUpdateInput = { updatedAt: new Date().toISOString() }
  if (patch.titleCharLimit !== undefined) data.titleCharLimit = patch.titleCharLimit
  if (patch.imageRules !== undefined) data.imageRules = patch.imageRules as Prisma.InputJsonValue
  return prisma.erpPlatformRule.update({ where: { orgId_platformCode: { orgId: user.orgId, platformCode: code } }, data })
}

/** AI 加工依赖注入（默认走真实 ai gateway；e2e 注入 mock 实现无密钥确定性验收） */
export interface AiProcessDeps {
  imageGenerator?: (profile: AiImageModelProfile, input: AiImageGenerateInput) => Promise<AiImageGenerateOutput>
  titleGenerator?: (ctx: { titleOriginal: string; category: string; brand: string; platform: string; styles: readonly string[]; charLimit: number }) => Promise<string[]>
  fetcher?: typeof fetch
  storage?: MediaStorage
}

export interface AiImagesResult {
  productId: string
  model: string
  platform: string
  generated: number
  status: string
  candidates: Array<{ id: string; sortOrder: number; localPath: string; url: string }>
  /** 生成图下载失败数（失败候选不落库、不进 candidates，见 P1-16） */
  failed: number
}

/** 解析图片对外可访问 URL（本地签名优先） */
function resolveUrl(storage: MediaStorage, localPath: string, fallback: string): string {
  if (localPath) return storage.getSignedUrl(localPath, 3600)
  return fallback
}

/**
 * 纯函数：图生图参照上限解析（P1-17）。
 * maxReferenceImages=0 是「纯文生图、不支持参照原图」的哨兵值（catalog.ts），
 * 旧实现 Math.max(1,…) 把 0 抹平成 1 强行塞参考图，违背模型契约；
 * 图生图红线要求必须以已入库原图作参照，故 0 直接拒绝（400），提示换支持参考图的模型。
 */
export function resolveReferenceLimit(profile: AiImageModelProfile): number {
  if (profile.maxReferenceImages <= 0) {
    throw httpError(400, 'ERP_MODEL_NO_REFERENCE', `模型 ${profile.id} 不支持参照原图（纯文生图），无法保证产品本体一致性，请换用支持参考图的模型`)
  }
  return profile.maxReferenceImages
}

/**
 * 纯函数：AI 图生成后的产品状态推进（P1-18）。
 * 仅 DOWNLOADED → PROCESSING（首次 AI 加工）；READY/PUBLISHED 等状态原样保留，
 * 调用方以本函数结果落库并回读，返回值不再硬编码 'PROCESSING'。
 */
export function resolveStatusAfterAiImages(currentStatus: string): string {
  return currentStatus === 'DOWNLOADED' ? 'PROCESSING' : currentStatus
}

/**
 * 纯函数：生成图候选是否允许落库/进入候选集（P1-16）。
 * 禁外链红线：仅本地落盘成功（localPath 非空）的候选可持久化并供 select 定稿；
 * 下载失败不得回退远端 generatedUrl 当 url，失败行删除、不进 candidates。
 */
export function isPersistableGeneratedCandidate(localPath: string): boolean {
  return (localPath ?? '').trim().length > 0
}

/**
 * 图生图：以已入库原图为参考图，生成平台候选图（待选图，isSelected=0，不替换原图）。
 * 要求产品已入库（status ≥ DOWNLOADED）；首次生成将状态推进为 PROCESSING。
 */
export async function generateProductImages(
  user: CurrentUser,
  productId: string,
  options: { platform: string; model?: string; count?: number; prompt?: string; size?: '1K' | '2K' },
  deps: AiProcessDeps = {}
): Promise<AiImagesResult> {
  const storage = deps.storage ?? createMediaStorage()
  const imageGenerator = deps.imageGenerator ?? generateImage
  const now = new Date().toISOString()
  const platform = (options.platform || '').toLowerCase()
  if (!platform) throw httpError(400, 'ERP_PLATFORM_REQUIRED', '必须指定目标平台 platform')

  const product = await prisma.erpProduct.findFirst({
    where: { id: productId, orgId: user.orgId },
    include: { images: { orderBy: { sortOrder: 'asc' } } }
  })
  if (!product) throw httpError(404, 'ERP_PRODUCT_NOT_FOUND', '产品不存在或无权访问')
  if (!isProcessedStatus(product.status)) {
    throw httpError(400, 'ERP_NOT_DOWNLOADED', '产品原图尚未入库，请先触发下载队列（status ≥ DOWNLOADED 才可 AI 加工）')
  }

  const model = options.model ?? DEFAULT_AI_IMAGE_MODEL
  const profile = findImageModel(model)
  if (!profile) throw httpError(400, 'ERP_UNKNOWN_IMAGE_MODEL', `未知图生图模型：${model}`)

  // 产品本体一致性：以已入库原图（非 AI 图）作参考图输入
  const originals = product.images.filter(image => image.imageType !== 'AI' && image.localPath)
  if (originals.length === 0) {
    throw httpError(400, 'ERP_NO_REFERENCE_IMAGE', '无已入库原图可作参考图，无法保证产品本体一致性')
  }
  // P1-17：0=不支持参照原图的哨兵语义由 resolveReferenceLimit 把守（不再 Math.max(1,…) 抹平）
  const referenceLimit = resolveReferenceLimit(profile)
  const referenceImageUrls = originals.slice(0, referenceLimit).map(image => resolveUrl(storage, image.localPath, image.sourceUrl))

  const rule = await ensurePlatformRule(user.orgId, platform)
  const imageRules = (rule.imageRules as Record<string, unknown>) ?? {}
  const basePrompt = options.prompt?.trim() ||
    `E-commerce product photo of "${product.titleOriginal}"${product.category ? ` in category ${product.category}` : ''}, clean studio lighting, high detail, true-to-life color.`
  const prompt = buildImagePrompt(basePrompt, imageRules)

  const count = Math.max(1, Math.min(4, options.count ?? 2))
  const output = await imageGenerator(profile, {
    model, prompt, referenceImageUrls, size: options.size ?? '1K', count
  })
  if (!output.imageUrls.length) throw httpError(502, 'ERP_AI_NO_IMAGE', 'AI 未返回任何候选图')

  // 首次 AI 加工：DOWNLOADED → PROCESSING；其余状态原样保留（P1-18，纯函数收敛状态推进规则）
  const nextStatus = resolveStatusAfterAiImages(product.status)
  if (nextStatus !== product.status) {
    await prisma.erpProduct.update({ where: { id: productId }, data: { status: nextStatus, updatedAt: now } })
  }

  const candidates: AiImagesResult['candidates'] = []
  let failed = 0
  let baseSort = 1000 + (await prisma.erpProductImage.count({ where: { productId, imageType: 'AI' } }))
  for (const generatedUrl of output.imageUrls) {
    const row = await prisma.erpProductImage.create({
      data: {
        orgId: user.orgId, productId, imageType: 'AI', sourceUrl: generatedUrl, localPath: '',
        platform, isSelected: 0, sortOrder: baseSort, createdAt: now
      }
    })
    baseSort += 1
    try {
      const fetched = await fetchImageWithRetry(generatedUrl, { fetcher: deps.fetcher, retries: 2, backoffMs: [200, 800] })
      const key = await storeDownloadedImage(storage, user.orgId, productId, row.id, fetched.buffer, fetched.contentType, generatedUrl)
      // P1-16：仅本地落盘成功的候选可持久化并进入候选集（禁外链红线）
      if (!isPersistableGeneratedCandidate(key)) throw new Error('存储未返回本地路径')
      await prisma.erpProductImage.update({ where: { id: row.id }, data: { localPath: key } })
      candidates.push({ id: row.id, sortOrder: row.sortOrder, localPath: key, url: storage.getSignedUrl(key, 3600) })
    } catch {
      // P1-16：生成图下载失败不再回退远端 generatedUrl 当 url（违反「local_path 切换后禁外链」红线）。
      // 失败候选整行删除：不落 sourceUrl、不可被 select 定稿；失败数计入审计告警，不阻塞其余候选
      failed += 1
      await prisma.erpProductImage.delete({ where: { id: row.id } }).catch(() => { /* 删除失败仅留待人工清理，不阻塞 */ })
    }
  }

  await writeAudit(prisma, {
    orgId: user.orgId, userId: user.id, action: 'ERP_AI_IMAGES',
    targetType: 'ErpProduct', targetId: productId,
    detail: { platform, model, generated: output.imageUrls.length, persisted: candidates.length, downloadFailed: failed, referenceCount: referenceImageUrls.length }
  }).catch(() => { /* 审计失败不阻塞 */ })

  // P1-18：回读真实产品状态返回（旧实现硬编码 PROCESSING，产品本已 READY/PUBLISHED 时返回值与库不符）
  const current = await prisma.erpProduct.findUnique({ where: { id: productId }, select: { status: true } })
  return { productId, model, platform, generated: output.imageUrls.length, status: current?.status ?? nextStatus, candidates, failed }
}

export interface AiTitlesResult {
  productId: string
  platform: string
  charLimit: number
  options: Array<{ style: string; title: string; charCount: number; truncated: boolean }>
}

async function defaultTitleGenerator(ctx: { titleOriginal: string; category: string; brand: string; platform: string; styles: readonly string[]; charLimit: number }): Promise<string[]> {
  const system = 'You are a cross-border e-commerce listing title expert. Write compelling English titles strictly within the character limit. Never exceed the limit. Return JSON only.'
  const userPrompt = [
    `Product: ${ctx.titleOriginal}`,
    ctx.brand ? `Brand: ${ctx.brand}` : '',
    ctx.category ? `Category: ${ctx.category}` : '',
    `Platform: ${ctx.platform}`,
    `Max characters per title: ${ctx.charLimit}`,
    `Produce exactly ${ctx.styles.length} titles in these styles (in order): ${ctx.styles.join(' / ')}.`,
    'Respond JSON: {"titles":["...","...","..."]}'
  ].filter(Boolean).join('\n')
  const output = await chatCompletion({
    provider: 'bailian',
    messages: [{ role: 'system', content: system }, { role: 'user', content: userPrompt }],
    responseFormat: 'json_object',
    temperature: 0.5
  })
  const parsed = JSON.parse(output.content) as { titles?: unknown }
  const titles = Array.isArray(parsed.titles) ? parsed.titles.map(String) : []
  return titles.slice(0, ctx.styles.length)
}

/**
 * 三风格标题生成 + 平台字符上限强制校验。
 * 结果写入 ErpListing.aiTitleOptions（按 productId+platform upsert），status=DRAFT，待人工选定。
 */
export async function generateProductTitles(
  user: CurrentUser,
  productId: string,
  options: { platform: string; styles?: string[] },
  deps: AiProcessDeps = {}
): Promise<AiTitlesResult> {
  const titleGenerator = deps.titleGenerator ?? defaultTitleGenerator
  const platform = (options.platform || '').toLowerCase()
  if (!platform) throw httpError(400, 'ERP_PLATFORM_REQUIRED', '必须指定目标平台 platform')

  const product = await prisma.erpProduct.findFirst({ where: { id: productId, orgId: user.orgId } })
  if (!product) throw httpError(404, 'ERP_PRODUCT_NOT_FOUND', '产品不存在或无权访问')

  const rule = await ensurePlatformRule(user.orgId, platform)
  const charLimit = rule.titleCharLimit
  const styles = options.styles?.length ? options.styles : [...TITLE_STYLES]

  const rawTitles = await titleGenerator({
    titleOriginal: product.titleOriginal, category: product.category, brand: product.brand,
    platform, styles, charLimit
  })
  if (!rawTitles.length) throw httpError(502, 'ERP_AI_NO_TITLE', 'AI 未返回任何标题')

  const resultOptions = styles.map((style, index) => {
    const enforced = enforceTitleLimit(rawTitles[index] ?? '', charLimit)
    return { style, title: enforced.title, charCount: enforced.charCount, truncated: enforced.truncated }
  }).filter(option => option.title.length > 0)

  const now = new Date().toISOString()
  await prisma.erpListing.upsert({
    where: { productId_platformCode: { productId, platformCode: platform } },
    create: {
      orgId: user.orgId, productId, platformCode: platform, title: '',
      aiTitleOptions: resultOptions as unknown as Prisma.InputJsonValue, status: 'DRAFT', updatedAt: now
    },
    update: { aiTitleOptions: resultOptions as unknown as Prisma.InputJsonValue, updatedAt: now }
  })

  await writeAudit(prisma, {
    orgId: user.orgId, userId: user.id, action: 'ERP_AI_TITLES',
    targetType: 'ErpProduct', targetId: productId, detail: { platform, charLimit, count: resultOptions.length }
  }).catch(() => { /* 审计失败不阻塞 */ })

  return { productId, platform, charLimit, options: resultOptions }
}

/** 待选图定稿：置/取消 isSelected（绝不删除或替换原图） */
export async function selectProductImage(user: CurrentUser, productId: string, imageId: string, isSelected: boolean) {
  const image = await prisma.erpProductImage.findFirst({ where: { id: imageId, productId, orgId: user.orgId } })
  if (!image) throw httpError(404, 'ERP_IMAGE_NOT_FOUND', '图片不存在或无权访问')
  const now = new Date().toISOString()
  const updated = await prisma.erpProductImage.update({ where: { id: imageId }, data: { isSelected: isSelected ? 1 : 0 } })
  await writeAudit(prisma, {
    orgId: user.orgId, userId: user.id, action: isSelected ? 'ERP_IMAGE_SELECT' : 'ERP_IMAGE_UNSELECT',
    targetType: 'ErpProductImage', targetId: imageId, detail: { productId, imageType: image.imageType }
  }).catch(() => { /* 审计失败不阻塞 */ })
  const status = await recomputeProductStatus(productId, now)
  return { id: updated.id, isSelected: updated.isSelected, productStatus: status }
}

/** 标题人工选定：写入 ErpListing.title（保护后续重算），并尝试推进状态 */
export async function chooseProductTitle(user: CurrentUser, productId: string, platform: string, title: string) {
  const code = (platform || '').toLowerCase()
  if (!code) throw httpError(400, 'ERP_PLATFORM_REQUIRED', '必须指定目标平台 platform')
  const rule = await ensurePlatformRule(user.orgId, code)
  const enforced = enforceTitleLimit(title, rule.titleCharLimit)
  if (!enforced.title) throw httpError(400, 'ERP_TITLE_EMPTY', '标题不能为空')
  const now = new Date().toISOString()
  const listing = await prisma.erpListing.upsert({
    where: { productId_platformCode: { productId, platformCode: code } },
    create: { orgId: user.orgId, productId, platformCode: code, title: enforced.title, status: 'DRAFT', updatedAt: now },
    update: { title: enforced.title, updatedAt: now }
  })
  const status = await recomputeProductStatus(productId, now)
  return { listingId: listing.id, platform: code, title: enforced.title, charCount: enforced.charCount, truncated: enforced.truncated, productStatus: status }
}

/**
 * 状态推进：PROCESSING 且「已定稿选图 + 已选定标题」→ READY。
 * 仅在 PROCESSING 时前进，绝不回退已发布状态。
 */
export async function recomputeProductStatus(productId: string, now = new Date().toISOString()): Promise<string> {
  const product = await prisma.erpProduct.findUnique({
    where: { id: productId },
    select: { status: true, images: { select: { isSelected: true } }, listings: { select: { title: true } } }
  })
  if (!product) return 'COLLECTED'
  if (product.status !== 'PROCESSING') return product.status
  const hasSelectedImage = product.images.some(image => image.isSelected === 1)
  const hasChosenTitle = product.listings.some(listing => Boolean(listing.title && listing.title.trim()))
  if (hasSelectedImage && hasChosenTitle) {
    await prisma.erpProduct.update({ where: { id: productId }, data: { status: 'READY', updatedAt: now } })
    return 'READY'
  }
  return product.status
}
