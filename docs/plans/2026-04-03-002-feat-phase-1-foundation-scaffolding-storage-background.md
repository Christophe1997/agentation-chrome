---
title: "feat: Phase 1 — Foundation (Scaffolding, Types, Storage, Background)"
type: feat
status: active
date: 2026-04-03
origin: docs/plans/2026-04-03-001-feat-agentation-chrome-clean-room-reimplementation-plan.md
---

# feat: Phase 1 — Foundation (Scaffolding, Types, Storage, Background)

## Overview

This is Phase 1 of the Agentation Chrome Extension clean-room reimplementation. It establishes the WXT project skeleton, all shared type definitions, the storage layer, and the background service worker that owns all MCP server communication.

**Depends on:** Nothing — this is the foundation.
**Unlocks:** Phase 2 (Core UI) can begin once Steps 1–4 are complete and the background service worker is functional.

See the master plan for full context, architecture diagrams, and key decisions: `docs/plans/2026-04-03-001-feat-agentation-chrome-clean-room-reimplementation-plan.md`

## Key Decisions (from master plan)

- **D1:** No popup — extension icon click sends `TOGGLE_TOOLBAR` message via `action.onClicked`
- **D2:** `host_permissions: ["<all_urls>"]` for development; `activeTab` path documented for distribution
- **D3:** Runtime content script registration (`registration: 'runtime'`)
- **D4:** Typed message protocol with `requestId` for SSE push-event correlation
- **D5:** WXT `storage.defineItem` with versioned migrations; `session:` prefix for per-tab state
- **D8:** Retry queue persisted in `chrome.storage.local`; `chrome.alarms` every 30s; exponential backoff
- **D9:** SSE connection while toolbar active; background service worker maintains connection

## Implementation Steps

### Step 1: Project Scaffolding

- Initialize WXT project: `npx wxt@latest init` (Vanilla + TypeScript template)
- Configure `wxt.config.ts`:

```typescript
// wxt.config.ts
import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Agentation',
    version: '0.1.0',
    description: 'Visual feedback toolbar for any website',
    permissions: ['storage', 'activeTab', 'scripting', 'alarms'],
    host_permissions: ['<all_urls>', 'http://localhost:4747/*'],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self';"
    },
    commands: {
      'toggle-toolbar': {
        suggested_key: { default: 'Ctrl+Shift+A', mac: 'Command+Shift+A' },
        description: 'Toggle Agentation toolbar',
      },
    },
  },
});
```

- Create placeholder extension icons (16, 32, 48, 128px) in `public/`
- Add `postinstall: "wxt prepare"` to `package.json` scripts
- Verify: `npm run dev` produces `.output/chrome-mv3/` with valid `manifest.json`

**Files created:**
- `package.json`
- `wxt.config.ts`
- `tsconfig.json`
- `public/icon-{16,32,48,128}.png` (placeholder)

### Step 2: Types and Event Emitter

All types are **redefined from the WALKTHROUGH.md specification** — not copied from upstream source.

- **`lib/types.ts`** — Core types from WALKTHROUGH.md §3.2:

```typescript
type AnnotationKind = 'feedback';  // Phase 1: only feedback

type AnnotationStatus = 'pending' | 'acknowledged' | 'resolved' | 'dismissed';

type OutputDetailLevel = 'compact' | 'standard' | 'detailed' | 'forensic';
type ReactComponentMode = 'off' | 'all' | 'filtered' | 'smart';

interface Annotation {
  id: string;                    // client-generated UUID
  serverId?: string;             // assigned by MCP server
  x: number;
  y: number;
  comment: string;
  element: string;               // human-readable name
  elementPath: string;           // CSS selector path
  timestamp: number;
  selectedText?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
  nearbyText?: string;
  cssClasses?: string[];
  nearbyElements?: NearbyElement[];
  computedStyles?: Record<string, string>;
  fullPath?: string;
  accessibility?: AccessibilityInfo;
  reactComponents?: string[];
  sourceFile?: string;           // Phase 2: deferred
  // Protocol fields
  url?: string;
  intent?: string;
  severity?: string;
  status?: AnnotationStatus;
  thread?: ThreadMessage[];
  createdAt?: string;
  updatedAt?: string;
}

interface Session {
  id: string;
  url: string;
  domain: string;
  createdAt: string;
}

type AnnotationSyncStatus = 'pending' | 'syncing' | 'synced' | 'failed';

type ExtensionSettings = {
  serverUrl: string;
  detailLevel: 'compact' | 'standard' | 'detailed' | 'forensic';
};

type RetryEntry = {
  annotationId: string;
  sessionId: string;
  serverId?: string;
  operation: 'create' | 'update' | 'delete';
  annotation?: Annotation;
  retryCount: number;
  lastRetryAt: number;
  nextRetryAt: number;
};
```

