import { describe, expect, it } from 'vitest'
import { MENU_PERM_GROUPS, MENU_PERMISSION_TREE, checkedLevel1Codes, expandMenuSelection, hasMenuAccess, menuCheckState, summarizeMenuPermissions } from '../menuPermissionTree'
// 纯函数跨包 import 沿用本目录 memberPermissionMerge.test.ts 先例（server rootDir 禁跨包，测试落 shared 侧）
import { mergePermissionsForSubmit } from '../../../src/renderer/memberPermissionMerge.js'

const nodeOf = (code: string) => {
  const node = MENU_PERMISSION_TREE.find(item => item.code === code)
  if (!node) throw new Error(`权限树缺少一级栏目 ${code}`)
  return node
}

describe('使用权限树与侧边栏分类同步', () => {
  // 分类基准=App.tsx aiModuleNav 可见项（货盘仓库/我的货盘共用 menu.warehouse.hub 卡码，故不单列节点）
  it('侧边栏一级条目与顺序对齐导航', () => {
    const sidebar = MENU_PERMISSION_TREE.filter(node => node.group === 'sidebar')
    expect(sidebar.map(node => node.code)).toEqual([
      'menu.ie-browser', 'menu.collect', 'menu.warehouse', 'menu.crossborder',
      'menu.advisor', 'menu.employee', 'menu.planet', 'menu.hq'
    ])
    expect(sidebar.map(node => node.label)).toEqual(['IE浏览', '货盘采集', '货盘仓库', 'AI跨境', 'AI参谋', 'AI员工', 'AI星球', 'AI总部'])
  })

  it('已撤下侧边栏的入口单列 entry 组，分组标题与之一一对应', () => {
    expect(MENU_PERMISSION_TREE.filter(node => node.group === 'entry').map(node => node.code)).toEqual(['menu.art', 'menu.video', 'menu.tasks'])
    expect(MENU_PERM_GROUPS.map(group => group.key)).toEqual(['sidebar', 'entry'])
  })

  it('二级入口归位到实际渲染它的一级栏目', () => {
    expect(nodeOf('menu.planet').cards.map(card => card.code)).toEqual(['menu.planet.ops', 'menu.cb-news'])
    expect(nodeOf('menu.hq').cards.map(card => card.code)).toContain('menu.planet.compliance')
  })

  it('码表不增不减：148 码全唯一，历史授权记录不会失效', () => {
    const codes = MENU_PERMISSION_TREE.flatMap(node => [node.code, ...node.cards.map(card => card.code)])
    expect(codes.length).toBe(148)
    expect(new Set(codes).size).toBe(148)
  })

  it('只持旧位置二级码的成员仍可进入归位后的栏目', () => {
    expect(hasMenuAccess(code => code === 'menu.planet.compliance', nodeOf('menu.hq'))).toBe(true)
    expect(hasMenuAccess(code => code === 'menu.cb-news', nodeOf('menu.planet'))).toBe(true)
  })

  it('一级勾选展开为一级码 + 该栏目全部二级码', () => {
    const collect = nodeOf('menu.collect')
    const expanded = expandMenuSelection(['menu.collect'])
    expect(expanded).toContain('menu.collect')
    expect(expanded.length).toBe(1 + collect.cards.length)
    expect(expanded).toContain('menu.collect.saleyeena')
    expect(expandMenuSelection([])).toEqual([])
    // UI 只会提交一级码：混入的二级码不单独成立，必须由所属一级带出
    expect(expandMenuSelection(['menu.warehouse.hub'])).toEqual([])
    expect(expandMenuSelection(['menu.hq', 'menu.hq'])).toEqual(expandMenuSelection(['menu.hq']))
  })

  it('成员现有码回显为一级勾选，只持部分二级也算已勾选', () => {
    expect(checkedLevel1Codes(['menu.planet.compliance'])).toEqual(['menu.hq'])
    expect(checkedLevel1Codes(['menu.collect', 'menu.collect.1688'])).toEqual(['menu.collect'])
    expect(checkedLevel1Codes(['dashboard.view', 'erp.collect'])).toEqual([])
    expect(checkedLevel1Codes(expandMenuSelection(['menu.collect', 'menu.employee']))).toEqual(['menu.collect', 'menu.employee'])
  })

  it('只持部分二级的老成员：回显为一级已勾选，保存补齐该栏目全部二级且不丢非 menu 码', () => {
    const collect = nodeOf('menu.collect')
    const currentAll = ['menu.collect.1688', 'menu.collect.saleyeena', 'menu.employee', 'erp.collect', 'ai.use', 'dashboard.view']
    // 打开面板：只持 2 个货盘采集二级码也显示「货盘采集」已勾选，且二级码不进入勾选集合
    const echoed = checkedLevel1Codes(currentAll.filter(code => code.startsWith('menu.')))
    expect(echoed).toEqual(['menu.collect', 'menu.employee'])
    // 保存：一级展开 + 合并未被 UI 展示的非 menu 码（PUT 是全量替换契约）
    const submitted = mergePermissionsForSubmit(currentAll, expandMenuSelection(echoed))
    expect(collect.cards.every(card => submitted.includes(card.code))).toBe(true)
    expect(submitted).toContain('menu.collect')
    expect(submitted).toContain('erp.collect')
    expect(submitted).toContain('ai.use')
    expect(submitted).toContain('dashboard.view')
    expect(submitted).toHaveLength(3 + 1 + collect.cards.length + 1)
  })

  it('摘要与三态仍按实际持有码呈现', () => {
    const warehouse = nodeOf('menu.warehouse')
    expect(menuCheckState(['menu.warehouse'], warehouse)).toBe('some')
    expect(menuCheckState(expandMenuSelection(['menu.warehouse']), warehouse)).toBe('all')
    expect(summarizeMenuPermissions(['menu.collect'])).toBe('货盘采集')
  })
})
