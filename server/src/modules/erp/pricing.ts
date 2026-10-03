/**
 * ERP 定价引擎 + 多平台 listing（规格 §8 定价 / §7 多平台 listing；方案 M4+M5 / P4）。
 *
 * 红线（方案 P4 验收标准）：
 *   - 参考价与手算公式一致：computeReferencePrice 为纯函数，公式固定且可复算。
 *   - 手改价不被重算覆盖：listing.priceManual=1 时 recalcListingPrice 跳过（除非 force）。
 *   - eBay/Amazon 双版本 listing 独立：ErpListing @@unique([productId, platformCode])，逐平台一行互不覆盖。
 *   - 导出包物料齐备：exportListingBundle 汇总产品/选定图/多平台 listing/定价明细 + 完整性核对表。
 *
 * 参考价公式（成本加成 + 佣金反推 + 固定费；目标币种）：
 *   landedCost = (costPrice + shippingCost) × exchangeRate         // 源币种成本换算为目标币种到手成本
 *   target     = landedCost × markupRate                           // 期望净得（含利润，扣佣前）
 *   gross      = target / (1 − commissionRate)                     // 反推平台佣金后的挂牌毛价
 *   price      = round2(gross + fixedFee)                          // 叠加平台固定费，2 位小数
 *   commission = round2(gross − target)                            // 佣金金额（披露用）
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { createMediaStorage, type MediaStorage } from '../../lib/media/storage.js'
import { writeAudit } from '../../lib/audit.js'
import { httpError } from '../../lib/errors.js'
import { config } from '../../config.js'
import type { CurrentUser } from '../../plugins/auth.js'
import { resolveImageViews } from './repository.js'
import { recomputeProductStatus } from './ai-process.js'

/** 默认平台定价规则（倍率/佣金率/固定费/目标币种） */
export const DEFAULT_PRICING_RULES: Record<string, { markupRate: number; commissionRate: number; fixedFee: number; currency: string }> = {
  ebay: { markupRate: 2.2, commissionRate: 0.13, fixedFee: 0.3, currency: 'USD' },
  amazon: { markupRate: 2.5, commissionRate: 0.15, fixedFee: 0, currency: 'USD' },
  ozon: { markupRate: 2.4, commissionRate: 0.12, fixedFee: 0, currency: 'RUB' }
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** 汇率解析：优先配置表 "FROM->TO"，同币种为 1；缺失时抛错（避免静默错价） */
export function resolveExchangeRate(fromCurrency: string, toCurrency: string, table: Record<string, number> = config.erpFxRates): number {
  const from = (fromCurrency || '').trim().toUpperCase()
  const to = (toCurrency || '').trim().toUpperCase()
  if (!from || !to) throw httpError(400, 'ERP_FX_MISSING', '币种缺失，无法换算参考价')
  if (from === to) return 1
  const rate = table[`${from}->${to}`]
  if (rate === undefined || !Number.isFinite(rate) || rate <= 0) {
    throw httpError(400, 'ERP_FX_MISSING', `未配置汇率 ${from}->${to}，请在 ERP_FX_RATES 补充`)
  }
  return rate
}

export interface PriceInput {
  costPrice: number
  shippingCost: number
  markupRate: number
  commissionRate: number
  fixedFee: number
  exchangeRate: number
  currency: string
}

export interface PriceBreakdown {
  landedCost: number
  target: number
  commission: number
  fixedFee: number
  price: number
  currency: string
  exchangeRate: number
  markupRate: number
  commissionRate: number
}

/** 纯函数：参考价计算（公式见文件头）；非法参数抛 400 */
export function computeReferencePrice(input: PriceInput): PriceBreakdown {
  const costPrice = Number(input.costPrice) || 0
  const shippingCost = Number(input.shippingCost) || 0
  const markupRate = Number(input.markupRate)
  const commissionRate = Number(input.commissionRate)
  const fixedFee = Number(input.fixedFee) || 0
  const exchangeRate = Number(input.exchangeRate)
  if (!Number.isFinite(markupRate) || markupRate <= 0) throw httpError(400, 'ERP_BAD_MARKUP', '倍率 markupRate 必须为正数')
  if (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate >= 1) throw httpError(400, 'ERP_BAD_COMMISSION', '佣金率 commissionRate 必须在 [0,1) 区间')
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) throw httpError(400, 'ERP_BAD_FX', '汇率 exchangeRate 必须为正数')
  const landedCost = round2((costPrice + shippingCost) * exchangeRate)
  const target = landedCost * markupRate
  const gross = target / (1 - commissionRate)
  const price = round2(gross + fixedFee)
  const commission = round2(gross - target)
  return {
    landedCost, target: round2(target), commission, fixedFee: round2(fixedFee), price,
    currency: (input.currency || '').toUpperCase(), exchangeRate, markupRate, commissionRate
  }
}

