import { useState } from 'react'

interface Props {
  value: string
  onChange: (v: string) => void
  hotSearch: string[]
  totalCount: number
  shownCount: number
}

export function SearchBar({ value, onChange, hotSearch, totalCount, shownCount }: Props) {
  const [focused, setFocused] = useState(false)

  // 搜索跳转 amz123 站内搜索（保持 1:1 体验）
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!value.trim()) return
    const url = `https://www.amz123.com/search?keyword=${encodeURIComponent(value.trim())}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="search">
      <form id="search" className="search-form" onSubmit={handleSubmit}>
        <div className={`search-box ${focused ? 'focused' : ''}`}>
          <span className="search-icon">🔍</span>
          <input
            id="search-input"
            name="q"
            type="text"
            className="search-input"
            placeholder="搜索跨境平台（亚马逊、TikTok、SHEIN…）"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
          <button type="submit" className="search-btn">搜 索</button>
        </div>
      </form>

      <div className="search-meta">
        <span className="search-meta-count">
          共收录 <b>{totalCount}</b> 个跨境平台
          {value && shownCount !== totalCount && (
            <> · 当前匹配 <b>{shownCount}</b> 个</>
          )}
        </span>
        {hotSearch.length > 0 && (
          <div className="hot-search">
            <span className="hot-search-label">热门：</span>
            {hotSearch.map((w) => (
              <button
                key={w}
                type="button"
                className="hot-search-tag"
                onClick={() => onChange(w)}
              >
                {w}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
