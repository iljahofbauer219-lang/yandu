#!/usr/bin/env node
/**
 * 阶段 3+：FBA 履约费推算回归。
 * 覆盖 Amazon US 2024-09 生效版 Standard-Size 费率表全部档位 + 边界。
 */
import { estimateFbaFulfillmentFee, type EstimateFbaFulfillmentFeeResult } from '../src/shared/amazonScraper'

let failures = 0
const assert = (label: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` · ${detail}` : ''}`)
  if (!ok) failures += 1
}
const show = (label: string, result: EstimateFbaFulfillmentFeeResult): void => {
  if (result.feeUsd != null) console.log(`  · ${label}: $${result.feeUsd.toFixed(2)} (${result.sizeTier})`)
}

// ─── 1. SmallStandard 档位 ──────────────────────────────────────
const ss1 = estimateFbaFulfillmentFee({ weightGrams: 80, dimensionsCm: { length: 8, width: 5, height: 1 } })
assert('SmallStandard ≤4 oz = $3.06', ss1.feeUsd === 3.06, `实际 $${ss1.feeUsd}`)
assert('SmallStandard 标签正确', ss1.sizeTier === 'SmallStandard')
assert('SmallStandard 描述含 Amazon US FBA 2024-09', ss1.source.includes('Amazon US FBA 2024-09'))
show('SS ≤4oz', ss1)

const ss2 = estimateFbaFulfillmentFee({ weightGrams: 160, dimensionsCm: { length: 9, width: 6, height: 1.2 } })
assert('SmallStandard 4-6 oz = $3.15', ss2.feeUsd === 3.15, `实际 $${ss2.feeUsd}`)
show('SS 4-6oz', ss2)

// ─── 2. LargeStandard 各档位 ───────────────────────────────────
const ls1 = estimateFbaFulfillmentFee({ weightGrams: 200, dimensionsCm: { length: 15, width: 10, height: 3 } })
assert('LargeStandard ≤0.5 lb = $3.43', ls1.feeUsd === 3.43, `实际 $${ls1.feeUsd}`)
show('LS ≤0.5lb', ls1)

const ls2 = estimateFbaFulfillmentFee({ weightGrams: 400, dimensionsCm: { length: 20, width: 15, height: 5 } })
assert('LargeStandard 0.5-1 lb = $3.78', ls2.feeUsd === 3.78, `实际 $${ls2.feeUsd}`)
show('LS 0.5-1lb', ls2)

const ls3 = estimateFbaFulfillmentFee({ weightGrams: 600, dimensionsCm: { length: 25, width: 18, height: 5 } })
assert('LargeStandard 1-1.5 lb = $4.39', ls3.feeUsd === 4.39, `实际 $${ls3.feeUsd}`)
show('LS 1-1.5lb', ls3)

const ls4 = estimateFbaFulfillmentFee({ weightGrams: 800, dimensionsCm: { length: 25, width: 18, height: 6 } })
assert('LargeStandard 1.5-2 lb = $4.88', ls4.feeUsd === 4.88, `实际 $${ls4.feeUsd}`)
show('LS 1.5-2lb', ls4)

const ls5 = estimateFbaFulfillmentFee({ weightGrams: 1200, dimensionsCm: { length: 30, width: 20, height: 8 } })
assert('LargeStandard 2-3 lb = $5.40', ls5.feeUsd === 5.40, `实际 $${ls5.feeUsd}`)
show('LS 2-3lb', ls5)

const ls6 = estimateFbaFulfillmentFee({ weightGrams: 2000, dimensionsCm: { length: 35, width: 25, height: 10 } })
assert('LargeStandard 4.4 lb 阶梯式 = $6.00', ls6.feeUsd != null && Math.abs(ls6.feeUsd - 6.00) < 0.01, `实际 $${ls6.feeUsd}`)
show('LS 4.4lb', ls6)

// ─── 3. LargeBulky 兜底 ─────────────────────────────────────────
const lb1 = estimateFbaFulfillmentFee({ weightGrams: 5000, dimensionsCm: { length: 80, width: 60, height: 40 } })
assert('LargeBulky 5 lb 返回阶梯费', lb1.feeUsd != null && lb1.feeUsd >= 9.61, `实际 $${lb1.feeUsd}`)
assert('LargeBulky tier 标记正确', lb1.sizeTier === 'LargeBulky')
assert('LargeBulky 必须警告 Revenue Calculator 复核', lb1.warnings.some(w => w.includes('Revenue Calculator')))
show('LB 5lb', lb1)

// ─── 4. 缺重量必返回 null ───────────────────────────────────────
const noWeight = estimateFbaFulfillmentFee({ weightGrams: null, dimensionsCm: { length: 10, width: 8, height: 3 } })
assert('缺重量返回 null', noWeight.feeUsd === null)
assert('缺重量警告说明', noWeight.warnings.some(w => w.includes('Item Weight')))

// ─── 5. 强制 tier 覆盖（用户/前端可指定 tier） ──────────────────
const forceLarge = estimateFbaFulfillmentFee({ weightGrams: 100, dimensionsCm: null, sizeTier: 'LargeStandard' })
assert('强制 LargeStandard 即使重量小也走大标', forceLarge.sizeTier === 'LargeStandard')
assert('强制 tier 时走 0.5-1 lb 档', forceLarge.feeUsd === 3.43, `实际 $${forceLarge.feeUsd}`)

const forceBulky = estimateFbaFulfillmentFee({ weightGrams: 2000, dimensionsCm: { length: 80, width: 60, height: 40 }, sizeTier: 'LargeBulky' })
assert('强制 LargeBulky 即超尺寸也走大件', forceBulky.sizeTier === 'LargeBulky')

// ─── 6. ExtraLarge 必走人工补差 ─────────────────────────────────
const xl1 = estimateFbaFulfillmentFee({ weightGrams: 40000, dimensionsCm: { length: 80, width: 60, height: 40 } })
assert('ExtraLarge tier 标记', xl1.sizeTier === 'ExtraLarge')
assert('ExtraLarge fee = null', xl1.feeUsd === null)
assert('ExtraLarge 警告人工报价', xl1.warnings.some(w => w.includes('按件报价')))

const xl2 = estimateFbaFulfillmentFee({ weightGrams: 80000, dimensionsCm: { length: 80, width: 60, height: 40 } })
assert('>150 lb 仍然 null', xl2.feeUsd === null)

// ─── 7. 来源描述含 Amazon US 2024-09 ───────────────────────────
assert('SmallStandard 源含 2024-09', ss1.source.includes('2024-09'))
assert('LargeStandard 源含 2024-09', ls2.source.includes('2024-09'))
assert('LargeBulky 源含 2024-09', lb1.source.includes('2024-09'))

if (failures) {
  console.log(`\n${failures} FAILURES`)
  process.exit(1)
}
console.log('\nALL PASS')
