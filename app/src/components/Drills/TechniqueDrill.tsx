import { useEffect, useState } from 'react'
import exercises from '../../assets/hanon/index.json'
import { openMusicXml } from '../../lib/loadScore'
import { useView } from '../../stores/view'
import { Snippet } from './Snippet'
import './TechniqueDrill.css'

/** Hanon, The Virtuoso Pianist (Schirmer 1900, public domain), as MusicXML. */
const files = import.meta.glob<string>('../../assets/hanon/*.musicxml', { query: '?raw', import: 'default' })

interface HanonExercise {
  number: number
  title: string
  description: string
  tempo: string
  bpm: number
  file: string
  measures: number
  page: string
}

const ALL = exercises as HanonExercise[]
const GROUPS: [string, number[]][] = [
  ['Fondamentali', [1, 2, 13, 20]],
  ['Tecnica avanzata', [43, 48, 50]]
]

async function load(ex: HanonExercise): Promise<string> {
  const loader = files[`../../assets/hanon/${ex.file}`]
  if (!loader) throw new Error(`esercizio non trovato: ${ex.file}`)
  return loader()
}

/** The first two measures, for the card. */
function preview(xml: string): string {
  const end = xml.indexOf('</measure>', xml.indexOf('<measure number="2"'))
  return end < 0 ? xml : xml.slice(0, end + '</measure>'.length) + '</part></score-partwise>'
}

/** Technique: Hanon exercises, opened in Studia with tempo, metronome, hands, loop and "A tempo". */
export function TechniqueDrill() {
  const [previews, setPreviews] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void Promise.all(ALL.map(async (ex) => [ex.number, preview(await load(ex))] as const)).then(
      (pairs) => live && setPreviews(Object.fromEntries(pairs))
    )
    return () => {
      live = false
    }
  }, [])

  const open = async (ex: HanonExercise) => {
    setBusy(ex.number)
    setError(null)
    try {
      await openMusicXml(ex.file, await load(ex), `${ex.title}`)
      useView.getState().set({ section: 'study' })
    } catch (e) {
      setError(`Impossibile aprire ${ex.title}: ${e}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="drill technique">
      <p className="technique-intro">
        Charles-Louis Hanon, <em>Il pianista virtuoso</em>. Si aprono in Studia: comincia a ♩ = 60 col metronomo e sali
        gradualmente (Hanon indica fino a 108); prova le mani separate, usa il loop sui passaggi difficili e «A tempo»
        per controllare la regolarità. Ogni esercizio va ripetuto senza fermarsi.
      </p>
      {error && <small className="omr-error">{error}</small>}
      {GROUPS.map(([label, numbers]) => (
        <section key={label}>
          <h3>{label}</h3>
          <div className="technique-list">
            {numbers.map((n) => {
              const ex = ALL.find((e) => e.number === n)
              if (!ex) return null
              return (
                <article key={n} className="technique-card">
                  <header>
                    <strong>n. {ex.number}</strong>
                    <span>
                      {ex.tempo} · {ex.measures} battute
                    </span>
                  </header>
                  <p>{ex.description}</p>
                  {previews[n] ? (
                    <Snippet xml={previews[n]} className="technique-preview" scale={30} />
                  ) : (
                    <div className="technique-preview" />
                  )}
                  <button className="primary" disabled={busy !== null} onClick={() => void open(ex)}>
                    {busy === n ? 'Apro…' : 'Apri in Studia'}
                  </button>
                </article>
              )
            })}
          </div>
        </section>
      ))}
      <small className="technique-source">
        Dall'edizione Schirmer (1900), di pubblico dominio; trascritti in MusicXML con le diteggiature della prima
        battuta in salita e in discesa.
      </small>
    </div>
  )
}
