# Linduo 模型选用(R-2 等级 + 例外)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 M1 21 commits 基础上,把 Linduo 模型分配从"按用户粒度"改为"按 LinduoModelTier(基础/进阶/全开)集合 + 用户例外"两层模型;UI 上,sidebar 齿轮 → 弹 LinduoAssignmentModal(左右双栏穿梭),OnlineAdvisor 右下角下拉接 Linduo 模型。

**Architecture:** DB 新增 `LinduoModelTier` / `LinduoTierGrant` / `UserLinduoException` 3 张表,改 `UserLinduoGrant` 为 `UserLinduoException` 加 `kind` 字段;启动 seed 3 个预置 tier,回填历史用户默认 tier;新增 `getAvailableModelsForUser(userId)` 核心计算函数;渲染层加 3 个 modal(分配/偏好/例外),改齿轮入口,改右下角下拉。

**Tech Stack:** Prisma + Fastify + Electron IPC + Vite/React + OpenAI Chat Completions API

**前置文档:** `docs/superpowers/specs/2026-08-26-linduo-model-selection-design.md` (R-2 修正版)

---

## 工作树与分支

- 工作目录:`/Users/zyc/Desktop/砚都跨境-m1-linduo`(已经存在,含 M1 21 commits)
- 分支:`feat/linduo-model-selection-m1`(就地继续加 11 个 commit,最后 squash 整条 32 commit)
- 不开新 worktree(避免复制 M1 21 commit 的代码)

---

## File Structure (R-2 改动汇总)

| 类别 | 文件 | 改动 |
|---|---|---|
| Schema | `server/prisma/schema.prisma` | UserLinduoGrant → UserLinduoException + 新增 LinduoModelTier + LinduoTierGrant + User.linduoTierId |
| Migration | `server/prisma/migrations/2026XXXXXX_linduo_model_tiers/` | 新建 |
| 共享 | `src/shared/contracts.ts` | 加 LinduoModelTierView / LinduoExceptionView |
| 后端服务 | `server/src/modules/linduo/chat-models-sync.ts` | 加 seedDefaultLinduoTiers / assignDefaultTierToNewUser / getAvailableModelsForUser |
| 后端路由 | `server/src/modules/linduo/chat-models-routes.ts` | 替换 user 粒度 grants 为 tier + exception API |
| 后端启动 | `server/src/index.ts` | 调 seedDefaultLinduoTiers + 回填 |
| 主进程 IPC | `src/main/main.ts` + `src/preload/index.ts` | 替换 6 个 IPC + 删 3 个旧 IPC |
| 类型 + API | `src/renderer/serverApi.ts` | 加 6 个新 API wrapper,删 3 个旧 |
| 渲染层 modal | `src/renderer/LinduoAssignmentModal.tsx` | 新建(admin 齿轮弹,双栏穿梭) |
| 渲染层 modal | `src/renderer/LinduoPreferenceModal.tsx` | 新建(普通用户,只读 + 修改特例入口) |
| 渲染层 modal | `src/renderer/LinduoExceptionModal.tsx` | 新建(特例双栏穿梭) |
| 渲染层 modal CSS | `src/renderer/linduoModal.css` | 新建 |
| 渲染层主 | `src/renderer/OnlineAdvisorExperience.tsx` | 右下角下拉接 Linduo |
| 渲染层 sidebar | `src/renderer/App.tsx` | 齿轮触发 modal |
| 系统管理 | `src/renderer/SystemAdmin.tsx` | 成员行加 tier 下拉 + 例外按钮,删旧 Linduo 选用按钮 |
| CSS | `src/renderer/online-advisor-experience.css` | 改右下角下拉样式 |

---

## Task 1: Schema + Migration(UserLinduoGrant 改名 + 加 tier 表)

**Files:**
- Modify: `server/prisma/schema.prisma:355-373` (UserLinduoGrant → UserLinduoException + kind)
- Modify: `server/prisma/schema.prisma` 新增 LinduoModelTier + LinduoTierGrant
- Modify: `server/prisma/schema.prisma:96-121` (User 加 linduoTierId 字段)
- Create: `server/prisma/migrations/20260827_linduo_model_tiers/migration.sql`

- [ ] **Step 1: 写 schema 改动**

在 `server/prisma/schema.prisma` 做以下改动:

```prisma
// L355-373 旧 UserLinduoGrant 替换为:
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

在 `LinduoChatModel` model 里改 `grants UserLinduoGrant[]` → `exceptions UserLinduoException[]` 和加 `tierGrants LinduoTierGrant[]`。

在 User model 加:
```prisma
  preferredLinduoModelId String?              @map("preferred_linduo_model_id")
  linduoTierId           String?              @map("linduo_tier_id")
  linduoTier             LinduoModelTier?     @relation(fields: [linduoTierId], references: [id], onDelete: SetNull)
  linduoExceptions       UserLinduoException[]
