import { useEffect, useMemo, useState } from 'react'
import {
  fetchAllLinduoChatModels,
  fetchLinduoChatModels,
  fetchLinduoMyTierAndExceptions,
  fetchLinduoPreferredModel,
  setLinduoPreferredModel
} from './serverApi'
import type { LinduoChatModelView, LinduoMemberTierView } from '../shared/contracts'
import { VENDOR_META, VENDORS, type LinduoVendor } from '../shared/linduoCatalog'
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
  const [keyword, setKeyword] = useState('')
  const [vendorFilter, setVendorFilter] = useState<Set<LinduoVendor>>(new Set())

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

  // 搜索 + 供应商筛选后的分组列表(模型多,裸列表不便找)
  const grouped = useMemo(() => {
    const lower = keyword.trim().toLowerCase()
    const filtered = available.filter(m => {
      if (vendorFilter.size > 0 && !vendorFilter.has(m.vendor as LinduoVendor)) return false
      if (!lower) return true
      return m.displayName.toLowerCase().includes(lower)
        || m.modelId.toLowerCase().includes(lower)
        || (m.description ?? '').toLowerCase().includes(lower)
    })
    return VENDORS
      .filter(v => vendorFilter.size === 0 || vendorFilter.has(v))
      .map(v => ({
        vendor: v,
        label: VENDOR_META[v].label,
        color: VENDOR_META[v].color,
        icon: VENDOR_META[v].icon,
        items: filtered.filter(m => m.vendor === v)
      }))
      .filter(g => g.items.length > 0)
  }, [available, keyword, vendorFilter])

  const toggleVendor = (vendor: LinduoVendor) => {
    setVendorFilter(previous => {
      const next = new Set(previous)
      if (next.has(vendor)) next.delete(vendor); else next.add(vendor)
      return next
    })
  }

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
          <>
            <div className="linduo-pref-toolbar">
              <input
                type="search"
                className="linduo-pref-search"
                placeholder="搜索模型名称 / id / 描述"
                value={keyword}
                onChange={event => setKeyword(event.target.value)}
              />
              <div className="linduo-pref-vendors">
                {VENDORS.map(vendor => {
                  const meta = VENDOR_META[vendor]
                  const active = vendorFilter.has(vendor)
                  return <button
                    key={vendor}
                    type="button"
                    className={`linduo-pref-vendor-chip${active ? ' active' : ''}`}
                    style={active ? { color: meta.color, borderColor: meta.color, background: `${meta.color}14` } : undefined}
                    onClick={() => toggleVendor(vendor)}
                  >
                    {meta.label}
                  </button>
                })}
              </div>
            </div>
            {grouped.length === 0 && <div className="linduo-picker-empty">没有匹配的模型,请调整搜索或筛选</div>}
            <ul className="linduo-preference-list" role="radiogroup" aria-label="选择默认模型">
              {grouped.map(group => (
                <li key={group.vendor} className="linduo-pref-group">
                  <div className="linduo-pref-group-head" style={{ color: group.color }}>
                    <span className="linduo-pref-group-icon" aria-hidden="true">{group.icon}</span>
                    {group.label}
                    <em>{group.items.length}</em>
                  </div>
                  <ul className="linduo-pref-group-list">
                    {group.items.map(m => {
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
                            <span className="linduo-pref-radio" aria-hidden="true" />
                            <span className="linduo-pref-main">
                              <span className="linduo-pref-line1">
                                <span className="linduo-picker-name">{m.displayName}</span>
                                {m.contextLabel && <span className="linduo-picker-ctx">{m.contextLabel}</span>}
                                {active && <span className="linduo-pref-default">默认</span>}
                              </span>
                              {m.description && <span className="linduo-picker-desc">{m.description}</span>}
                            </span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                </li>
              ))}
              <li className={`linduo-preference-row dashed${preferred === null ? ' active' : ''}`}>
                <label>
                  <input
                    type="radio"
                    name="linduo-preferred"
                    checked={preferred === null}
                    disabled={saving}
                    onChange={() => pickPreferred(null)}
                  />
                  <span className="linduo-pref-radio" aria-hidden="true" />
                  <span className="linduo-pref-main">
                    <span className="linduo-pref-line1">
                      <span className="linduo-picker-name">不使用 Linduo 模型</span>
                      {preferred === null && <span className="linduo-pref-default">默认</span>}
                    </span>
                    <span className="linduo-picker-desc">回退到 Codex 默认</span>
                  </span>
                </label>
              </li>
            </ul>
          </>
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
