# Linduo 聊天模型选用与全员路由 设计文档

> **For agentic workers:** 这是 M0 (数据 + 权限) + M1 (纯聊天 + UI 选用) 的设计 spec。M2/M3/M4 见文末「后续里程碑」,不在本次实施范围。

**Goal:** 让组织内的用户(由系统管理员按人授权)从「零度API 聚合」模型里选用真实可用的聊天模型,选用结果跟登录用户绑,跨设备同步;选完真能通过 `api000.com/v1/chat/completions` 跑通对话。

**Architecture:** 数据库存 3 张新表(LinduoChatModel 白名单 + UserLinduoGrant 用户授权 + User.preferredLinduoModelId 选用),启动时跟 LinduoModelMallPage 的 `LINDUO_MODELS` 静态目录对账自动同步 27 个 CHAT 模型;主进程新增 `LinduoChatService` 走 OpenAI 协议 SSE 流式,`AdvisorRuntime` 改 `modelProfiles` 合并 Codex + Linduo,新增 `executeLinduoTurn` 分支绕开 Codex app-server;渲染层加 `LinduoModelPickerModal` 弹窗,「设置」齿轮改触发弹窗,黄框下拉合并显示用户有权选的 Linduo 模型。

**Tech Stack:** Prisma + Fastify + Electron IPC + Vite/React + OpenAI Chat Completions API (零度API 代理)。

---

## 1. 现状(必读)

| 关键点 | 现状 |
|---|---|
| Online Advisor 黄框模型 | `DeepSeek V4 Flash` / `DeepSeek V4 Pro` / `OpenAI ChatGPT Latest` 硬编码 3 个(OnlineAdvisorExperience.tsx:132-136) |
| 存储位置 | localStorage `deepseek-codex.preferred-model` — 每渲染进程独立,跨用户/重启不共享 |
| 主进程路由 | `AdvisorRuntime.ts:195-200` `modelProfiles` 数组,`providerId` 是 `deepseek_proxy` / `openai_api`,统一走 Codex app-server stdio RPC |
| 零度API 接入范围 | 只有生图(`LinduoImageService.ts` 149 行),**没有聊天补全桥**;Linduo 37 模型里只 3 个生图接通 |
| 零度API 模型目录 | `LinduoModelMallPage.tsx:52-94` 静态常量 `LINDUO_MODELS`,37 个分 4 厂(OpenAI 14 / Google 10 / Anthropic 10 / Vidu 3) |
| 权限体系 | `Role` + `RolePermission` + `UserRole`,`loadProfile` 拉权限码集合回 `UserProfile.permissions` |
| 零度API Key 管理 | `LlmApiKeysPage.tsx` 零度API 卡片 + `LinduoLoginService` 走 Fastify `/api/linduo/*` |

## 2. 决定清单(本次实施不可变)

| # | 决定 | 说明 |
|---|---|---|
| 1 | 真实路由 Linduo | 选完真能用 |
| 2 | 跟登录用户绑 | `users.preferred_linduo_model_id` 字段;移除 localStorage 持久化 |
| 3 | 弹窗 | 点「设置」齿轮 → 弹 `LinduoModelPickerModal`;不同模型使用能力和价格不一样,管理员按人分配 |
| 4 | 保留黄框下拉 | 下拉做「快速切换 + 显示当前选用」,齿轮做「全量浏览 + 选用持久化」 |
| 5 | 白名单机制 | `linduo_chat_models` 表,初始 27 个 CHAT 能力 enabled;**启动时跟静态 `LINDUO_MODELS` 自动同步**;消失的 modelId 软关(`enabled=false`)保留 grants 历史 |
| 6 | 4 阶段拆分 | M1(纯聊天)→ M2(只读工具)→ M3(完整工具+approval)→ M4(vision) |
| 7 | OWNER 自动 grant | 启动时把 `enabled=true` 的所有 LinduoChatModel 自动 grant 给 OWNER 角色用户;非 OWNER 初始空 |
| 8 | M1 工具/vision 兜底 | Linduo 模型在 M1 范围**不接 tool / vision**,但要有兜底:UI 隐藏附件按钮 + 选 Linduo 模型时禁用工具相关 UI;LinduoChatService **强制不传 `tools` 字段** |

