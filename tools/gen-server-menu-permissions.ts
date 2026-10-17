/**
 * 由前端权限树 src/shared/menuPermissionTree.ts 生成服务端菜单权限白名单
 * server/src/modules/rbac/menuPermissions.generated.ts。
 *
 * 为什么需要生成而不是维护两份：服务端 PERMISSION_CODE_SET 是 PUT /api/members/:id/permissions
 * 与角色保存的过滤器，不在其中的码会被**静默丢弃**。前端新增二级卡片后服务端没跟上，成员端就会
 * 少看到整片入口（货盘采集曾因此只剩 4 张卡，管理员勾了一级也存不进去）。
 *
 * 用法：npx tsx tools/gen-server-menu-permissions.ts
 * 对账守卫：src/shared/__tests__/menuPermissionTree.serverSync.test.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { MENU_PERMISSION_TREE } from '../src/shared/menuPermissionTree'

const OUT = 'server/src/modules/rbac/menuPermissions.generated.ts'

/**
 * 展示名例外：树里的卡片名是给管理界面勾选用的短标签，服务端权限点目录沿用历史上更完整的说法。
 * 仅作显示文案用途，与权限判定无关。
 */
const LABEL_OVERRIDES: Record<string, string> = {
  'menu.warehouse.hub': '货盘仓库·货盘总览',
  'menu.planet.ops': 'AI星球·运营知识库',
  'menu.planet.compliance': 'AI星球·合规知识库',
  'menu.cb-news': 'CB资讯'
}

function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

const codes: string[] = []
const labels = new Map<string, string>()

for (const node of MENU_PERMISSION_TREE) {
  codes.push(node.code)
  labels.set(node.code, LABEL_OVERRIDES[node.code] ?? node.label)
  for (const card of node.cards) {
    codes.push(card.code)
    labels.set(card.code, LABEL_OVERRIDES[card.code] ?? `${node.label}·${card.label}`)
  }
}

const duplicated = codes.filter((code, index) => codes.indexOf(code) !== index)
if (duplicated.length > 0) throw new Error(`前端权限树存在重复权限码：${[...new Set(duplicated)].join(', ')}`)

const collectCards = codes.filter(code => code.startsWith('menu.collect.'))
const header = `/**
 * 本文件由 tools/gen-server-menu-permissions.ts 生成，请勿手改。
 * 唯一真值源：src/shared/menuPermissionTree.ts（${MENU_PERMISSION_TREE.length} 个一级栏目 / ${codes.length} 个权限码，
 * 其中货盘采集二级 ${collectCards.length} 个）。前端树改动后重新生成，漂移由对账单测拦截。
 */
export const MENU_PERMISSION_CODES = [`

const body = codes
  .map(code => `  ${quote(code)}, // ${labels.get(code)}`)
  .join('\n')

const labelEntries = codes.map(code => `  ${quote(code)}: ${quote(labels.get(code) ?? '')}`).join(',\n')

const out = `${header}
${body}
] as const

export type MenuPermissionCode = (typeof MENU_PERMISSION_CODES)[number]

export const MENU_PERMISSION_LABELS: Record<MenuPermissionCode, string> = {
${labelEntries}
}
`

if (existsSync(OUT)) {
  const current = readFileSync(OUT, 'utf8')
  if (current === out) {
    console.log(`未变化：${OUT}（${codes.length} 个菜单权限码，货盘采集二级 ${collectCards.length} 个）`)
    process.exit(0)
  }
}

writeFileSync(OUT, out)
console.log(`已生成 ${OUT}：${codes.length} 个菜单权限码（一级 ${MENU_PERMISSION_TREE.length}，货盘采集二级 ${collectCards.length}）`)
