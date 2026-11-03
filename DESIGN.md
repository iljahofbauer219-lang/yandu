---
version: alpha
name: 砚都跨境桌面工作台设计契约
description: 从 src/renderer 实测代码反推的设计契约。规范层是 ui/tokens.css 的 --yd-* 变量 + ui/components.css 的 .yd-* 类 + ui/primitives.tsx 八个组件；历史层是 styles.css / 31 个模块 CSS 的硬编码样式，正待迁移。纯 CSS，无 Tailwind、无第三方 UI 库。

colors:
  brand: "#0abab5"
  brand-hover: "#079d98"
  brand-soft: "#e1f8f6"
  brand-contrast: "#075955"
  on-brand: "#063c3a"
  canvas: "#f5f6f7"
  surface: "#ffffff"
  surface-muted: "#f7f9f9"
  text: "#1d2421"
  text-secondary: "#66716c"
  text-muted: "#858e89"
  border: "#dfe5e2"
  border-strong: "#c8d1cd"
  success: "#147453"
  success-soft: "#e2f6ef"
  warning: "#8e6015"
  warning-soft: "#fff7e4"
  danger: "#a33d36"
  danger-soft: "#fff0ee"
  info: "#2563eb"
  info-soft: "#eff6ff"
  dark-canvas: "#000000"
  dark-surface: "#151f1b"
  dark-surface-muted: "#1b2822"
  dark-text: "#f2f5f4"
  dark-brand: "#00e08a"
  dark-brand-hover: "#22e89b"
  dark-brand-contrast: "#7cf0c4"
  dark-success: "#62d49f"
  dark-warning: "#ffc45e"
  dark-danger: "#ff8073"
  dark-info: "#7aa7ff"
  graphite-brand: "#0b7a75"
  graphite-brand-hover: "#096662"
  graphite-brand-soft: "#e0f0ef"
  graphite-brand-contrast: "#054a47"
  graphite-on-brand: "#ffffff"
  graphite-canvas: "#e9ecef"
  graphite-surface: "#ffffff"
  graphite-surface-muted: "#f2f4f6"
  graphite-text: "#14181c"
  graphite-text-secondary: "#47505a"
  graphite-text-muted: "#656f7a"
  graphite-border: "#d5dae0"
  graphite-border-strong: "#bcc4cc"
  graphite-success: "#176b46"
  graphite-warning: "#8a5a08"
  graphite-danger: "#b03a2e"
  graphite-info: "#2b5fd9"
  content-brand-ink: "#075955"
  content-brand-bright: "#0abab5"
  content-brand-wash: "#e8f8f7"
  content-brand-muted: "#547a77"
  content-brand-faint: "#64827f"
  content-control-ink: "#333438"
  content-nav-ink: "#646b70"
  content-status-ink: "#60676b"
  content-bg-subtle: "#f8f9fa"
  graphite-content-brand-ink: "#054a47"
  graphite-content-brand-bright: "#0b7a75"
  graphite-content-brand-wash: "#e0f0ef"
  graphite-content-brand-muted: "#4a6d6a"
  graphite-content-brand-faint: "#4a6d6a"
  graphite-content-control-ink: "#14181c"
  graphite-content-nav-ink: "#47505a"
  graphite-content-status-ink: "#656f7a"
  graphite-content-bg-subtle: "#f2f4f6"
  legacy-accent: "#0abab5"
  legacy-ink: "#1d1d1f"
  legacy-erp-success: "#1f7a44"
  legacy-erp-warning: "#9a6200"
  legacy-erp-danger: "#b42318"
  legacy-erp-info: "#3a4bb5"
  legacy-erp-teal: "#0f766e"
  legacy-erp-purple: "#7c3aed"

typography:
  heading-md:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif'
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: 0px
  body-md:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif'
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0px
  body-sm:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif'
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.50
    letterSpacing: 0px
  caption:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif'
    fontSize: 11px
    fontWeight: 400
    lineHeight: 16px
    letterSpacing: 0px
  button-md:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif'
    fontSize: 13px
    fontWeight: 650
    lineHeight: 1
    letterSpacing: 0px
  badge-md:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif'
    fontSize: 12px
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: 0px
  field-input:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif'
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0px

