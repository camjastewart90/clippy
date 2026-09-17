import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  screen,
  systemPreferences,
  globalShortcut,
  clipboard,
  Notification,
  nativeImage,
  dialog
} from 'electron'
import { execFile } from 'child_process'
import { readFileSync, existsSync, unlinkSync } from 'fs'
import { join, extname, basename } from 'path'
import { autoUpdater } from 'electron-updater'
import { PDFParse } from 'pdf-parse'
import { getSettings, saveSettings } from './settings'
import { getMemories, addMemory, removeMemory, clearMemories } from './memory'
import { streamReply, listModels, type Turn } from './chat'

const COLLAPSED = { width: 140, height: 150 }

/** (Re)register the global hotkeys from settings. Returns whether both took. */
function registerHotkey(): boolean {
  globalShortcut.unregisterAll()
  const { hotkey, selectionHotkey } = getSettings()
  let ok = true
  const reg = (hk: string, fn: () => void): void => {
    if (!hk) return
    try {
      if (!globalShortcut.register(hk, fn)) ok = false
    } catch {
      ok = false
    }
  }
  reg(hotkey, () => void doQuickLook())
  reg(selectionHotkey, () => void doSelection())
  return ok
}

let win: BrowserWindow | null = null
let cursorTimer: ReturnType<typeof setInterval> | null = null
let appTimer: ReturnType<typeof setInterval> | null = null
const margin = 24

// Frontmost app/window (excluding ourselves) so Clippy knows what you're doing.
let lastActiveApp = ''
const APP_SCRIPT = `tell application "System Events"
set p to first application process whose frontmost is true
set a to name of p
set t to ""
try
set t to title of front window of p
end try
return a & "||" & t
end tell`

function pollActiveApp(): void {
  execFile('osascript', ['-e', APP_SCRIPT], (err, stdout) => {
    if (err) return
    const [name, title] = stdout.trim().split('||')
    if (!name || name === 'Electron' || name === 'AI Clippy') return
    lastActiveApp = title ? `${name} — ${title}` : name
  })
}

// Background music plays in an off-screen, opacity-0 window (shown so the media
// engine autoplays; invisible so it doesn't bother the user). Tracks must allow
// embedding.
let musicWin: BrowserWindow | null = null

function stopMusic(): void {
  if (musicWin && !musicWin.isDestroyed()) musicWin.destroy()
  musicWin = null
}

function playTrack(id: string): void {
  stopMusic()
  const url = `https://www.youtube.com/embed/${id}?autoplay=1&loop=1&playlist=${id}&playsinline=1`
  musicWin = new BrowserWindow({
    width: 400,
    height: 300,
    show: false,
    focusable: false,
    skipTaskbar: true,
    webPreferences: { autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false }
  })
  musicWin.loadURL(url, { httpReferrer: 'https://www.youtube.com/' })
  musicWin.once('ready-to-show', () => {
    musicWin?.showInactive()
    musicWin?.setOpacity(0)
  })
  // If the video blocks embedding (Error 150/153), fall back to the browser.
  musicWin.webContents.on('did-finish-load', () => {
    setTimeout(async () => {
      if (!musicWin || musicWin.isDestroyed()) return
      try {
        const failed = await musicWin.webContents.executeJavaScript(
          "!!document.querySelector('.ytp-error') || document.body.innerText.includes('Error 15')"
        )
        if (failed) {
          stopMusic()
          shell.openExternal(`https://www.youtube.com/watch?v=${id}`)
          win?.webContents.send('clippy:music-fallback', id)
        }
      } catch {
        // ignore
      }
    }, 2500)
  })
  musicWin.on('closed', () => {
    musicWin = null
  })
}