```

新增 `LinduoModelTier`:
```prisma
model LinduoModelTier {
  id          String              @id @default(cuid())
  orgId       String              @map("org_id")
  key         String
  name        String
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
```

新增 `LinduoTierGrant`:
```prisma
model LinduoTierGrant {
  tierId    String          @map("tier_id")
  modelId   String          @map("model_id")
  grantedBy String?         @map("granted_by")
  grantedAt DateTime        @default(now()) @map("granted_at")
  tier      LinduoModelTier @relation(fields: [tierId], references: [id], onDelete: Cascade)
  model     LinduoChatModel @relation(fields: [modelId], references: [id], onDelete: Cascade)

  @@id([tierId, modelId])
  @@index([modelId])
  @@map("linduo_tier_grants")
}
```

- [ ] **Step 2: 写 migration SQL**

```bash
mkdir -p server/prisma/migrations/20260827_linduo_model_tiers
```

`migration.sql`:
```sql
-- 1. 旧 user_linduo_grants 表改名为 user_linduo_exceptions + 加 kind 字段
ALTER TABLE "user_linduo_grants" RENAME TO "user_linduo_exceptions";
ALTER TABLE "user_linduo_exceptions" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'GRANT';

-- 2. 新增 linduo_model_tiers 表
CREATE TABLE "linduo_model_tiers" (
  "id" TEXT PRIMARY KEY,
  "org_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "is_system" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP NOT NULL,
  CONSTRAINT "linduo_model_tiers_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "linduo_model_tiers_org_id_key_key" ON "linduo_model_tiers"("org_id", "key");
CREATE INDEX "linduo_model_tiers_org_id_idx" ON "linduo_model_tiers"("org_id");

-- 3. 新增 linduo_tier_grants 表
CREATE TABLE "linduo_tier_grants" (
  "tier_id" TEXT NOT NULL,
  "model_id" TEXT NOT NULL,
  "granted_by" TEXT,
  "granted_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("tier_id", "model_id"),
  CONSTRAINT "linduo_tier_grants_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "linduo_model_tiers"("id") ON DELETE CASCADE,
  CONSTRAINT "linduo_tier_grants_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "linduo_chat_models"("id") ON DELETE CASCADE
);
CREATE INDEX "linduo_tier_grants_model_id_idx" ON "linduo_tier_grants"("model_id");

-- 4. users 表加 linduo_tier_id 字段
ALTER TABLE "users" ADD COLUMN "linduo_tier_id" TEXT;
ALTER TABLE "users" ADD CONSTRAINT "users_linduo_tier_id_fkey" FOREIGN KEY ("linduo_tier_id") REFERENCES "linduo_model_tiers"("id") ON DELETE SET NULL;
```

- [ ] **Step 3: 跑 prisma generate 验证**

```bash
cd /Users/zyc/Desktop/砚都跨境-m1-linduo/server
pnpm prisma generate
```

预期:无错误,生成新 client。

- [ ] **Step 4: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260827_linduo_model_tiers/
git commit -m "feat(db): add LinduoModelTier + LinduoTierGrant, rename UserLinduoGrant to UserLinduoException (R-2)"
```

---

## Task 2: 共享类型 + seedDefaultLinduoTiers 函数

**Files:**
- Modify: `src/shared/contracts.ts` (加 LinduoModelTierView / LinduoExceptionView)
- Modify: `server/src/modules/linduo/chat-models-sync.ts` (加 seedDefaultLinduoTiers + assignDefaultTierToNewUser + getAvailableModelsForUser)

- [ ] **Step 1: 在 contracts.ts 加类型**

```typescript
export interface LinduoModelTierView {
  id: string
  key: string
  name: string
  description: string | null
  displayOrder: number
  isSystem: boolean
}

export interface LinduoExceptionView {
  userId: string
  modelId: string
  displayName: string
  vendor: string
  kind: 'GRANT' | 'REVOKE'
  grantedBy: string | null
  grantedAt: string
}
```

- [ ] **Step 2: 在 chat-models-sync.ts 加 seedDefaultLinduoTiers**

```typescript
import { getLinduoChatModels } from './linduoCatalog.js'

const TIER_DEFAULTS: Record<string, { name: string; description: string; defaultModelIds: string[] }> = {
  basic: {
    name: '基础组',
    description: '基础模型,适合日常简单任务',
    defaultModelIds: []  // 空,admin 后续配
  },
  advanced: {
    name: '进阶组',
    description: '中阶模型,适合日常运营(选品/Listing/分析)',
    defaultModelIds: [
      'gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo',
      'claude-3-5-sonnet', 'claude-3-5-haiku',
      'gemini-2.5-flash', 'gemini-1.5-pro', 'gemini-1.5-flash',
      'o1-mini', 'o3-mini', 'gpt-4.1-mini', 'gemini-2.0-flash'
    ]
  },
  full: {
    name: '全开组',
    description: '全部 25 个 CHAT 模型开放,适合主帐号与高权限岗位',
    defaultModelIds: 'ALL'  // 特殊标记,seed 时全开
  }
}

/**
 * 启动时为每个 org seed 3 个预置 LinduoModelTier(幂等)
 * - basic / advanced / full
 * - full 的 default grants 是全部 enabled=true 的 LinduoChatModel
 * - advanced 是 TIER_DEFAULTS.advanced.defaultModelIds 的子集(在 DB 中存在的)
 * - basic 是空
 */
export async function seedDefaultLinduoTiers(): Promise<{ inserted: number; grants: number }> {
  const orgs = await prisma.organization.findMany({ select: { id: true } })
  const allEnabledModels = await prisma.linduoChatModel.findMany({
    where: { enabled: true },
    select: { id: true, modelId: true }
  })
  const enabledModelIds = new Set(allEnabledModels.map(m => m.modelId))
  const modelIdToPk = new Map(allEnabledModels.map(m => [m.modelId, m.id]))

  let inserted = 0
  let grants = 0

  for (const org of orgs) {
    for (const [key, def] of Object.entries(TIER_DEFAULTS)) {
      // upsert tier
      const tier = await prisma.linduoModelTier.upsert({
        where: { orgId_key: { orgId: org.id, key } },
        create: {
          orgId: org.id,
          key,
          name: def.name,
          description: def.description,
          displayOrder: key === 'basic' ? 0 : key === 'advanced' ? 1 : 2,
          isSystem: true
        },
        update: { name: def.name, description: def.description }
      })
      // 统计 inserted
      const existed = await prisma.linduoModelTier.count({ where: { id: tier.id, createdAt: { lt: new Date(Date.now() - 1000) } } })
      if (existed === 0) inserted += 1

      // 决定要 grant 的 modelId 列表
      let targetModelIds: string[]
      if (def.defaultModelIds === 'ALL') {
        targetModelIds = [...enabledModelIds]
      } else {
        targetModelIds = def.defaultModelIds.filter(id => enabledModelIds.has(id))
      }

      // 删旧 grants,插新
      await prisma.linduoTierGrant.deleteMany({ where: { tierId: tier.id } })
      for (const mid of targetModelIds) {
        const pk = modelIdToPk.get(mid)
        if (!pk) continue
        await prisma.linduoTierGrant.create({
          data: { tierId: tier.id, modelId: pk }
        })
        grants += 1
      }
    }
  }

  return { inserted, grants }
}

/**
 * 新注册用户自动分配 advanced tier(可在 members POST 流程里调)
 */
export async function assignDefaultTierToNewUser(userId: string, orgId: string): Promise<string | null> {
  const advanced = await prisma.linduoModelTier.findFirst({
    where: { orgId, key: 'advanced' },
    select: { id: true }
  })
  if (!advanced) return null
  await prisma.user.update({
    where: { id: userId },
    data: { linduoTierId: advanced.id }
  })
  return advanced.id
}

/**
 * 核心:计算某用户可用 Linduo 模型
 * = (tier 关联 ∪ user 例外 GRANT) − user 例外 REVOKE,再 ∩ enabled=true
 */
export async function getAvailableModelsForUser(userId: string): Promise<Array<{
  id: string
  modelId: string
  vendor: string
  displayName: string
  description: string | null
  contextLabel: string | null
  capabilities: string[]
  effort: string
  enabled: boolean
}>> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { linduoTierId: true }
  })
  const granted = new Set<string>()

  if (user?.linduoTierId) {
    const tierGrants = await prisma.linduoTierGrant.findMany({
      where: { tierId: user.linduoTierId },
      select: { modelId: true }
    })
    for (const t of tierGrants) granted.add(t.modelId)
  }

  const exceptions = await prisma.userLinduoException.findMany({
    where: { userId },
    select: { modelId: true, kind: true }
  })
  for (const ex of exceptions) {
    if (ex.kind === 'GRANT') granted.add(ex.modelId)
    else if (ex.kind === 'REVOKE') granted.delete(ex.modelId)
  }

  if (granted.size === 0) return []
  return prisma.linduoChatModel.findMany({
    where: { id: { in: [...granted] }, enabled: true },
    orderBy: [{ vendor: 'asc' }, { displayName: 'asc' }]
  })
}
```

- [ ] **Step 3: 跑 tsc 验证**

```bash
cd /Users/zyc/Desktop/砚都跨境-m1-linduo
pnpm tsc -p tsconfig.json --noEmit
pnpm tsc -p tsconfig.main.json --noEmit
pnpm tsc -p server/tsconfig.json --noEmit
```

预期:全绿。

- [ ] **Step 4: Commit**

```bash
git add src/shared/contracts.ts server/src/modules/linduo/chat-models-sync.ts
git commit -m "feat(server): add seedDefaultLinduoTiers + assignDefaultTierToNewUser + getAvailableModelsForUser (R-2)"
```

---

## Task 3: 启动时回填历史用户的 linduoTierId

**Files:**
- Modify: `server/src/index.ts` (启动 IIFE 调 seedDefaultLinduoTiers + 回填)

- [ ] **Step 1: 改 server/src/index.ts 启动块**

在 `server/src/index.ts` 现有 IIFE(已调 `syncLinduoChatModels` + `ensureOwnerLinduoGrants` 那段)替换为:

```typescript
void (async () => {
  try {
    const sync = await syncLinduoChatModels()
    app.log.info({ inserted: sync.inserted, updated: sync.updated, disabled: sync.disabled }, 'Linduo 聊天模型同步完成')

    const seed = await seedDefaultLinduoTiers()
    app.log.info({ inserted: seed.inserted, grants: seed.grants }, 'Linduo 模型等级 seed 完成')

    // 回填历史用户:OWNER → full,其他 → advanced
    const owners = await prisma.user.findMany({ where: { isOwner: true }, select: { id: true, orgId: true } })
    for (const owner of owners) {
      const full = await prisma.linduoModelTier.findFirst({ where: { orgId: owner.orgId, key: 'full' }, select: { id: true } })
      if (full) await prisma.user.update({ where: { id: owner.id }, data: { linduoTierId: full.id } })
    }
    const othersWithoutTier = await prisma.user.findMany({
      where: { isOwner: false, linduoTierId: null },
      select: { id: true, orgId: true }
    })
    for (const u of othersWithoutTier) {
      const advanced = await prisma.linduoModelTier.findFirst({ where: { orgId: u.orgId, key: 'advanced' }, select: { id: true } })
      if (advanced) await prisma.user.update({ where: { id: u.id }, data: { linduoTierId: advanced.id } })
    }
    app.log.info({ owners: owners.length, others: othersWithoutTier.length }, '历史用户 Linduo 等级回填完成')
  } catch (err) {
    app.log.error({ err }, 'Linduo 启动流程失败')
  }
})()
```

并从 import 删除 `ensureOwnerLinduoGrants`(已被 tier 替代),加 `seedDefaultLinduoTiers`。

- [ ] **Step 2: 跑 tsc 验证**

```bash
cd /Users/zyc/Desktop/砚都跨境-m1-linduo
pnpm tsc -p server/tsconfig.json --noEmit
```

预期:全绿。

- [ ] **Step 3: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(server): seed tiers on startup and backfill existing users' linduoTierId (R-2)"
```

---

## Task 4: 后端 API 改造(替换 user 粒度为 tier + exception)

**Files:**
- Modify: `server/src/modules/linduo/chat-models-routes.ts` (替换 grants 端点)

- [ ] **Step 1: 替换路由表**

把 `/api/linduo/grants` (GET/POST/DELETE) 替换为:

```typescript
// GET /api/linduo/tiers - 列出所有 tier
fastify.get('/tiers', { preHandler: requireMemberManage }, async (req) => {
  const tiers = await prisma.linduoModelTier.findMany({
    where: { orgId: req.user.orgId },
    orderBy: { displayOrder: 'asc' }
  })
  return tiers
})

// GET /api/linduo/tiers/:id/grants - 该 tier 已分配的 model
fastify.get<{ Params: { id: string } }>('/tiers/:id/grants', { preHandler: requireMemberManage }, async (req) => {
  const grants = await prisma.linduoTierGrant.findMany({
    where: { tierId: req.params.id },
    include: { model: true }
  })
  return grants.map(g => g.model)
})

// PUT /api/linduo/tiers/:id/grants - body: { modelIds: string[] } 增量设置
fastify.put<{ Params: { id: string }; Body: { modelIds: string[] } }>(
  '/tiers/:id/grants',
  { preHandler: requireMemberManage },
  async (req) => {
    const { modelIds } = req.body
    // 校验 modelIds 全部存在
    const validModels = await prisma.linduoChatModel.findMany({
      where: { modelId: { in: modelIds } },
      select: { id: true, modelId: true }
    })
    const validPks = new Set(validModels.map(m => m.id))

    // 删旧,插新(简单粗暴,可优化为 diff)
    await prisma.linduoTierGrant.deleteMany({ where: { tierId: req.params.id } })
    for (const m of validModels) {
      await prisma.linduoTierGrant.create({
        data: { tierId: req.params.id, modelId: m.id, grantedBy: req.user.id }
      })
    }
    return await prisma.linduoChatModel.findMany({
      where: { id: { in: [...validPks] } }
    })
  }
)

// PUT /api/linduo/users/:id/tier - body: { tierId: string | null }
fastify.put<{ Params: { id: string }; Body: { tierId: string | null } }>(
  '/users/:id/tier',
  { preHandler: requireMemberManage },
  async (req) => {
    const { tierId } = req.body
    if (tierId !== null) {
      const tier = await prisma.linduoModelTier.findFirst({
        where: { id: tierId, orgId: req.user.orgId }
      })
      if (!tier) throw new Error('TIER_NOT_FOUND')
    }
    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { linduoTierId: tierId },
      select: { id: true, linduoTierId: true }
    })
    return updated
  }
)

