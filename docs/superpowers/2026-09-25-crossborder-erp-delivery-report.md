# 跨境电商采集 ERP 本地实现与隔离验证记录（P0–P5）

> 依据方案：`docs/superpowers/plans/2026-09-24-crossborder-erp-phased-plan.md`
> 交付日期：2026-09-25
> 范围：M0 地基与权限 / M1 采集工作台 / M2 仓库与图片 / M3 AI 加工 / M4 定价 / M5 多平台 listing / M6 巡盘与通知。
> **更正（2026-09-25）：本记录不是上线验收报告。原“全部完成并交付闭环”结论撤回。实际部署和未完成项以 [生产部署报告](2026-09-25-crossborder-erp-deployment-report.md) 为准。**

---

## 一、总体结论

下表是此前记录的本地单测与临时 PGlite/API 服务断言结果，不证明真实货盘、生产 AI 或线上服务已连通。UI 截图采用 mock API。部署前另确认供应商初始化及生产巡盘适配仍有缺口，不能据此认定 P0–P5 的全部功能已完成：

| 阶段 | 主题 | 隔离 API 断言 | 单元测试 | 当时的隔离回归 |
|---|---|---|---|---|
| P0 | 地基（模型/权限/投影/products） | 20/20 | 6/6 | — |
| P1 | 采集闭环（crawl_rules/collect 去重三态） | 41/41 | 13/13 | P0 绿 |
| P2 | 仓库入库（下载队列/local_path 切换） | 26/26 | 11/11 | P0/P1 绿 |
| P3 | AI 加工（图生图/待选定稿/三风格标题） | 44/44 | 13/13 | P0–P2 绿 |
| P4 | 定价 + 多平台 listing + 导出 | 31/31 | 12/12 | P0–P3 绿 |
| P5 | 巡盘 + 变更确认 + 通知中心 | 44/44 | 16/16 | P0–P4 绿 |
| 汇总 | erp vitest 全量 | — | **71/71**（6 文件） | 全绿 |

- 类型检查：`tsc --noEmit` + `tsc -p tsconfig.main.json --noEmit` + `server tsc` 全部 clean。
- 构建：`vite build` 成功。
- mock UI 回归（真实 Electron 渲染进程 + Playwright，后端响应拦截）：当时 12/12 断言通过；8 张截图见 `artifacts/erp-p5-*.png`，不能作为生产端到端证据。

---

## 二、各阶段功能清单

### P0 地基
- Prisma ERP 域 9 张表 + 迁移 `20260925000000_add_erp_domain`（见 §四）。
- 双角色权限码：COLLECTOR / OPERATOR（见 §四 RBAC）。
- 敏感字段 SQL 层投影（`projection.ts`）：运营角色响应剥离货盘来源字段；入库后图片禁引外链、走本地签名 `/media/`。
- `GET /api/erp/products`、`GET /api/erp/products/:id`、`GET /api/erp/capabilities`。
- 产品状态机常量 `ERP_STATUS_ORDER`：COLLECTED→DOWNLOADED→PROCESSING→READY→PUBLISHED。

### P1 采集闭环
- 货盘抓取规则存库（`crawl_rules`，不写死）：GET/PUT `/suppliers/:id/crawl-rules`。
- 采集入库去重三态（`collect.ts`）：CREATED / NEEDS_CONFIRM / OVERWRITTEN；已加工产品仅置 `change_flag` 不覆盖。
- 主进程内嵌浏览器采集注入器（`BrowserWorkspace.injectErpCollector` + outbox 轮询）。
- 渲染层采集工作台 `CollectWorkbench`。

### P2 仓库入库
- 下载队列 worker（`download-worker.ts`）：并发池 + 退避重试 + 失败 URL 记录 + `local_path` 回填 + 状态切 DOWNLOADED。
- 图片 URL 解析禁外链（入库后仅本地签名）。
- 渲染层 AI 仓库产品库 tab + 产品详情抽屉下载触发。

### P3 AI 加工
- 图生图（`ai-process.ts`）：以已入库原图为参考图，AI 图 `imageType=AI` 且 `isSelected=0` 待选、不替换原图；可换模型重试。
- 平台规则库（`platform_rules`）：eBay 主图无文字等，注入生图 prompt。
- 三风格标题生成（卖点精炼/关键词覆盖/场景情感），按平台字符上限强制截断。
- 待选图定稿 + 标题人工选定 → 推进 READY。

