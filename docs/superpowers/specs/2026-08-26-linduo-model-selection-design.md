# Linduo 聊天模型选用(按等级 + 用户例外)设计文档

> **For agentic workers:** 这是 M1 (R-2 修正版) 的设计 spec。R-2 修正的关键变化:grant 粒度从 `userId` 改为 `LinduoModelTier`(预置 basic/advanced/full)+ `UserLinduoException`(用户特例覆盖);设置端入口从"系统管理 → 成员行 ⚙ 按钮"改为"sidebar 齿轮 → 弹 LinduoAssignmentModal(左右双栏穿梭)";使用端从"黄框点开"改为"右下角下拉直接接 Linduo 模型"。M2/M3/M4 不在本次实施范围。

**Goal:** 让组织内用户从「零度API 聚合」模型里选用真实可用的聊天模型,选用按 Linduo 模型等级(基础/进阶/全开)+ 用户特例两层授权;UI 上:sidebar 齿轮 → 弹穿梭 modal 管理分配,OnlineAdvisor 右下角下拉切换模型;选完真能通过 `api000.com/v1/chat/completions` 跑通对话。

**Architecture:** 数据库存 4 张新表(LinduoChatModel 白名单 + LinduoModelTier 预置等级 + LinduoTierGrant 等级→模型 + UserLinduoException 用户特例),加 `User.linduoTierId` 字段;启动时跟 `LINDUO_MODELS` 静态目录对账同步 25 个 CHAT 模型,seed 3 个预置 tier(basic/advanced/full),按用户 `linduoTierId` 计算可用模型;主进程 `LinduoChatService` 走 OpenAI SSE,`AdvisorRuntime` 合并 Codex + Linduo;渲染层 `LinduoAssignmentModal`(齿轮弹)+ `OnlineAdvisorExperience` 右下角下拉接 Linduo。

**Tech Stack:** Prisma + Fastify + Electron IPC + Vite/React + OpenAI Chat Completions API (零度API 代理)。

---

## 1. 现状(必读)

| 关键点 | 现状 |
|---|---|
| Online Advisor 右下角下拉 | `permissionOptions`(请求批准/完全访问)+ `modelOptions`(硬编码 Codex 3 模型,OnlineAdvisorExperience.tsx L155-178) |
| 存储位置 | localStorage `deepseek-codex.preferred-model` + `deepseek-codex.preferred-permission` — 每渲染进程独立 |
| 主进程路由 | `AdvisorRuntime.ts` `modelProfiles` 数组,`providerId` 是 `deepseek_proxy` / `openai_api`,统一走 Codex app-server stdio RPC;M1 已加 `reloadLinduoChatModels` 合并 Linduo |
| 零度API 接入范围 | M1 已加聊天桥(`LinduoChatService` 走 `api000.com/v1/chat/completions` SSE) |
| 零度API 模型目录 | `src/shared/linduoCatalog.ts` 共享,37 个,CHAT 过滤后 25 个(实测 25,不是 spec 原写的 27) |
| 权限体系 | `Role` + `RolePermission` + `UserRole` 多对多,4 个预置 role(OWNER/OPERATOR/PUBLISHER/VIEWER) |
| RBAC 模块权限 | `module.ebay` / `module.compliance` / `module.legacy` / `module.admin` — 决定侧边栏栏目显隐 |
| M1 旧设计 | `UserLinduoGrant(userId+modelId)` 按用户粒度;`ensureOwnerLinduoGrants` 给 OWNER 全开 — **R-2 替换为 tier + exception 模型** |

## 2. 决定清单(本次实施不可变)