- **`lib/event-emitter.ts`** — Lightweight typed event emitter (~50 LOC):

```typescript
type EventMap = {
  'annotate-mode': [active: boolean];
  'list-toggle': [open: boolean];
  'freeze-toggle': [frozen: boolean];
  'copy': [markdown: string];
  'annotation-submit': [annotation: Annotation];
  'annotation-delete': [annotationId: string];
  'annotation-update': [annotation: Annotation];
  'popup-close': [];
  'marker-click': [annotationId: string];
  'annotations-changed': [annotations: Annotation[]];
  'sync-status-changed': [annotationId: string, status: AnnotationSyncStatus];
  'server-status-changed': [status: 'connected' | 'disconnected' | 'unknown'];
};

class EventEmitter {
  private listeners = new Map<string, Set<Function>>();
  on<K extends keyof EventMap>(event: K, fn: (...args: EventMap[K]) => void): () => void;
  emit<K extends keyof EventMap>(event: K, ...args: EventMap[K]): void;
  off<K extends keyof EventMap>(event: K, fn: Function): void;
  removeAllListeners(): void;
}
```

- **`shared/messages.ts`** — Typed message protocol (discriminated union with `requestId`):

```typescript
// Content → Background
type ContentRequest =
  | { type: 'CREATE_SESSION'; requestId: string; url: string; domain: string }
  | { type: 'SYNC_ANNOTATION'; requestId: string; sessionId: string; annotation: Annotation }
  | { type: 'UPDATE_ANNOTATION'; requestId: string; serverId: string; changes: Partial<Annotation> }
  | { type: 'DELETE_ANNOTATION'; requestId: string; serverId: string }
  | { type: 'CLEAR_ANNOTATIONS'; requestId: string; sessionId: string }
  | { type: 'CHECK_SERVER_HEALTH'; requestId: string }
  | { type: 'GET_SETTINGS'; requestId: string }
  | { type: 'SAVE_SETTINGS'; requestId: string; settings: ExtensionSettings }
  | { type: 'TOOLBAR_ACTIVATED'; tabId: number }
  | { type: 'TOOLBAR_DEACTIVATED'; tabId: number };

// Background → Content
type BackgroundResponse =
  | { type: 'SESSION_CREATED'; requestId: string; session: Session }
  | { type: 'SYNC_SUCCESS'; requestId: string; annotationId: string; serverId: string }
  | { type: 'UPDATE_SUCCESS'; requestId: string; serverId: string }
  | { type: 'DELETE_SUCCESS'; requestId: string }
  | { type: 'CLEAR_SUCCESS'; requestId: string }
  | { type: 'ANNOTATION_RESOLVED'; requestId: string; annotationId: string; summary: string }
  | { type: 'ANNOTATION_DISMISSED'; requestId: string; annotationId: string; reason: string }
  | { type: 'SERVER_STATUS'; status: 'connected' | 'disconnected' | 'unknown' }
  | { type: 'SETTINGS'; requestId: string; settings: ExtensionSettings }
  | { type: 'ERROR'; requestId: string; code: ErrorCode; message: string };

type ErrorCode =
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR'
  | 'VALIDATION_ERROR'
  | 'SESSION_NOT_FOUND'
  | 'SYNC_FAILED'
  | 'STORAGE_QUOTA'
  | 'UNKNOWN';
```

- **`lib/constants.ts`** — Shared constants:

```typescript
const Z_INDEX = {
  MARKER: 2147483646,
  TOOLBAR: 2147483647,
  DIALOG: 2147483647,
  LIST_PANEL: 2147483645,
} as const;

const SELECTORS = {
  ROOT: '[data-agt-root]',
  MARKER: '[data-agt-marker]',
  EXTENSION: '[data-agt-ext]',
  FREEZE_STYLE_ID: 'agt-ext-freeze-styles',
} as const;

const LIMITS = {
  MAX_RETRIES: 10,
  RETRY_BASE_DELAY_MS: 1000,
  RETRY_MAX_DELAY_MS: 30000,
  HEALTH_CHECK_INTERVAL_MIN: 0.5,
  ANNOTATION_EXPIRY_DAYS: 7,
  FREEZE_QUEUE_CAP: 500,
  REACT_FIBER_DEPTH_LIMIT: 30,
  REACT_FIBER_TIME_BUDGET_MS: 10,
} as const;
```

**Files created:**
- `lib/types.ts`
- `lib/event-emitter.ts`
- `lib/constants.ts`
- `shared/messages.ts`

### Step 3: Storage Layer

- **`lib/storage.ts`** using WXT's `storage.defineItem`:

