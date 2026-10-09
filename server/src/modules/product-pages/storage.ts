/**
 * 产品页落盘存储：重下载「同商品只留最新一批」语义。
 *  - writePageAtomic：新批次先写 ~staging 暂存目录，全部写成功后才删旧目录并 rename 接管；
 *    写失败仅清理暂存目录，旧批次原样保留（避免「先删后写」中途失败丢旧文件）。
 *  - findProductPages / pruneProductPages：按 meta.json 的 orgId+warehouseProductId 归属，
 *    定位同商品历史孤儿目录并在新一批落盘成功后删除。
 * 暂存目录名前缀 ~ 不在 PAGE_ID_PATTERN 内：公开路由 assertPageId 直接 400，列表也会跳过。
 */
import fsp from 'node:fs/promises'
import path from 'node:path'

export const PRODUCT_PAGE_DIR_PATTERN = /^[A-Za-z0-9._-]{1,120}$/

async function pathExists(target: string): Promise<boolean> {
  try {
    await fsp.access(target)
    return true
  } catch {
    return false
  }
}

export async function readMeta(dir: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fsp.readFile(path.join(dir, 'meta.json'), 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

export async function findProductPages(root: string, orgId: string, warehouseProductId: string): Promise<string[]> {
  if (!(await pathExists(root))) return []
  const entries = await fsp.readdir(root, { withFileTypes: true })
  const matched: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !PRODUCT_PAGE_DIR_PATTERN.test(entry.name)) continue
    const meta = await readMeta(path.join(root, entry.name))
    if (meta && meta.orgId === orgId && meta.warehouseProductId === warehouseProductId) matched.push(entry.name)
  }
  return matched.sort()
}

export async function pruneProductPages(root: string, orgId: string, warehouseProductId: string, keepPageId: string): Promise<string[]> {
  const matched = await findProductPages(root, orgId, warehouseProductId)
  const removed: string[] = []
  for (const name of matched) {
    if (name === keepPageId) continue
    await fsp.rm(path.join(root, name), { recursive: true, force: true })
    removed.push(name)
  }
  return removed
}

export async function writePageAtomic(root: string, pageId: string, write: (stagingDir: string) => Promise<void>): Promise<void> {
  const finalDir = path.join(root, pageId)
  const staging = path.join(root, `~staging-${pageId}-${process.pid}-${Date.now().toString(36)}`)
  await fsp.rm(staging, { recursive: true, force: true })
  await fsp.mkdir(path.join(staging, 'assets'), { recursive: true })
  try {
    await write(staging)
    await fsp.rm(finalDir, { recursive: true, force: true })
    await fsp.rename(staging, finalDir)
  } catch (error) {
    await fsp.rm(staging, { recursive: true, force: true })
    throw error
  }
}
