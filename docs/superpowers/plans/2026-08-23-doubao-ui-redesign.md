# DeepSeek Codex UI 豆包化重构 — 阶段执行方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 DeepSeek Codex 在线参谋 (Online Advisor) 的渲染层 UI 向豆包对齐,涵盖字体/色彩/布局/交互/dark mode。

**Architecture:**
- **不动** 后端 IPC 协议、preload、state shape
- **只动** `src/renderer/OnlineAdvisorExperience.tsx`、`src/renderer/AIMessageContent.tsx`、`src/renderer/online-advisor-experience.css`
- 通过 CSS 设计令牌 (`:root` 自定义属性) 集中管理主题,保证 dark mode 切换无侵入
- 6 阶段独立 commit,每阶段自包含,中间可暂停截图对比

**Tech Stack:** React 18 + TypeScript + 原生 CSS (Shadow DOM,inline styles via `<style>` tag)。**不引入** Tailwind / CSS-in-JS / 新依赖。

---

## 用户痛点 → 解决方案 → 阶段映射

| # | 用户提到的问题 | 解决方案 | 所属阶段 |
|---|---|---|---|
| 1 | 字体大小偏小 | 引入字号阶梯 token,主体 14-15px,meta 11-12px | P1 + P2 |
| 2 | 颜色布局偏暖 | 完全切换到豆包蓝白 (`#165DFF` 主色),去掉砚都墨绿 | P1 |
| 3 | 上文过长需向下箭头 | scroll-to-latest 改 `position: absolute` 圆形浮窗 | P4 |
| 4 | 回复用表格(豆包式) | 保留现有 card 化 `MarkdownTable`,新主题 + sticky 表头 + hover 操作 | P3 |
| 5 | 豆包其它值得学的 UI | hover 操作行 / 流式光标 / 重生成 / 主题切换 / 加载态 / 错误降级 / 引用卡片 | P3 + P6 |

---

## 用户决策 (2026-08-23)

- ✅ 完全豆包蓝白 (去砚都墨绿)
- ✅ 表格保留 card 设计 (便于复制/下载)
- ✅ P6 全做 6.1-6.8
- ✅ dark mode (P6.4)

---

## 设计令牌 (P1 一次性建立)

```css
:root {
  /* 字号 */
  --fs-xs: 11px;
  --fs-sm: 12px;
  --fs-base: 14px;
  --fs-md: 15px;
  --fs-lg: 17px;
  --fs-xl: 20px;
  --fs-h: 24px;

  /* 行高 */
  --lh-tight: 1.4;
  --lh-normal: 1.65;
  --lh-loose: 1.8;

  /* 色彩 (豆包蓝白) */
  --color-bg: #ffffff;
  --color-surface: #f7f8fa;
  --color-surface-2: #f1f3f5;
  --color-border: #e5e7eb;
  --color-border-strong: #d1d5db;
  --color-text-primary: #1f2329;
  --color-text-secondary: #646a73;
  --color-text-tertiary: #8f959e;
  --color-accent: #165DFF;
  --color-accent-hover: #0E47D9;
  --color-accent-soft: #E8F0FF;
  --color-accent-soft-2: #F0F5FF;
  --color-success: #00b96b;
  --color-warn: #ff7d00;
  --color-error: #f54a45;

  /* 圆角 */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;
  --radius-pill: 999px;

  /* 阴影 */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow-md: 0 6px 18px rgba(0, 0, 0, 0.08);
  --shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.12);

  /* 间距 */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;

  /* 字体栈 */
  --font-family: Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace;
}

[data-theme="dark"] {
  --color-bg: #1a1d23;
  --color-surface: #23262d;
  --color-surface-2: #2c2f37;
  --color-border: #353942;
  --color-border-strong: #4a4f5a;
  --color-text-primary: #e6e8ec;
  --color-text-secondary: #a0a4ad;
  --color-text-tertiary: #6e7280;
  --color-accent: #4a8aff;
  --color-accent-hover: #6ba0ff;
  --color-accent-soft: #1e2a45;
  --color-accent-soft-2: #182238;
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 6px 18px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.5);
}
```

---

## P1 — 字体 / 颜色 / 间距基线重置 (基础)

**Files:**
- Modify: `src/renderer/online-advisor-experience.css:1-50` (在 `:host` 后插入 design tokens)
- Test: 桌面启动,目测字体/颜色变化

- [ ] **Step 1.1: 备份当前 `:host` 段,新增 token 块**

将 `src/renderer/online-advisor-experience.css:1-12` 的 `:host { ... }` 块保持不动,在其后追加 `:root { ... }` 块(包含上述 design tokens)。

