---
kind: frontend_style
name: 砚都跨境桌面应用前端样式体系（纯 CSS + CSS 变量主题）
category: frontend_style
scope:
    - '**'
source_files:
    - src/renderer/main.tsx
    - src/renderer/styles.css
    - src/renderer/image-studio.css
    - src/renderer/compliance.css
    - src/renderer/ebay-local-listing-editor.css
    - src/renderer/ui-readability.css
    - browser-extension/popup.css
    - browser-extension/content-script.css
    - vite.config.ts
    - package.json
---

## 1. 系统/方法
- 技术栈：React + Vite，渲染器入口 `src/renderer/main.tsx` 直接导入多个 `.css` 文件，未使用任何 CSS-in-JS、Tailwind、SCSS/Less 或组件库。
- 样式组织：采用“单文件全局 CSS”模式，每个业务模块一个独立 CSS 文件，由入口统一 import；通过 CSS 自定义属性（`:root { --tiffany, --ink, --muted, --line, --panel, --canvas }`）实现主题变量。

## 2. 关键文件与包
- 入口与构建：`vite.config.ts`（Vite React 插件，根目录 `src/renderer`）、`package.json`（dev/build/start 脚本）、`src/renderer/index.html`（挂载 `#root`）、`src/renderer/main.tsx`（集中 import 所有样式）。
- 核心样式：`src/renderer/styles.css`（全局布局、侧边栏、工作区、表单、响应式断点等基础样式，并包含 Apple-style “Tiffany” 主题覆盖）。
- 业务样式：`image-studio.css`、`compliance*.css`、`ebay-local-listing-editor.css`、`ebay-acceptance-readable.css`、`ui-readability.css` 等。
- 浏览器扩展样式：`browser-extension/popup.css`、`browser-extension/content-script.css`（注入到第三方页面的采集按钮样式）。

## 3. 架构与约定
- 样式加载顺序：`main.tsx` 按固定顺序 import styles → image-studio → compliance → ebay-acceptance-readable → ui-readability，后导入的样式可覆盖前者，形成“基础层 + 功能层 + 覆盖层”的分层。
- 命名约定：全部使用 BEM 风格类名（如 `.task-panel`、`.browser-panel`、`.ebay-browser-tabs`），无模块化 CSS 工具，类名即组件边界。
- 主题系统：通过 `:root` 定义 `--tiffany`（主色 #0abab5）、`--tiffany-soft`、`--ink`、`--muted`、`--line`、`--panel`、`--canvas` 等变量，配合 `-apple-system` / `SF Pro Text` / `PingFang SC` 字体栈，整体呈现 Apple 风格的浅灰底 + 青绿色强调。
- 布局策略：大量使用 CSS Grid（`.app-shell`、`.workspace`、`.candidate-filterbar`、`.compare-cost-grid` 等）+ Flexbox 组合，配合 `@media (max-width: ...)` 断点做响应式适配。
- 组件化视觉：每个页面/面板都有独立的 wrapper class（如 `.ebay-content-v2`、`.realshift-page`、`.publishing-page`），内部再细分 heading/body/footer 结构，保证模块间视觉隔离。

## 4. 约定与约束
- 无预处理器/框架：仓库中未发现 Tailwind、Sass、Less、CSS Modules、Styled Components 等，所有样式均为原生 CSS。
- 单一入口导入：新增样式必须通过 `src/renderer/main.tsx` 统一 import，避免样式遗漏或重复。
- 主题变量优先：新 UI 元素应复用 `var(--tiffany)`、`var(--line)`、`var(--panel)` 等变量，而非硬编码颜色值。
- 响应式断点：项目已定义 1100px/1200px/1300px/1400px 等多档断点，新增布局需遵循已有断点粒度。
- 浏览器扩展样式隔离：`content-script.css` 使用 `!important` 强制覆盖目标站点样式，popup 样式保持独立，不与主应用冲突。