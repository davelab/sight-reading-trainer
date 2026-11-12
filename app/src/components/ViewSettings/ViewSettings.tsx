import { DEFAULT_VIEW, useView } from '../../stores/view'
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
        <button onClick={() => v.set({ ...DEFAULT_VIEW, mode: v.mode, transpose: v.transpose })}>
          Ripristina predefiniti
        </button>
      </footer>
    </div>
  )
}
