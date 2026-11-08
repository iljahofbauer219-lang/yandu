import { describe, expect, it } from 'vitest'
import { checkEbayPolicyCarrierItemId } from '../ebayPolicyCarrier'

describe('checkEbayPolicyCarrierItemId', () => {
  it('放行纯数字在架商品编号，并去掉首尾与内部空格', () => {
    expect(checkEbayPolicyCarrierItemId('189035181453')).toEqual({ ok: true, itemId: '189035181453' })
    expect(checkEbayPolicyCarrierItemId('  189 0351 81453 ')).toEqual({ ok: true, itemId: '189035181453' })
    expect(checkEbayPolicyCarrierItemId('301234567890')).toEqual({ ok: true, itemId: '301234567890' })
  })

  it('空值不发请求：点名要填哪个字段与用途', () => {
    const result = checkEbayPolicyCarrierItemId('   ')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('在架商品编号')
      expect(result.message).toContain('189035181453')
    }
  })

  it('拒绝 PALLET- 本地货盘编号：这是 R1 的真机根因，不能再拼进 ReviseItem URL', () => {
    const result = checkEbayPolicyCarrierItemId('PALLET-4b695b47-8c63-4e5b-bf0e-97fe2dbe0e4d')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('PALLET-')
      expect(result.message).toContain('不是 eBay 商品编号')
    }
    expect(checkEbayPolicyCarrierItemId('pallet-wp-1').ok).toBe(false)
  })

  it('拒绝非纯数字与长度不合理的编号，并把原值回显在提示里', () => {
    for (const raw of ['18903518145A', 'https://www.ebay.com/itm/189035181453', '2026', '1890351814530000000']) {
      const result = checkEbayPolicyCarrierItemId(raw)
      expect(result.ok, raw).toBe(false)
      if (!result.ok) expect(result.message, raw).toContain('9–15 位纯数字')
    }
    const tooLong = checkEbayPolicyCarrierItemId('1890351814530000000')
    if (!tooLong.ok) expect(tooLong.message).toContain('1890351814530000000')
  })
})
