# LLM Page Translator

Chrome extension for translating webpages using any OpenAI-compatible API (local models, OpenAI, or any provider).

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- npm (ships with Node.js)

## Setup

```bash
npm install
```

## Build

```bash
npm run build
```

Output goes to `dist/`. The build bundles TypeScript via esbuild, copies HTML/CSS/manifest, and includes icons.

## Development (watch mode)

```bash
npm run dev
```

Rebuilds automatically on file changes.

## Load into Chrome

1. Go to `chrome://extensions`
2. Enable **Developer mode** (toggle top-right)
3. Click **Load unpacked**
4. Select the `dist/` directory

## Clean

```bash
npm run clean
```

Removes the `dist/` directory.

## Features

### Core Translation Pipeline
- Text extraction via `TreeWalker`, wraps each text node in `<span>` with `data-translation-id`, preserves structure
- Priority queue (lower number = higher priority), items sorted by priority then FIFO
- Parallel API workers (configurable, default 32 concurrent calls)
- Batch builder groups paragraphs into chunks of `maxChars` (default 4000)
- Oversized paragraphs split at `\n\n` → `\n` → `. ` → hard cut, recombined after translation
- Results streamed incrementally after each sub-batch for progressive display
- Stuck element recovery: reverts stuck "translating" elements and re-enqueues after 2s of queue emptiness

### API Client
- OpenAI-compatible Chat Completions (`POST /v1/chat/completions`)
- Bearer token auth (optional, empty for local models)
- Configurable timeout (default 60s), temperature, top_p, top_k, min_p, presence_penalty
- `{"enable_thinking": false}` sent by default to disable reasoning tokens (overridable)
- Retry with exponential backoff (1s, 2s, 4s), HTTP 401 is not retried
- Connection test button in settings

### SPA / Dynamic Content Support
- `MutationObserver` with 400ms debounce detects new content
- Detects SPA navigation via `popstate`, `hashchange`, and monkey-patched `history.pushState`/`replaceState`
- 300ms initial wait for client-side frameworks (React, Vue, etc.) to render
- 800ms delay after URL change before re-scanning

### Per-Site Configuration
- Auto-created on first visit with sensible defaults
- Built-in presets: qidian.com, m.qidian.com, novelupdates.com, fanyi.baidu.com
- Each site: **mode** (`off` / `on` / `auto`), prompt, language pair, observe selector, content selector, ignore selectors, priority rules
- Mode controls behavior:
  - `off` — extension does nothing on this site
  - `on` — manual mode: shows the floating control bar, no auto-translate on load. Click **Translate** to translate, then the observer starts so lazily-loaded content auto-translates
  - `auto` — auto-translates on load and observes dynamic (SPA) content
- For `on`/`auto` sites the extension injects `<meta name="google" content="notranslate">` (via a `document_start` content script, as soon as `<head>` exists) to suppress Google Translate / Chrome's built-in translator so they don't conflict with our translation. `off` sites are left untouched.
- Priority rules: CSS selector → priority number, matched via `el.closest()`

### Translation Cache
- Key: `SHA-256(systemPrompt + model + text)`
- True LRU eviction (reads update recency order)
- Dual eviction: hard count cap (10,000 entries) + byte-based cap (default 7MB, configurable 1-100MB)
- Cache hits emit immediately before API calls
- **Retranslate explicitly bypasses the cache** to request a fresh translation from the model

### In-Session Translation Memory
- When a translation is applied, the mapping `translated text → original text` is recorded in an in-session memory map
- On a framework re-render (e.g. Vue/React) that drops the extension's wrapper span, already-translated text is recognized and re-attached with the correct `data-original` instead of being re-sent to the model as new source
- Prevents the "data-original captures translated text" corruption bug on SPA sites
- Cleared on a full Retranslate / reload

### Manual Translation
- Per-paragraph "Translate Manually" action lets you supply your own translation via a prompt
- Manual translations are cached with the same key as model results, so they persist like a normal LLM translation

### Floating Control Bar
- Shown for `on` and `auto` modes (top-right of the page), icon-only buttons with hover tooltips:
  - 🌐 **Translate** — translate the whole page (manual trigger; starts the observer)
  - ↻ **Retranslate** — restore originals and re-translate everything with a *fresh* model call (ignores cache)
  - ⇄ **Show Original / Show Translated** — reversible, non-destructive toggle: swaps every paragraph between source and translated text without any API call
- Per-paragraph toolbar (hover a paragraph) also offers: toggle original, retranslate, retranslate with comment, translate manually

### Per-Paragraph Controls
- Hovering a translated paragraph reveals a small toolbar:
  - ⇄ Toggle Original / Translated
  - ↻ Retranslate
  - ✎ Retranslate with Comment (supply a reviewer instruction via prompt)
  - ✍ Translate Manually (supply your own translation)

### Built-in Prompts
- **General** — General-purpose for any language pair
- **Qidian VN** — Optimized for Chinese web novels → Vietnamese
- Template variables: `{{source_language}}`, `{{target_language}}`, `{{hostname}}`, `{{url}}`, `{{page_title}}`
- Users can duplicate and edit prompts

