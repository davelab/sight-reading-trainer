import { useEffect } from 'react'
import { inTauri, ipc } from '../lib/ipc'
import { useView, type ViewSettings } from '../stores/view'

/**
 * Apply the view settings: hand colours as CSS variables (keyboard, score
 * cursor, falling notes), and volume, reverb and transposition in Rust.
 */
export function useViewSync(): void {
  useEffect(() => {
    let last: Partial<ViewSettings> = {}
    const apply = (s: ViewSettings) => {
      const root = document.documentElement.style
      root.setProperty('--hand-right', s.rightColor)
      root.setProperty('--hand-left', s.leftColor)
      if (inTauri) {
        if (s.volume !== last.volume) void ipc.setVolume(s.volume)
        if (s.reverb !== last.reverb) void ipc.setReverb(s.reverb)
        if (s.transpose !== last.transpose) void ipc.setTranspose(s.transpose)
      }
      last = { ...s }
    }
    apply(useView.getState())
    return useView.subscribe(apply)
  }, [])
}
