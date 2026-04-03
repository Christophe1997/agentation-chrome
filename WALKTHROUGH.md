# Agentation — Complete Project Walkthrough

> Cloned from: https://github.com/benjitaylor/agentation.git
> License: PolyForm Shield 1.0.0 (non-permissive — restricts competitive use)

---

## 1. What is Agentation?

Agentation is a **visual feedback toolbar for web pages** that bridges the gap between human visual feedback and AI coding agents. Instead of describing UI issues in words, a developer/designer clicks elements on the page, adds notes, and the toolbar produces **structured output** (CSS selectors, DOM paths, computed styles, React component names, source file locations) that an AI agent can directly use to find and fix the exact code.

The project ships two packages:

| Package | npm name | Purpose |
|---------|----------|---------|
| `package/` | `agentation` | React component (toolbar UI) |
| `mcp/` | `agentation-mcp` | MCP server + HTTP API (agent communication layer) |

There is also a `skills/` directory with Claude Code skill definitions for agent-driven workflows.

---

## 2. Monorepo Structure

```
agentation/
├── package.json                 # pnpm workspace root
├── CLAUDE.md                    # Claude Code instructions
├── CONTRIBUTING.md              # Contribution guidelines
├── skills/
│   ├── agentation/SKILL.md      # Setup skill for Claude Code
│   └── agentation-self-driving/ # Autonomous design critique skill
│       ├── SKILL.md
│       └── references/two-session-workflow.md
├── package/                     # The npm-published React component
│   ├── src/
│   │   ├── index.ts             # Public API exports
│   │   ├── types.ts             # Annotation, Session, ThreadMessage types
│   │   ├── components/
│   │   │   ├── page-toolbar-css/     # Main toolbar component (~900 LOC)
│   │   │   ├── annotation-popup-css/ # Annotation dialog popup
│   │   │   ├── design-mode/          # Design placement & rearrange tools
│   │   │   ├── annotation-marker/    # Visual markers on annotated elements
│   │   │   ├── icons.tsx             # All SVG icons
│   │   │   ├── switch/, checkbox/, tooltip/, help-tooltip/
│   │   │   └── index.ts
│   │   └── utils/
│   │       ├── element-identification.ts  # DOM element analysis
│   │       ├── generate-output.ts        # Markdown output generation
│   │       ├── storage.ts                # localStorage persistence
│   │       ├── sync.ts                   # Server sync API client
│   │       ├── freeze-animations.ts      # Animation freezing
│   │       ├── screenshot.ts             # DOM region capture
│   │       ├── source-location.ts        # React source file detection
│   │       ├── react-detection.ts        # React component name extraction
│   │       └── index.ts
│   └── example/                  # Next.js website (agentation.com)
│       └── src/app/...
└── mcp/                         # MCP server package
    ├── src/
    │   ├── cli.ts              # CLI entry (init, doctor, server commands)
    │   ├── types.ts            # Shared types
    │   ├── index.ts            # Public API re-exports
    │   └── server/
    │       ├── index.ts        # Server orchestration
    │       ├── http.ts         # HTTP + SSE + MCP-HTTP server
    │       ├── mcp.ts          # MCP tool definitions & handlers
    │       ├── store.ts        # Store abstraction + in-memory impl
    │       ├── sqlite.ts       # SQLite persistence layer
    │       ├── events.ts       # EventBus (pub/sub for real-time)
    │       └── tenant-store.ts # Multi-tenant auth/API keys
    └── package.json
```

---

## 3. The React Component (`package/src/`)

### 3.1 Public API — `index.ts`

The package exports a single main component and utility functions:

```tsx
import { Agentation } from 'agentation';
// Agentation is actually PageFeedbackToolbarCSS under the hood
```

Also exports:
- `AnnotationPopupCSS` — for building custom annotation UIs
- Icons (pure SVG, no runtime deps)
- Element identification utilities (`identifyElement`, `getElementPath`, `getNearbyText`, etc.)
- Storage utilities (`loadAnnotations`, `saveAnnotations`)
- Types (`Annotation`)