// ---------------------------------------------------------------- 定价规则 CRUD

export interface PricingRuleView {
  id: string
  platformCode: string
  category: string
  markupRate: number
  commissionRate: number
  fixedFee: number
  currency: string
  updatedAt: string
}

/** 确保平台默认定价规则存在（category='' 为平台默认行）。
 *  P1-13：upsert 消除 findFirst→create 并发竞态（撞 @@unique 抛 P2002 被批量场景吞成 UNCHANGED） */
export async function ensurePricingRule(orgId: string, platformCode: string, category = ''): Promise<PricingRuleView> {
  const code = platformCode.toLowerCase()
  const defaults = DEFAULT_PRICING_RULES[code] ?? { markupRate: 2, commissionRate: 0.1, fixedFee: 0, currency: 'USD' }
  const now = new Date().toISOString()
  return prisma.erpPricingRule.upsert({
    where: { orgId_platformCode_category: { orgId, platformCode: code, category } },
    create: {
      orgId, platformCode: code, category, markupRate: defaults.markupRate,
      commissionRate: defaults.commissionRate, fixedFee: defaults.fixedFee, currency: defaults.currency, updatedAt: now
    },
    // 已存在则原样返回，绝不覆盖既有配置
    update: {}
  })
}

export async function listPricingRules(user: CurrentUser): Promise<PricingRuleView[]> {
  return prisma.erpPricingRule.findMany({
    where: { orgId: user.orgId },
    orderBy: [{ platformCode: 'asc' }, { category: 'asc' }]
  })
}

/** upsert 定价规则（平台×品类唯一） */
export async function upsertPricingRule(
  user: CurrentUser,
  patch: { platformCode: string; category?: string; markupRate?: number; commissionRate?: number; fixedFee?: number; currency?: string }
): Promise<PricingRuleView> {
  const code = (patch.platformCode || '').toLowerCase()
  if (!code) throw httpError(400, 'ERP_PLATFORM_REQUIRED', '必须指定 platformCode')
  const category = patch.category ?? ''
  await ensurePricingRule(user.orgId, code, category)
  const data: Prisma.ErpPricingRuleUpdateInput = { updatedAt: new Date().toISOString() }
  if (patch.markupRate !== undefined) data.markupRate = patch.markupRate
  if (patch.commissionRate !== undefined) data.commissionRate = patch.commissionRate
  if (patch.fixedFee !== undefined) data.fixedFee = patch.fixedFee
  if (patch.currency !== undefined) data.currency = patch.currency.toUpperCase()
  const rule = await prisma.erpPricingRule.update({
    where: { orgId_platformCode_category: { orgId: user.orgId, platformCode: code, category } },
    data
  })
  await writeAudit(prisma, {
    orgId: user.orgId, userId: user.id, action: 'ERP_PRICING_RULE_UPDATE',
    targetType: 'ErpPricingRule', targetId: rule.id, detail: { ...patch, platformCode: code, category }
  }).catch(() => { /* 审计失败不阻塞 */ })
  return rule
}