- [ ] **Step 1.2: 引入 dark mode 的 `[data-theme="dark"]` 覆写块**

紧随 `:root` 块后追加深色主题变量覆写。

- [ ] **Step 1.3: 验证**

- `npx tsc --noEmit` 通过
- 桌面启动 → 字号无变化但 token 已就位(P2 才开始大量替换)
- DevTools 查 `:root` 能看到所有 `--fs-*` / `--color-*`

- [ ] **Step 1.4: Commit**

```bash
git add src/renderer/online-advisor-experience.css
git commit -m "style(online-advisor): 引入 design tokens (字号/色彩/圆角/阴影/间距) + dark mode 变量"
```

**验收:**
- 设计令牌全部生效,可通过 DevTools 看到
- 现有 12 处 `font-size: xx px` 字面量暂不替换,留到 P2
- 暗色变量定义存在但未启用(P6.4 才生效)

**预估改动量:** +90 / -5

---

## P2 — 主布局与聊天列居中

**Files:**
- Modify: `src/renderer/online-advisor-experience.css` (`.app-shell` / `.topbar` / `.sidebar` / `.chat-panel` / `.message` / `.composer textarea` 等处字号)

- [ ] **Step 2.1: `.app-shell` 改为左右分栏,主区 1fr**

将 `grid-template-rows: 58px minmax(0, 1fr)` 改为 `grid-template-rows: 60px minmax(0, 1fr)`,新增 `grid-template-columns: 240px minmax(0, 1fr)`。

- [ ] **Step 2.2: `.chat-panel` 居中 + max-width 780px**

```css
.chat-panel {
  display: grid;
  min-width: 0;
  min-height: 0;
  max-width: 780px;
  margin: 0 auto;
  width: 100%;
  padding: 0 var(--space-6) var(--space-5);
  grid-template-rows: auto minmax(0, 1fr) auto;
}
```

- [ ] **Step 2.3: 字号批量替换 (基于 token)**

| 位置 | 原值 | 新值 |
|---|---|---|
| `.chat-heading h2` | 15px | `var(--fs-md)` |
| `.message-label` | (无固定) | `var(--fs-sm)` + font-weight 600 |
| `.empty-state h3` | 15px | `var(--fs-lg)` |
| `.ai-markdown-content` | (继承) | `font-size: var(--fs-base); line-height: var(--lh-loose)` |
| `.composer textarea` | 12px / 1.55 | `var(--fs-base)` / 1.6 |
| `.message pre code` | 12px | `var(--fs-sm)` |

- [ ] **Step 2.4: 顶栏 backdrop blur + 60px 高度**

```css
.topbar {
  position: sticky; top: 0; z-index: 10;
  height: 60px;
  backdrop-filter: blur(12px);
  background: rgba(255, 255, 255, 0.78);
  border-bottom: 1px solid var(--color-border);
}
```

- [ ] **Step 2.5: 验证 + Commit**

- `npx tsc --noEmit` 通过
- 启动截图:聊天列居中不超 780px
- 字号肉眼可感变大

```bash
git add src/renderer/online-advisor-experience.css
git commit -m "style(online-advisor): 聊天列居中 780px + 字号批量升级到 design token"
```

**验收:**
- 1200×800 窗口下聊天列水平居中
- 主体文字明显放大、行距更舒展
- 顶栏半透模糊生效

**预估改动量:** +80 / -40

---

## P3 — 消息气泡 + 表格视觉强化

**Files:**
- Modify: `src/renderer/online-advisor-experience.css` (`.message` / `.ai-markdown-content` / `.ai-markdown-table-card` / `.ai-markdown-document-card`)
- Modify: `src/renderer/AIMessageContent.tsx` (`.ai-markdown-table-card` 加 sticky `<thead>`,保留 card 设计)
- Modify: `src/renderer/OnlineAdvisorExperience.tsx` (加 AI 头像 + 消息操作行)

- [ ] **Step 3.1: AI 消息加 32×32 圆形头像**

在 `OnlineAdvisorExperience.tsx` 的 `<article className="message assistant">` 开头插入:

```tsx
<div className="message-avatar" aria-hidden="true">DS</div>
```

CSS:
```css
.message.assistant { display: grid; grid-template-columns: 36px 1fr; gap: var(--space-3); }
.message-avatar {
  width: 32px; height: 32px;
  display: grid; place-items: center;
  border-radius: 50%;
  background: var(--color-accent);
  color: #fff;
  font-size: var(--fs-xs);
  font-weight: 700;
}
```

