# 设计：eBay 发布表单镜像——按类目自动填属性，人工点最终提交

- 日期：2026-11-07
- 状态：待用户审阅
- 范围：砚都跨境桌面应用（主进程 BrowserWorkspace/AppDatabase + 渲染器 eBay 线上发布页 + shared 纯函数）

## 1. 背景与问题

用户给出 9 张 eBay 后台发布页截图（`lstng?mode=AddItem` / `sl/list?mode=ReviseItem`）与 5 张 APP「线上发布」页截图，要求：APP 侧补齐字段，使 eBay 后台发布可「一键」完成；且不同类目的属性要求不同，要智能化。

### 1.1 eBay 后台表单的必填/可选事实（截图取证）

| 分组 | 字段 | 必填性质 |
|---|---|---|
| 媒体 | 主图 + 附图（页面计数上限 25 格，含视频位） | 附图可选，**主图实际必需** |
| TITLE | Item title（80 字符） | 硬必填 |
| TITLE | Custom label (SKU)（50 字符） | 可选 |
| ITEM CATEGORY | 平台类目面包屑 | 硬必填 |
| ITEM CATEGORY | Store category 店铺分类 | 可选 |
| ITEM SPECIFICS | Required 区（截图该类目仅 `Brand`） | **必填集合由类目决定** |
| ITEM SPECIFICS | Additional (optional)：Type / Features / Items Included / Color / Manufacturer Part Number / OE-OEM Part Number / Country of Origin / Performance Part / Item Width | 可选，但随类目翻转 |
| COMPATIBILITY | 适配车辆 year/make/model/trim | 汽配类目的隐性硬门槛（不填失去 fits 列表与搜索匹配） |
| CONDITION | Item condition（New/Used…） | 硬必填 |
| DESCRIPTION | 富文本 / 自定义模板 | 硬必填 |
| PRICING | Format / Item price / **Quantity** | 硬必填 |
| PRICING | Payment policy | 硬必填（店铺级可复用资产） |
| PRICING | Allow offers | 可选 |
| 税务 | sales tax table | 条件必填（美国有代扣义务时） |
| SHIPPING | Shipping policy | 硬必填（店铺级可复用资产） |
| SHIPPING | Package weight / dimensions / Irregular package | 可选（部分政策要求） |
| Preferences | Item location + 邮编 | 硬必填 |
| Preferences | Return policy | 硬必填（店铺级可复用资产） |
| ITEM DISCLOSURES | Product documents | 条件必填（EU/UK 法规） |
| PROMOTE YOUR LISTING | General / Priority 竞价推广 | 可选 |

政策下拉的 option 文本自带 policyId：`eBay Managed Payments (257217501013)`、`云仓包邮 (1851 listings)`、`14天大健云仓退货`——这是可直接复用的店铺资产。

### 1.2 APP 现状与缺口

线上发布页只有 01 图片 / 02 标题 / 03 描述 / 04 定价（[EbayLocalListingEditor.tsx:190-236](../../../src/renderer/EbayLocalListingEditor.tsx)），格式下拉写死 `FIXED_PRICE` 且 disabled；页面自己声明「类目、库存、SKU、属性和政策不写入新版本」。草稿契约 [contracts.ts:235-242](../../../src/shared/contracts.ts) 只有 `title/descriptionText/descriptionHtml/price/currency/media` 六项。

**已存在、可直接扩展的资产**（本设计不重复造）：

- `inspectEbayListingRequirements`（[BrowserWorkspace.ts:1783-1805](../../../src/main/browser/BrowserWorkspace.ts)）已能从 ReviseItem 页 DOM 抓到 `{name, required, value, options}` 形态的类目属性清单。
- `prepareEbayListingRevision`（[:1852-1882](../../../src/main/browser/BrowserWorkspace.ts)）已按属性名匹配把 `draft.itemSpecifics` 灌进 `attributes.*` 字段，并轮询到连续两次稳定读。
- 通用 `setValue`（[:1832](../../../src/main/browser/BrowserWorkspace.ts)）已处理 checkbox / select / contenteditable / input 四类控件与 React 受控 value setter。
- `EbayPublishTask` 已有 `WAITING_CONFIRMATION` 语义与文案「已统一预填 N 项确认资料，等待人工核对并提交」（[main.ts:1237](../../../src/main/main.ts)），即「不点提交」这条边界在代码里已经成立。
- 平台类目真叶 ID 抓取（prelist `CategoryViewModel`，[:2088-2149](../../../src/main/browser/BrowserWorkspace.ts)）与 `runEbayAcceptance` 验收批次已可用。

**真正的缺口**：

