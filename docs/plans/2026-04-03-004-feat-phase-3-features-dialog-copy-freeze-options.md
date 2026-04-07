---
title: "feat: Phase 3 — Features (Dialog, List Panel, Markdown Copy, Freeze, Options)"
type: feat
status: complete
date: 2026-04-03
origin: docs/plans/2026-04-03-001-feat-agentation-chrome-clean-room-reimplementation-plan.md
---

# feat: Phase 3 — Features (Dialog, List Panel, Markdown Copy, Freeze, Options)

## Overview

This is Phase 3 of the Agentation Chrome Extension clean-room reimplementation. It completes the core user-facing features: the annotation dialog, annotation list panel, markdown copy (4 detail levels), animation freeze, and the options/settings page.

**Depends on:** Phase 1 and Phase 2 complete — specifically:
- `AgentationApp` orchestrator with `EventEmitter` bus
- `MarkerRegistry` (Phase 2) for marker creation after dialog submit
- `lib/storage.ts` for annotation persistence (Phase 1)
- `shared/messages.ts` typed protocol for background sync (Phase 1)
- `lib/element-identification.ts` for dialog element info display (Phase 2)

**Completes the MVP.** After this phase, all acceptance criteria from the master plan should be satisfied.

See the master plan for full context: `docs/plans/2026-04-03-001-feat-agentation-chrome-clean-room-reimplementation-plan.md`

## Key Decisions (from master plan)

- **D5:** WXT `storage.defineItem` — settings stored in `local:settings`
- **D6:** Markdown copy uses `navigator.clipboard.writeText()` with `execCommand` fallback
- **Freeze:** State stored in module closure (NOT on `window`) to avoid collision with React Agentation
- **Freeze queue cap:** 500 callbacks max (performance review finding P1-3)
- **Detail level default:** `'standard'`

## Implementation Steps

### Step 9: Annotation Dialog + List Panel

#### `ui/dialog/AnnotationDialog.ts` — Modal dialog

Triggered by `AgentationApp` after `identifyElement()` completes. Receives `ElementInfo` and click coordinates.

```typescript
class AnnotationDialog implements UIComponent {
  private container: HTMLElement;
  private eventBus: EventEmitter;
  private currentElement: Element | null = null;
  private triggerButton: HTMLElement | null = null; // for focus restoration

  constructor(parent: HTMLElement, eventBus: EventEmitter) {
    this.eventBus = eventBus;
    this.container = this.buildDOM(parent);
    this.attachListeners();
  }

  open(elementInfo: ElementInfo, position: { x: number; y: number }, selectedText?: string): void {
    // Populate element name, path, computed styles accordion
    // Pre-fill selectedText in textarea if provided
    // Position near click, clamp to viewport
    // Focus first interactive element (textarea)
    // Trap focus: Tab cycles within dialog, Escape closes
  }

  close(): void {
    this.container.hidden = true;
    this.triggerButton?.focus(); // restore focus
    this.eventBus.emit('popup-close');
  }

  private buildDOM(parent: HTMLElement): HTMLElement {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'agt-dialog-title');
    dialog.className = 'agt-dialog';
    dialog.hidden = true;
    parent.appendChild(dialog);
    return dialog;
    // Structure:
    // - .agt-dialog-header: element name (#agt-dialog-title), close button
    // - .agt-dialog-element-info: DOM path, React components (if any)
    // - <details>.agt-dialog-styles: computed styles accordion (collapsed by default)
    // - .agt-dialog-selected-text: selected text quote (if any)
    // - textarea.agt-dialog-textarea: feedback input
    // - .agt-dialog-footer: Cancel / Delete (if editing) / Submit
  }

  private attachListeners(): void {
    // Enter-to-submit, Escape-to-cancel
    // Submit: create Annotation, emit 'annotation-submit'
    // Delete: emit 'annotation-delete' (only shown when editing existing annotation)
    // Focus trap implementation
  }

  destroy(): void { this.container.remove(); }
}
```

**CSS guidelines (`ui/dialog/dialog.css`):**
- Max-width: 420px, max-height: 80vh with overflow scroll
- Centered near click point, clamped to viewport (8px margin)
- `backdrop-filter: blur(4px)` semi-transparent overlay behind dialog
- Textarea: full-width, 80px min-height, resize vertical only
- Focus trap: Tab must cycle through dialog's interactive elements; Shift+Tab reverses

**Focus management:**
- On open: `textarea.focus()`
- On close: return focus to the element that triggered the dialog (toolbar annotate button or marker)
- Tab order: textarea → submit button → cancel button → close button → back to textarea

#### `ui/list/AnnotationList.ts` — Slide-out panel

