// 搜索采集「入选榜单」页内工作台：按关键词分组展示已入选热销产品。
import { useEffect, useMemo, useState } from 'react'
import type { EbayShortlistItem } from '../shared/ebayResearch'

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