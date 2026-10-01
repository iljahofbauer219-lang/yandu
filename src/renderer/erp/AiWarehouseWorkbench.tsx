/**
 * AI 仓库工作台（方案 §2 渲染进程：替换图片1占位页）。
 * tabs：采集池（COLLECTED）/ 产品库（全部）/ 待确认变更（change_flag=1）/ 巡盘日志（P5 落地）。
 * 列表数据经 GET /api/erp/products，服务端按角色投影：运营看不到货盘来源敏感字段。
 */
import { useCallback, useEffect, useState } from 'react'
import {
  ERP_STATUS_LABELS,
  fetchErpCapabilities,
  fetchErpProducts,
  type ErpCapabilities,
  type ErpProductView
} from './erpApi'
import { ProductDetailDrawer } from './ProductDetailDrawer'
import { ChangesPanel, NotificationsPanel } from './PatrolPanels'

type WarehouseTab = 'pool' | 'products' | 'changes' | 'patrol'

/** 列表分页大小（服务端 pageSize 上限 100） */
const PAGE_SIZE = 100

const TAB_LABELS: Record<WarehouseTab, string> = {
  pool: '采集池',
  products: '产品库',
  changes: '待确认变更',
  patrol: '通知中心'
}

export function AiWarehouseWorkbench({ onEnterCollect }: { onEnterCollect: () => void }) {
  const [tab, setTab] = useState<WarehouseTab>('pool')
  const [caps, setCaps] = useState<ErpCapabilities | null>(null)
  const [items, setItems] = useState<ErpProductView[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  // 防抖后的关键词：请求只依赖它，避免每键一请求
  const [debouncedQ, setDebouncedQ] = useState('')
  const [page, setPage] = useState(1)
  const [detailId, setDetailId] = useState<string | null>(null)

  useEffect(() => {
    fetchErpCapabilities().then(setCaps).catch(() => { /* 能力摘要失败不阻塞列表 */ })
  }, [])

  // 搜索 300ms 防抖：定时器在下次输入与组件卸载时清理
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(q), 300)
    return () => window.clearTimeout(timer)
  }, [q])

  // 切换 tab 或关键词变化时回到第 1 页
  useEffect(() => { setPage(1) }, [tab, debouncedQ])

  const load = useCallback(async () => {
    // 变更确认/通知中心为独立面板（走 /changes 与 /notifications），不需产品列表
    if (tab === 'changes' || tab === 'patrol') {
      setItems([])
      setTotal(0)
      return
    }
    setLoading(true)
    setError('')
    try {
      const query: { status?: string; q?: string; page?: number; pageSize?: number } = { page, pageSize: PAGE_SIZE }
      if (tab === 'pool') query.status = 'COLLECTED'
      if (debouncedQ.trim()) query.q = debouncedQ.trim()
      const result = await fetchErpProducts(query)
      setItems(result.items)
      setTotal(result.total)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [tab, debouncedQ, page])

  useEffect(() => { void load() }, [load])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const canCollect = caps?.canCollect ?? false
  const canViewSource = caps?.canViewSource ?? false
  const canEdit = caps?.canEdit ?? false
  const canResolve = caps?.canResolveChanges ?? false

  return (
    <section className="ai-crossborder-page erp-warehouse-workbench">
      <div className="ai-crossborder-header">
        <div>
          <h2>AI 仓库</h2>
          <p>ERP 产品仓库工作台：采集池 / 产品库 / 待确认变更 / 通知中心</p>
        </div>
        {canCollect && <button type="button" className="primary-button" onClick={onEnterCollect}>进入采集工作台</button>}
      </div>

      <div className="selection-module-nav warehouse-flow-nav">
        {(Object.keys(TAB_LABELS) as WarehouseTab[]).map(key => (
          <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
            <span>{TAB_LABELS[key]}</span>
            {(key === 'pool' || key === 'products') && key === tab && total > 0 && <em>{total}</em>}
          </button>
        ))}
      </div>

      {(tab === 'pool' || tab === 'products') && (
        <div className="erp-warehouse-toolbar">
          <input
            className="erp-search"
            type="search"
            placeholder="按原始标题搜索…"
            value={q}
            onChange={event => setQ(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') setDebouncedQ(q) }}
          />
          <button type="button" className="ghost-button" onClick={() => void load()} disabled={loading}>{loading ? '加载中…' : '刷新'}</button>
          <span className="erp-warehouse-count">共 {items.length} 件</span>
        </div>
      )}

      {error && <div className="erp-banner erp-banner-error">{error}</div>}

      {tab === 'changes' ? (
        <ChangesPanel canResolve={canResolve} onOpenProduct={setDetailId} />
      ) : tab === 'patrol' ? (
        <NotificationsPanel canResolve={canResolve} />
      ) : items.length === 0 && !loading ? (
        <p className="dashboard-empty">{tab === 'pool' ? '采集池为空，进入采集工作台开始采集' : '产品库为空'}</p>
      ) : (
        <div className="erp-product-table-wrap">
          <table className="erp-product-table">
            <thead>
              <tr>
                <th>产品</th>
                {canViewSource && <th>货盘</th>}
                {canViewSource && <th>货盘SKU</th>}
                <th>成本价</th>
                <th>库存</th>
                <th>图片</th>
                <th>入库</th>
                <th>状态</th>
                <th>变更</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const localCount = item.images?.filter(image => image.localPath).length ?? 0
                const imageCount = item.images?.length ?? 0
                return (
                <tr key={item.id} className="erp-row-clickable" onClick={() => setDetailId(item.id)}>
                  <td>
                    <b>{item.titleOriginal || '（无标题）'}</b>
                    {canViewSource && item.sourceUrl && <small>{item.sourceProductId || item.sourceUrl}</small>}
                  </td>
                  {canViewSource && <td>{item.supplier?.name ?? '—'}</td>}
                  {canViewSource && <td>{item.sourceSku || '—'}</td>}
                  <td>{item.costPrice != null ? `${item.currency} ${item.costPrice}` : '—'}</td>
                  <td>{item.stockQuantity ?? '—'}</td>
                  <td>{imageCount}</td>
                  <td>
                    {imageCount === 0 ? '—' : localCount === imageCount
                      ? <em className="erp-tag erp-tag-created">已入库</em>
                      : <em className="erp-tag erp-tag-needs_confirm">{localCount}/{imageCount}</em>}
                  </td>
                  <td><em className={`erp-status erp-status-${item.status.toLowerCase()}`}>{ERP_STATUS_LABELS[item.status] ?? item.status}</em></td>
                  <td>{item.changeFlag === 1 ? <em className="erp-tag erp-tag-change_flagged">变更</em> : '—'}</td>
                </tr>
                )
              })}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div className="erp-warehouse-toolbar">
              <button type="button" className="ghost-button" disabled={loading || page <= 1} onClick={() => setPage(current => Math.max(1, current - 1))}>上一页</button>
              <span className="erp-warehouse-count">第 {page} / {totalPages} 页 · 共 {total} 件</span>
              <button type="button" className="ghost-button" disabled={loading || page >= totalPages} onClick={() => setPage(current => Math.min(totalPages, current + 1))}>下一页</button>
            </div>
          )}
        </div>
      )}

      {detailId && (
        <ProductDetailDrawer
          productId={detailId}
          canEdit={canEdit}
          canPricing={caps?.canPricing ?? false}
          canViewSource={canViewSource}
          onClose={() => setDetailId(null)}
          onChanged={() => void load()}
        />
      )}
    </section>
  )
}
