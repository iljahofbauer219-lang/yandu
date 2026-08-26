# 第四阶段执行闭环与安全验收记录

日期：2026-08-03

## 阶段范围

- DeepSeek 真实文本与流式事件。
- Codex app-server 工具闭环、文件修改和测试执行。
- 审批拒绝与高风险操作保护。
- 停止任务、后台进程清理及停止后立即开始下一任务。
- 图片 OCR、视觉理解和同一模型回合。
- 会话持久化、运行记录与凭据泄漏检查。
- 最终生产界面恢复。

## 本阶段修复

停止任务会终止当前 app-server。旧子进程的退出事件可能晚于下一任务的新子进程启动，原实现会无条件清空当前子进程并广播退出，导致下一任务错误：

`Codex app-server 已退出（code=null, signal=SIGTERM）`

已在 AppServerClient 的 exit/error 回调中加入子进程实例归属检查。只有当前活动实例退出时才清理连接和广播错误，旧实例的迟到事件不再影响新任务。

## 真实模型与流式验收

DeepSeek V4 Flash 真实任务：

- 状态：completed。
- 收到 taskStatus、activity、turnStarted、多个 delta、done。
- 最终回答：`PHASE4_TEXT_OK`。
- 执行时间：1510 ms。

## 工具与文件修改闭环

隔离项目：`phase-4-runtime-project`。

初始错误：

```js
export function multiply(a, b) {
  return a + b
}
```

真实模型执行：

1. 查找并读取 calculator.js、test.js、package.json。
2. 通过结构化文件修改把 `a + b` 改为 `a * b`。
3. 产生 Git 差异活动。
4. 实际运行 `npm test`。
5. 输出 `PHASE4_RUNTIME_TEST_OK`，退出码 0。
6. 再次读取文件并直接运行测试确认。

任务状态 completed，执行时间 10247 ms，共持久化 199 条事件。

## 审批与停止验收

### 删除审批拒绝

- 模型请求执行 `rm SHOULD_NOT_DELETE.txt`。
- 生成命令审批，原因是删除操作必须每次确认。
- allowRemember=false。
- 实际选择 decline。
- approvalResolved 记录 decision=decline。
- 任务结束后文件仍存在。

### 停止与清理

- Pro 模型实际启动 60 秒 Node 命令。
- 命令进入 inProgress 后调用 stopChat。
- 任务状态变为 stopped。
- 后台 phase4-stop-marker 进程为 0。

### 竞态回归

修复后在同一应用进程中：

1. 启动长命令。
2. 停止任务。
3. 100 ms 后立即发起新任务。
4. 新任务 completed，返回 `PHASE4_AFTER_STOP_OK`。
5. 未再出现旧 SIGTERM 污染新任务。

## 图片与视觉闭环

- 从迁移任务克隆 1 张图片到新任务。
- macOS Vision OCR 成功：success=true，图片 2880×1800。
- 生成结构化 OCR、红框标注、属性、Logo 候选、风险和建议。
- Codex vision sidecar 成功理解原图。
- 同一 DeepSeek 回合引用图片内容并返回 `PHASE4_IMAGE_OK`。
- 任务状态 completed，执行时间 143996 ms。

## 持久化与安全检查

验收任务全部保存为独立 JSON：

- completed：文本、工具修复、审批拒绝、图片、停止后新任务。
- stopped：长命令停止任务。
- pendingApprovalCount 最终均为 0。
- 每个任务保留状态、执行时间、事件和分支信息。
- 使用 .env.local 中实际密钥逐项扫描 dist/renderer、dist/main 和会话目录：命中 0。
- API Key 未进入渲染构建或任务记录。

## 编译与实际界面

- `pnpm typecheck`：通过。
- `pnpm build`：通过。
- 生产 Electron 已重新启动并加载修复后的主进程。
- 实际界面打开工具验收任务：
  - 历史项目分组显示 9 个阶段四任务。
  - 任务状态、执行时间和真实模型可见。
  - 页面显示最终 `PHASE4_RUNTIME_TEST_OK`。
  - 执行过程共恢复 27 个可展开活动节点。
  - “导出当前任务报告”入口可见。

实际截图：`phase-4-runtime-acceptance.png`。

