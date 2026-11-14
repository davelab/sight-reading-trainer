import { useEffect } from 'react'
import { inTauri } from '../lib/ipc'
import { listenOmrEvents } from '../stores/omr'

export function useOmrEvents(): void {
  useEffect(() => (inTauri ? listenOmrEvents() : undefined), [])
}
