# DeepSeek Harness 能力吸收进 DeepSeek Codex · 设计文档

> 文档版本：v1.0 · 起草时间：2026-08-23

## 1. 概述

### 1.1 背景

砚都跨境桌面应用当前在 **AI 参谋** 页面下并存两个对话类入口：

- **DeepSeek Codex**（`OnlineAdvisorExperience`）：自研 React 对话界面，承载项目分组 / 多模型 / 多权限 / 图片附件 / 消息编辑与分支 / 审批 / 任务持久化 / 记忆与个性化 / 报告导出等完整能力。后端走主进程 `AdvisorRuntime`（1317 行）+ `AppServerClient` 直接转发到中央服务。
- **DeepSeek Harness**（`DeepSeekHarness.tsx` + `DeepSeekHarnessProcessManager`）：本地端口 3080 启动 DeepSeek 官方 CLI 的 `web` 模式，通过 iframe 嵌入官方 Web UI；并配套一个服务端认证网关（`deployment/deepseek-harness-gateway/server.mjs`，8788 端口）+ Docker 容器化的"受限云端执行器"（`deployment/deepseek-harness-runtime/`）做用户隔离。

Harness 的核心价值不在 iframe 入口本身，而在于它背后的**多用户隔离执行链路**：基于 Docker worker 容器的命名卷、只读根目录、cap drop、HMAC 签名会话 cookie、ticket 五分钟过期等机制。Codex 当前**不具备这套隔离能力**。

### 1.2 目标

1. 将 Harness 后端的认证网关 + Docker 隔离 worker + 签名会话能力**吸收进 Codex**，让 Codex 提交的任务也跑在受限 worker 容器里。
2. **删除** DeepSeek Harness 入口、Harness 组件、Harness 本地侧资源、相关 IPC、相关 RBAC 权限。
3. 保留 harness gateway 服务源代码（位置迁入主进程代码同仓），保留服务端 Docker 部署形态不变。
4. Codex 在"无降级"的 force 模式下运行：worker 不可用时整体红字告警，不降级到原 AppServerClient 路径。

### 1.3 非目标

- 不重写 gateway 逻辑为 TypeScript（保留 `.mjs` 纯 ESM）。
- 不下沉 gateway 到用户机器（每台用户机器跑一个 gateway 违反多用户隔离）。
- 不增加「graceful 降级到本地执行」路径（已决策为 force-only）。
- 不动 `AI 参谋` 页面下其他卡片（报告样例库 / 在线参谋卡片本身 / 竞品分析 / 产品定价等）。
- 不动 `AppServerClient` / `SessionStore` / `AttachmentService` / `MultimodalVision` / `PersonalizationStore` / `ApprovalPolicy` —— 它们保留但不再被运行时调用（仅做历史兼容，新代码禁止依赖）。
- 不重命名 Docker 镜像（`yandu/deepseek-harness:0.1.0-rc.7`）—— 单独决策。

## 2. 已确认的关键决策

| # | 决策点 | 选择 | 备注 |
|---|--------|------|------|
| 1 | 融合范围 | Harness 的**认证网关 + Docker 隔离 worker** | 不复用官方 Web UI；不复制本地 CLI web 模式 |
| 2 | 共享子模块位置 | **方案 C**：保留 gateway 服务 + 主进程加轻量代理 | 单一事实源；改动最小 |
| 3 | gateway 与 worker 资产位置 | 迁入 `src/main/advisor/`（**源代码同仓、保留服务端部署**） | 不下沉到用户机器；Dockerfile 仍构建服务端镜像 |
| 4 | vendor/deepseek-harness 处理 | **全部删除**（含 `scripts/build-deepseek-harness.sh`） | 安装包体积立即下降 |
| 5 | 发布策略 | **仅 force 模式**，无 graceful 降级 | `ADVISOR_HARNESS_MODE` 环境变量移除 |
| 6 | DeepSeek Harness 入口 | **删除**（含 AI 参谋页对应卡片） | `AppPage` 中 `'deepseek-harness'` 一并移除 |
| 7 | RBAC 权限 | 删除 `menu.advisor.harness`，复用 `menu.advisor.online` | access-ticket 改由在线参谋权限保护 |

## 3. 架构总览

### 3.1 改造前