/** 匹配定价规则：优先平台×品类精确，回落平台默认（category=''） */
export async function findMatchingRule(orgId: string, platformCode: string, category: string): Promise<PricingRuleView> {
  const code = platformCode.toLowerCase()
  const exact = category
    ? await prisma.erpPricingRule.findFirst({ where: { orgId, platformCode: code, category } })
    : null
  if (exact) return exact
  return ensurePricingRule(orgId, code, '')
}

// ---------------------------------------------------------------- 多平台 listing

export interface ListingView {
  id: string
  productId: string
  platformCode: string
  title: string
  aiTitleOptions: unknown
  price: number | null
  priceManual: number
  category: string
  description: string
  status: string
  updatedAt: string
}

/** listing 状态生命周期（P1-9：写入/查询的唯一合法值，任意状态串会被 zod 400 拒绝）：
 *  DRAFT 草稿 → READY 就绪 → PUBLISHED 已发布 */
export const LISTING_STATUSES = ['DRAFT', 'READY', 'PUBLISHED'] as const

/** 某产品的多平台 listing 版本（eBay/Amazon/Ozon 各一行，互相独立） */
export async function getProductListings(user: CurrentUser, productId: string): Promise<ListingView[]> {
  const product = await prisma.erpProduct.findFirst({ where: { id: productId, orgId: user.orgId }, select: { id: true } })
  if (!product) throw httpError(404, 'ERP_PRODUCT_NOT_FOUND', '产品不存在或无权访问')
  return prisma.erpListing.findMany({ where: { orgId: user.orgId, productId }, orderBy: { platformCode: 'asc' } })
}

/**
 * 为产品在指定平台集合生成/补齐独立 listing 版本（不覆盖已存在行的手改字段）。
 * 逐平台：ensurePricingRule → 计算参考价（未手改则写入 price）→ 复制选定标题/类目。
 */
export async function generateListings(
  user: CurrentUser,
  productId: string,
  platforms: string[]
): Promise<{ productId: string; listings: ListingView[] }> {
  const product = await prisma.erpProduct.findFirst({
    where: { id: productId, orgId: user.orgId },
    include: { images: { orderBy: { sortOrder: 'asc' } } }
  })
  if (!product) throw httpError(404, 'ERP_PRODUCT_NOT_FOUND', '产品不存在或无权访问')
  const codes = Array.from(new Set((platforms ?? []).map(code => (code || '').toLowerCase()).filter(Boolean)))
  if (codes.length === 0) throw httpError(400, 'ERP_PLATFORM_REQUIRED', '必须指定至少一个平台')
  const now = new Date().toISOString()
  for (const code of codes) {
    const existing = await prisma.erpListing.findUnique({ where: { productId_platformCode: { productId, platformCode: code } } })
    const rule = await findMatchingRule(user.orgId, code, product.category)
    const breakdown = computeReferencePriceForProduct(product, rule)
    if (existing) {
      // 已存在：仅在未手改价时刷新参考价；标题/类目保留人工成果
      const data: Prisma.ErpListingUpdateInput = { updatedAt: now }
      if (existing.priceManual === 0) data.price = breakdown.price
      await prisma.erpListing.update({ where: { id: existing.id }, data })
    } else {
      await prisma.erpListing.create({
        data: {
          orgId: user.orgId, productId, platformCode: code,
          title: '', category: product.category, description: product.descriptionOriginal,
          price: breakdown.price, priceManual: 0, status: 'DRAFT', updatedAt: now
        }
      })
    }
  }
  await writeAudit(prisma, {
    orgId: user.orgId, userId: user.id, action: 'ERP_LISTING_GENERATE',
    targetType: 'ErpProduct', targetId: productId, detail: { platforms: codes }
  }).catch(() => { /* 审计失败不阻塞 */ })
  return { productId, listings: await getProductListings(user, productId) }
}