## 3. 数据层 (M0)

### 3.1 新增表

```prisma
model LinduoChatModel {
  id           String   @id @default(cuid())
  modelId      String   @unique @map("model_id")        // e.g. "gpt-4o"
  vendor       String                                    // "openai" / "google" / "anthropic"
  displayName  String   @map("display_name")             // "GPT-4o"
  description  String?
  contextLabel String?  @map("context_label")            // "128K" / "1M"
  /// JSON 数组,如 ["CHAT","VISION"]
  capabilities String   @default("[]")
  /// 推理深度,跟 Codex 字段对齐: low/medium/high/max
  effort       String   @default("medium")
  enabled      Boolean  @default(true)
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")
  grants       UserLinduoGrant[]

  @@map("linduo_chat_models")
}

model UserLinduoGrant {
  userId    String   @map("user_id")
  modelId   String   @map("model_id")
  grantedBy String?  @map("granted_by")
  grantedAt DateTime @default(now()) @map("granted_at")
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  model     LinduoChatModel @relation(fields: [modelId], references: [id], onDelete: Cascade)

  @@id([userId, modelId])
  @@map("user_linduo_grants")
}
```

### 3.2 User 表新增字段

```prisma
model User {
  // ... existing 字段保持不动
  preferredLinduoModelId String?          @map("preferred_linduo_model_id")
  linduoGrants           UserLinduoGrant[]
  // ...
}
```

### 3.3 迁移策略

- 一次性 `prisma migrate dev --name add_linduo_chat_models`
- 迁移**只创建表 + 字段**,不灌数据
- **首次启动**(Electron main 启动钩子)调用 `syncLinduoChatModels()` 同步 27 条
- 同步后再调 `ensureOwnerGrants()` 给所有 `isOwner=true` 用户开全部 enabled 模型的 grant

## 4. 启动同步机制

### 4.1 触发位置

`src/main/main.ts` 在 `linduoLoginService` 初始化之后调:

```typescript
import { syncLinduoChatModels } from './services/linduoChatModelSync'
import { ensureOwnerLinduoGrants } from './services/linduoChatModelSync'

void syncLinduoChatModels().then(() => ensureOwnerLinduoGrants()).catch(console.error)
```

### 4.2 `syncLinduoChatModels()` 算法

**入参**:从 `LinduoModelMallPage.tsx` 把 `LINDUO_MODELS` 抽到共享文件 `src/shared/linduoCatalog.ts`,导出 + `getLinduoChatModels(): LinduoModelEntry[]`(过滤 `capabilities.includes('CHAT')`)

**算法**:
1. `const target = getLinduoChatModels()` — 静态目录的 27 个
2. `const existing = await prisma.linduoChatModel.findMany()` — DB 当前
3. 对每个 target:
   - 不在 existing → `INSERT enabled=true`
   - 在但 displayName/description/contextLabel/capabilities/effort/vendor 不同 → `UPDATE`
4. 对每个 existing:
   - 不在 target → `UPDATE enabled=false`(软关,保留 grants 历史)
5. 不删 grants(软关也不删)

**失败处理**:catch 写 console.error,**不抛**(启动失败影响 Electron 启动就坑了)

### 4.3 `ensureOwnerLinduoGrants()` 算法

1. `const owners = await prisma.user.findMany({ where: { isOwner: true } })`
2. `const enabled = await prisma.linduoChatModel.findMany({ where: { enabled: true } })`
3. 对每个 (owner, model) 组合:`await prisma.userLinduoGrant.upsert({ where: { userId_modelId: {...} }, create: {...}, update: {} })`

**幂等**:`upsert` 多次跑也安全。

