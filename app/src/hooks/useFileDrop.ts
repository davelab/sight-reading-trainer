import { useEffect, useState } from 'react'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { inTauri } from '../lib/ipc'
import { openScoreFile, openScorePath } from '../lib/loadScore'

/**
 * Drag-and-drop of score files. In Tauri the webview reports native paths;
 * in a plain browser we fall back to HTML5 drag events.
 */
export function useFileDrop(): boolean {
  const [hovering, setHovering] = useState(false)

  useEffect(() => {
    if (inTauri) {
      const unlisten = getCurrentWebview().onDragDropEvent(({ payload }) => {
        if (payload.type === 'enter' || payload.type === 'over') setHovering(true)
        else if (payload.type === 'leave') setHovering(false)
        else if (payload.type === 'drop') {
          setHovering(false)
          if (payload.paths[0]) void openScorePath(payload.paths[0])
        }
      })
      return () => {
        void unlisten.then((fn) => fn())
      }
    }
    const over = (e: DragEvent) => {
      e.preventDefault()
      setHovering(true)
    }
    const leave = () => setHovering(false)
    const drop = (e: DragEvent) => {
      e.preventDefault()
      setHovering(false)
      const file = e.dataTransfer?.files[0]
      if (file) void openScoreFile(file)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [])

  return hovering
}