- [ ] **Step 3.2: 用户消息改为蓝色软底气泡**

```css
.message.user {
  max-width: 80%;
  margin-left: auto;
  padding: 10px 14px;
  border-radius: var(--radius-lg);
  color: var(--color-text-primary);
  background: var(--color-accent-soft-2);
}
```

(原 `background: #2e4033; color: #f4f2ea` 替换)

- [ ] **Step 3.3: 消息操作行(豆包式 hover)**

在 AI 消息末尾、`<AIMessageContent>` 后插入:

```tsx
{message.role === "assistant" && message.state !== "streaming" && (
  <div className="message-actions" role="toolbar" aria-label="消息操作">
    <button onClick={() => rateMessage(message, "up")} aria-pressed={...}>👍</button>
    <button onClick={() => rateMessage(message, "down")} aria-pressed={...}>👎</button>
    <button onClick={() => void copyMessage(message)}>📋 复制</button>
    <button onClick={() => regenerate(message)}>↻ 重新生成</button>
  </div>
)}
```

CSS 默认 `opacity: 0`,`.message.assistant:hover .message-actions { opacity: 1 }`,transition 150ms。

- [ ] **Step 3.4: `MarkdownTable` 加 sticky 表头 + 斑马纹 + hover 操作(保留 card)**

在 `AIMessageContent.tsx` 的 `<table>` 元素上,使其 `<thead>` 顶部吸附:

```css
.ai-markdown-table-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); }
.ai-markdown-table-card thead th { position: sticky; top: 0; background: var(--color-surface-2); z-index: 1; }
.ai-markdown-table-card tbody tr:nth-child(even) { background: rgba(0,0,0,0.02); }
.ai-markdown-table-card td, .ai-markdown-table-card th { padding: 8px 14px; border-bottom: 1px solid var(--color-border); }
```

复制/CSV/展开按钮放右上(已有),新主题色:主按钮用 `--color-accent`,hover 浮层淡入。

- [ ] **Step 3.5: 验证 + Commit**

- `npx tsc --noEmit` 通过
- 启动 → AI 消息带蓝色 DS 头像
- 用户消息为蓝色软底气泡
- 表格 card 视觉清爽,滚动时表头吸顶
- 鼠标悬停 AI 消息 → 操作行淡入

```bash
git add src/renderer/OnlineAdvisorExperience.tsx src/renderer/AIMessageContent.tsx src/renderer/online-advisor-experience.css
git commit -m "style(online-advisor): 豆包式消息气泡 + 表格 sticky 表头 + hover 操作行"
```

**验收:**
- 消息视觉接近豆包
- 表格 card 保留,便于复制/下载
- 操作行 hover 体验流畅

**预估改动量:** +200 / -70

---

## P4 — scroll-to-latest 浮窗与流式体验

**Files:**
- Modify: `src/renderer/online-advisor-experience.css` (`.message-scroll-to-latest` 块)
- Modify: `src/renderer/OnlineAdvisorExperience.tsx` (替换按钮文本为 SVG)

- [ ] **Step 4.1: 浮窗改 `position: absolute` 圆形 + 阴影**

```css
.message-list { position: relative; }

.message-scroll-to-latest {
  position: absolute;
  bottom: 24px;
  right: 24px;
  display: grid; place-items: center;
  width: 44px; height: 44px;
  border: none; border-radius: 50%;
  background: var(--color-accent);
  color: #fff;
  box-shadow: var(--shadow-md);
  cursor: pointer;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 200ms ease, transform 200ms ease, background 150ms ease;
  z-index: 5;
}
.message-scroll-to-latest:hover { background: var(--color-accent-hover); transform: translateY(-2px); }
.message-scroll-to-latest > .arrow { width: 18px; height: 18px; }
.message-scroll-to-latest-badge {
  position: absolute; top: -8px; right: -8px;
  min-width: 22px; height: 22px;
  padding: 0 6px;
  border-radius: var(--radius-pill);
  background: var(--color-error);
  color: #fff;
  font-size: var(--fs-xs);
  font-weight: 700;
  display: grid; place-items: center;
  box-shadow: 0 2px 6px rgba(245, 74, 69, 0.4);
}
```

- [ ] **Step 4.2: SVG 下箭头替换 `↓` 文字**

```tsx
<svg className="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
  <path d="M12 5v14M19 12l-7 7-7-7"/>
</svg>
```

- [ ] **Step 4.3: 显隐逻辑**

浮窗只在 `!autoFollow` 时显示,加 `data-show` 属性:

