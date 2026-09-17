import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

// A tiny local store of things Clippy remembers about the user. Plain strings,
// injected into the system prompt each turn. Never leaves the Mac except as part
// of a normal chat request to whichever model the user chose.

const MAX = 60

function file(): string {
  return join(app.getPath('userData'), 'memory.json')
}

let cache: string[] | null = null

export function getMemories(): string[] {
  if (cache) return cache
  if (existsSync(file())) {
    try {
      const parsed = JSON.parse(readFileSync(file(), 'utf-8'))
      cache = Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []
      return cache
    } catch {
      // fall through
    }
  }
  cache = []
  return cache
}

function save(list: string[]): string[] {
  cache = list.slice(0, MAX)
  writeFileSync(file(), JSON.stringify(cache, null, 2), 'utf-8')
  return cache
}

export function addMemory(text: string): string[] {
  const t = text.trim()
  if (!t) return getMemories()
  const list = getMemories()
  if (list.includes(t)) return list
  return save([...list, t])
}

export function removeMemory(index: number): string[] {
  const list = getMemories()
  if (index < 0 || index >= list.length) return list
  return save(list.filter((_, i) => i !== index))
}

export function clearMemories(): string[] {
  return save([])
}