### 3.2 Types — `types.ts`

The core `Annotation` type is the heart of the data model:

```
Annotation {
  id, x, y, comment, element, elementPath, timestamp
  selectedText?, boundingBox?, nearbyText?, cssClasses?
  nearbyElements?, computedStyles?, fullPath?, accessibility?
  isMultiSelect?, isFixed?, reactComponents?, sourceFile?

  // Protocol fields (set when syncing to server)
  sessionId?, url?, intent?, severity?, status?, thread?
  createdAt?, updatedAt?, resolvedAt?, resolvedBy?, authorId?

  // Annotation kinds
  kind?: "feedback" | "placement" | "rearrange"
  placement?: { componentType, width, height, scrollY, text? }
  rearrange?: { selector, label, tagName, originalRect, currentRect }
}
```

Three annotation **kinds**:
1. **feedback** — default click-to-annotate
2. **placement** — drag-and-drop design component placeholders (e.g., "put a Card here")
3. **rearrange** — reorder/resize page sections

Annotation lifecycle statuses: `pending → acknowledged → resolved | dismissed`

Sessions group annotations by URL/page.

### 3.3 Main Toolbar — `page-toolbar-css/index.tsx`

This is the **core component** (~900 lines). It's a `"use client"` React component that:

1. **Renders as a portal** into `document.body` so it floats above all content
2. **Manages annotation state** (create, read, update, delete)
3. **Handles click-to-annotate** — intercepts clicks on page elements
4. **Handles text selection** — detects selected text and annotates it
5. **Handles multi-select** — drag to select multiple elements
6. **Handles area selection** — drag to annotate empty regions
7. **Manages sessions** — creates/resumes sessions with the server
8. **Syncs annotations** — POSTs new annotations to the HTTP server in real-time
9. **Provides copy-to-clipboard** — generates markdown output for agents
10. **Freeze animations** — pauses all CSS/JS animations to capture specific states
11. **Design mode** — placement palette and rearrange overlay

**Key interaction flow:**

```
User clicks element → identifyElement() captures DOM info →
AnnotationPopupCSS shows dialog → User types feedback →
Annotation created → Saved to localStorage → Synced to HTTP server →
Server emits SSE event → MCP tool (watch_annotations) receives it →
AI agent processes it
```

The toolbar exposes callback props for programmatic use:
- `onAnnotationAdd`, `onAnnotationDelete`, `onAnnotationUpdate`
- `onAnnotationsClear`, `onCopy`
- `copyToClipboard` (boolean)

### 3.4 Annotation Popup — `annotation-popup-css/index.tsx`

A `forwardRef` component that renders the annotation dialog with:
- Element name header (with collapsible computed styles accordion)
- Selected text quote display
- Textarea for feedback
- Cancel / Delete / Submit buttons
- Enter-to-submit, Escape-to-cancel keyboard shortcuts
- Animation states (enter, entered, exit, shake)
- Accent color customization
- **Focus trap bypassing** — temporarily blocks focus-trap libraries (like Radix FocusScope) so the textarea can receive focus

### 3.5 Element Identification — `utils/element-identification.ts`

This is the **intelligence layer** that makes annotations useful. Given any DOM element, it extracts:

- **Human-readable name**: `button "Submit"`, `paragraph: "Welcome to..."`, `link "Learn more"`
- **DOM path**: `nav > .sidebar > button.primary` (up to 4 levels deep)
- **Nearby text**: Own text + previous/next sibling text for context
- **CSS classes**: Cleaned of CSS module hashes (strips `_abc123` suffixes)
- **Computed styles**: Different properties based on element type:
  - Text elements → color, fontSize, fontWeight, fontFamily, lineHeight
  - Interactive → backgroundColor, color, padding, borderRadius, fontSize
  - Containers → display, padding, margin, gap, backgroundColor
