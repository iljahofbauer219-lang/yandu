import type { EbayMarketKeywordStat, EbayTitleAudit } from './contracts'

const connectorTerms=new Set(['a','an','and','for','in','of','on','the','to','with'])

function words(value:string) {
  return value.toLowerCase().replace(/&/g,' and ').match(/[a-z0-9]+/g)||[]
}

export function auditEbayTitle(title:string,originalTitle:string,confirmedTerms:EbayMarketKeywordStat[],verifiedFacts:string[]=[]):EbayTitleAudit {
  const titleWords=words(title)
  const originalWords=new Set(words(originalTitle))
  const marketWords=new Set(confirmedTerms.flatMap(item=>words(item.term)))
  const factWords=new Set(verifiedFacts.flatMap(item=>words(item)))
  const allowedWords=new Set([...originalWords,...marketWords,...factWords,...connectorTerms])
  const counts=new Map<string,number>()
  titleWords.forEach(word=>counts.set(word,(counts.get(word)||0)+1))
  const duplicateTerms=[...counts].filter(([word,count])=>count>1&&!connectorTerms.has(word)).map(([word])=>word)
  const unverifiedTerms=[...new Set(titleWords.filter(word=>!allowedWords.has(word)))]
  const first=titleWords[0]||'',last=titleWords.at(-1)||''
  const danglingConnector=connectorTerms.has(first)||connectorTerms.has(last)
  const normalizedTitle=` ${titleWords.join(' ')} `
  const confirmedTermHits=confirmedTerms.filter(item=>{
    const term=words(item.term).join(' ')
    return term&&normalizedTitle.includes(` ${term} `)
  }).map(item=>item.term)
  const totalWeight=confirmedTerms.reduce((sum,item)=>sum+Math.max(1,item.count),0)
  const hitWeight=confirmedTerms.filter(item=>confirmedTermHits.includes(item.term)).reduce((sum,item)=>sum+Math.max(1,item.count),0)
  const coverageScore=totalWeight?Math.round(hitWeight/totalWeight*100):0
  const characterCount=title.trim().length
  const withinLimit=characterCount>=20&&characterCount<=80
  const passed=withinLimit&&!duplicateTerms.length&&!danglingConnector&&!unverifiedTerms.length&&confirmedTermHits.length>0
  return {characterCount,withinLimit,duplicateTerms,danglingConnector,confirmedTermHits,unverifiedTerms,coverageScore,passed}
}
