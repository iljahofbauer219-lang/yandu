/**
 * 成员权限提交合并（plan frosty-wood-gudgeon #1）。
 *
 * 背景：PUT /api/members/:id/permissions 是「全量替换」契约（服务端对专属自定义角色
 * deleteMany + createMany，且角色绑定收敛到该自定义角色），而系统管理页 UI 只展示
 * menu.* 前缀的权限点。若只提交编辑后的 menu 权限，成员当前的非 menu 操作码
 * （erp.*、report.*、ai.use 等）会被静默清除。
 *
 * 修法：提交「该成员当前未被 UI 展示的权限 ∪ 编辑后的权限」。
 * 本文件是零依赖纯函数，供 SystemAdmin.tsx 调用，并由
 * src/shared/__tests__/memberPermissionMerge.test.ts 守卫语义
 * （server rootDir 禁跨包 import，故测试落 shared 侧，沿用 dashboardTeamActions 先例）。
 */

/**
 * 合并提交集：保留 currentAll 中所有非 menu.* 的权限码（UI 未展示、本次不编辑），
 * 并并入编辑后的 menu 权限 editedMenu；结果去重。
 *
 * @param currentAll 该成员当前全量权限（其所有已绑定角色权限点的并集）
 * @param editedMenu UI 编辑后的 menu.* 权限
 */
export function mergePermissionsForSubmit(currentAll: readonly string[], editedMenu: readonly string[]): string[] {
  const hiddenNonMenu = currentAll.filter(code => !code.startsWith('menu.'))
  return [...new Set([...hiddenNonMenu, ...editedMenu])]
}
