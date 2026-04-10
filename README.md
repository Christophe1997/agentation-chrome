# Agentation

A Chrome extension that adds a floating visual feedback toolbar to any website. Annotate UI elements with text feedback, copy annotations as markdown, and sync them to an [agentation-mcp](https://github.com/anthropics/agentation-mcp) server where AI agents can consume and act on them.

Built with [WXT](https://wxt.dev) and TypeScript (Manifest V3).

## Features

- **Click-to-annotate** — click any element on a page and describe the issue or feedback
- **Annotation markers** — colored pins track annotated elements, even across scroll and resize
- **Annotation list panel** — slide-out panel with all annotations for the current URL
- **Markdown export** — copy annotations as formatted markdown at four detail levels (compact, standard, detailed, forensic)
- **Freeze page** — pause all CSS animations, transitions, and videos
- **MCP server sync** — annotations sync to the agentation MCP server via REST + SSE; agents can resolve or dismiss annotations in real time
- **Shadow DOM isolation** — all UI injected via Shadow DOM with zero CSS conflicts
- **SPA navigation support** — toolbar persists across client-side route changes

## Prerequisites

- Node.js 18+
- npm
- The [agentation-mcp](https://github.com/anthropics/agentation-mcp) server running (required for sync features)

## Development

```bash
npm install          # install dependencies + run wxt prepare
npm run dev          # start dev server with HMR → .output/chrome-mv3/
```

### Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `.output/chrome-mv3/` directory

### Build for production

```bash
npm run build        # production build → .output/chrome-mv3/
npm run zip          # create a .zip for the Chrome Web Store
```

### Firefox

```bash
npm run dev:firefox  # dev build for Firefox
npm run build:firefox
```

### Type checking and tests

```bash
npm run compile      # tsc --noEmit (strict mode)
npm test             # vitest in watch mode
npx vitest run       # single run
```

## Usage

### Activate the toolbar

- **Click the extension icon** in the Chrome toolbar, or
- Set an activation shortcut at **chrome://extensions/shortcuts**

The floating toolbar appears on the current page. The content script is lazy-loaded on first activation — zero overhead until then.

### Toolbar buttons

| Button | Action |
|--------|--------|
| **Annotate** | Toggle annotation mode. Click any page element to open the annotation dialog. |
| **Select Text** | Toggle text selection mode. Annotation mode detects text selection automatically. |
| **List Annotations** | Open/close the annotation list panel for the current URL. |
| **Freeze Page** | Pause/resume all CSS animations, transitions, WAAPI animations, and videos. |
| **Copy Markdown** | Copy all current annotations as formatted markdown to the clipboard. |
| **Settings** | Open the options page to configure server URL, detail level, and data management. |

### Annotating an element

1. Click **Annotate** in the toolbar
2. Click any element on the page
3. A dialog appears showing the element name and CSS path
4. Type your feedback in the textarea
5. Press **Ctrl/Cmd+Enter** or click **Submit**
6. A colored marker pin appears on the element

Click an existing marker to **edit** or **delete** its annotation.

### Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl/Cmd+Shift+A | Toggle toolbar |
| Ctrl/Cmd+Enter | Submit annotation (in dialog) |
| Escape | Close dialog |
| Tab / Shift+Tab | Cycle focus in dialog |

Additional shortcuts are available and user-configurable at **chrome://extensions/shortcuts**:

| Command | Default | Action |
|---------|---------|--------|
| Toggle annotate mode | — (set your own) | Enter/exit annotation mode |
| Toggle page freeze | — (set your own) | Pause/resume animations |
| Copy annotations | — (set your own) | Copy annotations as markdown |

### Settings

Open via the gear icon in the toolbar or `chrome://extensions` → Agentation → **Extension options**.

- **Server URL** — MCP server address (default: `http://localhost:4747`)
- **Markdown detail level** — compact, standard, detailed, or forensic
- **Clear all data** — remove all stored annotations and settings

## MCP Server Integration

The extension communicates with the agentation MCP server over HTTP + SSE:

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Health check | GET | `/health` |
| Create session | POST | `/sessions` |
| Sync annotation | POST | `/sessions/:id/annotations` |
| Update annotation | PATCH | `/annotations/:id` |
| Delete annotation | DELETE | `/annotations/:id` |
| Clear annotations | DELETE | `/sessions/:id/annotations` |
| SSE events | GET | `/events?agent=true` |

Annotations sync automatically when the toolbar is active. Failed syncs are retried with exponential backoff (up to 10 retries). Annotations expire after 7 days.

When an AI agent resolves or dismisses an annotation on the server side, the marker status updates in real time via SSE.

## Project Structure

```
agentation-chrome/
├── entrypoints/         # WXT entry points
│   ├── background.ts    # Service worker — MCP communication, SSE, retry queue
│   ├── content.ts       # Content script — lazy-loaded, zero overhead
│   └── options/         # Options page (HTML + CSS + JS)
├── lib/                 # Shared utilities
│   ├── app.ts           # App orchestrator — wires UI components together
│   ├── constants.ts     # Z-index values, limits, selectors
│   ├── event-emitter.ts # Typed event emitter
│   ├── identify-element.ts  # Element identification (path, React fiber, a11y)
│   ├── markdown-formatter.ts # Markdown export at four detail levels
│   ├── storage.ts       # Storage abstraction (local + session)
│   └── __tests__/       # Unit tests
├── shared/
│   └── messages.ts      # Typed message protocol (content ↔ background)
├── ui/
│   ├── toolbar/         # Floating toolbar (Shadow DOM)
│   ├── dialog/          # Annotation dialog
│   ├── markers/         # Marker pins (light DOM)
│   └── list/            # Annotation list panel
├── docs/plans/          # Implementation phase plans
├── wxt.config.ts        # WXT configuration
├── tsconfig.json
└── package.json
```

## License

MIT
