/**
 * 货盘仓库（ai-hub-warehouse 同级入口）：参照设计图三区布局。
 * 红区 = 顶部 9 Tab 筛选/操作栏（selection-module-nav warehouse-flow-nav）；
 * 蓝区 = 左侧产品目录树（catalog-panel）；黄区 = 右侧产品列表（candidate-catalog-main）。
 * 入库处理 tab = 本地待确认队列（inbound_processing_items）：选品审批与服务器采集池双 intake；
 * 确认入库双写正式入库与货盘存放（spec 2026-09-29-inbound-gate-before-warehouse）。
 */
import { useEffect, useMemo, useState } from 'react'
import { PanelCollapseButton, PanelExpandRail, usePanelCollapse } from '../panel-collapse'
import type { DelistedPalletItem, InboundProcessingItem, InboundSnapshot, PalletWarehouseItem, SupplyProductDownload } from '../../shared/contracts'
import { fetchErpCapabilities, fetchErpProducts, type ErpCapabilities } from './erpApi'
import { describeDesktopError } from '../../shared/desktopErrorText'
import { runWithSessionRetry } from '../serverApi'
import { MOCK_CATEGORIES, MOCK_TERTIARY_CATALOG, buildCatalogTree } from './warehouseCatalogData'

const HUB_TABS = ['入库处理', '全部产品', '地区货盘', '新品速递', '热销产品', '时节热品', '限时促销', '即将到货', '下架产品'] as const
type HubTab = (typeof HUB_TABS)[number]

// 我的货盘为个人入选视图：总货盘营运栏目五页签名称与功能一并移除，仅留全部产品/地区货盘/即将到货/下架产品
const MINE_HIDDEN_TABS: HubTab[] = ['入库处理', '新品速递', '热销产品', '时节热品', '限时促销']
export function hubTabsForScope(scope: 'warehouse' | 'mine'): readonly HubTab[] {
  return scope === 'mine' ? HUB_TABS.filter(tab => !MINE_HIDDEN_TABS.includes(tab)) : HUB_TABS
}

// 已接入数据源的 Tab：入库处理 / 全部产品 / 新品速递 / 下架产品；其余 Tab 暂无数据源
const DATA_READY_TABS: HubTab[] = ['入库处理', '全部产品', '新品速递', '下架产品']

const INBOUND_FILTERS = [
  { key: 'PENDING', label: '待确认' },
  { key: 'CONFIRMED', label: '已确认' },
  { key: 'REJECTED', label: '已驳回' }
] as const
type InboundFilter = (typeof INBOUND_FILTERS)[number]['key']

type CatalogPath = { category: string; subcategory: string; tertiaryCategory: string }

// 标题关键词兜底表：原始类目名匹配不上目录时使用（货源标题多为英文）
const CATEGORY_KEYWORDS: { category: string; subcategory?: string; keywords: string[] }[] = [
  { category: '汽车用品', subcategory: '电动车', keywords: ['electric tricycle', 'electric bike', 'e-bike', 'ebike', 'electric bicycle', 'scooter'] },
  { category: '汽车用品', subcategory: '摩托车配附件', keywords: ['motorcycle', 'motorbike'] },
  { category: '汽车用品', subcategory: '车灯', keywords: ['headlight', 'taillight', 'light bar'] },
  { category: '汽车用品', subcategory: '汽车内饰用品', keywords: ['seat cover', 'car interior', 'floor mat'] },
  { category: '汽摩及配件', subcategory: '电动车配件', keywords: ['hub motor', 'controller', 'battery pack'] },
  { category: '五金、工具', subcategory: '电动工具', keywords: ['drill', 'grinder', 'power tool'] },
  { category: '五金、工具', subcategory: '手动工具', keywords: ['wrench', 'screwdriver', 'pliers', 'tool set'] },
  { category: '花园与户外', keywords: ['garden', 'outdoor', 'patio', 'camping', 'lawn'] },
  { category: '办公、文化', keywords: ['office', 'stationery', 'notebook', 'pen'] },
  { category: '居家日用品', keywords: ['kitchen', 'storage', 'household', 'cleaning'] },
  { category: '家具', keywords: ['furniture', 'sofa', 'table', 'chair', 'bed', 'shelf', 'cabinet'] }
]

const nameHit = (a: string, b: string) => Boolean(a) && Boolean(b) && (a === b || a.includes(b) || b.includes(a))

