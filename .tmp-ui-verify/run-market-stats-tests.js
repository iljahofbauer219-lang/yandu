const {buildEbayMarketStats,normalizeEbayResearchToken}=require('./out/.tmp-ui-verify/verify-market-stats.js')

let failed=0
const eq=(name,got,want)=>{const ok=JSON.stringify(got)===JSON.stringify(want);console.log(`${ok?'PASS':'FAIL'} ${name}: ${JSON.stringify(got)}${ok?'':' 期望 '+JSON.stringify(want)}`);if(!ok)failed+=1}

// 1. 词形归一
eq('normalize',['clocks','frames','watches','batteries','glass','canvas','shoes','sizes','lamps','new','brass'].map(normalizeEbayResearchToken),
  ['clock','frame','watch','battery','glass','canvas','shoes','size','lamp','new','brass'])

// 2. 复数合并：clock/clocks 应合并计数
const samples=[
  {title:'Wooden Wall Clock Large Farmhouse Decor',soldQuantity:'500'},
  {title:'Rustic Wall Clocks for Living Room',soldQuantity:'1'},
  {title:'Large Wall Clock Silent Non Ticking',soldQuantity:''},
  {title:'Farmhouse Wood Wall Clock Battery Operated',soldQuantity:''},
]
const kw=buildEbayMarketStats(samples,'wooden wall clock farmhouse large',1)
const clock=kw.find(k=>k.term==='clock')
eq('clock合并计数',clock&&[clock.count,clock.coverage,clock.factStatus],[4,100,'CONFIRMED'])
eq('wooden事实确认',(kw.find(k=>k.term==='wooden')||{}).factStatus,'CONFIRMED')
eq('rustic待核对',(kw.find(k=>k.term==='rustic')||{}).factStatus,'REVIEW')
eq('clocks不再单独出现',kw.some(k=>k.term==='clocks'),false)

// 3. 销量加权可翻转排序：1 次高销量词 vs 3 次无销量词
const weighted=buildEbayMarketStats([
  {title:'Alpha Beta',soldQuantity:'1000'},
  {title:'Delta Epsilon',soldQuantity:''},
  {title:'Delta Epsilon',soldQuantity:''},
  {title:'Delta Epsilon',soldQuantity:''},
],'',1)
eq('销量加权排序',weighted.map(k=>k.term).slice(0,3),['alpha','beta','delta'])
eq('count保持原始频次',[weighted.find(k=>k.term==='alpha').count,weighted.find(k=>k.term==='delta').count],[1,3])

// 4. 双词统计 + 停用词
const combos=buildEbayMarketStats(samples,'wooden wall clock farmhouse large',2)
eq('双词归一组合',combos.some(c=>c.term==='wall clock'),true)
const forbidden=buildEbayMarketStats([{title:'Best Clock Free Shipping Hot Sale',soldQuantity:''}],'',1)
eq('停用词过滤',[forbidden.some(k=>k.term==='free'),forbidden.some(k=>k.term==='shipping')],[false,false])

// 5. 空样本安全
eq('空样本',buildEbayMarketStats([],'',1),[])

process.exit(failed?1:0)
