import { contextBridge, ipcRenderer, webUtils } from 'electron'

export interface Turn {
  role: 'user' | 'assistant'
  text: string
  image?: string
}

export interface SettingsState {
  model: string
  baseUrl: string
  apiKey: string
  hotkey: string
  selectionHotkey: string
}

const api = {
  getSettings: (): Promise<SettingsState> => ipcRenderer.invoke('clippy:get-settings'),
  saveSettings: (patch: {
    baseUrl?: string
    model?: string
    apiKey?: string
    hotkey?: string
    selectionHotkey?: string
  }): Promise<SettingsState & { hotkeyOk?: boolean }> =>
    ipcRenderer.invoke('clippy:save-settings', patch),
  checkServer: (): Promise<{ ok: boolean; models?: string[]; error?: string }> =>
    ipcRenderer.invoke('clippy:check-server'),
  capture: (): Promise<{ base64?: string; error?: string }> => ipcRenderer.invoke('clippy:capture'),
  captureRegion: (): Promise<{ base64?: string; cancelled?: boolean; error?: string }> =>
    ipcRenderer.invoke('clippy:capture-region'),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  readDrop: (
    filePath: string
  ): Promise<{
    kind?: 'image' | 'text'
    base64?: string
    text?: string
    name?: string
    truncated?: boolean
    error?: string
  }> => ipcRenderer.invoke('clippy:read-drop', filePath),
  pickFile: (): Promise<{
    kind?: 'image' | 'text'
    base64?: string
    text?: string
    name?: string
    truncated?: boolean
    cancelled?: boolean
    error?: string
  }> => ipcRenderer.invoke('clippy:pick-file'),
  runAction: (action: { type: string; value: string; label?: string }): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('clippy:run-action', action),
  playTrack: (id: string): Promise<{ playing: string | null }> =>
    ipcRenderer.invoke('clippy:play-track', id),
  stopMusic: (): Promise<{ playing: string | null }> => ipcRenderer.invoke('clippy:stop-music'),
  getMemories: (): Promise<string[]> => ipcRenderer.invoke('clippy:get-memories'),
  addMemory: (text: string): Promise<string[]> => ipcRenderer.invoke('clippy:add-memory', text),
  removeMemory: (index: number): Promise<string[]> => ipcRenderer.invoke('clippy:remove-memory', index),
  clearMemories: (): Promise<string[]> => ipcRenderer.invoke('clippy:clear-memories'),
  resize: (width: number, height: number): Promise<void> =>
    ipcRenderer.invoke('clippy:resize', { width, height }),
  windowPos: (): Promise<{ x: number; y: number }> => ipcRenderer.invoke('clippy:window-pos'),
  windowMove: (x: number, y: number): void => ipcRenderer.send('clippy:window-move', { x, y }),

  send: (turns: Turn[]): void => ipcRenderer.send('clippy:send', turns),
  cancel: (): void => ipcRenderer.send('clippy:cancel'),
  quit: (): void => ipcRenderer.send('clippy:quit'),
  openExternal: (url: string): void => ipcRenderer.send('clippy:open-external', url),

  onCursor: (cb: (p: { cx: number; cy: number; wx: number; wy: number }) => void): (() => void) => {
    const handler = (_e: unknown, p: { cx: number; cy: number; wx: number; wy: number }): void => cb(p)
    ipcRenderer.on('clippy:cursor', handler)
    return () => ipcRenderer.removeListener('clippy:cursor', handler)
  },
  onQuickLook: (cb: (base64: string) => void): (() => void) => {
    const handler = (_e: unknown, base64: string): void => cb(base64)
    ipcRenderer.on('clippy:quick-look', handler)
    return () => ipcRenderer.removeListener('clippy:quick-look', handler)
  },
  onSelection: (cb: (text: string) => void): (() => void) => {
    const handler = (_e: unknown, text: string): void => cb(text)
    ipcRenderer.on('clippy:selection', handler)
    return () => ipcRenderer.removeListener('clippy:selection', handler)
  },
  onMusicFallback: (cb: (id: string) => void): (() => void) => {
    const handler = (_e: unknown, id: string): void => cb(id)
    ipcRenderer.on('clippy:music-fallback', handler)
    return () => ipcRenderer.removeListener('clippy:music-fallback', handler)
  },
  onDelta: (cb: (text: string) => void): (() => void) => {
    const handler = (_e: unknown, text: string): void => cb(text)
    ipcRenderer.on('clippy:delta', handler)
    return () => ipcRenderer.removeListener('clippy:delta', handler)
  },
  onDone: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('clippy:done', handler)
    return () => ipcRenderer.removeListener('clippy:done', handler)
  },
  onError: (cb: (msg: string) => void): (() => void) => {
    const handler = (_e: unknown, msg: string): void => cb(msg)
    ipcRenderer.on('clippy:error', handler)
    return () => ipcRenderer.removeListener('clippy:error', handler)
  }
}

contextBridge.exposeInMainWorld('clippy', api)

export type ClippyApi = typeof api
