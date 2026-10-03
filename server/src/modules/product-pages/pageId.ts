import crypto from 'node:crypto'

/**
 * 生成不可猜的公开页 id。
 * 旧实现用 safeSegment(warehouseProductId) 作 id，既不含 orgId（跨组织互撞且 rmSync 会删掉别人的页面），
 * 又可被枚举（公开端点无需登录）。改为随机 id 后，公开 URL 不再可从商品 id 推导。
 * base64url 字符集落在 assertPageId 的 ^[A-Za-z0-9._-]{1,120}$ 白名单内。
 */
export function newPageId(): string {
  return crypto.randomBytes(12).toString('base64url')
}
