# DeepSeek Harness 阶段 1 源码纳入记录

更新时间：2026-08-18（Asia/Shanghai）

## 已完成内容

- 官方源码已以 Git archive 方式导入 `vendor/deepseek-harness/`。
- 导入基线为 `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`（`0.1.0-rc.7`）。
- 导入只包含该提交的受版本控制文件，不包含 `.git`、`node_modules` 和先前构建产物。
- 官方 `LICENSE`、`THIRD_PARTY_NOTICES.md` 及源码内许可证文件均随源码保留。
- 追溯信息写入 `vendor/deepseek-harness.source.json`，包含上游地址、提交、版本、许可证和锁文件 SHA-256。
- 新增 `scripts/build-deepseek-harness.sh`，在独立子目录安装锁定依赖并构建 Harness；它不改动当前 Electron 项目的依赖图或 pnpm workspace。
- 构建脚本在安装后建立 Harness 自己的 React 18 解析链接，避免 TypeScript 向上解析到当前应用根目录的 React 19 类型；链接位于被忽略的 Harness `node_modules`，不修改官方源码。
- 忽略 Harness 子项目的生成产物，避免将 `lib`、`types` 和 Web `dist` 误提交。

## 边界

本阶段只完成“源码进入当前仓库 + 可独立构建”的接线。尚未把 Harness 页面接入 `App.tsx`，尚未引入砚都登录态、租户隔离、远程执行器或公网服务。这些工作属于后续阶段，不能用本阶段源码导入代替。

## 维护规则

1. 任何上游更新必须先更新 `vendor/deepseek-harness.source.json` 的 commit、version 和 lockfileSha256。
2. 不直接在官方源码中混入砚都业务适配；后续适配优先放在 `src/renderer/DeepSeekHarness/`、`server/` 和 `patches/deepseek-harness/`。
3. 若必须改官方源码，先在 `localModifications` 中登记原因、文件、补丁编号和上游 Issue/PR 链接。
4. 每次更新至少执行 `scripts/build-deepseek-harness.sh`、许可证检查及相关 Web 测试。
5. 公司 Fork 地址确定后，替换 `upstream` 为公司 Fork 并额外保留官方 upstream remote 与原始 SHA。

## 阶段 1 验收标准

| 验收项 | 判定方式 |
| --- | --- |
| 官方源码在当前仓库 | `vendor/deepseek-harness/package.json` 与 `LICENSE` 存在 |
| 基线可追溯 | source manifest 的提交、版本与 lockfile SHA 与源码一致 |
| 无依赖污染 | 根 `pnpm-workspace.yaml` 不增加 Harness workspace；根 `package.json` 不增加 Harness 依赖 |
| 独立构建 | `scripts/build-deepseek-harness.sh` 成功退出 |
| 根项目无回归 | 根项目 `pnpm build` 成功退出 |
| 生成物不误提交 | `git check-ignore` 命中 Harness 的 `lib`/`types`/`apps/web/dist` |

## 本次验收记录

- `scripts/build-deepseek-harness.sh`：通过；Host、Client 与 Web 构建均成功。
- `pnpm run verify-dsh-package-licenses`：通过；检查 222 个 DSH 包，全部声明 MIT。
- 核心测试：通过；14 个测试文件、255 项测试全部通过。
- 根项目 `pnpm build`：通过；Vite 生产构建和 Electron 主进程 TypeScript 检查均成功。
- 来源核对：通过；源码版本为 `0.1.0-rc.7`，锁文件 SHA-256 与 source manifest 一致。
- 隔离核对：通过；根 `package.json` 和 `pnpm-workspace.yaml` 均未登记 Harness。
