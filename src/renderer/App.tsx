import { FormEvent, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { BrowserState, BrowserTab, BrowserTranslationMode, CandidateCollectionRecord, CandidateCollectionRun, CandidateArea, CollectionMethod, CollectionProtectionMode, CollectedOzonProduct, CollectedSupplyProduct, CollectorPluginProduct, ComparisonCostSettings, ComparisonDecision, ComparisonRecordView, ComplianceAlertStatus, ComplianceCategoryTemplateDraft, ComplianceCheckRequest, ComplianceCheckResult, ComplianceDocumentDraft, ComplianceDocumentRecord, ComplianceEnforcementStatus, ComplianceKnowledgeWorkspace, ComplianceProductProfileDraft, ComplianceReviewStatus, ComplianceRiskLevel, ComplianceRule, ComplianceRuleDraft, ComplianceTaskStatus, EbayAcceptanceBatch, EbayCategoryWorkspace, EbayCollectedProduct, EbayConfigurationStatus, EbayContentOptimizationResult, EbayContentTranslationResult, EbayDirectoryProductSyncCheckpoint, EbayDirectoryProductSyncProgress, EbayDirectoryProductSyncResult, EbayImageCandidateReview, EbayImageGenerationPurpose, EbayImageGroundingPlan, EbayImageInspectionReport, EbayImageVisualInspectionReport, EbayImageVisualRuleCode, EbayListing, EbayLocalProduct, EbayLocalProductUpdateInput, EbayLoginResult, EbayMarketResearchSnapshot, EbayOptimizationDraft, EbayProductSyncRun, EbayPublishTask, EbayStore, EbayTitleOptimizationResult, GigaReturnRateFilter, GigaSellerIndexFilter, ImageGenerationResult, ImageModelProfile, MarketplaceAccountProfile, MarketplaceMediaAsset, MarketplacePlatformCode, MarketplacePlatformProfile, MarketplacePublishAudit, MarketplacePublishDraft, MarketplacePublishStatus, MarketplaceSelectionProduct, NetworkStrategy, Platform, RealShiftProfile, RealShiftResult, SelectionCatalogItem, SelectionDecision, SelectionTask, SelectionTaskDraft, SupplyActivationResult, SupplyPlatformCode, SupplyWarehouseProduct, TaskProgress, WorkflowCounts } from '../shared/contracts'
import { evaluateEbayCompliance } from '../shared/ebayComplianceKnowledge'
import { complianceCheckFingerprint } from '../shared/complianceFingerprint'
import { buildEbayMarketDecisionReport } from '../shared/ebayMarketDecision'
import { auditEbayTitle } from '../shared/ebayTitleAudit'
import type { EbayTitleDecision } from '../shared/contracts'
import gigaCatalog from './gigaCatalog.json'
import EbayLocalListingEditor from './EbayLocalListingEditor'
import { EbayVisualCompliancePanel } from './EbayVisualCompliancePanel'
import EbayVideoStudio from './EbayVideoStudio'
import './ebay-collection.css'

type AppPage = 'ebay' | 'compliance-knowledge' | 'warehouse-dashboard' | 'tasks' | 'ozon' | 'sourcing' | 'comparison' | 'review' | 'catalog' | 'image-studio' | 'realshift' | 'publishing' | 'procurement' | 'finance' | 'ai-support' | 'feishu'
type EbayWorkspaceTab = 'browser' | 'library' | 'local' | 'optimize' | 'premium' | 'publish'
type ImageSourceProduct = CollectedOzonProduct | CollectedSupplyProduct | SupplyWarehouseProduct
type ProductWarehouseCode = 'GIGACLOUD' | 'ALIEXPRESS' | '1688' | 'OZON'
type EbayImagePurpose = EbayImageGenerationPurpose
type EbayImageShot = { purpose:EbayImagePurpose; index:number; total:number; code:string; title:string; instruction:string; evidence:string; acceptance:string; prohibited:string }
type EbayImageSourceRole = 'HERO'|'FRONT'|'SIDE'|'BACK'|'DETAIL'|'INSTALLATION'|'SIZE'|'PAIN_POINT'|'SCENE'|'UNUSED'
type EbayImageSourceCurationEntry = { enabled:boolean; role:EbayImageSourceRole }
type EbayImageSourceCuration = Record<string,EbayImageSourceCurationEntry>

const ebayImagePurposes:EbayImagePurpose[]=['HERO','DETAIL','PAIN_POINT','SCENE']
const ebayImagePurposeLabels:Record<EbayImagePurpose,string>={HERO:'产品主图',DETAIL:'产品详情图',PAIN_POINT:'解决痛点图',SCENE:'应用场景图'}
const ebayImageSourceRoles:EbayImageSourceRole[]=['HERO','FRONT','SIDE','BACK','DETAIL','INSTALLATION','SIZE','PAIN_POINT','SCENE','UNUSED']
const ebayImageSourceRoleLabels:Record<EbayImageSourceRole,string>={HERO:'主图',FRONT:'正面',SIDE:'侧面',BACK:'背面',DETAIL:'细节',INSTALLATION:'安装/结构',SIZE:'尺寸参照',PAIN_POINT:'痛点依据',SCENE:'应用场景',UNUSED:'不使用'}
const ebayImageSourceMaxReferences=8
const ebayFixedImageModelId='wan2.7-image-pro'
const ebayImageReferenceRolePreferences:Record<EbayImagePurpose,EbayImageSourceRole[]>={
  HERO:['HERO','FRONT','SIDE','DETAIL'],
  DETAIL:['DETAIL','SIDE','BACK','INSTALLATION','SIZE','FRONT'],
  PAIN_POINT:['PAIN_POINT','DETAIL','INSTALLATION','SIZE','HERO','FRONT'],
  SCENE:['SCENE','HERO','FRONT','SIDE','DETAIL']
}
const ebayImageSourceCurationKey=(listingId:string)=>`ebay-image-source-curation:v1:${listingId}`

function readEbayImageSourceCuration(listingId:string):EbayImageSourceCuration {
  if(!listingId)return {}
  try {
    const value=JSON.parse(localStorage.getItem(ebayImageSourceCurationKey(listingId))||'{}')
    return value&&typeof value==='object'?value as EbayImageSourceCuration:{}
  } catch { return {} }
}

function saveEbayImageSourceCuration(listingId:string,curation:EbayImageSourceCuration) {
  if(listingId)localStorage.setItem(ebayImageSourceCurationKey(listingId),JSON.stringify(curation))
}

function normalizeEbayImageSourceCuration(images:string[],saved:EbayImageSourceCuration):EbayImageSourceCuration {
  return Object.fromEntries(images.map((url,index)=>{
    const existing=saved[url]
    const defaultEnabled=index<ebayImageSourceMaxReferences
    const role=existing&&ebayImageSourceRoles.includes(existing.role)?existing.role:(index===0?'HERO':defaultEnabled?'DETAIL':'UNUSED')
    return [url,{enabled:role==='UNUSED'?false:(existing?.enabled??defaultEnabled),role}]
  })) as EbayImageSourceCuration
}

function ebayImageGenerationPlan(total:number):Record<EbayImagePurpose,number> {
  const count=Math.min(20,Math.max(4,Math.round(total)||8))
  const plan:Record<EbayImagePurpose,number>={HERO:1,DETAIL:1,PAIN_POINT:1,SCENE:1}
  const cycle:EbayImagePurpose[]=['DETAIL','PAIN_POINT','SCENE','DETAIL','HERO','DETAIL','PAIN_POINT','SCENE']
  for(let index=0;index<count-4;index+=1)plan[cycle[index%cycle.length]]+=1
  return plan
}

function ebayImageShotPlan(total:number,content?:EbayContentOptimizationResult|null):EbayImageShot[] {
  const counts=ebayImageGenerationPlan(total)
  const templates:Record<EbayImagePurpose,string[]>={
    HERO:[
      'Show the complete sellable product in a straight-on, centered studio view on a pure white background. This is the primary listing image, so no props, text, packaging claims, measurements or decorative setting.',
      'Show the complete sellable product from a clearly different three-quarter studio angle on a pure white background. Keep every visible product fact identical to the references.'
    ],
    DETAIL:[
      'Create a close product-detail shot focused on one verified material, finish, construction joint, closure or included component. The exact visible detail must be supported by the reference images.',
      'Create a different close product-detail shot focused on a second verified structure, side, back, installation point or functional feature. Do not reuse the previous detail angle or crop.',
      'Create a product-detail shot that explains verified scale, assembly or included parts visually without any words, labels, measurement marks or invented accessories.'
    ],
    PAIN_POINT:[
      'Create a product-led solution shot for one verified customer pain point. Make the relevant verified feature visually obvious through real use or construction, without before-and-after framing, claims or added text.',
      'Create a distinctly different product-led solution shot for another verified customer pain point or buying reason. Change the camera task and the demonstrated feature, not just the background.'
    ],
    SCENE:[
      'Place the exact verified product in one plausible, evidence-supported use scenario. Use a wide environmental composition while keeping the sellable product clearly dominant and recognizable.',
      'Place the exact verified product in a second plausible, evidence-supported use scenario with a different viewpoint, distance and real activity. Do not repeat the previous scene composition.'
    ]
  }
  const labels:Record<EbayImagePurpose,string[]>={
    HERO:['白底正面主图','白底三分之四主图'],
    DETAIL:['材质或工艺细节','结构或功能细节','安装与配件细节'],
    PAIN_POINT:['痛点解决展示','购买理由展示'],
    SCENE:['核心应用场景','第二应用场景']
  }
  const acceptance:Record<EbayImagePurpose,string>={
    HERO:'完整商品主体、白底、无文字、无道具',
    DETAIL:'展示指定已核实细节，且与其他细节图角度不同',
    PAIN_POINT:'可见地对应已核实痛点或购买理由，不使用夸张文案',
    SCENE:'真实可行的使用环境，商品主体清晰且占画面重点'
  }
  const prohibited:Record<EbayImagePurpose,string>={
    HERO:'禁止场景、包装、促销元素、裁切主体',
    DETAIL:'禁止仅换背景、重复裁切、凭空增加部件',
    PAIN_POINT:'禁止前后对比、功效承诺、文字标签',
    SCENE:'禁止改变产品事实、模糊商品主体、重复同一场景'
  }
  return ebayImagePurposes.flatMap(purpose=>Array.from({length:counts[purpose]},(_,index)=>{
    const benefit=content?.benefits?.length?content.benefits[index%content.benefits.length]:undefined
    const scenario=content?.scenarios?.length?content.scenarios[index%content.scenarios.length]:undefined
    const baseInstruction=templates[purpose][index%templates[purpose].length]
    const instruction=purpose==='PAIN_POINT'&&benefit
      ? `${baseInstruction} The only customer problem to demonstrate is: ${benefit.painPoint}. Show this verified solution: ${benefit.solution}. Make this verified buyer benefit visible without text: ${benefit.customerBenefit}.`
      :purpose==='SCENE'&&scenario
        ? `${baseInstruction} The required use scenario is: ${scenario.title}. ${scenario.description}.`
        :baseInstruction
    const evidence=purpose==='PAIN_POINT'
      ? benefit?`已核实痛点：${benefit.painPoint}；对应方案：${benefit.solution}；购买利益：${benefit.customerBenefit}。`:'未生成已核实痛点资料；仅可展示原图可直接证明的结构或功能，不得虚构痛点。'
      :purpose==='SCENE'
        ? scenario?`已核实应用场景：${scenario.title}；${scenario.description}。`:'未生成已核实应用场景；只能使用原图可直接证明的使用环境，不得虚构。'
        :purpose==='DETAIL'
          ? '仅展示原图中可见、已核实的结构、材质、尺寸或安装事实；镜头必须区别于其他详情图。'
          : '完整展示原图可验证的商品主体和事实，不得加入任何未核实信息。'
    return {purpose,index,total:counts[purpose],code:`${purpose}-${String(index+1).padStart(2,'0')}`,title:labels[purpose][index%labels[purpose].length],instruction,evidence,acceptance:acceptance[purpose],prohibited:prohibited[purpose]}
  }))
}

const ebayImageUsageKey=()=>`ebay-image-model-usage:${new Date().toISOString().slice(0,7)}`

function readEbayImageUsage():Record<string,number> {
  try { return JSON.parse(localStorage.getItem(ebayImageUsageKey())||'{}') as Record<string,number> }
  catch { return {} }
}

function saveEbayImageUsage(usage:Record<string,number>) {
  localStorage.setItem(ebayImageUsageKey(),JSON.stringify(usage))
}

function ebayImageModelQualityScore(review:EbayImageCandidateReview){
  return review.identityScore*.35+review.structuralScore*.25+review.factScore*.2+review.purposeScore*.2
}

function ebayImageCandidateStatus(review?:EbayImageCandidateReview){
  if(!review)return '等待自动审核'
  if(review.status==='PASSED')return `已通过 · 商品 ${review.identityScore} · 镜头 ${review.purposeScore} · 差异 ${review.diversityScore}`
  return review.status==='REVIEW'?'自动审核未完成，暂不可采用':'未通过质量门槛，需重新生成'
}

function ImageNaturalizePanel({purposes,purpose,onPurpose,profile,onProfile,results,choices,busy,onRun,onConfirm}:{purposes:EbayImagePurpose[];purpose:EbayImagePurpose;onPurpose:(purpose:EbayImagePurpose)=>void;profile:RealShiftProfile;onProfile:(profile:RealShiftProfile)=>void;results:Partial<Record<EbayImagePurpose,RealShiftResult>>;choices:Partial<Record<EbayImagePurpose,'original'|'processed'>>;busy:string;onRun:()=>void;onConfirm:(choice:'original'|'processed')=>void}) {
  const result=results[purpose]
  return <>
    <div className="ebay-naturalize-purpose">{purposes.map(value=><button type="button" className={purpose===value?'active':''} key={value} onClick={()=>onPurpose(value)}><b>{ebayImagePurposeLabels[value]}</b><small>{choices[value]?'✓ 最终版已确认':results[value]?'待对比确认':'待处理'}</small></button>)}</div>
    <div className="ebay-naturalize-controls"><div><b>处理强度</b><button type="button" className={profile==='light'?'active':''} onClick={()=>onProfile('light')}><strong>轻度（推荐）</strong><small>轻微纹理与色彩微调，更适合商品图</small></button><button type="button" className={profile==='balanced'?'active':''} onClick={()=>onProfile('balanced')}><strong>均衡</strong><small>调整更明显，必须仔细人工核对细节</small></button></div><aside><b>处理边界</b><span>✓ 本地处理、保留尺寸与原图</span><span>✓ 输出前后对比与处理报告</span><span>✕ 不删除第三方水印</span><span>✕ 不承诺规避平台检测</span></aside></div>
    <button className="primary ebay-naturalize-run" disabled={busy===`naturalize-image:${purpose}`} onClick={onRun}>{busy===`naturalize-image:${purpose}`?'本地处理中…':result?'按当前强度重新处理':'开始本地自然化处理'}</button>
    {result&&<div className="ebay-naturalize-result"><div className="ebay-naturalize-compare"><figure><img src={result.originalDataUrl} alt="第二阶段确认稿"/><figcaption>第二阶段确认稿</figcaption></figure><figure><img src={result.processedDataUrl} alt="自然化处理图"/><figcaption>自然化处理图</figcaption></figure></div><div className="ebay-naturalize-report"><header><b>本地处理报告</b><small>参考值仅用于前后对比，不是 eBay 官方判定。</small></header><div><span><b>{Math.round((1-result.processedScore.risk)*100)}</b><small>自然度参考</small></span><span><b>{result.processedScore.entropy.toFixed(2)}</b><small>细节熵</small></span><span><b>{result.processedScore.high_frequency.toFixed(2)}</b><small>高频细节</small></span><span><b>{result.chosenIteration}</b><small>选中迭代</small></span></div><p>请确认商品形状、结构、颜色、材质、配件和文字均未发生错误。确认后才会成为最终本地优化图。</p><footer><button disabled={busy===`naturalize-confirm:${purpose}`} onClick={()=>onConfirm('original')}>{choices[purpose]==='original'?'✓ 已保留原稿':'保留第二阶段原稿'}</button><button className="primary" disabled={busy===`naturalize-confirm:${purpose}`} onClick={()=>onConfirm('processed')}>{choices[purpose]==='processed'?'✓ 已采用自然化图':'确认采用自然化图'}</button></footer></div></div>}
  </>
}

function ebayContentTranslationSource(englishDescription:string) {
  return englishDescription.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map((english,index)=>({id:`P${String(index+1).padStart(3,'0')}`,english}))
}

function reconcileEbayContentTranslation(englishDescription:string,translation:EbayContentTranslationResult):EbayContentTranslationResult {
  const reusable=new Map<string,typeof translation.segments>()
  for(const segment of translation.segments)reusable.set(segment.english,[...(reusable.get(segment.english)||[]),segment])
  const segments=ebayContentTranslationSource(englishDescription).map(source=>{
    const pool=reusable.get(source.english)||[]
    const previous=pool.shift()
    reusable.set(source.english,pool)
    return previous?{...previous,id:source.id}:{id:source.id,english:source.english,chinese:'',sourceHash:'',status:'STALE' as const}
  })
  return {...translation,segments}
}

function ebayDisplayImage(url:string) {
  return url.replace(/\/s-l\d+(?=\.[a-z]+(?:\?|$))/i,'/s-l1600')
}

function ebayDisplayPrice(currency:string,price:string) {
  const code=currency.trim()||'USD'
  const numeric=Number(price.replace(/,/g,''))
  return Number.isFinite(numeric)&&numeric>0?`${code} ${new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(numeric)}`:`${code} --`
}

function ebayLocalMediaUrl(localPath:string,remoteUrl:string) {
  return localPath?`cross-media://local/${encodeURIComponent(localPath)}`:remoteUrl
}

function ebayLocalProductDraft(product:EbayLocalProduct):EbayLocalProductUpdateInput {
  const {details,sourceListing}=product.snapshot
  return {
    title:details.title||sourceListing.title,
    descriptionText:details.descriptionText||'',
    descriptionHtml:details.descriptionHtml||'',
    price:details.price||sourceListing.price,
    currency:details.currency||sourceListing.currency,
    media:[...product.snapshot.media].sort((left,right)=>left.sortOrder-right.sortOrder)
  }
}

type EbayResearchQuerySource = 'PRODUCT_TYPE'|'TITLE'|'CATEGORY'|'MANUAL'
type EbayResearchQueryPreference = {query:string;source:EbayResearchQuerySource;locked:boolean}
type EbayProfitFeeMode = 'CATEGORY_RULE'|'MANUAL'
type EbayProfitAssumptions = {
  exchangeRate:number
  purchaseCostCny:number
  logisticsCostCny:number
  packagingCostCny:number
  fulfillmentCostCny:number
  otherCostCny:number
  platformFeeMode:EbayProfitFeeMode
  platformFeeRate:number
  platformFixedFeeCny:number
  promotionFeeRate:number
  returnLossRate:number
  riskBufferRate:number
  targetMarginRate:number
}

type EbayNumericProfitField=Exclude<keyof EbayProfitAssumptions,'platformFeeMode'>

const defaultEbayProfitAssumptions:EbayProfitAssumptions={
  exchangeRate:7.2,
  purchaseCostCny:0,
  logisticsCostCny:0,
  packagingCostCny:0,
  fulfillmentCostCny:0,
  otherCostCny:0,
  platformFeeMode:'CATEGORY_RULE',
  platformFeeRate:13.6,
  platformFixedFeeCny:2.88,
  promotionFeeRate:0,
  returnLossRate:0,
  riskBufferRate:0,
  targetMarginRate:25
}
const ebayProfitAssumptionsKey=(productId:string)=>`ebay-profit-assumptions:${productId}`

function ebayCategoryFeeRule(categoryName:string,salePrice:number) {
  const category=categoryName.trim().toLocaleLowerCase()
  if(/musical instruments|乐器/.test(category))return {rate:6.7,label:'乐器类目规则'}
  if(/athletic shoes|运动鞋/.test(category)&&salePrice>=150)return {rate:8,label:'高客单运动鞋规则'}
  if(/books|movies|music|书籍|电影|音乐/.test(category))return {rate:15.3,label:'书籍、影音类目规则'}
  return {rate:13.6,label:categoryName?`${categoryName} · 通用类目规则`:'eBay 美国站通用类目规则'}
}

function readEbayProfitAssumptions(productId:string):EbayProfitAssumptions {
  if(!productId)return defaultEbayProfitAssumptions
  try {
    const saved=JSON.parse(localStorage.getItem(ebayProfitAssumptionsKey(productId))||'null') as Partial<EbayProfitAssumptions>|null
    return {...defaultEbayProfitAssumptions,...saved}
  } catch { return defaultEbayProfitAssumptions }
}

function saveEbayProfitAssumptions(productId:string,assumptions:EbayProfitAssumptions) {
  if(productId)localStorage.setItem(ebayProfitAssumptionsKey(productId),JSON.stringify(assumptions))
}

function ebayMoneyNumber(value:string|undefined) {
  const numeric=Number(String(value||'').replace(/[^0-9.-]/g,''))
  return Number.isFinite(numeric)?numeric:0
}

type EbayPricingStrategy='SELL_THROUGH'|'BALANCED'|'PROFIT'
type EbayCompetitivePricingDecision={researchSnapshotId:string;strategy:EbayPricingStrategy;recommendedPrice:number;currency:string;comparableSampleCount:number;marketLow:number;marketMedian:number;marketHigh:number;expectedProfitCny:number;expectedMarginRate:number;savedAt:string}

const ebayCompetitivePricingKey=(productId:string)=>`ebay-competitive-pricing:${productId}`

function readEbayCompetitivePricingDecision(productId:string):EbayCompetitivePricingDecision|null {
  if(!productId)return null
  try {
    const value=JSON.parse(localStorage.getItem(ebayCompetitivePricingKey(productId))||'null') as Partial<EbayCompetitivePricingDecision>|null
    if(!value||!value.researchSnapshotId||!['SELL_THROUGH','BALANCED','PROFIT'].includes(String(value.strategy)))return null
    const recommendedPrice=Number(value.recommendedPrice)
    if(!Number.isFinite(recommendedPrice)||recommendedPrice<=0)return null
    return {researchSnapshotId:String(value.researchSnapshotId),strategy:value.strategy as EbayPricingStrategy,recommendedPrice,currency:String(value.currency||'USD').toUpperCase(),comparableSampleCount:Math.max(0,Number(value.comparableSampleCount)||0),marketLow:Math.max(0,Number(value.marketLow)||0),marketMedian:Math.max(0,Number(value.marketMedian)||0),marketHigh:Math.max(0,Number(value.marketHigh)||0),expectedProfitCny:Number(value.expectedProfitCny)||0,expectedMarginRate:Number(value.expectedMarginRate)||0,savedAt:String(value.savedAt||'')}
  } catch { return null }
}

function saveEbayCompetitivePricingDecision(productId:string,decision:EbayCompetitivePricingDecision) {
  if(productId)localStorage.setItem(ebayCompetitivePricingKey(productId),JSON.stringify(decision))
}

function ebayMarketPriceNumber(value:string) {
  const values=(String(value||'').match(/\d[\d,.]*/g)||[]).map(token=>Number(token.replace(/,/g,''))).filter(number=>Number.isFinite(number)&&number>0)
  return values.length?values.reduce((sum,number)=>sum+number,0)/values.length:0
}

function ebayPercentile(values:number[],ratio:number) {
  if(!values.length)return 0
  const sorted=[...values].sort((a,b)=>a-b)
  const position=(sorted.length-1)*Math.min(1,Math.max(0,ratio))
  const lower=Math.floor(position)
  const upper=Math.ceil(position)
  return sorted[lower]+(sorted[upper]-sorted[lower])*(position-lower)
}

function ebayPricingTokens(value:string) {
  const stopWords=new Set(['with','from','this','that','the','and','for','new','item','product'])
  return [...new Set(value.toLowerCase().replace(/[^a-z0-9]+/g,' ').split(/\s+/).filter(token=>token.length>2&&!stopWords.has(token)))]
}

const ebayResearchQueryPreferenceKey=(storeId:string,listingId:string)=>`ebay-research-query:${storeId}:${listingId}`

function readEbayResearchQueryPreference(storeId:string,listingId:string):EbayResearchQueryPreference|undefined {
  try {
    const value=JSON.parse(localStorage.getItem(ebayResearchQueryPreferenceKey(storeId,listingId))||'null') as Partial<EbayResearchQueryPreference>|null
    const query=String(value?.query||'').replace(/\s+/g,' ').trim().slice(0,120)
    const source=value?.source
    if(!query||!source||!['PRODUCT_TYPE','TITLE','CATEGORY','MANUAL'].includes(source))return undefined
    return {query,source,locked:Boolean(value.locked)}
  } catch { return undefined }
}

function saveEbayResearchQueryPreference(storeId:string,listingId:string,preference:EbayResearchQueryPreference) {
  localStorage.setItem(ebayResearchQueryPreferenceKey(storeId,listingId),JSON.stringify(preference))
}

function ebayResearchQuerySuggestion(listing:EbayListing):{query:string;source:Exclude<EbayResearchQuerySource,'MANUAL'>} {
  const original=(listing.originalTitle||listing.title).replace(/\([^)]*\)/g,' ').replace(/\s+/g,' ').trim()
  const productType=(listing.itemSpecifics||[]).find(item=>/^(?:product\s*)?type$|^item\s*type$/i.test(item.name.trim()))?.value.replace(/\s+/g,' ').trim()||''
  if(productType&&!/^(?:does not apply|not applicable|n\/a|unbranded|unknown|other)$/i.test(productType)&&original.toLowerCase().includes(productType.toLowerCase()))return {query:productType.slice(0,120),source:'PRODUCT_TYPE'}
  const firstPhrase=(original.split(/\s*(?:,|;|\||\/|\s+-\s+)\s*/)[0]||original)
    .replace(/^(?:(?:brand\s+new|new|convenient|premium|professional|high\s+quality|hot\s+sale|best\s+selling|durable|heavy\s+duty)\s+)+/i,'')
    .replace(/^\d+(?:\.\d+)?\s*(?:inch(?:es)?|in\.?|cm|mm|ft|feet|foot|["”'])\s+/i,'')
    .replace(/\b(?:item\s+code|sku)\s*[:#].*$/i,'')
    .replace(/\s+/g,' ').trim()
  const titleQuery=firstPhrase.split(' ').filter(Boolean).slice(0,6).join(' ')
  if(titleQuery)return {query:titleQuery.slice(0,120),source:'TITLE'}
  return {query:listing.categoryName.trim().slice(0,120),source:'CATEGORY'}
}


function ebayCountryForMarketplace(marketplaceId:string) {
  const suffix=marketplaceId.replace(/^EBAY_/,'').toUpperCase()
  const countries:Record<string,string>={US:'US',GB:'GB',DE:'DE',FR:'FR',IT:'IT',ES:'ES',AU:'AU',CA:'CA',AT:'AT',BE:'BE',CH:'CH',IE:'IE',NL:'NL',PL:'PL'}
  return countries[suffix]||'US'
}

function ebayCurrencyForMarketplace(marketplaceId:string) {
  const code=marketplaceId.trim().toUpperCase()
  if(code==='EBAY_GB')return 'GBP'
  if(['EBAY_DE','EBAY_FR','EBAY_IT','EBAY_ES','EBAY_AT','EBAY_IE','EBAY_NL','EBAY_BE'].includes(code))return 'EUR'
  if(code==='EBAY_CA')return 'CAD'
  if(code==='EBAY_AU')return 'AUD'
  return 'USD'
}

const productWarehouses: Array<{code:ProductWarehouseCode;name:string;kind:'SUPPLY'|'MARKET';description:string}> = [
  {code:'GIGACLOUD',name:'大健云仓',kind:'SUPPLY',description:'海外仓库存、配送与履约货源'},
  {code:'ALIEXPRESS',name:'AliExpress',kind:'MARKET',description:'AliExpress市场商品与选品机会'},
  {code:'1688',name:'1688',kind:'SUPPLY',description:'国内工厂、批发与阶梯价货源'},
  {code:'OZON',name:'Ozon',kind:'MARKET',description:'Ozon市场商品、成本与利润机会'}
]

const warehouseRuleProfiles:Record<ProductWarehouseCode,string[]>={
  GIGACLOUD:['海外仓可售库存','仓库位置与配送区域','尾程费用与履约时效','重量体积与破损风险'],
  ALIEXPRESS:['订单量与评价质量','售价及折扣稳定性','配送时效与店铺表现','竞争强度与货源利润'],
  '1688':['超级工厂与源头旗舰','阶梯价格与MOQ','回头率及全网销量','综合服务与发货时效'],
  OZON:['卢布售价与销量表现','评分评论与品牌风险','平台佣金与物流成本','1688同款及预计利润']
}

const initialTask: SelectionTaskDraft = {
  selectionMode: 'FORWARD_SUPPLY', marketplacePlatform: 'OZON', marketplaceAccountId: 'ozon-default', networkStrategy: 'LOCAL_DIRECT', selectionRulePreset: 'BALANCED', minimumSelectionScore: 65, selectionDimensions: ['supplier_badge','category_rank','return_rate','network_sales','service_rating'], requiredSupplierBadges: ['SUPER_FACTORY','SOURCE_FLAGSHIP','CATEGORY_TOP'], maxCategoryTopRank: 20, minimumReturnRate: 30, minimumNetworkSales: 10000, minimumServiceRating: 4, collectionMethod: 'KEYWORD', sourceUrl: '', maxPages: 5, supplyPlatforms: ['1688'], maxMoq: 100,
  minSupplierYears: 2, onlyVerifiedSupplier: false, gigaSellerIndexFilter:'GE80', gigaReturnRateFilter:'LOW',
  name: 'Ozon 新选品任务', ozonUrl: 'https://www.ozon.ru/', keyword: '',
  targetQuantity: 100, minPrice: 0, maxPrice: 10000, minRating: 4,
  minReviews: 10, maxProducts: 50, collectionProtectionEnabled:true, collectionProtectionMode:'STANDARD', collectionBatchSize:12, collectionRestMinSeconds:20, collectionRestMaxSeconds:45, collectionMaxRunMinutes:20, collectionAutoPause:true, exchangeRate: 0.09, targetMargin: 25
}

type ProtectionSettings = Pick<SelectionTaskDraft,'collectionProtectionEnabled'|'collectionProtectionMode'|'collectionBatchSize'|'collectionRestMinSeconds'|'collectionRestMaxSeconds'|'collectionMaxRunMinutes'|'collectionAutoPause'>
const protectionPresets:Record<CollectionProtectionMode,Omit<ProtectionSettings,'collectionProtectionEnabled'|'collectionProtectionMode'|'collectionAutoPause'>>={
  CAUTIOUS:{collectionBatchSize:8,collectionRestMinSeconds:45,collectionRestMaxSeconds:90,collectionMaxRunMinutes:15},
  STANDARD:{collectionBatchSize:12,collectionRestMinSeconds:20,collectionRestMaxSeconds:45,collectionMaxRunMinutes:20},
  FAST:{collectionBatchSize:20,collectionRestMinSeconds:8,collectionRestMaxSeconds:20,collectionMaxRunMinutes:25}
}
const protectionModeName:Record<CollectionProtectionMode,string>={CAUTIOUS:'谨慎模式',STANDARD:'标准模式',FAST:'快速模式'}
const protectionSettingsFor=(platform:string):ProtectionSettings=>{
  const fallback:ProtectionSettings={collectionProtectionEnabled:true,collectionProtectionMode:'STANDARD',...protectionPresets.STANDARD,collectionAutoPause:true}
  try { const saved=localStorage.getItem(`collection-protection:${platform}`);if(!saved)return fallback;const parsed=JSON.parse(saved) as Partial<ProtectionSettings>;const mode:CollectionProtectionMode=parsed.collectionProtectionMode==='FAST'?'FAST':'STANDARD';return {...fallback,...protectionPresets[mode],...parsed,collectionProtectionEnabled:true,collectionProtectionMode:mode} } catch{return fallback}
}

const supplyPlatformOptions: { code: SupplyPlatformCode; name: string; ready: boolean }[] = [
  { code: '1688', name: '1688', ready: true },
  { code: 'PINDUODUO', name: '拼多多', ready: false },
  { code: 'YIWUGO', name: '义乌购', ready: false },
  { code: 'GIGACLOUD', name: '大健云仓', ready: true }
]

const supplyPlatformUrls: Record<string, string> = {
  '1688': 'https://www.1688.com/',
  PINDUODUO: 'https://www.pinduoduo.com/',
  YIWUGO: 'https://www.yiwugo.com/',
  GIGACLOUD: 'https://www.gigab2b.com/'
}

const supplyPlatformDomains: Record<string, string[]> = {
  '1688': ['1688.com'],
  PINDUODUO: ['pinduoduo.com', 'yangkeduo.com'],
  YIWUGO: ['yiwugo.com', 'yiwugou.com', 'yiwugocn.com'],
  GIGACLOUD: ['gigab2b.com']
}

const platformSelectionDimensions: Record<string, { code: string; name: string }[]> = {
  '1688': [{code:'supplier_badge',name:'供应商资质'},{code:'category_rank',name:'品类TOP排名'},{code:'return_rate',name:'回头率'},{code:'network_sales',name:'全网销量'},{code:'service_rating',name:'综合服务星级'}],
  PINDUODUO: [{code:'quality',name:'质量反馈'},{code:'reviews',name:'有效评价'},{code:'sales',name:'销售表现'},{code:'shop',name:'店铺稳定'},{code:'price',name:'价格合理'},{code:'risk',name:'异常低价风险'}],
  YIWUGO: [{code:'shop',name:'实体档口'},{code:'supplier',name:'主营匹配'},{code:'inventory',name:'库存稳定'},{code:'price',name:'批发价格'},{code:'moq',name:'起订量'},{code:'fulfillment',name:'发货能力'}],
  GIGACLOUD: [{code:'inventory',name:'海外仓库存'},{code:'fulfillment',name:'履约时效'},{code:'logistics',name:'物流成本'},{code:'quality',name:'商品质量'},{code:'supplier',name:'供应稳定'},{code:'risk',name:'破损退货风险'}]
}

let productCatalog = [
  { name:'家具', children:['客厅家具','卧室家具','办公家具'] }, { name:'花园与户外', children:['户外家具','园艺工具','烧烤用品'] },
  { name:'健身与运动', children:['健身器材','户外运动','运动配件'] }, { name:'卫浴与水龙头', children:['水龙头','淋浴用品','卫浴收纳'] },
  { name:'厨房用品', children:['烹饪工具','餐厨收纳','饮水器具'] }, { name:'宠物用品', children:['宠物食品','喂食用品','清洁护理','宠物玩具','牵引与出行','宠物家居'] },
  { name:'玩具', children:['益智玩具','模型玩具','户外玩具'] }, { name:'汽车配件与运输', children:['内饰用品','维修工具','车载电器'] },
  { name:'照明', children:['室内照明','户外照明','装饰灯具'] }, { name:'未分类', children:['待人工分类'] }
]

let tertiaryCatalog: Record<string, Array<{ name:string; icon:string }>> = {
  '客厅家具':[{name:'沙发',icon:'🛋'},{name:'茶几',icon:'🪑'},{name:'电视柜',icon:'📺'},{name:'收纳柜',icon:'🗄'}], '卧室家具':[{name:'床与床架',icon:'🛏'},{name:'床头柜',icon:'🗄'},{name:'衣柜',icon:'👗'}], '办公家具':[{name:'办公桌',icon:'🖥'},{name:'办公椅',icon:'🪑'},{name:'文件柜',icon:'🗂'}],
  '户外家具':[{name:'庭院桌椅',icon:'⛱'},{name:'户外沙发',icon:'🛋'},{name:'遮阳伞',icon:'☂'}], '园艺工具':[{name:'修剪工具',icon:'✂'},{name:'浇灌用品',icon:'💧'},{name:'种植工具',icon:'🌱'}], '烧烤用品':[{name:'烧烤炉',icon:'🔥'},{name:'烧烤工具',icon:'🍴'},{name:'露营炊具',icon:'⛺'}],
  '健身器材':[{name:'跑步机',icon:'🏃'},{name:'哑铃',icon:'🏋'},{name:'力量训练器',icon:'💪'}], '户外运动':[{name:'露营装备',icon:'⛺'},{name:'自行车用品',icon:'🚲'},{name:'球类用品',icon:'⚽'}], '运动配件':[{name:'运动护具',icon:'🪖'},{name:'训练辅助',icon:'🎯'},{name:'运动包',icon:'🎒'}],
  '水龙头':[{name:'厨房水龙头',icon:'🚰'},{name:'浴室水龙头',icon:'🚿'},{name:'感应水龙头',icon:'💧'}], '淋浴用品':[{name:'花洒',icon:'🚿'},{name:'淋浴套装',icon:'🛁'},{name:'浴帘与配件',icon:'🧼'}], '卫浴收纳':[{name:'浴室置物架',icon:'🧴'},{name:'马桶收纳',icon:'🚽'},{name:'洗漱台收纳',icon:'🗄'}],
  '烹饪工具':[{name:'锅具',icon:'🍳'},{name:'刀具',icon:'🔪'},{name:'厨房小工具',icon:'🥄'},{name:'厨房电器',icon:'🧇'}], '餐厨收纳':[{name:'调料架',icon:'🫙'},{name:'碗盘架',icon:'🍽'},{name:'厨房置物架',icon:'🗄'}], '饮水器具':[{name:'水杯与杯壶',icon:'🥤'},{name:'咖啡用具',icon:'☕'},{name:'净水器具',icon:'💧'}],
  '宠物食品':[{name:'狗粮',icon:'🐶'},{name:'猫粮',icon:'🐱'},{name:'宠物零食',icon:'🦴'},{name:'营养补充剂',icon:'💊'}], '喂食用品':[{name:'宠物食盆',icon:'🥣'},{name:'自动喂食器',icon:'⏲'},{name:'宠物饮水机',icon:'💧'}], '清洁护理':[{name:'宠物洗护',icon:'🧴'},{name:'梳毛工具',icon:'🪮'},{name:'宠物烘干箱',icon:'🌬'}], '宠物玩具':[{name:'狗玩具',icon:'🦴'},{name:'猫玩具',icon:'🧶'},{name:'训练玩具',icon:'🎯'}], '牵引与出行':[{name:'牵引绳',icon:'🪢'},{name:'宠物背包',icon:'🎒'},{name:'宠物推车',icon:'🐕'}], '宠物家居':[{name:'宠物窝',icon:'🏠'},{name:'猫爬架',icon:'🌳'},{name:'宠物围栏',icon:'🪜'}],
  '益智玩具':[{name:'积木',icon:'🧱'},{name:'拼图',icon:'🧩'},{name:'科学玩具',icon:'🧪'}], '模型玩具':[{name:'车辆模型',icon:'🚗'},{name:'动物模型',icon:'🦕'},{name:'拼装模型',icon:'🧰'}], '户外玩具':[{name:'水玩具',icon:'💦'},{name:'沙滩玩具',icon:'🏖'},{name:'儿童运动玩具',icon:'🏀'}],
  '内饰用品':[{name:'座椅用品',icon:'💺'},{name:'车内收纳',icon:'🗄'},{name:'方向盘配件',icon:'🚘'}], '维修工具':[{name:'随车工具',icon:'🧰'},{name:'清洗养护',icon:'🧽'},{name:'轮胎工具',icon:'🛠'}], '车载电器':[{name:'车载充电器',icon:'🔌'},{name:'行车记录仪',icon:'📷'},{name:'车载吸尘器',icon:'🧹'}],
  '室内照明':[{name:'吸顶灯',icon:'💡'},{name:'台灯',icon:'💡'},{name:'壁灯',icon:'🕯'}], '户外照明':[{name:'庭院灯',icon:'🌙'},{name:'太阳能灯',icon:'☀'},{name:'户外探照灯',icon:'🔦'}], '装饰灯具':[{name:'灯带',icon:'✨'},{name:'氛围灯',icon:'🌈'},{name:'节日灯饰',icon:'🎆'}], '待人工分类':[{name:'待细分',icon:'❓'}]
}

const catalogVersion = 'gigab2b-2026-07-13'
const tertiaryKey = (category:string,subcategory:string) => `${category}::${subcategory}`
productCatalog = [...gigaCatalog.map(group=>({name:group.name,children:group.children.map(child=>child.name)})),{name:'类目待核实',children:['待核实']}]
tertiaryCatalog = Object.fromEntries(gigaCatalog.flatMap(group=>group.children.map(child=>[
  tertiaryKey(group.name,child.name),child.children.map(item=>({name:item.name,icon:item.icon}))
])))
tertiaryCatalog[tertiaryKey('类目待核实','待核实')] = [{name:'待核实',icon:'❓'}]

try {
  const saved=localStorage.getItem('product-catalog-definition')
  if(saved){const parsed=JSON.parse(saved);if(parsed.version===catalogVersion&&Array.isArray(parsed.groups)&&parsed.tertiary){productCatalog=parsed.groups;tertiaryCatalog=parsed.tertiary}}
} catch { /* 保留默认目录 */ }

const saveCatalogDefinition=()=>localStorage.setItem('product-catalog-definition',JSON.stringify({version:catalogVersion,groups:productCatalog,tertiary:tertiaryCatalog}))

const tertiaryOptions = (subcategory:string,category='') => [...(tertiaryCatalog[tertiaryKey(category,subcategory)] || tertiaryCatalog[subcategory] || []),{name:'待细分',icon:'❓'}].filter((item,index,array)=>array.findIndex(other=>other.name===item.name)===index)
const CatalogIcon = ({icon}:{icon:string}) => /^https?:\/\//.test(icon)?<img src={icon} alt=""/>:<>{icon}</>
const readableError = (reason:unknown,fallback:string) => (reason instanceof Error ? reason.message : fallback).replace(/^Error invoking remote method '[^']+': Error:\s*/, '')

function inferCatalog(title: string) {
  const value = title.toLocaleLowerCase()
  const rules: Array<[string[], string, string]> = [
    [['pet','dog','cat','宠物','猫','狗'], '宠物用品', value.includes('cat') || value.includes('猫') ? '猫爬架' : '宠物床与家具'],
    [['kitchen','cook','cup','厨房','锅','杯'], '厨房用品', '厨房电器'], [['lamp','light','led','灯','照明'], '照明', '照明灯具'],
    [['car','auto','汽车','车载'], '汽车配件与运输', '零部件'], [['toy','玩具'], '玩具', '户外运动'],
    [['sport','fitness','健身','运动'], '健身与运动', '健身'], [['garden','outdoor','花园','户外'], '花园与户外', '园艺用品'],
    [['furniture','chair','table','家具','椅','桌'], '家具', '主要起居空间家具'], [['bath','faucet','shower','卫浴','水龙头'], '卫浴与水龙头', '浴室配件']
  ]
  const matched = rules.find(([keywords]) => keywords.some(keyword => value.includes(keyword)))
  return matched ? { category:matched[1], subcategory:matched[2] } : { category:'未分类', subcategory:'待人工分类' }
}

function exactSupplyCatalog(product: CollectedSupplyProduct) {
  const source = product.sourceCategory
  if (!source || source.status !== 'EXACT') return null
  const [level1Id,level2Id,level3Id] = source.pathIds
  const group = gigaCatalog.find(item=>item.id===level1Id)
  const child = group?.children.find(item=>item.id===level2Id)
  const tertiary = child?.children.find(item=>item.id===level3Id)
  if (!group || !child || !tertiary) return null
  return { category:group.name, subcategory:child.name, tertiaryCategory:tertiary.name }
}

function supplyCatalog(product: CollectedSupplyProduct) {
  return exactSupplyCatalog(product) || { category:'类目待核实', subcategory:'待核实', tertiaryCategory:'待核实' }
}

function SupplyCandidateCard({ product, candidateKey, sourceCount, sourceText, catalog, exactCatalog, batchMode, checked, preferred, onToggle, onRestore, onPurge, onPrefer, onOpen, onDelete }: {
  product: CollectedSupplyProduct
  candidateKey: string
  sourceCount: number
  sourceText: string
  catalog: CatalogPath
  exactCatalog: boolean
  batchMode: boolean
  checked: boolean
  preferred: boolean
  onToggle: () => void
  onRestore: () => void
  onPurge: () => void
  onPrefer: () => void
  onOpen: () => void
  onDelete: () => void
}) {
  const inferredGigaIndex = product.gigaIndex ?? (product.platformCode === 'GIGACLOUD' && product.supplierBadges.includes('GIGA_INDEX') && product.score > 0 ? product.score : null)
  const grade = inferredGigaIndex === null ? null : Math.round(inferredGigaIndex) >= 80 ? 'A' : Math.round(inferredGigaIndex) >= 65 ? 'B' : 'C'
  const inventoryText = product.sellableInventory !== null && product.sellableInventory !== undefined ? product.sellableInventory.toLocaleString('zh-CN') : product.salesText.replace(/^(?:Available\s*Stock|可售库存|库存)\s*[:：]?\s*/i,'') || '待补采'
  const platformName = product.platformCode === 'GIGACLOUD' ? '大健云仓' : product.platformCode
  return <article className={`product-card candidate-product-card supply-source-card${product.candidateDeletedAt?' is-deleted':''}`} key={candidateKey}>
    <div className="candidate-card-tools">{batchMode?<label title="选择商品"><input type="checkbox" checked={checked} onChange={onToggle}/></label>:product.candidateDeletedAt?<><button title="恢复商品" onClick={onRestore}>恢复</button><button className="danger" title="彻底删除" onClick={onPurge}>删除</button></>:null}</div>
    <button type="button" className="product-image" onClick={onOpen}>{product.imageUrl?<img src={product.imageUrl} alt={product.title}/>:<span>无图片</span>}{product.promotionText&&<span className="candidate-promotion">{product.promotionText}</span>}<span className={`score-badge${inferredGigaIndex===null?' pending':''}`} title={inferredGigaIndex===null?'未采集到 GIGA Index，暂不生成默认评分':`评分依据：GIGA Index ${inferredGigaIndex}`}>{inferredGigaIndex===null?'待评分':`${Math.round(inferredGigaIndex)}分 · ${grade}级`}</span></button>
    <div className="product-info supply-source-info">
      <small>{platformName} · Item Code {product.productId || '待补采'} · 来源批次 {sourceCount}</small>
      <b title={product.title}>{product.title}</b>
      <strong>{product.priceText || '价格待补采'}</strong>
      <dl className="candidate-source-facts"><div><dt>物流费</dt><dd>{product.shippingFeeText || '待补采'}</dd></div><div><dt>可售库存</dt><dd>{inventoryText}</dd></div><div><dt>原始类目</dt><dd title={`${catalog.category} / ${catalog.subcategory} / ${catalog.tertiaryCategory}`}>{catalog.category} / {catalog.subcategory} / {catalog.tertiaryCategory}</dd></div><div><dt>GIGA Index</dt><dd>{inferredGigaIndex ?? '待补采'}</dd></div></dl>
      <div className="original-price" title={sourceText}>{sourceText}</div>
      <div className="product-tags"><span>{product.candidateDeletedAt?'已删除':preferred?'已优选':product.selected?'AI入选':'待人工复核'}</span><span>{exactCatalog?'精确类目':'类目待核实'}</span></div>
      <div className="product-actions candidate-next-actions"><button className="search-1688" disabled={Boolean(product.candidateDeletedAt)} onClick={onPrefer}>{preferred?'已优选':'优选'} <i>→</i></button><button onClick={onOpen}>原址 <i>↗</i></button><button className="candidate-delete" disabled={Boolean(product.candidateDeletedAt)} onClick={onDelete}>删除</button></div>
    </div>
  </article>
}

export function App() {
  const [page, setPage] = useState<AppPage>('warehouse-dashboard')
  const [platform, setPlatform] = useState<Platform>('1688')
  const [state, setState] = useState<BrowserState | null>(null)
  const [browserTabs, setBrowserTabs] = useState<BrowserTab[]>([
    { id: 'home-1688', platform: '1688', title: '1688 采购', closable: false, active: true }
  ])
  const [address, setAddress] = useState('https://www.1688.com/')
  const [task, setTask] = useState(initialTask)
  const [created, setCreated] = useState(false)
  const [activeTask, setActiveTask] = useState<SelectionTask | null>(null)
  const [progress, setProgress] = useState<TaskProgress | null>(null)
  const [running, setRunning] = useState(false)
  const [previewProducts, setPreviewProducts] = useState<CollectedOzonProduct[]>([])
  const [previewSupplyProducts, setPreviewSupplyProducts] = useState<CollectedSupplyProduct[]>([])
  const [previewSelectedUrls, setPreviewSelectedUrls] = useState<Set<string>>(new Set())
  const [previewQuery, setPreviewQuery] = useState('')
  const [previewOnlySelected, setPreviewOnlySelected] = useState(false)
  const [products, setProducts] = useState<CollectedOzonProduct[]>([])
  const [supplyProducts, setSupplyProducts] = useState<CollectedSupplyProduct[]>([])
  const [candidateArea, setCandidateArea] = useState<'SUPPLY' | 'MARKET'>('MARKET')
  const [candidateView, setCandidateView] = useState<'ALL' | 'BATCH' | 'METHOD'>('ALL')
  const [candidateQuery, setCandidateQuery] = useState('')
  const [candidateCategory, setCandidateCategory] = useState('ALL')
  const [candidateStatus, setCandidateStatus] = useState<'ALL' | 'SELECTED' | 'REVIEW' | 'DELETED'>('ALL')
  const [candidateMethod, setCandidateMethod] = useState<'ALL' | CollectionMethod>('ALL')
  const [candidateRunId, setCandidateRunId] = useState('ALL')
  const [candidatePlatform, setCandidatePlatform] = useState('OZON')
  const [candidateRuns, setCandidateRuns] = useState<CandidateCollectionRun[]>([])
  const [candidateRecords, setCandidateRecords] = useState<CandidateCollectionRecord[]>([])
  const [candidateBatchMode, setCandidateBatchMode] = useState(false)
  const [selectedCandidateKeys, setSelectedCandidateKeys] = useState<Set<string>>(new Set())
  const [selectionItems, setSelectionItems] = useState<SelectionCatalogItem[]>([])
  const [warehouseProducts, setWarehouseProducts] = useState<SupplyWarehouseProduct[]>([])
  const [comparisons, setComparisons] = useState<ComparisonRecordView[]>([])
  const [,setCatalogRevision] = useState(0)
  const [workflowCounts, setWorkflowCounts] = useState<WorkflowCounts>({ collected: 0, compared: 0, selected: 0, stocked: 0, listed: 0, purchasing: 0, reconciled: 0 })
  const [error, setError] = useState('')
  const [translationActive, setTranslationActive] = useState(false)
  const [translationMode, setTranslationMode] = useState<BrowserTranslationMode>('BILINGUAL')
  const [translationCount, setTranslationCount] = useState(0)
  const [translationMenuOpen, setTranslationMenuOpen] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [imageProduct, setImageProduct] = useState<ImageSourceProduct | null>(null)
  const [imageMarketplaceSelection, setImageMarketplaceSelection] = useState<MarketplaceSelectionProduct | null>(null)
  const [activeWarehouse,setActiveWarehouse] = useState<ProductWarehouseCode>('1688')
  const [marketplacePlatforms, setMarketplacePlatforms] = useState<MarketplacePlatformProfile[]>([])
  const [marketplaceAccounts, setMarketplaceAccounts] = useState<MarketplaceAccountProfile[]>([])
  const [builtInCollectorActive, setBuiltInCollectorActive] = useState(false)
  const [builtInCollectorProducts, setBuiltInCollectorProducts] = useState<CollectorPluginProduct[]>([])
  const [builtInCollectorRecognized, setBuiltInCollectorRecognized] = useState(0)
  const [builtInCollectorMessage, setBuiltInCollectorMessage] = useState('')
  const [builtInCollectorConfirming, setBuiltInCollectorConfirming] = useState(false)
  const [supplyActivation,setSupplyActivation] = useState<SupplyActivationResult|null>(null)
  const browserSlot = useRef<HTMLDivElement>(null)
  const addressInput = useRef<HTMLInputElement>(null)
  const translationRunning = useRef(false)
  const taskSubmitRunning = useRef(false)
  const supplyActivationRequest = useRef(0)

  useEffect(() => window.desktop.browser.onState(next => {
    setState(next)
    setPlatform(next.platform)
    setAddress(next.url)
  }), [])

  useEffect(() => window.desktop.browser.onTabs(next => setBrowserTabs(next)), [])

  useEffect(() => window.desktop.tasks.onProgress(next => setProgress(next)), [])
  useEffect(() => { void window.desktop.workflow.counts().then(setWorkflowCounts) }, [products.length, supplyProducts.length])
  useEffect(()=>{if(task.selectionMode==='FORWARD_SUPPLY'){const code=task.supplyPlatforms[0];if(code==='1688'||code==='GIGACLOUD')setActiveWarehouse(code)}else if(task.marketplacePlatform==='OZON'||task.marketplacePlatform==='ALIEXPRESS')setActiveWarehouse(task.marketplacePlatform)},[task.selectionMode,task.supplyPlatforms[0],task.marketplacePlatform])
  useEffect(() => {
    if (!translationActive || page !== 'tasks') return
    const timer = window.setInterval(() => { void translateBrowserPage(translationMode, true) }, 5000)
    return () => window.clearInterval(timer)
  }, [translationActive, translationMode, page])
  useEffect(() => {
    void window.desktop.marketplace.profiles().then(async profiles => {
      setMarketplacePlatforms(profiles.platforms)
      setMarketplaceAccounts(profiles.accounts)
    }).catch(reason => setError(reason instanceof Error ? reason.message : '跨境平台配置加载失败'))
  }, [])

  useEffect(() => {
    void Promise.all([window.desktop.tasks.latest(), window.desktop.candidates.list()]).then(([saved, candidates]) => {
      setProducts(candidates.products)
      setSupplyProducts(candidates.supplyProducts)
      setCandidateRuns(candidates.runs)
      setCandidateRecords(candidates.records)
      if (candidates.products.length === 0 && candidates.supplyProducts.length > 0) { setCandidateArea('SUPPLY'); setCandidatePlatform('1688') }
      if (!saved) return
      setActiveTask(saved.task)
      setPlatform('1688')
      setTask(current => ({
        ...current,
        selectionMode: saved.task.selectionMode || 'REVERSE_MARKET',
        marketplacePlatform: saved.task.marketplacePlatform || 'OZON',
        marketplaceAccountId: saved.task.marketplaceAccountId || 'ozon-default',
        networkStrategy: saved.task.networkStrategy || 'LOCAL_DIRECT',
        selectionRulePreset: saved.task.selectionRulePreset || 'BALANCED',
        minimumSelectionScore: saved.task.minimumSelectionScore || 65,
        selectionDimensions: saved.task.supplyPlatforms?.[0] === '1688' && !saved.task.selectionDimensions?.some(code => ['supplier_badge','category_rank','return_rate','network_sales','service_rating'].includes(code)) ? ['supplier_badge','category_rank','return_rate','network_sales','service_rating'] : saved.task.selectionDimensions?.length ? saved.task.selectionDimensions : ['supplier_badge','category_rank','return_rate','network_sales','service_rating'],
        requiredSupplierBadges: saved.task.requiredSupplierBadges?.length ? saved.task.requiredSupplierBadges : ['SUPER_FACTORY','SOURCE_FLAGSHIP','CATEGORY_TOP'],
        maxCategoryTopRank: saved.task.maxCategoryTopRank || 20,
        minimumReturnRate: saved.task.minimumReturnRate || 30,
        minimumNetworkSales: saved.task.minimumNetworkSales || 10000,
        minimumServiceRating: saved.task.minimumServiceRating || 4,
        collectionMethod: saved.task.collectionMethod || 'KEYWORD',
        sourceUrl: saved.task.sourceUrl || '',
        maxPages: saved.task.maxPages || 5,
        supplyPlatforms: supplyPlatformOptions.some(option => option.code === saved.task.supplyPlatforms?.[0]) ? [saved.task.supplyPlatforms[0]] : ['1688'],
        maxMoq: saved.task.maxMoq || 100,
        minSupplierYears: saved.task.minSupplierYears || 2,
        onlyVerifiedSupplier: saved.task.onlyVerifiedSupplier || false,
        gigaSellerIndexFilter: saved.task.gigaSellerIndexFilter || 'GE80',
        gigaReturnRateFilter: saved.task.gigaReturnRateFilter || 'LOW',
        name: saved.task.name,
        ozonUrl: saved.task.ozonUrl,
        keyword: saved.task.keyword,
        targetQuantity: saved.task.targetQuantity,
        minPrice: saved.task.minPrice,
        maxPrice: saved.task.maxPrice,
        minRating: saved.task.minRating,
        minReviews: saved.task.minReviews,
        maxProducts: saved.task.maxProducts,
        exchangeRate: saved.task.exchangeRate,
        targetMargin: saved.task.targetMargin
      }))
      if (saved.task.selectionMode === 'FORWARD_SUPPLY') {
        const warehouse = saved.task.supplyPlatforms?.[0]
        if (warehouse === '1688' || warehouse === 'GIGACLOUD') {
          setActiveWarehouse(warehouse)
        }
      } else if (saved.task.marketplacePlatform === 'OZON' || saved.task.marketplacePlatform === 'ALIEXPRESS') {
        setActiveWarehouse(saved.task.marketplacePlatform)
      }
      setCreated(true)
      setProgress({
        taskId: saved.task.id,
        stage: saved.task.stage,
        message: saved.task.stage === 'OZON_LIST_COMPLETED' ? `已恢复 ${saved.products.length} 个商品` : '已恢复上次任务',
        collected: saved.products.length
      })
    }).catch(reason => setError(reason instanceof Error ? reason.message : '恢复本地候选数据失败'))
  }, [])

  useEffect(() => { void window.desktop.selections.list().then(setSelectionItems).catch(reason => setError(reason instanceof Error ? reason.message : '选品库加载失败')) }, [])
  useEffect(() => { void window.desktop.warehouses.list().then(setWarehouseProducts).catch(reason => setError(reason instanceof Error ? reason.message : '供应仓库加载失败')) }, [])
  useEffect(() => { void window.desktop.comparisons.list().then(setComparisons).catch(reason => setError(reason instanceof Error ? reason.message : '比价数据加载失败')) }, [])

  useEffect(() => {
    const collectorInstalled = page === 'tasks' && task.selectionMode === 'FORWARD_SUPPLY' && task.supplyPlatforms[0] === 'GIGACLOUD'
    if (!builtInCollectorActive && !collectorInstalled) return
    const refresh = async () => {
      try {
        const state = await window.desktop.browser.collectorState()
        setBuiltInCollectorActive(state.active)
        setBuiltInCollectorProducts(state.products)
        setBuiltInCollectorRecognized(state.recognizedCount)
      } catch (reason) { setBuiltInCollectorMessage(reason instanceof Error ? reason.message : '商品选择状态读取失败') }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 700)
    return () => window.clearInterval(timer)
  }, [builtInCollectorActive, page, task.selectionMode, task.supplyPlatforms[0]])

  useEffect(() => {
    if (page !== 'tasks' && page !== 'ebay') {
      void window.desktop.browser.hide()
      return
    }
    if (page === 'ebay') return
    void window.desktop.browser.show(platform)
    void window.desktop.browser.getState(platform).then(next => {
      if (next) { setState(next); setAddress(next.url) }
    })
  }, [platform, page])

  useEffect(() => {
    if (activeWarehouse === 'GIGACLOUD' && page === 'sourcing') setPage('review')
  }, [activeWarehouse, page])

  useEffect(() => {
    if (page !== 'tasks') return
    const update = () => {
      const rect = browserSlot.current?.getBoundingClientRect()
      if (!rect) return
      void window.desktop.browser.setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
    }
    update()
    const observer = new ResizeObserver(update)
    if (browserSlot.current) observer.observe(browserSlot.current)
    window.addEventListener('resize', update)
    return () => { observer.disconnect(); window.removeEventListener('resize', update) }
  }, [page])

  const createTask = async (event: FormEvent) => {
    event.preventDefault()
    if (taskSubmitRunning.current) return
    taskSubmitRunning.current = true
    setError('')
    try {
      if (task.selectionMode === 'FORWARD_SUPPLY' && task.supplyPlatforms[0] === 'GIGACLOUD') {
        const state = await window.desktop.browser.startCollector()
        setBuiltInCollectorActive(state.active)
        setBuiltInCollectorProducts(state.products)
        setBuiltInCollectorRecognized(state.recognizedCount)
        setBuiltInCollectorMessage(state.recognizedCount ? `当前页已识别 ${state.recognizedCount} 个商品，请点击图片右上角的“采集”` : '当前页面暂未识别到商品，可继续浏览大健云仓')
        return
      }
      if (task.collectionProtectionEnabled && task.collectionRestMaxSeconds < task.collectionRestMinSeconds) throw new Error('采集保护的最长休息时间不能小于最短休息时间')
      if (task.selectionMode === 'FORWARD_SUPPLY' && task.collectionMethod !== 'KEYWORD') {
        const hostname = new URL(task.sourceUrl).hostname
        const platformCode = task.supplyPlatforms[0] || '1688'
        if (!supplyPlatformDomains[platformCode].some(domain => hostname === domain || hostname.endsWith(`.${domain}`))) {
          throw new Error('链接与当前选择的供应链平台不一致，请检查后重试')
        }
      }
      const nextTask = await window.desktop.tasks.create(task)
      setActiveTask(nextTask)
      setCreated(true)
      await runPreview(nextTask)
    } catch (reason) {
      setError(readableError(reason,'任务创建失败'))
    } finally { taskSubmitRunning.current = false }
  }

  const runPreview = async (selectedTask = activeTask) => {
    if (!selectedTask || running) return
    setPage('tasks'); setError(''); setRunning(true)
    try {
      const result = await window.desktop.tasks.preview(selectedTask.id)
      setPreviewProducts(result.products)
      setPreviewSupplyProducts(result.supplyProducts)
      setPreviewSelectedUrls(new Set([...result.products, ...result.supplyProducts].map(item => item.url)))
      setPreviewQuery('')
      setPreviewOnlySelected(false)
    } catch (reason) { setError(readableError(reason,'预采集失败')) }
    finally { setRunning(false) }
  }

  const confirmPreview = async () => {
    if (!activeTask || running || !previewSelectedUrls.size) return
    setError(''); setRunning(true)
    try {
      await window.desktop.tasks.confirmPreview({ taskId:activeTask.id, selectedUrls:[...previewSelectedUrls] })
      const candidates = await window.desktop.candidates.list()
      setProducts(candidates.products)
      setSupplyProducts(candidates.supplyProducts)
      setCandidateRuns(candidates.runs)
      setCandidateRecords(candidates.records)
      await window.desktop.workflow.counts().then(setWorkflowCounts)
    } catch (reason) { setError(readableError(reason,'正式采集失败')) }
    finally { setRunning(false) }
  }

  const togglePreviewItem = (url: string, source: 'MARKET'|'SUPPLY'|'PLUGIN') => {
    if (source === 'PLUGIN') { void removeBuiltInCollectorProduct(url); return }
    setPreviewSelectedUrls(current=>{const next=new Set(current);next.has(url)?next.delete(url):next.add(url);return next})
  }

  const startTask = async (selectedTask = activeTask) => {
    if (!selectedTask || running) return
    if (selectedTask.selectionMode === 'FORWARD_SUPPLY') {
      setPage('tasks'); setPlatform('1688'); setError(''); setRunning(true)
      try {
        await window.desktop.tasks.start(selectedTask.id)
        const candidates = await window.desktop.candidates.list()
        setProducts(candidates.products)
        setSupplyProducts(candidates.supplyProducts)
        setCandidateRuns(candidates.runs)
        setCandidateRecords(candidates.records)
        if (candidates.products.length === 0 && candidates.supplyProducts.length > 0) { setCandidateArea('SUPPLY'); setCandidatePlatform(selectedTask.supplyPlatforms[0]||'1688') }
        await window.desktop.workflow.counts().then(setWorkflowCounts)
      } catch (reason) { setError(readableError(reason,'供应链采集失败')) }
      finally { setRunning(false) }
      return
    }
    setRunning(true); setError('')
    try {
      await window.desktop.tasks.start(selectedTask.id)
      const candidates = await window.desktop.candidates.list()
      setProducts(candidates.products)
      setSupplyProducts(candidates.supplyProducts)
      setCandidateRuns(candidates.runs)
      setCandidateRecords(candidates.records)
      if (candidates.products.length === 0 && candidates.supplyProducts.length > 0) { setCandidateArea('SUPPLY'); setCandidatePlatform(selectedTask.supplyPlatforms[0]||'1688') }
      await window.desktop.workflow.counts().then(setWorkflowCounts)
    }
    catch (reason) { setError(readableError(reason,'采集执行失败')) }
    finally { setRunning(false) }
  }

  const navigate = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    try { await window.desktop.browser.navigate(platform, address) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '导航失败') }
  }

  const switchPlatform = (next: Platform) => {
    setPlatform(next)
    setAddress(next === 'ozon' ? 'https://www.ozon.ru/' : 'https://www.1688.com/')
  }

  const openProduct = (product: CollectedOzonProduct) => {
    setPage('tasks'); setPlatform('ozon')
    setTimeout(() => void window.desktop.browser.openTab('ozon', product.url, product.title).catch(reason => {
      setError(reason instanceof Error ? reason.message : 'Ozon 详情标签打开失败')
    }), 80)
  }

  const searchOn1688 = async (product: CollectedOzonProduct) => {
    await startComparison(product)
  }

  const openSupplyProduct = (product: Pick<CollectedSupplyProduct,'platformCode'|'url'|'title'>) => {
    const browserPlatform:Platform=product.platformCode==='1688'?'1688':'web'
    setPage('tasks'); setPlatform(browserPlatform)
    setTimeout(() => void window.desktop.browser.openTab(browserPlatform, product.url, product.title).catch(reason => {
      setError(reason instanceof Error ? reason.message : `${product.platformCode}详情打开失败`)
    }), 80)
  }

  const activateBrowserTab = (tab: BrowserTab) => {
    setPlatform(tab.platform)
    void window.desktop.browser.switchTab(tab.id)
  }

  const createBrowserTab = async () => {
    setError('')
    try {
      await window.desktop.browser.newTab()
      setPlatform('web')
      window.setTimeout(() => {
        setAddress('')
        addressInput.current?.focus()
        addressInput.current?.select()
      }, 120)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '新建浏览页失败') }
  }

  const priceInCny = (priceText: string) => {
    const rub = Number(priceText.replace(/[^\d]/g, ''))
    return Number.isFinite(rub) && rub > 0 ? `¥${(rub * task.exchangeRate).toFixed(2)}` : '价格待采集'
  }

  const selectMode = (mode: SelectionTaskDraft['selectionMode']) => {
    const forward = mode === 'FORWARD_SUPPLY'
    setTask(current=>({
      ...current,
      selectionMode: mode,
      collectionMethod: forward ? current.collectionMethod : 'KEYWORD',
      supplyPlatforms: current.supplyPlatforms.length ? current.supplyPlatforms : ['1688'],
      name: forward ? '供应链多平台采集任务' : 'Ozon 跨境平台采集任务'
    }))
    setPlatform(forward ? '1688' : 'ozon')
  }

  const selectSupplyPlatform = (code: SupplyPlatformCode, name: string) => {
    const requestId = ++supplyActivationRequest.current
    setTask(current=>({ ...current, ...protectionSettingsFor(code), selectionMode:'FORWARD_SUPPLY', supplyPlatforms: [code], name: `${name} 供应链采集任务`, selectionDimensions: platformSelectionDimensions[code].map(item=>item.code) }))
    setPage('tasks')
    setError('')
    if (code === '1688' || code === 'GIGACLOUD') {
      setPlatform('1688')
      void window.desktop.browser.activateSupply(code).then(result => {
        if (supplyActivationRequest.current === requestId) setSupplyActivation(result)
      }).catch(reason => {
        if (supplyActivationRequest.current === requestId) setError(reason instanceof Error ? reason.message : `${name} 网站打开失败`)
      })
      return
    }
    const existing = browserTabs.find(tab => tab.generic && tab.title.includes(name))
    if (existing) {
      setPlatform('web')
      void window.desktop.browser.switchTab(existing.id)
      return
    }
    setTimeout(() => void window.desktop.browser.openTab('web', supplyPlatformUrls[code], `${name}采购`).then(()=>setPlatform('web')).catch(reason => {
      setError(reason instanceof Error ? reason.message : `${name} 网站打开失败`)
    }), 80)
  }

  const updateProtection=(changes:Partial<ProtectionSettings>)=>setTask(current=>{
    const next={...current,...changes}
    const platform=current.selectionMode==='FORWARD_SUPPLY'?(current.supplyPlatforms[0]||'1688'):current.marketplacePlatform
    const settings:ProtectionSettings={collectionProtectionEnabled:next.collectionProtectionEnabled,collectionProtectionMode:next.collectionProtectionMode,collectionBatchSize:next.collectionBatchSize,collectionRestMinSeconds:next.collectionRestMinSeconds,collectionRestMaxSeconds:next.collectionRestMaxSeconds,collectionMaxRunMinutes:next.collectionMaxRunMinutes,collectionAutoPause:next.collectionAutoPause}
    try { localStorage.setItem(`collection-protection:${platform}`,JSON.stringify(settings)) } catch { /* 使用当前会话配置 */ }
    return next
  })

  const selectProtectionMode=(mode:CollectionProtectionMode)=>updateProtection({collectionProtectionEnabled:true,collectionProtectionMode:mode,...protectionPresets[mode]})

  const useCurrentSupplyPage = () => {
    const platformCode=task.supplyPlatforms[0]||'1688'
    const currentUrl=state?.url||''
    let valid=false
    try { const hostname=new URL(currentUrl).hostname;valid=Boolean(currentUrl&&supplyPlatformDomains[platformCode]?.some(domain=>hostname===domain||hostname.endsWith(`.${domain}`))) } catch { valid=false }
    if (!valid) {
      setError('请先在右侧供应链浏览器中打开商品或类目页面')
      return
    }
    setTask({ ...task, sourceUrl: currentUrl })
    setError('')
  }

  const activeMarketplace = marketplacePlatforms.find(item => item.code === task.marketplacePlatform)
  const visibleMarketplaceAccounts = marketplaceAccounts.filter(item => item.platformCode === task.marketplacePlatform)
  const activeSupplyPlatform = supplyPlatformOptions.find(item => item.code === task.supplyPlatforms[0]) || supplyPlatformOptions[0]
  const isGigaCloudCollector = task.selectionMode === 'FORWARD_SUPPLY' && task.supplyPlatforms[0] === 'GIGACLOUD'
  const activeFilterCount = task.selectionMode === 'FORWARD_SUPPLY'
    ? task.supplyPlatforms[0] === 'GIGACLOUD'
      ? Number(task.gigaSellerIndexFilter !== 'ANY') + Number(task.gigaReturnRateFilter !== 'ANY')
      : 2 + Number(task.onlyVerifiedSupplier)
    : 4
  const collectionCompleted=progress?.stage==='OZON_LIST_COMPLETED'||progress?.stage==='SUPPLY_LIST_COMPLETED'
  const regularPreviewItems=[...previewProducts.map(item=>({source:'MARKET' as const,...item,meta:item.brand||'Ozon 商品'})),...previewSupplyProducts.map(item=>({source:'SUPPLY' as const,...item,meta:[item.supplierName,item.salesText].filter(Boolean).join(' · ')||item.platformCode}))]
  const pluginPreviewItems=builtInCollectorProducts.map(item=>({source:'PLUGIN' as const,...item,meta:[item.sourceCategory?.status==='EXACT'?item.sourceCategory.pathNames.join(' / '):'类目待核实',item.supplierName,item.salesText].filter(Boolean).join(' · ')||'大健云仓'}))
  const allPreviewItems=pluginPreviewItems.length?pluginPreviewItems:regularPreviewItems
  const normalizedPreviewQuery=previewQuery.trim().toLocaleLowerCase()
  const visiblePreviewItems=allPreviewItems.filter(item=>(!normalizedPreviewQuery||`${item.title} ${item.productId} ${item.meta}`.toLocaleLowerCase().includes(normalizedPreviewQuery))&&(!previewOnlySelected||item.source==='PLUGIN'||previewSelectedUrls.has(item.url)))
  const previewSelectedCount=pluginPreviewItems.length||previewSelectedUrls.size
  const hasPendingCollection=allPreviewItems.length>0&&previewSelectedCount>0
  const completedCollectorMessage=builtInCollectorMessage.startsWith('采集完成')?builtInCollectorMessage:''
  const collectionResultState=running?'running':error?'failed':progress?.stage==='PAUSED'?'paused':progress?.stage==='FAILED'?'failed':hasPendingCollection?'ready':completedCollectorMessage?'success':collectionCompleted&&(progress?.collected||0)<task.maxProducts?'partial':collectionCompleted?'success':'idle'
  const collectionResultText=running?(progress?.message||`正在采集 ${progress?.collected||0} / ${task.maxProducts}`):error?error:hasPendingCollection?'待确认正式采集':completedCollectorMessage||progress?.message||'尚未开始'
  const collectionResultIcon={idle:'●',ready:'→',running:'◉',success:'✓',partial:'!',paused:'⏸',failed:'×'}[collectionResultState]
  const collectionActionLabel=running?(progress?.stage==='CONFIRM_RUNNING'?'正在正式采集…':'正在预采集…'):allPreviewItems.length?`确认正式采集（${previewSelectedCount}）`:'开始预采集'
  const normalizedCandidateQuery = candidateQuery.trim().toLocaleLowerCase()
  const candidateAreaRuns = candidateRuns.filter(run => run.candidateArea === candidateArea)
  const candidateAreaRecords = candidateRecords.filter(record => record.candidateArea === candidateArea)
  const candidatePlatformOptions = candidateArea === 'SUPPLY'
    ? supplyPlatformOptions.map(option => ({ code: option.code, name: option.name, count: supplyProducts.filter(product => product.platformCode === option.code && (candidateStatus === 'DELETED' ? Boolean(product.candidateDeletedAt) : !product.candidateDeletedAt)).length }))
    : (marketplacePlatforms.length ? marketplacePlatforms : [{ code: 'OZON' as MarketplacePlatformCode, name: 'Ozon / 欧众', homeUrl: '', defaultNetworkStrategy: 'LOCAL_DIRECT' as NetworkStrategy, collectorReady: true }]).map(option => ({ code: option.code, name: option.name, count: option.code === 'OZON' ? products.filter(product => candidateStatus === 'DELETED' ? Boolean(product.candidateDeletedAt) : !product.candidateDeletedAt).length : 0 }))
  const candidatePlatformRuns = candidateAreaRuns.filter(run => candidatePlatform === 'ALL' || run.platformCode === candidatePlatform)
  const methodName = (method: CollectionMethod) => method === 'KEYWORD' ? '关键词搜索' : method === 'PRODUCT_URL' ? '单链接采集' : '类目页采集'
  const provenanceMatches = (candidateKey: string) => {
    const records = candidateAreaRecords.filter(record => record.candidateKey === candidateKey)
    if (!records.length) return candidateMethod === 'ALL' && candidateRunId === 'ALL' && candidatePlatform === 'ALL'
    return records.some(record => (candidateMethod === 'ALL' || record.collectionMethod === candidateMethod) && (candidateRunId === 'ALL' || record.collectionRunId === candidateRunId) && (candidatePlatform === 'ALL' || record.platformCode === candidatePlatform))
  }
  const supplyCandidatePool = supplyProducts.filter(product => {
    const queryMatches = !normalizedCandidateQuery || `${product.title} ${product.productId} ${product.supplierName}`.toLocaleLowerCase().includes(normalizedCandidateQuery)
    const deletionMatches = candidateStatus === 'DELETED' ? Boolean(product.candidateDeletedAt) : !product.candidateDeletedAt
    const statusMatches = candidateStatus === 'ALL' || candidateStatus === 'DELETED' || (candidateStatus === 'SELECTED' ? product.selected : !product.selected)
    return queryMatches && deletionMatches && statusMatches && provenanceMatches(`${product.platformCode}:${product.url}`)
  })
  const marketCandidatePool = products.filter(product => (candidateStatus === 'DELETED' ? Boolean(product.candidateDeletedAt) : !product.candidateDeletedAt) && (!normalizedCandidateQuery || `${product.title} ${product.productId} ${product.brand}`.toLocaleLowerCase().includes(normalizedCandidateQuery)) && provenanceMatches(`OZON:${product.url}`))
  const candidateCatalogPaths = (candidateArea === 'SUPPLY' ? supplyCandidatePool : marketCandidatePool).map(candidateCatalogPath)
  const candidateCategoryMatches = (product: CollectedSupplyProduct | CollectedOzonProduct) => {
    const catalog = candidateCatalogPath(product)
    return candidateCategory === 'ALL' || catalog.category === candidateCategory || catalog.subcategory === candidateCategory || catalog.tertiaryCategory === candidateCategory
  }
  const visibleSupplyCandidates = supplyCandidatePool.filter(candidateCategoryMatches)
  const visibleMarketCandidates = marketCandidatePool.filter(candidateCategoryMatches)
  const candidateMethodGroups = (['KEYWORD','PRODUCT_URL','CATEGORY_URL'] as CollectionMethod[]).map(method => {
    const runs = candidatePlatformRuns.filter(run => run.collectionMethod === method)
    const keys = new Set(candidateAreaRecords.filter(record => record.collectionMethod === method && (candidatePlatform === 'ALL' || record.platformCode === candidatePlatform)).map(record => record.candidateKey))
    return { method, runs, productCount: keys.size, selectedCount: runs.reduce((sum, run) => sum + run.selectedCount, 0) }
  }).filter(group => group.runs.length > 0)
  const candidateProvenance = (candidateKey: string) => candidateAreaRecords.filter(record => record.candidateKey === candidateKey)
  const visibleCandidateKeys = candidateArea === 'SUPPLY' ? visibleSupplyCandidates.map(product => `${product.platformCode}:${product.url}`) : visibleMarketCandidates.map(product => `OZON:${product.url}`)

  const applyCandidateWorkspace = (workspace: Awaited<ReturnType<typeof window.desktop.candidates.list>>) => {
    setProducts(workspace.products)
    setSupplyProducts(workspace.supplyProducts)
    setCandidateRuns(workspace.runs)
    setCandidateRecords(workspace.records)
    setSelectedCandidateKeys(new Set())
    void window.desktop.workflow.counts().then(setWorkflowCounts)
  }

  const updateCandidates = async (action: 'delete' | 'restore' | 'purge', candidateKeys: string[]) => {
    if (!candidateKeys.length) return
    const prompt = action === 'delete' ? `确定将这 ${candidateKeys.length} 个商品移入已删除状态吗？` : action === 'restore' ? `确定恢复这 ${candidateKeys.length} 个商品吗？` : `确定永久删除选中的 ${candidateKeys.length} 个候选商品吗？\n\n候选商品及候选来源将从数据库物理删除，但保留最小收录指纹，防止相同商品再次采集。优选产品和正式入库数据不受影响。此操作不可恢复。`
    if (!window.confirm(prompt)) return
    setError('')
    try {
      const workspace = await window.desktop.candidates[action]({ candidateArea, candidateKeys })
      applyCandidateWorkspace(workspace)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '候选商品操作失败') }
  }

  const toggleCandidateSelection = (candidateKey: string) => setSelectedCandidateKeys(current => {
    const next = new Set(current)
    if (next.has(candidateKey)) next.delete(candidateKey); else next.add(candidateKey)
    return next
  })

  const activateMarketplace = async (platformCode: MarketplacePlatformCode, accountId: string, strategy: NetworkStrategy) => {
    setTask(current => ({ ...current, ...protectionSettingsFor(platformCode), selectionMode:'REVERSE_MARKET', collectionMethod:'KEYWORD', marketplacePlatform: platformCode, marketplaceAccountId: accountId, networkStrategy: strategy, name: `${marketplacePlatforms.find(item => item.code === platformCode)?.name || platformCode} 砚都跨境任务` }))
    setPage('tasks'); setPlatform('ozon'); setError('')
    try { await window.desktop.marketplace.activate(platformCode, accountId, strategy) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '跨境平台浏览器打开失败') }
  }

  const selectMarketplace = async (platformCode: MarketplacePlatformCode) => {
    const profile = marketplacePlatforms.find(item => item.code === platformCode)
    if (!profile) return
    let account = marketplaceAccounts.find(item => item.platformCode === platformCode)
    if (!account) {
      account = await window.desktop.marketplace.addAccount(platformCode, `${profile.name} 采集账号1`)
      setMarketplaceAccounts(current => [...current, account!])
    }
    await activateMarketplace(platformCode, account.id, account.networkStrategy)
  }

  const addMarketplaceAccount = async () => {
    const name = window.prompt('请输入新采集账号名称')?.trim()
    if (!name) return
    try {
      const account = await window.desktop.marketplace.addAccount(task.marketplacePlatform, name)
      setMarketplaceAccounts(current => [...current, account])
      await activateMarketplace(task.marketplacePlatform, account.id, account.networkStrategy)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '新增账号失败') }
  }

  const activateProductWarehouse = async(code:ProductWarehouseCode,nextPage:AppPage='tasks')=>{
    supplyActivationRequest.current += 1
    setActiveWarehouse(code)
    setCandidateRunId('ALL');setCandidateMethod('ALL');setCandidateStatus('ALL');setCandidateCategory('ALL');setCandidateBatchMode(false);setSelectedCandidateKeys(new Set())
    if(code==='1688'||code==='GIGACLOUD'){
      setCandidateArea('SUPPLY');setCandidatePlatform(code)
      selectMode('FORWARD_SUPPLY')
      selectSupplyPlatform(code,code==='1688'?'1688':'大健云仓')
    }else{
      setCandidateArea('MARKET');setCandidatePlatform(code)
      selectMode('REVERSE_MARKET')
      await selectMarketplace(code)
    }
    setPage(nextPage)
  }

  const openWarehouseCandidates=(code:ProductWarehouseCode)=>{
    setActiveWarehouse(code)
    setCandidateRunId('ALL');setCandidateMethod('ALL');setCandidateStatus('ALL');setCandidateCategory('ALL');setCandidateBatchMode(false);setSelectedCandidateKeys(new Set())
    setCandidateArea(code==='1688'||code==='GIGACLOUD'?'SUPPLY':'MARKET')
    setCandidatePlatform(code)
    setPage('ozon')
  }

  const translateBrowserPage = async (mode: BrowserTranslationMode, silent = false) => {
    if (translationRunning.current) return
    translationRunning.current = true
    if (!silent) setTranslating(true)
    try {
      const status = await window.desktop.browser.translate(mode)
      setTranslationCount(current => current + status.translated)
      setTranslationActive(true)
      setTranslationMode(mode)
    } catch (reason) {
      if (!silent) setError(reason instanceof Error ? reason.message : '网页翻译失败')
    } finally {
      translationRunning.current = false
      if (!silent) setTranslating(false)
    }
  }

  const restoreBrowserTranslation = async () => {
    await window.desktop.browser.restoreTranslation()
    setTranslationActive(false)
    setTranslationCount(0)
    setTranslationMenuOpen(false)
  }

  const startBuiltInCollector = async () => {
    setError('')
    setBuiltInCollectorMessage('')
    try {
      const state = await window.desktop.browser.startCollector()
      setBuiltInCollectorActive(state.active)
      setBuiltInCollectorProducts(state.products)
      setBuiltInCollectorRecognized(state.recognizedCount)
      setBuiltInCollectorMessage(state.recognizedCount ? `当前页已识别 ${state.recognizedCount} 个商品，请点击图片右上角的“采集”` : '当前页面暂未识别到商品，可继续浏览大健云仓')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '无法开启商品选择模式') }
  }

  const removeBuiltInCollectorProduct = async (url: string) => {
    const state = await window.desktop.browser.removeCollectorProduct(url)
    setBuiltInCollectorProducts(state.products)
    setBuiltInCollectorRecognized(state.recognizedCount)
  }

  const confirmBuiltInCollector = async () => {
    if (!builtInCollectorProducts.length || builtInCollectorConfirming) return
    setBuiltInCollectorConfirming(true)
    setError('')
    try {
      const result = await window.desktop.browser.confirmCollector()
      const candidates = await window.desktop.candidates.list()
      setSupplyProducts(candidates.supplyProducts)
      setCandidateRuns(candidates.runs)
      setCandidateRecords(candidates.records)
      setCandidateArea('SUPPLY')
      setCandidatePlatform('GIGACLOUD')
      const collectorState = await window.desktop.browser.startCollector()
      setBuiltInCollectorActive(collectorState.active)
      setBuiltInCollectorProducts(collectorState.products)
      setBuiltInCollectorRecognized(collectorState.recognizedCount)
      const duplicateDetail=result.duplicates.slice(0,6).map(item=>`${item.productId||'无ID'}：${item.message}`).join('；')
      setBuiltInCollectorMessage(`采集完成：新增 ${result.imported} 个，阻止重复 ${result.blocked} 个；候选总数 ${result.total} 个${duplicateDetail?`。${duplicateDetail}`:''}`)
      await window.desktop.workflow.counts().then(setWorkflowCounts)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '确认采集失败') }
    finally { setBuiltInCollectorConfirming(false) }
  }

  const importCandidate = async (sourceArea: CandidateArea, product: CollectedOzonProduct | CollectedSupplyProduct) => {
    setError('')
    try {
      const catalog = sourceArea === 'SUPPLY' ? supplyCatalog(product as CollectedSupplyProduct) : { ...inferCatalog(product.title), tertiaryCategory:'待细分' }
      const imported = await window.desktop.selections.import({ sourceArea, product, ...catalog })
      setSelectionItems(current => [imported, ...current.filter(item => item.id !== imported.id)])
      await window.desktop.workflow.counts().then(setWorkflowCounts)
      setPage('comparison')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '加入AI选品失败') }
  }

  const returnSelectionToCandidates = async (item: SelectionCatalogItem) => {
    setError('')
    try {
      await window.desktop.selections.returnToCandidates(item.id)
      setSelectionItems(current => current.filter(entry => entry.id !== item.id))
      await window.desktop.workflow.counts().then(setWorkflowCounts)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '返回AI候选失败') }
  }

  const startComparison = async (product: CollectedOzonProduct) => {
    setError('')
    try {
      const record = await window.desktop.comparisons.import({ product })
      setComparisons(current => [record,...current.filter(item=>item.id!==record.id)])
      await window.desktop.workflow.counts().then(setWorkflowCounts)
      setPage('sourcing')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '发起比价失败') }
  }

  const selectionModulePages: AppPage[] = ['warehouse-dashboard','tasks','ozon','sourcing','comparison','review','catalog']
  const inSelectionModule = selectionModulePages.includes(page)
  const artModulePages: AppPage[] = ['image-studio','realshift']
  const inArtModule = artModulePages.includes(page)
  const activeWarehouseProfile=productWarehouses.find(item=>item.code===activeWarehouse)!
  const warehouseSelectionItems=selectionItems.filter(item=>item.platformCode===activeWarehouse)
  const warehouseComparisons=activeWarehouse==='OZON'?comparisons:[]
  const warehouseCount=(code:ProductWarehouseCode)=>code==='1688'||code==='GIGACLOUD'
    ? warehouseProducts.filter(item=>item.warehouseCode===code).length
    : selectionItems.filter(item=>item.platformCode===code&&item.decision==='APPROVED').length
  const warehouseCandidateCount=(code:ProductWarehouseCode)=>code==='1688'||code==='GIGACLOUD'
    ? supplyProducts.filter(item=>item.platformCode===code&&!item.candidateDeletedAt).length
    : code==='OZON'?products.filter(item=>!item.candidateDeletedAt).length:0
  const warehouseSelectedCount=(code:ProductWarehouseCode)=>selectionItems.filter(item=>item.platformCode===code&&item.decision==='APPROVED').length
  const warehouseComparedCount=(code:ProductWarehouseCode)=>code==='OZON'?comparisons.length:0
  const warehouseLastRun=(code:ProductWarehouseCode)=>candidateRuns.find(run=>run.platformCode===code)
  const dashboardToday=new Date().toISOString().slice(0,10)
  const dashboardTodayNew=candidateRuns.filter(run=>run.completedAt?.slice(0,10)===dashboardToday).reduce((sum,run)=>sum+run.newCount,0)
  const dashboardCandidateTotal=products.filter(item=>!item.candidateDeletedAt).length+supplyProducts.filter(item=>!item.candidateDeletedAt).length
  const dashboardSelectedTotal=selectionItems.filter(item=>item.decision==='APPROVED').length
  const recentDashboardRuns=[...candidateRuns].sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).slice(0,6)
  const mergeWarehouseSelections=(next:SelectionCatalogItem[])=>setSelectionItems(current=>[...current.filter(item=>item.platformCode!==activeWarehouse),...next])

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">砚</span><div><strong>砚都跨境</strong><small>Sourcing Desk</small></div></div>
      <nav>
        <NavButton label="eBay平台" icon="ebay" active={page==='ebay'} onClick={()=>setPage('ebay')} />
        <NavButton label="合规知识库" icon="compliance" active={page==='compliance-knowledge'} onClick={()=>setPage('compliance-knowledge')} />
        <NavButton label="旧版内容" icon="archive" active={page!=='ebay'&&page!=='compliance-knowledge'} onClick={()=>setPage('warehouse-dashboard')} />
      </nav>
    </aside>

    <main>
      {/* 导航功能统一直接渲染工作区，不使用占用顶部空间的全局页面头部。 */}
      {page!=='ebay'&&page!=='compliance-knowledge'&&<div className="legacy-module-nav">
        <span className="legacy-module-title"><b>旧版内容</b><small>原功能归档</small></span>
        <button className={inSelectionModule?'active':''} onClick={()=>setPage('warehouse-dashboard')}>供应仓库</button>
        <button className={inArtModule?'active':''} onClick={()=>setPage('image-studio')}>AI美工</button>
        <button className={page==='publishing'?'active':''} onClick={()=>setPage('publishing')}>平台运营</button>
        <button className={page==='procurement'?'active':''} onClick={()=>setPage('procurement')}>AI采购</button>
        <button className={page==='finance'?'active':''} onClick={()=>setPage('finance')}>AI财务</button>
        <button className={page==='ai-support'?'active':''} onClick={()=>setPage('ai-support')}>AI客服</button>
        <button className={page==='feishu'?'active':''} onClick={()=>setPage('feishu')}>AI飞书</button>
      </div>}
      {page==='ebay'&&<EbayPlatformWorkspace/>}
      {page==='compliance-knowledge'&&<ComplianceKnowledgePage/>}
      {inSelectionModule && <><div className="warehouse-module-nav">{productWarehouses.map(item=><button key={item.code} className={page!=='warehouse-dashboard'&&activeWarehouse===item.code?'active':''} onClick={()=>void activateProductWarehouse(item.code,'tasks')}><span><b>{item.name}</b><small>{item.description}</small></span><em>{warehouseCount(item.code)}</em></button>)}</div>{page!=='warehouse-dashboard'&&<div className="selection-module-nav warehouse-flow-nav"><button className={page==='tasks'?'active':''} onClick={()=>setPage('tasks')}><span>AI采集</span></button><button className={page==='ozon'?'active':''} onClick={()=>setPage('ozon')}><span>采集侯选</span></button><button className={page==='comparison'?'active':''} onClick={()=>setPage('comparison')}><span>优选产品</span>{warehouseSelectionItems.length>0&&<em>{warehouseSelectionItems.length}</em>}</button>{activeWarehouse!=='GIGACLOUD'&&<button className={page==='sourcing'?'active':''} onClick={()=>setPage('sourcing')}><span>AI比价</span>{warehouseComparisons.length>0&&<em>{warehouseComparisons.length}</em>}</button>}<button className={page==='review'?'active':''} onClick={()=>setPage('review')}><span>正式入库</span>{warehouseCount(activeWarehouse)>0&&<em>{warehouseCount(activeWarehouse)}</em>}</button></div>}</>}
      {inArtModule && <div className="selection-module-nav art-module-nav"><button className={page==='image-studio'?'active':''} onClick={()=>setPage('image-studio')}><span>AI做图</span></button><button className={page==='realshift'?'active':''} onClick={()=>setPage('realshift')}><span>AI洗图</span></button></div>}
      {page==='warehouse-dashboard'&&<section className="warehouse-dashboard">
        <div className="warehouse-dashboard-heading"><div><small>WAREHOUSE OVERVIEW</small><h2>供应仓库总览</h2><p>本页只读取本地业务数据，不连接或登录任何供应平台。</p></div><span>本地数据</span></div>
        <div className="warehouse-dashboard-metrics">
          <article><small>采集候选</small><b>{dashboardCandidateTotal}</b><span>全部仓库</span></article>
          <article><small>优选产品</small><b>{dashboardSelectedTotal}</b><span>已通过决策</span></article>
          <article><small>待比价商品</small><b>{Math.max(0,dashboardSelectedTotal-comparisons.length)}</b><span>尚未形成比价</span></article>
          <article><small>正式入库</small><b>{workflowCounts.stocked}</b><span>本地库存记录</span></article>
          <article><small>今日新增</small><b>{dashboardTodayNew}</b><span>采集新增商品</span></article>
        </div>
        <div className="warehouse-dashboard-grid">{productWarehouses.map(item=>{const lastRun=warehouseLastRun(item.code);const status=lastRun?.status||'IDLE';return <article key={item.code} className="warehouse-dashboard-card">
          <header><div><b>{item.name}</b><small>{item.description}</small></div><i className={status.toLowerCase()}>{status==='FAILED'?'异常':status==='RUNNING'?'执行中':status==='PAUSED'?'已暂停':lastRun?'已完成':'空闲'}</i></header>
          <dl><div><dt>采集候选</dt><dd>{warehouseCandidateCount(item.code)}</dd></div><div><dt>优选产品</dt><dd>{warehouseSelectedCount(item.code)}</dd></div>{item.code!=='GIGACLOUD'&&<div><dt>待比价</dt><dd>{Math.max(0,warehouseSelectedCount(item.code)-warehouseComparedCount(item.code))}</dd></div>}<div><dt>正式入库</dt><dd>{warehouseCount(item.code)}</dd></div></dl>
          <p>{lastRun?`最近采集：${lastRun.collectedCount} 个 · ${new Date(lastRun.startedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}`:'暂无采集任务记录'}</p>
          <footer><button onClick={()=>openWarehouseCandidates(item.code)}>查看本地候选</button><button className="primary" onClick={()=>void activateProductWarehouse(item.code,'tasks')}>进入{item.name}</button></footer>
        </article>})}</div>
        <div className="warehouse-dashboard-bottom">
          <section><div className="dashboard-section-title"><b>选品流程</b><small>全部仓库本地数据</small></div><div className="warehouse-flow-funnel"><span><b>{dashboardCandidateTotal}</b><small>采集候选</small></span><i>→</i><span><b>{dashboardSelectedTotal}</b><small>优选产品</small></span><i>→</i><span><b>{comparisons.length}</b><small>AI比价</small></span><i>→</i><span><b>{workflowCounts.stocked}</b><small>正式入库</small></span></div></section>
          <section><div className="dashboard-section-title"><b>最近任务</b><small>仅展示本地执行记录</small></div>{recentDashboardRuns.length?<div className="dashboard-run-list">{recentDashboardRuns.map(run=><article key={run.id}><span>{productWarehouses.find(item=>item.code===run.platformCode)?.name||run.platformCode}</span><b>{run.collectedCount} 个</b><small>{run.status}</small></article>)}</div>:<p className="dashboard-empty">暂无采集任务</p>}</section>
        </div>
      </section>}
      {page === 'tasks' && <div className="workspace">
        <section className="task-panel">
          <div className="task-workbench-heading"><small>COLLECTION WORKBENCH</small><h2>采集工作台</h2><p>配置采集平台、入口和任务参数</p></div>
          <form onSubmit={createTask}>
            <section className="task-config-card">
              <div className="config-card-title"><span>01</span><div><b>平台与采集身份</b><small>查看登录状态和管理登录凭据</small></div></div>
              <div className="config-card-body">
                {task.selectionMode === 'FORWARD_SUPPLY' ? <>
                  <div className="identity-summary"><span className="dot"/><div><b>{activeSupplyPlatform.name} · {task.supplyPlatforms[0]==='GIGACLOUD'&&supplyActivation?supplyActivation.loginStatus==='ONLINE'?'会话有效':supplyActivation.loginStatus==='VERIFICATION_REQUIRED'?'需要人工验证':supplyActivation.loginStatus==='OFFLINE'?'登录已失效':supplyActivation.loginStatus==='UNKNOWN'?'登录状态待确认':'正在检查登录':activeSupplyPlatform.ready?'已接入':'采集器待接入'}</b><small>{task.supplyPlatforms[0]==='GIGACLOUD'&&supplyActivation?supplyActivation.message:'浏览器登录状态保留 · 跟随本地网络'}</small></div></div>
                  <CredentialPanel accountId={`supply:${task.supplyPlatforms[0] || '1688'}:default`} platformCode={task.supplyPlatforms[0] || '1688'} />
                </> : <div className="marketplace-config">
                  <label>当前市场仓<select value={task.marketplacePlatform} disabled><option value={activeWarehouse}>{activeWarehouseProfile.name}{activeMarketplace?.collectorReady?'':'（采集器待接入）'}</option></select></label>
                  <div className="account-row"><label>采集账号<select value={task.marketplaceAccountId} onChange={e=>{ const account = marketplaceAccounts.find(item=>item.id===e.target.value); if (account) void activateMarketplace(task.marketplacePlatform, account.id, account.networkStrategy) }}>{visibleMarketplaceAccounts.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button type="button" onClick={()=>void addMarketplaceAccount()}>＋ 添加</button></div>
                  <label>网络策略<select value={task.networkStrategy} onChange={e=>void activateMarketplace(task.marketplacePlatform, task.marketplaceAccountId, e.target.value as NetworkStrategy)}><option value="LOCAL_DIRECT">本地网络直连</option><option value="SYSTEM">跟随系统网络</option><option value="PROXY_PROFILE" disabled>指定代理（请先配置线路）</option></select></label>
                  <div className="identity-summary"><span className="dot"/><div><b>{activeMarketplace?.name || '跨境平台'} · 账号会话独立</b><small>{task.networkStrategy === 'LOCAL_DIRECT' ? '本地网络直连' : '跟随系统网络'} · 登录状态保留</small></div></div>
                  <CredentialPanel accountId={task.marketplaceAccountId} platformCode={task.marketplacePlatform} />
                </div>}
              </div>
            </section>

            <section className="task-config-card">
              <div className="config-card-title"><span>02</span><div><b>采集入口</b><small>{isGigaCloudCollector?'在右侧浏览器选择商品并统一确认':'配置关键词、商品链接或类目入口'}</small></div></div>
              <div className="config-card-body">
                {isGigaCloudCollector?<div className="collector-entry-guide"><div><span>🤖</span><p><b>浏览器采集插件已开启</b><small>请先使用大健云仓原生条件筛选，再点击商品“采集”，选好后统一确认。</small></p></div><dl><div><dt>当前已选</dt><dd>{previewSelectedCount} 个</dd></div><div><dt>任务上限</dt><dd>{task.maxProducts} 个</dd></div></dl></div>:<><label className="compact-select-field">采集方式<select value={task.collectionMethod} onChange={e=>setTask({...task,collectionMethod:e.target.value as SelectionTaskDraft['collectionMethod']})}><option value="KEYWORD">关键词搜索</option>{task.selectionMode === 'FORWARD_SUPPLY' && <><option value="PRODUCT_URL">单链接采集</option><option value="CATEGORY_URL">类目页采集</option></>}</select></label>
                {task.collectionMethod === 'KEYWORD' ? <label>{task.selectionMode === 'FORWARD_SUPPLY' ? '商品关键词' : `${activeMarketplace?.name || '跨境平台'}搜索词`}<input required placeholder="例如：宠物食品" value={task.keyword} onChange={e => setTask({ ...task, keyword: e.target.value })} /></label> : <label>{task.collectionMethod === 'PRODUCT_URL' ? '商品详情链接' : '产品类目页链接'}<div className="url-input-row"><input required type="url" placeholder="https://" value={task.sourceUrl} onChange={e=>setTask({...task,sourceUrl:e.target.value})} />{task.selectionMode === 'FORWARD_SUPPLY' && <button type="button" onClick={useCurrentSupplyPage}>当前页面</button>}</div></label>}
                <div className="field-row"><label>最多采集商品<input type="number" min="1" value={task.maxProducts} onChange={e=>setTask({...task,maxProducts:+e.target.value})} /></label>{task.collectionMethod === 'CATEGORY_URL' && <label>最多采集页数<input type="number" min="1" value={task.maxPages} onChange={e=>setTask({...task,maxPages:+e.target.value})} /></label>}</div></>}
              </div>
            </section>

            {!isGigaCloudCollector&&<details className="task-filter-card">
              <summary><span><b>03　商品筛选条件</b><small>已设置 {activeFilterCount} 项</small></span><i>⌄</i></summary>
              <div className="filter-card-body"><div className="warehouse-rule-chips">{warehouseRuleProfiles[activeWarehouse].map(rule=><span key={rule}>{rule}</span>)}</div>{task.selectionMode === 'FORWARD_SUPPLY' ? task.supplyPlatforms[0] === 'GIGACLOUD' ? <>
                <div className="field-row"><label>Seller GIGA Index<select value={task.gigaSellerIndexFilter} onChange={e=>setTask({...task,gigaSellerIndexFilter:e.target.value as GigaSellerIndexFilter})}><option value="ANY">不限</option><option value="NEW">新Seller</option><option value="GE90">≥90</option><option value="GE80">≥80</option><option value="GE70">≥70</option><option value="GE60">≥60</option><option value="LT60">＜60</option></select></label><label>店铺退货率<select value={task.gigaReturnRateFilter} onChange={e=>setTask({...task,gigaReturnRateFilter:e.target.value as GigaReturnRateFilter})}><option value="ANY">不限</option><option value="LOW">低</option><option value="MEDIUM">中</option><option value="HIGH">高</option></select></label></div>
                <p className="giga-filter-note">以上为选品建议值。请先使用大健云仓原生筛选，再通过右上角“选择采集”标记商品。</p>
              </> : <>
                <div className="field-row"><label>可接受最大 MOQ<input type="number" min="1" value={task.maxMoq} onChange={e=>setTask({...task,maxMoq:+e.target.value})}/></label><label>供应商最低年限<input type="number" min="0" value={task.minSupplierYears} onChange={e=>setTask({...task,minSupplierYears:+e.target.value})}/></label></div>
                <label className="check-field"><input type="checkbox" checked={task.onlyVerifiedSupplier} onChange={e=>setTask({...task,onlyVerifiedSupplier:e.target.checked})}/>只采集认证或实力供应商</label>
              </> : <>
                <div className="field-row"><label>最低评分<input type="number" step="0.1" value={task.minRating} onChange={e=>setTask({...task,minRating:+e.target.value})}/></label><label>最低评论数<input type="number" min="0" value={task.minReviews} onChange={e=>setTask({...task,minReviews:+e.target.value})}/></label></div>
                <div className="field-row"><label>最低价格<input type="number" min="0" value={task.minPrice} onChange={e=>setTask({...task,minPrice:+e.target.value})}/></label><label>最高价格<input type="number" min="0" value={task.maxPrice} onChange={e=>setTask({...task,maxPrice:+e.target.value})}/></label></div>
              </>}</div>
            </details>}

            <details className="task-filter-card protection-config-card">
              <summary><span><b>{isGigaCloudCollector?'03':'04'}　采集保护</b><small>{protectionModeName[task.collectionProtectionMode]} · 分批执行 · 异常自动暂停</small></span><div className="protection-mode-buttons"><button type="button" className={task.collectionProtectionMode==='STANDARD'?'active':''} onClick={event=>{event.preventDefault();event.stopPropagation();selectProtectionMode('STANDARD')}}>标准模式</button><button type="button" className={task.collectionProtectionMode==='FAST'?'active':''} onClick={event=>{event.preventDefault();event.stopPropagation();selectProtectionMode('FAST')}}>快速模式</button></div><i>⌄</i></summary>
              <div className="collection-protection-body"><div className="protection-grid"><label>每批商品<input type="number" min="1" max="50" value={task.collectionBatchSize} onChange={event=>updateProtection({collectionBatchSize:+event.target.value})}/></label><label>休息最短（秒）<input type="number" min="1" value={task.collectionRestMinSeconds} onChange={event=>updateProtection({collectionRestMinSeconds:+event.target.value})}/></label><label>休息最长（秒）<input type="number" min={task.collectionRestMinSeconds} value={task.collectionRestMaxSeconds} onChange={event=>updateProtection({collectionRestMaxSeconds:+event.target.value})}/></label><label>最长运行（分钟）<input type="number" min="1" max="120" value={task.collectionMaxRunMinutes} onChange={event=>updateProtection({collectionMaxRunMinutes:+event.target.value})}/></label></div><label className="protection-check"><input type="checkbox" checked={task.collectionAutoPause} onChange={event=>updateProtection({collectionAutoPause:event.target.checked})}/><span>检测到验证码、登录失效、访问频繁或页面异常时自动暂停</span></label><p>不处理验证码、不伪造浏览器指纹；暂停后请在右侧浏览器人工完成验证再重新启动。</p></div>
            </details>

            {allPreviewItems.length>0&&<section className="collection-preview-card">
              <div className="collection-preview-title"><div><b>预采集产品</b><small>已选 {previewSelectedCount} / {allPreviewItems.length}，确认前不会进入采集侯选</small></div><button type="button" className={previewOnlySelected?'active':''} onClick={()=>setPreviewOnlySelected(value=>!value)}>仅看已选</button></div>
              <div className="collection-preview-tools"><input value={previewQuery} onChange={event=>setPreviewQuery(event.target.value)} placeholder="筛选标题、商品ID或供应商"/>{!pluginPreviewItems.length&&<><button type="button" onClick={()=>setPreviewSelectedUrls(new Set(regularPreviewItems.map(item=>item.url)))}>全选</button><button type="button" onClick={()=>setPreviewSelectedUrls(new Set())}>清空</button></>}</div>
              <div className="collection-preview-grid">{visiblePreviewItems.map(item=><article key={item.url} className={item.source==='PLUGIN'||previewSelectedUrls.has(item.url)?'selected':''}>
                <label><input type="checkbox" checked={item.source==='PLUGIN'||previewSelectedUrls.has(item.url)} onChange={()=>togglePreviewItem(item.url,item.source)}/><span>{item.source==='PLUGIN'?'移除':'选择'}</span></label>
                <button type="button" className="preview-product-open" onClick={()=>item.source==='MARKET'?openProduct(item):openSupplyProduct(item)}>{item.imageUrl?<img src={item.imageUrl} alt=""/>:<span className="preview-no-image">无图</span>}</button>
                <div><b title={item.title}>{item.title}</b><strong>{item.priceText||'价格待采集'}</strong><small>{item.meta}</small></div>
              </article>)}</div>
              {!visiblePreviewItems.length&&<p className="collection-preview-empty">没有符合当前筛选条件的商品</p>}
            </section>}

            <section className="task-summary-card compact">
              <b>采集执行</b>
              <dl><div><dt>采集目标</dt><dd>最多 {task.maxProducts} 个商品</dd></div>{hasPendingCollection&&<div><dt>本次已选</dt><dd>{previewSelectedCount} 个商品</dd></div>}<div className={`collection-result ${collectionResultState}`}><dt>{hasPendingCollection?'当前状态':'采集结果'}</dt><dd title={collectionResultText}><i>{collectionResultIcon}</i><span>{collectionResultText}</span></dd></div></dl>
              {allPreviewItems.length?<button className="primary full" type="button" disabled={running||builtInCollectorConfirming||previewSelectedCount===0} onClick={()=>void (pluginPreviewItems.length?confirmBuiltInCollector():confirmPreview())}>{builtInCollectorConfirming?'正在正式采集…':collectionActionLabel}</button>:<button className="primary full" type="submit" disabled={running}>{task.supplyPlatforms[0]==='GIGACLOUD'?(builtInCollectorActive?'请在右侧选择商品':'开始预采集'):collectionActionLabel}</button>}
            </section>
          </form>
        </section>

        <section className="browser-panel">
          <div className="browser-workspace-heading"><div><small>WORKSPACE BROWSER</small><b>采集浏览器</b></div><div className="browser-heading-actions">{task.supplyPlatforms[0]==='GIGACLOUD'&&<button title={builtInCollectorActive?'采集插件已自动安装；点击可重新加载':'点击启用内置采集插件'} className={`built-in-collector-trigger${builtInCollectorActive?' active':''}`} onClick={()=>void startBuiltInCollector()}>{builtInCollectorActive?`🤖 采集插件 · 已开启 · 已选 ${builtInCollectorProducts.length} / 当前页识别 ${builtInCollectorRecognized}`:'🤖 启用采集插件'}</button>}<div className="browser-translation"><button className={`translation-trigger ${translationActive?'active':''}`} disabled={translating} onClick={()=>translationActive?setTranslationMenuOpen(open=>!open):void translateBrowserPage('BILINGUAL')}><span>{translating?'翻译中…':translationActive?`中文 ✓${translationCount?` · ${translationCount}`:''}`:'译 · 中文'}</span><i>{translationMenuOpen?'⌃':'⌄'}</i></button>{translationMenuOpen&&<div className="translation-menu"><b>网页翻译</b><small>Qwen-MT Flash · 自动识别语种</small><button className={translationMode==='BILINGUAL'?'active':''} onClick={()=>{setTranslationMenuOpen(false);void translateBrowserPage('BILINGUAL')}}><span>原文 + 中文</span><em>推荐</em></button><button className={translationMode==='CHINESE'?'active':''} onClick={()=>{setTranslationMenuOpen(false);void translateBrowserPage('CHINESE')}}><span>仅显示中文</span></button><button onClick={()=>void translateBrowserPage(translationMode)}><span>翻译新增内容</span></button><button className="restore" onClick={()=>void restoreBrowserTranslation()}><span>恢复原网页</span></button><p>滚动加载的新内容每5秒自动翻译；品牌、型号、SKU和数字将尽量保留。</p></div>}</div></div></div>
          <div className="tabs"><div className="tab-scroll">{browserTabs.map(tab=><button key={tab.id} className={tab.active?'active':''} onClick={()=>activateBrowserTab(tab)}><span>{tab.generic?'◎':tab.platform === 'ozon' ? '◉' : '淘'}</span><b>{tab.title}</b>{tab.closable && <i onClick={event=>{event.stopPropagation();void window.desktop.browser.closeTab(tab.id)}}>×</i>}</button>)}</div><button className="new-browser-tab" title="新建浏览页" aria-label="新建浏览页" onClick={()=>void createBrowserTab()}>＋</button>{state?.loading&&<span className="run-state loading"><i/>页面加载中</span>}</div>
          <form className="address-bar" onSubmit={navigate}><button type="button" title="后退" disabled={!state?.canGoBack} onClick={()=>window.desktop.browser.back(platform)}>←</button><button type="button" title="前进" disabled={!state?.canGoForward} onClick={()=>window.desktop.browser.forward(platform)}>→</button><button type="button" title="刷新" onClick={()=>window.desktop.browser.reload(platform)}>↻</button><input ref={addressInput} aria-label="网页地址" placeholder="输入网址并访问" value={address} onChange={e=>setAddress(e.target.value)} /><button className="address-go" type="submit">打开 <span>↗</span></button></form>
          {error && <div className="error">{error}</div>}
          <div className="browser-slot" ref={browserSlot}><div className="browser-placeholder">正在准备 {platform === 'ozon' ? 'Ozon' : platform === 'web' ? '网页' : '1688'} 浏览器…</div></div>
        </section>
      </div>}
      {page === 'ozon' && <section className="candidate-page">
        <ThreeLevelCatalog paths={candidateCatalogPaths} selected={candidateCategory} onSelect={setCandidateCategory}/>
        <div className="candidate-catalog-main">
        <div className="warehouse-page-heading"><div><small>{activeWarehouseProfile.kind==='SUPPLY'?'SUPPLY WAREHOUSE CANDIDATES':'MARKET OPPORTUNITY CANDIDATES'}</small><b>{activeWarehouseProfile.name} · AI候选</b><span>候选数据只归属于当前仓库</span></div><em>{candidatePlatformOptions.find(option=>option.code===candidatePlatform)?.count||0}</em></div>
        <div className="candidate-controls-row"><div className="candidate-view-switch"><button className={candidateMethod==='ALL'?'active':''} onClick={()=>{setCandidateMethod('ALL');setCandidateRunId('ALL');setCandidateView('ALL')}}>全部商品</button><button className={candidateMethod==='KEYWORD'?'active':''} onClick={()=>{setCandidateMethod('KEYWORD');setCandidateRunId('ALL');setCandidateView('ALL')}}>关键词搜索</button><button className={candidateMethod==='PRODUCT_URL'?'active':''} onClick={()=>{setCandidateMethod('PRODUCT_URL');setCandidateRunId('ALL');setCandidateView('ALL')}}>单链接采集</button><button className={candidateMethod==='CATEGORY_URL'?'active':''} onClick={()=>{setCandidateMethod('CATEGORY_URL');setCandidateRunId('ALL');setCandidateView('ALL')}}>类目页采集</button></div></div>
        <div className="candidate-filterbar"><input value={candidateQuery} onChange={event=>setCandidateQuery(event.target.value)} placeholder="搜索商品标题、商品ID或供应商"/><select value={candidateRunId} onChange={event=>setCandidateRunId(event.target.value)}><option value="ALL">全部采集批次</option>{candidatePlatformRuns.filter(run=>candidateMethod==='ALL'||run.collectionMethod===candidateMethod).map(run=><option key={run.id} value={run.id}>{new Date(run.completedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}｜{methodName(run.collectionMethod)}｜{run.collectedCount}个</option>)}</select><select value={candidateStatus} onChange={event=>{setCandidateStatus(event.target.value as typeof candidateStatus);setSelectedCandidateKeys(new Set())}}><option value="ALL">全部状态</option>{candidateArea==='SUPPLY'&&<option value="SELECTED">AI已入选</option>}{candidateArea==='SUPPLY'&&<option value="REVIEW">待人工复核</option>}<option value="DELETED">已删除</option></select><button className={candidateBatchMode?'active candidate-batch-toggle':'candidate-batch-toggle'} onClick={()=>{setCandidateBatchMode(!candidateBatchMode);setSelectedCandidateKeys(new Set())}}>{candidateBatchMode?'退出批量':'批量管理'}</button></div>
        {candidateBatchMode&&<div className="candidate-batchbar"><label><input type="checkbox" checked={visibleCandidateKeys.length>0&&visibleCandidateKeys.every(key=>selectedCandidateKeys.has(key))} onChange={event=>setSelectedCandidateKeys(event.target.checked?new Set(visibleCandidateKeys):new Set())}/>全选当前结果</label><span>已选 <b>{selectedCandidateKeys.size}</b> 个</span><button className={candidateStatus==='DELETED'?'':'danger'} disabled={!selectedCandidateKeys.size} onClick={()=>void updateCandidates(candidateStatus==='DELETED'?'restore':'purge',[...selectedCandidateKeys])}>{candidateStatus==='DELETED'?'恢复已选':'删除已选'}</button>{candidateStatus==='DELETED'&&<button className="danger" disabled={!selectedCandidateKeys.size} onClick={()=>void updateCandidates('purge',[...selectedCandidateKeys])}>彻底删除</button>}</div>}
        <div className="candidate-zone-summary"><span>候选商品 <b>{candidatePlatformOptions.find(option=>option.code===candidatePlatform)?.count || 0}</b></span><span>采集批次 <b>{candidatePlatformRuns.length}</b></span><span>采集方式 <b>{candidateMethodGroups.length}</b></span><span>当前显示 <b>{candidateArea==='SUPPLY'?visibleSupplyCandidates.length:visibleMarketCandidates.length}</b></span></div>
        {candidateView === 'BATCH' ? <div className="candidate-group-grid">{candidatePlatformRuns.length===0?<EmptyState title="暂无采集批次" description="该平台完成采集后，会在这里形成独立批次。" action="去采集" onAction={()=>setPage('tasks')}/>:candidatePlatformRuns.map(run=><button key={run.id} className="candidate-group-card" onClick={()=>{setCandidateRunId(run.id);setCandidateMethod('ALL');setCandidateView('ALL')}}><small>{new Date(run.completedAt).toLocaleString('zh-CN')}</small><b>{run.platformCode} · {methodName(run.collectionMethod)}</b><p>{run.sourceEntry || '未记录采集入口'}</p><div><span>采集 {run.collectedCount}</span><span>新增 {run.newCount}</span><span>更新 {run.updatedCount}</span><span>AI入选 {run.selectedCount}</span></div></button>)}</div> : candidateView === 'METHOD' ? <div className="candidate-group-grid">{candidateMethodGroups.length===0?<EmptyState title="暂无采集方式记录" description="该平台完成采集后会按关键词、单链接和类目页自动归类。" action="去采集" onAction={()=>setPage('tasks')}/>:candidateMethodGroups.map(group=><button key={group.method} className="candidate-group-card" onClick={()=>{setCandidateMethod(group.method);setCandidateRunId('ALL');setCandidateView('ALL')}}><small>COLLECTION METHOD</small><b>{methodName(group.method)}</b><p>共 {group.runs.length} 个采集批次</p><div><span>去重商品 {group.productCount}</span><span>AI入选 {group.selectedCount}</span></div></button>)}</div> : candidateArea === 'SUPPLY' ? <>
          {visibleSupplyCandidates.length === 0 ? <EmptyState title="暂无供应链候选" description="当前筛选条件下没有候选商品。" action="清除筛选" onAction={()=>{setCandidateRunId('ALL');setCandidateMethod('ALL');setCandidateStatus('ALL')}} /> : <div className="product-grid">{visibleSupplyCandidates.map(product=>{const candidateKey=`${product.platformCode}:${product.url}`;const sources=candidateProvenance(candidateKey);const source=sources[0];const exactCatalog=exactSupplyCatalog(product);const catalog=candidateCatalogPath(product);const preferred=warehouseSelectionItems.some(item=>item.sourceUrl===product.url);return <SupplyCandidateCard key={`supply-${product.url}`} product={product} candidateKey={candidateKey} sourceCount={sources.length} sourceText={source?`${methodName(source.collectionMethod)} · ${source.sourceEntry}`:'采集来源待补充'} catalog={catalog} exactCatalog={Boolean(exactCatalog)} batchMode={candidateBatchMode} checked={selectedCandidateKeys.has(candidateKey)} preferred={preferred} onToggle={()=>toggleCandidateSelection(candidateKey)} onRestore={()=>void updateCandidates('restore',[candidateKey])} onPurge={()=>void updateCandidates('purge',[candidateKey])} onPrefer={()=>preferred?setPage('comparison'):void importCandidate('SUPPLY',product)} onOpen={()=>openSupplyProduct(product)} onDelete={()=>void updateCandidates('delete',[candidateKey])}/>})}</div>}
        </> : <>
          {visibleMarketCandidates.length === 0 ? <EmptyState title="暂无跨境方候选" description="当前筛选条件下没有候选商品。" action="清除筛选" onAction={()=>{setCandidateRunId('ALL');setCandidateMethod('ALL');setCandidateStatus('ALL')}} /> : <div className="product-grid">{visibleMarketCandidates.map(product=>{const candidateKey=`OZON:${product.url}`;const sources=candidateProvenance(candidateKey);const source=sources[0];return <article className={`product-card candidate-product-card${product.candidateDeletedAt?' is-deleted':''}`} key={`market-${product.url}`}><div className="candidate-card-tools">{candidateBatchMode?<label title="选择商品"><input type="checkbox" checked={selectedCandidateKeys.has(candidateKey)} onChange={()=>toggleCandidateSelection(candidateKey)}/></label>:product.candidateDeletedAt?<><button title="恢复商品" onClick={()=>void updateCandidates('restore',[candidateKey])}>恢复</button><button className="danger" title="彻底删除" onClick={()=>void updateCandidates('purge',[candidateKey])}>删除</button></>:<button className="danger" title="从AI候选删除" onClick={()=>void updateCandidates('delete',[candidateKey])}>×</button>}</div><button type="button" className="product-image" title="打开 Ozon 原商品详情" aria-label={`打开 Ozon 商品：${product.title}`} onClick={()=>openProduct(product)}>{product.imageUrl ? <img src={product.imageUrl} alt={product.title} /> : <span>无图片</span>}<span className="image-link-hint">查看 Ozon 详情 ↗</span></button><div className="product-info"><small>Ozon · ID {product.productId || '待识别'} · 来源批次 {sources.length}</small><b title={product.title}>{product.title}</b><strong>{priceInCny(product.priceText)}</strong><div className="original-price">{source ? `${methodName(source.collectionMethod)} · ${source.sourceEntry}` : '采集来源待补充'}</div><div className="product-tags"><span>{product.candidateDeletedAt?'已删除':'待市场分析'}</span><span>{product.brand || '品牌待识别'}</span></div><div className="product-actions candidate-next-actions"><button className="search-1688" disabled={Boolean(product.candidateDeletedAt)} onClick={()=>importCandidate('MARKET', product)}>进入AI选品 <i>→</i></button><button disabled={Boolean(product.candidateDeletedAt)} onClick={()=>searchOn1688(product)}>搜同款</button><button onClick={()=>openProduct(product)}>详情 <i>↗</i></button></div></div></article>})}</div>}
        </>}
        </div>
      </section>}
      {page === 'sourcing' && activeWarehouse!=='GIGACLOUD' && (activeWarehouseProfile.kind==='SUPPLY'?<SupplyPlatformComparisonWorkspace warehouse={activeWarehouse} products={supplyProducts.filter(item=>item.platformCode===activeWarehouse&&!item.candidateDeletedAt)} onCandidates={()=>setPage('ozon')} onSelection={product=>void importCandidate('SUPPLY',product)} onOpen={openSupplyProduct}/>:<ComparisonWorkspace warehouseName={activeWarehouseProfile.name} warehouseRules={warehouseRuleProfiles[activeWarehouse]} records={warehouseComparisons} onRecordsChange={next=>setComparisons(current=>[...current.filter(item=>!warehouseComparisons.some(entry=>entry.id===item.id)),...next])} onCandidates={()=>setPage('ozon')} onSearch={async product=>{const url=await window.desktop.browser.create1688SearchUrl(product.title);setPage('tasks');setPlatform('1688');setTimeout(()=>void window.desktop.browser.openTab('1688',url,`${product.title} · 1688搜款`),80)}} onSelection={async record=>{const imported=await window.desktop.selections.import({sourceArea:'MARKET',product:record.marketProduct,...inferCatalog(record.marketProduct.title),comparison:record});setSelectionItems(current=>[imported,...current.filter(item=>item.id!==imported.id)]);setPage('comparison')}} onPromote={async record=>{const result=await window.desktop.comparisons.promote({id:record.id,...inferCatalog(record.marketProduct.title),tertiaryCategory:'待细分'});setComparisons(current=>current.map(item=>item.id===record.id?result.comparison:item));setSelectionItems(current=>[result.selection,...current.filter(item=>item.id!==result.selection.id)]);setWarehouseProducts(current=>[result.warehouseProduct,...current.filter(item=>item.id!==result.warehouseProduct.id)]);setWorkflowCounts(await window.desktop.workflow.counts())}} onOpenMarket={product=>openProduct(product)} onOpenSupply={url=>{setPage('tasks');setPlatform('1688');void window.desktop.browser.openTab('1688',url,'1688货源')}} />)}
      {page === 'comparison' && <SelectionWorkspace warehouseName={activeWarehouseProfile.name} items={warehouseSelectionItems} onItemsChange={mergeWarehouseSelections} onDecision={()=>{void window.desktop.workflow.counts().then(setWorkflowCounts);void window.desktop.warehouses.list().then(setWarehouseProducts)}} onCandidates={()=>setPage('ozon')} onReturnCandidate={returnSelectionToCandidates} onOpen={item=>{const browserPlatform:Platform=item.platformCode==='1688'?'1688':item.platformCode==='OZON'?'ozon':'web';setPage('tasks');setPlatform(browserPlatform);void window.desktop.browser.openTab(browserPlatform,item.sourceUrl,item.title)}} onNext={activeWarehouse==='GIGACLOUD'?()=>setPage('review'):undefined} nextLabel={activeWarehouse==='GIGACLOUD'?'进入正式入库':undefined} />}
      {page === 'review' && <CatalogWorkspace paths={activeWarehouseProfile.kind==='SUPPLY'?warehouseProducts.filter(item=>item.warehouseCode===activeWarehouse).map(item=>({id:item.id,category:item.category,subcategory:item.subcategory,tertiaryCategory:item.tertiaryCategory})):warehouseSelectionItems.filter(item=>item.decision==='APPROVED').map(item=>({id:item.id,category:item.category,subcategory:item.subcategory,tertiaryCategory:item.tertiaryCategory||'待细分'}))}>{category=>activeWarehouseProfile.kind==='SUPPLY'?<SupplyWarehouseWorkspace products={warehouseProducts.filter(item=>item.warehouseCode===activeWarehouse&&catalogSelectionMatches(item,category))} warehouse={activeWarehouse as '1688'|'GIGACLOUD'} onOpenSelection={()=>setPage('comparison')} onOpenCatalog={()=>setPage('catalog')} onCreateImage={item=>{setImageMarketplaceSelection(null);setImageProduct(item);setPage('image-studio')}} />:<MarketOpportunityWarehouse warehouse={activeWarehouse as 'ALIEXPRESS'|'OZON'} items={warehouseSelectionItems.filter(item=>item.decision==='APPROVED'&&catalogSelectionMatches(item,category))} onOpenSelection={()=>setPage('comparison')} onOpen={item=>{setPage('tasks');setPlatform(item.platformCode==='OZON'?'ozon':'web');void window.desktop.browser.openTab(item.platformCode==='OZON'?'ozon':'web',item.sourceUrl,item.title)}} />}</CatalogWorkspace>}
      {page === 'catalog' && <CatalogManager usagePaths={[...selectionItems.map(item=>({id:item.id,category:item.category,subcategory:item.subcategory,tertiaryCategory:item.tertiaryCategory||'待细分'})),...supplyProducts.filter(item=>item.selected).map(stockCatalogPath)]} onChanged={()=>setCatalogRevision(value=>value+1)} />}
      {page === 'image-studio' && <ImageStudio product={imageProduct} marketplaceSelection={imageMarketplaceSelection} onOpenInventory={()=>setPage(imageMarketplaceSelection?'publishing':'review')} />}
      {page === 'realshift' && <RealShiftWorkbench />}
      {page === 'publishing' && <PublishingWorkspace products={warehouseProducts} onInventory={()=>setPage('review')} onCreateImage={(item,selection)=>{setImageMarketplaceSelection(selection);setImageProduct(item);setPage('image-studio')}} />}
      {page === 'procurement' && <section className="content-page"><div className="page-toolbar"><div><b>采购与履约数据库</b><small>销售订单、供应商采购单、采购明细、物流单号和履约状态</small></div></div><EmptyState title="暂无采购发货任务" description="跨境订单进入后，按 SKU 和供应商自动生成采购及发货履约记录。" action="查看AI发布" onAction={()=>setPage('publishing')} /></section>}
      {page === 'finance' && <section className="content-page"><div className="page-toolbar"><div><b>财务成本利润台账</b><small>销售、采购、运费、平台费、退款、汇率和利润对账</small></div></div><EmptyState title="暂无待核算账期" description="订单、采购和物流产生的费用会自动进入财务流水并按账期对账。" action="查看采购发货" onAction={()=>setPage('procurement')} /></section>}
      {page === 'ai-support' && <AiSupportFramework />}
      {page === 'feishu' && <FeishuBotPage activeTask={activeTask} />}
    </main>
  </div>
}

type PublishSection = 'SELECTION'|'IMAGES'|'WASH'|'CENTER'|'PRODUCTS'|'STORES'|'ISSUES'|'AUDIT'
type LocalPublishStore = { id:string; name:string; sellerId:string; enabled:boolean }

function CredentialPanel({ accountId, platformCode, onStatusChange }: { accountId:string; platformCode:string; onStatusChange?:()=>void|Promise<void> }) {
  const [open,setOpen] = useState(false)
  const [username,setUsername] = useState('')
  const [password,setPassword] = useState('')
  const [passwordSaved,setPasswordSaved] = useState(false)
  const [autoFill,setAutoFill] = useState(false)
  const [message,setMessage] = useState('')
  useEffect(()=>{let active=true;void window.desktop.marketplace.credentialStatus(accountId).then(status=>{if(!active)return;setUsername(status.username);setPasswordSaved(status.passwordSaved);setAutoFill(status.mode==='AUTO_FILL')}).catch(()=>undefined);return()=>{active=false}},[accountId])
  const save = async()=>{try{const status=await window.desktop.marketplace.saveCredential({accountId,platformCode,username,password:password||undefined,mode:autoFill?'AUTO_FILL':'SESSION_ONLY'});setPasswordSaved(status.passwordSaved);setPassword('');await onStatusChange?.();window.dispatchEvent(new CustomEvent('credential-status-change',{detail:{accountId}}));setMessage('凭据已使用系统安全存储保存')}catch(reason){setMessage(reason instanceof Error?reason.message:'凭据保存失败')}}
  const openLogin = async()=>{try{await window.desktop.marketplace.openCredentialLogin(accountId,platformCode);setMessage('已打开平台专用登录页，等页面加载后可填写或登录')}catch(reason){setMessage(reason instanceof Error?reason.message:'登录页打开失败')}}
  const fill = async(submit=false)=>{try{const result=await window.desktop.marketplace.fillCredential(accountId,submit);setMessage(result.verificationRequired?'已提交，当前需要验证码/邮箱/短信人工验证':result.submitted?'已填写并点击登录，请等待页面返回结果':result.usernameFilled||result.passwordFilled?'已安全填入，请人工确认后提交':'当前页未找到可用的登录输入框')}catch(reason){setMessage(reason instanceof Error?reason.message:'自动填充失败')}}
  const clear = async()=>{if(!window.confirm('确定删除当前账号已保存的登录凭据？'))return;await window.desktop.marketplace.deleteCredential(accountId);setUsername('');setPassword('');setPasswordSaved(false);setAutoFill(false);await onStatusChange?.();window.dispatchEvent(new CustomEvent('credential-status-change',{detail:{accountId}}));setMessage('凭据已删除')}
  const loginUrl=platformCode==='GIGACLOUD'?'https://www.gigab2b.com/index.php?route=account/login':platformCode==='1688'?'https://login.1688.com/':platformCode==='EBAY'?'https://www.ebay.com/signin/':'当前平台尚未预置'
  return <div className="credential-panel"><button type="button" className="credential-toggle" onClick={()=>setOpen(!open)}><span><b>登录凭据</b><small>{passwordSaved?'密码已安全保存':'未配置密码'}</small></span><em>{open?'⌃':'⌄'}</em></button>{open&&<div className="credential-body"><label>登录页地址<input value={loginUrl} readOnly/></label><label>登录账号<input value={username} onChange={event=>setUsername(event.target.value)} autoComplete="off" placeholder="邮箱、手机号或用户名"/></label><label>登录密码<input type="password" value={password} onChange={event=>setPassword(event.target.value)} autoComplete="new-password" placeholder={passwordSaved?'已保存，留空表示不修改':'输入密码'}/></label><label className="credential-check"><input type="checkbox" checked={autoFill} onChange={event=>setAutoFill(event.target.checked)}/><span>会话失效时允许安全自动填写</span></label><div className="credential-actions"><button type="button" onClick={()=>void openLogin()}>打开登录页</button><button type="button" className="primary" disabled={!username.trim()||(!password&& !passwordSaved)} onClick={()=>void save()}>保存凭据</button><button type="button" disabled={!passwordSaved} onClick={()=>void fill(false)}>仅填写</button><button type="button" className="primary" disabled={!passwordSaved} onClick={()=>void fill(true)}>填写并登录</button><button type="button" className="danger" disabled={!passwordSaved} onClick={()=>void clear()}>清除</button></div>{message&&<p>{message}</p>}<small className="credential-note">验证码、短信、扫码和风控验证需人工完成；系统不会自动绕过。</small></div>}</div>
}

function PublishingWorkspace({ products, onInventory, onCreateImage }: { products: SupplyWarehouseProduct[]; onInventory: () => void; onCreateImage:(product:SupplyWarehouseProduct,selection:MarketplaceSelectionProduct)=>void }) {
  const [platform,setPlatform] = useState<MarketplacePlatformCode>('OZON')
  const [section,setSection] = useState<PublishSection>('SELECTION')
  const [platformSelections,setPlatformSelections] = useState<MarketplaceSelectionProduct[]>([])
  const [query,setQuery] = useState('')
  const [status,setStatus] = useState<'ALL'|MarketplacePublishStatus>('ALL')
  const [stores,setStores] = useState<LocalPublishStore[]>(()=>{try{return JSON.parse(localStorage.getItem('ozon-publish-stores')||'[]')}catch{return[]}})
  const [items,setItems] = useState<MarketplacePublishDraft[]>([])
  const [audits,setAudits] = useState<MarketplacePublishAudit[]>([])
  const platformProfiles:{code:MarketplacePlatformCode;name:string;market:string;ready:boolean}[] = [
    {code:'OZON',name:'Ozon',market:'俄罗斯及独联体',ready:true},{code:'AMAZON',name:'Amazon',market:'全球站点',ready:false},{code:'EBAY',name:'eBay',market:'全球站点',ready:false},{code:'ALIEXPRESS',name:'AliExpress',market:'跨境零售',ready:false},{code:'TEMU',name:'Temu',market:'全托管与半托管',ready:false}
  ]
  const activePlatform = platformProfiles.find(item=>item.code===platform)!
  const saveStores = (next:LocalPublishStore[])=>{setStores(next);localStorage.setItem('ozon-publish-stores',JSON.stringify(next))}
  const addStore = ()=>{const name=window.prompt('请输入Ozon店铺名称')?.trim();if(!name)return;const sellerId=window.prompt('请输入Seller ID（可稍后补充）')?.trim()||'';saveStores([...stores,{id:crypto.randomUUID(),name,sellerId,enabled:true}])}
  const reloadPublishData = async(code:MarketplacePlatformCode)=>{const [drafts,nextAudits]=await Promise.all([window.desktop.marketplacePublish.list(code),window.desktop.marketplacePublish.audits(code)]);setItems(drafts);setAudits(nextAudits)}
  useEffect(()=>{void Promise.all([window.desktop.marketplaceSelections.list(platform).then(setPlatformSelections),reloadPublishData(platform)])},[platform])
  const addPlatformSelection = async(product:SupplyWarehouseProduct)=>{const item=await window.desktop.marketplaceSelections.import(platform,product.id);setPlatformSelections(current=>[item,...current.filter(entry=>entry.id!==item.id)])}
  const importProducts = async()=>{if(!platformSelections.length){setSection('SELECTION');return}const storeId=stores[0]?.id||'';await Promise.all(platformSelections.map(product=>window.desktop.marketplacePublish.create(product.id,storeId)));await reloadPublishData(platform)}
  const updateItem = async(id:string,patch:Parameters<typeof window.desktop.marketplacePublish.update>[0],action:string)=>{const next=await window.desktop.marketplacePublish.update({...patch,id},action);setItems(current=>current.map(item=>item.id===id?next:item));setAudits(await window.desktop.marketplacePublish.audits(platform))}
  const validate = async(item:MarketplacePublishDraft)=>{const checks=[item.title?'标题已完成':'缺少标题',item.platformSku?'SKU已完成':'缺少SKU',item.imageUrl?'主图已完成':'缺少主图',item.priceText?'价格已完成':'缺少价格',item.storeId?'已分配店铺':'未分配店铺'];const passed=!checks.some(value=>value.startsWith('缺少')||value.startsWith('未分配'));await updateItem(item.id,{id:item.id,checks,status:passed?'VALIDATED':'FAILED',error:passed?'':'发布资料不完整'},passed?'模拟发布通过':'模拟发布失败')}
  const platformItems=items
  const visible=platformItems.filter(item=>(status==='ALL'||item.status===status)&&(!query.trim()||`${item.title} ${item.platformSku}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))
  const current=visible[0]
  const statusLabel:Record<MarketplacePublishStatus,string>={DRAFT:'发布草稿',VALIDATED:'待上传草稿',SELLER_DRAFT:'Ozon草稿',REVIEW:'审核中',PUBLISHED:'已发布',FAILED:'失败'}
  const platformTabs=<div className="publishing-platform-tabs">{platformProfiles.map(item=><button key={item.code} className={platform===item.code?'active':''} onClick={()=>{setPlatform(item.code);setSection('SELECTION')}}><b>{item.name}</b><small>{item.market}</small><em>{item.ready?(item.code==='OZON'&&stores.length?`${stores.length}店铺`:'已开通'):'待接入'}</em></button>)}</div>
  const operationNav=<div className="ozon-publish-subnav">{([['SELECTION','平台选品库'],['IMAGES','AI做图'],['WASH','AI洗图'],['CENTER','发布中心'],['PRODUCTS','在线商品'],['STORES','店铺管理'],['ISSUES','审核与异常'],['AUDIT','发布记录']] as const).map(([value,label])=><button key={value} className={section===value?'active':''} onClick={()=>setSection(value)}>{label}</button>)}</div>
  const openStudio=(selection:MarketplaceSelectionProduct)=>{const source=products.find(product=>product.id===selection.supplyProductId);if(source)onCreateImage(source,selection)}
  const selectionContent=<PlatformSelectionLibrary platform={activePlatform.name} warehouseProducts={products} selections={platformSelections} onAdd={product=>void addPlatformSelection(product)} onCreateImage={openStudio}/>
  if(platform!=='OZON')return <section className="publishing-page"><div className="publishing-top"><div><small>MARKETPLACE OPERATIONS</small><h2>{activePlatform.name}运营工作台</h2><p>选品、素材和发布资料按平台独立保存</p></div><span><i/>{activePlatform.ready?'已开通':'发布器待接入'}</span></div>{platformTabs}{operationNav}{section==='SELECTION'?selectionContent:section==='IMAGES'?<PlatformMediaQueue title={`${activePlatform.name} AI做图`} items={platformSelections} action="进入AI做图" onAction={openStudio}/>:section==='WASH'?<PlatformMediaQueue title={`${activePlatform.name} AI洗图`} items={platformSelections} action="进入AI洗图" onAction={openStudio}/>:<EmptyState title={`${activePlatform.name}${section==='CENTER'?'发布器':'运营功能'}待接入`} description="当前已建立独立选品库和素材入口，正式发布需接入该平台官方API。" action="查看平台选品库" onAction={()=>setSection('SELECTION')}/>}</section>
  return <section className="publishing-page"><div className="publishing-top"><div><small>MARKETPLACE OPERATIONS</small><h2>Ozon运营工作台</h2><p>Ozon选品、素材、店铺和发布记录独立管理</p></div><span><i/>安全测试模式</span></div>{platformTabs}{operationNav}
    {section==='SELECTION'&&selectionContent}
    {section==='IMAGES'&&<PlatformMediaQueue title="Ozon AI做图" items={platformSelections} action="进入AI做图" onAction={openStudio}/>}
    {section==='WASH'&&<PlatformMediaQueue title="Ozon AI洗图" items={platformSelections} action="进入AI洗图" onAction={openStudio}/>} 
    {section==='CENTER'&&<div className="publishing-layout"><aside className="publishing-control"><div className="publish-card"><b>Ozon发布账号</b><label>发布站点<select><option>Ozon 俄罗斯站</option></select></label><label>卖家账号<select value={stores[0]?.id||''} disabled={!stores.length}><option value="">{stores.length?'选择店铺':'尚未配置账号'}</option>{stores.map(store=><option key={store.id} value={store.id}>{store.name}</option>)}</select></label><div className="publish-connect"><i/><span><b>{stores.length?'店铺已配置 · API待授权':'平台API未连接'}</b><small>未配置官方授权时仅保存本地草稿。</small></span></div><button onClick={addStore}>＋ 新增Ozon店铺</button></div><div className="publish-card"><b>安全发布规则</b><span>✓ 发布前必须人工确认</span><span>✓ 默认库存0，不直接在线销售</span><span>✓ 模拟校验与草稿上传分开</span><span>✓ 保存操作记录与失败原因</span></div></aside><main className="publishing-workspace"><div className="publishing-heading"><div><b>Ozon商品发布</b><small>从Ozon平台选品库生成发布草稿</small></div><button className="primary" onClick={()=>void importProducts()}>＋ 从Ozon选品库导入</button></div><div className="publishing-stats">{(['DRAFT','VALIDATED','SELLER_DRAFT','REVIEW','PUBLISHED','FAILED'] as MarketplacePublishStatus[]).map(value=><button key={value} onClick={()=>setStatus(value)}><b>{platformItems.filter(item=>item.status===value).length}</b><small>{statusLabel[value]}</small></button>)}</div><div className="publishing-filters"><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索商品标题、SKU或平台商品ID"/><select value={status} onChange={event=>setStatus(event.target.value as typeof status)}><option value="ALL">全部状态</option>{Object.entries(statusLabel).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div>{visible.length?<div className="ozon-publish-list">{visible.map(item=><article key={item.id}><img src={item.imageUrl} alt=""/><div><small>{statusLabel[item.status]} · SKU {item.platformSku}</small><b>{item.title}</b><span>{item.priceText||'价格待配置'} · {stores.find(store=>store.id===item.storeId)?.name||'未分配店铺'}</span>{item.error&&<em>{item.error}</em>}</div><div><button onClick={()=>void validate(item)}>{item.status==='FAILED'?'重新校验':'模拟发布'}</button><button disabled={item.status!=='VALIDATED'} onClick={()=>void updateItem(item.id,{id:item.id,status:'SELLER_DRAFT'},'生成Ozon本地草稿')}>生成草稿</button><button disabled>提交审核</button></div></article>)}</div>:<div className="publishing-empty"><span>◎</span><h3>暂无Ozon发布商品</h3><p>请先将供应仓商品加入Ozon平台选品库。</p><button className="primary" onClick={()=>setSection('SELECTION')}>进入Ozon选品库</button></div>}</main><aside className="publishing-checklist"><div><b>发布资料检查</b><small>{current?current.title:'Ozon平台要求'}</small></div><ul>{['商品基础资料','平台属性映射','价格与库存','图片与详情','物流与退货','合规与风险'].map((label,index)=><li key={label}><span>{index+1}</span><p><b>{label}</b><small>{current?.checks[index]||'待校验'}</small></p><em>{current?.checks[index]?.startsWith('缺少')?'阻断':'待校验'}</em></li>)}</ul><div className="publishing-note"><b>当前为安全测试模式</b><p>未配置Ozon官方授权，不会向平台发送商品数据。</p></div></aside></div>}
    {section==='PRODUCTS'&&<PublishSimplePanel title="Ozon商品管理" note="本系统发布商品、草稿、审核与已上线商品"><div className="publish-table">{platformItems.map(item=><article key={item.id}><img src={item.imageUrl} alt=""/><b>{item.title}</b><span>{item.platformSku}</span><span>{statusLabel[item.status]}</span><span>{item.updatedAt.slice(0,10)}</span></article>)}</div></PublishSimplePanel>}
    {section==='STORES'&&<PublishSimplePanel title="Ozon店铺管理" note="店铺配置本地保存，API凭据接入后应改用系统安全存储"><button className="primary" onClick={addStore}>＋ 新增店铺</button><div className="store-grid">{stores.map(store=><article key={store.id}><b>{store.name}</b><span>Seller ID：{store.sellerId||'待配置'}</span><span>Ozon 俄罗斯站</span><em>API待授权 · 本地配置</em><button onClick={()=>saveStores(stores.map(item=>item.id===store.id?{...item,enabled:!item.enabled}:item))}>{store.enabled?'停用':'启用'}</button></article>)}</div></PublishSimplePanel>}
    {section==='ISSUES'&&<PublishSimplePanel title="审核与异常" note="集中处理资料阻断、草稿失败和平台审核问题"><div className="issue-list">{platformItems.filter(item=>item.status==='FAILED'||item.error).map(item=><article key={item.id}><b>{item.title}</b><span>{item.error||'未知异常'}</span><button onClick={()=>validate(item)}>修复后重试</button></article>)}</div></PublishSimplePanel>}
    {section==='AUDIT'&&<PublishSimplePanel title="发布记录与审计" note="保存店铺分配、校验、草稿和失败重试记录"><div className="audit-list">{audits.map(entry=><article key={entry.id}><time>{new Date(entry.createdAt).toLocaleString('zh-CN')}</time><b>{entry.action}</b><span>{entry.detail}</span></article>)}</div></PublishSimplePanel>}
  </section>
}

function PlatformSelectionLibrary({ platform, warehouseProducts, selections, onAdd, onCreateImage }: { platform:string; warehouseProducts:SupplyWarehouseProduct[]; selections:MarketplaceSelectionProduct[]; onAdd:(product:SupplyWarehouseProduct)=>void; onCreateImage:(selection:MarketplaceSelectionProduct)=>void }) {
  const selectedIds=new Set(selections.map(item=>item.supplyProductId))
  return <section className="platform-selection-library"><div className="platform-library-heading"><div><small>PLATFORM SELECTION LIBRARY</small><h3>{platform}平台选品库</h3><p>只保存当前平台的选品、素材和发布状态，不会影响其他平台。</p></div><span>已选 <b>{selections.length}</b> 个</span></div><div className="platform-library-columns"><div><header><b>产品供应仓库</b><small>1688仓 + 大健云仓</small></header>{warehouseProducts.length?<div className="platform-library-grid">{warehouseProducts.map(item=><article key={item.id}><img src={item.imageUrl} alt=""/><div><small>{item.warehouseCode==='1688'?'1688仓':'大健云仓'} · {item.productId}</small><b>{item.title}</b><span>{item.priceText||'价格待核验'}</span></div><button disabled={selectedIds.has(item.id)} onClick={()=>onAdd(item)}>{selectedIds.has(item.id)?'已加入':`加入${platform}`}</button></article>)}</div>:<EmptyState title="供应仓暂无商品" description="请先完成供应库的采集、候选、选品、比价和入库。"/>}</div><div><header><b>{platform}已选商品</b><small>图文与发布资料独立</small></header>{selections.length?<div className="platform-selected-grid">{selections.map(item=><article key={item.id}><img src={item.imageUrl} alt=""/><div><small>{item.warehouseCode==='1688'?'1688仓':'大健云仓'} · {item.mediaStatus==='READY'?'素材已完成':'素材待处理'}</small><b>{item.title}</b><span>{item.category} · {item.priceText}</span></div><div><button onClick={()=>onCreateImage(item)}>AI做图</button><button onClick={()=>onCreateImage(item)}>AI洗图</button></div></article>)}</div>:<EmptyState title={`${platform}选品库为空`} description="从左侧供应仓库选择适合当前平台的商品。"/>}</div></div></section>
}

function PlatformMediaQueue({ title, items, action, onAction }: { title:string; items:MarketplaceSelectionProduct[]; action:string; onAction:(item:MarketplaceSelectionProduct)=>void }) {
  return <section className="platform-media-queue"><div><small>PLATFORM MEDIA WORKFLOW</small><h3>{title}</h3><p>素材处理结果仅归属当前平台选品库。</p></div>{items.length?<div>{items.map(item=><article key={item.id}><img src={item.imageUrl} alt=""/><span><small>{item.warehouseCode==='1688'?'1688仓':'大健云仓'} · {item.mediaStatus}</small><b>{item.title}</b><em>{item.priceText}</em></span><button className="primary" onClick={()=>onAction(item)}>{action}</button></article>)}</div>:<EmptyState title="暂无待处理商品" description="请先将供应仓商品加入当前平台选品库。"/>}</section>
}

function PublishSimplePanel({title,note,children}:{title:string;note:string;children:ReactNode}) { return <section className="publish-simple-panel"><div><b>{title}</b><small>{note}</small></div>{children}</section> }

function ComparisonWorkspace({ warehouseName, warehouseRules, records, onRecordsChange, onCandidates, onSearch, onSelection, onPromote, onOpenMarket, onOpenSupply }: { warehouseName:string; warehouseRules:string[]; records: ComparisonRecordView[]; onRecordsChange: (items: ComparisonRecordView[]) => void; onCandidates: () => void; onSearch: (item: CollectedOzonProduct) => Promise<void>; onSelection: (item: ComparisonRecordView) => Promise<void>; onPromote:(item:ComparisonRecordView)=>Promise<void>; onOpenMarket: (item: CollectedOzonProduct) => void; onOpenSupply: (url: string) => void }) {
  const [filter,setFilter] = useState<'ALL'|ComparisonDecision>('ALL')
  const [query,setQuery] = useState('')
  const [expanded,setExpanded] = useState<string[]>([])
  const [promoting,setPromoting] = useState('')
  const [message,setMessage] = useState('')
  const visible = records.filter(item=>(filter==='ALL'||item.decision===filter)&&(!query.trim()||item.marketProduct.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))
  const replace = (next: ComparisonRecordView) => onRecordsChange(records.map(item=>item.id===next.id?next:item))
  const update = async (request: Parameters<typeof window.desktop.comparisons.update>[0]) => replace(await window.desktop.comparisons.update(request))
  const decisionLabel: Record<ComparisonDecision,string> = {PENDING:'待复核',REVIEW:'人工复核',RECOMMENDED:'强推荐',REJECTED:'不建议',FAILED:'比价失败'}
  const changeSetting = (record: ComparisonRecordView, key: keyof ComparisonCostSettings, value: number) => void update({id:record.id,settings:{...record.settings,[key]:Math.max(0,value)}})
  const promote = async(record:ComparisonRecordView)=>{if(record.warehouseProductId)return;setPromoting(record.id);setMessage('');try{await onPromote(record);setMessage(`“${record.marketProduct.title}”已根据主货源进入供应仓。`)}catch(reason){setMessage(readableError(reason,'进入供应仓失败'))}finally{setPromoting('')}}
  return <section className="compare-workbench">
    <aside className="compare-control"><div className="compare-control-heading"><small>REVERSE MARKET COMPARISON</small><h2>{warehouseName} · 跨境对比</h2><p>跨境商品 → 1688同款 → 供应仓</p></div><div className="compare-control-card reverse-flow-card"><b>反向对比流程</b><span>1　跨境市场机会</span><span>2　绑定1688主货源</span><span>3　测算成本与利润</span><span>4　优选进入供应仓</span></div><div className="compare-control-card"><b>任务概况</b><div className="compare-mini-stats"><span><strong>{records.length}</strong><small>全部</small></span><span><strong>{records.filter(item=>item.decision==='PENDING'||item.decision==='REVIEW').length}</strong><small>待复核</small></span><span><strong>{records.filter(item=>item.decision==='RECOMMENDED').length}</strong><small>已推荐</small></span><span><strong>{records.filter(item=>item.warehouseProductId).length}</strong><small>已入供应仓</small></span></div></div><div className="compare-control-card"><b>1688货源环境</b><label>货源账号<select><option>1688 当前浏览器会话</option></select></label><label>线路/IP策略<select><option>本机直连 / VPN分流</option><option>系统代理</option></select></label><p>账号Cookie与跨境平台隔离；登录或验证码需人工处理。</p></div><div className="compare-control-card reverse-flow-card"><b>{warehouseName}专属规则</b>{warehouseRules.map((rule,index)=><span key={rule}>{index+1}　{rule}</span>)}</div><button className="primary compare-start" onClick={onCandidates}>＋ 从跨境候选发起对比</button>
    </aside>
    <div className="compare-main"><div className="compare-toolbar"><div><b>跨境机会与比价数据库</b><small>市场商品、主货源、落地成本、利润与供应仓结果全程关联</small></div><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索跨境市场商品"/></div>{message&&<div className="comparison-result-message">{message}</div>}<div className="compare-filter-tabs">{([['ALL','全部'],['RECOMMENDED','强推荐'],['PENDING','待复核'],['REVIEW','人工复核'],['REJECTED','不建议'],['FAILED','比价失败']] as const).map(([value,label])=><button className={filter===value?'active':''} key={value} onClick={()=>setFilter(value)}>{label}<em>{value==='ALL'?records.length:records.filter(item=>item.decision===value).length}</em></button>)}</div>
      {visible.length===0?<EmptyState title={records.length?'当前筛选下暂无商品':'暂无跨境对比任务'} description="请从AI候选的跨境方商品发起对比。" action="查看AI候选" onAction={onCandidates}/>:<div className="compare-list">{visible.map(record=>{const open=expanded.includes(record.id);const primary=record.suppliers.find(item=>item.binding==='PRIMARY');return <article className="compare-record" key={record.id}><div className="compare-summary"><button className="compare-market-image" onClick={()=>onOpenMarket(record.marketProduct)}>{record.marketProduct.imageUrl?<img src={record.marketProduct.imageUrl} alt=""/>:'无图片'}</button><div className="compare-product"><small>Ozon · {record.marketProduct.productId||'待识别'}</small><b>{record.marketProduct.title}</b><div><span>{record.warehouseProductId?'已进入供应仓':decisionLabel[record.decision]}</span><span>货源 {record.suppliers.length}</span><span>主货源匹配 {primary?.matchScore||0}</span></div></div><div className="compare-money"><span><b>¥{record.purchasePriceCny.toFixed(2)}</b><small>采购价</small></span><span><b>¥{record.landedCostCny.toFixed(2)}</b><small>落地成本</small></span><span className={record.estimatedProfitCny>=0?'profit':'loss'}><b>¥{record.estimatedProfitCny.toFixed(2)}</b><small>净利 / {record.estimatedMargin}%</small></span></div><button className="compare-expand" onClick={()=>setExpanded(current=>open?current.filter(id=>id!==record.id):[...current,record.id])}>{open?'收起':'展开货源'}</button></div>{open&&<div className="compare-details"><div className="compare-cost-panel"><b>跨境成本计算</b><div className="compare-cost-grid"><label>采购价<input type="number" value={record.purchasePriceCny} onChange={event=>void update({id:record.id,purchasePriceCny:Number(event.target.value)})}/></label>{([['exchangeRate','RUB汇率'],['commissionRate','平台佣金%'],['internationalLogistics','头程物流'],['fulfillmentCost','履约费'],['advertisingRate','广告%'],['returnLossRate','退货损耗%']] as Array<[keyof ComparisonCostSettings,string]>).map(([key,label])=><label key={key}>{label}<input type="number" step="0.01" value={record.settings[key]} onChange={event=>changeSetting(record,key,Number(event.target.value))}/></label>)}</div><p>销售额 ¥{record.sellingPriceCny.toFixed(2)} · 佣金、广告、退货和物流已计入。</p></div><div className="supplier-list"><div className="supplier-list-title"><b>1688货源匹配</b><small>匹配分低于85建议人工核对规格、材质和套装数量</small></div>{record.suppliers.map(supplier=><div className={`supplier-row ${supplier.binding.toLocaleLowerCase()}`} key={supplier.url}><button onClick={()=>onOpenSupply(supplier.url)}>{supplier.imageUrl?<img src={supplier.imageUrl} alt=""/>:'无图'}</button><div><b>{supplier.title}</b><small>{supplier.supplierName||'供应商待识别'} · {supplier.priceText} · 匹配 {supplier.matchScore} · 货源 {supplier.supplyScore}</small><span>{supplier.matchScore>=85?'高可信同款':supplier.matchScore>=70?'疑似同款·待复核':'弱相关货源'}</span></div><div><button className={supplier.binding==='PRIMARY'?'active':''} onClick={()=>void update({id:record.id,supplierUrl:supplier.url,binding:'PRIMARY'})}>{supplier.binding==='PRIMARY'?'已绑定':'主货源'}</button><button className={supplier.binding==='BACKUP'?'active':''} onClick={()=>void update({id:record.id,supplierUrl:supplier.url,binding:supplier.binding==='BACKUP'?'NONE':'BACKUP'})}>备选</button></div></div>)}</div><div className="compare-actions"><button onClick={()=>void update({id:record.id,decision:'REJECTED'})}>淘汰</button><button onClick={()=>void update({id:record.id,decision:'REVIEW'})}>待人工复核</button><button className="primary" onClick={()=>void update({id:record.id,decision:'RECOMMENDED'})}>确认比价</button><button disabled={!primary} onClick={()=>void onSelection(record)}>加入AI选品</button><button className="primary" disabled={!primary||Boolean(record.warehouseProductId)||promoting===record.id} onClick={()=>void promote(record)}>{record.warehouseProductId?'已进入供应仓':promoting===record.id?'正在入库…':'优选进入供应仓'}</button></div></div>}</article>})}</div>}
    </div>
  </section>
}

type CatalogPath = { id:string; category:string; subcategory:string; tertiaryCategory:string }

function CatalogManager({usagePaths,onChanged}:{usagePaths:CatalogPath[];onChanged:()=>void}) {
  const [revision,setRevision]=useState(0)
  const [level1,setLevel1]=useState(productCatalog[0]?.name||'')
  const group=productCatalog.find(item=>item.name===level1)||productCatalog[0]
  const [level2,setLevel2]=useState(group?.children[0]||'')
  const level2Key=tertiaryKey(group?.name||'',level2)
  const third=tertiaryOptions(level2,group?.name)
  const commit=(groups=productCatalog,tertiary=tertiaryCatalog)=>{productCatalog=groups;tertiaryCatalog=tertiary;saveCatalogDefinition();setRevision(value=>value+1);onChanged()}
  const promptName=(label:string,initial='')=>window.prompt(label,initial)?.trim()||''
  const addLevel1=()=>{const name=promptName('请输入一级目录名称');if(!name||productCatalog.some(item=>item.name===name))return;commit([...productCatalog,{name,children:[]}]);setLevel1(name);setLevel2('')}
  const addLevel2=()=>{if(!group)return;const name=promptName(`在“${group.name}”下新增二级目录`);if(!name||group.children.includes(name))return;commit(productCatalog.map(item=>item.name===group.name?{...item,children:[...item.children,name]}:item),{...tertiaryCatalog,[tertiaryKey(group.name,name)]:[]});setLevel2(name)}
  const addLevel3=()=>{if(!level2)return;const name=promptName(`在“${level2}”下新增三级目录`);if(!name)return;const icon=promptName('请输入图标（可使用Emoji或图片网址）','📦')||'📦';const values=tertiaryCatalog[level2Key]||[];if(values.some(item=>item.name===name))return;commit(productCatalog,{...tertiaryCatalog,[level2Key]:[...values,{name,icon}]})}
  const renameLevel1=(name:string)=>{const next=promptName('修改一级目录名称',name);if(!next||next===name)return;commit(productCatalog.map(item=>item.name===name?{...item,name:next}:item));setLevel1(next)}
  const renameLevel2=(name:string)=>{const next=promptName('修改二级目录名称',name);if(!next||next===name||!group)return;const oldKey=tertiaryKey(group.name,name),newKey=tertiaryKey(group.name,next);const tertiary={...tertiaryCatalog,[newKey]:tertiaryCatalog[oldKey]||[]};delete tertiary[oldKey];commit(productCatalog.map(item=>item.name===group.name?{...item,children:item.children.map(child=>child===name?next:child)}:item),tertiary);setLevel2(next)}
  const renameLevel3=(name:string)=>{const next=promptName('修改三级目录名称',name);if(!next||next===name)return;commit(productCatalog,{...tertiaryCatalog,[level2Key]:(tertiaryCatalog[level2Key]||[]).map(item=>item.name===name?{...item,name:next}:item)})}
  const move=(level:1|2|3,name:string,direction:-1|1)=>{if(level===1){const list=[...productCatalog],index=list.findIndex(item=>item.name===name),target=index+direction;if(target<0||target>=list.length)return;[list[index],list[target]]=[list[target],list[index]];commit(list);return}if(level===2&&group){const list=[...group.children],index=list.indexOf(name),target=index+direction;if(target<0||target>=list.length)return;[list[index],list[target]]=[list[target],list[index]];commit(productCatalog.map(item=>item.name===group.name?{...item,children:list}:item));return}const list=[...(tertiaryCatalog[level2Key]||[])],index=list.findIndex(item=>item.name===name),target=index+direction;if(target<0||target>=list.length)return;[list[index],list[target]]=[list[target],list[index]];commit(productCatalog,{...tertiaryCatalog,[level2Key]:list})}
  const moveParent=(level:2|3,name:string)=>{if(level===2){const target=promptName(`移动“${name}”到哪个一级目录？`,productCatalog.find(item=>item.name!==level1)?.name||'');if(!target||!group||!productCatalog.some(item=>item.name===target))return;const oldKey=tertiaryKey(group.name,name),newKey=tertiaryKey(target,name),tertiary={...tertiaryCatalog,[newKey]:tertiaryCatalog[oldKey]||[]};delete tertiary[oldKey];commit(productCatalog.map(item=>item.name===level1?{...item,children:item.children.filter(child=>child!==name)}:item.name===target?{...item,children:[...item.children,name]}:item),tertiary);setLevel1(target);setLevel2(name);return}const targets=productCatalog.flatMap(item=>item.children.map(child=>({category:item.name,subcategory:child})));const targetName=promptName(`移动“${name}”到哪个二级目录？`,targets.find(item=>item.subcategory!==level2)?.subcategory||'');const target=targets.find(item=>item.subcategory===targetName);if(!target)return;const targetKey=tertiaryKey(target.category,target.subcategory),source=tertiaryCatalog[level2Key]||[],node=source.find(item=>item.name===name);if(!node)return;commit(productCatalog,{...tertiaryCatalog,[level2Key]:source.filter(item=>item.name!==name),[targetKey]:[...(tertiaryCatalog[targetKey]||[]),node]});setLevel1(target.category);setLevel2(target.subcategory)}
  const remove=(level:1|2|3,name:string)=>{const used=usagePaths.filter(path=>level===1?path.category===name:level===2?(path.category===level1&&path.subcategory===name):path.tertiaryCategory===name).length;if(used){window.alert(`该目录关联 ${used} 个商品，请先迁移商品后再删除。`);return}if(level===1){const target=productCatalog.find(item=>item.name===name);if(target?.children.length){window.alert('该一级目录仍有子目录，无法删除。');return}commit(productCatalog.filter(item=>item.name!==name));setLevel1(productCatalog.find(item=>item.name!==name)?.name||'');return}if(level===2){const key=tertiaryKey(level1,name);if((tertiaryCatalog[key]||[]).length){window.alert('该二级目录仍有三级目录，无法删除。');return}const tertiary={...tertiaryCatalog};delete tertiary[key];commit(productCatalog.map(item=>item.name===level1?{...item,children:item.children.filter(child=>child!==name)}:item),tertiary);setLevel2('');return}commit(productCatalog,{...tertiaryCatalog,[level2Key]:(tertiaryCatalog[level2Key]||[]).filter(item=>item.name!==name)})}
  return <section className="catalog-manager"><div className="catalog-manager-heading"><div><small>PRODUCT CATALOG MANAGEMENT</small><h2>产品目录</h2><p>统一管理AI选品、AI入库和后续业务使用的三级目录</p></div><span>大健云仓目录 · 本地修改自动保存</span></div><div className="catalog-manager-columns" key={revision}><CatalogManageColumn title="一级目录" onAdd={addLevel1}>{productCatalog.map(item=><CatalogManageRow key={item.name} name={item.name} active={level1===item.name} count={usagePaths.filter(path=>path.category===item.name).length} onSelect={()=>{setLevel1(item.name);setLevel2(item.children[0]||'')}} onRename={()=>renameLevel1(item.name)} onUp={()=>move(1,item.name,-1)} onDown={()=>move(1,item.name,1)} onDelete={()=>remove(1,item.name)}/>)}</CatalogManageColumn><CatalogManageColumn title="二级目录" onAdd={addLevel2}>{(group?.children||[]).map(name=><CatalogManageRow key={name} name={name} active={level2===name} count={usagePaths.filter(path=>path.category===level1&&path.subcategory===name).length} onSelect={()=>setLevel2(name)} onRename={()=>renameLevel2(name)} onMove={()=>moveParent(2,name)} onUp={()=>move(2,name,-1)} onDown={()=>move(2,name,1)} onDelete={()=>remove(2,name)}/>)}</CatalogManageColumn><CatalogManageColumn title="三级目录与图标" onAdd={addLevel3} wide><div className="catalog-manage-icons">{third.map(item=><article key={item.name}><button className="catalog-icon-edit" onClick={()=>{const icon=promptName('修改图标',item.icon);if(icon)commit(productCatalog,{...tertiaryCatalog,[level2Key]:(tertiaryCatalog[level2Key]||[]).map(node=>node.name===item.name?{...node,icon}:node)})}}><i><CatalogIcon icon={item.icon}/></i></button><b>{item.name}</b><small>{usagePaths.filter(path=>path.category===level1&&path.subcategory===level2&&path.tertiaryCategory===item.name).length} 个商品</small><div><button onClick={()=>renameLevel3(item.name)}>改名</button><button onClick={()=>moveParent(3,item.name)}>移动</button><button onClick={()=>move(3,item.name,-1)}>↑</button><button onClick={()=>move(3,item.name,1)}>↓</button><button className="danger" onClick={()=>remove(3,item.name)}>删除</button></div></article>)}</div></CatalogManageColumn></div></section>
}

function CatalogManageColumn({title,onAdd,wide,children}:{title:string;onAdd:()=>void;wide?:boolean;children:ReactNode}) { return <section className={wide?'catalog-manage-column wide':'catalog-manage-column'}><header><b>{title}</b><button onClick={onAdd}>＋ 新增</button></header><div>{children}</div></section> }
function CatalogManageRow({name,count,active,onSelect,onRename,onMove,onUp,onDown,onDelete}:{name:string;count:number;active:boolean;onSelect:()=>void;onRename:()=>void;onMove?:()=>void;onUp:()=>void;onDown:()=>void;onDelete:()=>void}) { return <article className={active?'active':''}><button className="catalog-row-main" onClick={onSelect}><b>{name}</b><em>{count}</em></button><div><button onClick={onRename}>改名</button>{onMove&&<button onClick={onMove}>移动</button>}<button onClick={onUp}>↑</button><button onClick={onDown}>↓</button><button className="danger" onClick={onDelete}>删</button></div></article> }

function ThreeLevelCatalog({ paths, selected, onSelect }: { paths:CatalogPath[]; selected:string; onSelect:(value:string)=>void }) {
  const [expanded,setExpanded] = useState('')
  const [selectedSubcategory,setSelectedSubcategory] = useState('')
  const count = (level:'category'|'subcategory'|'tertiaryCategory',value:string)=>paths.filter(path=>path[level]===value).length
  return <aside className="catalog-panel"><div className="catalog-heading"><small>PRODUCT CATALOG</small><h2>产品目录库</h2><p>大健云仓三级目录 · 支持人工调整</p></div><button className={`catalog-all ${selected==='ALL'||selected==='全部产品'?'active':''}`} onClick={()=>{onSelect('ALL');setSelectedSubcategory('')}}><span>全部产品</span><em>{paths.length}</em></button><div className="catalog-tree">{productCatalog.map(group=>{const open=expanded===group.name;return <div className="catalog-group" key={group.name}><button className={selected===group.name?'active':''} onClick={()=>{onSelect(group.name);setExpanded(open?'':group.name);setSelectedSubcategory(open?'':group.children[0])}}><i>{open?'⌄':'›'}</i><span>{group.name}</span><em>{count('category',group.name)}</em></button>{open&&<div>{group.children.map(child=><button key={child} className={selected===child?'active':''} onClick={()=>{onSelect(child);setSelectedSubcategory(child)}}><span>{child}</span><em>{paths.filter(path=>path.category===group.name&&path.subcategory===child).length}</em></button>)}</div>}</div>})}</div>{selectedSubcategory&&<div className="tertiary-flyout"><div><small>LEVEL 3 CATEGORY</small><b>{selectedSubcategory}</b><button onClick={()=>setSelectedSubcategory('')}>×</button></div><div className="tertiary-icon-grid">{tertiaryOptions(selectedSubcategory,expanded).map(option=><button key={option.name} className={selected===option.name?'active':''} onClick={()=>{onSelect(option.name);setSelectedSubcategory('')}}><i><CatalogIcon icon={option.icon}/></i><span>{option.name}</span><em>{count('tertiaryCategory',option.name)}</em></button>)}</div></div>}</aside>
}

const catalogSelectionMatches = (item:{category:string;subcategory:string;tertiaryCategory?:string},selected:string) => selected==='ALL'||item.category===selected||item.subcategory===selected||item.tertiaryCategory===selected

function CatalogWorkspace({paths,children}:{paths:CatalogPath[];children:(selected:string)=>ReactNode}) {
  const [selected,setSelected]=useState('ALL')
  return <section className="warehouse-catalog-layout"><ThreeLevelCatalog paths={paths} selected={selected} onSelect={setSelected}/><div className="warehouse-catalog-main">{children(selected)}</div></section>
}

function SelectionWorkspace({ warehouseName, items, onItemsChange, onDecision, onCandidates, onReturnCandidate, onOpen, onNext, nextLabel }: { warehouseName:string; items: SelectionCatalogItem[]; onItemsChange: (items: SelectionCatalogItem[]) => void; onDecision: () => void; onCandidates: () => void; onReturnCandidate: (item: SelectionCatalogItem) => Promise<void>; onOpen: (item: SelectionCatalogItem) => void; onNext?:()=>void; nextLabel?:string }) {
  const [category, setCategory] = useState('ALL')
  const [decision, setDecision] = useState<'ALL' | SelectionDecision>('ALL')
  const [query, setQuery] = useState('')
  const normalized = query.trim().toLocaleLowerCase()
  const visible = items.filter(item => (category === 'ALL' || item.category === category || item.subcategory === category || item.tertiaryCategory === category) && (decision === 'ALL' || item.decision === decision) && (!normalized || `${item.title} ${item.productId} ${item.platformCode}`.toLocaleLowerCase().includes(normalized)))
  const count = (value: SelectionDecision) => items.filter(item => item.decision === value).length
  const replaceItem = (next: SelectionCatalogItem) => onItemsChange(items.map(item => item.id === next.id ? next : item))
  const decide = async (item: SelectionCatalogItem, value: SelectionDecision) => { replaceItem(await window.desktop.selections.decide(item.id, value)); onDecision() }
  const categorize = async (item: SelectionCatalogItem, nextCategory: string, nextSubcategory: string, nextTertiary: string) => replaceItem(await window.desktop.selections.categorize(item.id,nextCategory,nextSubcategory,nextTertiary))
  return <section className="selection-workbench">
    <ThreeLevelCatalog paths={items.map(item=>({id:item.id,category:item.category,subcategory:item.subcategory,tertiaryCategory:item.tertiaryCategory||'待细分'}))} selected={category} onSelect={setCategory}/>
    <div className="selection-main"><div className="selection-heading"><div><small>AI SELECTION WORKSPACE</small><b>{warehouseName} · AI选品</b><span>当前选品决策只影响本仓库</span></div><div><button className="primary" onClick={onCandidates}>＋ 从AI候选导入</button>{onNext&&<button className="primary" onClick={onNext}>{nextLabel||'下一步'} →</button>}</div></div>
      <div className="selection-stats"><button onClick={()=>setDecision('ALL')}><b>{items.length}</b><small>选品商品</small></button><button onClick={()=>setDecision('PENDING')}><b>{count('PENDING')}</b><small>待复核</small></button><button onClick={()=>setDecision('APPROVED')}><b>{count('APPROVED')}</b><small>已通过</small></button><button onClick={()=>setDecision('REJECTED')}><b>{count('REJECTED')}</b><small>已淘汰</small></button></div>
      <div className="selection-filters"><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索商品标题、ID或平台"/><select value={decision} onChange={event=>setDecision(event.target.value as typeof decision)}><option value="ALL">全部状态</option><option value="PENDING">待人工复核</option><option value="APPROVED">已通过</option><option value="REJECTED">已淘汰</option></select><span>当前显示 <b>{visible.length}</b> 个商品</span></div>
      {visible.length===0?<EmptyState title={items.length?'当前筛选下暂无商品':'暂无选品商品'} description={items.length?'请切换目录、状态或清除搜索条件。':'请从AI候选中将商品加入AI选品。'} action="进入AI候选" onAction={onCandidates}/>:<div className="selection-grid">{visible.map(item=>{const group=productCatalog.find(entry=>entry.name===item.category)||productCatalog[0];const subcategory=group.children.includes(item.subcategory)?item.subcategory:group.children[0];return <article className={`selection-card decision-${item.decision.toLocaleLowerCase()}`} key={item.id}><button className="selection-image" onClick={()=>onOpen(item)}>{item.imageUrl?<img src={item.imageUrl} alt={item.title}/>:<span>无图片</span>}<strong>{item.score}分</strong></button><div className="selection-card-body"><small>{item.platformCode} · ID {item.productId||'待识别'}</small><b title={item.title}>{item.title}</b><strong>{item.priceText||'价格待核验'}</strong><div className="selection-category-selects"><select value={item.category} onChange={event=>{const next=productCatalog.find(entry=>entry.name===event.target.value)!;void categorize(item,next.name,next.children[0],'待细分')}}>{productCatalog.map(entry=><option key={entry.name}>{entry.name}</option>)}</select><select value={subcategory} onChange={event=>void categorize(item,item.category,event.target.value,'待细分')}>{group.children.map(child=><option key={child}>{child}</option>)}</select><select value={item.tertiaryCategory||'待细分'} onChange={event=>void categorize(item,item.category,subcategory,event.target.value)}>{tertiaryOptions(subcategory,item.category).map(option=><option key={option.name}>{option.name}</option>)}</select></div><p>{item.recommendation||item.reason}</p><div className="selection-tags"><span>{item.category} / {subcategory} / {item.tertiaryCategory||'待细分'}</span><span>{item.riskFlags.length?`${item.riskFlags.length}项风险`:'暂无风险'}</span></div><div className="selection-decisions"><button className="candidate" onClick={()=>void onReturnCandidate(item)}>候选</button><button className={item.decision==='APPROVED'?'approved':''} onClick={()=>void decide(item,'APPROVED')}>通过</button><button className={item.decision==='PENDING'?'pending':''} onClick={()=>void decide(item,'PENDING')}>待复核</button><button className={item.decision==='REJECTED'?'rejected':''} onClick={()=>void decide(item,'REJECTED')}>淘汰</button></div></div></article>})}</div>}
    </div>
  </section>
}

type GenerationPlan = 'full' | 'main' | 'detail'

function stockCategory(title: string) {
  if (/家具|桌|椅|柜|床|沙发|收纳/.test(title)) return '家具'
  if (/花园|户外|露营|庭院/.test(title)) return '花园与户外'
  if (/健身|运动|瑜伽|训练/.test(title)) return '健身与运动'
  if (/卫浴|水龙头|浴室|淋浴/.test(title)) return '卫浴与水龙头'
  if (/厨房|餐具|锅|杯|刀具/.test(title)) return '厨房用品'
  if (/宠物|猫|狗|鸟/.test(title)) return '宠物用品'
  if (/玩具|积木|儿童/.test(title)) return '玩具'
  if (/汽车|车载|运输/.test(title)) return '汽车配件与运输'
  if (/灯|照明|台灯/.test(title)) return '照明'
  return '未分类'
}

function stockCatalogPath(product: CollectedSupplyProduct): CatalogPath {
  return { id:product.url,...supplyCatalog(product) }
}

function candidateCatalogPath(product: CollectedSupplyProduct | CollectedOzonProduct): CatalogPath {
  if ('platformCode' in product) return { id:product.url,...supplyCatalog(product) }
  const inferred = inferCatalog(product.title)
  const matched = tertiaryOptions(inferred.subcategory,inferred.category).find(option=>option.name!=='待细分'&&product.title.includes(option.name.replace(/[与用品工具]/g,'')))
  return { id:product.url,category:inferred.category,subcategory:inferred.subcategory,tertiaryCategory:matched?.name||'待细分' }
}

function StockCatalog({ products, onOpenCandidates, onCreateImage }: { products: CollectedSupplyProduct[]; onOpenCandidates: () => void; onCreateImage: (product: CollectedSupplyProduct) => void }) {
  const [category, setCategory] = useState('ALL')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('ALL')
  const paths=products.map(stockCatalogPath)
  const visible = products.filter(product => {const path=stockCatalogPath(product);return status!=='COMPLETED' && (category==='ALL'||path.category===category||path.subcategory===category||path.tertiaryCategory===category) && (!query.trim()||`${product.title} ${product.productId} ${product.supplierName}`.toLowerCase().includes(query.trim().toLowerCase()))})
  return <section className="stock-catalog-page">
    <ThreeLevelCatalog paths={paths} selected={category} onSelect={setCategory}/>
    <div className="stock-workspace"><div className="stock-workspace-heading"><div><small>AI STOCK WORKSPACE</small><h2>AI入库工作区</h2><p>管理已入选商品，并进入商品视觉生产流程</p></div><button className="primary" onClick={onOpenCandidates}>＋ 从AI候选导入</button></div>
      <div className="stock-stats"><span><b>{products.length}</b><small>入库商品</small></span><span><b>{products.length}</b><small>待做图</small></span><span><b>0</b><small>做图中</small></span><span><b>0</b><small>素材已完成</small></span></div>
      <div className="stock-filters"><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索商品标题、ID或供应商"/><select value={status} onChange={event=>setStatus(event.target.value)}><option value="ALL">全部状态</option><option value="PENDING">待做图</option><option value="COMPLETED">素材已完成</option></select><small>当前显示 {visible.length} 个商品</small></div>
      <div className="stock-results">{visible.length ? <div className="stock-library-grid">{visible.map(product=>{const path=stockCatalogPath(product);return <article key={product.url}><div className="stock-library-image"><img src={product.imageUrl} alt={product.title}/><span>待做图</span></div><div className="stock-library-info"><small>{product.platformCode} · SKU {product.productId}</small><b title={product.title}>{product.title}</b><strong>{product.priceText || '价格待核验'}</strong><p>{path.category} / {path.subcategory} / {path.tertiaryCategory}</p><p>{product.supplierName} · 完整度 {product.dataCompleteness}%</p><div><button>查看资料</button><button className="primary" onClick={()=>onCreateImage(product)}>AI做图 →</button></div></div></article>})}</div> : <div className="stock-empty"><span>◎</span><h3>{products.length?'当前筛选下暂无商品':'暂无入库商品'}</h3><p>{products.length?'请调整类目或搜索条件。':'请先从AI候选中确认需要入库的商品。'}</p>{!products.length&&<button className="primary" onClick={onOpenCandidates}>进入AI候选</button>}</div>}</div>
    </div>
  </section>
}

function SupplyPlatformComparisonWorkspace({warehouse,products,onCandidates,onSelection,onOpen}:{warehouse:ProductWarehouseCode;products:CollectedSupplyProduct[];onCandidates:()=>void;onSelection:(product:CollectedSupplyProduct)=>void;onOpen:(product:CollectedSupplyProduct)=>void}){
  const [query,setQuery]=useState('')
  const visible=products.filter(item=>!query.trim()||`${item.title} ${item.supplierName} ${item.productId}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a,b)=>b.score-a.score)
  const name=warehouse==='GIGACLOUD'?'大健云仓':'1688'
  const rules=warehouseRuleProfiles[warehouse]
  return <section className="warehouse-comparison-page"><aside><small>WAREHOUSE PRICE RULES</small><h2>{name} · AI比价</h2><p>当前规则只作用于{name}产品库。</p><div>{rules.map((rule,index)=><span key={rule}><i>{index+1}</i>{rule}</span>)}</div><button className="primary" onClick={onCandidates}>返回AI候选</button></aside><main><div className="warehouse-page-heading"><div><small>SUPPLY SOURCE COMPARISON</small><b>{name}货源横向对比</b><span>按平台特有指标排序，人工确认后进入AI选品</span></div><em>{visible.length}</em></div><input className="warehouse-comparison-search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索商品、供应商或SKU"/>{visible.length?<div className="warehouse-comparison-list">{visible.map(item=><article key={item.url}><button onClick={()=>onOpen(item)}>{item.imageUrl?<img src={item.imageUrl} alt=""/>:'无图'}</button><div><small>{item.productId} · {item.supplierName||'供应商待补采'}</small><b>{item.title}</b><span>{item.priceText||'价格待核验'} · 销量 {item.salesText||'--'}</span></div><dl><div><dt>AI评分</dt><dd>{item.score}</dd></div><div><dt>完整度</dt><dd>{item.dataCompleteness}%</dd></div><div><dt>评级</dt><dd>{item.grade}</dd></div></dl><button className="primary" onClick={()=>onSelection(item)}>进入AI选品</button></article>)}</div>:<EmptyState title={`${name}暂无可比商品`} description="请先在当前仓库完成采集和候选。" action="进入AI候选" onAction={onCandidates}/>}</main></section>
}

function MarketOpportunityWarehouse({warehouse,items,onOpenSelection,onOpen}:{warehouse:'ALIEXPRESS'|'OZON';items:SelectionCatalogItem[];onOpenSelection:()=>void;onOpen:(item:SelectionCatalogItem)=>void}){
  const [query,setQuery]=useState('')
  const name=warehouse==='OZON'?'Ozon':'AliExpress'
  const visible=items.filter(item=>!query.trim()||`${item.title} ${item.productId}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <section className="market-warehouse-page"><div className="warehouse-heading"><div><small>MARKET OPPORTUNITY WAREHOUSE</small><h2>{name}机会产品库</h2><p>保存{name}市场商品、竞品指标、利润机会及已绑定货源，不作为实物库存。</p></div><div className="warehouse-heading-actions"><button className="primary" onClick={onOpenSelection}>进入AI选品</button></div></div><div className="warehouse-toolbar"><input value={query} onChange={event=>setQuery(event.target.value)} placeholder={`搜索${name}商品或平台ID`}/><span>有效机会 <b>{visible.length}</b> 个</span></div>{visible.length?<div className="market-warehouse-grid">{visible.map(item=><article key={item.id}><button onClick={()=>onOpen(item)}>{item.imageUrl?<img src={item.imageUrl} alt=""/>:'无图'}</button><div><small>{name} · ID {item.productId||'待识别'}</small><b>{item.title}</b><strong>{item.priceText||'价格待采集'}</strong><p>{item.estimatedMargin!==undefined?`预计利润率 ${item.estimatedMargin}%`:'待完成货源比价'}</p><span>{item.supplierUrl?'已绑定供应货源':'货源待匹配'}</span></div></article>)}</div>:<EmptyState title={`${name}机会产品库为空`} description={`请在${name}仓完成采集、候选、选品和比价后入库。`} action="进入AI选品" onAction={onOpenSelection}/>}</section>
}

function SupplyWarehouseWorkspace({ products, warehouse, onOpenSelection, onOpenCatalog, onCreateImage }: { products: SupplyWarehouseProduct[]; warehouse:SupplyWarehouseProduct['warehouseCode']; onOpenSelection: () => void; onOpenCatalog:()=>void; onCreateImage: (product: SupplyWarehouseProduct) => void }) {
  const [query,setQuery] = useState('')
  const names:Record<SupplyWarehouseProduct['warehouseCode'],string> = { '1688':'1688仓', GIGACLOUD:'大健云仓' }
  const visible = products.filter(item=>!query.trim()||`${item.title} ${item.productId} ${item.supplierName}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const note=warehouse==='1688'?'国内工厂、阶梯价、MOQ与供应商档案':'海外仓库存、配送区域与履约档案'
  return <section className="supply-warehouse-page"><div className="warehouse-heading"><div><small>SUPPLY PRODUCT WAREHOUSE</small><h2>{names[warehouse]}产品库</h2><p>{note}；商品入库不代表已实际采购。</p></div><div className="warehouse-heading-actions"><button onClick={onOpenCatalog}>管理产品目录</button><button className="primary" onClick={onOpenSelection}>进入AI选品</button></div></div><div className="warehouse-toolbar"><input value={query} onChange={event=>setQuery(event.target.value)} placeholder={`搜索${names[warehouse]}商品、SKU或供应商`}/><span>当前显示 <b>{visible.length}</b> 个商品</span></div>{visible.length?<div className="warehouse-product-grid">{visible.map(item=><article key={item.id}><button className="warehouse-product-image" onClick={()=>onCreateImage(item)}>{item.imageUrl?<img src={item.imageUrl} alt={item.title}/>:<span>无图片</span>}<em>{names[item.warehouseCode]}</em></button><div><small>SKU {item.productId||'待生成'} · {item.category}</small><b>{item.title}</b><strong>{item.priceText||'价格待核验'}</strong><p>{item.supplierName||'供应商待补采'}</p><span>{item.category} / {item.subcategory} / {item.tertiaryCategory}</span><div><button onClick={()=>onCreateImage(item)}>AI做图</button><button className="primary" onClick={()=>onCreateImage(item)}>进入平台素材</button></div></div></article>)}</div>:<EmptyState title={`${names[warehouse]}暂无入库商品`} description="请在当前仓库的AI选品中审核商品，系统会自动归入本仓库。" action="进入AI选品" onAction={onOpenSelection}/>}</section>
}

function ImageStudio({ product, marketplaceSelection, onOpenInventory }: { product: ImageSourceProduct | null; marketplaceSelection:MarketplaceSelectionProduct|null; onOpenInventory: () => void }) {
  const usageStorageKey = `image-model-usage-${new Date().toISOString().slice(0,7)}`
  const [plan, setPlan] = useState<GenerationPlan>('full')
  const [targetPlatform, setTargetPlatform] = useState('Ozon')
  const [language, setLanguage] = useState('俄语')
  const [models, setModels] = useState<{ id: string; name: string; description: string }[]>([])
  const [model, setModel] = useState('wan2.7-image-pro')
  const [modelStatus, setModelStatus] = useState('正在连接百炼…')
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [modelUsage, setModelUsage] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(usageStorageKey) || '{}') as Record<string, number> } catch { return {} }
  })
  const [monthlyLimit, setMonthlyLimit] = useState(() => Number(localStorage.getItem('image-monthly-limit') || 0))
  const [generating, setGenerating] = useState(false)
  const [generationProgress, setGenerationProgress] = useState('')
  const [generationError, setGenerationError] = useState('')
  const [generatedImages, setGeneratedImages] = useState<string[]>([])
  const [realShiftEnabled, setRealShiftEnabled] = useState(true)
  const [realShiftProfile, setRealShiftProfile] = useState<RealShiftProfile>('light')
  const [realShiftResults, setRealShiftResults] = useState<Record<number, RealShiftResult>>({})
  const [realShiftProcessing, setRealShiftProcessing] = useState<number | null>(null)
  const [compareIndex, setCompareIndex] = useState<number | null>(null)
  const [savedChoices, setSavedChoices] = useState<Record<number, 'original' | 'processed'>>({})
  const [marketplaceAssets,setMarketplaceAssets] = useState<MarketplaceMediaAsset[]>([])
  const [extraPrompt, setExtraPrompt] = useState('')
  const plans: { id: GenerationPlan; icon: string; name: string; note: string; count: number; recommended?: boolean }[] = [
    { id:'full', icon:'▤', name:'全套生成', note:'主图 + 商品图库 + 详情页', count:16, recommended:true },
    { id:'main', icon:'▦', name:'仅主图', note:'搜索列表与商品图库 5–8张', count:6 },
    { id:'detail', icon:'▧', name:'仅详情页', note:'详情内容模块 8–18张', count:10 }
  ]
  const activePlan = plans.find(item=>item.id===plan)!
  const selectedModel = models.find(item => item.id === model)
  const totalUsage = Object.values(modelUsage).reduce((sum, count) => sum + count, 0)

  useEffect(() => {
    void window.desktop.image.models().then(connection => {
      setModels(connection.models)
      setModelStatus(connection.message)
      if (connection.models.length && !connection.models.some(item => item.id === model)) setModel(connection.models[0].id)
    }).catch(reason => setModelStatus(reason instanceof Error ? reason.message : '百炼连接失败'))
  }, [])

  useEffect(()=>{if(!marketplaceSelection){setMarketplaceAssets([]);return}setTargetPlatform(marketplaceSelection.marketplaceCode==='OZON'?'Ozon':marketplaceSelection.marketplaceCode);void window.desktop.marketplaceMedia.list(marketplaceSelection.id).then(setMarketplaceAssets)},[marketplaceSelection?.id])

  const saveMarketplaceAsset = async(assetType:'ORIGINAL'|'AI_GENERATED'|'REALSHIFT',imageUrl:string,localPath='',selected=false)=>{
    if(!marketplaceSelection)return
    await window.desktop.marketplaceMedia.save(marketplaceSelection.id,assetType,imageUrl,localPath,selected)
    setMarketplaceAssets(await window.desktop.marketplaceMedia.list(marketplaceSelection.id))
  }

  const runRealShift = async (imageUrl: string, index: number, profile = realShiftProfile) => {
    if (!product) return
    setRealShiftProcessing(index)
    try {
      const result = await window.desktop.image.realshift({ imageUrl, productId:product.productId, profile })
      setRealShiftResults(current=>({...current,[index]:result}))
      setCompareIndex(index)
    } catch (reason) {
      setGenerationError(reason instanceof Error ? reason.message : '真实感优化失败')
    } finally { setRealShiftProcessing(null) }
  }

  const saveRealShiftChoice = async (index: number, choice: 'original' | 'processed') => {
    const result = realShiftResults[index]
    if (!result) return
    await window.desktop.image.selectRealshift(result.reportPath, choice)
    if(marketplaceSelection) await saveMarketplaceAsset(choice==='processed'?'REALSHIFT':'AI_GENERATED',choice==='processed'?result.processedDataUrl:generatedImages[index],choice==='processed'?result.processedPath:'',true)
    setSavedChoices(current=>({...current,[index]:choice}))
  }

  const selectGeneratedAsset = async(index:number)=>{
    if(!marketplaceSelection)return
    await saveMarketplaceAsset('AI_GENERATED',generatedImages[index],'',true)
    setSavedChoices(current=>({...current,[index]:'original'}))
  }

  const generateImage = async () => {
    if (!product || !model || generating) return
    if (!window.confirm(`将为“${product.title}”生成${activePlan.count}张图片，百炼会按实际成功图片计费。确认开始？`)) return
    setGenerating(true)
    setGenerationError('')
    setGeneratedImages([])
    setRealShiftResults({})
    setSavedChoices({})
    setCompareIndex(null)
    const productContext = 'supplierName' in product ? `供应商：${product.supplierName}；价格：${product.priceText}；平台：${'platformCode' in product?product.platformCode:product.warehouseCode}` : `品牌：${product.brand}；价格：${product.priceText}`
    const mainPrompt = `为${targetPlatform}生成${language}站点商品图库。严格保留参考图商品的结构、颜色、材质和配件数量。包含纯净封面主图、多角度、局部细节、核心卖点与真实使用场景；禁止虚构参数、认证和功效，无水印。`
    const detailPrompt = `为${targetPlatform}生成${language}商品详情页模块图片。严格基于参考图和已知商品资料，包含商品首屏、核心卖点、材质细节、使用场景、使用步骤、尺寸参数占位、包装清单与注意事项；未知参数不得编造，保持整套商品外观一致。`
    const stages = plan === 'full' ? [{name:'主图与图库',count:6,prompt:mainPrompt},{name:'详情页',count:10,prompt:detailPrompt}] : plan === 'main' ? [{name:'主图与图库',count:6,prompt:mainPrompt}] : [{name:'详情页',count:10,prompt:detailPrompt}]
    const maxPerTask = model === 'z-image-turbo' ? 1 : model.startsWith('qwen-image') ? 6 : 4
    const completed: string[] = []
    try {
      let taskNumber = 0
      const totalTasks = stages.reduce((sum,stage)=>sum+Math.ceil(stage.count/maxPerTask),0)
      for (const stage of stages) {
        let remaining = stage.count
        while (remaining > 0) {
          taskNumber += 1
          const count = Math.min(maxPerTask,remaining)
          setGenerationProgress(`${stage.name} · 任务 ${taskNumber}/${totalTasks}`)
          const result = await window.desktop.image.generate({ model, prompt:`商品：${product.title}。${productContext}。${stage.prompt}${extraPrompt ? ` 补充要求：${extraPrompt}` : ''}`, referenceImageUrl:product.imageUrl, size:'1K', count })
          completed.push(...result.imageUrls)
          setGeneratedImages([...completed])
          remaining -= count
        }
      }
      setModelUsage(current => {
        const next = { ...current, [model]:(current[model] || 0) + completed.length }
        localStorage.setItem(usageStorageKey, JSON.stringify(next))
        return next
      })
      if(marketplaceSelection) for(const imageUrl of completed) await saveMarketplaceAsset('AI_GENERATED',imageUrl)
      if (realShiftEnabled && plan !== 'detail') {
        for (const index of [4,5]) if (completed[index]) await runRealShift(completed[index], index)
      }
    } catch (reason) {
      setGenerationError(reason instanceof Error ? reason.message : '图片生成失败')
    } finally { setGenerating(false); setGenerationProgress('') }
  }

  const configureMonthlyLimit = () => {
    const value = window.prompt('请输入本项目每月图片额度（张）', monthlyLimit ? String(monthlyLimit) : '100')
    if (value === null) return
    const parsed = Math.max(0, Math.floor(Number(value)))
    if (!Number.isFinite(parsed)) return
    setMonthlyLimit(parsed)
    localStorage.setItem('image-monthly-limit', String(parsed))
  }

  return <section className="image-studio">
    <aside className="image-tool-panel">
      <div className="image-panel-heading"><small>IMAGE WORKBENCH</small><h2>{marketplaceSelection?'Ozon平台素材':'商品视觉生成'}</h2><p>{marketplaceSelection?`平台SKU链路 · ${marketplaceSelection.productId||marketplaceSelection.id.slice(0,8)}`:'基于入库商品和目标平台要求生成'}</p></div>
      <div className="image-source-card">
        <div><b>AI入库商品</b><span>{product?'已选择':'未选择'}</span></div>
        {product ? <button className="selected-product" onClick={onOpenInventory}><img src={product.imageUrl} alt=""/><span><b>{product.title}</b><small>点击返回AI入库更换商品</small></span></button> : <button className="empty-product" onClick={onOpenInventory}>＋ 从AI入库选择商品</button>}
      </div>
      <div className="generation-flow-fields"><label>目标跨境平台<select value={targetPlatform} onChange={event=>setTargetPlatform(event.target.value)}><option>Ozon</option><option disabled>Amazon（即将支持）</option><option disabled>Wildberries（即将支持）</option></select></label><label>目标语言<select value={language} onChange={event=>setLanguage(event.target.value)}><option>俄语</option><option>英语</option><option>西班牙语</option></select></label></div>
      <div className="generation-plan-list"><small>选择生成方案</small>{plans.map(item=><button key={item.id} className={plan===item.id?'active':''} onClick={()=>setPlan(item.id)}><i>{item.icon}</i><span><b>{item.name}{item.recommended&&<em>推荐</em>}</b><small>{item.note}</small></span><strong>{item.count}张</strong></button>)}
      </div>
      <div className="plan-summary"><b>本次生成清单</b>{(plan==='full'||plan==='main')&&<span>主图与商品图库 <strong>6张</strong></span>}{(plan==='full'||plan==='detail')&&<span>详情页模块 <strong>10张</strong></span>}<span className="plan-total">合计 <strong>{activePlan.count}张</strong></span></div>
    </aside>

    <div className="image-workspace">
      <div className="image-workspace-toolbar"><div><small>当前方案</small><b>{activePlan.name} · {targetPlatform}</b></div><div className="image-toolbar-actions"><button>生成历史</button><button className="primary" disabled={!product || generating || !models.length} onClick={generateImage}>{generating?generationProgress:'确认并开始生成'}</button></div></div>
      <div className="image-product-strip">
        <span>生成进度</span>{generatedImages.length ? generatedImages.map((url,index)=><button key={url} className={index===0?'active':''}><img src={url} alt="生成结果"/><i>{index+1}</i></button>) : <span className="generation-waiting">确认清单后开始分批生成</span>}
      </div>
      <div className="image-editor">
        <div className="image-canvas">
          {generatedImages.length ? <div className="generation-results"><div className="generated-gallery">{generatedImages.map((url,index)=><figure key={url}><div><img src={realShiftResults[index]?.processedDataUrl || url} alt={`生成结果${index+1}`}/>{realShiftResults[index]&&<span className="realshift-badge">已优化</span>}</div><figcaption><span>{index < 6 && plan!=='detail'?'商品图库':'详情页模块'} {index+1}</span><div>{marketplaceSelection&&<button className={savedChoices[index]==='original'?'selected':''} onClick={()=>void selectGeneratedAsset(index)}>设为平台图</button>}{realShiftResults[index]&&<button onClick={()=>setCompareIndex(index)}>原图对比</button>}<button disabled={realShiftProcessing===index} onClick={()=>runRealShift(url,index)}>{realShiftProcessing===index?'处理中':'真实感优化'}</button></div></figcaption></figure>)}</div>{compareIndex!==null&&realShiftResults[compareIndex]&&<div className="realshift-compare"><div className="compare-heading"><span><b>原图与真实感优化对比</b><small>{realShiftResults[compareIndex].profile==='light'?'轻度':'均衡'} · 第 {compareIndex+1} 张</small></span><button onClick={()=>setCompareIndex(null)}>关闭</button></div><div className="compare-images"><figure><img src={realShiftResults[compareIndex].originalDataUrl}/><figcaption>百炼原始图</figcaption></figure><figure><img src={realShiftResults[compareIndex].processedDataUrl}/><figcaption>RealShift优化图</figcaption></figure></div><div className="compare-report"><span>原始自然度参考 <b>{Math.round((1-realShiftResults[compareIndex].originalScore.risk)*100)}</b></span><span>优化后自然度参考 <b>{Math.round((1-realShiftResults[compareIndex].processedScore.risk)*100)}</b></span><span>选择迭代 <b>{realShiftResults[compareIndex].chosenIteration+1}</b></span><span>平台素材 <b>{marketplaceAssets.filter(asset=>asset.selected).length?'已选定':'待选定'}</b></span></div><div className="compare-actions"><button onClick={()=>runRealShift(generatedImages[compareIndex],compareIndex)}>重新处理</button><button className={savedChoices[compareIndex]==='original'?'selected':''} onClick={()=>void saveRealShiftChoice(compareIndex,'original')}>使用原图</button><button className={savedChoices[compareIndex]==='processed'?'primary selected':'primary'} onClick={()=>void saveRealShiftChoice(compareIndex,'processed')}>使用优化图</button></div></div>}</div> : product?.imageUrl ? <div className="image-preview"><span>入库商品原图</span><img src={product.imageUrl} alt={product.title}/></div> : <div className="image-canvas-empty"><i>▧</i><h3>请先从AI入库选择商品</h3><p>系统将读取商品资料并按目标平台规则生成</p><button className="primary" onClick={onOpenInventory}>前往AI入库</button></div>}
        </div>
        <aside className="image-settings">
          <div className="settings-title"><b>{activePlan.name}</b><small>{activePlan.note}</small></div>
          <label className="model-picker-label">AI生图模型
            <button type="button" className={`model-picker-trigger ${modelMenuOpen?'open':''}`} onClick={()=>setModelMenuOpen(open=>!open)} disabled={!models.length}><span className="model-logo">AI</span><span><b>{selectedModel?.name || '暂无可用模型'}</b><small>{selectedModel?.description || modelStatus}</small></span><em>{modelMenuOpen?'⌃':'⌄'}</em></button>
            {modelMenuOpen && <div className="model-picker-menu">{models.map(item=><button type="button" key={item.id} className={item.id===model?'active':''} onClick={()=>{setModel(item.id);setModelMenuOpen(false)}}><span className="model-logo">AI</span><span><b>{item.name}</b><small>{item.description}</small><i>{item.id}</i></span><em><strong>{modelUsage[item.id] || 0} 张</strong><small>项目已用</small></em></button>)}</div>}
            <span className={`model-connection ${models.length?'connected':''}`}>{models.length?'●':'○'} {modelStatus}</span>
          </label>
          <div className="image-quota-card"><div className="quota-heading"><span><b>图片使用额度</b><small>本地项目统计</small></span><button type="button" onClick={configureMonthlyLimit}>{monthlyLimit?'调整':'设置额度'}</button></div><div className="quota-metrics"><span><b>{totalUsage}</b><small>本月已用</small></span><span><b>{monthlyLimit ? Math.max(0,monthlyLimit-totalUsage) : '--'}</b><small>项目剩余</small></span><span><b>{monthlyLimit || '--'}</b><small>月额度</small></span></div>{monthlyLimit>0 && <div className="quota-progress"><i style={{width:`${Math.min(100,totalUsage/monthlyLimit*100)}%`}}/></div>}<p>百炼云端剩余额度暂不支持通过推理API读取，请以百炼控制台为准。</p></div>
          <label>平台图片规范<select><option>{targetPlatform} · 自动匹配主图与详情页</option></select></label>
          <label>画面风格<select><option>简洁跨境电商</option><option>轻场景</option><option>品牌质感</option><option>生活方式</option></select></label>
          <div className="realshift-settings"><label className="realshift-toggle"><input type="checkbox" checked={realShiftEnabled} onChange={event=>setRealShiftEnabled(event.target.checked)}/><span><b>真实感优化</b><small>默认只自动处理场景图，原图永久保留</small></span></label>{realShiftEnabled&&<div className="realshift-profiles"><button className={realShiftProfile==='light'?'active':''} onClick={()=>setRealShiftProfile('light')}>轻度<small>推荐</small></button><button className={realShiftProfile==='balanced'?'active':''} onClick={()=>setRealShiftProfile('balanced')}>均衡<small>更明显</small></button></div>}</div>
          <label>补充要求<textarea value={extraPrompt} onChange={event=>setExtraPrompt(event.target.value)} placeholder="例如：保持商品颜色和结构，不改变配件数量…" /></label>
          {generationError && <div className="generation-error">{generationError}</div>}
          <div className="safety-note"><b>商品一致性保护</b><span>默认检查商品结构、颜色、配件数量和文字合规。</span></div>
          <button className="primary image-generate" disabled={!product || generating || !models.length} onClick={generateImage}>{generating?generationProgress:`生成${activePlan.name} · ${activePlan.count}张`}</button>
        </aside>
      </div>
    </div>
  </section>
}

function RealShiftWorkbench() {
  const [sourcePath, setSourcePath] = useState('')
  const [profile, setProfile] = useState<RealShiftProfile>('light')
  const [result, setResult] = useState<RealShiftResult | null>(null)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const [choice, setChoice] = useState<'original' | 'processed' | null>(null)

  const pickImage = async () => {
    const selected = await window.desktop.image.pickRealshiftImage()
    if (!selected) return
    setSourcePath(selected); setResult(null); setChoice(null); setError('')
  }
  const processImage = async () => {
    if (!sourcePath || processing) return
    setProcessing(true); setError(''); setChoice(null)
    try { setResult(await window.desktop.image.realshift({ localPath:sourcePath, productId:'standalone', profile })) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'AI洗图处理失败') }
    finally { setProcessing(false) }
  }
  const saveChoice = async (next: 'original' | 'processed') => {
    if (!result) return
    await window.desktop.image.selectRealshift(result.reportPath,next)
    setChoice(next)
  }

  return <section className="realshift-page">
    <aside className="realshift-control-panel"><div className="realshift-page-heading"><small>REALSHIFT WORKBENCH</small><h2>AI洗图工作台</h2><p>本地处理，不覆盖原始图片</p></div>
      <div className="realshift-source"><b>处理图片</b><button onClick={pickImage}>{sourcePath?'更换图片':'＋ 选择本地图片'}</button>{sourcePath&&<small title={sourcePath}>{sourcePath.split('/').pop()}</small>}</div>
      <div className="realshift-level"><b>优化强度</b><button className={profile==='light'?'active':''} onClick={()=>setProfile('light')}><span>轻度</span><small>轻微噪点、色彩与镜头质感，推荐商品场景图</small></button><button className={profile==='balanced'?'active':''} onClick={()=>setProfile('balanced')}><span>均衡</span><small>更明显的自然摄影质感，需要人工审核</small></button></div>
      <div className="realshift-protection"><b>处理规则</b><span>✓ 保留原图</span><span>✓ 保持原始尺寸</span><span>✓ EXIF保持关闭</span><span>✓ 输出独立处理报告</span></div>
      <button className="primary realshift-run" disabled={!sourcePath||processing} onClick={processImage}>{processing?'正在本地处理…':result?'重新处理':'开始AI洗图'}</button>{error&&<div className="generation-error">{error}</div>}
    </aside>
    <div className="realshift-main"><div className="realshift-main-toolbar"><div><small>对比工作区</small><b>{result?'处理完成，可选择最终版本':'选择图片后开始处理'}</b></div>{result&&<span className="realshift-ready">✓ 报告已生成</span>}</div>
      {!result ? <div className="realshift-page-empty"><span>✦</span><h3>选择一张图片开始AI洗图</h3><p>支持PNG、JPG、WEBP、BMP和TIFF，处理全部在本机完成。</p><button className="primary" onClick={pickImage}>选择图片</button></div> : <><div className="realshift-side-by-side"><figure><div><img src={result.originalDataUrl} alt="原图"/></div><figcaption><b>原始图片</b><small>始终保留，可随时恢复</small></figcaption></figure><figure><div><img src={result.processedDataUrl} alt="优化图"/></div><figcaption><b>RealShift优化图</b><small>{result.profile==='light'?'轻度':'均衡'}配置 · 迭代 {result.chosenIteration+1}</small></figcaption></figure></div><div className="realshift-result-actions"><button onClick={processImage}>单张重新处理</button><button className={choice==='original'?'selected':''} onClick={()=>saveChoice('original')}>使用原图</button><button className={choice==='processed'?'primary selected':'primary'} onClick={()=>saveChoice('processed')}>使用优化图</button></div></>}
    </div>
    <aside className="realshift-report-panel"><div className="report-title"><b>处理报告</b><small>RealShift自然度参考</small></div>{result ? <><div className="report-score"><span><small>原始自然度</small><b>{Math.round((1-result.originalScore.risk)*100)}</b></span><i>→</i><span><small>优化后自然度</small><b>{Math.round((1-result.processedScore.risk)*100)}</b></span></div><dl><div><dt>处理档位</dt><dd>{result.profile==='light'?'轻度':'均衡'}</dd></div><div><dt>选中迭代</dt><dd>{result.chosenIteration+1}</dd></div><div><dt>原始熵值</dt><dd>{result.originalScore.entropy.toFixed(3)}</dd></div><div><dt>优化后熵值</dt><dd>{result.processedScore.entropy.toFixed(3)}</dd></div><div><dt>高频信息</dt><dd>{result.processedScore.high_frequency.toFixed(3)}</dd></div><div><dt>EXIF</dt><dd>关闭</dd></div><div><dt>原图</dt><dd>已保留</dd></div><div><dt>最终选择</dt><dd>{choice==='original'?'原图':choice==='processed'?'优化图':'待选择'}</dd></div></dl><div className="report-path"><b>报告文件</b><span title={result.reportPath}>{result.reportPath}</span></div></> : <div className="report-empty">处理完成后显示评分、参数和报告路径。</div>}</aside>
  </section>
}

function EbayStoreCategoryTree({categories,listings,selected,onSelect}:{categories:EbayCategoryWorkspace['categories'];listings:EbayListing[];selected:string;onSelect:(categoryId:string)=>void}) {
  const descendants=(categoryId:string):string[]=>[categoryId,...categories.filter(item=>item.parentCategoryId===categoryId).flatMap(item=>descendants(item.categoryId))]
  const count=(categoryId:string)=>{const ids=new Set(descendants(categoryId));return listings.filter(item=>ids.has(item.categoryId)).length}
  const render=(parentCategoryId:string,depth=0):ReactNode=>categories.filter(item=>item.parentCategoryId===parentCategoryId).sort((a,b)=>a.sortOrder-b.sortOrder).map(item=><div className="ebay-store-category-node" key={item.categoryId}><button type="button" className={selected===item.categoryId?'active':''} style={{paddingLeft:`${12+depth*16}px`}} onClick={()=>onSelect(item.categoryId)}><i>{item.childCount?'›':'·'}</i><span>{item.name}</span><em>{count(item.categoryId)}</em></button>{render(item.categoryId,depth+1)}</div>)
  return <div className="ebay-store-category-tree">{render('')}</div>
}

const currentEbayTitleStrategyIds=['SEARCH','PARAMETER','BENEFIT','SCENARIO','INTENT','BALANCED'] as const

function hasCurrentEbayTitleVariants(variants:Array<{id:string}>|undefined) {
  const ids=new Set((variants||[]).map(item=>item.id))
  return (variants?.length||0)>=currentEbayTitleStrategyIds.length&&currentEbayTitleStrategyIds.every(id=>ids.has(id))
}

function EbayPlatformWorkspace() {
  const [activeTab,setActiveTab]=useState<EbayWorkspaceTab>('browser')
  const [storeScope,setStoreScope]=useState('')
  const [stores,setStores]=useState<EbayStore[]>([])
  const [listings,setListings]=useState<EbayListing[]>([])
  const [localProducts,setLocalProducts]=useState<EbayLocalProduct[]>([])
  const [categoryWorkspace,setCategoryWorkspace]=useState<EbayCategoryWorkspace>({categories:[]})
  const [categorySyncing,setCategorySyncing]=useState(false)
  const [directoryProductSyncOpen,setDirectoryProductSyncOpen]=useState(false)
  const [directoryProductSyncing,setDirectoryProductSyncing]=useState(false)
  const [directoryProductCategoryIds,setDirectoryProductCategoryIds]=useState<string[]>([])
  const [directoryProductSyncResult,setDirectoryProductSyncResult]=useState<EbayDirectoryProductSyncResult|null>(null)
  const [directoryProductSyncRuns,setDirectoryProductSyncRuns]=useState<EbayProductSyncRun[]>([])
  const [directoryProductStoreUrl,setDirectoryProductStoreUrl]=useState('')
  const [directoryProductSyncPhase,setDirectoryProductSyncPhase]=useState('')
  const [directoryProductSyncError,setDirectoryProductSyncError]=useState('')
  const [directoryProductSyncProgress,setDirectoryProductSyncProgress]=useState<EbayDirectoryProductSyncProgress|null>(null)
  const [directoryProductSyncCheckpoint,setDirectoryProductSyncCheckpoint]=useState<EbayDirectoryProductSyncCheckpoint|undefined>()
  const [directoryProductSyncPaused,setDirectoryProductSyncPaused]=useState(false)
  const [configuration,setConfiguration]=useState<EbayConfigurationStatus|null>(null)
  const [busy,setBusy]=useState('')
  const [notice,setNotice]=useState('')
  const [ebayError,setEbayError]=useState('')
  const [downloadToast,setDownloadToast]=useState<{kind:'progress'|'success'|'warning'|'error';message:string}|null>(null)
  const [search,setSearch]=useState('')
  const [selectedCategoryId,setSelectedCategoryId]=useState('ALL')
  const [premiumCategoryId,setPremiumCategoryId]=useState('ALL')
  const [premiumSearch,setPremiumSearch]=useState('')
  const [premiumStatus,setPremiumStatus]=useState<'ALL'|'READY'|'REVIEW'|'INCOMPLETE'>('ALL')
  const [selectedListingId,setSelectedListingId]=useState('')
  const [selectedLocalProductId,setSelectedLocalProductId]=useState('')
  const [localEditorProductId,setLocalEditorProductId]=useState('')
  const [localEditorDraft,setLocalEditorDraft]=useState<EbayLocalProductUpdateInput|null>(null)
  const [optimizeMode,setOptimizeMode]=useState<'title'|'image'|'content'|'video'|'pricing'>('title')
  const [profitAssumptions,setProfitAssumptions]=useState<EbayProfitAssumptions>(defaultEbayProfitAssumptions)
  const [selectedPricingStrategy,setSelectedPricingStrategy]=useState<EbayPricingStrategy>('BALANCED')
  const [savedPricingDecision,setSavedPricingDecision]=useState<EbayCompetitivePricingDecision|null>(null)
  const [complianceReviewed,setComplianceReviewed]=useState(false)
  const [complianceCheck,setComplianceCheck]=useState<ComplianceCheckResult|null>(null)
  const [complianceAutoRunning,setComplianceAutoRunning]=useState(false)
  const [complianceAutoError,setComplianceAutoError]=useState('')
  const [imageVisualReport,setImageVisualReport]=useState<EbayImageVisualInspectionReport|null>(null)
  const [titleResult,setTitleResult]=useState<EbayTitleOptimizationResult|null>(null)
  const [selectedTitle,setSelectedTitle]=useState('')
  const [titleDecision,setTitleDecision]=useState<EbayTitleDecision|null>(null)
  const [marketResearch,setMarketResearch]=useState<EbayMarketResearchSnapshot|null>(null)
  const [marketResearchHistory,setMarketResearchHistory]=useState<EbayMarketResearchSnapshot[]>([])
  const [researchQuery,setResearchQuery]=useState('')
  const [researchPeriod,setResearchPeriod]=useState<30|90|365>(90)
  const [optimizationDrafts,setOptimizationDrafts]=useState<EbayOptimizationDraft[]>([])
  const [publishTasks,setPublishTasks]=useState<EbayPublishTask[]>([])
  const [acceptanceBatches,setAcceptanceBatches]=useState<EbayAcceptanceBatch[]>([])
  const [imageModels,setImageModels]=useState<ImageModelProfile[]>([])
  const [imageModel,setImageModel]=useState('')
  const [imageResults,setImageResults]=useState<Partial<Record<EbayImagePurpose,ImageGenerationResult>>>({})
  const [imageGroundingPlan,setImageGroundingPlan]=useState<EbayImageGroundingPlan|null>(null)
  const [imageCandidateReviews,setImageCandidateReviews]=useState<Partial<Record<EbayImagePurpose,EbayImageCandidateReview[]>>>({})
  const [imageSourceCuration,setImageSourceCuration]=useState<EbayImageSourceCuration>({})
  const [extraGalleryOpen,setExtraGalleryOpen]=useState(false)
  const [imageGenerationRun,setImageGenerationRun]=useState<{phase:'IDLE'|'GROUNDING'|'GENERATING'|'REVIEWING'|'DONE'|'ERROR';message:string;completed:number;total:number}>({phase:'IDLE',message:'',completed:0,total:0})
  const [imageTotalCount,setImageTotalCount]=useState(8)
  const [imageExtraPrompt,setImageExtraPrompt]=useState('')
  const [shotEdits,setShotEdits]=useState<Record<string,{painPoint?:string;solution?:string;customerBenefit?:string;title?:string;description?:string}>>({})
  const [editingShot,setEditingShot]=useState<string|null>(null)
  const [selectedGeneratedImages,setSelectedGeneratedImages]=useState<Partial<Record<EbayImagePurpose,string>>>({})
  const [acceptedGeneratedImages,setAcceptedGeneratedImages]=useState<Partial<Record<EbayImagePurpose,string>>>({})
  const [naturalizePurpose,setNaturalizePurpose]=useState<EbayImagePurpose>('HERO')
  const [naturalizeProfile,setNaturalizeProfile]=useState<RealShiftProfile>('light')
  const [naturalizeResults,setNaturalizeResults]=useState<Partial<Record<EbayImagePurpose,RealShiftResult>>>({})
  const [naturalizeChoices,setNaturalizeChoices]=useState<Partial<Record<EbayImagePurpose,'original'|'processed'>>>({})
  const [finalImageInspection,setFinalImageInspection]=useState<EbayImageInspectionReport|null>(null)
  const [finalImageChecking,setFinalImageChecking]=useState(false)
  const [imageModelUsage,setImageModelUsage]=useState<Record<string,number>>(()=>readEbayImageUsage())
  const [contentResult,setContentResult]=useState<EbayContentOptimizationResult|null>(null)
  const [contentResultTitle,setContentResultTitle]=useState('')
  const [contentTranslationView,setContentTranslationView]=useState<'BILINGUAL'|'ENGLISH'|'CHINESE'>('ENGLISH')
  const [literalTitleTranslation,setLiteralTitleTranslation]=useState('')
  const [titleVariantTranslations,setTitleVariantTranslations]=useState<Record<string,string>>({})
  const [titleVariantTranslationLoading,setTitleVariantTranslationLoading]=useState(false)
  const [selectedSourceImageUrl,setSelectedSourceImageUrl]=useState('')
  const [storeFormOpen,setStoreFormOpen]=useState(false)
  const [storeDraft,setStoreDraft]=useState({name:'',username:'',password:''})
  const [ebayBrowserState,setEbayBrowserState]=useState<BrowserState|null>(null)
  const [ebayBrowserTabs,setEbayBrowserTabs]=useState<BrowserTab[]>([])
  const [ebayPlatformLogo,setEbayPlatformLogo]=useState('')
  const [ebayAddress,setEbayAddress]=useState('https://www.ebay.com/')
  const [ebayPluginActive,setEbayPluginActive]=useState(false)
  const [ebayPluginRecognized,setEbayPluginRecognized]=useState(0)
  const [ebayPluginSelected,setEbayPluginSelected]=useState(0)
  const [ebayPluginProducts,setEbayPluginProducts]=useState<EbayCollectedProduct[]>([])
  const [ebayCollectionConfirming,setEbayCollectionConfirming]=useState(false)
  const [ebayCollectionResult,setEbayCollectionResult]=useState<{status:'SUCCESS'|'FAILED';message:string}|null>(null)
  const [ebayLogin,setEbayLogin]=useState<EbayLoginResult|null>(null)
  const [ebayTranslationActive,setEbayTranslationActive]=useState(false)
  const [ebayTranslationMode,setEbayTranslationMode]=useState<BrowserTranslationMode>('BILINGUAL')
  const [ebayTranslationCount,setEbayTranslationCount]=useState(0)
  const [ebayTranslationMenuOpen,setEbayTranslationMenuOpen]=useState(false)
  const [ebayTranslating,setEbayTranslating]=useState(false)
  const [ebayDeliveryOpening,setEbayDeliveryOpening]=useState(false)
  const [ebayDeliveryLabel,setEbayDeliveryLabel]=useState('收货地')
  const ebayBrowserSlot=useRef<HTMLDivElement>(null)
  const ebayBrowserLaunchVersion=useRef(0)
  const pendingOriginalProduct=useRef<EbayListing|null>(null)
  const ebayTranslationRunning=useRef(false)
  const ebayCategoryAutoChecked=useRef(new Set<string>())
  const ebayImageSyncAttempted=useRef(new Set<string>())
  const ebayImageInspectionAttempted=useRef(new Set<string>())
  const activeStore=stores.find(store=>store.id===storeScope)
  const scopeName=activeStore?.name||'尚未选择店铺'
  const ensureEbayLogin=async(store=activeStore,silent=false)=>{if(!store)return null;if(!silent)setEbayLogin({status:'AUTO_LOGIN_RUNNING',message:'正在检查会话并安全登录eBay…',url:ebayAddress,autoLoginAttempted:false});try{const result=await window.desktop.ebay.ensureLogin(store.id);setEbayLogin(result);return result}catch(reason){const result:EbayLoginResult={status:'ERROR',message:readableError(reason,'eBay自动登录失败'),url:ebayAddress,autoLoginAttempted:false};setEbayLogin(result);return result}}
  const refreshStores=async()=>{const next=await window.desktop.ebay.stores();setStores(next);setStoreScope(current=>next.some(store=>store.id===current)?current:(next[0]?.id||''));return next}
  useEffect(()=>{void Promise.all([window.desktop.ebay.status().then(setConfiguration),refreshStores()]).catch(reason=>setEbayError(readableError(reason,'eBay工作区加载失败')))},[])
  useEffect(()=>{
    if(downloadToast?.kind!=='success')return
    const timeout=window.setTimeout(()=>setDownloadToast(current=>current===downloadToast?null:current),10_000)
    return()=>window.clearTimeout(timeout)
  },[downloadToast])
  useEffect(()=>{const refresh=(event:Event)=>{const accountId=(event as CustomEvent<{accountId:string}>).detail?.accountId;if(accountId?.startsWith('ebay:'))void refreshStores()};window.addEventListener('credential-status-change',refresh);return()=>window.removeEventListener('credential-status-change',refresh)},[])
  useEffect(()=>{setSelectedCategoryId('ALL');setPremiumCategoryId('ALL');setPremiumSearch('');setPremiumStatus('ALL');setSelectedLocalProductId('');if(!storeScope){setListings([]);setLocalProducts([]);setOptimizationDrafts([]);setPublishTasks([]);setAcceptanceBatches([]);setCategoryWorkspace({categories:[]});return}void Promise.all([window.desktop.ebay.listings(storeScope).then(setListings),window.desktop.ebay.localProducts(storeScope).then(setLocalProducts),window.desktop.ebay.categoryWorkspace(storeScope).then(setCategoryWorkspace),window.desktop.ebay.optimizationDrafts(storeScope).then(setOptimizationDrafts),window.desktop.ebay.publishTasks(storeScope).then(setPublishTasks),window.desktop.ebay.acceptanceBatches(storeScope).then(setAcceptanceBatches)]).catch(reason=>setEbayError(readableError(reason,'eBay产品库读取失败')))},[storeScope])
  useEffect(()=>window.desktop.browser.onState(next=>{if(next.platform==='web'){setEbayBrowserState(next);setEbayAddress(next.url)}}),[])
  useEffect(()=>window.desktop.browser.onTabs(next=>setEbayBrowserTabs(next.filter(tab=>tab.scopeId===`ebay:${activeStore?.id||''}`))),[activeStore?.id])
  useEffect(()=>window.desktop.ebay.onDirectorySyncProgress(progress=>{if(progress.storeId!==activeStore?.id)return;setDirectoryProductSyncProgress(progress);setDirectoryProductSyncPhase(progress.message);setDirectoryProductSyncPaused(progress.status==='PAUSED')}),[activeStore?.id])
  useEffect(()=>{
    const active=ebayBrowserTabs.find(tab=>tab.active)
    const logo=active?.siteLogoUrl||active?.faviconUrl||ebayBrowserTabs.find(tab=>tab.siteLogoUrl)?.siteLogoUrl||ebayBrowserTabs.find(tab=>tab.faviconUrl)?.faviconUrl
    if(logo)setEbayPlatformLogo(logo)
  },[ebayBrowserTabs])
  useEffect(()=>setEbayPlatformLogo(''),[activeStore?.id])
  useEffect(()=>{
    const launchVersion=++ebayBrowserLaunchVersion.current
    if(activeTab!=='browser'||!activeStore||storeFormOpen){void window.desktop.browser.hide();return}
    let cancelled=false
    const isCurrent=()=>!cancelled&&ebayBrowserLaunchVersion.current===launchVersion
    const openPendingOriginalProduct=async()=>{
      const item=pendingOriginalProduct.current
      if(!item||!isCurrent())return
      pendingOriginalProduct.current=null
      try {
        await window.desktop.ebay.openProduct(activeStore.id,item.viewUrl,item.title)
        if(isCurrent())setNotice('原商品已在当前店铺的 eBay 浏览器新标签中打开。')
      } catch(reason) {
        if(isCurrent())setEbayError(readableError(reason,'原商品打开失败'))
      } finally {
        if(isCurrent())setBusy('')
      }
    }
    setEbayError('')
    setEbayLogin({status:'CHECKING',message:'正在检查eBay店铺会话…',url:'',autoLoginAttempted:false})
    const launch=async()=>{
      try {
        await window.desktop.ebay.openSellerHub(activeStore.id)
        if(!isCurrent())return
        await window.desktop.browser.show('web')
        if(!isCurrent())return
        const next=await window.desktop.browser.getState('web')
        if(!isCurrent())return
        if(next){setEbayBrowserState(next);setEbayAddress(next.url)}
        const login=await window.desktop.ebay.ensureLogin(activeStore.id)
        if(!isCurrent())return
        setEbayLogin(login)
        if(login.status!=='ONLINE'){if(pendingOriginalProduct.current){pendingOriginalProduct.current=null;setBusy('');setEbayError(login.message||'请先完成 eBay 登录后重新打开原商品')}return}
        const plugin=await window.desktop.browser.startEbayPlugin()
        if(!isCurrent())return
        setEbayPluginActive(plugin.active);setEbayPluginRecognized(plugin.recognizedCount);setEbayPluginSelected(plugin.selectedCount);setEbayPluginProducts(plugin.products)
        await openPendingOriginalProduct()
      } catch(reason) {
        if(!isCurrent())return
        try {
          const recovered=await window.desktop.ebay.ensureLogin(activeStore.id)
          if(!isCurrent())return
          if(recovered.status==='ONLINE') {
            setEbayError('')
            setEbayLogin(recovered)
            const plugin=await window.desktop.browser.startEbayPlugin()
            if(!isCurrent())return
            setEbayPluginActive(plugin.active);setEbayPluginRecognized(plugin.recognizedCount);setEbayPluginSelected(plugin.selectedCount);setEbayPluginProducts(plugin.products)
            await openPendingOriginalProduct()
            return
          }
        } catch {
          // 浏览器尚未初始化或确实不可用时，继续展示原始导航错误。
        }
        setEbayError(readableError(reason,'eBay浏览器打开失败'))
        setEbayLogin({status:'ERROR',message:readableError(reason,'eBay自动登录失败'),url:'',autoLoginAttempted:false})
      }
    }
    void launch()
    return()=>{cancelled=true;ebayBrowserLaunchVersion.current+=1;void window.desktop.browser.hide()}
  },[activeStore?.id,activeTab,storeFormOpen])
  useEffect(()=>{if(activeTab!=='browser'||!activeStore||ebayLogin?.status!=='VERIFICATION_REQUIRED')return;const timer=window.setInterval(()=>void ensureEbayLogin(activeStore,true),2500);return()=>window.clearInterval(timer)},[activeStore?.id,activeTab,ebayLogin?.status])
  useEffect(()=>{
    if(activeTab!=='browser'||!activeStore||!ebayPluginActive)return
    const refresh=()=>void window.desktop.browser.ebayPluginState().then(state=>{setEbayPluginActive(state.active);setEbayPluginRecognized(state.recognizedCount);setEbayPluginSelected(state.selectedCount);setEbayPluginProducts(state.products)}).catch(()=>undefined)
    refresh();const timer=window.setInterval(refresh,700);return()=>window.clearInterval(timer)
  },[activeStore?.id,activeTab,ebayPluginActive])
  useEffect(()=>{if(ebayPluginProducts.length&&ebayCollectionResult)setEbayCollectionResult(null)},[ebayPluginProducts.length])
  useEffect(()=>{
    if(activeTab!=='browser'||!activeStore||!ebayTranslationActive)return
    const timer=window.setInterval(()=>void translateEbayPage(ebayTranslationMode,true),5000)
    return()=>window.clearInterval(timer)
  },[activeStore?.id,activeTab,ebayTranslationActive,ebayTranslationMode])
  useEffect(()=>{
    if(activeTab!=='browser'||!activeStore)return
    const update=()=>{const rect=ebayBrowserSlot.current?.getBoundingClientRect();if(rect)void window.desktop.browser.setBounds({x:rect.x,y:rect.y,width:rect.width,height:rect.height})}
    update();const observer=new ResizeObserver(update);if(ebayBrowserSlot.current)observer.observe(ebayBrowserSlot.current);window.addEventListener('resize',update)
    return()=>{observer.disconnect();window.removeEventListener('resize',update)}
  },[activeStore?.id,activeTab])
  const addStore=()=>{void window.desktop.browser.hide();setEbayError('');setStoreDraft({name:'',username:'',password:''});setStoreFormOpen(true)}
  const submitStore=async(event:FormEvent)=>{
    event.preventDefault()
    const name=storeDraft.name.trim()
    const username=storeDraft.username.trim()
    if(!name||!username||!storeDraft.password){setEbayError('请完整填写店名、eBay 登录账号和密码');return}
    setBusy('create');setEbayError('')
    try{const store=await window.desktop.ebay.createStore(name,username,storeDraft.password,'EBAY_US');await refreshStores();setStoreScope(store.id);setActiveTab('browser');setStoreFormOpen(false);setStoreDraft({name:'',username:'',password:''});setNotice(`${name} 已添加，账号和密码已使用系统安全存储加密保存。`)}
    catch(reason){setEbayError(readableError(reason,'添加 eBay 店铺失败'))}finally{setBusy('')}
  }
  const authorizeStore=async(store:EbayStore)=>{setBusy(`authorize:${store.id}`);setEbayError('');try{await window.desktop.ebay.authorize(store.id);await refreshStores();setNotice(`${store.name} 已完成正式环境只读授权，可以同步商品。`)}catch(reason){setEbayError(readableError(reason,'eBay店铺授权失败'))}finally{setBusy('')}}
  const syncStore=async(store:EbayStore)=>{setBusy(`sync:${store.id}`);setEbayError('');try{const result=await window.desktop.ebay.sync(store.id);await refreshStores();setListings(await window.desktop.ebay.listings(store.id));setNotice(`同步完成：读取 ${result.imported} 个在线商品。`)}catch(reason){setEbayError(readableError(reason,'eBay商品同步失败'));await refreshStores()}finally{setBusy('')}}
  const syncStoreCategories=async(store=activeStore,automatic=false)=>{if(!store||categorySyncing)return;setCategorySyncing(true);if(!automatic)setEbayError('');try{const previous=categoryWorkspace.lastSync;const result=await window.desktop.ebay.syncCategories(store.id);setCategoryWorkspace(result);const summary=result.lastSync;const changed=summary?(summary.added+summary.renamed+summary.moved+summary.removed):0;if(summary){if(!previous)setNotice(`店铺目录首次同步完成：已保存 ${summary.total} 个类别。`);else if(changed)setNotice(`检测到线上目录变化并已更新：新增 ${summary.added}、改名 ${summary.renamed}、移动 ${summary.moved}、删除 ${summary.removed}。`);else if(!automatic)setNotice(`店铺目录已是最新，共 ${summary.total} 个类别。`)}}catch(reason){if(!automatic)setEbayError(readableError(reason,'eBay店铺目录同步失败'))}finally{setCategorySyncing(false)}}
  const directoryProductCategories=categoryWorkspace.categories.filter(item=>item.status==='ACTIVE'&&item.listingCount>0)
  const openDirectoryProductSync=async()=>{
    if(!activeStore||!directoryProductCategories.length)return
    setDirectoryProductCategoryIds(directoryProductCategories.map(item=>item.categoryId))
    setDirectoryProductSyncResult(null)
    setDirectoryProductStoreUrl(activeStore.publicStoreUrl||'')
    setDirectoryProductSyncPhase('')
    setDirectoryProductSyncError('')
    setDirectoryProductSyncProgress(null)
    setDirectoryProductSyncPaused(false)
    setEbayError('')
    const [,runs,pending]=await Promise.all([window.desktop.browser.hide(),window.desktop.ebay.productSyncRuns(activeStore.id),window.desktop.ebay.pendingDirectorySync(activeStore.id)])
    setDirectoryProductSyncRuns(runs)
    setDirectoryProductSyncCheckpoint(pending)
    setDirectoryProductSyncOpen(true)
  }
  const closeDirectoryProductSync=async()=>{
    if(directoryProductSyncing)return
    setDirectoryProductSyncOpen(false)
    if(activeTab==='browser'&&activeStore)await window.desktop.browser.show('web')
  }
  const syncDirectoryProducts=async(mode:'NEW'|'RESUME'='NEW',categoryIds=directoryProductCategoryIds)=>{
    if(!activeStore||directoryProductSyncing||!categoryIds.length)return
    setDirectoryProductSyncing(true);setDirectoryProductSyncError('');setDirectoryProductSyncPhase('正在检查登录会话并自动定位店铺主页…');setEbayError('')
    try {
      const result=await window.desktop.ebay.syncDirectoryProducts({storeId:activeStore.id,categoryIds,publicStoreUrl:directoryProductStoreUrl.trim()||undefined,resumeTaskId:mode==='RESUME'?directoryProductSyncCheckpoint?.taskId:undefined,restart:mode==='NEW'})
      setDirectoryProductSyncResult(result)
      setDirectoryProductStoreUrl(result.publicStoreUrl)
      setDirectoryProductSyncPhase('同步完成')
      setDirectoryProductSyncCheckpoint(result.failedCategoryIds.length?await window.desktop.ebay.pendingDirectorySync(activeStore.id):undefined)
      const [nextListings,runs]=await Promise.all([window.desktop.ebay.listings(activeStore.id),window.desktop.ebay.productSyncRuns(activeStore.id)])
      setListings(nextListings)
      setDirectoryProductSyncRuns(runs)
      await refreshStores()
      setNotice(`目录增量同步完成：新增 ${result.imported}、更新 ${result.updated}、重新上架 ${result.reactivated}、下架 ${result.ended}、未变化 ${result.unchanged}${result.protectedOptimizations?`，已保护 ${result.protectedOptimizations} 个 AI 优化版本`:''}${result.failed?`，${result.failed} 个目录需重试`:''}。`)
    } catch(reason) {
      const message=readableError(reason,'按目录同步 eBay 商品失败')
      setDirectoryProductSyncError(message)
      setDirectoryProductSyncPhase('')
      setDirectoryProductSyncCheckpoint(await window.desktop.ebay.pendingDirectorySync(activeStore.id))
    } finally { setDirectoryProductSyncing(false) }
  }
  const controlDirectoryProductSync=async(action:'PAUSE'|'RESUME'|'CANCEL')=>{
    if(!activeStore)return
    try{await window.desktop.ebay.controlDirectorySync(activeStore.id,action);setDirectoryProductSyncPaused(action==='PAUSE');if(action==='CANCEL')setDirectoryProductSyncPhase('正在安全取消任务…')}
    catch(reason){setDirectoryProductSyncError(readableError(reason,'同步任务控制失败'))}
  }
  useEffect(()=>{if(activeTab!=='browser'||!activeStore||ebayLogin?.status!=='ONLINE'||ebayCategoryAutoChecked.current.has(activeStore.id))return;const last=categoryWorkspace.lastSync?.syncedAt;const stale=!last||Date.now()-Date.parse(last)>24*60*60_000;if(!stale)return;ebayCategoryAutoChecked.current.add(activeStore.id);void syncStoreCategories(activeStore,true)},[activeStore?.id,activeTab,ebayLogin?.status,categoryWorkspace.lastSync?.syncedAt])
  const importReport=async(store:EbayStore)=>{setBusy(`report:${store.id}`);setEbayError('');try{const result=await window.desktop.ebay.importReport(store.id);if(!result)return;await refreshStores();if(storeScope===store.id)setListings(await window.desktop.ebay.listings(store.id));setNotice(`${result.fileName} 导入完成：新增 ${result.imported} 个，更新 ${result.updated} 个${result.failed?`，跳过 ${result.failed} 行`:''}。`);if(result.errors.length)setEbayError(result.errors.join('；'))}catch(reason){setEbayError(readableError(reason,'eBay Listings 报表导入失败'))}finally{setBusy('')}}
  const activeCategoryIds=new Set(categoryWorkspace.categories.map(item=>item.categoryId))
  const selectedCategoryIds=(()=>{if(!activeCategoryIds.has(selectedCategoryId))return new Set<string>();const ids=new Set([selectedCategoryId]);let changed=true;while(changed){changed=false;for(const item of categoryWorkspace.categories)if(ids.has(item.parentCategoryId)&&!ids.has(item.categoryId)){ids.add(item.categoryId);changed=true}}return ids})()
  const categoryMatches=(item:EbayListing)=>{
    if(selectedCategoryId==='ALL')return true
    if(selectedCategoryId==='UNCLASSIFIED')return !activeCategoryIds.has(item.categoryId)
    if(selectedCategoryId==='MISSING_IMAGE')return !item.imageUrl
    return selectedCategoryIds.has(item.categoryId)
  }
  const visibleListings=listings.filter(item=>categoryMatches(item)&&(!search.trim()||[item.title,item.sku,item.listingId].some(value=>value.toLowerCase().includes(search.trim().toLowerCase()))))
  const localListings=localProducts.map(product=>product.snapshot.sourceListing)
  const localCategoryMatches=(product:EbayLocalProduct)=>{
    if(selectedCategoryId==='MISSING_IMAGE')return !product.snapshot.media.some(media=>media.downloadStatus==='DOWNLOADED')
    return categoryMatches(product.snapshot.sourceListing)
  }
  const visibleLocalProducts=localProducts.filter(product=>localCategoryMatches(product)&&(!search.trim()||[product.title,product.listingId,product.snapshot.sourceListing.sku].some(value=>value.toLowerCase().includes(search.trim().toLowerCase()))))
  const unclassifiedCount=listings.filter(item=>!activeCategoryIds.has(item.categoryId)).length
  const titleIssues=listings.filter(item=>item.title.length<50||item.title.length>80).length
  const imageIssues=listings.filter(item=>!item.imageUrl).length
  const selectedLocalProduct=localProducts.find(item=>item.id===selectedLocalProductId)
  const localEditorProduct=localProducts.find(item=>item.id===localEditorProductId)
  const selectedListing=selectedLocalProduct?.snapshot.sourceListing
  const selectedTitleVerifiedFacts=[
    ...(selectedListing?.itemSpecifics||[]).flatMap(item=>[item.name,item.value]),
    selectedLocalProduct?.snapshot.details.descriptionText||''
  ].filter(value=>Boolean(value.trim()))
  useEffect(()=>{setProfitAssumptions(readEbayProfitAssumptions(selectedLocalProduct?.id||''))},[selectedLocalProduct?.id])
  useEffect(()=>{
    const decision=readEbayCompetitivePricingDecision(selectedLocalProduct?.id||'')
    setSavedPricingDecision(decision)
    setSelectedPricingStrategy(decision?.strategy||'BALANCED')
  },[selectedLocalProduct?.id])
  const selectedSaleCurrency=(selectedLocalProduct?.snapshot.details.currency||selectedListing?.currency||'USD').toUpperCase()
  const selectedSalePrice=ebayMoneyNumber(selectedLocalProduct?.snapshot.details.price||selectedListing?.price)
  const saleRevenueCny=selectedSaleCurrency==='CNY'?selectedSalePrice:selectedSalePrice*profitAssumptions.exchangeRate
  const categoryFeeRule=ebayCategoryFeeRule(selectedListing?.categoryName||'',selectedSalePrice)
  const effectivePlatformFeeRate=profitAssumptions.platformFeeMode==='CATEGORY_RULE'?categoryFeeRule.rate:Math.max(0,profitAssumptions.platformFeeRate)
  const automaticFixedFeeCny=(selectedSalePrice>0&&selectedSalePrice<=10?0.3:0.4)*profitAssumptions.exchangeRate
  const effectivePlatformFixedFeeCny=profitAssumptions.platformFeeMode==='CATEGORY_RULE'?automaticFixedFeeCny:Math.max(0,profitAssumptions.platformFixedFeeCny)
  const platformFeeCny=saleRevenueCny*effectivePlatformFeeRate/100+effectivePlatformFixedFeeCny
  const promotionFeeCny=saleRevenueCny*Math.max(0,profitAssumptions.promotionFeeRate)/100
  const returnLossCny=saleRevenueCny*Math.max(0,profitAssumptions.returnLossRate)/100
  const riskBufferCny=saleRevenueCny*Math.max(0,profitAssumptions.riskBufferRate)/100
  const fixedOperatingCostCny=[
    profitAssumptions.purchaseCostCny,
    profitAssumptions.logisticsCostCny,
    profitAssumptions.packagingCostCny,
    profitAssumptions.fulfillmentCostCny,
    profitAssumptions.otherCostCny,
    effectivePlatformFixedFeeCny
  ].reduce((total,value)=>total+Math.max(0,value),0)
  const variableCostRate=[
    effectivePlatformFeeRate,
    profitAssumptions.promotionFeeRate,
    profitAssumptions.returnLossRate,
    profitAssumptions.riskBufferRate
  ].reduce((total,value)=>total+Math.max(0,value),0)/100
  const totalCostCny=fixedOperatingCostCny+saleRevenueCny*variableCostRate
  const estimatedProfitCny=saleRevenueCny-totalCostCny
  const estimatedProfitMargin=saleRevenueCny>0?estimatedProfitCny/saleRevenueCny*100:0
  const breakEvenDenominator=1-variableCostRate
  const targetMarginDenominator=breakEvenDenominator-Math.max(0,profitAssumptions.targetMarginRate)/100
  const breakEvenRevenueCny=breakEvenDenominator>0?fixedOperatingCostCny/breakEvenDenominator:0
  const targetRevenueCny=targetMarginDenominator>0?fixedOperatingCostCny/targetMarginDenominator:0
  const priceCurrencyFactor=selectedSaleCurrency==='CNY'?1:Math.max(0,profitAssumptions.exchangeRate)
  const breakEvenSalePrice=priceCurrencyFactor>0?breakEvenRevenueCny/priceCurrencyFactor:0
  const targetSalePrice=priceCurrencyFactor>0?targetRevenueCny/priceCurrencyFactor:0
  const profitReady=selectedSalePrice>0&&priceCurrencyFactor>0&&profitAssumptions.purchaseCostCny>0
  const pricingReady=priceCurrencyFactor>0&&profitAssumptions.purchaseCostCny>0&&breakEvenDenominator>0&&targetMarginDenominator>0
  const updateProfitAssumption=(field:EbayNumericProfitField,value:string)=>{
    const numeric=Math.max(0,Number(value)||0)
    setProfitAssumptions(current=>{const next={...current,[field]:numeric};saveEbayProfitAssumptions(selectedLocalProduct?.id||'',next);return next})
  }
  const updateProfitFeeMode=(platformFeeMode:EbayProfitFeeMode)=>{
    setProfitAssumptions(current=>{const next={...current,platformFeeMode};saveEbayProfitAssumptions(selectedLocalProduct?.id||'',next);return next})
  }
  const researchQuerySuggestion=selectedListing?ebayResearchQuerySuggestion(selectedListing):{query:'',source:'CATEGORY' as const}
  const selectedDownloadedMedia=selectedLocalProduct?.snapshot.media.filter(media=>media.downloadStatus==='DOWNLOADED'&&Boolean(media.localPath))||[]
  const selectedReadableMedia=selectedDownloadedMedia.filter(media=>media.width>0&&media.height>0&&Boolean(media.sha256))
  const selectedCompliantMedia=selectedReadableMedia.filter(media=>Math.max(media.width,media.height)>=500)
  const selectedMinimumLongestEdge=selectedReadableMedia.length?Math.min(...selectedReadableMedia.map(media=>Math.max(media.width,media.height))):0
  const selectedSourceImages=selectedListing?[...(selectedListing.imageUrls||[]),selectedListing.imageUrl].filter((value,index,array)=>value&&array.indexOf(value)===index):[]
  const selectedSourceImagesKey=selectedSourceImages.join('|')
  const curatedImageSourceEntries=selectedSourceImages.map((url,index)=>{
    const defaultEnabled=index<ebayImageSourceMaxReferences
    const entry=imageSourceCuration[url]
    const role=entry&&ebayImageSourceRoles.includes(entry.role)?entry.role:(index===0?'HERO':defaultEnabled?'DETAIL':'UNUSED')
    return {url,originalIndex:index,enabled:role==='UNUSED'?false:(entry?.enabled??defaultEnabled),role}
  })
  const activeImageSourceEntries=curatedImageSourceEntries.filter(entry=>entry.enabled&&entry.role!=='UNUSED').slice(0,ebayImageSourceMaxReferences)
  const activeImageSourceImages=activeImageSourceEntries.map(entry=>entry.url)
  const complianceCoveredImageUrls=new Set((selectedLocalProduct?.snapshot.media||[]).map(media=>media.remoteUrl).filter(Boolean))
  const extraImageSourceEntries=curatedImageSourceEntries.filter(entry=>!complianceCoveredImageUrls.has(entry.url))
  const imageShotReferenceIndices=(shot:EbayImageShot,grounding=imageGroundingPlan)=>{
    if(!grounding)return []
    const isValid=(index:number)=>Number.isInteger(index)&&index>=0&&index<activeImageSourceImages.length
    const matchedByPurpose=Array.from(new Set((grounding?.purposeReferences[shot.purpose]||[]).filter(isValid))).slice(0,3)
    if(matchedByPurpose.length)return matchedByPurpose
    const preferredRoles=ebayImageReferenceRolePreferences[shot.purpose]
    const matchedByRole=activeImageSourceEntries
      .map((entry,index)=>({entry,index}))
      .filter(item=>preferredRoles.includes(item.entry.role))
      .map(item=>item.index)
    if(matchedByRole.length){
      const start=shot.index%matchedByRole.length
      return [...matchedByRole.slice(start),...matchedByRole.slice(0,start)].slice(0,Math.min(3,matchedByRole.length))
    }
    return activeImageSourceImages.length?[0]:[]
  }
  const selectedSourceImage=activeImageSourceImages.includes(selectedSourceImageUrl)?selectedSourceImageUrl:(activeImageSourceImages[0]||'')
  const selectedLocalPreview=selectedLocalProduct?ebayLocalMediaUrl(selectedLocalProduct.snapshot.media.find(media=>media.downloadStatus==='DOWNLOADED')?.localPath||'',selectedSourceImages[0]||''):''
  const selectedOriginalTitleVerified=Boolean(selectedListing?.originalTitleVerified&&selectedListing.originalTitle?.trim())
  const selectedOriginalTitle=selectedOriginalTitleVerified?selectedListing?.originalTitle?.trim()||'':''
  const selectedTranslatedTitle=selectedListing?.translatedTitle?.trim()||''
  const selectedTitleEnglish=selectedOriginalTitle||selectedListing?.title.trim()||''
  const selectedTitleChinese=selectedTranslatedTitle||literalTitleTranslation
  useEffect(()=>{
    if(!selectedListing){setImageSourceCuration({});return}
    setImageSourceCuration(normalizeEbayImageSourceCuration(selectedSourceImages,readEbayImageSourceCuration(selectedListing.listingId)))
  },[selectedListing?.listingId,selectedSourceImagesKey])
  useEffect(()=>{
    if(!selectedListing||!selectedTitleEnglish){setLiteralTitleTranslation('');return}
    const storageKey=`ebay-title-zh:${selectedListing.storeId}:${selectedListing.listingId}`
    const stored=localStorage.getItem(storageKey)?.trim()||''
    const existing=selectedTranslatedTitle||stored
    setLiteralTitleTranslation(existing)
    if(existing)return
    let cancelled=false
    void window.desktop.ebay.translateContent({segments:[{id:'TITLE',english:selectedTitleEnglish}]}).then(result=>{
      if(cancelled)return
      const chinese=result.segments[0]?.chinese.trim()||''
      if(!chinese||chinese===selectedTitleEnglish)return
      localStorage.setItem(storageKey,chinese)
      setLiteralTitleTranslation(chinese)
    }).catch(()=>undefined)
    return()=>{cancelled=true}
  },[selectedListing?.id,selectedTitleEnglish,selectedTranslatedTitle])
  useEffect(()=>{
    const variants=titleResult?.variants||[]
    if(!variants.length){setTitleVariantTranslations({});setTitleVariantTranslationLoading(false);return}
    let cancelled=false
    const titleById=new Map(variants.map((variant,index)=>[`TITLE_VARIANT_${index}`,variant.title]))
    setTitleVariantTranslations({})
    setTitleVariantTranslationLoading(true)
    void window.desktop.ebay.translateContent({segments:variants.map((variant,index)=>({id:`TITLE_VARIANT_${index}`,english:variant.title}))}).then(result=>{
      if(cancelled)return
      const translations:Record<string,string>={}
      result.segments.forEach(segment=>{
        const title=titleById.get(segment.id)
        const chinese=segment.chinese.trim()
        if(title&&chinese&&chinese!==title)translations[title]=chinese
      })
      setTitleVariantTranslations(translations)
    }).catch(()=>{if(!cancelled)setTitleVariantTranslations({})}).finally(()=>{if(!cancelled)setTitleVariantTranslationLoading(false)})
    return()=>{cancelled=true}
  },[titleResult])
  const currentEnglishDescription=titleResult?.description||contentResult?.englishDescription||''
  const currentContentTranslation=contentResult?reconcileEbayContentTranslation(currentEnglishDescription,contentResult.translation):null
  const staleContentTranslationCount=currentContentTranslation?.segments.filter(segment=>segment.status!=='SYNCED').length||0
  const normalizedResearchQuery=researchQuery.replace(/\s+/g,' ').trim().toLowerCase()
  const marketResearchCurrent=Boolean(marketResearch&&selectedListing&&marketResearch.listingId===selectedListing.listingId&&marketResearch.query.toLowerCase()===normalizedResearchQuery&&marketResearch.periodDays===researchPeriod&&marketResearch.categoryId===selectedListing.categoryId&&(marketResearch.condition||'')===(selectedListing.condition||''))
  const selectedPricingFactTokens=ebayPricingTokens([
    selectedTitleEnglish,
    researchQuery,
    ...(selectedListing?.itemSpecifics||[]).filter(item=>/type|material|size|dimension|style|feature|color|shape/i.test(item.name)).flatMap(item=>[item.name,item.value])
  ].join(' '))
  const selectedPricingFactTokenSet=new Set(selectedPricingFactTokens)
  const marketComparableSamples=marketResearchCurrent&&marketResearch?marketResearch.samples.map(sample=>{
    const price=ebayMarketPriceNumber(sample.price)
    const currency=String(sample.currency||selectedSaleCurrency).toUpperCase()
    const sampleTokens=ebayPricingTokens(sample.title)
    const overlap=sampleTokens.filter(token=>selectedPricingFactTokenSet.has(token)).length
    return {...sample,price,currency,overlap}
  }).filter(sample=>sample.price>0&&sample.currency===selectedSaleCurrency&&sample.itemId!==selectedListing?.listingId&&(selectedPricingFactTokens.length===0||sample.overlap>0)):[]
  const marketComparablePrices=marketComparableSamples.map(sample=>sample.price).sort((a,b)=>a-b)
  const marketLow=ebayPercentile(marketComparablePrices,.25)
  const marketMedian=ebayPercentile(marketComparablePrices,.5)
  const marketHigh=ebayPercentile(marketComparablePrices,.75)
  const comparableReady=marketComparablePrices.length>=5
  const calculatePricingOutcome=(price:number)=>{
    const revenueCny=Math.max(0,price)*priceCurrencyFactor
    const totalCny=fixedOperatingCostCny+revenueCny*variableCostRate
    const profitCny=revenueCny-totalCny
    return {profitCny,marginRate:revenueCny>0?profitCny/revenueCny*100:0}
  }
  const pricingStrategies=[
    {id:'SELL_THROUGH' as const,label:'动销优先',price:Math.max(breakEvenSalePrice,ebayPercentile(marketComparablePrices,.35)),basis:'参考同款中低位价格，且不低于保本售价。'},
    {id:'BALANCED' as const,label:'平衡推荐',price:Math.max(breakEvenSalePrice,marketMedian),basis:'参考同款价格中位数，兼顾动销与利润。'},
    {id:'PROFIT' as const,label:'利润优先',price:Math.max(targetSalePrice,ebayPercentile(marketComparablePrices,.65)),basis:'参考同款中高位价格，且不低于目标毛利售价。'}
  ].map(item=>({...item,...calculatePricingOutcome(item.price)}))
  const selectedPricingOption=pricingStrategies.find(item=>item.id===selectedPricingStrategy)??pricingStrategies[1]
  const pricingMarketCeilingConflict=comparableReady&&breakEvenSalePrice>marketHigh
  const savedPricingDecisionCurrent=Boolean(savedPricingDecision&&marketResearch&&savedPricingDecision.researchSnapshotId===marketResearch.id&&savedPricingDecision.strategy===selectedPricingStrategy&&savedPricingDecision.currency===selectedSaleCurrency&&Math.abs(savedPricingDecision.recommendedPrice-selectedPricingOption.price)<.01)
  const saveCompetitivePricingDecision=()=>{
    if(!selectedLocalProduct||!marketResearch||!selectedPricingOption||!comparableReady||!pricingReady)return
    const decision:EbayCompetitivePricingDecision={researchSnapshotId:marketResearch.id,strategy:selectedPricingOption.id,recommendedPrice:Number(selectedPricingOption.price.toFixed(2)),currency:selectedSaleCurrency,comparableSampleCount:marketComparablePrices.length,marketLow:Number(marketLow.toFixed(2)),marketMedian:Number(marketMedian.toFixed(2)),marketHigh:Number(marketHigh.toFixed(2)),expectedProfitCny:Number(selectedPricingOption.profitCny.toFixed(2)),expectedMarginRate:Number(selectedPricingOption.marginRate.toFixed(2)),savedAt:new Date().toISOString()}
    saveEbayCompetitivePricingDecision(selectedLocalProduct.id,decision)
    setSavedPricingDecision(decision)
    setNotice(`已将${selectedPricingOption.label}售价保存到本地产品，不会修改 eBay。`)
  }
  const confirmedMarketTerms=marketResearch?[...marketResearch.keywords,...marketResearch.combinations].filter(item=>item.factStatus==='CONFIRMED').length:0
  const confirmedMarketTermStats=marketResearch?[...marketResearch.keywords,...marketResearch.combinations].filter(item=>item.factStatus==='CONFIRMED'):[]
  const selectedTitleAudit=selectedTitle&&selectedOriginalTitle?auditEbayTitle(selectedTitle,selectedOriginalTitle,confirmedMarketTermStats,selectedTitleVerifiedFacts):null
  const titleDecisionCurrent=Boolean(titleDecision&&marketResearch&&titleDecision.researchSnapshotId===marketResearch.id&&titleDecision.selectedTitle===selectedTitle)
  const reviewMarketTermItems=marketResearch?[
    ...marketResearch.keywords.filter(item=>item.factStatus==='REVIEW').map(item=>({...item,kind:'KEYWORD' as const})),
    ...marketResearch.combinations.filter(item=>item.factStatus==='REVIEW').map(item=>({...item,kind:'COMBINATION' as const}))
  ]:[]
  const reviewMarketTerms=reviewMarketTermItems.length
  const marketDecision=marketResearch?buildEbayMarketDecisionReport(marketResearch,marketResearchHistory):null
  const healthRows=listings.map(item=>({item,issues:[item.title.length<50?'标题少于 50 字符':'',item.title.length>80?'标题超过 80 字符':'',!item.imageUrl?'缺少主图':'',!item.categoryName?'缺少类目':'',!item.sku?'缺少 SKU':''].filter(Boolean)}))
  useEffect(()=>{
    setMarketResearch(null)
    setMarketResearchHistory([])
    setTitleDecision(null)
    const preference=activeStore&&selectedListing?readEbayResearchQueryPreference(activeStore.id,selectedListing.listingId):undefined
    const suggestion=selectedListing?ebayResearchQuerySuggestion(selectedListing):{query:'',source:'CATEGORY' as const}
    setResearchQuery(preference?.query||suggestion.query)
    if(!activeStore||!selectedListing)return
    void Promise.all([
      window.desktop.ebay.marketResearch(activeStore.id,selectedListing.listingId),
      window.desktop.ebay.marketResearchHistory(activeStore.id,selectedListing.listingId),
      window.desktop.ebay.titleDecision(activeStore.id,selectedListing.listingId),
      window.desktop.ebay.contentOptimization(activeStore.id,selectedListing.listingId)
    ]).then(([snapshot,history,decision,contentRecord])=>{
      setMarketResearchHistory(history)
      if(snapshot){setMarketResearch(snapshot);setResearchPeriod(snapshot.periodDays===30||snapshot.periodDays===365?snapshot.periodDays:90)}
      const currentDecision=decision&&hasCurrentEbayTitleVariants(decision.variants)
      const currentContent=currentDecision&&contentRecord?.selectedTitle===decision.selectedTitle?contentRecord:undefined
      if(currentDecision){
        setTitleDecision(decision)
        setTitleResult({originalTitle:decision.originalTitle,optimizedTitle:decision.selectedTitle,keywords:decision.variants.find(item=>item.id===decision.selectedVariantId)?.keywords||[],rationale:'已从第四阶段标题审核记录恢复',model:'saved-title-decision',variants:decision.variants,itemSpecifics:[],description:currentContent?.result.englishDescription||''})
        setSelectedTitle(decision.selectedTitle)
        setContentResult(currentContent?.result||null)
        setContentResultTitle(currentContent?.selectedTitle||'')
      }else{
        setTitleDecision(null)
        setTitleResult(null)
        setSelectedTitle('')
        setContentResult(null)
        setContentResultTitle('')
        if(decision)setNotice('检测到旧版3套标题方案，请点击“依据市场决策重新生成”生成新版6套方案。')
      }
    }).catch(reason=>setEbayError(readableError(reason,'市场数据读取失败')))
  },[activeStore?.id,selectedListing?.id])
  useEffect(()=>{
    if(contentResult&&contentResultTitle&&contentResultTitle!==selectedTitle){
      setContentResult(null)
      setContentResultTitle('')
    }
  },[selectedTitle,contentResult,contentResultTitle])
  useEffect(()=>{if(activeTab!=='optimize'||imageModels.length)return;void window.desktop.image.models().then(connection=>{const fixedModel=connection.models.find(model=>model.id===ebayFixedImageModelId);setImageModels(fixedModel?[fixedModel]:[]);setImageModel(fixedModel?.id||'');if(!fixedModel)setEbayError('当前百炼连接未提供万相 2.7 Pro（wan2.7-image-pro），无法生成 eBay 优化图。')}).catch(reason=>setEbayError(readableError(reason,'百炼生图模型读取失败')))},[activeTab,imageModels.length])
  const selectForOptimization=async(product:EbayLocalProduct)=>{const item=product.snapshot.sourceListing;const suggestion=ebayResearchQuerySuggestion(item);const preference=activeStore?readEbayResearchQueryPreference(activeStore.id,item.listingId):undefined;setSelectedLocalProductId(product.id);setSelectedListingId(item.id);setTitleResult(null);setSelectedTitle('');setTitleDecision(null);setMarketResearch(null);setMarketResearchHistory([]);setResearchQuery(preference?.query||suggestion.query);setImageResults({});setImageGroundingPlan(null);setImageCandidateReviews({});setImageGenerationRun({phase:'IDLE',message:'',completed:0,total:0});setSelectedGeneratedImages({});setAcceptedGeneratedImages({});setNaturalizePurpose('HERO');setNaturalizeProfile('light');setNaturalizeResults({});setNaturalizeChoices({});setImageExtraPrompt('');setContentResult(null);setContentResultTitle('');const localMedia=product.snapshot.media.find(media=>media.downloadStatus==='DOWNLOADED');setSelectedSourceImageUrl(localMedia?await window.desktop.ebay.localProductMediaData(product.id,localMedia.id).catch(()=>localMedia.remoteUrl):item.imageUrls?.[0]||item.imageUrl||'');setComplianceReviewed(false);setOptimizeMode('title');setActiveTab('optimize')}
  const openOriginalProduct=(item:EbayListing)=>{if(!activeStore||!item.viewUrl)return;pendingOriginalProduct.current=item;setBusy(`open:${item.id}`);setEbayError('');setActiveTab('browser')}
  const downloadLocalProduct=async(item:EbayListing)=>{
    if(!activeStore)return
    setBusy(`download:${item.id}`)
    setNotice('')
    setEbayError('')
    setDownloadToast({kind:'progress',message:`正在下载“${item.title}”，系统会读取原商品资料并保存图片，请稍候…`})
    try {
      const product=await window.desktop.ebay.downloadLocalProduct(activeStore.id,item.listingId)
      setLocalProducts(current=>[product,...current.filter(entry=>entry.id!==product.id)])
      setListings(await window.desktop.ebay.listings(activeStore.id))
      const downloaded=product.snapshot.media.filter(media=>media.downloadStatus==='DOWNLOADED').length
      const failed=product.snapshot.media.filter(media=>media.downloadStatus==='FAILED').length
      const missing=product.snapshot.missingFields
      const partial=failed>0||missing.length>0||product.status==='INCOMPLETE'
      const detail=`已保存本地快照 V${product.versionCount}，成功下载 ${downloaded} 张图片${failed?`，失败 ${failed} 张`:''}，完整度 ${product.snapshot.completeness}%${missing.length?`；仍缺少：${missing.join('、')}`:''}。`
      setDownloadToast({kind:partial?'warning':'success',message:partial?`下载部分完成：${detail} 可稍后重试更新本地版本。`:`下载成功：${detail}`})
    } catch(reason) {
      const message=readableError(reason,'下载本地产品失败')
      setEbayError(message)
      setDownloadToast({kind:'error',message:`下载失败：${message}`})
    } finally {
      if(activeTab!=='browser')void window.desktop.browser.hide()
      setBusy('')
    }
  }
  const openLocalEditor=async(product:EbayLocalProduct)=>{
    setEbayError('')
    let current=product
    const expectedCurrency=ebayCurrencyForMarketplace(product.marketplaceId)
    const savedCurrency=(product.snapshot.details.currency||product.snapshot.sourceListing.currency).trim().toUpperCase()
    const savedDescription=product.snapshot.details.descriptionText||product.snapshot.details.descriptionHtml||''
    const invalidDescription=!savedDescription.trim()||/item specifics\s*condition|brand\s*unbranded[\s\S]*upc\s*does not apply|shipping, returns, and payments/i.test(savedDescription.replace(/<[^>]+>/g,' '))
    if(savedCurrency!==expectedCurrency||invalidDescription) {
      const productStore=stores.find(store=>store.id===product.storeId)
      if(!productStore) {
        setEbayError('本地产品所属的 eBay 店铺不存在，无法恢复原刊登价格和真实描述')
        return
      }
      setBusy(`local-detail:${product.id}`)
      try {
        current=await window.desktop.ebay.downloadLocalProduct(productStore.id,product.listingId)
        setLocalProducts(items=>[current,...items.filter(item=>item.id!==current.id)])
        if(activeStore?.id===productStore.id)setListings(await window.desktop.ebay.listings(productStore.id))
        const restoredPrice=current.snapshot.details.price||current.snapshot.sourceListing.price
        setNotice(`已从 Seller Hub 修改页重新下载真实描述，并恢复原刊登价格：${expectedCurrency} ${restoredPrice}`)
      } catch(reason) {
        setEbayError(readableError(reason,`无法从 Seller Hub 读取 ${expectedCurrency} 原刊登价格和真实描述`))
        return
      } finally {
        setBusy('')
      }
    }
    setLocalEditorProductId(current.id)
    setLocalEditorDraft(ebayLocalProductDraft(current))
  }
  const saveLocalEditor=async()=>{if(!localEditorProductId||!localEditorDraft)return;setBusy(`local-save:${localEditorProductId}`);setEbayError('');try{const product=await window.desktop.ebay.updateLocalProduct(localEditorProductId,localEditorDraft);setLocalProducts(current=>[product,...current.filter(item=>item.id!==product.id)]);setLocalEditorDraft(ebayLocalProductDraft(product));if(selectedLocalProductId===product.id)setSelectedLocalProductId(product.id);setNotice(`四项核心资料已保存为本地 V${product.versionCount}，完整度 ${product.snapshot.completeness}%。线上刊登未修改。`)}catch(reason){setEbayError(readableError(reason,'保存本地产品资料失败'))}finally{setBusy('')}}
  const prepareLocalEditorInSellerHub=async()=>{if(!localEditorProductId||!localEditorDraft)return;const productId=localEditorProductId;setBusy(`local-prepare:${productId}`);setEbayError('');try{const product=await window.desktop.ebay.updateLocalProduct(productId,localEditorDraft);setLocalProducts(current=>[product,...current.filter(item=>item.id!==product.id)]);setLocalEditorDraft(ebayLocalProductDraft(product));const result=await window.desktop.ebay.prepareLocalProductRevision(product.id);setLocalEditorProductId('');setLocalEditorDraft(null);setActiveTab('browser');const warning=result.skippedFields.length?`；${result.skippedFields.length} 项需人工处理`:' ';setNotice(`本地 V${product.versionCount} 已保存，并在 Seller Hub 准备标题、描述和价格共 ${result.filledFields.length} 项${warning}。图片仍由您在页面人工核对，系统没有提交。`)}catch(reason){setEbayError(readableError(reason,'本地版本已保留，但准备 eBay 修改页面失败'))}finally{setBusy('')}}
  const uploadLocalEditorMedia=async(files:File[])=>{if(!localEditorProductId||!localEditorDraft||!files.length)return;const remaining=Math.max(0,24-localEditorDraft.media.length);const selected=files.slice(0,remaining);if(!selected.length){setEbayError('eBay 商品图片最多保留 24 张');return}setBusy(`local-media:${localEditorProductId}`);setEbayError('');try{const uploaded:EbayLocalProductUpdateInput['media']=[];for(const file of selected){const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||'').split(',')[1]||'');reader.onerror=()=>reject(reader.error||new Error('读取图片失败'));reader.readAsDataURL(file)});uploaded.push(await window.desktop.ebay.addLocalProductMedia(localEditorProductId,{fileName:file.name,mimeType:file.type||'image/jpeg',base64}))}setLocalEditorDraft(current=>current?({...current,media:[...current.media,...uploaded].slice(0,24).map((media,sortOrder)=>({...media,sortOrder}))}):current);setNotice(`已添加 ${uploaded.length} 张图片，保存新版本后写入本地产品。`)}catch(reason){setEbayError(readableError(reason,'添加本地商品图片失败'))}finally{setBusy('')}}
  const removeLocalProduct=async(product:EbayLocalProduct)=>{const confirmed=window.confirm(`确定删除这个本地产品及全部历史快照和本地图片吗？\n\n${product.title}\n\n此操作不会修改 eBay 在线刊登。`);if(!confirmed)return;setBusy(`remove-local:${product.id}`);setEbayError('');try{await window.desktop.ebay.removeLocalProduct(product.id);setLocalProducts(current=>current.filter(item=>item.id!==product.id));if(selectedLocalProductId===product.id){setSelectedLocalProductId('');setSelectedListingId('')}setNotice('本地产品、历史快照和本地图片已删除；eBay 在线刊登未修改。')}catch(reason){setEbayError(readableError(reason,'删除本地产品失败'))}finally{setBusy('')}}
  const removeLocalListing=async(item:EbayListing)=>{if(!activeStore)return;const confirmed=window.confirm(`确定从本地“线上产品”库彻底删除这个商品吗？\n\n${item.title}\n\n数据库记录会被物理删除，但不会结束或删除 eBay 平台上的在线刊登。之后再次采集时会作为新商品收录。`);if(!confirmed)return;setBusy(`remove:${item.id}`);setEbayError('');try{await window.desktop.ebay.removeLocalListing(activeStore.id,item.listingId);setListings(current=>current.filter(entry=>entry.id!==item.id));if(selectedListingId===item.id)setSelectedListingId('');await refreshStores();setNotice('商品已从本地数据库物理删除；eBay 在线刊登未被修改，再次采集时可作为新商品收录。')}catch(reason){setEbayError(readableError(reason,'删除线上产品失败'))}finally{setBusy('')}}
  const syncListingDetails=async(item=selectedListing)=>{if(!activeStore||!item)return null;setBusy(`details:${item.id}`);setEbayError('');try{const product=await window.desktop.ebay.downloadLocalProduct(activeStore.id,item.listingId);setLocalProducts(current=>[product,...current.filter(entry=>entry.id!==product.id)]);setSelectedLocalProductId(product.id);const updated=product.snapshot.sourceListing;setListings(current=>current.map(entry=>entry.id===updated.id?updated:entry));const synced=(updated.itemSpecifics||[]).map(specific=>({name:specific.name,value:specific.value,priority:'RECOMMENDED' as const,confidence:'HIGH' as const,needsConfirmation:false,source:'eBay 本地快照已保存'}));setTitleResult(current=>current?{...current,itemSpecifics:synced}:current);setSelectedSourceImageUrl(current=>(updated.imageUrls||[]).includes(current)?current:(updated.imageUrls?.[0]||updated.imageUrl||''));setImageGroundingPlan(null);setImageCandidateReviews({});setImageGenerationRun({phase:'IDLE',message:'',completed:0,total:0});setImageResults({});setSelectedGeneratedImages({});setAcceptedGeneratedImages({});setNaturalizeResults({});setNaturalizeChoices({});setFinalImageInspection(null);setNotice(`本地快照已更新至 V${product.versionCount}：${product.snapshot.media.filter(media=>media.downloadStatus==='DOWNLOADED').length} 张本地图片、${synced.length} 个 Item specifics，完整度 ${product.snapshot.completeness}%。`);return updated}catch(reason){setEbayError(readableError(reason,'更新本地产品快照失败'));return null}finally{if(activeTab!=='browser')void window.desktop.browser.hide();setBusy('')}}
  useEffect(()=>{
    if(activeTab!=='optimize'||optimizeMode!=='image'||!selectedListing||selectedSourceImages.length>1)return
    const key=`${selectedListing.id}:${selectedListing.updatedAt}`
    if(ebayImageSyncAttempted.current.has(key))return
    ebayImageSyncAttempted.current.add(key)
    void syncListingDetails(selectedListing)
  },[activeTab,optimizeMode,selectedListing?.id,selectedListing?.updatedAt])
  const updateResearchQuery=(value:string)=>{if(!selectedListing||!activeStore)return;setResearchQuery(value);saveEbayResearchQueryPreference(activeStore.id,selectedListing.listingId,{query:value.replace(/\s+/g,' ').trim().slice(0,120),source:'MANUAL',locked:false})}
  const runMarketResearch=async()=>{if(!selectedListing||!activeStore)return;if(!researchQuery.trim()){setEbayError('请输入能代表该商品的核心商品词');return}setBusy('market-research');setEbayError('');try{const snapshot=await window.desktop.ebay.runMarketResearch({storeId:activeStore.id,listingId:selectedListing.listingId,query:researchQuery.trim(),periodDays:researchPeriod});setMarketResearch(snapshot);setMarketResearchHistory(current=>[snapshot,...current.filter(item=>item.id!==snapshot.id)].slice(0,30));setResearchQuery(snapshot.query);setResearchPeriod(snapshot.periodDays===30||snapshot.periodDays===365?snapshot.periodDays:90);setTitleResult(null);setSelectedTitle('');setTitleDecision(null);const source=snapshot.source==='EBAY_PRODUCT_RESEARCH'?'eBay Product Research':'eBay Sold & Completed';setNotice(`已成交市场检索完成：通过 ${source} 读取 ${snapshot.sampleCount} 个真实结果。已保留最新结论与建议关键词，请核对后生成六套标题方案。`)}catch(reason){setEbayError(readableError(reason,'eBay 已成交市场检索失败'))}finally{setBusy('')}}
  const decideMarketTerm=async(kind:'KEYWORD'|'COMBINATION',term:string,status:'CONFIRMED'|'REVIEW'|'EXCLUDED')=>{if(!selectedListing||!activeStore)return;const key=`market-decision:${kind}:${term}`;setBusy(key);setEbayError('');try{const snapshot=await window.desktop.ebay.decideMarketResearch({storeId:activeStore.id,listingId:selectedListing.listingId,kind,term,status});setMarketResearch(snapshot);setTitleResult(null);setSelectedTitle('');setTitleDecision(null);setNotice(status==='CONFIRMED'?`已确认“${term}”与当前商品事实一致。`:status==='EXCLUDED'?`已排除“${term}”，生成标题时不会使用。`:`“${term}”已恢复为待核对。`)}catch(reason){setEbayError(readableError(reason,'市场词决策保存失败'))}finally{setBusy('')}}
  const optimizeTitle=async()=>{if(!selectedListing)return;if(!selectedOriginalTitleVerified){setEbayError('当前商品尚未取得 eBay 可验证原标题，请返回“店铺采集”，在店铺商品列表页重新采集。');return}if(!marketResearchCurrent||!marketResearch){setEbayError('市场调研条件已变化，请按当前关键词、时间、类目和 Condition 重新获取数据。');return}if(!confirmedMarketTerms){setEbayError('请至少确认一个与当前商品事实一致的市场词，再生成标题。');return}setBusy('optimize-title');setEbayError('');try{const result=await window.desktop.ebay.optimizeTitle({listingId:selectedListing.listingId,title:selectedOriginalTitle,categoryName:selectedListing.categoryName,marketplaceId:selectedListing.marketplaceId,sku:selectedListing.sku,itemSpecifics:selectedListing.itemSpecifics||[],condition:selectedListing.condition||'',verifiedDescription:selectedLocalProduct?.snapshot.details.descriptionText||'',marketResearch,marketResearchHistory});setTitleResult(result);setTitleDecision(null);setSelectedTitle(result.variants.find(item=>item.id==='BALANCED')?.title||result.optimizedTitle);setNotice('新版六套标题方案已生成，中文直译正在同步。')}catch(reason){const message=readableError(reason,'AI优化生成失败');setEbayError(/insufficient balance/i.test(message)?'AI服务余额不足，标题、属性和描述生成暂不可用；产品合规检查仍可正常使用。':message)}finally{setBusy('')}}
  const confirmTitleDecision=async()=>{if(!activeStore||!selectedListing||!marketResearch||!titleResult||!selectedTitle||!selectedTitleAudit)return;const variant=titleResult.variants.find(item=>item.title===selectedTitle);if(!variant){setEbayError('请选择本次生成的一个标题方案');return}if(!selectedTitleAudit.passed){setEbayError('当前标题未通过字符、重复词、商品事实或市场词检查，请改选其他方案。');return}setBusy('confirm-title');setEbayError('');try{const decision=await window.desktop.ebay.confirmTitleDecision({storeId:activeStore.id,listingId:selectedListing.listingId,researchSnapshotId:marketResearch.id,originalTitle:selectedOriginalTitle,selectedTitle,selectedVariantId:variant.id,variants:titleResult.variants,verifiedFacts:selectedTitleVerifiedFacts});setTitleDecision(decision);setNotice('标题审核结果和证据快照已保存；不会在当前环节打开或写入 eBay，将在最终发布确认时统一交付。')}catch(reason){setEbayError(readableError(reason,'标题审核保存失败'))}finally{setBusy('')}}
  const buildImageGroundingRequest=()=>selectedListing?{
    title:selectedTitle||selectedOriginalTitle||selectedListing.title,
    description:titleResult?.description||contentResult?.englishDescription||selectedLocalProduct?.snapshot.details.descriptionText||selectedLocalProduct?.snapshot.details.descriptionHtml||'',
    itemSpecifics:(titleResult?.itemSpecifics||selectedListing.itemSpecifics||[]).map(item=>({name:item.name,value:item.value})),
    sourceImages:activeImageSourceImages,
    sourceLabels:activeImageSourceEntries.map(entry=>ebayImageSourceRoleLabels[entry.role])
  }:null
  const clearImageWorkflowForSourceChange=()=>{
    setImageGroundingPlan(null)
    setImageCandidateReviews({})
    setImageGenerationRun({phase:'IDLE',message:'',completed:0,total:0})
    setImageResults({})
    setSelectedGeneratedImages({})
    setAcceptedGeneratedImages({})
    setNaturalizeResults({})
    setNaturalizeChoices({})
    setFinalImageInspection(null)
  }
  const updateImageSourceCuration=(url:string,role:EbayImageSourceRole)=>{
    if(!selectedListing)return
    const normalized=normalizeEbayImageSourceCuration(selectedSourceImages,imageSourceCuration)
    const nextEntry={...normalized[url],role,enabled:role!=='UNUSED'}
    const retainedCount=Object.entries(normalized).filter(([entryUrl,entry])=>entryUrl!==url&&entry.enabled&&entry.role!=='UNUSED').length+(nextEntry.enabled?1:0)
    if(retainedCount>ebayImageSourceMaxReferences){
      setEbayError(`最多保留 ${ebayImageSourceMaxReferences} 张原图作为 AI 参照，请先将其他图片标记为“不使用”。`)
      return
    }
    const next={...normalized,[url]:nextEntry}
    setImageSourceCuration(next)
    saveEbayImageSourceCuration(selectedListing.listingId,next)
    if(!nextEntry.enabled&&selectedSourceImageUrl===url)setSelectedSourceImageUrl('')
    clearImageWorkflowForSourceChange()
    setNotice(`原图治理已保存：${ebayImageSourceRoleLabels[role]}。后续事实分析与生成仅使用已保留的 ${retainedCount} 张原图。`)
  }
  const analyzeImageSources=async()=>{
    const request=buildImageGroundingRequest()
    if(!request?.sourceImages.length){const message='请至少保留 1 张原商品图片作为 AI 参照';setEbayError(message);setImageGenerationRun({phase:'ERROR',message,completed:0,total:imageTotalCount});return null}
    setImageGenerationRun({phase:'GROUNDING',message:`正在分析 ${request.sourceImages.length} 张 eBay 原图，建立商品事实卡…`,completed:0,total:imageTotalCount})
    setBusy('image-grounding');setEbayError('')
    try{
      const plan=await window.desktop.image.ground(request)
      setImageGroundingPlan(plan)
      setImageGenerationRun({phase:'DONE',message:`已完成 ${request.sourceImages.length} 张原图分析，可开始按事实生成。`,completed:0,total:imageTotalCount})
      setNotice(`已完成 ${request.sourceImages.length} 张原图的商品事实分析：${plan.productIdentity}。系统会按图片用途自动选取最相关的多张参照图，并为每张草稿建立独立镜头任务。`)
      return plan
    }catch(reason){const message=readableError(reason,'原图事实分析失败');setEbayError(message);setImageGenerationRun({phase:'ERROR',message:`原图事实分析失败：${message}`,completed:0,total:imageTotalCount});return null}finally{setBusy('')}
  }
  const optimizeImage=async()=>{
    if(!selectedListing){const message='未选择线上产品，无法开始图片优化';setEbayError(message);setImageGenerationRun({phase:'ERROR',message,completed:0,total:imageTotalCount});return}
    if(imageModel!==ebayFixedImageModelId){const message='万相 2.7 Pro 未就绪，请检查百炼生图模型配置后再生成。';setEbayError(message);setImageGenerationRun({phase:'ERROR',message,completed:0,total:imageTotalCount});return}
    if(!activeImageSourceImages.length){const message='请至少保留 1 张原商品图片作为 AI 参照';setEbayError(message);setImageGenerationRun({phase:'ERROR',message,completed:0,total:imageTotalCount});return}
    const instructions:Record<EbayImagePurpose,string>={
      HERO:'Create a compliant eBay hero image on a pure white background. Center the complete product with realistic studio light and no decorative props.',
      DETAIL:'Create a close-up eBay detail image that clearly shows only verified construction, material and craftsmanship. Use a clean neutral background.',
      PAIN_POINT:'Create a product-led explanatory image that visibly addresses one verified customer pain point and its verified solution. Keep the product dominant, realistic and fully recognizable. Do not use comparison claims, before-and-after framing, labels or added text.',
      SCENE:'Create a realistic eBay lifestyle image showing the verified product in a plausible use scenario. Keep the product dominant and fully recognizable.'
    }
    const specifics=(titleResult?.itemSpecifics||selectedListing.itemSpecifics||[]).slice(0,12).map(item=>`${item.name}: ${item.value}`)
    const facts=(contentResult?.sourceFacts||[]).slice(0,12).map(item=>item.text)
    const scaleFacts=[...specifics,...facts].filter(item=>/\d\s*(?:in(?:ch(?:es)?)?|cm|mm|ft|feet)\b|\b\d+\s*[x×]\s*\d+/i.test(item)).slice(0,6)
    const benefits=(contentResult?.benefits||[]).slice(0,4).map(item=>`${item.painPoint} -> ${item.solution} -> ${item.customerBenefit}`)
    const scenarios=(contentResult?.scenarios||[]).slice(0,4).map(item=>`${item.title}: ${item.description}`)
    const visualProblems=(imageVisualReport?.images||[]).flatMap(image=>image.rules.filter(rule=>rule.status!=='PASSED').map(rule=>`${rule.label}: ${rule.evidence}`)).slice(0,8)
    const evidence=[
      `Product title: ${selectedTitle||selectedOriginalTitle||selectedListing.title}`,
      `Category: ${selectedListing.categoryName}`,
      selectedListing.condition?`Condition: ${selectedListing.condition}`:'',
      specifics.length?`Verified item specifics: ${specifics.join('; ')}`:'',
      facts.length?`Verified source facts: ${facts.join('; ')}`:'',
      scaleFacts.length?`Verified dimensions and scale: ${scaleFacts.join('; ')}`:'No verified dimensions available. Do not imply an exact size or scale.',
      benefits.length?`Verified selling points: ${benefits.join('; ')}`:'',
      scenarios.length?`Verified use scenarios: ${scenarios.join('; ')}`:'',
      visualProblems.length?`Initial image-check issues to avoid: ${visualProblems.join('; ')}`:'',
      imageExtraPrompt.trim()?`Seller supplement: ${imageExtraPrompt.trim()}`:''
    ].filter(Boolean).join('\n')
    const grounding=imageGroundingPlan
    if(!grounding){
      const message='请先建立全图事实卡，再开始按强制分镜生成。'
      setEbayError(message)
      setImageGenerationRun({phase:'ERROR',message,completed:0,total:imageTotalCount})
      setNotice('请先建立全图事实卡。原图标签、保留状态或原图内容变更后，旧事实卡和图片草稿会自动失效。')
      return
    }
    const shots=ebayImageShotPlan(imageTotalCount,contentResult)
    const batch:Partial<Record<EbayImagePurpose,ImageGenerationResult>>={}
    const reviewsByPurpose:Partial<Record<EbayImagePurpose,EbayImageCandidateReview[]>>={}
    let generatedTotal=0
    const failedShots:string[]=[]
    setImageGenerationRun({phase:'GENERATING',message:`已建立商品事实卡，正在准备生成 ${imageTotalCount} 张图片…`,completed:0,total:imageTotalCount})
    setBusy('optimize-image');setEbayError('');setImageResults({});setImageCandidateReviews({});setSelectedGeneratedImages({});setAcceptedGeneratedImages({});setNaturalizeResults({});setNaturalizeChoices({});setFinalImageInspection(null)
    try{
      for(const shot of shots){
        try{
        const purpose=shot.purpose
        const referenceIndices=imageShotReferenceIndices(shot,grounding)
        const referenceImageUrls=referenceIndices.map(index=>activeImageSourceImages[index]).filter(Boolean)
        if(!referenceImageUrls.length)throw new Error(`${ebayImagePurposeLabels[purpose]}缺少可用原图参照`)
        const referenceLabels=referenceIndices.map(index=>{const entry=activeImageSourceEntries[index];return `original image ${(entry?.originalIndex??index)+1} (${entry?ebayImageSourceRoleLabels[entry.role]:'未标注'})`}).join(', ')
        const ev=shotEdits[shot.code]?shot.purpose==='PAIN_POINT'?'已核实痛点：'+(shotEdits[shot.code].painPoint??contentResult?.benefits?.[shot.index%contentResult.benefits.length]?.painPoint??'')+'；对应方案：'+(shotEdits[shot.code].solution??contentResult?.benefits?.[shot.index%contentResult.benefits.length]?.solution??'')+'；购买利益：'+(shotEdits[shot.code].customerBenefit??contentResult?.benefits?.[shot.index%contentResult.benefits.length]?.customerBenefit??'')+'。':shot.purpose==='SCENE'?'已核实应用场景：'+(shotEdits[shot.code].title??contentResult?.scenarios?.[shot.index%contentResult.scenarios.length]?.title??'')+'；'+(shotEdits[shot.code].description??contentResult?.scenarios?.[shot.index%contentResult.scenarios.length]?.description??'')+'。':shot.evidence:shot.evidence;const storyboardCard=`MANDATORY STORYBOARD CARD ${shot.code}\nRole: ${ebayImagePurposeLabels[purpose]} · ${shot.title}\nReference images: ${referenceLabels}\nContent evidence: ${ev}\nRequired shot: ${shot.instruction}\nAcceptance criteria: ${shot.acceptance}\nProhibited: ${shot.prohibited}\nReal-scale requirement: ${scaleFacts.length?`Use only these verified measurements or source proportions: ${scaleFacts.join('; ')}`:'No exact size is verified. Keep the product physically plausible against furniture, rooms and people; do not enlarge or shrink it for effect.'}\nThis card is mandatory. If any requirement conflicts with the references, preserve the reference facts and return no substitute product.`
        setImageGenerationRun({phase:'GENERATING',message:`正在生成${ebayImagePurposeLabels[purpose]} ${shot.index+1}/${shot.total}：独立镜头与多图参照…`,completed:generatedTotal,total:imageTotalCount})
        const result=await window.desktop.image.generate({model:imageModel,referenceImageUrls,promptExtend:false,size:purpose==='HERO'||purpose==='DETAIL'?'2K':'1K',count:1,prompt:`${instructions[purpose]}\n${storyboardCard}\nProduct identity confirmed from all original images: ${grounding.productIdentity}\nProtected attributes: ${grounding.protectedAttributes.join('; ')}\nVerified visual facts: ${grounding.verifiedFacts.join('; ')}\nPurpose-specific instruction: ${grounding.purposeInstructions[purpose]}\n${evidence}\nStrict truth constraints: the sellable product must remain the exact same product, not an item displayed in, worn by, stored in or used with it. Preserve exact product identity, structure, proportions, color, material, visible parts and included accessories from the reference images. Do not invent functions, parts, claims or packaging. No added text, measurement labels, logo, watermark, border or promotional badge. For pain-point and scene shots, demonstrate only the specific content evidence on this card. Keep the product at a physically plausible scale relative to its environment. This shot must be visually distinct from other ${ebayImagePurposeLabels[purpose]} shots by changing its camera task or verified feature, never merely the background.`})
        const candidateUrl=result.imageUrls[0]
        if(!candidateUrl)throw new Error(`${ebayImagePurposeLabels[purpose]}未返回可用图片`)
        generatedTotal+=1
        const previousCandidates=(batch[purpose]?.imageUrls||[])
        batch[purpose]={taskId:[batch[purpose]?.taskId,result.taskId].filter(Boolean).join(','),imageUrls:[...previousCandidates,candidateUrl]}
        setImageResults({...batch})
        setImageGenerationRun({phase:'REVIEWING',message:`已生成 ${generatedTotal}/${imageTotalCount} 张，正在复核${ebayImagePurposeLabels[purpose]} ${shot.index+1}/${shot.total}的商品一致性与镜头差异…`,completed:generatedTotal,total:imageTotalCount})
        let review:EbayImageCandidateReview
        try{review=await window.desktop.image.reviewCandidate({title:selectedTitle||selectedOriginalTitle||selectedListing.title,description:titleResult?.description||contentResult?.englishDescription||selectedLocalProduct?.snapshot.details.descriptionText||'',itemSpecifics:(titleResult?.itemSpecifics||selectedListing.itemSpecifics||[]).map(item=>({name:item.name,value:item.value})),purpose,candidateUrl,sourceImages:activeImageSourceImages,referenceIndices,protectedAttributes:grounding.protectedAttributes,verifiedFacts:grounding.verifiedFacts,shotInstruction:storyboardCard,comparisonCandidateUrls:previousCandidates})}
        catch{review={candidateUrl,purpose,status:'REVIEW',identityScore:0,structuralScore:0,factScore:0,purposeScore:0,diversityScore:0,reason:'一致性与镜头差异检查未完成，需人工确认。',referenceIndices}}
        const reviews=[...(reviewsByPurpose[purpose]||[]),review]
        reviewsByPurpose[purpose]=reviews
        setImageCandidateReviews({...reviewsByPurpose})
        }catch(reason){
          const message=readableError(reason,`${shot.code} 生成失败`)
          failedShots.push(`${shot.code}：${message}`)
          setImageGenerationRun({phase:'GENERATING',message:`${shot.code} 生成失败，继续生成下一张…`,completed:generatedTotal,total:imageTotalCount})
        }
      }
      for(const purpose of ebayImagePurposes){
        const reviews=reviewsByPurpose[purpose]||[]
        const selectable=reviews.find(review=>review.status==='PASSED')
        setSelectedGeneratedImages(current=>({...current,[purpose]:selectable?.candidateUrl||''}))
      }
      setImageModelUsage(current=>{const next={...current,[imageModel]:(current[imageModel]||0)+generatedTotal};saveEbayImageUsage(next);return next})
      const rejected=Object.values(reviewsByPurpose).flatMap(reviews=>reviews||[]).filter(review=>review.status!=='PASSED').length
      const summary=`已生成 ${generatedTotal}/${shots.length} 张草稿，${failedShots.length?`${failedShots.length} 张生成失败；`:''}并完成已返回草稿的一致性复核。`
      setImageGenerationRun({phase:failedShots.length?'ERROR':'DONE',message:failedShots.length?`${summary} ${failedShots.join('；')}`:summary,completed:generatedTotal,total:imageTotalCount})
      if(failedShots.length)setEbayError(`部分图片未生成：${failedShots.join('；')}`)
      setNotice(`已按全图事实卡生成 ${generatedTotal}/${shots.length} 张草稿；${rejected?`${rejected} 张未通过自动质量门槛，已拦截，`:'全部草稿均通过自动质量门槛，'}仅通过草稿可确认采用并进入自然化与最终复检。原商品图片未被覆盖。`)
    }catch(reason){const message=readableError(reason,'AI图片优化失败');setEbayError(message);setImageGenerationRun({phase:'ERROR',message:`图片生成失败：${message}`,completed:generatedTotal,total:imageTotalCount})}finally{setBusy('')}
  }
  /* const runImageModelAbTest=async()=>{
    if(!selectedListing){setEbayError('未选择线上产品，无法执行模型 A/B 测试');return}
    if(!imageModel||!imageAbChallenger||imageModel===imageAbChallenger){setEbayError('请选择两个不同的可用生图模型');return}
    if(!activeImageSourceImages.length){setEbayError('请至少保留 1 张原商品图片作为 AI 参照');return}
    setBusy('image-model-ab');setEbayError('')
    const grounding=imageGroundingPlan||await analyzeImageSources()
    if(!grounding){setBusy('');return}
    const shot=ebayImageShotPlan(4,contentResult).find(item=>item.purpose==='HERO')
    if(!shot){setBusy('');setEbayError('无法建立主图 A/B 分镜');return}
    const sourceReferenceIndex=(grounding.purposeReferences.HERO||[]).find(index=>Boolean(activeImageSourceImages[index]))??activeImageSourceImages.indexOf(selectedSourceImage)
    const referenceIndex=sourceReferenceIndex>=0?sourceReferenceIndex:0
    const referenceImageUrl=activeImageSourceImages[referenceIndex]
    if(!referenceImageUrl){setBusy('');setEbayError('主图 A/B 测试缺少可用原图参照');return}
    const specifics=(titleResult?.itemSpecifics||selectedListing.itemSpecifics||[]).slice(0,12).map(item=>`${item.name}: ${item.value}`)
    const facts=(contentResult?.sourceFacts||[]).slice(0,12).map(item=>item.text)
    const scaleFacts=[...specifics,...facts].filter(item=>/\d\s*(?:in(?:ch(?:es)?)?|cm|mm|ft|feet)\b|\b\d+\s*[x×]\s*\d+/i.test(item)).slice(0,6)
    const benefits=(contentResult?.benefits||[]).slice(0,4).map(item=>`${item.painPoint} -> ${item.solution} -> ${item.customerBenefit}`)
    const scenarios=(contentResult?.scenarios||[]).slice(0,4).map(item=>`${item.title}: ${item.description}`)
    const evidence=[
      `Product title: ${selectedTitle||selectedOriginalTitle||selectedListing.title}`,
      `Category: ${selectedListing.categoryName}`,
      selectedListing.condition?`Condition: ${selectedListing.condition}`:'',
      specifics.length?`Verified item specifics: ${specifics.join('; ')}`:'',
      facts.length?`Verified source facts: ${facts.join('; ')}`:'',
      scaleFacts.length?`Verified dimensions and scale: ${scaleFacts.join('; ')}`:'No verified dimensions available. Do not imply an exact size or scale.',
      benefits.length?`Verified selling points: ${benefits.join('; ')}`:'',
      scenarios.length?`Verified use scenarios: ${scenarios.join('; ')}`:'',
      imageExtraPrompt.trim()?`Seller supplement: ${imageExtraPrompt.trim()}`:''
    ].filter(Boolean).join('\n')
    const sourceEntry=activeImageSourceEntries[referenceIndex]
    const storyboardCard=`MANDATORY STORYBOARD CARD ${shot.code}\nRole: ${ebayImagePurposeLabels.HERO} · ${shot.title}\nReference image: original image ${(sourceEntry?.originalIndex??referenceIndex)+1} (${sourceEntry?ebayImageSourceRoleLabels[sourceEntry.role]:'未标注'})\nContent evidence: ${shot.evidence}\nRequired shot: ${shot.instruction}\nAcceptance criteria: ${shot.acceptance}\nProhibited: ${shot.prohibited}\nReal-scale requirement: ${scaleFacts.length?`Use only these verified measurements or source proportions: ${scaleFacts.join('; ')}`:'No exact size is verified. Do not imply an exact size or scale.'}\nThis card is mandatory. Preserve the reference facts and return no substitute product.`
    const prompt=`Create a compliant eBay hero image on a pure white background. Center the complete product with realistic studio light and no decorative props.\n${storyboardCard}\nProduct identity confirmed from all original images: ${grounding.productIdentity}\nProtected attributes: ${grounding.protectedAttributes.join('; ')}\nVerified visual facts: ${grounding.verifiedFacts.join('; ')}\nPurpose-specific instruction: ${grounding.purposeInstructions.HERO}\n${evidence}\nStrict truth constraints: the sellable product must remain the exact same product. Preserve exact product identity, structure, proportions, color, material, visible parts and included accessories from the reference image. Do not invent functions, parts, claims or packaging. No added text, measurement labels, logo, watermark, border or promotional badge.`
    const startedAt=new Date().toISOString()
    setImageAbRun({id:`image-ab-${Date.now()}`,productId:selectedListing.listingId,createdAt:startedAt,baselineModelId:imageModel,challengerModelId:imageAbChallenger,shot,candidates:[],reason:'正在用相同的事实卡、主图分镜和原图参照分别生成…'})
    const candidates:EbayImageModelAbCandidate[]=[]
    try{
      for(const modelId of [imageModel,imageAbChallenger]){
        const began=performance.now()
        try{
          const result=await window.desktop.image.generate({model:modelId,referenceImageUrls:[referenceImageUrl],size:'2K',count:1,prompt})
          const imageUrl=result.imageUrls[0]
          if(!imageUrl)throw new Error('模型未返回可用图片')
          const review=await window.desktop.image.reviewCandidate({title:selectedTitle||selectedOriginalTitle||selectedListing.title,description:titleResult?.description||contentResult?.englishDescription||selectedLocalProduct?.snapshot.details.descriptionText||'',itemSpecifics:(titleResult?.itemSpecifics||selectedListing.itemSpecifics||[]).map(item=>({name:item.name,value:item.value})),purpose:'HERO',candidateUrl:imageUrl,sourceImages:activeImageSourceImages,referenceIndices:[referenceIndex],protectedAttributes:grounding.protectedAttributes,verifiedFacts:grounding.verifiedFacts,shotInstruction:storyboardCard,comparisonCandidateUrls:[]})
          candidates.push({modelId,imageUrl,review,elapsedMs:Math.round(performance.now()-began)})
        }catch(reason){candidates.push({modelId,elapsedMs:Math.round(performance.now()-began),error:readableError(reason,'生成或质量审核失败')})}
        setImageAbRun(current=>current?{...current,candidates:[...candidates]}:current)
      }
      const passed=candidates.filter(candidate=>candidate.review?.status==='PASSED')
      let winner:EbayImageModelAbCandidate|undefined
      let reason='两个模型均未通过自动质量门槛，默认模型保持不变。'
      if(passed.length===1){winner=passed[0];reason=`只有 ${imageModels.find(model=>model.id===winner!.modelId)?.name||winner.modelId} 通过商品一致性、结构、事实和分镜质量门槛。`}
      if(passed.length>1){
        const ranked=[...passed].sort((left,right)=>ebayImageModelQualityScore(right.review!)-ebayImageModelQualityScore(left.review!))
        const [first,second]=ranked
        const scoreGap=ebayImageModelQualityScore(first.review!)-ebayImageModelQualityScore(second.review!)
        const chosen=scoreGap>.5?first:(first.elapsedMs<=second.elapsedMs?first:second)
        winner=chosen
        const winnerName=imageModels.find(model=>model.id===chosen.modelId)?.name||chosen.modelId
        const runner=chosen===first?second:first
        const runnerName=imageModels.find(model=>model.id===runner.modelId)?.name||runner.modelId
        reason=scoreGap>.5?`${winnerName} 质量综合分 ${ebayImageModelQualityScore(chosen.review!).toFixed(1)}，高于 ${runnerName} 的 ${ebayImageModelQualityScore(runner.review!).toFixed(1)}。`:`两者质量分接近（差 ${scoreGap.toFixed(1)}），按较短生成耗时选择 ${winnerName}。`
      }
      const run:EbayImageModelAbRun={id:`image-ab-${Date.now()}`,productId:selectedListing.listingId,createdAt:startedAt,baselineModelId:imageModel,challengerModelId:imageAbChallenger,shot,candidates,winnerModelId:winner?.modelId,reason}
      setImageAbRun(run)
      setImageAbHistory(current=>{const next=[run,...current].slice(0,12);saveEbayImageModelAbHistory(next);return next})
      const successful=candidates.filter(candidate=>Boolean(candidate.imageUrl))
      if(successful.length)setImageModelUsage(current=>{const next={...current};for(const candidate of successful)next[candidate.modelId]=(next[candidate.modelId]||0)+1;saveEbayImageUsage(next);return next})
      if(winner){saveEbayImageDefaultModel(winner.modelId);setImageDefaultModel(winner.modelId);setImageModel(winner.modelId);setNotice(`模型 A/B 测试完成：${imageModels.find(model=>model.id===winner!.modelId)?.name||winner.modelId} 已设为默认生图模型。${reason}`)}else setNotice(`模型 A/B 测试完成：${reason}`)
    }catch(reason){
      const message=readableError(reason,'模型 A/B 测试失败')
      setEbayError(message)
      setImageAbRun(current=>current?{...current,reason:`模型 A/B 测试失败：${message}`} : current)
    }finally{setBusy('')}
  } */
  const acceptGeneratedImage=(purpose:EbayImagePurpose)=>{
    const imageUrl=selectedGeneratedImages[purpose]
    if(!imageUrl)return
    const review=imageCandidateReviews[purpose]?.find(item=>item.candidateUrl===imageUrl)
    if(review?.status!=='PASSED'){setEbayError('该草稿未通过自动质量门槛，或自动审核未完成，不能确认采用。请改选已通过草稿或重新生成。');return}
    setAcceptedGeneratedImages(current=>({...current,[purpose]:imageUrl}))
    setNaturalizeResults(current=>{const next={...current};delete next[purpose];return next})
    setNaturalizeChoices(current=>{const next={...current};delete next[purpose];return next})
    setNaturalizePurpose(purpose)
    setNotice(`已确认${ebayImagePurposeLabels[purpose]}草稿。该图片只进入本地优化方案，尚未替换 eBay 线上图片。`)
  }
  const runImageNaturalization=async()=>{
    if(!selectedListing)return
    const imageUrl=acceptedGeneratedImages[naturalizePurpose]
    const review=imageUrl?imageCandidateReviews[naturalizePurpose]?.find(item=>item.candidateUrl===imageUrl):undefined
    if(!imageUrl||review?.status!=='PASSED'){setEbayError('请先确认一张已通过自动质量门槛的 AI 优化图，再进行自然化处理。');return}
    const key=`naturalize-image:${naturalizePurpose}`
    setBusy(key);setEbayError('')
    try{
      const result=await window.desktop.image.realshift({imageUrl,productId:`ebay-${selectedListing.listingId}-${naturalizePurpose.toLowerCase()}`,profile:naturalizeProfile})
      setNaturalizeResults(current=>({...current,[naturalizePurpose]:result}))
      setNaturalizeChoices(current=>{const next={...current};delete next[naturalizePurpose];return next})
      setNotice('本地自然化处理已完成，请对照商品结构、颜色和细节后选择最终版本。')
    }catch(reason){setEbayError(readableError(reason,'图片自然化处理失败'))}finally{setBusy('')}
  }
  const confirmNaturalizedImage=async(choice:'original'|'processed')=>{
    const result=naturalizeResults[naturalizePurpose]
    if(!result)return
    const key=`naturalize-confirm:${naturalizePurpose}`
    setBusy(key);setEbayError('')
    try{
      await window.desktop.image.selectRealshift(result.reportPath,choice)
      setNaturalizeChoices(current=>({...current,[naturalizePurpose]:choice}))
      setNotice(choice==='processed'?'已确认采用自然化版本；最终图将自动重新执行平台规则检查。':'已确认保留第二阶段原稿；选择原因已在本地报告中留痕。')
    }catch(reason){setEbayError(readableError(reason,'保存最终图片选择失败'))}finally{setBusy('')}
  }
  const persistContentOptimization=async(result:EbayContentOptimizationResult)=>{
    if(!activeStore||!selectedListing||!selectedTitle)throw new Error('当前商品或标题尚未准备完成')
    const saved=await window.desktop.ebay.saveContentOptimization({storeId:activeStore.id,listingId:selectedListing.listingId,selectedTitle,result})
    setContentResult(saved.result)
    setContentResultTitle(saved.selectedTitle)
    setTitleResult(current=>current?{...current,description:saved.result.englishDescription}:current)
    return saved.result
  }
  const optimizeContent=async()=>{if(!selectedListing||!activeStore||!selectedTitle||!titleDecisionCurrent){setEbayError('请先在标题与关键词阶段选择方案并完成第四阶段审核确认');setOptimizeMode('title');return}setBusy('optimize-content');setEbayError('');try{const result=await window.desktop.ebay.optimizeContent({listingId:selectedListing.listingId,originalTitle:selectedOriginalTitle||selectedListing.title,selectedTitle,categoryName:selectedListing.categoryName,condition:selectedListing.condition,itemSpecifics:(titleResult?.itemSpecifics||selectedListing.itemSpecifics||[]).map(item=>({name:item.name,value:item.value})),sourceDescription:selectedLocalProduct?.snapshot.details.descriptionText||'',sellerNotes:selectedLocalProduct?.snapshot.details.sellerNotes||''});const saved=await persistContentOptimization(result);setNotice(`详情页已按 ${saved.sourceFacts.length} 条原始事实重新分类排版并自动保存，事实覆盖率 ${saved.validation.factCoverage}%；程序重启后会继续保留。`)}catch(reason){setEbayError(readableError(reason,'AI详情内容生成或保存失败'))}finally{setBusy('')}}
  const syncContentTranslation=async()=>{if(!contentResult||!currentContentTranslation)return;const pending=currentContentTranslation.segments.filter(segment=>segment.status!=='SYNCED');if(!pending.length){setNotice('中英文逐段翻译已经同步，无需重复翻译。');return}setBusy('translate-content');setEbayError('');try{const translated=await window.desktop.ebay.translateContent({segments:pending.map(segment=>({id:segment.id,english:segment.english}))});const updates=new Map(translated.segments.map(segment=>[segment.id,segment]));const segments=currentContentTranslation.segments.map(segment=>updates.get(segment.id)||segment);const translation={...translated,segments};await persistContentOptimization({...contentResult,englishDescription:currentEnglishDescription,translation,chineseReference:segments.map(segment=>segment.chinese).filter(Boolean).join('\n')});if(translated.error)setEbayError(`Qwen-MT Flash 翻译未完成：${translated.error}`);else setNotice(`Qwen-MT Flash 已同步并保存 ${translated.segments.length} 个变化段落，中英文编号、数量和顺序保持一致。`)}catch(reason){setEbayError(readableError(reason,'Qwen-MT Flash 翻译或保存失败'))}finally{setBusy('')}}
  const editFinalEnglishDescription=(description:string)=>{
    setTitleResult(current=>current?{...current,description}:current)
    setContentResult(current=>current?{...current,englishDescription:description}:current)
  }
  const saveFinalEnglishDescription=async(description:string)=>{
    if(!contentResult||!description.trim())return
    setBusy('save-content-edit')
    setEbayError('')
    try{
      await persistContentOptimization({...contentResult,englishDescription:description})
      setNotice('最终英文详情页修改已自动保存。')
    }catch(reason){setEbayError(readableError(reason,'最终英文详情保存失败'))}finally{setBusy('')}
  }
  const plannedImageCounts=ebayImageGenerationPlan(imageTotalCount)
  const plannedImageShots=ebayImageShotPlan(imageTotalCount,contentResult)
  const selectedImageModel=imageModels.find(model=>model.id===imageModel)
  const generatedImageCount=Object.values(imageResults).reduce((total,result)=>total+(result?.imageUrls.length||0),0)
  const confirmedGeneratedImages=ebayImagePurposes.reduce<Partial<Record<EbayImagePurpose,string>>>((current,purpose)=>{
    const imageUrl=acceptedGeneratedImages[purpose]
    const review=imageUrl?imageCandidateReviews[purpose]?.find(item=>item.candidateUrl===imageUrl):undefined
    if(imageUrl&&review?.status==='PASSED')current[purpose]=imageUrl
    return current
  },{})
  const acceptedImagePurposes=ebayImagePurposes.filter(purpose=>confirmedGeneratedImages[purpose])
  const acceptedImageTrace=ebayImagePurposes.map(purpose=>{
    const imageUrl=confirmedGeneratedImages[purpose]
    const result=imageResults[purpose]
    const candidateIndex=imageUrl?(result?.imageUrls.indexOf(imageUrl)??-1):-1
    const review=imageUrl?imageCandidateReviews[purpose]?.find(item=>item.candidateUrl===imageUrl):undefined
    const shot=candidateIndex>=0?plannedImageShots.find(item=>item.purpose===purpose&&item.index===candidateIndex):undefined
          const referenceIndices=review?.referenceIndices?.length
            ?review.referenceIndices
            :(shot?imageShotReferenceIndices(shot):imageGroundingPlan?.purposeReferences[purpose]||[])
    return {purpose,imageUrl,review,shot,referenceIndices,choice:naturalizeChoices[purpose]}
  })
  const allImagePurposesAccepted=acceptedImagePurposes.length===ebayImagePurposes.length
  const imageNaturalizationComplete=Boolean(allImagePurposesAccepted&&acceptedImagePurposes.every(purpose=>naturalizeChoices[purpose]))
  const finalImageForPurpose=(purpose:EbayImagePurpose)=>naturalizeChoices[purpose]==='processed'?naturalizeResults[purpose]?.processedDataUrl:confirmedGeneratedImages[purpose]
  const finalImageUrls=(()=>{
    const images=[...selectedSourceImages]
    if(!images.length&&selectedListing?.imageUrl)images.push(selectedListing.imageUrl)
    const replacements:[EbayImagePurpose,number][]=[['HERO',0],['DETAIL',1],['PAIN_POINT',2],['SCENE',3]]
    for(const [purpose,index] of replacements) {
      const replacement=finalImageForPurpose(purpose)
      if(!replacement)continue
      if(index<images.length)images[index]=replacement
      else images.push(replacement)
    }
    return [...new Set(images.filter(Boolean))]
  })()
  const finalImageFingerprint=finalImageUrls.map(url=>url.startsWith('data:image/')?`${url.slice(0,32)}:${url.length}:${url.slice(-48)}`:url).join('|')
  const optimizedImage=finalImageUrls[0]||selectedSourceImage||selectedListing?.imageUrl||''
  const complianceRequest:ComplianceCheckRequest|null=selectedListing?{productId:selectedListing.id,platform:'EBAY',marketplaceSite:selectedListing.marketplaceId||'EBAY_US',country:ebayCountryForMarketplace(selectedListing.marketplaceId||'EBAY_US'),categoryId:selectedListing.categoryId,categoryName:selectedListing.categoryName,title:selectedTitle||selectedOriginalTitle||selectedListing.title,description:titleResult?.description||selectedLocalProduct?.snapshot.details.descriptionText||selectedLocalProduct?.snapshot.details.descriptionHtml||'',imageUrl:optimizedImage,itemSpecifics:(titleResult?.itemSpecifics||selectedListing.itemSpecifics||[]).map(item=>({name:item.name,value:item.value}))}:null
  const complianceInputFingerprint=complianceRequest?complianceCheckFingerprint(complianceRequest):''
  const complianceIsCurrent=Boolean(complianceCheck&&complianceCheck.inputFingerprint===complianceInputFingerprint&&complianceCheck.gateStatus!=='RECHECK_REQUIRED')
  const reviewImageVisualRule=async(mediaId:string,rule:EbayImageVisualRuleCode,decision:'PASSED'|'FAILED')=>{if(!selectedLocalProduct)return;const note=window.prompt(decision==='PASSED'?'请记录人工确认通过的依据：':'请记录人工确认不通过的问题：','已查看本地原图并核对商品画面');if(note===null)return;setBusy('visual-compliance-review');setEbayError('');try{const report=await window.desktop.ebay.reviewLocalProductImageRule({localProductId:selectedLocalProduct.id,mediaId,rule,decision,reviewedBy:'本机用户',note});setImageVisualReport(report);setNotice('人工复核结论已保存并记录时间、操作人和备注。')}catch(reason){setEbayError(readableError(reason,'保存人工复核结论失败'))}finally{setBusy('')}}
  useEffect(()=>{
    if(activeTab!=='optimize'||!selectedListing||!complianceRequest)return
    let cancelled=false
    setComplianceAutoError('')
    const timer=window.setTimeout(()=>{
      setComplianceAutoRunning(true)
      void window.desktop.compliance.latestCheck(selectedListing.id).then(async latest=>{
        if(cancelled)return
        if(latest&&latest.inputFingerprint===complianceInputFingerprint&&latest.gateStatus!=='RECHECK_REQUIRED'){
          setComplianceCheck(latest);setComplianceReviewed(Boolean(latest.reviewedAt));return
        }
        const result=await window.desktop.compliance.check(complianceRequest)
        if(cancelled)return
        setComplianceCheck(result);setComplianceReviewed(Boolean(result.reviewedAt))
      }).catch(reason=>{if(!cancelled){const message=readableError(reason,'eBay详情页自动检查失败');setComplianceAutoError(message);setEbayError(message)}}).finally(()=>{if(!cancelled)setComplianceAutoRunning(false)})
    },600)
    return()=>{cancelled=true;window.clearTimeout(timer);setComplianceAutoRunning(false)}
  },[activeTab,selectedListing?.id,complianceInputFingerprint])
  useEffect(()=>{
    let cancelled=false
    setFinalImageInspection(null)
    if(!imageNaturalizationComplete||!finalImageUrls.length)return()=>{cancelled=true}
    setFinalImageChecking(true)
    const timer=window.setTimeout(()=>{
      void window.desktop.ebay.inspectFinalImages(finalImageUrls).then(report=>{
        if(!cancelled)setFinalImageInspection(report)
      }).catch(reason=>{
        if(!cancelled)setEbayError(readableError(reason,'最终图片自动检查失败'))
      }).finally(()=>{
        if(!cancelled)setFinalImageChecking(false)
      })
    },400)
    return()=>{cancelled=true;window.clearTimeout(timer);setFinalImageChecking(false)}
  },[imageNaturalizationComplete,finalImageFingerprint])
  const submitComplianceReview=async()=>{if(!complianceCheck||!complianceIsCurrent||complianceCheck.gateStatus!=='REVIEW_REQUIRED')return;const note=window.prompt('请输入本次人工复核结论，该内容将作为发布门禁留痕保存。','已核对商品事实、安全资料与适用规则。');if(note===null)return;setBusy('compliance-review');setEbayError('');try{const result=await window.desktop.compliance.reviewCheck(complianceCheck.id,'本机用户',note);setComplianceCheck(result);setComplianceReviewed(Boolean(result.reviewedAt));setNotice(`人工复核已留痕：${new Date(result.reviewedAt!).toLocaleString('zh-CN')}`)}catch(reason){setEbayError(readableError(reason,'人工复核保存失败'))}finally{setBusy('')}}
  useEffect(()=>{
    let cancelled=false
    setImageVisualReport(null)
    if(!selectedLocalProductId||!selectedLocalProduct)return()=>{cancelled=true}
    const inspectionKey=`${selectedLocalProductId}:${selectedLocalProduct.latestSnapshotId}`
    void window.desktop.ebay.localProductImageVisualReport(selectedLocalProductId).then(async report=>{
      if(cancelled)return
      if(report){setImageVisualReport(report);return}
      if(!selectedLocalProduct.snapshot.media.length||ebayImageInspectionAttempted.current.has(inspectionKey))return
      ebayImageInspectionAttempted.current.add(inspectionKey)
      setBusy('visual-compliance-check')
      try{
        const inspected=await window.desktop.ebay.inspectLocalProductImages(selectedLocalProductId)
        if(!cancelled)setImageVisualReport(inspected)
      }catch(reason){
        if(!cancelled)setEbayError(readableError(reason,'图片自动初步检查失败'))
      }finally{
        if(!cancelled)setBusy('')
      }
    }).catch(reason=>{if(!cancelled)setEbayError(readableError(reason,'读取已保存的图片检查结果失败'))})
    return()=>{cancelled=true}
  },[selectedLocalProductId,selectedLocalProduct?.latestSnapshotId])
  const complianceReport=selectedListing?evaluateEbayCompliance(selectedListing,selectedLocalProduct?.snapshot.media||[],imageVisualReport):null
  const diagnosisIssues=complianceReport?.findings||[]
  const blockingIssues=diagnosisIssues.filter(item=>item.level==='P0')
  const reviewIssues=diagnosisIssues.filter(item=>item.level==='P1')
  const remediationIssues=diagnosisIssues.filter(item=>item.level==='P2')
  const advisoryIssues=diagnosisIssues.filter(item=>item.level==='P3')
  const visualPendingCount=complianceReport?.imageAssessment.visualPendingCount||0
  const visualStatusMessage=!imageVisualReport?`图片数量、尺寸、格式和单文件大小已通过技术检查；${complianceReport?.imageAssessment.visualChecks.join('、')||'画面内容'}待视觉检查，不计入建议优化。`:imageVisualReport.status==='REVIEW'?`技术规则已检查；${imageVisualReport.review} 张图片需要人工复核，逐图证据见上方。`:'当前项目已通过本类 eBay 官方技术与视觉要求。'
  const combinedBlockingIssues=blockingIssues.length
  const combinedReviewIssues=reviewIssues.length
  const combinedRemediationIssues=remediationIssues.length
  const combinedAdvisoryIssues=advisoryIssues.length
  const combinedGateLabel=complianceAutoRunning?'自动检查中':!complianceIsCurrent?'内容变化，待重检':complianceCheck?.gateStatus==='BLOCKED'||combinedBlockingIssues?'必须修改':combinedReviewIssues?'技术资料不完整':combinedRemediationIssues?'建议优化':visualPendingCount?'技术规则通过 · 视觉待检查':'符合 eBay 要求'
  const combinedGateClass=complianceAutoRunning||!complianceIsCurrent?'pending':combinedBlockingIssues?'blocked':combinedReviewIssues?'review_required':combinedRemediationIssues?'remediation_required':visualPendingCount?'visual_pending':'passed'
  const scoreBefore=0 // 仅兼容旧草稿数据结构；产品判断已改用合规门禁，不再计算竞争力分数。
  const scoreAfter=0
  const saveToPremium=async()=>{if(!selectedListing||!activeStore||!titleResult||!selectedTitle||!complianceReport)return;if(!complianceCheck||!complianceIsCurrent){setEbayError('当前内容尚未完成最新合规检查，请等待自动重检完成。');setOptimizeMode('image');return}if(complianceCheck.gateStatus==='BLOCKED'||complianceCheck.gateStatus==='RECHECK_REQUIRED'){setEbayError(`当前合规门禁为 ${complianceCheck.gateStatus}，请整改后重新检查。`);setOptimizeMode('image');return}if(complianceCheck.gateStatus==='REVIEW_REQUIRED'&&!complianceReviewed){setEbayError('合规知识库要求人工复核，完成证据核验后才能继续。');setOptimizeMode('image');return}if(!imageVisualReport){setEbayError('图片自动初步检查尚未完成。');setOptimizeMode('image');return}if(!imageNaturalizationComplete){setEbayError('请先完成图片自然化处理并确认所有最终图片。');setOptimizeMode('image');return}if(!finalImageInspection||finalImageChecking){setEbayError('最终图片图集仍在自动检查，请稍候。');setOptimizeMode('image');return}if(finalImageInspection.blocked||finalImageInspection.review){setEbayError(`最终图集中仍有 ${finalImageInspection.blocked} 张未通过、${finalImageInspection.review} 张需要人工确认；请处理后再保存。`);setOptimizeMode('image');return}if(!optimizedImage){setEbayError('商品缺少有效主图，请先在线上产品补充主图。');setOptimizeMode('image');return}if(selectedTitle.length>80){setEbayError('所选标题超过80字符，请重新选择或生成标题。');setOptimizeMode('title');return}if(!titleResult.description.trim()){setEbayError('结构化商品描述不能为空，请核对后再保存。');setOptimizeMode('content');return}setBusy('save-premium');setEbayError('');try{await window.desktop.ebay.saveOptimizationDraft({storeId:activeStore.id,listingId:selectedListing.listingId,listing:selectedListing,selectedTitle,titleVariants:titleResult.variants,itemSpecifics:titleResult.itemSpecifics,description:titleResult.description,imageUrl:optimizedImage,imageUrls:finalImageUrls,storyboard:contentResult?.storyboard||[],marketDecision:titleResult.marketDecision||marketDecision||undefined,scoreBefore,scoreAfter,complianceCheckId:complianceCheck.id,complianceGateStatus:complianceCheck.gateStatus,complianceRuleSetVersion:complianceCheck.ruleSetVersion,complianceCheckedAt:complianceCheck.checkedAt,complianceReviewedAt:complianceCheck.reviewedAt,complianceInputFingerprint:complianceCheck.inputFingerprint});setOptimizationDrafts(await window.desktop.ebay.optimizationDrafts(activeStore.id));setNotice(`最终图集 ${finalImageUrls.length} 张已通过自动检查并保存到优品仓库；原 eBay 线上图片未被直接修改。`);setActiveTab('premium')}catch(reason){setEbayError(readableError(reason,'保存优品仓库失败'))}finally{setBusy('')}}
  const validateDraftForPublish=async(draft:EbayOptimizationDraft)=>{const key=`publish-check:${draft.id}`;setBusy(key);setEbayError('');try{const result=await window.desktop.ebay.validateOptimizationDraft(draft.id);setOptimizationDrafts(current=>current.map(item=>item.id===result.draft.id?result.draft:item));if(result.publishAllowed)setNotice(result.reason);else{setEbayError(result.reason);setSelectedListingId(result.draft.listing.id);setSelectedLocalProductId(localProducts.find(product=>product.listingId===result.draft.listing.listingId)?.id||'');setTitleResult({originalTitle:result.draft.listing.title,optimizedTitle:result.draft.selectedTitle,keywords:[],rationale:'发布前重检未通过',model:'saved',variants:result.draft.titleVariants,itemSpecifics:result.draft.itemSpecifics,description:result.draft.description});setSelectedTitle(result.draft.selectedTitle);setComplianceReviewed(Boolean(result.check.reviewedAt));setOptimizeMode('image');setActiveTab('optimize')}}catch(reason){setEbayError(readableError(reason,'发布前自动重检失败'))}finally{setBusy('')}}
  const exportDraftForPublish=async(draft:EbayOptimizationDraft)=>{const key=`publish-export:${draft.id}`;setBusy(key);setEbayError('');try{const result=await window.desktop.ebay.exportOptimization({listing:draft.listing,selectedTitle:draft.selectedTitle,itemSpecifics:draft.itemSpecifics.map(item=>({name:item.name,value:item.value})),description:draft.description,chineseReference:'',imageUrls:draft.imageUrls?.length?draft.imageUrls:draft.imageUrl?[draft.imageUrl]:[],storyboard:draft.storyboard||[],marketDecision:draft.marketDecision});if(result)setNotice(`发布素材包已导出：${result.filePath}`)}catch(reason){setEbayError(readableError(reason,'发布素材包导出失败'))}finally{setBusy('')}}
  const prepareDraftInSellerHub=async(draft:EbayOptimizationDraft)=>{const key=`publish-prepare:${draft.id}`;setBusy(key);setEbayError('');setActiveTab('browser');try{await new Promise(resolve=>window.setTimeout(resolve,900));const task=await window.desktop.ebay.preparePublishTask(draft.id);setPublishTasks(await window.desktop.ebay.publishTasks(draft.storeId));if(task.status==='WAITING_CONFIRMATION')setNotice(`${task.message}。系统没有点击最终提交按钮。`);else setEbayError(task.message)}catch(reason){setEbayError(readableError(reason,'Seller Hub 发布准备失败'))}finally{setBusy('')}}
  const generateDraftVideo=async(draft:EbayOptimizationDraft)=>{const key=`publish-video:${draft.id}`;setBusy(key);setEbayError('');try{const task=await window.desktop.ebay.generatePublishVideo(draft.id);setPublishTasks(current=>[task,...current.filter(item=>item.id!==task.id)]);setNotice(`${task.video?.message||task.message}，请先完整预览再上传。`)}catch(reason){setEbayError(readableError(reason,'15秒商品视频生成失败'))}finally{setBusy('')}}
  const prepareDraftVideoUpload=async(draft:EbayOptimizationDraft)=>{const key=`publish-video-upload:${draft.id}`;setBusy(key);setEbayError('');setActiveTab('browser');try{await new Promise(resolve=>window.setTimeout(resolve,900));const task=await window.desktop.ebay.preparePublishVideoUpload(draft.id);setPublishTasks(await window.desktop.ebay.publishTasks(draft.storeId));setNotice(`${task.videoUpload?.message||task.message}。系统没有点击最终提交按钮。`)}catch(reason){setEbayError(readableError(reason,'Seller Hub 视频上传准备失败'))}finally{setBusy('')}}
  const runAcceptance=async(mode:'SINGLE'|'BATCH_10')=>{if(!activeStore)return;const draftId=mode==='SINGLE'?optimizationDrafts[0]?.id:undefined;if(mode==='SINGLE'&&!draftId){setEbayError('当前没有可执行真实验收的优品草稿。');return}const key=`acceptance:${mode}`;setBusy(key);setEbayError('');if(mode==='SINGLE')setActiveTab('browser');try{if(mode==='SINGLE')await new Promise(resolve=>window.setTimeout(resolve,900));const batch=await window.desktop.ebay.runAcceptance({storeId:activeStore.id,mode,draftId});setAcceptanceBatches(await window.desktop.ebay.acceptanceBatches(activeStore.id));setNotice(`${mode==='SINGLE'?'真实单品':'10商品批量'}验收完成：通过 ${batch.passed}，关注 ${batch.attention}，阻断 ${batch.blocked}。`);if(mode==='SINGLE')setActiveTab('publish')}catch(reason){setEbayError(readableError(reason,'第三阶段验收失败'));setActiveTab('publish')}finally{setBusy('')}}
  const tabs:Array<{id:EbayWorkspaceTab;name:string;note:string}>=[
    {id:'browser',name:'店铺采集',note:'浏览店铺并采集商品'},
    {id:'library',name:'线上产品',note:'已上架商品统一管理'},
    {id:'local',name:'本地产品',note:'完整快照与AI诊断依据'},
    {id:'optimize',name:'AI优化',note:'AI内容优化中心'},
    {id:'premium',name:'优品仓库',note:'保存审核通过的优化版本'},
    {id:'publish',name:'线上发布',note:'确认后更新到目标店铺'}
  ]
  const draftPublishIssues=(draft:EbayOptimizationDraft)=>[
    !draft.complianceGateStatus?'缺少合规快照':draft.complianceGateStatus==='BLOCKED'||draft.complianceGateStatus==='RECHECK_REQUIRED'?'合规门禁未通过':draft.complianceGateStatus==='REVIEW_REQUIRED'&&!draft.complianceReviewedAt?'待人工复核':'',
    !draft.selectedTitle.trim()?'缺少标题':draft.selectedTitle.length>80?'标题超过80字符':'',
    !draft.listing.categoryName?'缺少类目':'',
    !draft.imageUrl?'缺少主图':'',
    !draft.description.trim()?'缺少英文详情':'',
    draft.itemSpecifics.some(item=>item.needsConfirmation||!item.value.trim())?'属性待确认':''
  ].filter(Boolean)
  const publishReadyDrafts=optimizationDrafts.filter(draft=>draftPublishIssues(draft).length===0)
  const premiumListings=optimizationDrafts.map(draft=>draft.listing)
  const premiumSelectedCategoryIds=(()=>{
    if(!activeCategoryIds.has(premiumCategoryId))return new Set<string>()
    const ids=new Set([premiumCategoryId])
    let changed=true
    while(changed){
      changed=false
      for(const item of categoryWorkspace.categories)if(ids.has(item.parentCategoryId)&&!ids.has(item.categoryId)){ids.add(item.categoryId);changed=true}
    }
    return ids
  })()
  const premiumNeedsReview=(draft:EbayOptimizationDraft)=>draft.complianceGateStatus==='REVIEW_REQUIRED'&&!draft.complianceReviewedAt
  const premiumMatchesCategory=(draft:EbayOptimizationDraft)=>{
    if(premiumCategoryId==='ALL')return true
    if(premiumCategoryId==='UNCLASSIFIED')return !activeCategoryIds.has(draft.listing.categoryId)
    if(premiumCategoryId==='PREMIUM_READY')return draftPublishIssues(draft).length===0
    if(premiumCategoryId==='PREMIUM_REVIEW')return premiumNeedsReview(draft)
    if(premiumCategoryId==='PREMIUM_MISSING_IMAGE')return !draft.imageUrl
    if(premiumCategoryId==='PREMIUM_MISSING_DECISION')return !draft.marketDecision
    return premiumSelectedCategoryIds.has(draft.listing.categoryId)
  }
  const premiumMatchesStatus=(draft:EbayOptimizationDraft)=>{
    if(premiumStatus==='READY')return draftPublishIssues(draft).length===0
    if(premiumStatus==='REVIEW')return premiumNeedsReview(draft)
    if(premiumStatus==='INCOMPLETE')return draftPublishIssues(draft).length>0
    return true
  }
  const visiblePremiumDrafts=optimizationDrafts.filter(draft=>{
    const query=premiumSearch.trim().toLowerCase()
    return premiumMatchesCategory(draft)&&premiumMatchesStatus(draft)&&(!query||[draft.selectedTitle,draft.listing.title,draft.listing.sku,draft.listingId].some(value=>value.toLowerCase().includes(query)))
  })
  const premiumUnclassifiedCount=optimizationDrafts.filter(draft=>!activeCategoryIds.has(draft.listing.categoryId)).length
  const premiumReviewCount=optimizationDrafts.filter(premiumNeedsReview).length
  const premiumMissingImageCount=optimizationDrafts.filter(draft=>!draft.imageUrl).length
  const premiumMissingDecisionCount=optimizationDrafts.filter(draft=>!draft.marketDecision).length
  const latestAcceptance=acceptanceBatches[0]
  const stageBadge={
    title:titleResult&&selectedTitle?'✓':'—',
    content:titleResult?.description.trim()?'✓':'—',
    image:imageNaturalizationComplete?'✓':acceptedImagePurposes.length?'待自然化':Object.keys(imageResults).length?'待确认':complianceAutoRunning?'…':imageVisualReport?(imageVisualReport.failed+imageVisualReport.review||'待优化'):selectedSourceImages.length||'—',
    video:contentResult?.storyboard.length?'✓':'—'
  }
  const optimizeStageOrder=['title','content','image','video','pricing'] as const
  const optimizeStageLabels={title:'标题优化',content:'描述优化',image:'图片优化',video:'视频生成',pricing:'售价设定'} as const
  const optimizeStageIndex=optimizeStageOrder.indexOf(optimizeMode)
  const nextOptimizeMode=optimizeStageOrder[optimizeStageIndex+1]
  const finalImageInspectionPassed=Boolean(imageNaturalizationComplete&&finalImageInspection&&!finalImageInspection.blocked&&!finalImageInspection.review)
  const nextOptimizeReady=optimizeMode==='title'?titleDecisionCurrent:optimizeMode==='content'?Boolean(contentResult&&!staleContentTranslationCount):optimizeMode==='image'?finalImageInspectionPassed:true
  const nextOptimizeStatus=optimizeMode==='title'
      ?titleDecisionCurrent?'标题方案已审核确认':'请先完成标题方案审核确认'
      :optimizeMode==='content'
        ?!contentResult?'请先生成并核对详情内容':staleContentTranslationCount?`还有 ${staleContentTranslationCount} 段中文翻译待同步`:'详情内容与中文翻译已同步'
        :optimizeMode==='image'
          ?!imageNaturalizationComplete
            ?!acceptedImagePurposes.length?'请先一键生成整套图片并确认四类图片':!allImagePurposesAccepted?`请确认四类图片（已确认 ${acceptedImagePurposes.length}/4）`:`请完成 03 自然化处理并确认最终版本（${Object.keys(naturalizeChoices).length}/4）`
            :finalImageChecking||!finalImageInspection
              ?'正在自动检查最终图集'
              :finalImageInspection.blocked
                ?`最终图集中有 ${finalImageInspection.blocked} 张未通过，请重新处理`
                :'最终图集已确认并通过自动检查'
          :'视频分镜可继续调整，下一步进行售价核算'
  const goToNextOptimizeStage=()=>{
    if(!nextOptimizeMode||!nextOptimizeReady)return
    setOptimizeMode(nextOptimizeMode)
    window.requestAnimationFrame(()=>document.querySelector<HTMLElement>('.ebay-workspace')?.scrollTo({top:0,behavior:'smooth'}))
  }
  const publishTaskLabel:Record<EbayPublishTask['status'],string>={DRAFT:'待执行',VALIDATING:'检查中',READY_TO_FILL:'资料就绪',FILLING:'填写中',WAITING_CONFIRMATION:'待人工提交',BLOCKED:'已阻断',FAILED:'执行失败'}
  const ebayLoginLabel=ebayLogin?.status==='ONLINE'?'会话有效':ebayLogin?.status==='VERIFICATION_REQUIRED'?'需要人工验证':ebayLogin?.status==='AUTO_LOGIN_RUNNING'||ebayLogin?.status==='CHECKING'?'正在自动登录':ebayLogin?.status==='CREDENTIALS_REQUIRED'?'凭据待补充':ebayLogin?.status==='ERROR'?'登录失败':'会话已失效'
  const categorySummary=categoryWorkspace.lastSync
  const categoryImportantChanges=categorySummary?(categorySummary.added+categorySummary.renamed+categorySummary.moved+categorySummary.removed):0
  const categorySyncedAt=categorySummary?new Date(categorySummary.syncedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'尚未同步'
  const selectStore=(store:EbayStore)=>{setStoreScope(store.id);setActiveTab('browser');setEbayError('')}
  const navigateEbay=(event:FormEvent)=>{event.preventDefault();try{const target=new URL(ebayAddress);if(target.protocol!=='https:'||!(target.hostname==='ebay.com'||target.hostname.endsWith('.ebay.com')))throw new Error('eBay浏览器只允许访问 ebay.com');void window.desktop.browser.navigate('web',target.toString())}catch(reason){setEbayError(readableError(reason,'网址无效'))}}
  const createEbayBrowserTab=async()=>{if(!activeStore)return;setEbayError('');try{await window.desktop.ebay.newBrowserTab(activeStore.id)}catch(reason){setEbayError(readableError(reason,'新建eBay浏览页失败'))}}
  const activateEbayBrowserTab=async(tab:BrowserTab)=>{setEbayError('');try{await window.desktop.browser.switchTab(tab.id);const next=await window.desktop.browser.getState('web');setEbayBrowserState(next);setEbayAddress(next.url)}catch(reason){setEbayError(readableError(reason,'切换eBay浏览页失败'))}}
  const closeEbayBrowserTab=async(tabId:string)=>{setEbayError('');try{await window.desktop.browser.closeTab(tabId)}catch(reason){setEbayError(readableError(reason,'关闭eBay浏览页失败'))}}
  const startEbayPlugin=async()=>{setEbayError('');try{const state=await window.desktop.browser.startEbayPlugin();setEbayPluginActive(state.active);setEbayPluginRecognized(state.recognizedCount);setEbayPluginSelected(state.selectedCount);setEbayPluginProducts(state.products)}catch(reason){setEbayError(readableError(reason,'eBay采集插件启动失败'))}}
  const openEbayDeliveryLocation=async()=>{setEbayDeliveryOpening(true);setEbayError('');try{const result=await window.desktop.browser.openEbayDeliveryLocation();setEbayDeliveryLabel(result.label.replace(/[\s:：]+$/,'')||'收货地');setNotice(result.fallback?'当前页面未识别到收货地控件，已打开 eBay 官方收货地址设置。设置后返回店铺页面即可生效。':'已打开 eBay 收货地选择，请选择“美国”并填写邮编。设置会仅保存在当前店铺会话中。')}catch(reason){setEbayError(readableError(reason,'eBay收货地设置打开失败'))}finally{setEbayDeliveryOpening(false)}}
  const removeEbayCollectedProduct=async(url:string)=>{const state=await window.desktop.browser.removeEbayPluginProduct(url);setEbayPluginSelected(state.selectedCount);setEbayPluginProducts(state.products)}
  const clearEbayCollectedProducts=async()=>{const state=await window.desktop.browser.clearEbayPluginProducts();setEbayPluginSelected(state.selectedCount);setEbayPluginProducts(state.products);setEbayCollectionResult(null)}
  const confirmEbayCollection=async()=>{if(!activeStore||!ebayPluginProducts.length)return;setEbayCollectionConfirming(true);setEbayCollectionResult(null);setEbayError('');try{const result=await window.desktop.ebay.confirmCollection(activeStore.id);const [nextListings,nextCategories]=await Promise.all([window.desktop.ebay.listings(activeStore.id),window.desktop.ebay.categoryWorkspace(activeStore.id)]);setListings(nextListings);setCategoryWorkspace(nextCategories);setEbayPluginSelected(0);setEbayPluginProducts([]);setEbayCollectionResult({status:'SUCCESS',message:`采集完成：新增 ${result.imported} 个${result.duplicates?`，重复 ${result.duplicates} 个`:''}`})}catch(reason){const message=readableError(reason,'eBay商品采集失败');setEbayCollectionResult({status:'FAILED',message});setEbayError(message)}finally{setEbayCollectionConfirming(false)}}
  const translateEbayPage=async(mode:BrowserTranslationMode,silent=false)=>{if(ebayTranslationRunning.current)return;ebayTranslationRunning.current=true;if(!silent)setEbayTranslating(true);try{const status=await window.desktop.browser.translate(mode);setEbayTranslationCount(current=>current+status.translated);setEbayTranslationActive(true);setEbayTranslationMode(mode)}catch(reason){if(!silent)setEbayError(readableError(reason,'eBay网页翻译失败'))}finally{ebayTranslationRunning.current=false;if(!silent)setEbayTranslating(false)}}
  const restoreEbayTranslation=async()=>{try{await window.desktop.browser.restoreTranslation();setEbayTranslationActive(false);setEbayTranslationCount(0);setEbayTranslationMenuOpen(false)}catch(reason){setEbayError(readableError(reason,'恢复 eBay 原网页失败'))}}
  const ebayCollectionTarget=activeTab==='browser'?document.querySelector('.ebay-login-workbench'):null
  const ebayExecutionMessage=ebayCollectionConfirming?'正在执行采集…':ebayPluginProducts.length?'等待确认':ebayCollectionResult?.message||'等待选择商品'
  const ebayCollectionPanel=ebayCollectionTarget?createPortal(<><section className="ebay-collection-draft-card"><header><span>02</span><div><b>待确认采集商品</b><small>右侧点击“采集”后暂存在这里</small></div></header>{ebayPluginProducts.length?<><div className="ebay-collection-draft-toolbar"><b>已选 {ebayPluginProducts.length} 个</b><button type="button" onClick={()=>void clearEbayCollectedProducts()}>清空</button></div><div className="ebay-collection-draft-grid">{ebayPluginProducts.map(product=><article key={product.url}>{product.imageUrl?<img src={product.imageUrl} alt={product.title}/>:<span>无主图</span>}<div><b title={product.title}>{product.title}</b><small>{ebayDisplayPrice(product.currency,product.price)} · {product.categoryName||'未分类'}</small></div><button type="button" title="移除" onClick={()=>void removeEbayCollectedProduct(product.url)}>×</button></article>)}</div></>:<div className="ebay-collection-draft-empty"><span>🤖</span><b>尚未选择商品</b><small>请在右侧 eBay 页面点击商品上的“采集”</small></div>}</section><section className={`ebay-collection-execution${ebayCollectionResult?` ${ebayCollectionResult.status.toLowerCase()}`:''}`}><h3>采集执行</h3><dl><div><dt>采集目标</dt><dd>{ebayPluginProducts.length?`共 ${ebayPluginProducts.length} 个商品`:'尚未选择'}</dd></div><div><dt>采集结果</dt><dd><i/>{ebayExecutionMessage}</dd></div></dl>{!ebayPluginProducts.length&&ebayCollectionResult?.status==='SUCCESS'?<button type="button" onClick={()=>setEbayCollectionResult(null)}>继续采集</button>:<button type="button" disabled={!ebayPluginProducts.length||ebayCollectionConfirming} onClick={()=>void confirmEbayCollection()}>{ebayCollectionConfirming?'正在执行…':ebayPluginProducts.length?`确认执行（${ebayPluginProducts.length}）`:'请在右侧选择商品'}</button>}</section></>,ebayCollectionTarget):null
  const ebayDeliveryTarget=activeTab==='browser'?document.querySelector('.ebay-browser-heading .browser-heading-actions'):null
  const ebayDeliveryButton=ebayDeliveryTarget?createPortal(<button type="button" className="ebay-delivery-trigger" disabled={ebayDeliveryOpening} onClick={()=>void openEbayDeliveryLocation()}>{ebayDeliveryOpening?'打开中…':`📍 ${ebayDeliveryLabel}`}</button>,ebayDeliveryTarget):null
  return <section className="ebay-platform-page">
    <div className="ebay-store-bar">
      <div className="ebay-platform-identity"><span className={ebayPlatformLogo?'has-site-logo':''}>{ebayPlatformLogo?<img src={ebayPlatformLogo} alt="eBay平台Logo" onError={()=>setEbayPlatformLogo('')}/>:<i>e</i>}</span><div><b>eBay平台</b><small>多店铺商品优化中心</small></div></div>
      <div className="ebay-store-scopes" aria-label="eBay店铺范围">
        <button className="ebay-add-store-card" onClick={addStore}><b>＋ 添加店铺</b><small>保存独立登录身份</small></button>
        {stores.map(store=><button key={store.id} className={storeScope===store.id?'active':''} onClick={()=>selectStore(store)}><b>{store.name}</b><small>{store.passwordSaved?'凭据已保存':'待配置'} · {store.loginUsername||store.sellerId}</small></button>)}
      </div>
    </div>
    <div className="ebay-business-nav">{tabs.map(tab=><button key={tab.id} className={activeTab===tab.id?'active':''} onClick={()=>setActiveTab(tab.id)}><b>{tab.name}</b><small>{tab.note}</small></button>)}</div>
    <div className={`ebay-workspace ${activeTab==='browser'?'ebay-browser-workspace':''}`}>
      {ebayCollectionPanel}
      {ebayDeliveryButton}
      {downloadToast&&<div className={`ebay-download-toast ${downloadToast.kind}`} role={downloadToast.kind==='error'?'alert':'status'} aria-live={downloadToast.kind==='error'?'assertive':'polite'}><span aria-hidden="true">{downloadToast.kind==='progress'?'↻':downloadToast.kind==='success'?'✓':downloadToast.kind==='warning'?'!':'×'}</span><div><b>{downloadToast.kind==='progress'?'正在下载':downloadToast.kind==='success'?'下载成功':downloadToast.kind==='warning'?'下载部分完成':'下载失败'}</b><p>{downloadToast.message}</p></div>{downloadToast.kind!=='progress'&&<button type="button" aria-label="关闭下载通知" onClick={()=>setDownloadToast(null)}>×</button>}</div>}
      {notice&&<div className="ebay-success-notice">{notice}<button onClick={()=>setNotice('')}>×</button></div>}
      {ebayError&&<div className="ebay-error-notice">{ebayError}<button onClick={()=>setEbayError('')}>×</button></div>}
      {activeTab==='browser'&&activeStore&&<div className={`ebay-auto-login-banner status-${(ebayLogin?.status||'CHECKING').toLowerCase()}`}><i/><div><b>{activeStore.name} · {ebayLoginLabel}</b><small>{ebayLogin?.message||'正在检查登录状态'}</small></div><button type="button" disabled={ebayLogin?.status==='AUTO_LOGIN_RUNNING'||ebayLogin?.status==='CHECKING'} onClick={()=>void ensureEbayLogin()}>一键登录</button></div>}
      {activeTab==='browser'&&(activeStore?<div className="ebay-browser-layout"><aside className="ebay-login-workbench"><div className="ebay-workbench-heading"><small>EBAY WORKBENCH</small><h2>eBay店铺工作台</h2><p>登录身份与浏览会话按店铺独立保存</p></div><section><header><span>01</span><div><b>平台与登录身份</b><small>查看登录状态和管理登录凭据</small></div></header><div className="ebay-login-status"><i/><div><b>{activeStore.name} · {activeStore.passwordSaved?'凭据已保存':'待配置'}</b><small>{activeStore.loginUsername||'尚未设置登录账号'}</small></div></div><CredentialPanel accountId={`ebay:${activeStore.id}`} platformCode="EBAY"/></section></aside><main className="ebay-browser-panel"><div className="ebay-browser-heading"><div><small>WORKSPACE BROWSER</small><b>eBay浏览器</b></div><div className="browser-heading-actions"><button title="eBay页面商品识别插件" className={`built-in-collector-trigger${ebayPluginActive?' active':''}`} onClick={()=>void startEbayPlugin()}>{ebayPluginActive?`🤖 采集插件 · 已开启 · 已选 ${ebayPluginSelected} / 当前页识别 ${ebayPluginRecognized}`:'🤖 启用采集插件'}</button><div className="browser-translation"><button className={`translation-trigger ${ebayTranslationActive?'active':''}`} disabled={ebayTranslating} onClick={()=>ebayTranslationActive?setEbayTranslationMenuOpen(open=>!open):void translateEbayPage('BILINGUAL')}><span>{ebayTranslating?'翻译中…':ebayTranslationActive?`中文 ✓${ebayTranslationCount?` · ${ebayTranslationCount}`:''}`:'译 · 中文'}</span><i>{ebayTranslationMenuOpen?'⌃':'⌄'}</i></button>{ebayTranslationMenuOpen&&<div className="translation-menu"><b>网页翻译</b><small>Qwen-MT Flash · 自动识别语种</small><button className={ebayTranslationMode==='BILINGUAL'?'active':''} onClick={()=>{setEbayTranslationMenuOpen(false);void translateEbayPage('BILINGUAL')}}><span>原文 + 中文</span><em>推荐</em></button><button className={ebayTranslationMode==='CHINESE'?'active':''} onClick={()=>{setEbayTranslationMenuOpen(false);void translateEbayPage('CHINESE')}}><span>仅显示中文</span></button><button onClick={()=>void translateEbayPage(ebayTranslationMode)}><span>翻译新增内容</span></button><button className="restore" onClick={()=>void restoreEbayTranslation()}><span>恢复原网页</span></button></div>}</div></div></div><div className="tabs ebay-browser-tabs"><div className="tab-scroll">{ebayBrowserTabs.map(tab=><button key={tab.id} className={tab.active?'active':''} onClick={()=>void activateEbayBrowserTab(tab)}><span className={`ebay-tab-icon${tab.faviconUrl?' has-site-logo':''}`}>{tab.faviconUrl?<img src={tab.faviconUrl} alt="" onError={event=>{event.currentTarget.hidden=true}}/>:'e'}</span><b>{tab.title}</b>{tab.closable&&<i onClick={event=>{event.stopPropagation();void closeEbayBrowserTab(tab.id)}}>×</i>}</button>)}</div><button className="new-browser-tab" title="新建eBay浏览页" aria-label="新建eBay浏览页" onClick={()=>void createEbayBrowserTab()}>＋</button>{ebayBrowserState?.loading&&<span className="run-state loading"><i/>页面加载中</span>}</div><form className="address-bar ebay-address-bar" onSubmit={navigateEbay}><button type="button" title="后退" disabled={!ebayBrowserState?.canGoBack} onClick={()=>void window.desktop.browser.back('web')}>←</button><button type="button" title="前进" disabled={!ebayBrowserState?.canGoForward} onClick={()=>void window.desktop.browser.forward('web')}>→</button><button type="button" title="刷新" onClick={()=>void window.desktop.browser.reload('web')}>↻</button><input aria-label="eBay网页地址" value={ebayAddress} onChange={event=>setEbayAddress(event.target.value)}/><button className="address-go" type="submit">打开 <span>↗</span></button></form><div ref={ebayBrowserSlot} className="browser-slot ebay-browser-slot"><div className="browser-placeholder">正在打开 {activeStore.name} 的 eBay 独立浏览会话…</div></div></main></div>:<EbayEmpty title="尚未添加 eBay 店铺" description="点击顶部“添加店铺”，保存店名、登录账号和密码后进入独立浏览会话。" action="添加第一个店铺" onAction={addStore}/>)}
      {activeTab!=='browser'&&<><div className="ebay-page-heading"><div><small>EBAY {activeTab==='optimize'?'V2.0':'V1.0'} · PRODUCTION · READ ONLY</small><h2>{tabs.find(tab=>tab.id===activeTab)?.name}</h2><p>当前店铺：{scopeName} · 正式环境只读模式</p></div>{activeTab==='library'&&<div className="ebay-library-sync"><div className="ebay-library-sync-status"><b>{categoryWorkspace.categories.length} 个目录</b><small>上次同步：{categorySyncedAt}</small>{categoryImportantChanges>0&&<em>{categoryImportantChanges} 项变化</em>}</div><div className="ebay-library-sync-actions"><button type="button" title={ebayLogin?.status==='ONLINE'?'同步 eBay 店铺目录':'请先在店铺采集完成登录'} disabled={categorySyncing||ebayLogin?.status!=='ONLINE'} onClick={()=>void syncStoreCategories()}>{categorySyncing?'目录同步中…':'同步目录'}</button><button type="button" className="primary" title={ebayLogin?.status==='ONLINE'?'按店铺目录同步线上产品':'请先在店铺采集完成登录'} disabled={!directoryProductCategories.length||ebayLogin?.status!=='ONLINE'} onClick={()=>void openDirectoryProductSync()}>同步产品</button></div></div>}<span className={configuration?.configured?'ready':'pending'}><i/>{configuration?.configured?'正式环境配置完成':'等待 eBay 正式凭证'}</span></div>{!configuration?.configured&&<div className="ebay-config-notice"><b>正式环境尚未配置 Production Keys</b><span>当前可在内嵌 eBay 浏览器登录，并从 Seller Hub 下载 Listings CSV 后导入线上产品。</span></div>}</>}
      {activeTab==='library'&&<div className="ebay-inline-check-summary"><div><b>{listings.length}</b><small>线上产品</small></div><div className={titleIssues?'warn':''}><b>{titleIssues}</b><small>标题待优化</small></div><div className={imageIssues?'warn':''}><b>{imageIssues}</b><small>主图待补充</small></div><div className={healthRows.filter(row=>row.issues.length).length?'warn':''}><b>{healthRows.filter(row=>row.issues.length).length}</b><small>存在待优化项</small></div></div>}
      {activeTab==='library'&&<div className="ebay-library-layout">
        <aside className="ebay-product-catalog">
          <header><b>产品目录</b><small>{categoryWorkspace.categories.length?`eBay店铺目录 · ${categorySyncedAt}`:'尚未同步店铺目录'}</small></header>
          <button className={selectedCategoryId==='ALL'?'active':''} onClick={()=>setSelectedCategoryId('ALL')}>全部产品 <em>{listings.length}</em></button>
          {categoryWorkspace.categories.length?<EbayStoreCategoryTree categories={categoryWorkspace.categories} listings={listings} selected={selectedCategoryId} onSelect={setSelectedCategoryId}/>:<p className="ebay-category-empty">请先在“店铺采集”中同步目录</p>}
          <div className="ebay-catalog-filters"><b>其他筛选</b><button className={selectedCategoryId==='UNCLASSIFIED'?'active':''} onClick={()=>setSelectedCategoryId('UNCLASSIFIED')}>未分类 <em>{unclassifiedCount}</em></button><button className={selectedCategoryId==='MISSING_IMAGE'?'active':''} onClick={()=>setSelectedCategoryId('MISSING_IMAGE')}>缺少主图 <em>{imageIssues}</em></button></div>
        </aside>
        <section>
          <div className="ebay-toolbar ebay-toolbar-report"><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="搜索标题、SKU、Item ID"/><select><option>在线商品</option></select><button disabled={!activeStore||Boolean(busy)} onClick={()=>activeStore&&void importReport(activeStore)}>{busy===`report:${activeStore?.id}`?'导入中':'导入Listings报表'}</button><button disabled={!activeStore||activeStore.status!=='CONNECTED'||Boolean(busy)} onClick={()=>activeStore&&void syncStore(activeStore)}>{busy===`sync:${activeStore?.id}`?'同步中':'API同步'}</button></div>
          {visibleListings.length?<div className="ebay-listing-grid">{visibleListings.map(item=><article className="ebay-market-card" key={item.id}>
            <div className="ebay-market-card-media">
              {item.viewUrl?<button type="button" className="ebay-market-card-image-link" title="在店铺采集浏览器新标签打开 eBay 原商品" aria-label={`打开 eBay 原商品：${item.title}`} disabled={busy===`open:${item.id}`} onClick={()=>void openOriginalProduct(item)}>
                {item.imageUrl?<img src={ebayDisplayImage(item.imageUrl)} alt={item.title} loading="lazy" onError={event=>{if(event.currentTarget.dataset.fallback)return;event.currentTarget.dataset.fallback='1';event.currentTarget.src=item.imageUrl}}/>:<span>无主图</span>}
                <em>{busy===`open:${item.id}`?'正在打开…':'查看原商品 ↗'}</em>
              </button>:<div className="ebay-market-card-image-unavailable" title="原商品链接缺失，请重新同步产品">
                {item.imageUrl?<img src={ebayDisplayImage(item.imageUrl)} alt={item.title} loading="lazy" onError={event=>{if(event.currentTarget.dataset.fallback)return;event.currentTarget.dataset.fallback='1';event.currentTarget.src=item.imageUrl}}/>:<span>无主图</span>}
                <em>原商品链接缺失</em>
              </div>}
            </div>
            <div className="ebay-market-card-body">
              <b title={item.title}>{item.title}</b>
              <strong>{ebayDisplayPrice(item.currency,item.price)}</strong>
              <small>Item ID {item.listingId}</small>
              <details className="ebay-card-menu">
                <summary aria-label={`打开 ${item.title} 的操作菜单`}>⋮</summary>
                <div>
                  <span className="ebay-card-menu-site">{item.marketplaceId==='EBAY_US'?'🇺🇸 美国站':item.marketplaceId.replace(/^EBAY_/,'eBay ')}</span>
                  <div className="ebay-card-actions"><button type="button" className="primary" disabled={busy===`download:${item.id}`} onClick={()=>void downloadLocalProduct(item)}>{busy===`download:${item.id}`?'下载中…':localProducts.some(product=>product.listingId===item.listingId)?'更新本地版本':'下载到本地'}</button><button type="button" className="danger" title="从本地线上产品库彻底删除该商品" aria-label={`删除 ${item.title}`} disabled={busy===`remove:${item.id}`} onClick={()=>void removeLocalListing(item)}>{busy===`remove:${item.id}`?'删除中…':'删除'}</button></div>
                </div>
              </details>
            </div>
          </article>)}</div>:<EbayEmpty title={selectedCategoryId==='ALL'?'暂无已上架商品':'当前目录暂无商品'} description={activeStore?'可切换其他目录，或在店铺采集中采集商品。':'请先在顶部添加或选择具体店铺。'}/>} 
        </section>
      </div>}
      {activeTab==='local'&&<div className="ebay-library-layout ebay-local-products-layout">
        <aside className="ebay-product-catalog">
          <header><b>本地产品目录</b><small>沿用线上商品类目 · 独立持久化</small></header>
          <button className={selectedCategoryId==='ALL'?'active':''} onClick={()=>setSelectedCategoryId('ALL')}>全部产品 <em>{localProducts.length}</em></button>
          {categoryWorkspace.categories.length?<EbayStoreCategoryTree categories={categoryWorkspace.categories} listings={localListings} selected={selectedCategoryId} onSelect={setSelectedCategoryId}/>:<p className="ebay-category-empty">请先同步 eBay 店铺目录</p>}
          <div className="ebay-catalog-filters"><b>快照状态</b><button className={selectedCategoryId==='UNCLASSIFIED'?'active':''} onClick={()=>setSelectedCategoryId('UNCLASSIFIED')}>未分类 <em>{localListings.filter(item=>!activeCategoryIds.has(item.categoryId)).length}</em></button><button className={selectedCategoryId==='MISSING_IMAGE'?'active':''} onClick={()=>setSelectedCategoryId('MISSING_IMAGE')}>缺少本地图片 <em>{localProducts.filter(product=>!product.snapshot.media.some(media=>media.downloadStatus==='DOWNLOADED')).length}</em></button></div>
        </aside>
        <section>
          <div className="ebay-toolbar"><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="搜索本地产品标题、SKU、Item ID"/><span className="ebay-local-library-note">AI优化仅使用这里保存的快照</span></div>
          {visibleLocalProducts.length?<div className="ebay-listing-grid">{visibleLocalProducts.map(product=>{const item=product.snapshot.sourceListing;const localMedia=product.snapshot.media.find(media=>media.downloadStatus==='DOWNLOADED');const imageUrl=ebayLocalMediaUrl(localMedia?.localPath||'',localMedia?.remoteUrl||item.imageUrl);const currencyCode=(item.currency||'').trim().toUpperCase();const priceNumber=ebayMoneyNumber(item.price);const cnyPrice=currencyCode==='CNY'||currencyCode==='RMB'||priceNumber<=0?0:priceNumber*readEbayProfitAssumptions(product.id).exchangeRate;return <article className="ebay-market-card ebay-local-product-card" key={product.id}>
            <div className="ebay-market-card-media">{imageUrl?<img src={imageUrl} alt={product.title} loading="lazy" onError={event=>{if(event.currentTarget.dataset.fallback)return;event.currentTarget.dataset.fallback='1';event.currentTarget.src=localMedia?.remoteUrl||item.imageUrl}}/>:<span>无本地主图</span>}<span className={`ebay-local-completeness ${product.status.toLowerCase()}`}>{product.snapshot.completeness}%</span></div>
            <div className="ebay-market-card-body">
              <b title={product.title}>{product.title}</b>
              <div className="ebay-local-price-row"><strong>{ebayDisplayPrice(item.currency,item.price)}</strong>{cnyPrice>0&&<em>{ebayDisplayPrice('RMB',cnyPrice.toFixed(2))}</em>}</div>
              <div className="ebay-card-actions ebay-local-card-actions"><button type="button" className="primary" onClick={()=>selectForOptimization(product)}>AI优化</button><button type="button" disabled={busy===`local-detail:${product.id}`} onClick={()=>void openLocalEditor(product)}>{busy===`local-detail:${product.id}`?'读取中…':'本地详情'}</button>{item.viewUrl&&<button type="button" onClick={()=>void openOriginalProduct(item)}>原商品 ↗</button>}<button type="button" className="danger" disabled={busy===`remove-local:${product.id}`} onClick={()=>void removeLocalProduct(product)}>{busy===`remove-local:${product.id}`?'删除中…':'删除本地'}</button></div>
            </div>
          </article>})}</div>:<EbayEmpty title="本地产品库暂无商品" description="请在线上产品点击“下载到本地”，系统会保存商品详情、属性和全部可读取图片。" action="前往线上产品" onAction={()=>setActiveTab('library')}/>}
        </section>
      </div>}
      {activeTab==='optimize'&&selectedListing&&complianceReport&&<div className={`ebay-compliance-strip ${combinedGateClass}`}><div><small>eBay详情页检查结果</small><b>{combinedGateLabel}</b></div><span>{complianceReport.marketplaceLabel} · 对照 eBay 官方图片与描述要求</span><span className="counts"><strong>{combinedBlockingIssues}</strong> 个必须修改 · <strong>{combinedReviewIssues}</strong> 个技术资料不完整 · {combinedAdvisoryIssues} 个建议优化 · {visualPendingCount} 张待视觉确认</span></div>}
      {activeTab==='optimize'&&<div className="ebay-optimize-layout"><aside><b>优化任务 · V2</b><button className={optimizeMode==='title'?'active':''} onClick={()=>setOptimizeMode('title')}>标题优化 <em>{stageBadge.title}</em></button><button className={optimizeMode==='content'?'active':''} onClick={()=>setOptimizeMode('content')}>描述优化 <em>{stageBadge.content}</em></button><button className={optimizeMode==='image'?'active':''} onClick={()=>setOptimizeMode('image')}>图片优化 <em>{stageBadge.image}</em></button><button className={optimizeMode==='video'?'active':''} onClick={()=>setOptimizeMode('video')}>视频生成 <em>{stageBadge.video}</em></button><button className={optimizeMode==='pricing'?'active':''} onClick={()=>setOptimizeMode('pricing')}>售价设定 <em>{profitReady?`${estimatedProfitCny>=0?'+':''}${estimatedProfitCny.toFixed(0)}`:'待录入'}</em></button></aside><section>{selectedListing?<div className="ebay-optimization-workbench"><div className="ebay-selected-product">{selectedLocalPreview?<img src={selectedLocalPreview} alt={selectedTitleEnglish}/>:<span>无本地主图</span>}<div className="ebay-selected-title-pair"><small className="ebay-title-label">eBay 原文</small><b>{selectedTitleEnglish}</b><small className="ebay-title-label">中文直译</small><p className="ebay-title-translation">{selectedTitleChinese||'正在生成中文直译…'}</p>{optimizeMode==='title'&&selectedLocalProduct&&<small className="ebay-selected-source-meta">本地快照 V{selectedLocalProduct.versionCount} · 完整度 {selectedLocalProduct.snapshot.completeness}% · 本地图片 {selectedDownloadedMedia.length} 张 · 尺寸达标 {selectedCompliantMedia.length}/{selectedDownloadedMedia.length}{selectedMinimumLongestEdge?` · 最小最长边 ${selectedMinimumLongestEdge}px`:''}</small>}</div></div>
        {optimizeMode==='image'&&complianceReport&&<div className="ebay-diagnosis-panel ebay-compliance-panel ebay-image-initial-check"><header><div><b>图片优化 · 01 初步检查</b><small>自动对照 eBay 官方图片政策与展示指南，不评价美观和转化率。</small></div><div className="ebay-compliance-actions"><span className={`ebay-auto-check-status ${complianceAutoRunning?'checking':complianceAutoError?'failed':complianceIsCurrent?'checked':'pending'}`}><b>{complianceAutoRunning?'正在自动检查官方规则…':complianceAutoError?'自动检查失败':complianceIsCurrent?'✓ 已自动检查官方规则':'等待自动检查'}</b><small>{complianceAutoRunning?'正在读取当前商品内容':complianceAutoError?complianceAutoError:complianceIsCurrent&&complianceCheck?new Date(complianceCheck.checkedAt).toLocaleString('zh-CN'):'商品内容变化后自动执行'}</small></span><span className={`ebay-auto-check-status ebay-source-sync-status ${selectedLocalProduct?'checked':'pending'}`}><b>{selectedLocalProduct?'✓ 原商品资料已同步':'等待同步原商品资料'}</b><small>{selectedLocalProduct?`本地快照 V${selectedLocalProduct.versionCount} · ${new Date(selectedLocalProduct.snapshot.capturedAt).toLocaleString('zh-CN')} · ${selectedDownloadedMedia.length} 张图片`:'请先从线上产品下载并建立本地快照'}</small></span></div></header><EbayVisualCompliancePanel media={selectedLocalProduct?.snapshot.media||[]} report={imageVisualReport} running={busy==='visual-compliance-check'} onReview={(mediaId,rule,decision)=>void reviewImageVisualRule(mediaId,rule,decision)} curations={Object.fromEntries(curatedImageSourceEntries.map(entry=>[entry.url,{enabled:entry.enabled,role:entry.role}]))} roleOptions={ebayImageSourceRoles.map(role=>({value:role,label:ebayImageSourceRoleLabels[role]}))} selectedReferenceUrl={selectedSourceImage} onRoleChange={(url,role)=>updateImageSourceCuration(url,role as EbayImageSourceRole)} onToggleEnabled={(url,next)=>updateImageSourceCuration(url,next?'DETAIL':'UNUSED')} onSelectReference={url=>setSelectedSourceImageUrl(url)}/><div className="ebay-remediation-heading"><div><b>图片整改清单</b><small>仅列出图片尺寸、数量、商品一致性、边框、附加文字和水印结果</small></div><span><strong>{diagnosisIssues.filter(item=>item.dimension==='图片展示质量'&&(item.level==='P0'||item.level==='P2')).length}</strong> 必须修改 · {visualPendingCount} 张待视觉确认</span></div><div className="ebay-issue-list ebay-compliance-findings local-findings">{diagnosisIssues.filter(item=>item.dimension==='图片展示质量').map(issue=><article key={`${issue.ruleId}-${issue.title}`}><em className={issue.level.toLowerCase()}>{issue.level==='P0'||issue.level==='P2'?'修改':issue.level==='P1'?'人工确认':'建议'}</em><div><b>{issue.title}</b><p><strong>当前结果：</strong>{issue.evidence}</p><p><strong>eBay 要求影响：</strong>{issue.consequence}</p><p><strong>后续处理：</strong>{issue.remediation}</p><footer><span>{issue.ruleId} · 核验 {issue.lastVerifiedAt}</span>{issue.sourceUrl&&<a href={issue.sourceUrl} target="_blank" rel="noreferrer">eBay官方依据 ↗</a>}</footer></div></article>)}</div>{!diagnosisIssues.some(item=>item.dimension==='图片展示质量')&&<div className="ebay-ai-placeholder">{visualStatusMessage}</div>}<div className="ebay-compliance-knowledge"><span>{complianceIsCurrent?`规则集：${complianceCheck?.ruleSetVersion}`:'当前内容暂无可用检查结论'}</span><span>检查结果保存到当前本地快照，图片或商品内容变化后会自动重检。</span></div></div>}
        {optimizeMode==='title'&&<div className="ebay-title-workbench">
          {!selectedOriginalTitleVerified&&<div className="ebay-ai-placeholder">原标题尚未取得。请返回“店铺采集”从商品列表重新采集。</div>}
          <section className="ebay-market-research">
            <div className="ebay-market-controls"><label>核心商品词<input value={researchQuery} onChange={event=>updateResearchQuery(event.target.value)} placeholder="例如 Jersey Display Frame"/></label><label>时间范围<select value={researchPeriod} onChange={event=>setResearchPeriod(Number(event.target.value) as 30|90|365)}><option value={30}>近30天</option><option value={90}>近90天</option><option value={365}>近365天</option></select></label><div className="ebay-market-actions"><button className="primary" disabled={busy==='market-research'||!researchQuery.trim()} onClick={()=>void runMarketResearch()}>{busy==='market-research'?'正在读取已成交数据…':'检索已成交市场数据'}</button></div></div>
            {marketResearch?<>
              {!marketResearchCurrent&&<div className="ebay-market-stale">检索条件已变化，这份结果不能用于生成标题，请重新检索。</div>}
              <div className="ebay-market-latest">
                <header><div><b>最新市场结论</b><small>{marketResearch.query} · 近 {marketResearch.periodDays} 天 · {marketResearch.source==='EBAY_PRODUCT_RESEARCH'?'eBay Product Research':'eBay Sold & Completed'}</small></div><button className="ebay-market-source" onClick={()=>activeStore&&void window.desktop.ebay.openProduct(activeStore.id,marketResearch.sourceUrl,'eBay 已成交研究')}>打开研究页 ↗</button></header>
                <div className="ebay-market-summary"><span><b>{marketResearch.sampleCount}</b><small>有效成交样本</small></span><span><b>{marketResearch.source==='EBAY_PRODUCT_RESEARCH'?'Product Research':'Sold & Completed'}</b><small>数据来源</small></span><span><b>{confirmedMarketTerms}</b><small>已确认市场词</small></span><span><b>{reviewMarketTerms}</b><small>待核对市场词</small></span></div>
                <div className="ebay-market-latest-conclusion"><b>{marketDecision?.summary||'已读取最新已成交市场数据。'}</b><p>{marketDecision?.titleReadiness==='READY'?'当前证据可用于生成六套标题方案。':marketDecision?.titleReadiness==='BLOCKED'?'当前样本或市场词不足，请重新检索或确认关键词。':'可继续生成标题，但建议先核对待确认市场词。'}</p></div>
                <div className="ebay-market-latest-terms"><b>建议用于标题的已确认市场词</b><div>{confirmedMarketTermStats.length?confirmedMarketTermStats.slice(0,8).map(item=><span key={`${item.term}:${item.count}`}>{item.term} · {item.count}次 / {item.coverage}%</span>):<small>尚无已确认市场词，请在下方核对候选词。</small>}</div></div>
                {reviewMarketTermItems.length?<details className="ebay-market-keyword-review"><summary>核对 {reviewMarketTerms} 个候选市场词</summary>{reviewMarketTermItems.map(item=><article key={`${item.kind}:${item.term}`}><div><b>{item.term}</b><small>{item.count}次 · 覆盖 {item.coverage}% · {item.factSource}</small></div><span className="ebay-market-term-actions"><button disabled={busy===`market-decision:${item.kind}:${item.term}`} onClick={()=>void decideMarketTerm(item.kind,item.term,'CONFIRMED')}>确认使用</button><button className="excluded" disabled={busy===`market-decision:${item.kind}:${item.term}`} onClick={()=>void decideMarketTerm(item.kind,item.term,'EXCLUDED')}>排除</button></span></article>)}</details>:null}
              </div>
            </>:<div className="ebay-ai-placeholder">输入核心商品词后检索 eBay 已成交市场数据。系统会在应用内新建研究页，并在这里保留最新结论。</div>}
          </section>
          {/* 旧版市场分析过程区已停止渲染，仅保留最新结论和关键词核对。 
          <section className="ebay-market-research">
            <div className="ebay-market-controls"><label>核心商品词<input value={researchQuery} onChange={event=>updateResearchQuery(event.target.value)} placeholder="例如 Jersey Display Frame"/></label><label>时间范围<select value={researchPeriod} onChange={event=>setResearchPeriod(Number(event.target.value) as 30|90|365)}><option value={30}>近30天</option><option value={90}>近90天</option><option value={365}>近365天</option></select></label><div className="ebay-market-actions"><button className="primary" disabled={busy==='market-research'||!researchQuery.trim()} onClick={()=>void runMarketResearch()}>{busy==='market-research'?'后台搜索中…':'搜索并分析市场'}</button></div></div>
            {marketResearch?<>
              {!marketResearchCurrent&&<div className="ebay-market-stale">调研条件已变化，这份数据不能用于生成标题，请重新获取。</div>}
              <div className="ebay-market-snapshot-context"><b>本次研究条件</b><span>{marketResearch.query}</span><span>近 {marketResearch.periodDays} 天</span><span>{marketResearch.categoryName||'全部类目'}</span><span>{marketResearch.condition||'未限定 Condition'}</span>{marketResearch.filters?.map((filter,index)=><span key={`${filter.label}:${filter.value}:${index}`}>{filter.value}</span>)}</div>
              <div className="ebay-market-summary"><span><b>{marketResearch.sampleCount}</b><small>去重有效样本{marketResearch.rawSampleCount&&marketResearch.rawSampleCount!==marketResearch.sampleCount?` / 原始 ${marketResearch.rawSampleCount}`:''}</small></span><span><b>{marketAnalysisSampleCount}</b><small>进入标题分析的前排样本</small></span><span><b>{marketRankingLabel}</b><small>{marketResearch.rankingBasis==='SOLD_QUANTITY'?`销量证据 ${marketResearch.soldQuantityEvidenceCount||0}/${marketResearch.sampleCount}`:'销量字段不足，不冒充销量榜'}</small></span><span><b>{marketResearch.source==='EBAY_PRODUCT_RESEARCH'?'Product Research':'Sold & Completed'}</b><small>{marketResearch.captureMode==='AUTOMATIC'?'后台真实搜索快照':'人工筛选页面快照'}</small></span>{marketResearch.metrics.map(metric=><span key={metric.key}><b>{metric.value}</b><small>{metric.label}{metric.available?'':'（页面未提供）'}</small></span>)}</div>
              {marketResearch.findings?.length?<div className="ebay-market-findings"><b>市场分析报告</b><div>{marketResearch.findings.map(item=><article className={item.level.toLowerCase()} key={item.key}><span>{item.title}</span><strong>{item.conclusion}</strong><small>{item.evidence}</small></article>)}</div></div>:null}
              <details className="ebay-market-history">
                <summary><span><b>历史研究与趋势</b><small>已保存 {marketResearchHistory.length} 次市场研究 · 同条件历史 {comparableMarketResearch.length} 次</small></span><em>{previousMarketResearch?'可对比':'等待下一次同条件研究'}</em></summary>
                {previousMarketResearch?<div className="ebay-market-trends"><header><span>当前：{new Date(marketResearch.fetchedAt).toLocaleString('zh-CN')}</span><span>上次：{new Date(previousMarketResearch.fetchedAt).toLocaleString('zh-CN')}</span></header>{marketTrendRows.length?<div>{marketTrendRows.map(item=><article className={item.direction.toLowerCase()} key={item.key}><small>{item.label}</small><b>{item.current}</b><span>{item.direction==='UP'?'↑':item.direction==='DOWN'?'↓':'→'} 上次 {item.previous}</span></article>)}</div>:<p>两次研究没有同时提供可比较的指标；系统不会用缺失数据推算趋势。</p>}</div>:<div className="ebay-market-history-empty">保持关键词、类目、Condition 和时间范围一致，再采集一次即可生成趋势。</div>}
                <div className="ebay-market-history-list">{marketResearchHistory.slice(0,8).map(item=><article key={item.id}><div><b>{new Date(item.fetchedAt).toLocaleString('zh-CN')}</b><small>{item.query} · 近 {item.periodDays} 天 · {item.categoryName||'全部类目'}</small></div><span>{item.sampleCount} 个样本</span><em className={sameEbayResearchConditions(item,marketResearch)?'same':'different'}>{item.id===marketResearch.id?'本次':sameEbayResearchConditions(item,marketResearch)?'同条件':'不同条件'}</em></article>)}</div>
              </details>
              {marketDecision&&<div className={`ebay-market-decision-report ${marketDecision.titleReadiness.toLowerCase()}`}>
                <header><div><small>PHASE 3 · DECISION REPORT</small><b>市场决策与标题门禁</b><p>{marketDecision.summary}</p></div><span>{marketDecision.titleReadiness==='READY'?'可生成标题':marketDecision.titleReadiness==='REVIEW'?'需人工复核':'暂不可生成'}</span></header>
                <div className="ebay-market-decision-metrics"><span><b>{marketDecision.confidence==='HIGH'?'高':marketDecision.confidence==='MEDIUM'?'中':'低'}</b><small>标题数据可信度</small></span><span><b>{marketDecision.analysisSampleCount}</b><small>前排分析样本</small></span><span><b>{marketDecision.rankingBasis==='SOLD_QUANTITY'?'销量排序':'结果顺序'}</b><small>排名依据</small></span><span><b>{marketDecision.comparableSnapshotCount}</b><small>同条件历史</small></span><span><b>{marketDecision.confirmedTerms.length}</b><small>已确认市场词</small></span><span><b>{marketDecision.missingMetrics.length}</b><small>缺失指标</small></span></div>
                <div className="ebay-market-decision-signals">{marketDecision.signals.map(item=><article className={item.status.toLowerCase()} key={item.key}><span>{item.label}</span><b>{item.conclusion}</b><small>{item.evidence}</small></article>)}</div>
                <footer><span>证据快照：{marketDecision.currentSnapshotId.slice(0,8)}{marketDecision.previousSnapshotId?` · 对比 ${marketDecision.previousSnapshotId.slice(0,8)}`:' · 无同条件对比快照'}</span><span>{marketDecision.missingMetrics.length?`未取得：${marketDecision.missingMetrics.join('、')}`:'7 项市场指标均已取得'}</span></footer>
              </div>}
              <div className="ebay-market-decision-summary"><b>前 {marketAnalysisSampleCount} 个样本 · 市场词人工决策</b><span>已确认 {confirmedMarketTerms}</span><span>待核对 {reviewMarketTerms}</span><span>已排除 {excludedMarketTerms}</span><small>词频只统计标题分析池；标题只会使用“已确认”市场词，待核对和已排除词不会进入生成依据。</small></div>
              <div className="ebay-market-evidence">
                <div><b>前 {marketAnalysisSampleCount} 个标题 · 关键词与事实交集</b>{marketResearch.keywords.map(item=><p key={item.term}><strong>{item.term}</strong><span>{item.count}次 · {item.coverage}%</span><em className={item.factStatus.toLowerCase()}>{item.factStatus==='CONFIRMED'?'已确认':item.factStatus==='EXCLUDED'?'已排除':'待核对'}</em><small>{item.factSource}</small><span className="ebay-market-term-actions"><button className={item.factStatus==='CONFIRMED'?'active':''} disabled={busy===`market-decision:KEYWORD:${item.term}`} onClick={()=>void decideMarketTerm('KEYWORD',item.term,'CONFIRMED')}>确认使用</button><button className={item.factStatus==='EXCLUDED'?'excluded active':''} disabled={busy===`market-decision:KEYWORD:${item.term}`} onClick={()=>void decideMarketTerm('KEYWORD',item.term,'EXCLUDED')}>排除</button>{item.factSource.startsWith('人工')&&<button disabled={busy===`market-decision:KEYWORD:${item.term}`} onClick={()=>void decideMarketTerm('KEYWORD',item.term,'REVIEW')}>恢复待核对</button>}</span></p>)}</div>
                <div><b>前 {marketAnalysisSampleCount} 个标题 · 高频词组合</b>{marketResearch.combinations.map(item=><p key={item.term}><strong>{item.term}</strong><span>{item.count}次 · {item.coverage}%</span><em className={item.factStatus.toLowerCase()}>{item.factStatus==='CONFIRMED'?'已确认':item.factStatus==='EXCLUDED'?'已排除':'待核对'}</em><small>{item.factSource}</small><span className="ebay-market-term-actions"><button className={item.factStatus==='CONFIRMED'?'active':''} disabled={busy===`market-decision:COMBINATION:${item.term}`} onClick={()=>void decideMarketTerm('COMBINATION',item.term,'CONFIRMED')}>确认使用</button><button className={item.factStatus==='EXCLUDED'?'excluded active':''} disabled={busy===`market-decision:COMBINATION:${item.term}`} onClick={()=>void decideMarketTerm('COMBINATION',item.term,'EXCLUDED')}>排除</button>{item.factSource.startsWith('人工')&&<button disabled={busy===`market-decision:COMBINATION:${item.term}`} onClick={()=>void decideMarketTerm('COMBINATION',item.term,'REVIEW')}>恢复待核对</button>}</span></p>)}</div>
              </div>
              <details className="ebay-market-samples"><summary>查看标题分析池：前 {marketAnalysisSampleCount} 个有效样本（共 {marketResearch.sampleCount} 个）· {marketRankingLabel}</summary>{marketResearch.samples.slice(0,marketAnalysisSampleCount).map((sample,index)=><article key={`${sample.url}:${index}`}><span>{index+1}</span><div><b>{sample.title}</b><small>{sample.price?`${sample.currency} ${sample.price}`:'价格未读取'}{sample.soldQuantity?` · 已售 ${sample.soldQuantity}`:''}{sample.soldDate?` · 成交 ${sample.soldDate}`:''}</small></div></article>)}</details><button className="ebay-market-source" onClick={()=>activeStore&&void window.desktop.ebay.openProduct(activeStore.id,marketResearch.sourceUrl,'eBay 市场数据')}>查看 eBay 数据来源 ↗</button>
            </>:<div className="ebay-ai-placeholder">填写或确认核心商品词后点击“搜索并分析市场”。系统将在后台读取真实 eBay 数据，并保持当前 AI 优化页面不跳转。</div>}
          </section> */}
          {titleResult?<section className="ebay-title-review"><header><div><small>PHASE 4 · TITLE REVIEW</small><b>六套标题方案审核与确认</b><p>按搜索词、参数、卖点、场景和购买意图生成；中文仅供理解，不会写入 eBay。</p></div><span className={titleDecisionCurrent?'confirmed':'pending'}>{titleDecisionCurrent?'已确认':'待确认'}</span></header><div className="ebay-title-variants">{titleResult.variants.map(variant=>{const audit=auditEbayTitle(variant.title,selectedOriginalTitle,confirmedMarketTermStats,selectedTitleVerifiedFacts);const idealLength=audit.characterCount>=62&&audit.characterCount<=80;return <label className={selectedTitle===variant.title?'selected':''} key={variant.id}><input type="radio" name="title-variant" checked={selectedTitle===variant.title} onChange={()=>setSelectedTitle(variant.title)}/><span><b>{variant.name}</b><em>{audit.characterCount}/80</em></span><strong>{variant.title}</strong><div className="ebay-title-chinese"><small>中文直译</small><p>{titleVariantTranslations[variant.title]||(titleVariantTranslationLoading?'正在生成中文直译…':'中文直译暂不可用')}</p></div><div className="ebay-title-audit-badges"><em className={audit.withinLimit?'pass':'fail'}>{audit.withinLimit?'不超过80字':'超过80字'}</em><em className={idealLength?'pass':'recommend'}>{idealLength?'长度62–80字':'已核实信息不足62字'}</em><em className={audit.duplicateTerms.length?'fail':'pass'}>{audit.duplicateTerms.length?`重复：${audit.duplicateTerms.join('、')}`:'无重复词'}</em><em className={audit.unverifiedTerms.length?'fail':'pass'}>{audit.unverifiedTerms.length?`未核实：${audit.unverifiedTerms.join('、')}`:'商品事实已核对'}</em></div><small>命中市场词：{audit.confirmedTermHits.join('、')||'无'}{variant.rationale?` · ${variant.rationale}`:''}</small></label>})}</div><div className="ebay-title-comparison"><article><small>eBay 原标题</small><b>{selectedOriginalTitle}</b></article><article><small>待采用标题</small><b>{selectedTitle}</b></article></div><footer><div>{selectedTitleAudit?.passed?<><b>自动检查通过</b><small>命中市场词：{selectedTitleAudit.confirmedTermHits.join('、')}</small></>:<><b>自动检查未通过</b><small>{selectedTitleAudit?.unverifiedTerms.length?`存在未核实词：${selectedTitleAudit.unverifiedTerms.join('、')}`:'请选择合格方案'}</small></>}</div><button className="primary" disabled={!selectedTitleAudit?.passed||busy==='confirm-title'||titleDecisionCurrent} onClick={()=>void confirmTitleDecision()}>{busy==='confirm-title'?'保存审核中…':titleDecisionCurrent?'标题已确认':'确认采用此标题'}</button></footer>{titleDecision&&!titleDecisionCurrent&&<div className="ebay-title-stale">已有审核记录，但市场证据或当前选择已变化，需要重新确认。</div>}</section>:<div className="ebay-ai-placeholder">{!marketResearch?'请先检索 eBay 已成交市场数据。':!marketResearchCurrent?'检索条件已变化，请重新检索已成交市场数据。':confirmedMarketTerms?'已确认市场词，可以生成标题方案。':'请至少确认一个与商品事实一致的市场词。'}</div>}
          <button className="primary" disabled={busy==='optimize-title'||!selectedOriginalTitleVerified||!marketResearchCurrent||marketDecision?.titleReadiness==='BLOCKED'||!confirmedMarketTerms} onClick={()=>void optimizeTitle()}>{busy==='optimize-title'?'正在生成六套标题方案…':titleResult?'换一批六套标题方案':'生成六套标题方案'}</button>
          {titleDecision&&<section className={`ebay-title-save-state ${titleDecisionCurrent?'saved':'stale'}`}><span>{titleDecisionCurrent?'✓':'!'}</span><div><b>{titleDecisionCurrent?'标题方案已确认并保存':'标题方案已变化，需要重新确认'}</b><p>{titleDecisionCurrent?'本环节只保存标题和证据快照，不会打开或写入 eBay。完成其他优化后，在“线上发布”统一检查并交付。':'市场证据或当前选择已变化，旧标题不会进入最终发布资料。'}</p></div><em>{titleDecisionCurrent?'等待最终发布确认':'待重新确认'}</em></section>}
        </div>}
        {optimizeMode==='image'&&<div className="ebay-image-workbench">
          <div className="ebay-original-gallery-heading"><div><b>eBay 原商品图片 · 已保留 {activeImageSourceImages.length}/{selectedSourceImages.length}</b><small>每张原图的用途、排除/保留与参考选择已合并到上方“图片视觉规则检查”卡片；标记为“不使用”不会删除 eBay 原图。</small></div><span className="ebay-original-gallery-heading-actions">{extraImageSourceEntries.length?<button type="button" className="ebay-original-gallery-collapse" aria-expanded={extraGalleryOpen} onClick={()=>setExtraGalleryOpen(open=>!open)}>{extraGalleryOpen?'收起其他原图 ▴':`展开其他 ${extraImageSourceEntries.length} 张原图 ▾`}</button>:null}<button disabled={busy===`details:${selectedListing.id}`} onClick={()=>void syncListingDetails()}>{busy===`details:${selectedListing.id}`?'正在读取…':selectedSourceImages.length>1?'重新读取eBay原图':'读取eBay全部原图'}</button></span></div>
          {!selectedSourceImages.length&&<div className="ebay-ai-placeholder">尚未读取原商品图集。系统会自动尝试同步，也可以点击上方按钮重新读取。</div>}
          {extraGalleryOpen&&extraImageSourceEntries.length?<div className="ebay-original-gallery-extra">{extraImageSourceEntries.map(({url,originalIndex,enabled,role})=><article className={enabled?'':'excluded'} key={url}><img src={url} alt={`eBay原图 ${originalIndex+1}`}/><span>{originalIndex===0?'原主图':`原图 ${originalIndex+1}`}</span><select aria-label={`原图 ${originalIndex+1} 用途`} value={role} onChange={event=>updateImageSourceCuration(url,event.target.value as EbayImageSourceRole)}>{ebayImageSourceRoles.map(option=><option key={option} value={option}>{ebayImageSourceRoleLabels[option]}</option>)}</select><button type="button" onClick={()=>updateImageSourceCuration(url,enabled?'UNUSED':'DETAIL')}>{enabled?'排除':'保留'}</button></article>)}</div>:null}
          <section className="ebay-image-grounding"><header><div><b>全图商品事实卡</b><small>{imageGroundingPlan?`已由 ${imageGroundingPlan.model} 分析 ${activeImageSourceImages.length} 张已保留原图 · ${new Date(imageGroundingPlan.analyzedAt).toLocaleString()}`:'生成前会先识别已保留原图中的可售商品主体、结构、材质与真实使用关系。'}</small></div><button disabled={!activeImageSourceImages.length||busy==='image-grounding'||busy==='optimize-image'} onClick={()=>void analyzeImageSources()}>{busy==='image-grounding'?'分析中…':imageGroundingPlan?'重新分析已保留原图':'分析已保留原图'}</button></header>{imageGroundingPlan?<><p><b>商品主体：</b>{imageGroundingPlan.productIdentity}</p><div><span><b>锁定事实</b>{imageGroundingPlan.verifiedFacts.slice(0,5).join('；')||'待人工确认'}</span><span><b>用途参照</b>{ebayImagePurposes.map(purpose=>`${ebayImagePurposeLabels[purpose]}：${(imageGroundingPlan.purposeReferences[purpose]||[]).map(index=>`原图${(activeImageSourceEntries[index]?.originalIndex??index)+1}`).join('、')||'未确定'}`).join(' · ')}</span></div>{imageGroundingPlan.warnings.map(warning=><small className="warning" key={warning}>注意：{warning}</small>)}</>:<p>请先为原图标记用途并保留参照，再点击“分析已保留原图”建立生成依据。</p>}</section>
          <div className="ebay-image-generation-heading"><div><b>图片优化 · 02 AI优化</b><small>系统按比例生成主图、详情图、解决痛点图和应用场景图；草稿不会覆盖原图。</small></div><span className="ebay-image-phase-status">{acceptedImagePurposes.length?`已确认 ${acceptedImagePurposes.length}/4 类`:generatedImageCount?`已生成 ${generatedImageCount} 张，待确认`:'待一键生成'}</span></div>
          <section className="ebay-image-evidence"><header><b>本次生成依据</b><small>{contentResult?'已读取“描述优化”的事实、购买理由和场景':'尚未生成“描述优化”，本次仅使用原商品标题、属性与初检结果'}</small></header><div><article><strong>{imageVisualReport?.failed||0}</strong><span>初检不通过</span></article><article><strong>{contentResult?.sourceFacts.length||0}</strong><span>已核实事实</span></article><article><strong>{contentResult?.benefits.length||0}</strong><span>购买理由</span></article><article><strong>{contentResult?.scenarios.length||0}</strong><span>应用场景</span></article></div></section>
          <div className="ebay-image-settings ebay-image-settings-compact"><section><label>固定 AI 生图模型<select value={imageModel} disabled aria-label="固定 AI 生图模型">{imageModels.map(model=><option value={model.id} key={model.id}>{model.name} · 本月已生成 {imageModelUsage[model.id]||0} 张</option>)}</select></label>{selectedImageModel?<p><b>{selectedImageModel.name}</b><span>eBay 图片优化固定使用此模型；{selectedImageModel.description}</span><small>{selectedImageModel.id} · 本项目本月已生成 {imageModelUsage[selectedImageModel.id]||0} 张</small></p>:<div className="ebay-ai-placeholder">暂无可用百炼生图模型</div>}</section><section className="ebay-image-generation-options"><b>生成总数量</b><div>{[4,8,12].map(count=><button type="button" key={count} className={imageTotalCount===count?'active':''} onClick={()=>setImageTotalCount(count)}>{count===4?'快速 4 张':count===8?'推荐 8 张':'完整 12 张'}</button>)}</div><label className="ebay-image-custom-count">自定义总数量<input type="number" min="4" max="20" value={imageTotalCount} onChange={event=>setImageTotalCount(Math.min(20,Math.max(4,Number(event.target.value)||4)))} /></label><small>自动分配：产品主图 {plannedImageCounts.HERO} 张 · 产品详情图 {plannedImageCounts.DETAIL} 张 · 解决痛点图 {plannedImageCounts.PAIN_POINT} 张 · 应用场景图 {plannedImageCounts.SCENE} 张</small><label>补充要求<textarea value={imageExtraPrompt} onChange={event=>setImageExtraPrompt(event.target.value)} placeholder="例如：重点展示已核实的安装方式；不得改变产品颜色。请勿填写未经核实的卖点。"/></label></section></div>
          {/* 单模型流程不再展示模型 A/B 测试。 */}
          {/* <section className="ebay-image-model-ab">
            <header>
              <div><b>模型 A/B 测试</b><small>同一商品事实卡、同一主图分镜、同一原图参照，各生成 1 张 2K 主图。先以自动质量门槛决定胜出模型，质量分接近时才比较生成耗时。</small></div>
              <span className={imageDefaultModel?'ready':'pending'}>{imageDefaultModel?`默认：${imageModels.find(model=>model.id===imageDefaultModel)?.name||imageDefaultModel}`:'尚未完成 A/B 测试'}</span>
            </header>
            <div className="ebay-image-model-ab-controls">
              <div className="ebay-image-model-ab-baseline"><b>基准模型</b><strong>{selectedImageModel?.name||'请先选择模型'}</strong><small>使用上方“AI 生图模型”当前选择</small></div>
              <label>对照模型<select value={imageAbChallenger} onChange={event=>setImageAbChallenger(event.target.value)} disabled={busy==='image-model-ab'}>{imageModels.filter(model=>model.id!==imageModel).map(model=><option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
              <button type="button" className="primary" disabled={!activeImageSourceImages.length||imageModels.length<2||busy==='image-model-ab'} onClick={()=>void runImageModelAbTest()}>{busy==='image-model-ab'?'正在执行 A/B…':'执行主图 A/B 测试（2 张）'}</button>
            </div>
            <p>本次测试会实际调用两个模型，各生成 1 张图片并计入本月模型用量；不会替换当前草稿、原图或 eBay 线上图片。</p>
            {imageAbRun?<div className="ebay-image-model-ab-result"><header><b>{imageAbRun.winnerModelId?'✓ 已决定默认模型':'A/B 测试未决定默认模型'}</b><small>{new Date(imageAbRun.createdAt).toLocaleString('zh-CN')}</small></header><div>{imageAbRun.candidates.map(candidate=>{const model=imageModels.find(item=>item.id===candidate.modelId);const quality=candidate.review?ebayImageModelQualityScore(candidate.review):0;return <article className={`${candidate.modelId===imageAbRun.winnerModelId?'winner':''} ${candidate.review?.status==='PASSED'?'passed':'blocked'}`} key={candidate.modelId}>{candidate.imageUrl?<img src={candidate.imageUrl} alt={`${model?.name||candidate.modelId} A/B 测试结果`}/>:<span className="ab-image-placeholder">未生成</span>}<b>{model?.name||candidate.modelId}</b>{candidate.review?<small>{candidate.review.status==='PASSED'?`通过 · 综合 ${quality.toFixed(1)}`:`未通过 · ${candidate.review.reason}`}</small>:<small>{candidate.error||'等待生成和复核'}</small>}<em>{candidate.elapsedMs?`${(candidate.elapsedMs/1000).toFixed(1)} 秒`:''}</em></article>})}</div><p>{imageAbRun.reason}</p></div>:null}
            {imageAbHistory.length>1?<small className="ebay-image-model-ab-history">已保存最近 {imageAbHistory.length} 次 A/B 记录（本机浏览器存储）。</small>:null}
          </section> */}
          <section className="ebay-image-storyboard-cards"><header><div><b>强制分镜卡 · {plannedImageShots.length} 张</b><small>每张草稿只能按对应卡片生成；卡片会同时传入生图模型与一致性复核，不符合"镜头任务、内容依据、验收标准、禁止项"的结果会被拦截。</small></div><span>{imageGroundingPlan?'✓ 已绑定全图事实':'等待全图事实卡'}</span></header><div>{plannedImageShots.map(shot=>{const refs=imageShotReferenceIndices(shot);const isEditable=shot.purpose==='PAIN_POINT'||shot.purpose==='SCENE';const isEditing=editingShot===shot.code;const editData=shotEdits[shot.code];const benefit=contentResult?.benefits?.length?contentResult.benefits[shot.index%contentResult.benefits.length]:undefined;const scenario=contentResult?.scenarios?.length?contentResult.scenarios[shot.index%contentResult.scenarios.length]:undefined;const defaultPainPoint=editData?.painPoint!==undefined?editData.painPoint:benefit?.painPoint||'';const defaultSolution=editData?.solution!==undefined?editData.solution:benefit?.solution||'';const defaultBenefit=editData?.customerBenefit!==undefined?editData.customerBenefit:benefit?.customerBenefit||'';const defaultTitle=editData?.title!==undefined?editData.title:scenario?.title||'';const defaultDesc=editData?.description!==undefined?editData.description:scenario?.description||'';const evidence=editData?shot.purpose==='PAIN_POINT'?`已核实痛点：${defaultPainPoint}；对应方案：${defaultSolution}；购买利益：${defaultBenefit}。`:shot.purpose==='SCENE'?`已核实应用场景：${defaultTitle}；${defaultDesc}。`:shot.evidence:shot.evidence;return <article key={shot.code} className={isEditable?'editable':''}><em>{shot.code}</em><div><b>{ebayImagePurposeLabels[shot.purpose]} · {shot.title}</b>{isEditing?<div className="ebay-shot-edit">{(shot.purpose==='PAIN_POINT')&&<><label>痛点：<textarea rows={2} defaultValue={defaultPainPoint} onChange={e=>{const next={...shotEdits,[shot.code]:{...shotEdits[shot.code],painPoint:e.target.value}};setShotEdits(next)}}/></label><label>对应方案：<textarea rows={2} defaultValue={defaultSolution} onChange={e=>{const next={...shotEdits,[shot.code]:{...shotEdits[shot.code],solution:e.target.value}};setShotEdits(next)}}/></label><label>购买利益：<textarea rows={2} defaultValue={defaultBenefit} onChange={e=>{const next={...shotEdits,[shot.code]:{...shotEdits[shot.code],customerBenefit:e.target.value}};setShotEdits(next)}}/></label></>}{(shot.purpose==='SCENE')&&<><label>场景标题：<input defaultValue={defaultTitle} onChange={e=>{const next={...shotEdits,[shot.code]:{...shotEdits[shot.code],title:e.target.value}};setShotEdits(next)}}/></label><label>场景描述：<textarea rows={2} defaultValue={defaultDesc} onChange={e=>{const next={...shotEdits,[shot.code]:{...shotEdits[shot.code],description:e.target.value}};setShotEdits(next)}}/></label></>}<div className="ebay-shot-edit-actions"><button type="button" onClick={()=>setEditingShot(null)}>保存修改</button><button type="button" onClick={()=>{const next={...shotEdits};delete next[shot.code];setShotEdits(next);setEditingShot(null)}}>取消</button></div></div>:<>{isEditable?<small><strong>内容依据：</strong>{evidence}<button type="button" className="ebay-shot-edit-btn" onClick={()=>setEditingShot(shot.code)}>编辑</button></small>:<small><strong>内容依据：</strong>{evidence}</small>}</>}<small><strong>原图参照：</strong>{refs.length?refs.map(index=>{const entry=activeImageSourceEntries[index];return `原图${(entry?.originalIndex??index)+1}${entry?`（${ebayImageSourceRoleLabels[entry.role]}）`:''}`}).join('、'):'待全图分析后确定'}</small><small><strong>验收：</strong>{shot.acceptance}</small><small className="prohibited"><strong>禁止：</strong>{shot.prohibited}</small></div></article>})}</div></section>
          <section className="ebay-image-quality-gate"><header><div><b>自动质量门槛</b><small>系统自动复核；只有全部达标的草稿才能被选中、确认采用和进入自然化处理。审核服务异常或未完成时同样拦截。</small></div><span>硬性拦截</span></header><div><article><strong>≥ 90</strong><small>商品一致性</small></article><article><strong>≥ 88</strong><small>结构保留</small></article><article><strong>≥ 88</strong><small>事实准确</small></article><article><strong>≥ 85</strong><small>分镜完成</small></article><article><strong>≥ 75</strong><small>同用途差异</small></article></div><p>差异度仅在同用途已有草稿时比较；首张按 100 分计算。任一项不达标，或审核未完成，均不会进入后续确认流程。</p></section>
          <div className="ebay-image-truth-guard"><b>商品一致性保护</b><span>锁定商品形状、结构、比例、颜色、材质、配件和包装事实</span><span>禁止虚构功能、配件、文字、Logo、水印、促销标签和测量标注</span></div>
          {generatedImageCount>0&&<section className="ebay-image-candidate-groups"><header><div><b>AI 图片草稿 · {generatedImageCount} 张</b><small>每张草稿均按独立分镜卡、原图参照和自动质量门槛生成。未通过或审核未完成的草稿不能采用；可先查看审核说明，再使用下方“重新生成整套图片”。</small></div></header>{ebayImagePurposes.map(purpose=>{const result=imageResults[purpose];const selectedUrl=selectedGeneratedImages[purpose];return result?<section className="ebay-image-candidates" key={purpose}><header><div><b>{ebayImagePurposeLabels[purpose]} · {result.imageUrls.length} 张</b><small>{purpose==='HERO'?'商品完整、白底、无文字':purpose==='DETAIL'?'结构材质与核心细节':purpose==='PAIN_POINT'?'以已核实痛点和解决方案为依据':'符合真实用途的应用环境'}</small></div><span>{confirmedGeneratedImages[purpose]?'✓ 已确认':'待确认'}</span></header><div className="ebay-generated-images">{result.imageUrls.map((url,index)=>{const review=imageCandidateReviews[purpose]?.find(item=>item.candidateUrl===url);const shot=plannedImageShots.find(item=>item.purpose===purpose&&item.index===index);const passed=review?.status==='PASSED';return <article className={`${selectedUrl===url?'selected':''} ${passed?'passed':'rejected'}`} key={url}><button type="button" disabled={!passed} onClick={()=>setSelectedGeneratedImages(current=>({...current,[purpose]:url}))}><img src={url} alt={`${ebayImagePurposeLabels[purpose]}草稿 ${index+1}`}/><span className="ebay-generated-image-status">{ebayImageCandidateStatus(review)}</span></button><div className="ebay-generated-image-meta"><b>{shot?`${shot.code} · ${shot.title}`:`草稿 ${index+1}`}</b>{shot&&<small>{(()=>{const ed=shotEdits[shot.code];if(!ed)return shot.evidence;const eb=contentResult?.benefits?.[shot.index%contentResult.benefits.length];const es=contentResult?.scenarios?.[shot.index%contentResult.scenarios.length];if(shot.purpose==='PAIN_POINT')return'已核实痛点：'+(ed.painPoint??eb?.painPoint??'')+'；对应方案：'+(ed.solution??eb?.solution??'')+'；购买利益：'+(ed.customerBenefit??eb?.customerBenefit??'')+'。';if(shot.purpose==='SCENE')return'已核实应用场景：'+(ed.title??es?.title??'')+'；'+(ed.description??es?.description??'')+'。';return shot.evidence})()}</small>}{review&&<details><summary>查看审核说明</summary><p>{review.reason}</p></details>}</div></article>})}</div><footer><small>仅已通过自动质量门槛的草稿可确认采用；确认仅保存本地优化选择，不会修改 eBay 线上刊登。</small><button className="primary" disabled={!selectedUrl||imageCandidateReviews[purpose]?.find(item=>item.candidateUrl===selectedUrl)?.status!=='PASSED'} onClick={()=>acceptGeneratedImage(purpose)}>{confirmedGeneratedImages[purpose]===selectedUrl?'✓ 当前图片已确认':`确认采用${ebayImagePurposeLabels[purpose]}`}</button></footer></section>:null})}</section>}
          {generatedImageCount>0&&<section className="ebay-image-adoption"><header><div><b>最终采用清单</b><small>每类最终图都保留“原图参照、分镜任务、质量门槛和本地最终选择”的追溯记录。</small></div><span>{imageNaturalizationComplete?'✓ 4 类最终图已确认':`已确认 ${acceptedImagePurposes.length}/4 类 · 已完成自然化 ${Object.keys(naturalizeChoices).length}/4 类`}</span></header><div className="ebay-image-adoption-grid">{acceptedImageTrace.map(item=>{const sourceLabels=item.referenceIndices.map(index=>{const entry=activeImageSourceEntries[index];return entry?`原图${entry.originalIndex+1}（${ebayImageSourceRoleLabels[entry.role]}）`:`原图${index+1}`});const finalStatus=!item.imageUrl?'待确认采用':!item.choice?'已确认，待自然化':item.choice==='processed'?'已确认自然化稿':'已保留 AI 优化稿';const quality=item.review?ebayImageModelQualityScore(item.review).toFixed(1):'';return <article className={`${item.imageUrl?'confirmed':'missing'} ${item.choice?'final':''}`} key={item.purpose}>{item.imageUrl?<img src={item.imageUrl} alt={`${ebayImagePurposeLabels[item.purpose]}已确认稿`}/>:<div className="ebay-image-adoption-placeholder">待确认</div>}<div><b>{ebayImagePurposeLabels[item.purpose]}</b><em>{finalStatus}</em><small>{item.shot?`${item.shot.code} · ${item.shot.title}`:'请从已通过质量门槛的草稿中确认采用'}</small><small>原图参照：{sourceLabels.join('、')||'等待全图事实卡'}</small>{item.review&&<small>质量分 {quality} · {item.review.status==='PASSED'?'已通过自动门槛':'未通过自动门槛'}</small>}</div></article>})}</div><footer>四类图片均完成“确认采用 + 最终选择”后，系统才会自动启动最终图集复检；未通过复检或未完成的图片不能进入优品仓库。</footer></section>}
          <div className="ebay-image-generate-action">
            {imageGenerationRun.phase!=='IDLE'&&<div className={`ebay-image-run-status ${imageGenerationRun.phase.toLowerCase()}`} role="status"><b>{imageGenerationRun.phase==='GROUNDING'?'正在建立全图事实卡':imageGenerationRun.phase==='GENERATING'?'正在生成图片':imageGenerationRun.phase==='REVIEWING'?'正在复核商品一致性':imageGenerationRun.phase==='DONE'?'本次生成已完成':'本次生成未完成'}</b><span>{imageGenerationRun.message}</span>{imageGenerationRun.total>0&&imageGenerationRun.phase!=='GROUNDING'&&<em>{imageGenerationRun.completed}/{imageGenerationRun.total} 张</em>}</div>}
            <button className="primary ebay-image-generate" disabled={!activeImageSourceImages.length||!imageModel||busy==='optimize-image'||busy==='image-grounding'} onClick={()=>void optimizeImage()}>{imageGenerationRun.phase==='GROUNDING'?'正在分析已保留原图…':imageGenerationRun.phase==='GENERATING'?'百炼正在按强制分镜生成…':imageGenerationRun.phase==='REVIEWING'?'正在复核商品一致性…':generatedImageCount?'按强制分镜卡重新生成整套图片':`按强制分镜卡生成 ${imageTotalCount} 张图片`}</button>
          </div>
          <section className={`ebay-image-naturalize ${acceptedImagePurposes.length?'':'disabled'}`}>
            <header><div><b>图片优化 · 03 图片自然化处理</b><small>本机调整第二阶段确认稿的纹理、色彩与摄影质感，原图始终保留。</small></div><span>{imageNaturalizationComplete?'✓ 03 已完成':`已确认 ${Object.keys(naturalizeChoices).length}/${acceptedImagePurposes.length}`}</span></header>
            {acceptedImagePurposes.length?<ImageNaturalizePanel purposes={acceptedImagePurposes} purpose={naturalizePurpose} onPurpose={setNaturalizePurpose} profile={naturalizeProfile} onProfile={setNaturalizeProfile} results={naturalizeResults} choices={naturalizeChoices} busy={busy} onRun={()=>void runImageNaturalization()} onConfirm={choice=>void confirmNaturalizedImage(choice)}/>:<div className="ebay-ai-placeholder">请先在 02 AI优化中生成图片并点击“确认采用当前图片”。</div>}
          </section>
          {imageNaturalizationComplete&&<section className={`ebay-final-image-set ${finalImageInspection?.blocked?'blocked':finalImageInspectionPassed?'passed':'checking'}`}>
            <header><div><b>最终本地图集</b><small>按主图、详情图、解决痛点图、应用场景图顺序替换对应本地优化稿；其余 eBay 原图保持原顺序。</small></div><span>{finalImageChecking||!finalImageInspection?'自动检查中…':finalImageInspection.blocked?`${finalImageInspection.blocked} 张未通过`:`✓ 已检查 ${finalImageInspection.passed} 张`}</span></header>
            <div>{finalImageUrls.map((url,index)=>{
              const normalizedUrl=url.replace(/\/s-l\d+(?=\.[a-z0-9]+(?:\?|$))/i,'/s-l1600')
              const inspection=finalImageInspection?.images.find(item=>item.url===normalizedUrl)
              const label=index===0?'最终主图':index===1?'最终详情图':index===2?'最终解决痛点图':index===3?'最终应用场景图':`保留原图 ${index+1}`
              return <article className={inspection?.status==='BLOCKED'?'blocked':''} key={`${finalImageFingerprint}:${index}`}>
                <img src={url} alt={label}/>
                <b>{label}</b>
                <small>{!inspection?'待检查':inspection.status==='PASSED'?`${inspection.width}×${inspection.height} · ${inspection.format.toUpperCase()}`:inspection.findings.join('；')}</small>
              </article>
            })}</div>
            <footer>{finalImageInspectionPassed?'最终图集尺寸、格式与可读性已通过自动检查，可以进入下一环节。':finalImageInspection?.blocked?'未通过图片不会进入优品仓库，请返回对应图片类型重新生成或重新确认。':'正在读取最终图片尺寸、格式与可读性，请稍候。'}</footer>
          </section>}
        </div>}
        {optimizeMode==='content'&&<div className="ebay-description-workbench ebay-content-v2">
          <header><div><b>详情页与多语言核对</b><small>DeepSeek 负责英文内容优化；Qwen-MT Flash 按最终英文逐段翻译，中文仅用于内部核对。</small></div><button className="primary" disabled={!selectedTitle||busy==='optimize-content'} onClick={()=>void optimizeContent()}>{busy==='optimize-content'?'生成中…':contentResult?'重新生成内容方案':'生成详情内容方案'}</button></header>
          {contentResult?<>
            <div className="ebay-content-validation"><article><small>事实覆盖率</small><b>{contentResult.validation.factCoverage}%</b><span>{contentResult.validation.coveredFactCount}/{contentResult.validation.sourceFactCount} 条</span></article><article><small>数字规格</small><b>{contentResult.validation.numericFactCount}</b><span>{contentResult.validation.missingNumericFacts.length?'存在遗漏':'全部保留'}</span></article><article><small>痛点解决</small><b>{contentResult.benefits.length}</b><span>均绑定事实依据</span></article><article><small>应用场景</small><b>{contentResult.scenarios.length}</b><span>均绑定事实依据</span></article><article className={contentResult.validation.passed?'passed':'failed'}><small>完整性门禁</small><b>{contentResult.validation.passed?'通过':'拦截'}</b><span>{contentResult.validation.unsupportedClaimCount?`${contentResult.validation.unsupportedClaimCount} 项已拦截`:'0 项无依据表达'}</span></article></div>
            <details className="ebay-content-facts"><summary>查看原始事实依据 · {contentResult.sourceFacts.length} 条</summary><div>{contentResult.sourceFacts.map(fact=><article key={fact.id}><em>{fact.id}</em><span><b>{fact.sourceLabel}</b><small>{fact.text}</small></span></article>)}</div></details>
            {currentContentTranslation&&<div className="ebay-content-language-bar"><div><b>内容语言</b><small>中文仅供内部核对，不会写入 eBay</small></div><div className="ebay-translation-actions"><div className="ebay-translation-view"><button className={contentTranslationView==='ENGLISH'?'active':''} onClick={()=>setContentTranslationView('ENGLISH')}>英文</button><button className={contentTranslationView==='CHINESE'?'active':''} onClick={()=>setContentTranslationView('CHINESE')}>中文</button><button className={contentTranslationView==='BILINGUAL'?'active':''} onClick={()=>setContentTranslationView('BILINGUAL')}>中英对照</button></div><button className={`ebay-translation-sync ${staleContentTranslationCount?'pending':'synced'}`} disabled={!staleContentTranslationCount||busy==='translate-content'} onClick={()=>void syncContentTranslation()}>{busy==='translate-content'?'正在翻译…':staleContentTranslationCount?`更新中文（${staleContentTranslationCount}）`:'✓ 中文已同步'}</button></div></div>}
            {currentContentTranslation?.error&&<p className="ebay-translation-error">Qwen-MT Flash 上次未完成：{currentContentTranslation.error}</p>}
            <div className={`ebay-content-sections ${contentTranslationView.toLowerCase()}`}>{contentResult.sections.map(section=>{const titleTranslation=currentContentTranslation?.segments.find(segment=>segment.english.toLocaleLowerCase()===section.title.toLocaleLowerCase());const contentTranslations=section.content.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>currentContentTranslation?.segments.find(segment=>segment.english===line));const chineseTitle=titleTranslation?.chinese||'标题中文待更新';const chineseContent=contentTranslations.map(segment=>segment?.chinese||'该段英文已变化，请更新中文。').join('\n');const translationSynced=titleTranslation?.status==='SYNCED'&&contentTranslations.length>0&&contentTranslations.every(segment=>segment?.status==='SYNCED');return <article key={section.id} className={translationSynced?'translated':'translation-pending'}>{contentTranslationView!=='CHINESE'&&<div className="ebay-content-language-copy"><b>{section.title}</b><p>{section.content}</p></div>}{contentTranslationView!=='ENGLISH'&&<div className="ebay-content-language-copy chinese"><b>{chineseTitle}</b><p>{chineseContent}</p></div>}</article>})}</div>
            <details className="ebay-final-description"><summary><span><b>查看/编辑最终英文详情页</b><small>由上方全部结构化模块自动拼装；修改后离开输入框即保存</small></span></summary><label>最终英文详情页<textarea value={currentEnglishDescription} onChange={event=>editFinalEnglishDescription(event.target.value)} onBlur={event=>void saveFinalEnglishDescription(event.currentTarget.value)}/></label></details>
          </>:<div className="ebay-ai-placeholder">请先完成并选择标题，然后基于本地eBay完整原始详情生成内容。</div>}
          <div className="ebay-description-rules"><b>一致性保护</b><span>✓ 原始规格、包装、安装和注意事项完整保留</span><span>✓ 痛点、客户利益及场景必须绑定真实事实编号</span><span>✓ Qwen-MT Flash 逐段翻译，数字、单位、SKU 与段落顺序保持一致</span><span>✓ 中文稿不作为 eBay 发布内容</span></div>
        </div>}
        {optimizeMode==='pricing'&&<div className="ebay-profit-workbench">
          <header><div><b>售价与利润核算</b><small>录入完整经营成本，计算当前利润、保本售价与目标毛利售价。</small></div><span className={!profitAssumptions.purchaseCostCny?'pending':!pricingReady?'negative':'positive'}>{!profitAssumptions.purchaseCostCny?'待录采购成本':!pricingReady?'费率合计过高':'目标售价已生成'}</span></header>
          <div className="ebay-profit-summary">
            <article><small>eBay 当前售价</small><b>{selectedSalePrice>0?ebayDisplayPrice(selectedSaleCurrency,String(selectedSalePrice)):'售价未读取'}</b><span>来自本地商品快照</span></article>
            <article className={pricingReady?'positive':'pending'}><small>保本售价</small><b>{pricingReady?ebayDisplayPrice(selectedSaleCurrency,String(breakEvenSalePrice.toFixed(2))):'待核算'}</b><span>覆盖全部固定成本与比例费用</span></article>
            <article className={pricingReady?'positive':'pending'}><small>目标毛利售价</small><b>{pricingReady?ebayDisplayPrice(selectedSaleCurrency,String(targetSalePrice.toFixed(2))):'待核算'}</b><span>目标毛利率 {profitAssumptions.targetMarginRate.toFixed(1)}%</span></article>
            <article className={!profitReady?'pending':estimatedProfitCny>=0?'positive':'negative'}><small>当前预计利润 / 利润率</small><b>{profitReady?`¥${estimatedProfitCny.toFixed(2)}`:'待核算'}</b><span>{profitReady?`${estimatedProfitMargin.toFixed(1)}% · 总成本 ¥${totalCostCny.toFixed(2)}`:'请录入采购成本'}</span></article>
          </div>
          <div className="ebay-profit-input-groups">
            <section>
              <header><b>成本要素</b><small>全部按单件人民币口径录入</small></header>
              <div className="ebay-profit-fields">
                <label>外币→人民币核算汇率<input type="number" min="0" step="0.0001" value={profitAssumptions.exchangeRate} disabled={selectedSaleCurrency==='CNY'} onChange={event=>updateProfitAssumption('exchangeRate',event.target.value)}/><small>{selectedSaleCurrency==='CNY'?'当前售价为人民币，无需换算。':'用于售价换算和固定成交费换算。'}</small></label>
                <label>采购成本<input type="number" min="0" step="0.01" value={profitAssumptions.purchaseCostCny} onChange={event=>updateProfitAssumption('purchaseCostCny',event.target.value)}/><small>供应链采购价或含税采购价。</small></label>
                <label>物流成本<input type="number" min="0" step="0.01" value={profitAssumptions.logisticsCostCny} onChange={event=>updateProfitAssumption('logisticsCostCny',event.target.value)}/><small>头程、尾程和跨境运输。</small></label>
                <label>包装成本<input type="number" min="0" step="0.01" value={profitAssumptions.packagingCostCny} onChange={event=>updateProfitAssumption('packagingCostCny',event.target.value)}/><small>包装材料和加固耗材。</small></label>
                <label>仓配履约成本<input type="number" min="0" step="0.01" value={profitAssumptions.fulfillmentCostCny} onChange={event=>updateProfitAssumption('fulfillmentCostCny',event.target.value)}/><small>入库、拣货、出库等仓配费用。</small></label>
                <label>其他固定成本<input type="number" min="0" step="0.01" value={profitAssumptions.otherCostCny} onChange={event=>updateProfitAssumption('otherCostCny',event.target.value)}/><small>支付、税费或其他单件杂项。</small></label>
              </div>
            </section>
            <section>
              <header><b>平台与经营费率</b><small>类目规则可自动估算，也可按账单手动覆盖</small></header>
              <div className="ebay-profit-fields">
                <label>eBay 费率来源<select value={profitAssumptions.platformFeeMode} onChange={event=>updateProfitFeeMode(event.target.value as EbayProfitFeeMode)}><option value="CATEGORY_RULE">按商品类目估算</option><option value="MANUAL">手动输入费率</option></select><small>{profitAssumptions.platformFeeMode==='CATEGORY_RULE'?categoryFeeRule.label:'使用自定义平台费率和固定费。'}</small></label>
                <label>eBay 成交费率（%）<input type="number" min="0" max="100" step="0.1" value={profitAssumptions.platformFeeMode==='CATEGORY_RULE'?effectivePlatformFeeRate:profitAssumptions.platformFeeRate} disabled={profitAssumptions.platformFeeMode==='CATEGORY_RULE'} onChange={event=>updateProfitAssumption('platformFeeRate',event.target.value)}/><small>按销售额计提，不含固定成交费。</small></label>
                <label>固定成交费（人民币）<input type="number" min="0" step="0.01" value={profitAssumptions.platformFeeMode==='CATEGORY_RULE'?effectivePlatformFixedFeeCny.toFixed(2):profitAssumptions.platformFixedFeeCny} disabled={profitAssumptions.platformFeeMode==='CATEGORY_RULE'} onChange={event=>updateProfitAssumption('platformFixedFeeCny',event.target.value)}/><small>{profitAssumptions.platformFeeMode==='CATEGORY_RULE'?'按每笔订单外币固定费换算。':'填写每笔订单固定费用。'}</small></label>
                <label>推广成交佣金（%）<input type="number" min="0" max="100" step="0.1" value={profitAssumptions.promotionFeeRate} onChange={event=>updateProfitAssumption('promotionFeeRate',event.target.value)}/><small>广告成交后按销售额计提的比例。</small></label>
                <label>退货损耗预留（%）<input type="number" min="0" max="100" step="0.1" value={profitAssumptions.returnLossRate} onChange={event=>updateProfitAssumption('returnLossRate',event.target.value)}/><small>按历史退货与不可回收成本预留。</small></label>
                <label>风险缓冲（%）<input type="number" min="0" max="100" step="0.1" value={profitAssumptions.riskBufferRate} onChange={event=>updateProfitAssumption('riskBufferRate',event.target.value)}/><small>汇率波动、赔付和异常费用预留。</small></label>
              </div>
            </section>
            <section className="target">
              <header><b>目标利润</b><small>反推不亏本售价和目标毛利售价</small></header>
              <div className="ebay-profit-fields">
                <label>目标毛利率（%）<input type="number" min="0" max="80" step="0.1" value={profitAssumptions.targetMarginRate} onChange={event=>updateProfitAssumption('targetMarginRate',event.target.value)}/><small>目标毛利按销售额口径计算。</small></label>
              </div>
            </section>
          </div>
          <div className="ebay-profit-formula"><b>核算结果</b><span>当前销售额 ¥{saleRevenueCny.toFixed(2)} − 固定成本 ¥{fixedOperatingCostCny.toFixed(2)} − 平台比例费 ¥{(platformFeeCny-effectivePlatformFixedFeeCny).toFixed(2)} − 推广 ¥{promotionFeeCny.toFixed(2)} − 退货预留 ¥{returnLossCny.toFixed(2)} − 风险缓冲 ¥{riskBufferCny.toFixed(2)} = 预计利润 ¥{estimatedProfitCny.toFixed(2)}</span><span>保本价 = 固定成本 ÷（1 − 综合比例费率 {(variableCostRate*100).toFixed(1)}%）；目标售价再扣除目标毛利率 {profitAssumptions.targetMarginRate.toFixed(1)}%。</span><small>类目费率是本地规则估算，可切换为手动覆盖；最终利润以 eBay 实际账单、广告账单和物流账单为准。参数按本地产品独立保存。</small></div>
        </div>}
        {optimizeMode==='video'&&(contentResult?<EbayVideoStudio listingId={selectedListing.listingId} title={selectedTitle||selectedTitleEnglish} description={currentEnglishDescription} chineseDescription={contentResult.chineseReference||''} imageUrls={finalImageUrls} storyboard={contentResult.storyboard} imagesReady={finalImageInspectionPassed}/>:<div className="ebay-video-storyboard"><header><div><b>15秒产品视频生成</b><small>视频会直接读取描述优化内容和图片优化最终稿。</small></div><button className="primary" disabled={!selectedTitle||busy==='optimize-content'} onClick={()=>void optimizeContent()}>{busy==='optimize-content'?'生成中…':'先生成描述与视频脚本'}</button></header><div className="ebay-ai-placeholder">请先完成02描述优化，系统将自动生成视频脚本并进入方舟视频工作台。</div></div>)}
        {titleResult&&<div className="ebay-optimization-footer"><div><small>{optimizeMode==='pricing'?'保存后不会直接修改线上商品':`当前环节：${optimizeStageLabels[optimizeMode]}`}</small><b>{optimizeMode==='pricing'?(!complianceCheck?'尚未执行合规知识库检查':complianceCheck.gateStatus==='PASSED'?'合规门禁已通过':complianceCheck.gateStatus==='REVIEW_REQUIRED'&&complianceReviewed?'人工复核已确认':`合规门禁：${complianceCheck.gateStatus}`):nextOptimizeStatus}</b></div>{optimizeMode==='pricing'?<button className="primary" disabled={!selectedTitle||busy==='save-premium'||!complianceCheck||!imageVisualReport||!imageNaturalizationComplete||finalImageChecking||!finalImageInspection||finalImageInspection.blocked>0||finalImageInspection.review>0||complianceCheck.gateStatus==='BLOCKED'||complianceCheck.gateStatus==='RECHECK_REQUIRED'||complianceCheck.gateStatus==='REVIEW_REQUIRED'&&!complianceReviewed} onClick={()=>void saveToPremium()}>{busy==='save-premium'?'保存中…':'确认并存入优品仓库'}</button>:<button className="primary" disabled={!nextOptimizeReady} title={nextOptimizeReady?'进入下一个优化环节':nextOptimizeStatus} onClick={goToNextOptimizeStage}>下一步：{nextOptimizeMode?optimizeStageLabels[nextOptimizeMode]:''}</button>}</div>}</div>:<EbayEmpty title="请选择本地产品" description="AI优化只读取已下载的本地产品快照，请先在线上产品下载，再从本地产品进入。" action="前往本地产品" onAction={()=>setActiveTab('local')}/>}</section></div>}
      {activeTab==='premium'&&<div className="ebay-library-layout ebay-premium-layout">
        <aside className="ebay-product-catalog">
          <header><b>优品目录</b><small>复用当前 eBay 店铺目录，仅统计已保存的优化版本</small></header>
          <button className={premiumCategoryId==='ALL'?'active':''} onClick={()=>setPremiumCategoryId('ALL')}>全部优品 <em>{optimizationDrafts.length}</em></button>
          {categoryWorkspace.categories.length?<EbayStoreCategoryTree categories={categoryWorkspace.categories} listings={premiumListings} selected={premiumCategoryId} onSelect={setPremiumCategoryId}/>:<p className="ebay-category-empty">请先在“店铺采集”中同步目录</p>}
          <div className="ebay-catalog-filters">
            <b>状态与缺失项</b>
            <button className={premiumCategoryId==='PREMIUM_READY'?'active':''} onClick={()=>setPremiumCategoryId('PREMIUM_READY')}>发布就绪 <em>{publishReadyDrafts.length}</em></button>
            <button className={premiumCategoryId==='PREMIUM_REVIEW'?'active':''} onClick={()=>setPremiumCategoryId('PREMIUM_REVIEW')}>待人工复核 <em>{premiumReviewCount}</em></button>
            <button className={premiumCategoryId==='PREMIUM_MISSING_IMAGE'?'active':''} onClick={()=>setPremiumCategoryId('PREMIUM_MISSING_IMAGE')}>缺少主图 <em>{premiumMissingImageCount}</em></button>
            <button className={premiumCategoryId==='PREMIUM_MISSING_DECISION'?'active':''} onClick={()=>setPremiumCategoryId('PREMIUM_MISSING_DECISION')}>缺少市场决策 <em>{premiumMissingDecisionCount}</em></button>
            <button className={premiumCategoryId==='UNCLASSIFIED'?'active':''} onClick={()=>setPremiumCategoryId('UNCLASSIFIED')}>未分类 <em>{premiumUnclassifiedCount}</em></button>
          </div>
        </aside>
        <section className="ebay-premium-content">
          <div className="ebay-toolbar ebay-premium-toolbar">
            <input value={premiumSearch} onChange={event=>setPremiumSearch(event.target.value)} placeholder="搜索优化标题、SKU、Item ID"/>
            <select value={premiumStatus} onChange={event=>setPremiumStatus(event.target.value as typeof premiumStatus)}>
              <option value="ALL">全部状态</option>
              <option value="READY">发布就绪</option>
              <option value="REVIEW">待人工复核</option>
              <option value="INCOMPLETE">待完善</option>
            </select>
            <span>当前显示 {visiblePremiumDrafts.length} 个优品</span>
          </div>
          {visiblePremiumDrafts.length?<div className="ebay-premium-card-grid">{visiblePremiumDrafts.map(draft=>{
            const issues=draftPublishIssues(draft)
            const ready=!issues.length
            return <article className={`ebay-premium-card ${ready?'ready':'incomplete'}`} key={draft.id}>
              <div className="ebay-premium-card-media">{draft.imageUrl?<img src={draft.imageUrl} alt={draft.selectedTitle}/>:<span>无主图</span>}<em>{ready?'发布就绪':premiumNeedsReview(draft)?'待复核':'待完善'}</em></div>
              <div className="ebay-premium-card-body">
                <small>Item ID {draft.listingId}</small>
                <b>{draft.selectedTitle}</b>
                <p>{draft.listing.categoryName||'未分类'} · {draft.itemSpecifics.length} 个属性</p>
                <div className="ebay-premium-tags"><span>{draft.complianceGateStatus?`合规 ${draft.complianceGateStatus}`:'缺少合规快照'}</span><span>{draft.marketDecision?'市场决策已保存':'缺少市场决策'}</span></div>
                {issues.length?<small className="ebay-premium-issues">{issues.slice(0,3).join(' · ')}</small>:<small className="ebay-premium-ready">标题、图片、详情与属性已通过发布前检查</small>}
                <button onClick={()=>{setSelectedListingId(draft.listing.id);setSelectedLocalProductId(localProducts.find(product=>product.listingId===draft.listing.listingId)?.id||'');setTitleResult({originalTitle:draft.listing.title,optimizedTitle:draft.selectedTitle,keywords:[],rationale:'已从优品仓库恢复',model:'saved',variants:draft.titleVariants,itemSpecifics:draft.itemSpecifics,description:draft.description,marketDecision:draft.marketDecision});setSelectedTitle(draft.selectedTitle);setSelectedSourceImageUrl(draft.imageUrl||draft.listing.imageUrls?.[0]||draft.listing.imageUrl||'');setImageGroundingPlan(null);setImageCandidateReviews({});setImageResults({});setSelectedGeneratedImages({});setAcceptedGeneratedImages({});setContentResult(null);setComplianceReviewed(Boolean(draft.complianceReviewedAt));setOptimizeMode('image');setActiveTab('optimize')}}>查看优化版本</button>
              </div>
            </article>
          })}</div>:optimizationDrafts.length?<EbayEmpty title="当前筛选下暂无优品" description="可切换目录、状态或清空搜索条件继续查看。"/>:<EbayEmpty title="优品仓库暂无商品" description="完成产品合规检查和AI内容优化，经人工确认的版本会保存到这里；原线上商品不会被直接覆盖。" action="进入AI优化" onAction={()=>setActiveTab('optimize')}/>}
        </section>
      </div>}
      {activeTab==='publish'&&<div className="ebay-stage-panel ebay-publish-stage">
        <section className="ebay-final-handoff-heading"><div><small>FINAL STEP · PUBLISH REVIEW & HANDOFF</small><b>最终发布确认与统一交付</b><p>标题、类目属性、图片、英文详情和合规结论只在这里汇总。确认资料完整后，才会打开 Seller Hub 统一预填可安全识别的字段；最终提交仍由人工点击。</p></div><span>唯一 Seller Hub 交付入口</span></section>
        <section className="ebay-acceptance-center">
          <header><div><small>PHASE 03 · ACCEPTANCE</small><b>正式发布验收</b><p>连接真实 Seller Hub 验证单品；批量检查最多10件，并执行四类失败保护自检。</p></div><div><button disabled={Boolean(busy)||!optimizationDrafts.length} onClick={()=>void runAcceptance('SINGLE')}>{busy==='acceptance:SINGLE'?'真实页面验收中…':'运行真实单品验收'}</button><button className="primary" disabled={Boolean(busy)||!listings.length} onClick={()=>void runAcceptance('BATCH_10')}>{busy==='acceptance:BATCH_10'?'批量验收中…':'运行10商品批量验收'}</button></div></header>
          {latestAcceptance?<><div className={`ebay-acceptance-summary ${latestAcceptance.status.toLowerCase()}`}><span><small>验收模式</small><b>{latestAcceptance.mode==='SINGLE'?'真实单品':'批量10商品'}</b></span><span><small>本次检查</small><b>{latestAcceptance.checked}/{latestAcceptance.requested}</b></span><span><small>通过</small><b>{latestAcceptance.passed}</b></span><span><small>需关注</small><b>{latestAcceptance.attention}</b></span><span><small>阻断</small><b>{latestAcceptance.blocked}</b></span><span><small>结论</small><b>{latestAcceptance.status==='PASSED'?'通过':latestAcceptance.status==='ATTENTION'?'需关注':'有阻断'}</b></span></div>
            <div className="ebay-acceptance-columns"><details open><summary>商品验收结果</summary>{latestAcceptance.items.map(item=><article key={item.listingId}><span className={item.status.toLowerCase()}>{item.status==='PASSED'?'通过':item.status==='ATTENTION'?'关注':'阻断'}</span><div><b>{item.title}</b><small>Item ID {item.listingId}</small>{item.checks.map((check,index)=><p key={`${check.code}-${index}`} className={check.status.toLowerCase()}><strong>{check.status==='PASSED'?'✓':check.status==='WARNING'?'!':'×'} {check.label}</strong>{check.detail}</p>)}</div></article>)}</details>
              <details open><summary>异常保护自检</summary>{latestAcceptance.scenarios.map(scenario=><article key={scenario.scenario}><span className={scenario.status.toLowerCase()}>{scenario.status==='PASSED'?'通过':'失败'}</span><div><b>{scenario.scenario==='LOGIN_EXPIRED'?'登录失效':scenario.scenario==='CAPTCHA'?'验证码':scenario.scenario==='FIELD_CHANGED'?'字段变化':'失败恢复'}</b><p>{scenario.detail}</p></div></article>)}</details></div>
            <footer><span>报告：{latestAcceptance.reportPath}</span><time>{new Date(latestAcceptance.createdAt).toLocaleString('zh-CN')}</time></footer></>:<div className="ebay-acceptance-empty">尚未执行第三阶段验收。先运行真实单品验收，再运行10商品批量验收。</div>}
        </section>
        <div className={`ebay-publish-readiness ${configuration?.configured?'configured':'blocked'}`}><div><small>自动发布链路</small><b>尚未开放自动写入</b><p>{configuration?.configured?'当前 eBay 服务仍按只读模式运行，避免未经确认修改线上刊登。':'缺少 eBay Production Keys，无法调用正式写入接口。'}</p></div><span><strong>{publishReadyDrafts.length}</strong> 个内容就绪</span><span><strong>{optimizationDrafts.length-publishReadyDrafts.length}</strong> 个待完善</span><span><strong>JSON</strong> 素材包交付</span></div>
        {optimizationDrafts.length?<div className="ebay-premium-grid">{optimizationDrafts.map(draft=>{
          const issues=draftPublishIssues(draft)
          const ready=!issues.length
          const task=publishTasks.find(item=>item.draftId===draft.id)
          const taskCurrent=Boolean(task&&new Date(task.updatedAt).getTime()>=new Date(draft.updatedAt).getTime())
          const publishChecklist=[
            {label:'最终标题',ready:Boolean(draft.selectedTitle.trim()&&draft.selectedTitle.length<=80),detail:draft.selectedTitle.trim()?`${draft.selectedTitle.length}/80 字符`:'未保存'},
            {label:'类目与属性',ready:Boolean(draft.listing.categoryName&&!draft.itemSpecifics.some(item=>item.needsConfirmation||!item.value.trim())),detail:`${draft.listing.categoryName||'未分类'} · ${draft.itemSpecifics.length} 项属性`},
            {label:'最终图集',ready:Boolean(draft.imageUrl&&(draft.imageUrls?.length||1)),detail:`${draft.imageUrls?.length||(draft.imageUrl?1:0)} 张已确认，线上图片待核对`},
            {label:'英文详情',ready:Boolean(draft.description.trim()),detail:draft.description.trim()?`${draft.description.trim().length} 字符`:'未保存'},
            {label:'合规门禁',ready:Boolean(draft.complianceGateStatus&&(draft.complianceGateStatus==='PASSED'||draft.complianceGateStatus==='REVIEW_REQUIRED'&&draft.complianceReviewedAt)),detail:draft.complianceGateStatus||'未检查'}
          ]
          return <article className={ready?'publish-ready':'publish-blocked'} key={draft.id}>
            {draft.imageUrl?<img src={draft.imageUrl} alt={draft.selectedTitle}/>:<span>无主图</span>}
            <div>
              <small>Item ID {draft.listingId}</small><b>{draft.selectedTitle}</b>
              <p>{ready?'标题、类目、图片、详情、属性和入库合规快照均已齐备。':`待完善：${issues.join('、')}`}</p>
              <div className="ebay-final-publish-checklist">{publishChecklist.map(item=><span className={item.ready?'ready':'missing'} key={item.label}><i>{item.ready?'✓':'!'}</i><b>{item.label}</b><small>{item.detail}</small></span>)}<span className="review"><i>人</i><b>Seller Hub 人工核对项</b><small>图片、价格、库存及业务政策保留线上原值</small></span></div>
              {task&&<div className={`ebay-publish-task-status ${task.status.toLowerCase()}`}>
                <strong>{taskCurrent?publishTaskLabel[task.status]:'发布资料已变化'}</strong><span>{taskCurrent?task.message:'当前优化草稿晚于上次预填记录，旧记录已失效，请重新统一预填。'}</span>
                {task.imageInspection.checkedAt&&<small>图片：{task.imageInspection.images.length} 张 · 阻断 {task.imageInspection.blocked} · 待人工确认 {task.imageInspection.review}</small>}
                {task.categorySpecifics.length>0&&<small>Seller Hub 属性：{task.categorySpecifics.length} 项 · 必填 {task.categorySpecifics.filter(item=>item.required).length} 项</small>}
              </div>}
              {task?.video&&<div className="ebay-publish-video">
                <video controls preload="metadata" src={task.video.previewUrl}/>
                <div><b>15秒商品视频</b><small>{task.video.width}×{task.video.height} · {task.video.imageCount} 张原图 · {(task.video.sizeBytes/1024/1024).toFixed(1)} MB</small><span>{task.videoUpload?.message||'已本地生成，完整预览后再准备上传'}</span></div>
              </div>}
              {task?.comparison?.length?<details className="ebay-publish-details"><summary>查看发布前后对比（{task.comparison.length}项）</summary>{task.comparison.map(item=><div key={item.field}><b>{item.field}</b><span><small>原版</small>{item.before}</span><i>→</i><span><small>待发布</small>{item.after}</span><em>{item.status==='CHANGED'?'有变化':item.status==='UNCHANGED'?'未变化':'人工核对'}</em></div>)}</details>:null}
              {task?.auditTrail?.length?<details className="ebay-publish-details audit"><summary>查看操作审计（{task.auditTrail.length}条）</summary>{task.auditTrail.map(event=><div key={event.id}><b>{new Date(event.createdAt).toLocaleString('zh-CN')}</b><span>{event.detail.slice(0,320)}</span><em>{event.status==='SUCCESS'?'成功':event.status==='WARNING'?'待确认':'失败'}</em></div>)}</details>:null}
              <em className="compliance-saved">{ready?`内容已就绪 · 门禁 ${draft.complianceGateStatus}`:'当前不可进入发布交付'}</em>
            </div>
            <div className="ebay-publish-actions">
              <button disabled={busy===`publish-check:${draft.id}`} onClick={()=>void validateDraftForPublish(draft)}>{busy===`publish-check:${draft.id}`?'正在重检…':'发布前重检'}</button>
              {ready&&<button disabled={Boolean(busy)} onClick={()=>void generateDraftVideo(draft)}>{busy===`publish-video:${draft.id}`?'正在生成15秒视频…':task?.video?'重新生成视频':'生成15秒视频'}</button>}
              {ready&&task?.video&&<button className="primary" disabled={Boolean(busy)} onClick={()=>void prepareDraftVideoUpload(draft)}>{busy===`publish-video-upload:${draft.id}`?'正在准备视频上传…':'准备上传视频'}</button>}
              {ready&&<button className="primary" disabled={Boolean(busy)} onClick={()=>void prepareDraftInSellerHub(draft)}>{busy===`publish-prepare:${draft.id}`?'正在打开并统一预填…':taskCurrent&&task?.status==='WAITING_CONFIRMATION'?'重新打开并统一预填':'打开 Seller Hub 并统一预填'}</button>}
              {ready&&<button disabled={busy===`publish-export:${draft.id}`} onClick={()=>void exportDraftForPublish(draft)}>{busy===`publish-export:${draft.id}`?'导出中…':'导出素材包'}</button>}
              {!ready&&<button onClick={()=>{setSelectedListingId(draft.listing.id);setSelectedLocalProductId(localProducts.find(product=>product.listingId===draft.listing.listingId)?.id||'');setTitleResult({originalTitle:draft.listing.title,optimizedTitle:draft.selectedTitle,keywords:[],rationale:'从发布阶段返回完善',model:'saved',variants:draft.titleVariants,itemSpecifics:draft.itemSpecifics,description:draft.description});setSelectedTitle(draft.selectedTitle);setSelectedSourceImageUrl(draft.imageUrl||draft.listing.imageUrls?.[0]||draft.listing.imageUrl||'');setImageGroundingPlan(null);setImageCandidateReviews({});setImageResults({});setSelectedGeneratedImages({});setAcceptedGeneratedImages({});setComplianceReviewed(Boolean(draft.complianceReviewedAt));setOptimizeMode('image');setActiveTab('optimize')}}>返回完善</button>}
            </div>
          </article>
        })}</div>:<EbayEmpty title="暂无待发布版本" description="请先在AI优化中完成内容与合规检查，再保存到优品仓库。" action="查看优品仓库" onAction={()=>setActiveTab('premium')}/>}
      </div>}
    </div>
    {localEditorProduct&&localEditorDraft&&<EbayLocalListingEditor product={localEditorProduct} draft={localEditorDraft} saving={busy===`local-save:${localEditorProduct.id}`} uploading={busy===`local-media:${localEditorProduct.id}`} preparing={busy===`local-prepare:${localEditorProduct.id}`} onChange={setLocalEditorDraft} onSave={()=>void saveLocalEditor()} onPrepare={()=>void prepareLocalEditorInSellerHub()} onUpload={files=>void uploadLocalEditorMedia(files)} onClose={()=>{if(!busy.startsWith('local-')){setLocalEditorProductId('');setLocalEditorDraft(null)}}}/>} 
    {directoryProductSyncOpen&&<div className="ebay-store-dialog-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)void closeDirectoryProductSync()}}>
      <div className="ebay-store-dialog ebay-directory-product-dialog" role="dialog" aria-modal="true" aria-labelledby="ebay-directory-product-dialog-title">
        <header><div><small>EBAY DIRECTORY SYNC V2</small><h3 id="ebay-directory-product-dialog-title">按目录增量同步</h3><p>只写入新增或变化商品；仅完整读取的目录会执行安全下架判断。</p></div><button type="button" aria-label="关闭" disabled={directoryProductSyncing} onClick={()=>void closeDirectoryProductSync()}>×</button></header>
        <div className="ebay-directory-sync-mode"><div><b>第二版：增量更新＋安全下架识别</b><small>系统会复用当前登录会话，自动定位并验证公开店铺主页</small></div><span>AI 优化版本独立保护</span></div>
        {directoryProductSyncCheckpoint&&!directoryProductSyncing&&<div className="ebay-directory-resume"><div><b>发现未完成的同步任务</b><small>已完成 {directoryProductSyncCheckpoint.completedCategoryIds.length}/{directoryProductSyncCheckpoint.categoryIds.length} 个目录 · 失败 {directoryProductSyncCheckpoint.failedCategoryIds.length} 个</small></div><button type="button" onClick={()=>void syncDirectoryProducts('RESUME')}>继续上次任务</button></div>}
        <label className="ebay-directory-store-url"><span>公开店铺主页</span><input value={directoryProductStoreUrl} disabled={directoryProductSyncing} onChange={event=>setDirectoryProductStoreUrl(event.target.value)} placeholder="自动识别；失败时可填写 https://www.ebay.com/str/店铺名"/><small>{activeStore?.publicStoreVerifiedAt?`已验证：${new Date(activeStore.publicStoreVerifiedAt).toLocaleString('zh-CN',{hour12:false})}`:'首次同步将自动识别并保存，无需提前打开店铺页面'}</small></label>
        {(directoryProductSyncPhase||directoryProductSyncError)&&<div className={`ebay-directory-sync-progress${directoryProductSyncError?' error':''}`}><i/><div><b>{directoryProductSyncError||directoryProductSyncPhase}</b>{directoryProductSyncProgress&&<><small>{directoryProductSyncProgress.categoryName&&`${directoryProductSyncProgress.categoryName} · `}目录 {directoryProductSyncProgress.completedCategories}/{directoryProductSyncProgress.categoryCount}{directoryProductSyncProgress.expected?` · 商品 ${directoryProductSyncProgress.found}/${directoryProductSyncProgress.expected}`:''}</small><span><em style={{width:`${directoryProductSyncProgress.percent}%`}}/></span><small>总体进度 {directoryProductSyncProgress.percent}% · 失败目录 {directoryProductSyncProgress.failedCategories}</small></>}</div></div>}
        <label className="ebay-directory-select-all"><input type="checkbox" checked={directoryProductCategoryIds.length===directoryProductCategories.length&&directoryProductCategories.length>0} onChange={event=>setDirectoryProductCategoryIds(event.target.checked?directoryProductCategories.map(item=>item.categoryId):[])}/><span>全部有商品的目录</span><em>已选 {directoryProductCategoryIds.length} / {directoryProductCategories.length}</em></label>
        <div className="ebay-directory-product-list">{directoryProductCategories.map(category=><label key={category.categoryId} style={{paddingLeft:`${10+Math.max(0,category.level-1)*14}px`}}><input type="checkbox" checked={directoryProductCategoryIds.includes(category.categoryId)} onChange={event=>setDirectoryProductCategoryIds(current=>event.target.checked?[...current,category.categoryId]:current.filter(id=>id!==category.categoryId))}/><span>{category.name}</span><em>{category.listingCount} 个</em></label>)}</div>
        {directoryProductSyncResult&&<div className="ebay-directory-sync-result"><b>{directoryProductSyncResult.failed?'部分同步完成':'同步完成'}</b><span>新增 {directoryProductSyncResult.imported}</span><span>更新 {directoryProductSyncResult.updated}</span><span>移动目录 {directoryProductSyncResult.moved}</span><span>重新上架 {directoryProductSyncResult.reactivated}</span><span>疑似下架 {directoryProductSyncResult.suspectedEnded}</span><span>确认下架 {directoryProductSyncResult.ended}</span><span>未变化 {directoryProductSyncResult.unchanged}</span><span>保护优化稿 {directoryProductSyncResult.protectedOptimizations}</span><span>线上产品共 {directoryProductSyncResult.total}</span>{directoryProductSyncResult.failedCategoryIds.length>0&&<button type="button" onClick={()=>{setDirectoryProductCategoryIds(directoryProductSyncResult.failedCategoryIds);void syncDirectoryProducts('RESUME',directoryProductSyncResult.failedCategoryIds)}}>仅重试失败目录</button>}{directoryProductSyncResult.errors.length>0&&<small>{directoryProductSyncResult.errors.join('；')}</small>}{directoryProductSyncResult.changes.length>0&&<details className="ebay-product-sync-changes"><summary>查看本次变更商品（{directoryProductSyncResult.changes.length}）</summary>{directoryProductSyncResult.changes.slice(0,100).map(change=><div key={`${change.type}:${change.listingId}`}><span>{change.type==='IMPORTED'?'新增':change.type==='UPDATED'?'更新':change.type==='MOVED'?'移动':change.type==='REACTIVATED'?'重新上架':change.type==='SUSPECTED_ENDED'?'疑似下架':'确认下架'}</span><p><b>{change.title||change.listingId}</b><small>{change.beforeCategory&&change.afterCategory&&change.beforeCategory!==change.afterCategory?`${change.beforeCategory} → ${change.afterCategory}`:change.beforeCategory||change.afterCategory||`Item ID ${change.listingId}`}</small></p></div>)}</details>}</div>}
        {directoryProductSyncRuns.length>0&&<section className="ebay-product-sync-history"><div><b>最近同步记录</b><small>最多显示最近 5 次</small></div>{directoryProductSyncRuns.slice(0,5).map(run=><article key={run.id}><span className={run.status.toLowerCase()}>{run.status==='SUCCESS'?'成功':run.status==='PARTIAL'?'部分完成':'失败'}</span><time>{new Date(run.syncedAt).toLocaleString('zh-CN',{hour12:false})}</time><p>新增 {run.imported} · 更新 {run.updated} · 移动 {run.moved} · 疑似下架 {run.suspectedEnded} · 确认下架 {run.ended}</p><em>完整读取 {run.scannedCategoryCount}/{run.categoryCount} 个目录</em>{run.changes.length>0&&<details className="ebay-product-sync-changes"><summary>查看 {run.changes.length} 项商品变更</summary>{run.changes.slice(0,100).map(change=><div key={`${run.id}:${change.type}:${change.listingId}`}><span>{change.type==='IMPORTED'?'新增':change.type==='UPDATED'?'更新':change.type==='MOVED'?'移动':change.type==='REACTIVATED'?'重新上架':change.type==='SUSPECTED_ENDED'?'疑似下架':'确认下架'}</span><p><b>{change.title||change.listingId}</b><small>{change.beforeCategory&&change.afterCategory&&change.beforeCategory!==change.afterCategory?`${change.beforeCategory} → ${change.afterCategory}`:change.beforeCategory||change.afterCategory||`Item ID ${change.listingId}`}</small></p></div>)}</details>}</article>)}</section>}
        <footer>{directoryProductSyncing?<><button type="button" onClick={()=>void controlDirectoryProductSync('CANCEL')}>取消任务</button><button className="primary" type="button" onClick={()=>void controlDirectoryProductSync(directoryProductSyncPaused?'RESUME':'PAUSE')}>{directoryProductSyncPaused?'继续同步':'暂停同步'}</button></>:<><button type="button" onClick={()=>void closeDirectoryProductSync()}>{directoryProductSyncResult?'完成':'取消'}</button><button className="primary" type="button" disabled={!directoryProductCategoryIds.length} onClick={()=>void syncDirectoryProducts('NEW')}>{directoryProductSyncResult?'重新开始':'开始增量同步'}</button></>}</footer>
      </div>
    </div>}
    {storeFormOpen&&<div className="ebay-store-dialog-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&busy!=='create')setStoreFormOpen(false)}}><form className="ebay-store-dialog" role="dialog" aria-modal="true" aria-labelledby="ebay-store-dialog-title" onSubmit={event=>void submitStore(event)}><header><div><small>EBAY STORE</small><h3 id="ebay-store-dialog-title">添加 eBay 店铺</h3><p>保存店铺登录记录；密码使用 macOS 系统安全存储加密。</p></div><button type="button" aria-label="关闭" disabled={busy==='create'} onClick={()=>setStoreFormOpen(false)}>×</button></header><label>店名<span>*</span><input autoFocus value={storeDraft.name} onChange={event=>setStoreDraft(current=>({...current,name:event.target.value}))} placeholder="例如：美国主店" maxLength={80}/></label><label>eBay 登录账号<span>*</span><input value={storeDraft.username} onChange={event=>setStoreDraft(current=>({...current,username:event.target.value}))} autoComplete="off" placeholder="邮箱、手机号或用户名" maxLength={160}/></label><label>eBay 登录密码<span>*</span><input type="password" value={storeDraft.password} onChange={event=>setStoreDraft(current=>({...current,password:event.target.value}))} autoComplete="new-password" placeholder="输入当前店铺登录密码"/></label><div className="ebay-store-dialog-site"><span>浏览会话</span><b>按店铺独立保存，不与其他店铺共享</b></div><footer><button type="button" disabled={busy==='create'} onClick={()=>setStoreFormOpen(false)}>取消</button><button className="primary" type="submit" disabled={!storeDraft.name.trim()||!storeDraft.username.trim()||!storeDraft.password||busy==='create'}>{busy==='create'?'正在创建…':'确认添加'}</button></footer></form></div>}
  </section>
}

function EbayEmpty({title,description,action,onAction}:{title:string;description:string;action?:string;onAction?:()=>void}){
  return <div className="ebay-empty"><span>◎</span><b>{title}</b><small>{description}</small>{action&&onAction&&<button className="primary" onClick={onAction}>{action}</button>}</div>
}

function ComplianceKnowledgePage(){
  type Tab='overview'|'profiles'|'templates'|'reviews'|'monitoring'|'approvals'|'permits'|'enforcement'|'alerts'|'platform'|'regulations'|'recalls'
  const [tab,setTab]=useState<Tab>('overview')
  const [workspace,setWorkspace]=useState<ComplianceKnowledgeWorkspace|null>(null)
  const [selectedRuleId,setSelectedRuleId]=useState('')
  const [editing,setEditing]=useState(false)
  const [busy,setBusy]=useState('')
  const [message,setMessage]=useState('')
  const [failure,setFailure]=useState('')
  const [selectedProfileId,setSelectedProfileId]=useState('')
  const [profileDraft,setProfileDraft]=useState<ComplianceProductProfileDraft|null>(null)
  const [documentDraft,setDocumentDraft]=useState<ComplianceDocumentDraft|null>(null)
  const [templateDraft,setTemplateDraft]=useState<ComplianceCategoryTemplateDraft|null>(null)
  const blankRule=():ComplianceRuleDraft=>({code:'',platform:'EBAY',marketplaceSite:'ALL',country:'ALL',category:'ALL',ruleType:'PLATFORM_POLICY',riskLevel:'P2',reviewStatus:'DRAFT',title:'',summary:'',keywords:[],requiredFields:[],remediation:'',sourceUrl:'',effectiveFrom:new Date().toISOString().slice(0,10)})
  const [draft,setDraft]=useState<ComplianceRuleDraft>(blankRule)
  const load=async()=>{try{setWorkspace(await window.desktop.compliance.workspace());setFailure('')}catch(reason){setFailure(readableError(reason,'合规知识库加载失败'))}}
  useEffect(()=>{void load()},[])
  const selectedRule=workspace?.rules.find(item=>item.id===selectedRuleId)||workspace?.rules[0]
  useEffect(()=>{if(!selectedRuleId&&workspace?.rules[0])setSelectedRuleId(workspace.rules[0].id)},[workspace?.rules.length])
  const editRule=(rule?:ComplianceRule)=>{setDraft(rule?{id:rule.id,code:rule.code,platform:rule.platform,marketplaceSite:rule.marketplaceSite,country:rule.country,category:rule.category,ruleType:rule.ruleType,riskLevel:rule.riskLevel,reviewStatus:rule.reviewStatus,title:rule.version.title,summary:rule.version.summary,keywords:rule.version.condition.keywords||[],requiredFields:rule.version.condition.requiredFields||[],remediation:rule.version.remediation,sourceUrl:rule.version.sourceUrl,effectiveFrom:rule.version.effectiveFrom}:blankRule());setEditing(true);setFailure('')}
  const saveRule=async(event:FormEvent)=>{event.preventDefault();setBusy('save');setFailure('');try{const saved=await window.desktop.compliance.saveRule(draft);await load();setSelectedRuleId(saved.id);setEditing(false);setMessage(`规则 ${saved.code} 已保存为 v${saved.currentVersion}`)}catch(reason){setFailure(readableError(reason,'规则保存失败'))}finally{setBusy('')}}
  const changeStatus=async(rule:ComplianceRule,status:ComplianceReviewStatus)=>{setBusy(`status:${rule.id}`);setFailure('');try{await window.desktop.compliance.setRuleStatus(rule.id,status);await load();setMessage(status==='ACTIVE'?'规则已启用，将进入后续合规检查。':'规则状态已更新。')}catch(reason){setFailure(readableError(reason,'规则状态更新失败'))}finally{setBusy('')}}
  const syncSource=async(sourceId:string)=>{const label=workspace?.sources.find(item=>item.id===sourceId)?.name||sourceId;setBusy(`sync:${sourceId}`);setFailure('');try{const result=await window.desktop.compliance.syncSource(sourceId);setWorkspace(result.workspace);setMessage(result.imported!==undefined?`${label} 官方数据同步完成：${result.imported} 条；对应市场商品已重新检查。`:result.changed?`${label} 检测到变化，已生成 ${result.versionsCreated||0} 个待审核规则版本。`:`${label} 检测完成，官方内容没有变化。`)}catch(reason){setFailure(readableError(reason,`${label} 自动检测失败`))}finally{setBusy('')}}
  const recheckProfiles=async(platform='ALL',country='ALL')=>{setBusy('recheck');setFailure('');try{const result=await window.desktop.compliance.recheckProfiles(platform,country);await load();setMessage(`持续重检完成：检查 ${result.checked}/${result.total} 个，阻断 ${result.blocked} 个，待复核 ${result.reviewRequired} 个，跳过 ${result.skipped} 个。`)}catch(reason){setFailure(readableError(reason,'商品批量重检失败'))}finally{setBusy('')}}
  const openProfile=(productId:string)=>{const profile=workspace?.profiles.find(item=>item.productId===productId);if(!profile)return;setSelectedProfileId(productId);setProfileDraft({...profile})}
  const saveProfile=async(event:FormEvent)=>{event.preventDefault();if(!profileDraft)return;setBusy('profile');try{await window.desktop.compliance.saveProfile(profileDraft);await load();setMessage('商品合规档案已保存。')}catch(reason){setFailure(readableError(reason,'合规档案保存失败'))}finally{setBusy('')}}
  const startDocument=()=>{if(!selectedProfileId)return;setDocumentDraft({productId:selectedProfileId,documentType:'SAFETY_DOCUMENT',name:'',documentNumber:'',issuer:'',modelNumbers:'',countries:'',issuedAt:'',expiresAt:'',status:'PENDING_REVIEW',fileName:'',filePath:'',reviewNote:''})}
  const chooseDocument=async()=>{const chosen=await window.desktop.compliance.chooseDocument();if(chosen&&documentDraft)setDocumentDraft({...documentDraft,...chosen})}
  const saveDocument=async(event:FormEvent)=>{event.preventDefault();if(!documentDraft)return;setBusy('document');try{await window.desktop.compliance.saveDocument(documentDraft);await load();setDocumentDraft(null);setMessage('合规文件已存档，当前状态为待审核。')}catch(reason){setFailure(readableError(reason,'合规文件保存失败'))}finally{setBusy('')}}
  const newTemplate=()=>setTemplateDraft({name:'',platform:'EBAY',marketplaceSite:'ALL',country:'ALL',category:'ALL',requiredFields:[],requiredDocuments:[],requiredWarnings:[],logisticsRequirements:[],requiresManualReview:true,active:true})
  const saveTemplate=async(event:FormEvent)=>{event.preventDefault();if(!templateDraft)return;setBusy('template');try{await window.desktop.compliance.saveTemplate(templateDraft);await load();setTemplateDraft(null);setMessage('类目合规模板已保存。')}catch(reason){setFailure(readableError(reason,'类目模板保存失败'))}finally{setBusy('')}}
  const updateTask=async(taskId:string,status:ComplianceTaskStatus)=>{const assignee=status==='IN_REVIEW'?window.prompt('请输入复核负责人','合规专员')||'':window.prompt('请输入处理结论','已核验并完成整改')||'';if(!assignee)return;setBusy(`task:${taskId}`);try{await window.desktop.compliance.updateTask(taskId,status,status==='IN_REVIEW'?assignee:'',status==='RESOLVED'?assignee:'');await load();setMessage(status==='RESOLVED'?'合规任务已留痕并完成。':'任务已进入复核。')}catch(reason){setFailure(readableError(reason,'任务更新失败'))}finally{setBusy('')}}
  const reviewSourceChange=async(changeId:string,decision:'APPROVED'|'REJECTED')=>{const reviewedBy=window.prompt('请输入审批人','合规负责人')||'';if(!reviewedBy.trim())return;const note=window.prompt(decision==='APPROVED'?'请输入批准依据':'请输入驳回原因',decision==='APPROVED'?'已核对官方原文、适用范围和生效日期':'变化内容不适用或证据不足')||'';if(!note.trim())return;setBusy(`change:${changeId}`);setFailure('');try{const result=await window.desktop.compliance.reviewSourceChange(changeId,decision,reviewedBy,note);setWorkspace(result.workspace);setMessage(`政策变化已${decision==='APPROVED'?'批准':'驳回'}；自动重检 ${result.recheck.checked}/${result.recheck.total} 个商品，阻断 ${result.recheck.blocked} 个。`)}catch(reason){setFailure(readableError(reason,'政策变化审批失败'))}finally{setBusy('')}}
  const exportPermit=async(permitId:string)=>{setBusy(`permit:${permitId}`);setFailure('');try{const result=await window.desktop.compliance.exportPermit(permitId);if(!result.canceled)setMessage(`发布合规许可已导出：${result.filePath}`)}catch(reason){setFailure(readableError(reason,'发布合规许可导出失败'))}finally{setBusy('')}}
  const updateAlert=async(alertId:string,status:ComplianceAlertStatus)=>{const note=window.prompt(status==='ACKNOWLEDGED'?'请输入接收人或处理说明':'请输入关闭结论',status==='ACKNOWLEDGED'?'合规专员已接收':'问题已核验并处理')||'';if(!note)return;setBusy(`alert:${alertId}`);try{await window.desktop.compliance.updateAlert(alertId,status,note);await load();setMessage(status==='RESOLVED'?'告警已关闭并留痕。':'告警已接收。')}catch(reason){setFailure(readableError(reason,'告警状态更新失败'))}finally{setBusy('')}}
  const updateEnforcement=async(caseId:string,status:ComplianceEnforcementStatus)=>{const value=window.prompt(status==='IN_PROGRESS'?'请输入处置负责人':'请输入实际处理结论',status==='IN_PROGRESS'?'合规专员':'已在平台核验并完成下架或整改')||'';if(!value.trim())return;setBusy(`enforcement:${caseId}`);setFailure('');try{await window.desktop.compliance.updateEnforcementCase(caseId,status,status==='IN_PROGRESS'?value:'',status==='RESOLVED'?value:'');await load();setMessage(status==='RESOLVED'?'在售处置已完成并留痕。':'在售风险已接收处理。')}catch(reason){setFailure(readableError(reason,'在售处置更新失败'))}finally{setBusy('')}}
  const exportEvidence=async()=>{setBusy('export');setFailure('');try{const result=await window.desktop.compliance.exportEvidence();if(!result.canceled)setMessage(`合规证据报告已导出：${result.filePath}`)}catch(reason){setFailure(readableError(reason,'合规证据报告导出失败'))}finally{setBusy('')}}
  if(!workspace)return <section className="compliance-page"><div className="compliance-loading">{failure||'正在读取合规知识库…'}</div></section>
  const visibleRules=workspace.rules.filter(rule=>tab==='platform'?rule.platform!=='ALL':tab==='regulations'?rule.country!=='ALL'||rule.ruleType==='PRODUCT_SAFETY':true)
  return <section className="compliance-page">
    <header className="compliance-hero"><div><small>COMPLIANCE OPERATIONS CENTER</small><h1>合规知识库</h1><p>打通官方数据、规则版本、商品档案、发布许可和在售风险处置的完整合规闭环。</p></div><span>第八版 · 在售持续监管</span></header>
    <nav className="compliance-tabs"><button className={tab==='overview'?'active':''} onClick={()=>setTab('overview')}>运营总览</button><button className={tab==='profiles'?'active':''} onClick={()=>setTab('profiles')}>商品档案</button><button className={tab==='templates'?'active':''} onClick={()=>setTab('templates')}>类目模板</button><button className={tab==='reviews'?'active':''} onClick={()=>setTab('reviews')}>复核任务</button><button className={tab==='monitoring'?'active':''} onClick={()=>setTab('monitoring')}>持续监测</button><button className={tab==='approvals'?'active':''} onClick={()=>setTab('approvals')}>变更审批{workspace.sourceChanges.some(item=>item.status==='PENDING_REVIEW')?<em>{workspace.sourceChanges.filter(item=>item.status==='PENDING_REVIEW').length}</em>:null}</button><button className={tab==='permits'?'active':''} onClick={()=>setTab('permits')}>发布许可{workspace.metrics.validPermits?<em>{workspace.metrics.validPermits}</em>:null}</button><button className={tab==='enforcement'?'active':''} onClick={()=>setTab('enforcement')}>在售监管{workspace.metrics.openEnforcementCases?<em>{workspace.metrics.openEnforcementCases}</em>:null}</button><button className={tab==='alerts'?'active':''} onClick={()=>setTab('alerts')}>告警审计{workspace.alerts.some(item=>item.status==='OPEN')?<em>{workspace.alerts.filter(item=>item.status==='OPEN').length}</em>:null}</button><button className={tab==='platform'?'active':''} onClick={()=>setTab('platform')}>平台规则</button><button className={tab==='regulations'?'active':''} onClick={()=>setTab('regulations')}>国家法规</button><button className={tab==='recalls'?'active':''} onClick={()=>setTab('recalls')}>风险召回</button></nav>
    {failure&&<div className="compliance-alert error">{failure}</div>}{message&&<div className="compliance-alert success">{message}<button onClick={()=>setMessage('')}>×</button></div>}
    {tab==='reviews'&&<ComplianceDocumentReview documents={workspace.documents} onChanged={load}/>} 
    {documentDraft&&createPortal(<div className="compliance-editor-backdrop"><form className="compliance-editor" onSubmit={saveDocument}><header><div><b>添加合规文件</b><small>上传后默认待审核，不会直接解除发布门禁</small></div><button type="button" onClick={()=>setDocumentDraft(null)}>×</button></header><div className="editor-grid"><label>文件类型<input required value={documentDraft.documentType} onChange={event=>setDocumentDraft({...documentDraft,documentType:event.target.value})}/></label><label>文件名称<input required value={documentDraft.name} onChange={event=>setDocumentDraft({...documentDraft,name:event.target.value})}/></label><label>证书/文件编号<input value={documentDraft.documentNumber} onChange={event=>setDocumentDraft({...documentDraft,documentNumber:event.target.value})}/></label><label>签发机构<input value={documentDraft.issuer} onChange={event=>setDocumentDraft({...documentDraft,issuer:event.target.value})}/></label><label>适用型号<input value={documentDraft.modelNumbers} onChange={event=>setDocumentDraft({...documentDraft,modelNumbers:event.target.value})}/></label><label>适用国家<input value={documentDraft.countries} onChange={event=>setDocumentDraft({...documentDraft,countries:event.target.value})}/></label><label>签发日期<input type="date" value={documentDraft.issuedAt} onChange={event=>setDocumentDraft({...documentDraft,issuedAt:event.target.value})}/></label><label>有效期<input type="date" value={documentDraft.expiresAt} onChange={event=>setDocumentDraft({...documentDraft,expiresAt:event.target.value})}/></label></div><div className="compliance-file-picker"><button type="button" onClick={()=>void chooseDocument()}>选择文件</button><span>{documentDraft.fileName||'尚未选择文件'}</span></div><footer><button type="button" onClick={()=>setDocumentDraft(null)}>取消</button><button className="primary" disabled={busy==='document'}>保存并提交审核</button></footer></form></div>,document.body)}
    {templateDraft&&createPortal(<div className="compliance-editor-backdrop"><form className="compliance-editor" onSubmit={saveTemplate}><header><div><b>{templateDraft.id?'编辑类目模板':'新建类目模板'}</b><small>模板会根据平台、站点、国家和类目自动匹配</small></div><button type="button" onClick={()=>setTemplateDraft(null)}>×</button></header><div className="editor-grid"><label>模板名称<input required value={templateDraft.name} onChange={event=>setTemplateDraft({...templateDraft,name:event.target.value})}/></label><label>平台<input required value={templateDraft.platform} onChange={event=>setTemplateDraft({...templateDraft,platform:event.target.value})}/></label><label>站点<input value={templateDraft.marketplaceSite} onChange={event=>setTemplateDraft({...templateDraft,marketplaceSite:event.target.value})}/></label><label>国家/地区<input value={templateDraft.country} onChange={event=>setTemplateDraft({...templateDraft,country:event.target.value})}/></label><label>适用类目<input value={templateDraft.category} onChange={event=>setTemplateDraft({...templateDraft,category:event.target.value})}/></label><label><input type="checkbox" checked={templateDraft.requiresManualReview} onChange={event=>setTemplateDraft({...templateDraft,requiresManualReview:event.target.checked})}/>发布前需人工复核</label></div><label>必填字段（逗号分隔）<input value={templateDraft.requiredFields.join(',')} onChange={event=>setTemplateDraft({...templateDraft,requiredFields:event.target.value.split(',').map(value=>value.trim()).filter(Boolean)})}/></label><label>必需文件（逗号分隔）<input value={templateDraft.requiredDocuments.join(',')} onChange={event=>setTemplateDraft({...templateDraft,requiredDocuments:event.target.value.split(',').map(value=>value.trim()).filter(Boolean)})}/></label><label>必需警告（逗号分隔）<input value={templateDraft.requiredWarnings.join(',')} onChange={event=>setTemplateDraft({...templateDraft,requiredWarnings:event.target.value.split(',').map(value=>value.trim()).filter(Boolean)})}/></label><label>物流要求（逗号分隔）<input value={templateDraft.logisticsRequirements.join(',')} onChange={event=>setTemplateDraft({...templateDraft,logisticsRequirements:event.target.value.split(',').map(value=>value.trim()).filter(Boolean)})}/></label><footer><button type="button" onClick={()=>setTemplateDraft(null)}>取消</button><button className="primary" disabled={busy==='template'}>保存模板</button></footer></form></div>,document.body)}
    {tab==='overview'&&<div className="compliance-metrics compliance-v2-metrics"><article><small>商品合规档案</small><b>{workspace.metrics.profiles}</b><span>已进入持续监测</span></article><article><small>待处理任务</small><b>{workspace.metrics.openTasks}</b><span>规则、资料与复核</span></article><article><small>过期/将过期文件</small><b>{workspace.metrics.expiringDocuments}</b><span>需及时更新</span></article><article><small>P0 阻断商品</small><b>{workspace.metrics.blockedProducts}</b><span>不允许进入发布</span></article></div>}
    {tab==='profiles'&&<div className="compliance-v2-workspace"><aside><header><b>商品合规档案</b><small>{workspace.profiles.length} 个商品</small></header>{workspace.profiles.map(profile=><button key={profile.id} className={selectedProfileId===profile.productId?'active':''} onClick={()=>openProfile(profile.productId)}><b>{profile.title||profile.productId}</b><small>{profile.marketplaceSite} · {profile.categoryName||'未设类目'} · {workspace.documents.filter(item=>item.productId===profile.productId).length}份资料</small></button>)}</aside><main>{profileDraft?<form className="compliance-profile-form" onSubmit={saveProfile}><header><div><b>{profileDraft.title||'商品档案'}</b><small>{profileDraft.marketplaceSite} · {profileDraft.country} · {profileDraft.productId}</small></div><button className="primary" disabled={busy==='profile'}>{busy==='profile'?'保存中…':'保存档案'}</button></header><div className="compliance-profile-grid">{([['brand','品牌'],['manufacturer','制造商'],['importer','进口商'],['euResponsiblePerson','欧盟负责人'],['model','型号'],['batchNumber','批次'],['barcode','条码'],['originCountry','原产地'],['materials','材料'],['ageGrade','适用年龄'],['batteryType','电池类型']] as const).map(([key,label])=><label key={key}>{label}<input value={profileDraft[key]} onChange={event=>setProfileDraft({...profileDraft,[key]:event.target.value})}/></label>)}</div><section className="compliance-document-section"><header><div><b>合规文件</b><small>文件审核状态直接参与发布门禁</small></div><button type="button" onClick={startDocument}>＋ 添加文件</button></header>{workspace.documents.filter(item=>item.productId===profileDraft.productId).map(item=><article key={item.id}><span className={`document-status ${item.status.toLowerCase()}`}>{item.status}</span><p><b>{item.name}</b><small>{item.documentType} · {item.fileName||'未上传文件'}{item.expiresAt?` · 有效至 ${item.expiresAt}`:''}</small></p></article>)}</section></form>:<div className="compliance-v2-empty">选择商品后维护制造商、责任人、型号、批次、标签和证书资料。</div>}</main></div>}
    {tab==='templates'&&<div className="compliance-template-panel"><header><div><b>类目合规模板</b><small>按平台、站点、国家和类目计算发布必需资料</small></div><button className="primary" onClick={newTemplate}>＋ 新建模板</button></header><div className="compliance-template-grid">{workspace.templates.map(template=><article key={template.id}><header><div><b>{template.name}</b><small>{template.platform} · {template.marketplaceSite} · {template.country} · {template.category}</small></div><span>{template.active?'已启用':'已停用'}</span></header><p><strong>必填字段：</strong>{template.requiredFields.join('、')||'无'}</p><p><strong>必需文件：</strong>{template.requiredDocuments.join('、')||'无'}</p><footer><em>{template.requiresManualReview?'发布前需人工复核':'资料齐全可自动通过'}</em><button onClick={()=>setTemplateDraft({...template})}>编辑</button></footer></article>)}</div></div>}
    {tab==='reviews'&&<div className="compliance-task-panel"><header><div><b>合规复核与整改任务</b><small>规则变更、资料缺失、过期和召回命中统一留痕</small></div><span>{workspace.metrics.openTasks} 项待处理</span></header><div>{workspace.tasks.map(task=><article key={task.id}><span className={`risk ${task.riskLevel.toLowerCase()}`}>{task.riskLevel}</span><div><b>{task.title}</b><small>{task.taskType} · 商品 {task.productId}</small><p>{task.detail}</p><em>期限 {task.dueAt?new Date(task.dueAt).toLocaleString('zh-CN'):'未设定'}{task.assignee?` · ${task.assignee}`:''}{task.resolution?` · ${task.resolution}`:''}</em></div><strong className={`task-status ${task.status.toLowerCase()}`}>{task.status}</strong><footer>{task.status==='OPEN'&&<button disabled={busy===`task:${task.id}`} onClick={()=>void updateTask(task.id,'IN_REVIEW')}>接收复核</button>}{task.status!=='RESOLVED'&&task.status!=='DISMISSED'&&<button className="primary" disabled={busy===`task:${task.id}`} onClick={()=>void updateTask(task.id,'RESOLVED')}>完成处理</button>}</footer></article>)}</div></div>}
    {tab==='approvals'&&<div className="compliance-change-approval"><header><div><b>官方政策变化审批</b><small>只有批准后的规则版本才进入检查引擎；驳回会恢复上一有效版本。</small></div><span>{workspace.sourceChanges.filter(item=>item.status==='PENDING_REVIEW').length} 项待审批</span></header><div>{workspace.sourceChanges.length?workspace.sourceChanges.map(change=>{const source=workspace.sources.find(item=>item.id===change.sourceId);const affected=workspace.rules.filter(rule=>change.affectedRuleIds.includes(rule.id));const state=change.status==='PENDING_REVIEW'?'pending':change.status==='REJECTED'?'rejected':'approved';return <article key={change.id} className={state}><header><div><span>{state==='pending'?'待审批':state==='rejected'?'已驳回':'已批准'}</span><b>{source?.name||change.sourceId}</b></div><time>{new Date(change.detectedAt).toLocaleString('zh-CN')}</time></header><p>{change.summary}</p><section><small>受影响规则 {affected.length} 条</small>{affected.map(rule=><span key={rule.id}><b>{rule.code}</b><em>v{rule.currentVersion} · {rule.reviewStatus==='PENDING_REVIEW'?'待生效':rule.reviewStatus==='ACTIVE'?'已生效':'未启用'}</em></span>)}</section>{change.reviewedBy&&<aside><b>{change.reviewedBy}</b><span>{change.reviewNote}</span><time>{change.reviewedAt?new Date(change.reviewedAt).toLocaleString('zh-CN'):''}</time></aside>}{state==='pending'&&<footer><button disabled={busy===`change:${change.id}`} onClick={()=>void reviewSourceChange(change.id,'REJECTED')}>驳回变化</button><button className="primary" disabled={busy===`change:${change.id}`} onClick={()=>void reviewSourceChange(change.id,'APPROVED')}>{busy===`change:${change.id}`?'处理中…':'批准并重检'}</button></footer>}</article>}):<div className="compliance-audit-empty">尚未检测到官方政策变化。</div>}</div></div>}
    {tab==='permits'&&<div className="compliance-permit-panel"><header><div><b>发布合规许可</b><small>许可绑定商品内容指纹、规则版本和检查记录；有效期默认 7 天，任何关键变化都会自动吊销。</small></div><span>{workspace.metrics.validPermits} 张有效许可</span></header><div>{workspace.permits.length?workspace.permits.map(permit=>{const profile=workspace.profiles.find(item=>item.productId===permit.productId);return <article key={permit.id} className={permit.status.toLowerCase()}><header><span>{permit.status==='VALID'?'有效':permit.status==='REVOKED'?'已吊销':'已过期'}</span><b>{profile?.title||permit.productId}</b><time>{new Date(permit.issuedAt).toLocaleString('zh-CN')}</time></header><dl><div><dt>平台站点</dt><dd>{permit.platform} · {permit.marketplaceSite}</dd></div><div><dt>门禁结论</dt><dd>{permit.gateStatus}</dd></div><div><dt>规则版本</dt><dd>{permit.ruleSetVersion}</dd></div><div><dt>有效期至</dt><dd>{new Date(permit.expiresAt).toLocaleString('zh-CN')}</dd></div></dl>{permit.revokeReason&&<p>{permit.revokeReason}</p>}<footer><small>许可编号 {permit.id}</small><button disabled={busy===`permit:${permit.id}`} onClick={()=>void exportPermit(permit.id)}>{busy===`permit:${permit.id}`?'导出中…':'导出许可凭证'}</button></footer></article>}):<div className="compliance-audit-empty">商品通过最新合规检查后，将自动签发发布许可。</div>}</div></div>}
    {tab==='enforcement'&&<div className="compliance-enforcement-panel"><header><div><b>在售商品合规监管</b><small>仅对实际在线商品生成处置单；系统不会擅自操作平台下架，需人工在平台完成后回填结论。</small></div><span>{workspace.metrics.openEnforcementCases} 个待处置</span></header><div className="compliance-enforcement-summary"><article><small>紧急下架</small><b>{workspace.enforcementCases.filter(item=>item.status!=='RESOLVED'&&item.recommendedAction==='REMOVE_LISTING').length}</b></article><article><small>暂停并复核</small><b>{workspace.enforcementCases.filter(item=>item.status!=='RESOLVED'&&item.recommendedAction==='PAUSE_AND_REVIEW').length}</b></article><article><small>整改后重检</small><b>{workspace.enforcementCases.filter(item=>item.status!=='RESOLVED'&&item.recommendedAction==='CORRECT_AND_RECHECK').length}</b></article><article><small>已完成</small><b>{workspace.enforcementCases.filter(item=>item.status==='RESOLVED').length}</b></article></div><section>{workspace.enforcementCases.length?workspace.enforcementCases.map(item=><article className={`compliance-enforcement-case ${item.status.toLowerCase()}`} key={item.id}><span className={`risk ${item.riskLevel.toLowerCase()}`}>{item.riskLevel}</span><div><header><b>{item.title||item.productId}</b><strong>{item.status==='OPEN'?'待接收':item.status==='IN_PROGRESS'?'处置中':'已完成'}</strong></header><small>{item.platform} · {item.marketplaceSite} · Listing {item.listingId}</small><p>{item.reason}</p><em>{item.recommendedAction==='REMOVE_LISTING'?'建议：立即下架并核验召回或禁售范围':item.recommendedAction==='PAUSE_AND_REVIEW'?'建议：暂停销售，补充资料并重新检查':'建议：修正线上内容后重新执行合规检查'}</em>{item.assignee&&<small>负责人：{item.assignee}</small>}{item.resolution&&<small>处理结论：{item.resolution}</small>}</div><footer>{item.viewUrl&&<a href={item.viewUrl} target="_blank" rel="noreferrer">查看线上商品 ↗</a>}{item.status==='OPEN'&&<button disabled={busy===`enforcement:${item.id}`} onClick={()=>void updateEnforcement(item.id,'IN_PROGRESS')}>接收处置</button>}{item.status!=='RESOLVED'&&<button className="primary" disabled={busy===`enforcement:${item.id}`} onClick={()=>void updateEnforcement(item.id,'RESOLVED')}>完成并留痕</button>}</footer></article>):<div className="compliance-audit-empty">当前没有在售商品合规处置单。</div>}</section></div>}
    {tab==='alerts'&&<div className="compliance-audit-workspace"><header><div><b>合规告警与审计</b><small>来源异常、政策变化、召回命中和发布阻断统一进入告警；处理动作永久留痕。</small></div><button className="primary" disabled={busy==='export'} onClick={()=>void exportEvidence()}>{busy==='export'?'导出中…':'导出证据报告'}</button></header><div className="compliance-alert-summary"><article><small>未接收</small><b>{workspace.alerts.filter(item=>item.status==='OPEN').length}</b></article><article><small>处理中</small><b>{workspace.alerts.filter(item=>item.status==='ACKNOWLEDGED').length}</b></article><article><small>已关闭</small><b>{workspace.alerts.filter(item=>item.status==='RESOLVED').length}</b></article><article><small>审计记录</small><b>{workspace.auditEvents.length}</b></article></div><div className="compliance-audit-columns"><section><header><b>告警中心</b><small>按风险和状态排序</small></header>{workspace.alerts.length?workspace.alerts.map(alert=><article className={`compliance-alert-item ${alert.status.toLowerCase()}`} key={alert.id}><span className={`risk ${alert.riskLevel.toLowerCase()}`}>{alert.riskLevel}</span><div><b>{alert.title}</b><small>{alert.alertType} · {alert.entityId} · {new Date(alert.updatedAt).toLocaleString('zh-CN')}</small><p>{alert.detail}</p>{alert.note&&<em>{alert.note}</em>}</div><strong>{alert.status==='OPEN'?'未接收':alert.status==='ACKNOWLEDGED'?'处理中':'已关闭'}</strong><footer>{alert.status==='OPEN'&&<button disabled={busy===`alert:${alert.id}`} onClick={()=>void updateAlert(alert.id,'ACKNOWLEDGED')}>接收</button>}{alert.status!=='RESOLVED'&&<button className="primary" disabled={busy===`alert:${alert.id}`} onClick={()=>void updateAlert(alert.id,'RESOLVED')}>关闭告警</button>}</footer></article>):<div className="compliance-audit-empty">当前没有合规告警。</div>}</section><section><header><b>审计轨迹</b><small>最近 500 条关键操作</small></header>{workspace.auditEvents.length?workspace.auditEvents.map(event=><article className="compliance-audit-event" key={event.id}><span>✓</span><div><b>{event.action}</b><small>{event.entityType} · {event.entityId}</small><p>{event.detail}</p></div><time>{new Date(event.createdAt).toLocaleString('zh-CN')}</time></article>):<div className="compliance-audit-empty">完成同步、检查或复核后，这里会形成审计记录。</div>}</section></div></div>}
    {tab==='monitoring'&&<div className="compliance-monitoring"><header><div><b>规则与商品持续监测</b><small>三个官方召回库和三个平台政策来源每 24 小时检测；来源变化生成待审核规则版本，并重新执行相关商品门禁。</small></div><button className="primary" disabled={busy==='recheck'} onClick={()=>void recheckProfiles()}>{busy==='recheck'?'重检中…':'全部商品重检'}</button></header><div className="monitoring-platforms"><article><b>eBay</b><span>{workspace.profiles.filter(item=>item.platform==='EBAY').length} 个档案</span><button disabled={busy==='recheck'} onClick={()=>void recheckProfiles('EBAY')}>重检 eBay</button></article><article><b>Ozon</b><span>{workspace.profiles.filter(item=>item.platform==='OZON').length} 个档案</span><button disabled={busy==='recheck'} onClick={()=>void recheckProfiles('OZON')}>重检 Ozon</button></article><article><b>AliExpress</b><span>{workspace.profiles.filter(item=>item.platform==='ALIEXPRESS').length} 个档案</span><button disabled={busy==='recheck'} onClick={()=>void recheckProfiles('ALIEXPRESS')}>重检 AliExpress</button></article></div><section><header><div><b>权威来源状态</b><small>检测失败会保留错误，不会把登录页、验证码或空页面当成政策正文。</small></div></header>{workspace.sources.map(source=><div className="monitoring-source" key={source.id}><span className={`source-dot ${source.syncStatus.toLowerCase()}`}/><p><b>{source.name}</b><small>{source.authority} · {source.syncMode} · {source.lastCheckedAt?`最近检测 ${new Date(source.lastCheckedAt).toLocaleString('zh-CN')}`:'尚未检测'}{source.changeCount?` · 已发现 ${source.changeCount} 次变化`:''}</small>{source.lastError&&<small className="source-error">{source.lastError}</small>}</p><button disabled={busy.startsWith('sync:')} onClick={()=>void syncSource(source.id)}>{busy===`sync:${source.id}`?'检测中…':source.sourceType==='PLATFORM'?'立即检测':'立即同步'}</button><em>{source.syncStatus==='READY'?'可用':source.syncStatus==='ERROR'?'检测异常':'待配置'}</em></div>)}</section>{workspace.sourceChanges.length>0&&<section className="source-change-panel"><header><div><b>官方政策变化记录</b><small>变化只生成待审核版本，未经人工审核不会直接改写生效规则。</small></div></header>{workspace.sourceChanges.map(change=>{const source=workspace.sources.find(item=>item.id===change.sourceId);return <article key={change.id}><span className={change.status==='REVIEWED'?'reviewed':'pending'}>{change.status==='REVIEWED'?'已审核':'待审核'}</span><p><b>{source?.name||change.sourceId}</b><small>{new Date(change.detectedAt).toLocaleString('zh-CN')} · 影响 {change.affectedRuleIds.length} 条规则</small><em>{change.summary}</em></p></article>})}</section>}</div>}
    {tab==='overview'&&<><div className="compliance-metrics"><article><small>已启用规则</small><b>{workspace.metrics.activeRules}</b><span>进入检查引擎</span></article><article><small>待人工审核</small><b>{workspace.metrics.pendingReview}</b><span>未生效规则</span></article><article><small>官方召回</small><b>{workspace.metrics.recalls}</b><span>本地可检索</span></article><article><small>待同步来源</small><b>{workspace.metrics.staleSources}</b><span>超过 7 天或未配置</span></article></div><div className="compliance-overview-grid"><article><header><div><b>权威数据源</b><small>未配置的来源不会伪装成已同步</small></div></header><div className="compliance-source-list">{workspace.sources.map(source=><div key={source.id}><span className={`source-dot ${source.syncStatus.toLowerCase()}`}/><p><b>{source.name}</b><small>{source.authority} · {source.syncMode}</small></p><em>{source.syncStatus==='READY'?'可用':source.syncStatus==='ERROR'?'同步异常':'待配置'}</em></div>)}</div></article><article><header><div><b>发布前门禁</b><small>检查结果不只是参考分数</small></div></header><div className="compliance-gates"><span className="p0"><b>P0 禁止发布</b><small>禁售、确认侵权或命中召回</small></span><span className="p1"><b>P1 待人工复核</b><small>关键证书或安全信息不足</small></span><span className="p2"><b>P2 整改后重检</b><small>图片、文案或属性需修复</small></span><span className="passed"><b>已通过</b><small>才能进入线上发布</small></span></div></article></div></>}
    {(tab==='platform'||tab==='regulations')&&<div className="compliance-rule-workspace"><aside><header><div><b>{tab==='platform'?'平台规则':'国家法规'}</b><small>{visibleRules.length} 条结构化规则</small></div><button onClick={()=>editRule()}>＋ 新增</button></header><div>{visibleRules.map(rule=><button key={rule.id} className={selectedRule?.id===rule.id?'active':''} onClick={()=>setSelectedRuleId(rule.id)}><span className={`risk ${rule.riskLevel.toLowerCase()}`}>{rule.riskLevel}</span><p><b>{rule.version.title}</b><small>{rule.code} · v{rule.currentVersion}</small></p><em>{rule.reviewStatus==='ACTIVE'?'已启用':rule.reviewStatus==='PENDING_REVIEW'?'待审核':rule.reviewStatus==='INACTIVE'?'已停用':'草稿'}</em></button>)}</div></aside><main>{selectedRule?<><header><div><small>{selectedRule.platform} · {selectedRule.marketplaceSite} · {selectedRule.country}</small><h2>{selectedRule.version.title}</h2></div><button onClick={()=>editRule(selectedRule)}>编辑新版本</button></header><dl className="compliance-rule-detail"><div><dt>风险等级</dt><dd>{selectedRule.riskLevel}</dd></div><div><dt>规则类型</dt><dd>{selectedRule.ruleType}</dd></div><div><dt>生效日期</dt><dd>{selectedRule.version.effectiveFrom}</dd></div><div><dt>当前版本</dt><dd>v{selectedRule.currentVersion}</dd></div></dl><section><b>判定说明</b><p>{selectedRule.version.summary}</p></section><section><b>整改路径</b><p>{selectedRule.version.remediation}</p></section><section><b>官方依据</b><a href={selectedRule.version.sourceUrl}>{selectedRule.version.sourceUrl}</a></section><section><b>版本历史</b><div className="rule-version-list">{selectedRule.versions.map(version=><span key={version.id}><b>v{version.version}</b><small>{version.effectiveFrom} · {new Date(version.createdAt).toLocaleString('zh-CN')}</small></span>)}</div></section><footer><button disabled={busy===`status:${selectedRule.id}`} onClick={()=>void changeStatus(selectedRule,selectedRule.reviewStatus==='ACTIVE'?'INACTIVE':'ACTIVE')}>{selectedRule.reviewStatus==='ACTIVE'?'停用规则':'审核并启用'}</button>{selectedRule.reviewStatus==='DRAFT'&&<button onClick={()=>void changeStatus(selectedRule,'PENDING_REVIEW')}>提交审核</button>}</footer></>:<p>暂无规则</p>}</main></div>}
    {tab==='recalls'&&<div className="compliance-recall-panel"><header><div><b>风险召回库</b><small>美国 CPSC、英国 OPSS 与 EU Safety Gate 均使用官方机器数据自动同步并参与发布门禁。</small></div><div className="compliance-recall-actions"><button className="primary" disabled={busy.startsWith('sync:')} onClick={()=>void syncSource('source-cpsc')}>{busy==='sync:source-cpsc'?'同步中…':'同步 CPSC'}</button><button className="primary" disabled={busy.startsWith('sync:')} onClick={()=>void syncSource('source-uk-opss')}>{busy==='sync:source-uk-opss'?'同步中…':'同步 UK OPSS'}</button><button className="primary" disabled={busy.startsWith('sync:')} onClick={()=>void syncSource('source-eu-safety-gate')}>{busy==='sync:source-eu-safety-gate'?'同步中…':'同步 Safety Gate'}</button></div></header><div className="compliance-recall-table"><div className="head"><span>召回商品</span><span>风险</span><span>日期</span><span>来源</span></div>{workspace.recalls.length?workspace.recalls.map(item=>{const source=workspace.sources.find(entry=>entry.id===item.sourceId);return <div key={item.id}><span><b>{item.title}</b><small>{item.products||item.description}</small></span><span>{item.hazards||'待核对'}</span><span>{item.recallDate||'-'}</span><span><a href={item.sourceUrl} target="_blank" rel="noreferrer">{source?.name||item.sourceId} ↗</a></span></div>}):<p>尚未同步官方召回数据。点击右上角同步后，数据才会进入本地检查引擎。</p>}</div></div>}
    {editing&&createPortal(<div className="compliance-editor-backdrop"><form className="compliance-editor" onSubmit={saveRule}><header><div><b>{draft.id?'编辑规则新版本':'新增合规规则'}</b><small>保存时生成新版本，不覆盖历史依据</small></div><button type="button" onClick={()=>setEditing(false)}>×</button></header><div className="editor-grid"><label>规则编码<input required value={draft.code} onChange={event=>setDraft({...draft,code:event.target.value})}/></label><label>风险等级<select value={draft.riskLevel} onChange={event=>setDraft({...draft,riskLevel:event.target.value as ComplianceRiskLevel})}><option>P0</option><option>P1</option><option>P2</option><option>P3</option></select></label><label>平台<input value={draft.platform} onChange={event=>setDraft({...draft,platform:event.target.value})}/></label><label>站点<input value={draft.marketplaceSite} onChange={event=>setDraft({...draft,marketplaceSite:event.target.value})}/></label><label>国家/地区<input value={draft.country} onChange={event=>setDraft({...draft,country:event.target.value})}/></label><label>适用类目<input value={draft.category} placeholder="ALL 或具体类目 ID" onChange={event=>setDraft({...draft,category:event.target.value})}/></label><label>规则类型<input value={draft.ruleType} onChange={event=>setDraft({...draft,ruleType:event.target.value})}/></label></div><label>规则标题<input required value={draft.title} onChange={event=>setDraft({...draft,title:event.target.value})}/></label><label>判定说明<textarea required value={draft.summary} onChange={event=>setDraft({...draft,summary:event.target.value})}/></label><label>命中关键词（逗号分隔）<input value={draft.keywords.join(', ')} onChange={event=>setDraft({...draft,keywords:event.target.value.split(',').map(value=>value.trim()).filter(Boolean)})}/></label><label>必填字段（逗号分隔）<input value={draft.requiredFields.join(', ')} onChange={event=>setDraft({...draft,requiredFields:event.target.value.split(',').map(value=>value.trim()).filter(Boolean)})}/></label><label>整改建议<textarea required value={draft.remediation} onChange={event=>setDraft({...draft,remediation:event.target.value})}/></label><div className="editor-grid"><label>官方来源<input required type="url" value={draft.sourceUrl} onChange={event=>setDraft({...draft,sourceUrl:event.target.value})}/></label><label>生效日期<input required type="date" value={draft.effectiveFrom} onChange={event=>setDraft({...draft,effectiveFrom:event.target.value})}/></label></div><footer><button type="button" onClick={()=>setEditing(false)}>取消</button><button className="primary" disabled={busy==='save'}>{busy==='save'?'保存中…':'保存新版本'}</button></footer></form></div>,document.body)}
  </section>
}

function ComplianceDocumentReview({documents,onChanged}:{documents:ComplianceDocumentRecord[];onChanged:()=>Promise<void>}){
  const pending=documents.filter(item=>item.status==='PENDING_REVIEW')
  const [busy,setBusy]=useState('')
  const decide=async(document:ComplianceDocumentRecord,status:'APPROVED'|'REJECTED')=>{const note=window.prompt(status==='APPROVED'?'请输入核验依据':'请输入驳回原因',status==='APPROVED'?'已核对型号、签发机构和适用市场':'文件与当前商品或销售市场不匹配')||'';if(!note)return;setBusy(document.id);try{await window.desktop.compliance.saveDocument({...document,status,reviewNote:note});await onChanged()}finally{setBusy('')}}
  if(!pending.length)return <section className="compliance-document-review"><header><div><b>证书与文件待审核</b><small>当前没有待审核文件</small></div><span>0</span></header></section>
  return <section className="compliance-document-review"><header><div><b>证书与文件待审核</b><small>只有人工核验通过后才参与发布门禁</small></div><span>{pending.length}</span></header>{pending.map(document=><article key={document.id}><div><b>{document.name}</b><small>{document.documentType} · {document.fileName||'未上传文件'} · 商品 {document.productId}</small></div><button disabled={busy===document.id} onClick={()=>void decide(document,'REJECTED')}>驳回</button><button className="primary" disabled={busy===document.id} onClick={()=>void decide(document,'APPROVED')}>核验通过</button></article>)}</section>
}

function NavButton({ label, icon, count, active, onClick }: { label: string; icon: string; count?: number; active: boolean; onClick: () => void }) {
  const iconPaths: Record<string, ReactNode> = {
    collect: <><path d="M4 7h16v12H4z"/><path d="M8 4h8M8 11h8M8 15h5"/></>,
    candidate: <><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
    compare: <><path d="M4 8h13M14 5l3 3-3 3M20 16H7M10 13l-3 3 3 3"/></>,
    select: <><path d="M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></>,
    stock: <><path d="M4 8l8-4 8 4-8 4zM4 8v9l8 4 8-4V8M12 12v9"/></>,
    listing: <><path d="M5 20h14V9H5zM8 5h8M12 16V4M9 7l3-3 3 3"/></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="M4 17l5-5 4 4 2-2 5 4"/></>,
    realshift: <><path d="M4 18l7-7M9 5l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM17 12l1.2 2.8L21 16l-2.8 1.2L17 20l-1.2-2.8L13 16l2.8-1.2z"/><path d="M5 21l-2-2 9-9 2 2z"/></>,
    purchase: <><path d="M3 6h2l2 9h10l2-6H7M9 20h.01M17 20h.01"/></>,
    finance: <><path d="M4 20h16M6 17V9M10 17V5M14 17v-4M18 17V7"/></>,
    support: <><path d="M4 13v-2a8 8 0 0116 0v2M4 13h3v6H5a2 2 0 01-2-2v-2a2 2 0 011-2zM20 13h-3v6h2a2 2 0 002-2v-2a2 2 0 00-1-2zM17 19c0 2-2 2-5 2"/></>,
    feishu: <><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 12h8M12 8v8"/></>,
    archive: <><path d="M4 7h16v13H4zM3 4h18v3H3z"/><path d="M9 11h6"/></>,
    compliance: <><path d="M12 3l7 3v5c0 4.8-2.8 8.2-7 10-4.2-1.8-7-5.2-7-10V6z"/><path d="M9 12l2 2 4-5"/></>,
    ebay: <><path d="M4 9h16l-1 11H5zM7 9V7a5 5 0 0110 0v2"/><path d="M8 14h8M8 17h5"/></>
  }
  return <button type="button" className={active ? 'nav-active' : ''} onClick={onClick}><span className="nav-icon"><svg viewBox="0 0 24 24" aria-hidden="true">{iconPaths[icon]}</svg></span><span className="nav-label">{label}</span>{count ? <em>{count}</em> : null}</button>
}

function FeishuBotPage({ activeTask }: { activeTask: SelectionTask | null }) {
  const commands = [
    { command: '采集 Ozon 无线吸尘器 30', description: '在 Ozon 按关键词采集，最后的数字是目标数量' },
    { command: '采集 1688 无线吸尘器 30', description: '在 1688 采集并返回 AI 优选数量' },
    { command: '状态', description: '查询最近一个任务的状态和任务 ID' },
    { command: '帮助', description: '在飞书中查看机器人可用指令' }
  ]
  return <section className="feishu-page">
    <div className="feishu-overview">
      <div><small>FEISHU BOT</small><h2>用一条飞书指令驱动选品工作台</h2><p>机器人通过长连接接收指令，复用当前桌面应用的浏览器、采集器和本地数据库。</p></div>
      <div className="feishu-flow"><span>飞书指令</span><i>→</i><span>本地执行</span><i>→</i><span>结果回传</span></div>
    </div>
    <div className="feishu-grid">
      <article className="feishu-card command-card"><div className="feishu-card-title"><div><b>指令中心</b><small>在机器人单聊或群聊 @ 机器人后发送</small></div><span>4 条指令</span></div><div className="command-list">{commands.map(item=><div key={item.command}><code>{item.command}</code><p>{item.description}</p></div>)}</div></article>
      <article className="feishu-card"><div className="feishu-card-title"><div><b>运行状态</b><small>机器人与桌面端共用同一个任务执行器</small></div></div><div className="bot-status-row"><span className="bot-status-icon">✓</span><div><b>机器人代码已启用</b><small>启动桌面应用后自动建立飞书长连接</small></div></div><dl className="feishu-details"><div><dt>当前机制</dt><dd>单任务互斥</dd></div><div><dt>消息安全</dt><dd>消息 ID 去重</dd></div><div><dt>凭证保存</dt><dd>本地环境文件</dd></div><div><dt>最近任务</dt><dd>{activeTask?.name || '暂无任务'}</dd></div><div><dt>任务状态</dt><dd>{activeTask?.stage || '-'}</dd></div></dl></article>
      <article className="feishu-card setup-card"><div className="feishu-card-title"><div><b>飞书后台检查清单</b><small>完成并发布后，机器人才能正式收发消息</small></div></div><ol><li><span>1</span><div><b>开启机器人能力</b><small>在飞书开放平台的应用能力中启用机器人</small></div></li><li><span>2</span><div><b>选择长连接订阅</b><small>订阅 im.message.receive_v1，无需配置公网回调地址</small></div></li><li><span>3</span><div><b>申请消息权限</b><small>读取单聊或群聊 @ 消息，并允许应用身份发消息</small></div></li><li><span>4</span><div><b>设置可用范围并发布</b><small>将使用人加入可用范围，创建并发布应用版本</small></div></li></ol></article>
      <article className="feishu-card feedback-card"><div className="feishu-card-title"><div><b>反馈规则</b><small>任务执行过程中的飞书回复</small></div></div><div className="feedback-step"><span>→</span><div><b>已接收</b><small>回复平台、关键词和目标数量</small></div></div><div className="feedback-step success"><span>✓</span><div><b>任务完成</b><small>回复采集数量、AI 优选数量和任务 ID</small></div></div><div className="feedback-step failed"><span>!</span><div><b>任务失败</b><small>回复可读的失败原因，便于重试或处理登录问题</small></div></div><p className="feishu-note">注意：采集依赖本机浏览器会话，电脑和桌面应用需保持运行。</p></article>
    </div>
  </section>
}

function EmptyState({ title, description, action, onAction }: { title: string; description: string; action?: string; onAction?: () => void }) {
  return <div className="empty-state"><span>◎</span><h2>{title}</h2><p>{description}</p>{action&&onAction&&<button className="primary" onClick={onAction}>{action}</button>}</div>
}

const supportedLanguages = ['中文 zh-CN','英语 en-US','俄语 ru-RU','西班牙语 es-ES','葡萄牙语 pt-BR','法语 fr-FR','德语 de-DE','意大利语 it-IT','波兰语 pl-PL','土耳其语 tr-TR','阿拉伯语 ar-SA','日语 ja-JP','韩语 ko-KR','泰语 th-TH','越南语 vi-VN','印尼语 id-ID']

function AiSupportFramework() {
  return <section className="support-page">
    <div className="support-subnav"><button className="active">会话工作台</button><button>知识库</button><button>自动化</button><button>质检报表</button><button>渠道设置</button></div>
    <div className="support-workspace">
      <aside className="conversation-pane"><div className="pane-title"><div><b>客户会话</b><small>0 个待处理</small></div><button>筛选</button></div><input className="support-search" placeholder="搜索客户、订单号、会话" /><div className="queue-tabs"><button className="active">待处理</button><button>AI 处理中</button><button>待人工</button></div><div className="support-empty"><span>◌</span><b>尚未接入客服渠道</b><small>后续可连接 Ozon、邮件、网站聊天及其他跨境平台。</small></div></aside>
      <main className="chat-pane"><div className="chat-header"><div><b>多语种 AI 客服</b><small>建议回复模式 · 人工确认后发送</small></div><span className="support-status">安全模式</span></div><div className="chat-onboarding"><div className="ai-orb">AI</div><h2>客服功能框架已就绪</h2><p>接入渠道后，客户原文会自动识别语言、生成中文工作译文，并以客户语言生成回复草稿。</p><div className="language-cloud">{supportedLanguages.map(language=><span key={language}>{language}</span>)}</div></div><div className="composer-disabled"><div>AI 建议回复将在这里生成</div><button disabled>发送回复</button></div></main>
      <aside className="context-pane"><div className="context-section"><b>客户与订单上下文</b><div className="context-row"><span>客户</span><em>待关联</em></div><div className="context-row"><span>销售订单</span><em>待关联</em></div><div className="context-row"><span>物流状态</span><em>待查询</em></div><div className="context-row"><span>原始语言</span><em>自动检测</em></div><div className="context-row"><span>回复语言</span><em>跟随客户</em></div></div><div className="context-section"><b>AI 处理边界</b><ul><li>查询订单、库存和物流</li><li>基于知识库建议回复</li><li>低置信度自动转人工</li><li>退款、取消、补发必须审批</li></ul></div><div className="context-section"><b>知识与审计</b><small>保存知识引用、模型版本、翻译记录、工具调用和人工修改，支持全程追溯。</small></div></aside>
    </div>
  </section>
}
