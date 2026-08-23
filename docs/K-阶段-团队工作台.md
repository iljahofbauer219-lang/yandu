# K 阶段：团队工作台首页（KPI + 我的待办 + 团队动态）

更新时间：2026-08-19（Asia/Shanghai）

## 背景

砚都跨境在 H/I 阶段已经把「单兵作战」的能力补齐了 — 选品、采集、报告、Listing 优化都能跑通。但团队场景下仍有 3 个真问题：

1. **没有首页**：每次启动直接跳到「AI 员工」页，要 2~3 次点击才能找到核心工作
2. **没有 KPI 全局视图**：每个人只看到自己的数据，老板看不到「团队今天做了什么」
3. **没有团队动态**：成员 A 创建/更新了产品，成员 B 不知道；操作可追溯性弱

K 阶段一次性把这 3 个问题解决：把「团队工作台」作为默认首页，聚合 4 维度数据（KPI / 我的待办 / 团队动态 / 智能体用量），并按 4 个预置角色差异化展示。

## 设计原则

- **服务端聚合**：数据源在中央服务器（审计日志 / 选品任务 / AI 用量 / 成员），不走主进程 IPC
- **角色差异化**：OWNER 看全量；OPERATOR 看「自己 + 同 org」；PUBLISHER 看自己；VIEWER 只看 KPI
- **数据真实优先**：能从 prisma 拉的就拉；不能的就 0 兜底（不假装有数据）
- **可测试**：每个区块都有 `data-testid`，UI 组件纯展示 + 自动刷新

## 已完成内容

### K.1.1 共享契约 `src/shared/dashboard.ts`（88 行）

6 个接口 + 5 个类型联合：

| 类型 | 字段 | 说明 |
|---|---|---|
| `DashboardKpiKey` | 6 个字面量 | todayProducts / pendingReports / failedTasks / aiQuotaUsed / activeMembers / runningSkills |
| `DashboardTrend` | 'up'/'down'/'flat' | 趋势方向 |
| `DashboardKpi` | key/label/value/suffix/trend/trendValue | KPI 单元（含趋势） |
| `MyTodo` | id/type/title/ownerName/status/dueAt/createdAt/link | 待办 |
| `MyTodoType` | selection/compliance/publish/guardian/review | 待办类型 |
| `MyTodoStatus` | pending/running/failed | 待办状态 |
| `TeamAction` | 10 个字面量 | created/updated/deleted/enabled/disabled/reset_pwd/role_changed/ai_quota_exceeded/login/logout |
| `TeamTargetType` | product/report/task/user/role/kb/session | 目标类型 |
| `TeamActivity` | id/memberId/memberName/action/targetType/targetLabel/at | 动态 |
| `DashboardSummary` | kpis/myTodos/teamActivities/generatedAt | 顶层聚合 |
| `DashboardRequest` | requesterId? | 主进程 IPC 入参（当前未走 IPC，保留扩展） |

### K.1.2 服务端聚合 `server/src/modules/dashboard/routes.ts`（217 行）

- **路由**：`GET /api/dashboard/summary`
- **权限**：`dashboard.view`（OWNER/OPERATOR/PUBLISHER/VIEWER 均可见；按角色差异化返回）
- **预处理器**：`app.authenticate` + `app.requirePermission('dashboard.view')`
- **视角辅助函数**：
  - `isWideView(user)`：OWNER 或有 `member.manage` 权限 → 全 org 视角
  - `isSelfOnlyView(user)`：无 `report.view:all` 且无 `member.manage` → 只看自己
- **KPI 聚合**（`Promise.all` 11 个查询）：
  - todayProducts / yesterdayProducts（产品）
  - pendingReports / yesterdayPendingReports（待审）
  - failedTasks / yesterdayFailedTasks（失败任务）
  - aiUsageToday / aiUsageYesterday（AI 用量）
  - activeMembers（最近 24h 有 auditLog 的 distinct userId）
  - runningSkills（KB Guardian 数量，0 兜底）
- **趋势计算**：`trend(current, previous)` 返回 `{trend: 'up'/'down'/'flat', trendValue: diff}`（绝对值）
- **AI 用量百分比**：`min(100, round((aiUsageToday/100)*100))`（简化：实际应有配额阈值）
- **我的待办**：从 `selectionTask` 拉最近 5 条，stage 映射到 pending/running/failed
- **团队动态**：
  - 广角视角：全 org 最近 20 条 `auditLog`（按 TEAM_ACTIVITY_ACTIONS 白名单）
  - 自视角：仅自己的最近 20 条
  - VIEWER / PUBLISHER 自视角：都看不到团队动态

### K.1.2 RBAC 权限集成 `server/src/modules/rbac/permissions.ts`

- 在 PERMISSIONS 列表加入 `'dashboard.view'`（共 41 个权限码）
- 在 3 个非 OWNER 预置角色中显式加入：
  - OPERATOR: `['dashboard.view', 'collection.run', ...]`
  - PUBLISHER: `['dashboard.view', 'publish.run', ...]`
  - VIEWER: `['dashboard.view', 'menu.planet', ...]`
- OWNER 隐式包含全部（`isOwner: true` 分支）

### K.1.2 服务端注册 `server/src/app.ts`

```ts
import { dashboardRoutes } from './modules/dashboard/routes.js'
// ...
await app.register(dashboardRoutes, { prefix: '/api/dashboard' })
```

### K.1.3 前端 API 客户端 `src/renderer/serverApi.ts`

不走 IPC（与 auth / members 一致），走中央服务器：

