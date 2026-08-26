interface TopicItem { href: string; text: string }
interface TopicGroup { group: string; sdk?: string; items: TopicItem[] }

interface Props {
  topics: TopicGroup[]
}

export function TopicList({ topics }: Props) {
  if (!topics.length) return null
  return (
    <section className="topics">
      <div className="topics-inner">
        {topics.map((g) => (
          <div key={g.group} className="topics-group">
            <h3 className="topics-group-title">{g.group}</h3>
            <ul className="topics-list">
              {g.items.map((it) => (
                <li key={it.href + it.text}>
                  <a href={it.href} target="_blank" rel="noopener noreferrer">
                    {it.text}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
