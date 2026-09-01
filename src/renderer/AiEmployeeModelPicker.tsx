import { useEffect, useRef, useState } from 'react'
import type { AiEmployeeChatModelProfile } from '../shared/aiEmployee'

type AiEmployeeModelPickerProps = {
  models: AiEmployeeChatModelProfile[]
  selectedId: string
  onSelect: (id: string) => void
}

const DEFAULT_MODEL_ID = 'amazon-skills'

// AI员工对话大模型选择器：向上弹出的 role=menu 菜单，Escape / 点击外部关闭
export default function AiEmployeeModelPicker({ models, selectedId, onSelect }: AiEmployeeModelPickerProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = models.find(item => item.id === selectedId)
  const customized = !!selected && selectedId !== DEFAULT_MODEL_ID
  const isEmpty = models.length === 0

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onMouseDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onMouseDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [open])

  return (
    <div className="ai-employee-model-picker" ref={rootRef}>
      {open && (
        <div className="ai-employee-model-menu" role="menu" aria-label="选择大模型">
          {isEmpty && <span className="ai-employee-model-menu-empty">该岗位模型未配置</span>}
          {models.map(model => (
            <button
              key={model.id}
              type="button"
              role="menuitemradio"
              aria-checked={model.id === selectedId}
              disabled={!model.available}
              onClick={() => { onSelect(model.id); setOpen(false) }}
            >
              <b>{model.name}</b>
              <small>{model.available ? model.hint : `未配置 · ${model.hint}`}</small>
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className={`ai-employee-model-trigger${customized ? ' custom' : ''}${isEmpty ? ' empty' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-disabled={isEmpty}
        disabled={isEmpty}
        title={isEmpty ? '该岗位模型未配置' : '选择大模型'}
        onClick={isEmpty ? undefined : () => setOpen(current => !current)}
      >
        {isEmpty ? '模型未配置' : (selected?.name || '选择模型')} ▾
      </button>
    </div>
  )
}
