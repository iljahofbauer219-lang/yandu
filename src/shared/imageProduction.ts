import type { EbayImageCandidateReview, ImagePackageTextExtractionResult, ImageReferenceRole, ImportedProductImage } from './contracts'

export type ImageProductionPlan = 'full' | 'main' | 'detail'
export type ImageProductionTaskStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'REVIEW' | 'FAILED'

export interface PlatformImageRuleProfile {
  id:'OZON'
  platformName:string
  version:string
  sourceUrl:string
  sourceLabel:string
  recommendedMainCount:number
  recommendedDetailCount:number
  maxGalleryImages:number
  heroRules:string[]
  galleryRules:string[]
  planningNotes:string[]
}

export const PLATFORM_IMAGE_RULES:Record<string,PlatformImageRuleProfile>={
  Ozon:{id:'OZON',platformName:'Ozon',version:'2026-08-04',sourceUrl:'https://docs.ozon.com/global/ozon-seller-app/product-management/',sourceLabel:'Ozon官方帮助 · 商品图片管理',recommendedMainCount:5,recommendedDetailCount:7,maxGalleryImages:15,heroRules:['第一张图片作为商品主图','主体完整、清晰、易识别','避免促销角标、水印和无依据文字'],galleryRules:['单个商品图库最多15张图片','每张图片均会经过平台检查','图片顺序决定商品卡片中的展示顺序'],planningNotes:['5张主图与7张详情页是本系统的生产建议，不冒充平台硬性数量','用户可自定义生产数量；超过15张时需分批选择最终上传图库']}
}

export function getPlatformImageRule(platform:string):PlatformImageRuleProfile {
  return PLATFORM_IMAGE_RULES[platform]||PLATFORM_IMAGE_RULES.Ozon
}

export function platformImageRulePrompt(platform:string,group:'MAIN'|'DETAIL',code:string):string {
  const rule=getPlatformImageRule(platform),base=code.split('-')[0]
  if(group==='MAIN'&&base==='H01')return `PLATFORM CONTRACT ${rule.id} v${rule.version}: this is the first gallery image and platform hero. ${rule.heroRules.join('; ')}. No final marketing typography.`
  if(group==='MAIN')return `PLATFORM CONTRACT ${rule.id} v${rule.version}: this is a supporting gallery image, not a detail-page module. Keep the product immediately recognizable and preserve gallery order intent. ${rule.galleryRules.join('; ')}.`
  return `PLATFORM CONTRACT ${rule.id} v${rule.version}: this is a detail-page content module, not the platform hero image. Keep safe areas for later layout, use only confirmed product facts, and do not render final marketing typography in the generated base image.`
}

export function platformImagePlanningWarnings(platform:string,mainCount:number,detailCount:number):string[] {
  const rule=getPlatformImageRule(platform),total=Math.max(0,mainCount)+Math.max(0,detailCount)
  return total>rule.maxGalleryImages?[`计划生成${total}张，超过Ozon单个商品图库最多${rule.maxGalleryImages}张；可以继续生产，但最终上传前必须筛选。`]:[]
}

export type ImageStylePresetId = 'CLEAN_COMMERCE' | 'LIGHT_SCENE' | 'BRAND_PREMIUM' | 'LIFESTYLE'

export interface ImageStyleLock {
  enabled: boolean
  presetId: ImageStylePresetId
  presetName: string
  primaryColor: string
  backgroundColor: string
  lighting: string
  composition: string
  mood: string
  typography: string
  version: number
}

export interface ImageStyleContract {
  presetId:ImageStylePresetId
  shortDescription:string
  bestFor:string[]
  requiredCues:string[]
  forbiddenCues:string[]
  heroOverride:string
}

export type ImageLayoutTemplate = 'BOTTOM_BAND' | 'TOP_LEFT' | 'SIDE_PANEL'

export interface ImageLayoutDraft {
  template: ImageLayoutTemplate
  headline: string
  subheadline: string
  language: string
  accentColor: string
  textColor: string
  fontFamily: 'SYSTEM_SANS' | 'SERIF' | 'ROUNDED'
  version: number
  sourceHeadline?:string
  sourceSubheadline?:string
  translationStatus?:'NOT_REQUIRED'|'TRANSLATED'|'REVIEW'|'FAILED'
  translationIssues?:string[]
}

export type ImageLocalEditOperation = 'BRIGHTEN' | 'DARKEN' | 'BLUR' | 'AI_REPAINT'

export interface ImageLocalEditRecord {
  id: string
  operation: ImageLocalEditOperation
  instruction?: string
  region: { x:number; y:number; width:number; height:number }
  beforeUrl: string
  outputUrl: string
  qualityStatus?: 'PASSED' | 'REVIEW' | 'REJECTED'
  qualityReason?: string
  qualityLayers?: ImageTaskQualityLayers
  createdAt: string
}

export interface ImageSizeComplianceResult {
  status:'PASSED'|'REJECTED'
  format:string
  byteSize:number
  safeMarginPercent:number
  checks:string[]
  issues:string[]
}