```
┌────────────────────┐         ┌────────────────────┐
│   DeepSeek Codex   │         │  DeepSeek Harness  │
│  (OnlineAdvisor)   │         │   (DeepSeekHarness │
│                    │         │      .tsx iframe)  │
└────────┬───────────┘         └─────────┬──────────┘
         │ IPC advisor.*                  │ IPC deepseek-harness:*
         ▼                                ▼
┌────────────────────┐         ┌────────────────────────┐
│   AdvisorRuntime   │         │  DeepSeekHarness       │
│   (1317 行)        │         │  ProcessManager        │
└────────┬───────────┘         │  (本地端口 3080)        │
         │ AppServerClient     └────────────┬───────────┘
         ▼                                  │ iframe
┌────────────────────┐                     │
│  server/src/app.ts │                     ▼
│  (中央服务 8787)   │              ┌──────────────┐
└────────┬───────────┘              │ 官方 CLI web │
         │ /api/deepseek-harness/  │   (vendor)   │
         │   access-ticket         └──────────────┘
         ▼                                  ▲
┌────────────────────────┐                   │
│  harness gateway       │ ←──── 验证 ───────┤
│  (8788)                │                   │
│  + Docker worker       │ ←── 反向代理 ────┘
│  (受限云端执行器)       │
└────────────────────────┘
```

### 3.2 改造后

```
┌──────────────────────────────────────────┐
│         DeepSeek Codex（唯一入口）        │
│         (OnlineAdvisorExperience)         │
└──────────────────┬───────────────────────┘
                   │ IPC advisor.*  (新增 connect/disconnect)
                   ▼
┌──────────────────────────────────────────┐
│            AdvisorRuntime                │
│  ┌────────────────────────────────────┐  │
│  │   HarnessGatewayClient（新）       │  │   ← 主进程内轻量代理
│  │   · connect() / disconnect()       │  │
│  │   · getWorkerOrigin()              │  │
│  │   · getCookieHeader()              │  │
│  └──────────────┬──────────────────────┘  │
└─────────────────┼─────────────────────────┘
                  │ HTTP
   ┌──────────────┼──────────────────────────┐
   ▼              ▼                          │
┌──────────┐  ┌────────────────────────────┐ │
│ 中央服务 │  │  harness gateway (8788)    │ │
│  (8787)  │  │  源代码:                   │ │
│          │  │  src/main/advisor/         │ │
│ · access │  │    gateway/                │ │
│   ticket │  │  服务端部署: 不变          │ │
│ · /api/  │  │                            │ │
│   ...    │  │  + Docker worker (隔离)    │ │
└──────────┘  └────────────┬───────────────┘ │
                           │ 反向代理         │
                           ▼                  │
                ┌────────────────────┐         │
                │  worker 容器       │         │
                │  (受限云端执行器)  │         │
                │  源代码:           │         │
                │  src/main/advisor/ │         │
                │    runtime/        │         │
                └────────────────────┘         │
```

### 3.3 数据流

Codex 提交任务的新链路（force 模式）：

```
1. Codex UI 启动
   window.desktop.advisor.connect()
   → AdvisorRuntime.connectAdvisor()
   → HarnessGatewayClient.connect()
      ├─ GET /api/deepseek-harness/access-ticket   （走中央服务 RBAC）
      │     响应: { ticket }   aud=deepseek-codex
      └─ POST gateway:8788/session
            header: Authorization: Bearer <ticket>
            响应: 204 + Set-Cookie: __Host-yandu_harness=...
            副作用: gateway 创建/启动 worker 容器，缓存 workerOrigin

2. Codex UI 提交任务
   window.desktop.advisor.sendChat({...})
   → AdvisorRuntime.sendChat()
   → 用 workerOrigin 转发到 worker 容器内的执行器
   → 事件流通过 gateway 反向代理回流到 Codex UI

3. 任务进行中 worker 挂掉
   → 业务请求 5xx
   → 当前任务标记 failed（UI 提示「隔离执行中断」）
   → HarnessGatewayClient.connect({ force: true }) 自动重连
   → 连续 3 次失败 → Codex 顶栏持续红字「执行引擎不可用」

4. Codex UI 关闭
   window.desktop.advisor.disconnect()
   → AdvisorRuntime.disconnectAdvisor()
   → HarnessGatewayClient.disconnect()
   → gateway 引用计数 -1；闲置 worker 由 gateway 自身定时器回收
```

## 4. 删除清单

### 4.1 渲染层

| 路径 | 动作 | 备注 |
|------|------|------|
| `src/renderer/DeepSeekHarness.tsx` | **整文件删除** | 整个文件 |
| `src/renderer/App.tsx` L23 | 删除 `import DeepSeekHarness from './DeepSeekHarness'` | |
| `src/renderer/App.tsx` L31 | 从 `AppPage` 联合类型中删除 `'deepseek-harness'` | |
| `src/renderer/App.tsx` L1380 | 删除 `{page==='deepseek-harness'&&<DeepSeekHarness/>}` | |
| `src/renderer/styles.css` L430 | 删除 `.deepseek-harness-page{...}` 整段样式 | 包含 `.deepseek-harness-unavailable` |
| `src/renderer/global.d.ts` | 删除 `deepSeekHarness: DeepSeekHarnessDesktopApi` 相关声明 | |
| `src/renderer/AI 参谋` 页 | 删除"DeepSeek Harness"卡片（截图一红框卡片） | 见 §6.4 |

