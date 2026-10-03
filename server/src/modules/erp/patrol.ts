/**
 * ERP 巡盘（规格 §9 / 方案 M6 / 数据流 4）。
 *
 * 红线（方案 P5 验收标准）：
 *   - mock 货盘改价/改库存 → 生成 crawl_logs + 通知；
 *   - 命中「已发布（status ≥ PUBLISHED）」产品的变更标红（PATROL_URGENT）；
 *   - 早 8 点汇总可见（notify.buildMorningSummary）；
 *   - 10 万品分批 + 并发上限 + 请求间隔配置生效，不触发风控（runPatrolBatch/planPatrolBatches）。
 *
 * 双通道路由（规格 §5 云 IP 风控对策）：按货盘 patrolChannel 路由——
 *   SERVER 通道：服务端直连抓取（fetcher 注入，e2e 用 mock）；
 *   CLIENT 通道：下发客户端内嵌浏览器抓取（clientDispatcher 注入），规避云 IP 风控。
 *
 * 变更不覆盖已加工产品字段：patrolProduct 只写 crawl_logs + change_flag，绝不直接改产品字段；
 * 人工在「待确认变更」中 resolve（APPLY 采纳新值 / DISMISS 忽略）后才落地。
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { writeAudit } from '../../lib/audit.js'
import { httpError } from '../../lib/errors.js'
import { config } from '../../config.js'
import type { CurrentUser } from '../../plugins/auth.js'
import { createNotification, isPublishedStatus } from './notify.js'

export interface FieldDiff {
  field: string
  oldValue: string
  newValue: string
}

/** 巡盘监控字段（改价/改库存为重点；与采集 diff 字段保持一致语义）。
 *  P1-11 补齐 currency/descriptionOriginal/dimensions/sourceUrl：货盘改币种此前不产生变更标记，直接影响定价换算 */
export const PATROL_FIELDS = [
  'titleOriginal', 'costPrice', 'shippingCost', 'stockQuantity',
  'weight', 'material', 'color', 'brand', 'category',
  'currency', 'descriptionOriginal', 'dimensions', 'sourceUrl'
] as const

/** Json 列字段：比对/写入前需 JSON 序列化归一化（normalizeScalar 会把对象打成 [object Object]） */
const PATROL_JSON_FIELDS: ReadonlySet<string> = new Set(['dimensions'])

export type PatrolPayload = Partial<Record<(typeof PATROL_FIELDS)[number], unknown>>

function normalizeScalar(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return String(value)
  }
}

/** 按字段类型归一化比对值：Json 列走 JSON 序列化，其余走标量化 */
function normalizeFieldValue(field: string, value: unknown): string {
  return PATROL_JSON_FIELDS.has(field) ? normalizeScalar(value ?? {}) : normalizeScalar(value)
}

/**
 * 纯函数：只对 payload 中「出现的字段」做比对（巡盘可能只回传价/库存），
 * 避免因缺字段产生假 diff。供单测直接验证，不触库。
 */
export function diffPatrolPayload(
  existing: Partial<Record<(typeof PATROL_FIELDS)[number], unknown>>,
  payload: PatrolPayload
): FieldDiff[] {
  const diffs: FieldDiff[] = []
  for (const field of PATROL_FIELDS) {
    if (!(field in payload)) continue
    const oldValue = normalizeFieldValue(field, existing[field])
    const newValue = normalizeFieldValue(field, payload[field])
    if (oldValue !== newValue) diffs.push({ field, oldValue, newValue })
  }
  return diffs
}

/** 纯函数：分批计划（10 万品分批并发配置校验，不触库） */
export function planPatrolBatches(total: number, batchSize: number, concurrency: number) {
  const size = Math.max(1, Math.floor(batchSize))
  const conc = Math.max(1, Math.floor(concurrency))
  return {
    total,
    batchSize: size,
    concurrency: conc,
    batchCount: Math.ceil(total / size),
    maxInFlight: Math.min(conc, total)
  }
}