export interface ImageSizeVariant {
  id: string
  label: string
  width: number
  height: number
  fit: 'CONTAIN'
  outputUrl: string
  compliance?:ImageSizeComplianceResult
  createdAt: string
}

export function validateNormalizedImageRegion(region:ImageLocalEditRecord['region']):boolean {
  return region.x>=0&&region.y>=0&&region.width>=.03&&region.height>=.03&&region.x+region.width<=1.0001&&region.y+region.height<=1.0001
}

export function calculateContainPlacement(sourceWidth:number,sourceHeight:number,targetWidth:number,targetHeight:number):{x:number;y:number;width:number;height:number} {
  const scale=Math.min(targetWidth/sourceWidth,targetHeight/sourceHeight),width=Math.round(sourceWidth*scale),height=Math.round(sourceHeight*scale)
  return{x:Math.round((targetWidth-width)/2),y:Math.round((targetHeight-height)/2),width,height}
}

export function validateImageSizeOutput(input:{width:number;height:number;expectedWidth:number;expectedHeight:number;format:string;byteSize:number;placement:{x:number;y:number;width:number;height:number}}):ImageSizeComplianceResult {
  const issues:string[]=[],checks:string[]=[]
  if(input.width!==input.expectedWidth||input.height!==input.expectedHeight)issues.push(`尺寸应为${input.expectedWidth}×${input.expectedHeight}px`);else checks.push('输出尺寸准确')
  if(!['image/png','image/jpeg','image/webp'].includes(input.format))issues.push('文件格式必须为PNG、JPG或WebP');else checks.push('文件格式可上传')
  if(input.byteSize<=0||input.byteSize>10*1024*1024)issues.push('文件必须小于10MB');else checks.push('文件大小在10MB以内')
  const {x,y,width,height}=input.placement
  if(x<0||y<0||width<=0||height<=0||x+width>input.width||y+height>input.height)issues.push('商品主体超出画布');else checks.push('完整主体留白适配，无裁切')
  const safeMarginPercent=Math.round(Math.min(x/input.width,y/input.height,(input.width-x-width)/input.width,(input.height-y-height)/input.height)*1000)/10
  return{status:issues.length?'REJECTED':'PASSED',format:input.format,byteSize:input.byteSize,safeMarginPercent:Math.max(0,safeMarginPercent),checks,issues}
}

export const IMAGE_STYLE_PRESETS:Record<ImageStylePresetId,ImageStyleLock> = {
  CLEAN_COMMERCE:{enabled:true,presetId:'CLEAN_COMMERCE',presetName:'平台标准商品图',primaryColor:'#19B8B2',backgroundColor:'#F7F9F9',lighting:'柔和均匀商业棚拍光，色彩准确，阴影克制',composition:'商品主体完整、居中或稳定三分构图、留白充足',mood:'清晰、可信、合规、无干扰',typography:'现代无衬线，后期排版保持清晰高对比',version:2},
  LIGHT_SCENE:{enabled:true,presetId:'LIGHT_SCENE',presetName:'自然轻场景',primaryColor:'#6FAFA8',backgroundColor:'#EEF4F1',lighting:'自然窗光或柔和日光，阴影方向真实',composition:'商品为绝对主体，仅使用1至2个与用途直接相关的道具',mood:'自然、轻松、可信、受控商业场景',typography:'简洁无衬线，预留自然留白区',version:2},
  BRAND_PREMIUM:{enabled:true,presetId:'BRAND_PREMIUM',presetName:'高级品牌棚拍',primaryColor:'#173F3C',backgroundColor:'#E8E2D8',lighting:'方向明确的高级棚拍主光与轮廓光，保留深浅层次和精细阴影，禁止平淡均匀照明',composition:'高级品牌广告式构图，稳定视觉重心，使用石材或哑光台座、精致留白，禁止普通家居随拍构图',mood:'高级、沉稳、精致，深森林绿必须在环境中清晰可见，禁止只有米色背景的普通电商棚拍',typography:'高级现代无衬线，后期排版克制规整',version:3},
  LIFESTYLE:{enabled:true,presetId:'LIFESTYLE',presetName:'真实生活方式',primaryColor:'#C9825A',backgroundColor:'#F4EEE7',lighting:'自然环境光或真实室内光，保留可信生活质感',composition:'展示人物、宠物、空间或动作与商品之间明确的真实使用关系',mood:'温暖、亲和、有生活痕迹，避免样板间和摆拍感',typography:'友好现代无衬线，预留自然文案区域',version:2}
}

