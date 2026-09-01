/**
 * CrossborderAgentGrid — 跨境智能体部门分组卡片（Hub 主页「跨境智能体」区）
 *
 * 行为：
 * - 按 CROSSBORDER_DEPARTMENTS 分组渲染，卡片规格与 SceneEntry 一致
 *   （14px 圆角 / 48px 圆形图标 / 13px 标题 / 11px 副标）
 * - live 卡片可点 → onSelect(agent)；coming-soon 卡片灰态不可点
 * - 图标 / 配色 / 描述 / 状态全部复用 AgentProfile，不重复定义
 */

import {
  CROSSBORDER_DEPARTMENTS,
  findAgentByName,
  readinessLabel,
  type AgentProfile
} from '../shared/agentCategories'

type Props = {
  onSelect: (agent: AgentProfile) => void
}

export default function CrossborderAgentGrid({ onSelect }: Props) {
  return (
    <div className="crossborder-dept-groups">
      {CROSSBORDER_DEPARTMENTS.map(dept => (
        <div key={dept.id} className="crossborder-dept-group">
          <div className="crossborder-dept-header">
            <span
              className="crossborder-dept-bar"
              style={{ background: dept.color }}
              aria-hidden="true"
            />
            <b>{dept.name}</b>
            <small>{dept.agents.length} 个智体</small>
          </div>
          <div className="crossborder-agent-grid" role="list" aria-label={dept.name}>
            {dept.agents.map(name => {
              const agent = findAgentByName(name)
              if (!agent) return null
              const live = agent.readiness === 'live'
              return (
                <button
                  key={agent.id}
                  type="button"
                  role="listitem"
                  className={`crossborder-agent-card${live ? '' : ' coming'}`}
                  aria-disabled={!live}
                  onClick={() => {
                    if (live) onSelect(agent)
                  }}
                  aria-label={`${agent.name} - ${agent.description}${live ? '' : '（即将上线）'}`}
                >
                  <span className={`crossborder-agent-badge ${live ? 'live' : 'soon'}`}>
                    {live ? '已上线' : readinessLabel(agent.readiness)}
                  </span>
                  <i
                    className="crossborder-agent-icon"
                    style={{ background: agent.color }}
                    aria-hidden="true"
                  >
                    <span>{agent.icon}</span>
                  </i>
                  <span className="crossborder-agent-body">
                    <b>{agent.name}</b>
                    <small>{agent.description}</small>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