function computeReferencePriceForProduct(
  product: { costPrice: number | null; shippingCost: number | null; currency: string },
  rule: PricingRuleView
): PriceBreakdown {
  const exchangeRate = resolveExchangeRate(product.currency || 'CNY', rule.currency)
  return computeReferencePrice({
    costPrice: product.costPrice ?? 0,
    shippingCost: product.shippingCost ?? 0,
    markupRate: rule.markupRate,
    commissionRate: rule.commissionRate,
    fixedFee: rule.fixedFee,
    exchangeRate,
    currency: rule.currency
  })
}

/**
 * 更新 listing（改标题/价/类目/描述/状态）。
 * 手动改价（传入 price）→ priceManual=1，后续重算不再覆盖。
 */
export async function updateListing(
  user: CurrentUser,
  listingId: string,
  patch: { title?: string; price?: number; category?: string; description?: string; status?: string }
): Promise<ListingView> {
  const listing = await prisma.erpListing.findFirst({ where: { id: listingId, orgId: user.orgId } })
  if (!listing) throw httpError(404, 'ERP_LISTING_NOT_FOUND', 'listing 不存在或无权访问')
  const data: Prisma.ErpListingUpdateInput = { updatedAt: new Date().toISOString() }
  if (patch.title !== undefined) data.title = patch.title
  if (patch.category !== undefined) data.category = patch.category
  if (patch.description !== undefined) data.description = patch.description
  if (patch.status !== undefined) data.status = patch.status
  if (patch.price !== undefined) {
    if (!Number.isFinite(patch.price) || patch.price < 0) throw httpError(400, 'ERP_BAD_PRICE', '价格必须为非负数')
    data.price = round2(patch.price)
    data.priceManual = 1 // 手改价保护
  }
  const updated = await prisma.erpListing.update({ where: { id: listingId }, data })
  await writeAudit(prisma, {
    orgId: user.orgId, userId: user.id, action: 'ERP_LISTING_UPDATE',
    targetType: 'ErpListing', targetId: listingId, detail: { patched: Object.keys(patch), priceManual: updated.priceManual }
  }).catch(() => { /* 审计失败不阻塞 */ })
  // P1-12：listing 更新后推进产品状态机（此前 PUT 设标题永远推不到 READY：
  // recomputeProductStatus 只被选图/选标题路径调用，本端点漏挂）
  await recomputeProductStatus(listing.productId).catch(() => { /* 状态推进失败不阻塞 listing 更新结果 */ })
  return updated
}

export interface RecalcResult {
  listingId: string
  platformCode: string
  protected: boolean
  price: number | null
  breakdown: PriceBreakdown | null
}

/**
 * 参考价重算（保护手改价）：priceManual=1 且未 force → 跳过写入，返回 protected=true + 试算 breakdown。
 * 否则写入计算参考价。
 */
export async function recalcListingPrice(user: CurrentUser, listingId: string, force = false): Promise<RecalcResult> {
  const listing = await prisma.erpListing.findFirst({ where: { id: listingId, orgId: user.orgId } })
  if (!listing) throw httpError(404, 'ERP_LISTING_NOT_FOUND', 'listing 不存在或无权访问')
  const product = await prisma.erpProduct.findFirst({ where: { id: listing.productId, orgId: user.orgId } })
  if (!product) throw httpError(404, 'ERP_PRODUCT_NOT_FOUND', '产品不存在或无权访问')
  const rule = await findMatchingRule(user.orgId, listing.platformCode, product.category)
  const breakdown = computeReferencePriceForProduct(product, rule)
  const isProtected = listing.priceManual === 1 && !force
  if (isProtected) {
    return { listingId, platformCode: listing.platformCode, protected: true, price: listing.price, breakdown }
  }
  const updated = await prisma.erpListing.update({
    where: { id: listingId },
    data: { price: breakdown.price, priceManual: 0, updatedAt: new Date().toISOString() }
  })
  await writeAudit(prisma, {
    orgId: user.orgId, userId: user.id, action: 'ERP_LISTING_RECALC',
    targetType: 'ErpListing', targetId: listingId, detail: { price: updated.price, force }
  }).catch(() => { /* 审计失败不阻塞 */ })
  return { listingId, platformCode: listing.platformCode, protected: false, price: updated.price, breakdown }
}

