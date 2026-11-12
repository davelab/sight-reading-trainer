import { useEffect, useRef, useState } from 'react'
import { cancelImport, runTranscription, useOmr } from '../../stores/omr'
import { EMPTY_FORM, KEY_OPTIONS, TAP_RESET_MS, tapTempo, toHints, type HintForm } from './hints'
import './TranscribeSetup.css'

/**
 * Before transcribing: what the user already knows about the piece (all optional).
 * Each answer narrows what the transcription has to guess.
 */
export function TranscribeSetup() {
  const { phase, fileName } = useOmr()
  const [form, setForm] = useState<HintForm>(EMPTY_FORM)
  const taps = useRef<number[]>([])
  const first = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (phase !== 'setup') return
    first.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void cancelImport()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase])

  if (phase !== 'setup') return null
  const set = (patch: Partial<HintForm>) => setForm((f) => ({ ...f, ...patch }))
  const tap = () => {
    const now = performance.now()
    if (taps.current.length && now - taps.current[taps.current.length - 1] > TAP_RESET_MS) taps.current = []
    taps.current.push(now)
    const bpm = tapTempo(taps.current)
    if (bpm) set({ tempo: String(bpm) })
  }

  return (
    <div className="tx-backdrop">
      <form
        className="tx-setup"
        role="dialog"
        aria-labelledby="tx-setup-title"
        onSubmit={(e) => {
          e.preventDefault()
          void runTranscription(toHints(form))
        }}
      >
        <h2 id="tx-setup-title">Trascrivi «{fileName}»</h2>
        <p className="tx-help">
          {/\.(mid|midi|kar)$/i.test(fileName ?? '')
            ? 'Un MIDI esportato da un programma di notazione ha già tempo, metro e tonalità: lascia tutto su «automatico». Per un MIDI suonato dal piano digitale, quello che sai aiuta come per l\u2019audio.'
            : 'Se sai già qualcosa del brano, indicalo: la trascrizione sbaglia meno. Lascia «automatico» dove non sei sicuro.'}
        </p>
        <label>
          <span>Tempo (♩ al minuto)</span>
          <span className="tx-tempo">
            <input
              ref={first}
              inputMode="decimal"
              placeholder="automatico"
              value={form.tempo}
              onChange={(e) => set({ tempo: e.target.value })}
            />
            <button type="button" onClick={tap} title="Batti a tempo almeno 3 volte">
              Batti il tempo
            </button>
          </span>
          <small>Basta un valore approssimativo: serve a non confondere il battito con la sua metà o il doppio.</small>
        </label>
        <label>
          <span>Metro</span>
          <select value={form.meter} onChange={(e) => set({ meter: e.target.value as HintForm['meter'] })}>
            <option value="">automatico</option>
            <option value="2">2/4</option>
            <option value="3">3/4</option>
            <option value="4">4/4</option>
          </select>
        </label>
        <label>
          <span>Tonalità</span>
          <select value={form.key} onChange={(e) => set({ key: e.target.value })}>
            <option value="">automatica</option>
            {KEY_OPTIONS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Inizia in levare</span>
          <select value={form.pickup} onChange={(e) => set({ pickup: e.target.value as HintForm['pickup'] })}>
            <option value="">automatico</option>
            <option value="0">no, sul primo tempo</option>
            <option value="1">sì, 1 movimento prima</option>
            <option value="2">sì, 2 movimenti prima</option>
            <option value="3">sì, 3 movimenti prima</option>
          </select>
        </label>
        <div className="tx-actions">
          <button type="button" onClick={() => void cancelImport()}>
            Annulla
          </button>
          <button type="submit" className="primary">
            Trascrivi
          </button>
        </div>
      </form>
    </div>
  )
}