- **Accessibility info**: role, aria-label, aria-describedby, tabindex, focusability
- **Nearby elements**: Up to 4 sibling elements with parent context
- **Full DOM path**: Complete ancestry for forensic mode
- **Shadow DOM support**: Crosses shadow boundaries using `getRootNode()` + shadow host traversal

### 3.6 React Detection — `utils/react-detection.ts`

Walks the **React fiber tree** to extract component names. Key features:

- Works with React 16-19 (handles changing internal APIs)
- Three modes: `all` (no filter), `filtered` (skip framework internals), `smart` (require DOM class correlation)
- Skips framework internals: ErrorBoundary, Provider, Consumer, Router, etc.
- **Smart mode**: Only shows components whose names correlate with CSS classes on the element or its ancestors (e.g., `SideNav` matches CSS class `side-nav`)
- Caching via WeakMap (only for `all` mode to avoid stale filter results)

### 3.7 Source Location Detection — `utils/source-location.ts`

Finds the **exact source file and line number** of the React component that rendered a DOM element. Two strategies:

1. **`_debugSource`**: Standard React dev-only metadata on fiber nodes (`fileName`, `lineNumber`, `columnNumber`)
2. **Stack trace probing** (fallback for Next.js/SWC): Installs a proxy React hooks dispatcher that throws on any hook call, then parses the error stack trace to find the component's source location. Strips bundler prefixes (turbopack, webpack, etc.)

Only works in development builds (production strips debug info).

### 3.8 Freeze Animations — `utils/freeze-animations.ts`

A monkey-patching module that **pauses all animations** on the page so users can capture specific visual states:

- Patches `setTimeout`, `setInterval`, `requestAnimationFrame` — callbacks are queued when frozen, replayed on unfreeze
- Injects CSS: `animation-play-state: paused !important` and `transition: none !important`
- Pauses WAAPI animations via `Animation.pause()`
- Pauses `<video>` elements
- **Excludes agentation's own UI** from freezing (via `data-*` attribute selectors)
- Exports `originalSetTimeout` etc. for toolbar code that must bypass the freeze
- Survives HMR (state lives on `window.__agentation_freeze`)

### 3.9 Output Generation — `utils/generate-output.ts`

Converts annotations to markdown. Four detail levels:

| Level | Content |
|-------|---------|
| **compact** | Numbered list with element name + comment |
| **standard** | Element name, DOM path, source file, React components, selected text |
| **detailed** | Adds CSS classes, bounding box position, nearby text context |
| **forensic** | Full DOM path, all CSS classes, viewport position, computed styles, accessibility info, source file, React hierarchy |

### 3.10 Storage — `utils/storage.ts`

LocalStorage-based persistence with:
- Annotations keyed by pathname (`feedback-annotations-/about`)
- 7-day auto-expiry
- Sync markers (`_syncedTo` field tracks which session annotations were sent to)
- Separate storage for design placements, rearrange state, wireframe state
- Session ID persistence
- Toolbar visibility (per-tab via sessionStorage)

### 3.11 Design Mode — `components/design-mode/`

A subsystem for **visual design feedback**:

- **Palette** (`palette.tsx`): A library of 65 component types (navigation, hero, card, button, sidebar, etc.) organized into sections (Layout, Content, Controls, Elements, Blocks). Each has default dimensions.
- **Section Detection** (`section-detection.ts`): Automatically detects page sections (nav, hero, sections, footers) using heuristics on tag names, roles, and class names.
- **Rearrange** (`rearrange.tsx`): Allows dragging sections to reorder them on the page.
- **Skeletons** (`skeletons.tsx`): Renders wireframe placeholders for component types.
- **Output** (`output.ts`): Generates structured markdown for placement and rearrange annotations.

### 3.12 Screenshot — `utils/screenshot.ts`