| # | 决定 | 说明 |
|---|---|---|
| 1 | **真实路由 Linduo** | 选完真能用 |
| 2 | **跟登录用户绑** | `users.linduo_tier_id` 选 tier + `users.preferred_linduo_model_id` 选 model;移除 localStorage 持久化 |
| 3 | **设置端入口 = sidebar 齿轮** | 点齿轮 → 弹 `LinduoAssignmentModal`(左右双栏穿梭),不再先绕到 system-admin |
| 4 | **使用端入口 = OnlineAdvisor 右下角下拉** | 替换原"完全访问权限 / DeepSeek V4 Flash 更快"那个下拉,显示当前用户可用的 Linduo 模型 |
| 5 | **粒度 = tier 集合 + user 例外** | 每个用户挂在 1 个 LinduoModelTier(基础/进阶/全开)上,tier 关联 N 个 model;用户可在 tier 之上额外加/减 model(UserLinduoException) |
| 6 | **LinduoModelTier 预置 3 个** | `basic`(基础组,默认空) / `advanced`(进阶组,默认 13 个 GPT/Claude 中等) / `full`(全开组,默认 25 个全部);`isSystem=true`,启动时 seed |
| 7 | **OWNER 默认 tier = full** | 用户表的 `linduoTierId` 默认指向 `full`;OWNER 自动拥有全部 25 个;非 OWNER 由 admin 在 modal 里改 tier |
| 8 | **白名单机制** | `linduo_chat_models` 表 25 个 CHAT enabled;启动时跟静态 `LINDUO_MODELS` 自动同步;消失的 modelId 软关(`enabled=false`)保留 grants 历史 |
| 9 | **4 阶段拆分** | M1(纯聊天)→ M2(只读工具)→ M3(完整工具+approval)→ M4(vision) |
| 10 | **M1 工具/vision 兜底** | Linduo 模型在 M1 不接 tool / vision;UI 隐藏附件按钮;LinduoChatService 强制不传 `tools` |

## 3. 数据层

### 3.1 新增表

```prisma
model LinduoChatModel {
  id           String            @id @default(cuid())
  modelId      String            @unique @map("model_id")
  vendor       String
  displayName  String            @map("display_name")
  description  String?
  contextLabel String?           @map("context_label")
  capabilities String            @default("[]")
  effort       String            @default("medium")
  enabled      Boolean           @default(true)
  createdAt    DateTime          @default(now()) @map("created_at")
  updatedAt    DateTime          @updatedAt @map("updated_at")
  tierGrants   LinduoTierGrant[]
  exceptions   UserLinduoException[]

  @@index([vendor])
  @@map("linduo_chat_models")
}

model LinduoModelTier {
  id          String              @id @default(cuid())
  orgId       String              @map("org_id")
  key         String              // 'basic' / 'advanced' / 'full'
  name        String              // '基础组' / '进阶组' / '全开组'
  description String?
  displayOrder Int                @default(0) @map("display_order")
  isSystem    Boolean             @default(false) @map("is_system")
  createdAt   DateTime            @default(now()) @map("created_at")
  updatedAt   DateTime            @updatedAt @map("updated_at")
  org         Organization        @relation(fields: [orgId], references: [id], onDelete: Cascade)
  grants      LinduoTierGrant[]
  users       User[]

  @@unique([orgId, key])
  @@index([orgId])
  @@map("linduo_model_tiers")
}

model LinduoTierGrant {
  tierId   String          @map("tier_id")
  modelId  String          @map("model_id")
  grantedBy String?        @map("granted_by")
  grantedAt DateTime       @default(now()) @map("granted_at")
  tier     LinduoModelTier @relation(fields: [tierId], references: [id], onDelete: Cascade)
  model    LinduoChatModel @relation(fields: [modelId], references: [id], onDelete: Cascade)

  @@id([tierId, modelId])
  @@index([modelId])
  @@map("linduo_tier_grants")
}

model UserLinduoException {
  userId    String          @map("user_id")
  modelId   String          @map("model_id")
  /// 'GRANT' = 在 tier 之上额外开;'REVOKE' = 在 tier 之上关
  kind      String          @default("GRANT")
  grantedBy String?         @map("granted_by")
  grantedAt DateTime        @default(now()) @map("granted_at")
  user      User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  model     LinduoChatModel @relation(fields: [modelId], references: [id], onDelete: Cascade)

  @@id([userId, modelId])
  @@index([modelId])
  @@map("user_linduo_exceptions")
}
```

### 3.2 User 表字段调整

```prisma
model User {
  // ... 现有字段保留
  // preferredLinduoModelId 已存在,保留
  // linduoGrants 字段从 UserLinduoGrant 改名为 UserLinduoException
  preferredLinduoModelId String?              @map("preferred_linduo_model_id")
  linduoTierId           String?              @map("linduo_tier_id")
  linduoTier             LinduoModelTier?     @relation(fields: [linduoTierId], references: [id], onDelete: SetNull)
  linduoExceptions       UserLinduoException[]
  // ...
}
```