```css
.message-scroll-to-latest[data-show="true"] { opacity: 1; transform: translateY(0); }
```

在 `OnlineAdvisorExperience.tsx` 的按钮上:
```tsx
<button data-show={(!autoFollow && messages.length > 0).toString()} ...>
```

- [ ] **Step 4.4: 验证 + Commit**

- `npx tsc --noEmit` 通过
- 启动 → 上滚超过 80px → 圆形蓝色浮窗右下角淡入
- 点击 → 平滑滚回最底
- Badge "N 条新消息" 在按钮上方红点显示

```bash
git add src/renderer/OnlineAdvisorExperience.tsx src/renderer/online-advisor-experience.css
git commit -m "style(online-advisor): scroll-to-latest 圆形浮窗 + SVG 箭头 + 红点徽章"
```

**验收:**
- 浮窗固定在 chat-panel 右下角
- 视觉精致,有阴影/动画
- 隐藏时不占空间

**预估改动量:** +80 / -30

---

## P5 — 顶栏 / 侧边栏 / 底部 Composer 微调

**Files:**
- Modify: `src/renderer/online-advisor-experience.css`
- Modify: `src/renderer/OnlineAdvisorExperience.tsx` (微调 JSX)

- [ ] **Step 5.1: 顶栏品牌区圆形化**

`.brand-mark` 从 34×34 方块 → 36×36 圆形,色 `var(--color-accent)`,字 "DC"。

- [ ] **Step 5.2: 侧边栏选中项蓝色左边标识**

```css
.project-task-button.selected {
  background: var(--color-accent-soft);
  border-left: 3px solid var(--color-accent);
  padding-left: 9px;
}
```

- [ ] **Step 5.3: Composer 工具区始终可见**

将 model/permission 菜单从 `.composer-toolbar` 折叠菜单 → 直接展示为 pill chips。提交按钮改为圆形 32×32 蓝色 + 纸飞机 SVG。

- [ ] **Step 5.4: 拖入图片全屏 overlay**

复用 `.drag-active`,但叠加全屏半透明遮罩 `.composer-drag-overlay`(蓝色边框 + "松开上传"文案)。

- [ ] **Step 5.5: 验证 + Commit**

- `npx tsc --noEmit` 通过
- 启动截图:顶栏圆形头像、侧边栏选中项蓝标识、Composer 工具 pill、圆形提交按钮

```bash
git add src/renderer/OnlineAdvisorExperience.tsx src/renderer/online-advisor-experience.css
git commit -m "style(online-advisor): 顶栏/侧边栏/Composer 微调,工具区 pill 化"
```

**验收:**
- 顶栏半透模糊清晰
- 侧边栏选中明显
- Composer 一目了然

**预估改动量:** +120 / -50

---

## P6 — 体验细节 (6.1-6.8 全做)

### 6.1 流式光标 (P6.1)

**Files:** `online-advisor-experience.css` + `OnlineAdvisorExperience.tsx`

- [ ] **Step 6.1.1: AI 流式消息末尾加闪烁光标**

在 `state === "streaming"` 的 AI 消息末尾追加 `<span class="streaming-cursor">▌</span>`。

CSS:
```css
.streaming-cursor {
  display: inline-block;
  margin-left: 2px;
  color: var(--color-accent);
  animation: cursor-blink 1s steps(2) infinite;
}
@keyframes cursor-blink { 50% { opacity: 0; } }
```

### 6.2 重新生成 (P6.2)

- [ ] **Step 6.2.1: AI 消息 hover 出现"重新生成"按钮**

复用 `submit` 函数,构造一个重新触发的 ChatRequest(同 prompt、同 model、同 workspacePath、同 permissionMode、同 conversationId)。

```tsx
async function regenerate(message: Message) {
  if (message.role !== "assistant") return
  // 找到对应的 user 消息
  const userMessage = messages.find(m => m.id === `${message.id}:user`)
  if (!userMessage || !workspacePath) return
  await submit(new Event("submit") as any) // 复用逻辑,或单独实现
}
```

实际建议:把 `submit` 的核心逻辑拆成 `runChat({ prompt, attachments, ... })`,regenerate 调用之。

### 6.3 快捷键面板 (P6.3)

- [ ] **Step 6.3.1: `Cmd/Ctrl+/` 打开快捷键速查弹窗**

新增 `<dialog class="shortcuts-modal">`,包含:
- `Cmd/Ctrl+K` 搜索项目/对话
- `Cmd/Ctrl+N` 新建任务
- `Cmd/Ctrl+Enter` 发送
- `Cmd/Ctrl+.` 停止生成
- `Cmd/Ctrl+/` 打开本弹窗
- `Esc` 关闭弹窗

