/**
 * 淘汰原因确认对话框（优选产品 / 采集侯选共用）。
 * 独立成文件：App.tsx 为并行会话高频回写区，内联对话框 JSX 曾多次被旧缓冲区覆盖丢失，
 * 抽离后结构稳定；展示标题 + 平台/ID/URL 关键信息行 + 可选原因输入。
 */
import { useState } from 'react'
import './eliminated-products.css'

export function EliminateReasonDialog({ kind, title, meta, error, onCancel, onConfirm }: {
  kind: 'product' | 'candidate'
  title: string
  meta: string
  error?: string
  onCancel: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  const isProduct = kind === 'product'
  return <div className="eliminate-dialog-backdrop" onClick={onCancel}>
    <div className="eliminate-dialog" onClick={event => event.stopPropagation()} role="dialog" aria-label={isProduct ? '淘汰商品' : '淘汰候选商品'}>
      <header>
        <div>
          <small>{isProduct ? 'ELIMINATE PRODUCT' : 'ELIMINATE CANDIDATE'}</small>
          <h3>{isProduct ? '淘汰商品' : '淘汰候选商品'}</h3>
          <p title={title}>{title}</p>
          <p className="eliminate-dialog-meta">{meta}</p>
        </div>
        <button type="button" onClick={onCancel}>×</button>
      </header>
      <label>淘汰原因（可选）<textarea value={reason} onChange={event => setReason(event.target.value)} placeholder="例如：利润不足 / 类目不符 / 侵权风险…" /></label>
      {error ? <p className="eliminate-dialog-error">{error}</p> : null}
      <footer>
        <button type="button" onClick={onCancel}>取消</button>
        <button type="button" className="danger" onClick={() => onConfirm(reason.trim())}>确认淘汰</button>
      </footer>
    </div>
  </div>
}
