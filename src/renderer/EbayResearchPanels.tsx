// 搜索采集「关键词研究 / 入选榜单」页内工作台。
// 全链路在页内完成：关键词输入→读30天已售→热销判定→勾选入榜→按词分组展示。
// 数据经主进程复用「浏览器」登录态直连 Terapeak GraphQL，不依赖浏览器页签交互。
import { useEffect, useMemo, useState } from 'react'
import type { EbayResearchResult, EbayShortlistItem, ResearchHotThreshold } from '../shared/ebayResearch'
import { DEFAULT_HOT_THRESHOLD, isHotListing } from '../shared/ebayResearch'

const money = (n: number) => `$${n.toFixed(2)}`
const count = (n: number) => n.toLocaleString('en-US')

export function ResearchPanel({ storeId }: { storeId?: string }) {
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [result, setResult] = useState<EbayResearchResult | null>(null)
  const [threshold, setThreshold] = useState<ResearchHotThreshold>(DEFAULT_HOT_THRESHOLD)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const query = async () => {
    const kw = keyword.trim()
    if (!kw || !storeId) return
    setLoading(true); setError(''); setNotice(''); setSelected(new Set())
    try {
      const r = await window.desktop.ebay.research.query(storeId, kw)
      setResult(r)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setResult(null) }
    finally { setLoading(false) }
  }

  const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const selectHot = () => { if (!result) return; setSelected(new Set(result.listings.filter(l => isHotListing(l, threshold)).map(l => l.itemId))) }

  const addToShortlist = async () => {
    if (!result || !storeId || selected.size === 0) return
    const items = result.listings.filter(l => selected.has(l.itemId)).map(l => ({ keyword: result.keyword, storeId, itemId: l.itemId, title: l.title, imageUrl: l.imageUrl, itemSoldCount: l.itemSoldCount, avgSoldPrice: l.avgSoldPrice, avgShipping: l.avgShipping, totalSales: l.totalSales, lastSoldDateTime: l.lastSoldDateTime }))
    try {
      await window.desktop.ebay.shortlist.add(items)
      setNotice(`已将 ${items.length} 个热品按关键词「${result.keyword}」入选榜单`)
      setSelected(new Set())
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  if (!storeId) return <section className="ai-crossborder-page"><div className="ai-crossborder-header"><h2>关键词研究</h2><p>请先在「浏览器」页签添加并登录 eBay 店铺</p></div></section>

  return <section className="research-page">
    <div className="research-bar">
      <input value={keyword} onChange={e => setKeyword(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void query() }} placeholder="输入关键词，如 Headlight Assemblies" />
      <button className="primary" disabled={loading || !keyword.trim()} onClick={() => void query()}>{loading ? '查询中…' : '查询30天已售'}</button>
    </div>
    <div className="research-threshold">
      <span>热销判定：</span>
      <label>售出总计≥<input type="number" value={threshold.minSold} onChange={e => setThreshold(t => ({ ...t, minSold: Number(e.target.value) || 0 }))} /></label>
      <label>销售额≥$<input type="number" value={threshold.minRevenue} onChange={e => setThreshold(t => ({ ...t, minRevenue: Number(e.target.value) || 0 }))} /></label>
      <button onClick={selectHot} disabled={!result}>全选命中</button>
    </div>
    {error && <div className="research-error">{error}</div>}
    {notice && <div className="research-notice">{notice}</div>}
    {result && <>
      <div className="research-stats">
        <div><b>{money(result.summary.avgPrice)}</b><small>平均售价</small></div>
        <div><b>{count(result.summary.itemSoldCount)}</b><small>30天售出总计</small></div>
        <div><b>{money(result.summary.totalRevenue)}</b><small>物品销售额</small></div>
        <div><b>{count(result.summary.sellerCount)}</b><small>卖家总数</small></div>
        <div><b>{result.summary.freeShippingPercent.toFixed(0)}%</b><small>包邮</small></div>
      </div>
      <div className="research-table-wrap">
        <table className="research-table">
          <thead><tr><th></th><th>物品刊登</th><th>售出总计</th><th>平均售价</th><th>平均运费</th><th>销售额</th><th>上次售出</th></tr></thead>
          <tbody>
            {result.listings.map(l => {
              const hot = isHotListing(l, threshold)
              return <tr key={l.itemId} className={hot ? 'hot' : ''}>
                <td><input type="checkbox" checked={selected.has(l.itemId)} onChange={() => toggle(l.itemId)} /></td>
                <td className="research-title">{l.imageUrl && <img src={l.imageUrl} alt="" />}<span>{l.title}</span>{hot && <em className="research-hot-tag">热销</em>}</td>
                <td>{count(l.itemSoldCount)}</td>
                <td>{money(l.avgSoldPrice)}</td>
                <td>{money(l.avgShipping)}</td>
                <td>{money(l.totalSales)}</td>
                <td>{l.lastSoldDateTime.slice(0, 10)}</td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
      <div className="research-footer">
        <span>已选 {selected.size} 个</span>
        <button className="primary" disabled={selected.size === 0} onClick={() => void addToShortlist()}>入榜单（按关键词分组）</button>
      </div>
    </>}
  </section>
}

export function ShortlistPanel() {
  const [items, setItems] = useState<EbayShortlistItem[]>([])
  const [loading, setLoading] = useState(true)
  const load = async () => { setLoading(true); try { setItems(await window.desktop.ebay.shortlist.list()) } finally { setLoading(false) } }
  useEffect(() => { void load() }, [])
  const groups = useMemo(() => {
    const m = new Map<string, EbayShortlistItem[]>()
    for (const it of items) { const arr = m.get(it.keyword) || []; arr.push(it); m.set(it.keyword, arr) }
    return [...m.entries()]
  }, [items])
  const remove = async (id: string) => { await window.desktop.ebay.shortlist.remove(id); void load() }

  return <section className="research-page">
    <div className="ai-crossborder-header"><h2>入选榜单</h2><p>按关键词分组的热销产品，供货源匹配/选品决策/立项入库使用</p></div>
    {loading && <p className="research-empty">加载中…</p>}
    {!loading && groups.length === 0 && <p className="research-empty">暂无入选产品，请到「关键词研究」查询并勾选入榜</p>}
    {groups.map(([kw, arr]) => <div className="shortlist-group" key={kw}>
      <div className="shortlist-group-head"><b>{kw}</b><span>{arr.length} 个热品</span></div>
      <table className="research-table">
        <thead><tr><th>物品刊登</th><th>售出总计</th><th>平均售价</th><th>销售额</th><th>操作</th></tr></thead>
        <tbody>{arr.map(it => <tr key={it.id}>
          <td className="research-title">{it.imageUrl && <img src={it.imageUrl} alt="" />}<span>{it.title}</span></td>
          <td>{count(it.itemSoldCount)}</td>
          <td>{money(it.avgSoldPrice)}</td>
          <td>{money(it.totalSales)}</td>
          <td><button onClick={() => void remove(it.id)}>移除</button></td>
        </tr>)}</tbody>
      </table>
    </div>)}
  </section>
}