# AI Clippy

An AI-powered reboot of the classic Microsoft Office assistant — a googly-eyed paperclip that floats on top of everything on your Mac, answers questions, **looks at your screen** for context, and can **do a few things for you** (with your approval). Runs on your choice of a **free local model** or a **free hosted model**.

## What it is

- A **transparent, always-on-top desktop overlay** (Electron). Clippy sits in a corner, above your windows and across Spaces / fullscreen apps.
- **Drag him anywhere** to move the whole thing; click to open/close the chat. The window stays fully on-screen near edges and corners.
- The chat panel is styled like a **white spiral-bound ruled notepad** — blue lines, a red margin, and a spiral binding across the top. The text box is matching white ruled paper.
- The character is inline SVG (no image assets): a silver paperclip with a faint retro **scanline** sheen, **eyes that follow your cursor**, and blink/sway/talk animation.
- Readable chat bubbles: **your** messages are black with white text; **Clippy's** are light grey — same rounded shape and font, so it's easy to tell who's who. Blue-accented buttons tie into the ruled-paper look.
- The panel is **drag-to-resize** (grip at the top-left corner) and remembers its size.
- Chat **streams** token-by-token. Clear the conversation any time with the 🗑 button.

## Providers (pick one in Settings)

Clippy talks to any **OpenAI-compatible** chat server. Built-in presets:

