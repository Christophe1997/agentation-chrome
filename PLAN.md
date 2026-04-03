# Plan: Agentation Chrome Extension

## Context

Agentation is currently a React 18+ component that requires embedding in a web app. The goal is to build a Chrome extension that provides the same visual feedback toolbar on **any website** without requiring React or project integration. The existing MCP server (`agentation-mcp`) already has CORS enabled (`Access-Control-Allow-Origin: *`) and a full REST API — the extension will connect to it directly.

**~70% of Agentation's logic is already framework-agnostic** (element identification, freeze animations, output generation, storage, sync). The main rewrite is the UI layer: toolbar, popup dialog, markers.

## Decisions

- **Repo**: New standalone repo at `/Users/shendonglai/code/agentation-chrome/`
- **Build**: WXT (Web Extension Tools) — file-based routing, built-in Shadow DOM, HMR, MV3 native
- **UI**: Vanilla TypeScript DOM construction — zero runtime deps, no framework conflicts
- **CSS**: Shadow DOM isolation via WXT's `createShadowRootUi`
- **Storage**: `chrome.storage.local` (replaces localStorage)
- **Server comms**: Background service worker only (leverages `host_permissions`)
- **Phase 1 scope**: Core annotation + sync (defer design mode, rearrange, drawing, screenshots)

## Architecture

```
Content Script (Shadow DOM UI)          Background Service Worker
┌──────────────────────────┐            ┌──────────────────────┐
│ Toolbar (floating bar)   │  messages  │ Session management    │
│ Annotation popup         │ ─────────→ │ Annotation sync       │
│ Annotation markers       │            │ Health check          │
│ Annotation list panel    │ ←───────── │ Settings storage      │
│                          │            └──────────┬───────────┘
│ Core Logic (ported):     │                       │ fetch
│ - element-identification │                       ▼
│ - generate-output        │            ┌──────────────────────┐
│ - freeze-animations      │            │ MCP Server :4747     │
│ - react-detection        │            │ REST API + SSE       │
└──────────────────────────┘            └──────────────────────┘

Popup (chrome-extension://)
- Server URL config, connection status, annotation count
```

## File Structure

```
agentation-chrome/
├── package.json
├── wxt.config.ts
├── tsconfig.json
├── public/
│   └── icon-{16,32,48,128}.png
├── entrypoints/
│   ├── content.ts              # Main content script (Shadow DOM injection)
│   ├── background.ts           # Service worker (server comms)
│   └── popup/
│       ├── index.html
│       ├── main.ts
│       └── style.css
├── lib/                         # Ported from /tmp/agentation/package/src/utils/
│   ├── types.ts                 # Annotation, Session types
│   ├── element-identification.ts # Copy from Agentation (pure DOM, no changes)
│   ├── generate-output.ts       # Copy from Agentation (no changes)
│   ├── react-detection.ts       # Copy as-is (no React imports)
│   ├── freeze-animations.ts     # Copy + adapt (prefix changes)
│   ├── storage.ts               # Rewrite: chrome.storage.local
│   └── constants.ts             # Shared constants
├── ui/
│   ├── toolbar/
│   │   ├── Toolbar.ts           # Main toolbar class (vanilla DOM)
│   │   ├── toolbar.css
│   │   └── icons.ts             # SVG strings ported from icons.tsx
│   ├── popup/
│   │   ├── AnnotationPopup.ts   # Dialog class
│   │   └── popup.css
│   ├── markers/
│   │   ├── AnnotationMarker.ts  # Pin markers (light DOM)
│   │   └── markers.css
│   ├── list/
│   │   ├── AnnotationList.ts    # List panel
│   │   └── list.css
│   └── shared.css               # Common styles
└── shared/
    └── messages.ts              # Typed message protocol
```

## Implementation Steps

### Step 1: Project scaffolding
- Create repo at `/Users/shendonglai/code/agentation-chrome/`
- Initialize WXT project with TypeScript: `npx wxt@latest init`
- Configure `wxt.config.ts`: permissions (`activeTab`, `storage`, `scripting`), host_permissions (`http://localhost:4747/*`)
- Create placeholder extension icons

### Step 2: Port utilities
- Copy `element-identification.ts` from `/tmp/agentation/package/src/utils/` → `lib/`
- Copy `generate-output.ts` → `lib/`
- Copy `react-detection.ts` → `lib/`
- Port `types.ts` (Annotation type) from `/tmp/agentation/package/src/types.ts` → `lib/types.ts`
- Copy `freeze-animations.ts` → `lib/`, adapt `data-*` attribute selectors to `agt-` prefix

### Step 3: Storage layer
- Implement `lib/storage.ts` using `chrome.storage.local`
- Same key schema and 7-day expiry as original `storage.ts`
- Async API (chrome.storage is async, unlike localStorage)
- Settings storage (server URL, detail level)

