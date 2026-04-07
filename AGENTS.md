# AGENTS.md

Chrome extension (MV3) built with [WXT](https://wxt.dev) + TypeScript. Adds a floating visual feedback toolbar to any website for annotating UI elements and syncing with an MCP server.

## Dev Environment Setup

```bash
npm install          # installs deps + runs wxt prepare
npm run dev          # dev server with HMR → .output/chrome-mv3/
npm run build        # production build
npm run compile      # tsc --noEmit (strict mode check)
```

Load unpacked extension: `chrome://extensions` → Load unpacked → `.output/chrome-mv3/`

MCP server (required for sync): run `http://localhost:4747` before testing.

## Testing

```bash
npm test             # vitest (watch mode)
npx vitest run       # single run
```

Tests live in `lib/__tests__/`. Mock `wxt/utils/storage` with `vi.hoisted()` — never use module-level mock variables directly in `vi.mock()` factory.

## Code Style

- TypeScript strict mode (`noImplicitAny`, `strictNullChecks`)
- WXT auto-imports: `browser`, `defineBackground`, `storage`, `defineContentScript` — **no import needed**
- Use `Browser.runtime.MessageSender` (capital B) for type references; `browser` (lowercase) for runtime calls
- Import `storage` from `wxt/utils/storage` (not `wxt/storage`)
- Module structure:
  - `lib/` — shared utilities (types, storage, event emitter, constants)
  - `shared/` — cross-context types (message protocol)
  - `entrypoints/` — WXT entry points (background, content, options)
  - `ui/` — UI components (Phase 2+)

## Architecture Notes

- **No popup** — icon click sends `TOGGLE_TOOLBAR` to content script
- Content script is `registration: 'runtime'` — registered on first icon click, zero overhead otherwise
- Background service worker owns all MCP server communication + SSE connection
- Typed message protocol in `shared/messages.ts` with `requestId` for correlation
- Storage: `local:` prefix for persistent, `session:` prefix for tab-scoped (cleared on browser close)

## PR/Commit Guidelines

Use Conventional Commits (see `agd:conventional-commits` skill). Scope examples: `feat(storage)`, `fix(background)`, `test(event-emitter)`.

## Implementation Status

- [x] Phase 1: Foundation (types, storage, background service worker)
- [x] Phase 2: Core UI (Shadow DOM, toolbar, click-to-annotate, markers)
- [x] Phase 3: Features (dialog, list panel, markdown copy, freeze, options)

See `docs/plans/` for detailed phase plans.
