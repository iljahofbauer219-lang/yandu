import { forwardRef, useEffect, useId, useRef } from 'react'
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { createPortal } from 'react-dom'

type ButtonVariant = 'primary' | 'secondary' | 'danger'

export function Button({ variant = 'secondary', loading = false, className = '', children, disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean }) {
  return <button {...props} disabled={disabled || loading} aria-busy={loading || undefined} className={`yd-button yd-button--${variant} ${className}`.trim()}>{loading && <span className="yd-spinner" aria-hidden="true" />}{children}</button>
}

export function StatusBadge({ tone, children, className = '', ...props }: HTMLAttributes<HTMLSpanElement> & { tone: 'success' | 'warning' | 'danger' | 'info'; children: ReactNode }) {
  return <span {...props} className={`yd-status yd-status--${tone} ${className}`.trim()}>{children}</span>
}

export function Notice({ tone = 'info', children, className = '', ...props }: HTMLAttributes<HTMLDivElement> & { tone?: 'danger' | 'success' | 'warning' | 'info'; children: ReactNode }) {
  return <div {...props} className={`yd-notice yd-notice--${tone} ${className}`.trim()}>{children}</div>
}

export function Card({ className = '', ...props }: HTMLAttributes<HTMLElement>) {
  return <section {...props} className={`yd-card ${className}`.trim()} />
}

export const Field = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string; trailing?: ReactNode }>(function Field({ label, hint, error, trailing, className = '', id, required, ...props }, ref) {
  const generatedId = useId()
  const inputId = id || generatedId
  const hintId = hint ? `${inputId}-hint` : undefined
  const errorId = error ? `${inputId}-error` : undefined
  const describedBy = [props['aria-describedby'], hintId, errorId].filter(Boolean).join(' ') || undefined
  const input = <input {...props} ref={ref} id={inputId} required={required} aria-invalid={error ? true : undefined} aria-describedby={describedBy} />
  return <label className={`yd-field ${error ? 'yd-field--error' : ''} ${className}`.trim()} htmlFor={inputId}>
    <span className="yd-field__label">{label}{required && <em aria-hidden="true"> *</em>}</span>
    {trailing ? <span className="yd-field__control">{input}{trailing}</span> : input}
    {hint && <small id={hintId} className="yd-field__hint">{hint}</small>}
    {error && <small id={errorId} className="yd-field__error">{error}</small>}
  </label>
})

export function LoadingState({ label = '正在加载…', className = '' }: { label?: string; className?: string }) {
  return <div className={`yd-loading ${className}`.trim()} role="status" aria-live="polite"><span className="yd-spinner" aria-hidden="true" />{label}</div>
}

export function EmptyState({ title, description, action, className = '' }: { title: string; description?: string; action?: ReactNode; className?: string }) {
  return <div className={`yd-empty ${className}`.trim()}><b>{title}</b>{description && <p>{description}</p>}{action && <div>{action}</div>}</div>
}

export function Modal({ open, title, description, onClose, children, footer }: { open: boolean; title: string; description?: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const panelRef = useRef<HTMLElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()
  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onClose(); return }
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')]
      if (!focusable.length) { event.preventDefault(); panelRef.current.focus(); return }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown); previousFocusRef.current?.focus() }
  }, [open, onClose])
  if (!open) return null
  return createPortal(<div className="yd-modal-backdrop" onMouseDown={event => { if (event.currentTarget === event.target) onClose() }}>
    <section ref={panelRef} className="yd-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} tabIndex={-1}>
      <header><div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div><Button type="button" aria-label="关闭对话框" onClick={onClose}>×</Button></header>
      <div className="yd-modal__body">{children}</div>
      {footer && <footer>{footer}</footer>}
    </section>
  </div>, document.body)
}