function createWindow(): void {
  const display = screen.getPrimaryDisplay()
  const { width: sw, height: sh, x: dx, y: dy } = display.workArea

  win = new BrowserWindow({
    width: COLLAPSED.width,
    height: COLLAPSED.height,
    x: dx + sw - COLLAPSED.width - margin,
    y: dy + sh - COLLAPSED.height - margin,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Float above regular windows and stay visible across spaces / fullscreen apps.
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  win.on('closed', () => {
    win = null
    if (cursorTimer) clearInterval(cursorTimer)
    cursorTimer = null
  })

  // Feed the global cursor position to the renderer so Clippy's eyes can follow
  // it even when the pointer is outside our little window.
  cursorTimer = setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return
    const p = screen.getCursorScreenPoint()
    const b = win.getBounds()
    win.webContents.send('clippy:cursor', { cx: p.x, cy: p.y, wx: b.x, wy: b.y })
  }, 70)

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi))

/**
 * Resize the window keeping its bottom-right corner anchored, then nudge it so
 * it stays fully on-screen — so opening the chat near a top/left edge or corner
 * doesn't push the panel off the display.
 */
function resizeAnchored(width: number, height: number): void {
  if (!win) return
  width = Math.round(width)
  height = Math.round(height)
  const b = win.getBounds()
  const area = screen.getDisplayMatching(b).workArea
  let x = Math.round(b.x + b.width - width)
  let y = Math.round(b.y + b.height - height)
  x = clamp(x, area.x, area.x + area.width - width)
  y = clamp(y, area.y, area.y + area.height - height)
  win.setBounds({ x, y, width, height })
}

async function captureScreen(): Promise<{ base64?: string; error?: string }> {
  const primary = screen.getPrimaryDisplay()
  const { width, height } = primary.size
  const targetW = 1280
  const targetH = Math.round((height / width) * targetW)

  // Hide our own overlay so Clippy doesn't photobomb the screenshot.
  const wasVisible = win?.isVisible() ?? false
  if (wasVisible) win?.hide()
  try {
    // Always attempt the capture — this is what registers the app in macOS's
    // Screen Recording list (and triggers the permission prompt) the first time.
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: targetW, height: targetH }
    })
    const source = sources[0]
    if (!source || source.thumbnail.isEmpty()) {
      const status =
        process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'granted'
      if (status !== 'granted') {
        return {
          error:
            'Screen Recording is off. It should now appear in System Settings → Privacy & Security → Screen & System Audio Recording (as “Electron” in dev) — switch it on, then quit and reopen Clippy.'
        }
      }
      return { error: 'Could not capture the screen — please try again.' }
    }
    return { base64: source.thumbnail.toPNG().toString('base64') }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  } finally {
    if (wasVisible) win?.showInactive()
  }
}

const IMG_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']
const TXT_EXT = [
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.log', '.js', '.ts', '.tsx', '.jsx',
  '.py', '.html', '.htm', '.css', '.xml', '.yml', '.yaml', '.sh', '.rb', '.go', '.java', '.c',
  '.h', '.cpp', '.rs', '.php', '.sql'
]
const MAX_DOC = 12000

interface DropResult {
  kind?: 'image' | 'text'
  base64?: string
  text?: string
  name?: string
  truncated?: boolean
  error?: string
}