**Migration 策略**:
- M1 旧 `UserLinduoGrant` 表改名为 `user_linduo_exceptions`,字段 `kind` 默认 `'GRANT'`
- M1 旧的 `UserLinduoGrant` 数据全部迁移到新 `UserLinduoException`(`kind='GRANT'`)
- 新增 `LinduoModelTier` 表 + 3 个预置 seed(basic/advanced/full)
- 新增 `LinduoTierGrant` 表
- 给 `User.linduoTierId` 加外键
- 旧 `ensureOwnerLinduoGrants` 函数删除(OWNER 由 `tier='full'` 隐式表达)

## 4. 启动同步 + Seed

### 4.1 `syncLinduoChatModels()`(M1 已实现,保留)

- 静态新增 modelId → INSERT enabled=true
- 字段变化 → UPDATE(不动 enabled)
- 缺失 → 软关 enabled=false(保留 grants 历史)

### 4.2 `seedDefaultLinduoTiers()`(新增)

启动时调用,种子 3 个预置 tier(per org):

| key | name | 默认 grants | description |
|---|---|---|---|
| `basic` | 基础组 | (空,admin 后续配) | 仅可使用本组织下放的基础模型 |
| `advanced` | 进阶组 | 默认 grant 13 个(GPT-4o / GPT-4o-mini / GPT-4-Turbo / GPT-3.5-Turbo / Claude 3.5 Sonnet / Claude 3.5 Haiku / Gemini 2.5 Flash / Gemini 1.5 Pro / Gemini 1.5 Flash 等) | 中阶模型,适合日常运营 |
| `full` | 全开组 | 默认 grant 所有 enabled 模型(25 个) | 全模型开放,适合 OWNER / 高权限岗 |

**幂等**:upsert by `(orgId, key)`,多次跑安全。

### 4.3 `assignDefaultTierToNewUser(userId)`(新增)

新注册用户(在 `members/routes.ts` 的 POST 流程)自动分配 `advanced` tier。

### 4.4 `getAvailableModelsForUser(userId)`(新增,核心)

计算公式:
```
1. const tier = await prisma.user.findUnique({ where: { id }, select: { linduoTierId: true } })
2. const tierModels = tier.linduoTierId
     ? await prisma.linduoTierGrant.findMany({ where: { tierId: tier.linduoTierId }, select: { modelId: true } })
     : []
3. const exceptions = await prisma.userLinduoException.findMany({ where: { userId }, select: { modelId: true, kind: true } })
4. const granted = new Set(tierModels.map(t => t.modelId))
5. for (const ex of exceptions) {
     if (ex.kind === 'GRANT') granted.add(ex.modelId)
     else if (ex.kind === 'REVOKE') granted.delete(ex.modelId)
   }
6. return await prisma.linduoChatModel.findMany({
     where: { id: { in: [...granted] }, enabled: true }
   })
```

## 5. 后端 API(R-2 全部新增/替换)

| 路径 | 方法 | 权限 | 作用 | 返回 |
|---|---|---|---|---|
| `/api/linduo/chat-models` | GET | 登录 | 当前用户可用 Linduo 模型(走 `getAvailableModelsForUser`) | `LinduoChatModelView[]` |
| `/api/linduo/chat-models/all` | GET | `member.manage` | 全部 LinduoChatModel(给 modal 用) | `LinduoChatModelView[]` |
| `/api/linduo/chat-models/:id/enabled` | PATCH | `member.manage` | 切换 enabled | `LinduoChatModelView` |
| `/api/linduo/tiers` | GET | `member.manage` | 列出所有 tier | `LinduoModelTierView[]` |
| `/api/linduo/tiers/:id/grants` | GET | `member.manage` | 该 tier 已分配的 model | `LinduoChatModelView[]` |
| `/api/linduo/tiers/:id/grants` | PUT | `member.manage` | body: `{ modelIds: string[] }` 增量设置 | `LinduoChatModelView[]` |
| `/api/linduo/users/:id/tier` | PUT | `member.manage` | body: `{ tierId: string \| null }` 设用户 tier | `{ userId, tierId }` |
| `/api/linduo/users/:id/exceptions` | GET | `member.manage` | 该 user 例外 | `LinduoExceptionView[]` |
| `/api/linduo/users/:id/exceptions` | PUT | `member.manage` | body: `{ exceptions: Array<{ modelId, kind }> }` | `LinduoExceptionView[]` |
| `/api/linduo/preferred-model` | GET | 登录 | 当前用户的 preferred_linduo_model_id | `{ modelId: string \| null }` |
| `/api/linduo/preferred-model` | PUT | 登录 | body: `{ modelId: string \| null }` | `{ modelId: string \| null }` |

