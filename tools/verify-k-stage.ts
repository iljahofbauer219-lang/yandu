/**
 * K 阶段：团队工作台首页守卫
 *
 * 覆盖 K.1.1 ~ K.1.5 全部产物（共享契约 / 服务端聚合 / IPC 客户端 / UI / 导航）
 * + K.1.6 tsc 主+渲染 0 错
 *
 * 运行：tsx tools/verify-k-stage.ts
 * 退出码：全 pass → 0；任一 fail → 1
 */

import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const ROOT = process.cwd()
let pass = 0
let fail = 0
const failures: string[] = []

function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++
    console.log(`  ✅ ${label}`)
  } else {
    fail++
    failures.push(`${label}${detail ? ' — ' + detail : ''}`)
    console.log(`  ❌ ${label}${detail ? ' — ' + detail : ''}`)
  }
}

function section(title: string) {
  console.log('')
  console.log('── ' + title + ' ' + '─'.repeat(60 - title.length - 4))
}

function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf-8') : null
}

function group(name: string) {
  console.log('')
  console.log('══════════════════════════════════════════════════════════════')
  console.log('  ' + name)
  console.log('══════════════════════════════════════════════════════════════')
}

// ──────────────────────────────────────────────────────────────────
group('K.1.1 共享契约 src/shared/dashboard.ts')
// ──────────────────────────────────────────────────────────────────

const contract = readIfExists('src/shared/dashboard.ts')
section('K.1.1 文件 + 类型导出')
check('src/shared/dashboard.ts 存在', contract !== null)
if (contract) {
  check('导出 DashboardKpiKey 联合类型',
    /export\s+type\s+DashboardKpiKey\s*=/.test(contract))
  check('KPI 键覆盖 6 个值（todayProducts/pendingReports/failedTasks/aiQuotaUsed/activeMembers/runningSkills）',
    /todayProducts/.test(contract) && /pendingReports/.test(contract)
    && /failedTasks/.test(contract) && /aiQuotaUsed/.test(contract)
    && /activeMembers/.test(contract) && /runningSkills/.test(contract))
  check('导出 DashboardKpi 接口（含 trend / trendValue）',
    /export\s+interface\s+DashboardKpi/.test(contract) && /trend\??:\s*DashboardTrend/.test(contract))
  check('导出 DashboardTrend 联合（up/down/flat）',
    /export\s+type\s+DashboardTrend/.test(contract) && /'up'/.test(contract) && /'down'/.test(contract) && /'flat'/.test(contract))
  check('导出 MyTodoType / MyTodoStatus / MyTodo',
    /export\s+type\s+MyTodoType/.test(contract)
    && /export\s+type\s+MyTodoStatus/.test(contract)
    && /export\s+interface\s+MyTodo/.test(contract))
  check('导出 TeamAction / TeamTargetType / TeamActivity',
    /export\s+type\s+TeamAction/.test(contract)
    && /export\s+type\s+TeamTargetType/.test(contract)
    && /export\s+interface\s+TeamActivity/.test(contract))
  check('TeamAction 白名单覆盖 10 个动作',
    /'created'/.test(contract) && /'updated'/.test(contract) && /'deleted'/.test(contract)
    && /'enabled'/.test(contract) && /'disabled'/.test(contract) && /'reset_pwd'/.test(contract)
    && /'role_changed'/.test(contract) && /'ai_quota_exceeded'/.test(contract)
    && /'login'/.test(contract) && /'logout'/.test(contract))
  check('导出 DashboardSummary 接口（含 kpis / myTodos / teamActivities / generatedAt）',
    /export\s+interface\s+DashboardSummary/.test(contract)
    && /kpis:\s*DashboardKpi\[\]/.test(contract)
    && /myTodos:\s*MyTodo\[\]/.test(contract)
    && /teamActivities:\s*TeamActivity\[\]/.test(contract)
    && /generatedAt:\s*number/.test(contract))
  check('导出 DashboardRequest 接口',
    /export\s+interface\s+DashboardRequest/.test(contract))
}

// ──────────────────────────────────────────────────────────────────
group('K.1.2 服务端聚合 server/src/modules/dashboard/routes.ts')
// ──────────────────────────────────────────────────────────────────

