/**
 * SceneEntry — 场景圆形入口
 *
 * 行为：
 * - 一排 6 个圆形图标
 * - 点击触发 onSelect(scene)
 */

import type { SceneEntry } from '../shared/agentCategories'

type Props = {
  scenes: SceneEntry[]
  onSelect: (scene: SceneEntry) => void
}

export default function SceneEntryGrid({ scenes, onSelect }: Props) {
  return (
    <div className="scene-entry-grid" role="list" aria-label="场景入口">
      {scenes.map(scene => (
        <button
          key={scene.id}
          type="button"
          className="scene-entry"
          onClick={() => onSelect(scene)}
          role="listitem"
          aria-label={`${scene.name} - ${scene.description}`}
        >
          <i
            className="scene-entry-icon"
            style={{ background: scene.color }}
            aria-hidden="true"
          >
            <span>{scene.icon}</span>
          </i>
          <b>{scene.name}</b>
          <small>{scene.description}</small>
        </button>
      ))}
    </div>
  )
}
