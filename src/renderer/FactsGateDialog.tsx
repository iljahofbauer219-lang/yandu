/**
 * 优选前要素完整性闸口对话框：红框五要素读取失败时拦截优选，列明缺失项并提供「重读数据」动作。
 * 独立成文件：App.tsx 为并行会话高频回写区（同 EliminateReasonDialog 的抽离理由）。
 */
import './eliminated-products.css'

export function FactsGateDialog({ title, meta, missing, onCancel, onReread }: {
  title: string
  meta: string
  missing: string[]
  onCancel: () => void
  onReread: () => void
}) {
  return <div className="eliminate-dialog-backdrop" onClick={onCancel}>
    <div className="eliminate-dialog" onClick={event => event.stopPropagation()} role="dialog" aria-label="优选前要素完整性检查">
      <header>
        <div>
          <small>FACTS GATE</small>
          <h3>要素未读取完整，暂不能优选</h3>
          <p title={title}>{title}</p>
          <p className="eliminate-dialog-meta">{meta}</p>
        </div>
        <button type="button" onClick={onCancel}>×</button>
      </header>
      <p className="eliminate-dialog-error">以下要素读取失败：{missing.join('、')}。请重读数据补采后再进入优选产品。</p>
      <footer>
        <button type="button" onClick={onCancel}>知道了</button>
        <button type="button" className="gate-reread" onClick={onReread}>重读数据</button>
      </footer>
    </div>
  </div>
}
