/**
 * AgentAccordion — 一二级员工手风琴
 *
 * 行为：
 * - 默认展开：defaultOpen=true 的类目
 * - 单类目可独立展开/折叠
 * - 二级员工卡片可点击"进入"（live 状态）或显示"即将上线"（disabled）
 * - 点击二级员工触发 onSelectAgent(agentName)
 */

import { useState } from 'react'
import { AGENT_CATEGORIES, readinessClass, readinessLabel, type AgentCategory, type AgentProfile } from '../shared/agentCategories'

type Props = {
  /** 已选中的员工（高亮） */
  selectedAgent?: string
  /** 点击二级员工 */
  onSelectAgent: (agent: AgentProfile) => void
  /** 自定义状态覆盖（不传则用静态 readiness） */
  overrideReadiness?: (agent: AgentProfile) => AgentProfile['readiness']
  /** 自定义可用性（不传则用静态 available） */
  overrideAvailable?: (agent: AgentProfile) => boolean
}

export default function AgentAccordion({ selectedAgent, onSelectAgent, overrideReadiness, overrideAvailable }: Props) {
  // 初始展开：所有 defaultOpen=true 的类目
  const initialOpen = (): Record<string, boolean> => {
    const map: Record<string, boolean> = {}
    AGENT_CATEGORIES.forEach(c => { map[c.id] = c.defaultOpen })
    return map
  }
  const [openMap, setOpenMap] = useState<Record<string, boolean>>(initialOpen)

  const toggle = (id: string) => {
    setOpenMap(prev => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div className="agent-accordion" role="list" aria-label="AI 员工分类">
      {AGENT_CATEGORIES.map(category => {
        const open = openMap[category.id] ?? false
        const liveCount = category.agents.filter(a => a.readiness === 'live').length
        const totalCount = category.agents.length
        return (
          <div
            key={category.id}
            className={`agent-accordion-category${open ? ' open' : ''}`}
            role="listitem"
          >
            <button
              type="button"
              className="agent-accordion-header"
              onClick={() => toggle(category.id)}
              aria-expanded={open}
              aria-controls={`agent-accordion-body-${category.id}`}
            >
              <i className="agent-accordion-icon" style={{ background: category.color }} aria-hidden="true">
                {category.icon}
              </i>
              <div className="agent-accordion-title">
                <b>{category.name}</b>
                <small>{category.description} · {liveCount}/{totalCount} 已上线</small>
              </div>
              <span className={`agent-accordion-chevron${open ? ' open' : ''}`} aria-hidden="true">
                <svg viewBox="0 0 16 16" width="14" height="14">
                  <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </button>
            {open && (
              <div
                className="agent-accordion-body"
                id={`agent-accordion-body-${category.id}`}
                role="group"
              >
                {category.agents.map(agent => {
                  const readiness = overrideReadiness?.(agent) ?? agent.readiness
                  const available = overrideAvailable?.(agent) ?? agent.available
                  const isSelected = selectedAgent === agent.name
                  const isLive = readiness === 'live' && available
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      className={`agent-card${isSelected ? ' selected' : ''}${isLive ? '' : ' disabled'}`}
                      onClick={() => isLive && onSelectAgent(agent)}
                      disabled={!isLive}
                      aria-label={`${agent.name} - ${agent.description}`}
                    >
                      <i
                        className="agent-card-icon"
                        style={{ background: agent.color }}
                        aria-hidden="true"
                      >
                        {agent.icon}
                      </i>
                      <div className="agent-card-body">
                        <div className="agent-card-title">
                          <b>{agent.name}</b>
                          <span className={`agent-readiness ${readinessClass(readiness)}`}>
                            {readinessLabel(readiness)}
                          </span>
                        </div>
                        <small>{agent.description}</small>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
