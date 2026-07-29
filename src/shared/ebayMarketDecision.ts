import type { EbayMarketDecisionReport, EbayMarketDecisionSignal, EbayMarketResearchMetric, EbayMarketResearchSnapshot } from './contracts'

function sameConditions(left:EbayMarketResearchSnapshot,right:EbayMarketResearchSnapshot) {
  return left.query.trim().toLowerCase()===right.query.trim().toLowerCase()
    &&left.categoryId===right.categoryId
    &&left.condition===right.condition
    &&left.periodDays===right.periodDays
}

function metric(snapshot:EbayMarketResearchSnapshot,key:EbayMarketResearchMetric['key']) {
  return snapshot.metrics.find(item=>item.key===key)
}

function metricNumber(snapshot:EbayMarketResearchSnapshot,key:EbayMarketResearchMetric['key']) {
  const item=metric(snapshot,key)
  if(!item?.available||key==='SOLD_PRICE_RANGE')return null
  const match=item.value.replace(/,/g,'').match(/-?\d+(?:\.\d+)?/)
  return match?Number(match[0]):null
}

function comparison(current:EbayMarketResearchSnapshot,previous:EbayMarketResearchSnapshot|undefined,key:EbayMarketResearchMetric['key']) {
  if(!previous)return ''
  const currentValue=metricNumber(current,key),previousValue=metricNumber(previous,key)
  if(currentValue===null||previousValue===null)return ''
  return currentValue===previousValue?'与上次相同':currentValue>previousValue?'较上次上升':'较上次下降'
}

function signal(key:EbayMarketDecisionSignal['key'],label:string,status:EbayMarketDecisionSignal['status'],conclusion:string,evidence:string):EbayMarketDecisionSignal {
  return {key,label,status,conclusion,evidence}
}

export function buildEbayMarketDecisionReport(current:EbayMarketResearchSnapshot,history:EbayMarketResearchSnapshot[]):EbayMarketDecisionReport {
  const comparable=history.filter(item=>item.id!==current.id&&sameConditions(item,current))
  const previous=comparable[0]
  const available=current.metrics.filter(item=>item.available).length
  const analysisSampleCount=Math.min(current.analysisSampleCount??30,current.sampleCount)
  const soldQuantityEvidenceCount=current.soldQuantityEvidenceCount??0
  const rankingBasis=current.rankingBasis||'EBAY_RESULT_ORDER'
  const confirmed=[...current.keywords,...current.combinations]
    .filter(item=>item.factStatus==='CONFIRMED')
    .sort((a,b)=>b.count-a.count||b.coverage-a.coverage)
  const confidence:EbayMarketDecisionReport['confidence']=available>=5&&analysisSampleCount>=20?'HIGH':analysisSampleCount>=20||available>=3&&analysisSampleCount>=10?'MEDIUM':'LOW'
  const readiness:EbayMarketDecisionReport['titleReadiness']=!current.sampleCount||!confirmed.length?'BLOCKED':confidence==='LOW'?'REVIEW':'READY'
  const missingMetrics=current.metrics.filter(item=>!item.available).map(item=>item.label)
  const metricText=(key:EbayMarketResearchMetric['key'])=>metric(current,key)?.available?metric(current,key)!.value:'未取得'
  const demandComparison=comparison(current,previous,'SELL_THROUGH_RATE')||comparison(current,previous,'TOTAL_SOLD')
  const sellerComparison=comparison(current,previous,'SELLER_COUNT')
  const priceComparison=comparison(current,previous,'AVERAGE_SOLD_PRICE')
  const signals:EbayMarketDecisionSignal[]=[
    signal('DATA_QUALITY','数据可信度',confidence==='HIGH'?'POSITIVE':confidence==='MEDIUM'?'NEUTRAL':'ATTENTION',confidence==='HIGH'?'当前快照可作为标题决策的主要依据':confidence==='MEDIUM'?'前排标题样本足够用于词频决策，但仍应人工核对':'当前样本或指标不足，只能作为辅助参考',`${available}/7 项指标 · ${analysisSampleCount} 个标题分析样本 / ${current.sampleCount} 个有效样本`),
    signal('RANKING','样本排序',rankingBasis==='SOLD_QUANTITY'?'POSITIVE':'ATTENTION',rankingBasis==='SOLD_QUANTITY'?'已按页面提供的已售数量降序分析':'页面未提供足够销量字段，保留 eBay 成交结果顺序，不宣称销量排名',`销量证据覆盖 ${soldQuantityEvidenceCount}/${current.sampleCount} · 分析前 ${analysisSampleCount} 个`),
    signal('DEMAND','需求变化',demandComparison==='较上次上升'?'POSITIVE':demandComparison==='较上次下降'?'ATTENTION':'NEUTRAL',demandComparison||'没有同条件历史，不判断需求升降',`售出率 ${metricText('SELL_THROUGH_RATE')} · 已售出 ${metricText('TOTAL_SOLD')}`),
    signal('COMPETITION','竞争变化',sellerComparison==='较上次上升'?'ATTENTION':'NEUTRAL',sellerComparison||'没有同条件历史，不判断竞争变化',`卖家总数 ${metricText('SELLER_COUNT')}`),
    signal('PRICE','价格依据','NEUTRAL',priceComparison||'保留真实价格指标，不根据单次区间推断趋势',`平均售价 ${metricText('AVERAGE_SOLD_PRICE')} · 售价范围 ${metricText('SOLD_PRICE_RANGE')}`),
    signal('SHIPPING','配送依据','NEUTRAL','配送数据用于价格与转化判断，不直接写入标题承诺',`平均运费 ${metricText('AVERAGE_SHIPPING')} · 包邮率 ${metricText('FREE_SHIPPING_RATE')}`),
    signal('TERMS','可用市场词',confirmed.length?'POSITIVE':'ATTENTION',confirmed.length?'只允许已确认且与商品事实一致的市场词进入标题':'尚无已确认市场词，禁止生成决策标题',confirmed.slice(0,8).map(item=>`${item.term} ${item.count}次/${item.coverage}%`).join(' · ')||'无')
  ]
  return {
    generatedAt:current.fetchedAt,
    currentSnapshotId:current.id,
    previousSnapshotId:previous?.id,
    comparableSnapshotCount:comparable.length,
    confidence,
    titleReadiness:readiness,
    summary:readiness==='READY'?'前排市场标题样本与商品事实已经形成标题决策闭环':readiness==='REVIEW'?'可以生成标题，但必须人工复核样本、排序依据与词义':'缺少有效分析样本或已确认市场词，暂不能生成标题',
    analysisSampleCount,
    rankingBasis,
    soldQuantityEvidenceCount,
    confirmedTerms:confirmed.slice(0,12),
    missingMetrics,
    signals
  }
}
