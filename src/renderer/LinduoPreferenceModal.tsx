import { useEffect, useMemo, useState } from 'react'
import {
  fetchAllLinduoChatModels,
  fetchLinduoChatModels,
  fetchLinduoMyTierAndExceptions,
  fetchLinduoPreferredModel,
  setLinduoPreferredModel
} from './serverApi'
import type { LinduoChatModelView, LinduoMemberTierView } from '../shared/contracts'
import { LinduoExceptionModal } from './LinduoExceptionModal'
import './linduoModelPickerModal.css'

interface Props {
  onClose: () => void
  onChanged?: () => void  // 通知父组件偏好已变更
}

/**
 * 普通用户 Linduo 模型偏好 modal(M1/R-2)。
 *
 * 触发:sidebar 齿轮(任何登录用户)
 * 行为:
 *   - 顶副标题:「当前等级:{tier.name} · 由等级分配 + 特例」
 *   - 列表:当前用户可用模型(getAvailableModelsForUser 结果)只读 + 单选
 *   - 单选:点一项 = 设为默认(写 preferredLinduoModelId)
 *   - 「修改我的特例」按钮 → 弹 LinduoExceptionModal(targetUserId=自己)
 *   - 「关闭」
 */
export function LinduoPreferenceModal({ onClose, onChanged }: Props) {
  const [me, setMe] = useState<LinduoMemberTierView | null>(null)
  const [available, setAvailable] = useState<LinduoChatModelView[]>([])
  const [allModels, setAllModels] = useState<LinduoChatModelView[]>([])
  const [preferred, setPreferred] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showException, setShowException] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const [meView, models, pref, allEnabled] = await Promise.all([
          fetchLinduoMyTierAndExceptions(),
          fetchLinduoChatModels(),
          fetchLinduoPreferredModel(),
          fetchAllLinduoChatModels()
        ])
        if (cancelled) return
        setMe(meView)
        setAvailable(models)
        setPreferred(pref.modelId)
        setAllModels(allEnabled.filter(m => m.enabled))
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const tierName = me?.tier?.name ?? '未分配'
  const exceptionCount = me?.exceptions.length ?? 0
  const targetUserId = me?.memberId ?? ''

  // 默认模型名(用于副标题)
  const preferredName = useMemo(() => {
    if (!preferred) return '未设置(使用 Codex 默认)'
    return available.find(m => m.id === preferred)?.displayName ?? '未知模型'
  }, [preferred, available])

  async function pickPreferred(modelId: string | null) {
    setSaving(true)
    setError(null)
    try {
      await setLinduoPreferredModel(modelId)
      setPreferred(modelId)
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : '设置失败')
    } finally {
      setSaving(false)
    }
  }

  // 异常 modal 保存回调 — 重新拉 tier/exceptions 和 chat-models
  async function refresh() {
    try {
      const [meView, models] = await Promise.all([
        fetchLinduoMyTierAndExceptions(),
        fetchLinduoChatModels()
      ])
      setMe(meView)
      setAvailable(models)
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : '刷新失败')
    }
  }

  return <div className="settings-backdrop linduo-picker-backdrop" role="dialog" aria-modal="true">
    <div className="linduo-picker-card linduo-assignment-card">
      <header className="linduo-picker-head">
        <div>
          <h2>我的 Linduo 模型偏好</h2>
          <small>
            当前等级:{tierName} · 等级分配 + {exceptionCount} 个特例
            {' '}· 默认模型:{preferredName}
          </small>
        </div>
        <button type="button" className="linduo-picker-close" onClick={onClose} aria-label="关闭">✕</button>
      </header>
      <div className="linduo-picker-body linduo-assignment-body">
        {error && <div className="linduo-picker-error" role="status">{error}</div>}

        {loading && <div className="linduo-picker-loading">加载中…</div>}

        {!loading && available.length === 0 && (
          <div className="linduo-picker-empty">
            当前账号未分配任何 Linduo 模型,请联系管理员在「系统管理 → Linduo 等级」中配置。
          </div>
        )}

        {!loading && available.length > 0 && (
          <ul className="linduo-preference-list" role="radiogroup" aria-label="选择默认模型">
            {available.map(m => {
              const active = m.id === preferred
              return (
                <li key={m.id} className={`linduo-preference-row${active ? ' active' : ''}`}>
                  <label>
                    <input
                      type="radio"
                      name="linduo-preferred"
                      checked={active}
                      disabled={saving}
                      onChange={() => pickPreferred(m.id)}
                    />
                    <span className="linduo-picker-name">{m.displayName}</span>
                    {m.contextLabel && <span className="linduo-picker-ctx">{m.contextLabel}</span>}
                    <span className={`linduo-picker-vendor vendor-${m.vendor}`}>{m.vendor}</span>
                    {m.description && <span className="linduo-picker-desc">{m.description}</span>}
                  </label>
                </li>
              )
            })}
            <li className={`linduo-preference-row dashed${preferred === null ? ' active' : ''}`}>
              <label>
                <input
                  type="radio"
                  name="linduo-preferred"
                  checked={preferred === null}
                  disabled={saving}
                  onChange={() => pickPreferred(null)}
                />
                <span className="linduo-picker-name">不使用 Linduo 模型</span>
                <span className="linduo-picker-desc">回退到 Codex 默认</span>
              </label>
            </li>
          </ul>
        )}
      </div>
      <footer className="linduo-assignment-foot">
        <button
          type="button"
          onClick={() => setShowException(true)}
          disabled={loading || !me}
        >
          修改我的特例
        </button>
        <button type="button" onClick={onClose}>关闭</button>
      </footer>
    </div>
    {showException && me && (
      <LinduoExceptionModal
        onClose={() => setShowException(false)}
        onSaved={() => { void refresh() }}
        member={me}
        allModels={allModels}
        targetUserId={targetUserId}
      />
    )}
  </div>
}
