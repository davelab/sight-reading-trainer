import { useEffect } from 'react'
import { inTauri } from '../lib/ipc'
import { listenOmrEvents } from '../stores/omr'
import { listenSeparateEvents } from '../stores/separate'

export function useOmrEvents(): void {
  useEffect(() => (inTauri ? listenOmrEvents() : undefined), [])
  useEffect(() => (inTauri ? listenSeparateEvents() : undefined), [])
}
