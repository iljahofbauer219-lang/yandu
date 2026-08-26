import type { NavItem } from '../data/_topNav'

interface Props {
  items: NavItem[]
}

export function TopNav({ items }: Props) {
  return (
    <nav className="top-nav">
      <div className="top-nav-inner">
        <a className="top-nav-brand" href="./" title="砚都跨境导航">
          <span className="top-nav-brand-icon">⛵</span>
          <span className="top-nav-brand-text">砚都跨境导航</span>
        </a>
        <ul className="top-nav-list">
          {items.map((it) => (
            <li key={it.href} className="top-nav-item">
              <a href={it.href} target="_blank" rel="noopener noreferrer">
                {it.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  )
}
