import { useState, useEffect, useCallback } from 'react'
import { PracticeSession } from './components/PracticeSession'
import { SessionHistory } from './components/SessionHistory'
import type { PracticeSession as PracticeSessionData } from './types'
import './App.css'

type View = 'practice' | 'history'

declare global {
  interface Window {
    electronAPI: {
      loadSessions: () => Promise<PracticeSessionData[]>
      saveSessions: (sessions: PracticeSessionData[]) => Promise<void>
    }
  }
}

export function App() {
  const [view, setView] = useState<View>('practice')
  const [sessions, setSessions] = useState<PracticeSessionData[]>([])

  useEffect(() => {
    window.electronAPI.loadSessions().then(loaded => {
      setSessions(loaded as PracticeSessionData[])
    }).catch(() => {
      // No sessions file yet
    })
  }, [])

  const handleSessionComplete = useCallback((session: PracticeSessionData) => {
    setSessions(prev => {
      const updated = [...prev, session]
      window.electronAPI.saveSessions(updated).catch(console.error)
      return updated
    })
  }, [])

  const handleClearHistory = useCallback(() => {
    setSessions([])
    window.electronAPI.saveSessions([]).catch(console.error)
  }, [])

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-brand">
          <span className="app-logo">𝄞</span>
          <h1 className="app-title">Sight Reading Trainer</h1>
        </div>
        <nav className="app-nav">
          <button
            className={`nav-btn ${view === 'practice' ? 'nav-btn--active' : ''}`}
            onClick={() => setView('practice')}
          >
            Practice
          </button>
          <button
            className={`nav-btn ${view === 'history' ? 'nav-btn--active' : ''}`}
            onClick={() => setView('history')}
          >
            History
            {sessions.length > 0 && (
              <span className="nav-badge">{sessions.length}</span>
            )}
          </button>
        </nav>
      </header>

      <main className="app-main">
        {view === 'practice' && (
          <PracticeSession onSessionComplete={handleSessionComplete} />
        )}
        {view === 'history' && (
          <SessionHistory sessions={sessions} onClear={handleClearHistory} />
        )}
      </main>
    </div>
  )
}