export const IMAGE_STYLE_CONTRACTS:Record<ImageStylePresetId,ImageStyleContract>={
  CLEAN_COMMERCE:{presetId:'CLEAN_COMMERCE',shortDescription:'清晰、合规、商品优先的标准图库方案',bestFor:['平台首图','商品展示','结构材质','包装配件'],requiredCues:['纯白或极浅中性背景','商品完整清晰且占据主要画面','准确颜色与柔和均匀商业光','构图直接并保留干净留白'],forbiddenCues:['无关植物与装饰','复杂空间背景','强戏剧光影','无依据配件或促销文字'],heroOverride:'平台首图必须使用纯白或极浅中性背景，完整展示单一商品主体，不使用场景道具和营销文字。'},
  LIGHT_SCENE:{presetId:'LIGHT_SCENE',shortDescription:'有使用语境但保持商品主导的轻量商业场景',bestFor:['轻场景主图','使用环境','尺寸感','功能说明'],requiredCues:['真实且简洁的使用环境','仅1至2个用途相关道具','自然窗光或柔和日光','商品清晰且仍为视觉中心'],forbiddenCues:['随机绿植堆砌','无关家居装饰','过度虚化或遮挡商品','虚构使用方式'],heroOverride:'平台首图收敛为浅色无道具背景，仅保留自然光感；不得加入生活场景。'},
  BRAND_PREMIUM:{presetId:'BRAND_PREMIUM',shortDescription:'受控灯光、精致材质和品牌色构成的高级广告棚拍',bestFor:['品牌主视觉','高端卖点','材质特写','详情页头图'],requiredCues:['方向主光与可见轮廓光','明确深浅层次和精细阴影','品牌强调色真实进入环境','石材、金属、磨砂或建筑感表面','稳定有秩序的广告构图'],forbiddenCues:['普通米黄色背景冒充高级感','随机植物','平光灰蒙或过曝','廉价塑料背景','只有颜色参数但画面未使用'],heroOverride:'平台首图保持浅色合规背景，通过受控方向光、精细阴影、稳定构图和克制品牌色边缘表达高级感。'},
  LIFESTYLE:{presetId:'LIFESTYLE',shortDescription:'通过真实使用动作表达用户、环境与商品的关系',bestFor:['使用场景','用户体验','痛点解决','使用步骤'],requiredCues:['商品处于真实使用状态','人物、宠物或动作与商品存在明确关系','场景符合已确认商品事实','自然光和适度生活痕迹'],forbiddenCues:['人物摆拍但没有使用行为','商品仅作为背景摆件','过度干净的样板间','错误人群或虚构功能','商品变形或比例错误'],heroOverride:'平台首图不得出现人物动作或复杂生活场景；收敛为清晰浅色商品图，仅保留温暖自然光。'}
}

export function cloneImageStylePreset(presetId:ImageStylePresetId):ImageStyleLock {
  return {...IMAGE_STYLE_PRESETS[presetId]}
}

export function imageStyleLockPrompt(style:ImageStyleLock):string {
  if(!style.enabled)return 'Style lock is disabled; keep a neutral and internally coherent commercial visual direction.'
  const contract=IMAGE_STYLE_CONTRACTS[style.presetId]
  return `STYLE CONTRACT ${style.presetId} v${style.version} (${style.presetName}) — mandatory, not a suggestion. Goal: ${contract.shortDescription}. REQUIRED VISIBLE CUES: ${contract.requiredCues.join('; ')}. FORBIDDEN CUES: ${contract.forbiddenCues.join('; ')}. Accent color: ${style.primaryColor}; preferred background: ${style.backgroundColor}; lighting: ${style.lighting}; composition: ${style.composition}; mood: ${style.mood}; typography direction for reserved text areas only: ${style.typography}. Do not recolor the product, logo, packaging, or verified accessories. Style may affect only environment, props, background, lighting, and layout.`
}

export function imageStyleTaskPrompt(style:ImageStyleLock,task:Pick<ImageProductionTask,'code'|'group'>):string {
  const base=imageStyleLockPrompt(style),contract=IMAGE_STYLE_CONTRACTS[style.presetId],baseCode=task.code.split('-')[0]
  if(task.group==='MAIN'&&baseCode==='H01')return `${base} TASK OVERRIDE FOR PLATFORM HERO: ${contract.heroOverride}`
  if(style.presetId==='LIFESTYLE'&&task.group==='MAIN')return `${base} MAIN-GALLERY RESTRAINT: keep the product dominant and use only one credible action or environmental relationship; avoid complex narrative staging.`
  if(style.presetId==='LIGHT_SCENE'&&['H05','D03','D04','D07'].includes(baseCode))return `${base} INFORMATION-TASK RESTRAINT: use a clean controlled surface and no decorative lifestyle props; express the preset through natural light and one relevant contextual cue only.`
  return `${base} TASK APPLICATION: visibly satisfy at least three required cues that do not conflict with this task's product purpose.`
}

export type ImageFactKey='productName'|'category'|'brand'|'mainColor'|'structure'|'packaging'|'material'|'specification'|'accessories'|'audience'|'useScenario'|'sellingPoint'|'packageText'|'sku'|'price'
export type ImageFactSource='IMAGE'|'OCR'|'WEBPAGE'|'INVENTORY'|'USER'|'AI_INFERENCE'
export type ImageFactStatus='CONFIRMED'|'PENDING'|'CONFLICT'|'UNREADABLE'

