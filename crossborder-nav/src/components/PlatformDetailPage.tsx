import type { PlatformDetail } from '../data/_platformDetails'

interface Props {
  detail: PlatformDetail
  /** 部署基路径（如 /nav/），用于把 './logos/x' 解析为绝对路径 */
  base: string
  onBack: () => void
}

const asset = (p: string, base: string) => (p.startsWith('./') ? base + p.slice(2) : p)

/** 平台详情页：① 顶部横幅简写 + ② 分站入口（新页）+ ③ 详细简介 */
export function PlatformDetailPage({ detail, base, onBack }: Props) {
  return (
    <div className="pd-page">
      {/* ① 顶部横幅（logo + 名称 + 一句话 + 官网） */}
      <header
        className="pd-banner"
        style={{ background: `linear-gradient(120deg, ${detail.banner[0]} 0%, ${detail.banner[1]} 100%)` }}
      >
        <div className="pd-banner-inner">
          <button type="button" className="pd-back" onClick={onBack}>
            ← 返回导航
          </button>
          <div className="pd-banner-row">
            <div className="pd-logo-card">
              <img src={asset(detail.logo, base)} alt={detail.name} />
            </div>
            <div className="pd-banner-info">
              <h1>{detail.name}</h1>
              <p className="pd-tagline">{detail.tagline}</p>
              <p className="pd-official">
                官网：
                <a href={detail.officialUrl} target="_blank" rel="noopener noreferrer">
                  {detail.officialHost}
                </a>
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* ② 平台站点（点击新页打开分站官网） */}
      <section className="pd-section">
        <h2 className="pd-section-title">平台站点</h2>
        <ul className="pd-sites">
          {detail.sites.map((s) => (
            <li key={s.name + s.url}>
              <a href={s.url} target="_blank" rel="noopener noreferrer" title={s.url}>
                <img className="pd-flag" src={asset(s.flag, base)} alt={s.name} loading="lazy" />
                <span>{s.name}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      {/* ③ 平台介绍（截图 + 详细文本 + 关键事实） */}
      <section className="pd-section">
        <h2 className="pd-section-title">平台介绍</h2>
        {detail.intro.image && (
          <img className="pd-shot" src={asset(detail.intro.image, base)} alt={`${detail.name} 平台截图`} loading="lazy" />
        )}
        <h3 className="pd-intro-heading">{detail.intro.heading}</h3>
        {detail.intro.sections.map((sec) => (
          <div className="pd-block" key={sec.title}>
            <h4 className="pd-sub">{sec.title}</h4>
            {sec.type === 'text' && sec.text && <p className="pd-para">{sec.text}</p>}
            {sec.type === 'list' && sec.items && (
              <ul className="pd-list">
                {sec.items.map((it) => (
                  <li key={it}>{it}</li>
                ))}
              </ul>
            )}
            {sec.type === 'steps' && sec.items && (
              <ol className="pd-steps">
                {sec.items.map((it) => (
                  <li key={it}>{it}</li>
                ))}
              </ol>
            )}
          </div>
        ))}
        <ul className="pd-facts">
          {detail.intro.facts.map((f) => (
            <li key={f.label}>
              <b>{f.value}</b>
              <span>{f.label}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