### 4.2 主进程

| 路径 | 动作 | 备注 |
|------|------|------|
| `src/main/services/DeepSeekHarnessProcessManager.ts` | **整文件删除** | 只服务本地 3080 的官方 CLI web |
| `src/main/main.ts` L28 | 删除 `import { DeepSeekHarnessProcessManager } from './services/DeepSeekHarnessProcessManager'` | |
| `src/main/main.ts` L2838-2843 | 删除 ProcessManager 初始化 + 3 个 IPC handler | |
| `src/main/main.ts` L3030 | 删除 `deepSeekHarnessProcessManager.stop().catch(...)` | |
| `src/main/main.ts` L48 | 检查并删除 `binary=watchSkillVisionOcrPath()` 等仅服务 Harness 的引用 | 若 VisionOcr 仅被 Harness 使用则删除 |

### 4.3 预加载

| 路径 | 动作 | 备注 |
|------|------|------|
| `src/preload/preload.ts` L52-54 | 删除 `status` / `start` / `connect` 三个 IPC 桥接 | |

### 4.4 类型

| 路径 | 动作 | 备注 |
|------|------|------|
| `src/shared/advisor.ts`（或对应） | 删除 `DeepSeekHarnessDesktopApi` 接口 | 若定义在该文件 |
| `src/shared/menuPermissionTree.ts` | 删除 `menu.advisor.harness` 节点 | 完整删除，包括所有子节点 |
| `src/renderer/App.tsx` L31 `AppPage` 联合类型 | 删除 `'deepseek-harness'` | 已在 §4.1 列出 |

### 4.5 资源与脚本

| 路径 | 动作 | 备注 |
|------|------|------|
| `vendor/deepseek-harness/`（整目录） | **删除** | 约 800MB+ 官方 CLI 源码 |
| `scripts/build-deepseek-harness.sh` | **删除** | 用于构建 vendor 目录 |
| `electron-builder.yml` L23-28 | 删除 `extraResources` 中 `vendor/deepseek-harness` 引用 | 见 §10 |

### 4.6 RBAC

| 路径 | 动作 | 备注 |
|------|------|------|
| `server/src/modules/rbac/permissions.ts` L19 | 删除 `'menu.advisor.harness'` | |
| `server/src/modules/rbac/permissions.ts` L65 | 删除 `'menu.advisor.harness': 'AI参谋·DeepSeek Harness'` | |
| `server/src/modules/rbac/permissions.ts` OPERATOR 角色行 | 删除 `'menu.advisor.harness'` 引用 | 同步清理 ADMIN / 其他角色 |
| `server/src/modules/deepseek-harness/routes.ts` | 整体改写（见 §5.1） | 保留文件路径，便于追溯 |

## 5. 保留 + 演进清单

### 5.1 gateway 与 worker 资产迁入 src/main/advisor/

| 旧路径 | 新路径 | 备注 |
|--------|--------|------|
| `deployment/deepseek-harness-gateway/server.mjs` | `src/main/advisor/gateway/server.mjs` | 保留 `.mjs` 纯 ESM，不 TypeScript 化 |
| `deployment/deepseek-harness-gateway/Dockerfile` | `src/main/advisor/gateway/Dockerfile` | 内部 `COPY` 路径同步更新 |
| `deployment/deepseek-harness-runtime/Dockerfile` | `src/main/advisor/runtime/Dockerfile` | |
| `deployment/deepseek-harness-runtime/entrypoint.sh` | `src/main/advisor/runtime/entrypoint.sh` | |
| `deployment/deepseek-harness-runtime/proxy.mjs` | `src/main/advisor/runtime/proxy.mjs` | |

> **部署形态不变**：服务器上仍跑 Docker 容器（8788 gateway + 每用户一个 worker 容器），CI 中 `docker build` 上下文改为新路径。

### 5.2 server 端 access-ticket 简化

`server/src/modules/deepseek-harness/routes.ts` 改写为单一路径：

