import type { EbayContentBenefit, EbayContentFactKind, EbayContentOptimizationRequest, EbayContentOptimizationResult, EbayContentScenario, EbayContentSection, EbayContentSourceFact, EbayTitleOptimizationRequest, EbayTitleOptimizationResult } from '../../shared/contracts'
import { buildEbayMarketDecisionReport } from '../../shared/ebayMarketDecision'

interface ChatResponse {
  choices?:Array<{finish_reason?:string;message?:{content?:string|null;reasoning_content?:string|null}}>
  error?:{message?:string}
}

const normalizeToken=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]/g,'')
const titleConnectors=new Set(['a','an','and','by','for','from','in','of','on','the','to','with'])
const titleExpansionNoise=new Set([
  ...titleConnectors,'about','all','also','any','are','as','be','been','being','can','condition','could','definitions','details','does','each','go','has','have','help','helps','how','includes','including','is','it','item','its','keep','keeping','may','more','most','new','not','off','original','our','packaging','please','read','retail','right','see','seller','set','should','store','that','theirs','them','these','they','this','those','use','used','using','was','we','what','when','where','which','will','would','you','your'
])
const titleAcronyms=new Set(['ai','diy','led','mdf','odm','oem','pvc','sku','upc','usb','uv'])
const titleDanglingEndings=new Set([...titleConnectors,'all','go','help','helps','inner','keep','keeping','off','read','right','set','size','space','use','used','wooden','x'])
const titleAwkwardPatterns=[
  /\bdust\s+keep(?:\s+off)?\b/ig,
  /\bkeep\s+off\b/ig,
  /\bhanging\s+off\b/ig,
  /\boff\s+wooden\b/ig,
  /\binner\s+space\s+size\b/ig,
  /\bh\s+inner\b/ig,
  /\b\d+\s+\d+\s+x\b/ig
]
const titleStrategies=[
  {id:'SEARCH',name:'搜索覆盖型'},
  {id:'PARAMETER',name:'核心参数型'},
  {id:'BENEFIT',name:'产品卖点型'},
  {id:'SCENARIO',name:'使用场景型'},
  {id:'INTENT',name:'购买意图型'},
  {id:'BALANCED',name:'综合推荐型'}
] as const
type GeneratedTitleStrategyId=typeof titleStrategies[number]['id']

function truncateTitle(value:string,maxLength=80):string {
  const normalized=value.replace(/\s+/g,' ').trim()
  if(normalized.length<=maxLength)return normalized
  const clipped=normalized.slice(0,maxLength+1)
  return clipped.replace(/\s+\S*$/,'').replace(/[,.;:]$/,'').trim()
}

function sanitizeTitleText(value:string):string {
  let result=value
    .replace(/\s+/g,' ')
    .replace(/\s+([,.;:])/g,'$1')
    .replace(/[|/]+/g,' ')
    .trim()
  for(const pattern of titleAwkwardPatterns)result=result.replace(pattern,' ')
  result=result
    .replace(/\bUV\s+Dust\s+Protection\b/ig,'UV Dust Resistant')
    .replace(/\s+/g,' ')
    .replace(/[,.;:]$/,'')
    .trim()
  let words=result.split(/\s+/).filter(Boolean)
  while(words.length&&titleConnectors.has(normalizeToken(words[0])))words.shift()
  while(words.length&&titleDanglingEndings.has(normalizeToken(words.at(-1)||'')))words.pop()
  result=words.join(' ').replace(/\s+([,.;:])/g,'$1').trim()
  return truncateTitle(result)
}

function hasAwkwardTitlePhrase(value:string):boolean {
  return titleAwkwardPatterns.some(pattern=>{pattern.lastIndex=0;return pattern.test(value)})
}

function verifiedTokenSet(request:EbayTitleOptimizationRequest,research:NonNullable<EbayTitleOptimizationRequest['marketResearch']>):Set<string> {
  const evidence=[request.title,request.verifiedDescription||'',...research.keywords.filter(item=>item.factStatus==='CONFIRMED').map(item=>item.term),...research.combinations.filter(item=>item.factStatus==='CONFIRMED').map(item=>item.term)].join(' ')
  return new Set((evidence.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g)||[]).map(normalizeToken).filter(Boolean))
}