## 5. 后端 API (M0 全部实现)

新文件 `server/src/modules/linduo/chat-models-routes.ts`:

| 路径 | 方法 | 权限 | 作用 | 返回 |
|---|---|---|---|---|
| `/api/linduo/chat-models` | GET | 登录 | 当前用户**按 grant 过滤后**的 enabled Linduo 模型 | `LinduoChatModelView[]` |
| `/api/linduo/chat-models/all` | GET | `member.manage` | 全部 LinduoChatModel(含 disabled) | `LinduoChatModelView[]` |
| `/api/linduo/chat-models/:id/enabled` | PATCH | `member.manage` | 切换 enabled | `LinduoChatModelView` |
| `/api/linduo/grants` | GET | `member.manage` | 所有 grant 矩阵 | `UserLinduoGrantView[]` |
| `/api/linduo/grants` | POST | `member.manage` | body: `{ userId, modelId }` | `UserLinduoGrantView` |
| `/api/linduo/grants` | DELETE | `member.manage` | body: `{ userId, modelId }` | `void` |
| `/api/linduo/preferred-model` | GET | 登录 | 当前用户的 preferred_linduo_model_id | `{ modelId: string \| null }` |
| `/api/linduo/preferred-model` | PUT | 登录 | body: `{ modelId: string \| null }`(null = 清空) | `{ modelId: string \| null }` |

**校验**:
- `POST /grants` 时,确认 `modelId` 在 `linduo_chat_models` 表存在
- `PUT /preferred-model` 时,确认当前用户对该 modelId 有 grant(否则 403 `LINDUO_MODEL_NOT_GRANTED`)
- `PUT /preferred-model` 时,如果 `modelId` 是 null,清空 `User.preferredLinduoModelId`
- `DELETE /grants` 时,如果该 grant 是用户当前 `preferredLinduoModelId`,**自动清空 preferred**(防止悬挂)

## 6. 主进程层 (M1 范围)

### 6.1 新文件 `src/main/services/LinduoChatService.ts`

```typescript
class LinduoChatService {
  /**
   * 流式 chat completion,纯文本,不带 tools,不带 vision。
   * 假定零度API 走 OpenAI Chat Completions 协议。
   * 端点: https://api000.com/v1/chat/completions
   */
  async *streamChat(request: {
    modelId: string
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
    signal?: AbortSignal
  }): AsyncGenerator<{ type: 'delta'; text: string } | { type: 'done'; usage: { promptTokens: number; completionTokens: number; totalTokens: number } } | { type: 'error'; message: string }>
}
```

**实现细节**:
- `Authorization: Bearer ${LINDUO_API_KEY}`
- `stream: true`
- **不传 `tools` 字段**(M1 兜底)
- **不传 vision**(M1 兜底:即使 message.content 含图片也忽略,只发文本)
- SSE 解析:每行 `data: {...}`,`[DONE]` 表示结束
- `delta.choices[0].delta.content` 累加成 text
- 错误:`401` → 抛 `LINDUO_KEY_INVALID`;`404` → 抛 `LINDUO_MODEL_NOT_FOUND`(同步调 `setChatModelEnabled(id, false)` 软关)
- 超时:`AbortSignal.timeout(120_000)`
- 主进程单例:启动时检查 `LINDUO_API_KEY`,无 key 抛 `LINDUO_KEY_MISSING`

### 6.2 改 `src/main/advisor/AdvisorRuntime.ts`

**`modelProfiles` 改为动态合并**:

```typescript
// 启动时从 DB 加载
let modelProfiles: ModelProfile[] = [
  { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", providerId: "deepseek_proxy", ... },
  { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", providerId: "deepseek_proxy", ... },
  { id: "chat-latest", name: "OpenAI ChatGPT Latest", providerId: "openai_api", ... }
]

// 新函数(由 main.ts 启动后调)
async function reloadLinduoModels() {
  const rows = await prisma.linduoChatModel.findMany({ where: { enabled: true } })
  const linduoProfiles: ModelProfile[] = rows.map(r => ({
    id: `linduo:${r.modelId}`,            // 命名空间隔离
    name: r.displayName,
    providerId: "linduo_proxy",
    supportsTools: false,                  // M1 兜底
    supportsVision: false,                 // M1 兜底
    effort: r.effort as ModelProfile['effort']
  }))
  modelProfiles = [
    ...staticProfiles,
    ...linduoProfiles
  ]
  allowedModels = new Map(modelProfiles.map(m => [m.id, m]))
}
```

**新增 `executeLinduoTurn()`**:

```typescript
async function executeLinduoTurn(request: ChatRequest, profile: ModelProfile, events: { push: (e: ChatEvent) => void }) {
  // 1. 检查 LINDUO_API_KEY
  // 2. 检查 model 仍 enabled(M1:启动时拉一次,运行中变更不感知,等下次重启)
  // 3. 构造 messages(只取 text,M1 忽略 attachments 里的图片)
  // 4. for await (const chunk of linduoChatService.streamChat({ modelId, messages, signal })):
  //    - delta → events.push({ type: 'linduo_delta', requestId, text })
  //    - done → events.push({ type: 'linduo_done', requestId, usage })
  //    - error → events.push({ type: 'linduo_error', requestId, message })
  // 5. 结束:完成 stored turn,写 usage
}
```

**`executeTurn()` 分支**:

```typescript
if (profile.providerId === "linduo_proxy") {
  await executeLinduoTurn(request, profile, { push: events.push })
} else {
  // 现有 Codex app-server 路径,不动
}
```

**ChatEvent 扩展**(在 `src/shared/advisor.ts`):

```typescript
type ChatEvent =
  | { type: 'codex_*'; ... }   // 现有
  | { type: 'linduo_delta'; requestId: string; text: string }
  | { type: 'linduo_done'; requestId: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }
  | { type: 'linduo_error'; requestId: string; message: string }
```

**保留分支切换自动 fork**:`existingTask.codexThreadId` 切换 provider 时按现有 lines 876-882 逻辑 fork。Linduo 模型的 turn 完成后**不**写 `codexThreadId`(因为没 thread),只在 `SessionStore` 落本地 turn。

### 6.3 IPC 桥(在 `src/main/main.ts` + `src/preload/index.ts`)

新增 8 个 IPC:

| IPC | 入参 | 出参 |
|---|---|---|
| `linduo:list-chat-models` | (none) | `LinduoChatModelView[]`(按 grant 过滤) |
| `linduo:list-all-chat-models` | (none) | `LinduoChatModelView[]`(含 disabled,需 admin) |
| `linduo:set-chat-model-enabled` | `{ id, enabled }` | `LinduoChatModelView` |
| `linduo:list-grants` | (none) | `UserLinduoGrantView[]` |
| `linduo:set-grant` | `{ userId, modelId }` | `UserLinduoGrantView` |
| `linduo:revoke-grant` | `{ userId, modelId }` | `void` |
| `linduo:get-preferred-model` | (none) | `{ modelId: string \| null }` |
| `linduo:set-preferred-model` | `{ modelId: string \| null }` | `{ modelId: string \| null }` |

**全部走 `callWithToken`**(已有 `getTokens` 拿 accessToken)。

## 7. 渲染层 UI (M1 范围)

### 7.1 新文件 `src/renderer/LinduoModelPickerModal.tsx`

**触发**:`OnlineAdvisorExperience.tsx:1769` 「设置」齿轮 onClick 改 `openPersonalization` → `openLinduoModelPicker`

**布局**:
- 模态遮罩(复用现有 `.settings-backdrop` 样式)
- 卡片:左上 ✕ 关闭、标题「大模型选用 · 零度API 聚合」,副标题「按你的权限显示可选模型,选择会同步到所有设备」
- 主体:列表
  - 每行:左 `displayName` + `contextLabel` tag;中 `description` 灰字;右 vendor 色块;选中态打 ✓
  - 点击行 → `linduo:set-preferred-model` → 关弹窗 → 触发 OnlineAdvisorExperience 重读 preferred