// 两级匹配：先按快照原始一/二/三级类目名对目录做包含匹配，再按标题关键词兜底；三级匹配不到只推荐到二级
export function recommendCatalogPath(source: { title?: string; category?: string; subcategory?: string; tertiaryCategory?: string }): CatalogPath | null {
  const cat = (source.category || '').trim()
  const sub = (source.subcategory || '').trim()
  const ter = (source.tertiaryCategory || '').trim()
  const groupByName = MOCK_CATEGORIES.find(group => nameHit(group.name, cat))
  if (groupByName) {
    const subName = groupByName.children.find(child => nameHit(child, sub)) || groupByName.children.find(child => nameHit(child, ter)) || ''
    const terName = subName ? (MOCK_TERTIARY_CATALOG[subName] || []).find(option => nameHit(option.name, ter))?.name || '' : ''
    return { category: groupByName.name, subcategory: subName, tertiaryCategory: terName }
  }
  for (const group of MOCK_CATEGORIES) {
    const subName = group.children.find(child => nameHit(child, sub) || child === cat)
    if (subName) {
      const terName = (MOCK_TERTIARY_CATALOG[subName] || []).find(option => nameHit(option.name, ter))?.name || ''
      return { category: group.name, subcategory: subName, tertiaryCategory: terName }
    }
  }
  if (ter) {
    for (const [subName, options] of Object.entries(MOCK_TERTIARY_CATALOG)) {
      const option = options.find(entry => nameHit(entry.name, ter))
      const group = option ? MOCK_CATEGORIES.find(entry => entry.children.includes(subName)) : null
      if (option && group) return { category: group.name, subcategory: subName, tertiaryCategory: option.name }
    }
  }
  const title = (source.title || '').toLocaleLowerCase()
  if (title) {
    for (const entry of CATEGORY_KEYWORDS) {
      if (entry.keywords.some(keyword => title.includes(keyword))) return { category: entry.category, subcategory: entry.subcategory || '', tertiaryCategory: '' }
    }
  }
  return null
}

const DAY_MS = 86400000

