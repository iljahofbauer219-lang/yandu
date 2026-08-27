import { useEffect, useMemo, useState } from 'react'
import {
  fetchAllLinduoChatModels,
  revokeLinduoException,
  setLinduoException
} from './serverApi'
import type { LinduoChatModelView, LinduoMemberTierView } from '../shared/contracts'
import './linduoModelPickerModal.css'

interface Props {
  onClose: () => void
  onSaved?: () => void
  /** 已拉好的 member tier + exceptions 视图(父组件决定怎么拉,普通用户走 /me 端点,admin 走 /members/:id 端点) */
  member: LinduoMemberTierView
  /** 全 enabled 模型列表(父组件传进来,只拉一次) */
  allModels: LinduoChatModelView[]
  /** targetUserId:普通用户改自己 = 自己的 id;admin 改员工 = 员工 id */
  targetUserId: string
}

/** R-2: 单个例外编辑(GRANT 加 / REVOKE 加 / 删除) */
interface ExceptionEdit {
  modelId: string
  kind: 'GRANT' | 'REVOKE'
}

/**
 * Linduo 例外穿梭 modal(M1/R-2)。
 *
 * 触发:
 *   - LinduoPreferenceModal 「修改我的特例」按钮(普通用户改自己)
 *   - SystemAdmin 成员行「Linduo 例外」按钮(admin 帮员工改)
 *
 * 行为:
 *   - 双栏穿梭:左(未做例外的 enabled 模型)/ 右(当前例外,带 GRANT/REVOKE 切换)
 *   - 加例外:从左移到右(默认 GRANT,可点切换为 REVOKE)
 *   - 删例外:从右移到左
 *   - 保存:diff 现有 vs 新,差异部分 setLinduoException / revokeLinduoException
 */
