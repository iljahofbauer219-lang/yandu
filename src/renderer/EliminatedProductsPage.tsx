/**
 * 淘汰产品收录追踪页：集中管理所有被淘汰商品（优选产品 / 采集侯选两个来源）。
 * 支持搜索、平台/来源/状态筛选、批量重新启用与批量删除记录、采集预检查过滤开关。
 * 数据经 window.desktop.eliminations.* IPC 读写本地 SQLite eliminated_products 表。
 */
import { useEffect, useMemo, useState } from 'react'
import type { EliminatedProductRecord } from '../shared/contracts'
import './eliminated-products.css'

export default function EliminatedProductsPage({ onBack, onDataChange }: { onBack: () => void; onDataChange?: () => void | Promise<void> }) {
  const [records, setRecords] = useState<EliminatedProductRecord[]>([])
  const [query, setQuery] = useState('')
  const [platform, setPlatform] = useState('ALL')
  const [origin, setOrigin] = useState<'ALL' | 'SELECTION' | 'CANDIDATE'>('ALL')
  const [status, setStatus] = useState<'ALL' | 'ACTIVE' | 'REENABLED'>('ACTIVE')
  const [batchMode, setBatchMode] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [filterOn, setFilterOn] = useState(true)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')

  const reload = async () => {
    try {
      const [nextRecords, setting] = await Promise.all([
        window.desktop.eliminations.list(),
        window.desktop.eliminations.getSetting('filter_on_precheck')
      ])
      setRecords(nextRecords)
      setFilterOn(setting === '1')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '淘汰记录加载失败')
    }
  }
  useEffect(() => { void reload() }, [])

  const normalized = query.trim().toLocaleLowerCase()
  const platforms = useMemo(() => [...new Set(records.map(item => item.platformCode))].sort(), [records])
  const visible = records.filter(item =>
    (status === 'ALL' || item.status === status)
    && (platform === 'ALL' || item.platformCode === platform)
    && (origin === 'ALL' || item.origin === origin)
    && (!normalized || `${item.title} ${item.sourceUrl} ${item.platformCode} ${item.operator}`.toLocaleLowerCase().includes(normalized)))
  const monthPrefix = new Date().toISOString().slice(0, 7)
  const countBy = (value: 'ACTIVE' | 'REENABLED') => records.filter(item => item.status === value).length
  const toggleCheck = (id: string) => setChecked(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })

  const run = async (label: string, action: () => Promise<unknown>, success: string) => {
    setBusy(label)
    setNotice('')
    try {
      await action()
      await reload()
      await onDataChange?.()
      setChecked(new Set())
      setNotice(success)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `${label}失败`)
    } finally {
      setBusy('')
    }
  }
  const reenable = (record: EliminatedProductRecord) => run('重新启用', () => window.desktop.eliminations.reenable(record.id), `已重新启用：${record.title || record.sourceUrl}`)
  const removeOne = (record: EliminatedProductRecord) => {
    if (!window.confirm(`确定删除这条淘汰记录吗？\n${record.title || record.sourceUrl}\n\n删除后该商品不再受淘汰预检查保护，可能被再次采集。`)) return Promise.resolve()
    return run('删除记录', () => window.desktop.eliminations.delete([record.id]), '淘汰记录已删除')
  }
  // 批量重新启用为逐条 IPC（非原子）：用 allSettled 统计真实成功数，文案按实际结果报告
  const batchReenable = async () => {
    const ids = [...checked]
    setBusy('批量重新启用')
    setNotice('')
    try {
      const results = await Promise.allSettled(ids.map(id => window.desktop.eliminations.reenable(id)))
      const succeeded = results.filter(result => result.status === 'fulfilled').length
      const firstFailure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      await reload()
      await onDataChange?.()
      setChecked(new Set())
      setNotice(succeeded === ids.length
        ? `已重新启用 ${succeeded} 个商品`
        : `已重新启用 ${succeeded}/${ids.length} 个商品，${ids.length - succeeded} 个失败${firstFailure ? `：${firstFailure.reason instanceof Error ? firstFailure.reason.message : String(firstFailure.reason)}` : ''}`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '批量重新启用失败')
    } finally {
      setBusy('')
    }
  }
  const batchRemove = () => {
    if (!window.confirm(`确定删除选中的 ${checked.size} 条淘汰记录吗？删除后对应商品不再受淘汰预检查保护。`)) return Promise.resolve()
    return run('批量删除', () => window.desktop.eliminations.delete([...checked]), `已删除 ${checked.size} 条淘汰记录`)
  }
  const toggleFilter = async () => {
    const next = !filterOn
    setFilterOn(next)
    await window.desktop.eliminations.setSetting('filter_on_precheck', next ? '1' : '0')
  }
  const formatTime = (value: string) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

  return <section className="eliminated-page">
    <div className="eliminated-heading">
      <div><small>ELIMINATION TRACKING</small><h2>淘汰产品</h2><p>商品淘汰全量追踪：主要针对采集侯选环节，优选产品同样支持；防重复采集 · 可追溯 · 可重新启用</p></div>
      <label className={`eliminated-filter-toggle${filterOn ? ' on' : ''}`} title="开启后，采集预检查会自动过滤处于淘汰生效期的商品">
        <input type="checkbox" checked={filterOn} onChange={() => void toggleFilter()} />采集预检查自动过滤已淘汰
      </label>
    </div>
    {notice && <div className="eliminated-notice">{notice}</div>}
    <div className="eliminated-stats">
      <button className={status === 'ACTIVE' ? 'active' : ''} onClick={() => setStatus('ACTIVE')}><b>{countBy('ACTIVE')}</b><small>淘汰生效中</small></button>
      <button className={status === 'REENABLED' ? 'active' : ''} onClick={() => setStatus('REENABLED')}><b>{countBy('REENABLED')}</b><small>已重新启用</small></button>
      <button className={status === 'ALL' ? 'active' : ''} onClick={() => setStatus('ALL')}><b>{records.length}</b><small>全部记录</small></button>
      <button onClick={onBack}><b>{records.filter(item => item.eliminatedAt.startsWith(monthPrefix)).length}</b><small>本月新增 · 返回优选</small></button>
    </div>
    <div className="eliminated-filters">
      <input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索商品标题、URL、平台或操作人" />
      <select value={platform} onChange={event => setPlatform(event.target.value)}>
        <option value="ALL">全部平台</option>
        {platforms.map(code => <option key={code} value={code}>{code}</option>)}
      </select>
      <select value={origin} onChange={event => setOrigin(event.target.value as typeof origin)}>
        <option value="ALL">全部来源</option>
        <option value="SELECTION">优选产品</option>
        <option value="CANDIDATE">采集侯选</option>
      </select>
      <button className={batchMode ? 'active' : ''} onClick={() => { setBatchMode(!batchMode); setChecked(new Set()) }}>{batchMode ? '退出批量' : '批量管理'}</button>
    </div>
    {batchMode && <div className="eliminated-batchbar">
      <label><input type="checkbox" checked={visible.length > 0 && visible.every(item => checked.has(item.id))} onChange={event => setChecked(event.target.checked ? new Set(visible.map(item => item.id)) : new Set())} />全选当前结果</label>
      <span>已选 <b>{checked.size}</b> 条</span>
      <button disabled={!checked.size || Boolean(busy)} onClick={() => void batchReenable()}>{busy === '批量重新启用' ? '处理中…' : '重新启用已选'}</button>
      <button className="danger" disabled={!checked.size || Boolean(busy)} onClick={() => void batchRemove()}>{busy === '批量删除' ? '处理中…' : '删除已选记录'}</button>
    </div>}
    <div className="eliminated-list">
      {visible.length === 0 ? <div className="eliminated-empty">{records.length ? '当前筛选条件下暂无淘汰记录' : '暂无淘汰记录：在优选产品或采集侯选点击“淘汰”后，商品会自动归集到这里。'}</div> : visible.map(record => <article className={`eliminated-row${record.status === 'REENABLED' ? ' reenabled' : ''}`} key={record.id}>
        <div className="eliminated-row-check">{batchMode && <input type="checkbox" checked={checked.has(record.id)} onChange={() => toggleCheck(record.id)} />}</div>
        <div className="eliminated-row-thumb">{record.imageUrl ? <img src={record.imageUrl} alt="" /> : <span>无图</span>}</div>
        <div className="eliminated-row-main">
          <b title={record.title}>{record.title || '（无标题快照）'}</b>
          <code title={record.sourceUrl}>{record.sourceUrl}</code>
          <div className="eliminated-row-meta">
            <span>{record.platformCode}{record.productId ? ` · ${record.productId}` : ''}</span>
            <span>{record.origin === 'SELECTION' ? '优选产品淘汰' : '采集侯选淘汰'}</span>
            <span>淘汰于 {formatTime(record.eliminatedAt)}</span>
            <span className={`status-${record.status.toLowerCase()}`}>{record.status === 'ACTIVE' ? '淘汰生效 ACTIVE' : '已重新启用 REENABLED'}</span>
            {record.reenabledAt && <span className="status-reenabled">重新启用 {formatTime(record.reenabledAt)}</span>}
            <span>操作人 {record.operator}</span>
            {record.reason && <span className="reason">原因：{record.reason}</span>}
          </div>
        </div>
        <div className="eliminated-row-actions">
          {record.status === 'ACTIVE' && <button className="reenable" disabled={Boolean(busy)} onClick={() => void reenable(record)}>{busy === '重新启用' ? '处理中…' : '重新启用'}</button>}
          <button className="danger" disabled={Boolean(busy)} onClick={() => void removeOne(record)}>删除记录</button>
        </div>
      </article>)}
    </div>
  </section>
}