```typescript
// Per-tab annotation store, keyed by tabId + URL path
const annotations = storage.defineItem<Record<string, Annotation[]>>(
  'local:annotations',
  { fallback: {} }
);

// Sync status per annotation
const syncStatus = storage.defineItem<Record<string, AnnotationSyncStatus>>(
  'local:syncStatus',
  { fallback: {} }
);

// Session mapping: tabId → { sessionId, url, serverId }
const sessions = storage.defineItem<Record<number, SessionInfo>>(
  'session:sessions',  // cleared on browser close
  { fallback: {} }
);

// Extension settings
const settings = storage.defineItem<ExtensionSettings>(
  'local:settings',
  {
    fallback: {
      serverUrl: 'http://localhost:4747',
      detailLevel: 'standard',
    },
  }
);

// Retry queue
const retryQueue = storage.defineItem<RetryEntry[]>(
  'local:retryQueue',
  { fallback: [] }
);
```

**Public API (all async):**
- `loadAnnotations(tabId: number, url: string): Promise<Annotation[]>` — filter by tab+URL, enforce 7-day expiry
- `saveAnnotation(tabId: number, url: string, annotation: Annotation): Promise<void>` — atomic get→merge→set
- `deleteAnnotation(tabId: number, url: string, annotationId: string): Promise<void>`
- `clearAnnotations(tabId: number, url: string): Promise<void>`
- `getSyncStatus(annotationId: string): Promise<AnnotationSyncStatus>`
- `setSyncStatus(annotationId: string, status: AnnotationSyncStatus): Promise<void>`
- `enqueueRetry(entry: RetryEntry): Promise<void>`
- `dequeueRetry(): Promise<RetryEntry[]>` — entries where `nextRetryAt <= Date.now()`
- `runExpiryCleanup(): Promise<void>` — delete annotations older than 7 days

**Race condition mitigation (storage lost-update):**

```typescript
async function saveAnnotation(tabId: number, url: string, annotation: Annotation): Promise<void> {
  const key = `${tabId}-${url}`;
  const current = await annotations.getValue();
  const existing = current[key] ?? [];
  await annotations.setValue({ ...current, [key]: [...existing, annotation] });
}
```

All writes go through a single async function — Chrome storage is serialized per-extension, making get→merge→set safe.

**Files created:**
- `lib/storage.ts`

### Step 4: Background Service Worker

- **`entrypoints/background.ts`** — All server communication, retry queue, SSE, toolbar toggle:

```typescript
export default defineBackground(() => {
  // Typed message routing
  browser.runtime.onMessage.addListener((msg: ContentRequest, sender, sendResponse) => {
    // Validate sender: only accept from content scripts of this extension
    if (!sender.tab) return; // reject messages from extension pages
    handleMessage(msg).then(sendResponse).catch(err => {
      sendResponse({ type: 'ERROR', requestId: msg.requestId, code: 'UNKNOWN', message: err.message });
    });
    return true; // keep channel open for async
  });

  // Extension icon click → toggle toolbar
  browser.action.onClicked.addListener(async (tab) => {
    if (!tab.id) return;
    // Register content script if not already registered
    try {
      await browser.scripting.registerContentScripts([{
        id: 'agentation-content',
        matches: ['<all_urls>'],
        js: ['content-scripts/content.js'],
        css: ['content-scripts/content.css'],
        runAt: 'document_idle',
      }]);
    } catch {
      // Already registered — ignore DOMException
    }
    // Retry up to 3 times with 500ms delay if content script not yet ready
    for (let i = 0; i < 3; i++) {
      try {
        await browser.tabs.sendMessage(tab.id, { type: 'TOGGLE_TOOLBAR' });
        break;
      } catch {
        if (i < 2) await new Promise(r => setTimeout(r, 500));
      }
    }
  });

  // Alarms: health check + retry queue (both every 30s)
  browser.alarms.create('health-check', { periodInMinutes: 0.5 });
  browser.alarms.create('retry-sync', { periodInMinutes: 0.5 });
  browser.alarms.onAlarm.addListener(handleAlarm);

  // SSE connection state
  let sseConnection: EventSource | null = null;
  const activeToolbarTabs = new Set<number>();

  async function handleMessage(msg: ContentRequest): Promise<BackgroundResponse> {
    switch (msg.type) {
      case 'CREATE_SESSION': return createSession(msg.url, msg.domain, msg.requestId);
      case 'SYNC_ANNOTATION': return syncAnnotation(msg.sessionId, msg.annotation, msg.requestId);
      case 'UPDATE_ANNOTATION': return updateAnnotation(msg.serverId, msg.changes, msg.requestId);
      case 'DELETE_ANNOTATION': return deleteAnnotation(msg.serverId, msg.requestId);
      case 'CLEAR_ANNOTATIONS': return clearAnnotations(msg.sessionId, msg.requestId);
      case 'CHECK_SERVER_HEALTH': return checkHealth(msg.requestId);
      case 'GET_SETTINGS': return getSettings(msg.requestId);
      case 'SAVE_SETTINGS': return saveSettings(msg.settings, msg.requestId);
      case 'TOOLBAR_ACTIVATED':
        activeToolbarTabs.add(msg.tabId);
        connectSSE();
        return; // fire-and-forget
      case 'TOOLBAR_DEACTIVATED':
        activeToolbarTabs.delete(msg.tabId);
        if (activeToolbarTabs.size === 0) disconnectSSE();
        return;
    }
  }

  async function handleAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
    if (alarm.name === 'health-check') await checkHealth('alarm');
    if (alarm.name === 'retry-sync') await processRetryQueue();
  }

  function connectSSE(): void {
    if (sseConnection) return; // already connected
    const serverUrl = /* read from settings */ 'http://localhost:4747';
    sseConnection = new EventSource(`${serverUrl}/events?agent=true`);
    sseConnection.onmessage = handleSSEEvent;
    sseConnection.onerror = () => {
      sseConnection?.close();
      sseConnection = null;
      // Reconnect with exponential backoff (1s → 2s → 4s → 30s max)
      scheduleSSEReconnect();
    };
  }

  function disconnectSSE(): void {
    sseConnection?.close();
    sseConnection = null;
  }

  async function processRetryQueue(): Promise<void> { /* ... */ }
});
```

