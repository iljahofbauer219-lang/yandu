import type { EbayImageVisualInspectionReport, EbayImageVisualRuleCode, EbayListing, EbayLocalProductMedia } from './contracts'

export type EbayComplianceRiskLevel = 'P0' | 'P1' | 'P2' | 'P3'
export type EbayComplianceDecision = 'BLOCKED' | 'MANUAL_REVIEW' | 'REMEDIATION_REQUIRED' | 'PASSED'
export type EbayComplianceDimension = '图片刊登要求' | '图片展示质量' | '图文一致性'

export interface EbayComplianceRule {
  id:string
  title:string
  dimension:EbayComplianceDimension
  authority:string
  sourceTitle:string
  sourceUrl:string
  appliesTo:string[]
  lastVerifiedAt:string
  version:string
}

export interface EbayComplianceFinding {
  ruleId:string
  level:EbayComplianceRiskLevel
  dimension:EbayComplianceDimension
  title:string
  evidence:string
  consequence:string
  remediation:string
  authority:string
  sourceTitle:string
  sourceUrl:string
  lastVerifiedAt:string
}

export interface EbayComplianceDimensionResult {
  name:EbayComplianceDimension
  status:'BLOCKED'|'REVIEW'|'NOTICE'|'PENDING'|'PASSED'
  label:string
  issueCount:number
}

export interface EbayImageComplianceAssessment {
  technicalStatus:'BLOCKED'|'INCOMPLETE'|'PASSED'
  technicalLabel:string
  visualStatus:'NOT_READY'|'PENDING'|'PASSED'|'FAILED'|'REVIEW'
  visualLabel:string
  checkedImageCount:number
  visualCheckedImageCount:number
  visualIssueCount:number
  visualPendingCount:number
  visualModel:string
  visualCheckedAt:string
  visualChecks:string[]
}

export interface EbayComplianceReport {
  decision:EbayComplianceDecision
  decisionLabel:string
  marketplaceLabel:string
  destination:string
  knowledgeVersion:string
  checkedAt:string
  findings:EbayComplianceFinding[]
  dimensions:EbayComplianceDimensionResult[]
  imageAssessment:EbayImageComplianceAssessment
}

export const EBAY_COMPLIANCE_KNOWLEDGE_VERSION = 'EBAY-DETAIL-PAGE-2026.07.22'
const VERIFIED_AT = '2026-07-22'

export const ebayComplianceKnowledge: EbayComplianceRule[] = [
  {id:'EBAY-PICTURE-POLICY',title:'eBay 图片政策',dimension:'图片刊登要求',authority:'eBay',sourceTitle:'Picture policy',sourceUrl:'https://www.ebay.com/help/listing-policies/policies/picture-policy?id=4370',appliesTo:['ALL'],lastVerifiedAt:VERIFIED_AT,version:'2026.07.22'},
  {id:'EBAY-PICTURE-GUIDE',title:'eBay 图片上传与展示指南',dimension:'图片展示质量',authority:'eBay',sourceTitle:'Adding pictures to your listings',sourceUrl:'https://www.ebay.com/help/listings/selling/adding-pictures-listings?id=4148',appliesTo:['ALL'],lastVerifiedAt:VERIFIED_AT,version:'2026.07.22'},
  {id:'EBAY-DESCRIPTION-POLICY',title:'eBay 商品描述政策',dimension:'图文一致性',authority:'eBay',sourceTitle:'Item description policy',sourceUrl:'https://www.ebay.com/help/policies/listing-policies/item-description-policy?id=4372',appliesTo:['ALL'],lastVerifiedAt:VERIFIED_AT,version:'2026.07.22'}
]

const dimensions:EbayComplianceDimension[] = ['图片刊登要求','图片展示质量','图文一致性']