export function PalletWarehousePage({ canEdit = false, onReturn, scope = 'warehouse', onSendToEbay }: {
  canEdit?: boolean
  onReturn?: (item: PalletWarehouseItem) => Promise<void> | void
  /** warehouse = 总货盘；mine = 我的货盘（个人入选视图，界面与总货盘一致） */
  scope?: 'warehouse' | 'mine'
  /** 我的货盘：送入 eBay 工作台本地产品（成功后由调用方跳转） */
  onSendToEbay?: (warehouseProductId: string) => Promise<void> | void
}) {
  const catalogPanel = usePanelCollapse('pallet-catalog')
  const [hubTab, setHubTab] = useState<HubTab>('全部产品')
  const [selected, setSelected] = useState('ALL')
  const [expanded, setExpanded] = useState('')
  const [selectedSubcategory, setSelectedSubcategory] = useState('')
  const [query, setQuery] = useState('')
  const [batchId, setBatchId] = useState('ALL')
  const [status, setStatus] = useState('ALL')
  const [batchMode, setBatchMode] = useState(false)
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set())
  const [items, setItems] = useState<PalletWarehouseItem[]>([])
  const [delistedItems, setDelistedItems] = useState<DelistedPalletItem[]>([])
  const [notice, setNotice] = useState('')
  const [noticeRetry, setNoticeRetry] = useState<(() => void) | null>(null)
  const [inboundItems, setInboundItems] = useState<InboundProcessingItem[]>([])
  const [inboundFilter, setInboundFilter] = useState<InboundFilter>('PENDING')
  const [selectedRegion, setSelectedRegion] = useState('')
  const [inboundNotice, setInboundNotice] = useState('')
  const [inboundOk, setInboundOk] = useState('')
  const [caps, setCaps] = useState<ErpCapabilities | null>(null)
  const [capsLoaded, setCapsLoaded] = useState(false)
  const [inboundEdit, setInboundEdit] = useState<{ id: string; draft: InboundSnapshot } | null>(null)
  const [activeInboundId, setActiveInboundId] = useState('')
  const [warehouseDownloads, setWarehouseDownloads] = useState<Record<string, SupplyProductDownload>>({})
  const [myPalletIds, setMyPalletIds] = useState<Set<string>>(new Set())
  // 目录树名称单源入参：恒为总货盘商品（我的货盘侧复用总货盘结果，不按自身入选推导）
  const [masterItems, setMasterItems] = useState<PalletWarehouseItem[]>([])

  const reloadItems = () => (scope === 'mine'
    ? Promise.all([window.desktop.myPallet.list(), window.desktop.pallet.list()]).then(([mine, master]) => { setMasterItems(master); setItems(mine); return mine })
    : window.desktop.pallet.list().then(list => { setMasterItems(list); setItems(list); return list }))

  useEffect(() => {
    void reloadItems()
      .catch(reason => failNotice(reason, scope === 'mine' ? '我的货盘加载' : '货盘仓库加载', retryLoad))
  }, [scope])

  // 我的货盘入选关系：总货盘卡片据此显示「已加入」态；我的货盘页移除后同步清态
  useEffect(() => {
    let alive = true
    window.desktop.myPallet.ids()
      .then(ids => { if (alive) setMyPalletIds(new Set(ids)) })
      .catch(() => undefined)
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (hubTab !== '下架产品') return
    let alive = true
    window.desktop.warehouses.delistedPallet()
      .then(list => { if (alive) setDelistedItems(list) })
      .catch(reason => { if (alive) failNotice(reason, '下架产品加载', retryLoad) })
    return () => { alive = false }
  }, [hubTab])

  // 入库卡/存放卡「查看页面」与主图点击门控：与正式入库卡同口径，仅 DOWNLOADED 图文档案可开服务器详情页
  useEffect(() => {
    if (!['入库处理', '全部产品', '新品速递', '地区货盘', '下架产品'].includes(hubTab)) return
    let alive = true
    window.desktop.warehouses.downloads()
      .then(list => { if (alive) setWarehouseDownloads(Object.fromEntries(list.map(item => [item.warehouseProductId, item]))) })
      .catch(() => undefined)
    return () => { alive = false }
  }, [hubTab])

  // ERP 能力摘要惰性加载：仅进入「入库处理」tab 才拉取；无 canEdit 不发起同步与队列加载
  useEffect(() => {
    if (hubTab !== '入库处理' || capsLoaded) return
    let alive = true
    fetchErpCapabilities()
      .then(result => { if (alive) setCaps(result) })
      .catch(reason => { if (alive) failInbound(reason, 'ERP 能力摘要获取') })
      .finally(() => { if (alive) setCapsLoaded(true) })
    return () => { alive = false }
  }, [hubTab, capsLoaded])

  const reloadInbound = () => window.desktop.inbound.list().then(setInboundItems).catch(reason => failInbound(reason, '入库队列加载'))

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
      .catch(reason => { if (alive) { failInbound(reason, '入库处理同步'); void reloadInbound() } })
    return () => { alive = false }
  }, [hubTab, caps])

  const removeItems = (ids: string[]) => {
    if (!ids.length) return
    void runWithSessionRetry(token => window.desktop.pallet.remove(ids, token))
      .then(list => { setItems(list); setCheckedKeys(new Set()) })
      .catch(reason => failNotice(reason, '删除'))
  }

  const syncMyPallet = (list: PalletWarehouseItem[]) => {
    setMyPalletIds(new Set(list.map(item => item.warehouseProductId)))
    if (scope === 'mine') { setItems(list); setCheckedKeys(new Set()) }
  }

  const addToMyPallet = (warehouseProductIds: string[]) => {
    if (!warehouseProductIds.length) return
    void window.desktop.myPallet.add(warehouseProductIds)
      .then(syncMyPallet)
      .catch(reason => failNotice(reason, '加入我的货盘'))
  }

  const removeFromMyPallet = (warehouseProductIds: string[]) => {
    if (!warehouseProductIds.length) return
    void window.desktop.myPallet.remove(warehouseProductIds)
      .then(syncMyPallet)
      .catch(reason => failNotice(reason, '移出我的货盘'))
  }

  const checkedWarehouseIds = () => visible.filter(item => checkedKeys.has(item.id)).map(item => item.warehouseProductId)

  const inboundVisible = useMemo(() => {
    const byStatus = inboundItems.filter(item => item.status === inboundFilter)
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return byStatus
    return byStatus.filter(item => `${item.snapshot.title} ${item.snapshot.itemCode}`.toLocaleLowerCase().includes(normalized))
  }, [inboundItems, inboundFilter, query])

  const patchSnapshot = (item: InboundProcessingItem, next: InboundSnapshot, okMessage: string) => {
    void runWithSessionRetry(token => window.desktop.inbound.reedit(item.id, next, token))
      .then(list => { setInboundItems(list); setInboundEdit(null); setInboundNotice(''); setInboundOk(okMessage) })
      .catch(reason => failInbound(reason, '保存'))
  }

  const activeInbound = inboundItems.find(item => item.id === activeInboundId) || null

  const assignCatalog = (item: InboundProcessingItem, path: CatalogPath, okMessage: string, finish: boolean) => {
    if (finish) { setActiveInboundId(''); setSelectedSubcategory('') }
    patchSnapshot(item, { ...item.snapshot, ...path }, okMessage)
  }

  const catalogPathText = (path: CatalogPath) => [path.category, path.subcategory, path.tertiaryCategory].filter(Boolean).join(' / ')

  // 归位模式下树的高亮跟随当前产品的快照类目，而非目录筛选选中项
  const treeActiveClass = (name: string, parent: string, tertiary = false) => {
    if (activeInbound) {
      const snapshot = activeInbound.snapshot
      if (tertiary) return snapshot.tertiaryCategory === name && snapshot.subcategory === parent ? 'active' : ''
      return parent ? (snapshot.subcategory === name && snapshot.category === parent ? 'active' : '') : (snapshot.category === name ? 'active' : '')
    }
    return selected === name ? 'active' : ''
  }

  const confirmInbound = (id: string) => {
    void runWithSessionRetry(token => window.desktop.inbound.confirm(id, token))
      .then(list => {
        setInboundItems(list)
        return reloadItems()
      })
      .then(list => { setItems(list); setInboundNotice(''); setInboundOk('已确认转入正式入库与货盘仓库') })
      .catch(reason => failInbound(reason, '确认入库'))
  }

  const rejectInbound = (id: string) => {
    if (!window.confirm('确认驳回该产品？驳回后不写入正式入库与货盘仓库。')) return
    void runWithSessionRetry(token => window.desktop.inbound.reject(id, token))
      .then(list => { setInboundItems(list); setInboundNotice(''); setInboundOk('已驳回') })
      .catch(reason => failInbound(reason, '驳回'))
  }

  const returnPalletItem = (item: PalletWarehouseItem) => {
    void Promise.resolve(onReturn?.(item))
      .then(() => reloadItems())
      .then(list => setItems(list))
      .catch(reason => failNotice(reason, '退回入库处理'))
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
      if (selected !== 'ALL' && item.category !== selected && item.subcategory !== selected && item.tertiaryCategory !== selected) return false
      if (normalized && !`${item.title} ${item.itemCode}`.toLocaleLowerCase().includes(normalized)) return false
      return true
    })
  }, [items, hubTab, selected, query])

  const delistedVisible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return delistedItems.filter(item => {
      if (selected !== 'ALL' && item.category !== selected && item.subcategory !== selected && item.tertiaryCategory !== selected) return false
      if (normalized && !`${item.title} ${item.itemCode}`.toLocaleLowerCase().includes(normalized)) return false
      return true
    })
  }, [delistedItems, query, selected])

  const reloadDelisted = () => window.desktop.warehouses.delistedPallet().then(setDelistedItems).catch(reason => failNotice(reason, '下架产品加载', retryLoad))

  const restoreDelisted = (warehouseProductId: string) => {
    void runWithSessionRetry(token => window.desktop.warehouses.restore(warehouseProductId, token))
      .then(() => Promise.all([reloadDelisted(), reloadItems()]))
      .then(() => { setNotice(''); setInboundOk('已恢复到正式入库') })
      .catch(reason => failNotice(reason, '恢复'))
  }

  const updateDelisted = (item: PalletWarehouseItem) => {
    void runWithSessionRetry(token => window.desktop.warehouses.download(item.warehouseProductId, token))
      .then(() => { setNotice(''); setInboundOk(`「${item.title}」图文已更新`) })
      .catch(reason => failNotice(reason, '更新产品'))
  }

  const deleteDelisted = (item: PalletWarehouseItem) => {
    if (!window.confirm(`确认永久删除「${item.title}」？删除后不可恢复。`)) return
    void runWithSessionRetry(token => window.desktop.warehouses.deleteProduct(item.warehouseProductId, token))
      .then(() => reloadDelisted())
      .then(() => { setNotice(''); setInboundOk('产品已永久删除') })
      .catch(reason => failNotice(reason, '删除产品'))
  }

  const regionGroups = [...new Set(items.map(entry => entry.region).filter((region): region is string => Boolean(region)))]
  const activeRegion = selectedRegion && regionGroups.includes(selectedRegion) ? selectedRegion : regionGroups[0] || ''

  // 错误横幅：中文全文；加载类失败附重试动作；不直显英文技术串
  const failNotice = (reason: unknown, context: string, retry?: () => void) => {
    setInboundOk('')
    setNotice(describeDesktopError(reason, context))
    setNoticeRetry(retry || null)
  }
  const failInbound = (reason: unknown, context: string) => {
    setInboundOk('')
    setInboundNotice(describeDesktopError(reason, context))
  }
  const sendToEbay = async (warehouseProductId: string) => {
    if (!onSendToEbay) return
    setNotice('')
    setNoticeRetry(null)
    try {
      await onSendToEbay(warehouseProductId)
    } catch (reason) {
      failNotice(reason, '送入eBay工作台失败', () => void sendToEbay(warehouseProductId))
    }
  }
  const retryLoad = () => {
    setNotice('')
    setNoticeRetry(null)
    void reloadItems().catch(reason => failNotice(reason, scope === 'mine' ? '我的货盘加载' : '货盘仓库加载', retryLoad))
    void window.desktop.myPallet.ids().then(ids => setMyPalletIds(new Set(ids))).catch(reason => failNotice(reason, '我的货盘入选关系加载', retryLoad))
    if (hubTab === '下架产品') void reloadDelisted()
  }

  const toggleKey = (id: string) => setCheckedKeys(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const catalogTree = useMemo(() => buildCatalogTree(masterItems), [masterItems])

  const tertiaryOptions = useMemo(() => {
    if (!selectedSubcategory) return [] as { name: string; icon: string; count: number }[]
    return (catalogTree.tertiary[selectedSubcategory] || []).map(option => ({ ...option, count: items.filter(item => item.tertiaryCategory === option.name).length }))
  }, [items, selectedSubcategory, catalogTree])

  // 存放卡渲染：全部产品/新品速递/地区货盘/下架产品共用，保证红框区口径一致；delisted 传入时附加下架追溯两行事实与下架操作按钮
  const renderStoredCard = (item: PalletWarehouseItem, delisted?: { reason: string; at: string | null }) => {
    const scoreValue = item.gigaIndex ?? item.score ?? null
    const scoreGrade = scoreValue === null ? null : Math.round(scoreValue) >= 80 ? 'A' : Math.round(scoreValue) >= 65 ? 'B' : 'C'
    const inventoryText = item.sellableInventory !== null && item.sellableInventory !== undefined ? item.sellableInventory.toLocaleString('zh-CN') : item.salesText?.replace(/^(?:Available\s*Stock|可售库存|库存)\s*[:：]?\s*/i, '') || '待补采'
    const sourceCatalogText = item.sourceCategory ? `${item.sourceCategory} / ${item.sourceSubcategory || '—'} / ${item.sourceTertiaryCategory || '—'}` : '类目待核实'
    const currentCatalogText = item.category ? `${item.category} / ${item.subcategory || '—'} / ${item.tertiaryCategory || '—'}` : '—'
    const estimatedTotalText = (item.warehouseProductId ? warehouseDownloads[item.warehouseProductId]?.estimatedTotal : '') || ''
    // 主图与「查看页面」共用同一下载图文页链路：仅 DOWNLOADED 档案可点开
    const downloadId = item.warehouseProductId && warehouseDownloads[item.warehouseProductId]?.status === 'DOWNLOADED' ? item.warehouseProductId : ''
    const openStoredDownload = () => { if (!downloadId) return; void window.desktop.warehouses.openDownload(downloadId).catch(reason => failInbound(reason, '打开下载图文页')) }
    return <article className={`product-card candidate-product-card supply-source-card${delisted ? ' delisted-product-card' : ''}`} key={item.id}>
      <div className="candidate-card-tools">{batchMode ? <label title="选择商品"><input type="checkbox" checked={checkedKeys.has(item.id)} onChange={() => toggleKey(item.id)}/></label> : null}</div>
      <button type="button" className="product-image" aria-label={downloadId ? `查看下载图文页：${item.title}` : `查看商品图片：${item.title}`} title={downloadId ? '点击查看下载图文页' : undefined} onClick={downloadId ? () => openStoredDownload() : undefined}>
        {item.imageUrl ? <img src={item.imageUrl} alt={item.title}/> : <span>无图</span>}
        {item.promotionText ? <span className="candidate-promotion">{item.promotionText}</span> : null}
        <span className={`score-badge${scoreValue === null ? ' pending' : ''}`} title={scoreValue === null ? 'GIGA Index 未采集，待重读补采' : `评分依据：GIGA Index ${item.gigaIndex}`}>{scoreValue === null ? '待评分' : `${Math.round(scoreValue)}分 · ${scoreGrade}级`}</span>
      </button>
      <div className="product-info supply-source-info">
        <b title={item.title}>{item.title}</b>
        <strong>{item.priceText || '价格待核验'}</strong>
        <dl className="candidate-source-facts">
          <div><dt>原货盘</dt><dd>{item.warehouseCode === 'GIGACLOUD' ? '大健云仓' : item.warehouseCode} · Item Code {item.itemCode || '—'}</dd></div>
          <div><dt>地区货盘</dt><dd>{item.region || '—'}</dd></div>
          <div><dt>预估总额</dt><dd title={estimatedTotalText ? `${estimatedTotalText} (含物流费)` : ''}>{estimatedTotalText ? `${estimatedTotalText} (含物流费)` : '待补采'}</dd></div>
          <div><dt>物流费</dt><dd>{item.shippingFeeText || '待补采'}</dd></div>
          <div><dt>可售库存</dt><dd>{inventoryText}</dd></div>
          <div><dt>原始类目</dt><dd title={sourceCatalogText}>{sourceCatalogText}</dd></div>
          <div><dt>现在类目</dt><dd title={currentCatalogText}>{currentCatalogText}</dd></div>
          <div><dt>GIGA Index</dt><dd>{item.gigaIndexText ?? item.gigaIndex ?? '待补采'}</dd></div>
          <div><dt>采集时间</dt><dd>{(item.collectedAt || '').slice(0, 10) || '—'}</dd></div>
          {delisted && <div><dt>下架原因</dt><dd title={delisted.reason}>{delisted.reason || '—'}</dd></div>}
          {delisted && <div><dt>下架时间</dt><dd>{delisted.at ? new Date(delisted.at).toLocaleString('zh-CN') : '—'}</dd></div>}
        </dl>
        <div className="product-actions candidate-next-actions">
          {downloadId ? <button onClick={() => openStoredDownload()}>查看页面</button> : null}
          {delisted ? <>
            <button disabled={!canEdit} onClick={() => updateDelisted(item)}>更新产品</button>
            <button className="primary" disabled={!canEdit} onClick={() => restoreDelisted(item.warehouseProductId)}>重新上架</button>
            <button className="candidate-delete" disabled={!canEdit} onClick={() => deleteDelisted(item)}>删除产品</button>
          </> : <>
            {scope === 'warehouse' ? (
              myPalletIds.has(item.warehouseProductId)
                ? <button className="my-pallet-added" title="点击移出我的货盘" onClick={() => removeFromMyPallet([item.warehouseProductId])}>已加入</button>
                : <button onClick={() => addToMyPallet([item.warehouseProductId])}>加入我的货盘</button>
            ) : <>
              <button className="primary" title="送入 eBay 工作台本地产品" onClick={() => void sendToEbay(item.warehouseProductId)}>送eBay</button>
              <button className="candidate-delete" onClick={() => removeFromMyPallet([item.warehouseProductId])}>移除</button>
            </>}
            {scope === 'warehouse' && canEdit && <button onClick={() => returnPalletItem(item)}>退回入库处理</button>}
          </>}
        </div>
      </div>
    </article>
  }

  return <>
    <div className="selection-module-nav warehouse-flow-nav">
      {hubTabsForScope(scope).map(tab => <button key={tab} className={hubTab === tab ? 'active' : ''} onClick={() => { setHubTab(tab); setBatchMode(false); setCheckedKeys(new Set()); setActiveInboundId('') }}><span>{tab}</span></button>)}
    </div>
    <section className={`candidate-page pallet-catalog-page${catalogPanel.collapsed?' side-collapsed':''}`}>
      {catalogPanel.collapsed?<PanelExpandRail panel={catalogPanel} label="产品目录库"/>:<aside className="catalog-panel collapsible-aside">
        <div className="catalog-heading catalog-heading-row"><h2>产品目录库</h2><PanelCollapseButton panel={catalogPanel}/></div>
        <button className={`catalog-all ${selected === 'ALL' ? 'active' : ''}`} onClick={() => { setSelected('ALL'); setSelectedSubcategory('') }}><span>全部产品</span><em>{items.length}</em></button>
        <div className="catalog-tree">
          {catalogTree.categories.map(group => {
            const open = expanded === group.name
            return <div className="catalog-group" key={group.name}>
              <button className={treeActiveClass(group.name, '')} title={group.name} onClick={() => {
                if (activeInbound) { setExpanded(group.name); assignCatalog(activeInbound, { category: group.name, subcategory: '', tertiaryCategory: '' }, '已选一级类目，请继续选择二级类目', false); return }
                setSelected(group.name); setExpanded(open ? '' : group.name); setSelectedSubcategory(open ? '' : group.children[0] || '')
              }}>
                <i>{open ? '⌄' : '›'}</i><span>{group.name}</span><em>{countCategory(group.name)}</em>
              </button>
              {open && <div>
                {group.children.map(child => <button key={child} className={treeActiveClass(child, group.name)} title={child} onClick={() => {
                  if (activeInbound) {
                    const hasTertiary = (MOCK_TERTIARY_CATALOG[child] || []).length > 0
                    setSelectedSubcategory(child)
                    assignCatalog(activeInbound, { category: group.name, subcategory: child, tertiaryCategory: '' }, hasTertiary ? '已选二级类目，请继续选择三级类目' : `类目已归位：${group.name} / ${child}`, !hasTertiary)
                    return
                  }
                  setSelected(child); setSelectedSubcategory(child)
                }}>
                  <span>{child}</span><em>{countSubcategory(group.name, child)}</em>
                </button>)}
              </div>}
            </div>
          })}
        </div>
        {selectedSubcategory && tertiaryOptions.length > 0 && <div className="tertiary-flyout">
          <div><small>LEVEL 3 CATEGORY</small><b>{selectedSubcategory}</b><button onClick={() => setSelectedSubcategory('')}>×</button></div>
          <div className="tertiary-icon-grid">
            {tertiaryOptions.map(option => <button key={option.name} className={treeActiveClass(option.name, selectedSubcategory, true)} onClick={() => {
              if (activeInbound) { assignCatalog(activeInbound, { category: activeInbound.snapshot.category, subcategory: activeInbound.snapshot.subcategory, tertiaryCategory: option.name }, `类目已归位：${activeInbound.snapshot.category} / ${activeInbound.snapshot.subcategory} / ${option.name}`, true); return }
              setSelected(option.name); setSelectedSubcategory('')
            }}>
              <i>{option.icon.endsWith('.png') ? <img src={option.icon} alt={option.name}/> : option.icon}</i><span>{option.name}</span><em>{option.count}</em>
            </button>)}
          </div>
        </div>}
      </aside>}
      <div className="candidate-catalog-main">
        <div className="warehouse-page-heading"><div><small>{scope === 'mine' ? '我的货盘' : '货盘仓库'}</small><div className="pallet-heading-title-row"><b>{hubTab === '入库处理' ? '入库处理 · 待确认队列' : hubTab === '下架产品' ? '下架产品 · 可恢复' : scope === 'mine' ? '我的入选 · 货盘仓库选入' : '全部货源 · 已存放'}</b><em>{hubTab === '入库处理' ? inboundVisible.length : hubTab === '下架产品' ? delistedVisible.length : visible.length}</em></div></div>{hubTab === '入库处理' && <div className="pallet-heading-switch"><div className="candidate-view-switch inbound-status-filter">
          {INBOUND_FILTERS.map(filter => <button key={filter.key} className={inboundFilter === filter.key ? 'active' : ''} onClick={() => setInboundFilter(filter.key)}>
            {filter.label} <em>{inboundItems.filter(item => item.status === filter.key).length}</em>
          </button>)}
        </div></div>}</div>
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
          {scope === 'warehouse'
            ? <button disabled={!checkedKeys.size} onClick={() => addToMyPallet(checkedWarehouseIds())}>加入我的货盘</button>
            : <button disabled={!checkedKeys.size} onClick={() => removeFromMyPallet(checkedWarehouseIds())}>移除已选</button>}
          {canEdit && scope === 'warehouse' && <button className="danger" disabled={!checkedKeys.size} onClick={() => removeItems([...checkedKeys])}>删除已选</button>}
        </div>}
        <div className="candidate-zone-summary">
          {hubTab === '入库处理' ? <>
            <span>待确认 <b>{inboundItems.filter(item => item.status === 'PENDING').length}</b></span>
            <span>采集源 <b>{new Set(inboundItems.map(item => item.snapshot.platformCode)).size}</b></span>
            <span>当前显示 <b>{inboundVisible.length}</b></span>
          </> : hubTab === '下架产品' ? <>
            <span>已下架 <b>{delistedItems.length}</b></span>
            <span>可恢复 <b>{delistedItems.length}</b></span>
            <span>当前显示 <b>{delistedVisible.length}</b></span>
          </> : <>
            <span>{scope === 'mine' ? '我的货盘商品' : '货盘商品'} <b>{items.length}</b></span>
            <span>采集批次 <b>—</b></span>
            <span>采集方式 <b>{items.length ? 1 : 0}</b></span>
            <span>当前显示 <b>{visible.length}</b></span>
          </>}
        </div>
        {inboundOk ? <div className="erp-banner erp-banner-ok">{inboundOk}</div> : null}
        {inboundNotice ? <div className="erp-banner erp-banner-error">{inboundNotice}</div> : null}
        {notice ? <div className="erp-banner erp-banner-error"><span>{notice}</span>{noticeRetry ? <button type="button" onClick={() => noticeRetry()}>重试</button> : null}</div> : null}
        {hubTab === '入库处理' ? (
          caps !== null && !caps.canEdit ? (
            <div className="empty-state"><span>◎</span><h2>无入库处理权限</h2><p>当前账号缺少 ERP 仓库编辑权限（erp.warehouse.edit），无法同步采集池与确认入库，请联系管理员开通。</p></div>
          ) : inboundVisible.length === 0 ? <div className="empty-state"><span>◎</span><h2>暂无{INBOUND_FILTERS.find(filter => filter.key === inboundFilter)?.label}产品</h2><p>各货盘（1688、大健云仓等）选品审批通过或服务器采集池 COLLECTED 的原始产品会集中在这里待确认。</p></div> : (
          <div className="product-grid">
            {inboundVisible.map(item => {
              const snapshot = item.snapshot
              const edit = inboundEdit?.id === item.id ? inboundEdit.draft : null
              const assignedInCatalog = MOCK_CATEGORIES.some(group => group.name === snapshot.category)
              const rec = assignedInCatalog ? null : recommendCatalogPath(snapshot)
              const scoreValue = snapshot.gigaIndex ?? snapshot.score ?? null
              const scoreGrade = scoreValue === null ? null : Math.round(scoreValue) >= 80 ? 'A' : Math.round(scoreValue) >= 65 ? 'B' : 'C'
              const inventoryText = snapshot.sellableInventory !== null && snapshot.sellableInventory !== undefined ? snapshot.sellableInventory.toLocaleString('zh-CN') : snapshot.salesText?.replace(/^(?:Available\s*Stock|可售库存|库存)\s*[:：]?\s*/i, '') || '待补采'
              const sourceCatalogText = snapshot.sourceCategory ? `${snapshot.sourceCategory} / ${snapshot.sourceSubcategory || '—'} / ${snapshot.sourceTertiaryCategory || '—'}` : '类目待核实'
              const currentCatalogText = snapshot.category ? `${snapshot.category} / ${snapshot.subcategory || '—'} / ${snapshot.tertiaryCategory || '—'}` : '—'
              // 入库卡与存放卡同口径：主图与「查看页面」共用下载图文页链路
              const downloadId = item.warehouseProductId && warehouseDownloads[item.warehouseProductId]?.status === 'DOWNLOADED' ? item.warehouseProductId : ''
              const openInboundDownload = () => { if (!downloadId) return; void window.desktop.warehouses.openDownload(downloadId).catch(reason => failInbound(reason, '打开下载图文页')) }
              const estimatedTotalText = (downloadId ? warehouseDownloads[downloadId]?.estimatedTotal : '') || ''
              return (
              <article className={`product-card candidate-product-card supply-source-card${activeInboundId === item.id ? ' inbound-card-active' : ''}`} key={item.id} onClick={event => { if ((event.target as HTMLElement).closest('button, input, select, textarea, a')) return; setActiveInboundId(activeInboundId === item.id ? '' : item.id) }}>
                <button type="button" className="product-image" aria-label={downloadId ? `查看下载图文页：${snapshot.title}` : `查看商品图片：${snapshot.title}`} title={downloadId ? '点击查看下载图文页' : undefined} onClick={downloadId ? () => openInboundDownload() : undefined}>
                  {snapshot.imageUrl ? <img src={snapshot.imageUrl} alt={snapshot.title}/> : <span>无图</span>}
                  {snapshot.promotionText ? <span className="candidate-promotion">{snapshot.promotionText}</span> : null}
                  <span className={`score-badge${scoreValue === null ? ' pending' : ''}`} title={scoreValue === null ? 'GIGA Index 未采集，待重读补采' : `评分依据：GIGA Index ${snapshot.gigaIndex}`}>{scoreValue === null ? '待评分' : `${Math.round(scoreValue)}分 · ${scoreGrade}级`}</span>
                </button>
                <div className="product-info supply-source-info">
                  <b title={snapshot.title}>{snapshot.title}</b>
                  <strong>{snapshot.priceText || '价格待核验'}</strong>
                  <dl className="candidate-source-facts">
                    <div><dt>原货盘</dt><dd>{snapshot.platformCode === 'GIGACLOUD' ? '大健云仓' : snapshot.platformCode} · Item Code {snapshot.itemCode || '—'}</dd></div>
                    <div><dt>地区货盘</dt><dd>{item.region || '—'}</dd></div>
                    <div><dt>预估总额</dt><dd title={estimatedTotalText ? `${estimatedTotalText} (含物流费)` : ''}>{estimatedTotalText ? `${estimatedTotalText} (含物流费)` : '待补采'}</dd></div>
                    <div><dt>物流费</dt><dd>{snapshot.shippingFeeText || '待补采'}</dd></div>
                    <div><dt>可售库存</dt><dd>{inventoryText}</dd></div>
                    <div><dt>原始类目</dt><dd title={sourceCatalogText}>{sourceCatalogText}</dd></div>
                    <div><dt>现在类目</dt><dd title={currentCatalogText}>{currentCatalogText}</dd></div>
                    <div><dt>GIGA Index</dt><dd>{snapshot.gigaIndexText ?? snapshot.gigaIndex ?? '待补采'}</dd></div>
                    <div><dt>采集时间</dt><dd>{(snapshot.collectedAt || '').slice(0, 10) || '—'}</dd></div>
                    {item.status === 'REJECTED' && <div><dt>驳回时间</dt><dd>{(item.updatedAt || '').slice(0, 10)}</dd></div>}
                    {item.status === 'CONFIRMED' && <div><dt>确认时间</dt><dd>{(item.confirmedAt || '').slice(0, 10)}</dd></div>}
                  </dl>
                  {!assignedInCatalog || activeInboundId === item.id ? (
                  <div className="inbound-category-row">
                    {!assignedInCatalog && rec ? (
                      <>
                        <span className="path recommend">推荐：{catalogPathText(rec)}</span>
                        <button type="button" onClick={() => assignCatalog(item, rec, `已采纳推荐类目：${catalogPathText(rec)}`, false)}>采纳推荐</button>
                      </>
                    ) : !assignedInCatalog ? (
                      <span className="path empty">未匹配到推荐类目，请手动选择</span>
                    ) : null}
                    {activeInboundId === item.id ? <span className="hint">请在左侧目录树点选类目</span> : null}
                  </div>
                  ) : null}
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
                  ) : null}
                  <div className="product-actions candidate-next-actions">
                    {item.status === 'PENDING' && <>
                      <button onClick={() => setInboundEdit(edit ? null : { id: item.id, draft: { ...snapshot } })}>{edit ? '收起编辑' : '重新编辑'}</button>
                      <button className="primary" onClick={() => confirmInbound(item.id)}>确认入库</button>
                      <button className="candidate-delete" onClick={() => rejectInbound(item.id)}>驳回</button>
                    </>}
                    {item.status === 'REJECTED' && <button onClick={() => setInboundEdit({ id: item.id, draft: { ...snapshot } })}>重新编辑</button>}
                    {downloadId ? <button onClick={() => openInboundDownload()}>查看页面</button> : null}
                  </div>
                </div>
              </article>
              )
            })}
          </div>)
        ) : hubTab === '下架产品' ? (
          delistedVisible.length === 0 ? <div className="empty-state"><span>◎</span><h2>暂无下架产品</h2><p>正式入库中下架的商品会保留原因和时间，可在此恢复为有效商品。</p></div> : <div className="product-grid">
            {delistedVisible.map(item => renderStoredCard(item, { reason: item.delistedReason, at: item.delistedAt }))}
          </div>
        ) : hubTab === '地区货盘' ? (
          regionGroups.length === 0 ? <div className="empty-state"><span>◎</span><h2>暂无地区货盘</h2><p>产品确认入库时携带地区货盘（如美国货盘）后，会在此按国家货盘分组展示。</p></div> : <>
            <div className="candidate-view-switch inbound-status-filter">{regionGroups.map(region => <button key={region} className={activeRegion === region ? 'active' : ''} onClick={() => setSelectedRegion(region)}>{region} <em>{items.filter(entry => entry.region === region).length}</em></button>)}</div>
            <div className="product-grid">{items.filter(entry => entry.region === activeRegion).map(item => renderStoredCard(item))}</div>
          </>
        ) : !DATA_READY_TABS.includes(hubTab) ? (
          <div className="empty-state"><span>◎</span><h2>{hubTab} · 即将上线</h2><p>该栏目暂未接入数据源，敬请期待；当前可使用「入库处理 / 全部产品 / 新品速递 / 下架产品」。</p></div>
        ) : visible.length === 0 ? <div className="empty-state"><span>◎</span><h2>{scope === 'mine' ? '暂无我的货盘产品' : '暂无货盘商品'}</h2><p>{scope === 'mine' ? '到「货盘仓库」在产品卡点击「加入我的货盘」挑选适合你营运的产品；加入后可在本页送 AI跨境 营运。' : '当前栏目或筛选条件下没有商品。产品经“入库处理”审核确认后转入这里。'}</p></div> : <div className="product-grid">
          {visible.map(item => renderStoredCard(item))}
        </div>}
      </div>
    </section>
  </>
}
