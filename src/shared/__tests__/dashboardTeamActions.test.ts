import { describe, expect, it } from 'vitest'
import { TEAM_ACTIVITY_ACTIONS as SHARED_ACTIONS, type TeamAction } from '../dashboard'
// server 不 import src/shared，两份清单只能手工镜像 —— 本测试是唯一的漂移守卫
import { TEAM_ACTIVITY_ACTIONS as SERVER_ACTIONS } from '../../../server/src/modules/dashboard/teamActivity.js'

// 编译期守卫：server 清单的每一项都必须是 shared TeamAction 联合的成员，任一侧增删都会在此报错
const SERVER_AS_SHARED: TeamAction[] = [...SERVER_ACTIONS]

/** 曾长期写在白名单里、但与 writeAudit 实际取值零交集的裸词（导致团队动态永远为空） */
const LEGACY_BARE_WORDS = [
  'created', 'updated', 'deleted', 'enabled', 'disabled',
  'reset_pwd', 'role_changed', 'ai_quota_exceeded', 'login', 'logout'
]

describe('团队动态 action 白名单双源一致性', () => {
  it('server 与 shared 的清单完全相同', () => {
    expect([...SERVER_ACTIONS].sort()).toEqual([...SHARED_ACTIONS].sort())
    expect(SERVER_AS_SHARED).toHaveLength(SERVER_ACTIONS.length)
  })

  it('清单非空、无重复', () => {
    expect(SHARED_ACTIONS.length).toBeGreaterThan(0)
    expect(new Set(SHARED_ACTIONS).size).toBe(SHARED_ACTIONS.length)
  })

  it('全部是审计日志真实写入的点分 action 格式，不含历史裸词', () => {
    for (const action of SHARED_ACTIONS) {
      expect(action, `action "${action}" 不符合点分格式`).toMatch(/^[a-z][a-z0-9_]*(\.[a-z0-9_-]+)+$/)
      expect(LEGACY_BARE_WORDS).not.toContain(action)
    }
  })
})