```ts
// 目标形态
export async function deepSeekHarnessRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  // 签发访问票据，统一 aud=deepseek-codex
  app.get('/access-ticket', {
    preHandler: [app.requirePermission('menu.advisor.online')]  // ← 改用 Codex 权限
  }, async request => {
    const user = request.currentUser
    const ticket = app.jwt.sign({
      sub: user.id,
      org: user.orgId,
      aud: 'deepseek-codex',
      scope: ['harness:web'],
      permission: 'menu.advisor.online'
    }, { expiresIn: '5m' })
    return { ticket, expiresIn: '5m', audience: 'deepseek-codex' }
  })

  // 网关验证票据（仅供私有 Docker 网络内的 gateway 调用）
  app.post('/gateway/validate', {
    preHandler: [app.requirePermission('menu.advisor.online')]
  }, async request => {
    const claim = request.user
    if (
      claim.aud !== 'deepseek-codex' ||
      !claim.scope?.includes('harness:web') ||
      claim.permission !== 'menu.advisor.online'
    ) {
      throw httpError(403, 'FORBIDDEN', '无效的 Codex 访问票据')
    }
    return {
      userId: request.currentUser.id,
      orgId: request.currentUser.orgId,
      expiresAt: new Date(((claim as { exp?: number }).exp ?? 0) * 1000).toISOString()
    }
  })
}
```

> 文件路径仍为 `server/src/modules/deepseek-harness/` —— 这是为了保持与 `server/src/app.ts` 中 `import { deepSeekHarnessRoutes }` 的 import 路径不变（不引发 server 端无关改动）。后续若需要可整体重命名 `advisor` 模块，单独决策。

### 5.3 主进程轻量代理

新增 `src/main/advisor/HarnessGatewayClient.ts`（约 200-300 行）：

```ts
import { app } from 'electron'
import { net, CookieJar } from './gatewayCookie'  // 见 §5.4

export type AdvisorRemoteSession = {
  url: string            // workerOrigin, e.g. http://yandu-dsh-abc123:8080
  message: string         // UI 顶栏显示的连接状态文案
  expiresAt: number       // ticket 过期时间戳（毫秒）
}

export type HarnessConnectOptions = {
  force?: boolean
}

type HarnessEvent = 'unavailable' | 'expired'

export class HarnessGatewayClient {
  private cached: AdvisorRemoteSession | null = null
  private cookieJar: CookieJar | null = null
  private listeners = new Map<HarnessEvent, Set<(err: Error) => void>>()
  private connectPromise: Promise<AdvisorRemoteSession> | null = null
  private renewTimer: NodeJS.Timeout | null = null

  /** 建立 worker 会话；幂等；并发收敛 */
  async connect(opts: HarnessConnectOptions = {}): Promise<AdvisorRemoteSession>
  /** 拿到当前 workerOrigin；未连时抛 ADVISOR_NOT_CONNECTED */
  getWorkerOrigin(): string
  /** 拿签名 cookie header（`__Host-yandu_harness=...`） */
  getCookieHeader(): string
  /** 主动断开，引用计数 -1 */
  async disconnect(): Promise<void>
  /** 订阅事件：unavailable / expired */
  on(event: HarnessEvent, handler: (err: Error) => void): () => void

  // 内部私有方法
  private async fetchAccessTicket(): Promise<string>  // GET /api/deepseek-harness/access-ticket
  private async createGatewaySession(ticket: string): Promise<{ workerOrigin: string; cookie: string }>
  private scheduleRenew(): void  // 提前 30s 自动 connect({force: true})
}
```

关键行为：
- `connect()` 内部串行：先 `GET /api/deepseek-harness/access-ticket`（走中央服务 RBAC）→ 拿到 ticket → `POST gateway:8788/session`（带 Bearer ticket）→ 拿到 204 + `Set-Cookie: __Host-yandu_harness=...` → 解析出 workerOrigin + cookie
- 并发收敛：同一时刻只允许一个 connect 在途，其余等待
- 提前 30s 自动续约：ticket 5 分钟过期，前 4.5 分钟时自动 `connect({ force: true })`
- cookie 与 workerOrigin 缓存在内存中（不持久化到磁盘，避免重启时 stale）

### 5.4 cookie 解析辅助

新增 `src/main/advisor/gatewayCookie.ts`（约 50 行）：

```ts
/** 极简 cookie 解析，仅处理 Set-Cookie 头中的 name=value; Path=/; ... */
export class CookieJar {
  private cookies = new Map<string, string>()
  setFromSetCookieHeader(header: string | string[] | undefined): void
  getCookieHeader(): string  // 返回 "name1=value1; name2=value2"
  clear(): void
}
```

> 选用最小实现而非引入 `tough-cookie` 依赖 —— gateway 仅下发一个 `__Host-yandu_harness` cookie，过期由 ticket 控制。

### 5.5 AdvisorRuntime 改造

`src/main/advisor/AdvisorRuntime.ts` 增加：