```ts
import type { DashboardSummary } from '../shared/dashboard'

export async function fetchDashboardSummary(): Promise<DashboardSummary> {
  return apiFetch<DashboardSummary>('/api/dashboard/summary', { method: 'GET' })
}
```

### K.1.4 UI 组件 `src/renderer/Dashboard.tsx`（265 行）

- **入口**：`export default function Dashboard()`
- **状态**：`useState<DashboardSummary | null>(null)` + loading / error / refreshing
- **自动刷新**：
  - 60s 后台刷新：`setInterval(() => void load(true), 60_000)`
  - 30s 相对时间 tick：`setInterval(() => setTickNow(Date.now()), 30_000)`
- **结构**：
  - header：标题 + 副标题 + 「更新时间 + 刷新」按钮
  - `.dashboard-kpis` 网格：6 张 KPI 卡片（auto-fit minmax 180px）
  - `.dashboard-grid` 双栏：左「我的待办」 + 右「团队动态」
- **data-testid 覆盖**：
  - `dashboard-kpis` / `kpi-{key}` 单卡
  - `dashboard-my-todos` / `.dashboard-todo-item` 行
  - `dashboard-team-activities` / `.dashboard-activity-item` 行
- **辅助函数**：`formatRelativeTime` / `formatClock` / `kpiIcon` / `TREND_ARROW` / `TREND_CLASS`
- **错误处理**：`apiFetch` 抛错时显示 `dashboard-error` + 重试按钮

### K.1.4 UI 样式 `src/renderer/dashboard.css`（395 行）

- **容器**：`.dashboard-page` flex 纵向 + 24 padding
- **KPI 网格**：`.dashboard-kpis` grid auto-fit minmax 180px
- **KPI 卡片**：`.dashboard-kpi` + `.kpi-{key}` 6 个主题色
- **双栏**：`grid-template-columns: 1fr 1.2fr`，`@media (max-width: 1100px)` 收为单列
- **趋势 chip**：`.kpi-trend.up` 绿 / `.down` 红 / `.flat` 灰
- **暗色主题**：`@media (prefers-color-scheme: dark)` 完整覆盖（背景 / 边框 / 文字 / 强调色）

### K.1.5 导航 `src/renderer/App.tsx`

- `import Dashboard from './Dashboard'`
- `type AppPage = 'dashboard' | ...`（'dashboard' 作为新首页）
- `aiModuleNav` 首项：`{ page: 'dashboard', label: '团队工作台', icon: 'dashboard', perm: 'dashboard.view' }`
- 默认页：`useState<AppPage>('dashboard')`（之前是 'ai-employee'）
- 渲染分支（IIFE 内）：

  ```ts
  if(page==='dashboard')return <Dashboard/>
  ```

  插入在 `if(!canMenu(current.perm))return null;` 之后、`if(page==='ai-advisor')` 之前。

### K.1.6 tsc 主+渲染 0 错

```
$ npm run typecheck
> tsc --noEmit && tsc -p tsconfig.main.json --noEmit
(无输出 = 通过)
```

## 数据流

```
┌──────────────────┐     fetchDashboardSummary()     ┌──────────────────┐
│  Dashboard.tsx   │ ─────────────────────────────▶ │ serverApi.ts     │
└──────────────────┘                                 └────────┬─────────┘
                                                                │ apiFetch
                                                                ▼
                                                       ┌──────────────────┐
                                                       │ /api/dashboard/  │
                                                       │     summary      │
                                                       └────────┬─────────┘
                                                                │
                                                ┌───────────────┼───────────────┐
                                                ▼               ▼               ▼
                                          ┌──────────┐   ┌──────────┐   ┌──────────┐
                                          │ prisma.  │   │ prisma.  │   │ prisma.  │
                                          │ auditLog │   │selection │   │aiUsageLog│
                                          └──────────┘   │   Task    │   └──────────┘
                                                         └──────────┘
```

## 验证

### K.2 自动化守卫

新增 `tools/verify-k-stage.ts`（297 行，69 断言），覆盖：

- **K.1.1 共享契约**：6 类型 + 5 接口 + 10 个 TeamAction 字面量
- **K.1.2 服务端聚合**：dashboardRoutes 导出 + GET /summary + requirePermission + Promise.all + 6 KPI 键 + 趋势计算 + myTodos take:5 + teamActivities take:20 + 角色守卫
- **K.1.2 RBAC 集成**：4 角色都包含 dashboard.view
- **K.1.2 服务端注册**：import + register prefix
- **K.1.3 前端 API 客户端**：import type + 函数导出 + apiFetch 路径
- **K.1.4 UI 组件**：default export + 导入类型 + 4 个 data-testid + 60s/30s setInterval
- **K.1.4 UI 样式**：11 个核心选择器 + 暗色主题 + 趋势色 + 响应式
- **K.1.5 导航**：5 个挂钩点（import / AppPage / nav / 默认页 / IIFE 分支）
- **K.1.6 tsc 双端**：渲染 + 主进程退出码 0

运行方式：

```bash
npm run verify:k
# 或
npx tsx tools/verify-k-stage.ts
```

当前结果：**PASS 69 / FAIL 0**

## 后续可扩展点（不在 K 阶段范围）

- K.3：把 KB Guardian 的 `runningSkills` 从主进程内状态推送到中央服务器（IPC → server.sse）
- K.4：AI 用量阈值配置（目前 100 硬编码）
- K.5：把 DashboardSummary 加入 IPC channel，让主进程可以预热
- K.6：多语言（en-US / ms / de）的 dashboard 标签