### 6.4 dark mode (P6.4) ✅ 必含

- [ ] **Step 6.4.1: 顶栏加日月切换按钮**

在 `.topbar` 右上角(连接 chip 左侧)加 `<button class="theme-toggle">` 含 SVG 月亮/太阳图标。

- [ ] **Step 6.4.2: 主题状态持久化**

`localStorage.setItem('app-theme:v1', 'light' | 'dark' | 'system')`,初始读取同 App.tsx 已有逻辑(看 `app-theme:v1`)。

- [ ] **Step 6.4.3: 切换时给 `<html>` 加 `data-theme="dark"`**

由于 OnlineAdvisor 渲染在 Shadow DOM,Shadow 根的 host 上加 `data-theme`,CSS 选择器 `[data-theme="dark"]` 在 shadow 根作用域生效(因为 style 也是 inline 到 shadow 内)。

但 token 在 `:root` 上,需要确保它们也在 shadow 内。这里需要将 token 从 `:root` 移到 `:host`(Shadow Root 的 host),然后 dark mode 选 `:host([data-theme="dark"])`。

- [ ] **Step 6.4.4: 验证截图(light + dark)**

### 6.5 加载态 (P6.5)

- [ ] **Step 6.5.1: AI 思考中,composer 上方显示三跳点**

新增 `<div class="thinking-indicator">`,在 `isBusy` 时显示,带 `.dot` 三个,各延迟 0/150/300ms 跳动。

### 6.6 错误降级 (P6.6)

- [ ] **Step 6.6.1: 流式中断时,消息末尾显示"生成中断 · 点此重试"**

当 `message.state === "stopped"` 时,在消息末尾加 `<button class="resume-link">↻ 续写</button>`,点击触发续写(复用 steerChat)。

### 6.7 引用卡片 (P6.7)

- [ ] **Step 6.7.1: AI 消息中提到的工具/报告,末尾出"参考来源"卡**

复用现有 `enhanceReportDom` 已有的"证据等级"标注,在 AI 消息末尾追加一个 `<section class="ai-citation-card">`,列出本次引用的工具调用 / 报告链接(若 `message.activities` 中有 file/command 类活动)。

简化版:若 `activities.some(a => a.kind === 'file' || a.kind === 'command')` 则显示,否则不显示。

### 6.8 移动端响应式 (P6.8)

- [ ] **Step 6.8.1: 加 `@container (max-width: 720px)` 适配**

- 聊天列 max-width 取消,占满
- 侧边栏改为可折叠抽屉
- Composer 字号略小

### 最终验证

- [ ] **Step 6.Z: 综合截图 + 提交**

```bash
git add src/renderer/OnlineAdvisorExperience.tsx src/renderer/AIMessageContent.tsx src/renderer/online-advisor-experience.css
git commit -m "feat(online-advisor): P6 体验细节(流式光标/重生成/快捷键/dark mode/加载态/错误降级/引用卡片/响应式)"
```

**验收:**
- 所有 8 项均可见可触
- dark mode 切换无白闪
- 快捷键 `Cmd+/` 可打开弹窗
- 重生成按钮可触发同 prompt 重跑

**预估改动量:** +250 / -40

---

## 整体时间线 (预计 commit 数)

```
P1 字体/色彩基线     commit #1  (design tokens)
P2 布局居中         commit #2  (字号升级)
P3 气泡 + 表格       commit #3  (消息视觉)
P4 scroll 浮窗       commit #4  (导航交互)
P5 顶栏/侧栏/Composer commit #5  (外壳)
P6 体验细节(8 子项)  commit #6  (细节润色, 1 个大 commit 或拆 8 个小 commit)
```

总改动预估: **+820 行 / -235 行** 在 3 个文件中

---

## 不在本次范围 (明确排除)

- 语音输入 / 视频通话
- 实时协作 / 多用户
- 插件系统 / 主题市场
- AI 角色动画 / 拟人化形象
- 重新设计后端 IPC 协议
- 砚都跨境桌面 App 其它页面 (AI 员工、eBay 标题等) — 此次只动 Online Advisor

---

## 待用户确认启动方式

1. **Subagent-Driven Development(推荐)** — 每阶段 dispatch 独立 subagent,带 spec + code review
2. **Inline Execution** — 主线程直接执行,每阶段 commit 后停一下等您截图确认
3. **一次性全跑 6 阶段** — 不停,跑完再统一 commit + 截图(风险:中途错了难回滚)

请告诉我用哪种方式启动。
