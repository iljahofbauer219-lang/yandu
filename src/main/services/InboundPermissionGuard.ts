/**
 * 入库写操作的主进程权限强校验（spec 2026-09-29-inbound-gate-before-warehouse §6.2）。
 * UI 隐藏不算验证：confirm/reject/reedit/return/erpIntake 执行前必须经服务器 capabilities 确认 erp.warehouse.edit。
 */
import { readServerUrl } from '../serverConfig'

const TTL_MS = 60_000
const cache = new Map<string, { canEdit: boolean; fetchedAt: number }>()

export function clearInboundPermissionCache(): void {
  cache.clear()
}

const NO_PERMISSION = '无入库处理权限（需 erp.warehouse.edit）'
const VERIFY_FAILED = '权限校验失败，请检查网络后重试'

export async function requireInboundEditPermission(accessToken: string): Promise<void> {
  if (!accessToken) throw new Error('登录状态缺失，请重新登录后重试')
  const fingerprint = accessToken.slice(-24)
  const hit = cache.get(fingerprint)
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) {
    if (!hit.canEdit) throw new Error(NO_PERMISSION)
    return
  }
  let canEdit: boolean
  try {
    const response = await fetch(`${readServerUrl()}/api/erp/capabilities`, { headers: { authorization: `Bearer ${accessToken}` } })
    if (response.status === 401) throw new Error('SERVER_SESSION_EXPIRED')
    if (response.status === 403) canEdit = false
    else if (!response.ok) throw new Error(VERIFY_FAILED)
    else canEdit = ((await response.json()) as { canEdit?: boolean }).canEdit === true
  } catch (error) {
    if (error instanceof Error && error.message === 'SERVER_SESSION_EXPIRED') throw error
    throw new Error(VERIFY_FAILED)
  }
  cache.set(fingerprint, { canEdit, fetchedAt: Date.now() })
  if (!canEdit) throw new Error(NO_PERMISSION)
}
