/**
 * ERP 巡盘面板（P5 / M6 渲染层）：
 *   - ChangesPanel：待确认变更（change_flag=1）列表，字段级 diff，已发布产品标红，APPLY 采纳 / DISMISS 忽略；
 *   - NotificationsPanel：通知中心（PATROL_CHANGE/PATROL_URGENT/MORNING_SUMMARY），紧急标红、单条/全部已读、
 *     手动生成早间汇总、手动触发巡盘（防风控分批/并发）。
 * 数据经 /api/erp/changes、/api/erp/notifications、/api/erp/patrol/run，服务端按 RBAC 鉴权。
 */
import { useCallback, useEffect, useState } from 'react'
import {
  ERP_STATUS_LABELS,
  fetchErpChanges,
  fetchErpNotifications,
  generateErpMorningSummary,
  markAllErpNotificationsRead,
  markErpNotificationRead,
  resolveErpChange,
  runErpPatrol,
  type ErpChangeItem,
  type ErpNotificationView
} from './erpApi'

const FIELD_LABELS: Record<string, string> = {
  titleOriginal: '原始标题',
  costPrice: '成本价',
  shippingCost: '运费',
  stockQuantity: '库存',
  weight: '重量',
  material: '材质',
  color: '颜色',
  brand: '品牌',
  category: '类目'
}

const NOTIFICATION_KIND_LABELS: Record<string, string> = {
  PATROL_CHANGE: '货盘变更',
  PATROL_URGENT: '紧急变更',
  MORNING_SUMMARY: '早间汇总'
}

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field
}

