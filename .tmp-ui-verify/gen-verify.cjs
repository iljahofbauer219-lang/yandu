const fs=require('fs'),path=require('path')
const root=process.cwd()
const src=fs.readFileSync(path.join(root,'src/main/main.ts'),'utf8')
const start=src.indexOf('const ebayResearchStopWords')
const end=src.indexOf('function prepareEbayMarketAnalysis')
if(start<0||end<0||end<=start)throw new Error('snippet not found')
const snippet=src.slice(start,end).trimEnd()
const wrapper=`import type {EbayMarketResearchSnapshot,EbayMarketKeywordStat} from '../src/shared/contracts'

${snippet}

export {buildEbayMarketStats,normalizeEbayResearchToken}
`
fs.writeFileSync(path.join(root,'.tmp-ui-verify/verify-market-stats.ts'),wrapper)
console.log('wrapper written, snippet lines:',snippet.split('\n').length)
