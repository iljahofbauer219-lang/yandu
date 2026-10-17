/**
 * 成员菜单权限回填（服务端白名单修复后的存量数据补齐）。
 *
 * 背景：PUT /api/members/:id/permissions 用服务端白名单过滤提交码，旧白名单只有 4 个
 * menu.collect.* 码，成员即使勾了「货盘采集」一级也只落 4 张卡。白名单已改为由
 * tools/gen-server-menu-permissions.ts 从前端权限树生成；本脚本把存量角色按同一口径回填。
 *
 * 码集一律来自前端树纯函数（checkedLevel1Codes → expandMenuSelection → mergePermissionsForSubmit，
 * 与系统管理页保存时提交的集合完全一致），禁止手写码表。
 *
 * 用法：
 *   1) 只读出 diff：npx tsx tools/backfill-member-menu-permissions.ts --in /tmp/prod-roles.tsv
 *   2) 生成可审阅 SQL：追加 --emit-sql /tmp/backfill.sql
 * 输入 TSV 列（| 分隔，第六列起为逗号连接权限码）：
 *   role_id | role_name | is_system | user_name | email_tail | codes
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { checkedLevel1Codes, expandMenuSelection, MENU_PERMISSION_TREE } from '../src/shared/menuPermissionTree'
import { mergePermissionsForSubmit } from '../src/renderer/memberPermissionMerge'

const argOf = (flag: string): string | null => {
  const index = process.argv.indexOf(flag)
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : null
}

const inputPath = argOf('--in')
const emitSql = argOf('--emit-sql')
if (!inputPath) throw new Error('缺少 --in <tsv>')

interface RoleRow {
  roleId: string
  roleName: string
  isSystem: boolean
  userName: string
  emailTail: string
  codes: string[]
}

const rows: RoleRow[] = readFileSync(inputPath, 'utf8')
  .split('\n')
  .map(line => line.trim())
  .filter(line => line.length > 0)
  .map(line => {
    const [roleId, roleName, isSystem, userName, emailTail, codesRaw = ''] = line.split('|')
    return {
      roleId, roleName, isSystem: isSystem === 't', userName, emailTail,
      codes: codesRaw.split(',').map(code => code.trim()).filter(code => code.length > 0)
    }
  })

const labelOf = (code: string): string => {
  const node = MENU_PERMISSION_TREE.find(item => item.code === code)
  if (node) return node.label
  for (const item of MENU_PERMISSION_TREE) {
    const card = item.cards.find(entry => entry.code === code)
    if (card) return `${item.label}·${card.label}`
  }
  return code
}

const inserts: string[] = []
let totalAdded = 0
let totalRemoved = 0

for (const row of rows) {
  if (!row.roleId) throw new Error(`输入行缺少 role_id：${row.userName}`)
  const menuCodes = row.codes.filter(code => code.startsWith('menu.'))
  const checked = checkedLevel1Codes(menuCodes)
  const target = mergePermissionsForSubmit(row.codes, expandMenuSelection(checked))
  const added = target.filter(code => !row.codes.includes(code))
  const removed = row.codes.filter(code => !target.includes(code))
  totalAdded += added.length
  totalRemoved += removed.length

  console.log(`\n${row.userName}(${row.emailTail}) 角色=${row.roleName}${row.isSystem ? '[系统预置]' : ''}`)
  console.log(`  当前码数=${row.codes.length}  已勾选一级=${checked.length ? checked.map(labelOf).join('、') : '（无）'}`)
  console.log(`  应补 ${added.length} 码  应删 ${removed.length} 码`)
  if (removed.length > 0) console.log(`  !! 将删除：${removed.join(', ')}`)
  const addedCollect = added.filter(code => code.startsWith('menu.collect.'))
  if (addedCollect.length > 0) {
    const collectTotal = row.codes.filter(code => code.startsWith('menu.collect')).length + addedCollect.length
    console.log(`  其中货盘采集二级 ${addedCollect.length} 个（补后该角色 collect 码共 ${collectTotal} 个）`)
  }

  for (const code of added) {
    inserts.push(`('${code.replace(/'/g, "''")}', '${row.roleId.replace(/'/g, "''")}')`)
  }
}

console.log(`\n合计：补 ${totalAdded} 码、删 ${totalRemoved} 码，涉及角色 ${rows.length} 个`)

if (emitSql) {
  if (inserts.length === 0) {
    writeFileSync(emitSql, '-- 无需变更\n')
  } else {
    const values = inserts.map(insert => `  ${insert}`).join(',\n')
    writeFileSync(emitSql, `BEGIN;
-- 由 tools/backfill-member-menu-permissions.ts 生成，码集来自前端权限树展开
INSERT INTO role_permissions (code, role_id) VALUES
${values}
ON CONFLICT DO NOTHING;
COMMIT;
`)
  }
  console.log(`SQL 已写入 ${emitSql}（${inserts.length} 行）`)
}
