/**
 * SkillSelector — 技能选择器（全局弹窗）
 *
 * 行为：
 * - 弹窗打开时按当前 employeeName 加载全局/员工级技能
 * - 三列布局：左侧 一级员工分组(可下钻二级) | 中间 技能分组 | 右侧(无)
 * - 全局修改影响所有员工，员工级修改只影响当前二级员工(数据按二级员工持久化)
 * - 关闭时持久化到 localStorage
 *
 * 左侧栏布局(v2.0,仿 LinkFox 我的技能):
 * - 全部
 * - 一级员工分类(默认展开)
 *   - 二级员工(下钻)
 *
 * Props:
 * - employeeName: 当前上下文员工(默认选中其一二级)
 * - onClose: 关闭回调
 * - onChanged?: 配置变化后回调(用于触发 worker reload)
 */

import { useEffect, useMemo, useState } from 'react'
import {
  SKILL_DEFINITIONS,
  SKILL_GROUP_LABELS,
  getApplicableSkills,
  groupSkillsByGroup,
  loadAgentSkills,
  loadGlobalSkills,
  resolveSkillValue,
  saveAgentSkills,
  saveGlobalSkills,
  type GlobalSkillConfig,
  type SkillDefinition,
  type SkillValue
} from '../shared/employeeSkills'
import {
  AGENT_CATEGORIES,
  findAgentByName,
  type AgentCategory
} from '../shared/agentCategories'

type Props = {
  employeeName: string
  onClose: () => void
  onChanged?: () => void
}

type Scope = 'global' | 'agent'

/** 左侧栏选中态:全部 / 一级员工分类 / 二级员工 */
type SidebarKey =
  | { kind: 'all' }
  | { kind: 'category'; categoryId: string }
  | { kind: 'agent'; agentName: string }

const SCOPE_LABELS: Record<Scope, string> = {
  global: '🌐 全局',
  agent: '👤 员工级'
}