// GET /api/linduo/users/:id/exceptions
fastify.get<{ Params: { id: string } }>(
  '/users/:id/exceptions',
  { preHandler: requireMemberManage },
  async (req) => {
    return prisma.userLinduoException.findMany({
      where: { userId: req.params.id },
      include: { model: { select: { displayName: true, vendor: true, modelId: true } } }
    })
  }
)

// PUT /api/linduo/users/:id/exceptions - body: { exceptions: Array<{ modelId, kind }> }
fastify.put<{ Params: { id: string }; Body: { exceptions: Array<{ modelId: string; kind: 'GRANT' | 'REVOKE' }> } }>(
  '/users/:id/exceptions',
  { preHandler: requireMemberManage },
  async (req) => {
    const { exceptions } = req.body
    // 校验 modelId 全部存在
    const validModels = await prisma.linduoChatModel.findMany({
      where: { modelId: { in: exceptions.map(e => e.modelId) } },
      select: { id: true, modelId: true }
    })
    const modelIdToPk = new Map(validModels.map(m => [m.modelId, m.id]))

    await prisma.userLinduoException.deleteMany({ where: { userId: req.params.id } })
    for (const ex of exceptions) {
      const pk = modelIdToPk.get(ex.modelId)
      if (!pk) continue
      await prisma.userLinduoException.create({
        data: { userId: req.params.id, modelId: pk, kind: ex.kind, grantedBy: req.user.id }
      })
    }
    return prisma.userLinduoException.findMany({ where: { userId: req.params.id } })
  }
)
```

并把现有 `/api/linduo/grants` (GET/POST/DELETE) 整段删掉。

- [ ] **Step 2: 校验 `linduo:list-chat-models` 用 `getAvailableModelsForUser`**

找到现有 `GET /chat-models` 端点,改为:

```typescript
fastify.get('/chat-models', { preHandler: requireLogin }, async (req) => {
  return getAvailableModelsForUser(req.user.id)
})
```

- [ ] **Step 3: 跑 tsc 验证**

```bash
cd /Users/zyc/Desktop/砚都跨境-m1-linduo
pnpm tsc -p server/tsconfig.json --noEmit
```

预期:全绿。

- [ ] **Step 4: Commit**

```bash
git add server/src/modules/linduo/chat-models-routes.ts
git commit -m "feat(server): replace user grants API with tier + exception API (R-2)"
```

---

## Task 5: 主进程 IPC 桥改造(替换 6 个 + 删 3 个)

**Files:**
- Modify: `src/main/main.ts` (改 ipcMain 注册)
- Modify: `src/preload/index.ts` (改 desktop.linduo 暴露)
- Modify: `src/renderer/serverApi.ts` (改 API wrapper)

- [ ] **Step 1: 在 serverApi.ts 改 6 个新 API wrapper,删 3 个旧**

替换 `setGrant` / `revokeGrant` / `listGrants` 为:

```typescript
export async function listLinduoTiers(): Promise<LinduoModelTierView[]> { ... }
export async function getLinduoTierGrants(tierId: string): Promise<LinduoChatModelView[]> { ... }
export async function setLinduoTierGrants(tierId: string, modelIds: string[]): Promise<LinduoChatModelView[]> { ... }
export async function setLinduoUserTier(userId: string, tierId: string | null): Promise<{ userId: string; tierId: string | null }> { ... }
export async function getLinduoUserExceptions(userId: string): Promise<LinduoExceptionView[]> { ... }
export async function setLinduoUserExceptions(userId: string, exceptions: Array<{ modelId: string; kind: 'GRANT' | 'REVOKE' }>): Promise<LinduoExceptionView[]> { ... }
```

并删 `setGrant` / `revokeGrant` / `listGrants`(如果有)。改 `listChatModels` 内部实现(走 IPC `linduo:list-chat-models`,server 端会自己用 `getAvailableModelsForUser`)。

- [ ] **Step 2: 在 preload/index.ts 改 desktop.linduo**

替换:

```typescript
linduo: {
  listChatModels: () => ipcRenderer.invoke('linduo:list-chat-models'),
  listAllChatModels: () => ipcRenderer.invoke('linduo:list-all-chat-models'),
  setChatModelEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('linduo:set-chat-model-enabled', { id, enabled }),
  listTiers: () => ipcRenderer.invoke('linduo:list-tiers'),
  getTierGrants: (tierId: string) => ipcRenderer.invoke('linduo:get-tier-grants', tierId),
  setTierGrants: (tierId: string, modelIds: string[]) => ipcRenderer.invoke('linduo:set-tier-grants', tierId, modelIds),
  setUserTier: (userId: string, tierId: string | null) => ipcRenderer.invoke('linduo:set-user-tier', userId, tierId),
  getUserExceptions: (userId: string) => ipcRenderer.invoke('linduo:get-user-exceptions', userId),
  setUserExceptions: (userId: string, exceptions: Array<{ modelId: string; kind: 'GRANT' | 'REVOKE' }>) => ipcRenderer.invoke('linduo:set-user-exceptions', userId, exceptions),
  getPreferredModel: () => ipcRenderer.invoke('linduo:get-preferred-model'),
  setPreferredModel: (modelId: string | null) => ipcRenderer.invoke('linduo:set-preferred-model', modelId)
}
```

删 `setGrant` / `revokeGrant` / `listGrants`。

- [ ] **Step 3: 在 main.ts 改 ipcMain 注册**

替换 3 个旧 handler,加 6 个新 handler。每个都走 `callWithToken` + `fetch("http://localhost:PORT/api/linduo/...")`。

- [ ] **Step 4: 跑 tsc 验证**

```bash
cd /Users/zyc/Desktop/砚都跨境-m1-linduo
pnpm tsc --noEmit
pnpm tsc -p tsconfig.main.json --noEmit
```

预期:全绿。

- [ ] **Step 5: Commit**

```bash
git add src/main/main.ts src/preload/index.ts src/renderer/serverApi.ts
git commit -m "feat(electron): replace user-grant IPC with tier + exception IPC (R-2)"
```

---

## Task 6: LinduoAssignmentModal(admin 齿轮弹,双栏穿梭)

**Files:**
- Create: `src/renderer/LinduoAssignmentModal.tsx`
- Create: `src/renderer/linduoModal.css`

- [ ] **Step 1: 写 css**

```css
.linduo-modal-backdrop { /* 复用 .settings-backdrop 样式 */ }
.linduo-modal-card { /* 居中卡片 ~ 900x600 */ }
.linduo-modal-head { display: flex; justify-content: space-between; }
.linduo-tier-tabs { display: flex; gap: 12px; margin: 16px 0; }
.linduo-tier-tab { padding: 8px 16px; border: 1px solid; border-radius: 8px; cursor: pointer; }
.linduo-tier-tab.active { background: #1a73e8; color: white; }
.linduo-transfer { display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; }
.linduo-pane { border: 1px solid; border-radius: 8px; padding: 12px; min-height: 400px; }
.linduo-pane-title { font-weight: 600; margin-bottom: 8px; }
.linduo-pane-list { list-style: none; padding: 0; margin: 0; max-height: 360px; overflow-y: auto; }
.linduo-pane-row { padding: 8px; cursor: pointer; border-radius: 4px; }
.linduo-pane-row:hover { background: #f0f0f0; }
.linduo-pane-row.selected { background: #e3f2fd; }
.linduo-transfer-arrows { display: flex; flex-direction: column; justify-content: center; gap: 8px; }
.linduo-arrow-btn { padding: 8px 12px; }
.linduo-modal-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
```

- [ ] **Step 2: 写组件**

`src/renderer/LinduoAssignmentModal.tsx`(约 200 行):

- props:`{ onClose: () => void }`
- 状态:`tiers: LinduoModelTierView[]`、`selectedTierId: string | null`、`allModels: LinduoChatModelView[]`、`grantedModelIds: Set<string>`、`availableSelected: Set<string>`、`grantedSelected: Set<string>`、`saving: boolean`
- 加载:`useEffect` 调 `listLinduoTiers()` + `listAllChatModels()`
- 切 tier:调 `getLinduoTierGrants(tierId)` 更新 `grantedModelIds`
- ← 按钮:把 `availableSelected` 移入 `grantedModelIds`
- → 按钮:把 `grantedSelected` 移出 `grantedModelIds`
- 保存:`setLinduoTierGrants(tierId, [...grantedModelIds])` → onClose
- 空状态 / full tier 时全开(只显示右栏 + 灰字)逻辑

- [ ] **Step 3: 跑 tsc**

```bash
cd /Users/zyc/Desktop/砚都跨境-m1-linduo
pnpm tsc --noEmit
```

预期:全绿。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/LinduoAssignmentModal.tsx src/renderer/linduoModal.css
git commit -m "feat(renderer): add LinduoAssignmentModal (admin tier-based transfer UI) (R-2)"
```

---

## Task 7: LinduoPreferenceModal + LinduoExceptionModal(普通用户)

**Files:**
- Create: `src/renderer/LinduoPreferenceModal.tsx`
- Create: `src/renderer/LinduoExceptionModal.tsx`

- [ ] **Step 1: 写 LinduoPreferenceModal(~120 行)**

- props:`{ onClose: () => void }`
- 加载:`useEffect` 调 `listChatModels()`(自己用户可用) + `getUserExceptions(userId)` + 当前用户的 tier
- 顶部:「当前等级:{tier.name}」
- 列表:展示 `listChatModels()` 返回的 models(每行 ✓ icon)
- 底部:「修改我的特例」按钮 → `setExceptionModalOpen(true)`

- [ ] **Step 2: 写 LinduoExceptionModal(~180 行)**

- props:`{ userId: string, userName: string, onClose: () => void }`
- 复用 LinduoAssignmentModal 的双栏穿梭 UI(抽出 `<LinduoTransferPanel>` 子组件更佳,但本次不要求,直接复制)
- 左:全 enabled models;右:当前 exceptions(`kind === 'GRANT'` 视为"在右栏",`kind === 'REVOKE'` 视为"在左栏但划线")
- 每行:✓(GRANT)/✗(REVOKE)图标
- 保存:`setUserExceptions(userId, [...])` → onClose
- 顶部:「{userName} 的 Linduo 特例」+ 副标题「基础等级:{tier.name};特例优先级高于等级」

- [ ] **Step 3: 跑 tsc**

```bash
cd /Users/zyc/Desktop/砚都跨境-m1-linduo
pnpm tsc --noEmit
```

预期:全绿。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/LinduoPreferenceModal.tsx src/renderer/LinduoExceptionModal.tsx
git commit -m "feat(renderer): add LinduoPreferenceModal + LinduoExceptionModal (R-2)"
```

---

## Task 8: App.tsx 齿轮触发 modal

**Files:**
- Modify: `src/renderer/App.tsx:1343-1344`(齿轮 onClick)
- Modify: `src/renderer/App.tsx`(加 useState 控制 modal 开合)

- [ ] **Step 1: 改齿轮 onClick**

把 `onClick={()=>setPage('system-admin')}` 改为:

```typescript
onClick={() => setOpenLinduoModal(true)}
```

并加 state:

```typescript
const [openLinduoModal, setOpenLinduoModal] = useState(false)
```

- [ ] **Step 2: 加 modal 渲染(根据 useSession().profile.isOwner 判断弹哪个)**

在 `</section>` 末尾加:

```tsx
{openLinduoModal && profile?.isOwner && (
  <LinduoAssignmentModal onClose={() => setOpenLinduoModal(false)} />
)}
{openLinduoModal && !profile?.isOwner && (
  <LinduoPreferenceModal onClose={() => setOpenLinduoModal(false)} />
)}
```

并在文件顶 import 两个 modal。

- [ ] **Step 3: 跑 tsc + build**

```bash
cd /Users/zyc/Desktop/砚都跨境-m1-linduo
pnpm tsc --noEmit
pnpm build
```

预期:全绿。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat(renderer): wire sidebar settings gear to Linduo assignment/preference modal (R-2)"
```

---

## Task 9: OnlineAdvisor 右下角下拉改造

**Files:**
- Modify: `src/renderer/OnlineAdvisorExperience.tsx`(L155-178 现有 permissionOptions + modelOptions 替换)
- Modify: `src/renderer/OnlineAdvisorExperience.tsx`(useEffect 合并 Linduo)
- Modify: `src/renderer/online-advisor-experience.css`(右下角下拉样式)

- [ ] **Step 1: 替换 `permissionOptions` + `modelOptions` 为统一 `availableModels`**

在 OnlineAdvisorExperience.tsx 现有 modelOptions 段后加:

```typescript
const [linduoOptions, setLinduoOptions] = useState<Array<{
  id: string
  name: string
  vendor: string
  contextLabel: string | null
  isLinduo: boolean
}>>([])

useEffect(() => {
  void window.desktop.linduo.listChatModels().then(models => {
    setLinduoOptions(models.map(m => ({
      id: `linduo:${m.modelId}`,
      name: m.displayName,
      vendor: m.vendor,
      contextLabel: m.contextLabel,
      isLinduo: true
    })))
  })
}, [])
```

- [ ] **Step 2: 改右下角下拉 JSX**

把现有 `<select>` 或下拉组件改为:

```tsx
<select value={selectedModelId} onChange={e => setSelectedModelId(e.target.value)}>
  <optgroup label="Codex(原 DeepSeek)">
    <option value="deepseek/deepseek-v4-flash">DeepSeek V4 Flash · 更快</option>
    <option value="deepseek/deepseek-v4-pro">DeepSeek V4 Pro · 更强</option>
  </optgroup>
  {linduoOptions.length > 0 && (
    <optgroup label="Linduo 零度API 聚合">
      {linduoOptions.map(opt => (
        <option key={opt.id} value={opt.id}>
          {opt.name}{opt.contextLabel ? ` · ${opt.contextLabel}` : ''} · {opt.vendor}(经零度API)
        </option>
      ))}
    </optgroup>
  )}
</select>
```

并删 `permissionOptions`(完全访问权限语义由 Linduo 模型隐式表达:Linduo 模型默认走零度API proxy,无 Codex 沙箱)。

- [ ] **Step 3: 改 readPreferredModel**

把现有 `readPreferredModel` 改为:

```typescript
async function readPreferredModel() {
  const { modelId } = await window.desktop.linduo.getPreferredModel()
  if (modelId) {
    setSelectedModelId(`linduo:${modelId}`)
  } else {
    setSelectedModelId('deepseek/deepseek-v4-flash')  // fallback
  }
}
```

- [ ] **Step 4: 改 selectPreferredModel**

```typescript
async function selectPreferredModel(modelId: string) {
  if (modelId.startsWith('linduo:')) {
    const realId = modelId.replace(/^linduo:/, '')
    await window.desktop.linduo.setPreferredModel(realId)
  } else {
    await window.desktop.linduo.setPreferredModel(null)  // Codex 走旧逻辑
  }
  setSelectedModelId(modelId)
}
```

- [ ] **Step 5: 改 css**

把 `.composer-permission-picker` 改名为 `.composer-model-picker`,样式保留(下拉)。

- [ ] **Step 6: 跑 tsc + build**

```bash
cd /Users/zyc/Desktop/砚都跨境-m1-linduo
pnpm tsc --noEmit
pnpm build
```

预期:全绿。

- [ ] **Step 7: Commit**

```bash
git add src/renderer/OnlineAdvisorExperience.tsx src/renderer/online-advisor-experience.css
git commit -m "feat(advisor): replace bottom-right picker with Linduo model dropdown (R-2)"
```

---

## Task 10: SystemAdmin 成员行改造(删旧 Linduo 选用按钮,加 tier 下拉 + 例外按钮)

**Files:**
- Modify: `src/renderer/SystemAdmin.tsx`(L194-213 成员行 actions 段)
- Modify: `src/renderer/SystemAdmin.tsx`(删 linduoAssignTarget / linduoAllModels / linduoUserGrants state,加 tiers + exceptions state)

- [ ] **Step 1: 删旧 Linduo 选用 state 和 modal**

删除 `linduoAssignTarget` / `linduoAllModels` / `linduoUserGrants` state 和它们的相关函数(`onAssignLinduo` prop 等)。

- [ ] **Step 2: 加新 state + 加载**

```typescript
const [linduoTiers, setLinduoTiers] = useState<LinduoModelTierView[]>([])
const [exceptionTarget, setExceptionTarget] = useState<MemberView | null>(null)
const [memberTiers, setMemberTiers] = useState<Record<string, string | null>>({})

useEffect(() => {
  if (tab === 'members' && pageAllowed('system-admin')) {
    void window.desktop.linduo.listTiers().then(setLinduoTiers)
  }
}, [tab])
```

- [ ] **Step 3: 改成员行 actions**

L194-213 段:

```tsx
{member.isOwner ? (
  <>
    <button onClick={() => { setChangingPwd(true); setOldPassword(''); setNewPassword(''); setMessage('') }}>修改密码</button>
    <span className="member-action-note">全部已开放</span>
  </>
) : editing ? (
  /* ... 保留编辑模式 ... */
) : (
  <>
    <button onClick={startEdit}>编辑</button>
    <label className="member-linduo-tier">
      Linduo 等级:
      <select
        value={memberTiers[member.id] ?? ''}
        onChange={e => {
          const tierId = e.target.value || null
          setMemberTiers(prev => ({ ...prev, [member.id]: tierId }))
          void window.desktop.linduo.setUserTier(member.id, tierId)
        }}
      >
        <option value="">(无)</option>
        {linduoTiers.map(t => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
    </label>
    <button onClick={() => setExceptionTarget(member)}>Linduo 例外</button>
    {member.status === 'ACTIVE'
      ? <button className="danger" onClick={() => void toggleStatus()}>禁用</button>
      : <button onClick={() => void toggleStatus()}>启用</button>}
    <button className="danger" onClick={() => void doDelete()}>删除</button>
  </>
)}
```

- [ ] **Step 4: 加 exceptionTarget 渲染**

```tsx
{exceptionTarget && (
  <LinduoExceptionModal
    userId={exceptionTarget.id}
    userName={exceptionTarget.name}
    onClose={() => setExceptionTarget(null)}
  />
)}
```

- [ ] **Step 5: 跑 tsc + build**

```bash
cd /Users/zyc/Desktop/砚都跨境-m1-linduo
pnpm tsc --noEmit
pnpm build
```

预期:全绿。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/SystemAdmin.tsx
git commit -m "feat(system-admin): replace per-user Linduo grant with tier dropdown + exception button (R-2)"
```

---

## Task 11: 全量验证 + 收尾

**Files:** (无新增)

- [ ] **Step 1: 跑全量 typecheck + build**

```bash
cd /Users/zyc/Desktop/砚都跨境-m1-linduo
pnpm tsc --noEmit
pnpm tsc -p tsconfig.main.json --noEmit
pnpm tsc -p server/tsconfig.json --noEmit
pnpm build
```

预期:全绿。

- [ ] **Step 2: 跑 dev server + 手动验证 10 条**

(参 spec §10 验收 1-10)

- [ ] **Step 3: 跑 lint(如果有)**

```bash
pnpm lint 2>/dev/null || echo "no lint config"
```

- [ ] **Step 4: 删旧 LinduoModelPickerModal 文件(如果不再用)**

M1 旧 `LinduoModelPickerModal.tsx` 由 R-2 的 `LinduoPreferenceModal` + `LinduoAssignmentModal` 替代,删除。

```bash
rm src/renderer/LinduoModelPickerModal.tsx src/renderer/linduoModelPickerModal.css
```

- [ ] **Step 5: 跑 build 再确认**

```bash
pnpm build
```

预期:全绿(确认删除无遗漏引用)。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove obsolete LinduoModelPickerModal from M1 (R-2 cleanup)"
```

---

## Self-Review Checklist(写完 plan 后,逐项对照 spec)

- [x] spec §2 决定清单 10 条全部覆盖(任务 1-10 各对应)
- [x] spec §3 数据层 3 张新表 + User 字段都在 Task 1
- [x] spec §4 启动 sync + seed 在 Task 2-3
- [x] spec §4.3 `getAvailableModelsForUser` 在 Task 2(签名 / 公式与 spec 一致)
- [x] spec §5 API 11 个端点都在 Task 4-5
- [x] spec §6.3 IPC 调整在 Task 5
- [x] spec §7.1 LinduoAssignmentModal 在 Task 6
- [x] spec §7.2 LinduoPreferenceModal 在 Task 7
- [x] spec §7.3 LinduoExceptionModal 在 Task 7
- [x] spec §7.4 OnlineAdvisor 右下角下拉在 Task 9
- [x] spec §7.5 SystemAdmin 成员行在 Task 10
- [x] spec §10 验收 1-15 在 Task 11 验证

---

## 执行说明

- 每个 Task 自包含,可独立 commit + 验证
- TDD:本计划不要求新写单元测试(因为 M1 也没有),但每个 Task 的 tsc 必跑过才能 commit
- 派发方式:用 subagent-driven-development 流程,每个 Task 派发 1 个 implementer subagent + 2 个 reviewer(spec + quality)
- 全部完成后:Squash merge `feat/linduo-model-selection-m1` → main(32 commits → 1),清理 worktree,写 task_summary 长期记忆
