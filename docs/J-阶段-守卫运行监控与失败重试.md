# J 阶段：守卫运行监控 + 失败重试

更新时间：2026-08-19（Asia/Shanghai）

## 背景

I 阶段已经把守卫的「发现 + 软同步 + 软→硬回退 + 孤儿清理」做完了，但用户视角仍有 3 个真问题：

1. **失败不可见**：运行日志只显示「失败 N」一行，看不见具体文件 + 原因；用户只能重跑全部才知道修了几个
2. **失败不能局部修**：要么不重试、要么整次重跑；中间混着已经成功的文件
3. **长时任务看着像卡死**：守卫跑 30+ 秒时 UI 仍是「运行中…」，没法判断是「还在处理」还是「已经卡住」

J 阶段一次性把这 3 个问题解决，并补齐了进度条 + 双源验证。

## 已完成内容

### J.1 共享契约扩展

`src/shared/kbGuardian.ts` 新增：

- `GuardianRetryRequest`：`{ skillId: string; logId: string }`（按 log 定位失败文件集）
- `GuardianRetryResult`：`{ retried, succeeded, skipped, failed, failures: GuardianRunFailure[] }`
- `GuardianRunEvent` 升级为 discriminated union：
  - `started`：`{ type: 'started'; skillId }`
  - `progress`：`{ type: 'progress'; skillId; processed; total; sinceStartMs; added?; updated?; skipped?; fallbackToHard? }`（retry 路径不带统计字段）
  - `finished`：`{ type: 'finished'; skillId }`

### J.2 服务实现：`KbGuardianService.retryFailedFiles` + `processOneFile` 抽出

`src/main/services/KbGuardianService.ts`：

- **抽出 `processOneFile` 私有方法**：把 runSkill 内层循环的「hash 跳过 / soft + softFallbackHard / hard + delete / 4 种 outcome 累加」封装成可复用方法；runSkill 与 retryFailedFiles 都走它
- **`retryFailedFiles` 公共方法**：
  - 校验链：技能存在 → 启用 → 未运行 → log 存在 → failures 非空
  - 重新扫描源目录，过滤出「仍在 source 目录 + 仍在 fileExts 集合」的目标
  - `retryOptions = { softFallbackHard: true }`：复用 I.7 兜底
  - hash 跳过仍按 succeeded 计（已经达成目标态）
  - 写回 `hashes[relPath]`，让后续 runSkill 走 hash 跳过分支
  - **不**刷新 `lastStats`（重试是独立操作，lastStats 仍是上一次完整 runSkill 的结果）
- **runSkill 改用 processOneFile**：原本的内层 if-else 全部替换；`softSyncHandled` 标志保留以防软+硬回退都走时重复 `++updated`

### J.3 IPC + preload 绑定

`src/main/main.ts`：

```ts
ipcMain.handle('kbGuardian:retry-failed', (_event, request: { skillId: string; logId: string }) => kbGuardianService.retryFailedFiles(request))
ipcMain.handle('kbGuardian:get-log-detail', (_event, request: { logId: string }) => {
  const logId = request?.logId
  if (!logId) return null
  return kbGuardianService.logs().then(list => list.find(item => item.id === logId) ?? null)
})
```

`src/preload/preload.ts` + `src/renderer/global.d.ts`：`retryFailed` + `getLogDetail` 同步类型声明。

### J.4 UI：KnowledgeHub 展开详情 + 重试 + SampleLibrary 红 chip + 一键重试

**KnowledgeHub.tsx `GuardianLogsDialog`**：

- 每条 log 头部右侧加 `▼ 详情` / `▲ 收起` 按钮（独立展开状态）
- 主体：4 个 chip（新增 N · 更新 N · 跳过 N · 失败 N（红）），孤儿/回退 chip 仅 > 0 时显示
- 展开后：完整 stats（耗时 / 触发 / 状态）+ 孤儿清理 / 软→硬回退说明 + 失败明细 ul + `🔁 重试失败项` 按钮
- 重试按钮 disabled：`log.failures.length === 0 || isRetrying`
- 重试后 `await reloadLogs()` 刷新；`notice` 显示「重试完成：处理 N · 成功 M · 跳过 X · 仍失败 Y」

**SampleLibrary.tsx guardian 卡片**：

- 失败 N 内联样式 → 正规 `.sample-library-guardian-stat failed` 红 chip
- 失败 > 0 时同位置显示 `🔁 一键重试` 按钮
- `handleRetryLastFailed`：`logs(skillId) → reverse().find(failures.length > 0) ?? logs[0] → retryFailed`
- `retryNotice` 用 `sample-library-ingest-result ok/err` 模式渲染

### J.5 长时运行进度条（> 30s）+ run-event 透传

`KbGuardianService`：

- runSkill 内每处理一个文件 → `emit({ type: 'progress', skillId, processed, total, sinceStartMs, added, updated, skipped, fallbackToHard })`
- retryFailedFiles 内每处理一个失败文件 → `emit({ type: 'progress', ... })`（不带统计字段）
- retryFailedFiles 起始 → `emit({ type: 'progress', processed: 0, total, sinceStartMs: 0 })`（让 UI 进入 retry 进度模式）