export interface ImageProductFactEntry {
  key:ImageFactKey
  label:string
  value:string
  source:ImageFactSource
  sourceLabel:string
  status:ImageFactStatus
  highRisk?:boolean
}

export interface ImageProductFacts {
  productName: string
  sku: string
  source: string
  price: string
  referenceImageUrl: string
  confirmed: boolean
  confirmedAt?: string
  entries?:ImageProductFactEntry[]
  prohibitedInferences?:string[]
  packageTextExtraction?:ImagePackageTextExtractionResult
}

export function applyPackageTextExtraction(facts:ImageProductFacts,extraction:ImagePackageTextExtractionResult):ImageProductFacts {
  const status:ImageFactStatus=extraction.conflicts.length?'CONFLICT':extraction.combinedText.trim()?'PENDING':'UNREADABLE'
  const entries=(facts.entries||[]).map(entry=>entry.key==='packageText'?{...entry,value:extraction.combinedText,source:'OCR' as const,sourceLabel:`包装OCR · ${extraction.observations.length}张图`,status}:entry)
  return {...facts,entries,packageTextExtraction:extraction,confirmed:false,confirmedAt:undefined}
}

export const IMAGE_FACT_DEFINITIONS:ReadonlyArray<{key:ImageFactKey;label:string;highRisk?:boolean}>=[
  {key:'productName',label:'商品名称'}, {key:'category',label:'品类'}, {key:'brand',label:'品牌'},
  {key:'mainColor',label:'主体颜色'}, {key:'structure',label:'商品结构',highRisk:true}, {key:'packaging',label:'包装形态',highRisk:true},
  {key:'material',label:'材质',highRisk:true}, {key:'specification',label:'尺寸/数量/规格',highRisk:true}, {key:'accessories',label:'配件',highRisk:true},
  {key:'audience',label:'适用对象'}, {key:'useScenario',label:'使用场景'}, {key:'sellingPoint',label:'核心卖点',highRisk:true},
  {key:'packageText',label:'包装原文',highRisk:true}, {key:'sku',label:'SKU'}, {key:'price',label:'价格'}
]

export function normalizeImageProductFacts(facts:ImageProductFacts,source:'WEBPAGE'|'INVENTORY'|'IMAGE'='IMAGE'):ImageProductFacts {
  if(facts.entries?.length)return facts
  const values:Partial<Record<ImageFactKey,string>>={productName:facts.productName,sku:facts.sku,price:facts.price}
  const sourceLabel=source==='WEBPAGE'?'商品网页':source==='INVENTORY'?'AI入库资料':'参考图片'
  return {...facts,entries:IMAGE_FACT_DEFINITIONS.map(definition=>({key:definition.key,label:definition.label,value:values[definition.key]||'',source,sourceLabel,status:values[definition.key]?'PENDING':'UNREADABLE',highRisk:definition.highRisk})),prohibitedInferences:['未经确认的尺寸、数量和规格','未经确认的材质与功能','认证、功效、销量和用户评价']}
}

export function validateImageProductFacts(facts:ImageProductFacts):string[] {
  const entries=facts.entries||[]
  const issues:string[]=[]
  if(!facts.productName.trim())issues.push('商品名称不能为空')
  if(!facts.sku.trim())issues.push('SKU不能为空')
  for(const entry of entries){
    if(entry.status==='CONFLICT')issues.push(`${entry.label}存在冲突`)
    else if(entry.highRisk&&entry.value.trim()&&entry.status!=='CONFIRMED')issues.push(`${entry.label}属于高风险事实，必须逐项确认`)
  }
  return issues
}

export function confirmedImageFactContext(facts:ImageProductFacts):string {
  const verified=(facts.entries||[]).filter(entry=>entry.status==='CONFIRMED'&&entry.value.trim()).map(entry=>`${entry.label}=${entry.value.trim()}（来源：${entry.sourceLabel}）`)
  const prohibited=facts.prohibitedInferences?.length?`；禁止推断：${facts.prohibitedInferences.join('、')}`:''
  return `${verified.length?verified.join('；'):`商品=${facts.productName}；SKU=${facts.sku}`}；资料来源=${facts.source}${prohibited}`
}

export interface ImageProductionTask {
  id: string
  code: string
  group: 'MAIN' | 'DETAIL'
  title: string
  objective: string
  prompt: string
  status: ImageProductionTaskStatus
  outputUrl?: string
  layoutDraft?: ImageLayoutDraft
  finalOutputUrl?: string
  localEdits?: ImageLocalEditRecord[]
  sizeVariants?: ImageSizeVariant[]
  providerTaskId?: string
  error?: string
  referenceRoles?: ImageReferenceRole[]
  referenceImageIds?: string[]
  qualityStatus?: 'PASSED' | 'REVIEW' | 'REJECTED'
  qualityReason?: string
  qualityScores?: { identity: number; structure: number; facts: number; purpose: number; style?:number;language?:number }
  qualityLayers?:ImageTaskQualityLayers
  startedAt?: string
  durationMs?: number
  costLabel?: string
  attempts: number
  updatedAt: string
}

