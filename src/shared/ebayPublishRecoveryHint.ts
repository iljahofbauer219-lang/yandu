export interface EbayPublishRecoveryHintInput {
  publishRef?: { kind: string; id: string } | null
  tasks: { draftId: string; reviseUrl: string }[]
  premiumId: string
}

/** 进入发布找回短路：优品 payload 携带的 ref 优先，其次发布任务 reviseUrl 反解；都没有才值得去 eBay 页轮询。 */
export function resolveEbayPublishRecoveryHint(input: EbayPublishRecoveryHintInput): { itemId: string; draftId: string } | null {
  const ref = input.publishRef
  if (ref?.kind === 'draft' && ref.id) return { itemId: '', draftId: ref.id }
  if (ref?.kind === 'listing' && ref.id) return { itemId: ref.id, draftId: '' }
  const task = input.tasks.find(item => item.draftId === input.premiumId && item.reviseUrl)
  if (!task) return null
  try {
    const url = new URL(task.reviseUrl)
    const draftId = url.searchParams.get('draftId') || ''
    if (draftId) return { itemId: '', draftId }
    const itemId = url.searchParams.get('itemId') || (/\/itm\/(\d+)/.exec(url.pathname)?.[1] ?? '')
    if (itemId) return { itemId, draftId: '' }
  } catch {
    return null
  }
  return null
}