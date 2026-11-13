import { closeTab, switchTo, useDocuments } from '../../stores/documents'
import './TabBar.css'

/** One tab per open score; a dot marks unsaved changes. */
export function TabBar({ onOpen }: { onOpen: () => void }) {
  const { docs, activeId, switching } = useDocuments()
  if (docs.length === 0) return null
  return (
    <nav className="tab-bar" role="tablist" aria-label="Spartiti aperti">
      {docs.map((d) => (
        <div
          key={d.id}
          role="tab"
          aria-selected={d.id === activeId}
          className={`tab${d.id === activeId ? ' active' : ''}`}
          title={d.unsaved ? `${d.title} — modifiche non salvate` : d.title}
          onClick={() => !switching && void switchTo(d.id)}
          onAuxClick={(e) => e.button === 1 && void closeTab(d.id)}
        >
          <span className="tab-title">{d.title}</span>
          {d.unsaved && <span className="tab-dot" aria-label="non salvato" />}
          <button
            className="tab-close"
            aria-label={`Chiudi ${d.title}`}
            onClick={(e) => {
              e.stopPropagation()
              void closeTab(d.id)
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button className="tab-new" onClick={onOpen} title="Apri un altro spartito (⌘O)" aria-label="Apri">
        +
      </button>
    </nav>
  )
}
