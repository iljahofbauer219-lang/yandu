# eBay 发布表单镜像 · P0 断点修复 + P1 硬必填全集 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 APP「线上发布」页持有 eBay 后台表单的全部硬必填字段（状况、数量、定价格式、SKU、三项店铺政策、商品所在地/邮编），并把它们真正灌进 Seller Hub 修改页；同时修掉两处让发布链路「点了不做事 / 存了就丢字段」的断点。

**Architecture:** 三段式，全部沿用现有资产，不引入新依赖。① `src/shared/ebayListingForm.ts` 新增纯函数层（合并快照编辑、硬必填常量表、缺口计算、政策标签解析），可离线单测；② 主进程只做编排：`AppDatabase` 增 `ebay_business_policies` 表，`BrowserWorkspace` 在既有的 ReviseItem 抓取/灌值脚本里多读多写几类控件，`main.ts` 的 IPC 负责落库与阻断口径；③ 渲染器 `EbayLocalListingEditor.tsx` 从 4 区扩到 6 区（06 类目属性留 P2），`App.tsx` 只做接线与门禁文案去自证。

**Tech Stack:** TypeScript 5 / Electron 主渲染双进程 / React 18 / Vite / pnpm workspace / vitest / node:sqlite（`AppDatabase`）/ `WebContents.executeJavaScript` DOM 自动化。

**Spec:** [docs/superpowers/specs/2026-11-07-ebay-listing-form-mirror-design.md](../specs/2026-11-07-ebay-listing-form-mirror-design.md)

## Global Constraints

每一期的每一步都受这些约束，违反任意一条即视为该任务未完成：

- **零新 API**：不申请、不调用任何 eBay 生产写入接口（sell.inventory / sell.account / sell.fulfillment / sell.metadata / Trading 写调用一律禁止）。全部走现有内嵌浏览器的 eBay 登录态 DOM。
- **绝不点击 eBay 最终提交按钮**：`EbayPublishTask` 必须停在 `WAITING_CONFIRMATION`；`prepareEbayLocalProductRevision` 只允许「写入字段 + 挂横幅」，新增脚本里不得出现 `form.submit()`、`.click()` 提交按钮。
- **只放行官方 eBay 国别站点**：不改 [src/shared/ebaySites.ts](../../src/shared/ebaySites.ts) 的白名单，不改 CSP。
- **门禁不得 brick 操作**（对 spec §6 的工程裁定，实现者不要「顺手」改成硬阻断）：`requiredFormGaps` 的结果用于**点名展示**与**去掉假绿灯**。原因：05/07 字段在 ReviseItem 页上本就有线上原值，APP 缺记录 ≠ eBay 缺值；硬阻断会让「保存并准备到 eBay」变成用户眼中的「代码没生效」。真正阻断发布动作的只有既有校验（[src/main/main.ts:990](../../src/main/main.ts) 的 `validationErrors`）与既有登录/验证码护栏。
- **自动填充五条硬口径**（沿用本项目既有约定）：可手工改、不被自动覆盖、标注来源与时间、失败保原值、单位随源数据币种。
- **不改动**：`prepareEbayListingRevision`（优品草稿路径）现有三字段填充逻辑与轮询稳定读；`EbayPublishTask` 状态机取值集合；eBay 域名白名单与 CSP。
- **每任务收尾门禁**：`npm run typecheck && npx vitest run` 全绿；主进程或渲染器代码要上真机验证时先 `npm run hot:sync`，再用 `bash tools/restart-app.sh` 重启（唯一入口，禁止 `pkill -f` 中文名）。
- **中文文案**：面向用户的错误与提示一律中文完整句，不得出现裸英文技术串。

## 文件结构

| 文件 | 职责 | 任务 |
|---|---|---|
| `src/shared/contracts.ts` | 契约：属性来源字段、05/07 新字段、政策行、抓取结果形态 | T1 T3 T4 |
| `src/shared/ebayListingForm.ts` **(新)** | 纯函数：`mergeEbayLocalDetailsEdit`、`EBAY_HARD_REQUIRED_FIELDS`、`requiredFormGaps`、`formValuesFromInput`、`extractPolicyIdFromLabel` | T1 T3 |
| `src/shared/__tests__/ebayListingForm.test.ts` **(新)** | 上述纯函数单测 | T1 T3 |
| `src/main/main.ts` | 编排：保存走合并、需求抓取落库、政策列表 IPC | T1 T5 |
| `src/main/database/AppDatabase.ts` | `ebay_business_policies` 建表 + DAO | T4 |
| `src/main/database/__tests__/AppDatabase.businessPolicies.test.ts` **(新)** | 建表与按类整体覆盖语义回归 | T4 |
| `src/main/browser/ebayLocalFill.ts` **(新)** | 灌字段目标表（11 项）与 payload 构造，纯 TS 可离线测 | T8 |
| `src/main/browser/__tests__/ebayLocalFill.test.ts` **(新)** | 目标表与 payload 单测 | T8 |
| `src/main/browser/BrowserWorkspace.ts` | ReviseItem 页：读政策下拉选项；灌值脚本扩到 11 项 | T5 T8 |
| `src/preload/preload.ts` + `src/renderer/global.d.ts` | `businessPolicies` 暴露与类型 | T5 |
| `src/renderer/EbayLocalListingEditor.tsx` | 05 状况与库存、07 政策与所在地两区块 + 就绪度读数 | T6 T7 |
| `src/renderer/ebay-local-listing-editor.css` | 新区块栅格与缺口标记样式 | T6 T7 |
| `src/renderer/__tests__/EbayLocalListingEditor.gaps.test.tsx` **(新)** | 区块渲染与缺口点名的静态渲染断言 | T6 T7 |
| `vitest.config.ts` | `test.include` 收 `.test.tsx` | T6 |
| `src/renderer/App.tsx` | 草稿种子、`onPrepare` 接线、政策状态、门禁去自证 | T2 T7 T9 |

---

## Task 1: 保存不再抹字段（P0 根因）

**Files:**
- Modify: `src/shared/contracts.ts:148`（`EbayItemSpecific`）、`:150-168`（`EbayProductDetails`）、`:235-242`（`EbayLocalProductUpdateInput`）
- Create: `src/shared/ebayListingForm.ts`
- Create: `src/shared/__tests__/ebayListingForm.test.ts`
- Modify: `src/main/main.ts:999-1009`（`updateEbayLocalProduct` 里造 `details` 的那段）

**Interfaces:**
- Consumes: 无（本任务是地基）
- Produces:
  - `mergeEbayLocalDetailsEdit(previous:EbayProductDetails, changes:EbayLocalProductUpdateInput):EbayProductDetails`
  - `EbayProductDetails` 新增可选 `quantity`/`sku`/`itemLocation`/`postalCode`/`handlingTime`
  - `EbayLocalProductUpdateInput` 新增可选 `quantity`/`condition`/`listingFormat`/`sku`/`itemLocation`/`postalCode`/`handlingTime`/`itemSpecifics`/`policyIds`
  - `EbayItemSpecific` 新增可选 `source`/`confidence`/`needsConfirmation`
  - `EbayLocalProductPolicySelection { payment?; shipping?; return? }`

- [ ] **Step 1: 写失败测试**

Create `src/shared/__tests__/ebayListingForm.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import type { EbayLocalProductUpdateInput, EbayProductDetails } from '../contracts'
import { mergeEbayLocalDetailsEdit } from '../ebayListingForm'

const previous:EbayProductDetails={
  url:'https://www.ebay.com/itm/123',
  itemSpecifics:[{name:'Brand',value:'OEM',source:'SOURCE_PAGE',confidence:'HIGH',needsConfirmation:false}],
  condition:'New',
  imageUrls:['https://img.example/a.jpg'],
  videoUrl:'https://img.example/v.mp4',
  title:'Old Title',
  subtitle:'sub',
  descriptionText:'old text',
  descriptionHtml:'<p>old</p>',
  price:'9.90',
  currency:'USD',
  shippingPolicy:'云仓包邮',
  returnPolicy:'14天大健云仓退货',
  paymentPolicy:'eBay Managed Payments',
  sellerNotes:'notes',
  listingFormat:'FIXED_PRICE',
  bestOfferEnabled:false,
  quantity:'12',
  itemLocation:'Guangdong, CN',
  postalCode:'528000'
}

const changes:EbayLocalProductUpdateInput={
  title:'New Title',
  descriptionText:'new text',
  descriptionHtml:'<p>new</p>',
  price:'19.90',
  currency:'USD',
  media:[{id:'m1',mediaType:'IMAGE',sortOrder:0,remoteUrl:'https://img.example/b.jpg',localPath:'/tmp/b.jpg',mimeType:'image/jpeg',width:1200,height:1200,fileSize:100,sha256:'',downloadStatus:'DOWNLOADED'}]
}

describe('mergeEbayLocalDetailsEdit', () => {
  it('只改四项核心资料时，属性、状况、视频、政策、数量、所在地全部保留', () => {
    const merged=mergeEbayLocalDetailsEdit(previous,changes)
    expect(merged.title).toBe('New Title')
    expect(merged.price).toBe('19.90')
    expect(merged.itemSpecifics).toEqual(previous.itemSpecifics)
    expect(merged.condition).toBe('New')
    expect(merged.videoUrl).toBe(previous.videoUrl)
    expect(merged.subtitle).toBe('sub')
    expect(merged.sellerNotes).toBe('notes')
    expect(merged.listingFormat).toBe('FIXED_PRICE')
    expect(merged.bestOfferEnabled).toBe(false)
    expect(merged.quantity).toBe('12')
    expect(merged.itemLocation).toBe('Guangdong, CN')
    expect(merged.postalCode).toBe('528000')
    expect(merged.shippingPolicy).toBe('云仓包邮')
  })

  it('显式提交的属性与状况覆盖旧值，空数组视为清空而不是忽略', () => {
    const merged=mergeEbayLocalDetailsEdit(previous,{...changes,condition:'Used',itemSpecifics:[{name:'Brand',value:'Generic'}]})
    expect(merged.condition).toBe('Used')
    expect(merged.itemSpecifics).toEqual([{name:'Brand',value:'Generic'}])
    expect(mergeEbayLocalDetailsEdit(previous,{...changes,itemSpecifics:[]}).itemSpecifics).toEqual([])
  })

  it('政策选择按 kind 写入对应旧字段，未提交的 kind 保原值', () => {
    const merged=mergeEbayLocalDetailsEdit(previous,{...changes,policyIds:{shipping:'257217501013'}})
    expect(merged.shippingPolicy).toBe('257217501013')
    expect(merged.returnPolicy).toBe('14天大健云仓退货')
    expect(merged.paymentPolicy).toBe('eBay Managed Payments')
  })

  it('图片清单以提交媒体为准，缺 remoteUrl 的行不污染图集', () => {
    const merged=mergeEbayLocalDetailsEdit(previous,{...changes,media:[
      ...changes.media,
      {id:'m2',mediaType:'IMAGE' as const,sortOrder:1,remoteUrl:'',localPath:'/tmp/c.jpg',mimeType:'image/jpeg',width:1200,height:1200,fileSize:100,sha256:'',downloadStatus:'DOWNLOADED' as const}
    ]})
    expect(merged.imageUrls).toEqual(['https://img.example/b.jpg'])
  })

  it('不改动传入的旧对象（纯函数，无引用泄漏）', () => {
    const merged=mergeEbayLocalDetailsEdit(previous,changes)
    merged.itemSpecifics.push({name:'Material',value:'Steel'})
    expect(previous.itemSpecifics).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/shared/__tests__/ebayListingForm.test.ts`
