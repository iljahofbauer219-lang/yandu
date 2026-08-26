interface FooterItem { href: string; text: string }
interface FooterGroup { title: string; items: FooterItem[] }
interface Footer { groups: FooterGroup[] }

interface Props {
  footer: Footer
}

export function SiteFooter({ footer }: Props) {
  return (
    <footer className="footer">
      <div className="footer-inner">
        {footer.groups.map((g) => (
          <div key={g.title} className="footer-group footer-group-row">
            <h3 className="footer-group-title">{g.title}</h3>
            <ul className="footer-list footer-list-row">
              {g.items.map((it) => (
                <li key={it.href + it.text}>
                  <a href={it.href} target="_blank" rel="noopener noreferrer">
                    {it.text.trim()}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="footer-bottom">
        <p>
          本站为「砚都跨境」导航聚合页 · 数据来源于
          {' '}
          <a href="https://www.amz123.com" target="_blank" rel="noopener noreferrer">
            amz123.com
          </a>
          {' '}
          · 本地化部署仅供内部使用
        </p>
      </div>
    </footer>
  )
}