rounded:
  control: 8px
  card: 12px
  dialog: 16px
  full: 999px

spacing:
  1: 4px
  2: 8px
  3: 12px
  4: 16px
  6: 24px

components:
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.button-md}"
    rounded: "{rounded.control}"
    padding: "0px 16px"
    height: 36px
  button-secondary-hover:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
  button-secondary-disabled:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.control}"
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.on-brand}"
    typography: "{typography.button-md}"
    rounded: "{rounded.control}"
    padding: "0px 16px"
    height: 36px
  button-primary-hover:
    backgroundColor: "{colors.brand-hover}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.danger}"
    typography: "{typography.button-md}"
    rounded: "{rounded.control}"
    padding: "0px 16px"
    height: 36px
  button-danger-hover:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
    rounded: "{rounded.control}"
  field-input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.field-input}"
    rounded: "{rounded.control}"
    padding: "8px 11px"
    height: 38px
  field-input-error:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.danger}"
    rounded: "{rounded.control}"
  card-default:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body-md}"
    rounded: "{rounded.card}"
    padding: "{spacing.4}"
  status-badge:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success}"
    typography: "{typography.badge-md}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
    height: 24px
  notice:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.body-md}"
    rounded: "{rounded.control}"
    padding: "12px 16px"
  modal:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body-md}"
    rounded: "{rounded.dialog}"
    padding: "20px"
    width: 560px
  empty-state:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.body-md}"
    padding: "{spacing.6}"
    minHeight: 140px
---

## Overview

砚都跨境是 Electron 桌面工作台，服务跨境电商的选品、货盘、eBay 刊登与 AI 生图。界面气质为「彩色扁平 + 严格对齐列 + 行式列表」：品牌青 `{colors.brand}` 驱动主操作，浅灰画布 `{colors.canvas}` 上铺白色卡片，靠 1px 描边 `{colors.border}` 与留白分区，不用重投影。信息密度优先——正文 13px 起，元信息 11–12px。

本文件描述的是**目标规范层**：`src/renderer/ui/tokens.css`（`--yd-*` 变量）、`src/renderer/ui/components.css`（`.yd-*` 类）、`src/renderer/ui/primitives.tsx`（`Button` / `StatusBadge` / `Notice` / `Card` / `Field` / `LoadingState` / `EmptyState` / `Modal`）。仓库里同时存在**历史层**：`styles.css` 的 `--tiffany/--accent/--erp-*`、`ui-readability.css` 的 `--ui-*`、以及 31 个模块 CSS 里的硬编码值。新增或重构 UI 一律走规范层；改历史层时按迁移处理，不扩散旧写法。

## Colors

规范层的色彩全部来自 `--yd-*`。主题有两个正交的维度，都写在 `<html>` 上：`data-theme` = **主题名**（`light` / `dark` / `graphite`），`data-theme-mode` = **明暗档**（`light` / `dark`）。浅/暗取值成对给出：`tokens.css` 的 `:root` 是浅色基线，`[data-theme-mode="dark"]` 覆盖暗值；历史层的深色覆盖表（`theme-dark.css` 及模块 CSS，共 375 处选择器）一律挂在**明暗档**上，所以再加第 3 套主题只需补一个 `[data-theme="…"]` token 块，不必配深色覆盖层。主操作 `{colors.brand}`，hover 降到 `{colors.brand-hover}`，深底反白文字用 `{colors.on-brand}`；文本三级 `{colors.text}` / `{colors.text-secondary}` / `{colors.text-muted}`；表面三层 `{colors.canvas}` / `{colors.surface}` / `{colors.surface-muted}`；描边两级 `{colors.border}` / `{colors.border-strong}`。语义色四组各配一个 soft 底色：`success`、`warning`、`danger`、`info`。暗色下品牌色整体换成绿色 `{colors.dark-brand}`，画布纯黑。

第 3 套「砚石 Graphite」（`[data-theme="graphite"]`）明暗档仍是 `light`：砚都青压深一档为 `{colors.graphite-brand}`（#0b7a75），中性面转冷石墨灰，品牌实底反白改用 `{colors.graphite-on-brand}`（#ffffff 对 #0b7a75 实测 5.18:1，而 Tiffany 底在浅色主题下只能容 2.41:1）。用户在标题栏「主题」菜单里选，偏好持久化在 localStorage `app-theme:v1`，四值 `system` / `light` / `graphite` / `dark`，`system` 跟随 macOS 明暗；解析规则在 `src/renderer/ui/theme.ts`，单测在 `ui/__tests__/theme.test.ts`。