**校验**:
- `PUT /tiers/:id/grants` 时,确认 `modelIds` 全部在 `linduo_chat_models` 表存在
- `PUT /users/:id/tier` 时,如果 `tierId` 是 null,清空(用户零授权)
- `PUT /preferred-model` 时,确认当前用户对该 modelId 可用(走 `getAvailableModelsForUser` 校验),否则 403 `LINDUO_MODEL_NOT_GRANTED`
- `PUT /preferred-model` 时,如果 `modelId` 是 null,清空

**M1 旧 API 弃用**:
- `/api/linduo/grants` (user 粒度)→ 用 `/api/linduo/tiers/:id/grants` + `/api/linduo/users/:id/exceptions` 替代
- `linduo:set-grant` / `linduo:revoke-grant` IPC → 删
- `linduo:list-grants` IPC → 删

## 6. 主进程层

### 6.1 `LinduoChatService`(M1 已实现,保留)

SSE 走 `api000.com/v1/chat/completions`,纯文本,无 tools/vision(M1 兜底)。

### 6.2 `AdvisorRuntime`(M1 已实现,保留)

- `reloadLinduoChatModels()` 启动时加载 enabled Linduo 模型,合并到 `modelProfiles`
- `executeLinduoTurn()` 走 Linduo 路径
- `executeTurn()` 按 `profile.providerId === "linduo_proxy"` 分支

### 6.3 IPC 桥(R-2 调整)

**保留**:
- `linduo:list-chat-models` — 改内部实现为 `getAvailableModelsForUser`
- `linduo:list-all-chat-models`
- `linduo:set-chat-model-enabled`
- `linduo:get-preferred-model`
- `linduo:set-preferred-model`

**新增**:
- `linduo:list-tiers` → `GET /api/linduo/tiers`
- `linduo:get-tier-grants` → `GET /api/linduo/tiers/:id/grants`
- `linduo:set-tier-grants` → `PUT /api/linduo/tiers/:id/grants`
- `linduo:set-user-tier` → `PUT /api/linduo/users/:id/tier`
- `linduo:get-user-exceptions` → `GET /api/linduo/users/:id/exceptions`
- `linduo:set-user-exceptions` → `PUT /api/linduo/users/:id/exceptions`

**删除**:
- `linduo:list-grants`
- `linduo:set-grant`
- `linduo:revoke-grant`

## 7. 渲染层 UI

### 7.1 `LinduoAssignmentModal`(新)

**触发**:`App.tsx:1343` 「设置」齿轮 `onClick` 改 `setPage('system-admin')` → `setState({ openLinduoAssignment: true })`

**布局**:
```
┌──────────────────────────────────────────────────────────┐
│  大模型选用 · 零度API 聚合              [✕ 关闭]          │
├──────────────────────────────────────────────────────────┤
│  目标:  [● 基础组  ○ 进阶组  ○ 全开组]                   │
│         描述: 适合日常运营                                │
│                                                          │
│  ┌─可选─────────┐  [→] [←]  ┌─已分配──────┐              │
│  │ GPT-4o       │            │ GPT-4o mini │              │
│  │ Claude 3.5   │            │ Gemini 2.5  │              │
│  │ ...          │            │ ...         │              │
│  └──────────────┘            └─────────────┘              │
│                                                          │
│                            [取消]  [保存]                 │
└──────────────────────────────────────────────────────────┘
```

**字段**:
- 顶部 radio:3 个 tier(basic/advanced/full),点击切换 → 双栏刷新
- 左栏:全部 `enabled=true` 的 LinduoChatModel(按 vendor 分组)
- 右栏:当前 tier 已分配的 model
- 中间 ←/→ 按钮:把选中项在左右栏移动(双向)
- 「全部已开放」标识:如果选中的是 `full` tier,左栏隐藏,只显示右栏(灰色"全部 25 个已开放")
- 保存:PUT `/api/linduo/tiers/:id/grants`,成功后 toast「已保存」

**权限**:OWNER / 有 `member.manage` 权限才看到入口(齿轮对普通用户隐藏,普通用户用「设置」齿轮旁的「我的偏好」入口)

### 7.2 普通用户「我的偏好」入口(R-2 新增)

