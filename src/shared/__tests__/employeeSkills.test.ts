import { beforeEach, describe, expect, it } from 'vitest'
import { agentNameBySlug, agentSlug } from '../agentCategories'
import { getApplicableSkills, loadAgentSkills, saveAgentSkills } from '../employeeSkills'

const store = new Map<string, string>()
const localStorageStub = {
  getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
  setItem: (key: string, value: string) => { store.set(key, value) },
  removeItem: (key: string) => { store.delete(key) }
}
;(globalThis as Record<string, unknown>).localStorage = localStorageStub

beforeEach(() => store.clear())

describe('岗位稳定 slug（条目32：中文名不做存储/匹配键）', () => {
  it('中文名与 id 互转', () => {
    expect(agentSlug('选品调研员')).toBe('researcher')
    expect(agentSlug('researcher')).toBe('researcher')
    expect(agentNameBySlug('researcher')).toBe('选品调研员')
    expect(agentSlug('不存在的岗位')).toBe('不存在的岗位')
  })

  it('员工级技能存 slug 键；旧中文键读时迁移并删除', () => {
    store.set('aiEmployee.skills.选品调研员', JSON.stringify({ 'analyst-quick-profit': false }))
    const loaded = loadAgentSkills('选品调研员')
    expect(loaded['analyst-quick-profit']).toBe(false)
    expect(store.has('aiEmployee.skills.researcher')).toBe(true)
    expect(store.has('aiEmployee.skills.选品调研员')).toBe(false)
    saveAgentSkills('选品调研员', { 'analyst-quick-profit': true })
    expect(store.get('aiEmployee.skills.researcher')).toContain('"analyst-quick-profit":true')
  })

  it('applicableAgents 按 slug 匹配，中文名入参仍生效', () => {
    const byName = getApplicableSkills('选品调研员').map(s => s.id)
    const bySlug = getApplicableSkills('researcher').map(s => s.id)
    expect(byName).toEqual(bySlug)
    expect(byName).toContain('analyst-quick-profit')
    expect(byName).not.toContain('listing-six-block')
    expect(getApplicableSkills('知识库守卫').map(s => s.id)).toContain('guardian-auto-collect')
  })
})
