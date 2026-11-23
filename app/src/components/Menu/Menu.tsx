import { useEffect, useRef, useState, type ReactNode } from 'react'
import './Menu.css'

export interface MenuItem {
  label: string
  /** Shown on the right, e.g. "⌘O". */
  shortcut?: string
  hint?: string
  disabled?: boolean
  /** Draw attention to it (e.g. unsaved changes). */
  highlight?: boolean
  onSelect: () => void
}

/** `null` draws a separator. */
export type MenuEntry = MenuItem | null

/** A toolbar button opening a list of actions (closes on choice, Escape or a click outside). */
export function Menu({ label, items, badge }: { label: ReactNode; items: MenuEntry[]; badge?: boolean }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next = e.key === 'ArrowDown' ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length
        buttons[next]?.focus()
      }
    }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', key)
    list.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  return (
    <div className="menu" ref={root}>
      <button
        className={`menu-button${open ? ' open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {label}
        {badge && <span className="menu-badge" aria-label="modifiche non salvate" />}
        <span className="menu-caret">▾</span>
      </button>
      {open && (
        <div className="menu-list" role="menu" ref={list}>
          {items.map((item, i) =>
            item === null ? (
              <hr key={`sep-${i}`} />
            ) : (
              <button
                key={item.label}
                role="menuitem"
                disabled={item.disabled}
                className={item.highlight ? 'highlight' : ''}
                title={item.hint}
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
              >
                <span>{item.label}</span>
                {item.shortcut && <kbd>{item.shortcut}</kbd>}
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}