// ---------------------------------------------------------------- 导出包

export interface ExportBundle {
  productId: string
  exportedAt: string
  product: {
    titleOriginal: string
    category: string
    brand: string
    costPrice: number | null
    shippingCost: number | null
    currency: string
    weight: number | null
    dimensions: unknown
  }
  images: Array<{ id: string; imageType: string; isSelected: number; url: string; localPath: string }>
  listings: Array<ListingView & { breakdown: PriceBreakdown | null }>
  completeness: {
    hasSelectedImage: boolean
    imageCount: number
    platforms: string[]
    allHaveTitle: boolean
    allHavePrice: boolean
    noExternalRefs: boolean
    complete: boolean
  }
}

/**
 * 导出包物料齐备：汇总产品核心 + 选定/全部图片（禁外链，走本地签名）+ 多平台 listing（含定价明细）
 * + 完整性核对表（选定图/标题/价/无外链引用）。供打包发布或人工核对。
 */
export async function exportListingBundle(user: CurrentUser, productId: string, storage: MediaStorage = createMediaStorage()): Promise<ExportBundle> {
  const product = await prisma.erpProduct.findFirst({
    where: { id: productId, orgId: user.orgId },
    include: { images: { orderBy: { sortOrder: 'asc' } } }
  })
  if (!product) throw httpError(404, 'ERP_PRODUCT_NOT_FOUND', '产品不存在或无权访问')
  const canViewSource = user.isOwner || user.permissions.has('erp.source.view')
  const images = resolveImageViews(product.images, canViewSource) as ExportBundle['images']
  const listingRows = await prisma.erpListing.findMany({ where: { orgId: user.orgId, productId }, orderBy: { platformCode: 'asc' } })
  const listings: ExportBundle['listings'] = []
  for (const listing of listingRows) {
    const rule = await findMatchingRule(user.orgId, listing.platformCode, product.category)
    let breakdown: PriceBreakdown | null = null
    try { breakdown = computeReferencePriceForProduct(product, rule) } catch { breakdown = null }
    listings.push({ ...listing, breakdown })
  }
  const noExternalRefs = product.images.every(image => Boolean(image.localPath) || !image.sourceUrl)
  const completeness = {
    hasSelectedImage: product.images.some(image => image.isSelected === 1),
    imageCount: images.length,
    platforms: listings.map(listing => listing.platformCode),
    allHaveTitle: listings.length > 0 && listings.every(listing => Boolean(listing.title && listing.title.trim())),
    allHavePrice: listings.length > 0 && listings.every(listing => listing.price != null),
    noExternalRefs,
    complete: false
  }
  completeness.complete = completeness.hasSelectedImage && completeness.allHaveTitle && completeness.allHavePrice && completeness.noExternalRefs
  await writeAudit(prisma, {
    orgId: user.orgId, userId: user.id, action: 'ERP_EXPORT_BUNDLE',
    targetType: 'ErpProduct', targetId: productId, detail: { platforms: completeness.platforms, complete: completeness.complete }
  }).catch(() => { /* 审计失败不阻塞 */ })
  return {
    productId,
    exportedAt: new Date().toISOString(),
    product: {
      titleOriginal: product.titleOriginal, category: product.category, brand: product.brand,
      costPrice: product.costPrice, shippingCost: product.shippingCost, currency: product.currency,
      weight: product.weight, dimensions: product.dimensions
    },
    images,
    listings,
    completeness
  }
}
