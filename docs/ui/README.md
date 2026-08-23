# 砚都跨境 UI 规范

本目录是“砚都跨境”界面设计、开发交接和验收的统一依据。

## 文档

- [UI-DESIGN-SYSTEM.md](./UI-DESIGN-SYSTEM.md)：品牌、色彩、排版、间距、组件、主题、响应式与无障碍规范。
- [UI-AUDIT-2026-08-03.md](./UI-AUDIT-2026-08-03.md)：基于当前源码与既有验收截图形成的基线审计及整改优先级。
- [UI-ACCEPTANCE.md](./UI-ACCEPTANCE.md)：后续页面和组件必须执行的检查清单。
- [UI-PHASE1-VERIFICATION-2026-08-03.md](./UI-PHASE1-VERIFICATION-2026-08-03.md)：第一阶段实际验收结果和工程检查记录。
- [UI-PHASE2-VERIFICATION-2026-08-03.md](./UI-PHASE2-VERIFICATION-2026-08-03.md)：基础组件补齐、入口迁移与真实组件验收记录。
- [UI-PHASE3-VERIFICATION-2026-08-03.md](./UI-PHASE3-VERIFICATION-2026-08-03.md)：eBay AI 优化试点的实现范围、真实界面检查和工程验收记录。
- [UI-PHASE4-VERIFICATION-2026-08-03.md](./UI-PHASE4-VERIFICATION-2026-08-03.md)：核心业务页统一、可访问状态、深色与响应式实际验收记录。

## 使用顺序

1. 设计或修改页面前，先查阅设计系统。
2. 实现时优先使用语义 Token 和既有组件，不新增同义颜色或重复交互模式。
3. 完成后逐项执行验收清单，并保留对应截图或命令输出。
4. 业务要求与本文档冲突时，以业务正确性为先，同时在变更中记录例外及原因。

## 当前边界

第一至第四阶段已依次完成规范基线、基础组件、eBay 图片试点和核心业务页统一；业务逻辑与外部平台写入不在 UI 阶段验收范围内。
