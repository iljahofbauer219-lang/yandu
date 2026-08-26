import type {EbayListing} from '../src/shared/contracts'
type EbayResearchQuerySource = 'PRODUCT_TYPE'|'TITLE'|'CATEGORY'|'MANUAL'

const ebayResearchQueryDropWords=new Set(['with','for','and','the','a','an','of','to','in','on','by','at','pcs','pc','pack','set','sets','lot','lots','free','shipping','new','hot','sale','best','selling','premium','professional','high','quality','durable','heavy','duty','convenient','wholesale','fashion','multi','functional'])
const ebayResearchQueryInvalidSpecificValue=/^(?:does not apply|not applicable|n\/a|unbranded|unknown|other|none|no|-)$/i

// 商品词单复数归一，仅用于核心名词锚定匹配，不影响输出大小写
function ebayResearchQuerySingular(word:string):string {
  if(word.length<=4)return word
  if(/ves$/.test(word))return `${word.slice(0,-3)}fe`
  if(/sses$/.test(word))return word.slice(0,-2)
  if(/(?:ch|sh|x)es$/.test(word))return word.slice(0,-2)
  if(/ies$/.test(word))return `${word.slice(0,-3)}y`
  if(/s$/.test(word)&&!/us$|is$/.test(word))return word.slice(0,-1)
  return word
}

function ebayResearchQuerySuggestion(listing:EbayListing):{query:string;source:Exclude<EbayResearchQuerySource,'MANUAL'>} {
  const specifics=listing.itemSpecifics||[]
  const specificValue=(pattern:RegExp)=>{const value=specifics.find(item=>pattern.test(item.name.trim()))?.value.replace(/\s+/g,' ').trim()||'';return ebayResearchQueryInvalidSpecificValue.test(value)?'':value}
  const categoryAnchor=(listing.categoryName.split(/\s*>+\s*/).pop()||listing.categoryName).trim()
  const fallback:{query:string;source:'CATEGORY'}={query:categoryAnchor.slice(0,120),source:'CATEGORY'}
  const original=(listing.originalTitle||listing.title).replace(/\([^)]*\)/g,' ').replace(/\s+/g,' ').trim()
  if(!original)return fallback
  const brandTokens=new Set((specificValue(/^brand$/i).toLowerCase().match(/[a-z0-9]+/g)||[]))
  const isDimensionToken=(token:string)=>/\d/.test(token)&&(/^\d+(?:\.\d+)?x\d/i.test(token)||/^[a-z]?\d+(?:\.\d+)?(?:["”']|in(?:ch(?:es)?)?\.?|cm|mm|ft|feet|foot|pcs?|packs?|ml|cl|l|oz|lb|kg|g|mah)?$/i.test(token))
  const tokens=original.split(' ').map(raw=>raw.replace(/^[\s"'“”‘’()[\]{}.,;:!?|/\\&-]+|[\s"'“”‘’()[\]{}.,;:!?|/\\&-]+$/g,'')).filter(raw=>{
    const lower=raw.toLowerCase()
    if(!/[a-z0-9]/i.test(raw))return false
    if(ebayResearchQueryDropWords.has(lower)||brandTokens.has(lower)||isDimensionToken(raw))return false
    if(raw.includes('-')&&raw.split('-').every(part=>!part||ebayResearchQueryDropWords.has(part.toLowerCase())))return false
    return true
  })
  if(tokens.length<2)return fallback
  const type=specificValue(/^(?:product\s*)?type$|^item\s*type$/i)
  const anchorText=type||categoryAnchor
  const anchorTokens=(anchorText.toLowerCase().match(/[a-z0-9]+/g)||[]).map(ebayResearchQuerySingular).filter(token=>!ebayResearchQueryDropWords.has(token))
  const lowered=tokens.map(token=>ebayResearchQuerySingular(token.toLowerCase()))
  let anchorStart=-1
  if(anchorTokens.length){
    searchAnchor:for(let start=0;start+anchorTokens.length<=lowered.length;start+=1){
      for(let offset=0;offset<anchorTokens.length;offset+=1)if(lowered[start+offset]!==anchorTokens[offset])continue searchAnchor
      anchorStart=start;break
    }
  }
  let queryTokens:string[]
  let source:'PRODUCT_TYPE'|'TITLE'|'CATEGORY'
  if(anchorStart>=0){
    queryTokens=[...tokens.slice(Math.max(0,anchorStart-2),anchorStart),...tokens.slice(anchorStart,anchorStart+anchorTokens.length)]
    source=type?'PRODUCT_TYPE':'TITLE'
  }else if(type){
    queryTokens=[...tokens.slice(0,2),...type.split(' ').filter(Boolean)]
    source='PRODUCT_TYPE'
  }else{
    queryTokens=tokens.slice(0,3)
    source='TITLE'
  }
  if(queryTokens.length<2){const extra=tokens.find(token=>!queryTokens.includes(token));if(extra)queryTokens=[...queryTokens,extra]}
  const query=queryTokens.slice(0,5).join(' ').slice(0,120)
  return query?{query,source}:fallback
}

export {ebayResearchQuerySuggestion,ebayResearchQuerySingular}
