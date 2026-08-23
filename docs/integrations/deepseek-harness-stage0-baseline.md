# DeepSeek Harness 阶段 0 基线与验收记录

更新时间：2026-08-18（Asia/Shanghai）

## 结论

阶段 0 的源码基线、许可证、依赖、架构盘点和本机构建测试已经完成。当前基线可以作为后续源码纳入与多租户改造的输入，但不能按原样开放公网：官方 Web 连接层明确只提供 loopback/same-origin 信任约束而不提供身份认证，现有会话、工作区、设置和凭据也按单一 Harness Home 组织，没有 tenant/user 数据边界。

公司 GitHub 组织名称和目标仓库尚未提供，因此本阶段没有擅自创建外部 Fork。后续导入当前仓库前，必须先确定公司 Fork 地址；在此之前以官方提交 SHA 和锁文件摘要作为不可变基线。

## 1. 冻结的上游基线

| 项目 | 冻结值 |
| --- | --- |
| 官方仓库 | `https://github.com/deepseek-ai/deepseek-harness.git` |
| 官方分支 | `master` |
| 提交 SHA | `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca` |
| 提交时间 | `2026-08-17T19:03:17+08:00` |
| 提交摘要 | `Merge pull request #2620 from deepseek-harness/release/dsh-0.1.0-rc.7` |
| 根包版本 | `0.1.0-rc.7` |
| 根包名称 | `@deepseek-ai/dsh-root` |
| 许可证 | MIT，Copyright (c) 2026 DeepSeek |
| Node 要求 | `^22.19.0 || >=24.0.0` |
| pnpm 声明版本 | `11.7.0` |
| `pnpm-lock.yaml` SHA-256 | `f517dc3978d57531cda747df62a2abdde1df5b9f25415fcf1fc5d51f8b7547ea` |

后续同步或构建不得仅记录 `master`、`latest` 或 `0.1.x`；必须同时记录准确提交 SHA、包版本和锁文件摘要。

## 2. 构建环境基线

本次实际使用：

- macOS x64。
- Node.js `v24.19.0`。
- pnpm `11.19.0`。
- npm `11.6.2`（用于满足官方根脚本内部的 `npm run ...` 调用）。
- Playwright Chromium：使用本机完整的 `chromium_headless_shell-1234` 运行官方 revision 1228 的测试入口。

构建链有以下确定要求：

1. 官方工作区包含 238 个 pnpm workspace project，本次安装 925 个包。
2. 根 `build` 脚本由 pnpm 启动，但内部调用 npm，因此构建镜像必须同时提供 `node`、`pnpm` 和 `npm`。
3. 包含 `node-pty`、`koffi`、`sharp`、Playwright、Landlock/Windows ACL 等平台或原生相关依赖，生产构建必须按目标 OS/CPU 分别验证，不能只复制 macOS 构建产物到 Linux 服务器。
4. Web 端到端测试需要匹配的 Playwright 浏览器包；仅安装 npm 依赖不等于测试环境完整。
5. 官方要求 Node 22.19+ 或 24+，当前砚都应用的 Electron 内置 Node 不能未经验证直接代替服务器构建运行时。

## 3. 官方架构盘点

### 3.1 Web 与 API

- `apps/web` 是 Web 前端应用。
- `packages/client/*` 提供连接、运行时、UI 插件和页面模块。
- `packages/host/webserver` 提供 HTTP/WebSocket 入口，可配置 `127.0.0.1` 或 `0.0.0.0`。
- `packages/host/apiproxy` 和 `packages/api/*` 提供 BFF/RPC 接口。
- `packages/bundle/web-app` 通过 Cordis 插件组合完整 Web 产品。

### 3.2 会话、设置与工作区

- 会话以 append-only `SessionEvent` 日志为权威数据源。
- 默认持久化包含 SQLite/JSONL 实现。
- SQLite 会话持久化配置接受单一数据库路径，没有 tenant/user 配置字段。
- Workspace Registry 以规范化本机路径登记工作区，并从全局会话持久层建立索引。
- Workspace、session header 和本地存储目前没有可直接复用的租户所有权校验。

### 3.3 文件、命令与沙箱

- 文件系统、Shell、subprocess、terminal、LSP 和沙箱是可替换的 Cordis capability/provider。
- 默认产品组合包含本地文件、本地 subprocess 和本地沙箱能力。
- 仓库包含 E2B POC provider，但不能据此认定现有 Web 产品已经具备生产级多租户容器隔离。
- 多租户版本应新增远程执行 provider，而不是在共享 API 进程内复用 local provider。

### 3.4 模型与凭据

- DeepSeek 和其他模型通过 LLM provider 插件接入。
- 现有 credentials-local 以环境变量/本地 `.env` 等主机侧来源解析凭据。
- 当前 DeepSeek `userId` 是匿名安装身份，不能作为砚都账号或租户身份使用。
- 线上版本必须由请求身份解析 tenant/user 级 credential reference，不得让共享进程使用无归属的全局 Key。

## 4. 已确认的单用户假设与多租户缺口