function keepVerifiedTitleWords(title:string,request:EbayTitleOptimizationRequest,research:NonNullable<EbayTitleOptimizationRequest['marketResearch']>):string {
  const allowed=verifiedTokenSet(request,research)
  const seen=new Set<string>()
  const words=title.split(/\s+/).filter(word=>{const token=normalizeToken(word);if(!token||titleConnectors.has(token))return true;if(!allowed.has(token)||seen.has(token))return false;seen.add(token);return true})
  while(words.length&&titleConnectors.has(normalizeToken(words[0])))words.shift()
  while(words.length&&titleDanglingEndings.has(normalizeToken(words.at(-1)||'')))words.pop()
  const verified=sanitizeTitleText(words.join(' '))
  return verified.length>=20?verified:truncateTitle(request.title)
}

function keepVerifiedKeywords(value:unknown,request:EbayTitleOptimizationRequest,research:NonNullable<EbayTitleOptimizationRequest['marketResearch']>):string[] {
  const allowed=verifiedTokenSet(request,research)
  return (Array.isArray(value)?value.map(String):[]).map(item=>item.trim()).filter(item=>item&&(item.match(/[A-Za-z0-9]+/g)||[]).every(token=>allowed.has(normalizeToken(token)))).slice(0,8)
}

function verifiedExpansionPhrases(request:EbayTitleOptimizationRequest,research:NonNullable<EbayTitleOptimizationRequest['marketResearch']>):string[] {
  const allowed=verifiedTokenSet(request,research)
  const sources=[
    ...research.combinations.filter(item=>item.factStatus==='CONFIRMED').sort((a,b)=>b.count-a.count).map(item=>({value:item.term,minSize:1})),
    ...research.keywords.filter(item=>item.factStatus==='CONFIRMED').sort((a,b)=>b.count-a.count).map(item=>({value:item.term,minSize:1})),
    {value:request.title,minSize:2},
    {value:request.verifiedDescription||'',minSize:2}
  ]
  const phrases:string[]=[]
  const seen=new Set<string>()
  for(const source of sources) {
    const words=(source.value.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g)||[]).filter(word=>{
      const token=normalizeToken(word)
      return token&&allowed.has(token)&&!titleExpansionNoise.has(token)
    })
    for(let size=Math.min(4,words.length);size>=source.minSize;size-=1) {
      for(let index=0;index+size<=words.length;index+=1) {
        const slice=words.slice(index,index+size)
        const tokens=slice.map(normalizeToken)
        if(new Set(tokens).size!==tokens.length)continue
        if(tokens.some(token=>/^\d+$/.test(token)||/^[a-z]$/.test(token)))continue
        if(titleExpansionNoise.has(tokens[0])||titleExpansionNoise.has(tokens.at(-1)||''))continue
        if(titleDanglingEndings.has(tokens.at(-1)||''))continue
        if(tokens.includes('size')&&!tokens.some(token=>/\d/.test(token)))continue
        const phrase=slice.map(word=>{
          const token=normalizeToken(word)
          if(titleAcronyms.has(token))return token.toUpperCase()
          if(/^\d/.test(word)||word===word.toUpperCase())return word
          return `${word[0]?.toUpperCase()||''}${word.slice(1).toLowerCase()}`
        }).join(' ')
        const cleanPhrase=sanitizeTitleText(phrase)
        if(!cleanPhrase||hasAwkwardTitlePhrase(cleanPhrase))continue
        const key=cleanPhrase.toLowerCase()
        if(!seen.has(key)){seen.add(key);phrases.push(cleanPhrase)}
      }
    }
  }
  return phrases
}

