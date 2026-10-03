import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { writeAudit } from '../../lib/audit.js'
import { httpError, HttpError } from '../../lib/errors.js'
import type { CurrentUser } from '../../plugins/auth.js'

/**
 * ERP 采集入库去重三态状态机（规格 §3 / §4.4，方案 M1 + §3 数据流 1）。
 *
 * 去重键：`(orgId, supplierId, sourceProductId)`（与 ErpProduct @@unique 一致）。
 * 三态：
 *   1. 不存在           → 新建 COLLECTED（CREATED）
 *   2. 已存在且 COLLECTED（未加工）
 *        - 内容有差异且未确认覆盖 → NEEDS_CONFIRM（前端弹覆盖确认，返回 diff）
 *        - overwrite=true         → 覆盖字段与图集（OVERWRITTEN）
 *        - 内容一致               → UNCHANGED
 *   3. 已存在且 status ≥ DOWNLOADED（已加工/已发布）
 *        - 只置 change_flag=1 + 写 crawl_logs，绝不覆盖（CHANGE_FLAGGED）
 *        - 内容一致 → UNCHANGED
 */

/** 产品状态机顺序：COLLECTED→DOWNLOADED→PROCESSING→READY→PUBLISHED */
export const ERP_STATUS_ORDER = {
  COLLECTED: 0,
  DOWNLOADED: 1,
  PROCESSING: 2,
  READY: 3,
  PUBLISHED: 4
} as const

/** 已加工（进入不可覆盖区间）的状态判定：status ≥ DOWNLOADED */
export function isProcessedStatus(status: string): boolean {
  const order = (ERP_STATUS_ORDER as Record<string, number>)[status] ?? 0
  return order >= ERP_STATUS_ORDER.DOWNLOADED
}

export const collectImageSchema = z.object({
  imageType: z.string().min(1).default('MAIN'),
  sourceUrl: z.string().min(1),
  platform: z.string().optional(),
  sortOrder: z.number().int().min(0).optional()
})

export const collectItemSchema = z.object({
  supplierId: z.string().min(1),
  sourceProductId: z.string().min(1),
  sourceUrl: z.string().default(''),
  sourceSku: z.string().default(''),
  titleOriginal: z.string().default(''),
  descriptionOriginal: z.string().default(''),
  costPrice: z.number().nullable().optional(),
  shippingCost: z.number().nullable().optional(),
  currency: z.string().default('CNY'),
  stockQuantity: z.number().int().nullable().optional(),
  dimensions: z.record(z.unknown()).optional(),
  weight: z.number().nullable().optional(),
  material: z.string().default(''),
  color: z.string().default(''),
  brand: z.string().default(''),
  category: z.string().default(''),
  variants: z.array(z.unknown()).optional(),
  crawlConfig: z.record(z.unknown()).optional(),
  images: z.array(collectImageSchema).default([])
})

export type CollectItemInput = z.infer<typeof collectItemSchema>

export const collectBatchSchema = z.object({
  items: z.array(collectItemSchema).min(1).max(200),
  /** 前端覆盖确认后置 true：COLLECTED 状态且内容有差异时执行覆盖 */
  overwrite: z.boolean().optional(),
  mode: z.enum(['SINGLE', 'BATCH']).optional()
})

export type CollectBatchInput = z.infer<typeof collectBatchSchema>

export type CollectResultType =
  | 'CREATED'
  | 'NEEDS_CONFIRM'
  | 'OVERWRITTEN'
  | 'CHANGE_FLAGGED'
  | 'UNCHANGED'

export interface FieldDiff {
  field: string
  oldValue: string
  newValue: string
}

export interface CollectItemResult {
  sourceProductId: string
  productId: string | null
  result: CollectResultType
  /** 需要确认或已置变更标记时返回字段级 diff，供前端渲染覆盖确认/变更详情 */
  diff: FieldDiff[]
  /** 已存在产品的当前状态（NEEDS_CONFIRM/CHANGE_FLAGGED/UNCHANGED/OVERWRITTEN 时有效） */
  existingStatus?: string
  /** 单品处理抛出 HttpError 时的明确错误码（如 ERP_PRODUCT_ELIMINATED），供前端区分拒绝原因 */
  errorCode?: string
}

