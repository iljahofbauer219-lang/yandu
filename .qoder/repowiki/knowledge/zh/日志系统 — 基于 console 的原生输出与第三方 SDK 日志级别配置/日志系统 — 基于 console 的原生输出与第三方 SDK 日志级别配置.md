---
kind: logging_system
name: 日志系统 — 基于 console 的原生输出与第三方 SDK 日志级别配置
category: logging_system
scope:
    - '**'
source_files:
    - src/main/main.ts
    - src/main/services/FeishuBotService.ts
---

本仓库未引入专用日志框架（如 winston、pino、bunyan 等），整体采用 Node.js/Electron 原生 `console` API 进行输出，并在个别第三方 SDK 初始化时通过其内置的 `loggerLevel` 参数控制日志级别。

1. 使用的系统与工具
- 主进程与业务服务：统一使用 `console.log / console.info / console.warn / console.error` 直接输出到标准输出/错误流，无结构化字段、无文件落盘、无集中路由。
- 飞书 SDK（@larksuiteoapi/node-sdk）：在 `FeishuBotService.ts` 中通过 `Lark.WSClient({ ..., loggerLevel: Lark.LoggerLevel.warn })` 将 SDK 内部日志级别限制为 warn，避免过多调试信息。

2. 关键文件与位置
- src/main/main.ts：应用主入口，包含多处 `console.warn`、`console.info`、`console.error` 调用，用于合规同步失败、飞书机器人启用状态、长连接启动异常等场景。
- src/main/services/FeishuBotService.ts：飞书机器人服务，除自身 `console.error` 外，还通过 SDK 配置项设置日志级别。
- 渲染进程（src/renderer/*）：未发现任何 `console.*` 调用，前端 UI 层不直接输出日志。

3. 架构与约定
- 日志输出集中在 Electron 主进程侧，渲染进程不产生日志；所有业务异常、外部服务调用失败、用户操作反馈均通过 `console.*` 打印。
- 日志格式非结构化，仅以字符串拼接或对象展开形式输出，没有统一的字段规范（如 timestamp、level、service、traceId 等）。
- 第三方 SDK 的日志行为通过各自提供的配置项控制（如飞书 WSClient 的 `loggerLevel`），而非全局拦截或替换。

4. 约定与约束
- 未定义统一的日志等级策略，实际使用上 `info` 多用于环境检查（如飞书未启用提示），`warn` 用于可恢复异常，`error` 用于不可恢复错误。
- 未实现日志分级开关、采样、异步写入或持久化存储，所有日志均为同步控制台输出。
- 未对敏感信息做脱敏处理，错误消息可能直接包含原始文本内容。