Captures DOM regions with drawing strokes composited on top:
- Primary: Uses `modern-screenshot` (optional peer dep) for DOM-to-image capture
- Fallback: Stroke-only canvas capture on a light background
- Hides agentation UI before capture
- Handles scroll offset mapping between viewport and element content coordinates
- Output as JPEG (with quality parameter) or PNG

---

## 4. The MCP Server (`mcp/`)

### 4.1 Architecture

The MCP server is a **dual-protocol server** that runs in a single process:

```
┌─────────────────────────────────────────────────┐
│  agentation-mcp server                          │
│                                                 │
│  ┌──────────────┐  ┌────────────────────────┐   │
│  │ HTTP Server  │  │ MCP Server (stdio)     │   │
│  │ :4747        │  │ JSON-RPC via stdin/out │   │
│  │              │  │                        │   │
│  │ REST API     │  │ Fetches from HTTP API  │   │
│  │ SSE streams  │  │ (single source of      │   │
│  │ /mcp endpoint│  │  truth)                │   │
│  └──────┬───────┘  └───────────┬────────────┘   │
│         │                      │                 │
│         └──────────┬───────────┘                 │
│                    ▼                             │
│         ┌──────────────────┐                     │
│         │ Store (abstract) │                     │
│         ├──────────────────┤                     │
│         │ SQLite (persist) │ ← ~/.agentation/    │
│         │ Memory (fallback)│                     │
│         └──────────────────┘                     │
│                    ▲                             │
│         ┌──────────┴────────┐                    │
│         │ EventBus          │                    │
│         │ (pub/sub)         │                    │
│         └───────────────────┘                    │
└─────────────────────────────────────────────────┘
```

### 4.2 CLI — `cli.ts`

Three commands:

- **`init`**: Interactive wizard that configures Claude Code MCP integration (runs `claude mcp add agentation`)
- **`doctor`**: Diagnostic checks — Node version, Claude Code config, server connectivity
- **`server`**: Starts both HTTP and MCP servers (default port 4747)

Server options:
- `--port <port>` — HTTP server port (default: 4747)
- `--mcp-only` — Skip HTTP, only run MCP on stdio
- `--http-url <url>` — URL for MCP to fetch from
- `--api-key <key>` — Cloud storage API key

### 4.3 HTTP Server — `http.ts`

A **zero-dependency HTTP server** using Node.js `http` module (no Express/Koa). Features:

**REST API endpoints:**
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/sessions` | Create a new session |
| GET | `/sessions` | List all sessions |
| GET | `/sessions/:id` | Get session with annotations |
| GET | `/sessions/:id/pending` | Get pending annotations |
| GET | `/sessions/:id/events` | SSE stream for session events |
| POST | `/sessions/:id/annotations` | Add annotation |
| POST | `/sessions/:id/action` | Request agent action (triggers SSE + webhooks) |
| PATCH | `/annotations/:id` | Update annotation |
| DELETE | `/annotations/:id` | Delete annotation |
| POST | `/annotations/:id/thread` | Add thread message |
| GET | `/pending` | Get all pending across sessions |
| GET | `/events` | Global SSE stream |
| GET | `/health` | Health check |

**SSE (Server-Sent Events):**
- Per-session SSE: `/sessions/:id/events?agent=true`
- Global SSE: `/events?agent=true&domain=example.com`
- Supports reconnection via `Last-Event-ID` header
- Tracks agent connections separately for accurate delivery stats
- Initial sync: sends all pending annotations on connect (sequence 0 = historical)

**MCP over HTTP:**
- `/mcp` endpoint supports Streamable HTTP transport (POST for requests, GET for SSE, DELETE for cleanup)

**Webhooks:**
- Configured via `AGENTATION_WEBHOOK_URL` or `AGENTATION_WEBHOOKS` env vars
- Fire-and-forget on `action.requested` events

**Cloud mode:**
- When `--api-key` is set, all requests proxy to `https://agentation-mcp-cloud.vercel.app/api`
- SSE streams are proxied as well

