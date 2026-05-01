import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  loadSessions: (): Promise<unknown[]> => ipcRenderer.invoke('load-sessions'),
  saveSessions: (sessions: unknown[]): Promise<void> => ipcRenderer.invoke('save-sessions', sessions)
})