1. 抓到的属性清单只活在单次 task 里，**不按类目持久化复用**；换一件同类目商品要重新开页重抓。
2. 数量、状况、政策、商品所在地/邮编、销售税这些硬必填在 APP 里**完全没有字段来源**。
3. 发布前门禁只看 AI 自己的 `needsConfirmation`（[App.tsx:4425](../../../src/renderer/App.tsx)），**不与类目必填集合比对**——0 个属性也能显示「已通过发布前检查」（[App.tsx:4805](../../../src/renderer/App.tsx)）。
4. 两处真实断点：内嵌编辑器的「保存并准备到 eBay」`onPrepare` 是空函数（[App.tsx:4813](../../../src/renderer/App.tsx)、[App.tsx:4865](../../../src/renderer/App.tsx)），点了不做事；保存本地版本时把属性与状况抹成空（[main.ts:1001-1002](../../../src/main/main.ts) `itemSpecifics:[]`、`condition:''`），这是「0 个属性」的根因。

## 2. 目标与决策记录

用户已确认：

1. **交付形态 = 纯 DOM 自动化，零新 API**。不申请 sell.inventory / sell.metadata 等生产写权限，全部走现有内嵌浏览器的 eBay 登录态。
2. **提交这一步留人工**：灌完字段停在 eBay 页面，由用户点最终提交；自动提交不在本期范围。
3. **智能化核心机制**：把「一次开页抓取」变成「一类目抓一次、之后永久复用」——类目级表单 schema 缓存是零 API 方案成立的前提。
4. **分期**：P0 断点修复 → P1 硬必填字段 → P2 类目 schema 与属性区 → P3 灌字段引擎与回读三态 → P4 汽配兼容性。

目标链路：

```
平台类目选定（真叶 categoryId）
  → 查 ebay_category_form_schemas 缓存
     命中且未过期 → 直接用 schema 在 APP 渲染属性表单 + 必填门禁
     未命中/过期 → 隐藏 view 开 eBay 发布页抓一次 → 落库
  → 四级来源填充属性值（源页 → 枚举匹配 → AI → 人工）
  → 门禁：类目必填集合 + eBay 硬必填全集，缺口点名
  → 灌字段进 eBay 发布页（标题/描述/价格/数量/状况/属性/政策/所在地）
  → 回读三态报告（已写入 / 值不符 / 未写入）
  → 停在提交前，人工核对后点 eBay 提交
```

## 3. 数据模型

### 3.1 新表 `ebay_category_form_schemas`

```sql
CREATE TABLE ebay_category_form_schemas (
  category_id    TEXT PRIMARY KEY,        -- eBay 真叶类目 ID；sug- 前缀的合成 ID 禁止入库
  marketplace_id TEXT NOT NULL DEFAULT 'EBAY_US',
  category_path  TEXT NOT NULL,           -- 面包屑原文
  aspects_json   TEXT NOT NULL,           -- EbayAspectSchema[]
  controls_json  TEXT NOT NULL,           -- EbayFormFieldSchema[]（非属性的表单字段）
  source_url     TEXT NOT NULL,           -- 抓取来源页（AddItem 或 ReviseItem）
  scraped_at     TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1
);
```

### 3.2 新表 `ebay_business_policies`

```sql
CREATE TABLE ebay_business_policies (
  id            TEXT PRIMARY KEY,
  store_id      TEXT NOT NULL,
  kind          TEXT NOT NULL,            -- 'PAYMENT' | 'SHIPPING' | 'RETURN' | 'FULFILLMENT'
  policy_id     TEXT NOT NULL,            -- 从 option 文本括号里解出的数字 ID
  label         TEXT NOT NULL,            -- 原始显示名，如「云仓包邮」
  listing_count INTEGER,                  -- 「1851 listings」
  is_default    INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL,
  UNIQUE(store_id, kind, policy_id)
);
```

### 3.3 契约扩展（`src/shared/contracts.ts`）

```ts
export interface EbayAspectSchema {
  name: string; label: string
  required: boolean
  section: 'REQUIRED' | 'OPTIONAL'
  control: 'SELECT' | 'TEXT' | 'BOOLEAN' | 'COMBOBOX'
  options: string[]; maxLength?: number; unit?: string
}
export interface EbayFormFieldSchema {
  key: 'quantity'|'condition'|'listingFormat'|'paymentPolicy'|'shippingPolicy'|'returnPolicy'
     | 'itemLocation'|'postalCode'|'handlingTime'|'sku'|'storeCategory'|'salesTax'|'compatibility'
  label: string; required: boolean
  control: 'SELECT'|'TEXT'|'BOOLEAN'; options: string[]
}
export interface EbayCategoryFormSchema {
  categoryId: string; categoryPath: string; marketplaceId: string
  aspects: EbayAspectSchema[]; controls: EbayFormFieldSchema[]
  scrapedAt: string; stale: boolean
}
export interface EbayAspectValue {
  name: string; value: string
  source: 'SOURCE_PAGE'|'ENUM_MATCH'|'AI'|'MANUAL'|'CATEGORY_DEFAULT'
  confidence: 'HIGH'|'MEDIUM'|'LOW'; needsConfirmation: boolean; evidence?: string
}
```

