export interface SupplyFeeCandidates {
  packing: string[]
  freight: string[]
  shipping: string[]
}

export interface SupplyFeePickResult {
  packingFee: string
  freightFee: string
  shippingFee: string
}

// 经 toString() 注入供应原页执行：函数体必须纯 JS、不得对 const 再赋值，否则整段注入脚本抛错
export function pickSupplyFees(candidates: SupplyFeeCandidates, unitPrice: string, estimatedTotal: string): SupplyFeePickResult {
  const parse = (value: string): number | null => {
    if (!value) return null
    const m = /[\d,.]+/.exec(value)
    if (!m) return null
    const v = parseFloat(m[0].replace(/,/g, ''))
    return Number.isFinite(v) ? v : null
  }
  const packingList = candidates.packing && candidates.packing.length ? candidates.packing : ['']
  const freightList = candidates.freight || []
  const shippingList = candidates.shipping || []
  const result: SupplyFeePickResult = {
    packingFee: packingList[0] === undefined ? '' : packingList[0],
    freightFee: freightList[0] || '',
    shippingFee: shippingList[0] || ''
  }
  const unitNum = parse(unitPrice)
  const totalNum = parse(estimatedTotal)
  if (unitNum !== null && totalNum !== null && shippingList.length) {
    const hitShipping = shippingList.find(item => {
      const v = parse(item)
      return v !== null && Math.abs(unitNum + v - totalNum) <= 0.01
    })
    if (hitShipping) result.shippingFee = hitShipping
  }
  const shipNum = parse(result.shippingFee)
  if (shipNum !== null && freightList.length) {
    for (const p of packingList) {
      for (const f of freightList) {
        const pv = parse(p) || 0
        const fv = parse(f)
        if (fv !== null && Math.abs(pv + fv - shipNum) <= 0.01) {
          result.packingFee = p
          result.freightFee = f
          return result
        }
      }
    }
  }
  return result
}
