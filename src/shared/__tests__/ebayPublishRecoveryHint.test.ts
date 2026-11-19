import { describe, expect, it } from 'vitest'
import { resolveEbayPublishRecoveryHint } from '../ebayPublishRecoveryHint'

const task = (draftId: string, reviseUrl: string) => ({ draftId, reviseUrl })

describe('resolveEbayPublishRecoveryHint · 找回短路事实源', () => {
  it('优品自带 draft ref 直接短路，不需任务与 eBay 页', () => {
    expect(resolveEbayPublishRecoveryHint({ publishRef: { kind: 'draft', id: '5329376346020' }, tasks: [], premiumId: 'p1' }))
      .toEqual({ itemId: '', draftId: '5329376346020' })
  })
  it('优品自带 listing ref 短路为 itemId', () => {
    expect(resolveEbayPublishRecoveryHint({ publishRef: { kind: 'listing', id: '110582937465' }, tasks: [], premiumId: 'p1' }))
      .toEqual({ itemId: '110582937465', draftId: '' })
  })
  it('任务 reviseUrl 的 lstng draftId 参数可短路', () => {
    expect(resolveEbayPublishRecoveryHint({ tasks: [task('p1', 'https://www.ebay.com/lstng?draftId=5329376346020&mode=AddItem')], premiumId: 'p1' }))
      .toEqual({ itemId: '', draftId: '5329376346020' })
  })
  it('任务 reviseUrl 的 ReviseItem itemId 参数可短路', () => {
    expect(resolveEbayPublishRecoveryHint({ tasks: [task('p1', 'https://www.ebay.com/sl/list?mode=ReviseItem&itemId=110582937465')], premiumId: 'p1' }))
      .toEqual({ itemId: '110582937465', draftId: '' })
  })
  it('任务 reviseUrl 的 /itm/ 路径可短路', () => {
    expect(resolveEbayPublishRecoveryHint({ tasks: [task('p1', 'https://www.ebay.com/itm/110582937465')], premiumId: 'p1' }))
      .toEqual({ itemId: '110582937465', draftId: '' })
  })
  it('无 ref 无任务命中返回 null；坏 URL 与他优品任务不误导', () => {
    expect(resolveEbayPublishRecoveryHint({ tasks: [], premiumId: 'p1' })).toBeNull()
    expect(resolveEbayPublishRecoveryHint({ tasks: [task('p1', 'not a url')], premiumId: 'p1' })).toBeNull()
    expect(resolveEbayPublishRecoveryHint({ tasks: [task('p2', 'https://www.ebay.com/lstng?draftId=999')], premiumId: 'p1' })).toBeNull()
    expect(resolveEbayPublishRecoveryHint({ publishRef: { kind: 'draft', id: '' }, tasks: [task('p1', '')], premiumId: 'p1' })).toBeNull()
  })
})