```ts
// 顶部 import
import { HarnessGatewayClient, type AdvisorRemoteSession } from './HarnessGatewayClient'

// 类内成员
private harnessClient = new HarnessGatewayClient()

// 新增方法
async connectAdvisor(): Promise<AdvisorRemoteSession> {
  const session = await this.harnessClient.connect()
  this.setupHarnessEventHandlers()
  return session
}

async disconnectAdvisor(): Promise<void> {
  await this.harnessClient.disconnect()
  this.teardownHarnessEventHandlers()
}

private setupHarnessEventHandlers(): void {
  this.harnessClient.on('unavailable', (err) => {
    // 推一条系统消息到 UI 顶栏
    this.broadcastConnectionEvent({ type: 'advisor.unavailable', error: err.message })
  })
  this.harnessClient.on('expired', (err) => {
    this.broadcastConnectionEvent({ type: 'advisor.expired', error: err.message })
  })
}
```

**业务流改造原则**：
- `sendChat` / `steerChat` / `stopChat` / `listSessions` / `readStoredTask` / `renameStoredTask` / `deleteStoredTask` / `exportStoredTask` / `selectStoredBranch` / `resolveApproval` / `cloneImages` / `saveImages` / `removeImage` / `discardImages` / `analyzeImages` / `previewImage` / `selectImages` 全部从 `AppServerClient` 切到 `this.harnessClient.getWorkerOrigin()` + `getCookieHeader()` 转发
- `AppServerClient` 文件保留但**仅供测试与历史回放**（`grep` 验证无运行时引用）
- `getConnectionStatus` IPC 返回值增加 `mode: 'harness' | 'unavailable'` 字段
- `getPersonalization` / `savePersonalization` / `resetMemory` **不动**，仍走 `AppServerClient`（记忆/个性化是中央服务能力，不属于 worker 隔离范围）

### 5.6 IPC 暴露

`src/preload/preload.ts` 与 `src/renderer/global.d.ts` 在 `advisor` API 增：

```ts
advisor: {
  // 现有方法保持不变
  connect(): Promise<AdvisorRemoteSession>      // 新增
  disconnect(): Promise<void>                   // 新增
}
```

## 6. Codex UI 调整

### 6.1 顶部 connection chip

`OnlineAdvisorExperience.tsx` L1029 的 `connection` 状态扩展：

| 状态 | 显示文案 | chip 颜色 |
|------|----------|----------|
| 初始 | 「正在建立隔离执行器…」 | 灰 |
| 就绪 | 「执行引擎：受限隔离已就绪（worker: yandu-dsh-abc123）」 | 绿 |
| 不可用 | 「执行引擎不可用」 | 红 |
| 重连中 | 「执行引擎：重连中（N/3）」 | 橙 |

> worker 容器名仅在就绪时显示；不可用时 chip 只显示静态文案。

### 6.2 composer 上方提示条

`OnlineAdvisorExperience.tsx` 在 `composer` 上方增加条件渲染：

```tsx
{connection.mode === 'unavailable' && (
  <div className="advisor-unavailable-banner" role="alert">
    <strong>执行引擎不可用</strong>
    <span>Codex 任务已暂停；如需使用请联系管理员检查 harness gateway 状态。</span>
  </div>
)}
```

当 chip 处于"不可用"时：
- composer 整体禁用（含图片按钮、权限选择、模型选择、发送按钮）
- 任务历史可看、可打开，但**新建任务按钮 + 提交按钮都禁用**
- 任务进行中遇到 worker 挂掉：当前任务标记 `failed`，不自动提交新任务

### 6.3 connect 调用时机

`OnlineAdvisorExperience.tsx` 在 `useEffect` 初始化钩子（L278）内 `refreshHistory` 之前增加：

```ts
useEffect(() => {
  void window.desktop.advisor.connect()
    .then((session) => setConnection({
      connected: true,
      mode: 'harness',
      label: '执行引擎：受限隔离已就绪',
      detail: `worker: ${extractWorkerName(session.url)}`,
    }))
    .catch((err) => setConnection({
      connected: false,
      mode: 'unavailable',
      label: '执行引擎不可用',
      detail: err instanceof Error ? err.message : 'connect 失败',
    }))
  void window.desktop.advisor.getConnectionStatus().then(setConnection)
  void window.desktop.advisor.getPersonalization().then(setPersonalization)
  void refreshHistory(true)
  // ... 现有事件订阅
}, [])
```

### 6.4 AI 参谋页面卡片调整

`App.tsx` 中 `AI 参谋` 卡片网格删除"DeepSeek Harness"卡片（截图一第 3 个红框卡片）。其它卡片（报告样例库 / 在线参谋 / 竞品分析 / 产品定价 / 类目优选 / 数据复盘 / 产品仓库 / 物流成本）**保持不变**。

> 注：在 `AI 参谋` 网格里，"在线参谋"卡片是 `online-advisor` 入口（即 Codex）；删 Harness 卡片后用户从 AI 参谋进入 Codex 的路径不变。

## 7. 数据契约

### 7.1 类型定义

