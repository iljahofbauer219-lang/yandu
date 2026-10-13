import { describe, expect, it } from 'vitest'
import type { EbayMarketKeywordStat, EbayMarketResearchSnapshot } from '../contracts'
import { buildEbayMarketDecisionReport, confirmedEbayMarketTerms } from '../ebayMarketDecision'
import { auditEbayTitle } from '../ebayTitleAudit'

function term(partial:Partial<EbayMarketKeywordStat>&{term:string}):EbayMarketKeywordStat {
  return {count:1,coverage:10,factStatus:'CONFIRMED',factSource:'测试',...partial}
}

function snapshot(overrides:Partial<EbayMarketResearchSnapshot>={}):EbayMarketResearchSnapshot {
  return {
    id:'snap-1', storeId:'store-1', listingId:'PALLET-900001', marketplaceId:'EBAY_US',
    categoryId:'', categoryName:'Furniture', condition:'NEW', query:'bucket racing seats', periodDays:90,
    source:'OMKAR_EBAY_SCRAPER', sourceUrl:'https://www.ebay.com/clk', fetchedAt:'2026-10-13T10:00:00.000Z',
    sampleCount:24, analysisSampleCount:24, keywords:[], combinations:[], coreVariants:[], metrics:[], samples:[],
    ...overrides
  }
}

describe('已确认市场词唯一口径', () => {
  it('候选高频词、组合词与核心词短语变体中的 CONFIRMED 都进入', () => {
    const current=snapshot({
      keywords:[term({term:'seat',factStatus:'CONFIRMED'}),term({term:'used',factStatus:'EXCLUDED'})],
      combinations:[term({term:'racing seat pair',factStatus:'CONFIRMED'})],
      coreVariants:[term({term:'bucket racing seats',factStatus:'CONFIRMED'}),term({term:'reclinable bucket racing seats',factStatus:'REVIEW'})]
    })
    expect(confirmedEbayMarketTerms(current).map(item=>item.term)).toEqual(['seat','racing seat pair','bucket racing seats'])
  })

  it('只确认核心词变体时决策报告不再判 BLOCKED', () => {
    const current=snapshot({
      coreVariants:[term({term:'bucket racing seats',count:48,coverage:96})],
      metrics:[{key:'TOTAL_SOLD',label:'已售出',value:'120',available:true}]
    })
    expect(buildEbayMarketDecisionReport(current,[]).titleReadiness).not.toBe('BLOCKED')
  })

  it('用已确认核心词变体生成的标题能通过审计（主进程与渲染器同一口径）', () => {
    const current=snapshot({
      coreVariants:[term({term:'bucket racing seats',count:48,coverage:96})],
      combinations:[term({term:'racing seat pair',factStatus:'EXCLUDED'})]
    })
    const confirmed=confirmedEbayMarketTerms(current)
    const title='Reclinable Bucket Racing Seats 2PC'
    expect(auditEbayTitle(title,'2PC Universal Bucket Racing Seats Reclinable',confirmed,[]).passed).toBe(true)
    // 旧口径只看 keywords+combinations，会把唯一确认词丢掉而误判不通过
    expect(auditEbayTitle(title,'2PC Universal Bucket Racing Seats Reclinable',[...current.keywords,...current.combinations],[]).passed).toBe(false)
  })
})
