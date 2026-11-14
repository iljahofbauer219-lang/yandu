# 极简编辑器专项重构设计（2026-11-14）

> 状态：待确认。确认后才实施。目标：本地产品编辑只留核心，eBay 硬必填/政策/类目编辑与读取迁移到浏览器侧，不回归保存/准备/自动填写。

## 背景与问题

- 现「本地产品编辑」(EbayLocalListingEditor.tsx) 十段复刻 eBay 现网修改页；其中「类目属性 / 状况 / 运输与所在地 / 必填待补齐 / 定价选项 / 其他刊登选项」与浏览器「自动填写/固定填写」看似重复。
- 但前者是**上游数据源**：浏览器填写读取 `product.snapshot.details`（状况/类目属性/政策/所在地），这些字段的本地编辑入口与「从 Seller Hub 读取政策与类目属性」读取入口都在编辑器这六段里；保存链路 `saveLocalEditor`/`prepareLocalEditorInSellerHub`(App.tsx:4489-4490) 消费 draft 全字段。
- 布局守卫钉死段序与存在性：ebayLocalListingEditorOrder.test.ts:51-52、EbayLocalListingEditor.gaps.test.tsx:85,125。
- 直接删除＝本地数据失去来源＋读取入口消失＋守卫破坏 → 回归自动填写/准备。故需要"迁移"而非"删除"。

## 方案对比

- **A（推荐）抽离复用**：把六段抽成独立组件 `EbayListingDetailsPanel`，以抽屉形式挂到浏览器工作台（新增「刊登资料」按钮，与自动填写/固定填写/预设并列）。本地编辑器删除六段、仅留核心。两入口共用同一 draft/set/保存 props，数据流不变。
- **B 折叠隐藏**：编辑器内六段默认折叠。改动小但仍在编辑器内，不满足"极简"，且守卫仍需大改。不推荐。

## 推荐架构（A）

- 新组件 `src/renderer/EbayListingDetailsPanel.tsx`：承载 类目属性/状况/运输与所在地/定价选项/其他刊登选项/必填待补齐 六段 JSX 与交互（从 EbayLocalListingEditor 原样迁出，含 Bi 双语、读取按钮、政策下拉、类目属性填写）。
- `EbayLocalListingEditor.tsx`：删除六段，仅留 图片/标题/类别/描述/定价(价格/数量)/保存按钮；保留 validation 的 errors（必须修改）但移除 gaps 提示段（gaps 提示移入面板）。
- 浏览器工作台 `EbayPlatformWorkspace`(App.tsx)：header 增「刊登资料」按钮，打开抽屉渲染 `EbayListingDetailsPanel`，传入当前 localEditorProduct/draft/set/保存回调（复用现有 localEditor 状态）。
- 数据/保存/准备/自动填写链路**零改动**（draft 字段不变）。

## 守卫与测试迁移

- ebayLocalListingEditorOrder.test.ts：段序断言改为核心段；六段断言迁移到新文件 ebayListingDetailsPanel.test.tsx。
- EbayLocalListingEditor.gaps.test.tsx：运输/必填待补齐断言迁移到面板测试；编辑器侧改为断言"不再渲染六段"。
- 新增回归：保存本地新版本/保存并准备/浏览器自动填写 字段不丢（复用现有 gaps/fill 测试）。

## 回归清单（实施后必跑）

1. 编辑器仅核心段，保存本地新版本字段不丢。
2. 「刊登资料」抽屉可编辑状况/类目属性/政策/所在地并保存。
3. 「从 Seller Hub 读取政策与类目属性」入口在抽屉内可用。
4. 浏览器自动填写/固定填写读取本地数据不回归。
5. typecheck + vitest 全绿 + hot:sync + 真机截图。

## 风险与回滚

- 风险：抽屉与编辑器共用 draft 的状态同步；Bi 双语/样式类迁移遗漏。
- 回滚：单提交迁移，可整体 revert。