/** Read a dropped file: images → PNG for vision, PDFs/text → extracted text. */
async function readDropFile(filePath: string): Promise<DropResult> {
  try {
    const name = basename(filePath)
    const ext = extname(filePath).toLowerCase()
    if (IMG_EXT.includes(ext)) {
      const img = nativeImage.createFromPath(filePath)
      if (img.isEmpty()) return { error: `Couldn't read image ${name}.` }
      return { kind: 'image', base64: img.toPNG().toString('base64'), name }
    }
    if (ext === '.pdf') {
      const parser = new PDFParse({ data: readFileSync(filePath) })
      const result = await parser.getText()
      const text = (result.text || '').trim()
      if (!text) return { error: `No text found in ${name} — it may be scanned. Drop a screenshot instead.` }
      return { kind: 'text', name, text: text.slice(0, MAX_DOC), truncated: text.length > MAX_DOC }
    }
    if (TXT_EXT.includes(ext)) {
      const text = readFileSync(filePath, 'utf-8')
      return { kind: 'text', name, text: text.slice(0, MAX_DOC), truncated: text.length > MAX_DOC }
    }
    return { error: `Unsupported file type (${ext || 'unknown'}). Try an image, PDF, or text file.` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

/** Interactive drag-select of a screen region via macOS `screencapture -i`. */
async function captureRegion(): Promise<{ base64?: string; cancelled?: boolean; error?: string }> {
  if (process.platform !== 'darwin') return { error: 'Region capture is macOS-only.' }
  const out = join(app.getPath('temp'), `clippy-region-${Date.now()}.png`)
  const wasVisible = win?.isVisible() ?? false
  if (wasVisible) win?.hide()
  try {
    await run('screencapture', ['-i', '-x', out]) // -i interactive selection, -x silent
    if (!existsSync(out)) return { cancelled: true } // user pressed Escape
    const base64 = readFileSync(out).toString('base64')
    unlinkSync(out)
    return { base64 }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  } finally {
    if (wasVisible) win?.showInactive()
  }
}

/** Hotkey handler: grab the screen and have Clippy answer straight away. */
async function doQuickLook(): Promise<void> {
  if (!win) return
  const res = await captureScreen()
  if (win.isMinimized()) win.restore()
  win.showInactive()
  if (res.base64) win.webContents.send('clippy:quick-look', res.base64)
  else if (res.error) win.webContents.send('clippy:error', res.error)
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Hotkey handler: copy the frontmost app's current selection and act on it. */
async function doSelection(): Promise<void> {
  if (!win) return
  const surface = (): void => {
    if (win!.isMinimized()) win!.restore()
    win!.showInactive()
  }
  if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) {
    surface()
    win.webContents.send(
      'clippy:error',
      'To read your selection, grant Accessibility under System Settings → Privacy & Security → Accessibility, then try again.'
    )
    return
  }
  // Copy the selection without clobbering the user's clipboard: stash it, clear,
  // send Cmd+C to the (still-focused) app, read, then restore.
  const previous = clipboard.readText()
  try {
    clipboard.writeText('')
    await run('osascript', ['-e', 'tell application "System Events" to keystroke "c" using command down'])
    await delay(150)
    const selection = clipboard.readText()
    clipboard.writeText(previous)
    surface()
    if (selection.trim()) win.webContents.send('clippy:selection', selection)
    else
      win.webContents.send(
        'clippy:error',
        'No text selected — highlight some text first, then press the shortcut.'
      )
  } catch (err) {
    clipboard.writeText(previous)
    surface()
    win.webContents.send('clippy:error', err instanceof Error ? err.message : String(err))
  }
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err) => (err ? reject(err) : resolve()))
  })
}

interface ClippyAction {
  type: string
  value: string
  label?: string
}

/** Escape a string for use inside an AppleScript double-quoted literal. */
const asStr = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