export type ImageQualityLayerStatus='PASSED'|'REVIEW'|'REJECTED'
export interface ImageQualityLayerResult {status:ImageQualityLayerStatus;score:number;reason:string}
export interface ImageTaskQualityLayers {facts:ImageQualityLayerResult;task:ImageQualityLayerResult;style:ImageQualityLayerResult;language:ImageQualityLayerResult}

export function buildImageTaskQualityLayers(review:EbayImageCandidateReview):ImageTaskQualityLayers {
  if(review.status==='REVIEW'&&review.identityScore===0&&review.structuralScore===0&&review.factScore===0&&review.purposeScore===0){
    const reason=review.reason||'视觉审核暂不可用，需要人工复核'
    return{facts:{status:'REVIEW',score:0,reason},task:{status:'REVIEW',score:0,reason},style:{status:'REVIEW',score:0,reason},language:{status:'REVIEW',score:0,reason}}
  }
  const factsScore=Math.min(review.identityScore,review.structuralScore,review.factScore,review.geometryScore??100),factRejected=Boolean(review.newStructures?.length||review.geometryMismatch)||factsScore<70,factReview=Boolean(review.missingStructures?.length)||factsScore<80
  const facts:ImageQualityLayerResult={status:factRejected?'REJECTED':factReview?'REVIEW':'PASSED',score:factsScore,reason:factRejected?'商品身份、结构、事实或轮廓存在硬错误':factReview?'商品事实或关键结构需要人工复核':'商品身份、结构与已确认事实一致'}
  const task:ImageQualityLayerResult={status:review.purposeScore<65?'REJECTED':review.purposeScore<75?'REVIEW':'PASSED',score:review.purposeScore,reason:review.purposeScore<65?'未完成计划中的图片任务':review.purposeScore<75?'任务表达需要人工复核':'已完成预定主图/详情页任务'}
  const styleScore=review.styleScore??0,style:ImageQualityLayerResult={status:styleScore<55?'REJECTED':styleScore<75?'REVIEW':'PASSED',score:styleScore,reason:styleScore<55?'视觉模板关键特征明显缺失':styleScore<75?'视觉模板命中不足':'视觉模板必须项与禁止项检查通过'}
  const languageScore=review.languageScore??0,language:ImageQualityLayerResult={status:languageScore<60?'REJECTED':languageScore<80?'REVIEW':'PASSED',score:languageScore,reason:languageScore<60?'底图出现错误营销文字或乱码':languageScore<80?'底图文字状态需要人工复核':'无字底图检查通过；包装原文允许保留'}
  const layers={facts,task,style,language}
  if(review.status==='REJECTED'&&!Object.values(layers).some(layer=>layer.status==='REJECTED'))layers.facts={status:'REJECTED',score:facts.score,reason:review.reason||'视觉审核最终结论为拒绝'}
  else if(review.status==='REVIEW'&&Object.values(layers).every(layer=>layer.status==='PASSED'))layers.facts={status:'REVIEW',score:facts.score,reason:review.reason||'视觉审核要求人工复核'}
  return layers
}

export function summarizeImageTaskQuality(layers:ImageTaskQualityLayers):string {
  const label=(result:ImageQualityLayerResult)=>result.status==='PASSED'?'通过':result.status==='REVIEW'?'复核':'不通过'
  return `事实${label(layers.facts)}(${layers.facts.score}) · 任务${label(layers.task)}(${layers.task.score}) · 风格${label(layers.style)}(${layers.style.score}) · 语言${label(layers.language)}(${layers.language.score})`
}

export function overallImageTaskQuality(layers:ImageTaskQualityLayers):'PASSED'|'REVIEW'|'REJECTED' {
  const values=Object.values(layers);return values.some(layer=>layer.status==='REJECTED')?'REJECTED':values.some(layer=>layer.status==='REVIEW')?'REVIEW':'PASSED'
}

export function imageTaskAllowsTypography(task:Pick<ImageProductionTask,'code'>):boolean {
  return task.code.split('-')[0]!=='H01'
}

export function createDefaultImageLayout(task:Pick<ImageProductionTask,'code'|'title'|'objective'>,facts:Pick<ImageProductFacts,'productName'>,style:ImageStyleLock,language:string):ImageLayoutDraft {
  const headline=task.code.split('-')[0]==='D01'?facts.productName:task.title,subheadline=task.objective
  return {template:task.code.startsWith('D')?'BOTTOM_BAND':'TOP_LEFT',headline,subheadline,sourceHeadline:headline,sourceSubheadline:subheadline,language,translationStatus:language==='中文'?'NOT_REQUIRED':'REVIEW',translationIssues:language==='中文'?[]:['营销文案尚未翻译'],accentColor:style.primaryColor,textColor:'#FFFFFF',fontFamily:'SYSTEM_SANS',version:1}
}

