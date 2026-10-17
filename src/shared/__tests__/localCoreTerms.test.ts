import { describe, expect, it } from 'vitest'
import { parseCoreTermTranslationReply, parseCoreTermsReply } from '../localCoreTerms'

describe('parseCoreTermsReply 千问核心商品词解析', () => {
  it('解析标准 JSON 回复', () => {
    expect(parseCoreTermsReply('{"zh":"赛车座椅","en":"Racing Seat"}')).toEqual({ zh: '赛车座椅', en: 'Racing Seat' })
  })

  it('解析围栏 JSON 与中文键名', () => {
    const reply = '```json\n{"中文核心商品词":"桶式赛车座椅","英文核心商品词":"Bucket Racing Seats"}\n```'
    expect(parseCoreTermsReply(reply)).toEqual({ zh: '桶式赛车座椅', en: 'Bucket Racing Seats' })
  })

  it('解析 中文：/英文：标记行回落', () => {
    const reply = ['核心商品词如下：', '中文：赛车座椅', '英文：Racing Seat'].join('\n')
    expect(parseCoreTermsReply(reply)).toEqual({ zh: '赛车座椅', en: 'Racing Seat' })
  })

  it('英文混入中文时该字段回落空串', () => {
    expect(parseCoreTermsReply('{"zh":"赛车座椅","en":"赛车 Racing Seat"}')).toEqual({ zh: '赛车座椅', en: '' })
  })

  it('中文键取到英文值时该字段回落空串', () => {
    expect(parseCoreTermsReply('{"zh":"Racing Seat","en":"Racing Seat"}')).toEqual({ zh: '', en: 'Racing Seat' })
  })

  it('超长中文回落空串', () => {
    const long = '赛'.repeat(30)
    expect(parseCoreTermsReply(`{"zh":"${long}","en":"Racing Seat"}`)).toEqual({ zh: '', en: 'Racing Seat' })
  })

  it('坏 JSON 且无标记行返回 null', () => {
    expect(parseCoreTermsReply('抱歉，我无法回答')).toBeNull()
    expect(parseCoreTermsReply('')).toBeNull()
  })

  it('去掉尾部标点与多余空白', () => {
    expect(parseCoreTermsReply('{"zh":"赛车座椅。","en":"  Racing   Seat, "}')).toEqual({ zh: '赛车座椅', en: 'Racing Seat' })
  })
})

describe('parseCoreTermTranslationReply 中文产品译英文', () => {
  it('取纯英文名词短语并去引号与尾部标点', () => {
    expect(parseCoreTermTranslationReply('Racing Seat')).toBe('Racing Seat')
    expect(parseCoreTermTranslationReply('  "Bucket Racing Seats."  ')).toBe('Bucket Racing Seats')
  })

  it('围栏与解释前缀行下取首个有效英文行', () => {
    expect(parseCoreTermTranslationReply('```text\nHood Cover\n```')).toBe('Hood Cover')
    expect(parseCoreTermTranslationReply('翻译结果：\nRoof Rack')).toBe('Roof Rack')
  })

  it('整句、含中文、超长一律空串', () => {
    expect(parseCoreTermTranslationReply('This is a product for cars')).toBe('')
    expect(parseCoreTermTranslationReply('机盖 Hood Cover')).toBe('')
    expect(parseCoreTermTranslationReply('x'.repeat(70))).toBe('')
    expect(parseCoreTermTranslationReply('')).toBe('')
  })
})
