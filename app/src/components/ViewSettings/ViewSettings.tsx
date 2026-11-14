import { DEFAULT_VIEW, useView, type ViewSettings as Settings } from '../../stores/view'

type AidKey = 'aidNoteNames' | 'aidIntervals' | 'aidChordShapes'
const AIDS: { key: AidKey; label: string; hint: string }[] = [
  { key: 'aidNoteNames', label: 'Nomi delle note', hint: 'Il nome sotto ogni nota (il primo aiuto da togliere)' },
  {
    key: 'aidIntervals',
    label: 'Intervalli',
    hint: 'Salti della melodia dalla terza in su: 3↑, 5↓ (le seconde non sono segnate)'
  },
  {
    key: 'aidChordShapes',
    label: 'Forme degli accordi',
    hint: 'Triade in stato fondamentale, 1° o 2° rivolto, settima'
  }
]
import { setMetronome } from '../../stores/practice'
import './ViewSettings.css'

/** Display, hands, sound and zoom options of the falling-notes view and the keyboard. */
export function ViewSettings({ onClose }: { onClose: () => void }) {
  const v = useView()
  const check = (
    key: 'showChords' | 'showNoteNames' | 'showKeyNames' | 'showNoteLines' | 'showRight' | 'showLeft',
    label: string
  ) => (
    <label className="vs-check">
      <input type="checkbox" checked={v[key]} onChange={(e) => v.set({ [key]: e.target.checked })} />
      {label}
    </label>
  )
  const slider = (key: 'volume' | 'reverb', label: string) => (
    <label className="vs-slider">
      <span>
        {label} <output>{Math.round(v[key] * 100)}%</output>
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={v[key]}
        onChange={(e) => v.set({ [key]: Number(e.target.value) })}
      />
    </label>
  )
  return (
    <div className="view-settings" role="dialog" aria-label="Impostazioni">
      <header>
        <strong>Impostazioni</strong>
        <button className="vs-close" onClick={onClose} aria-label="Chiudi">
          ✕
        </button>
      </header>
      <section>
        <h4>Opzioni</h4>
        <div className="vs-grid">
          {check('showChords', 'Accordi')}
          {check('showNoteLines', 'Linee guida')}
          {check('showKeyNames', 'Nomi dei tasti')}
          {check('showNoteNames', 'Nomi delle note')}
        </div>
      </section>
      <section>
        <h4>Mani</h4>
        <div className="vs-grid">
          <label className="vs-color">
            <input type="color" value={v.rightColor} onChange={(e) => v.set({ rightColor: e.target.value })} />
            Destra <code>{v.rightColor}</code>
          </label>
          <label className="vs-color">
            <input type="color" value={v.leftColor} onChange={(e) => v.set({ leftColor: e.target.value })} />
            Sinistra <code>{v.leftColor}</code>
          </label>
          {check('showRight', 'Mostra mano destra')}
          {check('showLeft', 'Mostra mano sinistra')}
        </div>
      </section>
      <section>
        <h4>Lettura a prima vista</h4>
        <div className="vs-grid">
          <label className="vs-check" title="Una battuta di clic prima che parta la modalità «A tempo»">
            <input type="checkbox" checked={v.countIn} onChange={(e) => v.set({ countIn: e.target.checked })} />
            Conteggio iniziale
          </label>
          <label className="vs-check" title="Clic a ogni movimento, in ogni modalità (anche dal pulsante in basso)">
            <input type="checkbox" checked={v.metronome} onChange={(e) => void setMetronome(e.target.checked)} />
            Metronomo
          </label>
        </div>
        <label className="vs-row">
          <span>Tolleranza «A tempo»</span>
          <select value={v.tolerance} onChange={(e) => v.set({ tolerance: e.target.value as Settings['tolerance'] })}>
            <option value="strict">Stretta (±80 ms)</option>
            <option value="normal">Normale (±130 ms)</option>
            <option value="loose">Larga (±200 ms)</option>
          </select>
        </label>
        <label className="vs-row" title="Copre quello che stai suonando: gli occhi devono stare avanti">
          <span>Lettura anticipata</span>
          <select value={v.lookahead} onChange={(e) => v.set({ lookahead: e.target.value as Settings['lookahead'] })}>
            <option value="off">Spenta</option>
            <option value="current">Copri la battuta che suoni</option>
            <option value="next">Copri anche la successiva</option>
          </select>
        </label>
        <div className="vs-aids">
          <span>Aiuti in partitura</span>
          <span className="vs-presets">
            <button onClick={() => v.set({ aidNoteNames: true, aidIntervals: true, aidChordShapes: true })}>
              Tutti
            </button>
            <button onClick={() => v.set({ aidNoteNames: false, aidIntervals: true, aidChordShapes: true })}>
              Senza nomi
            </button>
            <button onClick={() => v.set({ aidNoteNames: false, aidIntervals: false, aidChordShapes: false })}>
              Nessuno
            </button>
          </span>
        </div>
        <div className="vs-grid">
          {AIDS.map((a) => (
            <label key={a.key} className="vs-check" title={a.hint}>
              <input type="checkbox" checked={v[a.key]} onChange={(e) => v.set({ [a.key]: e.target.checked })} />
              {a.label}
            </label>
          ))}
        </div>
      </section>
      <section>
        <h4>Suono</h4>
        {slider('volume', 'Volume')}
        {slider('reverb', 'Riverbero')}
      </section>
      <section>
        <h4>Vista</h4>
        <label className="vs-slider">
          <span>
            Zoom <output>{v.pixelsPerSecond} px/s</output>
          </span>
          <input
            type="range"
            min={60}
            max={420}
            step={10}
            value={v.pixelsPerSecond}
            onChange={(e) => v.set({ pixelsPerSecond: Number(e.target.value) })}
          />
        </label>
      </section>
      <footer>
        <button
          onClick={() => v.set({ ...DEFAULT_VIEW, mode: v.mode, transpose: v.transpose, metronome: v.metronome })}
        >
          Ripristina predefiniti
        </button>
      </footer>
    </div>
  )
}
