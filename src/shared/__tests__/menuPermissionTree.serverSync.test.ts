import { describe, expect, it } from 'vitest'
import { MENU_PERMISSION_TREE, expandMenuSelection } from '../menuPermissionTree'
// server 不 import src/shared（rootDir 限制），服务端白名单由 tools/gen-server-menu-permissions.ts 从本树生成
// —— 下面几条断言是唯一的漂移守卫：前端加卡片忘记重新生成时，成员保存会被服务端静默丢弃权限码
import { PERMISSIONS, PERMISSION_CODE_SET, PERMISSION_LABELS, PRESET_ROLES } from '../../../server/src/modules/rbac/permissions.js'
import { MENU_PERMISSION_CODES } from '../../../server/src/modules/rbac/menuPermissions.generated.js'

const treeCodes = MENU_PERMISSION_TREE.flatMap(node => [node.code, ...node.cards.map(card => card.code)])

describe('菜单权限码前后端对账（服务端白名单以权限树为唯一真值源）', () => {
  it('两侧菜单码集合完全相等', () => {
    expect([...MENU_PERMISSION_CODES].sort()).toEqual([...treeCodes].sort())
  })

  it('服务端不夹带树里没有的 menu.* 码', () => {
    const extra = PERMISSIONS.filter(code => code.startsWith('menu.') && !treeCodes.includes(code))
    expect(extra).toEqual([])
  })

  it('货盘采集二级 114 个平台卡全部在服务端白名单内', () => {
    const collect = treeCodes.filter(code => code.startsWith('menu.collect.'))
    expect(collect).toHaveLength(114)
    const missing = collect.filter(code => !PERMISSION_CODE_SET.has(code))
    expect(missing, `服务端白名单缺少货盘采集二级码: ${missing.join(', ')}`).toEqual([])
  })

  it('管理界面按一级勾选提交的每一码都能通过服务端过滤', () => {
    for (const node of MENU_PERMISSION_TREE) {
      const dropped = expandMenuSelection([node.code]).filter(code => !PERMISSION_CODE_SET.has(code))
      expect(dropped, `「${node.label}」(${node.code}) 展开后被服务端丢弃: ${dropped.join(', ')}`).toEqual([])
    }
    expect(expandMenuSelection(['menu.collect'])).toHaveLength(115)
  })

  it('每个菜单码都有非空显示名，预置角色权限码全部合法', () => {
    for (const code of MENU_PERMISSION_CODES) {
      expect(PERMISSION_LABELS[code], `${code} 缺少显示名`).toBeTruthy()
    }
    for (const role of PRESET_ROLES) {
      for (const code of role.permissions) {
        expect(PERMISSION_CODE_SET.has(code), `预置角色 ${role.key} 持有非法码 ${code}`).toBe(true)
      }
    }
  })
})
