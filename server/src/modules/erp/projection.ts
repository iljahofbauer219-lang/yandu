import type { CurrentUser } from '../../plugins/auth.js'

/**
 * 规格 §2.2 敏感字段：运营角色（无 erp.source.view）在服务端 SQL 投影层即不 SELECT，
 * API 返回的 JSON 里根本不出现这些键（防止 F12 抓包）。
 */
export const ERP_SOURCE_SENSITIVE_FIELDS = [
  'supplierId',
  'sourceUrl',
  'sourceProductId',
  'sourceSku',
  'collectedBy',
  'crawlConfig',
  'supplier'
] as const

export type ErpSourceSensitiveField = (typeof ERP_SOURCE_SENSITIVE_FIELDS)[number]

/** 是否可见货盘来源敏感字段：主帐号或持有 erp.source.view（采集专员） */
export function canViewErpSource(user: Pick<CurrentUser, 'isOwner' | 'permissions'>): boolean {
  return user.isOwner || user.permissions.has('erp.source.view')
}

/** Prisma select 白名单：敏感列在 SQL 层就不取（仅 API 响应路径使用） */
export function erpProductSelect(user: Pick<CurrentUser, 'isOwner' | 'permissions'>) {
  const canView = canViewErpSource(user)
  const base = {
    id: true,
    orgId: true,
    titleOriginal: true,
    descriptionOriginal: true,
    costPrice: true,
    shippingCost: true,
    currency: true,
    stockQuantity: true,
    dimensions: true,
    weight: true,
    material: true,
    color: true,
    brand: true,
    category: true,
    variants: true,
    status: true,
    changeFlag: true,
    lastCrawledAt: true,
    createdAt: true,
    updatedAt: true,
    images: {
      select: {
        id: true,
        imageType: true,
        // 图片外链同属货盘来源敏感信息：SQL 层就不取。此前无条件 SELECT 使运营角色
        // 能经 resolveImageViews 的 url 回落、download-jobs、导出等旁路拿到原值外链。
        ...(canView ? { sourceUrl: true } : {}),
        localPath: true,
        platform: true,
        isSelected: true,
        sortOrder: true
      },
      orderBy: { sortOrder: 'asc' as const }
    }
  }
  if (!canView) return base
  return {
    ...base,
    supplierId: true,
    sourceUrl: true,
    sourceProductId: true,
    sourceSku: true,
    collectedBy: true,
    crawlConfig: true,
    supplier: { select: { id: true, code: true, name: true, patrolChannel: true } }
  }
}

/** 兜底剥离：对任意已取出的产品行按角色移除敏感键（用于非 select 路径与测试断言） */
export function stripErpSourceFields<T extends Record<string, unknown>>(
  row: T,
  user: Pick<CurrentUser, 'isOwner' | 'permissions'>
): Partial<T> {
  if (canViewErpSource(user)) return row
  const copy: Record<string, unknown> = { ...row }
  for (const field of ERP_SOURCE_SENSITIVE_FIELDS) delete copy[field]
  return copy as Partial<T>
}

// ─── 下载任务失败明细红化 ─────────────────────────────────────────────
// erp_download_jobs.failed_urls 是裸 Json 列，历史上写入过货盘图片外链原值；
// 该列与 error 列对任何持 erp.warehouse.view 的角色可读，构成对 §2.2 SQL 层剥离的旁路。
// 写入方已改存图片行主键，这里提供读时红化作为纵深防御（并兜住存量毒数据与脏 Json）。

const EXTERNAL_URL_TOKEN = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//
const EXTERNAL_URL_ANYWHERE = /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+/g

/** 判定字符串是否为外链 URL token（scheme:// 前缀） */
export function isExternalUrlToken(value: string): boolean {
  return EXTERNAL_URL_TOKEN.test(value)
}

/**
 * failed_urls 读时红化：新写入方存图片行主键（cuid），历史毒数据是原值外链。
 * 含 scheme:// 的条目 → '[REDACTED]'；其余（imageId 等）原样 String 化；非数组 → []。
 */
export function redactFailedUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map(item => {
    const text = String(item)
    return isExternalUrlToken(text) ? '[REDACTED]' : text
  })
}

/** error 文本红化：fetch/undici 等异常 message 可能携带主机或 URL 片段 */
export function redactErrorText(message: string): string {
  return (message ?? '').replace(EXTERNAL_URL_ANYWHERE, '[REDACTED]')
}