function marketContext(marketplaceId:string) {
  const id=marketplaceId.toUpperCase()
  if(id.includes('US'))return {label:'eBay 美国站',destination:'美国'}
  if(id.includes('GB')||id.includes('UK'))return {label:'eBay 英国站',destination:'英国'}
  return {label:`eBay ${marketplaceId||'未指定站点'}`,destination:'当前店铺站点'}
}

function rule(id:string) {
  const matched=ebayComplianceKnowledge.find(item=>item.id===id)
  if(!matched)throw new Error(`Missing eBay detail-page rule: ${id}`)
  return matched
}

function finding(ruleId:string,level:EbayComplianceRiskLevel,title:string,evidence:string,consequence:string,remediation:string):EbayComplianceFinding {
  const source=rule(ruleId)
  return {ruleId,level,dimension:source.dimension,title,evidence,consequence,remediation,authority:source.authority,sourceTitle:source.sourceTitle,sourceUrl:source.sourceUrl,lastVerifiedAt:source.lastVerifiedAt}
}

export function evaluateEbayCompliance(item:EbayListing,localMedia:EbayLocalProductMedia[]=[],visualReport?:EbayImageVisualInspectionReport|null):EbayComplianceReport {
  const context=marketContext(item.marketplaceId)
  const findings:EbayComplianceFinding[]=[]
  const title=item.title.trim()
  const downloadedMedia=localMedia.filter(media=>media.downloadStatus==='DOWNLOADED'&&Boolean(media.localPath))
  const readableMedia=downloadedMedia.filter(media=>media.width>0&&media.height>0&&media.fileSize>0&&Boolean(media.sha256))
  const undersizedMedia=readableMedia.filter(media=>Math.max(media.width,media.height)<500)
  const oversizedMedia=readableMedia.filter(media=>media.fileSize>12*1024*1024)
  const supportedMimeTypes=['image/jpeg','image/jpg','image/png','image/gif','image/tiff','image/bmp','image/webp','image/heic','image/heif','image/avif']
  const unsupportedMedia=readableMedia.filter(media=>!supportedMimeTypes.includes(media.mimeType.toLowerCase()))

  if(!item.imageUrl&&!downloadedMedia.length) {
    findings.push(finding('EBAY-PICTURE-POLICY','P0','缺少主图','当前商品没有可用主图。','不符合 eBay 至少提供一张商品图片的刊登要求。','从 eBay 原商品同步或补充一张真实、清晰且与商品一致的主图。'))
  } else if(!downloadedMedia.length) {
    findings.push(finding('EBAY-PICTURE-GUIDE','P1','图片技术资料尚未保存','当前记录有线上图片，但没有可供检查的本地原图。','系统无法确认图片尺寸、格式和单文件大小是否符合 eBay 官方要求。','重新下载该线上产品后再执行检查。'))
  } else {
    if(downloadedMedia.length>24)findings.push(finding('EBAY-PICTURE-GUIDE','P0','图片数量超过上限',`当前本地产品保存了 ${downloadedMedia.length} 张图片。`,'eBay 单个刊登最多允许 24 张图片。','删除多余图片，将图片总数控制在 24 张以内。'))
    if(readableMedia.length<downloadedMedia.length)findings.push(finding('EBAY-PICTURE-GUIDE','P1','本地图片技术信息不完整',`已下载 ${downloadedMedia.length} 张图片，其中 ${downloadedMedia.length-readableMedia.length} 张缺少尺寸、文件大小或校验值。`,'系统无法完整确认这些图片是否达到 eBay 的尺寸和文件大小要求。','重新同步缺少技术信息的图片，再执行详情页检查。'))
    if(undersizedMedia.length)findings.push(finding('EBAY-PICTURE-GUIDE','P0','图片尺寸低于最低要求',`${undersizedMedia.length} 张本地图片的最长边低于 500 像素；最小为 ${Math.min(...undersizedMedia.map(media=>Math.max(media.width,media.height)))} 像素。`,'图片尺寸不符合 eBay 最低展示要求。','替换为最长边至少 500 像素的原商品图片，推荐约 1600×1600。'))
    if(oversizedMedia.length)findings.push(finding('EBAY-PICTURE-GUIDE','P0','图片文件超过 12MB',`${oversizedMedia.length} 张本地图片超过 eBay 单张 12MB 上限；最大为 ${(Math.max(...oversizedMedia.map(media=>media.fileSize))/1024/1024).toFixed(2)}MB。`,'文件大小不符合 eBay 图片上传要求。','压缩或替换超限图片，确保每张图片不超过 12MB。'))
    if(unsupportedMedia.length)findings.push(finding('EBAY-PICTURE-GUIDE','P0','图片格式不受 eBay 支持',`${unsupportedMedia.length} 张本地图片使用 ${[...new Set(unsupportedMedia.map(media=>media.mimeType||'未知格式'))].join('、')}。`,'该文件格式不在 eBay 当前支持的图片格式列表中。','转换为 JPEG、PNG、GIF、TIFF、BMP、WebP、HEIC 或 AVIF 后重新检查。'))
  }

  if(!title) {
    findings.push(finding('EBAY-DESCRIPTION-POLICY','P0','缺少商品标题','当前商品没有可用标题。','买家无法准确识别商品，刊登资料不完整。','补充准确描述当前商品的标题。'))
  } else if(title.length>80) {
    findings.push(finding('EBAY-DESCRIPTION-POLICY','P0','标题超过 eBay 80 字符限制',`当前标题为 ${title.length} 个字符。`,'标题不能按当前内容正常刊登。','删除重复词和无关词，将标题控制在 80 字符以内。'))
  }

  if(!item.originalTitleVerified) {
    findings.push(finding('EBAY-DESCRIPTION-POLICY','P3','确认图片与商品描述一致','当前记录尚未标记为从 eBay 原商品页验证。','系统无法自动确认图片中的商品、数量和配件与标题及描述完全一致。','在 eBay 原商品页核对商品主体、颜色、结构、数量和配件；AI方案不得改变这些商品事实。'))
  }

  if(visualReport) {
    const failedByRule=new Map<EbayImageVisualRuleCode,number[]>()
    for(const image of visualReport.images)for(const result of image.rules)if(result.status==='FAILED')failedByRule.set(result.rule,[...(failedByRule.get(result.rule)||[]),image.sortOrder+1])
    const ruleTitles:Record<EbayImageVisualRuleCode,string>={PRODUCT_ACCURACY:'图片呈现的商品与标题或图库不一致',NO_BORDER:'图片包含额外边框',NO_ADDED_TEXT:'图片包含附加文字或营销图形',NO_WATERMARK:'图片包含水印'}
    const ruleConsequences:Record<EbayImageVisualRuleCode,string>={PRODUCT_ACCURACY:'图片可能不能准确展示当前刊登的商品事实。',NO_BORDER:'不符合 eBay 图片不得添加额外边框的要求。',NO_ADDED_TEXT:'不符合 eBay 图片不得添加卖家文字或营销图形的要求。',NO_WATERMARK:'不符合 eBay 图片不得添加水印的要求。'}
    const ruleRemediations:Record<EbayImageVisualRuleCode,string>={PRODUCT_ACCURACY:'核对商品主体、数量和配件，删除不属于当前商品的图片或更正标题。',NO_BORDER:'使用没有人为外框的原始商品图片。',NO_ADDED_TEXT:'替换为不含促销文字、营销图形、拼贴或说明文字的商品原图。',NO_WATERMARK:'替换为没有覆盖式水印的商品原图。'}
    for(const [ruleCode,indexes] of failedByRule) {
      const issue=finding('EBAY-PICTURE-POLICY','P0',ruleTitles[ruleCode],`第 ${indexes.join('、')} 张图片触发该规则；逐图可见证据见视觉检查结果。`,ruleConsequences[ruleCode],ruleRemediations[ruleCode])
      if(ruleCode==='PRODUCT_ACCURACY')issue.dimension='图文一致性'
      findings.push(issue)
    }
    if(visualReport.review)findings.push(finding('EBAY-PICTURE-GUIDE','P1','部分图片需要人工确认',`${visualReport.review} 张图片的画面内容无法由视觉模型可靠确认。`,'系统没有把低置信度结果错误标记为通过。','人工核对逐图证据中的商品一致性、边框、附加文字和水印后再继续。'))
  }

  const imageTechnicalFindings=findings.filter(entry=>entry.dimension==='图片刊登要求'||entry.dimension==='图片展示质量')
  const imageTechnicalStatus:EbayImageComplianceAssessment['technicalStatus']=imageTechnicalFindings.some(entry=>entry.level==='P0')?'BLOCKED':imageTechnicalFindings.length?'INCOMPLETE':'PASSED'
  const imageAssessment:EbayImageComplianceAssessment={
    technicalStatus:imageTechnicalStatus,
    technicalLabel:imageTechnicalStatus==='BLOCKED'?'技术规则未通过':imageTechnicalStatus==='INCOMPLETE'?'技术资料不完整':'技术规则通过',
    visualStatus:visualReport?.status|| (readableMedia.length?'PENDING':'NOT_READY'),
    visualLabel:visualReport?.status==='PASSED'?'视觉规则通过':visualReport?.status==='FAILED'?'视觉规则未通过':visualReport?.status==='REVIEW'?'视觉结果需人工复核':readableMedia.length?'视觉规则待检查':'等待技术资料就绪',
    checkedImageCount:readableMedia.length,
    visualCheckedImageCount:visualReport?.checkedImageCount||0,
    visualIssueCount:visualReport?.failed||0,
    visualPendingCount:visualReport?.review||(!visualReport&&readableMedia.length?readableMedia.length:0),
    visualModel:visualReport?.model||'',
    visualCheckedAt:visualReport?.checkedAt||'',
    visualChecks:['商品呈现准确','无额外边框','无附加文字或营销图形','无水印']
  }
  const dimensionResults=dimensions.map(name=>{
    const matched=findings.filter(entry=>entry.dimension===name)
    const visualPending=name==='图片展示质量'&&!matched.length&&(imageAssessment.visualStatus==='PENDING'||imageAssessment.visualStatus==='REVIEW')
    const status:EbayComplianceDimensionResult['status']=matched.some(entry=>entry.level==='P0')?'BLOCKED':matched.some(entry=>entry.level==='P1')?'REVIEW':matched.some(entry=>entry.level==='P2'||entry.level==='P3')?'NOTICE':visualPending?'PENDING':'PASSED'
    const label=status==='BLOCKED'?'必须修改':status==='REVIEW'?'技术资料不完整':status==='PENDING'?'技术通过 · 视觉待检查':matched.length?'建议优化':'通过'
    return {name,status,label,issueCount:matched.length}
  })
  const decision:EbayComplianceDecision=findings.some(entry=>entry.level==='P0')?'BLOCKED':findings.some(entry=>entry.level==='P1')?'MANUAL_REVIEW':findings.some(entry=>entry.level==='P2')?'REMEDIATION_REQUIRED':'PASSED'
  const decisionLabel=decision==='BLOCKED'?'必须修改':decision==='MANUAL_REVIEW'?'技术资料不完整':decision==='REMEDIATION_REQUIRED'?'建议优化':imageAssessment.visualStatus==='PENDING'?'技术规则通过 · 视觉待检查':'符合 eBay 要求'
  return {decision,decisionLabel,marketplaceLabel:context.label,destination:context.destination,knowledgeVersion:EBAY_COMPLIANCE_KNOWLEDGE_VERSION,checkedAt:new Date().toISOString(),findings,dimensions:dimensionResults,imageAssessment}
}