**SSE reconnection (exponential backoff):**
- On `onerror`, close connection, schedule reconnect: 1s → 2s → 4s → ... → 30s max
- On reconnect, fetch any annotations resolved during disconnect: `GET /sessions/:id/annotations?status=resolved&since=<lastEventTimestamp>`

**State reconstruction on service worker restart:**
- Read `sessions` from `session:` storage
- Read `retryQueue` from `local:` storage
- If `activeToolbarTabs` is lost (in-memory), reconnect SSE on next `TOOLBAR_ACTIVATED`

**Files created/modified:**
- `entrypoints/background.ts`

## Research Insights

**TypeScript `Result<T, E>` type:** Use for message handler returns instead of throwing. Forces explicit error handling at every handler. Use mapped type `ResponseFor<T extends ContentRequest>` for compile-time request/response correlation.

**`requestId` rationale:** `chrome.runtime.sendMessage` provides implicit correlation per call, but SSE push events need explicit correlation — keep `requestId`.

**Storage write debouncing:** For bulk operations, use `queueMicrotask()` to coalesce rapid writes into a single `storage.local.set` per tick.

**Permission minimization (Chrome Web Store):** For distribution, remove `<all_urls>`, use `activeTab` + `chrome.scripting.executeScript`. Request `http://localhost:4747/*` as optional permission via `chrome.permissions.request()`.

## Acceptance Criteria

- [ ] `npm run dev` produces `.output/chrome-mv3/manifest.json` with correct permissions
- [ ] Extension installs via `chrome://extensions` → Load unpacked without errors
- [ ] All TypeScript types compile with strict mode (`noImplicitAny`, `strictNullChecks`)
- [ ] `lib/storage.ts` functions tested with Vitest unit tests (mock `wxt/storage`)
- [ ] `lib/event-emitter.ts` tested: subscribe, emit, unsubscribe, removeAllListeners
- [ ] Background service worker registers successfully (visible in `chrome://extensions` service worker link)
- [ ] `CHECK_SERVER_HEALTH` message returns `SERVER_STATUS: connected` when MCP server is running at localhost:4747
- [ ] `CREATE_SESSION` message creates a session on MCP server and returns `SESSION_CREATED` with session ID
- [ ] Retry queue: creating an annotation while server is down persists it to `local:retryQueue` storage
- [ ] Retry queue: starting server causes queued annotations to sync within 30 seconds
- [ ] SSE: `TOOLBAR_ACTIVATED` message causes background to connect to `/events?agent=true`
- [ ] SSE: `TOOLBAR_DEACTIVATED` (last tab) causes background to disconnect SSE
- [ ] Service worker restart: retry queue survives worker termination and resumes on next alarm
- [ ] No code copied from upstream Agentation project (clean-room check)

## Sources & References

- **Master plan:** [docs/plans/2026-04-03-001-feat-agentation-chrome-clean-room-reimplementation-plan.md](./2026-04-03-001-feat-agentation-chrome-clean-room-reimplementation-plan.md)
- **Behavioral spec:** [WALKTHROUGH.md](../../WALKTHROUGH.md) — §3.2 (types), §3.5–3.9 (utility modules)
- WXT documentation: https://wxt.dev/
- WXT storage API: https://wxt.dev/storage
- Chrome MV3 service worker lifecycle: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