### DOM Scan (Popup)
- Groups DOM elements by CSS path, suggests content/ignore/priority rules
- Heuristic: ≥15 elements → content, 5-14 → moderate priority, <5 → ignore
- One-click buttons to apply suggestions

### Language Support
- 23 languages including Auto Detect
- Any source → any target language pair

### Enabled Sites
- qidian.com (Chinese → Vietnamese, Qidian VN prompt)
- m.qidian.com (Chinese → Vietnamese, Qidian VN prompt)
- www.novelupdates.com (Auto → Vietnamese, General prompt)
- fanyi.baidu.com (Auto → English, General prompt)

## Project structure

```
├── src/
│   ├── background/    Service worker (translation queue, API calls, cache)
│   │   ├── api.ts         OpenAI-compatible API client
│   │   ├── queue.ts       Priority queue + parallel worker pool
│   │   ├── cache.ts       Translation cache with LRU eviction
│   │   └── index.ts       Message router, translation orchestrator
│   ├── content/       Content scripts (DOM extraction, rendering, observer)
│   │   ├── early.ts       document_start script: injects notranslate meta for on/auto sites
│   │   ├── extractor.ts   Text extraction + priority computation
│   │   ├── renderer.ts    DOM update + state indicators
│   │   ├── observer.ts    MutationObserver + SPA navigation
│   │   └── index.ts       Entry point, enqueue, cleanup, scan
│   ├── options/       Settings page
│   │   ├── options.html
│   │   ├── options.ts
│   │   └── options.css
│   ├── popup/         Toolbar popup
│   │   ├── popup.html
│   │   ├── popup.ts
│   │   └── popup.css
│   ├── prompts/       System prompt builder
│   │   └── builtins.ts
│   ├── sites/         Per-site default configs
│   │   └── defaults.ts
│   ├── storage/       Config persistence
│   │   └── config.ts
│   └── utils/         Batching, parsing, hashing, language helpers
│       ├── batching.ts
│       ├── parser.ts
│       ├── hashing.ts
│       └── language.ts
├── icons/             Extension icons (16, 32, 48, 128)
├── dist/              Build output (gitignored)
├── manifest.json
├── esbuild.config.mjs
├── tsconfig.json
├── package.json
├── README.md
└── v0.1.0_plan.md
```

## Configuration

All settings stored in `chrome.storage.local`, no backend server or account system.

### Global Settings

| Section | Field | Default | Description |
|---|---|---|---|
| API | Base URL | `""` | OpenAI-compatible endpoint |
| API | API Key | `""` | Bearer token (empty for local) |
| API | Model | `""` | Model name |
| API | Parallel Calls | `32` | Max concurrent API requests |
| API | Timeout | `60` | Request timeout in seconds |
| API | Temperature | `0.1` | Sampling temperature |
| API | Top-P | — | Nucleus sampling (optional) |
| API | Top-K | — | Top-K sampling (optional) |
| API | Min-P | — | Min-P sampling (optional) |
| API | Presence Penalty | — | Token presence penalty (optional) |
| API | Chat Template Kwargs | `{"enable_thinking":false}` | JSON kwargs for chat template |
| Translation | Max Characters | `4000` | Max chars per API request |
| Translation | Retry Count | `3` | Retry attempts on failure |
| Cache | Max Size | `7` MB | LRU cache eviction limit |

### Per-Site Settings

| Field | Default | Description |
|---|---|---|
| Mode | `"off"` | `off` / `on` / `auto` — see Per-Site Configuration |
| Prompt | `"general"` | System prompt ID |
| Source Language | `"Auto"` | Source language |
| Target Language | `"English"` | Target language |
| Observe | `"body"` | CSS selector for observation root |
| Content Selector | `""` | CSS selector for paragraphs (empty = auto) |
| Ignore | `[]` | CSS selectors for ignored elements |
| Priority Rules | `[]` | CSS selector → priority number |

## Architecture

```
Page Load / SPA Navigation
  │
  ├─ 300ms wait (framework render)
  ├─ Extract translatable nodes (TreeWalker)
  │   └─ Compute priority via CSS rules
  ├─ Enqueue → Background (chrome.runtime.sendMessage)
  │
  ▼
Background Worker
  │
  ├─ Priority sort (by priority, then FIFO)
  ├─ Parallel worker pool (up to `parallelCalls`)
  │   ├─ Check cache → emit immediately on hit
  │   ├─ Batch paragraphs (maxChars)
  │   ├─ POST /v1/chat/completions
  │   └─ Parse + merge split paragraphs
  │
  ▼
Content Script
  │
  ├─ Apply translations to DOM
  ├─ Update state indicators (⟳ translating / ✓ translated / ⚠ error)
  ├─ In-session translation memory (re-attach re-rendered translated text)
  ├─ Floating control bar (Translate / Retranslate / Show Original)
  └─ Schedule cleanup when queue empties (2s)
```

## Development

Built with TypeScript and esbuild. Manifest V3. No framework — vanilla TypeScript throughout.