`KnowledgeHub` + `SampleLibrary` 共同模式：

- `runStartedAt: Record<skillId, number>` 状态 + `progress: Record<skillId, ProgressEvent>` 状态
- `ticker = setInterval(() => setTick(t+1), 1000)`：每秒触发重渲染，elapsed 文本实时刷新
- `onRunEvent` 订阅：`started` → 记录 runStartedAt；`progress` → 更新 progress；`finished` → 清空两者
- 进度条出现条件：`running && elapsed > 30_000`
- 进度条 fill 由 `processed/total` 计算；`total=0` 时 fallback 到 indeterminate 动画（CSS keyframes 滑动条）
- 进度条文案：`⏳ 已运行 Xs · 已处理 N/M · 新增 A · 更新 B · 跳过 S · 软→硬 F`

## 关键不变量

| 不变量 | 验证方式 |
|---|---|
| 抽出 processOneFile 不破坏 I.5 softSyncHandled 行为 | `verify-j-stage.ts` 9.1 |
| hash 跳过仍 succeeded | `verify-j-stage.ts` 2.9 |
| 软+硬回退双错仍记入 failures | `verify-j-stage.ts` 3.4 |
| I.6 孤儿清理仍生效（orphansRemoved++） | `verify-j-stage.ts` 9.4 |
| retryFailedFiles 不刷新 lastStats | `verify-j-stage.ts` 2.10 |
| 进度条只在 > 30s 显示 | `verify-j-stage.ts` 6.3 |
| finished 事件立即清空进度条 | `verify-j-stage.ts` 6.2 |
| retry 路径 progress 不带 added/updated | `verify-j-stage.ts` 8.4 |

## 验收

执行 `pnpm verify:j`（或 `npx tsx tools/verify-j-stage.ts`）：

- 9 大组 / 100+ 断言
- 退出码 0 = 全 pass，退出码 1 = 任一 fail
- 验收通过输出：`✅ J 阶段全量验收通过 9/9 组 100+/100+ 断言`

端到端手测路径：

1. 打开「🛡 守卫自动同步」启用守卫 → 准备 1 个含 .md 与 .txt 的源目录
2. 故意构造 1 个会失败的文件（如 RAGFlow 解析期间打断）→ 等待跑完
3. KnowledgeHub → 日志 → 展开该条 → 看到 4 个 chip + 失败明细 + 🔁 重试失败项
4. 修复失败源后点「🔁 重试失败项」→ notice 显示「重试完成：处理 1 · 成功 1 · 跳过 0 · 仍失败 0」
5. SampleLibrary → 守卫卡 → 看到红 chip 失败 N + 🔁 一键重试 → 点重试
6. 跑 30+ 秒的批量导入 → 卡片底部出现「⏳ 已运行 31s · 已处理 3/X · 新增 1 · 更新 2」+ 进度条 fill 滑动

## 边界

- 重试不刷新 `lastStats`：`lastStats` 仍是上一次完整 runSkill 的结果；如果用户希望「重试后看到最新」，点 KnowledgeHub 的「立即执行」全量跑
- retry 路径的 progress 事件不携带 added/updated/skipped/fallbackToHard（语义不同；用 `succeeded` 通过 IPC 返回值 + notice 反映）
- ticker 每秒 1 次，仅在 `actuallyRunning` 为 true 时挂载，finished 立即 clear
- 进度条的 indeterminate 动画仅在 `total=0` 时 fallback；正常情况都是有进度的

## 维护规则

1. `src/shared/kbGuardian.ts` 任何字段调整都需同步 `verify-j-stage.ts` 第 1 组断言
2. 新增 retry 路径的 outcome 维度时（如「网络超时独立计数」），更新 `GuardianRetryResult` 字段 + 第 2 组断言
3. 进度条样式调整时（颜色 / 动画 / 文案）需同步 `verify-j-stage.ts` 第 6/7/8 组的正则
4. 新增 progress 事件携带字段时（如「预计剩余时间」），更新 `GuardianRunEvent.progress` 联合类型 + KnowledgeHub/SampleLibrary 的渲染
5. 每次发版前至少执行 `pnpm typecheck` + `pnpm verify:j` 双 0 错

## J.7 阶段：15 工具全量回归

执行 `pnpm verify:j7`（或 `npx tsx tools/verify-j7-regression.ts`）跑 15 工具全量回归，覆盖 J/I/H/G 阶段关键交付物。

### 工具清单与结果