function enforcePreferredTitleLength(title:string,request:EbayTitleOptimizationRequest,research:NonNullable<EbayTitleOptimizationRequest['marketResearch']>):string {
  let result=sanitizeTitleText(keepVerifiedTitleWords(title,request,research))
  if(result.length>=62)return truncateTitle(result)
  const used=new Set((result.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g)||[]).map(normalizeToken))
  const phrases=verifiedExpansionPhrases(request,research)
  while(result.length<62) {
    const candidates=phrases.map(phrase=>{
      const tokens=(phrase.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g)||[]).map(normalizeToken)
      const nextLength=result.length+1+phrase.length
      return {phrase,tokens,nextLength}
    }).filter(item=>item.tokens.length&&item.nextLength<=80&&item.tokens.every(token=>!used.has(token))&&!hasAwkwardTitlePhrase(`${result} ${item.phrase}`))
    if(!candidates.length)break
    candidates.sort((a,b)=>{
      const aReached=a.nextLength>=62,bReached=b.nextLength>=62
      if(aReached!==bReached)return aReached?-1:1
      if(aReached&&bReached)return Math.abs(a.nextLength-72)-Math.abs(b.nextLength-72)
      return b.nextLength-a.nextLength
    })
    const chosen=candidates[0]
    result=sanitizeTitleText(`${result} ${chosen.phrase}`)
    chosen.tokens.forEach(token=>used.add(token))
  }
  return truncateTitle(sanitizeTitleText(result))
}

function buildRationale(id:GeneratedTitleStrategyId,research:NonNullable<EbayTitleOptimizationRequest['marketResearch']>,trendEvidence:string):string {
  const terms=[...research.keywords,...research.combinations].filter(item=>item.factStatus==='CONFIRMED').sort((a,b)=>b.count-a.count).slice(0,3)
  const evidence=terms.map(item=>`${item.term} ${item.count}次/${item.coverage}%`).join('、')
  const analysisCount=Math.min(research.analysisSampleCount??30,research.sampleCount)
  if(id==='SEARCH')return `基于前${analysisCount}个有效标题样本，优先覆盖已确认市场词：${evidence}${trendEvidence}`
  if(id==='PARAMETER')return `优先呈现原商品已核实的重要购买参数，并结合市场词：${evidence}${trendEvidence}`
  if(id==='BENEFIT')return `优先呈现原商品已核实的卖点，不添加未提供功效；参考市场词：${evidence}${trendEvidence}`
  if(id==='SCENARIO')return `仅使用原商品已明确的适用对象或场景，并结合市场词：${evidence}${trendEvidence}`
  if(id==='INTENT')return `按买家搜索表达组织已核实事实，并结合市场词：${evidence}${trendEvidence}`
  return `在可读性与搜索覆盖间平衡，依据已确认市场词：${evidence}${trendEvidence}`
}

function plainDescription(value:string) {
  return value.replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/p\s*>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/\r/g,'').replace(/[ \t]+/g,' ').trim()
}

function contentFactKind(text:string,context:EbayContentFactKind='FEATURE'):EbayContentFactKind {
  if(/\b(package|includes?|in the box|quantity)\b/i.test(text))return 'PACKAGE'
  if(/\b(install|installation|assemble|assembly|mount|mounting|screw|hook|setup|set up)\b/i.test(text))return 'INSTALLATION'
  if(/\b(note|warning|care|clean|remove|peel|protective film|before use|arrival)\b/i.test(text))return 'CARE'
  if(/\b(specification|dimensions?|measurements?|size|color|materials?|length|width|height|weight|brand|type|upc|mpn)\b/i.test(text))return 'SPECIFICATION'
  return context
}

function sourceFacts(request:EbayContentOptimizationRequest):EbayContentSourceFact[] {
  const rows:Array<Omit<EbayContentSourceFact,'id'>>=[]
  const add=(text:string,source:EbayContentSourceFact['source'],sourceLabel:string,context:EbayContentFactKind='FEATURE')=>{
    const clean=text.replace(/^[•*-]\s*/,'').replace(/\s+/g,' ').trim().replace(/;$/,'')
    if(clean.length<3)return
    rows.push({kind:contentFactKind(clean,context),text:clean,source,sourceLabel})
  }
  let context:EbayContentFactKind='FEATURE'
  const description=plainDescription(request.sourceDescription||'')
    .replace(/\s+(Features?\s*:)/gi,'\n$1')
    .replace(/\s+(Specifications?\s*:)/gi,'\n$1')
    .replace(/\s+(Package (?:Includes|Contents)\s*:)/gi,'\n$1')
    .replace(/\s+-\s+/g,'\n')
  for(const raw of description.split(/\n+|[•●]\s*/).map(item=>item.trim()).filter(Boolean)) {
    let value=raw
    if(/^features?\s*:/i.test(value)){context='FEATURE';value=value.replace(/^features?\s*:\s*/i,'')}
    else if(/^specifications?\s*:/i.test(value)){context='SPECIFICATION';value=value.replace(/^specifications?\s*:\s*/i,'')}
    else if(/^package (?:includes|contents)\s*:/i.test(value)){context='PACKAGE';value=value.replace(/^package (?:includes|contents)\s*:\s*/i,'')}
    add(value,'SOURCE_DESCRIPTION','eBay 原始详情',context)
  }
  for(const item of request.itemSpecifics||[])if(item.name.trim()&&item.value.trim())add(`${item.name.trim()}: ${item.value.trim()}`,'ITEM_SPECIFIC',`eBay 属性：${item.name}`,'SPECIFICATION')
  if(request.sellerNotes?.trim())add(request.sellerNotes,'SELLER_NOTE','卖家备注','CARE')
  const seen=new Set<string>()
  return rows.filter(row=>{const key=row.text.toLowerCase();if(seen.has(key))return false;seen.add(key);return true}).map((row,index)=>({...row,id:`F${String(index+1).padStart(3,'0')}`}))
}

