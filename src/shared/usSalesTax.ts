/**
 * 美国各州法定销售税（eBay 作为 marketplace facilitator 代收口径）：
 * 州+地方平均综合税率表。真值源 Tax Foundation《State and Local Sales Tax Rates, 2026》（2026-01-01 生效）。
 * 逐单实际税率取决于收货地址（州+地方），产品级核算取所选辖区的代表值。
 */

export const US_SALES_TAX_TABLE_VERSION = 'Tax Foundation 2026 版（2026-01-01 生效）'

/** 非具体州选项：按 51 辖区简单平均的综合税率 */
export const US_SALES_TAX_NATIONAL = 'NATIONAL'

export type UsSalesTaxJurisdiction = {
  code: string
  name: string
  /** 州级法定税率（%） */
  stateRate: number
  /** 州+地方平均综合税率（%） */
  combinedRate: number
}

export const US_SALES_TAX_TABLE: UsSalesTaxJurisdiction[] = [
  { code: 'AL', name: 'Alabama', stateRate: 4, combinedRate: 9.46 },
  { code: 'AK', name: 'Alaska', stateRate: 0, combinedRate: 1.82 },
  { code: 'AZ', name: 'Arizona', stateRate: 5.6, combinedRate: 8.52 },
  { code: 'AR', name: 'Arkansas', stateRate: 6.5, combinedRate: 9.46 },
  { code: 'CA', name: 'California', stateRate: 7.25, combinedRate: 8.99 },
  { code: 'CO', name: 'Colorado', stateRate: 2.9, combinedRate: 7.89 },
  { code: 'CT', name: 'Connecticut', stateRate: 6.35, combinedRate: 6.35 },
  { code: 'DE', name: 'Delaware', stateRate: 0, combinedRate: 0 },
  { code: 'DC', name: 'District of Columbia', stateRate: 6, combinedRate: 6 },
  { code: 'FL', name: 'Florida', stateRate: 6, combinedRate: 6.98 },
  { code: 'GA', name: 'Georgia', stateRate: 4, combinedRate: 7.49 },
  { code: 'HI', name: 'Hawaii', stateRate: 4, combinedRate: 4.5 },
  { code: 'ID', name: 'Idaho', stateRate: 6, combinedRate: 6.03 },
  { code: 'IL', name: 'Illinois', stateRate: 6.25, combinedRate: 8.96 },
  { code: 'IN', name: 'Indiana', stateRate: 7, combinedRate: 7 },
  { code: 'IA', name: 'Iowa', stateRate: 6, combinedRate: 6.94 },
  { code: 'KS', name: 'Kansas', stateRate: 6.5, combinedRate: 8.69 },
  { code: 'KY', name: 'Kentucky', stateRate: 6, combinedRate: 6 },
  { code: 'LA', name: 'Louisiana', stateRate: 5, combinedRate: 10.11 },
  { code: 'ME', name: 'Maine', stateRate: 5.5, combinedRate: 5.5 },
  { code: 'MD', name: 'Maryland', stateRate: 6, combinedRate: 6 },
  { code: 'MA', name: 'Massachusetts', stateRate: 6.25, combinedRate: 6.25 },
  { code: 'MI', name: 'Michigan', stateRate: 6, combinedRate: 6 },
  { code: 'MN', name: 'Minnesota', stateRate: 6.875, combinedRate: 8.14 },
  { code: 'MS', name: 'Mississippi', stateRate: 7, combinedRate: 7.06 },
  { code: 'MO', name: 'Missouri', stateRate: 4.225, combinedRate: 8.44 },
  { code: 'MT', name: 'Montana', stateRate: 0, combinedRate: 0 },
  { code: 'NE', name: 'Nebraska', stateRate: 5.5, combinedRate: 6.98 },
  { code: 'NV', name: 'Nevada', stateRate: 6.85, combinedRate: 8.24 },
  { code: 'NH', name: 'New Hampshire', stateRate: 0, combinedRate: 0 },
  { code: 'NJ', name: 'New Jersey', stateRate: 6.625, combinedRate: 6.6 },
  { code: 'NM', name: 'New Mexico', stateRate: 4.875, combinedRate: 7.67 },
  { code: 'NY', name: 'New York', stateRate: 4, combinedRate: 8.54 },
  { code: 'NC', name: 'North Carolina', stateRate: 4.75, combinedRate: 7 },
  { code: 'ND', name: 'North Dakota', stateRate: 5, combinedRate: 7.09 },
  { code: 'OH', name: 'Ohio', stateRate: 5.75, combinedRate: 7.29 },
  { code: 'OK', name: 'Oklahoma', stateRate: 4.5, combinedRate: 9.06 },
  { code: 'OR', name: 'Oregon', stateRate: 0, combinedRate: 0 },
  { code: 'PA', name: 'Pennsylvania', stateRate: 6, combinedRate: 6.34 },
  { code: 'RI', name: 'Rhode Island', stateRate: 7, combinedRate: 7 },
  { code: 'SC', name: 'South Carolina', stateRate: 6, combinedRate: 7.49 },
  { code: 'SD', name: 'South Dakota', stateRate: 4.2, combinedRate: 6.11 },
  { code: 'TN', name: 'Tennessee', stateRate: 7, combinedRate: 9.61 },
  { code: 'TX', name: 'Texas', stateRate: 6.25, combinedRate: 8.2 },
  { code: 'UT', name: 'Utah', stateRate: 6.1, combinedRate: 7.42 },
  { code: 'VT', name: 'Vermont', stateRate: 6, combinedRate: 6.39 },
  { code: 'VA', name: 'Virginia', stateRate: 5.3, combinedRate: 5.77 },
  { code: 'WA', name: 'Washington', stateRate: 6.5, combinedRate: 9.51 },
  { code: 'WV', name: 'West Virginia', stateRate: 6, combinedRate: 6.59 },
  { code: 'WI', name: 'Wisconsin', stateRate: 5, combinedRate: 5.72 },
  { code: 'WY', name: 'Wyoming', stateRate: 4, combinedRate: 5.56 }
]

/** 51 辖区综合税率的简单平均（保留两位），作为「全国平均」代表值 */
export function usSalesTaxNationalAverageRate(): number {
  const total = US_SALES_TAX_TABLE.reduce((sum, item) => sum + item.combinedRate, 0)
  return Math.round(total / US_SALES_TAX_TABLE.length * 100) / 100
}

/** 取辖区综合税率；NATIONAL 返回全国平均；未知辖区返回 null 交由调用方保原值 */
export function usSalesTaxCombinedRate(code: string | null | undefined): number | null {
  if (code === US_SALES_TAX_NATIONAL) return usSalesTaxNationalAverageRate()
  const hit = US_SALES_TAX_TABLE.find(item => item.code === String(code || '').trim().toUpperCase())
  return hit ? hit.combinedRate : null
}

/** 下拉与提示用的辖区名称 */
export function usSalesTaxLabel(code: string | null | undefined): string {
  if (code === US_SALES_TAX_NATIONAL) return '全国平均'
  const hit = US_SALES_TAX_TABLE.find(item => item.code === String(code || '').trim().toUpperCase())
  return hit ? `${hit.name}（${hit.code}）` : '未知辖区'
}
