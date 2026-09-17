// Talks to a local, OpenAI-compatible chat server (LM Studio on
// http://localhost:1234/v1 by default; Ollama's /v1 works too). Streaming +
// vision, no API key, fully offline.

export interface Turn {
  role: 'user' | 'assistant'
  text: string
  image?: string // base64 PNG attached to a user turn
}

export const SYSTEM_PROMPT = `You are Clippy, an AI-powered reboot of the classic Microsoft Office assistant — a friendly, slightly cheeky paperclip who lives on the user's desktop.

Personality:
- Warm, upbeat, and concise. A little playful, never annoying or condescending.
- You may occasionally nod to your nostalgic origins ("It looks like you're writing a letter!") but only when it genuinely fits — don't force the bit.

How you help:
- You are a genuinely useful assistant first, character second. Give real, correct, practical answers.
- Keep replies short and scannable by default (a few sentences or a tight list). The user can ask you to go deeper.
- When the user shares a screenshot of their screen, ground your help in what you can actually see. Describe what you notice, then offer specific, relevant next steps. Never pretend to see something you can't.
- If you're unsure, say so briefly rather than guessing.

Never invent facts about the user's files, accounts, or data that you cannot see.

Taking actions on the user's Mac:
- When the user clearly wants something done that you can do, you may propose ONE action. The user always approves it before it runs — never assume it happened.
- Propose it by ending your reply with a single fenced block, exactly this shape:
\`\`\`clippy-action
{"type": "open_url", "value": "https://example.com", "label": "Open example.com"}
\`\`\`
- Allowed types only:
  - "open_url" — value = a full https URL
  - "open_app" — value = a macOS app name like "Safari" or "Notes"
  - "type_text" — value = text to type into whatever app is focused
  - "web_search" — value = a search query (opens the results in the browser)
  - "copy_text" — value = text to place on the clipboard
  - "create_note" — value = the note's contents (creates a new note in Apple Notes)
  - "show_notification" — value = a short message to show as a macOS notification
  - "remember" — value = a concise fact worth remembering about the user (their name, preferences, recurring details). Propose this when the user shares something durable, or asks you to remember it.
- Write a short sentence before the block. Include the block only when an action is genuinely wanted. Never propose anything destructive (deleting, overwriting, sending money, changing settings).`

export interface StreamOptions {
  baseUrl: string
  model: string
  apiKey?: string
  memories?: string[]
  activeApp?: string
  messages: Turn[]
  onText: (textSoFar: string) => void
  signal?: AbortSignal
}

function systemFor(memories?: string[], activeApp?: string): string {
  let s = SYSTEM_PROMPT
  if (memories && memories.length > 0) {
    s += `\n\nWhat you remember about the user (use it naturally when relevant):\n${memories.map((m) => `- ${m}`).join('\n')}`
  }
  if (activeApp) {
    s += `\n\nThe user currently appears to be working in: ${activeApp}. Use this for context only when relevant; don't mention it unprompted.`
  }
  return s
}

function authHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
}

type OpenAIContent = string | Array<Record<string, unknown>>

function toOpenAIMessages(
  turns: Turn[],
  memories?: string[],
  activeApp?: string
): Array<{ role: string; content: OpenAIContent }> {
  const msgs: Array<{ role: string; content: OpenAIContent }> = [
    { role: 'system', content: systemFor(memories, activeApp) }
  ]
  for (const t of turns) {
    if (t.image) {
      msgs.push({
        role: t.role,
        content: [
          { type: 'text', text: t.text },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${t.image}` } }
        ]
      })
    } else {
      msgs.push({ role: t.role, content: t.text })
    }
  }
  return msgs
}

const trimUrl = (u: string): string => u.replace(/\/+$/, '')

/** List model ids the server exposes. */
export async function listModels(baseUrl: string, apiKey?: string): Promise<string[]> {
  const res = await fetch(`${trimUrl(baseUrl)}/models`, { headers: authHeaders(apiKey) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = (await res.json()) as { data?: Array<{ id: string }> }
  return (json.data ?? []).map((m) => m.id)
}

export async function streamReply(opts: StreamOptions): Promise<string> {
  const res = await fetch(`${trimUrl(opts.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(opts.apiKey) },
    body: JSON.stringify({
      model: opts.model,
      messages: toOpenAIMessages(opts.messages, opts.memories, opts.activeApp),
      stream: true,
      temperature: 0.6,
      max_tokens: 4096
    }),
    signal: opts.signal
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Local server responded ${res.status}. ${body.slice(0, 200)}`)
  }
  if (!res.body) throw new Error('No response body from the local server.')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') return full
      try {
        const json = JSON.parse(data)
        const delta: string | undefined = json.choices?.[0]?.delta?.content
        if (delta) {
          full += delta
          opts.onText(full) // send the full text so far — the UI replaces, not appends
        }
      } catch {
        // ignore keep-alive / non-JSON lines
      }
    }
  }
  return full
}