- sidebar 齿轮下加 ⓘ 「我的偏好」按钮(任何登录用户可点)
- 弹简化版 modal:
  - 标题「我的 Linduo 模型偏好」
  - 副标题「当前等级:{tier.name}」,「由等级分配 + 我的特例」
  - 列表:展示当前用户 `getAvailableModelsForUser(userId)` 的结果(只读)
  - 底部「修改我的特例」按钮 → 弹 `LinduoExceptionModal`(只改自己的特例)

### 7.3 `LinduoExceptionModal`(新)

**触发**:「我的偏好」modal 内「修改我的特例」按钮;SystemAdmin 成员行「Linduo 例外」按钮(admin 帮员工改)

**布局**:
- 顶部:「{userName} 的 Linduo 特例」
- 副标题:「基础等级:{tier.name};这里可以额外开/关模型(优先级高于等级)」
- 双栏穿梭,左:全 enabled 模型;右:当前例外
- 每行:✓(GRANT)/✕(REVOKE)图标
- 保存:PUT `/api/linduo/users/:id/exceptions`

### 7.4 改 `OnlineAdvisorExperience.tsx`

**右下角下拉**(L155-178):
- **原 `permissionOptions`(请求批准/完全访问)+ `modelOptions`(Codex 3 模型)→ 替换为统一的「当前模型」下拉**
- 数据源:`linduo:list-chat-models` 返回的可用 Linduo 模型
- 顶部加一个"Codex 模型"分组(2 个:DeepSeek V4 Flash / DeepSeek V4 Pro),保留旧 Codex 路径兜底
- 默认选项:用户的 `preferredLinduoModelId`,fallback 到 `tier` 第一个 model
- 下拉选项形态:`{ displayName } · { contextLabel } · { vendor }` + 灰字「(经零度API)」

**composer 入口**:
- 「设置」齿轮(左下角)→ 弹 LinduoAssignmentModal(admin)/ LinduoPreferenceModal(普通用户)
- 移除旧的"完全访问权限"位置(被右下角下拉吸收)

**保留**:附件按钮兜底(Linduo 模型禁用附件 + LinduoChatService 不传 tools,M1 规则不变)

### 7.5 改 `SystemAdmin.tsx`

**成员行**:
- 删「Linduo 选用」按钮(逐人勾,已废)
- 新增「Linduo 等级」下拉(下拉 3 个 tier + "无"),修改后 PUT `/api/linduo/users/:id/tier`
- 新增「Linduo 例外」按钮 → 弹 `LinduoExceptionModal`
- OWNER 成员行:「Linduo 等级」下拉禁用 + 灰字「全开组(主帐号)」

**角色管理**:
- 不动(RBAC 跟 Linduo 等级是不同维度,本次不耦合)

## 8. 共享类型

### 8.1 `src/shared/contracts.ts` 新增

```typescript
export interface LinduoChatModelView {
  id: string
  modelId: string
  vendor: string
  displayName: string
  description: string | null
  contextLabel: string | null
  capabilities: string[]
  effort: string
  enabled: boolean
}

export interface LinduoModelTierView {
  id: string
  key: 'basic' | 'advanced' | 'full' | string
  name: string
  description: string | null
  displayOrder: number
  isSystem: boolean
}

export interface LinduoExceptionView {
  userId: string
  modelId: string
  kind: 'GRANT' | 'REVOKE'
  grantedBy: string | null
  grantedAt: string
}
```

## 9. 数据流(选用 → 真用)

```
[Admin] 点 sidebar 齿轮「设置」
  → LinduoAssignmentModal 打开
  → 顶部 radio 默认勾选「全开组」(OWNER)
  → 选「进阶组」 → 左栏 25 个 / 右栏 13 个默认
  → 点 ← 把 GPT-4o 从左移到右
  → 点「保存」 → PUT /api/linduo/tiers/:advancedId/grants { modelIds: [...14] }
  → 后端 upsert LinduoTierGrant 表
  → toast「已保存」

[普通员工] 登录 → OnlineAdvisor 右下角下拉
  → linduo:list-chat-models → getAvailableModelsForUser
  → 返回进阶组 14 个 + 自己的例外
  → 选 GPT-4o → 落 preferredLinduoModelId

[员工] 发消息
  → OnlineAdvisorExperience.sendMessage()
  → { model: "linduo:gpt-4o", message, ... }
  → AdvisorRuntime.executeTurn() → executeLinduoTurn()
  → LinduoChatService.streamChat({ modelId: "gpt-4o", messages })
  → POST api000.com/v1/chat/completions
  → SSE 流 → OnlineAdvisorExperience 渲染
```