const routes = readIfExists('server/src/modules/dashboard/routes.ts')
section('K.1.2 路由文件 + 端点')
check('server/src/modules/dashboard/routes.ts 存在', routes !== null)
if (routes) {
  check('导出 dashboardRoutes 函数', /export\s+async\s+function\s+dashboardRoutes/.test(routes))
  check('注册 GET /summary 端点', /app\.get\(['"]\/summary['"]/.test(routes))
  check('使用 preHandler requirePermission 守卫 dashboard.view',
    /app\.requirePermission\(DASHBOARD_VIEW_PERMISSION\)/.test(routes)
    && /DASHBOARD_VIEW_PERMISSION\s*=\s*['"]dashboard\.view['"]/.test(routes))
  check('添加 authenticate preHandler hook', /app\.addHook\(['"]preHandler['"],\s*app\.authenticate\)/.test(routes))
  check('包含 isWideView 辅助函数', /function\s+isWideView\s*\(/.test(routes))
  check('包含 isSelfOnlyView 辅助函数', /function\s+isSelfOnlyView\s*\(/.test(routes))
  check('TEAM_ACTIVITY_ACTIONS 白名单含 10 个动作',
    /'created'/.test(routes) && /'updated'/.test(routes) && /'deleted'/.test(routes)
    && /'enabled'/.test(routes) && /'disabled'/.test(routes) && /'reset_pwd'/.test(routes)
    && /'role_changed'/.test(routes) && /'ai_quota_exceeded'/.test(routes)
    && /'login'/.test(routes) && /'logout'/.test(routes))
  check('KPI 聚合使用 Promise.all',
    /Promise\.all\(/.test(routes) && /prisma\.selectionRecord\.count/.test(routes))
  check('KPI 包含 6 个指标键（pendingReports / failedTasks / aiQuotaUsed / todayProducts / activeMembers / runningSkills）',
    /key:\s*'pendingReports'/.test(routes) && /key:\s*'failedTasks'/.test(routes)
    && /key:\s*'aiQuotaUsed'/.test(routes) && /key:\s*'todayProducts'/.test(routes)
    && /key:\s*'activeMembers'/.test(routes) && /key:\s*'runningSkills'/.test(routes))
  check('KPI 计算趋势 up/down/flat',
    /trend:\s*'up'/.test(routes) && /trend:\s*'down'/.test(routes) && /trend:\s*'flat'/.test(routes))
  check('myTodos 从 selectionTask 拉取（限 5 条）',
    /selectionTask/.test(routes) && /take:\s*5/.test(routes))
  check('teamActivities 从 auditLog 拉取（限 20 条）',
    /auditLog/.test(routes) && /take:\s*20/.test(routes))
  check('返回 DashboardSummary 形状（kpis/myTodos/teamActivities/generatedAt）',
    /kpis,/.test(routes) && /myTodos,/.test(routes) && /teamActivities,/.test(routes)
    && /generatedAt:\s*now\.getTime\(\)/.test(routes))
  check('VIEWER/PUBLISHER 不暴露 myTodos 与 teamActivities（按 isSelfOnlyView 守卫）',
    /isSelfOnlyView/.test(routes) || /wideView/.test(routes))
}

// ──────────────────────────────────────────────────────────────────
group('K.1.2 RBAC 权限 server/src/modules/rbac/permissions.ts')
// ──────────────────────────────────────────────────────────────────

const rbac = readIfExists('server/src/modules/rbac/permissions.ts')
section('K.1.2 dashboard.view 权限码 + 4 角色覆盖')
check('server/src/modules/rbac/permissions.ts 存在', rbac !== null)
if (rbac) {
  check('PERMISSIONS 列表包含 dashboard.view',
    /PERMISSIONS[\s\S]*?'dashboard\.view'/.test(rbac))
  check('OWNER 隐式包含全部权限（存在 OWNER 分支）',
    /key:\s*'OWNER'/.test(rbac))
  check('OPERATOR 显式包含 dashboard.view',
    /key:\s*'OPERATOR'[\s\S]*?'dashboard\.view'/.test(rbac))
  check('PUBLISHER 显式包含 dashboard.view',
    /key:\s*'PUBLISHER'[\s\S]*?'dashboard\.view'/.test(rbac))
  check('VIEWER 显式包含 dashboard.view',
    /key:\s*'VIEWER'[\s\S]*?'dashboard\.view'/.test(rbac))
}

// ──────────────────────────────────────────────────────────────────
group('K.1.2 服务端注册 server/src/app.ts')
// ──────────────────────────────────────────────────────────────────

const appTs = readIfExists('server/src/app.ts')
section('K.1.2 app.register(dashboardRoutes)')
check('server/src/app.ts 存在', appTs !== null)
if (appTs) {
  check('import dashboardRoutes',
    /import\s*\{[^}]*dashboardRoutes[^}]*\}\s*from\s*['"][^'"]*dashboard\/routes\.js['"]/.test(appTs))
  check('app.register(dashboardRoutes, { prefix: "/api/dashboard" })',
    /app\.register\(\s*dashboardRoutes\s*,\s*\{\s*prefix:\s*['"]\/api\/dashboard['"]/.test(appTs))
}

// ──────────────────────────────────────────────────────────────────
group('K.1.3 前端 API 客户端 src/renderer/serverApi.ts')
// ──────────────────────────────────────────────────────────────────

const serverApi = readIfExists('src/renderer/serverApi.ts')
section('K.1.3 fetchDashboardSummary')
check('src/renderer/serverApi.ts 存在', serverApi !== null)
if (serverApi) {
  check('import type { DashboardSummary }',
    /import\s+type\s*\{[^}]*DashboardSummary[^}]*\}\s*from\s*['"]\.\.\/shared\/dashboard['"]/.test(serverApi))
  check('导出 fetchDashboardSummary 函数',
    /export\s+async\s+function\s+fetchDashboardSummary\s*\(/.test(serverApi))
  check('内部走 apiFetch 调用 /api/dashboard/summary',
    /apiFetch<DashboardSummary>\(\s*['"]\/api\/dashboard\/summary['"]/.test(serverApi))
}

// ──────────────────────────────────────────────────────────────────
group('K.1.4 UI 组件 src/renderer/Dashboard.tsx')
// ──────────────────────────────────────────────────────────────────

const dashboard = readIfExists('src/renderer/Dashboard.tsx')
section('K.1.4 Dashboard.tsx')
check('src/renderer/Dashboard.tsx 存在', dashboard !== null)
if (dashboard) {
  check('export default function Dashboard', /export\s+default\s+function\s+Dashboard\s*\(/.test(dashboard))
  check('导入 fetchDashboardSummary',
    /import\s*\{[^}]*fetchDashboardSummary[^}]*\}\s*from\s*['"][^'"]*serverApi['"]/.test(dashboard))
  check('导入 DashboardSummary 类型',
    /import\s+type\s*\{[^}]*DashboardSummary[^}]*\}\s*from\s*['"]\.\.\/shared\/dashboard['"]/.test(dashboard))
  check('包含 data-testid="dashboard-kpis"', /data-testid="dashboard-kpis"/.test(dashboard))
  check('包含 data-testid="dashboard-my-todos"', /data-testid="dashboard-my-todos"/.test(dashboard))
  check('包含 data-testid="dashboard-team-activities"', /data-testid="dashboard-team-activities"/.test(dashboard))
  check('包含 data-testid={`kpi-${kpi.key}`} 模板',
    /data-testid=\{`kpi-\$\{kpi\.key\}`\}/.test(dashboard))
  check('60s 后台刷新使用 setInterval(60_000)',
    /setInterval[\s\S]{0,80}60_?000/.test(dashboard))
  check('30s tick 使用 setInterval(30_000)',
    /setInterval[\s\S]{0,80}30_?000/.test(dashboard))
  check('状态管理：loading / error / summary / refreshing 状态',
    /useState<.*?loading/.test(dashboard) || /useState\(\s*true\s*\)/.test(dashboard))
}

// ──────────────────────────────────────────────────────────────────
group('K.1.4 UI 样式 src/renderer/dashboard.css')
// ──────────────────────────────────────────────────────────────────

const dashboardCss = readIfExists('src/renderer/dashboard.css')
section('K.1.4 dashboard.css')
check('src/renderer/dashboard.css 存在', dashboardCss !== null)
if (dashboardCss) {
  check('含 .dashboard-page 容器', /\.dashboard-page\s*\{/.test(dashboardCss))
  check('含 .dashboard-kpis 网格', /\.dashboard-kpis\s*\{/.test(dashboardCss))
  check('含 .dashboard-kpi 卡片', /\.dashboard-kpi\s*\{/.test(dashboardCss))
  check('含 .dashboard-grid 双栏', /\.dashboard-grid\s*\{/.test(dashboardCss))
  check('含 .dashboard-todo-list / -item',
    /\.dashboard-todo-list/.test(dashboardCss) && /\.dashboard-todo-item/.test(dashboardCss))
  check('含 .dashboard-activity-list / -item',
    /\.dashboard-activity-list/.test(dashboardCss) && /\.dashboard-activity-item/.test(dashboardCss))
  check('含 .kpi-{todayProducts,pendingReports,failedTasks,aiQuotaUsed,activeMembers,runningSkills} 主题色',
    /\.kpi-todayProducts/.test(dashboardCss) && /\.kpi-pendingReports/.test(dashboardCss)
    && /\.kpi-failedTasks/.test(dashboardCss) && /\.kpi-aiQuotaUsed/.test(dashboardCss)
    && /\.kpi-activeMembers/.test(dashboardCss) && /\.kpi-runningSkills/.test(dashboardCss))
  check('含暗色主题 @media (prefers-color-scheme: dark)',
    /@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)/.test(dashboardCss))
  check('含 .kpi-trend.up/.down/.flat 状态色',
    /\.kpi-trend\.up/.test(dashboardCss) && /\.kpi-trend\.down/.test(dashboardCss) && /\.kpi-trend\.flat/.test(dashboardCss))
  check('含响应式断点（@media max-width）',
    /@media\s*\(\s*max-width/.test(dashboardCss))
}

// ──────────────────────────────────────────────────────────────────
group('K.1.5 导航 src/renderer/App.tsx')
// ──────────────────────────────────────────────────────────────────

const appRenderer = readIfExists('src/renderer/App.tsx')
section('K.1.5 导航 + 默认页 + IIFE 渲染分支')
check('src/renderer/App.tsx 存在', appRenderer !== null)
if (appRenderer) {
  check('import Dashboard from \'./Dashboard\'',
    /import\s+Dashboard\s+from\s+['"]\.\/Dashboard['"]/.test(appRenderer))
  check('AppPage union 包含 \'dashboard\'',
    /type\s+AppPage\s*=[^;]*'dashboard'/.test(appRenderer))
  check('aiModuleNav 含团队工作台入口（dashboard.view 权限）',
    /page:\s*'dashboard'/.test(appRenderer)
    && /label:\s*'团队工作台'/.test(appRenderer)
    && /perm:\s*'dashboard\.view'/.test(appRenderer))
  check('默认页 useState<AppPage>(\'dashboard\')',
    /useState<AppPage>\(\s*'dashboard'\s*\)/.test(appRenderer))
  check('IIFE 内 if(page===\'dashboard\')return <Dashboard/>',
    /if\(page==='dashboard'\)return\s+<Dashboard\/>/.test(appRenderer))
  check('团队工作台是 aiModuleNav 第一个菜单项',
    /aiModuleNav[\s\S]*?page:\s*'dashboard'/.test(appRenderer))
}

// ──────────────────────────────────────────────────────────────────
group('K.1.6 tsc 主+渲染 0 错')
// ──────────────────────────────────────────────────────────────────

section('K.1.6 tsc 双端校验')

const tscRenderer = spawnSync('npx', ['tsc', '--noEmit'], {
  cwd: ROOT,
  encoding: 'utf-8',
  timeout: 180_000,
  stdio: ['ignore', 'pipe', 'pipe']
})
check('tsc --noEmit（渲染端）退出码 0',
  tscRenderer.status === 0,
  tscRenderer.stderr ? tscRenderer.stderr.slice(-200) : tscRenderer.stdout?.slice(-200))

const tscMain = spawnSync('npx', ['tsc', '-p', 'tsconfig.main.json', '--noEmit'], {
  cwd: ROOT,
  encoding: 'utf-8',
  timeout: 180_000,
  stdio: ['ignore', 'pipe', 'pipe']
})
check('tsc -p tsconfig.main.json --noEmit（主进程）退出码 0',
  tscMain.status === 0,
  tscMain.stderr ? tscMain.stderr.slice(-200) : tscMain.stdout?.slice(-200))

// ──────────────────────────────────────────────────────────────────
group('K 阶段验收')
// ──────────────────────────────────────────────────────────────────

console.log('')
console.log('══════════════════════════════════════════════════════════════')
console.log(`  K 阶段守卫：PASS ${pass} / FAIL ${fail}`)
console.log('══════════════════════════════════════════════════════════════')

if (fail > 0) {
  console.log('')
  console.log('  ❌ 失败项：')
  for (const f of failures) console.log('     - ' + f)
  process.exit(1)
}
console.log('  ✅ K 阶段全部通过')
process.exit(0)
