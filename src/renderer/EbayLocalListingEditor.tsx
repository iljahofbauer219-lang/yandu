import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { EbayItemSpecific, EbayLocalProduct, EbayLocalProductUpdateInput, EbayStoreBusinessPolicy, EbayStoreCategory } from '../shared/contracts'
import { formatFormGaps, type EbayFormGap } from '../shared/ebayListingForm'
import { checkEbayPolicyCarrierItemId } from '../shared/ebayPolicyCarrier'
import { EBAY_IMAGE_LIMIT } from '../shared/ebayUploadMediaPlan'
import type { EbayListingRouteKind } from '../shared/ebayListingTarget'
import type { EbayItemSpecificSlot, EbayItemSpecificsSection, EbaySuggestedSpecificsCard } from '../shared/ebayItemSpecificsModel'
import type { PlatformCategoryController } from './useEbayPlatformCategory'
import './ebay-local-listing-editor.css'
import './ebay-local-listing-pricing.css'
import './ebay-local-listing-validation.css'

type Props={
  product:EbayLocalProduct
  draft:EbayLocalProductUpdateInput
  saving:boolean
  uploading:boolean
  preparing:boolean
  categories:EbayStoreCategory[]
  onChange:(draft:EbayLocalProductUpdateInput)=>void
  onSave:()=>void
  onClose:()=>void
  onUpload:(files:File[])=>void
  onPrepare:()=>void
  onSetCategory:(categoryId:string,categoryName:string)=>void
  onAutoClassify:()=>void
  platformCategory?:PlatformCategoryController
  gaps:EbayFormGap[]
  businessPolicies:EbayStoreBusinessPolicy[]
  readingPolicies:boolean
  onReadPolicies:()=>void
  policyCarrierItemId:string
  onPolicyCarrierItemIdChange:(value:string)=>void
  /** 「保存并准备到 eBay」实际会打开哪一页（修改/首次刊登/新建刊登），由调用方按本地产品判定后传入；缺省按修改页 */
  routeKind?:EbayListingRouteKind
  /** 本次会话里从 eBay 现网 ITEM SPECIFICS 段读回的整段原文形（槽位+组说明+折叠两态+加属性按钮）；为空即「还没读过」，段体退回本地清单态 */
  attributeSection?:EbayItemSpecificsSection
  /** 上面那份清单的抓取时刻（requirements.inspectedAt）；清单只活在本次会话，不落库，故时间必须显式标出 */
  attributeSlotsAt?:string
  /** 现网 ITEM SPECIFICS 段顶部的 eBay.ai 建议卡；现网按条件渲染，读不到即为 null，段内不画卡片 */
  suggestedCard?:EbaySuggestedSpecificsCard|null
  /** H4：段头两个功能键——按产品已设 eBay 类目现读槽位清单；按产品真实内容自动填槽位。接线在 App */
  onReadSpecifics?:()=>void
  onFillSpecifics?:()=>void
  readingSpecifics?:boolean
  fillingSpecifics?:boolean
  /** 上次「类目属性填写」落进草稿的时刻；自动填的值必须标来源与时间（五硬要求） */
  specificsFilledAt?:string
  inline?:boolean
}

type RouteCopy={prepare:string;preparing:string;gapNote:string;fieldNote:string;routeNote:string}
// 三条路由的页面名不同，「沿用 eBay 线上原值」只在修改页成立：首次刊登页与新建刊登首页根本没有线上原值。
const ROUTE_COPY:Record<EbayListingRouteKind,RouteCopy>={
  revise:{
    prepare:'保存并准备到 eBay 修改',
    preparing:'正在准备 Seller Hub…',
    gapNote:'未在 APP 记录；准备到 Seller Hub 时这些字段沿用 eBay 线上原值，请人工核对。',
    fieldNote:'eBay 发布硬必填。留空的字段在准备 Seller Hub 时不写入，页面沿用线上原值。',
    routeNote:''
  },
  add:{
    prepare:'保存并准备到 eBay 首次刊登',
    preparing:'正在准备 eBay 首次刊登页…',
    gapNote:'未在 APP 记录；首次刊登页的政策与所在地由 eBay 自带默认，其余请在页面逐项补齐。',
    fieldNote:'eBay 发布硬必填。首次刊登页由 eBay 逐项索取，留空的请在页面补齐。',
    routeNote:'该商品还没有可修改的 eBay 在架编号，本次按上方「平台类目」选定的类目打开 eBay 首次刊登页。'
  },
  prelist:{
    prepare:'保存并打开 eBay 新建刊登',
    preparing:'正在打开 eBay…',
    gapNote:'未在 APP 记录；本次不写入任何字段，全部由您在 eBay 页面填写。',
    fieldNote:'eBay 发布硬必填。本次只打开新建刊登首页，字段全部由您在页面填写。',
    routeNote:'还没有在架编号，也没有可用的平台类目——eBay 对没有类目的首次刊登会直接报错，请先在上方「平台类目」确定类目再重试；本次只打开 eBay「List an item」新建刊登首页。'
  }
}

// eBay 真页 Item specifics 一次只铺开前若干行，其余收在 Show more 之后；本地按同一读数节流。
const SPECIFICS_VISIBLE_LIMIT=6

type ValidationIssue={level:'ERROR'|'WARNING';section:string;message:string}

function validateDraft(draft:EbayLocalProductUpdateInput):ValidationIssue[] {
  const issues:ValidationIssue[]=[]
  const error=(section:string,message:string)=>issues.push({level:'ERROR',section,message})
  const warning=(section:string,message:string)=>issues.push({level:'WARNING',section,message})
  const title=draft.title.trim()
  if(!title)error('title','物品标题不能为空')
  if(title.length>80)error('title','物品标题不能超过 80 个字符')
  if(/[©®™]/.test(title))warning('title','标题含特殊符号，发布前请确认商标与知识产权风险')
  // 与主进程 updateEbayLocalProduct 同一判据：只有真落盘（localPath 非空）才算已下载，否则编辑器绿灯、保存必被拒。
  const downloaded=draft.media.filter(item=>item.downloadStatus==='DOWNLOADED'&&item.localPath)
  if(!downloaded.length)error('media','至少需要 1 张已保存到本地的商品图片')
  downloaded.filter(item=>item.width&&item.height&&Math.max(item.width,item.height)<500).forEach((_,index)=>error('media',`第 ${index+1} 张图片最长边不足 500px`))
  if(downloaded.length>0&&downloaded.length<3)warning('media','建议保留多个角度的高清商品图片')
  if(draft.media.length>EBAY_IMAGE_LIMIT)error('media',`商品图片与视频不能超过 ${EBAY_IMAGE_LIMIT} 项`)
  if(!draft.descriptionText.trim()&&!draft.descriptionHtml.trim())error('description','商品描述不能为空')
  if(!Number.isFinite(Number(draft.price))||Number(draft.price)<=0)error('pricing','价格必须是大于 0 的数字')
  if(!/^[A-Z]{3}$/.test(draft.currency.trim()))error('pricing','币种必须使用 3 位大写代码，例如 USD')
  // section 键跟段锚点一一对应：明细按钮跳 #ebay-revise-<section>，故数量与刊登格式归定价段、SKU 归标题段
  // （eBay 真页把 Quantity 和付款政策排在 Pricing 段，Custom label (SKU) 排在 Title 段）。
  const quantity=draft.quantity===undefined?'':draft.quantity.trim()
  if(quantity&&!/^[1-9]\d{0,5}$/.test(quantity))error('pricing','数量必须是大于 0 的整数')
  if(draft.listingFormat&&!['FIXED_PRICE','AUCTION'].includes(draft.listingFormat))error('pricing','刊登格式只能是「现在购买」或「拍卖」')
  if((draft.sku||'').trim().length>50)error('title','自定义编号（SKU）不能超过 50 个字符')
  // 「所在地邮编」保持 WARNING 不升 ERROR：eBay 国别站点邮编格式差异大，旧记录可能本来就没错，
  // 硬阻断会让「保存」无从满足（门禁不得 brick 操作）；键指向运输段锚点，明细按钮跳 policies 段而不是定价段。
  if((draft.postalCode||'').trim()&&!/^[A-Za-z0-9][A-Za-z0-9 -]{2,11}$/.test(draft.postalCode!.trim()))warning('policies','所在地邮编格式不正确')
  return issues
}