## 10. 验收标准(M1 R-2)

1. ✅ `prisma migrate dev` 应用成功(包含重命名 UserLinduoGrant → user_linduo_exceptions + 新增 tier 表)
2. ✅ 启动后 `linduo_model_tiers` 表有 3 条(basic/advanced/full,isSystem=true)
3. ✅ 启动后 `linduo_tier_grants` 表 full tier 有 25 条(全部 CHAT);advanced 默认 13 条;basic 0 条
4. ✅ 现有用户的 `linduo_tier_id` 默认指向 `full`(OWNER) 或 `advanced`(非 OWNER)
5. ✅ OWNER 登录 → `GET /api/linduo/chat-models` 返回 25 条
6. ✅ 非 OWNER 登录 → `GET /api/linduo/chat-models` 返回 advanced 的 13 条
7. ✅ Admin 改 advanced tier → 加 1 个 model → 保存 → 普通员工刷新 → 下拉多 1 个
8. ✅ 普通员工点「我的偏好」→ 修改特例 GRANT 1 个 → 自己下拉立刻多 1 个
9. ✅ Admin 给员工 REVOKE 1 个(tier 有但特例关)→ 员工下拉立刻少 1 个
10. ✅ OWNER 点 sidebar 齿轮 → 弹 LinduoAssignmentModal → 全开组只显示右栏 + 灰字「全部 25 个已开放」
11. ✅ 非 OWNER 点 sidebar 齿轮 → 弹 LinduoPreferenceModal(简化版,只读 + 修改特例)
12. ✅ OnlineAdvisor 右下角下拉显示「GPT-4o (经零度API) · 128K · openai」格式;切换真请求 api000.com
13. ✅ Linduo 模型 + 附件 → 阻止发送 + 提示「不支持」
14. ✅ `pnpm typecheck` + `pnpm build` + `pnpm tsc -p tsconfig.main.json` 全绿
15. ✅ `tsc -p server/tsconfig.json --noEmit` 全绿

## 11. 后续里程碑(本次不实施)

| 阶段 | 范围 |
|---|---|
| **M2** | 工具只读(LinduoChatService 加 `tools`;白名单 `read_file` / `list_dir`) |
| **M3** | 完整工具 + Approval(加 `run_command` / `write_file` / `edit_file`) |
| **M4** | Vision(多模态模型支持 `image_url`) |

## 12. 风险与回退

| 风险 | 应对 |
|---|---|
| 旧 `UserLinduoGrant` 数据迁移出错 | migration 加 `kind='GRANT'` 默认值;老数据全转为 GRANT 例外 |
| OWNER 改 tier 不是 full → 失去全开 | UI 在 OWNER 行禁用 tier 下拉;后端 /tier 接口校验 OWNER 必须保持 full |
| tier 删了但 User.linduoTierId 引用 | `onDelete: SetNull` + `getAvailableModelsForUser` 兜底空 |
| 25 个全开组启动时 25 条 INSERT 慢 | 一次性 `createMany`,实测应 <300ms |
| api000.com 协议不兼容 | M1 已实测通过,继续用;不兼容则降级 B1 |

## 13. 文件清单(R-2)

