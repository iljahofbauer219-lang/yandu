import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { httpError } from '../../lib/errors.js'
import type { CurrentUser } from '../../plugins/auth.js'
import { collectBatchSchema, collectBatch, ERP_STATUS_ORDER, markProductPublished } from './collect.js'
import {
  enqueueProductImageDownload,
  getDownloadJob,
  listDownloadJobs,
  retryDownloadJob,
  recoverStalledDownloadJobs,
  DOWNLOAD_JOB_STATUSES
} from './download-worker.js'
import {
  generateProductImages,
  generateProductTitles,
  selectProductImage,
  chooseProductTitle,
  getPlatformRules,
  updatePlatformRule
} from './ai-process.js'
import {
  listPricingRules,
  upsertPricingRule,
  getProductListings,
  generateListings,
  updateListing,
  recalcListingPrice,
  exportListingBundle,
  LISTING_STATUSES
} from './pricing.js'
import { listChanges, resolveChange, runPatrolBatch, PATROL_RUN_MAX_PRODUCTS } from './patrol.js'
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  buildMorningSummary
} from './notify.js'
import { getRegisteredPatrolHooks } from './scheduler.js'
import { canViewErpSource } from './projection.js'
import { ErpRepository } from './repository.js'

/** 产品状态机合法值（与 collect.ERP_STATUS_ORDER 同源；P1-9：非法状态串 400，不得绕过状态机） */
const ERP_PRODUCT_STATUSES = Object.keys(ERP_STATUS_ORDER) as [string, ...string[]]

export const productQuerySchema = z.object({
  status: z.enum(ERP_PRODUCT_STATUSES).optional(),
  supplierId: z.string().optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional()
})

/** 下载任务查询入参（P1-9：status 走 enum 校验） */
export const downloadJobQuerySchema = z.object({
  productId: z.string().optional(),
  status: z.enum(DOWNLOAD_JOB_STATUSES).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional()
})

/** PUT /listings/:id 入参（P1-9：status 只接受 listing 生命周期枚举值） */
export const listingUpdateSchema = z.object({
  title: z.string().optional(),
  price: z.coerce.number().min(0).optional(),
  category: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(LISTING_STATUSES).optional()
})

