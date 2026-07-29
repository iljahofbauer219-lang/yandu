---
kind: error_handling
name: 错误处理体系：基于原生 Error 与业务语义化消息的混合模式
category: error_handling
scope:
    - '**'
source_files:
    - src/main/browser/BrowserWorkspace.ts
    - src/renderer/App.tsx
    - src/shared/contracts.ts
    - src/main/services/ArkVideoService.ts
---

该 Electron + Vite + pnpm Workspace 项目未引入统一的错误类型库或中间件框架，而是采用**以 `throw new Error(...)` 为主、`try/catch` 包裹为辅助**的轻量级错误处理模式，结合共享契约中的可选 `error`/`errors` 字段向上层传递。具体表现如下：

1. **主进程（BrowserWorkspace）集中抛出业务语义化错误**：在 `src/main/browser/BrowserWorkspace.ts` 中，所有浏览器操作、eBay 页面抓取、登录校验、标签页数量限制、超时等场景均通过 `throw new Error('...')` 抛出可读中文消息，如“采集保护已暂停”“请先在右侧打开 eBay 页面”“最多同时打开8个浏览标签”“eBay 原商品页加载超时”等。这些错误直接冒泡到调用方，由上层 `.catch()` 统一捕获并转为 UI 提示。

2. **服务层（services/*）同样使用原生 Error 表达配置缺失与能力验证失败**：例如 `ArkVideoService.ts` 中大量 `throw new Error('火山方舟 API Key 未配置' | '当前系统不支持 macOS 本机配音' | '视频模型尚未通过真实生成验证')`，用于阻断非法调用路径；网络请求失败则通过 `.catch(()=>({}))` 降级返回空对象，避免中断流水线。

3. **渲染器（renderer/App.tsx）统一用 `.catch(reason => setError(...))` 收敛错误**：所有 IPC 调用（selection.list、warehouses.list、comparisons.list 等）均在 `.catch()` 中将 `reason instanceof Error ? reason.message : '...'` 写入组件状态 `setError`，再由 UI 展示给用户。部分关键流程还通过 `readableError(reason, '预采集失败')` 包装上下文信息。

4. **共享契约（shared/contracts.ts）以可选字段承载错误信息**：多处接口定义包含 `error?: string`、`errors: string[]`、`lastError?: string` 等字段（如 `EbayProductSyncRun`、`EbayDirectoryProductSyncResult`、`EbayLoginResult`），表明错误既可以作为异常抛出，也可以作为响应体的一部分返回，形成“异常 + 数据”双通道。

5. **无全局错误处理器、无自定义 Error 子类、无 panic/recover**：项目中未发现 `class XxxError extends Error`、`process.on('uncaughtException')`、`try { ... } catch(e) { ... } finally { ... }` 之外的 recover 机制，也未见 Winston、Pino 等结构化日志库的错误上报集成。错误传播完全依赖 JavaScript 原生异常机制与 Promise rejection。

6. **防御性编程广泛使用 try/catch 包裹不可信操作**：对 `JSON.parse`、`URL` 构造、`executeJavaScript`、DOM 查询等可能抛错的调用普遍包裹 try/catch 并返回默认值，体现“快速失败 + 优雅降级”的倾向。