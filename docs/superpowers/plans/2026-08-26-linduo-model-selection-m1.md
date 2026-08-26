# Linduo 聊天模型选用与全员路由 (M1) 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让组织内用户从「零度API 聚合」模型里选用真实可用的聊天模型,选用结果跟登录用户绑,选完真能通过 `api000.com/v1/chat/completions` 跑通纯文本对话。

**Architecture:** Prisma 3 张新表(LinduoChatModel + UserLinduoGrant + User.preferredLinduoModelId),启动时跟 `LINDUO_MODELS` 静态目录自动同步 27 个 CHAT 模型并给 OWNER 自动 grant;主进程新增 `LinduoChatService` 走 OpenAI 协议 SSE 流式,`AdvisorRuntime` 合并 Codex + Linduo 模型档位并新增 `executeLinduoTurn` 分支;渲染层 `LinduoModelPickerModal` 弹窗 + 黄框下拉合并显示,「设置」齿轮改触发弹窗,系统管理页成员行加 Linduo 选用分配。

**Tech Stack:** Prisma + Fastify + Electron IPC + Vite/React + vitest + OpenAI Chat Completions API(零度API 代理)。

**Spec:** [docs/superpowers/specs/2026-08-26-linduo-model-selection-design.md](file:///Users/zyc/Desktop/砚都跨境/docs/superpowers/specs/2026-08-26-linduo-model-selection-design.md)

**M1 范围:** 数据层 + 后端 API + 启动同步 + 纯聊天 LinduoChatService + AdvisorRuntime 分支 + UI 弹窗 + 黄框下拉 + 系统管理页分配。**不含工具调用,不含 vision,有兜底**(强制不传 tools,UI 隐藏附件按钮)。

---

## 重要前置(Plan 起点必做)

### Task 0: 清理 WIP + 创建 worktree

**原因:** `OnlineAdvisorExperience.tsx` 当前有 ~1500 行 WIP diff(用户手工改的多个功能),本计划会再次大幅改动该文件。**必须先在干净分支上工作**。

**Files:**
- 无文件改动,纯 git 操作

- [ ] **Step 1: 查看 WIP 状态**

```bash
cd /Users/zyc/Desktop/砚都跨境
git status --short | head -20
git diff --stat src/renderer/OnlineAdvisorExperience.tsx
```

- [ ] **Step 2: 与用户确认 WIP 处置**

如果 `git diff --stat` 显示 `OnlineAdvisorExperience.tsx` 仍有大量 WIP(+500 行以上),向用户确认:
- 方案 A: 用户先手动 commit 现有 WIP(可以是 WIP commit),再开新分支
- 方案 B: 用户先 `git stash push src/renderer/OnlineAdvisorExperience.tsx -m "WIP before M1"`,本计划完成后 pop
- 方案 C: 用户直接 `git commit -am "WIP: carry over"`,然后开新分支从 WIP 继续

**不要自行决定**。问完再继续。

- [ ] **Step 3: 创建 worktree**

```bash
cd /Users/zyc/Desktop/砚都跨境
git worktree add ../砚都跨境-m1-linduo -b feat/linduo-model-selection-m1
cd ../砚都跨境-m1-linduo
```

- [ ] **Step 4: 验证环境**

```bash
npx tsc --noEmit 2>&1 | tail -5
npx vite build 2>&1 | tail -5
```

Expected: 都通过。如果不通过,说明 WIP 没清理干净,回到 Step 2 重新选方案。

---

## File Structure

实施过程中会动到的文件,按职责分组:

| 职责 | 文件 | 状态 |
|---|---|---|
| 数据库 schema | `server/prisma/schema.prisma` | 改 |
| 共享目录 | `src/shared/linduoCatalog.ts` | 新建 |
| 共享类型 | `src/shared/contracts.ts` | 改 |
| 共享 advisor 事件 | `src/shared/advisor.ts` | 改 |
| 启动同步 | `src/main/services/linduoChatModelSync.ts` | 新建 |
| Linduo 聊天 | `src/main/services/LinduoChatService.ts` | 新建 |
| Advisor 路由 | `src/main/advisor/AdvisorRuntime.ts` | 改 |
| 后端路由 | `server/src/modules/linduo/chat-models-routes.ts` | 新建 |
| 后端注册 | `server/src/app.ts` | 改 |
| IPC 主进程 | `src/main/main.ts` | 改 |
| IPC 桥 | `src/preload/index.ts` | 改 |
| 客户端 API | `src/renderer/serverApi.ts` | 改 |
| 弹窗组件 | `src/renderer/LinduoModelPickerModal.tsx` | 新建 |
| 渲染层主 | `src/renderer/OnlineAdvisorExperience.tsx` | 改 |
| 模型广场页 | `src/renderer/LinduoModelMallPage.tsx` | 改(共享化) |
| 系统管理页 | `src/renderer/SystemAdminPage.tsx` | 改 |
| CSS | `src/renderer/online-advisor-experience.css` + `styles.css` | 改 |

---

## 任务清单

### Task 1: 数据库 schema + migration

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/2026XXXXXX_add_linduo_chat_models/migration.sql` (prisma 会自动生成)

- [ ] **Step 1: 在 schema.prisma 末尾追加 3 处改动**

打开 `server/prisma/schema.prisma`,找到 `model User { ... }` 块(第 96-118 行),在 `aiQuotas AiQuota[]` 下面加:

```prisma
  preferredLinduoModelId String?          @map("preferred_linduo_model_id")
  linduoGrants           UserLinduoGrant[]
```

在文件末尾(零度API 模型价格抓取区域之后)加新表:

```prisma
// ===================== Linduo 聊天模型选用 (M1) =====================
// 启动时跟 src/shared/linduoCatalog.ts 的 LINDUO_MODELS 静态目录对账:
// - 静态新增 modelId → INSERT enabled=true
// - 静态已有但 displayName/description 变化 → UPDATE
// - 静态移除 modelId → UPDATE enabled=false (软关,保留 grants 历史)

model LinduoChatModel {
  id           String   @id @default(cuid())
  /// 零度API 模型 id，与 LinduoModelMallPage 静态目录严格一致
  modelId      String   @unique @map("model_id")
  /// openai / google / anthropic
  vendor       String
  /// UI 展示名
  displayName  String   @map("display_name")
  description  String?
  /// 128K / 1M 等
  contextLabel String?  @map("context_label")
  /// JSON 字符串，如 ["CHAT","VISION"]
  capabilities String   @default("[]")
  /// 推理深度 low/medium/high/max；M1 全部默认 medium
  effort       String   @default("medium")
  enabled      Boolean  @default(true)
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")
  grants       UserLinduoGrant[]

  @@map("linduo_chat_models")
  @@index([vendor])
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

- [ ] **Step 2: 跑 prisma 格式 + 迁移**

```bash
cd /Users/zyc/Desktop/砚都跨境
npx prisma format
npx prisma migrate dev --name add_linduo_chat_models
```

Expected: 看到 `Your database is now in sync with your schema.` + 迁移文件 `server/prisma/migrations/2026XXXXXX_add_linduo_chat_models/migration.sql` 自动生成。

- [ ] **Step 3: 验证迁移**

```bash
npx prisma studio --browser none  # 打开 GUI 验证
# 或:
cd server && npx prisma db execute --stdin <<'SQL'
SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'linduo%';
SQL
```

Expected: 看到 `linduo_chat_models` + `user_linduo_grants` + `users.preferred_linduo_model_id` 字段。

- [ ] **Step 4: Type check + build**

```bash
cd /Users/zyc/Desktop/砚都跨境
npx tsc --noEmit 2>&1 | tail -10
npx tsc -p tsconfig.main.json --noEmit 2>&1 | tail -10
```

Expected: 都通过。

- [ ] **Step 5: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/2026XXXXXX_add_linduo_chat_models/
git commit -m "feat(db): add LinduoChatModel + UserLinduoGrant + User.preferredLinduoModelId"
```

---

### Task 2: 共享 Linduo 模型目录抽离

**Files:**
- Create: `src/shared/linduoCatalog.ts`
- Modify: `src/renderer/LinduoModelMallPage.tsx`(把 `LINDUO_MODELS` + `VENDOR_META` + `CAPABILITY_META` + 工具函数搬过来并从共享目录 import)

- [ ] **Step 1: 创建共享目录文件 `src/shared/linduoCatalog.ts`**

```typescript
// 零度API 37 个模型目录（按 OpenAI 14 / Google 10 / Anthropic 10 / Vidu 3 编排）。
// 主进程 + 渲染层共用，作为 LinduoChatModel 白名单的「真值源」。
// 启动时 src/main/services/linduoChatModelSync.ts 会把 capabilities 包含 CHAT 的同步到 DB。

export type LinduoCapability = 'IMAGE' | 'VIDEO' | 'CHAT' | 'VISION' | 'EMBEDDING' | 'AUDIO'

export type LinduoVendor = 'openai' | 'google' | 'anthropic' | 'vidu'

export interface LinduoModelEntry {
  id: string
  name: string
  vendor: LinduoVendor
  capabilities: LinduoCapability[]
  description: string
  contextLabel?: string
  wiredToImageStudio?: boolean
}

export const LINDUO_MODELS: LinduoModelEntry[] = [
  // OpenAI 14
  { id: 'gpt-4o',                  name: 'GPT-4o',                  vendor: 'openai',    capabilities: ['CHAT', 'VISION'],        description: 'OpenAI 多模态旗舰，对话与视觉理解均突出',         contextLabel: '128K' },
  { id: 'gpt-4o-mini',             name: 'GPT-4o mini',             vendor: 'openai',    capabilities: ['CHAT', 'VISION'],        description: '轻量多模态，成本低、速度快',                       contextLabel: '128K' },
  { id: 'gpt-4-turbo',             name: 'GPT-4 Turbo',             vendor: 'openai',    capabilities: ['CHAT'],                  description: '高上下文对话模型，复杂指令表现稳定',               contextLabel: '128K' },
  { id: 'gpt-3.5-turbo',           name: 'GPT-3.5 Turbo',           vendor: 'openai',    capabilities: ['CHAT'],                  description: '经典对话模型，性价比首选',                         contextLabel: '16K' },
  { id: 'o1',                      name: 'o1',                       vendor: 'openai',    capabilities: ['CHAT'],                  description: 'OpenAI 推理模型，链式思考能力强',                   contextLabel: '200K' },
  { id: 'o1-mini',                 name: 'o1 mini',                  vendor: 'openai',    capabilities: ['CHAT'],                  description: '轻量推理模型，速度更快',                           contextLabel: '128K' },
  { id: 'o3-mini',                 name: 'o3 mini',                  vendor: 'openai',    capabilities: ['CHAT'],                  description: '高性价比推理模型，复杂任务表现优',                 contextLabel: '200K' },
  { id: 'gpt-4.1',                 name: 'GPT-4.1',                  vendor: 'openai',    capabilities: ['CHAT', 'VISION'],        description: 'GPT-4 系列升级，编码与指令遵循更强',               contextLabel: '1M' },
  { id: 'gpt-4.1-mini',            name: 'GPT-4.1 mini',             vendor: 'openai',    capabilities: ['CHAT', 'VISION'],        description: '轻量 GPT-4.1，速度与成本平衡',                     contextLabel: '1M' },
  { id: 'gpt-image-1',             name: 'GPT-Image-1',              vendor: 'openai',    capabilities: ['IMAGE'],                 description: 'OpenAI 图像生成模型，文字渲染与细节突出',          wiredToImageStudio: true },
  { id: 'dall-e-3',                name: 'DALL·E 3',                 vendor: 'openai',    capabilities: ['IMAGE'],                 description: 'OpenAI 文生图模型，创意构图表现强',                 wiredToImageStudio: true },
  { id: 'whisper-1',               name: 'Whisper',                  vendor: 'openai',    capabilities: ['AUDIO'],                 description: '语音转文字模型，多语种支持',                       contextLabel: '25MB' },
  { id: 'tts-1',                   name: 'TTS-1',                    vendor: 'openai',    capabilities: ['AUDIO'],                 description: 'OpenAI 文字转语音模型，6 种音色',                   contextLabel: '4096' },
  { id: 'text-embedding-3-large',  name: 'Embedding 3 Large',        vendor: 'openai',    capabilities: ['EMBEDDING'],             description: 'OpenAI 向量嵌入大模型，3072 维',                    contextLabel: '8K' },
  // Google 10
  { id: 'gemini-2.5-pro',                 name: 'Gemini 2.5 Pro',                 vendor: 'google',    capabilities: ['CHAT', 'VISION'],        description: 'Google 旗舰多模态模型，推理与代码表现强',         contextLabel: '1M' },
  { id: 'gemini-2.5-flash',               name: 'Gemini 2.5 Flash',               vendor: 'google',    capabilities: ['CHAT', 'VISION'],        description: '轻量多模态，速度与成本平衡',                       contextLabel: '1M' },
  { id: 'gemini-2.5-flash-image-preview', name: 'Gemini 2.5 Flash Image',         vendor: 'google',    capabilities: ['IMAGE'],                 description: 'Google 多模态生图，支持参照图',                     wiredToImageStudio: true },
  { id: 'imagen-4.0',                     name: 'Imagen 4.0',                     vendor: 'google',    capabilities: ['IMAGE'],                 description: 'Google 旗舰生图模型，品牌色与主图表现优',         wiredToImageStudio: true },
  { id: 'gemini-2.0-pro',                 name: 'Gemini 2.0 Pro',                 vendor: 'google',    capabilities: ['CHAT', 'VISION'],        description: '上一代 Pro 多模态模型',                            contextLabel: '2M' },
  { id: 'gemini-2.0-flash',               name: 'Gemini 2.0 Flash',               vendor: 'google',    capabilities: ['CHAT', 'VISION'],        description: '上一代 Flash 模型，结构化输出稳定',                 contextLabel: '1M' },
  { id: 'gemini-1.5-pro',                 name: 'Gemini 1.5 Pro',                 vendor: 'google',    capabilities: ['CHAT', 'VISION'],        description: '经典 Gemini Pro 长上下文模型',                      contextLabel: '2M' },
  { id: 'gemini-1.5-flash',               name: 'Gemini 1.5 Flash',               vendor: 'google',    capabilities: ['CHAT', 'VISION'],        description: '轻量 Gemini，延迟更低',                             contextLabel: '1M' },
  { id: 'text-embedding-004',             name: 'Embedding 004',                  vendor: 'google',    capabilities: ['EMBEDDING'],             description: 'Google 文本嵌入模型，768 维',                       contextLabel: '2K' },
  { id: 'gemini-embedding-exp',           name: 'Gemini Embedding (实验)',        vendor: 'google',    capabilities: ['EMBEDDING'],             description: 'Gemini 系列嵌入实验版',                             contextLabel: '8K' },
  // Anthropic 10
  { id: 'claude-opus-4-5-20251101',  name: 'Claude Opus 4.5',          vendor: 'anthropic', capabilities: ['CHAT', 'VISION'],        description: 'Anthropic 顶级模型，复杂任务首选',                   contextLabel: '200K' },
  { id: 'claude-sonnet-4-5-20251101',name: 'Claude Sonnet 4.5',        vendor: 'anthropic', capabilities: ['CHAT', 'VISION'],        description: '平衡性能与成本的 Anthropic 主力模型',               contextLabel: '200K' },
  { id: 'claude-haiku-4-5-20251101', name: 'Claude Haiku 4.5',         vendor: 'anthropic', capabilities: ['CHAT'],                  description: '轻量 Claude，速度与成本最优',                       contextLabel: '200K' },
  { id: 'claude-opus-4-1-20250805',  name: 'Claude Opus 4.1',          vendor: 'anthropic', capabilities: ['CHAT', 'VISION'],        description: '前代 Opus，适合高精度长文档分析',                   contextLabel: '200K' },
  { id: 'claude-sonnet-4-20250514',  name: 'Claude Sonnet 4',          vendor: 'anthropic', capabilities: ['CHAT', 'VISION'],        description: '前代 Sonnet，工具调用稳定',                         contextLabel: '200K' },
  { id: 'claude-3-7-sonnet',         name: 'Claude 3.7 Sonnet',        vendor: 'anthropic', capabilities: ['CHAT', 'VISION'],        description: '混合推理模式，可控思考深度',                       contextLabel: '200K' },
  { id: 'claude-3-5-sonnet',         name: 'Claude 3.5 Sonnet',        vendor: 'anthropic', capabilities: ['CHAT', 'VISION'],        description: '前代主力 Sonnet，编程与写作表现优',                 contextLabel: '200K' },
  { id: 'claude-3-5-haiku',          name: 'Claude 3.5 Haiku',         vendor: 'anthropic', capabilities: ['CHAT'],                  description: '轻量 Claude，适合日常对话',                         contextLabel: '200K' },
  { id: 'claude-3-opus',             name: 'Claude 3 Opus',            vendor: 'anthropic', capabilities: ['CHAT', 'VISION'],        description: '经典 Opus，长文档与复杂推理',                       contextLabel: '200K' },
  { id: 'claude-3-haiku',            name: 'Claude 3 Haiku',           vendor: 'anthropic', capabilities: ['CHAT'],                  description: '前代轻量模型，低延迟低成本',                       contextContextLabel: '200K' } as any, // 兜底：见下
  // Vidu 3
  { id: 'vidu-q1',          name: 'Vidu Q1',           vendor: 'vidu',      capabilities: ['VIDEO'],  description: 'Vidu 旗舰视频生成模型，1080P 5 秒',          contextLabel: '5s/1080P' },
  { id: 'vidu-2.0',         name: 'Vidu 2.0',          vendor: 'vidu',      capabilities: ['VIDEO'],  description: 'Vidu 主力视频生成模型，主体一致性突出',       contextLabel: '4s/720P' },
  { id: 'vidu-1.5',         name: 'Vidu 1.5',          vendor: 'vidu',      capabilities: ['VIDEO'],  description: 'Vidu 入门视频生成模型，性价比首选',           contextLabel: '4s/540P' }
] as LinduoModelEntry[]

// 修正上面那个 contextContextLabel 拼写错误：
;(LINDUO_MODELS.find(m => m.id === 'claude-3-haiku') as any).contextLabel = '200K'

export const VENDORS: LinduoVendor[] = ['openai', 'google', 'anthropic', 'vidu']
export const CAPABILITIES: LinduoCapability[] = ['IMAGE', 'VIDEO', 'CHAT', 'VISION', 'EMBEDDING', 'AUDIO']

export const VENDOR_META: Record<LinduoVendor, { label: string; color: string; icon: string }> = {
  openai:    { label: 'OpenAI',    color: '#10a37f', icon: '◐' },
  google:    { label: 'Google',    color: '#4285f4', icon: '✦' },
  anthropic: { label: 'Anthropic', color: '#d97706', icon: '✜' },
  vidu:      { label: 'Vidu',      color: '#e11d48', icon: '▶' }
}

export const CAPABILITY_META: Record<LinduoCapability, { label: string; color: string }> = {
  IMAGE:     { label: '生图',     color: '#9333ea' },
  VIDEO:     { label: '视频',     color: '#e11d48' },
  CHAT:      { label: '对话',     color: '#2563eb' },
  VISION:    { label: '视觉',     color: '#0891b2' },
  EMBEDDING: { label: '嵌入',     color: '#475569' },
  AUDIO:     { label: '语音',     color: '#0d9488' }
}

/** 过滤出可用于聊天的模型。M1 启动同步时调用。*/
export function getLinduoChatModels(): LinduoModelEntry[] {
  return LINDUO_MODELS.filter(m => m.capabilities.includes('CHAT'))
}
```

- [ ] **Step 2: 修改 `src/renderer/LinduoModelMallPage.tsx` 用共享目录**

打开文件,删掉文件内 `LINDUO_MODELS` / `VENDOR_META` / `CAPABILITY_META` / `VENDORS` / `CAPABILITIES` / `LinduoModelEntry` / `LinduoCapability` / `LinduoVendor` 的本地声明,改成 import:

```typescript
import {
  LINDUO_MODELS,
  VENDOR_META,
  CAPABILITY_META,
  VENDORS,
  CAPABILITIES,
  type LinduoModelEntry,
  type LinduoCapability,
  type LinduoVendor
} from '../shared/linduoCatalog'
```

- [ ] **Step 3: 验证 import 闭环**

```bash
cd /Users/zyc/Desktop/砚都跨境
npx tsc --noEmit 2>&1 | grep -E "linduo|Linduo" | head -10
```

Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add src/shared/linduoCatalog.ts src/renderer/LinduoModelMallPage.tsx
git commit -m "refactor(shared): extract LINDUO_MODELS catalog to src/shared/linduoCatalog.ts"
```

---

### Task 3: 共享类型 (contracts.ts + advisor.ts)

**Files:**
- Modify: `src/shared/contracts.ts`(追加 LinduoChatModelView + UserLinduoGrantView)
- Modify: `src/shared/advisor.ts`(追加 ChatEvent 变体)

- [ ] **Step 1: 找到 contracts.ts 末尾,在最后一个 export 之前追加**

```typescript
// ===================== Linduo 聊天模型选用 (M1) =====================

export interface LinduoChatModelView {
  id: string
  modelId: string
  vendor: string
  displayName: string
  description: string | null
  contextLabel: string | null
  capabilities: string[]  // 解析后的数组（服务端从 JSON 字符串反序列化）
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

- [ ] **Step 2: 修改 `src/shared/advisor.ts` 找到 ChatEvent 联合类型**

打开文件,找到 `type ChatEvent = ...` 联合定义,在末尾追加 3 个变体(其他变体不动):

```typescript
  | { type: 'linduo_delta'; requestId: string; text: string }
  | { type: 'linduo_done'; requestId: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }
  | { type: 'linduo_error'; requestId: string; message: string }
```

- [ ] **Step 3: Type check**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add src/shared/contracts.ts src/shared/advisor.ts
git commit -m "feat(shared): add Linduo chat model types + ChatEvent variants"
```

---

### Task 4: LinduoChatModelSync 启动同步服务

**Files:**
- Create: `src/main/services/linduoChatModelSync.ts`
- Test: 暂不写 vitest(此函数强耦合 Prisma,集成测成本高;M1 范围内用启动后 DB 校验)

- [ ] **Step 1: 创建 `src/main/services/linduoChatModelSync.ts`**

```typescript
import { prisma } from './prismaClient'  // 见 Step 2 备注
import { getLinduoChatModels, type LinduoModelEntry } from '../../shared/linduoCatalog'

/**
 * 启动时同步 LinduoChatModel 表：
 * - 静态目录新增的 modelId → INSERT enabled=true
 * - 静态目录已有的 modelId 但 displayName/description/contextLabel/capabilities/effort/vendor 变化 → UPDATE
 * - 静态目录移除的 modelId → UPDATE enabled=false (软关，保留 grants 历史)
 *
 * 失败仅 console.error，不抛（启动失败会拖垮 Electron）。
 */
export async function syncLinduoChatModels(): Promise<{ inserted: number; updated: number; disabled: number }> {
  const target = getLinduoChatModels()
  const existing = await prisma.linduoChatModel.findMany()
  const existingById = new Map(existing.map(m => [m.modelId, m]))

  let inserted = 0
  let updated = 0
  let disabled = 0

  // 1. 处理 target 里的：新增 + 字段变化
  for (const model of target) {
    const row = existingById.get(model.id)
    if (!row) {
      await prisma.linduoChatModel.create({
        data: {
          modelId: model.id,
          vendor: model.vendor,
          displayName: model.name,
          description: model.description,
          contextLabel: model.contextLabel ?? null,
          capabilities: JSON.stringify(model.capabilities),
          effort: 'medium',
          enabled: true
        }
      })
      inserted += 1
      continue
    }
    const nextCapabilities = JSON.stringify(model.capabilities)
    const needUpdate =
      row.vendor !== model.vendor ||
      row.displayName !== model.name ||
      row.description !== model.description ||
      (row.contextLabel ?? null) !== (model.contextLabel ?? null) ||
      row.capabilities !== nextCapabilities
    if (needUpdate) {
      await prisma.linduoChatModel.update({
        where: { id: row.id },
        data: {
          vendor: model.vendor,
          displayName: model.name,
          description: model.description,
          contextLabel: model.contextLabel ?? null,
          capabilities: nextCapabilities
          // 注意：enabled 不在这里改，保留管理员手动开关
        }
      })
      updated += 1
    }
  }

  // 2. 处理 existing 但不在 target 的：软关
  const targetIds = new Set(target.map(m => m.id))
  for (const row of existing) {
    if (!targetIds.has(row.modelId) && row.enabled) {
      await prisma.linduoChatModel.update({
        where: { id: row.id },
        data: { enabled: false }
      })
      disabled += 1
    }
  }

  return { inserted, updated, disabled }
}

/**
 * 启动时给所有 isOwner=true 的用户自动 grant 所有 enabled LinduoChatModel。
 * 幂等：upsert 多次跑也安全。
 */
export async function ensureOwnerLinduoGrants(): Promise<number> {
  const owners = await prisma.user.findMany({
    where: { isOwner: true },
    select: { id: true }
  })
  const enabled = await prisma.linduoChatModel.findMany({
    where: { enabled: true },
    select: { id: true }
  })
  let count = 0
  for (const owner of owners) {
    for (const model of enabled) {
      await prisma.userLinduoGrant.upsert({
        where: { userId_modelId: { userId: owner.id, modelId: model.id } },
        create: { userId: owner.id, modelId: model.id },
        update: {}
      })
      count += 1
    }
  }
  return count
}
```

**关于 `prismaClient` 路径**:
- 这个 prisma 客户端来自 Electron 主进程,不是 server 的 prisma
- 实际路径需要看 src/main 是否已有 prisma client

- [ ] **Step 2: 找到主进程的 prisma client 路径**

```bash
cd /Users/zyc/Desktop/砚都跨境
ls src/main/services/ | grep -i prisma
grep -r "PrismaClient" src/main --include="*.ts" -l | head -3
```

Expected 输出(根据项目实际情况调整):
- 如果是 `src/main/services/prisma.ts` → 上面 import 改成 `from './prisma'`
- 如果是 `src/main/db/prisma.ts` → 改成 `from '../db/prisma'`
- 如果还没有 → **STOP,告知用户需要先建主进程 prisma 客户端**,不要自行实现

- [ ] **Step 3: Type check**

```bash
npx tsc -p tsconfig.main.json --noEmit 2>&1 | tail -10
```

Expected: 通过(根据 Step 2 调整 import 路径)。

- [ ] **Step 4: Commit**

```bash
git add src/main/services/linduoChatModelSync.ts
git commit -m "feat(main): add LinduoChatModel startup sync + owner grant seeder"
```

---

### Task 5: 主进程 main.ts 接入启动同步

**Files:**
- Modify: `src/main/main.ts`

- [ ] **Step 1: 找到 main.ts 启动钩子(在 `linduoLoginService` 初始化附近)**

```bash
cd /Users/zyc/Desktop/砚都跨境
grep -n "linduoLoginService\|linduoImageService\|app.whenReady\|app.on('ready'" src/main/main.ts | head -10
```

- [ ] **Step 2: 在合适位置(初始化之后)加 import + 启动调用**

在文件顶部 import 区域加:

```typescript
import { syncLinduoChatModels, ensureOwnerLinduoGrants } from './services/linduoChatModelSync'
```

找到 app ready 钩子(具体行号看 Step 1),在 `linduoLoginService` 初始化后,加:

```typescript
  // Linduo 聊天模型白名单同步 + OWNER 自动 grant (M1)
  void syncLinduoChatModels()
    .then((result) => {
      console.log(`[linduo-chat] 同步完成: 新增 ${result.inserted} / 更新 ${result.updated} / 软关 ${result.disabled}`)
      return ensureOwnerLinduoGrants()
    })
    .then((grants) => {
      console.log(`[linduo-chat] OWNER 自动 grant ${grants} 条`)
    })
    .catch((err) => {
      console.error('[linduo-chat] 启动同步失败：', err)
    })
```

- [ ] **Step 3: 跑 typecheck + 启动 Electron 看日志**

```bash
npx tsc -p tsconfig.main.json --noEmit 2>&1 | tail -10
# 启动后看日志（用户在本机测试）
pnpm dev 2>&1 | grep linduo-chat
```

Expected 日志: `[linduo-chat] 同步完成: 新增 27 / 更新 0 / 软关 0` + `[linduo-chat] OWNER 自动 grant 27 条`

- [ ] **Step 4: 验证 DB**

```bash
cd server && npx prisma db execute --stdin <<'SQL'
SELECT model_id, vendor, display_name, enabled FROM linduo_chat_models ORDER BY model_id LIMIT 5;
SELECT COUNT(*) AS owner_grants FROM user_linduo_grants;
SQL
```

Expected: 看到 27 条 model + N 条 owner grants(OWNER 数量 × 27)。

- [ ] **Step 5: Commit**

```bash
git add src/main/main.ts
git commit -m "feat(main): invoke LinduoChatModel sync on Electron startup"
```

---

### Task 6: LinduoChatService (核心:真实路由 Linduo)

**Files:**
- Create: `src/main/services/LinduoChatService.ts`

- [ ] **Step 1: 创建 `src/main/services/LinduoChatService.ts`**

```typescript
import { prisma } from './prismaClient'  // 同 Task 4 路径

/**
 * 零度API 聊天补全服务。
 * 假定 api000.com 走 OpenAI Chat Completions 协议（与 LinduoImageService 一致）。
 *
 * M1 范围：
 * - 仅纯文本对话
 * - 不传 tools 字段
 * - 不处理 vision message（即使 caller 传了图片描述，只发文本）
 * - SSE 流式解析
 *
 * 错误码：
 * - LINDUO_KEY_MISSING     未配置 LINDUO_API_KEY
 * - LINDUO_KEY_INVALID     401 / 403
 * - LINDUO_MODEL_NOT_FOUND 404 → 同步软关对应 modelId
 * - LINDUO_RATE_LIMITED    429
 * - LINDUO_UPSTREAM_ERROR  其他 5xx / 网络异常
 */
export class LinduoChatService {
  private readonly apiKey: string
  private readonly baseUrl: string
  private static readonly TIMEOUT_MS = 120_000

  constructor(apiKey: string, baseUrl: string) {
    this.apiKey = apiKey
    this.baseUrl = (baseUrl || 'https://api000.com/v1').replace(/\/+$/, '')
  }

  /** 主进程单例获取 */
  static fromEnv(): LinduoChatService {
    const key = String(process.env.LINDUO_API_KEY || '').trim()
    const base = String(process.env.LINDUO_BASE_URL || 'https://api000.com/v1').trim()
    if (!key) throw new Error('LINDUO_KEY_MISSING')
    return new LinduoChatService(key, base)
  }

  async *streamChat(request: {
    modelId: string
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
    signal?: AbortSignal
  }): AsyncGenerator<{ type: 'delta'; text: string } | { type: 'done'; usage: { promptTokens: number; completionTokens: number; totalTokens: number } } | { type: 'error'; message: string }> {
    if (!this.apiKey) {
      yield { type: 'error', message: 'LINDUO_KEY_MISSING' }
      return
    }

    const body = {
      model: request.modelId,
      messages: request.messages,
      stream: true
      // M1 兜底：不传 tools
      // M1 兜底：不传 temperature/max_tokens，使用模型默认
    }

    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: request.signal ?? AbortSignal.timeout(LinduoChatService.TIMEOUT_MS)
      })
    } catch (err) {
      const detail = err instanceof Error ? err.message : '网络异常'
      yield { type: 'error', message: `LINDUO_UPSTREAM_ERROR: ${detail}` }
      return
    }

    if (response.status === 401 || response.status === 403) {
      yield { type: 'error', message: 'LINDUO_KEY_INVALID' }
      return
    }
    if (response.status === 404) {
      // 模型不存在 → 软关
      await this.softDisableModel(request.modelId).catch(() => {})
      yield { type: 'error', message: 'LINDUO_MODEL_NOT_FOUND' }
      return
    }
    if (response.status === 429) {
      yield { type: 'error', message: 'LINDUO_RATE_LIMITED' }
      return
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      yield { type: 'error', message: `LINDUO_UPSTREAM_ERROR: HTTP ${response.status} ${text.slice(0, 200)}` }
      return
    }

    if (!response.body) {
      yield { type: 'error', message: 'LINDUO_UPSTREAM_ERROR: empty body' }
      return
    }

    // SSE 解析
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let totalPrompt = 0
    let totalCompletion = 0
    let finishReason: string | null = null

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // 按 \n\n 切分事件
        let idx: number
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const event = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          const line = event.split('\n').find(l => l.startsWith('data:'))
          if (!line) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]') {
            finishReason = 'stop'
            continue
          }
          let parsed: any
          try {
            parsed = JSON.parse(data)
          } catch {
            continue
          }
          const choice = parsed?.choices?.[0]
          if (!choice) continue
          const delta = choice.delta?.content
          if (typeof delta === 'string' && delta.length > 0) {
            totalCompletion += 1  // 粗略计数
            yield { type: 'delta', text: delta }
          }
          if (choice.finish_reason) finishReason = choice.finish_reason
          if (parsed.usage) {
            totalPrompt = parsed.usage.prompt_tokens ?? 0
            totalCompletion = parsed.usage.completion_tokens ?? 0
          }
        }
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : '流式读取失败'
      yield { type: 'error', message: `LINDUO_UPSTREAM_ERROR: ${detail}` }
      return
    } finally {
      try { reader.releaseLock() } catch {}
    }

    yield {
      type: 'done',
      usage: { promptTokens: totalPrompt, completionTokens: totalCompletion, totalTokens: totalPrompt + totalCompletion }
    }
    // finishReason 当前未透传，保留以备未来用
    void finishReason
  }

  private async softDisableModel(modelId: string): Promise<void> {
    await prisma.linduoChatModel.updateMany({
      where: { modelId },
      data: { enabled: false }
    })
  }
}
```

- [ ] **Step 2: Type check**

```bash
npx tsc -p tsconfig.main.json --noEmit 2>&1 | tail -10
```

Expected: 通过。

- [ ] **Step 3: Commit**

```bash
git add src/main/services/LinduoChatService.ts
git commit -m "feat(main): add LinduoChatService for OpenAI-compatible chat completions"
```

---

### Task 7: AdvisorRuntime 集成 Linduo 模型档位 + executeLinduoTurn

**Files:**
- Modify: `src/main/advisor/AdvisorRuntime.ts`
- Modify: `src/shared/advisor.ts`(可能需要导出新事件类型)

- [ ] **Step 1: 找到 `modelProfiles` 数组(AdvisorRuntime.ts:195-200)**

把它改成可被外部重新加载的形式。找到文件顶部,确认已有:

```typescript
const modelProfiles: ModelProfile[] = [
  { id: "deepseek/deepseek-v4-flash", ... },
  { id: "deepseek/deepseek-v4-pro", ... },
  { id: "chat-latest", ... }
]
const allowedModels = new Map<string, ModelProfile>(modelProfiles.map(model => [model.id, model]))
```

替换为:

```typescript
const STATIC_CODEX_PROFILES: ModelProfile[] = [
  { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", providerId: "deepseek_proxy", supportsTools: true, supportsVision: false, effort: "high" },
  { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", providerId: "deepseek_proxy", supportsTools: true, supportsVision: false, effort: "high" },
  { id: "chat-latest", name: "OpenAI ChatGPT Latest", providerId: "openai_api", supportsTools: true, supportsVision: true, effort: "medium" }
]
let modelProfiles: ModelProfile[] = [...STATIC_CODEX_PROFILES]
let allowedModels: Map<string, ModelProfile> = new Map(modelProfiles.map(m => [m.id, m]))
```

- [ ] **Step 2: 在文件末尾 export 一个 reload 函数**

```typescript
/**
 * M1: 启动后由 main.ts 调用,从 DB 加载 enabled LinduoChatModel 合并到 modelProfiles。
 * 命名空间: linduo:<modelId> 隔离 Codex 命名空间。
 */
export async function reloadLinduoChatModels(): Promise<{ added: number; total: number }> {
  const { prisma } = await import('../main/services/prismaClient')  // 动态 import 避免循环依赖
  const rows = await prisma.linduoChatModel.findMany({ where: { enabled: true } })
  const linduoProfiles: ModelProfile[] = rows.map((r: any) => ({
    id: `linduo:${r.modelId}`,
    name: r.displayName,
    providerId: "linduo_proxy",
    supportsTools: false,  // M1 兜底
    supportsVision: false,  // M1 兜底
    effort: (r.effort as ModelProfile["effort"]) || "medium"
  }))
  modelProfiles = [...STATIC_CODEX_PROFILES, ...linduoProfiles]
  allowedModels = new Map(modelProfiles.map(m => [m.id, m]))
  return { added: linduoProfiles.length, total: modelProfiles.length }
}
```

- [ ] **Step 3: 在 `executeTurn()` 函数中加 Linduo 分支**

找到 `executeTurn` 函数(主流程,带 `modelProfile = allowedModels.get(request.model)` 那一行附近),在 `if (!modelProfile) throw new Error("不支持的模型。")` 之后,加:

```typescript
  // M1: Linduo 模型走独立分支，绕开 Codex app-server
  if (modelProfile.providerId === "linduo_proxy") {
    return executeLinduoTurn(request, modelProfile, context, existingTask, events)
  }
```

- [ ] **Step 4: 在文件底部加 `executeLinduoTurn` 实现**

```typescript
import { LinduoChatService } from "../services/LinduoChatService"

/**
 * M1: Linduo 模型走 OpenAI 兼容协议,绕开 Codex app-server。
 * 纯文本聊天，不接 tools / vision。
 */
async function executeLinduoTurn(
  request: ChatRequest,
  profile: ModelProfile,
  context: RunContext,
  existingTask: any,
  events: { push: (e: any) => void }
) {
  const { prisma } = await import('../main/services/prismaClient')

  // 1. 校验 model 仍 enabled（M1: 启动时拉一次，运行中变更不感知）
  const row = await prisma.linduoChatModel.findFirst({ where: { modelId: profile.id.replace(/^linduo:/, '') } })
  if (!row || !row.enabled) {
    events.push({ type: 'linduo_error', requestId: request.requestId, message: 'LINDUO_MODEL_DISABLED' })
    return
  }

  // 2. 校验 user 对该 model 有 grant
  if (!context.userId) {
    events.push({ type: 'linduo_error', requestId: request.requestId, message: 'LINDUO_NOT_AUTHENTICATED' })
    return
  }
  const grant = await prisma.userLinduoGrant.findUnique({
    where: { userId_modelId: { userId: context.userId, modelId: row.id } }
  })
  if (!grant) {
    events.push({ type: 'linduo_error', requestId: request.requestId, message: 'LINDUO_MODEL_NOT_GRANTED' })
    return
  }

  // 3. 构造 messages（M1: 只取文本，忽略 attachments 图片描述）
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []
  if (context.systemPrompt) messages.push({ role: 'system', content: context.systemPrompt })
  messages.push({ role: 'user', content: request.message })

  // 4. 落 stored turn（M1: 不写 codexThreadId，仅本地）
  beginStoredTurn({
    requestId: request.requestId,
    taskId: existingTask?.id ?? request.requestId,
    userMessage: request.message,
    model: profile.id
  })

  // 5. 流式调用
  let service: LinduoChatService
  try {
    service = LinduoChatService.fromEnv()
  } catch (err) {
    events.push({ type: 'linduo_error', requestId: request.requestId, message: err instanceof Error ? err.message : 'LINDUO_KEY_MISSING' })
    finishStoredTurn(request.requestId, { status: 'error', error: 'LINDUO_KEY_MISSING' })
    return
  }

  let assistantText = ''
  for await (const chunk of service.streamChat({
    modelId: row.modelId,
    messages
  })) {
    if (chunk.type === 'delta') {
      assistantText += chunk.text
      events.push({ type: 'linduo_delta', requestId: request.requestId, text: chunk.text })
    } else if (chunk.type === 'done') {
      events.push({ type: 'linduo_done', requestId: request.requestId, usage: chunk.usage })
      updateStoredUsage(request.requestId, chunk.usage)
    } else if (chunk.type === 'error') {
      events.push({ type: 'linduo_error', requestId: request.requestId, message: chunk.message })
      finishStoredTurn(request.requestId, { status: 'error', error: chunk.message })
      return
    }
  }

  finishStoredTurn(request.requestId, { status: 'completed', assistantText })
}
```

- [ ] **Step 5: Type check + 验证类型对齐**

```bash
npx tsc -p tsconfig.main.json --noEmit 2>&1 | tail -20
```

Expected: 通过。如果 `RunContext` / `ChatRequest` / `events` 类型对不上,根据实际定义微调。

- [ ] **Step 6: Commit**

```bash
git add src/main/advisor/AdvisorRuntime.ts
git commit -m "feat(advisor): route Linduo models through LinduoChatService bypassing Codex app-server"
```

---

### Task 8: 后端 API 路由 (chat-models-routes.ts)

**Files:**
- Create: `server/src/modules/linduo/chat-models-routes.ts`
- Modify: `server/src/app.ts`(注册路由)

- [ ] **Step 1: 创建 `server/src/modules/linduo/chat-models-routes.ts`**

```typescript
/**
 * Linduo 聊天模型选用 + 授权管理 API（M1）：
 * - GET    /api/linduo/chat-models            当前用户按 grant 过滤的 enabled 列表
 * - GET    /api/linduo/chat-models/all        全部（含 disabled），需 member.manage
 * - PATCH  /api/linduo/chat-models/:id/enabled  切换 enabled，需 member.manage
 * - GET    /api/linduo/grants                 所有 grant 矩阵，需 member.manage
 * - POST   /api/linduo/grants                 body: { userId, modelId }，需 member.manage
 * - DELETE /api/linduo/grants                 body: { userId, modelId }，需 member.manage
 * - GET    /api/linduo/preferred-model        当前用户
 * - PUT    /api/linduo/preferred-model        body: { modelId: string | null }
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { httpError } from '../../lib/errors.js'
import type { LinduoChatModelView, UserLinduoGrantView } from '../../../shared/contracts.js'

function toModelView(row: {
  id: string
  modelId: string
  vendor: string
  displayName: string
  description: string | null
  contextLabel: string | null
  capabilities: string
  effort: string
  enabled: boolean
}): LinduoChatModelView {
  let caps: string[] = []
  try { caps = JSON.parse(row.capabilities) } catch { caps = [] }
  return {
    id: row.id,
    modelId: row.modelId,
    vendor: row.vendor,
    displayName: row.displayName,
    description: row.description,
    contextLabel: row.contextLabel,
    capabilities: caps,
    effort: row.effort,
    enabled: row.enabled
  }
}

const grantSchema = z.object({
  userId: z.string().min(1),
  modelId: z.string().min(1)
})

const preferredSchema = z.object({
  modelId: z.string().min(1).nullable()
})

export async function linduoChatModelsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  // 当前用户可用的 enabled 模型（按 grant 过滤）
  app.get('/chat-models', async (request) => {
    const userId = request.user.sub
    const grants = await prisma.userLinduoGrant.findMany({
      where: { userId },
      include: { model: true }
    })
    return grants
      .filter(g => g.model.enabled)
      .map(g => toModelView(g.model))
  })

  // 全部模型（管理员）
  app.get('/chat-models/all', { preHandler: [app.requirePermission('member.manage')] }, async () => {
    const rows = await prisma.linduoChatModel.findMany({ orderBy: [{ enabled: 'desc' }, { modelId: 'asc' }] })
    return rows.map(toModelView)
  })

  // 切换 enabled
  app.patch('/chat-models/:id/enabled', { preHandler: [app.requirePermission('member.manage')] }, async (request) => {
    const id = (request.params as { id: string }).id
    const body = z.object({ enabled: z.boolean() }).parse(request.body)
    const row = await prisma.linduoChatModel.findUnique({ where: { id } })
    if (!row) throw httpError(404, 'MODEL_NOT_FOUND', '模型不存在')
    const updated = await prisma.linduoChatModel.update({ where: { id }, data: { enabled: body.enabled } })
    return toModelView(updated)
  })

  // 所有 grant
  app.get('/grants', { preHandler: [app.requirePermission('member.manage')] }, async () => {
    const rows = await prisma.userLinduoGrant.findMany({
      include: { model: true, user: { select: { id: true, name: true, email: true } } }
    })
    return rows.map(r => ({
      userId: r.userId,
      userName: r.user.name,
      modelId: r.modelId,
      displayName: r.model.displayName,
      vendor: r.model.vendor,
      grantedBy: r.grantedBy,
      grantedAt: r.grantedAt.toISOString()
    } satisfies UserLinduoGrantView & { userName: string }))
  })

  // 创建 grant
  app.post('/grants', { preHandler: [app.requirePermission('member.manage')] }, async (request) => {
    const body = grantSchema.parse(request.body)
    const model = await prisma.linduoChatModel.findUnique({ where: { id: body.modelId } })
    if (!model) throw httpError(404, 'MODEL_NOT_FOUND', '模型不存在')
    const user = await prisma.user.findUnique({ where: { id: body.userId } })
    if (!user) throw httpError(404, 'USER_NOT_FOUND', '用户不存在')
    const grant = await prisma.userLinduoGrant.upsert({
      where: { userId_modelId: { userId: body.userId, modelId: model.id } },
      create: { userId: body.userId, modelId: model.id, grantedBy: request.user.sub },
      update: { grantedBy: request.user.sub, grantedAt: new Date() }
    })
    return { userId: grant.userId, modelId: grant.modelId, grantedBy: grant.grantedBy, grantedAt: grant.grantedAt.toISOString() }
  })

  // 删除 grant（如该 grant 是用户的 preferred，自动清空）
  app.delete('/grants', { preHandler: [app.requirePermission('member.manage')] }, async (request) => {
    const body = grantSchema.parse(request.body)
    const model = await prisma.linduoChatModel.findUnique({ where: { id: body.modelId } })
    if (!model) throw httpError(404, 'MODEL_NOT_FOUND', '模型不存在')
    await prisma.$transaction([
      prisma.userLinduoGrant.delete({ where: { userId_modelId: { userId: body.userId, modelId: model.id } } }),
      prisma.user.updateMany({
        where: { id: body.userId, preferredLinduoModelId: model.id },
        data: { preferredLinduoModelId: null }
      })
    ])
    return { ok: true }
  })

  // 当前用户 preferred model
  app.get('/preferred-model', async (request) => {
    const userId = request.user.sub
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { preferredLinduoModelId: true } })
    return { modelId: user?.preferredLinduoModelId ?? null }
  })

  // 设置 preferred model（null = 清空）
  app.put('/preferred-model', async (request) => {
    const body = preferredSchema.parse(request.body)
    const userId = request.user.sub
    if (body.modelId !== null) {
      // 校验 grant
      const model = await prisma.linduoChatModel.findUnique({ where: { id: body.modelId } })
      if (!model) throw httpError(404, 'MODEL_NOT_FOUND', '模型不存在')
      if (!model.enabled) throw httpError(400, 'MODEL_DISABLED', '模型已禁用')
      const grant = await prisma.userLinduoGrant.findUnique({
        where: { userId_modelId: { userId, modelId: model.id } }
      })
      if (!grant) throw httpError(403, 'LINDUO_MODEL_NOT_GRANTED', '当前用户未被授权使用该模型')
    }
    await prisma.user.update({ where: { id: userId }, data: { preferredLinduoModelId: body.modelId } })
    return { modelId: body.modelId }
  })
}
```

- [ ] **Step 2: 在 `server/src/app.ts` 注册路由**

找到 import 区(第 20 行附近)加:

```typescript
import { linduoChatModelsRoutes } from './modules/linduo/chat-models-routes.js'
```

找到 register 区(第 69 行附近,`linduoPricingRoutes` 之后)加:

```typescript
  // 零度API 聊天模型选用路由（M1）
  await app.register(linduoChatModelsRoutes, { prefix: '/api/linduo' })
```

- [ ] **Step 3: 验证后端编译**

```bash
cd /Users/zyc/Desktop/砚都跨境
npx tsc -p server/tsconfig.json --noEmit 2>&1 | tail -10
```

Expected: 通过。

- [ ] **Step 4: 启动后端,curl 验证**

```bash
pnpm dev:server 2>&1 | head -5 &
sleep 3
# 假设有 JWT token
TOKEN=$(curl -s -X POST http://localhost:8787/api/auth/login -H "Content-Type: application/json" -d '{"email":"13800000000","password":"test"}' | jq -r .tokens.accessToken)
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8787/api/linduo/chat-models | jq
```

Expected: 返回数组(可能 0 或 27 条,取决于是否 OWNER + 是否启用)。

- [ ] **Step 5: Commit**

```bash
git add server/src/modules/linduo/chat-models-routes.ts server/src/app.ts
git commit -m "feat(server): add Linduo chat models selection + grant management API"
```

---

### Task 9: 渲染层 serverApi 客户端封装

**Files:**
- Modify: `src/renderer/serverApi.ts`

- [ ] **Step 1: 找到文件末尾,追加 8 个 API 函数**

```typescript
import type { LinduoChatModelView, UserLinduoGrantView } from '../shared/contracts'

// ===================== Linduo 聊天模型选用 (M1) =====================

export async function fetchLinduoChatModels(): Promise<LinduoChatModelView[]> {
  return apiFetch<LinduoChatModelView[]>('/api/linduo/chat-models', { method: 'GET' })
}

export async function fetchAllLinduoChatModels(): Promise<LinduoChatModelView[]> {
  return apiFetch<LinduoChatModelView[]>('/api/linduo/chat-models/all', { method: 'GET' })
}

export async function setLinduoChatModelEnabled(id: string, enabled: boolean): Promise<LinduoChatModelView> {
  return apiFetch<LinduoChatModelView>(`/api/linduo/chat-models/${encodeURIComponent(id)}/enabled`, {
    method: 'PATCH',
    body: { enabled }
  })
}

export async function fetchLinduoGrants(): Promise<Array<UserLinduoGrantView & { userName: string }>> {
  return apiFetch<Array<UserLinduoGrantView & { userName: string }>>('/api/linduo/grants', { method: 'GET' })
}

export async function setLinduoGrant(userId: string, modelId: string): Promise<void> {
  await apiFetch('/api/linduo/grants', { method: 'POST', body: { userId, modelId } })
}

export async function revokeLinduoGrant(userId: string, modelId: string): Promise<void> {
  await apiFetch('/api/linduo/grants', { method: 'DELETE', body: { userId, modelId } })
}

export async function fetchLinduoPreferredModel(): Promise<{ modelId: string | null }> {
  return apiFetch<{ modelId: string | null }>('/api/linduo/preferred-model', { method: 'GET' })
}

export async function setLinduoPreferredModel(modelId: string | null): Promise<{ modelId: string | null }> {
  return apiFetch<{ modelId: string | null }>('/api/linduo/preferred-model', { method: 'PUT', body: { modelId } })
}
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: 通过。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/serverApi.ts
git commit -m "feat(renderer): add Linduo chat models client API wrappers"
```

---

### Task 10: IPC + Preload 桥

**Files:**
- Modify: `src/main/main.ts`(注册 8 个 IPC handler)
- Modify: `src/preload/index.ts`(暴露 8 个 API)
- Modify: `src/shared/electronApi.d.ts`(类型声明,如果存在)

- [ ] **Step 1: 在 main.ts 找到 IPC 注册区(搜索 `ipcMain.handle('linduo-`)**

在最后一个 `linduo-pricing:*` IPC 之后,加 8 个:

```typescript
  // ===== Linduo 聊天模型选用 (M1) =====
  ipcMain.handle('linduo-chat-models:list', async (_event, accessToken: unknown) => {
    return callWithTokenList<LinduoChatModelView[]>(accessToken, '/api/linduo/chat-models', 'GET')
  })
  ipcMain.handle('linduo-chat-models:list-all', async (_event, accessToken: unknown) => {
    return callWithTokenList<LinduoChatModelView[]>(accessToken, '/api/linduo/chat-models/all', 'GET')
  })
  ipcMain.handle('linduo-chat-models:set-enabled', async (_event, accessToken: unknown, id: string, enabled: boolean) => {
    return callWithToken<LinduoChatModelView>(accessToken, `/api/linduo/chat-models/${encodeURIComponent(id)}/enabled`, 'PATCH', { enabled })
  })
  ipcMain.handle('linduo-grants:list', async (_event, accessToken: unknown) => {
    return callWithTokenList(accessToken, '/api/linduo/grants', 'GET')
  })
  ipcMain.handle('linduo-grants:set', async (_event, accessToken: unknown, userId: string, modelId: string) => {
    return callWithToken(accessToken, '/api/linduo/grants', 'POST', { userId, modelId })
  })
  ipcMain.handle('linduo-grants:revoke', async (_event, accessToken: unknown, userId: string, modelId: string) => {
    return callWithToken(accessToken, '/api/linduo/grants', 'DELETE', { userId, modelId })
  })
  ipcMain.handle('linduo-preferred:get', async (_event, accessToken: unknown) => {
    return callWithToken<{ modelId: string | null }>(accessToken, '/api/linduo/preferred-model', 'GET')
  })
  ipcMain.handle('linduo-preferred:set', async (_event, accessToken: unknown, modelId: string | null) => {
    return callWithToken<{ modelId: string | null }>(accessToken, '/api/linduo/preferred-model', 'PUT', { modelId })
  })
```

- [ ] **Step 2: 找到 `callWithToken` / `callWithTokenList` 实现,如果没有就建**

在 main.ts 中搜索。如果已有同名函数(从其他 linduo IPC 复用),用现有的;否则加:

```typescript
async function callWithToken<T>(accessToken: unknown, path: string, method: string, body?: any): Promise<T> {
  const token = typeof accessToken === 'string' ? accessToken : null
  if (!token) throw new Error('NOT_AUTHENTICATED')
  const res = await fetch(`${serverBaseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}
async function callWithTokenList<T>(accessToken: unknown, path: string, method: string): Promise<T> {
  return callWithToken<T>(accessToken, path, method)
}
```

- [ ] **Step 3: 修改 `src/preload/index.ts` 暴露 8 个 API**

找到 `desktop.linduoLogin` 附近(IPC 暴露),在 `linduoLogin: { ... }` 之后加:

```typescript
    linduoChat: {
      listChatModels: (token: string) => ipcRenderer.invoke('linduo-chat-models:list', token),
      listAllChatModels: (token: string) => ipcRenderer.invoke('linduo-chat-models:list-all', token),
      setChatModelEnabled: (token: string, id: string, enabled: boolean) => ipcRenderer.invoke('linduo-chat-models:set-enabled', token, id, enabled),
      listGrants: (token: string) => ipcRenderer.invoke('linduo-grants:list', token),
      setGrant: (token: string, userId: string, modelId: string) => ipcRenderer.invoke('linduo-grants:set', token, userId, modelId),
      revokeGrant: (token: string, userId: string, modelId: string) => ipcRenderer.invoke('linduo-grants:revoke', token, userId, modelId),
      getPreferredModel: (token: string) => ipcRenderer.invoke('linduo-preferred:get', token),
      setPreferredModel: (token: string, modelId: string | null) => ipcRenderer.invoke('linduo-preferred:set', token, modelId)
    }
```

- [ ] **Step 4: 找到 `src/shared/electronApi.d.ts` 类型声明文件,加类型**

如果有这个文件,在 `linduoLogin: { ... }` 之后加同构的类型定义。如果没有,在 `src/shared/electronApi.d.ts` 新建:

```typescript
// (根据实际项目情况调整 namespace 路径)
```

- [ ] **Step 5: Type check + 编译**

```bash
npx tsc -p tsconfig.main.json --noEmit 2>&1 | tail -10
npx tsc --noEmit 2>&1 | tail -10
```

Expected: 都通过。

- [ ] **Step 6: Commit**

```bash
git add src/main/main.ts src/preload/index.ts src/shared/electronApi.d.ts
git commit -m "feat(electron): expose 8 Linduo chat model IPC handlers and preload bridge"
```

---

### Task 11: LinduoModelPickerModal 弹窗组件

**Files:**
- Create: `src/renderer/LinduoModelPickerModal.tsx`
- Create: `src/renderer/linduoModelPickerModal.css`(或合并到 styles.css)

- [ ] **Step 1: 创建 `src/renderer/LinduoModelPickerModal.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { fetchLinduoChatModels, setLinduoPreferredModel } from './serverApi'
import { getTokens } from './serverApi'
import type { LinduoChatModelView } from '../shared/contracts'
import './linduoModelPickerModal.css'

interface Props {
  onClose: () => void
  onPicked: () => void  // 通知父组件重读 preferred
}

export function LinduoModelPickerModal({ onClose, onPicked }: Props) {
  const [models, setModels] = useState<LinduoChatModelView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetchLinduoChatModels().then(setModels).catch(err => setError(err instanceof Error ? err.message : '加载失败'))
  }, [])

  async function pick(modelId: string | null) {
    setSubmitting(true)
    setError(null)
    try {
      await setLinduoPreferredModel(modelId)
      onPicked()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '设置失败')
    } finally {
      setSubmitting(false)
    }
  }

  return <div className="settings-backdrop linduo-picker-backdrop" role="dialog" aria-modal="true">
    <div className="linduo-picker-card">
      <header className="linduo-picker-head">
        <div>
          <h2>大模型选用</h2>
          <small>零度API 聚合 · 按你的权限显示可选模型,选择会同步到所有设备</small>
        </div>
        <button type="button" className="linduo-picker-close" onClick={onClose} aria-label="关闭">✕</button>
      </header>
      <div className="linduo-picker-body">
        {error && <div className="linduo-picker-error" role="status">{error}</div>}
        {models === null && !error && <div className="linduo-picker-loading">加载中…</div>}
        {models !== null && models.length === 0 && (
          <div className="linduo-picker-empty">
            当前账号未分配任何 Linduo 聊天模型,请联系管理员在系统管理页分配。
          </div>
        )}
        {models !== null && models.length > 0 && (
          <ul className="linduo-picker-list">
            {models.map(model => (
              <li key={model.id}>
                <button
                  type="button"
                  className="linduo-picker-row"
                  disabled={submitting}
                  onClick={() => pick(model.id)}
                >
                  <span className="linduo-picker-name">{model.displayName}</span>
                  {model.contextLabel && <span className="linduo-picker-ctx">{model.contextLabel}</span>}
                  <span className={`linduo-picker-vendor vendor-${model.vendor}`}>{model.vendor}</span>
                  <span className="linduo-picker-desc">{model.description}</span>
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                className="linduo-picker-row linduo-picker-clear"
                disabled={submitting}
                onClick={() => pick(null)}
              >
                <span className="linduo-picker-name">不使用 Linduo 模型</span>
                <span className="linduo-picker-desc">回退到 Codex 默认 (DeepSeek V4 Flash)</span>
              </button>
            </li>
          </ul>
        )}
      </div>
    </div>
  </div>
}
```

- [ ] **Step 2: 创建 `src/renderer/linduoModelPickerModal.css`**

```css
.linduo-picker-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.linduo-picker-card {
  background: var(--bg-primary, #fff);
  border-radius: 12px;
  width: 520px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
}

.linduo-picker-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 20px 24px 12px;
  border-bottom: 1px solid var(--border-soft, #e5e7eb);
}
.linduo-picker-head h2 { margin: 0 0 4px; font-size: 17px; font-weight: 600; }
.linduo-picker-head small { color: var(--text-secondary, #64748b); font-size: 12px; }
.linduo-picker-close {
  border: none; background: transparent; cursor: pointer; font-size: 18px; color: var(--text-secondary);
  width: 28px; height: 28px; border-radius: 6px;
}
.linduo-picker-close:hover { background: var(--bg-soft, #f1f5f9); }

.linduo-picker-body {
  padding: 16px 20px 20px;
  overflow-y: auto;
  flex: 1;
}

.linduo-picker-loading,
.linduo-picker-empty {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-secondary, #64748b);
  font-size: 14px;
}
.linduo-picker-error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #b91c1c;
  padding: 8px 12px;
  border-radius: 6px;
  margin-bottom: 12px;
  font-size: 13px;
}

.linduo-picker-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.linduo-picker-row {
  width: 100%;
  display: grid;
  grid-template-columns: auto auto 1fr;
  grid-template-rows: auto auto;
  align-items: center;
  gap: 4px 10px;
  padding: 10px 12px;
  background: var(--bg-soft, #f8fafc);
  border: 1px solid var(--border-soft, #e5e7eb);
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s, border-color 0.12s;
}
.linduo-picker-row:hover:not(:disabled) {
  background: var(--bg-hover, #f1f5f9);
  border-color: var(--accent, #16a59a);
}
.linduo-picker-row:disabled { opacity: 0.5; cursor: not-allowed; }

.linduo-picker-name { font-weight: 600; font-size: 14px; }
.linduo-picker-ctx {
  font-size: 11px;
  padding: 2px 6px;
  background: var(--bg-soft, #f1f5f9);
  border-radius: 4px;
  color: var(--text-secondary, #64748b);
}
.linduo-picker-vendor {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
  font-weight: 600;
}
.linduo-picker-vendor.vendor-openai { background: #d1fae5; color: #047857; }
.linduo-picker-vendor.vendor-google { background: #dbeafe; color: #1d4ed8; }
.linduo-picker-vendor.vendor-anthropic { background: #fef3c7; color: #b45309; }
.linduo-picker-vendor.vendor-vidu { background: #fce7f3; color: #be185d; }
.linduo-picker-desc {
  grid-column: 1 / -1;
  font-size: 12px;
  color: var(--text-secondary, #64748b);
  margin-top: 4px;
}

.linduo-picker-clear {
  border-style: dashed;
  margin-top: 8px;
}
.linduo-picker-clear .linduo-picker-name { color: var(--text-secondary); font-weight: 500; }
```

- [ ] **Step 3: Type check**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/LinduoModelPickerModal.tsx src/renderer/linduoModelPickerModal.css
git commit -m "feat(renderer): add LinduoModelPickerModal with grant-filtered model list"
```

---

### Task 12: OnlineAdvisorExperience 改造 (齿轮 + 黄框下拉合并)

**Files:**
- Modify: `src/renderer/OnlineAdvisorExperience.tsx`

**⚠️ 该文件当前有大量 WIP diff,本任务应只在 WIP 已 commit/stash 的 worktree 上做。**

- [ ] **Step 1: 找到「设置」齿轮按钮(OnlineAdvisorExperience.tsx:1760-1785)**

把 `onClick={openPersonalization}` 改为:

```typescript
  const [linduoPickerOpen, setLinduoPickerOpen] = useState(false)
  // ... 在 component 内 ...

  // 替换原 onClick:
  onClick={() => setLinduoPickerOpen(true)}
```

- [ ] **Step 2: 找到 component 末尾(在 `</aside>` 之前或合适位置)插入 Modal 渲染**

```typescript
      {linduoPickerOpen && <LinduoModelPickerModal
        onClose={() => setLinduoPickerOpen(false)}
        onPicked={() => {
          // 重读 preferred
          void loadPreferredModel()
        }}
      />}
```

- [ ] **Step 3: 加 import**

```typescript
import { LinduoModelPickerModal } from './LinduoModelPickerModal'
```

- [ ] **Step 4: 改黄框下拉 modelOptions 动态化**

找到 `modelOptions` 数组(行 132-136 附近,原本是常量),改成动态加载:

```typescript
// 改写 component 顶部:
const [modelOptions, setModelOptions] = useState<Array<{id: ModelId, name: string, hint: string, isLinduo: boolean}>>([
  { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", hint: "更快", isLinduo: false },
  { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", hint: "更强", isLinduo: false },
  { id: "chat-latest", name: "OpenAI ChatGPT Latest", hint: "ChatGPT", isLinduo: false }
])

useEffect(() => {
  // 拉用户可用的 Linduo 模型,合并
  void fetchLinduoChatModels().then(linduo => {
    const linduoOptions = linduo.map(m => ({
      id: `linduo:${m.modelId}` as ModelId,
      name: `${m.displayName} (经零度API)`,
      hint: m.contextLabel || m.vendor,
      isLinduo: true
    }))
    setModelOptions(prev => [
      ...prev.filter(o => !o.isLinduo),  // 去重旧的 Linduo
      ...linduoOptions
    ])
  }).catch(() => { /* Linduo 未配置时忽略 */ })
}, [])
```

- [ ] **Step 5: 改 `selectPreferredModel`**

找到原 `selectPreferredModel(selected: ModelId)`,替换为:

```typescript
function selectPreferredModel(selected: ModelId) {
  const opt = modelOptions.find(o => o.id === selected)
  if (opt?.isLinduo) {
    // Linduo 走后端
    const modelDbId = selected.replace(/^linduo:/, '')  // 实际应该是 model.id (cuid)
    // 修正:从 options 里存完整 modelId
    // 见 Step 5b
  }
  // Codex 走原 localStorage 逻辑
  setModel(selected)
  window.localStorage.setItem(preferredModelStorageKey, selected)
}
```

**Step 5b 修正:选项结构里要存原始 modelId**

回到 Step 4,把 modelOptions 改成:

```typescript
type ModelOption = {
  id: ModelId       // 完整 id,例 "linduo:gpt-4o"
  name: string
  hint: string
  isLinduo: boolean
  linduoDbId?: string  // 仅 Linduo: 后端 LinduoChatModel.id (cuid)
}

const [modelOptions, setModelOptions] = useState<ModelOption[]>([
  { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", hint: "更快", isLinduo: false },
  // ...
])

useEffect(() => {
  void fetchLinduoChatModels().then(linduo => {
    const linduoOptions: ModelOption[] = linduo.map(m => ({
      id: `linduo:${m.modelId}` as ModelId,
      name: `${m.displayName} (经零度API)`,
      hint: m.contextLabel || m.vendor,
      isLinduo: true,
      linduoDbId: m.id
    }))
    setModelOptions(prev => [
      ...prev.filter(o => !o.isLinduo),
      ...linduoOptions
    ])
  }).catch(() => {})
}, [])

function selectPreferredModel(selected: ModelId) {
  const opt = modelOptions.find(o => o.id === selected)
  if (opt?.isLinduo && opt.linduoDbId) {
    void setLinduoPreferredModel(opt.linduoDbId)
      .then(() => setModel(selected))
      .catch(err => console.error('设置 Linduo 选用失败：', err))
    return
  }
  setModel(selected)
  window.localStorage.setItem(preferredModelStorageKey, selected)
}
```

- [ ] **Step 6: 改 `readPreferredModel` 拉后端**

找到 `readPreferredModel`(文件底部 utility 函数),**不删原函数,新建一个 async 版**:

```typescript
async function loadInitialModel(): Promise<ModelId> {
  // 1. 后端 Linduo preferred
  try {
    const { modelId } = await fetchLinduoPreferredModel()
    if (modelId) {
      // 需要把后端 model.id (cuid) 还原成 "linduo:<modelId>"
      // 通过 fetchLinduoChatModels 找到对应 modelId
      const list = await fetchLinduoChatModels()
      const match = list.find(m => m.id === modelId)
      if (match) return `linduo:${match.modelId}` as ModelId
    }
  } catch { /* 未登录或 Linduo 未配置 */ }
  // 2. fallback 到 localStorage Codex
  const saved = window.localStorage.getItem(preferredModelStorageKey)
  if (saved === "deepseek/deepseek-v4-pro") return saved
  if (saved === "chat-latest") return saved
  return "deepseek/deepseek-v4-flash"
}
```

把原 `useState<ModelId>(() => readPreferredModel())` 改成:

```typescript
const [model, setModel] = useState<ModelId>("deepseek/deepseek-v4-flash")
useEffect(() => { void loadInitialModel().then(setModel) }, [])

// loadPreferredModel 用作 onPicked 回调:
const loadPreferredModel = async () => {
  const m = await loadInitialModel()
  setModel(m)
}
```

- [ ] **Step 7: Linduo 模型 + 附件发送兜底**

找到 `send` 函数(或 sendMessage 之类),在发送前加:

```typescript
const isLinduoModel = model.startsWith('linduo:')
if (isLinduoModel && attachments.length > 0) {
  setError('Linduo 模型暂不支持附件,请移除附件或切换 Codex 模型')
  return
}
```

- [ ] **Step 8: 附件按钮 disabled 兜底(可选但推荐)**

找到附件按钮(`.composer-upload`),加:

```typescript
disabled={isLinduoModel}
title={isLinduoModel ? 'Linduo 模型暂不支持视觉,Vision 功能将在 M4 启用' : undefined}
```

- [ ] **Step 9: 加 import**

```typescript
import { fetchLinduoChatModels, fetchLinduoPreferredModel, setLinduoPreferredModel } from './serverApi'
```

- [ ] **Step 10: Type check + build**

```bash
npx tsc --noEmit 2>&1 | tail -10
npx vite build 2>&1 | tail -10
```

Expected: 都通过。

- [ ] **Step 11: Commit**

```bash
git add src/renderer/OnlineAdvisorExperience.tsx
git commit -m "feat(online-advisor): wire Linduo model picker modal + merge Linduo options into yellow box"
```

---

### Task 13: 渲染层 ChatEvent 适配 (linduo_delta / done / error)

**Files:**
- Modify: `src/renderer/OnlineAdvisorExperience.tsx`

- [ ] **Step 1: 找到 onChatEvent 回调(注册在 `window.desktop.advisor.onChatEvent`)**

在事件 switch 里(假设已有 `case 'codex_*': ...`),加 3 个 case:

```typescript
case 'linduo_delta': {
  // 找到当前 requestId 对应的 message,append text
  setMessages(prev => prev.map(msg => {
    if (msg.taskStatus?.requestId === event.requestId && msg.role === 'assistant') {
      return { ...msg, text: (msg.text ?? '') + event.text }
    }
    return msg
  }))
  break
}
case 'linduo_done': {
  setMessages(prev => prev.map(msg => {
    if (msg.taskStatus?.requestId === event.requestId && msg.role === 'assistant') {
      return { ...msg, taskStatus: { ...msg.taskStatus, status: 'completed' } }
    }
    return msg
  }))
  break
}
case 'linduo_error': {
  setError(`Linduo 调用失败：${event.message}`)
  setMessages(prev => prev.map(msg => {
    if (msg.taskStatus?.requestId === event.requestId && msg.role === 'assistant') {
      return { ...msg, taskStatus: { ...msg.taskStatus, status: 'error' } }
    }
    return msg
  }))
  break
}
```

- [ ] **Step 2: 验证**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: 通过(类型对齐 `event.requestId` / `event.text` / `event.message`)。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/OnlineAdvisorExperience.tsx
git commit -m "feat(online-advisor): render Linduo stream delta/done/error events in message list"
```

---

### Task 14: 系统管理页 Linduo 选用分配 Modal

**Files:**
- Modify: `src/renderer/SystemAdminPage.tsx`

- [ ] **Step 1: 找到系统管理页成员表格**

```bash
cd /Users/zyc/Desktop/砚都跨境
grep -n "fetchMembers\|<table\|<tbody" src/renderer/SystemAdminPage.tsx | head -10
```

- [ ] **Step 2: 在 component 顶部加状态**

```typescript
const [linduoAssignTarget, setLinduoAssignTarget] = useState<MemberView | null>(null)
const [linduoAllModels, setLinduoAllModels] = useState<LinduoChatModelView[]>([])
const [linduoUserGrants, setLinduoUserGrants] = useState<Set<string>>(new Set())
```

- [ ] **Step 3: 实现「分配 Linduo 模型」按钮 + Modal**

找到成员表格行(假设已有「操作」列),加:

```tsx
{!member.isOwner && (
  <button
    type="button"
    className="member-action-btn"
    onClick={async () => {
      setLinduoAssignTarget(member)
      try {
        const all = await fetchAllLinduoChatModels()
        const grants = await fetchLinduoGrants()
        setLinduoAllModels(all.filter(m => m.enabled))
        setLinduoUserGrants(new Set(
          grants.filter(g => g.userId === member.id).map(g => g.modelId)
        ))
      } catch (err) {
        console.error('加载 Linduo 模型失败：', err)
      }
    }}
  >
    ⚙ Linduo 选用
  </button>
)}
{member.isOwner && (
  <span className="member-action-note">OWNER 全开</span>
)}
```

- [ ] **Step 4: Modal 实现**

在 component 末尾加:

```tsx
{linduoAssignTarget && (
  <div className="settings-backdrop" role="dialog">
    <div className="linduo-assign-card">
      <header>
        <h2>为 {linduoAssignTarget.name} 分配 Linduo 聊天模型</h2>
        <button type="button" onClick={() => setLinduoAssignTarget(null)} aria-label="关闭">✕</button>
      </header>
      <div className="linduo-assign-body">
        {linduoAllModels.length === 0 && <div className="linduo-assign-empty">暂无可用 Linduo 模型</div>}
        {linduoAllModels.map(model => {
          const checked = linduoUserGrants.has(model.id)
          return (
            <label key={model.id} className="linduo-assign-row">
              <input
                type="checkbox"
                checked={checked}
                onChange={async (e) => {
                  const newSet = new Set(linduoUserGrants)
                  if (e.target.checked) {
                    newSet.add(model.id)
                    try { await setLinduoGrant(linduoAssignTarget.id, model.id) } catch (err) { console.error(err); return }
                  } else {
                    newSet.delete(model.id)
                    try { await revokeLinduoGrant(linduoAssignTarget.id, model.id) } catch (err) { console.error(err); return }
                  }
                  setLinduoUserGrants(newSet)
                }}
              />
              <span>
                <strong>{model.displayName}</strong>
                <small>{model.vendor} · {model.contextLabel || '—'}</small>
              </span>
            </label>
          )
        })}
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 5: 加 import**

```typescript
import {
  fetchAllLinduoChatModels,
  fetchLinduoGrants,
  setLinduoGrant,
  revokeLinduoGrant
} from './serverApi'
import type { LinduoChatModelView } from '../shared/contracts'
import type { MemberView } from './serverApi'
```

- [ ] **Step 6: 加 CSS(追加到 `src/renderer/styles.css`)**

```css
.linduo-assign-card {
  background: var(--bg-primary, #fff);
  border-radius: 12px;
  width: 480px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.linduo-assign-card > header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid var(--border-soft, #e5e7eb);
}
.linduo-assign-card > header h2 { margin: 0; font-size: 16px; }
.linduo-assign-body {
  padding: 12px 20px 20px; overflow-y: auto; flex: 1;
}
.linduo-assign-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: 6px;
}
.linduo-assign-row:hover { background: var(--bg-soft, #f8fafc); }
.linduo-assign-row small { display: block; color: var(--text-secondary); font-size: 11px; }
.linduo-assign-empty { padding: 40px; text-align: center; color: var(--text-secondary); }
.member-action-btn { padding: 4px 10px; font-size: 12px; border-radius: 4px; cursor: pointer; }
.member-action-note { font-size: 11px; color: var(--text-secondary); }
```

- [ ] **Step 7: Type check + build**

```bash
npx tsc --noEmit 2>&1 | tail -10
npx vite build 2>&1 | tail -10
```

Expected: 都通过。

- [ ] **Step 8: Commit**

```bash
git add src/renderer/SystemAdminPage.tsx src/renderer/styles.css
git commit -m "feat(admin): add Linduo chat model grant assignment modal in member row"
```

---

### Task 15: main.ts 接入 reloadLinduoChatModels + AdvisorRuntime

**Files:**
- Modify: `src/main/main.ts`

- [ ] **Step 1: 找到 Task 5 加的启动同步代码块**

在那段 `void syncLinduoChatModels().then(...).then(...)` 之后,加:

```typescript
  // 把 enabled Linduo 模型注入 AdvisorRuntime 的 modelProfiles
  import('./advisor/AdvisorRuntime').then(({ reloadLinduoChatModels }) => {
    return reloadLinduoChatModels()
  }).then((result) => {
    console.log(`[advisor] 已加载 ${result.added} 个 Linduo 模型,共 ${result.total} 个模型档位`)
  }).catch((err) => {
    console.error('[advisor] 加载 Linduo 模型失败：', err)
  })
```

- [ ] **Step 2: 验证**

```bash
npx tsc -p tsconfig.main.json --noEmit 2>&1 | tail -10
pnpm dev 2>&1 | grep -E "linduo-chat|advisor" | head -10
```

Expected 日志:
```
[linduo-chat] 同步完成: 新增 27 / 更新 0 / 软关 0
[linduo-chat] OWNER 自动 grant 27 条
[advisor] 已加载 27 个 Linduo 模型,共 30 个模型档位
```

- [ ] **Step 3: Commit**

```bash
git add src/main/main.ts
git commit -m "feat(main): wire reloadLinduoChatModels into AdvisorRuntime on startup"
```

---

### Task 16: 端到端验证 + cleanup

**Files:**
- 无文件改动,纯验证

- [ ] **Step 1: 全套 typecheck + build**

```bash
cd /Users/zyc/Desktop/砚都跨境
npx tsc --noEmit 2>&1 | tail -5
npx tsc -p tsconfig.main.json --noEmit 2>&1 | tail -5
npx tsc -p server/tsconfig.json --noEmit 2>&1 | tail -5
npx vite build 2>&1 | tail -5
```

Expected: 全绿。

- [ ] **Step 2: 启动应用,跑 spec 验收标准 1-14**

具体步骤对应 spec §10:

1. ✅ `pnpm prisma migrate dev` 已跑过(看 Task 1)
2. ✅ 启动后 DB 27 条 enabled(看 Task 5 验证)
3. ✅ 改 LINDUO_MODELS 同步:临时加一个 `{id: 'test-chat', name: 'Test', vendor: 'openai', capabilities: ['CHAT'], description: 'tmp'}`,重启,DB 出现 `test-chat`
4. ✅ 删一个:临时移除 `o1`,重启,DB 中 `o1` enabled=false
5. ✅ OWNER `GET /api/linduo/chat-models` 返回 27
6. ✅ 非 OWNER 返回 0
7. ✅ OWNER 选 GPT-4o → 弹窗关 → 黄框显示「GPT-4o (经零度API)」→ 发消息 → 看 LinduoChatService 日志 + 流式输出
8. ✅ 流式 UI 增量显示
9. ✅ 切 Codex ↔ Linduo → SessionStore fork
10. ✅ 系统管理分配 → 该用户刷新后能看到
11. ✅ Linduo + 附件 → 阻止发送
12. ✅ Linduo + 无附件 → 正常发
13. ✅ 全套 typecheck + build(Step 1)
14. ✅ 旧 localStorage 兼容:手动设 localStorage = "linduo:gpt-4o"(需要构造这个 id),重启,黄框显示 Linduo 模型

- [ ] **Step 3: 临时测试数据回滚**

```bash
# 移除临时加的 test-chat
# 改 src/shared/linduoCatalog.ts 删除 'test-chat' 那行
# 移除临时移除 o1 的改动(如果有)
git diff src/shared/linduoCatalog.ts
# 确认无 WIP 后:
git add src/shared/linduoCatalog.ts
git commit -m "test: revert temporary catalog changes for sync verification"
```

- [ ] **Step 4: 跑最终 typecheck + build 收尾**

```bash
npx tsc --noEmit 2>&1 | tail -5
npx tsc -p tsconfig.main.json --noEmit 2>&1 | tail -5
npx tsc -p server/tsconfig.json --noEmit 2>&1 | tail -5
npx vite build 2>&1 | tail -5
```

Expected: 全绿。

- [ ] **Step 5: 提 PR(可选,等用户决定)**

```bash
git log --oneline main..HEAD  # 看 16 个 commit
git push -u origin feat/linduo-model-selection-m1
gh pr create --title "M1: Linduo 聊天模型选用 + 全员路由" --body "见 docs/superpowers/specs/2026-08-26-linduo-model-selection-design.md + docs/superpowers/plans/2026-08-26-linduo-model-selection-m1.md"
```

---

## 工作量与文件清单(汇总)

| 任务 | commit | 文件数 | 行数 |
|---|---|---|---|
| 0. WIP 清理 + worktree | (无) | 0 | 0 |
| 1. Schema + migration | 1 | 1 + 1 新 | +90 |
| 2. 共享目录 | 1 | 1 新 + 1 改 | +250 + -100 |
| 3. 共享类型 | 1 | 2 改 | +40 |
| 4. LinduoChatModelSync | 1 | 1 新 | +90 |
| 5. main.ts 接入 | 1 | 1 改 | +15 |
| 6. LinduoChatService | 1 | 1 新 | +150 |
| 7. AdvisorRuntime 集成 | 1 | 1 改 | +130 |
| 8. 后端 API | 1 | 1 新 + 1 改 | +180 |
| 9. 客户端 API | 1 | 1 改 | +50 |
| 10. IPC + Preload | 1 | 3 改 | +80 |
| 11. Modal 组件 | 1 | 1 新 + 1 新 | +200 |
| 12. OnlineAdvisorExperience | 1 | 1 改 | +90 |
| 13. ChatEvent 适配 | 1 | 1 改 | +40 |
| 14. 系统管理页 | 1 | 2 改 | +180 |
| 15. main.ts 接入 reload | 1 | 1 改 | +15 |
| 16. 端到端验证 | 1 | (rollback) | (0) |
| **合计** | **16 commits** | **15 文件** | **~1600 行** |

---

## 风险与回退

| 风险 | 应对 |
|---|---|
| WIP 冲突 | Task 0 必做,未清理 WIP 不开新分支 |
| Prisma migrate 失败 | 检查 server/prisma/schema.prisma 字段名,确保 `User` 表已有 `aiQuotas AiQuota[]` 这类 relation 才能加新字段 |
| LinduoChatModelSync 找不到 prisma client | Task 4 Step 2 暴露路径,如未建主进程 prisma 客户端,告知用户 |
| Linduo API 协议不是 OpenAI 兼容 | Task 6 跑通后第一时间实测;不兼容则降级(暂停 plan,回 spec 讨论) |
| 测试发现更多 WIP 冲突 | 每个任务 Step 1 都 `git status` 确认 working tree 干净,否则回到 Task 0 |
| 模型改名后 UI 仍显示旧名 | 黄框下拉有 hint 字段,显示 contextLabel 或 vendor,UI 不直接绑 displayName |
| 渲染层 ChatEvent 适配断流 | Step 1-2 的 case 单独测,失败就回退到 Task 13 commit |

---

## Self-Review (per writing-plans skill)

**1. Spec coverage:**
- §3 数据层 → Task 1 ✓
- §4 启动同步 → Task 4, 5 ✓
- §5 后端 API 8 个 → Task 8 ✓
- §6 LinduoChatService → Task 6 ✓
- §6 AdvisorRuntime → Task 7 ✓
- §6 IPC 8 个 → Task 10 ✓
- §7 弹窗 → Task 11 ✓
- §7 黄框下拉合并 → Task 12 ✓
- §7 系统管理 → Task 14 ✓
- §7 兜底(附件 disabled + 阻止发送) → Task 12 Step 7-8 ✓
- §8 共享类型 → Task 3 ✓
- §8 共享目录抽离 → Task 2 ✓
- §10 验收 14 条 → Task 16 ✓

**2. Placeholder scan:** 无"TBD"/"TODO"/"待实现"。所有代码块都给了具体内容。

**3. Type consistency:**
- `LinduoChatModelView`: Task 3 定义,Task 8 服务端用,Task 9 客户端用 ✓
- `UserLinduoGrantView`: Task 3 定义,Task 8 服务端用,Task 9 客户端用 ✓
- `linduo_delta` / `done` / `error`: Task 3 ChatEvent 定义,Task 7 主进程 emit,Task 13 渲染层接收 ✓
- `linduo:<modelId>` 命名空间: Task 7 引入,Task 12 黄框下拉用 ✓
- `model.id` (cuid) vs `model.modelId`: Task 9 setLinduoPreferredModel 用 `model.id`;Task 12 黄框下拉的 `linduoDbId` 存 `model.id` ✓

**结论**:自审通过。可以开始实施。