- 空状态:「当前账号未分配任何 Linduo 聊天模型,请联系管理员在系统管理页分配」
- 加载态:spinner(走 `linduo:list-chat-models`)
- **样式**:复用 `.settings-backdrop` + 新增 `.linduo-picker-list / .linduo-picker-row`(~50 行 CSS)

### 7.2 改 `OnlineAdvisorExperience.tsx`

**「设置」齿轮**:
- 改 `onClick={openPersonalization}` → `onClick={openLinduoModelPicker}`
- 移除 `openPersonalization` 调用,或保留作为快捷入口(「设置」齿轮改触发 Linduo 选用;个性化通过 composer 顶栏其他入口)— 决策:**本次只改齿轮绑定,personalization 入口仍可从其他 UI 进入**(留后续清理)

**黄框下拉**(`composer-model-picker`):
- 启动时 `void window.desktop.linduo.listChatModels()`,得到当前用户可用的 Linduo 模型
- 合并到 `modelOptions`:
  ```typescript
  const [modelOptions, setModelOptions] = useState<Array<{id: ModelId, name: string, hint: string, isLinduo: boolean}>>([])
  useEffect(() => {
    const codexOptions = [
      { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", hint: "更快", isLinduo: false },
      { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", hint: "更强", isLinduo: false },
      { id: "chat-latest", name: "OpenAI ChatGPT Latest", hint: "ChatGPT", isLinduo: false }
    ]
    void window.desktop.linduo.listChatModels().then(linduo => {
      const linduoOptions = linduo.map(m => ({
        id: `linduo:${m.modelId}`,
        name: `${m.displayName} (经零度API)`,
        hint: m.contextLabel || m.vendor,
        isLinduo: true
      }))
      setModelOptions([...codexOptions, ...linduoOptions])
    })
  }, [])
  ```
- `readPreferredModel` 改为:启动时 `await window.desktop.linduo.getPreferredModel()`,得到 `linduo:gpt-4o` 之类;fallback 到 `deepseek/deepseek-v4-flash`
- `selectPreferredModel` 改为:按 `option.isLinduo` 分流 — 是 Linduo → `linduo:set-preferred-model`;是 Codex → 写 localStorage(保留旧逻辑,因为 Codex 选用不在 M1 范围动)

**附件按钮兜底**:
- 当前 `model` 是 Linduo 模型 → 附件按钮(`.composer-upload`)显示但 `disabled`,hover 提示「Linduo 模型暂不支持视觉,Vision 功能将在 M4 启用」
- `send` 时:`isLinduoModel && attachments.length > 0` → 阻止发送,提示「Linduo 模型暂不支持附件,请移除附件或切换 Codex 模型」

### 7.3 系统管理页(成员行 Linduo 选用分配)

**改 `src/renderer/SystemAdminPage.tsx`**(找具体行号,基于现有成员表格):

- 成员表格新增列「Linduo 选用」
- 每行末尾新增 ⚙ 按钮
- 点 ⚙ → 弹「分配 Linduo 模型」Modal:
  - 标题「为 {name} 分配 Linduo 聊天模型」
  - 复选框列表:`linduo:list-all-chat-models` 返回的 enabled 模型
  - 默认勾上当前已有 grant
  - 保存:遍历 diff,`linduo:set-grant` 增量 + `linduo:revoke-grant` 删除
- Modal 关闭后:成员行「Linduo 选用」列显示「已分配 N 个模型」

**OWNER 隐藏** ⚙ 按钮(OWNER 自动全 grant,不需要手动分配);但显示「全部已开放」灰字。

## 8. 共享类型

### 8.1 `src/shared/linduoCatalog.ts`(新)

把 `LinduoModelMallPage.tsx` 的 `LINDUO_MODELS` 抽出来,主进程 + 渲染层共用:

```typescript
export interface LinduoModelEntry {
  id: string
  name: string
  vendor: 'openai' | 'google' | 'anthropic' | 'vidu'
  capabilities: Array<'IMAGE' | 'VIDEO' | 'CHAT' | 'VISION' | 'EMBEDDING' | 'AUDIO'>
  description: string
  contextLabel?: string
  wiredToImageStudio?: boolean
}

export const LINDUO_MODELS: LinduoModelEntry[] = [/* 37 个,从 LinduoModelMallPage 搬过来 */]

export function getLinduoChatModels(): LinduoModelEntry[] {
  return LINDUO_MODELS.filter(m => m.capabilities.includes('CHAT'))
}
```

**`LinduoModelMallPage.tsx`** 改为 import 共享目录,不再自己声明。

### 8.2 `src/shared/contracts.ts` 新增类型

```typescript
export interface LinduoChatModelView {
  id: string
  modelId: string
  vendor: string
  displayName: string
  description: string | null
  contextLabel: string | null
  capabilities: string[]  // 解析后的数组
  effort: string
  enabled: boolean
}

export interface UserLinduoGrantView {
  userId: string
  modelId: string
  displayName: string
  vendor: string
  grantedBy: string | null
  grantedAt: string
}
```

## 9. 数据流(选用 → 真用)

```
[User] 点「设置」齿轮
  → LinduoModelPickerModal 打开
  → GET /api/linduo/chat-models (按 grant 过滤)
  → [User] 点选 GPT-4o
  → PUT /api/linduo/preferred-model { modelId: "gpt-4o" }
  → 弹窗关闭
  → [Composer] 重读 preferred
  → 黄框显示 "GPT-4o (经零度API)"

[User] 发消息
  → OnlineAdvisorExperience.sendMessage()
  → { model: "linduo:gpt-4o", message, workspacePath, permissionMode }
  → ipcMain 'advisor:send-message' (已有)
  → AdvisorRuntime.executeTurn()
  → profile.providerId === "linduo_proxy" → executeLinduoTurn()
  → LinduoChatService.streamChat({ modelId: "gpt-4o", messages: [{role:'user', content: ...}] })
  → POST https://api000.com/v1/chat/completions
    Headers: Authorization: Bearer ${LINDUO_API_KEY}
    Body: { model: "gpt-4o", messages, stream: true }   // 无 tools
  → SSE 流
  → for await (chunk) events.push({ type: 'linduo_delta', text })
  → [Renderer] OnlineAdvisorExperience.onChatEvent 收到 delta
  → message.assistant 累加 text
  → 流结束 → events.push({ type: 'linduo_done', usage })
  → [Renderer] message 标记 done
  → SessionStore.finishStoredTurn() 落本地
```

## 10. 验收标准 (M1)

1. ✅ `pnpm prisma migrate dev --name add_linduo_chat_models` 应用成功
2. ✅ Electron 启动后,`linduo_chat_models` 表有 27 条 CHAT 模型,全 `enabled=true`
3. ✅ 改 `LINDUO_MODELS` 加 1 个测试模型(临时)→ 重启 → DB 同步出 28 条
4. ✅ 从 `LINDUO_MODELS` 删 1 个 → 重启 → DB 那条 `enabled=false`,grant 保留
5. ✅ OWNER 登录 → `GET /api/linduo/chat-models` 返回 27 条
6. ✅ 非 OWNER 登录 → `GET /api/linduo/chat-models` 返回空
7. ✅ OWNER 选 GPT-4o → 弹窗关 → 黄框显示「GPT-4o (经零度API)」→ 发消息 → 主进程日志显示 `executeLinduoTurn` → 真请求 api000.com
8. ✅ 流式输出在 UI 上增量显示(像 Codex 那样逐字/逐句)
9. ✅ 切 Codex ↔ Linduo → SessionStore 自动 fork 新分支
10. ✅ OWNER 系统管理 → 选非 OWNER → 分配 GPT-4o → 该用户刷新 → 弹窗有 GPT-4o
11. ✅ Linduo 模型 + 附件 → 阻止发送 + 提示「不支持」
12. ✅ Linduo 模型 + 无附件 → 正常发
13. ✅ `pnpm typecheck` + `pnpm build` + `pnpm tsc -p tsconfig.main.json` 全绿
14. ✅ 改 localStorage 旧 `deepseek-codex.preferred-model` 为 `linduo:gpt-4o` → 启动 → 黄框显示 Linduo 模型(向后兼容旧用户偏好,M1 边界 case)

