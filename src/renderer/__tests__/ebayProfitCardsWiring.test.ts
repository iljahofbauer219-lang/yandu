import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const appSource = readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8')

/**
 * 用户口径（2026-11-18 截图四色框）：05 售价设定四张汇总卡改美元利润链——
 * 红=产品成本（成本要素五项和）、黄=销售成本（平台与经营费率+推广佣金+退货预留）、
 * 蓝=销售价格（建议销售价现值）、绿=产品毛利（销售价格−产品成本−销售成本）。
 * 只改四卡；保本/目标毛利引擎与保存入优品链路不动。
 */
describe('售价设定四卡 · 美元利润链口径守卫', () => {
  const start = appSource.indexOf('<div className="ebay-profit-summary">')
  const block = appSource.slice(start, appSource.indexOf('</div>', start))

  it('四卡标题与公式副标题齐备，且走共享纯函数', () => {
    expect(start).toBeGreaterThan(-1)
    for (const label of ['产品成本（美元）', '销售成本（美元）', '销售价格（美元）', '产品毛利（美元）']) {
      expect(block, `缺少卡标题 ${label}`).toContain(label)
    }
    for (const needle of ['采购+物流+包装+仓配+其他', '平台与经营费率+推广佣金+退货预留', '销售价格−产品成本−销售成本', 'computeEbayProfitCards(']) {
      expect(block, `缺少口径锚点 ${needle}`).toContain(needle)
    }
    expect(appSource).toContain("import { computeEbayProfitCards } from '../shared/ebayProfitCards'")
  })

  it('旧四卡口径（快照售价/保本售价/目标毛利售价/人民币预计利润）不得留在汇总卡内', () => {
    for (const old of ['eBay 当前售价', '保本售价', '目标毛利售价', '当前预计利润']) {
      expect(block, `汇总卡仍含旧口径 ${old}`).not.toContain(old)
    }
    expect(block, '毛利卡不得再显示人民币金额').not.toContain('¥${')
  })

  it('销售价格取建议销售价（targetSalePrice）并按币种折美元；销售成本固定费随费率模式', () => {
    expect(block).toContain('targetSalePrice')
    expect(block).toContain("platformFeeMode==='CATEGORY_RULE'")
    expect(block).toContain('platformFixedFeeCny')
  })

  it('保本/目标毛利引擎与核算结果带不动（只改四卡）', () => {
    expect(appSource).toContain('const breakEvenSalePrice=')
    expect(appSource).toContain('const targetSalePrice=')
    expect(appSource).toContain('const estimatedProfitCny=')
    expect(appSource).toContain('<b>核算结果</b>')
  })
})