export function ChangesPanel({ canResolve, onOpenProduct }: { canResolve: boolean; onOpenProduct: (productId: string) => void }) {
  const [items, setItems] = useState<ErpChangeItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await fetchErpChanges({ pageSize: 100 })
      setItems(result.items)
      setTotal(result.total)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const resolve = async (productId: string, action: 'APPLY' | 'DISMISS') => {
    setNotice('')
    setError('')
    try {
      const result = await resolveErpChange(productId, action)
      setNotice(action === 'APPLY'
        ? `已采纳 ${result.applied.length ? result.applied.map(fieldLabel).join('、') : '变更'} 并写入产品`
        : '已忽略该变更（保留产品原值）')
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '确认失败')
    }
  }

  return (
    <div className="erp-changes-panel">
      <div className="erp-warehouse-toolbar">
        <button type="button" className="ghost-button" onClick={() => void load()} disabled={loading}>{loading ? '加载中…' : '刷新'}</button>
        <span className="erp-warehouse-count">待确认变更 {total} 项</span>
        {!canResolve && <span className="erp-hint">当前角色仅可查看，变更确认需「运营」权限</span>}
      </div>
      {error && <div className="erp-banner erp-banner-error">{error}</div>}
      {notice && <div className="erp-banner erp-banner-ok">{notice}</div>}
      {items.length === 0 && !loading ? (
        <p className="dashboard-empty">暂无待确认变更（巡盘检测到货盘改价/改库存后会在此列出）</p>
      ) : (
        <ul className="erp-change-list">
          {items.map(item => (
            <li key={item.productId} className={`erp-change-card${item.published ? ' erp-change-urgent' : ''}`}>
              <div className="erp-change-head">
                <b onClick={() => onOpenProduct(item.productId)} className="erp-row-clickable">{item.titleOriginal || '（无标题）'}</b>
                <em className={`erp-status erp-status-${item.status.toLowerCase()}`}>{ERP_STATUS_LABELS[item.status] ?? item.status}</em>
                {item.published && <em className="erp-tag erp-tag-urgent">已发布·标红</em>}
              </div>
              <table className="erp-change-diff">
                <thead>
                  <tr><th>字段</th><th>原值</th><th>货盘新值</th></tr>
                </thead>
                <tbody>
                  {item.changes.map(change => (
                    <tr key={change.id}>
                      <td>{fieldLabel(change.field)}</td>
                      <td className="erp-diff-old">{change.oldValue || '—'}</td>
                      <td className="erp-diff-new">{change.newValue || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="erp-change-actions">
                <button type="button" className="primary-button" disabled={!canResolve} onClick={() => void resolve(item.productId, 'APPLY')}>采纳新值</button>
                <button type="button" className="ghost-button" disabled={!canResolve} onClick={() => void resolve(item.productId, 'DISMISS')}>忽略</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function NotificationsPanel({ canResolve }: { canResolve: boolean }) {
  const [items, setItems] = useState<ErpNotificationView[]>([])
  const [unread, setUnread] = useState(0)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [patrolBusy, setPatrolBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await fetchErpNotifications({ unreadOnly, pageSize: 100 })
      setItems(result.items)
      setUnread(result.unread)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [unreadOnly])

  useEffect(() => { void load() }, [load])

  const markRead = async (id: string) => {
    try { await markErpNotificationRead(id); await load() } catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败') }
  }

  const markAll = async () => {
    try { await markAllErpNotificationsRead(); await load() } catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败') }
  }

  const summarize = async () => {
    setNotice(''); setError('')
    try {
      const summary = await generateErpMorningSummary()
      setNotice(`早间汇总已生成：${summary.totalChanges} 项变更，${summary.urgentChanges} 项紧急，${summary.pendingProducts} 个待确认`)
      await load()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '生成汇总失败') }
  }

  const patrol = async () => {
    setNotice(''); setError(''); setPatrolBusy(true)
    try {
      const result = await runErpPatrol({})
      setNotice(`巡盘完成：扫描 ${result.scanned}，SERVER ${result.serverChannel} / CLIENT ${result.clientChannel}，变更 ${result.changed}，紧急 ${result.urgent}（峰值并发 ${result.pool.peakConcurrency}/${result.plan.concurrency}）`)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '巡盘失败')
    } finally {
      setPatrolBusy(false)
    }
  }

  return (
    <div className="erp-notifications-panel">
      <div className="erp-warehouse-toolbar">
        <label className="erp-checkbox">
          <input type="checkbox" checked={unreadOnly} onChange={event => setUnreadOnly(event.target.checked)} />
          仅看未读
        </label>
        <button type="button" className="ghost-button" onClick={() => void load()} disabled={loading}>{loading ? '加载中…' : '刷新'}</button>
        <button type="button" className="ghost-button" onClick={() => void markAll()}>全部已读</button>
        <button type="button" className="ghost-button" onClick={() => void summarize()}>生成早间汇总</button>
        {canResolve && <button type="button" className="primary-button" onClick={() => void patrol()} disabled={patrolBusy}>{patrolBusy ? '巡盘中…' : '立即巡盘'}</button>}
        <span className="erp-warehouse-count">未读 {unread}</span>
      </div>
      {error && <div className="erp-banner erp-banner-error">{error}</div>}
      {notice && <div className="erp-banner erp-banner-ok">{notice}</div>}
      {items.length === 0 && !loading ? (
        <p className="dashboard-empty">暂无通知</p>
      ) : (
        <ul className="erp-notification-list">
          {items.map(item => (
            <li key={item.id} className={`erp-notification${item.urgent ? ' erp-notification-urgent' : ''}${item.read ? ' erp-notification-read' : ''}`}>
              <div className="erp-notification-main">
                <em className="erp-tag">{NOTIFICATION_KIND_LABELS[item.kind] ?? item.kind}</em>
                {item.urgent && <em className="erp-tag erp-tag-urgent">标红</em>}
                <span className="erp-notification-title">{item.title}</span>
              </div>
              <div className="erp-notification-meta">
                <small>{new Date(item.createdAt).toLocaleString()}</small>
                {!item.read && <button type="button" className="link-button" onClick={() => void markRead(item.id)}>标记已读</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
