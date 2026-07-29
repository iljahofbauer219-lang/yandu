---
kind: dependency_management
name: pnpm Workspace 依赖管理
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - pnpm-workspace.yaml
    - pnpm-lock.yaml
---

本项目采用 pnpm workspace 进行依赖管理，通过根目录的 `package.json`、`pnpm-workspace.yaml` 和 `pnpm-lock.yaml` 统一管理 Electron + Vite 桌面应用的依赖。