### P4 定价 + Listing
- 定价规则（`pricing_rules`，平台×品类 upsert）+ 参考价计算器：成本加成 + 佣金反推 + 固定费 + 汇率表（`config.erpFxRates`）。
- 手改价保护：`priceManual=1`，重算默认跳过、`force` 才覆盖。
- 多平台独立 listing（eBay/Amazon/Ozon 各一行）。
- JSON 导出清单：产品/图片签名地址/多平台 listing/定价明细 + 完整性核对表；不包含离线图片 ZIP，也不自动刊登平台。

### P5 巡盘 + 通知
- 巡盘调度器（`scheduler.ts`）：每 `ERP_PATROL_INTERVAL_MS` 巡盘 + 每日早 `ERP_PATROL_SUMMARY_HOUR`（默认 8 点）汇总；`ERP_PATROL_ENABLED` 开关；index.ts 注册启停。
- 双通道路由框架（`patrol.ts`）：按货盘 `patrolChannel` 选择注入的 SERVER fetcher / CLIENT dispatcher。生产注册调用及客户端任务领取、回传链路尚未实现；仅定义注入接口不等于真实巡盘可用。
- 防风控：分批（`batchSize`）+ 并发上限（`concurrency`）+ 每请求节流（`delayMs`），`runPool` 追踪峰值并发与启动间隔。
- 变更不覆盖已加工字段：仅写 `crawl_logs` + `change_flag`；人工 APPLY 采纳 / DISMISS 忽略后落地。
- 已发布（status=PUBLISHED）变更标红：通知 `PATROL_URGENT`。
- 通知中心（`notify.ts`）：PATROL_CHANGE / PATROL_URGENT / MORNING_SUMMARY；单条/全部已读；早间汇总统计。
- 渲染层：待确认变更面板（字段级 diff + 标红 + APPLY/DISMISS）+ 通知中心面板（标红/未读/汇总/立即巡盘）。

---

## 三、接口文档（REST，前缀 `/api/erp`）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | /products | erp.warehouse.view | 产品列表（按角色投影） |
| GET | /products/:id | erp.warehouse.view | 产品详情（投影） |
| GET | /capabilities | 登录 | 能力摘要（canCollect/canEdit/canPricing/canResolveChanges…） |
| GET | /suppliers | erp.source.view | 货盘列表（不含凭据密文） |
| GET | /suppliers/:id/crawl-rules | erp.source.view | 读取抓取规则 |
| PUT | /suppliers/:id/crawl-rules | erp.source.manage | 更新抓取规则 |
| POST | /collect | erp.collect | 采集入库（去重三态） |
| POST | /products/:id/download-images | erp.warehouse.edit | 原图下载入队 |
| GET | /download-jobs | erp.warehouse.view | 下载队列列表 |
| GET | /download-jobs/:id | erp.warehouse.view | 下载任务详情 |
| POST | /products/:id/ai-images | erp.warehouse.edit | 图生图（model 可换重试） |
| POST | /products/:id/ai-titles | erp.warehouse.edit | 三风格标题生成 |
| POST | /products/:id/images/:imgId/select | erp.warehouse.edit | 待选图定稿 |
| POST | /products/:id/choose-title | erp.warehouse.edit | 标题人工选定 |
| GET | /platform-rules | erp.warehouse.view | 平台规则列表 |
| PUT | /platform-rules/:code | erp.warehouse.edit | 更新平台规则 |
| GET | /pricing-rules | erp.pricing.manage | 定价规则列表 |
| POST | /pricing-rules | erp.pricing.manage | upsert 定价规则 |
| GET | /products/:id/listings | erp.warehouse.view | 多平台 listing |
| POST | /products/:id/listings | erp.warehouse.edit | 生成/补齐 listing（含参考价） |
| PUT | /listings/:id | erp.warehouse.edit | 改标题/价/类目/描述（手改价置 priceManual） |
| POST | /listings/:id/price-recalc | erp.pricing.manage | 参考价重算（保护手改价） |
| GET | /products/:id/export | erp.warehouse.view | 导出包 + 完整性核对 |
| GET | /changes | erp.warehouse.view | 待确认变更列表（change_flag=1） |
| POST | /changes/:id/resolve | erp.changes.resolve | 变更确认 APPLY/DISMISS |
| GET | /notifications | erp.warehouse.view | 通知中心列表（含未读数） |
| POST | /notifications/summary | erp.warehouse.view | 生成早间汇总 |
| POST | /notifications/read-all | erp.warehouse.view | 全部已读 |
| POST | /notifications/:id/read | erp.warehouse.view | 单条已读 |
| POST | /patrol/run | erp.changes.resolve | 手动触发巡盘（复用注入抓取器） |

