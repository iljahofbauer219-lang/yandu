import { useEffect, useMemo, useRef, useState } from 'react'
import type { EbayItemSpecific, EbayLocalProduct, EbayLocalProductUpdateInput, EbayStoreBusinessPolicy, EbayStoreCategory } from '../shared/contracts'
import { formatFormGaps, type EbayFormGap } from '../shared/ebayListingForm'
import { checkEbayPolicyCarrierItemId } from '../shared/ebayPolicyCarrier'
import type { EbayListingRouteKind } from '../shared/ebayListingTarget'
import type { EbayItemSpecificSlot } from '../shared/ebayItemSpecificsModel'
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
  /** 本次会话里从 eBay 现网 ITEM SPECIFICS 段读回的槽位清单；为空即「还没读过」，段体退回本地清单态 */
  attributeSlots?:EbayItemSpecificSlot[]
  /** 上面那份清单的抓取时刻（requirements.inspectedAt）；清单只活在本次会话，不落库，故时间必须显式标出 */
  attributeSlotsAt?:string
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
  if(draft.media.length>24)error('media','商品图片不能超过 24 张')
  downloaded.filter(item=>item.width&&item.height&&Math.max(item.width,item.height)<500).forEach((_,index)=>error('media',`第 ${index+1} 张图片最长边不足 500px`))
  if(downloaded.length>0&&downloaded.length<3)warning('media','建议保留多个角度的高清商品图片')
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