Expected: FAIL —— `Failed to resolve import "../ebayListingForm"`（文件还不存在）。

- [ ] **Step 3: 扩契约**

`src/shared/contracts.ts` —— 把 `:148` 一行替换为：

```ts
export interface EbayItemSpecific {
  name:string
  value:string
  source?:'SOURCE_PAGE'|'ENUM_MATCH'|'AI'|'MANUAL'|'CATEGORY_DEFAULT'
  confidence?:'HIGH'|'MEDIUM'|'LOW'
  needsConfirmation?:boolean
  evidence?:string
}
```

`EbayProductDetails`（`:150-168`）在 `bestOfferEnabled?:boolean` 之后补：

```ts
  quantity?:string
  sku?:string
  itemLocation?:string
  postalCode?:string
  handlingTime?:string
```

`EbayLocalProductUpdateInput`（`:235-242`）整体替换为：

```ts
export interface EbayLocalProductPolicySelection {
  payment?:string
  shipping?:string
  return?:string
}

export interface EbayLocalProductUpdateInput {
  title:string
  descriptionText:string
  descriptionHtml:string
  price:string
  currency:string
  media:EbayLocalProductMedia[]
  quantity?:string
  condition?:string
  listingFormat?:'FIXED_PRICE'|'AUCTION'
  sku?:string
  itemLocation?:string
  postalCode?:string
  handlingTime?:string
  itemSpecifics?:EbayItemSpecific[]
  policyIds?:EbayLocalProductPolicySelection
}
```

- [ ] **Step 4: 写 `src/shared/ebayListingForm.ts`**

```ts
import type { EbayLocalProductUpdateInput, EbayProductDetails } from './contracts'

/** 把渲染器提交的编辑合并回旧快照详情：只覆盖本次真正提交的字段，其余（属性/状况/视频/政策/数量/所在地）原样保留。 */
export function mergeEbayLocalDetailsEdit(previous:EbayProductDetails,changes:EbayLocalProductUpdateInput):EbayProductDetails {
  const policies=changes.policyIds||{}
  return {
    ...previous,
    itemSpecifics:changes.itemSpecifics?changes.itemSpecifics.map(item=>({...item})):[...(previous.itemSpecifics||[])],
    condition:changes.condition===undefined?previous.condition:changes.condition.trim(),
    quantity:changes.quantity===undefined?previous.quantity:changes.quantity.trim(),
    sku:changes.sku===undefined?previous.sku:changes.sku.trim(),
    itemLocation:changes.itemLocation===undefined?previous.itemLocation:changes.itemLocation.trim(),
    postalCode:changes.postalCode===undefined?previous.postalCode:changes.postalCode.trim(),
    handlingTime:changes.handlingTime===undefined?previous.handlingTime:changes.handlingTime.trim(),
    listingFormat:changes.listingFormat===undefined?previous.listingFormat:changes.listingFormat,
    paymentPolicy:policies.payment===undefined?previous.paymentPolicy:policies.payment,
    shippingPolicy:policies.shipping===undefined?previous.shippingPolicy:policies.shipping,
    returnPolicy:policies.return===undefined?previous.returnPolicy:policies.return,
    title:changes.title.trim(),
    descriptionText:changes.descriptionText.trim(),
    descriptionHtml:changes.descriptionHtml.trim(),
    price:changes.price.trim(),
    currency:changes.currency.trim(),
    imageUrls:changes.media.map(item=>item.remoteUrl).filter(Boolean)
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/shared/__tests__/ebayListingForm.test.ts`
Expected: PASS（5 个用例）。

- [ ] **Step 6: 主进程接入**

`src/main/main.ts` —— 顶部 shared 契约 import 处补 `mergeEbayLocalDetailsEdit`（与 `EbayLocalProductUpdateInput` 同一 from 语句之外，单独一行）：

```ts
import { mergeEbayLocalDetailsEdit } from '../shared/ebayListingForm'
```

把 `updateEbayLocalProduct` 内 `:999-1009` 的 `const details:EbayProductDetails={...}` 整段替换为：

```ts
  const details=mergeEbayLocalDetailsEdit(product.snapshot.details,{...changes,title,price:listing.price,currency:listing.currency})
```

- [ ] **Step 7: 全套校验**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck 无输出；vitest 全绿（用例数比基线 +5）。

- [ ] **Step 8: 提交**

```bash
git add src/shared/contracts.ts src/shared/ebayListingForm.ts src/shared/__tests__/ebayListingForm.test.ts src/main/main.ts
git commit -m "fix(ebay-publish): 保存本地版本不再抹掉属性/状况/视频/政策/数量/所在地（P0 根因）"
```

---

## Task 2: 「保存并准备到 eBay」空函数接线（P0 断点）

**Files:**
- Modify: `src/renderer/App.tsx:215-225`（`ebayLocalProductDraft`）
- Modify: `src/renderer/App.tsx:4806`（「进入发布」按钮内联种子）
- Modify: `src/renderer/App.tsx:4813`（内嵌编辑器 `onPrepare={()=>{}}`）

**Interfaces:**
- Consumes: `window.desktop.ebay.updateLocalProduct(id,draft)`、`window.desktop.ebay.prepareLocalProductRevision(id)`（[preload.ts:453/461](../../src/preload/preload.ts)）、Task 1 扩展后的 `EbayLocalProductUpdateInput`
- Produces: `ebayLocalProductFormSeed(product:EbayLocalProduct):Pick<EbayLocalProductUpdateInput,'quantity'|'condition'|'listingFormat'|'sku'|'itemLocation'|'postalCode'|'handlingTime'|'itemSpecifics'>`；`preparePublishEditorInSellerHub():Promise<void>`

- [ ] **Step 1: 加统一种子函数**

`src/renderer/App.tsx`，紧跟 `ebayLocalProductDraft`（`:225` 的 `}` 之后）插入：

```ts
function ebayLocalProductFormSeed(product:EbayLocalProduct):Pick<EbayLocalProductUpdateInput,'quantity'|'condition'|'listingFormat'|'sku'|'itemLocation'|'postalCode'|'handlingTime'|'itemSpecifics'> {
  const {details,sourceListing}=product.snapshot
  return {
    quantity:details.quantity??String(sourceListing.quantity??''),
    condition:details.condition||'',
    listingFormat:details.listingFormat||'FIXED_PRICE',
    sku:details.sku||'',
    itemLocation:details.itemLocation||'',
    postalCode:details.postalCode||'',
    handlingTime:details.handlingTime||'',
    itemSpecifics:(details.itemSpecifics||[]).map(item=>({...item}))
  }
}
```

- [ ] **Step 2: 两处种子都带上表单字段**

`ebayLocalProductDraft`（`:215-225`）的 `return` 改为展开种子：

```ts
function ebayLocalProductDraft(product:EbayLocalProduct):EbayLocalProductUpdateInput {
  const {details,sourceListing}=product.snapshot
  return {
    ...ebayLocalProductFormSeed(product),
    title:details.title||sourceListing.title,
    descriptionText:details.descriptionText||'',
    descriptionHtml:details.descriptionHtml||'',
    price:details.price||sourceListing.price,
    currency:details.currency||sourceListing.currency,
    media:[...product.snapshot.media].sort((left,right)=>left.sortOrder-right.sortOrder)
  }
}
```

`:4806` 的「进入发布」按钮里，只做**一处插入**：在 `setPublishEditorDraft({` 之后、`title:draft.selectedTitle` 之前插入 `{...ebayLocalProductFormSeed(lp),}` —— 即把 `setPublishEditorDraft({title:draft.selectedTitle,` 改成 `setPublishEditorDraft({...ebayLocalProductFormSeed(lp),title:draft.selectedTitle,`。该行后面已有的 `title/descriptionText/descriptionHtml/price/currency/media` 六个键保持一字不动，它们排在展开之后，因此 title 等仍取优品草稿的值，而 `quantity/condition/listingFormat/sku/itemLocation/postalCode/handlingTime/itemSpecifics` 由种子补上。

- [ ] **Step 2b: 确认展开顺序没有覆盖掉媒体与价格**

Run: `grep -c 'ebayLocalProductFormSeed(lp),title:draft.selectedTitle' src/renderer/App.tsx`
Expected: `1`（种子在最前，草稿值覆盖其后）。

- [ ] **Step 3: 写 prepare 函数**

`src/renderer/App.tsx`，在 `const inlinePlatformCategory=useEbayPlatformCategory(...)`（`:4103`）之后插入。注意：与 `:4150` 的浮层版区别是它保存后**不关编辑器**，用户要能立刻看到灌了哪些字段。

```ts
  const preparePublishEditorInSellerHub=async()=>{
    if(!publishEditorProduct||!publishEditorDraft)return
    const product=publishEditorProduct
    setBusy(`publish-prepare:${product.id}`)
    setEbayError('')
    try {
      const saved=await window.desktop.ebay.updateLocalProduct(product.id,publishEditorDraft)
      setLocalProducts(current=>[saved,...current.filter(item=>item.id!==saved.id)])
      setPublishEditorProduct(saved)
      setPublishEditorDraft({...publishEditorDraft,...ebayLocalProductFormSeed(saved)})
      const result=await window.desktop.ebay.prepareLocalProductRevision(saved.id)
      setActiveTab('browser')
      const gaps=localProductFormGaps(saved)
      const skipped=[...new Set(result.skippedFields)]
      setNotice(`已在 Seller Hub 填写 ${[...new Set(result.filledFields)].length} 项：${[...new Set(result.filledFields)].join('、')||'无'}。${skipped.length?` ${skipped.length} 项未能自动写入（${skipped.join('、')}），请在页面人工补齐。`:''}${gaps.length?` APP 尚未记录：${gaps.map(item=>item.label).join('、')}，页面沿用 eBay 线上原值。`:''}最终提交按钮仍需由您点击。`)
    } catch (reason) {
      setEbayError(readableError(reason,'本地版本已保留，但准备 eBay 修改页面失败'))
    } finally {
      setBusy('')
    }
  }
```

`localProductFormGaps` 在 Task 3 里定义在 `src/shared/ebayListingForm.ts`，Task 2 先用最小内联实现，Task 3 落地后由 Task 3 Step 6 统一改 import——**若按本计划顺序执行，请在本步骤直接 import Task 3 的函数**；因此本步骤与 Task 3 的 Step 6 之间不要插入其它改动。为避免跨任务顺序耦合，本步先写局部版本：

```ts
  const localProductFormGaps=(product:EbayLocalProduct)=>requiredFormGaps([],product.snapshot.details)
```

并在文件顶部 shared import 区补：

```ts
import { requiredFormGaps } from '../shared/ebayListingForm'
```

（`requiredFormGaps` 于 Task 3 Step 1 落地。若 Task 2 单独执行，先跳到 Task 3 Step 1-5 再做 Task 2 Step 3。）

