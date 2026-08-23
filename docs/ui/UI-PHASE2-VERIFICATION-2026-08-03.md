# UI 第二阶段最终验收记录

验收日期：2026-08-03  
范围：基础 UI 组件契约，以及登录、注册、强制改密和系统管理首批迁移。  
结论：第二阶段剩余部分已补齐，适用验收项通过。

## 1. 完成内容

基础层现包含：

- `Button`：主、次、危险、禁用和加载状态，加载时阻止重复提交。
- `Field`：可见标签、必填标识、hint/error 关联、`aria-invalid` 和焦点态。
- `StatusBadge`：成功、警告、错误、信息四种语义。
- `Notice`：四种语义反馈，可承载 alert/status。
- `Card`、`EmptyState`、`LoadingState`。
- `Modal`：dialog 语义、标题/描述关联、打开聚焦、Escape 关闭、Tab 焦点循环和关闭后焦点恢复。
- 浅色与深色 Token 映射、减少动态效果支持。

首批迁移：

- 登录/注册：Field、Button、Notice、Tab 语义及登录恢复 LoadingState。
- 强制改密：字段 hint、确认密码错误关联、加载按钮和错误 Notice。
- 系统管理：主操作、危险操作、状态 Badge、顶层错误、加载、空状态和栏目 Tab 语义。
- `ui/migrations.css` 最后加载，仅覆盖已迁移入口，避免改变其他业务模块。

## 2. 生产登录页实际检查

使用真实 Vite 生产入口渲染登录与注册页面，未提交账号或密码。

| 检查项 | 结果 | 证据摘要 |
|---|---|---|
| 1180×720 布局 | 通过 | `scrollWidth = clientWidth = 1180`，无横向溢出 |
| 登录/注册 Tab | 通过 | 2 个 tab，始终只有 1 个 `aria-selected=true` |
| 字段标签 | 通过 | 手机号、密码与 input 正确关联，必填状态可读 |
| 注册提示 | 通过 | 密码 hint 进入可访问名称/描述结构 |
| 控件尺寸 | 通过 | 登录输入框计算高度 40px |
| 字号 | 通过 | 登录卡计算字号为 12、13、14、17、22px |
| 焦点 | 通过 | Field、Tab、服务器入口具有明确 `focus-visible` 规则 |
| 数据安全 | 通过 | 未猜测、读取、修改或提交真实账号凭据 |

登录入口本身使用固定深色品牌背景，因此不存在独立的浅色登录变体；其字段、按钮和反馈的深色对比已实际检查。

## 3. 基础组件实际检查

独立验收页直接加载生产 `primitives.tsx`、Token 和组件样式。

| 检查项 | 结果 | 证据摘要 |
|---|---|---|
| 浅色组件 | 通过 | Card、Field、Button、Badge、Notice、Loading、EmptyState 均正确显示 |
| 深色组件 | 通过 | Card 与 Field 使用 `#151f1b` 表面及浅色文字，无浅底浅字 |
| 错误字段 | 通过 | `aria-invalid=true`，`aria-describedby` 指向实际错误文案 |
| 加载状态 | 通过 | 按钮 disabled + `aria-busy=true`；LoadingState 为 live status |
| Notice | 通过 | 阻断信息具有 alert 语义 |
| Modal 初始焦点 | 通过 | 打开后活动元素为 dialog |
| Modal 语义 | 通过 | `aria-modal=true`，标题和描述 ID 均有效 |
| Modal Escape | 通过 | 关闭后 dialog 数量为 0 |
| Modal 焦点恢复 | 通过 | 焦点回到“打开验收对话框”按钮 |
| Modal 焦点循环 | 通过 | 从首个关闭按钮 Shift+Tab 回到最后的确认按钮 |
| 组件字号 | 通过 | 计算字号集合为 12、13、14、16、18、22px |

## 4. 源码与工程检查

- UI 层不存在小于 12px 的字号声明。
- `migrations.css` 确认为渲染入口最后加载的 CSS。
- `pnpm typecheck`：通过。
- `pnpm build`：通过，Vite 8.1.4，53 个模块完成构建。
- 实际构建资源：`index-N5tBfDO1.css`、`index-rFqY6sXG.js`。
- 保留既有大 chunk 警告：JS 735.54kB；不属于第二阶段整改范围。

## 5. 边界

- 系统管理数据依赖真实授权账号，本次未修改账号或组织数据；迁移通过类型、构建、源码语义和真实基础组件状态验证。
- 旧页面的原始小字号声明仍存在，但系统管理迁移范围由最后加载的 scoped 兼容层覆盖。全项目清理属于后续逐模块迁移工作，不在第二阶段做全局替换。
- 验收工具位于 `tools/ui-stage2-preview`，不进入默认生产构建。
