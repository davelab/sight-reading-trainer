import { useEffect, useState } from 'react'
import { ipc } from '../../lib/ipc'
import { refineWithClaude, useOmr } from '../../stores/omr'
import '../TranscribeSetup/TranscribeSetup.css'

/** Ask for the Claude API key once; it goes to the macOS Keychain, never to a file. */
export function ClaudeKeyDialog() {
  const open = useOmr((s) => s.keyDialog)
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setKey('')
    setError(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useOmr.setState({ keyDialog: false })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null
  const close = () => useOmr.setState({ keyDialog: false })
  return (
    <div className="tx-backdrop">
      <form
        className="tx-setup"
        role="dialog"
        aria-labelledby="claude-key-title"
        onSubmit={async (e) => {
          e.preventDefault()
          setSaving(true)
          setError(null)
          try {
            await ipc.setApiKey(key)
            close()
            void refineWithClaude()
          } catch (err) {
            setError(String(err))
          } finally {
            setSaving(false)
          }
        }}
      >
        <h2 id="claude-key-title">Chiave API di Claude</h2>
        <p className="tx-help">
          Per rileggere le battute sospette serve una chiave API di Anthropic: creala su
          <strong> console.anthropic.com</strong> → Settings → API Keys (serve un credito prepagato). Viene salvata nel
          Portachiavi di macOS. Ogni rilettura invia ad Anthropic le immagini delle pagine del PDF e costa in genere
          pochi centesimi.
        </p>
        <label>
          <span>Chiave</span>
          <input
            type="password"
            autoFocus
            autoComplete="off"
            placeholder="sk-ant-…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
        {error && <small className="omr-error">{error}</small>}
        <div className="tx-actions">
          <button type="button" onClick={close}>
            Annulla
          </button>
          <button type="submit" className="primary" disabled={!key.trim() || saving}>
            Salva e rileggi
          </button>
        </div>
      </form>
    </div>
  )
}