| 领域 | 当前事实 | 后续必须改造 |
| --- | --- | --- |
| 网络信任 | Client connection 源码注明 DNS rebinding fence 不是认证，并保持 loopback/same-origin | 接入砚都短期 Token、服务端身份解析和网关鉴权 |
| 用户身份 | DeepSeek provider 使用匿名安装 user id | 映射砚都 `tenantId/userId`，禁止前端自报身份 |
| 会话数据 | 单一 SessionPersistence，无 tenant/user 分区 | 数据模型、查询和事件入口增加租户所有权 |
| 工作区 | 全局 Workspace Registry，直接登记主机真实路径 | 用户/租户命名空间和远程工作区 provider |
| 设置 | 单一 Harness Home/profile/settings | 用户设置与管理员策略分层存储 |
| 凭据 | 环境变量/本地 `.env` provider | KMS/加密存储、用户或租户级 credential resolver |
| 文件系统 | 默认 local filesystem provider | 每用户/会话隔离卷，路径授权与配额 |
| 命令执行 | 默认 local subprocess/shell/terminal | 独立 Worker/容器，非 root、资源限制、网络策略 |
| 插件 | Everything-is-a-plugin，可加载用户层 patch/plugin | 插件来源签名、管理员准入、权限和版本锁定 |
| 审计 | SessionEvent 能记录模型可见事实，但不是租户安全审计 | 增加登录、授权、越权拒绝、密钥、费用和执行审计 |
| 横向扩展 | SQLite 和本机路径适合单实例本地产品 | PostgreSQL/对象存储/任务队列或明确的单写者策略 |
| 在线协作 | 未发现同一会话多人实时协作协议 | 首版只支持多人并发独立会话，不承诺实时共编 |

## 5. 首版范围冻结

首版纳入：

- 官方 Web UI 源码纳入当前仓库并在“DeepSeek Harness”页面展示。
- 复用砚都登录态和二级权限。
- 多位同事并发创建各自的会话。
- 用户级会话、工作区、文件、模型凭据和用量隔离。
- DeepSeek 模型接入。
- 文件读取、文件修改和命令执行，但只能在远程隔离执行环境中运行。
- 高风险操作审批、任务取消、基础审计和额度限制。
- 固定版本发布、灰度、回滚和上游同步记录。

首版不纳入：

- 多人同时编辑同一个 Harness 会话。
- 直接把 local subprocess provider 暴露到公网。
- 用户任意安装未经管理员批准的第三方插件。
- 自动跟随官方 `master` 或 npm `latest` 升级。
- macOS 本机构建产物直接作为 Linux 生产产物发布。

## 6. 实际测试记录

### 6.1 安装与供应链

命令：

```text
pnpm install --frozen-lockfile
```

结果：通过。

- 锁文件供应链策略：1203 条全部通过。
- 238 个 workspace project 完成安装。
- 925 个包完成解析/安装。
- 安装阶段出现 Linux ARM64/Linux x64 包在 macOS x64 上不适配的预期提示。
- 构建前 bin 链接曾提示目标 `lib/bin.js` 尚未生成，正式 build 后对应产物生成；未阻止安装或构建。

### 6.2 正式构建

等价命令：

```text
npm run build
```

结果：通过。

- Host TypeScript 与 tsdown 构建通过。
- Client TypeScript 与 tsdown 构建通过。
- Vite Web production build 通过，414 modules transformed。
- Web 构建存在大于 500 kB chunk 的性能警告，不是构建失败；阶段 1 需要记录加载性能基线。

### 6.3 许可证验证

命令：

```text
pnpm run verify-dsh-package-licenses
```

结果：通过，222 个 DSH 包全部声明 MIT。

### 6.4 核心相关测试

命令：

```text
pnpm exec vitest run \
  packages/host/webserver \
  packages/client/connection \
  packages/session/session-persistence-sqlite \
  packages/workspace/workspace
```

结果：14 个测试文件通过，255/255 测试通过。

### 6.5 Web 端到端测试

命令：

```text
pnpm run test:web:built
```

最终结果：通过。

- 75 个测试文件通过。
- 1 个测试文件按官方条件跳过。
- 253 个测试通过。
- 15 个测试按官方条件跳过。
- 0 个测试失败。
- 耗时 583.25 秒。

首次执行因 Playwright Chromium 未安装而失败；联网下载目标浏览器长时间无进度，随后使用本机已有完整 Playwright Chromium 运行环境重试并通过。该过程证明 CI/生产验收镜像必须显式安装浏览器依赖，不能依赖开发机缓存。

## 7. 阶段 0 验收结果

| 验收项 | 状态 | 证据 |
| --- | --- | --- |
| 明确版本、提交号和许可证 | 通过 | 版本 `0.1.0-rc.7`、SHA、MIT 已冻结 |
| 锁文件不使用模糊基线 | 通过 | 已记录完整 lockfile SHA-256 |
| 官方源码可在独立目录构建 | 通过 | Host、Client、Web production build 全部通过 |
| 输出依赖和平台要求 | 通过 | Node/pnpm/npm、原生依赖、Playwright 和目标平台要求已列出 |
| 输出多租户改造清单 | 通过 | 认证、会话、工作区、凭据、执行、插件和扩展缺口已列出 |
| 冻结首版范围 | 通过 | 纳入项与不纳入项已明确 |
| 公司 Fork 已建立 | 待外部信息 | 缺少公司 GitHub 组织和目标仓库名，未擅自创建外部仓库 |
| 未完成改造前不开放公网 | 通过 | 本阶段只在隔离临时目录构建和测试，未启动公网服务 |

阶段 0 当前判定：**技术基线验收通过；公司 Fork 建立项待提供目标组织/仓库后关闭。**

## 8. 阶段 1 准入条件

进入阶段 1 前需要：

1. 指定公司 GitHub 组织或目标 Fork URL。
2. 决定使用 Git subtree 还是保留独立 Fork 后以 workspace/package 方式引用；推荐公司 Fork + subtree，保留上游历史并允许当前仓库统一构建。
3. 确认生产目标为 Linux x64 还是 Linux ARM64，以便建立同平台构建和原生依赖测试。
4. 确认首版容量目标和沙箱平台（自建容器 Worker 或 E2B 类远程执行服务）。
5. 认可“多人并发独立会话，不含同会话实时共编”的首版边界。