`EbayItemSpecific` 保持 `{name,value}` 不变、新增三个可选字段（`source`/`confidence`/`needsConfirmation`），旧记录读出即兼容。`EbayLocalProductUpdateInput` 增 `quantity?`、`condition?`、`itemSpecifics?`、`policyIds?`、`itemLocation?`。`EbayPublishTask` 增 `readback?: {verified:string[]; mismatch:string[]; missing:string[]}`。

### 3.4 新增 shared 纯函数 `src/shared/ebayListingForm.ts`

- `isRealLeafCategoryId(id)` — 拒 `sug-` 合成 ID 入 schema 表。
- `normaliseAspectName(name)` — 复用 `ebaySpecificsEnglish.ts` 的中文键英译底子做归一（大小写/空格/`*`/「必填」「建议」后缀剥离）。
- `matchEnumValue(raw, options)` — 精确 → 大小写折叠 → 别名表 → 唯一包含；**匹配不上返回空串，绝不把自由文本塞进枚举控件**。
- `resolveAspectValue(schema, sources)` — 第 4 节四级回退，产出 `EbayAspectValue`。
- `requiredFormGaps(schema, values, hardRequired: EbayFormFieldSchema[])` — `hardRequired` 是与类目无关的 eBay 硬必填全集（quantity/condition/policies/itemLocation 等，由 §1.1 表格固化为常量表），返回缺口清单 `Array<{kind:'ASPECT'|'FIELD', name:string, label:string}>`，供门禁与 UI 点名。
- `extractPolicyIdFromLabel(label)` — `eBay Managed Payments (257217501013)` → `{policyId:'257217501013', label:'eBay Managed Payments'}`。
- `schemaStaleness(scrapedAt, now, ttlDays)` — 默认 30 天。

条件必填规则单独放 `src/shared/ebayListingConditionalRules.ts` 的数据表，不埋进代码分支：形如 `{when:{aspect:'Brand', in:['unbranded','']}, then:{require:'Manufacturer Part Number'}}`、`{when:{categoryPath~/^eBay Motors/}, then:{require:'compatibility'}}`、`{when:{marketplace in [EBAY_DE,EBAY_FR,...]}, then:{require:'itemDisclosures'}}`。

## 4. 属性智能填充：四级来源

逐属性依次回退，命中即停，并记录来源与时间（沿用既有自动填充口径：可手工改、不被覆盖、标来源时间、失败保原值）：

1. **源商品页已有属性** — `snapshot.details.itemSpecifics`（货盘/图文页抓取已有）经 `normaliseAspectName` 映射到 schema 属性名。
2. **枚举匹配** — 在该属性 `options` 内 `matchEnumValue`；schema 是 SELECT 而值匹配不上则视为未命中，回退下一级。
3. **AI 推断** — 走现有 `EbayOptimizationService` 属性建议 + `productPageFacts` 事实卡，打 `needsConfirmation:true`、`confidence` 降级。
4. **人工** — 必填且前三路全空 → 属性区高亮该行并要求填写；**门禁阻断，不允许进入灌字段**。

店铺级记忆：人工修正过的值按 `(storeId, categoryId, aspectName)` 回写为 `CATEGORY_DEFAULT`；同类目下一件商品在「源商品页 → 枚举匹配」都未命中时、**在 AI 推断之前**先查该记忆，命中即停。

## 5. 灌字段引擎：从 3 个字段扩到硬必填全集

现状 `prepareEbayListingRevision` 只灌标题/描述/价格/属性。改造为「字段描述符数组驱动」，复用现有 `setValue`：

| 目标字段 | 定位方式 | 控件 |
|---|---|---|
| 标题 / 描述 / 价格 | 现有逻辑不动 | input / textarea / input |
| Quantity | label `quantity|数量` | input |
| Item condition | label `item condition|商品状况` | select |
| Payment / Shipping / Return policy | label 匹配 + option 文本含 policyId | select（按 policyId 选，不只按名称） |
| Item location / 邮编 | label `item location|zip|postal` | input |
| SKU | label `custom label|sku` | input |
| 类目属性 | `attributes.*` name 匹配（现有） | select / input / Yes-No |

**回读三态**：灌完后再跑一遍读脚本，逐字段比对期望值与实际 DOM 值，产出 `verified / mismatch / missing`，写入 `EbayPublishTask.readback` 并在 UI 展示。验收口径是「eBay 页面上实际读回的值 = APP 里的值」，不是 APP 自己声称填过了。

COMBOBOX 类属性（搜索型联想，如部分 Color/Material）本期**不自动灌**：计入 `missing` 并提示人工点选，避免误选枚举值污染刊登。

