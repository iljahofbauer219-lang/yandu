# 跨境电商采集 ERP 分阶段开发方案

> **For agentic workers:** 本文件为设计级分阶段开发方案（用户明确要求本期不写代码）。实施时使用 superpowers:executing-plans 或 subagent-driven-development 按阶段拆任务执行。

**Goal:** 将《跨境电商采集ERP开发规格文档》的 8 大一期模块落地到砚都跨境现有架构（Electron 桌面端 + Fastify/Prisma 中央服务器），把空白的「AI仓库」页建设为 ERP 产品仓库工作台，把已完成的「AI采集」页扩展为采集工作台入口。

**Architecture:** 不引入规格文档假设的 CodeIgniter/PHP 栈；ERP 作为新业务域 `server/src/modules/erp/` 落在现有 Fastify + Prisma(PostgreSQL) 中央服务器（org 隔离 + JWT + RBAC + 审计 + media 存储 + AI gateway + 进程内调度器全部复用）；桌面端负责内嵌浏览器采集注入（BrowserWorkspace executeJavaScript 桥）与仓库工作台 UI；浏览器扩展通道保留兼容。

**Tech Stack:** Electron 43 + React 19 + Vite（渲染/主进程）、Fastify + Prisma + PostgreSQL（server/）、node:sqlite（本地镜像，仅缓存）、Bailian ai gateway（qwen-image 同步 / wan2.7 异步图生图）、Vitest。

---

## 0. 现状映射（规格 ↔ 已有代码）