| Provider | Cost | Vision | Notes |
|---|---|---|---|
| **Google Gemini** | Free tier (~1,500 req/day, no card) | ✅ | Fast, best free vision. Key: [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Default model `gemini-3.6-flash`. |
| **Groq** | Free tier (no card) | ✅ | Fastest inference. Key: [console.groq.com/keys](https://console.groq.com/keys). Uses Llama 4 Scout. |
| **LM Studio** | Free, local | ✅ (with a vision model) | Fully offline & private. Load a model + Start Server (`localhost:1234`). |
| **Custom** | — | — | Any OpenAI-compatible base URL + optional key. |

Switch providers, models, and keys any time in ⚙️ — there's a **connection status** dot, a **Test connection** button, and a model picker that lists what the server exposes.

## Privacy

- **Local (LM Studio):** nothing leaves your Mac — text or screenshots.
- **Hosted (Gemini/Groq/custom):** requests and screenshots go to that provider, and **free tiers may use your inputs to improve their models**. Keep sensitive screens (work/rostering data) off hosted models — switch to LM Studio for those.
- **Screenshots are on-demand only** — captured when you tap "Look at my screen" or press the hotkey, never passively. You see the thumbnail before it's sent.
- Settings (including any API key) are stored locally in `~/Library/Application Support/ai-clippy/settings.json`.

## Setup

```bash
npm install
npm run dev
```

On first launch Clippy opens to **Settings**. Pick a **Provider**, paste a key if it needs one (or, for LM Studio, load a vision model and Start Server), **Test connection**, and **Save**.

## Using Clippy

- **Ask:** click Clippy → type in the pad → Enter (Shift+Enter for a newline).
- **Look at my screen:** attach a screenshot so the model can help with what's in front of you. Needs macOS **Screen Recording** permission (see below).
- **Global hotkey:** press **⌘⇧Space** anywhere → Clippy instantly grabs the screen and answers. The shortcut is **configurable** in Settings (click the field, press your combo).
- **Look at a region + OCR:** the **▢ Region** button lets you drag-select part of the screen (macOS native selection) — sharper and more private than the full screen. Once anything is attached, **Extract text** pulls the text out of it verbatim.
- **Attach a file:** the **📎 File** button (or drag a file onto Clippy) loads a **PDF, image, or text file** and lets you ask about it — summarise a report, pull key dates, etc. PDFs are text-extracted; images go to vision.
- **Selection hotkey:** highlight text in *any* app and press **⌘⇧E** → Clippy loads just that selection with one-tap **Summarize / Explain / Improve / Translate** (or type your own instruction). Only the selection is sent. Configurable in Settings; needs Accessibility.
- **Active-app awareness:** Clippy quietly notices which app/window you're in and uses it as context (e.g. "you're in Mail — want me to draft a reply?"). Just the window title; needs Accessibility.
- **Memory:** Clippy remembers facts about you across sessions (name, preferences, recurring details) and uses them in chat. Manage them under the **🧠** button, or approve a "remember" suggestion. Stored locally.
- **Actions (with approval):** ask Clippy to do something and it proposes an **Approve / Dismiss** card. Nothing runs until you approve. Supported: **open a URL**, **open an app**, **web search**, **copy text** to the clipboard, **create a note** (Apple Notes), **show a notification**, **type text** into the focused app, and **remember** a fact about you. No arbitrary commands — every action is a fixed, safe type, individually confirmed.

## Toolbar (header buttons)

🎮 Games · 🎵 Music · 🧠 Memory · 🗑 Clear chat · ⚙️ Settings — plus **–** hide and **×** quit.

## Fun extras

- **🎵 Music:** a dropdown of background tracks that play **in-app** (hidden off-screen player). If a track blocks embedding, Clippy automatically opens it in your browser instead. Edit the list in `TRACKS` in `src/renderer/src/App.tsx`.
- **🎮 Games:** pick **Pong** (mouse paddle vs CPU) or **Space Invaders** (mouse to move, click/space to fire) to pass the time while a model loads. Each has an **Easy / Normal / Hard** setting (remembered) and a New game button. Games only run while their view is open, so they don't drain battery in the background.

### macOS permissions

- **Screen Recording** (for capture): System Settings → Privacy & Security → Screen & System Audio Recording. In dev the app appears as **"Electron"** — enable it, then **restart the app**. (First trigger a capture so it shows up in the list.)
- **Accessibility** (only for the *type text* action): System Settings → Privacy & Security → Accessibility → enable **Electron**.

When packaged as a real app it appears as **"AI Clippy"** and you grant these once.

## How it's wired

```
src/
  main/          Electron main process
    index.ts     window (transparent/always-on-top), drag + edge clamping, screen &
                 region capture, cursor feed, active-app poll, global hotkeys,
                 approved-action execution, dropped/picked file reading, music, IPC
    chat.ts      OpenAI-compatible streaming client (+ vision), system prompt,
                 memory + active-app context injection
    settings.ts  local settings store (provider URL, model, key, hotkeys)
    memory.ts    local "facts about you" store
  preload/       contextBridge — safe window.clippy API
  renderer/      React UI
    src/App.tsx          chat, streaming, screenshot, region/OCR, file attach & drop,
                         selection actions, settings, provider presets, hotkey
                         recorders, memory view, action cards, music & games menus,
                         drag, spiral binding
    src/Clippy.tsx       the SVG character (cursor-tracking eyes, scanlines)
    src/Pong.tsx         Pong mini-game
    src/SpaceInvaders.tsx Space Invaders mini-game
    src/styles.css       notepad theme
```

- The window resizes itself to hug visible content (via a `ResizeObserver` → IPC) and clamps to the display's work area so it never spills off-screen.
- The main process polls the global cursor (for the eyes) and the frontmost app (for context), and streams the model's reply as full-text-so-far so the UI is immune to duplicate events.
- Actions are proposed by the model as a fenced `clippy-action` JSON block, parsed in the UI, and only executed after you Approve.

## Build a distributable app

```bash
npm run dist   # produces a .dmg in dist/ via electron-builder
```

## Known limits / next steps

- Local vision models are rougher than hosted ones at reading busy screens — a good VL model or a hosted provider helps.
- Dropping a file straight onto the transparent always-on-top window can be hit-or-miss on macOS — the **📎 File** button is the reliable way to attach.
- Replies render as plain text (no markdown formatting yet).
- No app icon yet — `electron-builder` uses a default until one is added to `resources/`.
- "Always watching" the screen is intentionally not built (free-tier limits + continuous cloud capture); the hotkey covers the instant-look case instead.
