import type { EbayCategorySpecificRequirement, EbayFormFieldSchema, EbayLocalProductUpdateInput, EbayProductDetails } from './contracts'

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
    // 政策三项全项目统一存放政策 id 数字串（人类可读名只存在于抓取到的政策表/下拉标签里），页面读取带进来的空格一律不能留下
    paymentPolicy:policies.payment===undefined?previous.paymentPolicy:policies.payment.trim(),
    shippingPolicy:policies.shipping===undefined?previous.shippingPolicy:policies.shipping.trim(),
    returnPolicy:policies.return===undefined?previous.returnPolicy:policies.return.trim(),
    title:changes.title.trim(),
    descriptionText:changes.descriptionText.trim(),
    descriptionHtml:changes.descriptionHtml.trim(),
    price:changes.price.trim(),
    currency:changes.currency.trim(),
    // 图片清单只收 IMAGE 行：VIDEO 行属于 details.videoUrl，后续任务会把它当 eBay 图片清单推送，混入视频会直接报错
    imageUrls:changes.media.filter(item=>item.mediaType==='IMAGE').map(item=>item.remoteUrl).filter(Boolean)
  }
}

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

/** 只剥离作为标签后缀的必填标记：`Required Parts`、`建议零售价` 本身是 eBay 真属性名，削成 `Parts`、`零售价` 会让两条必填属性在缺口计算里撞成同一个键，缺口静默消失即假绿灯。 */
export function normaliseAspectName(name:string):string {
  return String(name||'')
    .replace(/\*|\s+/g,' ')
    .replace(/[:：]\s*$/,'')
    .replace(/\s*[(（【\[]\s*(?:required(?:\s+(?:immediately|soon|per\s+policy))?|必填|建议)\s*[)）】\]]\s*$/i,'')
    .replace(/\s+required(?:\s+(?:immediately|soon|per\s+policy))?\s*$/i,'')
    .replace(/(?:必填|建议)\s*$/,'')
    .replace(/\s+/g,' ')
    .trim()
}

/** eBay 政策 id 恒为纯数字；采集器把整段页面文字塞进快照政策格时，非数字值既会伪装成「已填」也会让灌值引擎按 id 命不中。 */
export function isEbayPolicyId(value?:string):boolean {
  return /^\d+$/.test(String(value||'').trim())
}

export function requiredFormGaps(aspects:EbayCategorySpecificRequirement[],values:EbayFormValues,hardRequired:EbayFormFieldSchema[]=EBAY_HARD_REQUIRED_FIELDS):EbayFormGap[] {
  const gaps:EbayFormGap[]=[]
  for(const item of hardRequired) {
    if(!item.required)continue
    const raw=String(values[item.key]??'').trim()
    if(/Policy$/.test(item.key)?!isEbayPolicyId(raw):!raw)gaps.push({kind:'FIELD',name:item.key,label:item.label})
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
