import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { httpError } from '../../lib/errors.js'
import { writeAudit } from '../../lib/audit.js'
import { createMediaStorage } from '../../lib/media/storage.js'
import type { CurrentUser } from '../../plugins/auth.js'
import { canViewErpSource, erpProductSelect } from './projection.js'

/** 图片本地签名 URL 有效期（秒） */
const IMAGE_URL_TTL = 3600

interface RawImage {
  id: string
  imageType: string
  /** SQL 层对无 erp.source.view 的角色不 SELECT 该列（projection.erpProductSelect），故此处可选 */
  sourceUrl?: string
  localPath: string
  platform: string | null
  isSelected: number
  sortOrder: number
}

/**
 * 图片投影（规格 §5「local_path 切换后全系统禁引货盘外链」）：
 *   - localPath 存在 → url 为本地媒体签名 URL（/media/...），不再暴露货盘外链；
 *   - sourceUrl 仅在「采集角色 且 尚未落盘」时返回，入库后对任何角色都不出现外链。
 */
export function resolveImageViews(images: RawImage[], canViewSource: boolean) {
  const storage = createMediaStorage()
  return images.map(image => {
    const hasLocal = Boolean(image.localPath)
    // url 回落必须与下方显式 sourceUrl 键同一门控：此前未落盘图对任何角色都回落外链原值，
    // 是 §2.2 SQL 层剥离被旁路的主因之一；pricing.ts 的导出路径复用本函数，同样在此一并收敛。
    const url = hasLocal ? storage.getSignedUrl(image.localPath, IMAGE_URL_TTL) : (canViewSource ? (image.sourceUrl ?? '') : '')
    const view: Record<string, unknown> = {
      id: image.id,
      imageType: image.imageType,
      platform: image.platform,
      isSelected: image.isSelected,
      sortOrder: image.sortOrder,
      localPath: image.localPath,
      url
    }
    if (canViewSource && !hasLocal) view.sourceUrl = image.sourceUrl
    return view
  })
}

/**
 * 仓库层断言（规格 §5 红线）：产品进入 DOWNLOADED 及以后状态时，所有图片必须已落盘（localPath 非空）。
 * 返回仍未落盘的外链图数量；>0 表示存在违规外链引用，供导出/发布前拦截。
 */
export function countExternalImageRefs(images: Array<{ localPath: string; sourceUrl?: string }>): number {
  return images.filter(image => !image.localPath && image.sourceUrl).length
}

/** 将 Prisma 产品行映射为对外视图：图片经 resolveImageViews 处理（禁外链） */
function mapProductView<T extends { status: string; images: RawImage[] }>(product: T, canViewSource: boolean) {
  return { ...product, images: resolveImageViews(product.images, canViewSource) }
}

export interface ErpProductQuery {
  status?: string
  supplierId?: string
  q?: string
  page?: number
  pageSize?: number
}