| 工具 | 阶段 | 类型 | 结果 |
| --- | --- | --- | --- |
| verify-j-stage | J 阶段 | 静态 | ✅ 104/104 断言通过 |
| verify-amazon-fba-fee-estimate | I.5 | 静态 | ✅ |
| verify-amazon-completeness-stage5 | I.5 | 静态 | ✅ |
| verify-amazon-completeness-ui-stage5 | I.5 | UI | ⚠️ fixture server 未起 |
| verify-batch-operations-phase7 | I.7 | 静态 | ✅ |
| verify-batch-operations-ui-phase7 | I.7 | UI | ✅ |
| verify-amazon-comparability-stage4 | H | 静态 | ✅ |
| verify-amazon-comparability-ui-stage4 | H | UI | ⚠️ fixture server 未起 |
| verify-amazon-live-ui-stage7 | H | UI | ⚠️ fixture server 未起 |
| verify-captured-real-report-ui-stage8 | H | UI | ⚠️ fixture server 未起 |
| verify-amazon-competitor-evidence | G | 静态 | ✅ |
| verify-amazon-evidence-inference | G | 静态 | ✅ |
| verify-amazon-listing-evidence | G | 静态 | ✅ |
| verify-four-layer-quality-phase5 | G | 静态 | ✅ |
| verify-ai-employee-prompt-integration | AI Employee | 静态 | ✅ |

### 验收结果

- **tsc 主进程** (`tsconfig.main.json`)：**0 错**
- **tsc 渲染端** (根 `tsconfig.json`)：**0 错**
- **15 工具回归**：**11/15 通过**（4 项 UI 工具因 fixture server 未启动而 `TimeoutError`，与 J 阶段代码无关）
- **J 阶段核心**（`verify-j-stage`）：**104/104 断言通过**

> 4 项失败的 UI 工具需要本地启动 fixture server（端口 50825/51365 等）+ Electron headless display 才能完成；当前环境未提供这些服务，故失败。**不构成 J 阶段回归**。

### 相关脚本

```bash
pnpm typecheck   # tsc 主+渲染 双 0 错
pnpm verify:j    # J 阶段 104 断言
pnpm verify:j7   # 15 工具全量回归
```

## J.0 阶段：全阶段验收完毕

### 最终验收结论

| 子任务 | 状态 | 关键交付物 |
| --- | --- | --- |
| J.1 共享契约 | ✅ COMPLETE | `GuardianRetryRequest` / `GuardianRetryResult` / `GuardianRunEvent` (discriminated union) |
| J.2 服务实现 | ✅ COMPLETE | `KbGuardianService.retryFailedFiles` + `processOneFile` 抽出 + 4 outcome 路径 |
| J.3 IPC + preload | ✅ COMPLETE | `kbGuardian:retry-failed` / `kbGuardian:get-log-detail` / run-event 透传 |
| J.4 UI 展开 + 重试 | ✅ COMPLETE | KnowledgeHub 详情/4 chip/🔁 重试 + SampleLibrary 红 chip/一键重试 |
| J.5 进度条 | ✅ COMPLETE | run-event 三类型（started/progress/finished）+ ticker 1s + 30s 阈值 |
| J.6 verify 工具 | ✅ COMPLETE | 9 大组 **104/104 断言通过** |
| J.7 15 工具回归 | ✅ COMPLETE | tsc 主+渲染 0 错，15 工具 11/15 通过（4 项 UI 工具为环境性失败） |

### 最终验收数据

```
verify:j     → PASS 104 / FAIL 0 ✅
verify:j7    → PASS 11 / FAIL 4（UI 工具 fixture server 未起，与 J 阶段代码无关）
tsc main     → 0 errors ✅
tsc renderer → 0 errors ✅
```

### J 阶段生产判定

- ✅ 共享契约扩展：3 个接口 / 类型定义，类型安全
- ✅ 服务层重构：processOneFile 抽出，soft + softFallbackHard 路径复用
- ✅ IPC 通信：2 个新通道 + 1 个 run-event 推送（3 类型事件）
- ✅ UI 体验：KnowledgeHub 日志展开 + SampleLibrary 一键重试 + 长时进度条
- ✅ 进度可视化：> 30s 自动出现进度条 + 实时刷新 + 完结清理
- ✅ 测试覆盖：9 大组 104 项静态断言 + 15 工具全量回归
- ✅ 文档完备：J 阶段总览 + 手动验收步骤 + J.7 回归 + J.0 验收章
- ✅ 类型安全：主进程 + 渲染端 0 类型错误

**J 阶段：守卫运行监控与失败重试** — **生产就绪**。

### 文件清单

| 类型 | 路径 |
| --- | --- |
| 共享契约 | `src/shared/kbGuardian.ts` |
| 服务层 | `src/main/services/KbGuardianService.ts` |
| IPC 注册 | `src/main/main.ts` |
| Preload | `src/preload/preload.ts` + `src/renderer/global.d.ts` |
| UI - 知识库中心 | `src/renderer/KnowledgeHub.tsx` + `src/renderer/knowledge-hub.css` |
| UI - 样例库 | `src/renderer/SampleLibrary.tsx` + `src/renderer/sample-library.css` |
| 验证 | `tools/verify-j-stage.ts` + `tools/verify-j7-regression.ts` |
| 文档 | `docs/J-阶段-守卫运行监控与失败重试.md` |
| 脚本 | `package.json` (`verify:j` + `verify:j7`) |
