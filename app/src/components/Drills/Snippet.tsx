import { useEffect, useState } from 'react'
import { renderSnippet } from '../../lib/verovio'

/** The SVG of a drill question, drawn by the drill's own Verovio toolkit. */
export function Snippet({ xml, className, scale = 110 }: { xml: string; className?: string; scale?: number }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    let live = true
    void renderSnippet(xml, scale).then((s) => live && setSvg(s))
    return () => {
      live = false
    }
  }, [xml, scale])
  return <div className={`drill-staff ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: svg }} />
}
