/**
 * 成员权限提交合并单测（plan frosty-wood-gudgeon #1）。
 *
 * 缺陷背景：PUT /api/members/:id/permissions 是全量替换（server members/routes.ts 的
 * deleteMany + createMany），而 SystemAdmin.tsx 的编辑 UI 只展示 menu.* 权限点。
 * 旧实现只提交过滤后的 menu 权限，导致「改任何菜单权限即清掉该成员的 erp.* 等操作码」。
 * 修法为前端提交 mergePermissionsForSubmit(当前全量权限, 编辑后 menu 权限)，本测试守卫其语义：
 * 改菜单权限后，非 menu 操作码必须原样保留。
 *
 * 纯函数在 src/renderer/memberPermissionMerge.ts（零依赖），此处跨包 import 做防漂移校验
 * （同本目录 dashboardTeamActions.test.ts 的先例；server 侧 tsconfig rootDir 限制无法放 members/__tests__）。
 */
import { describe, expect, it } from 'vitest'
import { mergePermissionsForSubmit } from '../../../src/renderer/memberPermissionMerge.js'

describe('mergePermissionsForSubmit', () => {
  it('改菜单权限后，erp.* 等非 menu 操作码仍在（核心回归断言）', () => {
    // 成员当前权限：菜单 menu.hq + menu.tasks，另持有 ERP 采集/查看与报表操作码
    const currentAll = ['menu.hq', 'menu.tasks', 'erp.source.view', 'erp.warehouse.edit', 'report.view:self', 'ai.use']
    // 编辑动作：去掉 menu.tasks、勾上 menu.ai
    const editedMenu = ['menu.hq', 'menu.ai']
    const submitted = mergePermissionsForSubmit(currentAll, editedMenu)
    // 非 menu 操作码一个都不能丢
    expect(submitted).toContain('erp.source.view')
    expect(submitted).toContain('erp.warehouse.edit')
    expect(submitted).toContain('report.view:self')
    expect(submitted).toContain('ai.use')
    // menu 权限以编辑结果为准：新增的在、去掉的不在
    expect(submitted).toContain('menu.ai')
    expect(submitted).toContain('menu.hq')
    expect(submitted).not.toContain('menu.tasks')
  })

  it('当前权限里的 menu.* 不会作为“未展示权限”被保留（以编辑结果为准）', () => {
    const submitted = mergePermissionsForSubmit(['menu.hq', 'menu.tasks'], ['menu.ai'])
    expect(submitted).toEqual(['menu.ai'])
  })

  it('结果去重且不受输入顺序影响', () => {
    const submitted = mergePermissionsForSubmit(['erp.source.view', 'menu.hq'], ['menu.hq', 'erp.source.view'])
    expect(submitted).toHaveLength(2)
    expect(new Set(submitted)).toEqual(new Set(['erp.source.view', 'menu.hq']))
  })

  it('成员无任何非 menu 权限时等价于直接提交编辑结果', () => {
    expect(mergePermissionsForSubmit(['menu.hq'], ['menu.hq', 'menu.tasks'])).toEqual(['menu.hq', 'menu.tasks'])
  })

  it('空输入不抛错', () => {
    expect(mergePermissionsForSubmit([], [])).toEqual([])
  })
})