export function protectedCommerceTokens(texts:string[]):string[]{
  return [...new Set(texts.flatMap(text=>text.match(/(?:[A-ZА-Я]{1,8}-?\d[\w-]*|\d+(?:[.,]\d+)?(?:\s?[×x]\s?\d+(?:[.,]\d+)?)?(?:\s?(?:mm|cm|m|ml|l|g|kg|pcs?))?|[$€¥₽]\s?\d+(?:[.,]\d+)?)/gi)||[]))]
}

export function validateMarketingTranslation(sourceTexts:string[],translations:string[],targetLanguage:string,protectedTerms:string[]=[]):string[]{
  const issues:string[]=[]
  if(translations.length!==sourceTexts.length)issues.push('翻译分段数量不一致')
  const joined=translations.join(' '),terms=[...new Set([...protectedCommerceTokens(sourceTexts),...protectedTerms].filter(Boolean))]
  for(const term of terms)if(!joined.toLocaleLowerCase().includes(term.toLocaleLowerCase()))issues.push(`受保护内容缺失：${term}`)
  if(targetLanguage==='俄语'&&translations.some(text=>/[\u4e00-\u9fff]/.test(text)))issues.push('俄语营销文案中仍包含中文')
  if(targetLanguage==='俄语'&&translations.some(text=>text.trim()&&!/[А-Яа-яЁё]/.test(text)&&!/^[\d\s.,%+\-–—/:()A-Z]+$/i.test(text)))issues.push('部分营销文案未识别为俄语')
  return [...new Set(issues)]
}