`src/shared/advisor.ts`（或新建 `src/shared/harness.ts`）：

```ts
export type AdvisorRemoteSession = {
  /** workerOrigin, e.g. http://yandu-dsh-abc123:8080 */
  url: string
  /** UI 显示的连接状态文案 */
  message: string
  /** ticket 过期时间戳（毫秒），UI 据此显示剩余时间 */
  expiresAt: number
}

export type AdvisorConnectionState = {
  connected: boolean
  mode: 'harness' | 'unavailable' | 'reconnecting'
  label: string
  detail: string
}
```

### 7.2 IPC 签名

| Channel | Direction | Request | Response |
|---------|-----------|---------|----------|
| `advisor:connect` | renderer → main | `void` | `AdvisorRemoteSession` |
| `advisor:disconnect` | renderer → main | `void` | `void` |
| `advisor:getConnectionStatus` | renderer → main | `void` | `AdvisorConnectionState`（扩展现有） |
| 现有 `advisor:sendChat` / `:steerChat` / `:stopChat` / `:listSessions` / `:exportSession` / `:resolveApproval` / `:selectBranch` / `:cloneImages` / `:saveImages` / `:removeImage` / `:discardImages` / `:analyzeImages` / `:previewImage` / `:selectImages` | 双向 | （不变） | （不变，内部实现从 AppServerClient 切换到 workerOrigin） |

## 8. 错误处理（force 模式）

### 8.1 错误分类与处理

| 错误源 | HTTP / 现象 | 处理 |
|--------|------------|------|
| `access-ticket` 403 | 用户没有 `menu.advisor.online` 权限 | **不降级**，UI 顶栏红字「执行引擎不可用：当前账号无在线参谋权限」 |
| `access-ticket` 401 | 中央服务 token 失效 | 顶栏红字「执行引擎不可用：登录已过期」 |
| `gateway /session` 502 | gateway 不可用 | 顶栏红字「执行引擎不可用：gateway 离线」 |
| `gateway /session` 401 | ticket 校验失败 | 重试一次（时钟漂移容错），仍失败则红字 |
| worker 启动超时（30s） | 容器未就绪 | 红字 + 主进程日志 `[advisor-harness] worker-boot-timeout` |
| 业务请求 5xx | worker 挂掉 | 当前任务 `failed` + 提示「隔离执行中断」+ 自动 `connect({ force: true })` |
| cookie 过期 | gateway 主动 invalidate | `HarnessGatewayClient` 监听 Set-Cookie 重下发，自动重连 |
| ticket 过期 | 业务请求 401 | `HarnessGatewayClient` 提前 30s 自动重连，UI 无感 |
| 连续 3 次 `connect()` 失败 | gateway 持续不可用 | 顶栏红字持续显示；停止自动重连 60s 后再尝试 |

### 8.2 用户可见行为

- **启动时 connect 失败**：顶栏红字、composer 禁用、新建任务按钮禁用；任务历史可看、可打开
- **运行中 worker 挂掉**：当前任务 failed 并附「隔离执行中断」标记；下一个任务提交时若 worker 已恢复则正常；否则 composer 继续禁用
- **gateway 恢复后**：自动重连成功，chip 立刻变绿，composer 解禁，提示条消失
- **不提供任何降级路径**；不弹 modal 阻塞

### 8.3 主进程日志规范

主进程统一输出：

```
[advisor-harness] connected worker=yandu-dsh-abc123 userId=12345
[advisor-harness] reconnected worker=yandu-dsh-abc123 reason=ticket-renew
[advisor-harness] unavailable reason=gateway-502 retryIn=15000ms
[advisor-harness] worker-boot-timeout name=yandu-dsh-abc123
[advisor-harness] disconnected userId=12345
[advisor-harness] max-retry-exceeded userId=12345 backoff=60000ms
```

## 9. 测试与验收

### 9.1 单元 / 集成测试（Vitest）

| 场景 | 期望 |
|------|------|
| `HarnessGatewayClient.connect()` 首次成功 | 缓存 workerOrigin + cookie，`expiresAt` 正确 |
| `connect()` 二次调用（未过期） | 命中缓存，不重复请求 |
| `connect()` 时缓存已过期 | 走 `force: true` 路径，重连 |
| `access-ticket` 403 | 抛 `ADVISOR_FORBIDDEN`，**不降级** |
| `gateway /session` 502 | 抛 `HARNESS_UNAVAILABLE`，触发 `unavailable` 事件 |
| ticket 过期前 30s | 自动触发重连，UI 无感 |
| `disconnect()` 后再 `sendChat` | 抛 `ADVISOR_NOT_CONNECTED` |
| 多次 `connect()` 并发 | 只发起一次真实请求，其余等待 Promise |
| `CookieJar` 解析多 Set-Cookie 头 | 正确合并所有 cookie |
| `CookieJar.clear()` 后再发请求 | 不再带旧 cookie |