| 规格模块 | 现状 | 结论 |
|---|---|---|
| §4 采集（内嵌浏览器注入） | [BrowserWorkspace.ts](file:///Users/zyc/Desktop/砚都跨境/src/main/browser/BrowserWorkspace.ts) 已用 `executeJavaScript` 注入 `window.__crossBorderCollector` / `__crossBorderEbayPlugin` 并轮询回收；[browser-extension](file:///Users/zyc/Desktop/砚都跨境/browser-extension/content-script.js) 支持大健云仓/1688 详情页采集→`127.0.0.1:17321` 本地桥→[AppDatabase](file:///Users/zyc/Desktop/砚都跨境/src/main/database/AppDatabase.ts)；AI采集页 4 平台卡片已上线（图片2） | **复用注入桥模式**，抓取规则从 TS 硬编码改为 `crawl_rules` JSON 数据库驱动 |
| §2 角色与敏感字段隔离 | RBAC 已有（[permissions.ts](file:///Users/zyc/Desktop/砚都跨境/server/src/modules/rbac/permissions.ts) + [menuPermissionTree.ts](file:///Users/zyc/Desktop/砚都跨境/src/shared/menuPermissionTree.ts)，`menu.warehouse` 码已存在）；**字段级 SQL 投影缺失** | 新增 COLLECTOR/OPERATOR 角色 + 服务端 select 白名单投影 |
| §3 状态机 / §10 products 表 | Prisma 有候选/入库域（SupplyCandidate、ProductIntakeRegistry、InventoryRecord、ListingRecord），但**无 ERP 产品主档** | 新增 Erp 产品域模型；IntakeRegistry 的 identityKey 去重思路沿用 |
| §5 图片下载入库 | [media/routes.ts](file:///Users/zyc/Desktop/砚都跨境/server/src/modules/media/routes.ts) 已有 local/OSS 双驱动存储（`storage.put`/预签名） | 新增下载队列 worker，落盘复用 media storage |
| §6 AI 加工 | server [ai/providers.ts](file:///Users/zyc/Desktop/砚都跨境/server/src/modules/ai/providers.ts) 已支持 Bailian 参考图图生图（qwen-image 同步、wan2.7 异步轮询）；主进程有 EbayImageGroundingService（产品本体一致性经验） | server 侧 ai gateway 扩展 ERP 加工端点 |
| §8 定价 / §7 多平台 listing | 无定价引擎；ListingRecord 为 task 域 Ozon 导向 | 新增 pricing_rules 与 ErpListing（平台维度） |
| §9 巡盘 + 通知 | 无通知模型；调度器先例：[pricing-scheduler.ts](file:///Users/zyc/Desktop/砚都跨境/server/src/modules/linduo/pricing-scheduler.ts)（index.ts 启停） | 新增 patrol scheduler + ErpNotification |
| UI 落点 | 图片1「AI仓库」= 占位页（[App.tsx](file:///Users/zyc/Desktop/砚都跨境/src/renderer/App.tsx) `aiModuleNav` 中 `ai-warehouse`）；图片2「AI采集」= 平台卡片 hub | AI仓库→ERP 工作台；AI采集卡片→采集工作台 |

**关键架构决策（需用户确认）：**
1. **放弃 CodeIgniter/PHP/MySQL**，ERP 落在现有 Node 中央服务器。理由：账号/RBAC/审计/media/AI/调度器全复用，避免双后端双账号体系；规格文档的"后端"诉求（REST、cron、AI 封装、图片存储）现有栈全部满足。
2. **ERP 主数据只存中央 Prisma（org 隔离）**，本地 SQLite 仅做离线缓存快照。理由：规格要求部门级权限隔离与多员工协同，必须服务端 SQL 层实现。
3. **巡盘双通道**：服务器直连通道仅对已验证不被云 IP 风控的货盘开放（1688 已被阿里云 IP 风控阻断，见历史决策记录）；风控货盘走客户端内嵌浏览器巡盘通道，统一写 crawl_logs。

---

## 1. 核心功能模块划分

- **M0 地基与权限**：Prisma Erp 模型迁移；COLLECTOR（采集专员）/OPERATOR（运营专员）角色与权限码；敏感字段投影中间件（`supplier_id/source_url/source_product_id/source_sku/collected_by/crawl_config` 运营角色 SQL 层不 SELECT）。
- **M1 采集工作台**：`suppliers.crawl_rules`（CSS 选择器/XPath JSON）驱动的通用注入器；详情页单采 + 列表页批量勾选采；`(supplier_id, source_product_id)` 去重/覆盖/变更标记三态逻辑；采集池 UI。
- **M2 产品仓库与图片入库**：下载队列（并发控制+失败重试+失败 URL 记录）；`local_path` 切换后全系统禁引货盘外链；产品列表/详情 UI（AI仓库页主体）。
- **M3 AI 加工**：图生图 provider 适配（产品本体一致性约束：原图作参考图输入）；待选图人工挑选定稿（`is_selected`）；三风格标题生成 + 平台字符上限校验；状态 collected→downloaded→processing→ready 流转。
- **M4 定价引擎**：`pricing_rules`（平台×品类：佣金率/固定费/倍率/币种）；参考价计算器（纯函数）；运营手改保护（手改后不自动覆盖）。
- **M5 多平台 listing**：一产品多平台版本（标题/图集/类目/售价/状态 draft|synced|published）；一期止于物料导出/手动搬运，不推平台。
- **M6 巡盘与通知**：凌晨 0:00–07:00 分批队列巡盘；关键字段 diff（库存/成本价/运费/变体/图片）；`change_flag` + 运营确认流；站内通知 + 早 8 点变动汇总；状态≥published 标红。

## 2. 前后端技术实现路径

**服务端（server/）**
- 新增 `server/src/modules/erp/`：`routes.ts`（REST）、`repository.ts`（Prisma 访问+投影）、`projection.ts`（角色字段白名单）、`collect.ts`（去重/覆盖状态机）、`download-worker.ts`（图片队列）、`pricing.ts`（公式计算纯函数）、`ai-process.ts`（图生图/标题编排）、`patrol.ts`（巡盘 diff）、`notify.ts`、`scheduler.ts`（参照 pricing-scheduler 启停模式注册进 `index.ts`）。
- `prisma/schema.prisma` 新增模型：`ErpSupplier`（扩展现有 SupplyPlatform：login_url/credentials 加密/crawl_rules JSON）、`ErpProduct`（规格 §10 字段全量+status+change_flag+last_crawled_at）、`ErpProductImage`（image_type/platform/is_selected/sort_order/source_url/local_path）、`ErpPlatformRule`（扩展 MarketplacePlatform：title_char_limit/image_rules）、`ErpPricingRule`、`ErpListing`（ai_title_options JSON）、`ErpCrawlLog`、`ErpNotification`、`ErpDownloadJob`。改 schema 后必须 `prisma generate` 再跑 tsc（历史教训）。
- 注册：`app.ts` 挂 `erpRoutes`；权限码进 `rbac/permissions.ts` 与 `shared/menuPermissionTree.ts` 双份同步（menu.warehouse.pool / .products / .changes / .patrol / .pricing）。

**桌面主进程（src/main）**
- `BrowserWorkspace.ts` 新增 `injectErpCollector(supplier, crawlRules)`：按 crawl_rules 渲染"采集此产品"浮动按钮 + 列表勾选框，注入脚本只写 `window.__erpCollector.outbox`；主进程轮询 outbox（沿用 `__crossBorderCollector` sync/remove 轮询模式），以当前用户 JWT 调 server `POST /api/erp/collect`，结果回写注入 UI（已采集/已更新/失败）。
- 本地桥 `17321` 增加 `/local/erp/collect` 兼容扩展通道，与内嵌桥共用 collect 编排。
- 巡盘客户端通道：空闲时段按 server 下发的巡盘任务在内嵌浏览器回访 source_url 提取字段回传（仅风控货盘）。

**渲染进程（src/renderer）**
- 新增 `src/renderer/erp/`：`AiWarehouseWorkbench.tsx`（替换图片1占位页，tabs：采集池/产品库/待确认变更/巡盘日志）、`ProductDetailDrawer.tsx`（图/变体/尺寸重量/listing/定价）、`CollectWorkbench.tsx`（图片2 卡片"进入"后的内嵌浏览器采集台+进度）、`NotificationsBell.tsx`（顶栏）。
- `App.tsx`：`ai-warehouse` 从占位分支移入业务页；AI采集卡片进入 CollectWorkbench；权限 `canMenu`/`pageAllowed` 接入新码。

## 3. 关键接口与数据流

**REST（JWT 鉴权；运营角色响应自动剥离敏感字段）**
```
POST   /api/erp/collect                      采集入库（去重/覆盖/变更标记）
GET    /api/erp/products?status=&supplier=&q= 采集池/产品库列表（角色投影）
GET    /api/erp/products/:id                 详情（角色投影）
POST   /api/erp/products/:id/download-images 触发原图下载队列
GET    /api/erp/download-jobs                队列进度/失败 URL
POST   /api/erp/products/:id/ai-images       图生图（platform, model 可换重试）
POST   /api/erp/products/:id/ai-titles       三风格标题（platform 字符上限）
POST   /api/erp/products/:id/images/:imgId/select  待选图定稿
GET/POST /api/erp/pricing-rules              定价规则配置（采集角色禁）
POST   /api/erp/listings/:id/price-recalc    参考价重算（保护手改价）
GET    /api/erp/products/:id/listings        多平台 listing 版本
PUT    /api/erp/listings/:id                 改标题/价/图/类目
GET    /api/erp/changes  POST /api/erp/changes/:id/resolve   巡盘变更确认
GET    /api/erp/notifications  POST /api/erp/notifications/:id/read
GET/PUT /api/erp/suppliers/:id/crawl-rules    抓取规则配置（仅 COLLECTOR）
```
**本地桥**：`POST 127.0.0.1:17321/local/erp/collect`（扩展兼容）；内嵌桥 `window.__erpCollector` outbox 轮询协议。

**数据流**
1. 采集：货盘页 ←注入脚本(crawl_rules)→ outbox → 主进程轮询 → `POST /api/erp/collect` → 去重三态 → `ErpProduct(status=collected)` + `ErpProductImage(source_url)` + AuditLog。
2. 入库：UI 触发 → ErpDownloadJob 队列 → worker GET source_url → media storage.put → local_path 回填 → `status=downloaded`。
3. 加工：ai-images/ai-titles → ai gateway（原图作参考图）→ 待选图/ai_title_options → 人工选定 → `status=ready`。
4. 巡盘：scheduler 分批 → 通道路由（server 直连/客户端）→ diff → ErpCrawlLog + change_flag + ErpNotification（≥published 标红）→ 早 8 点汇总视图。

## 4. 阶段性交付目标

| 阶段 | 范围 | 交付物 | 验收标准 |
|---|---|---|---|
| P0 地基（~1w） | M0 | schema 迁移、角色/权限码、投影中间件 | 双角色登录；同一 `GET /api/erp/products` 运营响应 JSON 快照不含 6 个敏感字段（vitest 快照测试）；F12 抓包验证 |
| P1 采集闭环（~1.5w） | M1 | 大健云仓 crawl_rules + 注入器 + collect API + 采集池 tab | 详情页单采、列表批量 20 品成功；重复采集弹覆盖确认；已加工品再采只置 change_flag 不覆盖；批量采集不阻塞内嵌浏览器 |
| P2 仓库入库（~1w） | M2 | 下载队列 worker + 产品库/详情 UI（AI仓库页上线） | 单品全图下载成功且详情只引 local_path；断网模拟失败重试并记录失败 URL；状态 collected→downloaded 正确 |
| P3 AI 加工（~1.5w） | M3 | 图生图适配 + 待选图定稿 + 三风格标题 | 产品本体一致性人工核对表通过；eBay 主图无文字规则生效；标题≤平台上限；未定稿不替换原图；可换模型重试 |
| P4 定价+listing（~1w） | M4+M5 | pricing_rules CRUD + 计算器 + 多平台 listing + 导出 | 参考价与手算公式一致；手改价不被重算覆盖；eBay/Amazon 双版本 listing 独立；导出包物料齐备 |
| P5 巡盘+通知（~1.5w） | M6 | scheduler + 双通道巡盘 + 变更确认 + 通知中心 | mock 货盘改价/改库存生成 crawl_logs+通知；≥published 标红；早 8 点汇总可见；10 万品分批并发配置生效不触发风控 |

## 5. 风险与对策
- **云 IP 风控**（1688 已验证阻断）：巡盘/补采通道路由表按货盘配置，风控货盘强制客户端通道；P5 前对 gigab2b 做服务器直连探测。
- **敏感字段泄漏**：投影白名单在 repository 层唯一出口实现 + 接口快照测试进 CI；前端不做任何"隐藏即安全"。
- **AI 货不对板**：原图强制参考图输入 + 平台 image_rules 校验 + 人工定稿兜底（规格 §6.1 红线）。
- **下载封禁/裂图**：队列并发上限+退避重试；local_path 切换后全局禁外链（repository 层断言）。
- **schema 变更流程**：改 schema 必须 `prisma generate` 后再 tsc/迁移（历史踩坑记录）。
