// K 阶段新增：团队工作台首页共享契约
// 数据从中央服务器聚合（审计日志 / 选品任务 / AI 用量 / 成员），按角色差异化返回

/** KPI 指标键（按角色显示不同子集） */
export type DashboardKpiKey =
  | 'todayProducts'      // 今日新增产品
  | 'pendingReports'     // 待审报告
  | 'failedTasks'        // 失败任务
  | 'aiQuotaUsed'        // AI 用量百分比
  | 'activeMembers'      // 在岗成员

/** KPI 趋势（与昨日对比） */
export type DashboardTrend = 'up' | 'down' | 'flat'

export interface DashboardKpi {
  key: DashboardKpiKey
  label: string
  /** null = 服务端无真实数据源（不再以假 0 充数） */
  value: number | null
  /** 副标题/单位（如 "68%" / "23 件"） */
  suffix?: string
  /** 与昨日对比的趋势 */
  trend?: DashboardTrend
  /** 变化量（绝对值，正数表示增加） */
  trendValue?: number
}

/** 待办类型（按业务域区分） */
export type MyTodoType = 'selection' | 'compliance' | 'publish' | 'guardian' | 'review'

/** 待办状态 */
export type MyTodoStatus = 'pending' | 'running' | 'failed'

export interface MyTodo {
  id: string
  type: MyTodoType
  title: string
  ownerName: string
  ownerAvatar?: string
  status: MyTodoStatus
  /** 截止时间（毫秒时间戳） */
  dueAt?: number
  createdAt: number
  /** 跳转锚点（AppPage 路径） */
  link: string
}

/**
 * 团队动作类型（来自审计日志的 action 字面量）。
 * 必须与 server/src/modules/dashboard/teamActivity.ts 的 TEAM_ACTIVITY_ACTIONS 完全一致
 * （server 不 import src/shared，只能手工镜像；漂移由 __tests__/dashboardTeamActions.test.ts 守卫）。
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

export type TeamAction = typeof TEAM_ACTIVITY_ACTIONS[number]

/**
 * 团队动态目标类型：审计日志的 targetType 是自由字符串（user / role / store / organization /
 * LinduoModelTier / ErpProduct …），不做闭合联合，前端按映射表取名并对未知值回退原值。
 */
export type TeamTargetType = string

export interface TeamActivity {
  id: string
  memberId: string
  memberName: string
  action: TeamAction
  targetType: TeamTargetType
  /** 目标显示名（如产品名 / 报告标题 / 用户名） */
  targetLabel: string
  /** 动作时间戳（毫秒） */
  at: number
}

export interface DashboardSummary {
  kpis: DashboardKpi[]
  myTodos: MyTodo[]
  teamActivities: TeamActivity[]
  generatedAt: number
}

/** K 阶段新增：团队工作台请求（主进程 IPC 入参） */
export interface DashboardRequest {
  /** 视角用户 ID（由主进程从 session 自动注入；UI 不需要传） */
  requesterId?: string
}
