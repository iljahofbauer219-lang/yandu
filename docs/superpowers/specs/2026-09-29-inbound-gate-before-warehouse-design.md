# 设计：入库处理闸口前移——先入库处理、后正式入库

- 日期：2026-09-29
- 状态：待用户审阅
- 范围：砚都跨境桌面应用（Electron 主进程 AppDatabase + 渲染器货盘仓库/选品模块）

## 1. 背景与问题

货盘仓库页（`src/renderer/erp/PalletWarehousePage.tsx`）顶部有「入库处理」tab，语义是采集原始产品先在此待确认、编辑、补标签，确认后才进入正式入库。但当前代码的实际链路方向是反的：

- 现状链路：采集（大健云仓/1688/市场仓绑货源）→ 采集候选 → AI选品审核「通过」→ **直写正式入库**（`AppDatabase.updateSelectionDecision`，src/main/database/AppDatabase.ts:2586 调 `upsertSupplyWarehouseProduct`）→ 正式入库卡手动「送入库处理」→ 入库处理待确认 → 确认 → 货盘仓库存放（`pallet_warehouse_items`）。
- 后果：大健云仓 AI 采集的商品未经任何入库处理即出现在正式入库与货盘仓库「全部产品」（用户截图红框商品，卡片标注「正式入库」），入库处理环节被旁路。
- 另有两处旁路：`promoteComparisonToWarehouse`（AppDatabase.ts:2523-2534）审批后立刻要求存在正式入库商品否则抛错；启动回填（AppDatabase.ts:1354）每次启动把所有 APPROVED 选品直写正式入库。

## 2. 目标与决策记录

用户确认的四项决策：

1. **闸口位置**：AI选品审核通过后 → 入库处理待确认 → 确认后才正式入库。AI选品决策环节保留。
2. **闸口范围**：所有会写正式入库的货源统一过闸（大健云仓、1688、绑定货源的 Ozon/AliExpress 机会品）。
3. **存量数据**：已在正式入库/货盘仓库的商品豁免不动；提供单件「退回入库处理」操作供人工回炉。
4. **确认写入**：入库处理确认后双写 `supply_warehouse_products`（正式入库，ACTIVE）与 `pallet_warehouse_items`（货盘存放）。

实现方案选型：**方案 A——复用 `inbound_processing_items` 作统一待确认队列**（加 origin/source_id/status/snapshot_json），闸口下沉到 `AppDatabase.updateSelectionDecision`。否决方案 B（正式入库表加 PENDING_INBOUND 状态：污染正式入库语义、编辑字段侵入仓库表）与方案 C（新建第三张闸口表：UI/IPC 全重复）。

目标链路：

```
采集（大健云仓/1688/市场仓绑货源）
  → 采集候选 → AI选品审核「通过」
  → inbound_processing_items（origin=SELECTION, PENDING）
  → 货盘仓库「入库处理」tab：重新编辑 / 补标签 / 确认 / 驳回
  → 确认：双写 supply_warehouse_products(ACTIVE) + pallet_warehouse_items，快照置 CONFIRMED
  → 驳回：置 REJECTED，不写任何库
服务器 ERP 采集池（status=COLLECTED）同步 = origin=ERP 的第二 intake，确认行为相同。
```

## 3. 数据模型

### 3.1 `inbound_processing_items`（重建后 schema）

```sql
CREATE TABLE inbound_processing_items (
  id            TEXT PRIMARY KEY,
  origin        TEXT NOT NULL,             -- 'SELECTION' | 'ERP'
  source_id     TEXT NOT NULL,             -- 选品ID / 服务器采集记录ID(erpProductId)
  selection_id  TEXT NOT NULL DEFAULT '',  -- origin=SELECTION 时为选品ID，否则 ''
  status        TEXT NOT NULL,             -- 'PENDING' | 'CONFIRMED' | 'REJECTED'
  snapshot_json TEXT NOT NULL,             -- 入库快照（见 3.2）
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  confirmed_at  TEXT
);
CREATE UNIQUE INDEX uq_inbound_origin_source
  ON inbound_processing_items(origin, source_id);
```

语义约束：

- `(origin, source_id)` 唯一：同来源重复提交更新同一行；PENDING/REJECTED 行覆盖 snapshot 并置 PENDING；**CONFIRMED 行冻结**（选品重审批、ERP 重采均不覆盖，要改走「退回入库处理」）。
- `confirmed_at` 仅 CONFIRMED 时写入；reedit/return 回 PENDING 时清空。

### 3.2 快照结构（snapshot_json）

