/**
 * ProductLibraryDrawer — 工作台右侧抽屉
 *
 * 行为：
 * - 点击"📦 商品库"按钮从右侧滑出
 * - 复用 ProductLibrary 列表
 * - 注入 "📎 上传" 与 "🛒 1688 提取" 入口
 * - 选中商品：关闭抽屉 + 预填 draft（带入商品信息）
 * - 点外侧 / 关闭按钮关闭
 *
 * Props:
 * - open: 是否显示
 * - onClose: 关闭回调
 * - onSelectProduct: 选中商品
 * - onPickFiles: 上传本地图片
 * - onExtract1688: 从 1688 当前页提取
 */

import { useEffect } from 'react'
import ProductLibrary from './ProductLibrary'
import type { ProductLibraryItem } from '../shared/productLibrary'

type Props = {
  open: boolean
  onClose: () => void
  onSelectProduct: (item: ProductLibraryItem) => void
  onPickFiles: () => void
  onExtract1688: () => void
}

export default function ProductLibraryDrawer({ open, onClose, onSelectProduct, onPickFiles, onExtract1688 }: Props) {
  // ESC 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="ai-employee-product-drawer-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="商品库"
    >
      <aside
        className="ai-employee-product-drawer"
        onClick={event => event.stopPropagation()}
      >
        <ProductLibrary
          onSelect={item => {
            onSelectProduct(item)
            onClose()
          }}
          onPickFiles={() => { onPickFiles() }}
          onExtract1688={() => { onExtract1688() }}
          onClose={onClose}
        />
      </aside>
    </div>
  )
}
