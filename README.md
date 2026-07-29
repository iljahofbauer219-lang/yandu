# 砚都跨境桌面应用

Electron + React + TypeScript 桌面端骨架，内置独立持久化的 Ozon 与 1688 浏览器会话。

Ozon 与 1688 均在本机 Electron 中运行。Ozon 会话强制使用 `direct` 模式，绕过 macOS 的 HTTP/HTTPS/SOCKS 代理，并使用标准 Chromium User-Agent 与俄语请求语言；系统级路由仍由 macOS 管理。

## 开发

```bash
pnpm install
pnpm dev
```

## 构建检查

```bash
pnpm typecheck
pnpm build
```

桌面快捷方式使用 `pnpm desktop`，会先完成生产构建，再直接读取本地构建文件启动；它不依赖 Vite 端口。

生产入口位于 `dist/main/main/main.js`，页面位于 `dist/renderer/index.html`。

应用关闭最后一个窗口时会完全退出，避免 macOS 留下无窗口进程并阻止快捷方式再次启动。

当前阶段实现浏览器工作台与选品任务草稿。下一阶段接入 SQLite 状态机、Ozon 列表/详情采集器和失败诊断。

任务与 Ozon 商品会持久化到 Electron 用户数据目录下的 `sourcing-data.sqlite`。应用更新或重启后会自动恢复最近一次任务及商品数据。

商品图片、Ozon 详情和 1688 搜款会在工作台内部创建独立浏览标签页；标签可切换和关闭，并继续复用对应平台的持久化会话。

完整业务阶段为：采集、比价、选品、入库、上架。每个阶段在同一个 SQLite 文件内使用独立业务表，并通过任务 ID 与 Ozon 商品 URL 关联；另有 `workflow_events` 保存跨阶段操作轨迹。

## 飞书机器人

机器人通过飞书长连接接收指令，无需公网回调地址。在 `.env.local` 配置 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET` 后，启动桌面应用即会同时启动机器人。可选用逗号分隔的 `FEISHU_ALLOWED_OPEN_IDS` 限制可执行人员。

飞书开放平台需要开启机器人能力，使用长连接订阅 `im.message.receive_v1`，并申请“读取用户发给机器人的单聊消息”与“以应用的身份发消息”权限，然后发布应用版本。

指令：`采集 Ozon <关键词> [数量]`、`采集 1688 <关键词> [数量]`、`状态`、`帮助`。桌面端与机器人共用任务执行器，同一时间只执行一个采集任务。

配置 `DEEPSEEK_API_KEY` 后，非标准格式的飞书消息会先由 DeepSeek 转换为受控的结构化指令。DeepSeek 只负责理解 `collect`、`status`、`help` 或 `unknown`，不直接操作浏览器或数据库；平台、数量和关键词会经过本地白名单及范围校验后才会执行。