```ts
interface InboundSnapshot {
  platformCode: string                  // 来源平台标识（GIGACLOUD / 1688 / 供应商 code）
  warehouseCode: '1688' | 'GIGACLOUD'   // 目标仓（双写时 supply_warehouse_products.warehouse_code）
  itemCode: string                      // SKU / productId
  title: string
  imageUrl: string
  priceText: string
  category: string                      // 一级类目（货位）
  subcategory: string                   // 二级类目（货位）
  tertiaryCategory: string              // 三级类目（货位）
  sourceUrl: string
  tags: string[]
  collectedAt: string                   // 采集/快照时间
}
```

说明：「目标仓/货位」即 `warehouseCode` + 三级类目，不引入新的货位字段；编辑表单字段 = 品名、价格、目标仓、三级类目、标签。

### 3.3 契约类型（src/shared/contracts.ts）

```ts
export type InboundOrigin = 'SELECTION' | 'ERP'
export type InboundStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED'
export interface InboundProcessingItem {
  id: string
  origin: InboundOrigin
  sourceId: string
  selectionId: string
  status: InboundStatus
  snapshot: InboundSnapshot
  createdAt: string
  updatedAt: string
  confirmedAt: string | null
}
```

替换现有 `InboundSnapshotInput` / `InboundPatchInput` / `InboundProcessingItem`（原始/编辑双份字段取消，编辑即覆盖快照）。`ComparisonPromotionResult.warehouseProduct` 改为 `inboundItemId: string`（审批后不再当场产生正式入库商品）。`erp:intake` 入参形状：`Array<{ sourceId: string, snapshot: InboundSnapshot }>`（sourceId=服务器 ERP 商品 id）。

## 4. 主进程改动（AppDatabase / IPC）

### 4.1 闸口下沉

- `updateSelectionDecision`（AppDatabase.ts:2578-2590）：APPROVED 且（sourceArea==='SUPPLY' || supplierUrl）分支由 `upsertSupplyWarehouseProduct` 改为 `upsertInboundFromSelection(item)`：origin=SELECTION、sourceId=selectionId=item.id、snapshot 取自选品记录（warehouseCode 由 platformCode 映射：GIGACLOUD→GIGACLOUD，其余→1688；sourceUrl=supplierUrl||sourceUrl；tags=[]）。非 APPROVED 分支维持现有归档逻辑不变。
- `promoteComparisonToWarehouse`（AppDatabase.ts:2523-2534）：删除「取正式入库商品、取不到抛错」两步，改为返回 `{ comparison, selection, inboundItemId }`，workflow_events detail 记录 inboundItemId。
- 启动回填（AppDatabase.ts:1354）：改为对 APPROVED 且（SUPPLY||supplierUrl）的选品逐条检查——已有正式入库行（按 selection_id）或已有入库队列行（SELECTION, selection.id）则跳过；否则补入库快照。存量豁免由此保证，重启不产生重复待确认。

### 4.2 队列操作

- `confirmInbound(id)`：读队列行 → snapshot 终值 → upsert `supply_warehouse_products`（warehouse_code=snapshot.warehouseCode、selection_id=row.selectionId、source_url、product_id=itemCode、title/image_url/price_text、supplier_name=''、category/subcategory/tertiary、status='ACTIVE'；按 (warehouse_code, source_url) 冲突更新）→ upsert `pallet_warehouse_items`（warehouse_product_id=正式入库行 id，按该键去重）→ 队列行置 CONFIRMED+confirmed_at。返回 inbound 列表。
- `rejectInbound(id)`：置 REJECTED，不写任何库。
- `reeditInbound(id, snapshot)`：覆盖 snapshot、置 PENDING、清 confirmed_at（CONFIRMED 行拒绝操作，抛「已确认商品请从正式入库退回」）。
- `returnToInbound(warehouseProductId)`：读 ACTIVE 正式入库行（不存在或已 ARCHIVED 则抛「正式入库商品不存在或已归档」）→ 组装 snapshot（tags 若存在同键历史队列行则继承，否则 []）→ origin=selection_id 非空 ? 'SELECTION' : 'ERP'，sourceId=selection_id||warehouseProductId → upsert 队列行（含 CONFIRMED/REJECTED 重置为 PENDING）→ 正式入库行置 ARCHIVED → 删除 `pallet_warehouse_items` 中 warehouse_product_id 匹配行。返回 inbound 列表。
- `erpIntake(snapshots)`：origin=ERP、sourceId=erpProductId 的建/更新（CONFIRMED 行跳过），替代现 `upsertInboundSnapshots`。
- `listInbound()`：返回全部状态（UI 侧筛选），按 updated_at 倒序。

