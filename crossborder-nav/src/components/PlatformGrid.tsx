import type { Region } from '../data/_regions'
import { findDetailBySiteName } from '../data/_platformDetails'

interface Props {
  regions: Region[]
  query: string
  /** 已建详情页的平台 → 站内路由跳转；未建 → 仍走原 <a target=_blank> */
  onOpenDetail: (slug: string) => void
}

export function PlatformGrid({ regions, query, onOpenDetail }: Props) {
  if (regions.length === 0) {
    return (
      <div className="empty">
        <p>没有找到与「<b>{query}</b>」相关的平台。</p>
        <p className="empty-tip">试试搜索：亚马逊、TikTok、SHEIN、Temu、Lazada…</p>
      </div>
    )
  }

  return (
    <div className="regions">
      {regions.map((region) => (
        <section
          key={region.title}
          id={`region-${region.title}`}
          className="region"
        >
          <h2 className="region-title">
            <span className="region-title-bar" />
            <span className="region-title-text">{region.title}</span>
            <span className="region-title-count">{region.sites.length} 个平台</span>
          </h2>
          <ul className="site-grid">
            {region.sites.map((s) => {
              const detail = findDetailBySiteName(s.name)
              return (
                <li key={s.name} className="site-card">
                  <a
                    className="site-card-link"
                    href={detail ? `platform/${detail.slug}` : s.href || '#'}
                    target={detail ? undefined : '_blank'}
                    rel={detail ? undefined : 'noopener noreferrer'}
                    title={s.desc || s.name}
                    onClick={detail
                      ? (e) => {
                          e.preventDefault()
                          onOpenDetail(detail.slug)
                        }
                      : undefined}
                  >
                  <div className="site-card-logo">
                    <img
                      src={s.logo}
                      alt={s.name}
                      loading="lazy"
                      onError={(e) => {
                        // logo 加载失败 → 显示文字占位
                        const t = e.currentTarget
                        t.style.display = 'none'
                        const fb = t.parentElement?.querySelector('.site-card-logo-fallback')
                        if (fb) (fb as HTMLElement).style.display = 'flex'
                      }}
                    />
                    <span className="site-card-logo-fallback" style={{ display: 'none' }}>
                      {s.name.slice(0, 2)}
                    </span>
                  </div>
                  <div className="site-card-body">
                    <div className="site-card-name">{s.name}</div>
                    {s.desc && (
                      <div className="site-card-desc">{s.desc.trim()}</div>
                    )}
                  </div>
                  </a>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
