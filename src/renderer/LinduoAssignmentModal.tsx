import { useEffect, useMemo, useState } from 'react'
import {
  fetchAllLinduoChatModels,
  fetchLinduoTierModels,
  fetchLinduoTiers,
  setLinduoTierModels
} from './serverApi'
import type { LinduoChatModelView, LinduoModelTierView } from '../shared/contracts'
import './linduoModelPickerModal.css'

interface Props {
  onClose: () => void
  onSaved?: () => void  // 通知父组件 tier 已更新(其他 modal 重新拉)
}

/**
 * Admin 端 Linduo 模型分配穿梭 modal(M1/R-2)。
 *
 * 入口:App.tsx sidebar 齿轮(只有 member.manage 权限才看到)
 * 行为:
 *   1. 进入时拉 tiers + 全部 enabled models
 *   2. 顶部 radio 切 tier(默认 full,OWNER 全开)
 *   3. 双栏穿梭:左可选 / 右已分配
 *   4. full tier 是只读,左栏隐藏,只显示右栏「全部 N 个已开放」
 *   5. 保存:PUT /tiers/:id/models { modelIds }
 */
export function LinduoAssignmentModal({ onClose, onSaved }: Props) {
  const [tiers, setTiers] = useState<LinduoModelTierView[] | null>(null)
  const [allModels, setAllModels] = useState<LinduoChatModelView[]>([])
  const [activeTierId, setActiveTierId] = useState<string | null>(null)
  /** 选中状态的"已分配"模型 id 集合(尚未保存) */
  const [assigned, setAssigned] = useState<Set<string>>(new Set())
  /** 穿梭栏左右两侧的待操作选中(modelId) */
  const [pickedLeft, setPickedLeft] = useState<Set<string>>(new Set())
  const [pickedRight, setPickedRight] = useState<Set<string>>(new Set())

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  // 进入时拉 tiers + 全模型列表
  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const [tierRows, modelRows] = await Promise.all([
          fetchLinduoTiers(),
          fetchAllLinduoChatModels()
        ])
        if (cancelled) return
        setTiers(tierRows)
        setAllModels(modelRows.filter(m => m.enabled))
        // 默认进 advanced(如果存在)否则第一个
        const preferred = tierRows.find(t => t.key === 'advanced') ?? tierRows[0]
        if (preferred) setActiveTierId(preferred.id)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // 切 tier 时拉它的 grants
  useEffect(() => {
    if (activeTierId === null) return
    const tier = tiers?.find(t => t.id === activeTierId)
    if (!tier) return
    let cancelled = false
    void (async () => {
      setError(null)
      setInfo(null)
      try {
        const result = await fetchLinduoTierModels(activeTierId)
        if (cancelled) return
        setAssigned(new Set(result.models.map(m => m.id)))
        setPickedLeft(new Set())
        setPickedRight(new Set())
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载 tier 失败')
      }
    })()
    return () => { cancelled = true }
  }, [activeTierId, tiers])

  const activeTier = useMemo(
    () => tiers?.find(t => t.id === activeTierId) ?? null,
    [tiers, activeTierId]
  )
  const isFullReadonly = activeTier?.key === 'full'

  // 左栏:未分配的 enabled 模型
  const leftModels = useMemo(
    () => allModels.filter(m => !assigned.has(m.id)),
    [allModels, assigned]
  )
  // 右栏:已分配
  const rightModels = useMemo(
    () => allModels.filter(m => assigned.has(m.id)),
    [allModels, assigned]
  )

  function togglePicked(side: 'left' | 'right', id: string) {
    const setter = side === 'left' ? setPickedLeft : setPickedRight
    setter(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function moveRight() {
    if (pickedLeft.size === 0) return
    setAssigned(prev => {
      const next = new Set(prev)
      for (const id of pickedLeft) next.add(id)
      return next
    })
    setPickedLeft(new Set())
  }
  function moveLeft() {
    if (pickedRight.size === 0) return
    setAssigned(prev => {
      const next = new Set(prev)
      for (const id of pickedRight) next.delete(id)
      return next
    })
    setPickedRight(new Set())
  }
  function moveAll(direction: 'right' | 'left') {
    if (direction === 'right') {
      setAssigned(prev => new Set([...prev, ...leftModels.map(m => m.id)]))
    } else {
      setAssigned(prev => {
        const next = new Set(prev)
        for (const m of rightModels) next.delete(m.id)
        return next
      })
    }
    setPickedLeft(new Set())
    setPickedRight(new Set())
  }

  async function save() {
    if (activeTierId === null) return
    setSaving(true)
    setError(null)
    setInfo(null)
    try {
      await setLinduoTierModels(activeTierId, [...assigned])
      setInfo(`已保存「${activeTier?.name ?? ''}」的 ${assigned.size} 个模型`)
      onSaved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return <div className="settings-backdrop linduo-picker-backdrop" role="dialog" aria-modal="true">
    <div className="linduo-picker-card linduo-assignment-card">
      <header className="linduo-picker-head">
        <div>
          <h2>大模型选用 · 零度API 聚合</h2>
          <small>按等级分配 Linduo 模型,选定后所有同等级成员立刻生效</small>
        </div>
        <button type="button" className="linduo-picker-close" onClick={onClose} aria-label="关闭">✕</button>
      </header>
      <div className="linduo-picker-body linduo-assignment-body">
        {error && <div className="linduo-picker-error" role="status">{error}</div>}
        {info && <div className="linduo-picker-info" role="status">{info}</div>}

        {loading && <div className="linduo-picker-loading">加载中…</div>}

        {!loading && tiers && tiers.length === 0 && (
          <div className="linduo-picker-empty">组织下未配置任何等级,请联系系统管理员。</div>
        )}

        {!loading && tiers && tiers.length > 0 && (
          <>
            <div className="linduo-assignment-tiers" role="radiogroup" aria-label="Linduo 模型等级">
              {tiers.map(tier => {
                const active = tier.id === activeTierId
                return (
                  <button
                    key={tier.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`linduo-assignment-tier${active ? ' active' : ''}`}
                    onClick={() => setActiveTierId(tier.id)}
                  >
                    <span className="linduo-assignment-tier-name">{tier.name}</span>
                    <small className="linduo-assignment-tier-meta">
                      {tier.grantCount ?? 0} 个模型 · {tier.isSystem ? '系统' : '自定义'}
                    </small>
                  </button>
                )
              })}
            </div>
            {activeTier?.description && (
              <p className="linduo-assignment-tier-desc">{activeTier.description}</p>
            )}

            {isFullReadonly ? (
              <div className="linduo-assignment-readonly">
                <p>全部 {rightModels.length} 个已开放(随「零度API 聚合」大模型增/减而自动同步,不可手动调整)</p>
                <ul className="linduo-assignment-readonly-list">
                  {rightModels.map(m => (
                    <li key={m.id}>
                      <span className="linduo-picker-name">{m.displayName}</span>
                      {m.contextLabel && <span className="linduo-picker-ctx">{m.contextLabel}</span>}
                      <span className={`linduo-picker-vendor vendor-${m.vendor}`}>{m.vendor}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="linduo-assignment-transfer">
                <div className="linduo-assignment-col">
                  <div className="linduo-assignment-col-head">
                    <span>可选模型({leftModels.length})</span>
                    <button
                      type="button"
                      className="linduo-assignment-move-all"
                      onClick={() => moveAll('right')}
                      disabled={leftModels.length === 0}
                    >
                      全部 &raquo;
                    </button>
                  </div>
                  <ul className="linduo-assignment-list" role="listbox" aria-multiselectable="true">
                    {leftModels.map(m => {
                      const picked = pickedLeft.has(m.id)
                      return (
                        <li
                          key={m.id}
                          className={`linduo-assignment-item${picked ? ' picked' : ''}`}
                          role="option"
                          aria-selected={picked}
                          onClick={() => togglePicked('left', m.id)}
                        >
                          <input
                            type="checkbox"
                            checked={picked}
                            onChange={() => togglePicked('left', m.id)}
                            onClick={event => event.stopPropagation()}
                            aria-label={`选择 ${m.displayName}`}
                          />
                          <span className="linduo-picker-name">{m.displayName}</span>
                          {m.contextLabel && <span className="linduo-picker-ctx">{m.contextLabel}</span>}
                          <span className={`linduo-picker-vendor vendor-${m.vendor}`}>{m.vendor}</span>
                        </li>
                      )
                    })}
                    {leftModels.length === 0 && (
                      <li className="linduo-assignment-empty">全部模型已分配</li>
                    )}
                  </ul>
                </div>

                <div className="linduo-assignment-arrows">
                  <button
                    type="button"
                    onClick={moveRight}
                    disabled={pickedLeft.size === 0}
                    aria-label="添加到已分配"
                    title="添加到已分配"
                  >
                    &rarr;
                  </button>
                  <button
                    type="button"
                    onClick={moveLeft}
                    disabled={pickedRight.size === 0}
                    aria-label="从已分配移除"
                    title="从已分配移除"
                  >
                    &larr;
                  </button>
                </div>

                <div className="linduo-assignment-col">
                  <div className="linduo-assignment-col-head">
                    <span>已分配({rightModels.length})</span>
                    <button
                      type="button"
                      className="linduo-assignment-move-all"
                      onClick={() => moveAll('left')}
                      disabled={rightModels.length === 0}
                    >
                      &laquo; 全部
                    </button>
                  </div>
                  <ul className="linduo-assignment-list" role="listbox" aria-multiselectable="true">
                    {rightModels.map(m => {
                      const picked = pickedRight.has(m.id)
                      return (
                        <li
                          key={m.id}
                          className={`linduo-assignment-item${picked ? ' picked' : ''}`}
                          role="option"
                          aria-selected={picked}
                          onClick={() => togglePicked('right', m.id)}
                        >
                          <input
                            type="checkbox"
                            checked={picked}
                            onChange={() => togglePicked('right', m.id)}
                            onClick={event => event.stopPropagation()}
                            aria-label={`选择 ${m.displayName}`}
                          />
                          <span className="linduo-picker-name">{m.displayName}</span>
                          {m.contextLabel && <span className="linduo-picker-ctx">{m.contextLabel}</span>}
                          <span className={`linduo-picker-vendor vendor-${m.vendor}`}>{m.vendor}</span>
                        </li>
                      )
                    })}
                    {rightModels.length === 0 && (
                      <li className="linduo-assignment-empty">尚未分配任何模型</li>
                    )}
                  </ul>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <footer className="linduo-assignment-foot">
        <button type="button" onClick={onClose} disabled={saving}>取消</button>
        <button
          type="button"
          className="primary"
          onClick={save}
          disabled={saving || loading || activeTierId === null || isFullReadonly}
        >
          {saving ? '正在保存…' : '保存'}
        </button>
      </footer>
    </div>
  </div>
}