### 9.2 E2E 测试（Playwright + Electron）

> 路径：`tests/e2e/online-advisor-harness.spec.ts`

| # | 场景 | 验收 |
|---|------|------|
| 1 | 有 `menu.advisor.online` 权限的用户进入 Codex | 顶部 chip 绿字「执行引擎：受限隔离已就绪」+ 真实 worker 容器名 |
| 2 | 提交一个简单任务（"列出当前目录"） | 任务在 worker 中执行成功，主进程日志可见 worker 容器名 |
| 3 | 任务进行中 kill worker 容器（`docker stop yandu-dsh-abc123`） | 当前任务 `failed` 提示「隔离执行中断」+ 自动重连 + 下一个任务恢复正常 |
| 4 | 启动时 gateway 不可达 | 顶部 chip 红字「执行引擎不可用」+ composer 禁用 + 任务历史可看但不能新建 |
| 5 | gateway 恢复后 | 60s 内自动重连，chip 变绿，composer 解禁 |
| 6 | 没有 `menu.advisor.online` 权限 | 顶栏红字「执行引擎不可用：当前账号无在线参谋权限」+ 不降级 |
| 7 | ticket 过期自动续约 | 临时改 gateway `expiresIn: '1m'`，观察 30s 时自动重连 |
| 8 | RBAC 拒绝（无 `menu.advisor.online`） | 顶栏红字 + 不允许任何操作 |
| 9 | 主进程启动时 `connect` 失败 → 不影响启动 | Codex 加载但不显示任务提交入口 |
| 10 | AI 参谋页入口只剩 3 个（原 4 个中的 Harness 卡片已删除） | 报告样例库 / 在线参谋 / 竞品分析 |

### 9.3 人工验收清单（上线前）

- [ ] 默认安装包体积对比：删除 `vendor/deepseek-harness/` 后安装包至少减少 600MB
- [ ] 默认 `force` 模式下，Codex 与改造前行为肉眼差异：仅顶部 chip 文案 + 不可用时 composer 禁用
- [ ] Codex 提交报告样例库里的 3 个标准任务，输出与改造前一致（数据、格式、链接、表格均无回归）
- [ ] DeepSeek Harness 入口已**完全不可见**（AI 参谋页无该卡片；侧边栏无该入口；菜单权限无该节点）
- [ ] 系统管理页 → 成员行，`menu.advisor.online` 权限开关可立即影响 Codex 入口可用性
- [ ] 主进程日志新增 `[advisor-harness] connected / reconnected / unavailable / disconnected` 四类事件
- [ ] `.env.example` 增加 `DEEPSEEK_HARNESS_GATEWAY_URL` 注释（gateway 实际地址）

### 9.4 回归保护

- `AdvisorRuntime` 现有方法签名（`sendChat` / `listSessions` / `exportSession` 等）保持不变 → 渲染层核心交互零改动
- `AppServerClient` / `SessionStore` / `AttachmentService` / `MultimodalVision` / `PersonalizationStore` / `ApprovalPolicy` 文件保留但运行时不再调用 → `grep -r 'AppServerClient' src/main/advisor/AdvisorRuntime.ts` 应无业务流引用
- `DeepSeekHarnessProcessManager` 一行不动 → 删干净后 `grep -r 'DeepSeekHarness\|deepseek-harness' src/` 应无残留
- 单元测试覆盖 `HarnessGatewayClient` 与 `CookieJar` 的所有错误路径

## 10. 构建 / 部署影响

### 10.1 electron-builder.yml 变更

```yaml
# 删除 L21-29
# Harness 在主进程中以 Electron 的 Node 模式运行，不能放入 asar；保留官方
# 源码、锁定依赖与 Web 构建结果，以支持已安装桌面应用的离线本机启动。
# extraResources:
#   - from: vendor/deepseek-harness
#     to: deepseek-harness
#     filter:
#       - "**/*"
#       - "!**/.git/**"
```

`extraResources` 整段删除（无其他子项依赖该字段时）。

### 10.2 CI / 部署脚本

- `tools/`、`deployment/`、`scripts/` 中所有引用 `deployment/deepseek-harness-gateway/`、`deployment/deepseek-harness-runtime/`、`vendor/deepseek-harness/` 的路径同步更新到 `src/main/advisor/gateway/`、`src/main/advisor/runtime/`
- 镜像构建上下文 `docker build` 命令路径同步更新
- 主分支 / Tag pipeline 中 `pnpm build:deepseek-harness` 步骤删除

### 10.3 中央服务

