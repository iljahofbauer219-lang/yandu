import { MENU_PERMISSION_CODES, MENU_PERMISSION_LABELS } from './menuPermissions.generated.js'

/**
 * 操作类权限码（与侧边栏/栏目入口无关，服务端手工维护）。
 * 菜单类权限码一律来自生成文件，见下。
 */
const OPERATION_PERMISSIONS = [
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
  // ERP 采集加工域：操作权限（erp.source.view 决定敏感字段投影，仅采集专员/主帐号持有）
  'erp.collect',
  'erp.source.view',
  'erp.source.manage',
  'erp.warehouse.view',
  'erp.warehouse.edit',
  'erp.pricing.manage',
  'erp.changes.resolve',
  // K 阶段新增：团队工作台首页权限（首页默认页；所有角色可见）
  'dashboard.view'
] as const

/**
 * 两级使用权限：一级=侧边栏菜单 menu.<栏目>，二级=栏目内卡片 menu.<栏目>.<卡片>。
 * 唯一真值源是前端 src/shared/menuPermissionTree.ts，由 tools/gen-server-menu-permissions.ts
 * 生成 menuPermissions.generated.ts。本白名单是成员权限保存的过滤器，不在其中的码会被静默丢弃，
 * 因此菜单码必须随树同步——漂移由 src/shared/__tests__/menuPermissionTree.serverSync.test.ts 拦截。
 */
export const PERMISSIONS = [...OPERATION_PERMISSIONS, ...MENU_PERMISSION_CODES] as const

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
  'erp.collect': 'ERP 采集入库（内嵌浏览器/扩展采集写入）',
  'erp.source.view': 'ERP 货盘来源敏感字段可见（供应商/原始URL/货盘SKU/采集人）',
  'erp.source.manage': 'ERP 货盘与抓取规则管理',
  'erp.warehouse.view': 'ERP 产品库查看',
  'erp.warehouse.edit': 'ERP 产品加工操作（下载原图/AI加工/选图定稿）',
  'erp.pricing.manage': 'ERP 定价规则配置',
  'erp.changes.resolve': 'ERP 巡盘变更确认',
  'dashboard.view': '团队工作台首页',
  ...MENU_PERMISSION_LABELS
}

export const PERMISSION_CODE_SET: ReadonlySet<string> = new Set(PERMISSIONS)

export interface PresetRole {
  key: 'OWNER' | 'OPERATOR' | 'COLLECTOR' | 'PUBLISHER' | 'VIEWER'
  name: string
  permissions: PermissionCode[]
}

export const PRESET_ROLES: PresetRole[] = [
  { key: 'OWNER', name: '主帐号', permissions: [...PERMISSIONS] },
  // menu.tasks 是顶级码而非 menu.hq 子卡（客户端权限树已同步独立成栏）；OPERATOR 需持 menu.hq
  // 才能进 AI总部页看到其中的 AI任务卡片（历史上经"tasks 是 hq 子卡"的 hasMenuAccess 连带可达，独立成栏后显式补齐，不扩大实际访问面）
  { key: 'OPERATOR', name: '运营', permissions: ['dashboard.view', 'collection.run', 'product.edit', 'ai.use', 'compliance.manage', 'report.view:self', 'menu.crossborder', 'menu.crossborder.login', 'menu.crossborder.title', 'menu.crossborder.desc', 'menu.crossborder.image', 'menu.collect', 'menu.collect.gigacloud', 'menu.collect.1688', 'menu.collect.aliexpress', 'menu.collect.ozon', 'menu.art', 'menu.art.studio', 'menu.art.realshift', 'menu.advisor', 'menu.advisor.online', 'menu.planet', 'menu.planet.ops', 'menu.planet.compliance', 'menu.employee', 'menu.video', 'menu.tasks', 'menu.hq', 'menu.warehouse', 'menu.warehouse.products', 'menu.warehouse.changes', 'menu.warehouse.pricing', 'erp.warehouse.view', 'erp.warehouse.edit', 'erp.pricing.manage', 'erp.changes.resolve'] },
  // 采集专员（货盘部）：可见货盘来源敏感字段；不可操作 listing/定价/变更确认，
  // 也不持 erp.warehouse.edit（下载原图/AI加工/选图定稿属产品加工操作，归运营）
  { key: 'COLLECTOR', name: '采集专员', permissions: ['dashboard.view', 'collection.run', 'report.view:self', 'menu.collect', 'menu.collect.gigacloud', 'menu.collect.1688', 'menu.collect.aliexpress', 'menu.collect.ozon', 'menu.warehouse', 'menu.warehouse.pool', 'menu.warehouse.products', 'menu.warehouse.patrol', 'erp.collect', 'erp.source.view', 'erp.source.manage', 'erp.warehouse.view'] },
  { key: 'PUBLISHER', name: '发布员', permissions: ['dashboard.view', 'publish.run', 'report.view:self', 'menu.crossborder', 'menu.crossborder.login', 'menu.crossborder.title', 'menu.crossborder.desc', 'menu.crossborder.image'] },
  { key: 'VIEWER', name: '只读', permissions: ['dashboard.view', 'menu.planet', 'menu.planet.ops', 'menu.planet.compliance'] }
]

export const OWNER_ROLE_KEY = 'OWNER'
