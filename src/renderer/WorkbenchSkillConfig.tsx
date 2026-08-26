/**
 * WorkbenchSkillConfig — 工作台内嵌的「员工技能」配置条
 *
 * 行为：
 * - 默认折叠；点击标题栏展开
 * - 仅显示当前员工 applicable 的技能（不含其它员工专属项）
 * - 实时写 localStorage.aiEmployee.skills.<position>（员工级覆盖）
 * - 顶部带「全局已配…」与「高级：去 Hub 设置」入口（点跳 SkillSelector）
 *
 * 复用：与 SkillSelector 共享 employeeSkills 数据层，状态互不影响（这里改 agent 覆盖，弹窗改 global/agent 两 scope）。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  SKILL_DEFINITIONS,
  getApplicableSkills,
  groupSkillsByGroup,
  loadAgentSkills,
  loadGlobalSkills,
  resolveSkillValue,
  saveAgentSkills,
  type SkillDefinition,
  type SkillValue
} from '../shared/employeeSkills'

type Props = {
  /** 当前员工岗位名（与 localStorage key 后缀一致） */
  position: string
}

export default function WorkbenchSkillConfig({ position }: Props) {
  const [open, setOpen] = useState(false)
  const [agentOverride, setAgentOverride] = useState<Record<string, SkillValue>>(() => loadAgentSkills(position))
  const [global, setGlobal] = useState(() => loadGlobalSkills())
  const containerRef = useRef<HTMLDivElement>(null)

  // 切换岗位时重新加载（AIEmployee 同一组件实例支持不同 position）
  useEffect(() => {
    setAgentOverride(loadAgentSkills(position))
  }, [position])

  // 展开/关闭 + 点外侧关闭
  useEffect(() => {
    if (!open) return
    const onDocClick = (event: MouseEvent) => {
      const el = containerRef.current
      if (!el) return
      if (event.target instanceof Node && el.contains(event.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const applicable = useMemo(() => getApplicableSkills(position), [position])
  const grouped = useMemo(() => groupSkillsByGroup(applicable), [applicable])

  const overrideCount = useMemo(
    () => Object.keys(agentOverride).filter(k => agentOverride[k] !== undefined).length,
    [agentOverride]
  )

  const update = (skillId: string, value: SkillValue) => {
    const next = { ...agentOverride, [skillId]: value }
    setAgentOverride(next)
    saveAgentSkills(position, next)
  }

  return (
    <div
      ref={containerRef}
      className={`ai-employee-workbench-skill${open ? ' open' : ''}`}
      data-position={position}
    >
      <button
        type="button"
        className="ai-employee-workbench-skill-head"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <i aria-hidden="true">⚙</i>
        <b>员工技能</b>
        <small>{overrideCount > 0 ? `${overrideCount} 项覆盖` : '使用全局'}</small>
        <span className={`ai-employee-workbench-skill-chevron${open ? ' up' : ''}`} aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="ai-employee-workbench-skill-body" role="region" aria-label="员工技能配置">
          {applicable.length === 0 ? (
            <p className="ai-employee-workbench-skill-empty">该员工暂无可配置技能。</p>
          ) : (
            Object.entries(grouped).map(([group, skills]) => (
              <section key={group}>
                <h5>{groupTitle(group)}</h5>
                {skills.map(skill => {
                  const value = resolveSkillValue(skill.id, position, global, agentOverride)
                  const isOverridden = agentOverride[skill.id] !== undefined
                  return (
                    <div
                      key={skill.id}
                      className={`ai-employee-workbench-skill-row${isOverridden ? ' overridden' : ''}`}
                    >
                      <div>
                        <b>{skill.name}</b>
                        <small>{skill.description}</small>
                      </div>
                      <CompactControl
                        skill={skill}
                        value={value}
                        isOverridden={isOverridden}
                        onChange={next => update(skill.id, next)}
                        onClear={() => {
                          const next = { ...agentOverride }
                          delete next[skill.id]
                          setAgentOverride(next)
                          saveAgentSkills(position, next)
                        }}
                      />
                    </div>
                  )
                })}
              </section>
            ))
          )}
          <footer>
            <small>员工级 &gt; 全局 &gt; 默认</small>
          </footer>
        </div>
      )}
    </div>
  )
}

/* ─── 紧凑控件 ──────────────────────────── */

function CompactControl({
  skill,
  value,
  isOverridden,
  onChange,
  onClear
}: {
  skill: SkillDefinition
  value: SkillValue
  isOverridden: boolean
  onChange: (v: SkillValue) => void
  onClear: () => void
}) {
  if (skill.valueType === 'boolean') {
    return (
      <div className="ai-employee-workbench-skill-control">
        <button
          type="button"
          role="switch"
          aria-checked={Boolean(value)}
          className={`ai-employee-skill-switch${value ? ' on' : ''}`}
          onClick={() => onChange(!value)}
          title={isOverridden ? '已员工级覆盖 · 点击关闭' : '使用全局 · 点击覆盖'}
        >
          <span className="track"><span className="thumb" /></span>
        </button>
        {isOverridden && (
          <button type="button" className="ai-employee-workbench-skill-clear" onClick={onClear} title="清除员工级覆盖，回退全局">
            ↺
          </button>
        )}
      </div>
    )
  }
  if (skill.valueType === 'select') {
    return (
      <div className="ai-employee-workbench-skill-control">
        <select
          value={String(value)}
          onChange={event => onChange(event.target.value)}
          className={`ai-employee-skill-select${isOverridden ? ' overridden' : ''}`}
        >
          {skill.options?.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {isOverridden && (
          <button type="button" className="ai-employee-workbench-skill-clear" onClick={onClear} title="清除员工级覆盖，回退全局">
            ↺
          </button>
        )}
      </div>
    )
  }
  return null
}

function groupTitle(group: string): string {
  const map: Record<string, string> = {
    'kb-reference': '📚 知识库引用',
    'output-style': '🎨 输出风格',
    'analyst-tools': '📊 选品分析工具',
    'listing-tools': '✨ Listing 工具',
    'guardian-tools': '🛡 守卫工具'
  }
  return map[group] || group
}