---

## 四、数据库 schema 变更记录

迁移：`server/prisma/migrations/20260925000000_add_erp_domain`（新增，无破坏性变更）。

新增表（9）：
1. `erp_suppliers` —— 货盘（含 `patrol_channel` 双通道路由、`crawl_rules`）。
2. `erp_products` —— 产品（状态机 `status`、`change_flag`、成本/运费/库存/重量等）。
3. `erp_product_images` —— 图片（`image_type` MAIN/DETAIL/AI、`is_selected`、`local_path`、`source_url`）。
4. `erp_platform_rules` —— 平台规则（`title_char_limit`、`image_rules`）。
5. `erp_pricing_rules` —— 定价规则（`@@unique([org_id, platform_code, category])`）。
6. `erp_listings` —— 多平台 listing（`@@unique([product_id, platform_code])`、`price_manual`）。
7. `erp_crawl_logs` —— 巡盘变更日志（`field_changed`/`old_value`/`new_value`/`notified`）。
8. `erp_notifications` —— 通知（`kind`、`read_at`、`body` Json）。
9. `erp_download_jobs` —— 下载队列任务（`status`/`failed_urls`）。

RBAC 变更（`server/src/modules/rbac/permissions.ts`）：
- 新增权限码：`erp.collect`、`erp.source.view`、`erp.source.manage`、`erp.warehouse.view`、`erp.warehouse.edit`、`erp.pricing.manage`、`erp.changes.resolve`。
- COLLECTOR：`erp.collect` + `erp.source.*` + `erp.warehouse.view/edit`（**无** `erp.pricing.manage` / `erp.changes.resolve`）。
- OPERATOR：`erp.warehouse.view/edit` + `erp.pricing.manage` + `erp.changes.resolve`（**无** `erp.source.*`）。

---

## 五、历史 mock UI 回归截图（非生产端到端）

以下截图来自真实 Electron 渲染进程，但商品、变更、通知和巡盘回执由确定性 mock 回放。截图位于 `artifacts/`，不能用于证明真实部署完成：

| 截图 | 内容 |
|---|---|
| [erp-p5-01-pool.png](../../artifacts/erp-p5-01-pool.png) | AI 仓库工作台 · 采集池 |
| [erp-p5-02-products.png](../../artifacts/erp-p5-02-products.png) | 产品库 tab |
| [erp-p5-03-changes.png](../../artifacts/erp-p5-03-changes.png) | 待确认变更：已发布标红 + 字段级 diff（成本价 20→18）+ 采纳/忽略 |
| [erp-p5-04-changes-applied.png](../../artifacts/erp-p5-04-changes-applied.png) | APPLY 采纳后列表收敛 |
| [erp-p5-05-notifications.png](../../artifacts/erp-p5-05-notifications.png) | 通知中心：紧急标红 + 未读计数 + 汇总/巡盘按钮 |
| [erp-p5-06-summary.png](../../artifacts/erp-p5-06-summary.png) | 生成早间汇总后 |
| [erp-p5-07-patrol-run.png](../../artifacts/erp-p5-07-patrol-run.png) | 立即巡盘回执（扫描/双通道/并发） |
| [erp-p5-08-read-all.png](../../artifacts/erp-p5-08-read-all.png) | 全部已读后未读=0 |

复现命令：
- 后端隔离断言：在 `server/` 下逐个执行 `npx tsx scripts/verify-erp-p0.ts` 至 `verify-erp-p5.ts`；单次 tsx 命令不支持将六个脚本作为六次执行。
- 单元测试：`npx vitest run server/src/modules/erp`
- 浏览器 UI：`node tools/verify-erp-p5-ui.cjs`

---

## 六、关键设计决策

1. **依赖注入**：download-worker / ai-process / patrol 均接受 deps（fetcher/storage/imageGenerator/clientDispatcher），使 e2e 在无密钥、无网络下确定性验收。
2. **巡盘不覆盖已加工字段**：变更只落 `crawl_logs` + `change_flag`，人工 resolve 后落地，保障已发布 listing 稳定。
3. **节流设计边界**：分批、并发上限和请求间隔通过隔离验证；CLIENT 生产下发/回传尚未接通。10 万品批次计算不是实际 10 万品压力测试，也不能保证第三方不会触发风控。
4. **敏感字段 SQL 层投影**：运营角色在数据库查询层即剥离货盘来源，前端不做"隐藏即安全"。
5. **手改价保护**：`priceManual=1` 默认不被重算覆盖，需显式 `force`。
