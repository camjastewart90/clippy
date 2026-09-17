import { JSX, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Clippy, { ClippyState } from './Clippy'
import Pong, { type Difficulty } from './Pong'
import SpaceInvaders from './SpaceInvaders'

interface Message {
  role: 'user' | 'assistant'
  text: string
  image?: string // base64 PNG attached to a user turn
  doc?: { name: string; text: string } // a dropped file's contents
}

interface Action {
  type: string
  value: string
  label: string
}

const ACTION_RE = /```clippy-action\s*([\s\S]*?)```/

// Pull a proposed action out of an assistant reply; return the text with the
// raw block stripped so the user sees a clean sentence, not JSON.
function parseAction(text: string): { clean: string; action: Action | null } {
  let clean = text
  let action: Action | null = null
  const m = text.match(ACTION_RE)
  if (m) {
    try {
      const o = JSON.parse(m[1].trim())
      if (o && o.type && o.value) {
        action = { type: o.type, value: String(o.value), label: o.label || `${o.type}: ${o.value}` }
      }
    } catch {
      // malformed — leave as-is
    }
    clean = text.replace(ACTION_RE, '')
  }
  // hide any half-streamed / unclosed action block so raw JSON never shows
  clean = clean.replace(/```clippy-action[\s\S]*$/, '').trim()
  return { clean, action }
}

const GREETING =
  "Hi! I'm Clippy. Ask me anything, or hit “Look at my screen” and I'll help with whatever you're doing."

function loadNum(key: string, def: number): number {
  try {
    const v = localStorage.getItem(key)
    if (v) {
      const n = parseInt(v, 10)
      if (!Number.isNaN(n)) return n
    }
  } catch {
    // ignore
  }
  return def
}

const clampN = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)

// x positions for the spiral binding rings across the panel
const SPIRAL_X = Array.from({ length: 15 }, (_, i) => 13 + i * 22)

// Background-music tracks. Embeddable ones play in-app; blocked ones fall back
// to opening in the browser automatically.
const TRACKS = [
  { id: 'ihe1QbeGt7U', label: 'Linkin Park Lofi' },
  { id: 'lRaXPHFEbKA', label: 'J. Cole Chill' },
  { id: '3EOxDmSX3Rc', label: 'Mac Miller Grooves' },
  { id: 'go3q9mBsHZ4', label: '420 Vibe / Chill Rap' },
  { id: '6idk_BFKa9U', label: '90s Boom Bap' }
]

interface Preset {
  id: string
  label: string
  baseUrl: string
  model: string
  keyUrl: string
  needsKey: boolean
}

const PRESETS: Preset[] = [
  {
    id: 'gemini',
    label: 'Google Gemini — free, vision',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.6-flash',
    keyUrl: 'https://aistudio.google.com/apikey',
    needsKey: true
  },
  {
    id: 'groq',
    label: 'Groq — free, fastest',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    keyUrl: 'https://console.groq.com/keys',
    needsKey: true
  },
  {
    id: 'lmstudio',
    label: 'LM Studio — local',
    baseUrl: 'http://localhost:1234/v1',
    model: '',
    keyUrl: '',
    needsKey: false
  },
  { id: 'custom', label: 'Custom', baseUrl: '', model: '', keyUrl: '', needsKey: false }
]

function presetForUrl(url: string): string {
  return PRESETS.find((p) => p.id !== 'custom' && p.baseUrl === url)?.id ?? 'custom'
}

// Build an Electron accelerator string from a keydown (needs ≥1 modifier + a key).
function accelFromEvent(e: React.KeyboardEvent): string | null {
  const mods: string[] = []
  if (e.metaKey) mods.push('Command')
  if (e.ctrlKey) mods.push('Control')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  const k = e.key
  let key = ''
  if (k === ' ' || e.code === 'Space') key = 'Space'
  else if (/^[a-z]$/i.test(k)) key = k.toUpperCase()
  else if (/^[0-9]$/.test(k)) key = k
  else if (/^F\d{1,2}$/.test(k)) key = k
  if (!key || mods.length === 0) return null
  return [...mods, key].join('+')
}

function prettyKey(a: string): string {
  return a
    .replace('CommandOrControl', '⌘')
    .replace('Command', '⌘')
    .replace('Control', '⌃')
    .replace('Alt', '⌥')
    .replace('Shift', '⇧')
    .replace(/\+/g, ' ')
}

export default function App(): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [view, setView] = useState<'chat' | 'settings' | 'memory' | 'pong' | 'invaders'>('chat')
  const [gameKey, setGameKey] = useState(0)
  const [gamesOpen, setGamesOpen] = useState(false)
  const [difficulty, setDifficulty] = useState<Difficulty>(() => {
    try {
      const v = localStorage.getItem('clippy.difficulty')
      if (v === 'easy' || v === 'normal' || v === 'hard') return v
    } catch {
      /* ignore */
    }
    return 'normal'
  })

  function setDiff(d: Difficulty): void {
    setDifficulty(d)
    setGameKey((k) => k + 1)
    try {
      localStorage.setItem('clippy.difficulty', d)
    } catch {
      /* ignore */
    }
  }
  const [memories, setMemories] = useState<string[]>([])
  const [memInput, setMemInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [pendingImage, setPendingImage] = useState<string | null>(null)
  const [pendingDoc, setPendingDoc] = useState<{ name: string; text: string } | null>(null)

  // Drag-and-drop must be handled at the document level in Electron, and every
  // dragover must preventDefault or macOS refuses the drop.
  useEffect(() => {
    const over = (e: DragEvent): void => {
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const drop = async (e: DragEvent): Promise<void> => {
      e.preventDefault()
      const f = e.dataTransfer?.files?.[0]
      if (!f) return
      const path = window.clippy.getPathForFile(f)
      setExpanded(true)
      setView('chat')
      const res = await window.clippy.readDrop(path)
      if (res.error) {
        setMessages((p) => [...p, { role: 'assistant', text: `⚠️ ${res.error}` }])
      } else if (res.kind === 'image' && res.base64) {
        setPendingImage(res.base64)
      } else if (res.kind === 'text' && res.text) {
        setPendingDoc({ name: res.name || 'file', text: res.text })
      }
    }
    document.addEventListener('dragover', over)
    document.addEventListener('drop', drop)
    return () => {
      document.removeEventListener('dragover', over)
      document.removeEventListener('drop', drop)
    }
  }, [])

  const [baseUrl, setBaseUrl] = useState('http://localhost:1234/v1')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [provider, setProvider] = useState('lmstudio')
  const [models, setModels] = useState<string[]>([])
  const [conn, setConn] = useState<'checking' | 'ok' | 'down'>('checking')
  const [pickOpen, setPickOpen] = useState(false)
  const [hotkey, setHotkey] = useState('CommandOrControl+Shift+Space')
  const [selHotkey, setSelHotkey] = useState('CommandOrControl+Shift+E')
  const [recording, setRecording] = useState(false)
  const [recordingSel, setRecordingSel] = useState(false)
  const [hotkeyWarn, setHotkeyWarn] = useState(false)
  const [pendingSelection, setPendingSelection] = useState<string | null>(null)
  const [musicOpen, setMusicOpen] = useState(false)
  const [musicTrack, setMusicTrack] = useState<string | null>(null)

  async function playTrack(id: string): Promise<void> {
    const r = await window.clippy.playTrack(id)
    setMusicTrack(r.playing)
    setMusicOpen(false)
  }
  async function stopMusic(): Promise<void> {
    const r = await window.clippy.stopMusic()
    setMusicTrack(r.playing)
    setMusicOpen(false)
  }

  const [panelWidth, setPanelWidth] = useState(() => loadNum('clippy.panelWidth', 340))
  const [listHeight, setListHeight] = useState(() => loadNum('clippy.listHeight', 360))
  const panelWidthRef = useRef(panelWidth)
  panelWidthRef.current = panelWidth
  const listHeightRef = useRef(listHeight)
  listHeightRef.current = listHeight
  const resizeRef = useRef<{ sx: number; sy: number; w: number; h: number } | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem('clippy.panelWidth', String(panelWidth))
    } catch {
      /* ignore */
    }
  }, [panelWidth])
  useEffect(() => {
    try {
      localStorage.setItem('clippy.listHeight', String(listHeight))
    } catch {
      /* ignore */
    }
  }, [listHeight])

  const onResizeMove = useCallback((e: MouseEvent) => {
    const r = resizeRef.current
    if (!r) return
    setPanelWidth(clampN(r.w - (e.screenX - r.sx), 280, 680))
    setListHeight(clampN(r.h - (e.screenY - r.sy), 160, 720))
  }, [])
  const onResizeUp = useCallback(() => {
    window.removeEventListener('mousemove', onResizeMove)
    window.removeEventListener('mouseup', onResizeUp)
    resizeRef.current = null
  }, [onResizeMove])
  const onResizeDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      resizeRef.current = { sx: e.screenX, sy: e.screenY, w: panelWidthRef.current, h: listHeightRef.current }
      window.addEventListener('mousemove', onResizeMove)
      window.addEventListener('mouseup', onResizeUp)
    },
    [onResizeMove, onResizeUp]
  )

  const activePreset = PRESETS.find((p) => p.id === provider) ?? PRESETS[PRESETS.length - 1]

  function applyPreset(id: string): void {
    setProvider(id)
    const p = PRESETS.find((x) => x.id === id)
    if (!p || p.id === 'custom') return
    setBaseUrl(p.baseUrl)
    setModel(p.model)
  }

  const [acted, setActed] = useState<Record<number, boolean>>({})

  const contentRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef<Message[]>([])
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  async function checkConnection(): Promise<boolean> {
    setConn('checking')
    const res = await window.clippy.checkServer()
    if (res.ok) {
      setModels(res.models ?? [])
      setConn('ok')
      return true
    }
    setConn('down')
    return false
  }

  // --- load settings + probe the local server once ---
  useEffect(() => {
    window.clippy.getSettings().then(async (s) => {
      setBaseUrl(s.baseUrl)
      setModel(s.model)
      setApiKey(s.apiKey)
      setHotkey(s.hotkey)
      setSelHotkey(s.selectionHotkey)
      setProvider(presetForUrl(s.baseUrl))
      const ok = await checkConnection()
      if (!ok) {
        setExpanded(true)
        setView('settings')
      }
    })
  }, [])

  // --- wire up streaming events ---
  useEffect(() => {
    const offDelta = window.clippy.onDelta((textSoFar) => {
      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        // Replace (not append): main sends the full text so far, so this is
        // idempotent and immune to any duplicate stream events.
        if (last && last.role === 'assistant') last.text = textSoFar
        return next
      })
    })
    const offDone = window.clippy.onDone(() => setStreaming(false))
    const offError = window.clippy.onError((msg) => {
      setStreaming(false)
      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last && last.role === 'assistant' && last.text === '') last.text = `⚠️ ${msg}`
        else next.push({ role: 'assistant', text: `⚠️ ${msg}` })
        return next
      })
    })
    return () => {
      offDelta()
      offDone()
      offError()
    }
  }, [])

  // --- load remembered facts once ---
  useEffect(() => {
    window.clippy.getMemories().then(setMemories)
  }, [])

  // --- global hotkey: capture + ask instantly ---
  useEffect(() => {
    return window.clippy.onQuickLook((base64) => {
      setExpanded(true)
      setView('chat')
      const userMsg: Message = {
        role: 'user',
        text: 'What am I looking at? Help me with what I am doing here.',
        image: base64
      }
      setPendingImage(null)
      sendPayload([...messagesRef.current, userMsg])
    })
  }, [])

  // --- music fell back to the browser (track blocks embedding) ---
  useEffect(() => {
    return window.clippy.onMusicFallback(() => {
      setMusicTrack(null)
      setMessages((p) => [
        ...p,
        { role: 'assistant', text: '🎵 That track blocks embedding — opened it in your browser instead.' }
      ])
    })
  }, [])

  // --- selection hotkey: act on highlighted text from any app ---
  useEffect(() => {
    return window.clippy.onSelection((text) => {
      setExpanded(true)
      setView('chat')
      setPendingSelection(text)
    })
  }, [])

  // --- keep the window sized to the visible content ---
  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    const sync = (): void => {
      const r = el.getBoundingClientRect()
      window.clippy.resize(Math.ceil(r.width) + 2, Math.ceil(r.height) + 2)
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [expanded, view, pendingImage])

  // --- autoscroll the transcript ---
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, streaming])

  function sendPayload(history: Message[]): void {
    // Only the most recent user turn keeps its screenshot — cheaper, and older
    // context rarely needs the pixels again.
    let lastUserIdx = -1
    history.forEach((m, i) => {
      if (m.role === 'user') lastUserIdx = i
    })
    const turns = history.map((m, i) => {
      const keep = i === lastUserIdx
      let text = m.text
      if (keep && m.doc) {
        text = `Regarding the file "${m.doc.name}":\n"""\n${m.doc.text}\n"""\n\n${m.text}`
      }
      return { role: m.role, text, image: keep ? m.image : undefined }
    })
    setStreaming(true)
    setMessages([...history, { role: 'assistant', text: '' }])
    window.clippy.send(turns)
  }

  function actOnSelection(instruction: string): void {
    if (!pendingSelection || streaming) return
    const userMsg: Message = { role: 'user', text: `${instruction}:\n\n"""\n${pendingSelection}\n"""` }
    const history = [...messages, userMsg]
    setMessages(history)
    setPendingSelection(null)
    setInput('')
    sendPayload(history)
  }

  function handleSend(): void {
    if (pendingSelection && !streaming) {
      actOnSelection(input.trim() || 'Help me with this')
      return
    }
    const text = input.trim()
    if ((!text && !pendingImage && !pendingDoc) || streaming) return
    const userMsg: Message = {
      role: 'user',
      text: text || (pendingDoc ? 'Summarise this and pull out the key points.' : 'What am I looking at?'),
      image: pendingImage ?? undefined,
      doc: pendingDoc ?? undefined
    }
    const history = [...messages, userMsg]
    setMessages(history)
    setInput('')
    setPendingImage(null)
    setPendingDoc(null)
    sendPayload(history)
  }

  async function handleCapture(): Promise<void> {
    setCapturing(true)
    try {
      const res = await window.clippy.capture()
      if (res.base64) setPendingImage(res.base64)
      else if (res.error) setMessages((p) => [...p, { role: 'assistant', text: `⚠️ ${res.error}` }])
    } finally {
      setCapturing(false)
    }
  }

  async function handleRegion(): Promise<void> {
    setCapturing(true)
    try {
      const res = await window.clippy.captureRegion()
      if (res.base64) setPendingImage(res.base64)
      else if (res.error) setMessages((p) => [...p, { role: 'assistant', text: `⚠️ ${res.error}` }])
      // cancelled → do nothing
    } finally {
      setCapturing(false)
    }
  }

  async function handleAttach(): Promise<void> {
    const res = await window.clippy.pickFile()
    if (!res || res.cancelled) return
    setExpanded(true)
    setView('chat')
    if (res.error) setMessages((p) => [...p, { role: 'assistant', text: `⚠️ ${res.error}` }])
    else if (res.kind === 'image' && res.base64) setPendingImage(res.base64)
    else if (res.kind === 'text' && res.text) setPendingDoc({ name: res.name || 'file', text: res.text })
  }

  function sendImagePrompt(prompt: string): void {
    if (!pendingImage || streaming) return
    const userMsg: Message = { role: 'user', text: prompt, image: pendingImage }
    const history = [...messages, userMsg]
    setMessages(history)
    setInput('')
    setPendingImage(null)
    sendPayload(history)
  }

  async function addMemory(): Promise<void> {
    const t = memInput.trim()
    if (!t) return
    setMemories(await window.clippy.addMemory(t))
    setMemInput('')
  }

  function stop(): void {
    window.clippy.cancel()
    setStreaming(false)
  }

  function clearChat(): void {
    if (streaming) window.clippy.cancel()
    setStreaming(false)
    setMessages([])
    setActed({})
    setPendingImage(null)
  }

  // --- drag the whole overlay by grabbing the paperclip (click still toggles) ---
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null)
  const suppressClickRef = useRef(false)

  function onClippyMove(e: MouseEvent): void {
    const d = dragRef.current
    if (!d) return
    const dx = e.screenX - d.sx
    const dy = e.screenY - d.sy
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true
    if (d.moved) window.clippy.windowMove(d.ox + dx, d.oy + dy)
  }

  function onClippyUp(): void {
    window.removeEventListener('mousemove', onClippyMove)
    window.removeEventListener('mouseup', onClippyUp)
    if (dragRef.current?.moved) suppressClickRef.current = true
    dragRef.current = null
  }

  async function onClippyDown(e: React.MouseEvent): Promise<void> {
    if (e.button !== 0) return
    const pos = await window.clippy.windowPos()
    dragRef.current = { sx: e.screenX, sy: e.screenY, ox: pos.x, oy: pos.y, moved: false }
    window.addEventListener('mousemove', onClippyMove)
    window.addEventListener('mouseup', onClippyUp)
  }

  function onClippyClick(): void {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    setExpanded((v) => !v)
  }

  async function approve(i: number, action: Action): Promise<void> {
    setActed((a) => ({ ...a, [i]: true }))
    const res = await window.clippy.runAction(action)
    setMessages((prev) => [
      ...prev,
      { role: 'assistant', text: res.ok ? `✅ ${res.message}` : `⚠️ ${res.message}` }
    ])
    if (action.type === 'remember' && res.ok) window.clippy.getMemories().then(setMemories)
  }

  function dismiss(i: number): void {
    setActed((a) => ({ ...a, [i]: true }))
  }

  async function saveSettings(): Promise<void> {
    const s = await window.clippy.saveSettings({ baseUrl, model, apiKey, hotkey, selectionHotkey: selHotkey })
    setBaseUrl(s.baseUrl)
    setModel(s.model)
    setApiKey(s.apiKey)
    setHotkey(s.hotkey)
    setSelHotkey(s.selectionHotkey)
    setProvider(presetForUrl(s.baseUrl))
    const badHotkey = s.hotkeyOk === false
    setHotkeyWarn(badHotkey)
    const ok = await checkConnection()
    if (ok && !badHotkey) setView('chat')
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const clippyState: ClippyState = streaming ? 'talking' : capturing ? 'thinking' : 'idle'

  const diffRow = (
    <div className="diffrow">
      {(['easy', 'normal', 'hard'] as Difficulty[]).map((d) => (
        <button
          key={d}
          className={`ghost ${difficulty === d ? 'ghost--on' : ''}`}
          onClick={() => setDiff(d)}
        >
          {d}
        </button>
      ))}
    </div>
  )

  return (
    <div className="stage">
      <div className="content" ref={contentRef}>
        {expanded && (
          <div className="panel" style={{ width: panelWidth }}>
            {view === 'chat' && (
              <div className="resize-grip" onMouseDown={onResizeDown} title="Drag to resize" />
            )}
            <svg
              className="spiral"
              viewBox="0 -5 340 22"
              width="100%"
              height="22"
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="coil" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#eef2f6" />
                  <stop offset="0.55" stopColor="#aab4c2" />
                  <stop offset="1" stopColor="#7b8798" />
                </linearGradient>
              </defs>
              {SPIRAL_X.map((x) => (
                <g key={x}>
                  <ellipse cx={x} cy={11} rx={3.4} ry={3} fill="#8a7c34" opacity="0.55" />
                  <rect
                    x={x - 2}
                    y={-5}
                    width={4}
                    height={14}
                    rx={2}
                    fill="url(#coil)"
                    transform={`rotate(14 ${x} 4)`}
                  />
                </g>
              ))}
            </svg>
            <header className="panel__bar">
              <span className="panel__title">
                {view === 'settings'
                  ? 'Settings'
                  : view === 'memory'
                    ? 'Memory'
                    : view === 'pong'
                      ? 'Pong'
                      : view === 'invaders'
                        ? 'Space Invaders'
                        : ''}
              </span>
              <div className="panel__actions">
                <button
                  className={`iconbtn ${view === 'pong' || view === 'invaders' ? 'iconbtn--on' : ''}`}
                  title="Games"
                  onClick={() => {
                    setGamesOpen((o) => !o)
                    setMusicOpen(false)
                  }}
                >
                  {'🎮'}
                </button>
                <button
                  className={`iconbtn ${musicTrack ? 'iconbtn--on' : ''}`}
                  title="Music"
                  onClick={() => {
                    setMusicOpen((o) => !o)
                    setGamesOpen(false)
                  }}
                >
                  {'🎵'}
                </button>
                {view === 'chat' && messages.length > 0 && (
                  <button className="iconbtn" title="Clear chat" onClick={clearChat}>
                    {'🗑'}
                  </button>
                )}
                <button
                  className="iconbtn"
                  title="Memory"
                  onClick={() => setView(view === 'memory' ? 'chat' : 'memory')}
                >
                  {'🧠'}
                </button>
                <button
                  className="iconbtn"
                  title="Settings"
                  onClick={() => setView(view === 'settings' ? 'chat' : 'settings')}
                >
                  {'⚙️'}
                </button>
                <button className="iconbtn" title="Hide" onClick={() => setExpanded(false)}>
                  {'–'}
                </button>
                <button className="iconbtn" title="Quit" onClick={() => window.clippy.quit()}>
                  {'×'}
                </button>
              </div>
            </header>

            {musicOpen && (
              <div className="musicmenu">
                {TRACKS.map((t) => (
                  <button
                    key={t.id}
                    className={`musicmenu__item ${musicTrack === t.id ? 'musicmenu__item--on' : ''}`}
                    onClick={() => playTrack(t.id)}
                  >
                    {musicTrack === t.id ? '▶ ' : ''}
                    {t.label}
                  </button>
                ))}
                {musicTrack && (
                  <button className="musicmenu__item musicmenu__stop" onClick={stopMusic}>
                    {'■ Stop'}
                  </button>
                )}
              </div>
            )}

            {gamesOpen && (
              <div className="musicmenu">
                <button
                  className={`musicmenu__item ${view === 'pong' ? 'musicmenu__item--on' : ''}`}
                  onClick={() => {
                    setView('pong')
                    setGamesOpen(false)
                  }}
                >
                  Pong
                </button>
                <button
                  className={`musicmenu__item ${view === 'invaders' ? 'musicmenu__item--on' : ''}`}
                  onClick={() => {
                    setView('invaders')
                    setGamesOpen(false)
                  }}
                >
                  Space Invaders
                </button>
                {(view === 'pong' || view === 'invaders') && (
                  <button
                    className="musicmenu__item musicmenu__stop"
                    onClick={() => {
                      setView('chat')
                      setGamesOpen(false)
                    }}
                  >
                    Close game
                  </button>
                )}
              </div>
            )}

            {view === 'settings' ? (
              <div className="settings">
                <div className={`status status--${conn}`}>
                  <span className="status__dot" />
                  {conn === 'checking'
                    ? 'Checking local server…'
                    : conn === 'ok'
                      ? models.length
                        ? `Connected — ${models.length} model${models.length > 1 ? 's' : ''} loaded`
                        : 'Connected, but no model is loaded'
                      : 'No local server found'}
                </div>

                <label className="settings__label">Provider</label>
                <select
                  className="settings__input"
                  value={provider}
                  onChange={(e) => applyPreset(e.target.value)}
                >
                  {PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>

                {activePreset.needsKey && (
                  <>
                    <label className="settings__label">API key</label>
                    <input
                      className="settings__input"
                      type="password"
                      placeholder="paste your free key"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                    />
                    {activePreset.keyUrl && (
                      <button className="linkbtn" onClick={() => window.clippy.openExternal(activePreset.keyUrl)}>
                        Get a free key {'↗'}
                      </button>
                    )}
                  </>
                )}

                <label className="settings__label">Server URL</label>
                <input
                  className="settings__input"
                  type="text"
                  placeholder="http://localhost:1234/v1"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />

                <label className="settings__label">Model</label>
                <div className="modelpick">
                  <input
                    className="settings__input"
                    type="text"
                    placeholder="blank = auto-detect"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  />
                  {models.length > 0 && (
                    <button
                      className="modelpick__toggle"
                      title="Pick a loaded model"
                      onClick={() => setPickOpen((o) => !o)}
                    >
                      {'▾'}
                    </button>
                  )}
                </div>
                {pickOpen && models.length > 0 && (
                  <div className="modellist">
                    {models.map((m) => (
                      <button
                        key={m}
                        className="modellist__item"
                        onClick={() => {
                          setModel(m)
                          setPickOpen(false)
                        }}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}

                <button className="linkbtn" onClick={checkConnection}>
                  Test connection {'↻'}
                </button>

                <label className="settings__label">Capture hotkey</label>
                <button
                  className={`settings__input hotkeyrec ${recording ? 'hotkeyrec--on' : ''}`}
                  onClick={() => setRecording(true)}
                  onBlur={() => setRecording(false)}
                  onKeyDown={(e) => {
                    if (!recording) return
                    e.preventDefault()
                    if (e.key === 'Escape') return setRecording(false)
                    const a = accelFromEvent(e)
                    if (a) {
                      setHotkey(a)
                      setHotkeyWarn(false)
                      setRecording(false)
                    }
                  }}
                >
                  {recording ? 'Press keys…' : prettyKey(hotkey)}
                </button>
                {hotkeyWarn && (
                  <div className="settings__warn">
                    A shortcut is taken by another app — pick a different combo.
                  </div>
                )}

                <label className="settings__label">Selection hotkey</label>
                <button
                  className={`settings__input hotkeyrec ${recordingSel ? 'hotkeyrec--on' : ''}`}
                  onClick={() => setRecordingSel(true)}
                  onBlur={() => setRecordingSel(false)}
                  onKeyDown={(e) => {
                    if (!recordingSel) return
                    e.preventDefault()
                    if (e.key === 'Escape') return setRecordingSel(false)
                    const a = accelFromEvent(e)
                    if (a) {
                      setSelHotkey(a)
                      setHotkeyWarn(false)
                      setRecordingSel(false)
                    }
                  }}
                >
                  {recordingSel ? 'Press keys…' : prettyKey(selHotkey)}
                </button>

                <p className="settings__note">
                  {activePreset.needsKey
                    ? 'Free hosted model. Note: screenshots are sent to the provider, and free tiers may use your data to improve their models — keep sensitive screens off it.'
                    : 'Local model — free, offline, private (nothing leaves this Mac). In LM Studio, load a vision model and Start Server (Developer tab). Vision needs a vision-capable model.'}
                </p>
                <button className="primary" onClick={saveSettings}>
                  Save
                </button>
              </div>
            ) : view === 'memory' ? (
              <div className="settings">
                <p className="settings__note">
                  Clippy keeps these across sessions and uses them in chats. Stored locally on this Mac.
                </p>
                {memories.length === 0 && <div className="mem-empty">Nothing remembered yet.</div>}
                {memories.map((m, i) => (
                  <div className="mem-item" key={i}>
                    <span>{m}</span>
                    <button
                      className="composer__shotx"
                      title="Forget"
                      onClick={async () => setMemories(await window.clippy.removeMemory(i))}
                    >
                      {'×'}
                    </button>
                  </div>
                ))}
                <div className="modelpick">
                  <input
                    className="settings__input"
                    placeholder="Add something to remember…"
                    value={memInput}
                    onChange={(e) => setMemInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addMemory()
                      }
                    }}
                  />
                  <button className="modelpick__toggle" title="Add" onClick={addMemory}>
                    {'+'}
                  </button>
                </div>
                {memories.length > 0 && (
                  <button
                    className="linkbtn"
                    onClick={async () => setMemories(await window.clippy.clearMemories())}
                  >
                    Forget everything
                  </button>
                )}
              </div>
            ) : view === 'pong' ? (
              <div className="settings">
                <Pong key={gameKey} difficulty={difficulty} />
                {diffRow}
                <button className="primary" onClick={() => setGameKey((k) => k + 1)}>
                  New game
                </button>
              </div>
            ) : view === 'invaders' ? (
              <div className="settings">
                <SpaceInvaders key={gameKey} difficulty={difficulty} />
                {diffRow}
                <button className="primary" onClick={() => setGameKey((k) => k + 1)}>
                  New game
                </button>
              </div>
            ) : (
              <>
                <div className="transcript" ref={scrollRef} style={{ height: listHeight }}>
                  {messages.length === 0 && <div className="bubble bubble--bot">{GREETING}</div>}
                  {messages.map((m, i) => {
                    if (m.role === 'user') {
                      return (
                        <div key={i} className="bubble bubble--me">
                          {m.image && (
                            <img className="bubble__shot" src={`data:image/png;base64,${m.image}`} alt="screenshot" />
                          )}
                          {m.doc && <div className="bubble__doc">{'📄'} {m.doc.name}</div>}
                          {m.text}
                        </div>
                      )
                    }
                    const { clean, action } = parseAction(m.text)
                    const isLast = i === messages.length - 1
                    const showCard = action && !acted[i] && !(streaming && isLast)
                    return (
                      <div key={i}>
                        <div className="bubble bubble--bot">
                          {m.image && (
                            <img className="bubble__shot" src={`data:image/png;base64,${m.image}`} alt="screenshot" />
                          )}
                          {clean || (streaming && isLast ? <span className="dots">{'…'}</span> : '')}
                        </div>
                        {showCard && action && (
                          <div className="actioncard">
                            <div className="actioncard__label">
                              <b>Clippy wants to:</b> {action.label}
                            </div>
                            <div className="actioncard__row">
                              <button className="ghost" onClick={() => dismiss(i)}>
                                Dismiss
                              </button>
                              <button className="primary" onClick={() => approve(i, action)}>
                                Approve
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                <div className="composer">
                  {pendingSelection && (
                    <div className="selcard">
                      <div className="selcard__head">
                        <span>Selected text</span>
                        <button
                          className="composer__shotx"
                          title="Clear"
                          onClick={() => setPendingSelection(null)}
                        >
                          {'×'}
                        </button>
                      </div>
                      <div className="selcard__preview">
                        {pendingSelection.slice(0, 160)}
                        {pendingSelection.length > 160 ? '…' : ''}
                      </div>
                      <div className="selcard__actions">
                        <button className="ghost" onClick={() => actOnSelection('Summarize this')}>
                          Summarize
                        </button>
                        <button className="ghost" onClick={() => actOnSelection('Explain this clearly')}>
                          Explain
                        </button>
                        <button
                          className="ghost"
                          onClick={() => actOnSelection('Rewrite this to be clearer and more concise')}
                        >
                          Improve
                        </button>
                        <button className="ghost" onClick={() => actOnSelection('Translate this to English')}>
                          Translate
                        </button>
                      </div>
                    </div>
                  )}
                  {pendingImage && (
                    <div className="composer__shot">
                      <img src={`data:image/png;base64,${pendingImage}`} alt="pending screenshot" />
                      <button className="composer__shotx" onClick={() => setPendingImage(null)} title="Remove">
                        {'×'}
                      </button>
                      <span>Attached</span>
                      <button
                        className="linkbtn"
                        disabled={streaming}
                        onClick={() =>
                          sendImagePrompt('Extract all text from this image, exactly as written. Output only the text.')
                        }
                      >
                        Extract text
                      </button>
                    </div>
                  )}
                  {pendingDoc && (
                    <div className="composer__shot">
                      <span>{'📄'} {pendingDoc.name}</span>
                      <button className="composer__shotx" onClick={() => setPendingDoc(null)} title="Remove">
                        {'×'}
                      </button>
                    </div>
                  )}
                  <textarea
                    className="composer__input"
                    rows={2}
                    placeholder={'Ask Clippy…'}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={onKeyDown}
                  />
                  <div className="composer__row">
                    <div className="composer__caps">
                      <button className="ghost" onClick={handleCapture} disabled={capturing || streaming}>
                        {capturing ? '…' : '👀 Screen'}
                      </button>
                      <button className="ghost" onClick={handleRegion} disabled={capturing || streaming}>
                        {'▢ Region'}
                      </button>
                      <button className="ghost" onClick={handleAttach} disabled={streaming}>
                        {'📎 File'}
                      </button>
                    </div>
                    {streaming ? (
                      <button className="primary" onClick={stop}>
                        Stop
                      </button>
                    ) : (
                      <button className="primary" onClick={handleSend}>
                        Send
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        <div className="dock">
          <Clippy
            state={clippyState}
            title={expanded ? 'Hide Clippy (drag to move)' : 'Open Clippy (drag to move)'}
            onClick={onClippyClick}
            onMouseDown={onClippyDown}
          />
        </div>
      </div>
    </div>
  )
}
