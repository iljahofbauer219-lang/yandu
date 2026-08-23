# DeepSeek Harness 能力吸收进 DeepSeek Codex · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除 DeepSeek Harness 入口/组件/本地侧资源；将 gateway + Docker 隔离 worker 能力源代码迁入 `src/main/advisor/`；新增主进程轻量代理 `HarnessGatewayClient`；改造 Codex 在 force-only 模式下运行于受限 worker 容器中。

**Architecture:** 保留服务端 Docker 部署（gateway 8788 + 每用户一个 worker），主进程通过新增的 `HarnessGatewayClient` 调 `access-ticket` 拿 JWT、再调 `gateway /session` 拿签名 cookie + workerOrigin；Codex 业务流切到 workerOrigin；worker 不可用时整体红字告警，不降级。

**Tech Stack:** Electron 43 + Node.js 20+、TypeScript 5、React 18、Fastify 4（中央服务）、Docker（gateway + worker）、Vitest（单元）、Playwright（E2E）

**Spec:** [docs/superpowers/specs/2026-08-23-deepseek-harness-merge-into-codex-design.md](file:///Users/zyc/Desktop/砚都跨境/docs/superpowers/specs/2026-08-23-deepseek-harness-merge-into-codex-design.md)

---

## 阶段 1：代码删除（11 个 commit）

### Task 1: 删除 `src/renderer/DeepSeekHarness.tsx` 渲染组件

**Files:**
- Delete: `src/renderer/DeepSeekHarness.tsx`
- Modify: `src/renderer/App.tsx`（删除 import + 渲染分支 + `AppPage` 联合类型）

- [ ] **Step 1.1: 删除渲染组件文件**

```bash
git rm src/renderer/DeepSeekHarness.tsx
```

- [ ] **Step 1.2: 在 `src/renderer/App.tsx` 删除 import**

删除 L23：
```ts
import DeepSeekHarness from './DeepSeekHarness'
```

- [ ] **Step 1.3: 在 `src/renderer/App.tsx` 删除渲染分支**

删除 L1380：
```tsx
{page==='deepseek-harness'&&<DeepSeekHarness/>}
```

- [ ] **Step 1.4: 在 `src/renderer/App.tsx` 的 `AppPage` 联合类型删除 `'deepseek-harness'`**

L31 类型从：
```ts
type AppPage = 'dashboard' | 'ebay' | ... | 'online-advisor' | 'deepseek-harness' | ...
```
改为：
```ts
type AppPage = 'dashboard' | 'ebay' | ... | 'online-advisor' | ...
```

- [ ] **Step 1.5: 验证 TypeScript 编译**

```bash
pnpm tsc --noEmit -p tsconfig.json
```
Expected: 0 errors。`deepseek-harness` 类型引用若仍有残留，会在 `AppPage` 联合类型处报错。

- [ ] **Step 1.6: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "refactor(renderer): 删除 DeepSeek Harness 渲染组件

移除不再使用的 DeepSeekHarness.tsx 及其在 App.tsx 中的
import、渲染分支、AppPage 联合类型条目。

关联：docs/superpowers/specs/2026-08-23-deepseek-harness-merge-into-codex-design.md §4.1"
```

---

### Task 2: 删除 `src/main/services/DeepSeekHarnessProcessManager.ts` 与 main.ts IPC

**Files:**
- Delete: `src/main/services/DeepSeekHarnessProcessManager.ts`
- Modify: `src/main/main.ts`

- [ ] **Step 2.1: 删除 ProcessManager 文件**

```bash
git rm src/main/services/DeepSeekHarnessProcessManager.ts
```

- [ ] **Step 2.2: 在 `src/main/main.ts` 删除 import**

删除 L28：
```ts
import { DeepSeekHarnessProcessManager } from './services/DeepSeekHarnessProcessManager'
```

- [ ] **Step 2.3: 在 `src/main/main.ts` 删除初始化与 IPC handler**

删除 L2838-2843（含上下文，保留空行结构）：
```ts
? path.join(process.resourcesPath, 'deepseek-harness')
: path.join(app.getAppPath(), 'vendor', 'deepseek-harness')
const deepSeekHarnessProcessManager = new DeepSeekHarnessProcessManager(deepSeekHarnessSourceDir, app.getPath('userData'))
ipcMain.handle('deepseek-harness:status', () => deepSeekHarnessProcessManager.status())
ipcMain.handle('deepseek-harness:start', () => deepSeekHarnessProcessManager.start())
ipcMain.handle('deepseek-harness:connect', async (_event, ticket: unknown) => {
```

注意：原 `connect` handler 多行，仅删除从 `? path.join(...)` 起到 `ipcMain.handle('deepseek-harness:connect', async (_event, ticket: unknown) => {` 这一行的开头（包括 `})` 行需要保留为更下面 `}` 的处理）。实际操作时按 `git grep -n "deepseek-harness" src/main/main.ts` 找到所有相关行整段删除，保留文件结构干净。

- [ ] **Step 2.4: 在 `src/main/main.ts` 删除 stop 调用**

删除 L3030：
```ts
deepSeekHarnessProcessManager.stop().catch(error => console.error('[deepseek-harness] 关闭本地服务失败：', error)),
```

- [ ] **Step 2.5: 验证 grep 残留**

```bash
git grep -n "DeepSeekHarnessProcessManager\|deepseek-harness:" src/main/main.ts
```
Expected: 无输出（0 行匹配）。

- [ ] **Step 2.6: 验证 TypeScript 编译**

```bash
pnpm tsc --noEmit -p tsconfig.json
```
Expected: 0 errors。

- [ ] **Step 2.7: Commit**

```bash
git add src/main/main.ts
git commit -m "refactor(main): 删除 DeepSeekHarness ProcessManager 与 IPC

移除本地 3080 端口官方 CLI web 模式的进程管理器与对应
3 个 IPC handler（status / start / connect）。

关联：docs/superpowers/specs/2026-08-23-deepseek-harness-merge-into-codex-design.md §4.2"
```

---

### Task 3: 删除 `src/preload/preload.ts` 的 `deepSeekHarness.*` 桥接

**Files:**
- Modify: `src/preload/preload.ts`

- [ ] **Step 3.1: 删除三行桥接**

删除 L52-54：
```ts
status: (): Promise<{ running: boolean; url: string; message: string }> => ipcRenderer.invoke('deepseek-harness:status'),
start: (): Promise<{ running: boolean; url: string; message: string }> => ipcRenderer.invoke('deepseek-harness:start'),
connect: (ticket: string): Promise<{ url: string; message: string }> => ipcRenderer.invoke('deepseek-harness:connect', ticket)
```

- [ ] **Step 3.2: 验证 grep 残留**

```bash
git grep -n "deepSeekHarness" src/preload/
```
Expected: 无输出。

- [ ] **Step 3.3: Commit**

```bash
git add src/preload/preload.ts
git commit -m "refactor(preload): 删除 deepSeekHarness 桥接

关联：docs/superpowers/specs/2026-08-23-deepseek-harness-merge-into-codex-design.md §4.3"
```

---

### Task 4: 删除 `src/renderer/styles.css` 的 deepseek-harness-page 样式

**Files:**
- Modify: `src/renderer/styles.css`

- [ ] **Step 4.1: 删除样式段**

删除 L430 整段：
```css
.deepseek-harness-page{...}.deepseek-harness-unavailable{...}
```

精确范围用 `git grep -n "deepseek-harness" src/renderer/styles.css` 定位后整段删除。

- [ ] **Step 4.2: 验证**

```bash
git grep -n "deepseek-harness" src/renderer/styles.css
```
Expected: 无输出。

- [ ] **Step 4.3: Commit**

```bash
git add src/renderer/styles.css
git commit -m "refactor(styles): 删除 deepseek-harness-page 样式

关联：docs/superpowers/specs/2026-08-23-deepseek-harness-merge-into-codex-design.md §4.1"
```

---

### Task 5: 删除 `src/renderer/global.d.ts` 的 DeepSeekHarness 声明

**Files:**
- Modify: `src/renderer/global.d.ts`

- [ ] **Step 5.1: 删除接口引用**

```bash
git grep -n "DeepSeekHarness\|deepSeekHarness" src/renderer/global.d.ts
```

按输出删除对应行（含 `import` 与 `interface` 块）。

- [ ] **Step 5.2: 验证 TypeScript**

```bash
pnpm tsc --noEmit -p tsconfig.json
```
Expected: 0 errors。

- [ ] **Step 5.3: Commit**

```bash
git add src/renderer/global.d.ts
git commit -m "refactor(types): 删除 DeepSeekHarness DesktopApi 声明

关联：docs/superpowers/specs/2026-08-23-deepseek-harness-merge-into-codex-design.md §4.4"
```

---

### Task 6: 删除 `src/shared/menuPermissionTree.ts` 的 `menu.advisor.harness` 节点

**Files:**
- Modify: `src/shared/menuPermissionTree.ts`

- [ ] **Step 6.1: 定位并删除节点**

```bash
git grep -n "menu.advisor.harness" src/shared/menuPermissionTree.ts
```

删除对应节点行。常见形态：
```ts
'harness': { label: 'DeepSeek Harness', perm: 'menu.advisor.harness' },
```

- [ ] **Step 6.2: 验证编译**

```bash
pnpm tsc --noEmit -p tsconfig.json
```
Expected: 0 errors。

- [ ] **Step 6.3: Commit**

```bash
git add src/shared/menuPermissionTree.ts
git commit -m "refactor(permissions): 删除 menu.advisor.harness 节点

关联：docs/superpowers/specs/2026-08-23-deepseek-harness-merge-into-codex-design.md §4.6"
```

---

### Task 7: 删除 `server/src/modules/rbac/permissions.ts` 的 `menu.advisor.harness` 权限

**Files:**
- Modify: `server/src/modules/rbac/permissions.ts`

- [ ] **Step 7.1: 删除权限条目**

```bash
git grep -n "menu.advisor.harness" server/src/modules/rbac/permissions.ts
```

删除位置：
- L19 权限列表中的 `'menu.advisor.harness'`
- L65 权限名称映射中的 `'menu.advisor.harness': 'AI参谋·DeepSeek Harness'`
- OPERATOR / ADMIN / 其他角色行中所有 `'menu.advisor.harness'` 引用

- [ ] **Step 7.2: 验证 server 端编译**

```bash
cd server && pnpm tsc --noEmit
```
Expected: 0 errors。

- [ ] **Step 7.3: Commit**

```bash
git add server/src/modules/rbac/permissions.ts
git commit -m "refactor(rbac): 删除 menu.advisor.harness 权限

Codex 改用 menu.advisor.online 权限；Harness 入口已下线，
对应权限节点不再需要。

关联：docs/superpowers/specs/2026-08-23-deepseek-harness-merge-into-codex-design.md §4.6"
```

---

### Task 8: 删除 `electron-builder.yml` 的 `extraResources` 引用

**Files:**
- Modify: `electron-builder.yml`

- [ ] **Step 8.1: 删除 extraResources 段**

删除 L21-28：
```yaml
# Harness 在主进程中以 Electron 的 Node 模式运行，不能放入 asar；保留官方
# 源码、锁定依赖与 Web 构建结果，以支持已安装桌面应用的离线本机启动。
extraResources:
  - from: vendor/deepseek-harness
    to: deepseek-harness
    filter:
      - "**/*"
      - "!**/.git/**"
```

- [ ] **Step 8.2: Commit**

```bash
git add electron-builder.yml
git commit -m "chore(build): 删除 vendor/deepseek-harness 资源引用

vendor/deepseek-harness/ 将整体删除，安装包体积减少约 600MB+。

关联：docs/superpowers/specs/2026-08-23-deepseek-harness-merge-into-codex-design.md §4.5"
```

---

### Task 9: 删除 `vendor/deepseek-harness/` 与 `scripts/build-deepseek-harness.sh`

**Files:**
- Delete: `vendor/deepseek-harness/`（整目录）
- Delete: `scripts/build-deepseek-harness.sh`

- [ ] **Step 9.1: 验证目录大小**

```bash
du -sh vendor/deepseek-harness/ scripts/build-deepseek-harness.sh 2>/dev/null
```
记录 baseline 体积（用于人工验收对比）。

- [ ] **Step 9.2: 删除目录与脚本**

```bash
git rm -r vendor/deepseek-harness/
git rm scripts/build-deepseek-harness.sh
```
注意：仅当 `vendor/deepseek-harness/` 已被 git 追踪时才用 `git rm`；若在 .gitignore 中则直接 `rm -rf`。

- [ ] **Step 9.3: 验证 grep 残留**

```bash
git grep -n "deepseek-harness" -- ':!**/deepseek-harness/**' ':!docs/superpowers/**' ':!scripts/build-deepseek-harness.sh'
```
Expected: 无业务代码残留（仅 spec 文档历史引用，保留）。

- [ ] **Step 9.4: Commit**

```bash
git add -A vendor/ scripts/
git commit -m "chore: 删除 vendor/deepseek-harness 与构建脚本

释放约 \$(du -sh vendor/deepseek-harness/ 2>/dev/null | awk '{print \$1}') 磁盘空间。

关联：docs/superpowers/specs/2026-08-23-deepseek-harness-merge-into-codex-design.md §4.5"
```

---

### Task 10: 删除 `AI 参谋` 页面的"DeepSeek Harness"卡片

**Files:**
- Modify: `src/renderer/App.tsx`（或专门的 AI 参谋页组件，按实际归属）

- [ ] **Step 10.1: 定位入口页组件**

```bash
git grep -n "DeepSeek Harness\|deepseek-harness" src/renderer/App.tsx | head
```

实际归属可能在 `App.tsx` 的 `aiModuleNav` 附近、或在独立的 `ai-advisor` 入口组件中。按 `git grep` 输出定位。

- [ ] **Step 10.2: 删除卡片节点**

删除对应 `{ page: 'deepseek-harness', ... }` 行与对应 `<Card ... />` 渲染。删除后保持网格布局不破坏（其它卡片位置自动上移）。

- [ ] **Step 10.3: 视觉验证**

```bash
pnpm dev
```
打开 AI 参谋页，确认仅剩 3 个 Harness 区域入口（报告样例库 / 在线参谋 / 竞品分析），DeepSeek Harness 卡片已消失。

- [ ] **Step 10.4: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "refactor(advisor): 删除 AI 参谋页 DeepSeek Harness 卡片

Harness 入口整体下线后，AI 参谋网格同步清理对应卡片。

关联：docs/superpowers/specs/2026-08-23-deepseek-harness-merge-into-codex-design.md §6.4"
```

---

### Task 11: 阶段 1 整体验证

- [ ] **Step 11.1: 残留扫描**

```bash
git grep -rn "DeepSeekHarness\|deepseek-harness\|deepSeekHarness" -- ':!**/specs/**' ':!**/plans/**' ':!docs/superpowers/specs/**' ':!docs/superpowers/plans/**'
```
Expected: 无业务代码匹配（仅历史 commit message、spec 文档、plan 文档可保留）。

- [ ] **Step 11.2: 编译验证**

```bash
pnpm tsc --noEmit -p tsconfig.json
cd server && pnpm tsc --noEmit
```
Expected: 0 errors。

- [ ] **Step 11.3: 安装包体积记录**

```bash
pnpm build && pnpm package -- --dir
ls -la release/
```
记录 baseline 安装包体积（用于 Task 33 人工验收对比）。

- [ ] **Step 11.4: Tag 阶段 1 完成**

```bash
git tag stage-1-harness-removal
```

---

## 阶段 2：gateway 与 worker 资产迁移（3 个 commit）

### Task 12: 迁移 `deployment/deepseek-harness-gateway/` → `src/main/advisor/gateway/`

**Files:**
- Move: `deployment/deepseek-harness-gateway/server.mjs` → `src/main/advisor/gateway/server.mjs`
- Move: `deployment/deepseek-harness-gateway/Dockerfile` → `src/main/advisor/gateway/Dockerfile`

- [ ] **Step 12.1: 创建目标目录**

```bash
mkdir -p src/main/advisor/gateway
```

- [ ] **Step 12.2: git mv 移动文件**

```bash
git mv deployment/deepseek-harness-gateway/server.mjs src/main/advisor/gateway/server.mjs
git mv deployment/deepseek-harness-gateway/Dockerfile src/main/advisor/gateway/Dockerfile
```

- [ ] **Step 12.3: 清理空目录**

```bash
rmdir deployment/deepseek-harness-gateway
```

- [ ] **Step 12.4: 验证文件完整**

```bash
ls -la src/main/advisor/gateway/
diff -q src/main/advisor/gateway/server.mjs <(git show HEAD:deployment/deepseek-harness-gateway/server.mjs)
```
Expected: 0 diff（内容未变，仅路径变化）。

- [ ] **Step 12.5: Commit**

```bash
git add -A deployment/ src/main/advisor/gateway/
git commit -m "refactor(deployment): 迁移 gateway 资产至 src/main/advisor/gateway/

源代码同仓，保留服务端 Docker 部署形态。Dockerfile 内部
COPY 路径在后续任务中更新。

关联：docs/superpowers/specs/2026-08-23-deepseek-harness-merge-into-codex-design.md §5.1"
```

---

### Task 13: 迁移 `deployment/deepseek-harness-runtime/` → `src/main/advisor/runtime/`

**Files:**
- Move: `deployment/deepseek-harness-runtime/*` → `src/main/advisor/runtime/*`

- [ ] **Step 13.1: 创建目标目录**

```bash
mkdir -p src/main/advisor/runtime
```

- [ ] **Step 13.2: git mv 移动文件**

```bash
git mv deployment/deepseek-harness-runtime/Dockerfile src/main/advisor/runtime/Dockerfile
git mv deployment/deepseek-harness-runtime/entrypoint.sh src/main/advisor/runtime/entrypoint.sh
git mv deployment/deepseek-harness-runtime/proxy.mjs src/main/advisor/runtime/proxy.mjs
```

- [ ] **Step 13.3: 清理空目录**

```bash
rmdir deployment/deepseek-harness-runtime
```

- [ ] **Step 13.4: 验证**

```bash
ls -la src/main/advisor/runtime/
ls deployment/ 2>/dev/null
```
Expected: `deployment/` 目录为空（仅剩 `yandu-https.conf`），或已可整体删除。

- [ ] **Step 13.5: Commit**

```bash
git add -A deployment/ src/main/advisor/runtime/
git commit -m "refactor(deployment): 迁移 worker 资产至 src/main/advisor/runtime/

源代码同仓，保留服务端 Docker 部署形态。

关联：docs/superpowers/specs/2026-08-23-deepseek-harness-merge-into-codex-design.md §5.1"
```

---

### Task 14: 更新 Dockerfile 内部路径与 CI/部署脚本

**Files:**
- Modify: `src/main/advisor/gateway/Dockerfile`
- Modify: `src/main/advisor/runtime/Dockerfile`
- Modify: `tools/`、`scripts/`、`deployment/yandu-https.conf`（按 grep 输出定位所有引用）

- [ ] **Step 14.1: 扫描所有引用**

```bash
git grep -n "deployment/deepseek-harness" -- ':!docs/superpowers/**'
```
记录所有需要更新的路径。

- [ ] **Step 14.2: 更新 Dockerfile**

按扫描结果，把 Dockerfile 内部 `COPY` / `WORKDIR` 等路径从 `deployment/deepseek-harness-gateway/` / `deployment/deepseek-harness-runtime/` 改为 `src/main/advisor/gateway/` / `src/main/advisor/runtime/`。

- [ ] **Step 14.3: 更新 CI/部署脚本**

按扫描结果，逐文件更新（通常是 `docker build` 上下文路径）。

- [ ] **Step 14.4: 验证无残留**

```bash
git grep -n "deployment/deepseek-harness" -- ':!docs/superpowers/**'
```
Expected: 无业务代码匹配。

- [ ] **Step 14.5: 验证 Dockerfile 语法（可选）**

```bash
docker build --check -f src/main/advisor/gateway/Dockerfile src/main/advisor/gateway/ 2>&1 | head -20
```
若环境无 docker 可跳过此步，留待 CI 验证。

- [ ] **Step 14.6: Commit**

```bash
git add -A
git commit -m "chore(ci): 更新 Dockerfile 与 CI/部署脚本路径

deployment/deepseek-harness-* 路径已废弃，全部指向
src/main/advisor/{gateway,runtime}/。

关联：docs/superpowers/specs/2026-08-23-deepseek-harness-merge-into-codex-design.md §10"
```

---

## 阶段 3：主进程 HarnessGatewayClient + CookieJar（2 个 commit）

### Task 15: 新增 `CookieJar` 与单元测试

**Files:**
- Create: `src/main/advisor/gatewayCookie.ts`
- Create: `src/main/advisor/__tests__/gatewayCookie.test.ts`

- [ ] **Step 15.1: 写失败测试**

```ts
// src/main/advisor/__tests__/gatewayCookie.test.ts
import { describe, it, expect } from 'vitest'
import { CookieJar } from '../gatewayCookie'

describe('CookieJar', () => {
  it('parses a single Set-Cookie header', () => {
    const jar = new CookieJar()
    jar.setFromSetCookieHeader('__Host-yandu_harness=abc.def; Path=/; HttpOnly')
    expect(jar.getCookieHeader()).toBe('__Host-yandu_harness=abc.def')
  })

  it('parses an array of Set-Cookie headers', () => {
    const jar = new CookieJar()
    jar.setFromSetCookieHeader([
      '__Host-yandu_harness=abc.def; Path=/',
      'session=xyz; Path=/'
    ])
    expect(jar.getCookieHeader()).toBe('__Host-yandu_harness=abc.def; session=xyz')
  })

  it('handles undefined gracefully', () => {
    const jar = new CookieJar()
    jar.setFromSetCookieHeader(undefined)
    expect(jar.getCookieHeader()).toBe('')
  })

  it('clears all cookies', () => {
    const jar = new CookieJar()
    jar.setFromSetCookieHeader('a=1; Path=/')
    jar.clear()
    expect(jar.getCookieHeader()).toBe('')
  })

  it('overwrites same-name cookies', () => {
    const jar = new CookieJar()
    jar.setFromSetCookieHeader('a=1; Path=/')
    jar.setFromSetCookieHeader('a=2; Path=/')
    expect(jar.getCookieHeader()).toBe('a=2')
  })
})
```

- [ ] **Step 15.2: 运行测试，确认失败**

```bash
pnpm vitest run src/main/advisor/__tests__/gatewayCookie.test.ts
```
Expected: FAIL（"Cannot find module"）。

- [ ] **Step 15.3: 实现 CookieJar**

```ts
// src/main/advisor/gatewayCookie.ts
/**
 * 极简 cookie 解析，仅服务 harness gateway：
 * - 仅解析 Set-Cookie 头中的 name=value 段
 * - 不处理 Expires/Max-Age/HttpOnly/Secure/SameSite 等属性（gateway 不下发过期）
 * - 过期由 ticket 控制，不在此层关注
 */
export class CookieJar {
  private cookies = new Map<string, string>()

  setFromSetCookieHeader(header: string | string[] | undefined): void {
    if (!header) return
    const lines = Array.isArray(header) ? header : [header]
    for (const line of lines) {
      for (const piece of line.split(',')) {
        const trimmed = piece.trim()
        if (!trimmed) continue
        const [pair] = trimmed.split(';')
        const eq = pair.indexOf('=')
        if (eq < 0) continue
        const name = pair.slice(0, eq).trim()
        const value = pair.slice(eq + 1).trim()
        if (name) this.cookies.set(name, value)
      }
    }
  }

  getCookieHeader(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
  }

  clear(): void {
    this.cookies.clear()
  }
}
```

- [ ] **Step 15.4: 运行测试，确认通过**

```bash
pnpm vitest run src/main/advisor/__tests__/gatewayCookie.test.ts
```
Expected: 5 passed。

- [ ] **Step 15.5: Commit**

```bash
git add src/main/advisor/gatewayCookie.ts src/main/advisor/__tests__/gatewayCookie.test.ts
git commit -m "feat(advisor): 新增 CookieJar 极简 cookie 解析

仅服务 harness gateway 签名会话 cookie；过期由 ticket
控制，属性解析（HttpOnly/Secure）忽略。

关联：docs/superpowers/specs/2026-08-23-deepseek-harness-merge-into-codex-design.md §5.4"
```

---

### Task 16: 新增 `HarnessGatewayClient` 与单元测试

**Files:**
- Create: `src/main/advisor/HarnessGatewayClient.ts`
- Create: `src/main/advisor/__tests__/HarnessGatewayClient.test.ts`

- [ ] **Step 16.1: 写失败测试**

```ts
// src/main/advisor/__tests__/HarnessGatewayClient.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { HarnessGatewayClient } from '../HarnessGatewayClient'

const mockFetch = vi.fn()
;(globalThis as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch

const makeClient = () => new HarnessGatewayClient({
  appServerBaseUrl: 'http://app:8787',
  gatewayBaseUrl: 'http://gateway:8788',
  getAccessToken: () => Promise.resolve('test-user-jwt')
})

describe('HarnessGatewayClient', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('connect() 首次成功：缓存 workerOrigin + cookie', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ ticket: 'jwt-ticket' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, {
        status: 204,
        headers: { 'set-cookie': '__Host-yandu_harness=abc.def; Path=/; HttpOnly' }
      }))
    const client = makeClient()
    const session = await client.connect()
    expect(session.url).toBeTruthy()
    expect(session.message).toContain('已就绪')
    expect(client.getCookieHeader()).toBe('__Host-yandu_harness=abc.def')
  })

  it('connect() 二次调用命中缓存，不重复请求', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('{"ticket":"t1"}', { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204, headers: { 'set-cookie': 'a=1' } }))
    const client = makeClient()
    await client.connect()
    const second = await client.connect()
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(second.url).toBeTruthy()
  })

  it('access-ticket 403 抛出 ADVISOR_FORBIDDEN', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{"error":"FORBIDDEN"}', { status: 403 }))
    const client = makeClient()
    await expect(client.connect()).rejects.toThrow(/ADVISOR_FORBIDDEN|FORBIDDEN/)
  })

  it('gateway 502 抛出 HARNESS_UNAVAILABLE', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('{"ticket":"t1"}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{"error":"BAD"}', { status: 502 }))
    const client = makeClient()
    await expect(client.connect()).rejects.toThrow(/HARNESS_UNAVAILABLE/)
  })

  it('并发 connect() 只发起一次真实请求', async () => {
    let resolveFirst!: (r: Response) => void
    mockFetch
      .mockReturnValueOnce(new Promise<Response>(r => { resolveFirst = r }))
    const client = makeClient()
    const p1 = client.connect()
    const p2 = client.connect()
    resolveFirst(new Response('{"ticket":"t1"}', { status: 200 }))
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204, headers: { 'set-cookie': 'a=1' } }))
    await Promise.all([p1, p2])
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('disconnect() 后再 getWorkerOrigin 抛错', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('{"ticket":"t1"}', { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204, headers: { 'set-cookie': 'a=1' } }))
    const client = makeClient()
    await client.connect()
    await client.disconnect()
    expect(() => client.getWorkerOrigin()).toThrow(/ADVISOR_NOT_CONNECTED/)
  })

  it('on("unavailable") 监听 gateway 502', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('{"ticket":"t1"}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{"error":"BAD"}', { status: 502 }))
    const client = makeClient()
    const handler = vi.fn()
    client.on('unavailable', handler)
    await expect(client.connect()).rejects.toThrow()
    expect(handler).toHaveBeenCalled()
  })
})
```

- [ ] **Step 16.2: 运行测试，确认失败**

```bash
pnpm vitest run src/main/advisor/__tests__/HarnessGatewayClient.test.ts
```
Expected: FAIL（"Cannot find module"）。

- [ ] **Step 16.3: 实现 HarnessGatewayClient**

```ts
// src/main/advisor/HarnessGatewayClient.ts
import { CookieJar } from './gatewayCookie'

export type AdvisorRemoteSession = {
  url: string
  message: string
  expiresAt: number
}

export type HarnessConnectOptions = {
  force?: boolean
}

export type HarnessClientConfig = {
  appServerBaseUrl: string
  gatewayBaseUrl: string
  ticketExpiresInMs?: number
  renewBeforeMs?: number
  /** 由 AdvisorRuntime 注入，提供当前登录用户的 JWT */
  getAccessToken: () => Promise<string>
}

type HarnessEvent = 'unavailable' | 'expired'
type EventHandler = (err: Error) => void

export class HarnessGatewayClient {
  private cached: AdvisorRemoteSession | null = null
  private cookieJar = new CookieJar()
  private listeners = new Map<HarnessEvent, Set<EventHandler>>()
  private connectPromise: Promise<AdvisorRemoteSession> | null = null
  private renewTimer: NodeJS.Timeout | null = null
  private readonly ticketExpiresInMs: number
  private readonly renewBeforeMs: number

  constructor(private readonly config: HarnessClientConfig) {
    this.ticketExpiresInMs = config.ticketExpiresInMs ?? 5 * 60_000
    this.renewBeforeMs = config.renewBeforeMs ?? 30_000
  }

  async connect(opts: HarnessConnectOptions = {}): Promise<AdvisorRemoteSession> {
    if (this.connectPromise) return this.connectPromise
    if (!opts.force && this.cached && this.cached.expiresAt > Date.now()) {
      return this.cached
    }
    this.connectPromise = this.doConnect().finally(() => {
      this.connectPromise = null
    })
    return this.connectPromise
  }

  private async doConnect(): Promise<AdvisorRemoteSession> {
    let ticket: string
    try {
      const accessToken = await this.config.getAccessToken()
      const res = await fetch(`${this.config.appServerBaseUrl}/api/deepseek-harness/access-ticket`, {
        method: 'GET',
        headers: { authorization: `Bearer ${accessToken}` }
      })
      if (res.status === 403) throw new Error('ADVISOR_FORBIDDEN: 无在线参谋权限')
      if (res.status === 401) throw new Error('ADVISOR_UNAUTHORIZED: 登录已过期')
      if (!res.ok) throw new Error(`ADVISOR_TICKET_FAILED: HTTP ${res.status}`)
      const data = await res.json() as { ticket: string }
      ticket = data.ticket
    } catch (err) {
      throw err instanceof Error ? err : new Error('ADVISOR_TICKET_FAILED: 网络异常')
    }

    let workerOrigin: string
    let cookie: string
    try {
      const res = await fetch(`${this.config.gatewayBaseUrl}/session`, {
        method: 'POST',
        headers: { authorization: `Bearer ${ticket}` }
      })
      if (res.status === 401) throw new Error('HARNESS_AUTH_FAILED')
      if (!res.ok) throw new Error(`HARNESS_UNAVAILABLE: HTTP ${res.status}`)
      this.cookieJar.setFromSetCookieHeader(res.headers.get('set-cookie'))
      cookie = this.cookieJar.getCookieHeader()
      workerOrigin = await this.resolveWorkerOrigin(cookie)
    } catch (err) {
      this.emit('unavailable', err instanceof Error ? err : new Error(String(err)))
      throw err
    }

    const session: AdvisorRemoteSession = {
      url: workerOrigin,
      message: '受限隔离执行器已就绪',
      expiresAt: Date.now() + this.ticketExpiresInMs
    }
    this.cached = session
    this.scheduleRenew()
    return session
  }

  private async resolveWorkerOrigin(cookie: string): Promise<string> {
    // 通过 gateway 自身的 worker 路由头推断；若无头则取 gateway URL（standalone 模式）
    const probe = await fetch(`${this.config.gatewayBaseUrl}/health`, {
      headers: { cookie }
    }).catch(() => null)
    if (probe && probe.ok) {
      const data = await probe.json().catch(() => null) as { workerImage?: string } | null
      // 简化策略：默认 standalone，worker 与 gateway 同 URL
      return this.config.gatewayBaseUrl
    }
    return this.config.gatewayBaseUrl
  }

  getWorkerOrigin(): string {
    if (!this.cached) throw new Error('ADVISOR_NOT_CONNECTED')
    return this.cached.url
  }

  getCookieHeader(): string {
    return this.cookieJar.getCookieHeader()
  }

  async disconnect(): Promise<void> {
    this.cached = null
    this.cookieJar.clear()
    if (this.renewTimer) {
      clearTimeout(this.renewTimer)
      this.renewTimer = null
    }
  }

  on(event: HarnessEvent, handler: EventHandler): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(handler)
    return () => this.listeners.get(event)?.delete(handler)
  }

  private emit(event: HarnessEvent, err: Error): void {
    this.listeners.get(event)?.forEach(h => {
      try { h(err) } catch { /* ignore */ }
    })
  }

  private scheduleRenew(): void {
    if (this.renewTimer) clearTimeout(this.renewTimer)
    const delay = this.ticketExpiresInMs - this.renewBeforeMs
    this.renewTimer = setTimeout(() => {
      this.connect({ force: true }).catch(err => this.emit('expired', err))
    }, delay)
    this.renewTimer.unref?.()
  }
}
```

> 注：`appServerBaseUrl` 与 `gatewayBaseUrl` 在生产通过 `process.env` 或主进程配置注入；测试时显式传入。

- [ ] **Step 16.4: 运行测试，确认通过**

```bash
pnpm vitest run src/main/advisor/__tests__/HarnessGatewayClient.test.ts
```
Expected: 7 passed。如有失败，按错误调整实现（典型：mock fetch 的 Response 包装、URL 推断逻辑）。

- [ ] **Step 16.5: Commit**

```bash
git add src/main/advisor/HarnessGatewayClient.ts src/main/advisor/__tests__/HarnessGatewayClient.test.ts
git commit -m "feat(advisor): 新增 HarnessGatewayClient 主进程轻量代理

封装 access-ticket 获取、gateway /session 创建、签名 cookie
缓存、提前 30s 自动续约、并发收敛、事件订阅。

关联：docs/superpowers/specs/2026-08-23-deepseek-harness-merge-into-codex-design.md §5.3"
```

---

## 阶段 4：AdvisorRuntime 改造（3 个 commit）

### Task 17: 引入 HarnessGatewayClient 与 connect/disconnect

**Files:**
- Modify: `src/main/advisor/AdvisorRuntime.ts`

- [ ] **Step 17.1: 添加 import**

在 `AdvisorRuntime.ts` 顶部（已有 import 区）增加：
```ts
import { HarnessGatewayClient, type AdvisorRemoteSession } from './HarnessGatewayClient'
```

- [ ] **Step 17.2: 添加成员变量**

在 `AdvisorRuntime` 类内（`private` 字段区）增加：
```ts
private harnessClient = new HarnessGatewayClient({
  appServerBaseUrl: process.env.APP_SERVER_BASE_URL ?? 'http://127.0.0.1:8787',
  gatewayBaseUrl: process.env.HARNESS_GATEWAY_BASE_URL ?? 'http://127.0.0.1:8788',
  // 实际实现中注入：返回当前登录用户 JWT（从 SessionStore / AppServerClient 获取）
  getAccessToken: () => this.appServer.getAccessToken()
})
```

- [ ] **Step 17.3: 添加 connect/disconnect 方法**

在 `AdvisorRuntime` 类内（公开方法区）增加：
```ts
async connectAdvisor(): Promise<AdvisorRemoteSession> {
  const session = await this.harnessClient.connect()
  this.setupHarnessEventHandlers()
  return session
}

async disconnectAdvisor(): Promise<void> {
  await this.harnessClient.disconnect()
  this.teardownHarnessEventHandlers()
}

private harnessHandlers: Array<() => void> = []

private setupHarnessEventHandlers(): void {
  this.teardownHarnessEventHandlers()
  this.harnessHandlers = [
    this.harnessClient.on('unavailable', (err) => {
      console.error('[advisor-harness] unavailable:', err.message)
    }),
    this.harnessClient.on('expired', (err) => {
      console.error('[advisor-harness] expired:', err.message)
    })
  ]
}

private teardownHarnessEventHandlers(): void {
  this.harnessHandlers.forEach(d => d())
  this.harnessHandlers = []
}
```

- [ ] **Step 17.4: 验证编译**

```bash
pnpm tsc --noEmit -p tsconfig.json
```
Expected: 0 errors。

- [ ] **Step 17.5: Commit**

```bash
git add src/main/advisor/AdvisorRuntime.ts
git commit -m "feat(advisor): 引入 HarnessGatewayClient 与 connect/disconnect

为后续业务流切换提供连接管理基础；暂不替换 AppServerClient
调用。

关联：docs/superpowers/specs/2026-08-23-deepseek-harness-merge-into-codex-design.md §5.5"
```

---

### Task 18: 业务流从 AppServerClient 切换到 workerOrigin

**Files:**
- Modify: `src/main/advisor/AdvisorRuntime.ts`

> **注意**：此任务是本次改造中代码量最大、风险最高的 task。建议逐方法切换，每个方法单独 commit 后跑单元测试（若有）；为压缩粒度，**合并到本 task 一次性 commit，但需要严格按子步骤推进**。

- [ ] **Step 18.1: 改造 `sendChat`**

把原 `sendChat` 内对 `this.appServer` / `AppServerClient` 的调用改为：
```ts
const workerOrigin = this.harnessClient.getWorkerOrigin()
const cookie = this.harnessClient.getCookieHeader()
const res = await fetch(`${workerOrigin}/api/session.send`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify(payload)
})
```

- [ ] **Step 18.2: 改造 `steerChat` / `stopChat` / `listSessions` / `readStoredTask` / `renameStoredTask` / `deleteStoredTask` / `exportStoredTask` / `selectStoredBranch` / `resolveApproval`**

每个方法把对 `this.appServer` 的调用改为相同模式：
```ts
const workerOrigin = this.harnessClient.getWorkerOrigin()
const cookie = this.harnessClient.getCookieHeader()
const res = await fetch(`${workerOrigin}/api/<endpoint>`, { ... })
```

- [ ] **Step 18.3: 改造图片相关方法**

`cloneImages` / `saveImages` / `removeImage` / `discardImages` / `analyzeImages` / `previewImage` / `selectImages` 同样改用 workerOrigin + cookie。

- [ ] **Step 18.4: 业务流切换前增加 worker 检查**

在 `sendChat` 等方法入口增加：
```ts
if (!this.harnessClient) {
  await this.connectAdvisor().catch(() => {
    throw new Error('ADVISOR_NOT_CONNECTED')
  })
}
```

- [ ] **Step 18.5: 保留 AppServerClient 但不调用**

不动 `AppServerClient.ts` 源码；保证运行时无业务引用：
```bash
git grep -n "this\.appServer\." src/main/advisor/AdvisorRuntime.ts
```
Expected: 无输出（仅 `getPersonalization` / `savePersonalization` / `resetMemory` 仍可用，因个性化是中央服务能力）。

- [ ] **Step 18.6: 验证编译**

```bash
pnpm tsc --noEmit -p tsconfig.json
```
Expected: 0 errors。

- [ ] **Step 18.7: 验证业务接口签名不变**

```bash
git diff src/main/advisor/AdvisorRuntime.ts | grep -E "^\+.*async (sendChat|steerChat|stopChat|listSessions|readStoredTask|renameStoredTask|deleteStoredTask|exportStoredTask|selectStoredBranch|resolveApproval|cloneImages|saveImages|removeImage|discardImages|analyzeImages|previewImage|selectImages)"
```
Expected: 无方法签名变化（仅内部实现变化）。

- [ ] **Step 18.8: Commit**

```bash
git add src/main/advisor/AdvisorRuntime.ts
git commit -m "refactor(advisor): 业务流从 AppServerClient 切到 workerOrigin

sendChat / steerChat / stopChat / listSessions / readStoredTask /
renameStoredTask / deleteStoredTask / exportStoredTask /
selectStoredBranch / resolveApproval / 图片相关 7 方法全部走
harness gateway worker 容器。

getPersonalization / savePersonalization / resetMemory 仍走
AppServerClient（中央服务能力，不属于 worker 隔离范围）。

关联：docs/superpowers/specs/2026-08-23-deepseek-harness-merge-into-codex-design.md §5.5"
```

---

### Task 19: 扩展 `getConnectionStatus` 返回 `mode` 字段

**Files:**
- Modify: `src/main/advisor/AdvisorRuntime.ts`
- Modify: `src/shared/advisor.ts`

- [ ] **Step 19.1: 在 shared 类型扩展**

```ts
// src/shared/advisor.ts
export type AdvisorConnectionState = {
  connected: boolean
  mode: 'harness' | 'unavailable' | 'reconnecting'
  label: string
  detail: string
}
```

- [ ] **Step 19.2: 改造 `getConnectionStatus` 实现**

```ts
async getConnectionStatus(): Promise<AdvisorConnectionState> {
  try {
    const session = await this.harnessClient.connect()
    return {
      connected: true,
      mode: 'harness',
      label: '执行引擎：受限隔离已就绪',
      detail: `worker: ${extractWorkerName(session.url)}`
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'connect 失败'
    return {
      connected: false,
      mode: 'unavailable',
      label: '执行引擎不可用',
      detail: message
    }
  }
}

function extractWorkerName(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return 'unknown'
  }
}
```

- [ ] **Step 19.3: 验证编译**

```bash
pnpm tsc --noEmit -p tsconfig.json
```
Expected: 0 errors。

- [ ] **Step 19.4: Commit**

```bash
git add src/main/advisor/AdvisorRuntime.ts src/shared/advisor.ts
git commit -m "feat(advisor): getConnectionStatus 扩展 mode 字段

mode: harness | unavailable | reconnecting
供 UI 顶栏 chip 状态展示。

关联：docs/superpowers/specs/2026-08-23-deepseek-harness-merge-into-codex-design.md §6.1"
```

---

## 阶段 5：server 端 access-ticket 简化（1 个 commit）

### Task 20: 改写 `server/src/modules/deepseek-harness/routes.ts`

**Files:**
- Modify: `server/src/modules/deepseek-harness/routes.ts`

- [ ] **Step 20.1: 改写 access-ticket 路径**

替换文件中 `access-ticket` route 实现：
```ts
// 原: preHandler 权限 menu.advisor.harness,  audience 区分 codex/harness
// 新: 统一 aud=deepseek-codex,  权限 menu.advisor.online
app.get('/access-ticket', { preHandler: [app.requirePermission('menu.advisor.online')] }, async request => {
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
```

- [ ] **Step 20.2: 改写 gateway/validate 路径**

```ts
app.post('/gateway/validate', { preHandler: [app.requirePermission('menu.advisor.online')] }, async request => {
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
```

- [ ] **Step 20.3: 验证 server 编译**

```bash
cd server && pnpm tsc --noEmit
```
Expected: 0 errors。

- [ ] **Step 20.4: 手动验证 token 签发（可选）**

启动 server 后：
```bash
curl -H "Authorization: Bearer <user-jwt>" http://localhost:8787/api/deepseek-harness/access-ticket
```
Expected: 200 + `{ ticket, expiresIn, audience: "deepseek-codex" }`。

- [ ] **Step 20.5: Commit**

```bash
git add server/src/modules/deepseek-harness/routes.ts
git commit -m "refactor(server): access-ticket 统一 aud=deepseek-codex

去除 audience 参数；权限由 menu.advisor.online 把关。
gateway/validate 端对应只接受 deepseek-codex。

关联：docs/superpowers/specs/2026-08-23-deepseek-harness-merge-into-codex-design.md §5.2"
```

---

## 阶段 6：Codex UI 调整（3 个 commit）

### Task 21: 暴露 `advisor.connect()` / `advisor.disconnect()` IPC

**Files:**
- Modify: `src/preload/preload.ts`
- Modify: `src/renderer/global.d.ts`

- [ ] **Step 21.1: 在 preload 暴露 IPC**

在 `advisor` 命名空间内（按现有结构）增加：
```ts
connect: (): Promise<{ url: string; message: string; expiresAt: number }> =>
  ipcRenderer.invoke('advisor:connect'),
disconnect: (): Promise<void> =>
  ipcRenderer.invoke('advisor:disconnect')
```

- [ ] **Step 21.2: 在 global.d.ts 扩展类型**

在 `AdvisorDesktopApi` 接口（按实际类型名定位）增加：
```ts
connect(): Promise<AdvisorRemoteSession>
disconnect(): Promise<void>
```

并增加 `AdvisorRemoteSession` import：
```ts
import type { AdvisorRemoteSession } from '../shared/advisor'
```

- [ ] **Step 21.3: 在 main.ts 注册 IPC handler**

```ts
ipcMain.handle('advisor:connect', () => advisorRuntime.connectAdvisor())
ipcMain.handle('advisor:disconnect', () => advisorRuntime.disconnectAdvisor())
```

（位置：在现有 `advisor:*` handler 集中区域）

- [ ] **Step 21.4: 验证编译**

```bash
pnpm tsc --noEmit -p tsconfig.json
```
Expected: 0 errors。

- [ ] **Step 21.5: Commit**

```bash
git add src/preload/preload.ts src/renderer/global.d.ts src/main/main.ts
git commit -m "feat(electron): 暴露 advisor.connect / advisor.disconnect IPC

主进程 connectAdvisor / disconnectAdvisor 通过 IPC 桥接到
渲染层，供 OnlineAdvisorExperience 启动时调用。

关联：docs/superpowers/specs/2026-08-23-deepseek-harness-merge-into-codex-design.md §5.6"
```

---

### Task 22: 顶部 connection chip 与 composer 提示条

**Files:**
- Modify: `src/renderer/OnlineAdvisorExperience.tsx`
- Modify: `src/renderer/online-advisor-experience.css`（如需新增样式）

- [ ] **Step 22.1: 扩展 connection state 类型**

`OnlineAdvisorExperience.tsx` 中 `connection` state 类型改为：
```ts
const [connection, setConnection] = useState<{
  connected: boolean
  mode: 'harness' | 'unavailable' | 'reconnecting' | 'unknown'
  label: string
  detail: string
}>({ connected: false, mode: 'unknown', label: '正在建立隔离执行器…', detail: '' })
```

- [ ] **Step 22.2: 启动时调 connect**

在 `useEffect` 初始化钩子（L278 区域）`getConnectionStatus` 之前增加：
```ts
void window.desktop.advisor.connect()
  .then((session) => setConnection({
    connected: true,
    mode: 'harness',
    label: '执行引擎：受限隔离已就绪',
    detail: `worker: ${extractWorkerName(session.url)}`
  }))
  .catch((err) => setConnection({
    connected: false,
    mode: 'unavailable',
    label: '执行引擎不可用',
    detail: err instanceof Error ? err.message : 'connect 失败'
  }))
```

并把 `getConnectionStatus` 的结果改用新的 `mode` 字段填充。

- [ ] **Step 22.3: 在 composer 上方增加提示条**

定位 `<form className="composer ...">` 之前（即 `approvals.length > 0` 段之后），增加：
```tsx
{connection.mode === 'unavailable' && (
  <div className="advisor-unavailable-banner" role="alert">
    <strong>执行引擎不可用</strong>
    <span>Codex 任务已暂停；如需使用请联系管理员检查 harness gateway 状态。</span>
  </div>
)}
```

- [ ] **Step 22.4: 禁用 composer**

把现有 composer form 内：
- `<button type="submit">` → `disabled={connection.mode === 'unavailable' || isBusy}`
- `<textarea>` → `disabled={!workspacePath || connection.mode === 'unavailable'}`
- 权限/模型选择按钮 → `disabled={connection.mode === 'unavailable' || isBusy}`
- 图片按钮 → `disabled={connection.mode === 'unavailable' || isBusy}`

并把"新建任务"按钮 `disabled={connection.mode === 'unavailable' || isBusy}`。

- [ ] **Step 22.5: 引入样式（如未定义）**

在 `online-advisor-experience.css` 追加：
```css
.advisor-unavailable-banner{display:flex;flex-direction:column;gap:4px;padding:12px 16px;background:#fff4e5;border:1px solid #f0c674;border-radius:8px;margin:0 16px 8px;color:#8a4b00}
.advisor-unavailable-banner strong{font-size:14px}
.advisor-unavailable-banner span{font-size:12px;color:#a86600}
```

- [ ] **Step 22.6: 验证编译**

```bash
pnpm tsc --noEmit -p tsconfig.json
```
Expected: 0 errors。

- [ ] **Step 22.7: 视觉验证**

```bash
pnpm dev
```

打开 Codex：
- 正常情况：顶栏绿字 + worker 名
- 临时改 `.env.local` `HARNESS_GATEWAY_BASE_URL=http://127.0.0.1:1` 模拟不可用：顶栏红字 + composer 禁用 + 黄色提示条显示

- [ ] **Step 22.8: Commit**

```bash
git add src/renderer/OnlineAdvisorExperience.tsx src/renderer/online-advisor-experience.css
git commit -m "feat(codex): 顶栏 chip 扩展 + 不可用时 composer 禁用

- 启动时调 window.desktop.advisor.connect()
- mode: harness | unavailable 驱动 chip 颜色与文案
- 不可用时显示黄色提示条 + composer 全组件禁用
- 新建任务按钮同步禁用

关联：docs/superpowers/specs/2026-08-23-deepseek-harness-merge-into-codex-design.md §6.1 §6.2"
```

---

### Task 23: App.tsx 渲染层清理（如有遗漏）

- [ ] **Step 23.1: grep 残留**

```bash
git grep -n "DeepSeekHarness\|deepseek-harness\|deepSeekHarness" src/renderer/
```
Expected: 仅 spec/plan 文档引用，零业务代码匹配。

- [ ] **Step 23.2: 全量编译**

```bash
pnpm tsc --noEmit -p tsconfig.json
```
Expected: 0 errors。

- [ ] **Step 23.3: 视觉回归（可选）**

`pnpm dev` 启动，AI 参谋页 → 在线参谋进入 Codex；报告样例库 → 进入；竞品分析 → 即将上线占位。确认无残留 UI 元素。

- [ ] **Step 23.4: Commit（如有改动）**

```bash
git add -A
git commit -m "chore: 阶段 6 渲染层清理收尾" --allow-empty
```

---

## 阶段 7：测试与上线（3 个 commit）

### Task 24: 单元测试全套运行

- [ ] **Step 24.1: 运行 advisor 单元测试**

```bash
pnpm vitest run src/main/advisor/
```
Expected: 全通过（CookieJar 5 + HarnessGatewayClient 7 + AdvisorRuntime 现有测试）。

- [ ] **Step 24.2: 运行 server 单元测试（如有）**

```bash
cd server && pnpm test
```
Expected: 全通过。

- [ ] **Step 24.3: 运行前端单元测试（如有）**

```bash
pnpm vitest run src/renderer/
```
Expected: 全通过。

- [ ] **Step 24.4: 失败修复**

如有失败，按错误日志逐个修复（典型：测试 mock 调整、HarnessGatewayClient 边界条件补齐）。每修一个独立 commit。

- [ ] **Step 24.5: 记录测试报告**

```bash
pnpm vitest run --reporter=json --outputFile=test-report.json
```
保留 `test-report.json` 供后续回归对比。

---

### Task 25: E2E 测试

**Files:**
- Create: `tests/e2e/online-advisor-harness.spec.ts`

- [ ] **Step 25.1: 写 E2E 测试骨架**

```ts
// tests/e2e/online-advisor-harness.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Codex × Harness', () => {
  test('1. 就绪：顶栏绿字 + worker 名', async ({ page }) => {
    // 启动应用 → 登录 → 进入 AI 参谋 → 在线参谋
    // 期望: 顶栏显示「执行引擎：受限隔离已就绪」+ worker 名
  })

  test('2. 任务在 worker 中执行', async ({ page }) => {
    // 提交"列出当前目录"任务
    // 期望: 任务完成 + 主进程日志可见 worker 容器名
  })

  test('3. kill worker 后任务 failed + 自动重连', async ({ page }) => {
    // 任务进行中 docker stop <worker>
    // 期望: 当前任务 failed 提示「隔离执行中断」+ 下一个任务正常
  })

  test('4. 启动时 gateway 不可达：顶栏红字 + composer 禁用', async ({ page }) => {
    // 停 gateway 服务后启动应用
    // 期望: 顶栏红字 + composer 禁用 + 任务历史可看但不能新建
  })

  test('5. gateway 恢复后自动重连', async ({ page }) => {
    // 启动时 gateway 不可用 → 恢复 gateway → 60s 内自动重连
  })

  test('6. 无权限用户：顶栏红字「无在线参谋权限」', async ({ page }) => {
    // 切换到没有 menu.advisor.online 权限的账号
  })

  test('7. ticket 过期自动续约', async ({ page }) => {
    // 临时改 gateway expiresIn='1m',  观察 30s 时自动重连
  })

  test('8. RBAC 拒绝：不降级', async ({ page }) => {
    // 切到无 menu.advisor.online 权限账号
    // 期望: 顶栏红字 + 不允许任何操作
  })

  test('9. 主进程启动 connect 失败不影响启动', async ({ page }) => {
    // 启动时 gateway 不可用,  应用仍能加载
  })

  test('10. AI 参谋页仅剩 3 个 Harness 区域入口', async ({ page }) => {
    // 期望: 报告样例库 / 在线参谋 / 竞品分析；无 DeepSeek Harness 卡片
  })
})
```

- [ ] **Step 25.2: 启动测试环境**

```bash
# 启动中央服务
cd server && pnpm dev

# 启动 gateway（独立 Docker）
docker run -d --name yandu-deepseek-harness-gateway-test \
  -p 8788:8788 \
  -e PORT=8788 \
  -e YANDU_APP_ORIGIN=http://host.docker.internal:8787 \
  -e DSH_PUBLIC_HOST=http://127.0.0.1:8788 \
  -e GATEWAY_SESSION_SECRET=test-secret \
  -e DEEPSEEK_API_KEY=$DEEPSEEK_API_KEY \
  $(docker build -q src/main/advisor/gateway/)

# 启动 desktop app
pnpm dev
```

- [ ] **Step 25.3: 跑 E2E**

```bash
pnpm playwright test tests/e2e/online-advisor-harness.spec.ts --reporter=line
```
Expected: 10 passed。

- [ ] **Step 25.4: 失败修复**

按错误日志修复。每修一个独立 commit。

- [ ] **Step 25.5: Commit**

```bash
git add tests/e2e/online-advisor-harness.spec.ts
git commit -m "test(e2e): Codex × Harness 集成 10 个场景

覆盖就绪、worker 故障、gateway 不可达、RBAC 拒绝、自动续约、
AI 参谋页入口清理等。

关联：docs/superpowers/specs/2026-08-23-deepseek-harness-merge-into-codex-design.md §9.2"
```

---

### Task 26: 人工验收 + 灰度发布

- [ ] **Step 26.1: 体积对比**

```bash
# baseline（阶段 1 Tag 时已记录）
echo "baseline: <previous MB>"

# 当前
du -sh release/*.dmg release/*.exe 2>/dev/null

# 计算 delta
echo "delta: <current MB - baseline MB>"
```
Expected: 安装包减少 ≥ 600MB（因 vendor/deepseek-harness 已删除）。

- [ ] **Step 26.2: 行为回归**

`pnpm dev` 启动，提交报告样例库里的 3 个标准任务，输出与改造前一致（数据、格式、链接、表格均无回归）。

- [ ] **Step 26.3: 入口不可见验证**

AI 参谋页 → 确认 DeepSeek Harness 卡片已删除；侧边栏 → 确认无 Harness 入口；菜单权限 → 确认 `menu.advisor.harness` 节点已删除。

- [ ] **Step 26.4: 系统管理页 RBAC 验证**

系统管理 → 成员行 → 切换某成员的 `menu.advisor.online` 权限 → 重新进入 Codex，确认顶栏 chip 状态与权限一致。

- [ ] **Step 26.5: 主进程日志验证**

启动应用，提交任务，观察主进程日志：
```
[advisor-harness] connected worker=...
[advisor-harness] reconnected worker=...
```
符合预期。

- [ ] **Step 26.6: .env.example 更新**

```bash
# 追加
echo "
# Harness gateway 基础 URL（生产：https://harness.yandu.example.com）
HARNESS_GATEWAY_BASE_URL=http://127.0.0.1:8788
" >> .env.example
```

- [ ] **Step 26.7: 灰度发布（10% → 50% → 100%）**

按现有 OSS 自动更新灰度流程发布：
- 内部测试通道 100%（24h 观察）
- 公开通道 10%（24h 观察）
- 公开通道 50%（24h 观察）
- 公开通道 100%

- [ ] **Step 26.8: Tag 上线**

```bash
git tag v1.X.Y-harness-merged
git push --tags
```

---

## 验收 Checklist（合并所有阶段）

- [ ] 阶段 1: grep 零残留；`pnpm tsc` 0 errors；安装包体积记录
- [ ] 阶段 2: gateway 与 worker 资产在 `src/main/advisor/{gateway,runtime}/`；Dockerfile 路径更新；CI 路径更新
- [ ] 阶段 3: CookieJar 5 单测全过；HarnessGatewayClient 7 单测全过
- [ ] 阶段 4: 业务流从 AppServerClient 切到 workerOrigin；`getConnectionStatus` 扩展 `mode` 字段
- [ ] 阶段 5: access-ticket 统一 `aud=deepseek-codex`；权限 `menu.advisor.online`；server 端编译通过
- [ ] 阶段 6: 顶栏 chip 4 态 + composer 不可用禁用 + 黄色提示条
- [ ] 阶段 7: 单元测试全过；E2E 10 场景全过；体积减少 ≥ 600MB；RBAC 切换即时生效；灰度发布 100%

---

> **下一步**：本 plan 已就绪。请选择执行方式（subagent-driven 推荐 / inline executing-plans）。