export default function SkillSelector({ employeeName, onClose, onChanged }: Props) {
  // 作用域:global(全局) / agent(员工级)
  const [scope, setScope] = useState<Scope>('agent')
  // 左侧栏选中态(默认优先匹配 employeeName 所属二级员工,否则其分类,否则全部)
  const [sidebarKey, setSidebarKey] = useState<SidebarKey>(() => {
    const profile = findAgentByName(employeeName)
    if (profile) return { kind: 'agent', agentName: profile.name }
    return { kind: 'all' }
  })
  // 一级员工展开/折叠(默认全部展开)
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {}
    for (const cat of AGENT_CATEGORIES) map[cat.id] = true
    return map
  })

  // 全局/员工级技能配置
  const [globalSkills, setGlobalSkills] = useState<GlobalSkillConfig>(() => loadGlobalSkills())
  const [agentSkills, setAgentSkills] = useState<Record<string, Record<string, SkillValue>>>(() => {
    const map: Record<string, Record<string, SkillValue>> = {}
    for (const cat of AGENT_CATEGORIES) {
      for (const agent of cat.agents) {
        map[agent.name] = loadAgentSkills(agent.name)
      }
    }
    return map
  })

  // 当前 sidebarKey 下实际生效的代表 agent(用于读写)
  // - 'agent': 即该 agent
  // - 'category': 取该分类下第一个 live 的 agent(代表),若无则为 null
  // - 'all': 为 null(只读视图)
  const representativeAgent = useMemo(() => {
    if (sidebarKey.kind === 'agent') return findAgentByName(sidebarKey.agentName)
    if (sidebarKey.kind === 'category') {
      const cat = AGENT_CATEGORIES.find(c => c.id === sidebarKey.categoryId)
      if (!cat) return null
      return cat.agents.find(a => a.readiness === 'live') || null
    }
    return null
  }, [sidebarKey])

  // 当前 sidebarKey 下的代表 agent 名(用于 resolveSkillValue)
  const effectiveAgentName = representativeAgent?.name || null

  // 当前显示的技能:按 sidebarKey 聚合
  const applicableSkills = useMemo(() => {
    const collect = (predicate: (name: string) => boolean) => {
      const seen = new Map<string, SkillDefinition>()
      for (const cat of AGENT_CATEGORIES) {
        for (const agent of cat.agents) {
          if (!predicate(agent.name)) continue
          for (const skill of getApplicableSkills(agent.name)) {
            if (!seen.has(skill.id)) seen.set(skill.id, skill)
          }
        }
      }
      return Array.from(seen.values())
    }
    if (sidebarKey.kind === 'agent') {
      return getApplicableSkills(sidebarKey.agentName)
    }
    if (sidebarKey.kind === 'category') {
      const cat = AGENT_CATEGORIES.find(c => c.id === sidebarKey.categoryId)
      if (!cat) return []
      const names = new Set(cat.agents.map(a => a.name))
      return collect(name => names.has(name))
    }
    return collect(() => true)
  }, [sidebarKey])

  const grouped = useMemo(() => groupSkillsByGroup(applicableSkills), [applicableSkills])

  // 当前代表 agent 的覆盖项
  const currentAgentOverride = effectiveAgentName ? (agentSkills[effectiveAgentName] || {}) : {}

  // 修改值(全局或员工级)
  const updateValue = (skillId: string, value: SkillValue) => {
    if (scope === 'global') {
      setGlobalSkills(prev => ({ ...prev, [skillId]: value }))
      return
    }
    // 员工级:必须有代表 agent
    if (!effectiveAgentName) return
    setAgentSkills(prev => ({ ...prev, [effectiveAgentName]: { ...(prev[effectiveAgentName] || {}), [skillId]: value } }))
  }

  // 重置当前 scope 到默认
  const resetScope = () => {
    if (scope === 'global') {
      setGlobalSkills({})
      return
    }
    if (!effectiveAgentName) return
    setAgentSkills(prev => ({ ...prev, [effectiveAgentName]: {} }))
  }

  // 关闭时持久化
  const handleClose = () => {
    saveGlobalSkills(globalSkills)
    for (const [name, cfg] of Object.entries(agentSkills)) {
      saveAgentSkills(name, cfg)
    }
    onChanged?.()
    onClose()
  }

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalSkills, agentSkills])

  // 切换一级员工展开/折叠
  const toggleCategory = (categoryId: string) => {
    setExpandedCategories(prev => ({ ...prev, [categoryId]: !prev[categoryId] }))
  }

  // 判断 sidebarKey 是否匹配某个一级/二级
  const isCategoryActive = (cat: AgentCategory) => sidebarKey.kind === 'category' && sidebarKey.categoryId === cat.id
  const isAgentActive = (agentName: string) => sidebarKey.kind === 'agent' && sidebarKey.agentName === agentName
  const isAllActive = sidebarKey.kind === 'all'

  // 统计一级员工下的总覆盖项(聚合所有二级员工)
  const categoryOverrideCount = (cat: AgentCategory) => {
    let count = 0
    for (const agent of cat.agents) {
      const cfg = agentSkills[agent.name] || {}
      count += Object.values(cfg).filter(v => v !== undefined).length
    }
    return count
  }

  // footer 文案
  const footerHint = useMemo(() => {
    if (scope === 'global') return '🌐 全局修改将影响所有员工'
    if (sidebarKey.kind === 'all') {
      return '👤 全员视图(只读) · 选择具体员工或一级分类进行员工级修改'
    }
    if (sidebarKey.kind === 'category') {
      const cat = AGENT_CATEGORIES.find(c => c.id === sidebarKey.categoryId)
      const liveCount = cat?.agents.filter(a => a.readiness === 'live').length || 0
      const totalCount = cat?.agents.length || 0
      return `👤 ${cat?.icon || ''} ${cat?.name || ''} 员工级修改(${totalCount} 名员工,员工级 > 全局)`
    }
    const profile = findAgentByName(sidebarKey.agentName)
    return `👤 ${profile?.icon || 'AI'} ${sidebarKey.agentName} 员工级修改(员工级 > 全局)`
  }, [scope, sidebarKey])

  return (
    <div
      className="ai-employee-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="技能选择"
      onClick={handleClose}
    >
      <div
        className="ai-employee-skill-selector"
        onClick={event => event.stopPropagation()}
      >
        <header>
          <h3>🛠 技能配置</h3>
          <div className="ai-employee-skill-scope-switch" role="tablist" aria-label="作用域">
            {(['global', 'agent'] as Scope[]).map(s => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={scope === s}
                className={scope === s ? 'active' : ''}
                onClick={() => setScope(s)}
              >
                {SCOPE_LABELS[s]}
              </button>
            ))}
            <button type="button" className="ai-employee-skill-reset" onClick={resetScope} title="清除当前作用域的覆盖">
              ↺ 重置
            </button>
          </div>
          <button type="button" onClick={handleClose} aria-label="关闭">×</button>
        </header>

        <div className="ai-employee-skill-body">
          {/* 左:一二级员工分类(始终显示,无论作用域) */}
          <aside className="ai-employee-skill-agents" aria-label="员工分类列表">
            <small>我的技能</small>
            <button
              type="button"
              className={`ai-employee-skill-agents-item all${isAllActive ? ' active' : ''}`}
              onClick={() => setSidebarKey({ kind: 'all' })}
            >
              <i className="ai-employee-skill-agents-all-icon" aria-hidden>⊞</i>
              <div>
                <b>全部</b>
                <small>{SKILL_DEFINITIONS.length} 项技能</small>
              </div>
            </button>
            {AGENT_CATEGORIES.map(cat => {
              const expanded = expandedCategories[cat.id] ?? true
              const overrideCount = categoryOverrideCount(cat)
              return (
                <div key={cat.id} className="ai-employee-skill-agents-group">
                  <button
                    type="button"
                    className={`ai-employee-skill-agents-group-header${isCategoryActive(cat) ? ' active' : ''}`}
                    onClick={() => {
                      setSidebarKey({ kind: 'category', categoryId: cat.id })
                      // 选中一级员工时,自动展开
                      setExpandedCategories(prev => ({ ...prev, [cat.id]: true }))
                    }}
                  >
                    <span
                      className="ai-employee-skill-agents-caret"
                      onClick={event => {
                        event.stopPropagation()
                        toggleCategory(cat.id)
                      }}
                      aria-hidden
                    >
                      {expanded ? '▾' : '▸'}
                    </span>
                    <i style={{ background: cat.color }}>{cat.icon}</i>
                    <div>
                      <b>{cat.name}</b>
                      <small>{cat.agents.length} 名员工 · {overrideCount > 0 ? `${overrideCount} 项覆盖` : '使用全局'}</small>
                    </div>
                  </button>
                  {expanded && (
                    <ul className="ai-employee-skill-agents-sublist">
                      {cat.agents.map(agent => {
                        const cfg = agentSkills[agent.name] || {}
                        const overrideCount = Object.values(cfg).filter(v => v !== undefined).length
                        return (
                          <li key={agent.id}>
                            <button
                              type="button"
                              className={`ai-employee-skill-agents-item${isAgentActive(agent.name) ? ' active' : ''}${agent.readiness !== 'live' ? ' is-disabled' : ''}`}
                              disabled={agent.readiness !== 'live'}
                              onClick={() => {
                                if (agent.readiness !== 'live') return
                                setSidebarKey({ kind: 'agent', agentName: agent.name })
                              }}
                              title={agent.readiness !== 'live' ? '该员工尚未上线' : undefined}
                            >
                              <i style={{ background: agent.color }}>{agent.shortName}</i>
                              <div>
                                <b>{agent.name}</b>
                                <small>
                                  {agent.readiness === 'coming-soon' ? '即将上线' : overrideCount > 0 ? `${overrideCount} 项覆盖` : '使用全局'}
                                </small>
                              </div>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )
            })}
          </aside>

          {/* 中:技能列表 */}
          <div className="ai-employee-skill-list" role="tabpanel">
            {Object.keys(grouped).length === 0 && (
              <div className="ai-employee-skill-empty">
                {effectiveAgentName
                  ? `${effectiveAgentName} 暂无可配置技能。`
                  : '该分类下所有员工均暂无可配置技能。'}
              </div>
            )}
            {Object.entries(grouped).map(([group, skills]) => (
              <section key={group}>
                <h4>{SKILL_GROUP_LABELS[group] || group}</h4>
                {skills.map(skill => {
                  const value = scope === 'global'
                    ? (globalSkills[skill.id] ?? skill.defaultValue)
                    : effectiveAgentName
                      ? resolveSkillValue(skill.id, effectiveAgentName, globalSkills, currentAgentOverride)
                      : skill.defaultValue
                  const isOverridden = scope === 'agent' && effectiveAgentName != null && currentAgentOverride[skill.id] !== undefined
                  const readOnly = scope === 'agent' && effectiveAgentName == null
                  return (
                    <article
                      key={skill.id}
                      className={`ai-employee-skill-row${isOverridden ? ' overridden' : ''}${readOnly ? ' read-only' : ''}`}
                    >
                      <div className="ai-employee-skill-info">
                        <div className="ai-employee-skill-name">
                          <b>{skill.name}</b>
                          {skill.status === 'beta' && <span className="ai-employee-skill-badge">Beta</span>}
                          {isOverridden && <span className="ai-employee-skill-badge override">覆盖</span>}
                          {readOnly && <span className="ai-employee-skill-badge read-only">只读</span>}
                        </div>
                        <small>{skill.description}</small>
                      </div>
                      <div className="ai-employee-skill-control">
                        <SkillControl
                          skill={skill}
                          value={value}
                          disabled={readOnly}
                          onChange={v => updateValue(skill.id, v)}
                        />
                      </div>
                    </article>
                  )
                })}
              </section>
            ))}
          </div>
        </div>

        <footer>
          <small>{footerHint}</small>
          <div>
            <button type="button" onClick={handleClose}>完成</button>
          </div>
        </footer>
      </div>
    </div>
  )
}

/* ─── 子组件:技能值控件 ──────────────────────────── */

function SkillControl({
  skill,
  value,
  onChange,
  disabled = false
}: {
  skill: SkillDefinition
  value: SkillValue
  onChange: (v: SkillValue) => void
  disabled?: boolean
}) {
  if (skill.valueType === 'boolean') {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={Boolean(value)}
        className={`ai-employee-skill-switch${value ? ' on' : ''}${disabled ? ' disabled' : ''}`}
        onClick={() => !disabled && onChange(!value)}
        disabled={disabled}
      >
        <span className="track"><span className="thumb" /></span>
        <em>{value ? '开' : '关'}</em>
      </button>
    )
  }
  if (skill.valueType === 'select') {
    return (
      <select
        value={String(value)}
        onChange={event => onChange(event.target.value)}
        className="ai-employee-skill-select"
        disabled={disabled}
      >
        {skill.options?.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    )
  }
  return <em>unknown</em>
}
