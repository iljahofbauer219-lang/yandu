/**
 * ProductLibrary — 商品库展示与选择（核心组件）
 *
 * 三来源分组：1688 提取 / 本地图片 / 草稿
 * - 顶部分段切换 (segmented)
 * - 卡片网格：缩略图 + 标题 + 来源徽标 + 价格 + 摘要 + 时间
 * - 卡片操作：选中 / 删除
 * - 空态：友好引导
 *
 * 复用：
 * - Hub 商品库弹窗（AIEmployeeHub 触发）
 * - 工作台右侧抽屉（AIEmployee 触发）
 *
 * Props:
 * - onSelect(item): 用户选中商品时的回调
 * - onPickFiles?(): 「上传本地图片」回调（工作台抽屉有，Hub 弹窗可省）
 * - onExtract1688?(): 「从 1688 当前页提取」回调（工作台抽屉有）
 * - onClose?(): 关闭回调（Hub 弹窗有，抽屉由外层控制）
 */

import { useMemo, useState } from 'react'
import {
  loadProductLibrary,
  removeProductItem,
  SOURCE_LABELS,
  buildSummary,
  type ProductLibraryItem,
  type ProductLibrarySource
} from '../shared/productLibrary'

type SourceFilter = 'all' | ProductLibrarySource

type Props = {
  onSelect: (item: ProductLibraryItem) => void
  onPickFiles?: () => void
  onExtract1688?: () => void
  onClose?: () => void
}

export default function ProductLibrary({ onSelect, onPickFiles, onExtract1688, onClose }: Props) {
  const [filter, setFilter] = useState<SourceFilter>('all')
  const [keyword, setKeyword] = useState('')
  // 简单 forceReload 计数：删除后列表需要重读
  const [reloadTick, setReloadTick] = useState(0)

  const items = useMemo(() => {
    void reloadTick
    return loadProductLibrary()
  }, [reloadTick])

  const counts = useMemo(() => {
    const c: Record<SourceFilter, number> = { all: items.length, '1688': 0, local: 0, draft: 0 }
    items.forEach(it => { c[it.source] += 1 })
    return c
  }, [items])

  const filtered = useMemo(() => {
    const lower = keyword.trim().toLowerCase()
    return items
      .filter(it => filter === 'all' || it.source === filter)
      .filter(it => !lower || (it.title || '').toLowerCase().includes(lower) || (it.summary || '').toLowerCase().includes(lower))
  }, [items, filter, keyword])

  const handleRemove = (id: string) => {
    if (!window.confirm('确认从商品库移除该商品？')) return
    removeProductItem(id)
    setReloadTick(t => t + 1)
  }

  return (
    <div className="ai-employee-product-library">
      <header className="ai-employee-product-library-head">
        <div className="ai-employee-product-library-tabs" role="tablist" aria-label="商品库分类">
          {(['all', '1688', 'local', 'draft'] as SourceFilter[]).map(f => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              className={filter === f ? 'active' : ''}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? '🌐 全部' : `${SOURCE_LABELS[f].emoji} ${SOURCE_LABELS[f].label}`}
              <small>{counts[f]}</small>
            </button>
          ))}
        </div>
        <div className="ai-employee-product-library-search">
          <input
            type="search"
            value={keyword}
            onChange={event => setKeyword(event.target.value)}
            placeholder="搜索商品标题或摘要…"
            aria-label="搜索商品"
          />
          {onPickFiles && (
            <button type="button" className="ai-employee-product-library-action" onClick={onPickFiles} title="上传本地图片">
              📎 上传
            </button>
          )}
          {onExtract1688 && (
            <button type="button" className="ai-employee-product-library-action primary" onClick={onExtract1688} title="从当前 1688 标签页提取">
              🛒 1688 提取
            </button>
          )}
          {onClose && (
            <button type="button" className="ai-employee-product-library-close" onClick={onClose} aria-label="关闭">×</button>
          )}
        </div>
      </header>

      {filtered.length === 0 ? (
        <div className="ai-employee-product-library-empty">
          <p>暂无商品{items.length === 0 ? '。从工作台使用「📎 上传」或「🛒 1688 提取」可加入商品库。' : '匹配当前筛选。'}</p>
        </div>
      ) : (
        <div className="ai-employee-product-library-grid">
          {filtered.map(item => (
            <ProductCard
              key={item.id}
              item={item}
              onSelect={() => onSelect(item)}
              onRemove={() => handleRemove(item.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ProductCard({ item, onSelect, onRemove }: { item: ProductLibraryItem; onSelect: () => void; onRemove: () => void }) {
  const meta = SOURCE_LABELS[item.source]
  const summary = item.summary || buildSummary(item.source, item.payload)
  return (
    <article className="ai-employee-product-card" onClick={onSelect} role="button" tabIndex={0}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect() } }}
    >
      <div className="ai-employee-product-card-thumb" aria-hidden="true">
        {item.thumbnail
          ? <img src={item.thumbnail} alt="" loading="lazy" />
          : <span className="ai-employee-product-card-placeholder">{meta.emoji}</span>}
      </div>
      <div className="ai-employee-product-card-body">
        <h4 title={item.title}>{item.title || '(无标题)'}</h4>
        <small>{summary}</small>
        <footer>
          <span className="ai-employee-product-card-source" style={{ color: meta.tone, borderColor: meta.tone }}>
            {meta.emoji} {meta.label}
          </span>
          {item.price && <b className="ai-employee-product-card-price">{item.price}</b>}
          <time>{formatTime(item.createdAt)}</time>
        </footer>
      </div>
      <button
        type="button"
        className="ai-employee-product-card-remove"
        onClick={event => { event.stopPropagation(); onRemove() }}
        aria-label="移除该商品"
        title="移除"
      >
        ×
      </button>
    </article>
  )
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const dayMs = 86400000
    if (diffMs < 60000) return '刚刚'
    if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)} 分钟前`
    if (diffMs < dayMs) return `${Math.floor(diffMs / 3600000)} 小时前`
    if (diffMs < dayMs * 7) return `${Math.floor(diffMs / dayMs)} 天前`
    return `${d.getMonth() + 1}/${d.getDate()}`
  } catch {
    return ''
  }
}