内容层的可换档色走 `content-*` 九支（`--yd-content-brand-ink/bright/wash/muted/faint`、`--yd-content-control-ink/nav-ink/status-ink/bg-subtle`，定义在 `tokens.css` 的 `:root`，只在 `[data-theme="graphite"]` 里重定义）。它们**刻意不进 `[data-theme-mode="dark"]`**：历史层这些位置原本就是写死的 hex，若改引用 `--yd-brand-contrast` 一类既有变量，深色档会跟着变量换成 `#7cf0c4`，属于改观感。所以九支变量的 `:root` 值 = 今天的原 hex，浅色与深色按构造零变化，只有砚石换值——这条不变量由 `/tmp` 一次性 A/B 门卫（同一冻结 DOM × 前后两份构建 CSS × 三档主题，RGBA 逐像素）与快照屏锚点共同守着。`content-brand-muted` / `content-brand-faint` 两支是砚石专档收口的旧账：浅色仍是 4.34:1 / 3.81:1（未达标，见 Known Gaps），砚石下两者同为 `#4a6d6a`，压 `#e0f0ef` 达 4.85:1。

`legacy-*` 条目只为让历史值可追溯，不代表可继续使用。**禁止在功能代码里新增未登记进本文件的 hex/rgb**：需要新色值时先在 `tokens.css` 加 `--yd-*`，再补本文档条目。

## Typography

中文环境优先 `-apple-system / PingFang SC`，表单输入 `{typography.field-input}`（14px，保证可读与系统输入一致）。层级：对话框标题 `{typography.heading-md}`（18px）、正文 `{typography.body-md}`（13px / 1.55）、说明 `{typography.body-sm}`（12px）、表格元信息与徽章 `{typography.caption}` / `{typography.badge-md}`。按钮文字固定 `{typography.button-md}`（13px / 650）。

历史层的 `--ui-text-*` / `--ui-title-*` 变量（11/12/13/15/17/20px）仍在生效，收敛方向是并入本节层级。正文不得为「塞更多内容」压到 13px 以下；11px 只用于标签、徽章、时间戳等非正文短文本。

## Layout

间距阶梯只有一个来源：`--yd-space-1/2/3/4/6` = `{spacing.1}`…`{spacing.6}`（4/8/12/16/24px）。卡片内边距 `{spacing.4}`，卡片与区块间距 `{spacing.3}`，表单组内间距 `{spacing.2}`，标签与控件间距 6px（历史遗留，待并入阶梯）。骨架为应用外壳双列：68px 图标侧栏 + 弹性内容区。

列表类界面必须对齐成列：数值、状态、时间各占固定列宽，同类行高度一致；下拉控件不画 caret 装饰，底托用长方形而非胶囊。命中高度：`Button` 36px、`Field` 输入 38px、历史全局控件 38/40/44px（`--ui-control-height*`），新代码取 36/38px 两档。分区靠间距与描边，不靠背景色块堆叠；不要为单点界面新增一次性 margin，优先落到阶梯。

## Elevation & Depth

扁平优先，层级靠描边。投影只有三处：规范层的对话框 `0 24px 70px rgb(0 0 0 / 28%)`（唯一带投影的组件，因其需浮于内容之上）、历史卡片 `--shadow-card: 0 5px 20px rgba(0,0,0,.035)`、历史面板 `0 2px 8px rgba(25,48,39,.04)`。不要新造第四种阴影。

焦点可见性：规范层控件用 `outline: 2px solid var(--yd-brand)` + `box-shadow: var(--yd-focus-ring)`（3px 青色光环）；历史层由 `ui-readability.css` 统一给 3px `rgba(10,186,181,.2)` 轮廓。任何组件不得 `outline: none` 抹掉焦点环（`.yd-field input` 的 `outline: none` 紧跟 `:focus-visible` 重设，属合规写法）。遮罩 `rgb(5 12 9 / 58%)`，z-index 1000。暗色历史主题下 `--card-blur` 14px、`--glow` 青绿发光，用户以 `[data-effects="off"]` 关闭特效时回落 `0px` / `none`；新 UI 的模糊与发光必须挂在变量上，不要写死。