### 4.3 IPC 通道（preload 暴露于 window.desktop.inbound）

| 通道 | 语义 | 入参 | 返回 |
|---|---|---|---|
| `inbound:list` | 全状态队列 | 无 | InboundProcessingItem[] |
| `inbound:confirm(id)` | 双写正式入库+货盘存放 | id, accessToken | InboundProcessingItem[] |
| `inbound:reject(id)` | 置 REJECTED | id, accessToken | InboundProcessingItem[] |
| `inbound:reedit(id, snapshot)` | 覆盖快照回 PENDING | id, snapshot, accessToken | InboundProcessingItem[] |
| `inbound:return(warehouseProductId)` | 单件退回入库处理 | warehouseProductId, accessToken | InboundProcessingItem[] |
| `erp:intake`（暴露为 inbound.erpIntake） | 服务器采集池同步 | items, accessToken | InboundProcessingItem[] |

写通道（confirm/reject/reedit/return/erpIntake）一律携带 accessToken，由主进程做权限强校验（见 §6）；读通道 `inbound:list` 为纯本地数据，不做服务器校验。

移除：`inbound.upsert`（由 erp:intake 与内部 seeding 取代）、`inbound.patch`（由 reedit 取代）。`pallet:list` / `pallet:remove` 保留。confirm/return 成功后前端主动刷新 inbound:list、pallet:list、warehouses:list 三个列表。

### 4.4 迁移（schema 版本 +1）

旧表平铺列 + review_status 搬运到新 schema：origin='ERP'、source_id=erp_product_id、selection_id=''、status=review_status 原值、snapshot_json 由平铺字段组装（title_edit 等非空编辑值覆盖原始值；warehouseCode 由 platform_code 映射；tags 原样）、created_at/updated_at 保留、CONFIRMED 行 confirmed_at=updated_at。搬运用「建新表 → INSERT…SELECT → DROP 旧表 → 建唯一索引」。`supply_warehouse_products` 与 `pallet_warehouse_items` 存量行不动。

## 5. 渲染器改动

### 5.1 货盘仓库「入库处理」tab（PalletWarehousePage.tsx）

- 数据源改 `inbound:list`（本地队列，全状态）；服务器采集池同步改为进 tab 且 canEdit 时调 `inbound.erpIntake`（fetchErpProducts COLLECTED 映射快照），无 canEdit 维持现有「无入库处理权限」空状态。
- 新增状态筛选 chips：待确认（默认）/ 已确认 / 已驳回。
- 卡片：来源徽标（选品审批=teal / 服务器采集池=灰）、品名、SKU、来源平台、目标仓/货位（三级类目）、标签、快照时间；已驳回加驳回时间、已确认加确认时间。
- 操作按状态：待确认＝重新编辑（内联表单：品名/价格/目标仓/三级类目/标签，保存调 reedit）+ 确认入库（primary）+ 驳回（danger，二次确认对话框）；已驳回＝重新编辑；已确认＝只读。
- 所有写调用传 `getTokens()?.accessToken`，并经统一 helper 做 SERVER_SESSION_EXPIRED → refreshSession 重试一次；失败消息走 error 横幅。
- 确认成功横幅：「已确认转入正式入库与货盘仓库」。

### 5.2 选品模块「正式入库」tab（App.tsx SupplyWarehouseWorkspace）

- 删除「送入库处理 / 入库处理中 / 已正式入库」按钮及 `palletKeys`、`inboundPendingKeys`、`handleStorePallet` 全链路状态。
- 新增「退回入库处理」按钮（canEdit 门控，二次确认）→ `inbound.return`（带 token + refresh 重试）；成功后刷新 warehouses/pallet/inbound 列表。

### 5.3 货盘仓库「全部产品 / 新品速递」卡

- 操作行「原址 / 删除」旁新增「退回入库处理」（canEdit 门控，同一 IPC、二次确认）。
- 卡脚注文案改「入库处理确认 · 正式入库并存放」。

## 6. 权限与验证逻辑

不新增权限码；服务器路由不改。验证分三层，**主进程 IPC 强校验为权威层**（UI 隐藏不算验证）：

### 6.1 权限码映射

| 操作 | 权限 | 强制层 |
|---|---|---|
| 货盘仓库页进入 / `inbound:list` | 页面权限 `menu.warehouse.hub` | 渲染器路由门控 |
| `erp:intake` 拉取服务器采集池 | `erp.warehouse.view`（服务器 `/api/erp/products` 路由既有 requirePermission） | 服务器路由 |
| `erp:intake` 写本地队列、`inbound:reedit` / `confirm` / `reject` / `return` | `erp.warehouse.edit`（capabilities.canEdit；OWNER 直通） | 主进程 IPC 强校验 + 渲染器按钮门控 |

