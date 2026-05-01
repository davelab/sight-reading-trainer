import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { is } from '@electron-toolkit/utils'

const SESSIONS_PATH = join(app.getPath('userData'), 'sessions.json')

function ensureStorageDir(): void {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 650,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Grant MIDI permissions automatically
  win.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'midi' || permission === 'midiSysex') {
      callback(true)
    } else {
      callback(false)
    }
  })

  win.webContents.session.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'midi' || permission === 'midiSysex'
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  setupIPC()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function setupIPC(): void {
  ensureStorageDir()

  ipcMain.handle('load-sessions', () => {
    if (!existsSync(SESSIONS_PATH)) return []
    try {
      return JSON.parse(readFileSync(SESSIONS_PATH, 'utf-8'))
    } catch {
      return []
    }
  })

  ipcMain.handle('save-sessions', (_event, sessions: unknown) => {
    writeFileSync(SESSIONS_PATH, JSON.stringify(sessions, null, 2), 'utf-8')
  })
}