/** 纯函数：按 batchSize 切块 */
export function chunk<T>(items: T[], batchSize: number): T[][] {
  const size = Math.max(1, Math.floor(batchSize))
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export interface PoolStats {
  processed: number
  failed: number
  peakConcurrency: number
  gapsMs: number[]
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * 并发池：限制在途请求数 ≤ concurrency，每个请求前 sleep(delayMs) 做节流（防风控）。
 * 单品 worker 抛错被吞掉（计入 failed），不中断整池——10 万品巡盘中个别抓取失败不应拖垮全批。
 * 返回峰值并发与相邻请求启动间隔，供 e2e 断言「并发/节流配置生效」。
 */
export async function runPool<T>(
  items: T[],
  concurrency: number,
  delayMs: number,
  worker: (item: T) => Promise<void>
): Promise<PoolStats> {
  const conc = Math.max(1, Math.floor(concurrency))
  let index = 0
  let inFlight = 0
  let peak = 0
  let processed = 0
  let failed = 0
  const starts: number[] = []

  async function lane(): Promise<void> {
    while (true) {
      const current = index
      index += 1
      if (current >= items.length) return
      const item = items[current] as T
      inFlight += 1
      peak = Math.max(peak, inFlight)
      if (delayMs > 0) await sleep(delayMs)
      starts.push(Date.now())
      try {
        await worker(item)
      } catch {
        failed += 1
      } finally {
        inFlight -= 1
        processed += 1
      }
    }
  }

  const lanes = Array.from({ length: Math.min(conc, items.length) }, () => lane())
  await Promise.all(lanes)
  const sorted = [...starts].sort((a, b) => a - b)
  const gapsMs: number[] = []
  for (let i = 1; i < sorted.length; i += 1) gapsMs.push((sorted[i] as number) - (sorted[i - 1] as number))
  return { processed, failed, peakConcurrency: peak, gapsMs }
}

export interface PatrolProductResult {
  productId: string
  changed: boolean
  diffs: FieldDiff[]
  urgent: boolean
  notificationId: string | null
}

/**
 * 单品巡盘落地：检测到 diff → 写 crawl_logs + 置 change_flag=1 + 生成通知；
 * 命中已发布产品 → 通知 kind=PATROL_URGENT（标红）。绝不直接覆盖产品字段。
 */
export async function patrolProduct(
  orgId: string,
  product: { id: string; titleOriginal: string; status: string; costPrice: number | null; shippingCost: number | null; stockQuantity: number | null; weight: number | null; material: string; color: string; brand: string; category: string; currency: string; descriptionOriginal: string; dimensions: unknown; sourceUrl: string },
  payload: PatrolPayload,
  now = new Date().toISOString()
): Promise<PatrolProductResult> {
  const diffs = diffPatrolPayload(product, payload)
  if (diffs.length === 0) {
    await prisma.erpProduct.update({ where: { id: product.id }, data: { lastCrawledAt: now, updatedAt: now } })
    return { productId: product.id, changed: false, diffs: [], urgent: false, notificationId: null }
  }
  const urgent = isPublishedStatus(product.status)
  await prisma.$transaction(async tx => {
    await tx.erpProduct.update({ where: { id: product.id }, data: { changeFlag: 1, lastCrawledAt: now, updatedAt: now } })
    for (const change of diffs) {
      await tx.erpCrawlLog.create({
        data: {
          orgId, productId: product.id, fieldChanged: change.field,
          oldValue: change.oldValue, newValue: change.newValue, notified: 0, createdAt: now
        }
      })
    }
  })
  const notification = await createNotification(orgId, {
    kind: urgent ? 'PATROL_URGENT' : 'PATROL_CHANGE',
    title: urgent
      ? `【标红】已发布产品货盘变更：${product.titleOriginal || product.id}（${diffs.map(d => d.field).join('、')}）`
      : `货盘变更：${product.titleOriginal || product.id}（${diffs.map(d => d.field).join('、')}）`,
    body: { diffs, status: product.status, urgent },
    productId: product.id
  })
  await prisma.erpCrawlLog.updateMany({ where: { orgId, productId: product.id, notified: 0 }, data: { notified: 1 } })
  return { productId: product.id, changed: true, diffs, urgent, notificationId: notification.id }
}

export interface PatrolRunOptions {
  fetcher?: (product: { id: string; sourceProductId: string; sourceUrl: string }) => Promise<PatrolPayload | null>
  clientDispatcher?: (product: { id: string; sourceProductId: string; supplierId: string }) => Promise<void>
  batchSize?: number
  concurrency?: number
  delayMs?: number
  supplierId?: string
  /** 单次运行最多扫描的产品数（同步 HTTP 触发时的上限，防止 10 万品全量巡盘阻塞到超时）；不传则不限量 */
  maxProducts?: number
}

/** HTTP 同步触发全组织巡盘的单次扫描上限（P1-8：防大货盘把请求拖到超时；后台调度不受此限） */
export const PATROL_RUN_MAX_PRODUCTS = 2000

export interface PatrolRunResult {
  orgId: string
  scanned: number
  serverChannel: number
  clientChannel: number
  changed: number
  urgent: number
  plan: ReturnType<typeof planPatrolBatches>
  pool: PoolStats
}

/**
 * 组织级巡盘：按货盘 patrolChannel 双通道路由，SERVER 通道分批并发直连抓取，
 * CLIENT 通道下发客户端。分批/并发/间隔取自 options 或 config（防风控）。
 * maxProducts 限制单次扫描量（同步 HTTP 触发时防超时）；后台调度不传则全量。
 */
export async function runPatrolBatch(orgId: string, options: PatrolRunOptions = {}): Promise<PatrolRunResult> {
  const batchSize = options.batchSize ?? config.erpPatrolBatchSize
  const concurrency = options.concurrency ?? config.erpPatrolConcurrency
  const delayMs = options.delayMs ?? config.erpPatrolDelayMs
  const where: Record<string, unknown> = { orgId }
  if (options.supplierId) where.supplierId = options.supplierId
  const products = await prisma.erpProduct.findMany({
    where,
    select: {
      id: true, sourceProductId: true, sourceUrl: true, supplierId: true, status: true, titleOriginal: true,
      costPrice: true, shippingCost: true, stockQuantity: true, weight: true, material: true, color: true, brand: true, category: true,
      currency: true, descriptionOriginal: true, dimensions: true,
      supplier: { select: { patrolChannel: true } }
    },
    // 优先巡最久未更新的：限量触发时保证老数据不被新数据挤掉
    orderBy: { updatedAt: 'asc' },
    ...(options.maxProducts !== undefined && options.maxProducts > 0 ? { take: Math.floor(options.maxProducts) } : {})
  })
  const plan = planPatrolBatches(products.length, batchSize, concurrency)
  const serverItems = products.filter(p => (p.supplier?.patrolChannel ?? 'SERVER').toUpperCase() !== 'CLIENT')
  const clientItems = products.filter(p => (p.supplier?.patrolChannel ?? 'SERVER').toUpperCase() === 'CLIENT')

  let changed = 0
  let urgent = 0
  // SERVER 通道：分批 + 并发 + 节流直连抓取
  const batches = chunk(serverItems, batchSize)
  let pool: PoolStats = { processed: 0, failed: 0, peakConcurrency: 0, gapsMs: [] }
  for (const batch of batches) {
    const stats = await runPool(batch, concurrency, delayMs, async product => {
      if (!options.fetcher) return
      const payload = await options.fetcher({ id: product.id, sourceProductId: product.sourceProductId, sourceUrl: product.sourceUrl })
      if (!payload) return
      const result = await patrolProduct(orgId, product, payload)
      if (result.changed) { changed += 1; if (result.urgent) urgent += 1 }
    })
    pool = {
      processed: pool.processed + stats.processed,
      failed: pool.failed + stats.failed,
      peakConcurrency: Math.max(pool.peakConcurrency, stats.peakConcurrency),
      gapsMs: [...pool.gapsMs, ...stats.gapsMs]
    }
  }
  // CLIENT 通道：下发客户端内嵌浏览器抓取（规避云 IP 风控）
  for (const product of clientItems) {
    if (options.clientDispatcher) await options.clientDispatcher({ id: product.id, sourceProductId: product.sourceProductId, supplierId: product.supplierId })
  }
  return {
    orgId, scanned: products.length, serverChannel: serverItems.length, clientChannel: clientItems.length,
    changed, urgent, plan, pool
  }
}

// ---------------------------------------------------------------- 待确认变更

export interface ChangeItem {
  productId: string
  titleOriginal: string
  status: string
  published: boolean
  lastCrawledAt: string | null
  changes: Array<{ id: string; field: string; oldValue: string; newValue: string; createdAt: string }>
}

export interface ChangeListResult {
  items: ChangeItem[]
  total: number
  page: number
  pageSize: number
}

/** 待确认变更列表：change_flag=1 的产品 + 其巡盘 crawl_logs（已发布标红 published=true） */
export async function listChanges(user: CurrentUser, query: { page?: number; pageSize?: number } = {}): Promise<ChangeListResult> {
  const page = Math.max(1, query.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20))
  const where = { orgId: user.orgId, changeFlag: 1 }
  const [rows, total] = await Promise.all([
    prisma.erpProduct.findMany({
      where,
      select: { id: true, titleOriginal: true, status: true, lastCrawledAt: true, crawlLogs: { orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, fieldChanged: true, oldValue: true, newValue: true, createdAt: true } } },
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.erpProduct.count({ where })
  ])
  const items: ChangeItem[] = rows.map(row => ({
    productId: row.id,
    titleOriginal: row.titleOriginal,
    status: row.status,
    published: isPublishedStatus(row.status),
    lastCrawledAt: row.lastCrawledAt,
    changes: row.crawlLogs.map(log => ({ id: log.id, field: log.fieldChanged, oldValue: log.oldValue, newValue: log.newValue, createdAt: log.createdAt }))
  }))
  return { items, total, page, pageSize }
}

const NUMERIC_FIELDS = new Set(['costPrice', 'shippingCost', 'weight'])
const INT_FIELDS = new Set(['stockQuantity'])

export interface ApplyFieldPlan {
  /** 解析成功、可写入产品的字段值（不含 changeFlag/updatedAt，由调用方合并） */
  data: Record<string, unknown>
  applied: string[]
  /** newValue 解析失败的字段：跳过不写（绝不静默写 null 清空成本价），由调用方记入审计告警 */
  skipped: string[]
}

/**
 * 纯函数：把待确认变更的最新 crawl_log 值解析为产品字段更新计划（P1-10）。
 * 数值字段解析失败（如 costPrice='abc'）不得静默写 null——跳过该字段并计入 skipped，
 * 调用方在返回与审计中告警；空串视为源端清空，写 null 属合法语义。
 * 供单测直接验证，不触库。
 */
export function planApplyFields(logs: Array<{ fieldChanged: string; newValue: string }>): ApplyFieldPlan {
  // 每个字段取最新一条 crawl_log 的 newValue（入参已按 createdAt desc 排序）
  const latest = new Map<string, string>()
  for (const log of logs) {
    if (!latest.has(log.fieldChanged)) latest.set(log.fieldChanged, log.newValue)
  }
  const data: Record<string, unknown> = {}
  const applied: string[] = []
  const skipped: string[] = []
  for (const [field, rawValue] of latest) {
    if (NUMERIC_FIELDS.has(field)) {
      if (rawValue === '') {
        data[field] = null
        applied.push(field)
        continue
      }
      const num = Number(rawValue)
      if (!Number.isFinite(num)) {
        skipped.push(field)
        continue
      }
      data[field] = num
      applied.push(field)
    } else if (INT_FIELDS.has(field)) {
      if (rawValue === '') {
        data[field] = null
        applied.push(field)
        continue
      }
      const num = Number(rawValue)
      if (!Number.isFinite(num)) {
        skipped.push(field)
        continue
      }
      data[field] = Math.round(num)
      applied.push(field)
    } else if (PATROL_JSON_FIELDS.has(field)) {
      // Json 列（dimensions）：crawl_log 存的是 JSON 序列化串，解析失败同样跳过
      try {
        data[field] = JSON.parse(rawValue) as Prisma.InputJsonValue
        applied.push(field)
      } catch {
        skipped.push(field)
      }
    } else if ((PATROL_FIELDS as readonly string[]).includes(field)) {
      data[field] = rawValue
      applied.push(field)
    }
  }
  return { data, applied, skipped }
}

/**
 * 变更确认：
 *   APPLY  → 采纳巡盘新值写入产品（按字段类型转数值；解析失败字段跳过并在返回值/审计中标明 skipped），清 change_flag；
 *   DISMISS→ 忽略变更，仅清 change_flag（保留产品原值）。
 * crawl_logs 作为历史保留。
 */
export async function resolveChange(user: CurrentUser, productId: string, action: 'APPLY' | 'DISMISS') {
  const product = await prisma.erpProduct.findFirst({
    where: { id: productId, orgId: user.orgId },
    select: { id: true, status: true, crawlLogs: { orderBy: { createdAt: 'desc' }, select: { fieldChanged: true, newValue: true, createdAt: true } } }
  })
  if (!product) throw httpError(404, 'ERP_PRODUCT_NOT_FOUND', '产品不存在或无权访问')
  const now = new Date().toISOString()
  if (action === 'DISMISS') {
    await prisma.erpProduct.update({ where: { id: productId }, data: { changeFlag: 0, updatedAt: now } })
    await writeAudit(prisma, { orgId: user.orgId, userId: user.id, action: 'ERP_CHANGE_DISMISS', targetType: 'ErpProduct', targetId: productId, detail: { status: product.status } }).catch(() => { /* ignore */ })
    return { productId, action, applied: [], skipped: [], status: product.status, changeFlag: 0 }
  }
  // APPLY：解析最新 crawl_log 值；无法解析的字段跳过并告警（绝不静默写 null 清空数据）
  const plan = planApplyFields(product.crawlLogs)
  const data = { changeFlag: 0, updatedAt: now, ...plan.data } as Prisma.ErpProductUpdateInput
  await prisma.erpProduct.update({ where: { id: productId }, data })
  await writeAudit(prisma, {
    orgId: user.orgId, userId: user.id, action: 'ERP_CHANGE_APPLY', targetType: 'ErpProduct', targetId: productId,
    // skipped 非空即为告警信号：巡盘回传了无法解析的新值，对应字段保持产品原值
    detail: { applied: plan.applied, skipped: plan.skipped }
  }).catch(() => { /* ignore */ })
  return { productId, action, applied: plan.applied, skipped: plan.skipped, status: product.status, changeFlag: 0 }
}
