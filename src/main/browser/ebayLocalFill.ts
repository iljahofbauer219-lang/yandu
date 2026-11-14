import type { EbayProductDetails } from '../../shared/contracts'
import type { EbayPolicyModelChoices, EbayPolicyModelField } from '../../shared/ebayPolicyModel'
import type { EbayFixedFillPlan } from '../../shared/ebayAutoFillPlan'

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
  {label:'数量',key:'quantity',patterns:[/^quantity\b|available quantity|quantity available/i,/^(?!.*已售)(?!.*销量).*数量/]},
  {label:'商品状况',key:'condition',patterns:[/item condition|^condition\b/i,/商品状况|物品状况/]},
  {label:'付款政策',key:'paymentPolicy',byPolicyId:true,patterns:[/payment policy/i,/付款政策|支付政策/]},
  {label:'运输政策',key:'shippingPolicy',byPolicyId:true,patterns:[/shipping policy|delivery policy/i,/运输政策|物流政策/]},
  {label:'退货政策',key:'returnPolicy',byPolicyId:true,patterns:[/return policy/i,/退货政策/]},
  {label:'商品所在地',key:'itemLocation',patterns:[/item location|located in|ships from/i,/^(?:商品)?所在地(?!邮编)/]},
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

export interface EbayPolicyFillPlanEntry {
  key:EbayPolicyModelField
  label:string
  anchor:string
  policyId:string
  optionText:string
}

/**
 * 缺陷 (a)：现网政策控件是 input[role=combobox]，往框里写政策编号只会留下一个框里根本不存在的字符串，
 * 还被报成「已填」。能选中的是它 aria-controls 列表里的 [role=option]，而选项节点只认显示文本，
 * 所以「编号 → 本页该编号那条选项的显示文本」这一步必须在主进程先算好，页面只负责按文本点中那一个选项。
 * 判据三条，任何一条不成立就一条都不出（宁可不填也不按名称猜：猜错就是改错政策，且改的是店铺级资产）：
 *   1. APP 真的记了编号（纯数字串）——没记录=不动线上原值，与 ebayLocalFillPayload 的空值口径对称；
 *   2. 这一类的内嵌模型给出了控件名——没有控件名页内就无处定位；
 *   3. 该编号在本页选项里唯一命中——政策已删、换了店铺、或同一编号出现两次都算命中不了。
 */
export function ebayPolicyFillPlan(
  details:Pick<EbayProductDetails,'paymentPolicy'|'shippingPolicy'|'returnPolicy'>,
  models?:Partial<Record<EbayPolicyModelField,EbayPolicyModelChoices>>
):EbayPolicyFillPlanEntry[] {
  const plan:EbayPolicyFillPlanEntry[]=[]
  for(const target of EBAY_LOCAL_FILL_TARGETS.filter(item=>item.byPolicyId)) {
    const key=target.key as EbayPolicyModelField
    const policyId=String(details[key]||'').trim()
    if(!/^\d+$/.test(policyId))continue
    const choices=models?.[key]
    if(!choices||!choices.controlName)continue
    const matches=choices.options.filter(option=>option.id===policyId)
    if(matches.length!==1)continue
    plan.push({key,label:target.label,anchor:choices.controlName,policyId,optionText:matches[0].text})
  }
  return plan
}

/**
 * R3：固定填写计划 → 页内目标描述符。页内脚本只按描述符操作现网控件（pills/switch/combobox/偏好弹窗），
 * 政策编号→显示文本仍走 ebayPolicyFillPlan 的三条判据（宁可不填也不按名称猜）。
 * 控件形来自 2026-11-13 现网取证（~/.yandu-acceptance/2026-11-13-R1/）：
 * 状况是 button.condition-recommendation-value；议价/批量是 name=bestOfferEnabled/vpSelection 的 switch；
 * 商品文件是「物品披露信息」段内唯一 unnamed switch；推广是 aria-label=切换为常规/切换为优先 的 switch。
 */
export interface EbayFixedFillPageTarget {
  key:string
  label:string
  fee:boolean
  control:'condition-pill'|'switch-name'|'switch-aria'|'switch-section'|'combobox'|'preferences'|'volume-pricing'|'text-name'
  matcher:string
  desired:string|boolean
  optionText?:string
  /** X：批量折扣三档（购买2/3/4件+）默认百分比，仅「开」时写入空档位，不覆盖人工已设值 */
  tiers?:Record<string,string>
  /** AC：推广·常规广告费率百分比 */
  rate?:string
}

export function ebayFixedFillPageTargets(
  plan:EbayFixedFillPlan,
  models?:Partial<Record<EbayPolicyModelField,EbayPolicyModelChoices>>
):{targets:EbayFixedFillPageTarget[];skipped:Array<{key:string;label:string;reason:string}>} {
  const targets:EbayFixedFillPageTarget[]=[]
  const skipped=[...plan.skipped]
  const policyDetails:Record<string,string>={}
  for(const row of plan.rows){
    if(row.kind==='combobox')policyDetails[row.key.replace(/Id$/,'')]=String(row.value)
  }
  const policyPlan=ebayPolicyFillPlan(policyDetails as Pick<EbayProductDetails,'paymentPolicy'|'shippingPolicy'|'returnPolicy'>,models)
  for(const row of plan.rows){
    const base={key:row.key,label:row.label,fee:row.fee}
    if(row.kind==='condition'){targets.push({...base,control:'condition-pill',matcher:String(row.value),desired:row.value});continue}
    if(row.kind==='switch'){
      if(row.key==='productDocumentsEnabled')targets.push({...base,control:'switch-section',matcher:'物品披露信息',desired:row.value})
      else if(row.key==='vpSelection')targets.push({...base,control:'volume-pricing',matcher:'vpSelection',desired:row.value,tiers:row.tiers||{2:'5',3:'7',4:'10'}})
      else if(row.key==='promotedRegularEnabled')targets.push({...base,control:'switch-aria',matcher:'切换为常规',desired:row.value,rate:row.rate})
      else if(row.key==='promotedPriorityEnabled')targets.push({...base,control:'switch-aria',matcher:'切换为优先',desired:row.value})
      else targets.push({...base,control:'switch-name',matcher:row.key,desired:row.value})
      continue
    }
    if(row.kind==='combobox'){
      const entry=policyPlan.find(item=>item.key===row.key.replace(/Id$/,''))
      if(!entry){skipped.push({key:row.key,label:row.label,reason:'本页政策模型没读到该编号对应的唯一选项，保留线上原值，请人工核对'});continue}
      targets.push({...base,control:'combobox',matcher:entry.anchor,desired:entry.policyId,optionText:entry.optionText})
      continue
    }
    if(row.kind==='text'){targets.push({...base,control:'text-name',matcher:row.key,desired:row.value});continue}
    targets.push({...base,control:'preferences',matcher:row.key,desired:row.value})
  }
  return {targets,skipped}
}
