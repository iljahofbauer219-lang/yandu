---
kind: external_dependency
name: Electron 桌面应用框架
slug: electron
category: external_dependency
category_hints:
    - vendor_identity
scope:
    - '**'
source_files:
    - package.json
    - README.md
---

### Electron 桌面应用框架
- 角色：作为桌面端运行时，承载 React + TypeScript 前端与 Node.js 后端进程
- 使用模式：通过 Vite 构建前端资源，tsc 编译 TypeScript，开发时并行启动 Vite 开发服务器和 Electron 应用
- 特性：内置持久化的 Ozon 与 1688 浏览器会话，支持 macOS 系统级路由管理
- 验证：生产构建输出到 `dist/` 目录，应用关闭最后一个窗口时完全退出避免残留进程