/** Execute an action the user has explicitly approved. Deliberately a small, safe set. */
async function runAction(action: ClippyAction): Promise<{ ok: boolean; message: string }> {
  const value = String(action?.value ?? '').trim()
  try {
    switch (action?.type) {
      case 'open_url': {
        if (!/^https?:\/\//i.test(value)) return { ok: false, message: 'Only http(s) URLs are allowed.' }
        await shell.openExternal(value)
        return { ok: true, message: `Opened ${value}` }
      }
      case 'open_app': {
        if (!value) return { ok: false, message: 'No app name given.' }
        await run('open', ['-a', value])
        return { ok: true, message: `Opened ${value}` }
      }
      case 'web_search': {
        if (!value) return { ok: false, message: 'No search query given.' }
        await shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(value)}`)
        return { ok: true, message: `Searched the web for “${value}”` }
      }
      case 'copy_text': {
        if (!value) return { ok: false, message: 'Nothing to copy.' }
        clipboard.writeText(value)
        return { ok: true, message: 'Copied to your clipboard.' }
      }
      case 'show_notification': {
        if (!Notification.isSupported()) return { ok: false, message: 'Notifications are not available.' }
        new Notification({ title: 'Clippy', body: value }).show()
        return { ok: true, message: 'Shown a notification.' }
      }
      case 'type_text': {
        if (process.platform !== 'darwin') return { ok: false, message: 'Typing is macOS-only.' }
        if (!systemPreferences.isTrustedAccessibilityClient(false)) {
          return {
            ok: false,
            message:
              'To let Clippy type, grant Accessibility under System Settings → Privacy & Security → Accessibility, then try again.'
          }
        }
        await run('osascript', ['-e', `tell application "System Events" to keystroke "${asStr(value)}"`])
        return { ok: true, message: 'Typed the text into the focused app.' }
      }
      case 'create_note': {
        if (process.platform !== 'darwin') return { ok: false, message: 'Notes is macOS-only.' }
        if (!value) return { ok: false, message: 'The note is empty.' }
        const body = asStr(value.replace(/\r?\n/g, '<br>'))
        await run('osascript', ['-e', `tell application "Notes" to make new note with properties {body:"${body}"}`])
        return { ok: true, message: 'Created a note in Notes.' }
      }
      case 'remember': {
        if (!value) return { ok: false, message: 'Nothing to remember.' }
        addMemory(value)
        return { ok: true, message: `Remembered: “${value}”` }
      }
      default:
        return { ok: false, message: `Unknown action: ${action?.type}` }
    }
  } catch (err) {
    let msg = err instanceof Error ? err.message : String(err)
    if (/-1743|not authoriz|not allowed/i.test(msg)) {
      msg = 'macOS blocked that — allow the app to control the other app under Privacy & Security → Automation, then retry.'
    }
    return { ok: false, message: msg }
  }
}

let activeStream: AbortController | null = null

function registerIpc(): void {
  ipcMain.handle('clippy:get-settings', () => {
    const s = getSettings()
    return {
      model: s.model,
      baseUrl: s.baseUrl,
      apiKey: s.apiKey,
      hotkey: s.hotkey,
      selectionHotkey: s.selectionHotkey
    }
  })

  ipcMain.handle(
    'clippy:save-settings',
    (
      _e,
      patch: { baseUrl?: string; model?: string; apiKey?: string; hotkey?: string; selectionHotkey?: string }
    ) => {
      const clean: Partial<{
        baseUrl: string
        model: string
        apiKey: string
        hotkey: string
        selectionHotkey: string
      }> = {}
      if (typeof patch.baseUrl === 'string' && patch.baseUrl.trim()) clean.baseUrl = patch.baseUrl.trim()
      // model & apiKey may be intentionally cleared, so accept empty strings.
      if (typeof patch.model === 'string') clean.model = patch.model.trim()
      if (typeof patch.apiKey === 'string') clean.apiKey = patch.apiKey.trim()
      if (typeof patch.hotkey === 'string' && patch.hotkey.trim()) clean.hotkey = patch.hotkey.trim()
      if (typeof patch.selectionHotkey === 'string' && patch.selectionHotkey.trim())
        clean.selectionHotkey = patch.selectionHotkey.trim()
      const s = saveSettings(clean)
      const hotkeyOk = registerHotkey()
      return {
        model: s.model,
        baseUrl: s.baseUrl,
        apiKey: s.apiKey,
        hotkey: s.hotkey,
        selectionHotkey: s.selectionHotkey,
        hotkeyOk
      }
    }
  )

  // Probe the server and report which models it exposes.
  ipcMain.handle('clippy:check-server', async () => {
    try {
      const { baseUrl, apiKey } = getSettings()
      const models = await listModels(baseUrl, apiKey)
      return { ok: true, models }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('clippy:capture', () => captureScreen())

  ipcMain.handle('clippy:capture-region', () => captureRegion())

  ipcMain.handle('clippy:read-drop', (_e, filePath: string) => readDropFile(String(filePath)))

  ipcMain.handle('clippy:pick-file', async (): Promise<DropResult & { cancelled?: boolean }> => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        {
          name: 'Documents & Images',
          extensions: ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'txt', 'md', 'csv', 'json', 'log']
        }
      ]
    })
    if (r.canceled || !r.filePaths[0]) return { cancelled: true }
    return readDropFile(r.filePaths[0])
  })

  ipcMain.handle('clippy:run-action', (_e, action: ClippyAction) => runAction(action))

  ipcMain.handle('clippy:get-memories', () => getMemories())
  ipcMain.handle('clippy:add-memory', (_e, text: string) => addMemory(String(text ?? '')))
  ipcMain.handle('clippy:remove-memory', (_e, index: number) => removeMemory(Number(index)))
  ipcMain.handle('clippy:clear-memories', () => clearMemories())

  ipcMain.handle('clippy:resize', (_e, size: { width: number; height: number }) => {
    resizeAnchored(size.width, size.height)
  })

  ipcMain.handle('clippy:window-pos', () => {
    const b = win?.getBounds()
    return { x: b?.x ?? 0, y: b?.y ?? 0 }
  })

  ipcMain.on('clippy:window-move', (_e, pos: { x: number; y: number }) => {
    if (!win) return
    const b = win.getBounds()
    const area = screen.getDisplayMatching(b).workArea
    // keep the window fully on-screen while dragging, so it can't be lost off an edge
    const x = clamp(Math.round(pos.x), area.x, area.x + area.width - b.width)
    const y = clamp(Math.round(pos.y), area.y, area.y + area.height - b.height)
    win.setPosition(x, y)
  })

  ipcMain.on('clippy:send', async (e, turns: Turn[]) => {
    const { baseUrl, apiKey } = getSettings()
    let model = getSettings().model
    activeStream?.abort()
    const controller = new AbortController()
    activeStream = controller
    try {
      // Blank model = use whatever the server currently has loaded.
      if (!model) {
        const loaded = await listModels(baseUrl, apiKey).catch(() => [])
        model = loaded[0] ?? ''
      }
      if (!model) {
        e.sender.send(
          'clippy:error',
          'No model selected. Open settings (the gear), pick a provider/model, and Test connection.'
        )
        return
      }
      await streamReply({
        baseUrl,
        model,
        apiKey,
        memories: getMemories(),
        activeApp: lastActiveApp,
        messages: turns,
        signal: controller.signal,
        onText: (textSoFar) => e.sender.send('clippy:delta', textSoFar)
      })
      e.sender.send('clippy:done')
    } catch (err) {
      if (controller.signal.aborted) return
      let msg = err instanceof Error ? err.message : String(err)
      if (/fetch failed|ECONNREFUSED|Failed to fetch/i.test(msg)) {
        msg = `Can't reach ${baseUrl}. Check the URL and your connection (and if it's LM Studio, that the local server is started).`
      }
      e.sender.send('clippy:error', msg)
    } finally {
      if (activeStream === controller) activeStream = null
    }
  })

  ipcMain.handle('clippy:play-track', (_e, id: string) => {
    playTrack(String(id))
    return { playing: String(id) }
  })
  ipcMain.handle('clippy:stop-music', () => {
    stopMusic()
    return { playing: null }
  })

  ipcMain.on('clippy:cancel', () => activeStream?.abort())
  ipcMain.on('clippy:quit', () => app.quit())
  ipcMain.on('clippy:open-external', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
  })
}

/** Check GitHub Releases for updates; download in the background, install on quit. */
function initAutoUpdate(): void {
  if (!app.isPackaged) return // no update feed in dev
  autoUpdater.autoDownload = true
  autoUpdater.on('error', (e) => console.warn('[updater]', e?.message ?? e))
  autoUpdater.on('update-downloaded', () => {
    new Notification({
      title: 'AI Clippy update ready',
      body: 'Quit and reopen Clippy to install the latest version.'
    }).show()
  })
  autoUpdater.checkForUpdatesAndNotify().catch(() => {})
  // re-check every 6 hours while running
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000)
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock?.hide()
  registerIpc()
  createWindow()
  initAutoUpdate()

  if (!registerHotkey()) {
    console.warn('Could not register the global capture hotkey (another app may own it).')
  }

  pollActiveApp()
  appTimer = setInterval(pollActiveApp, 2500)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  stopMusic()
  if (appTimer) clearInterval(appTimer)
})

// Overlay lives on until explicitly quit; don't exit when the window hides.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
