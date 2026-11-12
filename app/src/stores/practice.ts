import { inTauri, ipc } from '../lib/ipc'
import { countInAt, metronomeClicks } from '../lib/practice'
import { scoreDurationMs } from '../lib/timemap'
import { timedRunStart, useMidi } from './midi'
import { useScore } from './score'
import { useTransport } from './transport'
import { TOLERANCE_MS, useView } from './view'

/** Start "A tempo" mode from the current position (from the top if at the end). */
export async function startTimed(): Promise<void> {
  if (!inTauri) return
  const { measures, measureIds, meters, events } = useScore.getState()
  const duration = scoreDurationMs(events)
  const position = useTransport.getState().positionMs
  const from = position >= duration - 1 ? 0 : position
  if (from !== position) await ipc.seek(from)
  const view = useView.getState()
  const clicks = metronomeClicks(measures, measureIds, meters, duration)
  const countIn = view.countIn ? countInAt(clicks, from) : null
  timedRunStart.ms = from
  useMidi.getState().set({ timed: true, timedResults: {}, timedSummary: null, results: {}, following: false })
  await ipc.startTimedMode(TOLERANCE_MS[view.tolerance], countIn)
}

/** Stop the run; its totals arrive as `timed:summary`. */
export async function stopTimed(): Promise<void> {
  if (inTauri) await ipc.stopTimedMode()
}

/** Play the same run again, optionally at another tempo (percent). */
export async function retryTimed(tempoPercent?: number): Promise<void> {
  const summary = useMidi.getState().timedSummary
  if (tempoPercent !== undefined) {
    useTransport.getState().set({ tempoPercent })
    await ipc.setTempo(tempoPercent)
  }
  await ipc.seek(summary?.fromMs ?? 0)
  useTransport.getState().set({ positionMs: summary?.fromMs ?? 0 })
  await startTimed()
}

export async function setMetronome(on: boolean): Promise<void> {
  useView.getState().set({ metronome: on })
  if (inTauri) await ipc.setMetronome(on)
}