```typescript
class AnnotationList implements UIComponent {
  private container: HTMLElement;
  private eventBus: EventEmitter;

  constructor(parent: HTMLElement, eventBus: EventEmitter) {
    this.eventBus = eventBus;
    this.container = this.buildDOM(parent);
    this.attachListeners();

    // Rebuild list when annotations change
    this.eventBus.on('annotations-changed', (annotations) => this.render(annotations));
    this.eventBus.on('sync-status-changed', (id, status) => this.updateRowStatus(id, status));
  }

  toggle(open: boolean): void {
    this.container.hidden = !open;
    this.container.setAttribute('aria-hidden', String(!open));
  }

  private render(annotations: Annotation[]): void {
    // Each row: element name, comment preview (max 80 chars), status badge
    // Status badge colors: pending=yellow, syncing=blue, synced=green, failed=red, resolved=checkmark
    // Click row: scroll element into view, emit 'annotation-click' (reopens dialog for editing)
    // Delete button per row: emit 'annotation-delete'
    // "Clear all" button with confirmation dialog: emit 'clear-all'
  }

  destroy(): void { this.container.remove(); }
}
```

**CSS guidelines (`ui/list/list.css`):**
- Slide-out panel: `position: fixed; right: 80px; top: 50%; transform: translateY(-50%)`
- Width: 320px, max-height: 70vh, scroll
- Roles: `role="listbox"`, each item `role="option"`, `aria-selected`
- Click to scroll: `element.scrollIntoView({ behavior: 'smooth', block: 'center' })`

**Files created:**
- `ui/dialog/AnnotationDialog.ts`
- `ui/dialog/dialog.css`
- `ui/list/AnnotationList.ts`
- `ui/list/list.css`

### Step 10: Markdown Copy + Freeze Animations

#### `lib/generate-output.ts` — Markdown generation (reimplemented from WALKTHROUGH.md §3.8)

```typescript
function generateMarkdown(annotations: Annotation[], level?: OutputDetailLevel): string;
```

**Behavioral spec — 4 detail levels:**

| Level | Content |
|-------|---------|
| `compact` | Numbered list: `1. **element**: comment` |
| `standard` | Element name, DOM path, React components (if any), selected text, comment |
| `detailed` | Adds CSS classes, bounding box position, nearby text context |
| `forensic` | Full DOM path, all CSS classes, viewport position, all computed styles, accessibility info, React component hierarchy |

**Clipboard with fallback:**
```typescript
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
  }
}
```

`navigator.clipboard.writeText()` requires a secure context (HTTPS or localhost) and user gesture. The fallback handles HTTP pages.

#### `lib/freeze-animations.ts` — Animation freezing (reimplemented from WALKTHROUGH.md §3.7)

```typescript
function freeze(): void;
function unfreeze(): void;
function isFrozen(): boolean;
// Exported for toolbar code that must bypass freeze:
export { originalSetTimeout, originalSetInterval, originalRAF };
```

**Behavioral spec — 4 mechanisms in order:**

1. **CSS injection** (primary): Inject `<style id="agt-ext-freeze-styles">` into `<head>`:
   ```css
   :not([data-agt-ext]) {
     animation-play-state: paused !important;
     transition: none !important;
   }
   ```

2. **WAAPI pause** (secondary): `document.getAnimations()` → `.pause()`. Skip animations on `[data-agt-ext]` elements.

