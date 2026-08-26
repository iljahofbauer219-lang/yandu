import { useEffect, useState } from 'react'
import { fetchLinduoChatModels, setLinduoPreferredModel } from './serverApi'
import type { LinduoChatModelView } from '../shared/contracts'
import './linduoModelPickerModal.css'

interface Props {
  onClose: () => void
  onPicked: () => void  // 通知父组件重读 preferred
}

export function LinduoModelPickerModal({ onClose, onPicked }: Props) {
  const [models, setModels] = useState<LinduoChatModelView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetchLinduoChatModels().then(setModels).catch(err => setError(err instanceof Error ? err.message : '加载失败'))
  }, [])

  async function pick(modelId: string | null) {
    setSubmitting(true)
    setError(null)
    try {
      await setLinduoPreferredModel(modelId)
      onPicked()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '设置失败')
    } finally {
      setSubmitting(false)
    }
  }

  return <div className="settings-backdrop linduo-picker-backdrop" role="dialog" aria-modal="true">
    <div className="linduo-picker-card">
      <header className="linduo-picker-head">
        <div>
          <h2>大模型选用</h2>
          <small>零度API 聚合 · 按你的权限显示可选模型,选择会同步到所有设备</small>
        </div>
        <button type="button" className="linduo-picker-close" onClick={onClose} aria-label="关闭">✕</button>
      </header>
      <div className="linduo-picker-body">
        {error && <div className="linduo-picker-error" role="status">{error}</div>}
        {models === null && !error && <div className="linduo-picker-loading">加载中…</div>}
        {models !== null && models.length === 0 && (
          <div className="linduo-picker-empty">
            当前账号未分配任何 Linduo 聊天模型,请联系管理员在系统管理页分配。
          </div>
        )}
        {models !== null && models.length > 0 && (
          <ul className="linduo-picker-list">
            {models.map(model => (
              <li key={model.id}>
                <button
                  type="button"
                  className="linduo-picker-row"
                  disabled={submitting}
                  onClick={() => pick(model.id)}
                >
                  <span className="linduo-picker-name">{model.displayName}</span>
                  {model.contextLabel && <span className="linduo-picker-ctx">{model.contextLabel}</span>}
                  <span className={`linduo-picker-vendor vendor-${model.vendor}`}>{model.vendor}</span>
                  <span className="linduo-picker-desc">{model.description}</span>
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                className="linduo-picker-row linduo-picker-clear"
                disabled={submitting}
                onClick={() => pick(null)}
              >
                <span className="linduo-picker-name">不使用 Linduo 模型</span>
                <span className="linduo-picker-desc">回退到 Codex 默认 (DeepSeek V4 Flash)</span>
              </button>
            </li>
          </ul>
        )}
      </div>
    </div>
  </div>
}