export async function erpRoutes(app: FastifyInstance) {
  const repository = new ErpRepository()

  // P2-22 下载 job 重启恢复：服务重启会中断在途下载，就绪时把遗留 PENDING/RUNNING 标 FAILED
  //（error 说明服务重启），前端可经 POST /download-jobs/:id/retry 重新入队。幂等，失败不阻断启动。
  app.addHook('onReady', async () => {
    try {
      const recovered = await recoverStalledDownloadJobs()
      if (recovered > 0) app.log.info({ recovered }, 'ERP 下载任务重启恢复：遗留任务已标 FAILED')
    } catch (err) {
      app.log.error({ err }, 'ERP 下载任务重启恢复失败（不阻断启动）')
    }
  })

  /** 产品列表（采集池/产品库共用，status 过滤）：响应按角色投影剥离敏感字段 */
  app.get('/products', {
    preHandler: [app.authenticate, app.requirePermission('erp.warehouse.view')]
  }, async request => {
    const query = productQuerySchema.parse(request.query)
    return repository.listProducts(request.currentUser, query)
  })

  /** 产品详情：同上投影 */
  app.get('/products/:id', {
    preHandler: [app.authenticate, app.requirePermission('erp.warehouse.view')]
  }, async request => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params)
    const product = await repository.getProduct(request.currentUser, params.id)
    if (!product) throw httpError(404, 'ERP_PRODUCT_NOT_FOUND', '产品不存在或无权访问')
    return product
  })

  /** 标记已发布（条目20：PUBLISHED 唯一合法写入路径，READY→PUBLISHED）：仓库编辑权限门控 */
  app.post('/products/:id/mark-published', {
    preHandler: [app.authenticate, app.requirePermission('erp.warehouse.edit')]
  }, async request => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params)
    return markProductPublished(request.currentUser, params.id)
  })

  /** 货盘列表（含 crawl_rules）：仅采集专员/主帐号 */
  app.get('/suppliers', {
    preHandler: [app.authenticate, app.requirePermission('erp.source.view')]
  }, async request => {
    return repository.listSuppliers(request.currentUser as CurrentUser)
  })

  /** 创建货盘（P2-22：此前无写端点，货盘只能直插数据库）：门控 isOwner || erp.source.view */
  app.post('/suppliers', {
    preHandler: [app.authenticate, app.requirePermission('erp.source.view')]
  }, async request => {
    const body = z.object({
      code: z.string().trim().min(1).max(64),
      name: z.string().trim().min(1).max(128),
      loginUrl: z.string().trim().max(512).optional(),
      crawlRules: z.record(z.unknown()).optional(),
      patrolChannel: z.enum(['SERVER', 'CLIENT']).optional()
    }).parse(request.body)
    return repository.createSupplier(request.currentUser, body)
  })

  /** 更新货盘基础信息（名称/登录页/巡盘通道/状态）：门控 isOwner || erp.source.view；抓取规则走独立端点 */
  app.put('/suppliers/:id', {
    preHandler: [app.authenticate, app.requirePermission('erp.source.view')]
  }, async request => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params)
    const body = z.object({
      name: z.string().trim().min(1).max(128).optional(),
      loginUrl: z.string().trim().max(512).optional(),
      patrolChannel: z.enum(['SERVER', 'CLIENT']).optional(),
      status: z.enum(['ACTIVE', 'DISABLED']).optional()
    }).parse(request.body)
    return repository.updateSupplier(request.currentUser, params.id, body)
  })

  /** 采集入库（去重三态）：单品/批量共用，需 erp.collect 权限 */
  app.post('/collect', {
    preHandler: [app.authenticate, app.requirePermission('erp.collect')]
  }, async request => {
    const payload = collectBatchSchema.parse(request.body)
    return collectBatch(payload, request.currentUser)
  })

  /** 读取货盘抓取规则（注入器配置源）：仅采集专员/主帐号 */
  app.get('/suppliers/:id/crawl-rules', {
    preHandler: [app.authenticate, app.requirePermission('erp.source.view')]
  }, async request => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params)
    return repository.getSupplierCrawlRules(request.currentUser, params.id)
  })

  /** 更新货盘抓取规则（规格 §4.4：规则存库不写死）：需 erp.source.manage */
  app.put('/suppliers/:id/crawl-rules', {
    preHandler: [app.authenticate, app.requirePermission('erp.source.manage')]
  }, async request => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params)
    const body = z.object({ crawlRules: z.record(z.unknown()) }).parse(request.body)
    return repository.updateSupplierCrawlRules(request.currentUser, params.id, body.crawlRules)
  })

  /** 触发原图下载队列（规格 §5 / 数据流 2）：非阻塞入队，返回任务视图供轮询。需 erp.warehouse.edit */
  app.post('/products/:id/download-images', {
    preHandler: [app.authenticate, app.requirePermission('erp.warehouse.edit')]
  }, async request => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params)
    return enqueueProductImageDownload(request.currentUser, params.id)
  })

  /** 下载队列进度/失败 URL 列表：需 erp.warehouse.view（status 走 enum 校验，P1-9） */
  app.get('/download-jobs', {
    preHandler: [app.authenticate, app.requirePermission('erp.warehouse.view')]
  }, async request => {
    const query = downloadJobQuerySchema.parse(request.query)
    return listDownloadJobs(request.currentUser, query)
  })

  /** 单个下载任务详情（前端轮询进度）：需 erp.warehouse.view */
  app.get('/download-jobs/:id', {
    preHandler: [app.authenticate, app.requirePermission('erp.warehouse.view')]
  }, async request => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params)
    return getDownloadJob(request.currentUser, params.id)
  })

  /** 下载任务重试（P2-22：重启恢复标 FAILED 后/部分失败后重新入队）：需 erp.warehouse.edit */
  app.post('/download-jobs/:id/retry', {
    preHandler: [app.authenticate, app.requirePermission('erp.warehouse.edit')]
  }, async request => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params)
    return retryDownloadJob(request.currentUser, params.id)
  })

  /** 图生图（规格 §6 / 数据流 3）：以已入库原图为参考图生成待选图，model 可换重试。需 erp.warehouse.edit */
  app.post('/products/:id/ai-images', {
    preHandler: [app.authenticate, app.requirePermission('erp.warehouse.edit')]
  }, async request => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params)
    const body = z.object({
      platform: z.string().min(1),
      model: z.string().optional(),
      count: z.coerce.number().int().min(1).max(4).optional(),
      prompt: z.string().optional(),
      size: z.enum(['1K', '2K']).optional()
    }).parse(request.body)
    return generateProductImages(request.currentUser, params.id, body)
  })

  /** 三风格标题生成（规格 §6）：按平台字符上限强制校验，结果存 ErpListing.aiTitleOptions。需 erp.warehouse.edit */
  app.post('/products/:id/ai-titles', {
    preHandler: [app.authenticate, app.requirePermission('erp.warehouse.edit')]
  }, async request => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params)
    const body = z.object({
      platform: z.string().min(1),
      styles: z.array(z.string()).optional()
    }).parse(request.body)
    return generateProductTitles(request.currentUser, params.id, body)
  })

  /** 待选图定稿（规格 §6：不替换原图，仅置 is_selected）：需 erp.warehouse.edit */
  app.post('/products/:id/images/:imgId/select', {
    preHandler: [app.authenticate, app.requirePermission('erp.warehouse.edit')]
  }, async request => {
    const params = z.object({ id: z.string().min(1), imgId: z.string().min(1) }).parse(request.params)
    const body = z.object({ isSelected: z.boolean().optional() }).parse(request.body ?? {})
    return selectProductImage(request.currentUser, params.id, params.imgId, body.isSelected ?? true)
  })

  /** 标题人工选定（写入 ErpListing.title，保护后续重算 + 推进 READY）：需 erp.warehouse.edit */
  app.post('/products/:id/choose-title', {
    preHandler: [app.authenticate, app.requirePermission('erp.warehouse.edit')]
  }, async request => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params)
    const body = z.object({ platform: z.string().min(1), title: z.string().min(1) }).parse(request.body)
    return chooseProductTitle(request.currentUser, params.id, body.platform, body.title)
  })

  /** 平台规则列表（title_char_limit + image_rules）：需 erp.warehouse.view */
  app.get('/platform-rules', {
    preHandler: [app.authenticate, app.requirePermission('erp.warehouse.view')]
  }, async request => {
    return getPlatformRules(request.currentUser)
  })

  /** 更新平台规则（eBay 主图无文字等）：需 erp.warehouse.edit */
  app.put('/platform-rules/:code', {
    preHandler: [app.authenticate, app.requirePermission('erp.warehouse.edit')]
  }, async request => {
    const params = z.object({ code: z.string().min(1) }).parse(request.params)
    const body = z.object({
      titleCharLimit: z.coerce.number().int().min(1).max(500).optional(),
      imageRules: z.record(z.unknown()).optional()
    }).parse(request.body)
    return updatePlatformRule(request.currentUser, params.code, body)
  })

  /** 定价规则列表（采集角色禁）：需 erp.pricing.manage */
  app.get('/pricing-rules', {
    preHandler: [app.authenticate, app.requirePermission('erp.pricing.manage')]
  }, async request => {
    return listPricingRules(request.currentUser)
  })

  /** 新增/更新定价规则（平台×品类）：需 erp.pricing.manage */
  app.post('/pricing-rules', {
    preHandler: [app.authenticate, app.requirePermission('erp.pricing.manage')]
  }, async request => {
    const body = z.object({
      platformCode: z.string().min(1),
      category: z.string().optional(),
      markupRate: z.coerce.number().positive().optional(),
      commissionRate: z.coerce.number().min(0).lt(1).optional(),
      fixedFee: z.coerce.number().min(0).optional(),
      currency: z.string().length(3).optional()
    }).parse(request.body)
    return upsertPricingRule(request.currentUser, body)
  })

  /** 多平台 listing 版本（eBay/Amazon/Ozon 各一行）：需 erp.warehouse.view */
  app.get('/products/:id/listings', {
    preHandler: [app.authenticate, app.requirePermission('erp.warehouse.view')]
  }, async request => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params)
    return getProductListings(request.currentUser, params.id)
  })

  /** 生成/补齐多平台独立 listing（含参考价计算）：需 erp.warehouse.edit */
  app.post('/products/:id/listings', {
    preHandler: [app.authenticate, app.requirePermission('erp.warehouse.edit')]
  }, async request => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params)
    const body = z.object({ platforms: z.array(z.string().min(1)).min(1) }).parse(request.body)
    return generateListings(request.currentUser, params.id, body.platforms)
  })

  /** 改标题/价/类目/描述/状态（手改价置 priceManual=1）：需 erp.warehouse.edit；
   *  P1-8 权限边界：改价额外要求 erp.pricing.manage（防 OPERATOR 之外的仓库角色经此端点绕过定价权限分立） */
  app.put('/listings/:id', {
    preHandler: [app.authenticate, app.requirePermission('erp.warehouse.edit')]
  }, async request => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params)
    const body = listingUpdateSchema.parse(request.body)
    if (body.price !== undefined) {
      const user = request.currentUser
      if (!user.isOwner && !user.permissions.has('erp.pricing.manage')) {
        throw httpError(403, 'FORBIDDEN', '没有该操作的权限（改价需 erp.pricing.manage）')
      }
    }
    return updateListing(request.currentUser, params.id, body)
  })

  /** 参考价重算（保护手改价：priceManual=1 且非 force 则跳过）：需 erp.pricing.manage */
  app.post('/listings/:id/price-recalc', {
    preHandler: [app.authenticate, app.requirePermission('erp.pricing.manage')]
  }, async request => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params)
    const body = z.object({ force: z.boolean().optional() }).parse(request.body ?? {})
    return recalcListingPrice(request.currentUser, params.id, body.force ?? false)
  })

  /** 导出包（产品/选定图/多平台 listing/定价明细 + 完整性核对表）：需 erp.warehouse.view */
  app.get('/products/:id/export', {
    preHandler: [app.authenticate, app.requirePermission('erp.warehouse.view')]
  }, async request => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params)
    return exportListingBundle(request.currentUser, params.id)
  })

  /** 待确认变更列表（巡盘检测到货盘改价/改库存，change_flag=1）：需 erp.warehouse.view */
  app.get('/changes', {
    preHandler: [app.authenticate, app.requirePermission('erp.warehouse.view')]
  }, async request => {
    const query = z.object({
      page: z.coerce.number().int().min(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(100).optional()
    }).parse(request.query)
    return listChanges(request.currentUser, query)
  })

  /** 变更确认：APPLY 采纳新值写入产品 / DISMISS 忽略（清 change_flag）：需 erp.changes.resolve */
  app.post('/changes/:id/resolve', {
    preHandler: [app.authenticate, app.requirePermission('erp.changes.resolve')]
  }, async request => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params)
    const body = z.object({ action: z.enum(['APPLY', 'DISMISS']) }).parse(request.body)
    return resolveChange(request.currentUser, params.id, body.action)
  })

  /** 通知中心列表（PATROL_CHANGE/PATROL_URGENT/MORNING_SUMMARY，含未读数）：需 erp.warehouse.view */
  app.get('/notifications', {
    preHandler: [app.authenticate, app.requirePermission('erp.warehouse.view')]
  }, async request => {
    const query = z.object({
      unreadOnly: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
      kind: z.string().optional(),
      page: z.coerce.number().int().min(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(100).optional()
    }).parse(request.query)
    return listNotifications(request.currentUser, {
      unreadOnly: query.unreadOnly === true || query.unreadOnly === 'true',
      kind: query.kind,
      page: query.page,
      pageSize: query.pageSize
    })
  })

  /** 手动生成早间汇总（统计过去 24h 变更/紧急/待确认，落一条 MORNING_SUMMARY）：写端点需 erp.warehouse.edit（P1-8） */
  app.post('/notifications/summary', {
    preHandler: [app.authenticate, app.requirePermission('erp.warehouse.edit')]
  }, async request => {
    return buildMorningSummary(request.currentUser.orgId)
  })

  /** 全部通知标记已读：写端点需 erp.warehouse.edit（P1-8）；只清 currentUser 可见范围 */
  app.post('/notifications/read-all', {
    preHandler: [app.authenticate, app.requirePermission('erp.warehouse.edit')]
  }, async request => {
    return markAllNotificationsRead(request.currentUser)
  })

  /** 单条通知标记已读：写端点需 erp.warehouse.edit（P1-8）；只允许操作本人可见行 */
  app.post('/notifications/:id/read', {
    preHandler: [app.authenticate, app.requirePermission('erp.warehouse.edit')]
  }, async request => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params)
    return markNotificationRead(request.currentUser, params.id)
  })

  /** 手动触发巡盘（复用已注入的真实抓取器/下发器；可覆写分批/并发/间隔）：需 erp.warehouse.edit。
   *  P1-8：门控与巡盘读写域一致（触发巡盘属仓库加工操作，与下载/AI加工同族）——旧门控 erp.changes.resolve
   *  是「变更确认」语义，与"跑一轮巡盘"错配（changes.resolve 仍只管 GET/POST /changes 的确认动作）；
   *  同步端点带单次扫描上限，防 10 万品全组织巡盘阻塞到超时（响应形状不变，scanned 为截断后计数） */
  app.post('/patrol/run', {
    preHandler: [app.authenticate, app.requirePermission('erp.warehouse.edit')]
  }, async request => {
    const body = z.object({
      supplierId: z.string().optional(),
      batchSize: z.coerce.number().int().min(1).optional(),
      concurrency: z.coerce.number().int().min(1).optional(),
      delayMs: z.coerce.number().int().min(0).optional()
    }).parse(request.body ?? {})
    return runPatrolBatch(request.currentUser.orgId, {
      ...getRegisteredPatrolHooks(),
      ...body,
      maxProducts: PATROL_RUN_MAX_PRODUCTS
    })
  })

  /** 当前用户 ERP 能力摘要：供前端按角色渲染工作台 tab */
  app.get('/capabilities', { preHandler: [app.authenticate] }, async request => {
    const user = request.currentUser
    return {
      canViewSource: canViewErpSource(user),
      canCollect: user.isOwner || user.permissions.has('erp.collect'),
      canEdit: user.isOwner || user.permissions.has('erp.warehouse.edit'),
      canPricing: user.isOwner || user.permissions.has('erp.pricing.manage'),
      canResolveChanges: user.isOwner || user.permissions.has('erp.changes.resolve')
    }
  })
}