export class ErpRepository {
  /** 产品列表：select 白名单按角色投影，敏感列在 SQL 层不取 */
  async listProducts(user: CurrentUser, query: ErpProductQuery = {}) {
    const page = Math.max(1, query.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20))
    const where: Record<string, unknown> = { orgId: user.orgId }
    if (query.status) where.status = query.status
    if (query.supplierId) where.supplierId = query.supplierId
    if (query.q) {
      where.titleOriginal = { contains: query.q, mode: 'insensitive' }
    }
    const select = erpProductSelect(user)
    const canViewSource = canViewErpSource(user)
    const [rows, total] = await Promise.all([
      prisma.erpProduct.findMany({
        where,
        select,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      prisma.erpProduct.count({ where })
    ])
    const items = rows.map(row => mapProductView(row as unknown as { status: string; images: RawImage[] }, canViewSource))
    return { items, total, page, pageSize }
  }

  async getProduct(user: CurrentUser, productId: string) {
    const row = await prisma.erpProduct.findFirst({
      where: { id: productId, orgId: user.orgId },
      select: erpProductSelect(user)
    })
    if (!row) return null
    return mapProductView(row as unknown as { status: string; images: RawImage[] }, canViewErpSource(user))
  }

  /** 货盘列表（含抓取规则，不含凭据密文）：仅采集专员/主帐号可见 */
  async listSuppliers(user: CurrentUser) {
    return prisma.erpSupplier.findMany({
      where: { orgId: user.orgId },
      select: {
        id: true,
        code: true,
        name: true,
        loginUrl: true,
        crawlRules: true,
        patrolChannel: true,
        status: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: { createdAt: 'asc' }
    })
  }

  /** 读取指定货盘的抓取规则（crawl_rules JSON），校验归属当前组织 */
  async getSupplierCrawlRules(user: CurrentUser, supplierId: string) {
    const supplier = await prisma.erpSupplier.findFirst({
      where: { id: supplierId, orgId: user.orgId },
      select: { id: true, code: true, name: true, loginUrl: true, patrolChannel: true, crawlRules: true, updatedAt: true }
    })
    if (!supplier) throw httpError(404, 'ERP_SUPPLIER_NOT_FOUND', '货盘不存在或无权访问')
    return supplier
  }

  /** 更新抓取规则：注入器按此 JSON 驱动（规格 §4.4 规则存库不写死） */
  async updateSupplierCrawlRules(user: CurrentUser, supplierId: string, crawlRules: Record<string, unknown>) {
    const existing = await prisma.erpSupplier.findFirst({ where: { id: supplierId, orgId: user.orgId }, select: { id: true } })
    if (!existing) throw httpError(404, 'ERP_SUPPLIER_NOT_FOUND', '货盘不存在或无权访问')
    return prisma.erpSupplier.update({
      where: { id: supplierId },
      data: { crawlRules: crawlRules as Prisma.InputJsonValue, updatedAt: new Date().toISOString() },
      select: { id: true, code: true, name: true, crawlRules: true, updatedAt: true }
    })
  }

  /** 对外货盘视图列（凭据密文列已删除，天然不含敏感凭据） */
  private static readonly supplierPublicSelect = {
    id: true,
    code: true,
    name: true,
    loginUrl: true,
    crawlRules: true,
    patrolChannel: true,
    status: true,
    createdAt: true,
    updatedAt: true
  } satisfies Prisma.ErpSupplierSelect

  /**
   * 创建货盘（P2-22：此前货盘无写端点，只能直插数据库）。
   * orgId+code 撞 @@unique（并发/重复提交）→ 409 明确错误码，不吞成 500。
   */
  async createSupplier(user: CurrentUser, input: { code: string; name: string; loginUrl?: string; crawlRules?: Record<string, unknown>; patrolChannel?: string }) {
    const now = new Date().toISOString()
    try {
      const row = await prisma.erpSupplier.create({
        data: {
          orgId: user.orgId,
          code: input.code,
          name: input.name,
          loginUrl: input.loginUrl ?? '',
          crawlRules: (input.crawlRules ?? {}) as Prisma.InputJsonValue,
          patrolChannel: input.patrolChannel ?? 'SERVER',
          createdAt: now,
          updatedAt: now
        },
        select: ErpRepository.supplierPublicSelect
      })
      await writeAudit(prisma, {
        orgId: user.orgId, userId: user.id, action: 'ERP_SUPPLIER_CREATE',
        targetType: 'ErpSupplier', targetId: row.id, detail: { code: row.code, name: row.name, patrolChannel: row.patrolChannel }
      }).catch(() => { /* 审计失败不阻塞 */ })
      return row
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw httpError(409, 'ERP_SUPPLIER_CODE_TAKEN', `货盘编码已存在：${input.code}`)
      }
      throw error
    }
  }

  /** 更新货盘基础信息（名称/登录页/巡盘通道/状态）；抓取规则走独立端点（erp.source.manage 门控） */
  async updateSupplier(user: CurrentUser, supplierId: string, patch: { name?: string; loginUrl?: string; patrolChannel?: string; status?: string }) {
    const existing = await prisma.erpSupplier.findFirst({ where: { id: supplierId, orgId: user.orgId }, select: { id: true } })
    if (!existing) throw httpError(404, 'ERP_SUPPLIER_NOT_FOUND', '货盘不存在或无权访问')
    const data: Prisma.ErpSupplierUpdateInput = { updatedAt: new Date().toISOString() }
    if (patch.name !== undefined) data.name = patch.name
    if (patch.loginUrl !== undefined) data.loginUrl = patch.loginUrl
    if (patch.patrolChannel !== undefined) data.patrolChannel = patch.patrolChannel
    if (patch.status !== undefined) data.status = patch.status
    const row = await prisma.erpSupplier.update({
      where: { id: supplierId },
      data,
      select: ErpRepository.supplierPublicSelect
    })
    await writeAudit(prisma, {
      orgId: user.orgId, userId: user.id, action: 'ERP_SUPPLIER_UPDATE',
      targetType: 'ErpSupplier', targetId: supplierId, detail: { patched: Object.keys(patch) }
    }).catch(() => { /* 审计失败不阻塞 */ })
    return row
  }
}