- [ ] **Step 4: 把 `onPrepare` 接上**

`src/renderer/App.tsx:4813`：把 `onPrepare={()=>{}}` 替换为 `onPrepare={()=>{void preparePublishEditorInSellerHub()}}`，并把同一行的 `preparing={false}` 替换为 `preparing={busy===\`publish-prepare:${publishEditorProduct?.id}\`}`。

- [ ] **Step 5: 校验**

Run: `npm run typecheck`
Expected: 无输出（`onPrepare` 不再是空函数）。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/App.tsx
git commit -m "fix(ebay-publish): 线上发布页「保存并准备到 eBay」由空函数接为真保存+真灌字段（P0 断点）"
```

---

## Task 3: eBay 硬必填全集与缺口点名（P1 shared）

**Files:**
- Modify: `src/shared/ebayListingForm.ts`（追加，不动 Task 1 的函数）
- Modify: `src/shared/__tests__/ebayListingForm.test.ts`（追加 describe 块）

**Interfaces:**
- Consumes: `EbayFormFieldSchema`（spec §3.3）、`EbayCategorySpecificRequirement`（[contracts.ts:799-805](../../src/shared/contracts.ts)）
- Produces:
  - `EbayFormGap {kind:'ASPECT'|'FIELD'; name:string; label:string}`
  - `EbayFormValues`
  - `EBAY_HARD_REQUIRED_FIELDS:EbayFormFieldSchema[]`
  - `requiredFormGaps(aspects:EbayCategorySpecificRequirement[],values:EbayFormValues,hardRequired?:EbayFormFieldSchema[]):EbayFormGap[]`
  - `formValuesFromInput(input:EbayLocalProductUpdateInput):EbayFormValues` —— 把编辑器的 `policyIds.{payment,shipping,return}` 摊平成 `EbayFormValues` 的三个政策键（`EbayLocalProductUpdateInput` 与 `EbayFormValues` 形状不同，不能直接传）
  - `extractPolicyIdFromLabel(raw:string):{policyId?:string; label:string; listingCount?:number}`
  - `formatFormGaps(gaps:EbayFormGap[]):string`

- [ ] **Step 1: 写失败测试（追加到 `ebayListingForm.test.ts`）**

```ts
import { EBAY_HARD_REQUIRED_FIELDS, extractPolicyIdFromLabel, formValuesFromInput, formatFormGaps, requiredFormGaps } from '../ebayListingForm'
import type { EbayCategorySpecificRequirement } from '../contracts'

const requirement=(name:string,required:boolean,value=''):EbayCategorySpecificRequirement=>({name,required,value,options:[],source:'SELLER_HUB'})

describe('EBAY_HARD_REQUIRED_FIELDS', () => {
  it('固化 spec §1.1 的与类目无关硬必填全集，且不含可选字段', () => {
    expect(EBAY_HARD_REQUIRED_FIELDS.filter(item=>item.required).map(item=>item.key).sort()).toEqual(
      ['condition','itemLocation','listingFormat','paymentPolicy','postalCode','quantity','returnPolicy','shippingPolicy']
    )
    expect(EBAY_HARD_REQUIRED_FIELDS.some(item=>item.key==='sku')).toBe(false)
    expect(EBAY_HARD_REQUIRED_FIELDS.some(item=>item.key==='storeCategory')).toBe(false)
    expect(EBAY_HARD_REQUIRED_FIELDS.every(item=>item.options.length===0||item.key==='listingFormat')).toBe(true)
  })
})

describe('requiredFormGaps', () => {
  const filled={quantity:'12',condition:'New',listingFormat:'FIXED_PRICE',paymentPolicy:'257217501013',shippingPolicy:'1851',returnPolicy:'14',itemLocation:'Guangdong, CN',postalCode:'528000'}

  it('全集齐 → 无缺口', () => {
    expect(requiredFormGaps([],filled)).toEqual([])
  })

  it('缺几项点几名，字段缺口排在属性缺口之前', () => {
    const gaps=requiredFormGaps([requirement('Brand',true),requirement('Type',false)],{...filled,condition:'',postalCode:'  '})
    expect(gaps).toEqual([
      {kind:'FIELD',name:'condition',label:'商品状况'},
      {kind:'FIELD',name:'postalCode',label:'所在地邮编'},
      {kind:'ASPECT',name:'Brand',label:'Brand'}
    ])
  })

  it('非必填属性即使空着也不算缺口；必填属性有值也不算', () => {
    expect(requiredFormGaps([requirement('Color',false),requirement('MPN',true,'1K-205')],filled)).toEqual([])
  })

  it('属性名归一后去重，同名必填只报一次', () => {
    const gaps=requiredFormGaps([requirement('Brand',true),requirement('brand *',true)],filled)
    expect(gaps.filter(item=>item.kind==='ASPECT')).toHaveLength(1)
  })

  it('formatFormGaps 输出中文顿号清单，空数组返回空串', () => {
    expect(formatFormGaps([])).toBe('')
    expect(formatFormGaps([{kind:'FIELD',name:'quantity',label:'数量'},{kind:'ASPECT',name:'Brand',label:'Brand'}])).toBe('数量、Brand')
  })

  it('formValuesFromInput 把 policyIds 摊平成三个政策键', () => {
    const values=formValuesFromInput({title:'t',descriptionText:'',descriptionHtml:'',price:'1',currency:'USD',media:[],quantity:'3',condition:'New',policyIds:{shipping:'18510002003'}})
    expect(values.quantity).toBe('3')
    expect(values.shippingPolicy).toBe('18510002003')
    expect(values.paymentPolicy).toBeUndefined()
    expect(requiredFormGaps([],formValuesFromInput({title:'t',descriptionText:'',descriptionHtml:'',price:'1',currency:'USD',media:[],quantity:'3',condition:'New',itemLocation:'CN',postalCode:'528000',listingFormat:'FIXED_PRICE'})).map(item=>item.name)).toEqual(['paymentPolicy','shippingPolicy','returnPolicy'])
  })
})

