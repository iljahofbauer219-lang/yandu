/**
 * ERP 采集工作台（方案 M1 + §3 数据流 1）。
 * 流程：选货盘 → 打开内嵌浏览器并注入 crawl_rules 采集器 → 轮询 outbox 累积待采条目
 *      → 确认采集 POST /api/erp/collect（去重三态）→ NEEDS_CONFIRM 弹覆盖确认 → 结果回写注入 UI。
 * 批量采集在注入侧只写 outbox、主进程轮询回收，不阻塞内嵌浏览器交互。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  collectErp,
  fetchErpSuppliers,
  type ErpCollectItemInput,
  type ErpCollectItemResult,
  type ErpSupplierView
} from './erpApi'

interface PendingItem extends ErpCollectItemInput {
  capturedAt: string
}

function domainsOf(supplier: ErpSupplierView): string[] {
  const fromRules = (supplier.crawlRules as { domains?: unknown })?.domains
  if (Array.isArray(fromRules)) {
    const list = fromRules.map(value => String(value).trim()).filter(Boolean)
    if (list.length) return list
  }
  try {
    const host = new URL(supplier.loginUrl).hostname
    return [host.replace(/^www\./, '')]
  } catch {
    return []
  }
}

const RESULT_LABELS: Record<string, string> = {
  CREATED: '新建采集',
  OVERWRITTEN: '已覆盖',
  CHANGE_FLAGGED: '标记变更',
  NEEDS_CONFIRM: '待确认覆盖',
  UNCHANGED: '无变化'
}

export function CollectWorkbench({ onBack, onOpenPool }: { onBack: () => void; onOpenPool: () => void }) {
  const [suppliers, setSuppliers] = useState<ErpSupplierView[]>([])
  const [activeSupplier, setActiveSupplier] = useState<ErpSupplierView | null>(null)
  const [collecting, setCollecting] = useState(false)
  const [pending, setPending] = useState<PendingItem[]>([])
  const [lastResults, setLastResults] = useState<ErpCollectItemResult[]>([])
  const [confirmItems, setConfirmItems] = useState<ErpCollectItemResult[] | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const pollRef = useRef<number | null>(null)

  useEffect(() => {
    let alive = true
    fetchErpSuppliers()
      .then(list => { if (alive) setSuppliers(list) })
      .catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : '加载货盘失败') })
    return () => { alive = false }
  }, [])

  // 卸载时停止注入并关闭内嵌浏览器
  useEffect(() => () => {
    if (pollRef.current) window.clearInterval(pollRef.current)
    void window.desktop?.erp?.stopCollector?.()
  }, [])

  const startCollect = useCallback(async (supplier: ErpSupplierView) => {
    setError('')
    setNotice('')
    const domains = domainsOf(supplier)
    if (!domains.length) {
      setError(`货盘「${supplier.name}」未配置采集域名，请先在抓取规则中填写 domains 或 loginUrl`)
      return
    }
    try {
      await window.desktop.browser.show('web')
      if (supplier.loginUrl) await window.desktop.browser.navigate('web', supplier.loginUrl)
      await window.desktop.erp.injectCollector(
        { id: supplier.id, code: supplier.code, name: supplier.name, domains },
        supplier.crawlRules ?? {}
      )
      setActiveSupplier(supplier)
      setCollecting(true)
      setPending([])
      setLastResults([])
      setNotice(`已启动「${supplier.name}」采集：在右侧页面点击「🤖 采集此产品」或勾选列表卡片后批量采集`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '启动采集失败')
    }
  }, [])

  // outbox 轮询：每 1.5s 回收注入侧采集条目，按 sourceProductId 去重累积
  useEffect(() => {
    if (!collecting) return
    pollRef.current = window.setInterval(() => {
      void window.desktop.erp.drainOutbox().then(drain => {
        if (!drain.active || !drain.items.length) return
        setPending(prev => {
          const map = new Map(prev.map(item => [item.sourceProductId, item]))
          for (const raw of drain.items) {
            const item = raw as ErpCollectItemInput
            if (!item?.sourceProductId) continue
            map.set(item.sourceProductId, { ...item, capturedAt: new Date().toISOString() })
          }
          return [...map.values()]
        })
      }).catch(() => { /* 页面切换时忽略单次轮询失败 */ })
    }, 1500)
    return () => { if (pollRef.current) window.clearInterval(pollRef.current) }
  }, [collecting])

  const stopCollect = useCallback(async () => {
    if (pollRef.current) window.clearInterval(pollRef.current)
    await window.desktop.erp.stopCollector()
    setCollecting(false)
    setActiveSupplier(null)
    setNotice('已停止采集')
  }, [])

  const applyResults = useCallback((items: ErpCollectItemResult[]) => {
    setLastResults(items)
    const doneIds = new Set(items.filter(i => i.result !== 'NEEDS_CONFIRM').map(i => i.sourceProductId))
    if (doneIds.size) {
      setPending(prev => prev.filter(item => !doneIds.has(item.sourceProductId)))
      void window.desktop.erp.syncStates(items.filter(i => i.productId).map(i => ({ id: i.sourceProductId, state: i.result })))
    }
  }, [])

  const submit = useCallback(async (items: ErpCollectItemInput[], overwrite: boolean) => {
    setError('')
    try {
      const result = await collectErp(items, overwrite)
      const needsConfirm = result.items.filter(i => i.result === 'NEEDS_CONFIRM')
      applyResults(result.items)
      if (!overwrite && needsConfirm.length) {
        setConfirmItems(needsConfirm)
        setNotice(`${needsConfirm.length} 件为已采集未加工产品，需确认是否覆盖`)
      } else {
        const summary = `新建 ${result.created} · 覆盖 ${result.overwritten} · 标记变更 ${result.changeFlagged} · 无变化 ${result.unchanged}`
        setNotice(`采集完成：${summary}`)
      }
      return result
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '采集入库失败')
      return null
    }
  }, [applyResults])

  const confirmOverwrite = useCallback(async () => {
    if (!confirmItems) return
    const ids = new Set(confirmItems.map(i => i.sourceProductId))
    const targets = pending.filter(item => ids.has(item.sourceProductId))
    setConfirmItems(null)
    await submit(targets, true)
  }, [confirmItems, pending, submit])

  const pendingCount = pending.length
  const supplierOptions = useMemo(() => suppliers, [suppliers])

  return (
    <section className="ai-crossborder-page erp-collect-workbench">
      <div className="ai-crossborder-header">
        <div>
          <h2>ERP 采集工作台</h2>
          <p>选择货盘 → 内嵌浏览器注入采集器 → 确认入库（去重/覆盖/变更标记三态）</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="ghost-button" onClick={onOpenPool}>采集池</button>
          <button type="button" className="ghost-button" onClick={onBack}>返回</button>
        </div>
      </div>

      {error && <div className="erp-banner erp-banner-error">{error}</div>}
      {notice && !error && <div className="erp-banner erp-banner-info">{notice}</div>}

      {!collecting ? (
        <div className="ai-crossborder-entries">
          {supplierOptions.length === 0 && <p className="dashboard-empty">暂无货盘，请先由采集专员在货盘管理中配置 crawl_rules</p>}
          {supplierOptions.map(supplier => (
            <div className="ai-crossborder-card clickable" key={supplier.id} onClick={() => void startCollect(supplier)}>
              <b>{supplier.name}</b>
              <small>{supplier.code} · {supplier.patrolChannel === 'CLIENT' ? '客户端巡盘' : '服务器巡盘'}</small>
              <em className="ready">进入采集</em>
            </div>
          ))}
        </div>
      ) : (
        <div className="erp-collect-panel">
          <div className="erp-collect-toolbar">
            <span>正在采集：<b>{activeSupplier?.name}</b></span>
            <span className="erp-collect-count">待采 {pendingCount} 件</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button type="button" className="primary-button" disabled={pendingCount === 0} onClick={() => void submit(pending, false)}>确认采集 {pendingCount} 件</button>
              <button type="button" className="ghost-button" onClick={() => void stopCollect()}>停止采集</button>
            </div>
          </div>
          <div className="erp-collect-hint">在右侧内嵌浏览器中：详情页点「🤖 采集此产品」，列表页勾选卡片后点「采集选中」。采集为异步回收，不会阻塞页面浏览。</div>
          <ul className="erp-pending-list">
            {pending.map(item => (
              <li key={item.sourceProductId}>
                <b>{item.titleOriginal || item.sourceProductId}</b>
                <small>{item.sourceProductId}{item.costPrice != null ? ` · ¥${item.costPrice}` : ''}{item.images?.length ? ` · ${item.images.length} 图` : ''}</small>
              </li>
            ))}
            {pending.length === 0 && <li className="erp-pending-empty">尚无待采条目，请在右侧页面点击采集按钮</li>}
          </ul>
          {lastResults.length > 0 && (
            <div className="erp-result-list">
              <div className="dashboard-section-title"><b>最近采集结果</b><small>去重三态</small></div>
              {lastResults.map(result => (
                <article key={result.sourceProductId}>
                  <span>{result.sourceProductId}</span>
                  <em className={`erp-tag erp-tag-${result.result.toLowerCase()}`}>{RESULT_LABELS[result.result] ?? result.result}</em>
                  {result.diff.length > 0 && <small>{result.diff.map(d => d.field).join('、')}</small>}
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {confirmItems && (
        <div className="erp-modal-mask" role="dialog" aria-modal="true">
          <div className="erp-modal">
            <h3>覆盖确认</h3>
            <p>以下 {confirmItems.length} 件产品已采集但未加工，再次采集将覆盖原有内容：</p>
            <ul className="erp-confirm-list">
              {confirmItems.map(item => (
                <li key={item.sourceProductId}>
                  <b>{item.sourceProductId}</b>
                  <ul>{item.diff.map(d => <li key={d.field}><code>{d.field}</code>：{d.oldValue || '（空）'} → {d.newValue || '（空）'}</li>)}</ul>
                </li>
              ))}
            </ul>
            <div className="erp-modal-actions">
              <button type="button" className="ghost-button" onClick={() => setConfirmItems(null)}>取消</button>
              <button type="button" className="primary-button" onClick={() => void confirmOverwrite()}>确认覆盖</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
