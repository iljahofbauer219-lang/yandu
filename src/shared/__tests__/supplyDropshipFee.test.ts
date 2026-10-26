import { describe, expect, it } from 'vitest'
import { pickDropshipShippingFee } from '../supplyDropshipFee'

// 注入脚本经 toString() 取源码执行，此处用同一手法复现，确保函数体自包含（不得引用模块作用域）
const injected = new Function('return ' + pickDropshipShippingFee.toString())() as typeof pickDropshipShippingFee

describe('pickDropshipShippingFee', () => {
  it('双卡同容器且一件代发在前：取一件代发的预估物流费', () => {
    const texts = ['物流方式 一件代发 预估物流费: $47.68 /件 云送仓 预估物流费: $23.35~$65.50 /件 (单地址起订量: 100ft²)']
    expect(pickDropshipShippingFee(texts)).toBe('$47.68 /件')
  })

  it('云送仓卡排在前面时仍取一件代发', () => {
    const texts = ['物流方式 云送仓 预估物流费: $23.35~$65.50 /件 一件代发 预估物流费: $47.68 /件']
    expect(pickDropshipShippingFee(texts)).toBe('$47.68 /件')
  })

  it('祖先容器混入时取最小的一张卡', () => {
    const texts = [
      '商品详情 物流方式 一件代发 预估物流费: $47.68 /件 云送仓 预估物流费: $23.35~$65.50 /件 单价(件) $235.00 可售库存 8',
      '物流方式 一件代发 预估物流费: $47.68 /件 云送仓 预估物流费: $23.35~$65.50 /件',
      '一件代发 预估物流费: $47.68 /件'
    ]
    expect(pickDropshipShippingFee(texts)).toBe('$47.68 /件')
  })

  it('标签与金额被其它字段分隔（含 $）时回落单卡取值', () => {
    const texts = ['一件代发 单价(件) $235.00 预估物流费: $47.68 /件']
    expect(pickDropshipShippingFee(texts)).toBe('$47.68 /件')
  })

  it('只有云送仓商品返回空串交由候选打分兜底', () => {
    expect(pickDropshipShippingFee(['物流方式 云送仓 预估物流费: $23.35~$65.50 /件 (单地址起订量: 100ft²)'])).toBe('')
  })

  it('金额非数值形态返回空串', () => {
    expect(pickDropshipShippingFee(['一件代发 预估物流费: 计算中'])).toBe('')
    expect(pickDropshipShippingFee([])).toBe('')
  })

  it('经 toString() 注入执行结果一致', () => {
    expect(injected(['一件代发 预估物流费: US$146.00 /件'])).toBe('US$146.00 /件')
  })
})