export default function EbayLocalListingEditor({product,draft,saving,uploading,preparing,categories,onChange,onSave,onClose,onUpload,onPrepare,onSetCategory,onAutoClassify,platformCategory,gaps,businessPolicies,readingPolicies,onReadPolicies,policyCarrierItemId,onPolicyCarrierItemIdChange,routeKind='revise',attributeSlots=[],attributeSlotsAt='',inline}:Props) {
  const fileInput=useRef<HTMLInputElement>(null)
  const [draggedId,setDraggedId]=useState('')
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
  const essentialSlots=attributeSlots.filter(item=>item.group==='ESSENTIAL')
  const optionalSlots=attributeSlots.filter(item=>item.group!=='ESSENTIAL')
  const slottedNames=new Set(attributeSlots.map(item=>specificKey(item.name)))
  const localOnlySpecifics=indexedSpecifics.filter(entry=>!slottedNames.has(specificKey(entry.item.name)))
  // 槽位清单只在本次会话里活着（不落库），故把抓取时刻显式标出来；没给时间就不谎报「已读取于……」。
  const stampText=(iso:string)=>iso?new Date(iso).toLocaleString('zh-CN',{hour12:false}):''
  const attributeSlotsAtText=attributeSlots.length?stampText(attributeSlotsAt):''
  const slotRow=(slot:EbayItemSpecificSlot)=>{
    const localIndex=specifics.findIndex(item=>specificKey(item.name)===specificKey(slot.name))
    const local=localIndex>=0?specifics[localIndex]:undefined
    const value=local?.value??''
    const writeSlotValue=(next:string)=>{
      const list=[...specifics]
      // 现网槽位不一定已有本地行：新增行按同名匹配键写入 itemSpecifics，准备阶段与本地行共用同一份值。
      if(localIndex>=0)list[localIndex]={...list[localIndex],value:next,source:'MANUAL',needsConfirmation:false}
      else list.push({name:slot.name,value:next,source:'MANUAL',needsConfirmation:false})
      set('itemSpecifics',list)
    }
    return (
      <div className="ebay-specific-row ebay-specific-row--slot" key={slot.name}>
        <span className={`ebay-specific-label${slot.required?' required':''}`} title={slot.name}>{slot.name}{slot.required&&<i className="ebay-specific-star" aria-label="eBay 必填属性">*</i>}</span>
        <div className="ebay-specific-control">
          {slot.control==='MENU'?(
            <div className="ebay-specific-menu">
              <input name={slot.name} value={value} placeholder={slot.placeholder} onChange={event=>writeSlotValue(event.target.value)}/>
              <i className="ebay-specific-menu-caret" aria-hidden="true">▾</i>
            </div>
          ):slot.control==='TEXTAREA'?(
            <textarea name={slot.name} value={value} placeholder={slot.placeholder} rows={3} maxLength={slot.maxLength||undefined} onChange={event=>writeSlotValue(event.target.value)}/>
          ):(
            <input name={slot.name} value={value} placeholder={slot.placeholder} onChange={event=>writeSlotValue(event.target.value)}/>
          )}
          {slot.control==='TEXTAREA'&&slot.maxLength>0&&<span className="ebay-specific-counter">{`${value.length}/${slot.maxLength}`}</span>}
          {slot.suggested&&<button type="button" className="ebay-specific-suggested" onClick={()=>writeSlotValue(slot.suggested)}>{`Suggested: ${slot.suggested}`}</button>}
          {Boolean(slot.value)&&slot.value!==value&&<em className="ebay-specific-live">{`eBay 线上原值：${slot.value}`}</em>}
          {local?.source&&<em className="ebay-specific-source">{`${SOURCE_LABELS[local.source]}${local.needsConfirmation?' · 待确认':''}`}</em>}
        </div>
      </div>
    )
  }
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
          <section id="ebay-revise-media" className="ebay-revise-band ebay-revise-media-section">
            <header className="ebay-revise-band-head"><div><h2>图片与视频</h2><p>本地保存商品媒体；拖动可排序，第一张图片为主图。</p></div><span className="ebay-band-counter" data-ebay-slot="section-action" data-ebay-counter="photos">{draft.media.length}/24</span></header>
            <div className="ebay-photo-strip">
              {draft.media.map((media,index)=><figure key={media.id} draggable onDragStart={()=>setDraggedId(media.id)} onDragEnd={()=>setDraggedId('')} onDragOver={event=>event.preventDefault()} onDrop={()=>moveMedia(draggedId,media.id)} data-dragging={draggedId===media.id?'true':undefined} className={index===0?'ebay-photo-tile main':'ebay-photo-tile'}>
                {media.mediaType==='VIDEO'?(
                  <div className="ebay-photo-video">
                    <video src={mediaUrl(media.localPath,media.remoteUrl)} muted playsInline/>
                    <span className="ebay-photo-play">▶</span>
                  </div>
                ):(
                  <img src={mediaUrl(media.localPath,media.remoteUrl)} alt={`商品图片 ${index+1}`}/>
                )}
                <figcaption>{media.mediaType==='VIDEO'?`Video ${index+1}`:`Photo ${index+1}`}</figcaption>
                <div className="ebay-photo-tools"><button type="button" onClick={()=>makeMain(media.id)} disabled={media.mediaType==='VIDEO'}>{index===0?'Main':media.mediaType==='VIDEO'?'视频':'设为主图'}</button><button type="button" aria-label="删除媒体" onClick={()=>removeMedia(media.id)}>×</button></div>
              </figure>)}
              {draft.media.length<24&&<button className="ebay-photo-add" type="button" disabled={uploading} onClick={()=>fileInput.current?.click()}><strong>{uploading?'…':'＋'}</strong><span>{uploading?'正在添加':'添加照片'}</span></button>}
            </div>
            <input ref={fileInput} hidden type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" onChange={event=>{onUpload(Array.from(event.target.files||[]));event.currentTarget.value=''}}/>
          </section>

          <section id="ebay-revise-title" className="ebay-revise-band">
            <header className="ebay-revise-band-head"><div><h2>标题</h2><p>只保存买家在商品页看到的主标题。</p></div><span className="ebay-band-counter" data-ebay-slot="section-action" data-ebay-counter="title">{draft.title.length}/80</span></header>
            <label className="ebay-revise-field"><span>物品标题</span><div><input maxLength={80} value={draft.title} onChange={event=>set('title',event.target.value)}/></div></label>
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
            <header className="ebay-revise-band-head"><div><h2>类目</h2><p>与 eBay 修改页同序：左栏平台类目（eBay Item category），右栏店铺类目（Store category）。</p></div><span data-ebay-slot="section-action">{platformCategory?.savedName||product.categoryName||'未分类'}</span></header>
            <div className="ebay-revise-cols">
              <div className="ebay-revise-category-row" data-ebay-col="left">
                <h3>平台类目</h3>
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
                <h3>店铺类目</h3>
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
                {essentialSlots.length>0&&<h3 className="ebay-specific-group">Essential</h3>}
                {essentialSlots.map(slotRow)}
                {optionalSlots.length>0&&<h3 className="ebay-specific-group">Optional</h3>}
                {optionalSlots.map(slotRow)}
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
