const fs=require('fs'),path=require('path')
const root=process.cwd()
const src=fs.readFileSync(path.join(root,'src/renderer/App.tsx'),'utf8')
const start=src.indexOf('const ebayResearchQueryDropWords')
const end=src.indexOf('function ebayCountryForMarketplace')
if(start<0||end<0||end<=start)throw new Error('snippet not found')
const snippet=src.slice(start,end).trimEnd()
const wrapper=`import type {EbayListing} from '../src/shared/contracts'
type EbayResearchQuerySource = 'PRODUCT_TYPE'|'TITLE'|'CATEGORY'|'MANUAL'

${snippet}

export {ebayResearchQuerySuggestion,ebayResearchQuerySingular}
`
fs.writeFileSync(path.join(root,'.tmp-ui-verify/verify-query-suggestion.ts'),wrapper)
console.log('wrapper written, snippet lines:',snippet.split('\n').length)