### 5.1 schema 抓取入口（P2 首个待实测项）

现有抓取全部依赖 `mode=ReviseItem&itemId=`，即**只能抓已在线上的刊登**。新类目首次抓取需要 AddItem 路径：

- 首选：隐藏 view 直开 `https://www.ebay.com/lstng?mode=AddItem&categoryId=<真叶ID>`，验证 eBay 是否接受按类目直入。
- 兜底（若直入不成立）：走 prelist `identify` 流程到 AddItem，首次需人工点一次类目，之后同类目复用缓存；同时 ReviseItem 路径继续为「已在线商品」提供 schema 来源。
- 触发时机：平台类目确定后后台静默抓（用户无感）；属性区提供「重新获取」手动回源。
- `stale` 不阻断发布，只在 UI 提示「该类目表单镜像已过期，建议重抓」。

## 6. UI：线上发布页 4 区扩到 7 区

| 区块 | 内容 | 期次 |
|---|---|---|
| 05 状况与库存 | condition、quantity、定价格式（解除写死） | P1 |
| 06 类目属性 | schema 驱动的动态表单 + 来源徽标 + 必填缺口点名 + 「重新获取」 | P2 |
| 07 政策与所在地 | 付款/运输/退货政策选择器（读 `ebay_business_policies`）、商品所在地邮编、处理天数、销售税 | P1 |

门禁改造：`draftPublishIssues`（[App.tsx:4419-4426](../../../src/renderer/App.tsx)）第 4425 行的「属性待确认」替换为 `requiredFormGaps` 的具体缺口点名；「已通过发布前检查」文案只在缺口为空时出现。同时修掉 `onPrepare` 空函数与 `main.ts:1001-1002` 抹属性两处断点。

## 7. 分期

- **P0 断点修复**（不依赖 schema）：`onPrepare` 接线、保存不再抹 `itemSpecifics/condition`、`EbayItemSpecific` 扩展可选字段。
- **P1 硬必填全集**：05/07 区块 + 政策抓取入库 + 门禁按硬必填集合 + 灌字段引擎扩 quantity/condition/policies/location。
- **P2 类目 schema**：AddItem 直入可行性实测 → `ebay_category_form_schemas` 落库与缓存 → 06 属性区 + 四级填充 + 条件规则表。
- **P3 回读三态**：灌后重读比对、`readback` 报告、UI 三态展示。
- **P4 汽配兼容性**（可选，风险最高，多级联动 combobox）。

每期独立验收、独立可发布；P1 结束时「能发出去」，P2 结束时「按类目自动填属性」。

**本轮实施计划只覆盖 P0 + P1**（不含 schema 缓存与属性区）；P2 开工前提是 §5.1 的 AddItem 直入可行性实测出结论，届时另出计划。

## 8. 测试与验收

- vitest 纯函数：`isRealLeafCategoryId`、`normaliseAspectName`、`matchEnumValue`（精确/别名/歧义/未命中四路）、`resolveAspectValue` 四级回退与来源标注、`requiredFormGaps`、`extractPolicyIdFromLabel`、`schemaStaleness`、条件规则表翻转用例。
- DOM 解析用真实 eBay 页面 HTML 快照做 fixture，解析器与 `executeJavaScript` 字符串解耦，便于离线断言。
- 真机复验（每期）：取一件真实商品，断言 eBay 页面上**读回值 = APP 值**；必填缺口存在时门禁必须阻断且点名具体属性；政策按 policyId 命中；`sug-` 类目 ID 不落 schema 表。
- 门禁：双端 typecheck + vitest 全绿 + `hot:sync` 部署 + `tools/restart-app.sh` 重启复验。

## 9. 边界与不做的事

- 不申请任何 eBay 生产 API 写权限；不调 Sell Inventory/Account/Metadata。
- **不自动点击 eBay 最终提交按钮**（P1–P3 全程保持 `WAITING_CONFIRMATION`）。
- 不修改线上既有政策，只读取与选择。
- 不批量并发开页抓 schema（限速、串行），避免触发 eBay 风控。
- 不改 eBay 域名白名单与 CSP（上一轮已定口径：只放行官方国别站点）。
- 不做与发布无关的编辑器重构。

## 10. 风险

1. **eBay 前台改版即断**：靠 `stale` 检测 + 单类目重抓 + 三态报告把断裂显式暴露；缓解不了的是断的那一刻批量发布停摆。
2. **AddItem 按类目直入未验证**：P2 第一动作就是这项可行性实测，兜底路径已写在 §5.1。
3. **枚举误填**：`matchEnumValue` 未命中即不回退为自由文本，宁缺毋滥；COMBOBOX 一律留人工。
4. **速度**：逐页操作，批量吞吐受浏览器串行限制；批量场景需排队而非并发。
