import { useEffect, useState, type ReactNode } from 'react'
import type { Tag } from '../core/types'
import { useStore } from './store'

export function Modal({
  title,
  children,
  onClose,
  wide = false,
  footer,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
  footer?: ReactNode
}) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className={`modal ${wide ? 'modal-wide' : ''}`}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  )
}

export function PromptDialog({
  title,
  label,
  defaultValue = '',
  placeholder,
  confirmText = '确定',
  onSubmit,
  onClose,
}: {
  title: string
  label: string
  defaultValue?: string
  placeholder?: string
  confirmText?: string
  onSubmit: (value: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(defaultValue)
  const submit = () => {
    const trimmed = value.trim()
    if (!trimmed) return
    onSubmit(trimmed)
  }
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <div className="row gap">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={submit} disabled={!value.trim()}>
            {confirmText}
          </button>
        </div>
      }
    >
      <label className="field">
        <span>{label}</span>
        <input
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
        />
      </label>
    </Modal>
  )
}

export function WindowControls() {
  const api = window.desktop
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!api) return
    void api.windowIsMaximized().then(setMaximized)
  }, [api])

  if (!api) return null

  return (
    <div className="window-controls">
      <button
        type="button"
        onClick={() => void api.windowMinimize()}
        title="最小化"
        aria-label="最小化"
      >
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
          <path d="M1 6h10" />
        </svg>
      </button>
      <button
        type="button"
        onClick={async () => {
          setMaximized(await api.windowToggleMaximize())
        }}
        title={maximized ? '还原' : '最大化'}
        aria-label={maximized ? '还原' : '最大化'}
      >
        {maximized ? (
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="1.5" y="3.5" width="7" height="7" />
            <path d="M4 3.5V1.5h6.5V8H8.5" />
          </svg>
        ) : (
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="1.5" y="1.5" width="9" height="9" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="close"
        onClick={() => void api.windowClose()}
        title="关闭"
        aria-label="关闭"
      >
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
          <path d="M2 2l8 8M10 2l-8 8" />
        </svg>
      </button>
    </div>
  )
}

export function Toast() {
  const { toast } = useStore()
  if (!toast) return null
  return (
    <div className="toast" role="status">
      {toast}
    </div>
  )
}

export function TagChip({
  tag,
  color,
  onRemove,
  onClick,
  active,
}: {
  tag: Tag
  color: string
  onRemove?: () => void
  onClick?: () => void
  active?: boolean
}) {
  const isWhite = color.toLowerCase() === '#ffffff'
  return (
    <span
      className={`tag-chip ${active ? 'active' : ''} ${onClick ? 'clickable' : ''}`}
      style={{
        background: isWhite ? '#FFFFFF' : `${color}22`,
        borderColor: isWhite ? '#CBD5E1' : `${color}66`,
        color: isWhite ? '#475569' : color,
      }}
      onClick={onClick}
    >
      {tag.name}
      {onRemove ? (
        <button
          className="tag-remove"
          onClick={(event) => {
            event.stopPropagation()
            onRemove()
          }}
          aria-label="移除标签"
        >
          ×
        </button>
      ) : null}
    </span>
  )
}

const ICONS = [
  '🎲',
  '🍜',
  '🍕',
  '🍱',
  '☕',
  '🍺',
  '🎬',
  '📚',
  '🏠',
  '🚗',
  '✈️',
  '🎵',
  '🎮',
  '💼',
  '🎁',
  '❤️',
  '⭐',
  '🔥',
  '🌱',
  '🏃',
  '🧩',
  '🛒',
  '💡',
  '🗺️',
]

export function IconPicker({
  value,
  onChange,
  onClose,
}: {
  value: string
  onChange: (icon: string) => void
  onClose: () => void
}) {
  return (
    <Modal title="选择图标" onClose={onClose}>
      <div className="icon-grid">
        {ICONS.map((icon) => (
          <button
            key={icon}
            className={`icon-cell ${value === icon ? 'selected' : ''}`}
            onClick={() => {
              onChange(icon)
              onClose()
            }}
          >
            {icon}
          </button>
        ))}
      </div>
    </Modal>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: string
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  )
}

export function Section({
  title,
  description,
  children,
  actions,
}: {
  title: string
  description?: string
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <section className="section">
      <div className="section-head">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="section-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}
