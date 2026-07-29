import type {EbayMarketResearchSnapshot,EbayMarketKeywordStat} from '../src/shared/contracts'

const ebayResearchStopWords=new Set(['a','an','and','are','as','at','be','by','for','from','in','into','is','it','new','of','on','or','the','to','with','your','you','this','that','item','product','sale','best','free','shipping'])

// 英文商品词简单词形归一：合并常见复数，避免 clock/clocks、frame/frames 分开计数稀释词频
function normalizeEbayResearchToken(token:string):string {
  if(token.length<=4)return token
  if(/(?:ch|sh|x)es$/.test(token))return token.slice(0,-2)
  if(/ies$/.test(token))return `${token.slice(0,-3)}y`
  if(/[bcdfgklmnprtvz]es$/.test(token))return token.slice(0,-1)
  if(/[bcdfghjklmnpqrtvwxz]s$/.test(token))return token.slice(0,-1)
  return token
}

function buildEbayMarketStats(samples:EbayMarketResearchSnapshot['samples'],factText:string,size:1|2):EbayMarketKeywordStat[] {
  const facts=new Set((factText.toLowerCase().match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g)||[]).map(normalizeEbayResearchToken))
  const forbidden=/^(?:free shipping|best price|hot sale|lowest price|clearance)$/i
  const counts=new Map<string,number>()
  const scores=new Map<string,number>()
  for(const sample of samples) {
    const sold=Number((sample.soldQuantity||'').replace(/,/g,'').match(/\d+(?:\.\d+)?/)?.[0]||0)
    const sampleWeight=sold>0?1+Math.log10(sold+1):1
    const entries=(sample.title.toLowerCase().match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g)||[])
      .map((raw,index)=>({token:normalizeEbayResearchToken(raw),early:index<5}))
      .filter(entry=>entry.token.length>1&&!ebayResearchStopWords.has(entry.token)&&!/^[\d.]+$/.test(entry.token))
    const terms=new Map<string,boolean>()
    if(size===1)entries.forEach(entry=>terms.set(entry.token,Boolean(terms.get(entry.token))||entry.early))
    else for(let index=0;index<entries.length-1;index+=1){const term=`${entries[index].token} ${entries[index+1].token}`;terms.set(term,Boolean(terms.get(term))||entries[index].early)}
    terms.forEach((early,term)=>{
      counts.set(term,(counts.get(term)||0)+1)
      scores.set(term,(scores.get(term)||0)+sampleWeight*(early?1.5:1))
    })
  }
  return [...counts.entries()].sort((a,b)=>(scores.get(b[0])||0)-(scores.get(a[0])||0)||b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,size===1?20:12).map(([term,count])=>{
    const factStatus:EbayMarketKeywordStat['factStatus']=forbidden.test(term)?'EXCLUDED':term.split(' ').every(token=>facts.has(token))?'CONFIRMED':'REVIEW'
    return {term,count,coverage:samples.length?Math.round(count/samples.length*100):0,factStatus,factSource:factStatus==='CONFIRMED'?'原商品标题或属性已确认':factStatus==='EXCLUDED'?'平台合规风险词，不用于标题':'市场成交词，需结合商品事实人工确认'}
  })
}

export {buildEbayMarketStats,normalizeEbayResearchToken}
