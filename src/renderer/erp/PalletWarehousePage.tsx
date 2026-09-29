/**
 * 货盘仓库（ai-hub-warehouse 同级入口）：参照设计图三区布局。
 * 红区 = 顶部 9 Tab 筛选/操作栏（selection-module-nav warehouse-flow-nav）；
 * 蓝区 = 左侧产品目录树（catalog-panel）；黄区 = 右侧产品列表（candidate-catalog-main）。
 * 入库处理 tab = 本地待确认队列（inbound_processing_items）：选品审批与服务器采集池双 intake；
 * 确认入库双写正式入库与货盘存放（spec 2026-09-29-inbound-gate-before-warehouse）。
 */
import { useEffect, useMemo, useState } from 'react'
import { PanelCollapseButton, PanelExpandRail, usePanelCollapse } from '../panel-collapse'
import type { InboundProcessingItem, InboundSnapshot, PalletWarehouseItem } from '../../shared/contracts'
import { fetchErpCapabilities, fetchErpProducts, type ErpCapabilities } from './erpApi'
import { runWithSessionRetry } from '../serverApi'
import { MOCK_CATEGORIES, MOCK_TERTIARY_CATALOG } from './warehouseCatalogData'

const HUB_TABS = ['入库处理', '全部产品', '新品速递', '热销产品', '时节热品', '限时促销', '地区选品', '即将到货', '下架产品'] as const
type HubTab = (typeof HUB_TABS)[number]

// 已接入数据源的 Tab：入库处理（本地队列+服务器采集池同步）/ 全部产品 / 新品速递（入库 7 天内）；其余 Tab 暂无数据源
const DATA_READY_TABS: HubTab[] = ['入库处理', '全部产品', '新品速递']

const SEGMENTS = [
  { key: 'ALL', label: '全部商品' },
  { key: 'WAREHOUSE', label: '正式入库' },
  { key: 'KEYWORD', label: '关键词搜索' },
  { key: 'PRODUCT_URL', label: '单链接采集' },
  { key: 'CATEGORY_URL', label: '类目页采集' }
] as const

const INBOUND_FILTERS = [
  { key: 'PENDING', label: '待确认' },
  { key: 'CONFIRMED', label: '已确认' },
  { key: 'REJECTED', label: '已驳回' }
] as const
type InboundFilter = (typeof INBOUND_FILTERS)[number]['key']

const DAY_MS = 86400000