function factSections(facts:EbayContentSourceFact[]):EbayContentSection[] {
  const definitions:Array<[EbayContentFactKind,EbayContentSection['id'],string]>=[
    ['FEATURE','FEATURES','Verified Features'],['SPECIFICATION','SPECIFICATIONS','Detailed Specifications'],['PACKAGE','PACKAGE','Package Contents'],['INSTALLATION','INSTALLATION','Installation & Setup'],['CARE','CARE','Care & Important Notes']
  ]
  return definitions.flatMap(([kind,id,title])=>{const rows=facts.filter(fact=>fact.kind===kind);return rows.length?[{id,title,content:rows.map(fact=>`- ${fact.text}`).join('\n')}]:[]})
}

function verifiedOverview(request:EbayContentOptimizationRequest,facts:EbayContentSourceFact[]) {
  const features=facts.filter(fact=>fact.kind==='FEATURE').slice(0,5).map(fact=>fact.text)
  const summary=[request.selectedTitle.trim(),...features].filter(Boolean).join('. ').replace(/\.{2,}/g,'.')
  return summary.endsWith('.')?summary:`${summary}.`
}

function numericFacts(facts:EbayContentSourceFact[]) {
  return [...new Set(facts.flatMap(fact=>fact.text.match(/\b\d+(?:\.\d+)?(?:\s*["']|\s*x\s*\d+(?:\.\d+)?)?/gi)||[]).map(item=>item.replace(/\s+/g,' ').trim()))]
}

function unsupportedMarketingClaim(value:string,facts:EbayContentSourceFact[]) {
  const evidence=facts.map(fact=>fact.text).join(' ').toLowerCase()
  const absolute=/\b(guarantee(?:d)?|never|completely|perfect(?:ly)?|100%|theft[- ]?proof|waterproof|fireproof|scratch[- ]?proof|lifetime)\b/i
  if(absolute.test(value))return true
  const inferredTerms=['signed','autograph','man cave','game room','home office','museum','retail','gift']
  return inferredTerms.some(term=>value.toLowerCase().includes(term)&&!evidence.includes(term))
}

function verifiedConversionContent(parsed:Record<string,unknown>,facts:EbayContentSourceFact[]) {
  const validFactIds=new Set(facts.map(fact=>fact.id))
  let unsupportedClaimCount=0
  const benefits=(Array.isArray(parsed.benefits)?parsed.benefits:[]).map(item=>{
    const row=item as Record<string,unknown>;const evidenceFactIds=(Array.isArray(row.evidenceFactIds)?row.evidenceFactIds.map(String):[]).filter(id=>validFactIds.has(id))
    if(!evidenceFactIds.length||unsupportedMarketingClaim([row.painPoint,row.solution,row.customerBenefit].map(String).join(' '),facts)){unsupportedClaimCount+=1;return null}
    return {painPoint:String(row.painPoint||'').trim(),solution:String(row.solution||'').trim(),customerBenefit:String(row.customerBenefit||'').trim(),evidenceFactIds}
  }).filter((item):item is EbayContentBenefit=>Boolean(item?.painPoint&&item.solution&&item.customerBenefit)).slice(0,6)
  const scenarios=(Array.isArray(parsed.scenarios)?parsed.scenarios:[]).map(item=>{
    const row=item as Record<string,unknown>;const evidenceFactIds=(Array.isArray(row.evidenceFactIds)?row.evidenceFactIds.map(String):[]).filter(id=>validFactIds.has(id))
    if(!evidenceFactIds.length||unsupportedMarketingClaim([row.title,row.description].map(String).join(' '),facts)){unsupportedClaimCount+=1;return null}
    return {title:String(row.title||'').trim(),description:String(row.description||'').trim(),evidenceFactIds}
  }).filter((item):item is EbayContentScenario=>Boolean(item?.title&&item.description)).slice(0,6)
  return {benefits,scenarios,unsupportedClaimCount}
}

export class EbayOptimizationService {
  constructor(
    private readonly apiKey:string,
    private readonly baseUrl='https://api.deepseek.com',
    private readonly model='deepseek-v4-flash'
  ) {}

  async optimizeTitle(request:EbayTitleOptimizationRequest):Promise<EbayTitleOptimizationResult> {
    if(!this.apiKey)throw new Error('未配置 DeepSeek API Key，暂时无法生成 eBay 标题')
    if(!request.marketResearch?.sampleCount)throw new Error('请先获取 eBay 市场数据，核对成交样本后再生成标题')
    const research=request.marketResearch
    const marketDecision=buildEbayMarketDecisionReport(research,request.marketResearchHistory||[])
    if(marketDecision.titleReadiness==='BLOCKED')throw new Error(marketDecision.summary)
    const confirmedKeywords=research.keywords.filter(item=>item.factStatus==='CONFIRMED')
    const confirmedCombinations=research.combinations.filter(item=>item.factStatus==='CONFIRMED')
    if(!confirmedKeywords.length&&!confirmedCombinations.length)throw new Error('请至少确认一个与当前商品事实一致的市场词，再生成标题')
    const analysisCount=Math.min(research.analysisSampleCount??30,research.sampleCount)
    const researchEvidence={query:research.query,periodDays:research.periodDays,source:research.source,sampleCount:research.sampleCount,analysisSampleCount:analysisCount,rankingBasis:research.rankingBasis||'EBAY_RESULT_ORDER',soldQuantityEvidenceCount:research.soldQuantityEvidenceCount||0,metrics:research.metrics.filter(item=>item.available),confirmedKeywords,confirmedCombinations,sampleTitles:research.samples.slice(0,analysisCount).map(item=>item.title),decision:marketDecision}
    const messages=[
      {role:'system',content:`你是 eBay 美国站商品标题专家。严格保留已知事实，不虚构品牌、材质、颜色、尺寸、功能、认证、兼容性、包装数量、促销、排名或商品状态。标题中的每个商品含义词必须来自 productFacts 或 confirmedKeywords、confirmedCombinations；市场样本只用于判断词频，不能把竞品属性搬到本商品。未提供的待核对词和已排除词一律不得使用。每个实义词只出现一次，标题不得以 for、with、and、of、to 等连接词结尾。每个标题硬性不超过80个字符，优先写到62至80字符；如果已核实事实不足，宁可短一些也不得填充虚构内容。每个方案应尽量同时包含核心商品词、已确认市场词，以及原商品已核实的卖点或重要购买参数。生成6个自然英文标题：SEARCH=搜索覆盖型，PARAMETER=核心参数型，BENEFIT=产品卖点型，SCENARIO=使用场景型，INTENT=购买意图型，BALANCED=综合推荐型。SCENARIO 只能使用原商品已明确的适用场景或对象；INTENT 不得擅自使用 Sale、Discount、Best、Top 等促销或排名词。六个标题必须有明确侧重点，不能只是完全相同标题的轻微换序。rationale 必须使用简短中文，引用标题分析样本数、关键词出现次数或覆盖率，不得出现 confirmedKeywords 等内部字段名，不得声称未提供的销量、转化率或排名。Item specifics 只保留输入已有属性。Condition 不放入 Item specifics。描述只写已知事实。只输出JSON：{"variants":[{"id":"SEARCH","name":"搜索覆盖型","title":"...","keywords":["..."],"rationale":"..."},{"id":"PARAMETER","name":"核心参数型","title":"...","keywords":["..."],"rationale":"..."},{"id":"BENEFIT","name":"产品卖点型","title":"...","keywords":["..."],"rationale":"..."},{"id":"SCENARIO","name":"使用场景型","title":"...","keywords":["..."],"rationale":"..."},{"id":"INTENT","name":"购买意图型","title":"...","keywords":["..."],"rationale":"..."},{"id":"BALANCED","name":"综合推荐型","title":"...","keywords":["..."],"rationale":"..."}],"itemSpecifics":[],"description":"..."}`},
      {role:'user',content:JSON.stringify({productFacts:{title:request.title,category:request.categoryName,marketplace:request.marketplaceId,sku:request.sku,itemSpecifics:request.itemSpecifics||[],condition:request.condition||'',description:request.verifiedDescription?.slice(0,12_000)||''},marketEvidence:researchEvidence})}
    ]
    type ParsedResult={variants?:Array<Record<string,unknown>>;itemSpecifics?:Array<Record<string,unknown>>;description?:string}
    let parsed:ParsedResult|undefined
    let lastFinishReason=''
    const requestTitlePayload=async(requestMessages:typeof messages,maxTokens:number)=>{
      const response=await fetch(`${this.baseUrl.replace(/\/$/,'')}/chat/completions`,{
        method:'POST',headers:{Authorization:`Bearer ${this.apiKey}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(45_000),
        body:JSON.stringify({model:this.model,temperature:0.2,max_tokens:maxTokens,thinking:{type:'disabled'},response_format:{type:'json_object'},messages:requestMessages})
      })
      const payload=await response.json() as ChatResponse
      if(!response.ok)throw new Error(payload.error?.message||`DeepSeek 请求失败：${response.status}`)
      const choice=payload.choices?.[0]
      lastFinishReason=choice?.finish_reason||''
      const content=choice?.message?.content?.trim()
      if(!content||lastFinishReason==='length')return undefined
      try {
        const clean=content.replace(/^```json\s*|\s*```$/g,'')
        const start=clean.indexOf('{'),end=clean.lastIndexOf('}')
        if(start>=0&&end>start)return JSON.parse(clean.slice(start,end+1)) as ParsedResult
      } catch { return undefined }
      return undefined
    }
    for(const maxTokens of [2400,3600]) {
      parsed=await requestTitlePayload(messages,maxTokens)
      if((parsed?.variants?.length||0)>=titleStrategies.length)break
    }
    if(!parsed)throw new Error(lastFinishReason==='length'?'DeepSeek 返回内容被截断，系统自动重试后仍不完整，请稍后再试':'DeepSeek 返回格式不完整，系统自动重试后仍无法解析，请稍后再试')
    const normalizeVariants=(value:ParsedResult|undefined)=>(Array.isArray(value?.variants)?value.variants:[]).slice(0,titleStrategies.length).map((item,index)=>{
      const fallback=titleStrategies[index]
      const matched=titleStrategies.find(strategy=>strategy.id===String(item.id))||fallback
      const id=matched.id
      return {
      id,
      name:matched.name,title:keepVerifiedTitleWords(String(item.title||'').trim(),request,research),
      keywords:keepVerifiedKeywords(item.keywords,request,research),rationale:buildRationale(id,research,marketDecision.previousSnapshotId?'；已纳入同条件历史趋势':'；暂无同条件历史趋势')
    }}).filter(item=>item.title)
    let variants=normalizeVariants(parsed)
    if(variants.length===titleStrategies.length&&variants.some(item=>item.title.length<62)) {
      const allowedVocabulary=[...verifiedTokenSet(request,research)].sort()
      const repairMessages=[
        ...messages,
        {role:'assistant',content:JSON.stringify(parsed)},
        {role:'user',content:JSON.stringify({
          task:'重新生成全部6套标题，修正标题长度，不要解释。',
          hardRules:[
            '每个英文标题优先为62至80个字符（含空格），且不得超过80字符。',
            '每个实义词只能使用 allowedVocabulary 中的词；连接词可使用 a、an、and、by、for、from、in、of、on、the、to、with。',
            '优先补充 productFacts.description 中已核实的材质、尺寸、结构、适用对象或功能，不得补充新事实。',
            '同一标题不得重复同一实义词，不得以连接词结尾。',
            '必须保持6种策略差异并输出原JSON结构。'
          ],
          allowedVocabulary,
          filteredTitles:variants.map(item=>({id:item.id,title:item.title,length:item.title.length}))
        })}
      ]
      const repaired=await requestTitlePayload(repairMessages,3600)
      const repairedVariants=normalizeVariants(repaired)
      if(repairedVariants.length===titleStrategies.length) {
        variants=variants.map(current=>{
          const candidate=repairedVariants.find(item=>item.id===current.id)
          return candidate&&candidate.title.length>current.title.length&&candidate.title.length<=80?candidate:current
        })
        if(repaired)parsed=repaired
      }
    }
    variants=variants.map(item=>({...item,title:enforcePreferredTitleLength(item.title,request,research)}))
    if(variants.length<titleStrategies.length)throw new Error('AI 未完整生成6种标题方案，请点击“换一批标题方案”重试')
    const balanced=variants.find(item=>item.id==='BALANCED')||variants[0]
    const optimizedTitle=balanced?.title||''
    if(!optimizedTitle)throw new Error('AI 未生成有效标题')
    const extracted=(Array.isArray(parsed.itemSpecifics)?parsed.itemSpecifics:[]).slice(0,12).map(item=>({name:String(item.name||''),value:String(item.value||''),priority:item.priority==='RECOMMENDED'?'RECOMMENDED' as const:'REQUIRED' as const,confidence:['HIGH','MEDIUM'].includes(String(item.confidence))?String(item.confidence) as 'HIGH'|'MEDIUM':'LOW' as const,needsConfirmation:Boolean(item.needsConfirmation)||!String(item.value||'').trim(),source:String(item.source||'AI根据现有资料提取')})).filter(item=>item.name)
    const synced=(request.itemSpecifics||[]).filter(item=>item.name.trim()&&item.value.trim()).map(item=>({name:item.name.trim(),value:item.value.trim(),priority:'RECOMMENDED' as const,confidence:'HIGH' as const,needsConfirmation:false,source:'eBay 原商品页已填写'}))
    const itemSpecifics=synced.length?synced:extracted.map(item=>({...item,priority:'RECOMMENDED' as const,needsConfirmation:true,source:item.source||'AI建议，待人工核实'}))
    return {originalTitle:request.title,optimizedTitle,keywords:balanced.keywords,rationale:balanced.rationale,model:this.model,variants,itemSpecifics,description:String(parsed.description||'').trim(),marketDecision}
  }

  async optimizeContent(request:EbayContentOptimizationRequest):Promise<EbayContentOptimizationResult> {
    if(!this.apiKey)throw new Error('未配置 DeepSeek API Key，暂时无法生成详情内容')
    const facts=request.itemSpecifics.filter(item=>item.name.trim()&&item.value.trim())
    const verifiedFacts=sourceFacts(request)
    if(!verifiedFacts.length)throw new Error('本地快照没有可用的原始详情或商品属性，请先同步 eBay 详情')
    const messages=[
      {role:'system',content:`你是 eBay 美国站高转化详情页编辑。只能根据 sourceFacts 中的真实事实写作，不得增加品牌、材质、尺寸、性能、认证、包装数量、配件、适用对象、产地、物流、退货、质保或促销承诺。先用自然英文概括商品，再把真实功能转换成客户痛点、解决方式和客户利益，并给出合理应用场景。痛点、利益和场景都必须提供至少一个真实 evidenceFactIds；不得把锁扣写成防盗。所有效果只能保守表达为 helps、designed to、suitable for，不得使用 prevent、guarantee、never、perfect、100% 等绝对化词语。应用场景只能使用 sourceFacts 原文已经明确出现的物品或用途，不得擅自添加 signed、autograph、man cave、game room、home office、museum、retail、gift 等对象或地点。客户利益只能解释已有功能如何帮助顾客，不得增加使用时间、维护频率、性能等级或结果保证。请生成5组 benefits 和5个 scenarios，系统会过滤不合格内容并至少保留3组。视频分镜只能描述如何使用现有商品图片，不得假装视频已经生成。不要重新输出规格和包装清单，系统会从原始事实确定性排版并保证完整保留。中文翻译由独立翻译模型处理，不要生成中文稿。只输出JSON：{"overview":"120-180词英文概述","benefits":[{"painPoint":"...","solution":"...","customerBenefit":"...","evidenceFactIds":["F001"]}],"scenarios":[{"title":"...","description":"...","evidenceFactIds":["F001"]}],"storyboard":[{"order":1,"durationSeconds":3,"visual":"...","caption":"...","sourceRequirement":"..."}]}`},
      {role:'user',content:JSON.stringify({originalTitle:request.originalTitle,selectedTitle:request.selectedTitle,categoryName:request.categoryName,condition:request.condition||'',itemSpecifics:facts,sourceFacts:verifiedFacts})}
    ]
    let parsed:Record<string,unknown>|undefined
    let conversion:ReturnType<typeof verifiedConversionContent>|undefined
    let lastError=''
    for(const maxTokens of [3200,4400]) {
      const response=await fetch(`${this.baseUrl.replace(/\/$/,'')}/chat/completions`,{
        method:'POST',headers:{Authorization:`Bearer ${this.apiKey}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(45_000),
        body:JSON.stringify({model:this.model,temperature:0.1,max_tokens:maxTokens,thinking:{type:'disabled'},response_format:{type:'json_object'},messages})
      })
      const payload=await response.json() as ChatResponse
      if(!response.ok)throw new Error(payload.error?.message||`DeepSeek 请求失败：${response.status}`)
      const content=payload.choices?.[0]?.message?.content?.trim()
      if(!content){lastError='AI 未返回详情内容';continue}
      try {const clean=content.replace(/^```json\s*|\s*```$/g,'');parsed=JSON.parse(clean.slice(clean.indexOf('{'),clean.lastIndexOf('}')+1)) as Record<string,unknown>} catch {lastError='AI 返回的详情内容格式无法解析';continue}
      conversion=verifiedConversionContent(parsed,verifiedFacts)
      if(conversion.benefits.length>=3&&conversion.scenarios.length>=3)break
      lastError='过滤无依据表达后，客户痛点或应用场景不足3项'
      parsed=undefined
      conversion=undefined
    }
    if(!parsed||!conversion)throw new Error(`${lastError||'AI 详情内容不完整'}，系统自动重试后仍未达到完整度要求`)
    const {benefits,scenarios,unsupportedClaimCount}=conversion
    const overview=verifiedOverview(request,verifiedFacts)
    const sections:EbayContentSection[]=[
      {id:'SUMMARY',title:'Product Overview',content:overview},
      {id:'PROBLEMS',title:'Customer Problems & Solutions',content:benefits.map((item,index)=>`${index+1}. ${item.painPoint}\nHow it helps: ${item.solution}\nCustomer benefit: ${item.customerBenefit}`).join('\n\n')},
      ...factSections(verifiedFacts),
      {id:'SCENARIOS',title:'Recommended Use Scenarios',content:scenarios.map(item=>`- ${item.title}: ${item.description}`).join('\n')}
    ]
    const storyboard=(Array.isArray(parsed.storyboard)?parsed.storyboard:[]).map((item,index)=>{
      const row=item as Record<string,unknown>
      return {order:index+1,durationSeconds:Math.max(1,Math.min(6,Number(row.durationSeconds)||3)),visual:String(row.visual||'').trim(),caption:String(row.caption||'').trim(),sourceRequirement:String(row.sourceRequirement||'').trim()}
    }).filter(item=>item.visual).slice(0,6)
    const englishDescription=sections.map(item=>`${item.title.toUpperCase()}\n${item.content}`).join('\n\n').trim()
    const chineseReference=''
    const numbers=numericFacts(verifiedFacts)
    const missingNumericFacts=numbers.filter(value=>!englishDescription.includes(value))
    const validation={sourceFactCount:verifiedFacts.length,coveredFactCount:verifiedFacts.length,factCoverage:100,numericFactCount:numbers.length,missingNumericFacts,unsupportedClaimCount,passed:missingNumericFacts.length===0,warnings:[...(unsupportedClaimCount?[`已从最终详情移除 ${unsupportedClaimCount} 项没有事实依据的转化表达`]:[]),...(missingNumericFacts.length?[`缺少数字事实：${missingNumericFacts.join('、')}`]:[])]}
    if(!validation.passed)throw new Error(validation.warnings.join('；'))
    return {sections,sourceFacts:verifiedFacts,benefits,scenarios,validation,englishDescription,chineseReference,translation:{model:'qwen-mt-flash',translatedAt:'',segments:[]},storyboard,model:this.model}
  }
}
