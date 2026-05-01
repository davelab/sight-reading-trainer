import { useState, useEffect, useRef, useCallback } from 'react'

export interface MIDIDevice {
  id: string
  name: string
}

export interface MIDINoteEvent {
  midi: number
  velocity: number
  timestamp: number
}

export interface MIDIState {
  isSupported: boolean
  isConnected: boolean
  devices: MIDIDevice[]
  error: string | null
}

type NoteOnCallback = (event: MIDINoteEvent) => void

export function useMIDI(onNoteOn: NoteOnCallback) {
  const [state, setState] = useState<MIDIState>({
    isSupported: typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator,
    isConnected: false,
    devices: [],
    error: null,
  })

  const midiAccessRef = useRef<MIDIAccess | null>(null)
  const callbackRef = useRef<NoteOnCallback>(onNoteOn)
  callbackRef.current = onNoteOn

  const handleMIDIMessage = useCallback((event: MIDIMessageEvent) => {
    if (!event.data || event.data.length < 3) return
    const [status, note, velocity] = Array.from(event.data)
    const isNoteOn = (status & 0xf0) === 0x90 && velocity > 0
    if (isNoteOn) {
      callbackRef.current({ midi: note, velocity, timestamp: performance.now() })
    }
  }, [])

  const refreshDevices = useCallback((access: MIDIAccess) => {
    const inputs = Array.from(access.inputs.values())
    const devices: MIDIDevice[] = inputs.map(input => ({
      id: input.id,
      name: input.name ?? `MIDI Device ${input.id}`,
    }))

    // Attach message handlers
    for (const input of inputs) {
      input.onmidimessage = handleMIDIMessage
    }

    setState(prev => ({
      ...prev,
      isConnected: devices.length > 0,
      devices,
      error: null,
    }))
  }, [handleMIDIMessage])

  useEffect(() => {
    if (!state.isSupported) return

    navigator.requestMIDIAccess({ sysex: false })
      .then(access => {
        midiAccessRef.current = access
        refreshDevices(access)

        access.onstatechange = () => refreshDevices(access)
      })
      .catch(err => {
        setState(prev => ({
          ...prev,
          isConnected: false,
          error: err instanceof Error ? err.message : 'MIDI access denied',
        }))
      })

    return () => {
      if (midiAccessRef.current) {
        for (const input of midiAccessRef.current.inputs.values()) {
          input.onmidimessage = null
        }
      }
    }
  }, [state.isSupported, refreshDevices])

  return state
}