export function PalletWarehousePage({ onOpenSource, canEdit = false, onReturn }: {
  onOpenSource?: (item: PalletWarehouseItem) => void
  canEdit?: boolean
  onReturn?: (item: PalletWarehouseItem) => Promise<void> | void
}) {
  const catalogPanel = usePanelCollapse('pallet-catalog')
  const [hubTab, setHubTab] = useState<HubTab>('全部产品')
  const [selected, setSelected] = useState('ALL')
  const [expanded, setExpanded] = useState('')
  const [selectedSubcategory, setSelectedSubcategory] = useState('')
  const [segment, setSegment] = useState<'ALL' | 'WAREHOUSE' | 'KEYWORD' | 'PRODUCT_URL' | 'CATEGORY_URL'>('ALL')
  const [query, setQuery] = useState('')
  const [batchId, setBatchId] = useState('ALL')
  const [status, setStatus] = useState('ALL')
  const [batchMode, setBatchMode] = useState(false)
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set())
  const [items, setItems] = useState<PalletWarehouseItem[]>([])
  const [notice, setNotice] = useState('')
  const [inboundItems, setInboundItems] = useState<InboundProcessingItem[]>([])
  const [inboundFilter, setInboundFilter] = useState<InboundFilter>('PENDING')
  const [inboundNotice, setInboundNotice] = useState('')
  const [inboundOk, setInboundOk] = useState('')
  const [caps, setCaps] = useState<ErpCapabilities | null>(null)
  const [capsLoaded, setCapsLoaded] = useState(false)
  const [inboundTagDrafts, setInboundTagDrafts] = useState<Record<string, string>>({})
  const [inboundEdit, setInboundEdit] = useState<{ id: string; draft: InboundSnapshot } | null>(null)

  useEffect(() => {
    let alive = true
    window.desktop.pallet.list()
      .then(list => { if (alive) setItems(list) })
      .catch(reason => { if (alive) setNotice(reason instanceof Error ? reason.message : '货盘仓库加载失败') })
    return () => { alive = false }
  }, [])

  // ERP 能力摘要惰性加载：仅进入「入库处理」tab 才拉取；无 canEdit 不发起同步与队列加载
  useEffect(() => {
    if (hubTab !== '入库处理' || capsLoaded) return
    let alive = true
    fetchErpCapabilities()
      .then(result => { if (alive) setCaps(result) })
      .catch(reason => { if (alive) setInboundNotice(reason instanceof Error ? reason.message : 'ERP 能力摘要获取失败，无法校验入库处理权限') })
      .finally(() => { if (alive) setCapsLoaded(true) })
    return () => { alive = false }
  }, [hubTab, capsLoaded])

  const reloadInbound = () => window.desktop.inbound.list().then(setInboundItems).catch(reason => setInboundNotice(reason instanceof Error ? reason.message : '入库队列加载失败'))

  // 进入 tab 且具备 canEdit：先同步服务器采集池（COLLECTED）快照，再加载本地队列
  useEffect(() => {
    if (hubTab !== '入库处理' || !caps?.canEdit) return
    let alive = true
    fetchErpProducts({ status: 'COLLECTED', pageSize: 100 })
      .then(result => runWithSessionRetry(token => window.desktop.inbound.erpIntake(result.items.map(product => ({
        sourceId: product.id,
        snapshot: {
          platformCode: product.supplier?.code ?? '1688',
          warehouseCode: (product.supplier?.code ?? '1688') === 'GIGACLOUD' ? 'GIGACLOUD' : '1688',
          itemCode: product.sourceProductId || '',
          title: product.titleOriginal || '（无标题）',
          imageUrl: product.images?.[0]?.url || '',
          priceText: product.costPrice != null ? `${product.currency} ${product.costPrice}` : '',
          category: product.category || '',
          subcategory: '',
          tertiaryCategory: '',
          sourceUrl: product.sourceUrl || '',
          tags: [],
          collectedAt: product.createdAt
        }
      })), token)))
      .then(list => { if (alive) setInboundItems(list) })
      .catch(reason => { if (alive) { setInboundOk(''); setInboundNotice(reason instanceof Error ? reason.message : '入库处理同步失败'); void reloadInbound() } })
    return () => { alive = false }
  }, [hubTab, caps])

  const removeItems = (ids: string[]) => {
    if (!ids.length) return
    void window.desktop.pallet.remove(ids)
      .then(list => { setItems(list); setCheckedKeys(new Set()) })
      .catch(reason => setNotice(reason instanceof Error ? reason.message : '删除失败'))
  }

  const inboundVisible = useMemo(() => {
    const byStatus = inboundItems.filter(item => item.status === inboundFilter)
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return byStatus
    return byStatus.filter(item => `${item.snapshot.title} ${item.snapshot.itemCode}`.toLocaleLowerCase().includes(normalized))
  }, [inboundItems, inboundFilter, query])

  const patchSnapshot = (item: InboundProcessingItem, next: InboundSnapshot, okMessage: string) => {
    void runWithSessionRetry(token => window.desktop.inbound.reedit(item.id, next, token))
      .then(list => { setInboundItems(list); setInboundEdit(null); setInboundNotice(''); setInboundOk(okMessage) })
      .catch(reason => { setInboundOk(''); setInboundNotice(reason instanceof Error ? reason.message : '保存失败') })
  }

  const addInboundTag = (item: InboundProcessingItem) => {
    const value = (inboundTagDrafts[item.id] || '').trim()
    if (!value || item.snapshot.tags.includes(value)) return
    patchSnapshot(item, { ...item.snapshot, tags: [...item.snapshot.tags, value] }, '标签已补充')
    setInboundTagDrafts(current => ({ ...current, [item.id]: '' }))
  }

  const confirmInbound = (id: string) => {
    void runWithSessionRetry(token => window.desktop.inbound.confirm(id, token))
      .then(list => {
        setInboundItems(list)
        return window.desktop.pallet.list()
      })
      .then(list => { setItems(list); setInboundNotice(''); setInboundOk('已确认转入正式入库与货盘仓库') })
      .catch(reason => { setInboundOk(''); setInboundNotice(reason instanceof Error ? reason.message : '确认入库失败') })
  }

  const rejectInbound = (id: string) => {
    if (!window.confirm('确认驳回该产品？驳回后不写入正式入库与货盘仓库。')) return
    void runWithSessionRetry(token => window.desktop.inbound.reject(id, token))
      .then(list => { setInboundItems(list); setInboundNotice(''); setInboundOk('已驳回') })
      .catch(reason => { setInboundOk(''); setInboundNotice(reason instanceof Error ? reason.message : '驳回失败') })
  }

  const returnPalletItem = (item: PalletWarehouseItem) => {
    void Promise.resolve(onReturn?.(item))
      .then(() => window.desktop.pallet.list())
      .then(list => setItems(list))
      .catch(reason => setNotice(reason instanceof Error ? reason.message : '退回入库处理失败'))
  }

  const countCategory = (name: string) => items.filter(item => item.category === name).length
  const countSubcategory = (category: string, sub: string) => items.filter(item => item.category === category && item.subcategory === sub).length

  const visible = useMemo(() => {
    if (hubTab !== '全部产品' && hubTab !== '新品速递') return [] as PalletWarehouseItem[]
    const base = hubTab === '新品速递'
      ? items.filter(item => Date.now() - Date.parse(item.storedAt) <= 7 * DAY_MS).sort((a, b) => Date.parse(b.storedAt) - Date.parse(a.storedAt))
      : items
    const normalized = query.trim().toLocaleLowerCase()
    return base.filter(item => {
      if (segment !== 'ALL' && segment !== 'WAREHOUSE') return false
      if (selected !== 'ALL' && item.category !== selected && item.subcategory !== selected && item.tertiaryCategory !== selected) return false
      if (normalized && !`${item.title} ${item.itemCode}`.toLocaleLowerCase().includes(normalized)) return false
      return true
    })
  }, [items, hubTab, selected, query, segment])

  const toggleKey = (id: string) => setCheckedKeys(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const tertiaryOptions = useMemo(() => {
    if (!selectedSubcategory) return [] as { name: string; icon: string; count: number }[]
    return (MOCK_TERTIARY_CATALOG[selectedSubcategory] || []).map(option => ({ ...option, count: items.filter(item => item.tertiaryCategory === option.name).length }))
  }, [items, selectedSubcategory])

  return <>
    <div className="selection-module-nav warehouse-flow-nav">
      {HUB_TABS.map(tab => <button key={tab} className={hubTab === tab ? 'active' : ''} onClick={() => setHubTab(tab)}><span>{tab}</span></button>)}
    </div>
    <section className={`candidate-page${catalogPanel.collapsed?' side-collapsed':''}`}>
      {catalogPanel.collapsed?<PanelExpandRail panel={catalogPanel} label="产品目录库"/>:<aside className="catalog-panel collapsible-aside">
        <PanelCollapseButton panel={catalogPanel}/>
        <div className="catalog-heading"><small>PRODUCT CATALOG</small><h2>产品目录库</h2><p>大健云仓三级目录 · 支持人工调整</p></div>
        <button className={`catalog-all ${selected === 'ALL' ? 'active' : ''}`} onClick={() => { setSelected('ALL'); setSelectedSubcategory('') }}><span>全部产品</span><em>{items.length}</em></button>
        <div className="catalog-tree">
          {MOCK_CATEGORIES.map(group => {
            const open = expanded === group.name
            return <div className="catalog-group" key={group.name}>
              <button className={selected === group.name ? 'active' : ''} onClick={() => { setSelected(group.name); setExpanded(open ? '' : group.name); setSelectedSubcategory(open ? '' : group.children[0] || '') }}>
                <i>{open ? '⌄' : '›'}</i><span>{group.name}</span><em>{countCategory(group.name)}</em>
              </button>
              {open && <div>
                {group.children.map(child => <button key={child} className={selected === child ? 'active' : ''} onClick={() => { setSelected(child); setSelectedSubcategory(child) }}>
                  <span>{child}</span><em>{countSubcategory(group.name, child)}</em>
                </button>)}
              </div>}
            </div>
          })}
        </div>
        {selectedSubcategory && tertiaryOptions.length > 0 && <div className="tertiary-flyout">
          <div><small>LEVEL 3 CATEGORY</small><b>{selectedSubcategory}</b><button onClick={() => setSelectedSubcategory('')}>×</button></div>
          <div className="tertiary-icon-grid">
            {tertiaryOptions.map(option => <button key={option.name} className={selected === option.name ? 'active' : ''} onClick={() => { setSelected(option.name); setSelectedSubcategory('') }}>
              <i>{option.icon.endsWith('.png') ? <img src={option.icon} alt={option.name}/> : option.icon}</i><span>{option.name}</span><em>{option.count}</em>
            </button>)}
          </div>
        </div>}
      </aside>}
      <div className="candidate-catalog-main">
        <div className="warehouse-page-heading"><div><small>货盘仓库</small><div className="pallet-heading-title-row"><b>{hubTab === '入库处理' ? '入库处理 · 待确认队列' : '全部货源 · 已存放'}</b><em>{hubTab === '入库处理' ? inboundVisible.length : visible.length}</em></div></div><div className="pallet-heading-switch"><div className="candidate-view-switch">
          {SEGMENTS.map(item => <button key={item.key} className={segment === item.key ? 'active' : ''} onClick={() => setSegment(item.key)}>{item.label}</button>)}
        </div></div></div>
        <div className="candidate-filterbar">
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索商品标题、商品ID或供应商"/>
          <select value={batchId} onChange={event => setBatchId(event.target.value)}>
            <option value="ALL">全部采集批次</option>
          </select>
          <select value={status} onChange={event => setStatus(event.target.value)}>
            <option value="ALL">全部状态</option>
            <option value="SELECTED">AI已入选</option>
            <option value="REVIEW">待人工复核</option>
            <option value="DELETED">已删除</option>
          </select>
          <button className={batchMode ? 'active candidate-batch-toggle' : 'candidate-batch-toggle'} onClick={() => { setBatchMode(!batchMode); setCheckedKeys(new Set()) }}>{batchMode ? '退出批量' : '批量管理'}</button>
        </div>
        {batchMode && <div className="candidate-batchbar">
          <label><input type="checkbox" checked={visible.length > 0 && visible.every(item => checkedKeys.has(item.id))} onChange={event => setCheckedKeys(event.target.checked ? new Set(visible.map(item => item.id)) : new Set())}/>全选当前结果</label>
          <span>已选 <b>{checkedKeys.size}</b> 个</span>
          <button className="danger" disabled={!checkedKeys.size} onClick={() => removeItems([...checkedKeys])}>删除已选</button>
        </div>}
        {hubTab === '入库处理' && <div className="candidate-view-switch inbound-status-filter">
          {INBOUND_FILTERS.map(filter => <button key={filter.key} className={inboundFilter === filter.key ? 'active' : ''} onClick={() => setInboundFilter(filter.key)}>
            {filter.label} <em>{inboundItems.filter(item => item.status === filter.key).length}</em>
          </button>)}
        </div>}
        <div className="candidate-zone-summary">
          {hubTab === '入库处理' ? <>
            <span>待确认 <b>{inboundItems.filter(item => item.status === 'PENDING').length}</b></span>
            <span>采集源 <b>{new Set(inboundItems.map(item => item.snapshot.platformCode)).size}</b></span>
            <span>当前显示 <b>{inboundVisible.length}</b></span>
          </> : <>
            <span>货盘商品 <b>{items.length}</b></span>
            <span>采集批次 <b>—</b></span>
            <span>采集方式 <b>{items.length ? 1 : 0}</b></span>
            <span>当前显示 <b>{visible.length}</b></span>
          </>}
        </div>
        {inboundOk ? <div className="erp-banner erp-banner-ok">{inboundOk}</div> : null}
        {inboundNotice ? <div className="erp-banner erp-banner-error">{inboundNotice}</div> : null}
        {notice ? <div className="erp-banner erp-banner-error">{notice}</div> : null}
        {(hubTab === '全部产品' || hubTab === '新品速递') && segment !== 'ALL' && segment !== 'WAREHOUSE' ? (
          <div className="erp-banner erp-banner-info">采集方式「{SEGMENTS.find(item => item.key === segment)?.label ?? segment}」尚未接入数据源，列表已过滤为空；当前商品均来自入库处理确认。</div>
        ) : null}
        {hubTab === '入库处理' ? (
          caps !== null && !caps.canEdit ? (
            <div className="empty-state"><span>◎</span><h2>无入库处理权限</h2><p>当前账号缺少 ERP 仓库编辑权限（erp.warehouse.edit），无法同步采集池与确认入库，请联系管理员开通。</p></div>
          ) : inboundVisible.length === 0 ? <div className="empty-state"><span>◎</span><h2>暂无{INBOUND_FILTERS.find(filter => filter.key === inboundFilter)?.label}产品</h2><p>各货盘（1688、大健云仓等）选品审批通过或服务器采集池 COLLECTED 的原始产品会集中在这里待确认。</p></div> : (
          <div className="product-grid">
            {inboundVisible.map(item => {
              const snapshot = item.snapshot
              const edit = inboundEdit?.id === item.id ? inboundEdit.draft : null
              return (
              <article className="product-card candidate-product-card supply-source-card" key={item.id}>
                <button type="button" className="product-image" aria-label={`查看商品图片：${snapshot.title}`}>
                  {snapshot.imageUrl ? <img src={snapshot.imageUrl} alt={snapshot.title}/> : <span>无图</span>}
                </button>
                <div className="product-info supply-source-info">
                  <small>
                    <span className={`inbound-origin-badge ${item.origin === 'SELECTION' ? 'origin-selection' : 'origin-erp'}`}>{item.origin === 'SELECTION' ? '选品审批' : '服务器采集池'}</span>
                    {snapshot.platformCode === 'GIGACLOUD' ? '大健云仓' : snapshot.platformCode} · Item Code {snapshot.itemCode || '—'} · {INBOUND_FILTERS.find(filter => filter.key === item.status)?.label}
                  </small>
                  <b title={snapshot.title}>{snapshot.title}</b>
                  <strong>{snapshot.priceText || '价格待核验'}</strong>
                  <dl className="candidate-source-facts">
                    <div><dt>目标仓/货位</dt><dd title={`${snapshot.category} / ${snapshot.subcategory} / ${snapshot.tertiaryCategory}`}>{snapshot.warehouseCode} / {snapshot.category || '—'} / {snapshot.subcategory || '—'} / {snapshot.tertiaryCategory || '—'}</dd></div>
                    <div><dt>采集时间</dt><dd>{(snapshot.collectedAt || '').slice(0, 10) || '—'}</dd></div>
                    {item.status === 'REJECTED' && <div><dt>驳回时间</dt><dd>{(item.updatedAt || '').slice(0, 10)}</dd></div>}
                    {item.status === 'CONFIRMED' && <div><dt>确认时间</dt><dd>{(item.confirmedAt || '').slice(0, 10)}</dd></div>}
                  </dl>
                  {edit ? (
                    <div className="inbound-edit-form">
                      <label>标题<input value={edit.title} onChange={event => setInboundEdit({ id: item.id, draft: { ...edit, title: event.target.value } })}/></label>
                      <label>价格<input value={edit.priceText} onChange={event => setInboundEdit({ id: item.id, draft: { ...edit, priceText: event.target.value } })}/></label>
                      <label>目标仓<select value={edit.warehouseCode} onChange={event => setInboundEdit({ id: item.id, draft: { ...edit, warehouseCode: event.target.value as '1688' | 'GIGACLOUD' } })}>
                        <option value="1688">1688</option><option value="GIGACLOUD">大健云仓</option>
                      </select></label>
                      <label>一级类目<input value={edit.category} onChange={event => setInboundEdit({ id: item.id, draft: { ...edit, category: event.target.value } })}/></label>
                      <label>二级类目<input value={edit.subcategory} onChange={event => setInboundEdit({ id: item.id, draft: { ...edit, subcategory: event.target.value } })}/></label>
                      <label>三级类目<input value={edit.tertiaryCategory} onChange={event => setInboundEdit({ id: item.id, draft: { ...edit, tertiaryCategory: event.target.value } })}/></label>
                      <div className="product-actions candidate-next-actions"><button className="primary" onClick={() => patchSnapshot(item, edit, '已保存编辑')}>保存</button><button onClick={() => setInboundEdit(null)}>取消</button></div>
                    </div>
                  ) : (
                    <div className="product-tags">
                      {snapshot.tags.map(tag => <span key={tag}>{tag}</span>)}
                      {item.status !== 'CONFIRMED' && <>
                        <input className="inbound-tag-input" placeholder="补标签" value={inboundTagDrafts[item.id] || ''} onChange={event => setInboundTagDrafts(current => ({ ...current, [item.id]: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter') addInboundTag(item) }}/>
                        <button type="button" onClick={() => addInboundTag(item)}>添加</button>
                      </>}
                    </div>
                  )}
                  <div className="product-actions candidate-next-actions">
                    {item.status === 'PENDING' && <>
                      <button onClick={() => setInboundEdit(edit ? null : { id: item.id, draft: { ...snapshot } })}>{edit ? '收起编辑' : '重新编辑'}</button>
                      <button className="primary" onClick={() => confirmInbound(item.id)}>确认入库</button>
                      <button className="candidate-delete" onClick={() => rejectInbound(item.id)}>驳回</button>
                    </>}
                    {item.status === 'REJECTED' && <button onClick={() => setInboundEdit({ id: item.id, draft: { ...snapshot } })}>重新编辑</button>}
                  </div>
                </div>
              </article>
              )
            })}
          </div>)
        ) : !DATA_READY_TABS.includes(hubTab) ? (
          <div className="empty-state"><span>◎</span><h2>{hubTab} · 即将上线</h2><p>该栏目暂未接入数据源，敬请期待；当前可使用「入库处理 / 全部产品 / 新品速递」。</p></div>
        ) : visible.length === 0 ? <div className="empty-state"><span>◎</span><h2>暂无货盘商品</h2><p>当前栏目或筛选条件下没有商品。产品经“入库处理”审核确认后转入这里。</p></div> : <div className="product-grid">
          {visible.map(item => <article className="product-card candidate-product-card supply-source-card" key={item.id}>
            <div className="candidate-card-tools">{batchMode ? <label title="选择商品"><input type="checkbox" checked={checkedKeys.has(item.id)} onChange={() => toggleKey(item.id)}/></label> : null}</div>
            <button type="button" className="product-image" aria-label={`查看商品图片：${item.title}`}>
              {item.imageUrl ? <img src={item.imageUrl} alt={item.title}/> : <span>无图</span>}
            </button>
            <div className="product-info supply-source-info">
              <small>{item.warehouseCode === 'GIGACLOUD' ? '大健云仓' : '1688'} · Item Code {item.itemCode || '—'} · 来源批次 —</small>
              <b title={item.title}>{item.title}</b>
              <strong>{item.priceText || '价格待核验'}</strong>
              <dl className="candidate-source-facts">
                <div><dt>物流费</dt><dd>待补采</dd></div>
                <div><dt>可售库存</dt><dd>待补采</dd></div>
                <div><dt>原始类目</dt><dd title={`${item.category} / ${item.subcategory} / ${item.tertiaryCategory}`}>{item.category} / {item.subcategory} / {item.tertiaryCategory}</dd></div>
                <div><dt>GIGA Index</dt><dd>—</dd></div>
              </dl>
              <div className="original-price">入库处理确认 · 正式入库并存放</div>
              <div className="product-tags"><span>入库确认</span></div>
              <div className="product-actions candidate-next-actions">
                <button onClick={() => onOpenSource?.(item)}>原址 <i>↗</i></button>
                {canEdit && <button onClick={() => returnPalletItem(item)}>退回入库处理</button>}
                <button className="candidate-delete" onClick={() => removeItems([item.id])}>删除</button>
              </div>
            </div>
          </article>)}
        </div>}
      </div>
    </section>
  </>
}