describe('extractPolicyIdFromLabel', () => {
  it('解出括号里的数字政策 ID 并剥掉尾括号', () => {
    expect(extractPolicyIdFromLabel('eBay Managed Payments (257217501013)')).toEqual({policyId:'257217501013',label:'eBay Managed Payments'})
  })
  it('解出 listings 计数但不误认成政策 ID', () => {
    expect(extractPolicyIdFromLabel('云仓包邮 (1851 listings)')).toEqual({label:'云仓包邮',listingCount:1851})
  })
  it('既无 ID 也无计数的名字原样返回', () => {
    expect(extractPolicyIdFromLabel('14天大健云仓退货')).toEqual({label:'14天大健云仓退货'})
  })
  it('千分位计数与多余空白一并规整', () => {
    expect(extractPolicyIdFromLabel('  标准运输  (2,050 listings) ')).toEqual({label:'标准运输',listingCount:2050})
  })
  it('空串与纯空白返回空 label，不抛异常', () => {
    expect(extractPolicyIdFromLabel('')).toEqual({label:''})
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/shared/__tests__/ebayListingForm.test.ts`
Expected: FAIL —— `does not provide an export named 'requiredFormGaps'`。

- [ ] **Step 3: 先补 `EbayFormFieldSchema` 契约**

`src/shared/contracts.ts`，在 `EbayCategorySpecificRequirement`（`:799-805`）定义之后追加（`EbayAspectSchema`/`EbayCategoryFormSchema` 属 P2，本任务不引入）：

```ts
export interface EbayFormFieldSchema {
  key:'quantity'|'condition'|'listingFormat'|'paymentPolicy'|'shippingPolicy'|'returnPolicy'|'itemLocation'|'postalCode'|'handlingTime'|'sku'|'storeCategory'|'salesTax'|'compatibility'
  label:string
  required:boolean
  control:'SELECT'|'TEXT'|'BOOLEAN'
  options:string[]
}
```

- [ ] **Step 4: 实现纯函数**

追加到 `src/shared/ebayListingForm.ts`（import 行补 `EbayCategorySpecificRequirement`、`EbayFormFieldSchema`）：

```ts
export interface EbayFormGap { kind:'ASPECT'|'FIELD'; name:string; label:string }

export interface EbayFormValues {
  quantity?:string
  condition?:string
  listingFormat?:string
  paymentPolicy?:string
  shippingPolicy?:string
  returnPolicy?:string
  itemLocation?:string
  postalCode?:string
  handlingTime?:string
  sku?:string
  storeCategory?:string
  salesTax?:string
  compatibility?:string
}

const field=(key:EbayFormFieldSchema['key'],label:string,control:EbayFormFieldSchema['control'],options:string[]=[]):EbayFormFieldSchema=>({key,label,required:true,control,options})

/** 与类目无关的 eBay 硬必填全集，逐条来自 spec §1.1 截图取证表。 */
export const EBAY_HARD_REQUIRED_FIELDS:EbayFormFieldSchema[]=[
  field('condition','商品状况','SELECT'),
  field('quantity','数量','TEXT'),
  field('listingFormat','刊登格式','SELECT',['FIXED_PRICE','AUCTION']),
  field('paymentPolicy','付款政策','SELECT'),
  field('shippingPolicy','运输政策','SELECT'),
  field('returnPolicy','退货政策','SELECT'),
  field('itemLocation','商品所在地','TEXT'),
  field('postalCode','所在地邮编','TEXT')
]

export function normaliseAspectName(name:string):string {
  return String(name||'')
    .replace(/\s+/g,' ')
    .replace(/\*|required soon|required immediately|required|必填|建议|required per policy/gi,'')
    .replace(/[:：]\s*$/,'')
    .trim()
}

export function requiredFormGaps(aspects:EbayCategorySpecificRequirement[],values:EbayFormValues,hardRequired:EbayFormFieldSchema[]=EBAY_HARD_REQUIRED_FIELDS):EbayFormGap[] {
  const gaps:EbayFormGap[]=[]
  for(const item of hardRequired) {
    if(!item.required)continue
    if(!String(values[item.key]??'').trim())gaps.push({kind:'FIELD',name:item.key,label:item.label})
  }
  const seen=new Set<string>()
  for(const aspect of aspects) {
    if(!aspect.required)continue
    const name=normaliseAspectName(aspect.name)
    if(!name)continue
    const key=name.toLowerCase()
    if(seen.has(key))continue
    seen.add(key)
    if(!String(aspect.value??'').trim())gaps.push({kind:'ASPECT',name:aspect.name,label:name})
  }
  return gaps
}

export function formatFormGaps(gaps:EbayFormGap[]):string {
  return gaps.map(item=>item.label).join('、')
}

/** 编辑器草稿 → 门禁读数：政策选择存放在 policyIds 里，必须摊平成三个政策键才对齐硬必填字段名。 */
export function formValuesFromInput(input:EbayLocalProductUpdateInput):EbayFormValues {
  return {
    quantity:input.quantity,
    condition:input.condition,
    listingFormat:input.listingFormat,
    paymentPolicy:input.policyIds?.payment,
    shippingPolicy:input.policyIds?.shipping,
    returnPolicy:input.policyIds?.return,
    itemLocation:input.itemLocation,
    postalCode:input.postalCode,
    handlingTime:input.handlingTime,
    sku:input.sku
  }
}

export interface EbayPolicyLabel { policyId?:string; label:string; listingCount?:number }

/** eBay 政策下拉的 option 文本自带店铺资产标识：`名称 (数字ID)` 与 `名称 (1851 listings)`。 */
export function extractPolicyIdFromLabel(raw:string):EbayPolicyLabel {
  const text=String(raw||'').replace(/\s+/g,' ').trim()
  const count=text.match(/\((\d[\d,]*)\s*(?:listings?|件)\)\s*$/i)
  const id=text.match(/\((\d{6,})\)\s*$/)?.[1]
  const label=text.replace(/\s*\((?:\d[\d,]*\s*(?:listings?|件)?|\d{6,})\)\s*$/i,'').trim()
  return {
    ...(id?{policyId:id}:{}),
    label,
    ...(count?{listingCount:Number(count[1].replace(/,/g,''))}:{})
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/shared/__tests__/ebayListingForm.test.ts`
Expected: PASS（Task 1 的 5 例 + 本任务 12 例）。

- [ ] **Step 6: 全套校验并提交**

Run: `npm run typecheck && npx vitest run`
Expected: 全绿；Task 2 Step 3 的 `requiredFormGaps` import 此刻开始可解析。

```bash
git add src/shared/contracts.ts src/shared/ebayListingForm.ts src/shared/__tests__/ebayListingForm.test.ts src/renderer/App.tsx
git commit -m "feat(ebay-publish): eBay 硬必填全集常量表、缺口点名与政策标签解析纯函数（P1）"
```

---

## Task 4: `ebay_business_policies` 落库与查询（P1）

**Files:**
- Modify: `src/main/database/AppDatabase.ts`（DDL 区在 `:379-394` 的 `ebay_store_categories` 之后；DAO 区在 `:1740` `saveEbayPublishTask` 之后）
- Create: `src/main/database/__tests__/AppDatabase.businessPolicies.test.ts`
- Modify: `src/shared/contracts.ts`（`EbayBusinessPolicyKind`、`EbayStoreBusinessPolicy`、`EbayScrapedPolicyOption`）

**Interfaces:**
- Produces:
  - `AppDatabase.getEbayBusinessPolicies(storeId:string,kind?:EbayBusinessPolicyKind):EbayStoreBusinessPolicy[]`
  - `AppDatabase.saveEbayBusinessPolicies(storeId:string,rows:EbayScrapedPolicyOption[]):EbayStoreBusinessPolicy[]`
  - `EbayBusinessPolicyKind='PAYMENT'|'SHIPPING'|'RETURN'|'FULFILLMENT'`
  - `EbayStoreBusinessPolicy {id,storeId,kind,policyId,label,listingCount?,isDefault,updatedAt}`
  - `EbayScrapedPolicyOption {kind:EbayBusinessPolicyKind;label:string;policyId?:string;listingCount?:number;selected:boolean}`

- [ ] **Step 1: 写失败测试**

Create `src/main/database/__tests__/AppDatabase.businessPolicies.test.ts`：

```ts
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { AppDatabase as AppDatabaseType } from '../AppDatabase'
import type { EbayScrapedPolicyOption } from '../../../shared/contracts'

/**
 * 回归守卫：eBay 店铺级业务政策（付款/运输/退货）是「零新 API」方案下唯一可复用的发布资产。
 * 语义：政策 ID 从下拉文本括号里解出；无 ID 的行不入库；同类目重复抓取覆盖标签与计数，不产生重复行；
 * 「当前选中」映射为 is_default，供 APP 下一次发布默认选同一政策。
 */

const ctx=vi.hoisted(()=>({dir:''}))

vi.mock('electron',async()=>{
  const os=await import('node:os')
  const nodePath=await import('node:path')
  const fs=await import('node:fs')
  ctx.dir=fs.mkdtempSync(nodePath.join(os.tmpdir(),'appdb-policies-test-'))
  return {app:{getPath:()=>ctx.dir}}
})

const option=(kind:EbayScrapedPolicyOption['kind'],label:string,policyId:string|undefined,selected=false):EbayScrapedPolicyOption=>
  ({...(policyId?{policyId}:{}),kind,label,selected})

describe('AppDatabase · eBay 业务政策库', () => {
  let database:AppDatabaseType
  let storeId=''

  beforeAll(async()=>{
    const {AppDatabase}=await import('../AppDatabase.js')
    database=new AppDatabase()
    storeId=database.createEbayStore('政策验收店','qa@example.test','enc','EBAY_US').id
  })

  it('首抓落库三类政策，is_default 跟随 selected，无 policyId 的行被丢弃', () => {
    const rows=database.saveEbayBusinessPolicies(storeId,[
      option('PAYMENT','eBay Managed Payments','257217501013',true),
      option('PAYMENT','没有 ID 的旧样式',undefined),
      option('SHIPPING','云仓包邮','18510002003'),
      option('SHIPPING','标准运输','18510002004',true),
      option('RETURN','14天大健云仓退货','19007008009',true)
    ])
    expect(rows).toHaveLength(4)
    expect(database.getEbayBusinessPolicies(storeId).map(item=>item.label)).toEqual(
      ['eBay Managed Payments','14天大健云仓退货','云仓包邮','标准运输']
    )
    expect(database.getEbayBusinessPolicies(storeId,'SHIPPING').map(item=>item.policyId)).toEqual(['18510002004','18510002003'])
    expect(database.getEbayBusinessPolicies(storeId,'PAYMENT').find(item=>item.policyId==='257217501013')?.isDefault).toBe(true)
  })

  it('二抓同 ID 改名 → 覆盖不增行；某类政策整体消失 → 该类旧行清空', () => {
    database.saveEbayBusinessPolicies(storeId,[option('SHIPPING','云仓包邮（改）','18510002003',true)])
    const shipping=database.getEbayBusinessPolicies(storeId,'SHIPPING')
    expect(shipping.map(item=>item.label)).toEqual(['云仓包邮（改）'])
    expect(shipping[0].isDefault).toBe(true)
    expect(database.getEbayBusinessPolicies(storeId,'PAYMENT')).toHaveLength(1)
  })

  it('listingCount 从文本计数写入并可原样读回', () => {
    database.saveEbayBusinessPolicies(storeId,[{kind:'RETURN',label:'30天退货',policyId:'19007008010',listingCount:2050,selected:true}])
    expect(database.getEbayBusinessPolicies(storeId,'RETURN').find(item=>item.policyId==='19007008010')?.listingCount).toBe(2050)
  })

  it('店铺之间互不可见', () => {
    const other=database.createEbayStore('别家店','other@example.test','enc','EBAY_US').id
    expect(database.getEbayBusinessPolicies(other)).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/database/__tests__/AppDatabase.businessPolicies.test.ts`
Expected: FAIL —— `database.saveEbayBusinessPolicies is not a function`。

- [ ] **Step 3: 补契约**

`src/shared/contracts.ts`，在 `EbayLocalListingRequirements`（`:250-255`）之前插入：

```ts
export type EbayBusinessPolicyKind='PAYMENT'|'SHIPPING'|'RETURN'|'FULFILLMENT'

export interface EbayStoreBusinessPolicy {
  id:string
  storeId:string
  kind:EbayBusinessPolicyKind
  policyId:string
  label:string
  listingCount?:number
  isDefault:boolean
  updatedAt:string
}

export interface EbayScrapedPolicyOption {
  kind:EbayBusinessPolicyKind
  label:string
  policyId?:string
  listingCount?:number
  selected:boolean
}
```

同文件 `EbayLocalListingRequirements` 内 `warnings:string[]` 之后补一行（本任务先只加类型，Task 5 才填值）：

```ts
  policies:EbayScrapedPolicyOption[]
```

- [ ] **Step 4: 建表**

`src/main/database/AppDatabase.ts`，在 `ebay_store_categories` 的 `CREATE INDEX ... idx_ebay_store_categories_tree`（`:394`）之后插入：

```ts
      CREATE TABLE IF NOT EXISTS ebay_business_policies (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        policy_id TEXT NOT NULL,
        label TEXT NOT NULL,
        listing_count INTEGER,
        is_default INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        UNIQUE(store_id, kind, policy_id),
        FOREIGN KEY (store_id) REFERENCES ebay_stores(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ebay_business_policies_store ON ebay_business_policies(store_id, kind, is_default DESC, label);
```

- [ ] **Step 5: 写 DAO**

`src/main/database/AppDatabase.ts`，在 `saveEbayPublishTask`（`:1743` 的 `}`）之后插入：

```ts
  getEbayBusinessPolicies(storeId:string,kind?:EbayBusinessPolicyKind):EbayStoreBusinessPolicy[] {
    const rows=(kind
      ?this.database.prepare(`SELECT * FROM ebay_business_policies WHERE store_id=? AND kind=? ORDER BY is_default DESC, label`).all(storeId,kind)
      :this.database.prepare(`SELECT * FROM ebay_business_policies WHERE store_id=? ORDER BY kind, is_default DESC, label`).all(storeId)) as unknown as Array<{
        id:string;store_id:string;kind:EbayBusinessPolicyKind;policy_id:string;label:string;listing_count:number|null;is_default:number;updated_at:string
      }>
    return rows.map(row=>({
      id:row.id,
      storeId:row.store_id,
      kind:row.kind,
      policyId:row.policy_id,
      label:row.label,
      ...(row.listing_count===null?{}:{listingCount:row.listing_count}),
      isDefault:Boolean(row.is_default),
      updatedAt:row.updated_at
    }))
  }

  saveEbayBusinessPolicies(storeId:string,rows:EbayScrapedPolicyOption[]):EbayStoreBusinessPolicy[] {
    const now=new Date().toISOString()
    const kinds=[...new Set(rows.map(row=>row.kind))]
    for(const kind of kinds)this.database.prepare(`DELETE FROM ebay_business_policies WHERE store_id=? AND kind=?`).run(storeId,kind)
    const statement=this.database.prepare(`INSERT INTO ebay_business_policies (id,store_id,kind,policy_id,label,listing_count,is_default,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(store_id,kind,policy_id) DO UPDATE SET label=excluded.label,listing_count=excluded.listing_count,is_default=excluded.is_default,updated_at=excluded.updated_at`)
    const saved:EbayStoreBusinessPolicy[]=[]
    for(const row of rows) {
      const policyId=String(row.policyId||'').trim()
      if(!/^\d{6,}$/.test(policyId))continue
      const id=`${storeId}:${row.kind}:${policyId}`
      statement.run(id,storeId,row.kind,policyId,row.label.trim(),row.listingCount===undefined?null:row.listingCount,row.selected?1:0,now)
      saved.push({id,storeId,kind:row.kind,policyId,label:row.label.trim(),...(row.listingCount===undefined?{}:{listingCount:row.listingCount}),isDefault:row.selected,updatedAt:now})
    }
    return saved
  }
```

`AppDatabase.ts` 顶部 contracts import 补 `EbayBusinessPolicyKind`、`EbayScrapedPolicyOption`、`EbayStoreBusinessPolicy`。

「本次提交覆盖的 kind 先整类清空、再重灌」是有意语义：某类政策在 eBay 侧被删光时，APP 不留幽灵行；未被本次提交触及的 kind（例如这次只抓了 SHIPPING）保持不动 —— 这正是第 2 个用例断言 `PAYMENT` 仍有 1 行的原因。

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run src/main/database/__tests__/AppDatabase.businessPolicies.test.ts`
Expected: PASS（4 例）。

- [ ] **Step 7: 全套校验并提交**

Run: `npm run typecheck && npx vitest run`
Expected: 全绿。

```bash
git add src/shared/contracts.ts src/main/database/AppDatabase.ts src/main/database/__tests__/AppDatabase.businessPolicies.test.ts
git commit -m "feat(ebay-publish): 新增 ebay_business_policies 表与按类整体覆盖的政策 DAO（P1）"
```

---

## Task 5: 从 ReviseItem 页抓政策并入库（P1）

**Files:**
- Modify: `src/main/browser/BrowserWorkspace.ts:1788-1804`（`inspectEbayListingRequirements` 的脚本与返回）
- Modify: `src/main/main.ts:3417-3420`（`ebay:local-products:requirements` handler）
- Modify: `src/main/main.ts`（新增 `ebay:business-policies:list` handler）
- Modify: `src/preload/preload.ts:460` 附近、`src/renderer/global.d.ts:399` 附近

**Interfaces:**
- Consumes: `extractPolicyIdFromLabel`（T3）、`AppDatabase.saveEbayBusinessPolicies`/`getEbayBusinessPolicies`（T4）
- Produces: `EbayLocalListingRequirements.policies`（已含 label/policyId/listingCount/selected）；`window.desktop.ebay.businessPolicies(storeId,kind?)`

- [ ] **Step 1: 页面脚本只回原始文本，解析留在 TS**

`src/main/browser/BrowserWorkspace.ts`，`inspectEbayListingRequirements` 脚本内、`const titleField=...` 之前插入：

```js
      const policyGroups=[{kind:'PAYMENT',patterns:[/payment policy|付款政策|支付政策/i]},{kind:'SHIPPING',patterns:[/shipping policy|delivery policy|运输政策|物流政策/i]},{kind:'RETURN',patterns:[/return policy|退货政策/i]},{kind:'FULFILLMENT',patterns:[/fulfillment policy|handling policy|发货政策/i]}];
      const policyOptions=[];
      for(const group of policyGroups){
        const select=fields.find(field=>field.tagName==='SELECT'&&group.patterns.some(pattern=>pattern.test(labelFor(field)+' '+(field.name||'')+' '+(field.id||''))));
        if(!select)continue;
        for(const option of [...select.options]){const raw=clean(option.textContent);if(raw)policyOptions.push({kind:group.kind,raw,selected:option.selected})}
      }
      return {url:location.href,login,verification,ready:Boolean(titleField),categorySpecifics,policyOptions};
```

（同时删掉原 `return {url:location.href,login,verification,ready:Boolean(titleField),categorySpecifics};` 那一行，避免双 return。）

`BrowserWorkspace.ts` 顶部 contracts import 补 `EbayScrapedPolicyOption`；shared import 区补：

```ts
import { extractPolicyIdFromLabel } from '../../shared/ebayListingForm'
```

`let result:{...}` 类型与初值（`:1801`）加上 `policyOptions:Array<{kind:string;raw:string;selected:boolean}>` 与 `policyOptions:[]`。

方法返回（`:1804`）替换为：

```ts
    const policies:result.policyOptions.map(item=>{
      const parsed=extractPolicyIdFromLabel(item.raw)
      return {kind:item.kind as EbayScrapedPolicyOption['kind'],label:parsed.label,...(parsed.policyId?{policyId:parsed.policyId}:{}),...(parsed.listingCount?{listingCount:parsed.listingCount}:{}),selected:item.selected} satisfies EbayScrapedPolicyOption
    })
    return {sourceUrl:result.url,categorySpecifics:result.categorySpecifics,policies,inspectedAt:new Date().toISOString(),warnings:[
      ...(result.categorySpecifics.length?[]:['页面未读取到类目属性；可能是页面结构变化或该类目没有可见属性']),
      ...(policies.length?[]:['页面未读取到付款/运输/退货政策下拉；请在 Seller Hub 修改页确认政策区块已加载后重试'])
    ]}
```

- [ ] **Step 2: IPC 落库 + 列表读取**

`src/main/main.ts`，把 `:3417-3420` 的 requirements handler 换成抓完即入库（返回值原样透传，UI 一律从库里读，不做二次合并）：

```ts
ipcMain.handle('ebay:local-products:requirements', async (_event, storeId:string, listingId:string, title:string) => {
  if(!workspace)throw new Error('应用内浏览器尚未初始化')
  if(!database)throw new Error('数据库尚未初始化')
  const requirements=await workspace.inspectEbayListingRequirements(`ebay:${storeId}`,listingId,title)
  database.saveEbayBusinessPolicies(storeId,requirements.policies)
  return requirements
})
ipcMain.handle('ebay:business-policies:list', (_event, storeId:string, kind?:EbayBusinessPolicyKind) => database?.getEbayBusinessPolicies(storeId,kind)||[])
```

没有 `policyId` 的下拉项进不了库（`saveEbayBusinessPolicies` 用 `/^\d{6,}$/` 过滤），但仍留在 `requirements.policies` 返回值里，UI 若需要可提示「该政策暂不可自动选中」。

main.ts contracts import 补 `EbayBusinessPolicyKind`。

- [ ] **Step 3: preload 与渲染器类型**

`src/preload/preload.ts`，`:460` `localProductRequirements` 之后加：

```ts
    businessPolicies: (storeId:string,kind?:EbayBusinessPolicyKind):Promise<EbayStoreBusinessPolicy[]> => ipcRenderer.invoke('ebay:business-policies:list',storeId,kind),
```

`src/renderer/global.d.ts`，`:399` 之后加：

```ts
        businessPolicies(storeId:string,kind?:EbayBusinessPolicyKind):Promise<EbayStoreBusinessPolicy[]>
```

两处 contracts import 类型清单补 `EbayBusinessPolicyKind`、`EbayStoreBusinessPolicy`（`global.d.ts` 已有 `import type` 块）。

- [ ] **Step 4: 校验**

Run: `npm run typecheck && npx vitest run`
Expected: 全绿。若 typecheck 报 `EbayLocalListingRequirements` 缺 `policies`，说明 Step 1 的返回未替换干净。

- [ ] **Step 5: 提交**

```bash
git add src/main/browser/BrowserWorkspace.ts src/main/main.ts src/preload/preload.ts src/renderer/global.d.ts
git commit -m "feat(ebay-publish): ReviseItem 页一次开页同时抓类目属性与店铺政策并落库（P1）"
```

---

## Task 6: 编辑器 05 状况与库存（P1）

**Files:**
- Modify: `src/renderer/EbayLocalListingEditor.tsx`（Props 类型、`validateDraft`、04 定价区块之后新增 05）
- Modify: `src/renderer/ebay-local-listing-editor.css`
- Create: `src/renderer/__tests__/EbayLocalListingEditor.gaps.test.tsx`

**Interfaces:**
- Consumes: `draft.quantity`/`condition`/`listingFormat`/`sku`/`itemSpecifics`（T1）、`requiredFormGaps`/`formatFormGaps`/`EBAY_HARD_REQUIRED_FIELDS`（T3）
- Produces: Props 新增 `gaps:EbayFormGap[]`；组件导出 `export default`（不变）；DOM 上 `#ebay-revise-form`、`[data-gap="quantity"]` 等锚点

- [ ] **Step 0: 让 vitest 收 `.tsx` 测试**

`vitest.config.ts` 的 `test.include` 数组里，`'src/renderer/**/__tests__/**/*.test.ts'` 之后加一行（本任务的测试写 JSX，`.ts` 装不下）：

```ts
      'src/renderer/**/__tests__/**/*.test.tsx',
```

Run: `npx vitest run`
Expected: 全绿（此时新测试文件还没建，用例数不变），确认 include 改动没破坏既有 104 个测试文件的发现。

- [ ] **Step 1: 写失败测试**

Create `src/renderer/__tests__/EbayLocalListingEditor.gaps.test.tsx`：

```tsx
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps } from 'react'
import EbayLocalListingEditor from '../EbayLocalListingEditor'
import type { EbayLocalProduct, EbayLocalProductUpdateInput } from '../../shared/contracts'
import { formValuesFromInput, requiredFormGaps } from '../../shared/ebayListingForm'

const product={id:'lp1',storeId:'s1',listingId:'T1',title:'Bracket',imageUrl:'',imageUrls:[],price:'9.9',currency:'USD',quantity:12,status:'ACTIVE',versionCount:1,updatedAt:'',categoryId:'',categoryName:'',snapshot:{details:{url:'',itemSpecifics:[{name:'Brand',value:'OEM'}],condition:'New',imageUrls:[],quantity:'12',paymentPolicy:'257217501013',shippingPolicy:'18510002003',returnPolicy:'19007008009',itemLocation:'Guangdong, CN',postalCode:'528000',listingFormat:'FIXED_PRICE',descriptionText:'x'},media:[],sourceListing:{} as never,completeness:100,missingFields:[],contentHash:'',capturedAt:'',id:'snap1',localProductId:'lp1',version:1}} as unknown as EbayLocalProduct

const draftOf=(over:Partial<EbayLocalProductUpdateInput>={}):EbayLocalProductUpdateInput=>({
  title:'Bracket',descriptionText:'desc',descriptionHtml:'',price:'9.9',currency:'USD',
  media:[{id:'m1',mediaType:'IMAGE',sortOrder:0,remoteUrl:'https://img/a.jpg',localPath:'/tmp/a.jpg',mimeType:'image/jpeg',width:1200,height:1200,fileSize:1,sha256:'',downloadStatus:'DOWNLOADED'}],
  quantity:'12',condition:'New',listingFormat:'FIXED_PRICE',sku:'',itemLocation:'Guangdong, CN',postalCode:'528000',itemSpecifics:[{name:'Brand',value:'OEM'}],
  ...over
})

const noop=vi.fn()
const props=(draft:EbayLocalProductUpdateInput,over:Partial<ComponentProps<typeof EbayLocalListingEditor>>={}):ComponentProps<typeof EbayLocalListingEditor>=>({
  inline:true,product,draft,saving:false,uploading:false,preparing:false,readingPolicies:false,businessPolicies:[],categories:[],
  onChange:noop,onSave:noop,onClose:noop,onUpload:noop,onPrepare:noop,onSetCategory:noop,onAutoClassify:noop,onReadPolicies:noop,
  gaps:requiredFormGaps([],formValuesFromInput(draft)),...over
})

describe('EbayLocalListingEditor · 05 状况与库存', () => {
  it('渲染 05 区块的四个字段并回填草稿值', () => {
    const html=renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf())}/>)
    expect(html).toContain('05 状况与库存')
    expect(html).toContain('value="12"')
    expect(html).toContain('eBay 商品状况')
    expect(html).toContain('value="FIXED_PRICE"')
  })

  it('数量非正整数时报必须修改', () => {
    const html=renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf({quantity:'0'}))}/>)
    expect(html).toContain('数量必须是大于 0 的整数')
  })

  it('属性来源徽标显示中文来源与「待确认」', () => {
    const draft=draftOf({itemSpecifics:[{name:'Brand',value:'OEM',source:'AI',confidence:'MEDIUM',needsConfirmation:true}]})
    const html=renderToStaticMarkup(<EbayLocalListingEditor {...props(draft)}/>)
    expect(html).toContain('AI 推断')
    expect(html).toContain('待确认')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/renderer/__tests__/EbayLocalListingEditor.gaps.test.tsx`
Expected: FAIL —— 断言找不到 `05 状况与库存`（当前组件只有 01-04）。

- [ ] **Step 3: Props 与校验扩展**

`src/renderer/EbayLocalListingEditor.tsx`：contracts import 补 `EbayItemSpecific`、`EbayStoreBusinessPolicy`，并新增

```ts
import { formatFormGaps, type EbayFormGap } from '../shared/ebayListingForm'
```

`type Props`（`:8-24`）内 `inline?:boolean` 之前加：

```ts
  gaps:EbayFormGap[]
  businessPolicies:EbayStoreBusinessPolicy[]
  readingPolicies:boolean
  onReadPolicies:()=>void
```

同文件 `:145` 的组件解构（`export default function EbayLocalListingEditor({product,draft,...,platformCategory,inline}:Props)`）里补上 `gaps`、`businessPolicies`、`readingPolicies`、`onReadPolicies` 四个名字 —— 本任务只用到 `gaps`，另三个在 Task 7 使用（tsconfig 未开 `noUnusedLocals`，先解构不会报错）。

`validateDraft`（`:28-45`）在 `pricing` 两条断言之后加：

```ts
  const quantity=draft.quantity===undefined?'':draft.quantity.trim()
  if(quantity&&!/^[1-9]\d{0,5}$/.test(quantity))error('form','数量必须是大于 0 的整数')
  if(draft.listingFormat&&!['FIXED_PRICE','AUCTION'].includes(draft.listingFormat))error('form','刊登格式只能是「现在购买」或「拍卖」')
  if((draft.sku||'').trim().length>50)error('form','自定义编号（SKU）不能超过 50 个字符')
  if((draft.postalCode||'').trim()&&!/^[A-Za-z0-9][A-Za-z0-9 -]{2,11}$/.test(draft.postalCode!.trim()))error('form','所在地邮编格式不正确')
```

- [ ] **Step 4: 05 区块 JSX**

`src/renderer/EbayLocalListingEditor.tsx`，在 `04 定价` 的 `</section>`（`:238` 附近，`ebay-revise-pricing-section` 区块结束）之后插入。`gaps` 命中的字段加 `data-gap` 与红标，但**不禁用输入、不禁用保存**（Global Constraints）：

```tsx
        <section id="ebay-revise-form" className="ebay-revise-section">
          <header><div><h2>05 状况与库存</h2><p>eBay 发布硬必填。留空的字段在准备 Seller Hub 时不写入，页面沿用线上原值。</p></div></header>
          <div className="ebay-revise-form-grid">
            <label className="ebay-revise-field"><span>刊登格式</span><select value={draft.listingFormat||'FIXED_PRICE'} onChange={event=>set('listingFormat',event.target.value as 'FIXED_PRICE'|'AUCTION')}><option value="FIXED_PRICE">现在购买</option><option value="AUCTION">拍卖</option></select></label>
            <label className="ebay-revise-field"><span>数量</span><input data-gap={gaps.some(item=>item.name==='quantity')?'quantity':undefined} inputMode="numeric" value={draft.quantity??''} onChange={event=>set('quantity',event.target.value.replace(/[^\d]/g,''))}/></label>
            <label className="ebay-revise-field"><span>eBay 商品状况</span><input data-gap={gaps.some(item=>item.name==='condition')?'condition':undefined} placeholder="New" value={draft.condition??''} onChange={event=>set('condition',event.target.value)}/></label>
            <label className="ebay-revise-field"><span>自定义编号（SKU）</span><input maxLength={50} value={draft.sku??''} onChange={event=>set('sku',event.target.value)}/></label>
          </div>
          {(draft.itemSpecifics?.length||0)>0&&<div className="ebay-revise-specifics">
            <b>类目属性 {draft.itemSpecifics!.length} 项</b>
            {draft.itemSpecifics!.map((item,index)=><div className="ebay-revise-specific-row" key={`${item.name}-${index}`}>
              <span title={item.name}>{item.name}</span>
              <input value={item.value} onChange={event=>{const next=[...(draft.itemSpecifics||[])];next[index]={...next[index],value:event.target.value,source:'MANUAL',needsConfirmation:false};set('itemSpecifics',next)}}/>
              <em>{item.source?SOURCE_LABELS[item.source]:'—'}{item.needsConfirmation?' · 待确认':''}</em>
            </div>)}
          </div>}
        </section>
```

组件体顶部（`:124` 的 `set` 定义之后）加来源徽标映射：

```ts
  const SOURCE_LABELS:Record<NonNullable<EbayItemSpecific['source']>,string>={SOURCE_PAGE:'源页抓取',ENUM_MATCH:'枚举匹配',AI:'AI 推断',MANUAL:'人工确认',CATEGORY_DEFAULT:'类目记忆'}
```

（`EbayItemSpecific` 需加入 contracts 的 `import type` 清单。）

- [ ] **Step 5: 样式**

`src/renderer/ebay-local-listing-editor.css` 末尾追加：

```css
.ebay-revise-form-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.ebay-revise-form-grid .ebay-revise-field>input,.ebay-revise-form-grid .ebay-revise-field>select{width:100%}
.ebay-revise-field [data-gap]{border-color:var(--ebay-revise-danger,#c14b3a);box-shadow:0 0 0 2px rgba(193,75,58,.14)}
.ebay-revise-specifics{margin-top:14px;display:grid;gap:8px}
.ebay-revise-specific-row{display:grid;grid-template-columns:minmax(120px,1fr) minmax(0,2fr) 132px;align-items:center;gap:10px}
.ebay-revise-specific-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ebay-revise-specific-row em{font-style:normal;opacity:.72;font-size:12px}
@media (max-width:1180px){.ebay-revise-form-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run src/renderer/__tests__/EbayLocalListingEditor.gaps.test.tsx`
Expected: PASS（3 例）。

- [ ] **Step 7: 全套校验并提交**

Run: `npm run typecheck && npx vitest run`
Expected: 全绿。typecheck 会列出所有未传新 Props 的调用点——本任务先在 `App.tsx:4813`/`:4865` 两处临时补 `gaps={[]} businessPolicies={[]} readingPolicies={false} onReadPolicies={()=>{}}`，Task 7 Step 4 换成真值。

```bash
git add src/renderer/EbayLocalListingEditor.tsx src/renderer/ebay-local-listing-editor.css src/renderer/__tests__/EbayLocalListingEditor.gaps.test.tsx src/renderer/App.tsx
git commit -m "feat(ebay-publish): 线上发布页新增 05 状况与库存（格式/数量/状况/SKU）与类目属性只读改值区（P1）"
```

---

## Task 7: 编辑器 07 政策与所在地 + 就绪度读数（P1）

**Files:**
- Modify: `src/renderer/EbayLocalListingEditor.tsx`（07 区块、页脚文案、就绪度条）
- Modify: `src/renderer/App.tsx`（`businessPolicies` 状态与 `onReadPolicies` 接线）
- Modify: `src/renderer/__tests__/EbayLocalListingEditor.gaps.test.tsx`

**Interfaces:**
- Consumes: `window.desktop.ebay.businessPolicies`/`localProductRequirements`（T5）、`draft.policyIds`（T1）
- Produces: DOM 锚点 `#ebay-revise-policies`、`[data-policy-kind="shipping"]`、`.ebay-revise-readiness`

- [ ] **Step 1: 写失败测试（追加 describe 块）**

```tsx
import type { EbayStoreBusinessPolicy } from '../../shared/contracts'

const policies:EbayStoreBusinessPolicy[]=[
  {id:'s1:PAYMENT:257217501013',storeId:'s1',kind:'PAYMENT',policyId:'257217501013',label:'eBay Managed Payments',isDefault:true,updatedAt:''},
  {id:'s1:SHIPPING:18510002003',storeId:'s1',kind:'SHIPPING',policyId:'18510002003',label:'云仓包邮',listingCount:1851,isDefault:true,updatedAt:''},
  {id:'s1:SHIPPING:18510002004',storeId:'s1',kind:'SHIPPING',policyId:'18510002004',label:'标准运输',isDefault:false,updatedAt:''},
  {id:'s1:RETURN:19007008009',storeId:'s1',kind:'RETURN',policyId:'19007008009',label:'14天大健云仓退货',isDefault:true,updatedAt:''}
]

describe('EbayLocalListingEditor · 07 政策与所在地', () => {
  it('已有政策时按 kind 分组渲染下拉并选中草稿值', () => {
    const html=renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf({policyIds:{shipping:'18510002004'}}),{businessPolicies:policies})}/>)
    expect(html).toContain('07 政策与所在地')
    expect(html).toContain('data-policy-kind="shipping"')
    expect(html).toContain('<option value="18510002004" selected>')
    expect(html).toContain('云仓包邮')
  })

  it('无政策时给出「从 Seller Hub 读取政策」入口而不是空白', () => {
    const html=renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf(),{businessPolicies:[]})}/>)
    expect(html).toContain('从 Seller Hub 读取政策')
  })

  it('就绪度条点名缺口，并声明这些字段页面沿用线上原值', () => {
    const draft=draftOf({condition:'',postalCode:'',policyIds:{payment:'257217501013',shipping:'18510002003',return:'19007008009'}})
    const html=renderToStaticMarkup(<EbayLocalListingEditor {...props(draft,{gaps:requiredFormGaps([],formValuesFromInput(draft))})}/>)
    expect(html).toContain('eBay 必填待补齐 2 项')
    expect(html).toContain('商品状况')
    expect(html).toContain('沿用 eBay 线上原值')
    expect(html).not.toContain('四项核心资料已通过')
  })

  it('所在地与邮编可编辑并回填', () => {
    const html=renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf({itemLocation:'Yunnan, CN',postalCode:'650000'}))}/>)
    expect(html).toContain('value="Yunnan, CN"')
    expect(html).toContain('value="650000"')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/renderer/__tests__/EbayLocalListingEditor.gaps.test.tsx`
Expected: FAIL —— `07 政策与所在地` 不存在。

- [ ] **Step 3: 07 区块 JSX**

`src/renderer/EbayLocalListingEditor.tsx`，Task 6 的 05 区块之后插入：

```tsx
        <section id="ebay-revise-policies" className="ebay-revise-section">
          <header><div><h2>07 政策与所在地</h2><p>店铺级可复用资产：从 Seller Hub 读一次即入库，之后同类发布直接选用。政策按 eBay 政策 ID 命中，不按名称猜。</p></div><button type="button" disabled={readingPolicies} onClick={onReadPolicies}>{readingPolicies?'正在读取…':'从 Seller Hub 读取政策'}</button></header>
          {businessPolicies.length===0?<p className="ebay-revise-category-error">尚未读取到店铺政策。点上方按钮开一次修改页即可抓取；读取前这些字段保留 eBay 线上原值。</p>:<div className="ebay-revise-form-grid">
            {([['payment','付款政策'],['shipping','运输政策'],['return','退货政策']] as const).map(([kind,label])=>{
              const options=businessPolicies.filter(item=>item.kind===kind.toUpperCase() as typeof businessPolicies[number]['kind'])
              const gapName=`${kind}Policy`
              return <label className="ebay-revise-field" key={kind}><span>{label}</span><select data-policy-kind={kind} data-gap={gaps.some(item=>item.name===gapName)?gapName:undefined} value={draft.policyIds?.[kind]||''} onChange={event=>set('policyIds',{...(draft.policyIds||{}),[kind]:event.target.value})}>
                <option value="">未选择（沿用线上原值）</option>
                {options.map(item=><option key={item.policyId} value={item.policyId}>{item.label}{item.listingCount?` · ${item.listingCount} 条`:''}</option>)}
              </select></label>
            })}
            <label className="ebay-revise-field"><span>发货处理天数</span><input inputMode="numeric" value={draft.handlingTime??''} onChange={event=>set('handlingTime',event.target.value.replace(/[^\d]/g,''))}/></label>
            <label className="ebay-revise-field"><span>商品所在地</span><input data-gap={gaps.some(item=>item.name==='itemLocation')?'itemLocation':undefined} placeholder="Guangdong, CN" value={draft.itemLocation??''} onChange={event=>set('itemLocation',event.target.value)}/></label>
            <label className="ebay-revise-field"><span>所在地邮编</span><input data-gap={gaps.some(item=>item.name==='postalCode')?'postalCode':undefined} value={draft.postalCode??''} onChange={event=>set('postalCode',event.target.value)}/></label>
          </div>}
        </section>
```

`kind.toUpperCase()` 的类型收窄不够精确，实现时写成：

```ts
              const options=businessPolicies.filter(item=>item.kind===KIND_BY_PREFIX[kind])
```

并在组件体顶部定义：

```ts
  const KIND_BY_PREFIX:Record<'payment'|'shipping'|'return','PAYMENT'|'SHIPPING'|'RETURN'>={payment:'PAYMENT',shipping:'SHIPPING',return:'RETURN'}
```

- [ ] **Step 4: 就绪度读数与页脚文案**

`validateDraft` 的返回值之外，在组件 `return` 前的 `issues/errors/warnings` 定义旁加：

```ts
  const gapLabels=formatFormGaps(gaps)
```

`ebay-revise-validation` 区块（`:180` 附近）的 `<strong>` 文案改为三态，`gaps.length` 存在时绝不再说「已通过」：

```tsx
          <div><strong>{errors.length?`${errors.length} 项必须修改`:gaps.length?`eBay 必填待补齐 ${gaps.length} 项`:'四项核心资料已通过'}</strong><span>{gaps.length?`${gapLabels} 未在 APP 记录；准备到 Seller Hub 时这些字段沿用 eBay 线上原值，请人工核对。`:`${warnings.length} 项建议优化 · 图片、标题、描述、价格与状况政策齐备`}</span></div>
```

页脚（`:242`）左侧 `<span>` 的文案由「仅保存四项核心内容；类目、库存、SKU、属性和政策不写入新版本」改为：

```tsx
<span>{errors.length?`还有 ${errors.length} 项必须修改后才能保存`:'保存标题、描述、价格、状况、数量、SKU、类目属性与政策所在地；库存与业务政策仍只在 eBay 页面生效'}</span>
```

- [ ] **Step 5: App.tsx 接线**

`src/renderer/App.tsx`：状态区（`:3391` 附近）加

```ts
  const [publishEditorPolicies,setPublishEditorPolicies]=useState<EbayStoreBusinessPolicy[]>([])
```

在 `preparePublishEditorInSellerHub` 之后加读取函数，并把 Task 6 临时补的 `businessPolicies={[]} readingPolicies={false} onReadPolicies={()=>{}}` 与 `gaps={[]}` 换成真值：

```ts
  const readPublishEditorPolicies=async()=>{
    if(!publishEditorProduct||!activeStore)return
    setBusy('publish-read-policies');setEbayError('')
    try {
      await window.desktop.ebay.localProductRequirements(activeStore.id,publishEditorProduct.listingId,publishEditorProduct.title)
      setPublishEditorPolicies(await window.desktop.ebay.businessPolicies(activeStore.id))
      setNotice('店铺政策已抓取入库；付款/运输/退货政策可直接下拉选择，之后同类发布复用。')
    } catch (reason) {
      setEbayError(readableError(reason,'读取店铺政策失败；请确认 eBay 已登录且该商品仍在线'))
    } finally {
      setBusy('')
    }
  }
```

`:4813` 内嵌编辑器 props 补 `gaps={publishEditorDraft?requiredFormGaps([],formValuesFromInput(publishEditorDraft)):[]}`、`businessPolicies={publishEditorPolicies}`、`readingPolicies={busy==='publish-read-policies'}`、`onReadPolicies={()=>{void readPublishEditorPolicies()}}`。App.tsx 顶部 shared import 行改为 `import { formatFormGaps, formValuesFromInput, requiredFormGaps } from '../shared/ebayListingForm'`（与 T2 Step 3 的那行合并成一条）。

> 注：P1 阶段还没有类目必填标记，`requiredFormGaps` 的第一个参数一律传 `[]`，属性缺口由 `draftPublishIssues` 的 `needsConfirmation` 点名单独承载（Task 9 Step 1）；P2 落 `ebay_category_form_schemas` 后此处换成 schema 的必填属性集合。

`:4865` 浮层编辑器同样补四个 props（`gaps={localEditorDraft?requiredFormGaps([],formValuesFromInput(localEditorDraft)):[]}`，政策读取按钮复用 `localEditorProduct` 与同一段读取逻辑）。

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run src/renderer/__tests__/EbayLocalListingEditor.gaps.test.tsx`
Expected: PASS（Task 6 的 3 例 + 本任务 4 例）。

- [ ] **Step 7: 全套校验并提交**

Run: `npm run typecheck && npx vitest run`

```bash
git add src/renderer/EbayLocalListingEditor.tsx src/renderer/App.tsx src/renderer/__tests__/EbayLocalListingEditor.gaps.test.tsx
git commit -m "feat(ebay-publish): 07 政策与所在地区块、政策按 ID 选择与发布就绪度点名（P1）"
```

---

## Task 8: 灌字段引擎扩到硬必填全集（P1）

**Files:**
- Modify: `src/main/browser/BrowserWorkspace.ts:1807-1850`（`prepareEbayLocalProductRevision`）
- Create: `src/main/browser/ebayLocalFill.ts`（目标表与 payload 构造，纯 TS，可离线单测）
- Create: `src/main/browser/__tests__/ebayLocalFill.test.ts`

**Interfaces:**
- Consumes: `product.snapshot.details` 的 `quantity`/`condition`/`paymentPolicy`/`shippingPolicy`/`returnPolicy`/`itemLocation`/`postalCode`/`sku`（T1）
- Produces: `EbayLocalRevisionPreparationResult.filledFields`/`skippedFields` 现在可能包含「数量 / 商品状况 / 付款政策 / 运输政策 / 退货政策 / 商品所在地 / 所在地邮编 / 自定义编号」

- [ ] **Step 1: 写失败测试**

Create `src/main/browser/__tests__/ebayLocalFill.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { EBAY_LOCAL_FILL_TARGETS, ebayLocalFillPayload } from '../ebayLocalFill'

const details={title:'Bracket',descriptionHtml:'<p>x</p>',descriptionText:'x',price:'9.9',quantity:'12',condition:'New',paymentPolicy:'257217501013',shippingPolicy:'18510002003',returnPolicy:'19007008009',itemLocation:'Guangdong, CN',postalCode:'528000',sku:'PK-01'}

describe('eBay 本地版本灌字段目标表', () => {
  it('目标表覆盖 11 个字段，标题/价格/描述仍在最前且现有 label 文案不变', () => {
    expect(EBAY_LOCAL_FILL_TARGETS.map(item=>item.label)).toEqual(['标题','价格','描述','数量','商品状况','付款政策','运输政策','退货政策','商品所在地','所在地邮编','自定义编号'])
  })

  it('政策三项按 policyId 命中，其它走文本匹配', () => {
    expect(EBAY_LOCAL_FILL_TARGETS.filter(item=>item.byPolicyId).map(item=>item.label)).toEqual(['付款政策','运输政策','退货政策'])
  })

  it('payload 只带非空值，空字段不进目标表以便计入 skipped 判定', () => {
    const payload=ebayLocalFillPayload({...details,condition:'',postalCode:'  '})
    expect(payload.condition).toBeUndefined()
    expect(payload.postalCode).toBeUndefined()
    expect(payload.quantity).toBe('12')
    expect(payload.shippingPolicy).toBe('18510002003')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/browser/__tests__/ebayLocalFill.test.ts`
Expected: FAIL —— 模块 `../ebayLocalFill` 不存在。

- [ ] **Step 3: 把目标表与 payload 抽成可测模块**

Create `src/main/browser/ebayLocalFill.ts`：

```ts
import type { EbayProductDetails } from '../../shared/contracts'

export interface EbayLocalFillTarget {
  label:string
  key:'title'|'price'|'description'|'quantity'|'condition'|'paymentPolicy'|'shippingPolicy'|'returnPolicy'|'itemLocation'|'postalCode'|'sku'
  byPolicyId?:boolean
  patterns:RegExp[]
  selectors?:string
}

export const EBAY_LOCAL_FILL_TARGETS:EbayLocalFillTarget[]=[
  {label:'标题',key:'title',patterns:[/^(item |listing )?title\b/i,/物品标题|商品标题|刊登标题/],selectors:'input[name="title"],input[id="title"]'},
  {label:'价格',key:'price',patterns:[/^price\b|buy it now price|starting price/i,/价格|一口价|起拍价/]},
  {label:'描述',key:'description',patterns:[/description|详情|描述/i]},
  {label:'数量',key:'quantity',patterns:[/^quantity\b|available quantity|quantity available|sold quantity/i,/数量/]},
  {label:'商品状况',key:'condition',patterns:[/item condition|^condition\b/i,/商品状况|物品状况/]},
  {label:'付款政策',key:'paymentPolicy',byPolicyId:true,patterns:[/payment policy/i,/付款政策|支付政策/]},
  {label:'运输政策',key:'shippingPolicy',byPolicyId:true,patterns:[/shipping policy|delivery policy/i,/运输政策|物流政策/]},
  {label:'退货政策',key:'returnPolicy',byPolicyId:true,patterns:[/return policy/i,/退货政策/]},
  {label:'商品所在地',key:'itemLocation',patterns:[/item location|located in|ships from/i,/商品所在地|所在地/]},
  {label:'所在地邮编',key:'postalCode',patterns:[/\bzip\b|postal code|postcode/i,/邮编/]},
  {label:'自定义编号',key:'sku',patterns:[/custom label|\bsku\b/i,/自定义编号|卖家编号/]}
]

/** 只提交非空字段：空字段不进 payload，页面保留 eBay 线上原值，也不会被计成「写入失败」。 */
export function ebayLocalFillPayload(details:EbayProductDetails):Record<string,string> {
  const source:Record<string,string|undefined>={
    title:details.title,price:details.price,description:details.descriptionHtml||details.descriptionText,
    quantity:details.quantity,condition:details.condition,paymentPolicy:details.paymentPolicy,shippingPolicy:details.shippingPolicy,
    returnPolicy:details.returnPolicy,itemLocation:details.itemLocation,postalCode:details.postalCode,sku:details.sku
  }
  const payload:Record<string,string>={}
  for(const target of EBAY_LOCAL_FILL_TARGETS) {
    const value=String(source[target.key]||'').trim()
    if(value)payload[target.key]=value
  }
  return payload
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/main/browser/__tests__/ebayLocalFill.test.ts`
Expected: PASS（3 例）。

- [ ] **Step 5: 灌值脚本改为描述符驱动**

`src/main/browser/BrowserWorkspace.ts`：import `EBAY_LOCAL_FILL_TARGETS`、`ebayLocalFillPayload`。把 `:1815-1820` 的 `payload` 换成：

```ts
    const payload={...ebayLocalFillPayload(details),localImageCount:snapshot.media.filter(item=>item.downloadStatus==='DOWNLOADED'&&item.localPath).length}
    const targets=EBAY_LOCAL_FILL_TARGETS.map(target=>({...target,patterns:target.patterns.map(pattern=>pattern.source)}))
```

脚本内 `const desired=${JSON.stringify(payload)};` 之后加一行目标表注入：

```js
      const targets=${JSON.stringify(targets)};
```

把 `:1836-1839` 的四行手写 `fill(...)`（**保留 `:1835` 的 `const titleField=find(...)` 不动**：脚本末尾 `ready:Boolean(titleField)` 与主进程 `if(!result.ready)` 都依赖它）替换为循环：

```js
      const selectByPolicyId=(field,policyId)=>{if(!field||field.tagName!=='SELECT')return false;const want=clean(String(policyId||''));if(!/^\d+$/.test(want))return false;const option=[...field.options].find(item=>clean(item.value)===want||clean(item.textContent).includes('('+want+')'));if(!option)return false;field.value=option.value;field.dispatchEvent(new Event('change',{bubbles:true}));field.dispatchEvent(new Event('blur',{bubbles:true}));return true};
      for(const target of targets){
        if(desired[target.key]===undefined)continue;
        if(target.key==='description'){
          const field=allFields.find(node=>node.tagName==='TEXTAREA'&&/description|详情|描述/i.test(labelFor(node)))||fields.find(node=>node.isContentEditable&&/description|详情|描述/i.test(labelFor(node)));
          fill('描述',field,desired.description);
          continue;
        }
        const field=find(target.patterns.map(source=>new RegExp(source,'i')),target.selectors);
        if(target.byPolicyId){if(selectByPolicyId(field,desired[target.key]))filledFields.push(target.label);else skippedFields.push(target.label);continue}
        fill(target.label,field,desired[target.key]);
      }
```

三条语义要点，实现时不要合并：

1. `desired[target.key]===undefined` 先 `continue` —— APP 没记录的字段既不记 `filled` 也不记 `skipped`，页面原值不动，通知里也就不会出现「1 项未能写入」的假失败。
2. 政策三项走 `selectByPolicyId`，命中的是 option 的 `value` 或文本里的 `(政策ID)`，不按名称猜；因此 `filledFields`/`skippedFields` 由它自己判定，不经过 `fill`。
3. `/^\d+$/` 只允许纯数字政策 ID 进匹配，eBay 政策 ID 恒为数字（截图取证：`257217501013`）。

`warnings` 两条（`:1841-1842`）中的第二条改为：

```js
      warnings.push('本次填写标题、描述、价格、数量、商品状况、付款/运输/退货政策、商品所在地、邮编与 SKU；图片、类目与业务政策内容仍需在页面人工核对。');
```

- [ ] **Step 6: 校验**

Run: `npm run typecheck && npx vitest run src/main/browser`
Expected: 全绿；既有 `BrowserWorkspace.navigate.test.ts` 不受影响。

- [ ] **Step 7: 提交**

```bash
git add src/main/browser/ebayLocalFill.ts src/main/browser/BrowserWorkspace.ts src/main/browser/__tests__/ebayLocalFill.test.ts
git commit -m "feat(ebay-publish): Seller Hub 灌字段引擎从 3 项扩到 11 项，政策按 policyId 命中（P1）"
```

---

## Task 9: 门禁去自证 + 部署 + 真机验收（P0+P1 收尾）

**Files:**
- Modify: `src/renderer/App.tsx:4419-4426`（`draftPublishIssues`）、`:4805`（通过文案）

**Interfaces:**
- Consumes: `draft.itemSpecifics`（`needsConfirmation`/`value`）、Task 3 的点名读数
- Produces: 「已通过发布前检查」类绿灯只在真无缺口时出现；待确认属性按名字点出

- [ ] **Step 1: 属性缺口点名**

`src/renderer/App.tsx:4425` 的最后一行

```ts
    draft.itemSpecifics.some(item=>item.needsConfirmation||!item.value.trim())?'属性待确认':''
```

替换为

```ts
    (()=>{const pending=draft.itemSpecifics.filter(item=>item.needsConfirmation||!item.value.trim());return pending.length?`属性待确认：${pending.map(item=>item.name).slice(0,6).join('、')}${pending.length>6?` 等 ${pending.length} 项`:''}`:''})(),
    (()=>{const product=localProducts.find(item=>item.listingId===draft.listing.listingId);if(!product)return '';const gaps=requiredFormGaps([],product.snapshot.details);return gaps.length?`eBay 必填待补齐：${formatFormGaps(gaps)}`:''})()
```

第二行只在该商品**已有本地产品**时计算硬必填缺口（本地产品才存 `condition/quantity/政策/所在地`）；没有本地产品的草稿不报此项，避免把「APP 还没同步」误报成「eBay 缺必填」。App.tsx 的 shared import 行此处需含 `formatFormGaps`（T7 Step 5 已引入）。

- [ ] **Step 2: 绿灯文案收紧**

`src/renderer/App.tsx:4805` 附近的「标题、图片、详情与属性已通过发布前检查」——确认它渲染在 `issues.length===0` 分支内（现在 issues 里已包含「属性待确认：Brand」「eBay 必填待补齐：数量」这类具体名），且同级没有出现无条件展示的「符合 eBay 要求」字样。若该文案在别处硬编码出现，一并挂到同一条件之下。

- [ ] **Step 3: 全套校验**

Run: `npm run typecheck && npx vitest run`
Expected: 全绿，用例数较基线 +23 以上。

- [ ] **Step 4: 部署到热更包并重启**

```bash
npm run hot:sync
bash tools/restart-app.sh
```

Expected: 脚本尾部打印主进程构建时间晚于 `dist` mtime、main window revealed；窗口非白屏。

- [ ] **Step 5: 真机验收 P0（两件商品）**

进入「eBay 工作台 → 线上发布 → 进入发布」（PALLET 那件 `PALLET-4b695b47-…`）。逐条断言：

1. 页面出现 `01 图片与视频 … 05 状况与库存 … 07 政策与所在地`，不再有「类目、库存、SKU、属性和政策不写入新版本」字样。
2. 数量自动带出线上值（非空），状况非空。
3. 点「保存并准备到 eBay」：应用切到「店铺采集」页签并在 eBay 修改页挂出横幅；通知条出现「已在 Seller Hub 填写 N 项：…」且 N ≥ 3。
4. 回「线上发布」重进编辑器：刚保存的属性、状况、数量、所在地、邮编**仍在**（这条即 P0 回归——旧代码会显示空）。

- [ ] **Step 6: 真机验收 P1 政策抓取与灌值**

1. 点 07 区块「从 Seller Hub 读取政策」→ 通知「店铺政策已抓取入库」；付款/运输/退货三个下拉均有选项，且默认项即页面当前选中项。
2. 选一个运输政策 → 保存并准备 → eBay 修改页运输下拉的选中项 = APP 所选政策名（读页面 DOM 或 AX 树断言，不看 APP 自述）。
3. 断言 eBay 页面 URL 停在 `sl/list?mode=ReviseItem`，刊登状态仍是「未提交」，APP 无任何自动点击提交的行为（横幅文案含「尚未提交」）。

- [ ] **Step 7: 真机验收门禁不再自证**

1. 清空「商品状况」→ 顶部读数变成「eBay 必填待补齐 1 项」并点名「商品状况」，**不再出现**「四项核心资料已通过」。
2. 「保存并准备到 eBay」按钮**仍可点**（Global Constraints：拦截 + 指导 = 被判没生效），且通知里点名「APP 尚未记录：商品状况，页面沿用 eBay 线上原值」。
3. 优品仓库里存在 `needsConfirmation` 属性的草稿 → 发布页卡片显示「属性待确认：Brand」这样的具体名字，而不是光秃秃的「属性待确认」。

- [ ] **Step 8: 提交**

```bash
git add src/renderer/App.tsx
git commit -m "feat(ebay-publish): 发布门禁改为点名具体待确认属性与 eBay 硬必填缺口（P1 收尾，去掉自证绿灯）"
```

---

## 覆盖对照（spec §7 的 P0/P1 清单 → 任务）

| spec 条目 | 任务 |
|---|---|
| `onPrepare` 空函数接线 | T2 |
| 保存抹掉 `itemSpecifics/condition` | T1 |
| `EbayItemSpecific` 增可选来源字段 | T1 |
| 05 状况与库存（含解除格式写死） | T6 |
| 07 政策与所在地 | T4 T5 T7 |
| 政策抓取入库 + `extractPolicyIdFromLabel` | T3 T4 T5 |
| 灌字段引擎扩 quantity/condition/policies/location | T8 |
| 门禁按硬必填集合 + 具体缺口点名 | T3 T7 T9 |
| 「已通过发布前检查」去掉假绿灯 | T7 T9 |
| 06 类目属性 / `ebay_category_form_schemas` / 四级填充 | **不在本计划**（P2，前置是 spec §5.1 AddItem 直入可行性实测） |
| 回读三态 `readback` | **不在本计划**（P3） |
| 汽配兼容性 | **不在本计划**（P4） |

## 已知取舍（供审阅者一眼看到）

1. **缺口不硬阻断 prepare**：ReviseItem 页上这些字段有线上原值，APP 缺记录不代表 eBay 缺值；阻断会把可工作的按钮变成「点了没反应」。改为读数点名 + 通知点名 + 去掉绿灯。真正阻断的仍是 `updateEbayLocalProduct` 的 `validationErrors`（价格/图片/描述等 APP 必须持有的项）。
2. **P1 的属性缺口走 `needsConfirmation`，不是类目必填集合**：类目必填要等 P2 的 schema 缓存。因此 T7 Step 5 的 `required:false` 是**有意的临时口径**，P2 计划里第一处要改的就是它。
3. **`handlingTime`、`salesTax` 只入库不自动判定**：条件规则表（spec §3.4 末）属 P2；P1 仅把字段做成可填可灌，避免「销售税区块不存在」时误报缺口。
