/**
 * notify 纯函数单测（P1-14：通知读状态模型）：
 *   - notificationScopeWhere：可见/可操作范围 = 本人定向行 + userId=null 的历史组织广播行；
 *     列表、未读计数、单条已读、全部已读共用同一口径，修复"一人点全部已读清零所有人徽标"
 *   - isPublishedStatus：变更标红判定
 * 触库路径（createNotification 扇出 / listNotifications / markRead / buildMorningSummary）由 verify-erp-p5.ts e2e 覆盖。
 */
import { describe, expect, it } from 'vitest'
import { notificationScopeWhere, isPublishedStatus } from '../notify.js'

describe('notificationScopeWhere（P1-14：已读状态按人独立）', () => {
  it('范围 = 本人 userId 定向行 + userId=null 历史广播行', () => {
    expect(notificationScopeWhere('user-1')).toEqual({
      OR: [{ userId: 'user-1' }, { userId: null }]
    })
  })

  it('不同用户的范围互不重叠（各自定向行隔离，全部已读不再互相清零）', () => {
    const a = notificationScopeWhere('user-a')
    const b = notificationScopeWhere('user-b')
    expect(a.OR[0]).toEqual({ userId: 'user-a' })
    expect(b.OR[0]).toEqual({ userId: 'user-b' })
    expect(a.OR[0]).not.toEqual(b.OR[0])
  })

  it('保留 userId=null 兼容项（升级前落库的存量广播不丢可见性）', () => {
    expect(notificationScopeWhere('user-1').OR).toContainEqual({ userId: null })
  })
})

describe('isPublishedStatus（变更标红判定）', () => {
  it('PUBLISHED（含大小写变体）命中', () => {
    expect(isPublishedStatus('PUBLISHED')).toBe(true)
    expect(isPublishedStatus('published')).toBe(true)
  })

  it('其余状态与空值不命中', () => {
    expect(isPublishedStatus('READY')).toBe(false)
    expect(isPublishedStatus('')).toBe(false)
  })
})