- `server/src/app.ts` 中 `import { deepSeekHarnessRoutes }` 不变
- `server/src/modules/deepseek-harness/` 目录保留（文件路径），但内容改写为 §5.2 形式
- 部署在 8787 端口的中央服务**无需重启整个服务**（fastify route 是热加载的；但生产环境建议滚动重启）

### 10.4 镜像构建（server 端）

- `yandu/deepseek-harness:0.1.0-rc.7` worker 镜像名**保留**（避免 worker 容器替换抖动）
- gateway 镜像名**保留**（如需重命名单独决策）
- Dockerfile 中的 `COPY` 路径更新为新源代码位置

## 11. 风险与回滚

### 11.1 主要风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| gateway 持续不可用 | Codex 整面不可用 | SRE 监控 `gateway /health`；连续 3 次 connect 失败后 60s 重连；准备备用 gateway 实例（部署层） |
| worker 容器泄漏 | 服务器磁盘占用 | 保留 gateway 原有的闲置 worker 回收（`HARNESS_IDLE_WORKER_MS=3600000`） |
| Harness iframe 用户已习惯入口 | 切换体验差 | 在 `AI 参谋` 页面顶部加一次性提示条（7 天后移除）说明「Harness 入口已合并进 Codex」 |
| 改造后 `getConnectionStatus` 返回值扩展 | 渲染层 `mode` 字段缺失时崩溃 | 渲染层使用 `connection.mode ?? 'unknown'` 兜底 |
| ticket 续约时钟漂移 | 偶发 401 | 重试一次（已在 §8.1 中处理） |

### 11.2 回滚步骤

若上线后必须回滚：

1. **回滚中央服务**（10 分钟内）
   - `git revert` `server/src/modules/deepseek-harness/routes.ts` 的简化改写
   - 重新部署中央服务
2. **回滚主进程**（30 分钟内）
   - `git revert` 涉及 `HarnessGatewayClient.ts` / `gatewayCookie.ts` / `AdvisorRuntime.ts` / `OnlineAdvisorExperience.tsx` 的 commits
   - 重新打包桌面应用并发布到 OSS
3. **极端回滚**（如 gateway 代码本身出问题）
   - 把 `src/main/advisor/gateway/server.mjs` 还原到 `deployment/deepseek-harness-gateway/server.mjs`
   - 重新 docker build 并部署
   - 桌面应用侧恢复 `DeepSeekHarnessProcessManager` 入口（紧急发布）

> 上述回滚的每一步都对应独立 commit / tag，运维可以按粒度选择回滚深度。

## 12. 实施计划概要

实施将分为以下顺序的子任务（详细 plan 走 `writing-plans` 流程）：

1. **阶段 1：代码删除**
   - 删除 `src/renderer/DeepSeekHarness.tsx`
   - 删除 `src/main/services/DeepSeekHarnessProcessManager.ts`
   - 清理 `App.tsx` / `main.ts` / `preload.ts` / `global.d.ts` / `styles.css` / `electron-builder.yml` 中的 Harness 引用
   - 删除 `vendor/deepseek-harness/` 与 `scripts/build-deepseek-harness.sh`
   - 删除 `menu.advisor.harness` RBAC 节点

2. **阶段 2：gateway 资产迁移**
   - `git mv deployment/deepseek-harness-gateway/ src/main/advisor/gateway/`
   - `git mv deployment/deepseek-harness-runtime/ src/main/advisor/runtime/`
   - 更新 Dockerfile 内部路径
   - 更新 CI / 部署脚本

3. **阶段 3：主进程 HarnessGatewayClient + CookieJar**
   - 新建 `src/main/advisor/gatewayCookie.ts`
   - 新建 `src/main/advisor/HarnessGatewayClient.ts`
   - 单元测试覆盖

4. **阶段 4：AdvisorRuntime 改造**
   - 增加 `connectAdvisor` / `disconnectAdvisor`
   - 业务流从 `AppServerClient` 切换到 workerOrigin
   - IPC `getConnectionStatus` 扩展 `mode` 字段

5. **阶段 5：server 端 access-ticket 简化**
   - 改写 `server/src/modules/deepseek-harness/routes.ts`
   - 移除 `audience` 参数，统一 `aud=deepseek-codex`
   - 权限改为 `menu.advisor.online`

6. **阶段 6：Codex UI 调整**
   - 顶部 connection chip 扩展
   - composer 上方提示条
   - 启动时 `connect` 调用
   - AI 参谋页删除 Harness 卡片

7. **阶段 7：测试与上线**
   - 单元测试
   - E2E 测试
   - 人工验收
   - 灰度发布

---

> 本文档由 brainstorming 流程产出，所有决策点已与用户逐条确认。下一步通过 `writing-plans` 流程生成可执行的实施计划。
