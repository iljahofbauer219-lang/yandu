import type { EbayProductDetails } from '../../shared/contracts'

/**
 * Seller Hub「ReviseItem 本地版本待确认」灌字段引擎的目标表（Task 8，P1 收尾）。
 * 口径三条：
 *   1. 一条目标 = 一个 label（面向操作手的中文点名，也是 filledFields/skippedFields 里出现的字符串）
 *      + 一个 details 键 + 一组匹配模式；label 顺序即页面循环顺序，标题/价格/描述保持在最前，
 *      与 Task 1-7 之前手写的三项文案完全一致，避免历史通知文案与横幅计数漂移。
 *   2. 政策三项 byPolicyId=true：命中的是 <select> option 的 value（eBay 政策 ID 数字串）
 *      或 option 文本里的 `(政策ID)` 后缀，不按名称猜。前提是 details 里这三项存的就是政策 ID 数字串
 *      （Task 1 裁定），页内 selectByPolicyId 再用 /^\d+$/ 挡掉历史脏值。
 *   3. 本表会被序列化后注入页面（RegExp 不能跨 executeJavaScript 传递，故只带 patterns 的 .source，
 *      页内用 new RegExp(source,'i') 重建；标志位必须留在页内重建那一步）。
 *      回归锁在 src/main/browser/__tests__/ebayLocalFill.test.ts。
 */
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

/** 第一个真正有内容的值：空白串等于没记录（历史脏数据里「两个空格」曾把空格写进 eBay 标题框）。 */
function firstNonBlank(...values:(string|undefined)[]):string {
  for(const value of values) {
    const text=String(value||'').trim()
    if(text)return text
  }
  return ''
}

/**
 * 只提交非空字段：空字段不进 payload，页面保留 eBay 线上原值，也不会被计成「写入失败」。
 * fallbacks 只服务标题与价格——这两项自 P0 起就有「存档 details 优先、线上刊登原值兜底」的口径
 * （与主进程完成度读数同一方向）；其余字段 APP 没记录就是没记录，绝不用别的来源凑。
 * 描述同理：富文本为空白才回落纯文本，两者皆空白则整个字段不进 payload。
 */
export function ebayLocalFillPayload(details:EbayProductDetails,fallbacks:{title?:string;price?:string}={}):Record<string,string> {
  const source:Record<string,string|undefined>={
    title:firstNonBlank(details.title,fallbacks.title),price:firstNonBlank(details.price,fallbacks.price),
    description:firstNonBlank(details.descriptionHtml,details.descriptionText),
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