### Step 4: Background service worker
- Implement `entrypoints/background.ts`
- Message handler: CREATE_SESSION, SYNC_ANNOTATION, CHECK_SERVER_HEALTH, GET/SAVE_SETTINGS
- Direct fetch to MCP server (POST /sessions, POST /sessions/:id/annotations, GET /health)
- Connection status tracking

### Step 5: Content script shell + Shadow DOM setup
- Implement `entrypoints/content.ts` with WXT `createShadowRootUi`
- `cssInjectionMode: 'ui'` for Shadow DOM isolation
- `isolateEvents: true` for click interception
- `AgentationApp` orchestrator class (mount/destroy lifecycle)
- Coexistence detection: check for existing `[data-agentation-root]` before mounting

### Step 6: Toolbar UI
- Implement `ui/toolbar/Toolbar.ts` — floating bar with buttons
- Port SVG icons from `/tmp/agentation/package/src/components/icons.tsx` → string constants in `icons.ts`
- CSS: `position: fixed`, bottom-right, z-index management
- Buttons: toggle, annotate mode, text selection, list, freeze, copy markdown
- Keyboard shortcut: Ctrl+Shift+A to toggle

### Step 7: Click-to-annotate flow
- Intercept clicks via capture phase listener (when annotate mode active)
- Run `identifyElement()` on target element
- Show `AnnotationPopup` at click position
- On submit: create Annotation object, save to storage, send SYNC_ANNOTATION to background
- Support text selection: detect `window.getSelection()`, pre-fill selected text

### Step 8: Annotation markers
- Implement `ui/markers/AnnotationMarker.ts`
- Create pin elements in **light DOM** (must overlay page content — Shadow DOM is behind stacking context)
- `position: fixed` + `z-index: 2147483646`
- `ResizeObserver` + scroll listener to track position
- Click marker to re-open popup (edit mode)
- `data-agt-marker` attribute for identification

### Step 9: Annotation list panel
- Implement `ui/list/AnnotationList.ts`
- Slide-out panel showing all annotations for current URL
- Click to scroll to marker, delete individual, clear all
- Status display (pending count)

### Step 10: Markdown copy + freeze
- Use `generate-output.ts` for 4 detail levels (compact/standard/detailed/forensic)
- Copy via `navigator.clipboard.writeText()`
- Freeze animations: port `freeze()`/`unfreeze()` from `lib/freeze-animations.ts`
- Toggle button with visual indicator

### Step 11: Popup page
- Implement `entrypoints/popup/` — connection status, annotation count, settings link
- Server URL configuration
- Detail level selector

## Key Technical Details

### Shadow DOM + Marker strategy
- Toolbar UI lives inside Shadow DOM (complete CSS isolation)
- Markers live in light DOM with inline styles + `!important` (must visually overlay page elements)
- Freeze animations CSS injected into light DOM with `:not([data-agt-ext])` selectors

### Message protocol
```
Content → Background:
  CREATE_SESSION { url, domain }
  SYNC_ANNOTATION { sessionId, annotation }
  CHECK_SERVER_HEALTH
  GET/SAVE_SETTINGS { settings }

Background → Content:
  SESSION_CREATED { session }
  SYNC_SUCCESS { annotationId, serverId }
  ANNOTATION_RESOLVED { annotationId, summary }
  SERVER_STATUS { status }
```

### Utility extraction — source mappings
| Target file | Source (in /tmp/agentation/) | Changes |
|-------------|------------------------------|---------|
| `lib/element-identification.ts` | `package/src/utils/element-identification.ts` | None |
| `lib/generate-output.ts` | `package/src/utils/generate-output.ts` | Remove React type imports |
| `lib/react-detection.ts` | `package/src/utils/react-detection.ts` | None |
| `lib/freeze-animations.ts` | `package/src/utils/freeze-animations.ts` | Prefix `data-*` attrs to `agt-` |
| `lib/types.ts` | `package/src/types.ts` | Trim to needed types only |
| `lib/storage.ts` | `package/src/utils/storage.ts` | Full rewrite (chrome.storage) |
| `ui/toolbar/icons.ts` | `package/src/components/icons.tsx` | Convert JSX → template strings |

## Verification

1. **Build**: `npm run dev` — WXT dev mode with HMR
2. **Load**: `chrome://extensions` → Developer mode → Load unpacked → select `.output/chrome-mv3/`
3. **Test on arbitrary page** (e.g., github.com):
   - Click extension icon → popup shows connection status
   - Ctrl+Shift+A → toolbar appears
   - Click "annotate" button → click any element → popup appears with element info
   - Type feedback, submit → marker appears on element
   - Click "copy" → markdown in clipboard with selectors and paths
   - Verify React detection works on React pages
4. **Server sync** (with MCP server running):
   - Start `agentation-mcp server`
   - Create annotation → verify it appears in server via `curl localhost:4747/pending`
   - Verify popup shows "Connected" status
5. **Coexistence**: Load on a page with React Agentation installed → verify no conflicts
