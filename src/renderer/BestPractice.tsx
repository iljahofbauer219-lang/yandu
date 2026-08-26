/**
 * BestPractice — 最佳实践卡片网格
 *
 * 行为：
 * - 横向滚动/换行的卡片网格
 * - 点击触发 onSelect(bestPractice)
 */

import type { BestPractice } from '../shared/agentCategories'

type Props = {
  items: BestPractice[]
  onSelect: (item: BestPractice) => void
}

export default function BestPracticeGrid({ items, onSelect }: Props) {
  return (
    <div className="best-practice-grid" role="list" aria-label="最佳实践">
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          className="best-practice-card"
          onClick={() => onSelect(item)}
          role="listitem"
          aria-label={`${item.title} - ${item.description}`}
        >
          <i className="best-practice-icon" aria-hidden="true">{item.icon}</i>
          <div className="best-practice-body">
            <b>{item.title}</b>
            <small>{item.description}</small>
            <span className="best-practice-target">→ {item.targetAgent}</span>
          </div>
        </button>
      ))}
    </div>
  )
}
