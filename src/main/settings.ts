import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

export interface Settings {
  // OpenAI-compatible server (LM Studio local, or a hosted provider).
  baseUrl: string
  // Model id to request; blank = auto-pick whatever the server has loaded.
  model: string
  // Bearer key for hosted providers; blank for a local server.
  apiKey: string
  // Electron accelerator string for the global screen-capture hotkey.
  hotkey: string
  // Global hotkey to act on the currently selected text in any app.
  selectionHotkey: string
}

const DEFAULTS: Settings = {
  baseUrl: 'http://localhost:1234/v1',
  model: '',
  apiKey: '',
  hotkey: 'CommandOrControl+Shift+Space',
  selectionHotkey: 'CommandOrControl+Shift+E'
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

let cache: Settings | null = null

export function getSettings(): Settings {
  if (cache) return cache
  const path = settingsPath()
  let result: Settings = { ...DEFAULTS }
  if (existsSync(path)) {
    try {
      result = { ...DEFAULTS, ...(JSON.parse(readFileSync(path, 'utf-8')) as Partial<Settings>) }
    } catch {
      // keep defaults on a corrupt file
    }
  }
  cache = result
  return result
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch }
  cache = next
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf-8')
  return next
}