export function LinduoExceptionModal({ onClose, onSaved, member, allModels, targetUserId }: Props) {
  const tierName = member.tier?.name ?? '未分配'
  const tierDesc = member.tier?.description ?? null

  // 现有例外(从 member.exceptions 来)
  const initial = useMemo<ExceptionEdit[]>(
    () => member.exceptions.map(e => ({ modelId: e.modelId, kind: e.kind as 'GRANT' | 'REVOKE' })),
    [member]
  )
  const [exceptions, setExceptions] = useState<ExceptionEdit[]>(initial)

  const [pickedLeft, setPickedLeft] = useState<Set<string>>(new Set())
  const [pickedRight, setPickedRight] = useState<Set<string>>(new Set())

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  // diff helper
  const currentIds = useMemo(() => new Set(exceptions.map(e => e.modelId)), [exceptions])
  const initialIds = useMemo(() => new Set(initial.map(e => e.modelId)), [initial])

  const leftModels = useMemo(
    () => allModels.filter(m => !currentIds.has(m.id)),
    [allModels, currentIds]
  )
  const rightModels = useMemo(
    () => allModels.filter(m => currentIds.has(m.id)),
    [allModels, currentIds]
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
    setExceptions(prev => [
      ...prev,
      ...[...pickedLeft].map(modelId => ({ modelId, kind: 'GRANT' as const }))
    ])
    setPickedLeft(new Set())
  }
  function moveLeft() {
    if (pickedRight.size === 0) return
    const ids = pickedRight
    setExceptions(prev => prev.filter(e => !ids.has(e.modelId)))
    setPickedRight(new Set())
  }
  function moveAll(direction: 'right' | 'left') {
    if (direction === 'right') {
      const newOnes = leftModels.map(m => ({ modelId: m.id, kind: 'GRANT' as const }))
      setExceptions(prev => [...prev, ...newOnes])
    } else {
      const rightIds = new Set(rightModels.map(m => m.id))
      setExceptions(prev => prev.filter(e => !rightIds.has(e.modelId)))
    }
    setPickedLeft(new Set())
    setPickedRight(new Set())
  }

  function toggleKind(modelId: string) {
    setExceptions(prev => prev.map(e => e.modelId === modelId
      ? { ...e, kind: e.kind === 'GRANT' ? 'REVOKE' : 'GRANT' }
      : e))
  }

  async function save() {
    setSaving(true)
    setError(null)
    setInfo(null)
    try {
      // diff:新增的 + 改 kind 的 + 删除的
      const toAdd: ExceptionEdit[] = []
      const toUpdate: ExceptionEdit[] = []
      for (const cur of exceptions) {
        const orig = initial.find(e => e.modelId === cur.modelId)
        if (!orig) toAdd.push(cur)
        else if (orig.kind !== cur.kind) toUpdate.push(cur)
      }
      const toDelete: string[] = []
      for (const orig of initial) {
        if (!currentIds.has(orig.modelId)) toDelete.push(orig.modelId)
      }
      for (const e of [...toAdd, ...toUpdate]) {
        await setLinduoException(targetUserId, e.modelId, e.kind)
      }
      for (const modelId of toDelete) {
        await revokeLinduoException(targetUserId, modelId)
      }
      setInfo(`已保存 ${exceptions.length} 个例外`)
      onSaved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  // 是否有未保存的变更
  const dirty = useMemo(() => {
    if (exceptions.length !== initial.length) return true
    for (const cur of exceptions) {
      const orig = initial.find(e => e.modelId === cur.modelId)
      if (!orig || orig.kind !== cur.kind) return true
    }
    return false
  }, [exceptions, initial])

  return <div className="settings-backdrop linduo-picker-backdrop" role="dialog" aria-modal="true">
    <div className="linduo-picker-card linduo-assignment-card">
      <header className="linduo-picker-head">
        <div>
          <h2>{member.memberName} 的 Linduo 特例</h2>
          <small>
            基础等级:{tierName}
            {tierDesc ? ` · ${tierDesc}` : ''}
            {' '}· 这里可以额外开/关模型(优先级高于等级)
          </small>
        </div>
        <button type="button" className="linduo-picker-close" onClick={onClose} aria-label="关闭">✕</button>
      </header>
      <div className="linduo-picker-body linduo-assignment-body">
        {error && <div className="linduo-picker-error" role="status">{error}</div>}
        {info && <div className="linduo-picker-info" role="status">{info}</div>}

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
                <li className="linduo-assignment-empty">全部模型都已做特例</li>
              )}
            </ul>
          </div>

          <div className="linduo-assignment-arrows">
            <button
              type="button"
              onClick={moveRight}
              disabled={pickedLeft.size === 0}
              aria-label="添加为例外(GRANT)"
              title="添加为例外(GRANT)"
            >
              &rarr;
            </button>
            <button
              type="button"
              onClick={moveLeft}
              disabled={pickedRight.size === 0}
              aria-label="删除例外"
              title="删除例外"
            >
              &larr;
            </button>
          </div>

          <div className="linduo-assignment-col">
            <div className="linduo-assignment-col-head">
              <span>当前例外({rightModels.length})</span>
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
                const exc = exceptions.find(e => e.modelId === m.id)
                const kind = exc?.kind ?? 'GRANT'
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
                    <button
                      type="button"
                      className={`linduo-exception-kind kind-${kind.toLowerCase()}`}
                      onClick={event => { event.stopPropagation(); toggleKind(m.id) }}
                      title={kind === 'GRANT' ? 'GRANT(额外开) — 点击切换为 REVOKE' : 'REVOKE(额外关) — 点击切换为 GRANT'}
                    >
                      {kind === 'GRANT' ? '✓ GRANT' : '✕ REVOKE'}
                    </button>
                  </li>
                )
              })}
              {rightModels.length === 0 && (
                <li className="linduo-assignment-empty">尚未设置任何例外</li>
              )}
            </ul>
          </div>
        </div>
      </div>
      <footer className="linduo-assignment-foot">
        <button type="button" onClick={onClose} disabled={saving}>取消</button>
        <button
          type="button"
          className="primary"
          onClick={save}
          disabled={saving || !dirty}
        >
          {saving ? '正在保存…' : '保存'}
        </button>
      </footer>
    </div>
  </div>
}
