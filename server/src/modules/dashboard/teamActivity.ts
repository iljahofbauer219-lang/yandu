/**
 * 团队动态（仪表盘）动作白名单：只有这些审计 action 会出现在「团队动态」里。
 *
 * 必须与 src/shared/dashboard.ts 的 TEAM_ACTIVITY_ACTIONS 完全一致。server 端不 import src/shared，
 * 只能手工镜像；漂移由 src/shared/__tests__/dashboardTeamActions.test.ts 守卫（运行时 + 编译期双重）。
 *
 * 取值必须是审计日志里**真实写入**的 action 字面量（点分小写，如 member.create / auth.login）。
 * 这里曾长期写着 created / login / role_changed 一类裸词，与 writeAudit 的实际取值零交集，
 * 导致团队动态永远为空。新增审计 action 若要进动态流，两边同时加。
 *
 * 只收团队/权限/账号治理类动作：ai.* 调用、media.*、compliance.check.run、ERP_* 等高频操作
 * 会把 20 条的动态流冲掉，故不收。
 */
export const TEAM_ACTIVITY_ACTIONS = [
  'member.create',
  'member.update',
  'member.delete',
  'member.approve',
  'member.reject',
  'grant.update',
  'role.create',
  'role.update',
  'role.delete',
  'store.create',
  'store.update',
  'store.delete',
  'auth.register',
  'auth.login',
  'auth.logout',
  'auth.change-password',
  'ai.quota.update',
  'linduo.member.tier.set',
  'linduo.tier.models.set',
  'linduo.chat_model.toggle_enabled'
] as const

export type TeamActivityAction = typeof TEAM_ACTIVITY_ACTIONS[number]