## Shapes

圆角四档全部变量化：控件 `{rounded.control}`（8px，`--yd-radius-control`）、卡片 `{rounded.card}`（12px，`--yd-radius-card`）、对话框 `{rounded.dialog}`（16px，`--yd-radius-dialog`）、胶囊 `{rounded.full}`（999px，仅徽章与头像类）。

历史层存在 5/6/7/9/10/11/13/14px 等未变量化圆角（例如全局 `button` 9px、面板 13px），属已登记债务，向四档收敛。禁止新增第五种一次性圆角。

## Components

规范层组件即设计系统本体，从 `ui/primitives` 导入：

- `{components.button-primary}` / `{components.button-secondary}` / `{components.button-danger}`：`Button` 的三个 `variant`，另支持 `loading`（内置 `yd-spinner` + `aria-busy`）。
- `{components.field-input}`：`Field`，自带 label、`required` 星号、hint、error（写 `aria-invalid` + `aria-describedby`）。
- `{components.status-badge}`：`StatusBadge` 四 `tone`；`{components.notice}`：`Notice` 四 `tone`。
- `{components.card-default}`：`Card`；`{components.modal}`：`Modal`（焦点陷阱、Esc 关闭、`aria-modal`、portal 到 body）；`{components.empty-state}` 与 `LoadingState` 补齐空/加载态。

交互状态矩阵（规范层已实现，新增组件须逐条覆盖）：default / hover / focus-visible / active / disabled（`opacity: .56`）/ loading（spinner）/ error（`--error` 修饰类 + `aria-invalid`），并对 `prefers-reduced-motion: reduce` 关闭过渡与旋转。

当前采用度极低：`src/renderer` 89 个 UI 文件里只有 `SessionGate.tsx`、`SystemAdmin.tsx` 导入 `ui/primitives`，其余界面仍用全局元素选择器与模块 CSS 类，因此会大量报出 `component-library-bypass`。这类告警按「迁移信号」读，不当作即时阻塞；新代码必须用规范层组件。历史层的 `.primary` / 全局 `button` / `--erp-*` 属迁移来源，逐模块替换。

## Do's and Don'ts

Do:

- 新 UI 从 `ui/primitives` 取 `Button` / `Field` / `Card` / `Modal` / `Notice` / `StatusBadge` / `LoadingState` / `EmptyState`。
- 颜色、间距、圆角、阴影、动效时长引用 `--yd-*` 变量；局部需求先补变量再引用。
- 成对写浅/暗值，实测两种主题下的文字对比度。
- 列表保持等宽对齐列，行式布局优先于卡片堆叠。
- 迁移一个模块时，顺带删掉该模块被替换的旧规则，避免两层叠加。

Don't:

- 在功能代码里硬编码 hex、`rgb()/rgba()`、px 圆角或阴影。
- 写 `style={{...}}` 内联样式（运行时计算值如坐标、进度宽度除外，且需说明原因）。
- 绕过 primitives 自己写同名全局 `button` / `input` 规则，或再造一套 `.card` / `.badge`。
- 用 `outline: none` 或透明边框隐藏焦点环。
- 引入 Tailwind、CSS Modules 或第三方 UI 库来解决债务——先做架构决策。

## Responsive Behavior

宿主为桌面 Electron 窗口，不做移动端断点。窗口宽度变化：侧栏固定 68px，内容区弹性伸缩；多列表格窄窗口下横向滚动而不折叠列；网格卡片 `auto-fit` 换列、列间距 `{spacing.3}`。左右分栏页面（智库首页、货盘仓库等）宽度不足时收起右栏，不压缩正文行宽。字号不随视口缩放。`Modal` 宽度取 `min(560px, 100%)`、高度 `min(760px, 100vh - 48px)`，保证极窄窗口不溢出。动效遵循 `prefers-reduced-motion`。

## Known Gaps