| 类别 | 文件 | 状态 |
|---|---|---|
| Schema | `server/prisma/schema.prisma` | 改(UserLinduoGrant → UserLinduoException + LinduoModelTier + LinduoTierGrant + User.linduoTierId) |
| Migration | `server/prisma/migrations/2026XXXXXX_linduo_model_tiers/` | 新建 |
| 共享 | `src/shared/contracts.ts` | 改(加 tier / exception 类型) |
| 后端服务 | `server/src/modules/linduo/chat-models-sync.ts` | 改(加 seedDefaultLinduoTiers + assignDefaultTierToNewUser + getAvailableModelsForUser) |
| 后端路由 | `server/src/modules/linduo/chat-models-routes.ts` | 改(替换 user 粒度 grants 为 tier + exception) |
| 后端启动 | `server/src/index.ts` | 改(启动时调 seedDefaultLinduoTiers + 回填历史用户的 linduoTierId) |
| 主进程 IPC | `src/main/main.ts` + `src/preload/index.ts` | 改(替换 grants IPC) |
| Preload | `src/preload/index.ts` | 改(加 6 个新 IPC) |
| 类型 + API | `src/renderer/serverApi.ts` | 改(加新 API wrapper) |
| 渲染层 modal | `src/renderer/LinduoAssignmentModal.tsx` | 新建(齿轮弹,双栏穿梭) |
| 渲染层 modal | `src/renderer/LinduoPreferenceModal.tsx` | 新建(普通用户,只读 + 特例) |
| 渲染层 modal | `src/renderer/LinduoExceptionModal.tsx` | 新建(特例双栏穿梭) |
| 渲染层主 | `src/renderer/OnlineAdvisorExperience.tsx` | 改(右下角下拉接 Linduo) |
| 渲染层 sidebar | `src/renderer/App.tsx` | 改(齿轮触发 modal) |
| 系统管理 | `src/renderer/SystemAdmin.tsx` | 改(成员行加 tier 下拉 + 例外按钮,删旧 Linduo 选用按钮) |
| CSS | `src/renderer/linduoModal.css` + `online-advisor-experience.css` | 改 |

**合计**:~700 行新增,~500 行改,16 个文件。

---

## 14. 与 M1 原 spec 的差异表(供 review 对照)

| M1 原方案 | R-2 方案 | 原因 |
|---|---|---|
| `UserLinduoGrant(userId+modelId)` 逐人 grant | `LinduoModelTier` + `LinduoTierGrant` + `UserLinduoException` | 用户原话"按不同同事等级" |
| OWNER 自动全开(启动时 ensureOwnerLinduoGrants) | OWNER 默认 `tier='full'`(seed 时挂) | 与 RBAC role 概念解耦 |
| 齿轮 → system-admin → 成员行 ⚙ 按钮 | 齿轮 → LinduoAssignmentModal(顶层穿梭) | 用户原话"点齿轮选大模型" |
| 分配 UI 是 checkbox 列表 | 分配 UI 是左右双栏穿梭 | 用户原话"左边选大模型,右边大模型来应用" |
| 使用端在黄框小图标里 | 使用端在右下角下拉 | 用户原话"右边大模型来应用"指右下角 |
| SystemAdmin 成员行"Linduo 选用"按钮(逐人勾) | SystemAdmin 成员行"Linduo 等级"下拉 + "例外"按钮 | tier 化后不需要逐人勾 |
| 初始 27 个 CHAT 模型 | 实际 25 个 CHAT 模型(spec 修正) | 零度API 实际可调通 25 个 |
| §4.2 advanced 默认 13：GPT-4o/4-Turbo/3.5/Claude 3.5/Gemini 1.5 等 | 按 2026-08 新 catalog 重新选型 13：gpt-4o、gpt-4o-mini、gpt-5、gpt-5-mini、gpt-5.4-mini、gpt-5.6-luna、gemini-2.5-flash、gemini-2.5-flash-lite、gemini-3.1-flash、gemini-3.1-flash-lite、claude-haiku-4-5、claude-sonnet-4、claude-sonnet-4-5 | catalog 升级至 37 模型，旧名单大多下架(仅余 3 个) |
| §4.2/§10 full 组 25 条 | 实际 31 条(新 catalog 全部启用 CHAT 模型) | 同上，模型数随 catalog 变化，代码以"全部 enabled"为准 |
| §4.3 新注册用户自动分 advanced | 接线在 members 审核通过 + admin 创建成员两处；注册走待审核流程时不分配 | 注册改为审核制后，"新用户"在审核通过时才生效 |
| §4.2 仅启动时 seed | 启动 seed + 首次注册 bootstrap 后 `ensureOrgDefaultTiers` 双路径 | 覆盖"注册即建组"与"存量组织兜底"两种时序 |
| §10 #10 "sidebar 齿轮" | 实际为顶栏工具条「设置」齿轮按钮(App.tsx) | 现有 sidebar 无齿轮位，统一用顶栏设置入口 |
| §13 seed 逻辑在 chat-models-sync.ts | 实际独立 `tier-seed.ts`(seed/回填) + `tier-resolver.ts`(公式解析) | 职责拆分，chat-models-sync.ts 只留模型同步 + OWNER 例外 fallback |
| — | 交付修复 a052978：全开组首次创建时漏灌 grants(仅 tier 已存在时补缺) | 2026-08-27 中央部署实测发现并修复，新 org 首启全开组曾为 0 授权 |
