export const PERMISSIONS = [
  'store.manage',
  'member.manage',
  'role.manage',
  'collection.run',
  'product.edit',
  'ai.use',
  'publish.run',
  'compliance.manage',
  'report.view:all',
  'report.view:self',
  // 两级使用权限：一级=侧边栏菜单 menu.<栏目>，二级=栏目内卡片 menu.<栏目>.<卡片>
  'menu.crossborder',
  'menu.crossborder.login',
  'menu.crossborder.title',
  'menu.crossborder.desc',
  'menu.crossborder.image',
  'menu.advisor',
  'menu.advisor.online',
  'menu.advisor.harness',
  'menu.collect',
  'menu.collect.gigacloud',
  'menu.collect.1688',
  'menu.collect.aliexpress',
  'menu.collect.ozon',
  'menu.art',
  'menu.art.studio',
  'menu.art.realshift',
  'menu.video',
  'menu.tasks',
  'menu.employee',
  'menu.planet',
  'menu.planet.ops',
  'menu.planet.compliance',
  'menu.hq',
  'menu.hq.finance',
  'menu.hq.support',
  'menu.hq.feishu',
  'menu.hq.vpn',
  'menu.hq.admin',
  // K 阶段新增：团队工作台首页权限（首页默认页；所有角色可见）
  'dashboard.view'
] as const

export type PermissionCode = (typeof PERMISSIONS)[number]

export const PERMISSION_LABELS: Record<PermissionCode, string> = {
  'store.manage': '店铺管理（添加/编辑/删除店铺与凭据）',
  'member.manage': '成员管理（创建/禁用子帐号、分配店铺）',
  'role.manage': '角色管理（自定义角色与权限）',
  'collection.run': '店铺采集',
  'product.edit': '本地产品编辑',
  'ai.use': 'AI 优化（标题/内容/生图/视频）',
  'publish.run': '线上发布/更新店铺',
  'compliance.manage': '合规知识库管理',
  'report.view:all': '查看全员用量与审计报表',
  'report.view:self': '查看本人用量报表',
  'menu.crossborder': 'AI跨境',
  'menu.crossborder.login': 'AI跨境·平台登录',
  'menu.crossborder.title': 'AI跨境·标题优化',
  'menu.crossborder.desc': 'AI跨境·描述优化',
  'menu.crossborder.image': 'AI跨境·图片优化',
  'menu.advisor': 'AI参谋',
  'menu.advisor.online': 'AI参谋·在线参谋',
  'menu.advisor.harness': 'AI参谋·DeepSeek Harness',
  'menu.collect': 'AI采集',
  'menu.collect.gigacloud': 'AI采集·大健云仓',
  'menu.collect.1688': 'AI采集·1688',
  'menu.collect.aliexpress': 'AI采集·AliExpress',
  'menu.collect.ozon': 'AI采集·Ozon',
  'menu.art': 'AI美工',
  'menu.art.studio': 'AI美工·AI生图',
  'menu.art.realshift': 'AI美工·AI洗图',
  'menu.video': 'AI视频',
  'menu.tasks': 'AI任务',
  'menu.employee': 'AI员工',
  'menu.planet': 'AI星球',
  'menu.planet.ops': 'AI星球·运营知识库',
  'menu.planet.compliance': 'AI星球·合规知识库',
  'menu.hq': 'AI总部',
  'menu.hq.finance': 'AI总部·AI财务',
  'menu.hq.support': 'AI总部·AI客服',
  'menu.hq.feishu': 'AI总部·AI飞书',
  'menu.hq.vpn': 'AI总部·翻墙管理',
  'menu.hq.admin': 'AI总部·系统管理'
}

export const PERMISSION_CODE_SET: ReadonlySet<string> = new Set(PERMISSIONS)

export interface PresetRole {
  key: 'OWNER' | 'OPERATOR' | 'PUBLISHER' | 'VIEWER'
  name: string
  permissions: PermissionCode[]
}

export const PRESET_ROLES: PresetRole[] = [
  { key: 'OWNER', name: '主帐号', permissions: [...PERMISSIONS] },
  { key: 'OPERATOR', name: '运营', permissions: ['dashboard.view', 'collection.run', 'product.edit', 'ai.use', 'compliance.manage', 'report.view:self', 'menu.crossborder', 'menu.crossborder.login', 'menu.crossborder.title', 'menu.crossborder.desc', 'menu.crossborder.image', 'menu.collect', 'menu.collect.gigacloud', 'menu.collect.1688', 'menu.collect.aliexpress', 'menu.collect.ozon', 'menu.art', 'menu.art.studio', 'menu.art.realshift', 'menu.advisor', 'menu.advisor.online', 'menu.advisor.harness', 'menu.planet', 'menu.planet.ops', 'menu.planet.compliance', 'menu.employee', 'menu.video', 'menu.tasks'] },
  { key: 'PUBLISHER', name: '发布员', permissions: ['dashboard.view', 'publish.run', 'report.view:self', 'menu.crossborder', 'menu.crossborder.login', 'menu.crossborder.title', 'menu.crossborder.desc', 'menu.crossborder.image'] },
  { key: 'VIEWER', name: '只读', permissions: ['dashboard.view', 'menu.planet', 'menu.planet.ops', 'menu.planet.compliance'] }
]

export const OWNER_ROLE_KEY = 'OWNER'
