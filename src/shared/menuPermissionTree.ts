/**
 * 两级使用权限树：一级=侧边栏菜单，二级=栏目内卡片。
 * 码表与 server/src/modules/rbac/permissions.ts 保持一致（前后端各存一份）。
 */
export interface MenuCardPerm {
  code: string
  label: string
}

export interface MenuPermNode {
  code: string
  label: string
  cards: MenuCardPerm[]
}

export const MENU_PERMISSION_TREE: MenuPermNode[] = [
  // 阶段：左侧栏重排新增的三个占位入口（尚不执行业务代码）
  { code: 'menu.cb-news', label: 'CB资讯', cards: [] },
  { code: 'menu.ie-browser', label: 'IE浏览', cards: [] },
  {
    code: 'menu.crossborder', label: 'AI跨境', cards: [
      { code: 'menu.crossborder.login', label: '平台登录' },
      { code: 'menu.crossborder.title', label: '标题优化' },
      { code: 'menu.crossborder.desc', label: '描述优化' },
      { code: 'menu.crossborder.image', label: '图片优化' }
    ]
  },
  { code: 'menu.advisor', label: 'AI参谋', cards: [{ code: 'menu.advisor.online', label: '在线参谋' }] },
  { code: 'menu.warehouse', label: 'AI仓库', cards: [] },
  {
    code: 'menu.collect', label: 'AI采集', cards: [
      { code: 'menu.collect.gigacloud', label: '大健云仓' },
      { code: 'menu.collect.1688', label: '1688' },
      { code: 'menu.collect.aliexpress', label: 'AliExpress' },
      { code: 'menu.collect.ozon', label: 'Ozon' }
    ]
  },
  {
    code: 'menu.art', label: 'AI美工', cards: [
      { code: 'menu.art.studio', label: 'AI生图' },
      { code: 'menu.art.realshift', label: 'AI洗图' }
    ]
  },
  { code: 'menu.video', label: 'AI视频', cards: [] },
  { code: 'menu.employee', label: 'AI员工', cards: [] },
  {
    code: 'menu.planet', label: 'AI星球', cards: [
      { code: 'menu.planet.ops', label: '运营知识库' },
      { code: 'menu.planet.compliance', label: '合规知识库' }
    ]
  },
  {
    code: 'menu.hq', label: 'AI总部', cards: [
      { code: 'menu.hq.finance', label: 'AI财务' },
      { code: 'menu.hq.support', label: 'AI客服' },
      { code: 'menu.hq.feishu', label: 'AI飞书' },
      { code: 'menu.hq.vpn', label: '翻墙管理' },
      { code: 'menu.hq.crossborder', label: '跨境导航' },
      { code: 'menu.hq.admin', label: '系统管理' },
      { code: 'menu.tasks', label: 'AI任务' }
    ]
  }
]

export type MenuCheckState = 'none' | 'some' | 'all'

/** 一级勾选三态：无二级的一级叶子按一级码；有二级时按二级勾选数量（持有一级码但无二级视为半选） */
export function menuCheckState(selected: string[], node: MenuPermNode): MenuCheckState {
  const set = new Set(selected)
  if (node.cards.length === 0) return set.has(node.code) ? 'all' : 'none'
  const count = node.cards.filter(card => set.has(card.code)).length
  if (count === node.cards.length) return 'all'
  if (count > 0 || set.has(node.code)) return 'some'
  return 'none'
}

/** 一级菜单访问判断：持有一级码或任一下属二级码 */
export function hasMenuAccess(hasPerm: (code: string) => boolean, node: MenuPermNode): boolean {
  return hasPerm(node.code) || node.cards.some(card => hasPerm(card.code))
}

/** 点击一级勾选框：全选/清空该栏（含一级码与全部二级码） */
export function toggleMenu(selected: string[], node: MenuPermNode, checked: boolean): string[] {
  const codes = [node.code, ...node.cards.map(card => card.code)]
  if (checked) return [...new Set([...selected, ...codes])]
  return selected.filter(code => !codes.includes(code))
}

/** 点击二级勾选框：勾选自动带上一级；取消最后一个二级时自动取消一级 */
export function toggleMenuCard(selected: string[], node: MenuPermNode, cardCode: string, checked: boolean): string[] {
  if (checked) return [...new Set([...selected, cardCode, node.code])]
  let next = selected.filter(code => code !== cardCode)
  if (next.includes(node.code) && !node.cards.some(card => next.includes(card.code))) {
    next = next.filter(code => code !== node.code)
  }
  return next
}

/** 成员使用权限摘要：一级名顿号分隔，部分二级时如「AI美工（AI生图）」 */
export function summarizeMenuPermissions(selected: string[]): string {
  const set = new Set(selected)
  const parts: string[] = []
  for (const node of MENU_PERMISSION_TREE) {
    const state = menuCheckState(selected, node)
    if (state === 'none') continue
    if (state === 'all') {
      parts.push(node.label)
      continue
    }
    const cardLabels = node.cards.filter(card => set.has(card.code)).map(card => card.label)
    parts.push(cardLabels.length > 0 ? `${node.label}（${cardLabels.join('/')}）` : node.label)
  }
  return parts.join('、')
}