## 11. 后续里程碑(本次不实施)

| 阶段 | 范围 | 实施文件 |
|---|---|---|
| **M2** | 工具只读 | `LinduoChatService` 加 `tools` 参数;白名单 `read_file` / `list_dir` / `grep_content`;Tool execution loop |
| **M3** | 完整工具 + Approval | 工具扩展 `run_command` / `write_file` / `edit_file`;新增 `linduo:approval-request` IPC |
| **M4** | Vision | 多模态模型支持 `image_url`;附件按钮 Linduo 启用;`describeAttachments` 跳过 Linduo 路径 |

## 12. 风险与回退

| 风险 | 应对 |
|---|---|
| api000.com 协议不是 OpenAI 兼容 | M1 跑通后第一时间实测;不兼容则降级 B1(纯文本 prompt,不开 SSE) |
| 启动同步 27 条慢(冷启动) | 一次性 `INSERT ... ON CONFLICT DO UPDATE`,实测应 <500ms |
| 用户启用 Linduo 模型但 API Key 失效 | LinduoChatService 抛 `LINDUO_KEY_INVALID` → UI 弹横幅「请检查 LINDUO_API_KEY」,走现有 settings 入口 |
| 切换 provider 时 fork 失败(同 provider) | 保留 `autoForkedReason` 日志,出错兜底:不 fork,直接新 turn |
| 旧用户偏好 localStorage → 后端迁移(M1 不完整迁移) | M1 接受用户首次手动重选;真正迁移在 M5 写迁移工具 |
| Codex 模型与 Linduo 模型同名冲突 | 用命名空间 `linduo:<modelId>` 隔离,allowedModels key 唯一 |

## 13. 文件清单(M1)

| 类别 | 文件 | 状态 |
|---|---|---|
| Schema | `server/prisma/schema.prisma` | 改 |
| Migration | `server/prisma/migrations/2026XXXXXX_add_linduo_chat_models/` | 新建 |
| 共享 | `src/shared/linduoCatalog.ts` | 新建 |
| 共享 | `src/shared/contracts.ts` | 改 |
| 共享 | `src/shared/advisor.ts` | 改(ChatEvent 扩展) |
| 后端路由 | `server/src/modules/linduo/chat-models-routes.ts` | 新建 |
| 后端注册 | `server/src/app.ts` | 改(register 路由) |
| 同步工具 | `src/main/services/linduoChatModelSync.ts` | 新建 |
| Linduo Chat | `src/main/services/LinduoChatService.ts` | 新建 |
| Advisor 路由 | `src/main/advisor/AdvisorRuntime.ts` | 改 |
| IPC 注册 | `src/main/main.ts` | 改 |
| Preload | `src/preload/index.ts` | 改 |
| 类型 + API | `src/renderer/serverApi.ts` | 改 |
| 渲染层弹窗 | `src/renderer/LinduoModelPickerModal.tsx` | 新建 |
| 渲染层主 | `src/renderer/OnlineAdvisorExperience.tsx` | 改 |
| 系统管理 | `src/renderer/SystemAdminPage.tsx` | 改 |
| 渲染层模型页 | `src/renderer/LinduoModelMallPage.tsx` | 改(import 共享) |
| CSS | `src/renderer/online-advisor-experience.css` + `styles.css` | 改 |

**合计**:~1100 行新增,~400 行改,15 个文件。