3. **JS timing patch** (last resort, enabled when `freeze()` called with `{ patchJS: true }`):
   - Patch `setTimeout`, `setInterval`, `requestAnimationFrame`
   - Queue callbacks during freeze; replay on `unfreeze()`
   - **Queue cap: 500** — drop oldest with `console.warn` when exceeded
   - State stored in **module closure** (NOT on `window` — avoids collision with React Agentation's `window.__agentation_freeze`)

4. **Video pause**: `document.querySelectorAll('video:not([data-agt-ext])')` → `.pause()`

`unfreeze()` reverses all steps in reverse order. CSS style element removed. WAAPI animations `.play()`. Queued JS callbacks replayed in order using saved `originalSetTimeout`.

**Files created:**
- `lib/generate-output.ts`
- `lib/freeze-animations.ts`

#### `lib/react-detection.ts` — React component detection (reimplemented from WALKTHROUGH.md §3.6)

```typescript
function getReactComponents(element: Element, mode?: ReactComponentMode): string[];
function isReactPage(): boolean;
```

**Behavioral spec:**
- Access fiber via `Object.keys(element).find(k => k.startsWith('__reactFiber$'))`
- Walk up fiber tree from element's fiber node
- 3 modes: `all`, `filtered` (skip ErrorBoundary/Provider/Consumer/Router/Suspense), `smart` (default: CSS class name correlation)
- Works with React 16–19 (handle changing fiber key names)
- **Abort after 10ms** (`performance.now()`) — return partial results
- **Depth limit: 30 levels**
- Optional 2-second TTL WeakMap cache: `WeakMap<Element, { names: string[]; ts: number }>` — entries GC'd when elements removed

**Dynamic import optimization** (only load on React pages):
```typescript
async function identifyElementWithReact(element: Element): Promise<ElementInfo> {
  const info = identifyElement(element);
  if (isReactPage()) {
    const { getReactComponents } = await import('./react-detection');
    info.reactComponents = getReactComponents(element);
  }
  return info;
}
```

**Files created:**
- `lib/react-detection.ts`

### Step 11: Options Page

- **`entrypoints/options/`** — Settings page (WXT auto-generates manifest `options_page` entry):

```typescript
// entrypoints/options/main.ts
const settings = await loadSettings(); // GET_SETTINGS via chrome.runtime.sendMessage
renderForm(settings);

async function onSaveSettings(newSettings: ExtensionSettings): Promise<void> {
  await browser.runtime.sendMessage({ type: 'SAVE_SETTINGS', requestId: uuid(), settings: newSettings });
  showToast('Settings saved');
}

async function onTestConnection(): Promise<void> {
  const result = await browser.runtime.sendMessage({ type: 'CHECK_SERVER_HEALTH', requestId: uuid() });
  showConnectionStatus(result.status === 'connected' ? 'Connected' : 'Unreachable');
}
```

**Options page sections:**
- **Server URL** input (default: `http://localhost:4747`) + "Test Connection" button
- **Detail level** selector: radio buttons (compact / standard / detailed / forensic)
- **Annotation count** display (aggregated across all stored tabs/URLs)
- **"Clear all data"** button (confirmation required) — calls `clearAnnotations` for all keys

**Files created:**
- `entrypoints/options/index.html`
- `entrypoints/options/main.ts`
- `entrypoints/options/style.css`

## Reimplementation Notes

All modules in `lib/` (`generate-output.ts`, `freeze-animations.ts`, `react-detection.ts`) are **reimplemented from behavioral specifications in WALKTHROUGH.md** — not from upstream source code. The following must NOT be copied:
- Variable names or internal structure from upstream `generate-output.ts`, `freeze-animations.ts`, `react-detection.ts`
- The upstream `icons.tsx` (icons must be redrawn or sourced from a permissive icon library)

## System-Wide Impact (Phase 3 additions)

### Interaction Graph

```
User clicks "Copy" toolbar button
  → Toolbar emits 'copy'
  → AgentationApp calls generateMarkdown(annotations, detailLevel)
  → copyToClipboard(markdown)
  → Toast: "Copied N annotations"

User submits annotation dialog
  → AnnotationDialog emits 'annotation-submit' with Annotation object
  → AgentationApp saves to storage (saveAnnotation)
  → AgentationApp sends SYNC_ANNOTATION to background
  → AgentationApp adds marker via MarkerRegistry
  → AgentationApp emits 'annotations-changed' (updates list panel)
  → Background POSTs to MCP /sessions/:id/annotations
  → Background replies SYNC_SUCCESS → AgentationApp updates syncStatus indicator

User clicks marker
  → MarkerRegistry emits 'marker-click' with annotationId
  → AgentationApp opens AnnotationDialog in edit mode for that annotation

SPA navigation with open dialog
  → agt:navigation event fires
  → AgentationApp auto-saves in-progress annotation as draft (status: 'pending', intent: 'draft')
  → Shows toast: "Draft saved — resume in annotation list"
  → Dialog closes
```

### Error & Failure Propagation

| Error Source | User Feedback |
|-------------|---------------|
| Clipboard API unavailable (HTTP) | `execCommand` fallback used silently |
| Clipboard `execCommand` fails | Toast: "Copy failed — select text manually" |
| Storage quota exceeded | Toast: "Storage full, cleaning up old annotations..." then cleanup |
| All freeze mechanisms fail | Console warning; toolbar freeze button stays unchecked |

### Integration Test Scenarios

1. **End-to-end annotation flow**: Activate toolbar → annotate mode → click element → fill dialog → submit. Verify: marker appears, list panel shows annotation, status transitions pending → synced.

2. **Offline → online sync**: Submit annotation while MCP server down. Verify status badge shows "pending". Start server. Verify synced within 30s.

3. **Markdown copy**: Create 3 annotations at different detail levels. Toggle detail level in options. Click copy. Paste and verify markdown format matches selected level.

4. **Freeze animations**: Open a page with CSS animations (e.g., loading spinners). Activate freeze. Verify animations pause, toolbar remains interactive. Deactivate freeze. Verify animations resume.

5. **Coexistence with React Agentation**: Load a page with `<Agentation />` embedded. Activate Chrome extension toolbar. Verify: no shared state, no visual conflict, both toolbar UIs work independently, freeze state in module closure does not leak to React component.

## Acceptance Criteria

### Annotation Dialog

- [ ] Clicking element in annotate mode opens dialog near click position, clamped to viewport
- [ ] Dialog shows element name, DOM path, React component names (if on React page)
- [ ] Computed styles accordion is collapsed by default, expands on click
- [ ] Selected text quote shown if text was selected before clicking
- [ ] Enter key submits dialog; Escape key closes without saving
- [ ] Submit creates annotation, adds marker, sends SYNC_ANNOTATION to background
- [ ] Dialog focus trap: Tab cycles within dialog; Shift+Tab reverses; Escape closes
- [ ] Dialog `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to title
- [ ] Focus restored to trigger element on dialog close

### Annotation List Panel

- [ ] List button toggles slide-out panel showing all annotations for current URL
- [ ] Each row shows element name, comment preview (80 chars), status badge
- [ ] Status badge colors: pending=yellow, synced=green, failed=red, resolved=checkmark
- [ ] Clicking row scrolls annotated element into view (`scrollIntoView({ behavior: 'smooth' })`) and reopens dialog in edit mode
- [ ] Delete button per row removes annotation, removes marker, removes from storage
- [ ] "Clear all" shows confirmation before clearing; clears storage and all markers
- [ ] List auto-updates when annotations change (via 'annotations-changed' event)
- [ ] List auto-updates sync status badges (via 'sync-status-changed' event)

### Markdown Copy

- [ ] Copy button generates markdown at current detail level and copies to clipboard
- [ ] All 4 detail levels produce correct format (compact/standard/detailed/forensic)
- [ ] Copy works on HTTP pages (execCommand fallback)
- [ ] Toast notification confirms copy success

### Freeze Animations

- [ ] Freeze button pauses all CSS animations and transitions on page
- [ ] Freeze does NOT affect toolbar, dialog, markers (excluded via `[data-agt-ext]`)
- [ ] WAAPI animations pause on freeze
- [ ] Video elements pause on freeze
- [ ] Unfreeze restores all animations to running state
- [ ] Freeze state in module closure — does NOT write to `window` (coexistence safe)
- [ ] JS timing patch queue capped at 500 callbacks (overflow drops oldest + console.warn)

### Options Page

- [ ] `chrome://extensions` → Extension options opens options page
- [ ] Server URL change persists and is used by background for subsequent requests
- [ ] "Test Connection" button shows "Connected" when MCP server is running
- [ ] Detail level selector changes default for markdown copy (immediately effective)
- [ ] "Clear all data" removes all annotations from storage (with confirmation)
- [ ] Annotation count displays correctly (sum across all stored tab+URL keys)

### React Detection

- [ ] React component names appear in annotation dialog on React pages (GitHub, etc.)
- [ ] React detection does NOT load on non-React pages (dynamic import)
- [ ] Fiber walk aborts after 10ms (partial results returned, no UI freeze)
- [ ] Works on React 16, 17, 18, 19 (tested on at least 2 versions)

### Clean-Room Verification

- [ ] No code copied from upstream Agentation project in `lib/generate-output.ts`, `lib/freeze-animations.ts`, `lib/react-detection.ts`
- [ ] SVG icons are original or from a permissive icon library (not converted from `icons.tsx`)
- [ ] All variable names in reimplemented modules are independently chosen

## Sources & References

- **Master plan:** [docs/plans/2026-04-03-001-feat-agentation-chrome-clean-room-reimplementation-plan.md](./2026-04-03-001-feat-agentation-chrome-clean-room-reimplementation-plan.md)
- **Phase 1 plan:** [docs/plans/2026-04-03-002-feat-phase-1-foundation-scaffolding-storage-background.md](./2026-04-03-002-feat-phase-1-foundation-scaffolding-storage-background.md)
- **Phase 2 plan:** [docs/plans/2026-04-03-003-feat-phase-2-core-ui-shadow-dom-toolbar-markers.md](./2026-04-03-003-feat-phase-2-core-ui-shadow-dom-toolbar-markers.md)
- **Behavioral spec:** [WALKTHROUGH.md](../../WALKTHROUGH.md) — §3.6 (react-detection), §3.7 (freeze-animations), §3.8 (generate-output)
- Chrome extensions permissions: https://developer.chrome.com/docs/extensions/develop/concepts/permissions
