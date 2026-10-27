import { useCallback, useEffect, useRef, useState } from 'react'
import type { EbayLocalProduct, EbayPlatformCategoryOption } from '../shared/contracts'

export interface PlatformCategoryController {
  options: EbayPlatformCategoryOption[]
  busy: boolean
  error: string
  pick: string
  savedId: string
  savedName: string
  setPick: (id: string) => void
  refresh: () => void
  confirm: () => void
}

interface Args {
  product: EbayLocalProduct | null
  onUpdated: (product: EbayLocalProduct) => void
  notify: (message: string) => void
  fail: (message: string) => void
}

/** 平台类目选择：按核心商品词拉 eBay 已成交类目候选，默认销量最大者；确定后落库 */
export function useEbayPlatformCategory({ product, onUpdated, notify, fail }: Args): PlatformCategoryController {
  const [options, setOptions] = useState<EbayPlatformCategoryOption[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pick, setPick] = useState('')
  const productId = product?.id || ''
  const storeId = product?.storeId || ''
  const coreTerm = product ? (product.coreTermEn || product.coreTermZh).trim() : ''
  const savedId = product?.platformCategoryId || ''
  const savedName = product?.platformCategoryName || ''
  const attemptedFor = useRef('')
  const prevProductId = useRef('')

  useEffect(() => {
    // 换产品才清空候选；同产品保存后只回显，避免下拉被清空
    if (prevProductId.current !== productId) {
      prevProductId.current = productId
      setOptions([])
      attemptedFor.current = ''
    }
    setPick(savedId)
    setError('')
  }, [productId, savedId])

  const refresh = useCallback(() => {
    if (!product || busy) return
    if (!coreTerm) { setError('缺少核心商品词，无法获取平台类目'); return }
    attemptedFor.current = productId
    setBusy(true)
    setError('')
    window.desktop.ebay.platformCategories(storeId, coreTerm).then(list => {
      setOptions(list)
      setPick(current => {
        if (current && list.some(item => item.categoryId === current)) return current
        if (savedId && list.some(item => item.categoryId === savedId)) return savedId
        return list[0]?.categoryId || ''
      })
    }).catch(reason => {
      setError(reason instanceof Error ? reason.message : '获取平台类目失败')
    }).finally(() => setBusy(false))
  }, [product, busy, coreTerm, productId, storeId, savedId])

  useEffect(() => {
    if (product && coreTerm && !savedId && attemptedFor.current !== productId) refresh()
  }, [product, coreTerm, savedId, productId, refresh])

  const confirm = useCallback(() => {
    if (!product || busy) return
    if (!pick) { fail('请先选择一个平台类目'); return }
    const chosen = options.find(item => item.categoryId === pick)
    setBusy(true)
    window.desktop.ebay.setLocalPlatformCategory(product.id, pick, chosen?.name || pick).then(updated => {
      onUpdated(updated)
      notify(`平台类目已保存为『${chosen?.name || pick}』`)
    }).catch(reason => {
      fail(reason instanceof Error ? reason.message : '保存平台类目失败')
    }).finally(() => setBusy(false))
  }, [product, busy, pick, options, onUpdated, notify, fail])

  return { options, busy, error, pick, savedId, savedName, setPick, refresh, confirm }
}