### 6.2 主进程强校验机制（新增）

- 写通道 IPC handler 执行前校验：以入参 accessToken 调服务器 `GET /api/erp/capabilities`（复用主进程既有服务器请求工具与 base url），结果按 token 指纹缓存 **TTL 60s**；缓存命中直接用，未命中/过期实时请求。
- 判定：`canEdit === true` 放行；`canEdit === false` 或 403 → 抛语义化错误「无入库处理权限（需 erp.warehouse.edit）」；401 → 抛 `SERVER_SESSION_EXPIRED`；网络不可达/超时 → **fail closed**，抛「权限校验失败，请检查网络后重试」，拒绝写入。
- 渲染器对写调用复用既有 refresh-once 模式（同 `handleWarehouseDownload`）：捕获 `SERVER_SESSION_EXPIRED` → `refreshSession` 成功则重试一次，失败提示重新登录。
- 读通道与纯本地操作（list、页面渲染）不触发服务器校验，离线可读队列。
- capabilities 缓存同时在登录成功/手动刷新主题级会话时清空，避免换账号后沿用旧权限。

### 6.3 渲染器门控（沿用既有模式，补退回按钮）

- 入库处理 tab：无 canEdit 维持现有「无入库处理权限」空状态，不发 erpIntake。
- 正式入库卡 / 货盘仓库卡的「退回入库处理」按钮以 canEdit 门控，无权限不渲染。
- 写操作失败（无权限/校验失败）走 error 横幅展示服务器语义消息；成功走 ok 横幅。

## 7. 验证计划

手动黄金路径（dev 应用）：

1. 大健云仓采集 → 选品审批通过 → 正式入库无新增；入库处理出现「选品审批」徽标待确认卡。
2. 重新编辑保存 → 仍待确认，快照更新。
3. 确认入库 → 正式入库 ACTIVE 行 + 货盘「全部产品」卡出现；队列卡转已确认（只读）。
4. 驳回 → 不写任何库；重新编辑 → 回待确认。
5. 退回：正式入库卡「退回入库处理」→ 正式入库与货盘仓库同时消失、回待确认；再确认 → 双写恢复。
6. 有 canEdit 进入入库处理 tab → 服务器采集池 COLLECTED 快照以「服务器采集池」徽标入队；确认双写。
7. 重启应用 → 存量 APPROVED+已入库选品不重复补快照。

权限验证路径：

8. 无 `erp.warehouse.edit` 账号：入库处理 tab 空状态；正式入库/货盘仓库卡无退回按钮；绕过 UI 直调 `inbound:confirm` IPC → 主进程拒绝并返回「无入库处理权限（需 erp.warehouse.edit）」，队列与两表无变化。
9. 会话过期：写调用首次返回 SERVER_SESSION_EXPIRED → 自动 refresh 重试一次成功，用户无感；refresh 失败提示重新登录。
10. OWNER 账号：capabilities.canEdit 直通，确认/退回正常。
11. 断网时点确认 → fail closed 报错「权限校验失败，请检查网络后重试」，不写库；恢复后重试成功。

脚本与回归：

- 更新 `tools/verify-warehouse-review-actions.cjs`、`tools/verify-pallet-warehouse-ui.cjs`、`tools/fixture-seed-pallet-warehouse.cjs` 适配新流转；实施时排查其余 verify-*/fixture-* 对 inbound/pallet/warehouse 的引用。
- `tsc` 类型检查通过（contracts 变更后全量编译）。
- 重点回归：`promoteComparisonToWarehouse` 不再抛「供应仓商品生成失败」；正式入库 tab 计数徽标；palletKeys 禁用逻辑移除后卡片按钮态；SupplyProductDownloadService 对正式入库行的读取不受 ARCHIVED 影响（下载仅针对 ACTIVE）。

## 8. 边界与不做的事

- 不引入独立货位字段；不新增权限码；不改服务器端 ERP/collection 模块。
- 未绑货源的 Ozon/AliExpress 机会品本就不写正式入库，不过闸。
- CONFIRMED 快照冻结；已确认商品唯一修改路径是「退回入库处理」。
- 退回后选品记录仍为 APPROVED，不自动重审批；队列行是该商品入库与否的唯一闸口真源。
- 存量正式入库/货盘仓库数据豁免，不批量回炉。