function mediaUrl(localPath:string,remoteUrl:string) {
  return localPath?`cross-media://local/${encodeURIComponent(localPath)}`:remoteUrl
}

/**
 * 现网原文在上、中文对照在下：图片段按用户口径（2026-11-10）逐字复刻 eBay PHOTOS & VIDEO，
 * 英文取 DOM 原文（~/.yandu-acceptance/2026-11-10-F1/F1-photos-section.json），中文只做对照不改判据。
 */
function Bi({en,zh}:{en:string;zh:string}) {
  return <span className="ebay-bilingual"><span className="ebay-en">{en}</span><span className="ebay-zh">{zh}</span></span>
}

/** 视频瓦片左上的时长徽章照现网 mm:ss（现网原文「00:41」）；只画真的从媒体元素读到的时长。 */
function clockOf(seconds:number) {
  return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(Math.round(seconds%60)).padStart(2,'0')}`
}

function CustomCategoryDropdown({options,value,onChange,disabled,placeholder,savedId,savedName}: {
  options:Array<{categoryId:string;name:string;soldCount:number}>
  value:string
  onChange:(categoryId:string)=>void
  disabled:boolean
  placeholder:string
  savedId?:string
  savedName?:string
}) {
  const [open,setOpen]=useState(false)
  const dropdownRef=useRef<HTMLDivElement>(null)
  const displayOptions=options.length>0
    ?options
    :(savedId?[{categoryId:savedId,name:savedName||savedId,soldCount:0}]:[])
  const selectedOption=displayOptions.find(o=>o.categoryId===value)

  useEffect(()=>{
    const handleClickOutside=(event:MouseEvent)=>{
      if(dropdownRef.current&&!dropdownRef.current.contains(event.target as Node)){
        setOpen(false)
      }
    }
    document.addEventListener('mousedown',handleClickOutside)
    return ()=>document.removeEventListener('mousedown',handleClickOutside)
  },[])

  return (
    <div className="ebay-revise-custom-dropdown" ref={dropdownRef}>
      <button
        type="button"
        className="ebay-revise-custom-dropdown-trigger"
        disabled={disabled}
        onClick={()=>setOpen(!open)}
        title={selectedOption?.name||placeholder}
      >
        <span>{selectedOption?.name||placeholder}</span>
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
          <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
      {open&&displayOptions.length>0&&(
        <div className="ebay-revise-custom-dropdown-menu">
          {displayOptions.map(option=>(
            <div
              key={option.categoryId}
              className={`ebay-revise-custom-dropdown-option ${option.categoryId===value?'selected':''}`}
              title={option.name}
              onClick={()=>{
                onChange(option.categoryId)
                setOpen(false)
              }}
            >
              <span>{option.name}</span>
              {option.soldCount>0&&option.soldCount<999999&&(
                <small>已成交 {option.soldCount}</small>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function EbayLocalListingEditor({product,draft,saving,uploading,preparing,categories,onChange,onSave,onClose,onUpload,onPrepare,onSetCategory,onAutoClassify,platformCategory,gaps,businessPolicies,readingPolicies,onReadPolicies,policyCarrierItemId,onPolicyCarrierItemIdChange,routeKind='revise',attributeSection,attributeSlotsAt='',suggestedCard=null,onReadSpecifics,onFillSpecifics,readingSpecifics=false,fillingSpecifics=false,specificsFilledAt='',inline}:Props) {
  const fileInput=useRef<HTMLInputElement>(null)
  const [draggedId,setDraggedId]=useState('')
  // 视频瓦片左上的时长徽章照现网画（现网原文「00:41」）：只画媒体元素真读到的秒数，读不到就不画，不编 00:00
  const [videoSeconds,setVideoSeconds]=useState<Record<string,number>>({})
  const [descriptionMode,setDescriptionMode]=useState<'TEXT'|'HTML'>('TEXT')
  // eBay 真页的 Custom label (SKU) 是标题段里的开关：开关只决定这行显不显示，关掉不清空已记录的编号。
  const [skuVisible,setSkuVisible]=useState(()=>Boolean((draft.sku||'').trim()))
  const [specificsExpanded,setSpecificsExpanded]=useState(false)
  const issues=useMemo(()=>validateDraft(draft),[draft])
  const errors=issues.filter(item=>item.level==='ERROR')
  const warnings=issues.filter(item=>item.level==='WARNING')
  const route=ROUTE_COPY[routeKind]
  const gapLabels=formatFormGaps(gaps)
  const priceCurrency=draft.currency.trim().toUpperCase()||'USD'
  const priceSymbol=({USD:'$',GBP:'£',EUR:'€',CAD:'CA$',AUD:'A$',CNY:'¥',RMB:'¥'} as Record<string,string>)[priceCurrency]||priceCurrency
  const set=<K extends keyof EbayLocalProductUpdateInput>(key:K,value:EbayLocalProductUpdateInput[K])=>onChange({...draft,[key]:value})
  const SOURCE_LABELS:Record<NonNullable<EbayItemSpecific['source']>,string>={SOURCE_PAGE:'源页抓取',ENUM_MATCH:'枚举匹配',AI:'AI 推断',MANUAL:'人工确认',CATEGORY_DEFAULT:'类目记忆'}
  const specifics=draft.itemSpecifics||[]
  const indexedSpecifics=specifics.map((item,index)=>({item,index}))
  const pendingSpecifics=indexedSpecifics.filter(entry=>Boolean(entry.item.needsConfirmation))
  const visibleSpecifics=specificsExpanded?indexedSpecifics:indexedSpecifics.slice(0,SPECIFICS_VISIBLE_LIMIT)
  const acceptAllSpecifics=()=>set('itemSpecifics',specifics.map(item=>item.needsConfirmation?{...item,needsConfirmation:false}:item))
  const updateSpecific=(index:number,value:string)=>{const next=[...specifics];next[index]={...next[index],value,source:'MANUAL',needsConfirmation:false};set('itemSpecifics',next)}
  // 05 段两态：读到现网槽位清单走「现网清单态」（分组/必填/控件形状照 eBay），没读到退回「本地清单态」并点名尚未读取。
  const specificKey=(name:string)=>name.trim().toLowerCase()
  // 建议卡的勾选态只活在本次会话：现网也是「勾上即写入」，取消勾选只撤勾，不回滚已经填进属性行的值。
  const [suggestionChecked,setSuggestionChecked]=useState<Record<string,boolean>>({})
  const attributeSlots=attributeSection?.slots??[]
  const sectionGroups=attributeSection?.groups??[]
  const sectionToggleExpanded=attributeSection?.toggleExpandedText??''
  const sectionToggleCollapsed=attributeSection?.toggleCollapsedText??''
  const sectionCustomAction=attributeSection?.customActionText??''
  const sectionCollapsedNames=attributeSection?.collapsedSlotNames??[]
  // 现网折叠开关的镜像只在「折叠态行名也读回来」时才给真开关；读不到就照画开关文字当读数，不自己编折叠范围。
  const [sectionExpanded,setSectionExpanded]=useState(true)
  const sectionCollapsible=Boolean(sectionCollapsedNames.length&&sectionToggleExpanded&&sectionToggleCollapsed)
  const visibleSlots=(sectionCollapsible&&!sectionExpanded)?attributeSlots.filter(slot=>sectionCollapsedNames.includes(slot.name)):attributeSlots
  const slottedNames=new Set(attributeSlots.map(item=>specificKey(item.name)))
  const localOnlySpecifics=indexedSpecifics.filter(entry=>!slottedNames.has(specificKey(entry.item.name)))
  // 槽位清单只在本次会话里活着（不落库），故把抓取时刻显式标出来；没给时间就不谎报「已读取于……」。
  const stampText=(iso:string)=>iso?new Date(iso).toLocaleString('zh-CN',{hour12:false}):''
  const attributeSlotsAtText=attributeSlots.length?stampText(attributeSlotsAt):''
  // 现网槽位不一定已有本地行：新增行按同名匹配键写入 itemSpecifics，准备阶段与本地行共用同一份值。
  const writeSlotInto=(list:EbayItemSpecific[],name:string,value:string)=>{
    const index=list.findIndex(item=>specificKey(item.name)===specificKey(name))
    if(index>=0)list[index]={...list[index],value,source:'MANUAL',needsConfirmation:false}
    else list.push({name,value,source:'MANUAL',needsConfirmation:false})
    return list
  }
  const toggleSuggestion=(item:{name:string;value:string},checked:boolean)=>{
    setSuggestionChecked(current=>({...current,[specificKey(item.name)]:checked}))
    // 值只在操作员明确勾选时写入；取消勾选只撤勾，不动已经填进属性行的值。
    if(checked&&item.value)set('itemSpecifics',writeSlotInto([...specifics],item.name,item.value))
  }
  const applyAllSuggestions=()=>{
    if(!suggestedCard)return
    setSuggestionChecked(Object.fromEntries(suggestedCard.items.map(item=>[specificKey(item.name),true])))
    // 一次算完整张清单再交出去：逐条 set 会各自基于同一份旧 specifics，后一条把前一条抹掉。
    let list=[...specifics]
    for(const item of suggestedCard.items)if(item.value)list=writeSlotInto(list,item.name,item.value)
    set('itemSpecifics',list)
  }
  const slotRow=(slot:EbayItemSpecificSlot)=>{
    const localIndex=specifics.findIndex(item=>specificKey(item.name)===specificKey(slot.name))
    const local=localIndex>=0?specifics[localIndex]:undefined
    const value=local?.value??''
    const writeSlotValue=(next:string)=>set('itemSpecifics',writeSlotInto([...specifics],slot.name,next))
    return (
      <div className="ebay-specific-row ebay-specific-row--slot" key={slot.name}>
        <span className={`ebay-specific-label${slot.required?' required':''}`} title={slot.name}>{slot.name}{slot.required&&<i className="ebay-specific-star" aria-label="eBay 必填属性">*</i>}{slot.meta&&<span className={slot.metaKind==='TRENDING'?'ebay-specific-meta ebay-specific-meta--trending':'ebay-specific-meta'}>{slot.meta}</span>}</span>
        <div className="ebay-specific-control">
          {slot.control==='YESNO'?(
            <div className="ebay-specific-pills" role="group" aria-label={slot.name}>
              {slot.options.map(option=>(<button type="button" className={`ebay-specific-pill${value===option.text?' ebay-specific-pill--on':''}`} key={option.text} aria-pressed={value===option.text} onClick={()=>writeSlotValue(value===option.text?'':option.text)}>{option.text}</button>))}
            </div>
          ):slot.control==='MENU'?(
            <div className="ebay-specific-menu">
              <input name={slot.name} value={value} placeholder={slot.placeholderShown} className={slot.placeholderShown?'ebay-specific-menu-input--live':undefined} onChange={event=>writeSlotValue(event.target.value)}/>
              <svg className="ebay-specific-menu-caret" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M3 5.75 8 10.75l5-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </div>
          ):slot.control==='TEXTAREA'?(
            <textarea name={slot.name} value={value} placeholder={slot.placeholderShown} rows={3} maxLength={slot.maxLength||undefined} onChange={event=>writeSlotValue(event.target.value)}/>
          ):(
            <input name={slot.name} value={value} placeholder={slot.placeholderShown} onChange={event=>writeSlotValue(event.target.value)}/>
          )}
          {slot.control==='TEXTAREA'&&slot.maxLength>0&&<span className="ebay-specific-counter">{`${value.length}/${slot.maxLength}`}</span>}
          {slot.suggested&&<button type="button" className="ebay-specific-suggested" onClick={()=>writeSlotValue(slot.suggested)}>{`Suggested: ${slot.suggested}`}</button>}
          {Boolean(slot.value)&&slot.value!==value&&<em className="ebay-specific-live">{`eBay 线上原值：${slot.value}`}</em>}
          {local?.source&&<em className="ebay-specific-source">{`${SOURCE_LABELS[local.source]}${local.needsConfirmation?' · 待确认':''}`}</em>}
        </div>
      </div>
    )
  }
  // 组标题与说明句照现网原文画；读不到组标题时按槽位 group 记号合成 Essential/Optional，保持旧现网页的画法。
  const groupLabelOf=(slot:EbayItemSpecificSlot)=>slot.groupLabel||(slot.group==='ESSENTIAL'?'Essential':'Optional')
  const effectiveGroups=sectionGroups.length?sectionGroups:[...new Set(attributeSlots.map(slot=>slot.group))].map(group=>({name:group==='ESSENTIAL'?'Essential':'Optional',blurb:''}))
  const sectionNodes:ReactNode[]=[]
  for(const group of effectiveGroups){
    const groupSlots=visibleSlots.filter(slot=>groupLabelOf(slot)===group.name)
    sectionNodes.push(<h3 className="ebay-specific-group" key={`group-${group.name}`}>{group.name}</h3>)
    if(group.blurb)sectionNodes.push(<p className="ebay-specific-group-blurb" key={`group-blurb-${group.name}`}>{group.blurb}</p>)
    for(const slot of groupSlots)sectionNodes.push(slotRow(slot))
  }
  const groupedNames=new Set(effectiveGroups.map(group=>group.name))
  for(const slot of visibleSlots.filter(item=>!groupedNames.has(groupLabelOf(item))))sectionNodes.push(slotRow(slot))
  const descriptionLength=(descriptionMode==='TEXT'?draft.descriptionText:draft.descriptionHtml).length
  // 只渲染付款/运输/退货三类下拉（裁决 3）：FULFILLMENT 入库存着但不做第四个控件；kind 收窄用映射表，不用 toUpperCase 断言。
  type PolicyKey='payment'|'shipping'|'return'
  const KIND_BY_KEY:Record<PolicyKey,'PAYMENT'|'SHIPPING'|'RETURN'>={payment:'PAYMENT',shipping:'SHIPPING',return:'RETURN'}
  // DAO 无 kind 参数时按 kind,label 排序、不按 isDefault（AppDatabase 注释点名由本组件补），故默认政策在此前置排序。
  const policyOptions=(key:PolicyKey)=>businessPolicies.filter(item=>item.kind===KIND_BY_KEY[key]).sort((left,right)=>Number(right.isDefault)-Number(left.isDefault)||left.label.localeCompare(right.label,'zh-CN'))
  const policyReadout=(key:PolicyKey)=>{const picked=policyOptions(key).find(item=>item.policyId===(draft.policyIds?.[key]||''));return picked?`${picked.label}${picked.listingCount?` · ${picked.listingCount} 条`:''}`:'未选择（沿用线上原值）'}
  // R1：读取政策要开一次 eBay 修改页，而本地产品的 listingId 是 PALLET-<货盘编号>，eBay 不认（会落 createOrGetDraft 错误页）。
  // 故载体由操作员手填一个真实在架商品编号，按店铺记住；它只用于开页，政策本身按店铺入库复用。
  // 校验用同一个 shared 纯函数：这里先当场点名，App.tsx 的读取入口再据此决定是否发 IPC（不合法就不开页）。
  const policyCarrierCheck=checkEbayPolicyCarrierItemId(policyCarrierItemId)
  // 上次抓取时间＝入库记录里最新的 updatedAt：政策是店铺级资产，入库即一次成功读取。
  const policyFetchedAt=businessPolicies.reduce((latest,item)=>!latest||item.updatedAt>latest?item.updatedAt:latest,'')
  const policyFetchedAtText=policyFetchedAt?new Date(policyFetchedAt).toLocaleString('zh-CN',{hour12:false}):'尚未抓取过'
  const moveMedia=(sourceId:string,targetId:string)=>{
    if(!sourceId||sourceId===targetId)return
    const media=[...draft.media]
    const sourceIndex=media.findIndex(item=>item.id===sourceId)
    const targetIndex=media.findIndex(item=>item.id===targetId)
    if(sourceIndex<0||targetIndex<0)return
    const [item]=media.splice(sourceIndex,1)
    media.splice(targetIndex,0,item)
    set('media',media.map((entry,index)=>({...entry,sortOrder:index})))
  }
  const makeMain=(id:string)=>{
    const media=[...draft.media]
    const index=media.findIndex(item=>item.id===id)
    if(index<=0)return
    const [item]=media.splice(index,1)
    set('media',[item,...media].map((entry,sortOrder)=>({...entry,sortOrder})))
  }
  const removeMedia=(id:string)=>set('media',draft.media.filter(item=>item.id!==id).map((entry,sortOrder)=>({...entry,sortOrder})))

  return <div className={inline?'ebay-revise-inline':'ebay-revise-overlay'} role={inline?undefined:'dialog'} aria-modal={inline?undefined:true} aria-label="本地 eBay 商品编辑器">
    <div className="ebay-revise-shell">
      <header className="ebay-revise-topbar">
        <div className="ebay-wordmark" aria-label="eBay"><i>e</i><i>b</i><i>a</i><i>y</i></div>
        <div><b>本地产品编辑</b><span>Item ID {product.listingId} · 本地版本 V{product.versionCount}</span></div>
        <em>保存本地版本并准备 eBay 必填字段，不代您提交线上刊登</em>
        <button type="button" aria-label="关闭编辑器" disabled={saving} onClick={onClose}>×</button>
      </header>

      <main className="ebay-revise-body">
        <section className={`ebay-revise-validation ${errors.length?'blocked':'ready'}`}>
          <div><strong>{errors.length?`${errors.length} 项必须修改`:gaps.length?`eBay 必填待补齐 ${gaps.length} 项`:'四项核心资料已通过'}</strong><span>{gaps.length?`${gapLabels} ${route.gapNote}`:`${warnings.length} 项建议优化 · 图片、标题、描述、价格与状况政策齐备`}</span></div>
          {route.routeNote&&<p className="ebay-revise-route-note">{route.routeNote}</p>}
          {issues.length>0&&<details><summary>查看检查明细</summary><div>{issues.map((issue,index)=><button type="button" key={`${issue.section}-${index}`} className={issue.level.toLowerCase()} onClick={()=>document.getElementById(`ebay-revise-${issue.section}`)?.scrollIntoView({behavior:'smooth',block:'start'})}><b>{issue.level==='ERROR'?'必须修改':'建议优化'}</b><span>{issue.message}</span></button>)}</div></details>}
        </section>

        {/* 以下十段的段序、段头「段名左 + 动作或读数右」几何、段内左右两栏与计数读数逐项取自 eBay 现网修改页取证
            （~/.yandu-acceptance/2026-11-09-R4/P1-ebay-layout.json：Photos & Video → Title → Item category → Variations
            → Item specifics → Condition → Description → Pricing → Shipping → Item disclosures，内容列 max-width 1024px）。
            真页有段而本地没有字段支撑的（变体、定价选项、您的设置、其他刊登选项）一律如实说明「APP 未记录、请在页面补齐」，不臆造控件。 */}
        <div className="ebay-revise-column">
          {/* 现网这一列最上方是页面级标题 Complete your listing（24px/600），就压在 PHOTOS & VIDEO 段头上。 */}
          <div className="ebay-revise-pagehead"><h1><Bi en="Complete your listing" zh="完成您的刊登"/></h1></div>
          <section id="ebay-revise-media" className="ebay-revise-band ebay-revise-media-section">
            <header className="ebay-revise-band-head">
              <div>
                <h2><Bi en="Photos & Video" zh="图片与视频"/></h2>
                <p><Bi en="You can add up to 40 photos and a 1-minute video. Buyers want to see all details and angles." zh="最多可上传 40 张照片和 1 段 1 分钟视频；买家想看到全部细节与角度。"/></p>
                <p className="ebay-band-local-note">本地保存商品媒体；拖动可排序，第一张图片为主图。</p>
              </div>
              {/* 现网这一处是菜单（Upload photos from mobile / from web）；APP 没有这两条通道，只画文字并如实说明，不做假按钮。 */}
              <span className="ebay-band-action-pill" data-ebay-slot="section-action" title="现网这一处是菜单：从手机上传 / 从网页上传。APP 没有这两条通道，请用下方 Select 或 Add 从本机选文件。"><Bi en="See photo options" zh="查看照片选项"/></span>
            </header>
            <details className="ebay-media-tips">
              <summary><Bi en="Tips for taking pro photos" zh="专业拍照技巧"/></summary>
              <div className="ebay-media-tips-pop"><strong><Bi en="Photo tips" zh="拍照技巧"/></strong><p><Bi en="Learn how to take photos that attract buyers and help avoid returns." zh="了解如何拍出能吸引买家、并有助于减少退货的照片。"/></p></div>
            </details>
            <div className="ebay-media-counter">
              <span className="ebay-media-count" data-ebay-counter="photos"><Bi en={`${draft.media.length}/${EBAY_IMAGE_LIMIT}`} zh={`已上传 ${EBAY_IMAGE_LIMIT} 张照片或视频中的 ${draft.media.length} 张`}/></span>
              <button type="button" className="ebay-media-select" disabled={uploading} onClick={()=>fileInput.current?.click()}><Bi en="Select" zh="选择文件"/></button>
            </div>
            <div className="ebay-photo-strip">
              {draft.media.map((media,index)=><figure key={media.id} draggable onDragStart={()=>setDraggedId(media.id)} onDragEnd={()=>setDraggedId('')} onDragOver={event=>event.preventDefault()} onDrop={()=>moveMedia(draggedId,media.id)} data-dragging={draggedId===media.id?'true':undefined} className={index===0?'ebay-photo-tile main':'ebay-photo-tile'} aria-label={media.mediaType==='VIDEO'?`Video ${index+1} 视频 ${index+1}`:`Photo ${index+1} 照片 ${index+1}`}>
                {media.mediaType==='VIDEO'?(
                  <div className="ebay-photo-video">
                    <video src={mediaUrl(media.localPath,media.remoteUrl)} muted playsInline onLoadedMetadata={event=>{const seconds=event.currentTarget.duration;if(Number.isFinite(seconds)&&seconds>0)setVideoSeconds(previous=>previous[media.id]===seconds?previous:{...previous,[media.id]:seconds})}}/>
                    <span className="ebay-photo-play">▶</span>
                    {videoSeconds[media.id]?<span className="ebay-photo-duration">{clockOf(videoSeconds[media.id])}</span>:null}
                  </div>
                ):(
                  <img src={mediaUrl(media.localPath,media.remoteUrl)} alt={`商品图片 ${index+1}`}/>
                )}
                {index===0&&<span className="ebay-photo-pill"><Bi en="Main" zh="主图"/></span>}
                <div className="ebay-photo-tools">
                  {index>0&&media.mediaType!=='VIDEO'&&<button type="button" onClick={()=>makeMain(media.id)}>设为主图</button>}
                  <button type="button" aria-label="删除媒体" onClick={()=>removeMedia(media.id)}>×</button>
                </div>
              </figure>)}
              {draft.media.length<EBAY_IMAGE_LIMIT&&<button className="ebay-photo-add" type="button" disabled={uploading} onClick={()=>fileInput.current?.click()}><strong>{uploading?'…':'＋'}</strong><Bi en="Add" zh={uploading?'正在添加':'添加'}/></button>}
            </div>
            <input ref={fileInput} hidden type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" onChange={event=>{onUpload(Array.from(event.target.files||[]));event.currentTarget.value=''}}/>
          </section>

          <section id="ebay-revise-title" className="ebay-revise-band">
            <header className="ebay-revise-band-head">
              <div>
                <h2><Bi en="Title" zh="标题"/></h2>
                <p className="ebay-band-local-note">只保存买家在商品页看到的主标题。</p>
              </div>
              {/* 现网这一处是菜单（标题建议/关键词）；APP 的标题优化在 AI优化 页做，这里只如实显示，不做假按钮。 */}
              <span className="ebay-band-action-pill" data-ebay-slot="section-action" title="现网这一处是菜单：标题建议与关键词。APP 的标题优化在「AI优化」页做，这里只如实显示。"><Bi en="See title options" zh="查看标题选项"/></span>
            </header>
            <label className="ebay-revise-field"><span><Bi en="Item title" zh="物品标题"/></span><div><input className="ebay-title-input" maxLength={80} value={draft.title} onChange={event=>set('title',event.target.value)}/></div></label>
            {/* 现网计数 72/80 贴在输入框下方右对齐（12px 灰），不在段头；读屏文「72 of 80 characters」由中文对照行承担。 */}
            <div className="ebay-title-counter" data-ebay-counter="title"><Bi en={`${draft.title.length}/80`} zh={`80 个字符中的 ${draft.title.length} 个`}/></div>
            <div className="ebay-revise-field ebay-sku-row">
              <span>自定义编号（SKU）</span>
              <div className="ebay-sku-control">
                <button type="button" role="switch" aria-checked={skuVisible} aria-label="显示自定义编号" onClick={()=>setSkuVisible(!skuVisible)}><i/></button>
                {skuVisible&&<div className="ebay-sku-input"><input maxLength={50} value={draft.sku??''} onChange={event=>set('sku',event.target.value)}/><small data-ebay-counter="sku">{(draft.sku??'').length}/50</small></div>}
                {!skuVisible&&(draft.sku||'').trim()&&<em>已记录 {(draft.sku||'').trim().length} 个字符；关掉开关只隐藏这一行，不清空已保存的编号。</em>}
              </div>
            </div>
          </section>

          <section id="ebay-revise-category" className="ebay-revise-band ebay-revise-category-section">
            <header className="ebay-revise-band-head">
              <div>
                <h2><Bi en="Item category" zh="类目"/></h2>
                <p className="ebay-band-local-note">左栏平台类目（eBay Item category），右栏店铺类目（Store category）；下拉与按钮是 APP 本地控件，现网用 Edit 在 eBay 页改。</p>
              </div>
              {/* 现网这一处是 Edit 图标按钮（点开 eBay 类目选择）；APP 用左栏下拉 + 确定完成同一件事，不画假按钮。 */}
              <span className="ebay-band-action-pill" data-ebay-slot="section-action" title="现网这一处是 Edit 图标按钮，点开 eBay 的类目选择；APP 用左栏下拉 + 确定完成同一件事。"><Bi en="Edit" zh="编辑"/></span>
            </header>
            <div className="ebay-revise-cols">
              <div className="ebay-revise-category-row" data-ebay-col="left">
                {/* 现网左栏没有小标题：类目值是一条下划线值链，下面一行 in 开头的面包屑（14px 灰）。值与路径是数据，照本地存的原样画。 */}
                {platformCategory?.savedName?(<>
                  <span className="ebay-value-link">{platformCategory.savedName.split(' > ').pop()}</span>
                  <span className="ebay-value-secondary">in {platformCategory.savedName}</span>
                </>):null}
                <p className="ebay-band-local-note">平台类目选择（本地）</p>
                {platformCategory?(<>
                  <CustomCategoryDropdown
                    options={platformCategory.options}
                    value={platformCategory.pick}
                    onChange={platformCategory.setPick}
                    disabled={platformCategory.busy||!(platformCategory.options.length||platformCategory.savedId)}
                    placeholder={platformCategory.busy?'正在获取平台类目…':'暂无候选类目'}
                    savedId={platformCategory.savedId}
                    savedName={platformCategory.savedName}
                  />
                  <button type="button" disabled={platformCategory.busy} onClick={platformCategory.refresh}>{platformCategory.busy?'获取中…':'重新获取'}</button>
                  <button type="button" disabled={platformCategory.busy||!platformCategory.pick||platformCategory.pick===platformCategory.savedId} onClick={platformCategory.confirm}>确定</button>
                </>):<p className="ebay-band-empty">本次没有可核对的平台类目；准备到 eBay 页面时在 Item category 逐项选择。</p>}
                {platformCategory?.error&&<p className="ebay-revise-category-error" role="alert">{platformCategory.error}</p>}
              </div>
              <div className="ebay-revise-category-row" data-ebay-col="right">
                <h3><Bi en="Store category" zh="店铺类目"/></h3>
                {product.categoryName?<span className="ebay-value-link">{product.categoryName}</span>:null}
                <p className="ebay-band-local-note">店铺类目选择（本地）</p>
                <select aria-label="本地产品类目" value={product.categoryId} onChange={event=>{const found=categories.find(item=>item.categoryId===event.target.value);if(found)onSetCategory(found.categoryId,found.name)}}>
                  <option value="">未分类</option>
                  {categories.map(item=><option key={item.categoryId} value={item.categoryId}>{'　'.repeat(Math.max(0,item.level-1))}{item.name}</option>)}
                </select>
                <button type="button" onClick={onAutoClassify}>自动分类</button>
              </div>
            </div>
          </section>

          <section id="ebay-revise-variations" className="ebay-revise-band">
            <header className="ebay-revise-band-head"><div><h2>变体</h2><p>eBay 真页有这一段；本地商品按单一规格刊登，没有变体字段。</p></div><span data-ebay-slot="section-action">未启用</span></header>
            <div className="ebay-note-band">本地没有可写的变体行、变体价与变体图片。若该商品在 eBay 是多变体刊登，Variations 段整段由 Seller Hub 页面人工处理，系统不代您增删变体。</div>
          </section>

          <section id="ebay-revise-specifics" className="ebay-revise-band">
            <header className="ebay-revise-band-head"><div><h2>类目属性</h2><p>{attributeSlots.length?'照 eBay 现网 ITEM SPECIFICS 段逐行铺开：分组、必填、控件形状与长度上限都取现网读回的原文，值仍可手改。':'对应 eBay Item specifics 段；来源与待确认状态逐行标出。'}</p>{attributeSlotsAtText&&<p className="ebay-band-stamp">{`现网清单读取于 ${attributeSlotsAtText}`}</p>}</div><span className="ebay-band-counter" data-ebay-slot="section-action">{attributeSlots.length?`${attributeSlots.length} 个现网槽位`:`${specifics.length} 项`}</span></header>
            {/* H4 两个功能键：读取按产品已设 eBay 类目现读（同类目已缓存就不开页）；填写按产品真实内容过 shared 白名单判据后落草稿。 */}
            <div className="ebay-specifics-actions">
              <button type="button" disabled={readingSpecifics} onClick={onReadSpecifics}>{readingSpecifics?'正在读取…':'读取类目属性'}</button>
              <button type="button" disabled={fillingSpecifics||!attributeSlots.length} onClick={onFillSpecifics} title="按本地标题/描述/已记属性自动填槽位；人工改过的值不覆盖，AI 推断的标待确认。">{fillingSpecifics?'正在填写…':'类目属性填写'}</button>
              {specificsFilledAt&&<em className="ebay-band-stamp">{`上次自动填写 ${specificsFilledAt}`}</em>}
            </div>
            {pendingSpecifics.length>0&&(
              <div className="ebay-specific-suggestions">
                <div><b>待确认属性 {pendingSpecifics.length} 项</b><span>来源是源页抓取、枚举匹配或 AI 推断的属性，确认后即记为人工确认；采用后照样能在下方逐行改。</span></div>
                <button type="button" onClick={acceptAllSpecifics}>全部采用</button>
              </div>
            )}
            {attributeSlots.length===0&&(attributeSlotsAt
              ?<div className="ebay-note-band">{`这次读取（${stampText(attributeSlotsAt)}）没有回现网类目属性槽位：可能是 ITEM SPECIFICS 区块没加载，或该类目没有可见属性。下面先按本地已记录的属性展示；可在 Seller Hub 修改页人工核对这一段的属性行。`}</div>
              :<div className="ebay-note-band">尚未读取现网类目属性：点下方「运输与所在地」段的「从 Seller Hub 读取政策与类目属性」开一次修改页，eBay 该类目的分组、必填与控件形状会一并读回这里。下面先按本地已记录的属性展示。</div>)}
            {attributeSlots.length>0?(
              <div className="ebay-specific-list">
                {suggestedCard&&(
                  <div className="ebay-specifics-ai-card">
                    <h4 className="ebay-specifics-ai-title">{suggestedCard.title}</h4>
                    {suggestedCard.blurb&&<p className="ebay-specifics-ai-blurb">{suggestedCard.blurb}</p>}
                    <div className="ebay-specifics-ai-items">
                      {suggestedCard.items.map(item=>(
                        <label className="ebay-specifics-ai-item" key={`${item.name}-${item.value}`}>
                          <input type="checkbox" name={item.name} checked={Boolean(suggestionChecked[specificKey(item.name)]??item.checked)} onChange={event=>toggleSuggestion(item,event.target.checked)}/>
                          <span>{item.value?`${item.name}: ${item.value}`:item.name}</span>
                        </label>
                      ))}
                    </div>
                    {suggestedCard.applyAll&&<button type="button" className="ebay-specifics-ai-apply" onClick={applyAllSuggestions}>{suggestedCard.applyAll}</button>}
                  </div>
                )}
                {sectionNodes}
                {localOnlySpecifics.length>0&&(
                  <div className="ebay-specific-local-only">
                    <h4>本地已记录但不在现网清单</h4>
                    <p>eBay 现网该类目没有这些属性槽位；值保留在本地记录里，准备到 Seller Hub 时不会写入现网没有的字段。</p>
                    {localOnlySpecifics.map(({item,index})=><div className="ebay-specific-row ebay-specific-row--slot" key={`local-only-${item.name}-${index}`}>
                      <span className="ebay-specific-label" title={item.name}>{item.name}</span>
                      <div className="ebay-specific-control">
                        <input name={item.name} value={item.value} onChange={event=>updateSpecific(index,event.target.value)}/>
                        <em className="ebay-specific-source">{item.source?SOURCE_LABELS[item.source]:'—'}</em>
                      </div>
                    </div>)}
                  </div>
                )}
                {sectionToggleExpanded&&<button type="button" className="ebay-specific-toggle" disabled={!sectionCollapsible} onClick={()=>setSectionExpanded(current=>!current)}>{sectionCollapsible&&!sectionExpanded?sectionToggleCollapsed:sectionToggleExpanded}</button>}
                {sectionCustomAction&&<button type="button" className="ebay-specific-custom" disabled>{sectionCustomAction}</button>}
              </div>
            ):specifics.length>0?(
              <div className="ebay-specific-list">
                {visibleSpecifics.map(({item,index})=><div className="ebay-specific-row" key={`${item.name}-${index}`}>
                  <span title={item.name}>{item.name}</span>
                  <input value={item.value} onChange={event=>updateSpecific(index,event.target.value)}/>
                  <em>{item.source?SOURCE_LABELS[item.source]:'—'}{item.needsConfirmation?' · 待确认':''}</em>
                </div>)}
                {indexedSpecifics.length>SPECIFICS_VISIBLE_LIMIT&&!specificsExpanded&&<button type="button" className="ebay-specifics-more" onClick={()=>setSpecificsExpanded(true)}>显示更多（还有 {indexedSpecifics.length-SPECIFICS_VISIBLE_LIMIT} 项）</button>}
              </div>
            ):<p className="ebay-band-empty">本地还没有记录类目属性；eBay 该类目有哪些属性槽位，要点下方「从 Seller Hub 读取政策与类目属性」读取一次才知道。</p>}
          </section>

          <section id="ebay-revise-condition" className="ebay-revise-band">
            <header className="ebay-revise-band-head"><div><h2>状况</h2><p>{route.fieldNote}</p></div><span data-ebay-slot="section-action">{(draft.condition||'').trim()||'未填写'}</span></header>
            <div className="ebay-revise-cols">
              <div className="ebay-band-main" data-ebay-col="left">
                <h3>物品状况</h3>
                <label className="ebay-revise-field"><span>eBay 商品状况</span><input data-gap={gaps.some(item=>item.name==='condition')?'condition':undefined} placeholder="New" value={draft.condition??''} onChange={event=>set('condition',event.target.value)}/></label>
              </div>
              <div className="ebay-note-band" data-ebay-col="right">eBay 状况取值随站点与类目变（New、Used - Seller refurbished 等）。留空时准备阶段不写入，页面按线上原值保留，请在修改页逐项核对。</div>
            </div>
          </section>

          <section id="ebay-revise-description" className="ebay-revise-band">
            <header className="ebay-revise-band-head"><div><h2>描述</h2><p>保留可供 AI 诊断和优化的纯文本与原始 HTML。</p></div><span className="ebay-band-counter" data-ebay-slot="section-action">{descriptionLength} 字符</span></header>
            <div className="ebay-revise-segment"><button className={descriptionMode==='TEXT'?'active':''} type="button" onClick={()=>setDescriptionMode('TEXT')}>文本</button><button className={descriptionMode==='HTML'?'active':''} type="button" onClick={()=>setDescriptionMode('HTML')}>HTML</button></div>
            {descriptionMode==='TEXT'?<textarea className="ebay-revise-description" value={draft.descriptionText} onChange={event=>set('descriptionText',event.target.value)}/>:<textarea className="ebay-revise-description code" value={draft.descriptionHtml} onChange={event=>set('descriptionHtml',event.target.value)}/>}
          </section>

          <section id="ebay-revise-pricing" className="ebay-revise-band">
            <header className="ebay-revise-band-head"><div><h2>定价</h2><p>直接使用 eBay 原刊登币种与售价，作为后续成本和利润核算基准。</p></div><span className="ebay-band-counter" data-ebay-slot="section-action">{priceCurrency}</span></header>
            <div className="ebay-revise-cols">
              <div className="ebay-band-main" data-ebay-col="left">
                <label className="ebay-revise-field"><span>刊登格式</span><select value={draft.listingFormat||'FIXED_PRICE'} onChange={event=>set('listingFormat',event.target.value as 'FIXED_PRICE'|'AUCTION')}><option value="FIXED_PRICE">现在购买</option><option value="AUCTION">拍卖</option></select></label>
                <label className="ebay-revise-field ebay-price-field"><span>商品价格</span><div className="ebay-price-box"><b>{priceSymbol}</b><input aria-label={`商品价格（${priceCurrency}）`} inputMode="decimal" value={draft.price} onChange={event=>set('price',event.target.value)}/></div><small className="ebay-field-note">价格必须是大于 0 的数字 · 币种 {priceCurrency} 取自 eBay 原刊登</small></label>
                <label className="ebay-revise-field"><span>数量</span><input data-gap={gaps.some(item=>item.name==='quantity')?'quantity':undefined} inputMode="numeric" value={draft.quantity??''} onChange={event=>set('quantity',event.target.value.replace(/[^\d]/g,''))}/></label>
                <label className="ebay-revise-field"><span>付款政策</span><select data-policy-kind="payment" data-gap={gaps.some(item=>item.name==='paymentPolicy')?'paymentPolicy':undefined} value={draft.policyIds?.payment||''} onChange={event=>set('policyIds',{...(draft.policyIds||{}),payment:event.target.value})}>
                  <option value="">未选择（沿用线上原值）</option>
                  {policyOptions('payment').map(item=><option key={item.policyId} value={item.policyId}>{item.label}{item.listingCount?` · ${item.listingCount} 条`:''}</option>)}
                </select></label>
              </div>
              <aside className="ebay-pricing-aside" data-ebay-col="right">
                <h3>定价选项</h3>
                <dl>
                  <div><dt>币种</dt><dd>{priceCurrency} · eBay 原刊登币种</dd></div>
                  <div><dt>格式</dt><dd>{draft.listingFormat==='AUCTION'?'拍卖':'现在购买'}</dd></div>
                  <div><dt>付款政策</dt><dd>{policyReadout('payment')}</dd></div>
                </dl>
                <div className="ebay-note-band">eBay 真页这一段还提供折扣与促销、运费补贴、销售税与市场面板；这些字段 APP 没有记录，准备到页面后请人工核对。</div>
              </aside>
            </div>
          </section>

          {/* 评审 Important-2：读取政策走的是同一个全局 busy（App.tsx 的 busyKey），只锁 readingPolicies 时，
              保存/上传/「保存并准备到 eBay」进行中照样能点它——两边互相覆盖 busy，会让 preparing 提前变 false、
              「保存并准备到 eBay」在中途重新可点。故四类进行中一律禁用，并把原因写进按钮文案：点了没反应会被读成「代码没生效」。
              这是便利按钮不是门禁：只是随流程结束的瞬时锁定，就绪度读数不受影响。 */}
          <section id="ebay-revise-policies" className="ebay-revise-band">
            <header className="ebay-revise-band-head"><div><h2>运输与所在地</h2><p>店铺级可复用资产：从 Seller Hub 读一次即入库，之后同类发布直接选用。政策按 eBay 政策 ID 命中，不按名称猜。</p></div>
              <button type="button" className="ebay-band-action" data-ebay-slot="section-action" disabled={readingPolicies||saving||uploading||preparing} onClick={onReadPolicies}>{readingPolicies?'正在读取…':saving||uploading||preparing?'请等待当前操作完成':'从 Seller Hub 读取政策与类目属性'}</button></header>
            <div className="ebay-policy-carrier"><label><span>在架商品编号（读取载体）</span><input data-policy-carrier inputMode="numeric" placeholder="例如 189035181453" value={policyCarrierItemId} onChange={event=>onPolicyCarrierItemIdChange(event.target.value.replace(/\s+/g,''))}/></label>
              <p className={policyCarrierCheck.ok?'ebay-policy-carrier-ok':'ebay-revise-category-error'}>{policyCarrierCheck.ok?`读取时只用它开一次修改页，政策入库后本店所有商品都能选用。上次抓取：${policyFetchedAtText}。`:policyCarrierCheck.message}</p></div>
            {businessPolicies.length===0&&<p className="ebay-revise-category-error">尚未读取到店铺政策。点上方按钮开一次修改页即可抓取；读取前这些字段保留 eBay 线上原值。</p>}
            <div className="ebay-revise-cols">
              <div className="ebay-band-main" data-ebay-col="left">
                <label className="ebay-revise-field"><span>运输政策</span><select data-policy-kind="shipping" data-gap={gaps.some(item=>item.name==='shippingPolicy')?'shippingPolicy':undefined} value={draft.policyIds?.shipping||''} onChange={event=>set('policyIds',{...(draft.policyIds||{}),shipping:event.target.value})}>
                  <option value="">未选择（沿用线上原值）</option>
                  {policyOptions('shipping').map(item=><option key={item.policyId} value={item.policyId}>{item.label}{item.listingCount?` · ${item.listingCount} 条`:''}</option>)}
                </select></label>
                <label className="ebay-revise-field"><span>退货政策</span><select data-policy-kind="return" data-gap={gaps.some(item=>item.name==='returnPolicy')?'returnPolicy':undefined} value={draft.policyIds?.return||''} onChange={event=>set('policyIds',{...(draft.policyIds||{}),return:event.target.value})}>
                  <option value="">未选择（沿用线上原值）</option>
                  {policyOptions('return').map(item=><option key={item.policyId} value={item.policyId}>{item.label}{item.listingCount?` · ${item.listingCount} 条`:''}</option>)}
                </select></label>
                <label className="ebay-revise-field"><span>发货处理天数</span><input inputMode="numeric" value={draft.handlingTime??''} onChange={event=>set('handlingTime',event.target.value.replace(/[^\d]/g,''))}/></label>
                <label className="ebay-revise-field"><span>商品所在地</span><input data-gap={gaps.some(item=>item.name==='itemLocation')?'itemLocation':undefined} placeholder="Guangdong, CN" value={draft.itemLocation??''} onChange={event=>set('itemLocation',event.target.value)}/></label>
                <label className="ebay-revise-field"><span>所在地邮编</span><input data-gap={gaps.some(item=>item.name==='postalCode')?'postalCode':undefined} value={draft.postalCode??''} onChange={event=>set('postalCode',event.target.value)}/></label>
              </div>
              <div className="ebay-your-settings" data-ebay-col="right">
                <h3>您的设置</h3>
                <dl>
                  <div><dt>运输政策</dt><dd>{policyReadout('shipping')}</dd></div>
                  <div><dt>退货政策</dt><dd>{policyReadout('return')}</dd></div>
                  <div><dt>商品所在地</dt><dd>{(draft.itemLocation||'').trim()||'未填写'}{(draft.postalCode||'').trim()?` · ${(draft.postalCode||'').trim()}`:''}</dd></div>
                  <div><dt>处理天数</dt><dd>{(draft.handlingTime||'').trim()?`${draft.handlingTime} 天`:'未填写'}</dd></div>
                </dl>
                <div className="ebay-note-band">eBay 真页此处还有 Dispatch time 逐档、International shipping 与销售税面板；本地只记录上面这几项，其余在页面人工核对。</div>
              </div>
            </div>
          </section>

          <section id="ebay-revise-others" className="ebay-revise-band">
            <header className="ebay-revise-band-head"><div><h2>其他 eBay 刊登选项</h2><p>eBay 真页在定价之后还有发票声明、推广与慈善三段。</p></div><span data-ebay-slot="section-action">APP 未记录</span></header>
            <div className="ebay-note-band">Item disclosures、Promote your listing（含 Sponsored Products）与 Charity donation 在 eBay 现网修改页各自成段。本地产品没有这些字段，准备到页面后由您逐项决定；系统不代您勾选，也不代您开推广预算。</div>
          </section>
        </div>
      </main>

      <footer className="ebay-revise-footer"><span>{errors.length?`还有 ${errors.length} 项必须修改后才能保存`:'保存标题、描述、价格、状况、数量、SKU、类目属性与政策所在地；库存与业务政策仍只在 eBay 页面生效'}</span><button type="button" disabled={saving||preparing} onClick={onClose}>取消</button><button type="button" disabled={saving||preparing||uploading||errors.length>0} onClick={onSave}>{saving?'正在保存…':'保存本地新版本'}</button><button className="primary" type="button" disabled={saving||preparing||uploading||errors.length>0} onClick={onPrepare}>{preparing?route.preparing:route.prepare}</button></footer>
    </div>
  </div>
}
