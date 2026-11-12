import { useState } from 'react'
import { inTauri, ipc, type Hands } from '../../lib/ipc'
import { useView } from '../../stores/view'
import { ViewSettings } from '../ViewSettings'
import { useScore } from '../../stores/score'
import { useTransport } from '../../stores/transport'
import './Transport.css'

const TEMPO_MIN = 25
const TEMPO_MAX = 200

export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

const HANDS: { value: Hands; label: string }[] = [
  { value: 'both', label: 'Entrambe' },
  { value: 'right', label: 'Destra' },
  { value: 'left', label: 'Sinistra' }
]

/** Play/pause, tempo 25–200 %, loop A–B and hand selection. */
export function Transport() {
  const hasScore = useScore((s) => s.events.length > 0)
  const t = useTransport()
  const enabled = hasScore && inTauri
  const duration = t.info?.durationMs ?? 0
  const transpose = useView((s) => s.transpose)
  const setView = useView((s) => s.set)
  const [settings, setSettings] = useState(false)
  const [scrub, setScrub] = useState<number | null>(null)

  const togglePlay = () => void (t.playing ? ipc.pause() : ipc.play())

  const setTempo = (percent: number) => {
    t.set({ tempoPercent: percent })
    if (inTauri) void ipc.setTempo(percent)
  }

  const markLoop = () => {
    if (t.pendingLoopStart === null) {
      t.set({ pendingLoopStart: t.positionMs })
      return
    }
    const [startMs, endMs] = [t.pendingLoopStart, t.positionMs].sort((a, b) => a - b)
    const loop = endMs - startMs > 100 ? { startMs, endMs } : null
    t.set({ loop, pendingLoopStart: null })
    void ipc.setLoop(loop)
  }

  const clearLoop = () => {
    t.set({ loop: null, pendingLoopStart: null })
    void ipc.setLoop(null)
  }

  const setHands = (hands: Hands) => {
    t.set({ hands })
    if (inTauri) void ipc.setHands(hands)
  }

  return (
    <footer className="transport">
      <input
        className="seek"
        type="range"
        min={0}
        max={Math.max(1, duration)}
        step={10}
        value={scrub ?? t.positionMs}
        disabled={!enabled}
        aria-label="Posizione"
        onChange={(e) => {
          const ms = Number(e.target.value)
          setScrub(ms)
          void ipc.seek(ms)
        }}
        onPointerUp={() => setScrub(null)}
        onKeyUp={() => setScrub(null)}
      />
      <div className="transport-group">
        <button disabled={!enabled} onClick={() => void ipc.seek(t.loop?.startMs ?? 0)} title="Torna all'inizio">
          ⏮
        </button>
        <button className="play" disabled={!enabled} onClick={togglePlay} title="Play/pausa (spazio)">
          {t.playing ? '⏸' : '▶'}
        </button>
        <span className="time">
          {formatTime(t.positionMs)} / {formatTime(duration)}
        </span>
      </div>

      <label className="transport-group tempo">
        Tempo
        <input
          type="range"
          min={TEMPO_MIN}
          max={TEMPO_MAX}
          step={5}
          value={t.tempoPercent}
          disabled={!hasScore}
          onChange={(e) => setTempo(Number(e.target.value))}
        />
        <output>{t.tempoPercent}%</output>
      </label>

      <div className="transport-group">
        <button disabled={!enabled} onClick={markLoop} className={t.pendingLoopStart !== null ? 'armed' : ''}>
          {t.pendingLoopStart === null ? 'A' : 'B'}
        </button>
        <span className="loop-label">
          {t.loop
            ? `Loop ${formatTime(t.loop.startMs)}–${formatTime(t.loop.endMs)}`
            : t.pendingLoopStart !== null
              ? `A = ${formatTime(t.pendingLoopStart)}, ora B`
              : 'Loop A–B'}
        </span>
        {(t.loop || t.pendingLoopStart !== null) && (
          <button disabled={!enabled} onClick={clearLoop} title="Togli il loop">
            ✕
          </button>
        )}
      </div>

      <div className="transport-group segmented" role="group" aria-label="Mani">
        {HANDS.map((h) => (
          <button
            key={h.value}
            disabled={!hasScore}
            className={t.hands === h.value ? 'selected' : ''}
            onClick={() => setHands(h.value)}
          >
            {h.value !== 'left' && <i className="hand-dot right" />}
            {h.value !== 'right' && <i className="hand-dot left" />}
            {h.label}
          </button>
        ))}
      </div>

      <div className="transport-group" aria-label="Trasposizione">
        <button
          disabled={!hasScore || transpose <= -12}
          onClick={() => setView({ transpose: transpose - 1 })}
          title="Trasponi giù di un semitono"
        >
          −
        </button>
        <span className="transpose" title="Trasposizione in semitoni">
          {transpose > 0 ? `+${transpose}` : transpose} st
        </span>
        <button
          disabled={!hasScore || transpose >= 12}
          onClick={() => setView({ transpose: transpose + 1 })}
          title="Trasponi su di un semitono"
        >
          +
        </button>
      </div>

      <button className="gear" onClick={() => setSettings(!settings)} title="Impostazioni" aria-expanded={settings}>
        ⚙︎
      </button>
      {settings && <ViewSettings onClose={() => setSettings(false)} />}

      <span className="synth-status">
        {!inTauri
          ? "Playback disponibile nell'app desktop"
          : t.info?.synth === 'soundfont'
            ? `SoundFont: ${t.info.soundfontName ?? ''}`
            : t.info?.synth === 'fallback'
              ? 'Synth di riserva (nessun SoundFont in resources/)'
              : t.info?.synth === 'none'
                ? 'Nessuna uscita audio'
                : ''}
      </span>
    </footer>
  )
}