export function validateImageLayoutDraft(draft:ImageLayoutDraft):string[] {
  const issues:string[]=[]
  const headline=draft.headline.trim(),subheadline=draft.subheadline.trim()
  if(!headline)issues.push('主标题不能为空')
  if(headline.length>42)issues.push('主标题超过42个字符，可能溢出')
  if(subheadline.length>96)issues.push('副标题超过96个字符，可能溢出')
  if(draft.translationStatus==='REVIEW'||draft.translationStatus==='FAILED')issues.push(...(draft.translationIssues?.length?draft.translationIssues:['营销文案尚未完成目标语言翻译']))
  if(draft.language==='俄语'&&/[\u4e00-\u9fff]/.test(`${headline}${subheadline}`))issues.push('俄语排版中不能包含中文营销文案')
  if(!/^#[0-9a-f]{6}$/i.test(draft.accentColor)||!/^#[0-9a-f]{6}$/i.test(draft.textColor))issues.push('排版颜色格式无效')
  return issues
}

export interface ImageProductionProject {
  id: string
  productKey: string
  productTitle: string
  productImageUrl: string
  referenceImages?: ImportedProductImage[]
  mainImageCount?: number
  detailImageCount?: number
  plan: ImageProductionPlan
  platform: string
  platformRuleVersion?:string
  language: string
  model: string
  styleLock?: ImageStyleLock
  facts: ImageProductFacts
  approved: boolean
  approvedAt?: string
  status: 'DRAFT' | 'APPROVED' | 'RUNNING' | 'PARTIAL' | 'COMPLETED' | 'FAILED'
  tasks: ImageProductionTask[]
  createdAt: string
  updatedAt: string
}

export interface ImageOperationsSummary {
  skuCount:number
  completedSkuCount:number
  taskCount:number
  successCount:number
  reviewCount:number
  failedCount:number
  retryCount:number
  qualityPassRate:number
  averageDurationMs:number
  estimatedCostCny:number
  localEditCount:number
  sizeVariantCount:number
  manualReviewRate:number
  rejectionRate:number
  exportReadyCount:number
  formalLayoutCount:number
}

export function isImageTaskExportReady(task:ImageProductionTask):boolean {
  if(task.status!=='SUCCESS'||task.qualityStatus!=='PASSED')return false
  if(imageTaskAllowsTypography(task)&&!task.finalOutputUrl)return false
  return !(task.sizeVariants||[]).some(variant=>variant.compliance?.status==='REJECTED')
}

export function buildImageOperationsSummary(projects:ImageProductionProject[]):ImageOperationsSummary {
  const tasks=projects.flatMap(project=>project.tasks),successCount=tasks.filter(task=>task.status==='SUCCESS').length,reviewCount=tasks.filter(task=>task.status==='REVIEW').length,failedCount=tasks.filter(task=>task.status==='FAILED').length,durations=tasks.map(task=>task.durationMs||0).filter(Boolean)
  return{skuCount:new Set(projects.map(project=>project.productKey)).size,completedSkuCount:projects.filter(project=>project.status==='COMPLETED').length,taskCount:tasks.length,successCount,reviewCount,failedCount,retryCount:tasks.reduce((sum,task)=>sum+Math.max(0,task.attempts-1),0),qualityPassRate:tasks.length?Math.round(successCount/tasks.length*100):0,averageDurationMs:durations.length?Math.round(durations.reduce((sum,value)=>sum+value,0)/durations.length):0,estimatedCostCny:Number(tasks.reduce((sum,task)=>sum+(Number(task.costLabel?.match(/¥\s*([\d.]+)/)?.[1])||0)*task.attempts,0).toFixed(2)),localEditCount:tasks.reduce((sum,task)=>sum+(task.localEdits?.length||0),0),sizeVariantCount:tasks.reduce((sum,task)=>sum+(task.sizeVariants?.length||0),0),manualReviewRate:tasks.length?Math.round(reviewCount/tasks.length*100):0,rejectionRate:tasks.length?Math.round(failedCount/tasks.length*100):0,exportReadyCount:tasks.filter(isImageTaskExportReady).length,formalLayoutCount:tasks.filter(task=>Boolean(task.finalOutputUrl)).length}
}

const MAIN_TASKS = [
  ['H01', '平台合规首图', '完整、清晰地展示真实商品主体，作为平台首图。', 'Create a clean platform-compliant hero image on a pure light background. Show the complete referenced product clearly, with no promotional text, badge, invented packaging, props, or cropped parts.'],
  ['H02', '核心功能或材质', '突出一个参考图可验证的功能、结构或材质细节。', 'Create a focused commercial detail image showing one visually verifiable material, construction, finish, or functional detail from the referenced product. Do not invent specifications or claims.'],
  ['H03', '真实使用场景', '将商品放入合理使用环境，同时保持商品清晰可辨。', 'Place the exact referenced product in one plausible real-life use scenario. Keep the product dominant and recognizable; preserve its structure, color, material, logo, and accessory count.'],
  ['H04', '选择理由', '通过可观察的设计或使用方式表达选择理由，不虚构对比数据。', 'Create a product-led choice-reason image using only observable product design and plausible use. No before-and-after claims, percentages, certifications, testimonials, or competitor branding.'],
  ['H05', '包装与配件', '准确展示参考图中可确认的包装、配件或组合内容。', 'Create a clean package-and-accessories presentation. Include only items visibly supported by the reference image and product facts; do not add accessories, gifts, guarantees, or labels.']
] as const

const DETAIL_TASKS = [
  ['D01', '产品定位与适用人群', '说明产品适合谁以及主要使用需求。', 'Create a PDP opening visual that presents the exact product and a plausible target-use context. Keep generous safe space for later typography; generate no final text.'],
  ['D02', '需求与使用痛点', '展示合理使用需求，不制造恐惧或未经证实的问题。', 'Create a restrained problem-context visual for a plausible customer need that this product visibly addresses. Avoid exaggerated pain, medical implications, and before-and-after framing.'],
  ['D03', '结构与工作方式', '用画面解释参考图可验证的结构或使用方式。', 'Create a clear mechanism or construction visual based only on visible referenced product facts. No invented internal components, measurements, labels, or performance data.'],
  ['D04', '核心利益信息图底图', '为2至3个已确认利益点预留后期排版区域。', 'Create a clean ecommerce infographic background with the exact product as focal point and 2-3 empty callout zones for later typography. Do not render final words, numbers, icons, or claims.'],
  ['D05', '使用步骤底图', '展示合理的使用过程，并为后期步骤文字留白。', 'Create a simple three-step usage sequence background based on a plausible operation of the referenced product. Preserve product identity and leave clean numbered-step areas without rendering final text.'],
  ['D06', '场景覆盖', '展示多个合理使用场景，保持商品身份一致。', 'Create a coherent lifestyle visual showing plausible usage coverage while keeping the exact referenced product consistent. Avoid collage clutter, duplicate products, and unsupported scenarios.'],
  ['D07', '包装、FAQ与保障底图', '展示已确认包装内容并为FAQ或保障文案预留区域。', 'Create a clean PDP closing background showing only verified package contents and generous safe space for later FAQ or warranty typography. Do not invent guarantees, certifications, reviews, or package items.']
] as const

const taskReferenceRoles:Record<string,ImageReferenceRole[]>={
  H01:['PRIMARY'],H02:['DETAIL','PRIMARY'],H03:['PRIMARY','DETAIL'],H04:['PRIMARY','DETAIL'],H05:['PACKAGING','ACCESSORY','PRIMARY'],
  D01:['PRIMARY'],D02:['PRIMARY','DETAIL'],D03:['DETAIL','PRIMARY'],D04:['DETAIL','PRIMARY'],D05:['DETAIL','PRIMARY'],D06:['PRIMARY','DETAIL'],D07:['PACKAGING','ACCESSORY','PRIMARY']
}

function makeTask(template: readonly [string, string, string, string], context: string, now: string, platform:string,style:ImageStyleLock, variant=1): ImageProductionTask {
  const [baseCode, baseTitle, objective, instruction] = template
  const code=variant===1?baseCode:`${baseCode}-${variant}`
  const title=variant===1?baseTitle:`${baseTitle} · 变体 ${variant}`
  return {
    id: code,
    code,
    group: code.startsWith('H') ? 'MAIN' : 'DETAIL',
    title,
    objective,
    prompt: `${context}\n${platformImageRulePrompt(platform,code.startsWith('H')?'MAIN':'DETAIL',code)}\n${imageStyleTaskPrompt(style,{code,group:code.startsWith('H')?'MAIN':'DETAIL'})}\nImage task ${code} — ${title}. ${instruction}\nHard constraints: use the reference product as the only product identity source; preserve structure, proportions, main color, material, visible logo, packaging, and accessory count. No watermark, fake review, sales number, certification, medical claim, efficacy claim, unreadable text, or invented fact. Produce one complete standalone image.`,
    referenceRoles:taskReferenceRoles[baseCode]||['PRIMARY'],
    status: 'PENDING',
    attempts: 0,
    updatedAt: now
  }
}

export function selectTaskReferenceImages(task:Pick<ImageProductionTask,'code'|'referenceRoles'>,images:ImportedProductImage[],limit:number):ImportedProductImage[]{
  if(limit<=0||!images.length)return[]
  const roles=task.referenceRoles?.length?task.referenceRoles:taskReferenceRoles[task.code]||['PRIMARY']
  const ranked=[...images].sort((a,b)=>{const aRank=roles.indexOf(a.role||'DETAIL');const bRank=roles.indexOf(b.role||'DETAIL');return(aRank<0?99:aRank)-(bRank<0?99:bRank)})
  return [...new Map(ranked.map(image=>[image.id||image.source,image])).values()].slice(0,limit)
}

export function taskReviewPurpose(task:Pick<ImageProductionTask,'code'>):'HERO'|'PRODUCT'|'PAIN_POINT'|'SCENE'{
  const baseCode=task.code.split('-')[0]
  if(baseCode==='H01')return'HERO'
  if(['H03','D01','D02','D06'].includes(baseCode))return'SCENE'
  if(baseCode==='H04')return'PAIN_POINT'
  return'PRODUCT'
}

export function buildImageProductionTasks(input: {
  plan: ImageProductionPlan
  productName: string
  sku: string
  platform: string
  language: string
  sourceContext: string
  extraPrompt?: string
  styleLock?: ImageStyleLock
  mainCount?: number
  detailCount?: number
}): ImageProductionTask[] {
  const now = new Date().toISOString()
  const context = `Product: ${input.productName}. SKU: ${input.sku || 'not provided'}. Target platform: ${input.platform}. Target language: ${input.language}. Verified source context: ${input.sourceContext || 'reference image only'}.${input.extraPrompt?.trim() ? ` User-approved additional direction: ${input.extraPrompt.trim()}.` : ''}`
  const style=input.styleLock||cloneImageStylePreset('CLEAN_COMMERCE')
  const expand=(templates:typeof MAIN_TASKS|typeof DETAIL_TASKS,count:number)=>Array.from({length:count},(_,index)=>makeTask(templates[index%templates.length],context,now,input.platform,style,Math.floor(index/templates.length)+1))
  const mainCount=Math.max(1,Math.floor(input.mainCount??MAIN_TASKS.length)),detailCount=Math.max(1,Math.floor(input.detailCount??DETAIL_TASKS.length))
  if(input.plan==='main')return expand(MAIN_TASKS,mainCount)
  if(input.plan==='detail')return expand(DETAIL_TASKS,detailCount)
  return [...expand(MAIN_TASKS,mainCount),...expand(DETAIL_TASKS,detailCount)]
}

export function deriveImageProjectStatus(tasks: ImageProductionTask[]): ImageProductionProject['status'] {
  if (tasks.some(task => task.status === 'RUNNING')) return 'RUNNING'
  const successes = tasks.filter(task => task.status === 'SUCCESS').length
  const failures = tasks.filter(task => task.status === 'FAILED').length
  const reviews = tasks.filter(task => task.status === 'REVIEW').length
  if (successes === tasks.length && tasks.length) return 'COMPLETED'
  if (successes > 0 && (failures > 0||reviews>0)) return 'PARTIAL'
  if(reviews>0)return'PARTIAL'
  if (failures === tasks.length && tasks.length) return 'FAILED'
  return 'APPROVED'
}

export function validateImageProductionProject(project: ImageProductionProject): string[] {
  const issues: string[] = []
  if (!project.facts.confirmed) issues.push('商品事实尚未确认')
  issues.push(...validateImageProductFacts(project.facts))
  if (!project.approved) issues.push('生成清单尚未批准')
  if (!project.tasks.length) issues.push('生成清单为空')
  const ids = new Set<string>()
  for (const task of project.tasks) {
    if (ids.has(task.id)) issues.push(`任务编号重复：${task.id}`)
    ids.add(task.id)
    if (!task.prompt.trim()) issues.push(`任务 ${task.id} 缺少独立 Prompt`)
    if (!task.objective.trim()) issues.push(`任务 ${task.id} 缺少图片职责`)
    if (task.status === 'SUCCESS' && !task.outputUrl) issues.push(`任务 ${task.id} 成功但没有输出文件`)
  }
  return issues
}
