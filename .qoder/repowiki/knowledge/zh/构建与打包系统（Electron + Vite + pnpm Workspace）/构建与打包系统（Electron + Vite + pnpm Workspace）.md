---
kind: build_system
name: 构建与打包系统（Electron + Vite + pnpm Workspace）
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - vite.config.ts
    - pnpm-workspace.yaml
    - tsconfig.json
    - tsconfig.main.json
---

本项目采用 Electron + Vite + pnpm Workspace 的轻量级构建体系，未使用 electron-builder 等专用打包工具，而是通过 Vite 编译渲染器、TypeScript 编译主进程，最终由 Electron 直接加载产物。

**构建流程与脚本**
- `pnpm dev`：并行启动 Vite 开发服务器（端口 5173）、监听 TypeScript 主进程编译（`tsconfig.main.json`），并在两者就绪后通过 `wait-on` 等待后启动 Electron 应用，开发时 Electron 加载本地 Vite 服务。
- `pnpm build`：先执行 `vite build` 将 `src/renderer` 构建到 `dist/renderer`，再执行 `tsc -p tsconfig.main.json` 将主进程与 preload 代码编译到 `dist/main`。
- `pnpm desktop`：顺序执行 build 和 start，用于本地桌面应用调试。
- `pnpm typecheck`：对渲染器与主进程分别执行类型检查。

**Vite 配置**
- 根目录为 `src/renderer`，输出目录为 `../../dist/renderer`，启用 React 插件，base 路径设为相对路径 `./`。

**TypeScript 双配置**
- `tsconfig.json`：针对渲染器与共享代码，target ES2022，module 为 ESNext，moduleResolution 为 Bundler，strict 模式开启，noEmit 仅做类型检查。
- `tsconfig.main.json`：针对主进程与 preload，target ES2022，module 与 moduleResolution 均为 Node16，outDir 为 `dist/main`，rootDir 为 `src`，包含 `src/main`、`src/preload`、`src/shared`。

**pnpm Workspace**
- 根 `pnpm-workspace.yaml` 中通过 `allowBuilds` 显式允许 `@ffmpeg-installer/darwin-x64` 与 `protobufjs` 的原生模块构建，避免 pnpm 默认拒绝原生包构建的限制。

**产物结构**
- 渲染器产物：`dist/renderer/`（Vite 构建输出）
- 主进程产物：`dist/main/`（TypeScript 编译输出）
- Electron 入口：`package.json` 中 `main` 指向 `dist/main/main/main.js`

**打包与发布**
- 未发现 electron-builder、electron-packager、@electron-forge 等打包工具的依赖或配置，也未发现 `.github` CI 工作流文件。当前仓库仅包含开发与本地构建脚本，不包含跨平台安装包生成与自动化发布流程。

**约束与约定**
- 主进程与渲染器通过独立的 TypeScript 配置分别编译，共享代码同时被两个配置包含。
- 开发环境依赖 `concurrently` 与 `wait-on` 协调多进程启动顺序。
- 原生模块需显式在 `pnpm-workspace.yaml` 的 `allowBuilds` 中放行。