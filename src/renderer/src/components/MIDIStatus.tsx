import type { MIDIState } from '../hooks/useMIDI'

interface MIDIStatusProps {
  midiState: MIDIState
}

export function MIDIStatus({ midiState }: MIDIStatusProps) {
  const { isSupported, isConnected, devices, error } = midiState

  if (!isSupported) {
    return (
      <div className="midi-status midi-status--unsupported">
        <span className="midi-dot" />
        <span>Web MIDI not supported in this environment</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="midi-status midi-status--error">
        <span className="midi-dot midi-dot--error" />
        <span>MIDI error: {error}</span>
      </div>
    )
  }

  if (!isConnected) {
    return (
      <div className="midi-status midi-status--disconnected">
        <span className="midi-dot midi-dot--disconnected" />
        <span>No MIDI device connected</span>
      </div>
    )
  }

  return (
    <div className="midi-status midi-status--connected">
      <span className="midi-dot midi-dot--connected" />
      <span>
        {devices.length === 1
          ? devices[0].name
          : `${devices.length} MIDI devices connected`}
      </span>
    </div>
  )
}