export interface CollectBatchResult {
  mode: 'SINGLE' | 'BATCH'
  total: number
  created: number
  overwritten: number
  changeFlagged: number
  needsConfirm: number
  unchanged: number
  items: CollectItemResult[]
}

/** 参与变更比对的关键字段（规格 §9 巡盘 diff：库存/成本价/运费/变体/图片；标题也纳入）。
 *  P1-11 补齐 currency/descriptionOriginal/dimensions/sourceUrl：货盘改币种此前不产生变更标记，直接影响定价换算 */
const DIFF_FIELDS = [
  'titleOriginal',
  'costPrice',
  'shippingCost',
  'stockQuantity',
  'weight',
  'material',
  'color',
  'brand',
  'category',
  'currency',
  'descriptionOriginal',
  'dimensions',
  'sourceUrl'
] as const

/** Json 列字段：比对前用 JSON 序列化归一化（normalizeScalar 会把对象打成 [object Object]） */
const JSON_DIFF_FIELDS: ReadonlySet<string> = new Set(['dimensions'])

function normalizeScalar(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  return String(value)
}

function normalizeJson(value: unknown): string {
  if (value === null || value === undefined) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** 图片 URL 集合差异（排序后 join，忽略顺序） */
function normalizeImageUrls(images: Array<{ sourceUrl?: string | null }>): string {
  return images
    .map(image => (image?.sourceUrl ?? '').trim())
    .filter(Boolean)
    .sort()
    .join('|')
}

/**
 * 纯函数：比对已存在产品与本次采集内容，返回字段级 diff。
 * 供单测直接验证，不触库。
 */
export function diffProductFields(
  existing: {
    titleOriginal?: string | null
    costPrice?: number | null
    shippingCost?: number | null
    stockQuantity?: number | null
    weight?: number | null
    material?: string | null
    color?: string | null
    brand?: string | null
    category?: string | null
    currency?: string | null
    descriptionOriginal?: string | null
    dimensions?: unknown
    sourceUrl?: string | null
    variants?: unknown
    images?: Array<{ sourceUrl?: string | null }>
  },
  incoming: CollectItemInput
): FieldDiff[] {
  const diffs: FieldDiff[] = []
  for (const field of DIFF_FIELDS) {
    // Json 列（dimensions）两侧统一 ?? {} 再序列化，避免 undefined vs {} 的假 diff
    const oldValue = JSON_DIFF_FIELDS.has(field)
      ? normalizeJson(existing[field as (typeof DIFF_FIELDS)[number]] ?? {})
      : normalizeScalar(existing[field as (typeof DIFF_FIELDS)[number]])
    const newValue = JSON_DIFF_FIELDS.has(field)
      ? normalizeJson(incoming[field as keyof CollectItemInput] ?? {})
      : normalizeScalar(incoming[field as keyof CollectItemInput])
    if (oldValue !== newValue) diffs.push({ field, oldValue, newValue })
  }
  const oldVariants = normalizeJson(existing.variants ?? [])
  const newVariants = normalizeJson(incoming.variants ?? [])
  if (oldVariants !== newVariants) diffs.push({ field: 'variants', oldValue: oldVariants, newValue: newVariants })
  const oldImages = normalizeImageUrls(existing.images ?? [])
  const newImages = normalizeImageUrls(incoming.images ?? [])
  if (oldImages !== newImages) diffs.push({ field: 'images', oldValue: oldImages, newValue: newImages })
  return diffs
}

interface CollectContext {
  user: CurrentUser
  overwrite: boolean
  mode: 'SINGLE' | 'BATCH'
}

/** 校验货盘归属当前组织，防止跨 org 采集写入 */
async function assertSupplier(orgId: string, supplierId: string) {
  const supplier = await prisma.erpSupplier.findFirst({ where: { id: supplierId, orgId } })
  if (!supplier) throw httpError(404, 'ERP_SUPPLIER_NOT_FOUND', `货盘不存在或无权访问：${supplierId}`)
  return supplier
}

/** Prisma 唯一约束冲突（P2002）判定：findFirst→create 竞态时用于重查而非报错（P1-13） */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

/**
 * P1-15：入库前查淘汰黑名单（对照 collection/repository.ts 的预检模式）。
 * ERP 的 sourceProductId 与采集域 identityKey 是两套身份键，这里按「同 org 的
 * EliminatedProduct.productId / sourceUrl 命中」拦截：已淘汰商品拒绝重新采入 ERP 仓。
 */
async function assertNotEliminated(orgId: string, input: CollectItemInput): Promise<void> {
  const or: Array<Record<string, unknown>> = [{ productId: input.sourceProductId }]
  if (input.sourceUrl) or.push({ sourceUrl: input.sourceUrl })
  const eliminated = await prisma.eliminatedProduct.findFirst({
    where: { orgId, status: 'ACTIVE', OR: or },
    select: { id: true, reason: true }
  })
  if (eliminated) {
    throw httpError(409, 'ERP_PRODUCT_ELIMINATED', `该商品已被淘汰，禁止重新采入 ERP 仓${eliminated.reason ? `（淘汰原因：${eliminated.reason}）` : ''}`)
  }
}

function buildProductData(input: CollectItemInput, ctx: { orgId: string; collectedBy: string; now: string }) {
  return {
    sourceUrl: input.sourceUrl,
    sourceSku: input.sourceSku,
    collectedBy: ctx.collectedBy,
    crawlConfig: (input.crawlConfig ?? {}) as Prisma.InputJsonValue,
    titleOriginal: input.titleOriginal,
    descriptionOriginal: input.descriptionOriginal,
    costPrice: input.costPrice ?? null,
    shippingCost: input.shippingCost ?? null,
    currency: input.currency,
    stockQuantity: input.stockQuantity ?? null,
    dimensions: (input.dimensions ?? {}) as Prisma.InputJsonValue,
    weight: input.weight ?? null,
    material: input.material,
    color: input.color,
    brand: input.brand,
    category: input.category,
    variants: (input.variants ?? []) as Prisma.InputJsonValue,
    lastCrawledAt: ctx.now,
    updatedAt: ctx.now
  }
}

/**
 * 覆盖产品图集。只删「未落盘的采集源图」：
 *   - 已落盘图（localPath≠''）对应盘上实体媒体文件，删记录即把文件孤儿化，且下载成果作废；
 *   - AI 图（imageType='AI'）是 ai-process 增量 create 的高成本加工资产，覆盖采集语义不含清空它，
 *     保留后 ai-process 的 baseSort = 1000 + count(AI) 才是真单调游标（旧全删会把它清零撞车）。
 * 与产品写同处一个事务（由调用方传入 tx），中途失败不再留下"产品已改、图集半删"的中间态。
 */
async function replaceImages(tx: Prisma.TransactionClient, orgId: string, productId: string, images: CollectItemInput['images'], now: string) {
  await tx.erpProductImage.deleteMany({ where: { productId, imageType: { not: 'AI' }, localPath: '' } })
  if (images.length === 0) return
  await tx.erpProductImage.createMany({
    data: images.map((image, index) => ({
      orgId,
      productId,
      imageType: image.imageType,
      sourceUrl: image.sourceUrl,
      platform: image.platform ?? null,
      sortOrder: image.sortOrder ?? index,
      isSelected: 0,
      localPath: '',
      createdAt: now
    }))
  })
}

/** 单品采集三态处理（触库）；批量场景逐品调用，互不影响 */
export async function collectOne(input: CollectItemInput, ctx: CollectContext): Promise<CollectItemResult> {
  const { user, overwrite } = ctx
  const now = new Date().toISOString()
  await assertSupplier(user.orgId, input.supplierId)

  let existing = await prisma.erpProduct.findFirst({
    where: { orgId: user.orgId, supplierId: input.supplierId, sourceProductId: input.sourceProductId },
    include: { images: { select: { sourceUrl: true }, orderBy: { sortOrder: 'asc' } } }
  })

  // 态 1：不存在 → 新建 COLLECTED。产品行 + 图集 + 审计同一事务：任一步失败整体回滚
  if (!existing) {
    // P1-15：入库前查淘汰黑名单，已淘汰商品拒绝重新采入
    await assertNotEliminated(user.orgId, input)
    try {
      const created = await prisma.$transaction(async tx => {
        const row = await tx.erpProduct.create({
          data: {
            orgId: user.orgId,
            supplierId: input.supplierId,
            sourceProductId: input.sourceProductId,
            status: 'COLLECTED',
            changeFlag: 0,
            createdAt: now,
            ...buildProductData(input, { orgId: user.orgId, collectedBy: user.email, now })
          }
        })
        await replaceImages(tx, user.orgId, row.id, input.images, now)
        await writeAudit(tx, {
          orgId: user.orgId,
          userId: user.id,
          action: 'ERP_COLLECT_CREATE',
          targetType: 'ErpProduct',
          targetId: row.id,
          detail: { supplierId: input.supplierId, sourceProductId: input.sourceProductId, images: input.images.length }
        })
        return row
      })
      return { sourceProductId: input.sourceProductId, productId: created.id, result: 'CREATED', diff: [] }
    } catch (error) {
      // P1-13：并发 findFirst→create 撞 @@unique(orgId,supplierId,sourceProductId) 时不吞错，
      // 重查已存在行并落入下方三态逻辑（该走 NEEDS_CONFIRM/CHANGE_FLAGGED 就照常走）
      if (!isUniqueViolation(error)) throw error
      existing = await prisma.erpProduct.findFirst({
        where: { orgId: user.orgId, supplierId: input.supplierId, sourceProductId: input.sourceProductId },
        include: { images: { select: { sourceUrl: true }, orderBy: { sortOrder: 'asc' } } }
      })
      if (!existing) throw error
    }
  }
  // 并发兜底：走到这里 existing 必非空（TS 收窄需显式守卫）
  if (!existing) throw httpError(409, 'ERP_COLLECT_CONFLICT', '并发创建冲突且重查未命中，请重试')

  const diff = diffProductFields(existing, input)

  // 态 3：已加工（status ≥ DOWNLOADED）→ 只置 change_flag，绝不覆盖
  if (isProcessedStatus(existing.status)) {
    if (diff.length === 0) {
      await prisma.erpProduct.update({ where: { id: existing.id }, data: { lastCrawledAt: now, updatedAt: now } })
      return { sourceProductId: input.sourceProductId, productId: existing.id, result: 'UNCHANGED', diff: [], existingStatus: existing.status }
    }
    await prisma.$transaction(async tx => {
      await tx.erpProduct.update({ where: { id: existing.id }, data: { changeFlag: 1, lastCrawledAt: now, updatedAt: now } })
      for (const change of diff) {
        await tx.erpCrawlLog.create({
          data: {
            orgId: user.orgId,
            productId: existing.id,
            fieldChanged: change.field,
            oldValue: change.oldValue,
            newValue: change.newValue,
            notified: 0,
            createdAt: now
          }
        })
      }
      // 与新建/覆盖路径同一不变式：变更标记与其审计证据同生共死，审计写失败不留"已改无痕"
      await writeAudit(tx, {
        orgId: user.orgId,
        userId: user.id,
        action: 'ERP_COLLECT_CHANGE_FLAG',
        targetType: 'ErpProduct',
        targetId: existing.id,
        detail: { status: existing.status, changedFields: diff.map(d => d.field) }
      })
    })
    return { sourceProductId: input.sourceProductId, productId: existing.id, result: 'CHANGE_FLAGGED', diff, existingStatus: existing.status }
  }

  // 态 2：COLLECTED（未加工）
  if (diff.length === 0) {
    await prisma.erpProduct.update({ where: { id: existing.id }, data: { lastCrawledAt: now, updatedAt: now } })
    return { sourceProductId: input.sourceProductId, productId: existing.id, result: 'UNCHANGED', diff: [], existingStatus: existing.status }
  }
  if (!overwrite) {
    // 未确认覆盖：返回 NEEDS_CONFIRM + diff，前端弹覆盖确认
    return { sourceProductId: input.sourceProductId, productId: existing.id, result: 'NEEDS_CONFIRM', diff, existingStatus: existing.status }
  }
  // 覆盖写：产品字段 + 图集替换 + 审计同一事务。旧实现先 update 再 deleteMany/createMany 三步分离，
  // 中途失败会丢光该产品全部图片（deleteMany 已提交、createMany 未执行）。
  await prisma.$transaction(async tx => {
    await tx.erpProduct.update({
      where: { id: existing.id },
      data: buildProductData(input, { orgId: user.orgId, collectedBy: user.email, now })
    })
    await replaceImages(tx, user.orgId, existing.id, input.images, now)
    await writeAudit(tx, {
      orgId: user.orgId,
      userId: user.id,
      action: 'ERP_COLLECT_OVERWRITE',
      targetType: 'ErpProduct',
      targetId: existing.id,
      detail: { changedFields: diff.map(d => d.field) }
    })
  })
  return { sourceProductId: input.sourceProductId, productId: existing.id, result: 'OVERWRITTEN', diff, existingStatus: existing.status }
}

/** 批量采集：逐品独立处理，聚合计数；单品失败不影响其余（错误记入 items） */
export async function collectBatch(payload: CollectBatchInput, user: CurrentUser): Promise<CollectBatchResult> {
  const ctx: CollectContext = { user, overwrite: payload.overwrite ?? false, mode: payload.mode ?? (payload.items.length > 1 ? 'BATCH' : 'SINGLE') }
  const results: CollectItemResult[] = []
  for (const item of payload.items) {
    try {
      results.push(await collectOne(item, ctx))
    } catch (error) {
      results.push({
        sourceProductId: item.sourceProductId,
        productId: null,
        result: 'UNCHANGED',
        diff: [],
        // 采集失败以异常向上抛出会中断整批；此处降级为跳过并记录（保持批量不阻塞）。
        // HttpError 附带明确错误码（如 ERP_PRODUCT_ELIMINATED），前端可区分拒绝原因
        ...(error instanceof HttpError ? { errorCode: error.code } : {}),
        ...(error instanceof Error ? { existingStatus: `ERROR:${error.message}` } : {})
      })
    }
  }
  const summary: CollectBatchResult = {
    mode: ctx.mode,
    total: results.length,
    created: results.filter(r => r.result === 'CREATED').length,
    overwritten: results.filter(r => r.result === 'OVERWRITTEN').length,
    changeFlagged: results.filter(r => r.result === 'CHANGE_FLAGGED').length,
    needsConfirm: results.filter(r => r.result === 'NEEDS_CONFIRM').length,
    unchanged: results.filter(r => r.result === 'UNCHANGED').length,
    items: results
  }
  return summary
}

/**
 * 标记已发布（条目20）：PUBLISHED 此前生产零写入方，巡盘「命中已发布产品变更标红」是死语义。
 * 本端点是唯一合法写入路径：仅 READY→PUBLISHED（其余状态 409），状态写与审计同事务。
 */
export async function markProductPublished(user: CurrentUser, productId: string): Promise<{ productId: string; status: string }> {
  const product = await prisma.erpProduct.findFirst({
    where: { id: productId, orgId: user.orgId },
    select: { id: true, status: true }
  })
  if (!product) throw httpError(404, 'ERP_PRODUCT_NOT_FOUND', '产品不存在或无权访问')
  if (product.status !== 'READY') {
    throw httpError(409, 'ERP_NOT_READY_TO_PUBLISH', `仅 READY 状态可标记已发布，当前为 ${product.status}`)
  }
  const now = new Date().toISOString()
  await prisma.$transaction(async tx => {
    await tx.erpProduct.update({ where: { id: product.id }, data: { status: 'PUBLISHED', updatedAt: now } })
    await writeAudit(tx, {
      orgId: user.orgId,
      userId: user.id,
      action: 'ERP_MARK_PUBLISHED',
      targetType: 'ErpProduct',
      targetId: product.id,
      detail: { from: 'READY' }
    })
  })
  return { productId: product.id, status: 'PUBLISHED' }
}