- `needs-design-decision`：规范层（`ui/primitives` + `.yd-*`）已完整但仅 2 个文件采用，历史层 31 个 CSS 与 `App.tsx` 巨型容器仍是主力。需要决定迁移节奏（按模块逐替换 vs 冻结新功能再整体重写）。
- `needs-design-decision`：历史层未登记 hex 共 4296 处、`rgb()/rgba()` 518 处、未变量化 px 值 10663 处（债务真值 15,834 条、组件绕过 1,172 条；审计脚本会截断到 1000 条，报告内数字非真值），需要分批变量化。本文档只登记规范层真实 token，未把散落值洗白。
- `needs-design-decision`：`{components.button-primary-hover}` 自身写死 `textColor: "#ffffff"`，对 `{colors.brand-hover}`（#079d98）只有 3.34:1，13px/650 不过 WCAG AA；改 `{colors.on-brand}` 也只有 3.66:1。要同时保住「hover 变深」的手感与达标，需设计侧定一档（候选：hover 底色降到 `{colors.brand-contrast}` #075955 + 白字 = 8.17:1）。
- `needs-design-decision`：白字压 Tiffany 的同族缺陷还剩 9 条规则（`styles.css` 3 处、`image-studio.css` 6 处，均为 `color:#fff` + `#0abab5`/`var(--tiffany)`），每条实测 2.41:1。本轮修掉的 2 处（`.address-go` 8px→13px、`.build-stamp`）已进活体：2026-10-17 17:28 重启后活体 axe 在「外壳」（`main` 之外）报 0 条对比度违规。其余 9 条分布在系统管理、eBay 同步等页面，需一次批量迁移并逐页截屏复核。
- `needs-design-decision`：`main` 内的正文对比度从未被任何闸口度量过——遮罩只作用于截图，axe 仍扫全文档，所以外壳干净不等于页面达标。2026-10-17 活体 AI跨境页实测 18 条 `color-contrast`（3.24–4.48，全在 `main` 内：`.ebay-compliance-strip` 6px/7px 小字、阶段栏按钮 `#71787c/#ffffff` 4.48、`.ebay-title-label` 3.47、市场卡标签 3.43）+ 2 条 `label-content-name-mismatch`（`aria-label` 与可见文案不一致）。2026-10-22 用同一冻结帧走快照屏复算（`tools/design-qa-snapshot.mjs --axe`）得 24 节点 `color-contrast` + 2 节点 `label-content-name-mismatch` + 1 节点 `page-has-heading-one`，其中最低 1.83:1（`.score-badge` 8px 粗体 `#969ca0` 压 `#8ee0db`），市场卡 `<dt>` 标签 3.12:1 成批出现。这些是业务内容而非外壳，需要设计侧先定「页内小字的最小字号与色档」再逐页收口。
- `needs-design-decision`：外壳（标题栏 + 侧栏 + 内容区）没有任何 `h1`，axe 报 `page-has-heading-one`。加不加、加在标题栏产品名还是页面标题，属信息架构决策，未擅自动 DOM。
- `needs-design-decision`：两套语义色并存（`--yd-*` 与 `--erp-*`）数值接近但不等价（如 danger `#a33d36` vs `#b42318`），需要确定以哪套为唯一真值。
- `needs-design-decision`：圆角与间距的第四档（如 6px 标签间距）尚未进阶梯。
- `needs-design-decision`：`LoadingState` / `EmptyState` / `Notice` 尚未覆盖 eBay 图像工作流、入库闸口等既有提示，错误文案的中文化与动作按钮规范需并入。
- 取证链路已建立（2026-10-17）：渲染面没有 HTTP 可达地址，活体窗口只由 `tools/design-qa-cdp.mjs` 经 CDP 取景（截图 + axe），插件原生阶段改读 `tools/design-qa-snapshot.mjs` 生成的静态快照（冻结 DOM + 内联构建 CSS，`http://127.0.0.1:4390/harness/…`）。快照屏另跑 `tools/design-qa-snapshot.mjs --axe`（写 `reports/a11y-snapshot.json`，不覆盖活体 `a11y.json`），使纯 CSS 改动免重启即可复算对比度；`--verify` 逐属性比活体 vs 快照，是保真门卫。仍待办：快照只冻结取景时所在的那一屏，多屏基线需在实机逐页取景。
- `needs-design-decision`：基线与页面态绑死。快照屏 `maxDiffPixels: 0` 下，同一套 CSS 只是活体从「IE浏览」换到「AI跨境」就报 7,592 px 差异——逐像素定位证明它们全是页面态而非设计漂移：侧栏两条 66px 导航行（y 64–129 与 y 336–401，即高亮行换位，7,232 px）+ 标题栏仅在 AI跨境出现的「收起」按钮图标（x 1089–1132，360 px）。要么约定「重播基线前先把实机停在固定页」，要么把条件性标题栏控件也纳入遮罩（会少掉这块设计覆盖面），属设计侧取舍，未擅自改动闸口。2026-11-03 第 2 期再撞一次并给出了判别法：对着 10-17 的基线，快照屏报 7,592 px（pixelmatch 6,992，差值即 AA 像素），但**同一份冻结 DOM 换上改前/改后两份构建 CSS 互为对照 = 0 px**（`main` 遮罩区外，1,247,040 px 全等），可见这 7,592 px 全部来自 16 天里活体页面态的位移，与本轮 CSS 无关。所以「等值替换」的证明要用同 DOM CSS-A/B，不能用跨时间基线比对；基线本身仍待设计侧确认后重播。
- `needs-design-decision`：砚石的内容层覆盖已从「零」推进到「主框架可换档，长尾未收」。2026-11-03 第 2 期把 eBay 内容帧上出现频次最高的 9 支色 token 化（`image-studio.css` 87 处 + `styles.css` 51 处引用），并在 `theme-graphite.css` 补 `[data-theme="graphite"] body{color:var(--yd-text)}` 桥掉 `ui-readability.css` 里那行 `body{color:#202927}`（该文件在本轮范围外，只能在砚石档就地覆盖）。同一冻结 eBay 帧实测：砚石相对改前换档 106,878 px（8.57%），浅色与深色 0 px。剩余未 token 化的近重复家族仍在浅色层写死，砚石下仍呈 Tiffany 观感：`#e5f8f6`/`#e7f8f6`/`#dff6f4`/`#edf9f8`（品牌浅底四兄弟，与 `content-brand-wash` 差 3–14 个色阶）、`#8b9296`/`#949b9f`/`#7e898d`/`#9aa49f`/`#8b8e93`/`#8a9691`（说明文字六兄弟，正是砚石下仅剩的 4 条对比度违规）、`#5f6368`/`#fbfbfc`/`#e6e6e8`（外壳侧栏）、`#176a67`/`#087a75`/`#08736f`/`#086a66`（青绿中间档散落值）、以及 `theme-dark.css` 的 375 条明暗档覆盖表（按明暗命中，砚石不享有对应深色层）。合档会改浅色观感，需设计侧先定「一族一档」的取值表再收口（与第 1 条迁移节奏是同一个决策）。
- `needs-design-decision`：内容页对比度已在 eBay 内容帧量到并部分收口，长尾仍待设计侧定档。2026-11-03 同一帧 axe `color-contrast`：浅色 8 条违规 / 24 passes，砚石改前 6 / 26，砚石第 2 期后 4 / 28。砚石已消掉的：`.ebay-workbench-heading > small` 与 `.ebay-browser-heading-main > div > small`（`#0abab5` 压白 2.41，由 `--tiffany` 换深青解决）、`.ebay-auto-login-banner > div > small`（4.33 → `content-brand-muted` #4a6d6a 压 #e0f0ef 达 4.85）、`.ebay-login-status > div > small`（3.80 → 同上）。浅色仍是旧账的两条：`#547a77` 压 `#e8f8f7` 4.34、`#64827f` 压 `#e8f8f7` 3.81（本轮按「浅色等值」原则压深底未动，压深会改浅色观感）。砚石剩下的 4 条全属未 token 化的说明文字灰：`#8b9296` 3.15、`#949b9f` 2.81、`#7e898d` 3.48、`.browser-placeholder` `#9aa49f` 2.32。另两条历史账不变：2026-10-22 AI跨境帧 24 节点（最低 `.score-badge` 1.83）与 `label-content-name-mismatch` / `page-has-heading-one`。需要设计侧先定「页内小字的最小字号与色档」，再逐页收口。
