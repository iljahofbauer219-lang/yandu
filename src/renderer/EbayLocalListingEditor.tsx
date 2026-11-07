import { useEffect, useMemo, useRef, useState } from 'react'
import type { EbayItemSpecific, EbayLocalProduct, EbayLocalProductUpdateInput, EbayStoreBusinessPolicy, EbayStoreCategory } from '../shared/contracts'
import { formatFormGaps, type EbayFormGap } from '../shared/ebayListingForm'
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
  inline?:boolean
}

type ValidationIssue={level:'ERROR'|'WARNING';section:string;message:string}

function validateDraft(draft:EbayLocalProductUpdateInput):ValidationIssue[] {
  const issues:ValidationIssue[]=[]
  const error=(section:string,message:string)=>issues.push({level:'ERROR',section,message})
  const warning=(section:string,message:string)=>issues.push({level:'WARNING',section,message})
  const title=draft.title.trim()
  if(!title)error('title','物品标题不能为空')
  if(title.length>80)error('title','物品标题不能超过 80 个字符')
  if(/[©®™]/.test(title))warning('title','标题含特殊符号，发布前请确认商标与知识产权风险')
  const downloaded=draft.media.filter(item=>item.downloadStatus==='DOWNLOADED'&&(item.localPath||item.remoteUrl))
  if(!downloaded.length)error('media','至少需要 1 张已保存到本地的商品图片')
  if(draft.media.length>24)error('media','商品图片不能超过 24 张')
  downloaded.filter(item=>item.width&&item.height&&Math.max(item.width,item.height)<500).forEach((_,index)=>error('media',`第 ${index+1} 张图片最长边不足 500px`))
  if(downloaded.length>0&&downloaded.length<3)warning('media','建议保留多个角度的高清商品图片')
  if(!draft.descriptionText.trim()&&!draft.descriptionHtml.trim())error('description','商品描述不能为空')
  if(!Number.isFinite(Number(draft.price))||Number(draft.price)<=0)error('pricing','价格必须是大于 0 的数字')
  if(!/^[A-Z]{3}$/.test(draft.currency.trim()))error('pricing','币种必须使用 3 位大写代码，例如 USD')
  const quantity=draft.quantity===undefined?'':draft.quantity.trim()
  if(quantity&&!/^[1-9]\d{0,5}$/.test(quantity))error('form','数量必须是大于 0 的整数')
  if(draft.listingFormat&&!['FIXED_PRICE','AUCTION'].includes(draft.listingFormat))error('form','刊登格式只能是「现在购买」或「拍卖」')
  if((draft.sku||'').trim().length>50)error('form','自定义编号（SKU）不能超过 50 个字符')
  if((draft.postalCode||'').trim()&&!/^[A-Za-z0-9][A-Za-z0-9 -]{2,11}$/.test(draft.postalCode!.trim()))error('form','所在地邮编格式不正确')
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

export default function EbayLocalListingEditor({product,draft,saving,uploading,preparing,categories,onChange,onSave,onClose,onUpload,onPrepare,onSetCategory,onAutoClassify,platformCategory,gaps,businessPolicies,readingPolicies,onReadPolicies,inline}:Props) {
  const fileInput=useRef<HTMLInputElement>(null)
  const [draggedId,setDraggedId]=useState('')
  const [descriptionMode,setDescriptionMode]=useState<'TEXT'|'HTML'>('TEXT')
  const issues=useMemo(()=>validateDraft(draft),[draft])
  const errors=issues.filter(item=>item.level==='ERROR')
  const warnings=issues.filter(item=>item.level==='WARNING')
  const priceCurrency=draft.currency.trim().toUpperCase()||'USD'
  const priceSymbol=({USD:'$',GBP:'£',EUR:'€',CAD:'CA$',AUD:'A$',CNY:'¥',RMB:'¥'} as Record<string,string>)[priceCurrency]||priceCurrency
  const set=<K extends keyof EbayLocalProductUpdateInput>(key:K,value:EbayLocalProductUpdateInput[K])=>onChange({...draft,[key]:value})
  const SOURCE_LABELS:Record<NonNullable<EbayItemSpecific['source']>,string>={SOURCE_PAGE:'源页抓取',ENUM_MATCH:'枚举匹配',AI:'AI 推断',MANUAL:'人工确认',CATEGORY_DEFAULT:'类目记忆'}
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
        <em>仅保存图片、标题、描述和价格，不修改线上刊登</em>
        <button type="button" aria-label="关闭编辑器" disabled={saving} onClick={onClose}>×</button>
      </header>

      <main className="ebay-revise-body">
        <section className={`ebay-revise-validation ${errors.length?'blocked':'ready'}`}>
          <div><strong>{errors.length?`${errors.length} 项必须修改`:'四项核心资料已通过'}</strong><span>{warnings.length} 项建议优化 · 本地产品只保留四个核心部分</span></div>
          {issues.length>0&&<details><summary>查看检查明细</summary><div>{issues.map((issue,index)=><button type="button" key={`${issue.section}-${index}`} className={issue.level.toLowerCase()} onClick={()=>document.getElementById(`ebay-revise-${issue.section}`)?.scrollIntoView({behavior:'smooth',block:'start'})}><b>{issue.level==='ERROR'?'必须修改':'建议优化'}</b><span>{issue.message}</span></button>)}</div></details>}
        </section>

        <section className="ebay-revise-section ebay-revise-category-section">
          <header><div><h2>类目</h2><p>送入时按标题与原类目自动归入店铺类目树；未匹配可在此重跑自动分类或手工选择。</p></div><span>{product.categoryName||'未分类'}</span></header>
          <div className="ebay-revise-category-row">
            <select aria-label="本地产品类目" value={product.categoryId} onChange={event=>{const found=categories.find(item=>item.categoryId===event.target.value);if(found)onSetCategory(found.categoryId,found.name)}}>
              <option value="">未分类</option>
              {categories.map(item=><option key={item.categoryId} value={item.categoryId}>{'　'.repeat(Math.max(0,item.level-1))}{item.name}</option>)}
            </select>
            <button type="button" onClick={onAutoClassify}>自动分类</button>
          </div>
        </section>

        {platformCategory&&(
          <section className="ebay-revise-section ebay-revise-category-section">
            <header><div><h2>平台类目</h2><p>按核心商品词的 eBay prelist「Find a match」推荐类目；默认选中 Best match，可下拉改选后确定。</p></div><span>{platformCategory.savedName||'未选择'}</span></header>
            <div className="ebay-revise-category-row">
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
            </div>
            {platformCategory.error&&<p className="ebay-revise-category-error" role="alert">{platformCategory.error}</p>}
          </section>
        )}

        <section id="ebay-revise-media" className="ebay-revise-section ebay-revise-media-section">
          <header><div><h2>01 图片与视频</h2><p>本地保存商品媒体；拖动可排序，第一张图片为主图。</p></div><span>{draft.media.length}/24</span></header>
          <div className="ebay-revise-media-layout">
            <figure className="ebay-revise-main-media">
              {draft.media[0]?(
                draft.media[0].mediaType==='VIDEO'?(
                  <div className="ebay-revise-main-media-video">
                    <video src={mediaUrl(draft.media[0].localPath,draft.media[0].remoteUrl)} muted playsInline controls/>
                  </div>
                ):(
                  <img src={mediaUrl(draft.media[0].localPath,draft.media[0].remoteUrl)} alt="商品主图"/>
                )
              ):<div>尚未添加图片</div>}
              {draft.media[0]&&<figcaption>{draft.media[0].mediaType==='VIDEO'?'Video':'Main'}</figcaption>}
            </figure>
            <div className="ebay-revise-media-grid">
              {draft.media.map((media,index)=><figure key={media.id} draggable onDragStart={()=>setDraggedId(media.id)} onDragEnd={()=>setDraggedId('')} onDragOver={event=>event.preventDefault()} onDrop={()=>moveMedia(draggedId,media.id)} className={draggedId===media.id?'dragging':''}>
                {media.mediaType==='VIDEO'?(
                  <div className="ebay-revise-media-video">
                    <video src={mediaUrl(media.localPath,media.remoteUrl)} muted playsInline/>
                    <div className="ebay-revise-media-play-icon">▶</div>
                  </div>
                ):(
                  <img src={mediaUrl(media.localPath,media.remoteUrl)} alt={`商品图片 ${index+1}`}/>
                )}
                <div><button type="button" onClick={()=>makeMain(media.id)} disabled={media.mediaType==='VIDEO'}>{index===0?'主图':media.mediaType==='VIDEO'?'视频':'设为主图'}</button><button type="button" aria-label="删除媒体" onClick={()=>removeMedia(media.id)}>×</button></div>
              </figure>)}
              {draft.media.length<24&&<button className="ebay-revise-add-media" type="button" disabled={uploading} onClick={()=>fileInput.current?.click()}><strong>{uploading?'…':'＋'}</strong><span>{uploading?'正在添加':'添加照片'}</span></button>}
            </div>
          </div>
          <input ref={fileInput} hidden type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" onChange={event=>{onUpload(Array.from(event.target.files||[]));event.currentTarget.value=''}}/>
        </section>

        <section id="ebay-revise-title" className="ebay-revise-section">
          <header><div><h2>02 标题</h2><p>只保存买家在商品页看到的主标题。</p></div></header>
          <label className="ebay-revise-field"><span>物品标题</span><div><input maxLength={80} value={draft.title} onChange={event=>set('title',event.target.value)}/><small>{draft.title.length}/80</small></div></label>
        </section>

        <section id="ebay-revise-description" className="ebay-revise-section">
          <header><div><h2>03 描述</h2><p>保留可供 AI 诊断和优化的纯文本与原始 HTML。</p></div><div className="ebay-revise-segment"><button className={descriptionMode==='TEXT'?'active':''} type="button" onClick={()=>setDescriptionMode('TEXT')}>文本</button><button className={descriptionMode==='HTML'?'active':''} type="button" onClick={()=>setDescriptionMode('HTML')}>HTML</button></div></header>
          {descriptionMode==='TEXT'?<textarea className="ebay-revise-description" value={draft.descriptionText} onChange={event=>set('descriptionText',event.target.value)}/>:<textarea className="ebay-revise-description code" value={draft.descriptionHtml} onChange={event=>set('descriptionHtml',event.target.value)}/>} 
        </section>

        <section id="ebay-revise-pricing" className="ebay-revise-section ebay-revise-pricing-section">
          <header><div><h2>04 定价</h2><p>直接使用 eBay 原刊登币种与售价，作为后续成本和利润核算基准。</p></div></header>
          <div className="ebay-revise-pricing-form">
            <label className="ebay-revise-format-field"><span>格式</span><select disabled value="FIXED_PRICE"><option value="FIXED_PRICE">现在购买</option></select></label>
            <label className="ebay-revise-price-field"><span>商品价格</span><div><b>{priceSymbol}</b><input aria-label={`商品价格（${priceCurrency}）`} inputMode="decimal" value={draft.price} onChange={event=>set('price',event.target.value)}/></div><small>{priceCurrency} · eBay 原刊登币种</small></label>
          </div>
        </section>

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
      </main>

      <footer className="ebay-revise-footer"><span>{errors.length?`还有 ${errors.length} 项必须修改后才能保存`:'仅保存四项核心内容；类目、库存、SKU、属性和政策不写入新版本'}</span><button type="button" disabled={saving||preparing} onClick={onClose}>取消</button><button type="button" disabled={saving||preparing||uploading||errors.length>0} onClick={onSave}>{saving?'正在保存…':'保存本地新版本'}</button><button className="primary" type="button" disabled={saving||preparing||uploading||errors.length>0} onClick={onPrepare}>{preparing?'正在准备 Seller Hub…':'保存并准备到 eBay'}</button></footer>
    </div>
  </div>
}
