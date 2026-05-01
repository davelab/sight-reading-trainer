import type { Clef, PracticeState } from '../types'

interface ControlsProps {
  clef: Clef
  bpm: number
  numMeasures: number
  practiceState: PracticeState
  midiConnected: boolean
  onClefChange: (clef: Clef) => void
  onBpmChange: (bpm: number) => void
  onMeasuresChange: (n: number) => void
  onNewMelody: () => void
  onPlayReference: () => void
  onStartPractice: () => void
  onStopPractice: () => void
}

export function Controls({
  clef,
  bpm,
  numMeasures,
  practiceState,
  midiConnected,
  onClefChange,
  onBpmChange,
  onMeasuresChange,
  onNewMelody,
  onPlayReference,
  onStartPractice,
  onStopPractice,
}: ControlsProps) {
  const isActive = practiceState === 'listening' || practiceState === 'countdown' || practiceState === 'practicing'
  const canStart = practiceState === 'idle' || practiceState === 'finished'

  return (
    <div className="controls">
      <div className="controls-row settings-row">
        <div className="control-group">
          <label htmlFor="clef-select">Clef</label>
          <div className="segmented">
            <button
              className={clef === 'treble' ? 'active' : ''}
              onClick={() => onClefChange('treble')}
              disabled={isActive}
            >
              Treble
            </button>
            <button
              className={clef === 'bass' ? 'active' : ''}
              onClick={() => onClefChange('bass')}
              disabled={isActive}
            >
              Bass
            </button>
          </div>
        </div>

        <div className="control-group">
          <label htmlFor="bpm-slider">Tempo: ♩ = {bpm}</label>
          <input
            id="bpm-slider"
            type="range"
            min={40}
            max={160}
            step={5}
            value={bpm}
            onChange={e => onBpmChange(Number(e.target.value))}
            disabled={isActive}
            className="bpm-slider"
          />
          <div className="bpm-labels">
            <span>40</span>
            <span>160</span>
          </div>
        </div>

        <div className="control-group">
          <label>Measures</label>
          <div className="segmented">
            {[1, 2, 4].map(n => (
              <button
                key={n}
                className={numMeasures === n ? 'active' : ''}
                onClick={() => onMeasuresChange(n)}
                disabled={isActive}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="controls-row actions-row">
        <button
          className="btn btn-secondary"
          onClick={onNewMelody}
          disabled={isActive}
        >
          <span className="btn-icon">↻</span> New Melody
        </button>

        <button
          className="btn btn-secondary"
          onClick={onPlayReference}
          disabled={isActive}
        >
          <span className="btn-icon">▶</span> Play Reference
        </button>

        {canStart ? (
          <button
            className="btn btn-primary"
            onClick={onStartPractice}
            disabled={!midiConnected}
            title={!midiConnected ? 'Connect a MIDI keyboard to practice' : ''}
          >
            <span className="btn-icon">🎹</span> Start Practice
          </button>
        ) : (
          <button
            className="btn btn-danger"
            onClick={onStopPractice}
          >
            <span className="btn-icon">■</span> Stop
          </button>
        )}
      </div>

      {!midiConnected && canStart && (
        <p className="midi-hint">Connect a MIDI keyboard to enable practice mode</p>
      )}
    </div>
  )
}
