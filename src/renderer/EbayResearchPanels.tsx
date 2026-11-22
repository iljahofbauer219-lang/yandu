// 搜索采集「入选榜单」页内工作台：按关键词分组展示已入选热销产品。
import { useEffect, useMemo, useState } from 'react'
import type { EbayShortlistItem, ResearchCollectedItem } from '../shared/ebayResearch'

const money = (n: number) => `$${n.toFixed(2)}`
const count = (n: number) => n.toLocaleString('en-US')

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
    {!loading && groups.length === 0 && <p className="research-empty">暂无入选产品</p>}
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

// 关键词热销：左右布局（同我的货盘）。左=已采集关键词列表（去重+计数），右=所选关键词的已采集产品。
export function KeywordHotPanel() {
  const [items, setItems] = useState<ResearchCollectedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeKw, setActiveKw] = useState('')
  useEffect(() => {
    void window.desktop.ebay.research.collectedList()
      .then(list => { setItems(list); setActiveKw(prev => prev || (list[0]?.keyword ?? '')) })
      .finally(() => setLoading(false))
  }, [])
  const groups = useMemo(() => {
    const m = new Map<string, ResearchCollectedItem[]>()
    for (const it of items) { const arr = m.get(it.keyword) || []; arr.push(it); m.set(it.keyword, arr) }
    return [...m.entries()]
  }, [items])
  const active = groups.find(([kw]) => kw === activeKw)?.[1] ?? []

  return <section className="kwh-page">
    <aside className="kwh-aside">
      <div className="kwh-aside-head"><b>关键词列表</b><span>{groups.length}</span></div>
      {loading && <p className="research-empty">加载中…</p>}
      {!loading && groups.length === 0 && <p className="research-empty">暂无采集，请在浏览器研究页用采集插件勾选入库</p>}
      {groups.map(([kw, arr]) => (
        <button key={kw} type="button" className={`kwh-kw${kw === activeKw ? ' active' : ''}`} onClick={() => setActiveKw(kw)}>
          <span>{kw}</span><em>{arr.length}</em>
        </button>
      ))}
    </aside>
    <main className="kwh-main">
      {active.length === 0
        ? <p className="research-empty">选择左侧关键词查看已采集产品</p>
        : <div className="kwh-grid">{active.map(it => (
          <div className="kwh-card" key={it.id}>
            {it.imageUrl && <img src={it.imageUrl} alt="" />}
            <b>{it.title}</b>
            <div className="kwh-metrics"><span>售出 {count(it.itemSoldCount)}</span><span>{money(it.avgSoldPrice)}</span><span>{money(it.totalSales)}</span></div>
          </div>
        ))}</div>}
    </main>
  </section>
}