### 4.4 MCP Server — `mcp.ts`

Implements the **Model Context Protocol** over stdio. The MCP server does NOT have its own store — it **fetches from the HTTP API** (single source of truth).

**10 MCP tools:**

| Tool | Purpose |
|------|---------|
| `agentation_list_sessions` | List all active sessions |
| `agentation_get_session` | Get session with annotations |
| `agentation_get_pending` | Get pending annotations for a session |
| `agentation_get_all_pending` | Get all pending across all sessions |
| `agentation_acknowledge` | Mark annotation as acknowledged |
| `agentation_resolve` | Mark annotation as resolved (with optional summary) |
| `agentation_dismiss` | Dismiss annotation (with required reason) |
| `agentation_reply` | Add reply to annotation thread |
| `agentation_watch_annotations` | **Block until new annotations appear, batch them** |

The **`watch_annotations`** tool is the key innovation:
1. First drains any existing pending annotations (catches ones that arrived between calls)
2. If none pending, opens an SSE connection to the HTTP server
3. Blocks until an `annotation.created` event arrives (ignoring sequence 0 / initial sync)
4. After first annotation, waits a batch window (default 10s, max 60s) to collect more
5. Returns the batch — agent processes them, calls `resolve`, then loops back

### 4.5 Store — `store.ts` + `sqlite.ts`

Two-tier storage:

1. **In-memory store** (default fallback): Uses `Map` objects, lives in process memory
2. **SQLite store** (preferred): Persists to `~/.agentation/store.db` using `better-sqlite3`

The store implements the `AFSStore` interface:
- Session CRUD
- Annotation CRUD + status transitions
- Thread messages
- Event history (for SSE replay on reconnect)

Auto-fallback: if `better-sqlite3` fails to load, silently falls back to in-memory.

### 4.6 Event Bus — `events.ts`

A **pub/sub event bus** for real-time distribution:
- Global `eventBus` — subscribes to all events
- `userEventBus` — user-scoped events (for multi-tenant isolation)
- Each event has a monotonic sequence number for ordering/dedup/replay
- Event types: `annotation.created/updated/deleted`, `session.created/updated/closed`, `thread.message`, `action.requested`

### 4.7 Multi-Tenant — `tenant-store.ts`

Support for organizations, users, and API keys:
- Organizations own users
- Users have roles (owner, admin, member)
- API keys are stored as SHA-256 hashes with a display prefix
- User-scoped queries prevent data leakage

---

## 5. Skills (Claude Code Integration)

### 5.1 `agentation/SKILL.md` — Setup Skill

Guides Claude Code through setting up Agentation in a project:
1. Check if already installed
2. Detect framework (Next.js App Router vs Pages Router)
3. Add `<Agentation />` component with `NODE_ENV === "development"` guard
4. Recommend MCP server setup (via `npx add-mcp` or `agentation-mcp init`)

### 5.2 `agentation-self-driving/SKILL.md` — Autonomous Design Critique

The most sophisticated skill. Enables an AI agent to **autonomously critique a web page** using the Agentation toolbar:

**Workflow:**
1. Open a visible (headed) browser via `agent-browser`
2. Verify toolbar is present, expand it
3. Work top-to-bottom through the page
4. For each element: scroll → get bounding box → coordinate-click → fill dialog → submit
5. Aim for 5-8 annotations per page
6. Verify each annotation was added (marker count check)

**Critical constraint:** Standard `click @ref` doesn't work for annotations — the Agentation overlay intercepts pointer events. Must use `mouse move → mouse down left → mouse up left` coordinate-based clicks.

### 5.3 Two-Session Workflow

The self-driving skill enables a **fully autonomous design review loop**:

```
Terminal 1 (Critic)              Terminal 2 (Fixer)
─────────────────                ──────────────────
Opens browser, scans page       Blocking on watch_annotations...
Clicks element, adds critique   ← Receives annotation
                                Reads code, makes fix
                                Calls agentation_resolve
Moves to next element           ← Blocking on watch_annotations...
```

The MCP server is the bridge — annotations auto-send via SSE, the fixer receives them in real-time.

---

## 6. Data Flow — End to End

```
┌──────────┐     click      ┌──────────────────┐   POST    ┌──────────────┐
│  Browser  │ ────────────→ │ Agentation React │ ────────→ │ HTTP Server  │
│  (user)   │               │ Component        │           │ :4747        │
│           │               │                  │           │              │
│           │  renders      │ - identifyElement│           │ - Store      │
│           │  toolbar      │ - getReactComp.. │           │ - EventBus   │
│           │               │ - getSourceLoc.. │           │              │
└──────────┘               └──────────────────┘           └──────┬───────┘
                                                                   │ SSE
                                                                   ▼
┌──────────┐   tool call   ┌──────────────────┐            ┌──────────────┐
│  AI Agent │ ────────────→ │ MCP Server       │ ←─fetch──→ │ HTTP Server  │
│ (Claude)  │               │ (stdio)          │            │ :4747        │
│           │               │                  │            └──────────────┘
│           │ ←──────────── │ - watch_annots   │
│           │  annotations  │ - resolve        │
│           │               │ - acknowledge    │
└──────────┘               └──────────────────┘
```

---

## 7. Key Design Decisions

1. **Zero runtime dependencies for the React component** — Pure CSS animations, no external libraries. Keeps the npm package tiny.

2. **CSS-only toolbar variant** — The default export (`PageFeedbackToolbarCSS`) uses CSS modules and no runtime animation library. This is intentional for minimal bundle size.

3. **Single source of truth** — The MCP server doesn't have its own store; it fetches from the HTTP API. This prevents data inconsistency.

4. **Monkey-patching for freeze** — Rather than requiring page code changes, `freeze-animations.ts` patches global timing functions. The toolbar uses `originalSetTimeout` to bypass its own freeze.

5. **Stack trace probing for source locations** — When `_debugSource` is unavailable (Next.js with SWC), the tool installs a proxy React hooks dispatcher that throws, then parses the error stack. Clever but fragile — it relies on React internals.

6. **SSE with initial sync** — When an MCP tool connects via SSE, the server first sends all pending annotations (sequence 0), then streams new ones. The `watch_annotations` tool ignores sequence 0 events to avoid processing historical annotations as new.

7. **Batch window in watch** — After detecting the first new annotation, the tool waits up to 60 seconds to collect more before returning. This prevents the agent from processing one annotation at a time when the user is rapidly annotating.

8. **PolyForm Shield license** — This is a non-permissive license that restricts competitive use. Not MIT/Apache.

---

## 8. Running the Project

```bash
# Install all dependencies
pnpm install

# Run package watch + website dev server
pnpm dev

# Build the npm package only
pnpm build

# Run the MCP server
pnpm mcp

# Run diagnostics
agentation-mcp doctor

# Interactive setup
agentation-mcp init
```

---

## 9. File Sizes (approximate)

| File | Lines | Role |
|------|-------|------|
| `page-toolbar-css/index.tsx` | ~900 | Main toolbar component |
| `element-identification.ts` | ~400 | DOM analysis utilities |
| `react-detection.ts` | ~350 | React fiber tree walking |
| `source-location.ts` | ~400 | Source file detection |
| `freeze-animations.ts` | ~200 | Animation freezing |
| `http.ts` (MCP) | ~500 | HTTP server |
| `mcp.ts` (MCP) | ~450 | MCP tool definitions |
| `store.ts` (MCP) | ~300 | Store abstraction |
| `sqlite.ts` (MCP) | ~500 | SQLite persistence |
| `cli.ts` | ~250 | CLI commands |
| `events.ts` | ~200 | Event bus |
