---
title: "feat: Phase 2 — Core UI (Shadow DOM, Toolbar, Click-to-Annotate, Markers)"
type: feat
status: complete
date: 2026-04-03
origin: docs/plans/2026-04-03-001-feat-agentation-chrome-clean-room-reimplementation-plan.md
---

# feat: Phase 2 — Core UI (Shadow DOM, Toolbar, Click-to-Annotate, Markers)

## Overview

This is Phase 2 of the Agentation Chrome Extension clean-room reimplementation. It builds the content script shell, the `AgentationApp` orchestrator, the floating toolbar UI, click-to-annotate capture logic, and the shared annotation marker system.

**Depends on:** Phase 1 complete — `lib/types.ts`, `lib/event-emitter.ts`, `lib/constants.ts`, `lib/storage.ts`, `shared/messages.ts`, and `entrypoints/background.ts` must all be in place and passing tests.

**Unlocks:** Phase 3 (Annotation Dialog, List Panel, Markdown Copy, Options Page).

See the master plan for full context: `docs/plans/2026-04-03-001-feat-agentation-chrome-clean-room-reimplementation-plan.md`

## Key Decisions (from master plan)

- **D1:** No popup — icon click sends `TOGGLE_TOOLBAR`; content script mounts/unmounts `AgentationApp`
- **D3:** Runtime content script registration (`registration: 'runtime'`); zero overhead on non-activated tabs
- **D6:** Single shared `ResizeObserver` for all markers; single `rAF`-throttled scroll handler
- **D7:** SPA navigation via `history.pushState`/`replaceState` monkey-patching + `popstate`

**Architecture recap:**

```
Content Script (Shadow DOM)           Background Service Worker
┌──────────────────────────┐         ┌────────────────────────┐
│ AgentationApp            │ ──msg→  │ Session mgmt           │
│ ├── Toolbar (Shadow DOM) │         │ Annotation CRUD + sync │
│ ├── AnnotationMarkers    │         │ SSE listener           │
│ │   (light DOM)          │ ←msg──  │ Retry queue            │
│ └── EventEmitter (bus)   │         └────────────────────────┘
└──────────────────────────┘
```

## Implementation Steps

### Step 5: Content Script Shell + Shadow DOM Setup

- **`entrypoints/content.ts`** — Minimal entry point:

```typescript
export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'ui',
  registration: 'runtime',

  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'agentation-toolbar',
      position: 'overlay',
      mode: 'open',
      isolateEvents: true,
      inheritStyles: false,

      onMount(container, shadow) {
        const app = new AgentationApp(container, shadow);
        return app;
      },

      onRemove(container, shadow, app) {
        app.destroy();
      },
    });

    // Listen for toggle from background
    browser.runtime.onMessage.addListener((msg, sender) => {
      if (sender.tab) return; // only accept from background
      if (msg.type === 'TOGGLE_TOOLBAR') {
        if (ui.mounted) {
          ui.remove();
          browser.runtime.sendMessage({ type: 'TOOLBAR_DEACTIVATED', tabId: /* current tab */ });
        } else {
          ui.mount();
          browser.runtime.sendMessage({ type: 'TOOLBAR_ACTIVATED', tabId: /* current tab */ });
        }
      }
    });

    // Do NOT auto-mount — wait for explicit activation
  },
});
```

**Shadow DOM mount timing race mitigation:**

`createShadowRootUi` returns before Shadow DOM is fully attached. `AgentationApp` must split initialization:
- `mount()` — creates toolbar UI only (safe to call immediately)
- `restore()` — creates markers from storage (deferred to next `requestAnimationFrame`)

**Service worker wake-up race mitigation:**

Background already handles retry (3× with 500ms delay) before sending `TOGGLE_TOOLBAR`. Content script must be idempotent if it receives the message while partially initialized.

- **`lib/app.ts`** (or inline in `content.ts`) — `AgentationApp` orchestrator:

```typescript
interface UIComponent {
  mount(container: HTMLElement): void;
  destroy(): void;
}

class AgentationApp {
  private eventBus: EventEmitter;
  private toolbar: Toolbar | null = null;
  private markerRegistry: MarkerRegistry;
  private freezeController: FreezeController;
  private tabId: number;
  private url: string;
  private annotations: Annotation[] = [];

  constructor(container: HTMLElement, shadow: ShadowRoot) {
    this.eventBus = new EventEmitter();
    this.url = window.location.href;
    this.markerRegistry = new MarkerRegistry(this.eventBus);
    this.freezeController = new FreezeController();

    this.setupNavigationDetection();
    browser.runtime.onMessage.addListener(this.handleBackgroundMessage);

    // Mount toolbar immediately
    this.toolbar = new Toolbar(container, this.eventBus);

    // Restore markers on next frame (avoid Shadow DOM timing race)
    requestAnimationFrame(() => this.loadAnnotations());
  }

  private setupNavigationDetection(): void {
    const originalPushState = history.pushState.bind(history);
    history.pushState = (...args) => {
      originalPushState(...args);
      window.dispatchEvent(new CustomEvent('agt:navigation'));
    };
    const originalReplaceState = history.replaceState.bind(history);
    history.replaceState = (...args) => {
      originalReplaceState(...args);
      window.dispatchEvent(new CustomEvent('agt:navigation'));
    };
    window.addEventListener('popstate', () => this.handleNavigation());
    window.addEventListener('agt:navigation', () => this.handleNavigation());
  }

  private async handleNavigation(): Promise<void> {
    this.markerRegistry.removeAll();
    this.url = window.location.href;
    await this.loadAnnotations();
  }

  private async loadAnnotations(): Promise<void> {
    // Load from storage, create markers for each annotation
  }

  destroy(): void {
    this.freezeController.unfreeze();
    this.markerRegistry.destroy();
    this.toolbar?.destroy();
    this.eventBus.removeAllListeners();
    // Restore patched history methods
  }
}
```

**Files created:**
- `entrypoints/content.ts`
- `lib/app.ts` (or inline)

### Step 6: Toolbar UI

- **`ui/toolbar/Toolbar.ts`** — Floating bar:

```typescript
class Toolbar implements UIComponent {
  private container: HTMLElement;
  private eventBus: EventEmitter;
  private annotateMode: boolean = false;

  constructor(parent: HTMLElement, eventBus: EventEmitter) {
    this.eventBus = eventBus;
    this.container = this.buildDOM(parent);
    this.attachListeners();
  }

  private buildDOM(parent: HTMLElement): HTMLElement {
    const toolbar = document.createElement('div');
    toolbar.className = 'agt-toolbar';
    toolbar.setAttribute('data-agt-ext', '');
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Agentation toolbar');
    // Buttons: annotate, text-select, list, freeze, copy, settings
    // Each button: role="button", aria-label, aria-pressed
    parent.appendChild(toolbar);
    return toolbar;
  }

  private attachListeners(): void {
    this.eventBus.on('annotate-mode', (active) => {
      this.annotateMode = active;
      // update aria-pressed on annotate button
    });
    this.eventBus.on('freeze-toggle', (frozen) => {
      // update aria-pressed on freeze button
    });
  }

  destroy(): void {
    this.container.remove();
  }
}
```

- **`ui/toolbar/toolbar.css`** — Scoped to Shadow DOM:

```css
/* Floating bar */
.agt-toolbar {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  gap: var(--agt-space-xs);
  padding: var(--agt-space-sm);
  background: rgba(26, 26, 46, 0.92);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: var(--agt-radius-lg);
  box-shadow: var(--agt-shadow-lg);
}

/* Buttons: 36×36px */
.agt-toolbar-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--agt-text-secondary);
  border-radius: var(--agt-radius-md);
  cursor: pointer;
  transition: background var(--agt-transition), color var(--agt-transition);
}
.agt-toolbar-btn:hover { background: rgba(255,255,255,0.08); color: var(--agt-text-primary); }
.agt-toolbar-btn[aria-pressed="true"] {
  background: var(--agt-accent-muted);
  color: var(--agt-accent);
  box-shadow: 0 0 0 1px var(--agt-accent);
}
```

- **`ui/shared.css`** — CSS custom properties (full "precision instrument" design system):

```css
:root {
  --agt-bg-primary: #1a1a2e;
  --agt-bg-secondary: #16213e;
  --agt-bg-surface: #0f3460;
  --agt-accent: #e94560;
  --agt-accent-hover: #ff6b81;
  --agt-accent-muted: rgba(233, 69, 96, 0.15);
  --agt-text-primary: #eaeaea;
  --agt-text-secondary: #8892a4;
  --agt-text-muted: #555e6e;
  --agt-success: #2ed573;
  --agt-warning: #ffa502;
  --agt-error: #ff4757;
  --agt-info: #70a1ff;
  --agt-space-xs: 4px; --agt-space-sm: 8px; --agt-space-md: 12px;
  --agt-space-lg: 16px; --agt-space-xl: 24px;
  --agt-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  --agt-font-size-xs: 11px; --agt-font-size-sm: 12px;
  --agt-font-size-md: 13px; --agt-font-size-lg: 14px;
  --agt-radius-sm: 4px; --agt-radius-md: 6px;
  --agt-radius-lg: 8px; --agt-radius-full: 9999px;
  --agt-shadow-sm: 0 1px 3px rgba(0,0,0,0.4);
  --agt-shadow-md: 0 4px 12px rgba(0,0,0,0.5);
  --agt-shadow-lg: 0 8px 24px rgba(0,0,0,0.6);
  --agt-transition: 150ms cubic-bezier(0.4, 0, 0.2, 1);
}
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}
```

Button icons: inline SVG string constants — no external icon library in Phase 2.

**Files created:**
- `ui/toolbar/Toolbar.ts`
- `ui/toolbar/toolbar.css`
- `ui/shared.css`

### Step 7: Click-to-Annotate Flow

> ⚠️ `lib/element-identification.ts` must be implemented here (reimplemented from spec). See Reimplementation Spec below.

- Capture-phase listener attached **only when annotate mode is active**:

```typescript
// In AgentationApp
private captureListener: ((e: PointerEvent) => void) | null = null;

enableAnnotateMode(): void {
  this.captureListener = (e: PointerEvent) => {
    const target = e.target as HTMLElement;
    // Do not intercept our own UI
    if (target.closest('[data-agt-ext]') || target.closest('[data-agt-root]')) return;

    e.preventDefault();
    e.stopPropagation();

    const elementInfo = identifyElement(target);  // lib/element-identification.ts
    const rect = target.getBoundingClientRect();
    this.showDialog(elementInfo, rect, { x: e.clientX, y: e.clientY });
  };
  document.addEventListener('pointerdown', this.captureListener, { capture: true });
}

disableAnnotateMode(): void {
  if (this.captureListener) {
    document.removeEventListener('pointerdown', this.captureListener, { capture: true });
    this.captureListener = null;
  }
}
```

- Text selection: on dialog open, check `window.getSelection()`. If non-empty, pre-fill in dialog textarea.
- Listener removed immediately on annotate mode deactivate (security review finding P2-3).

**`lib/element-identification.ts`** — Reimplemented from WALKTHROUGH.md §3.5:

```typescript
interface ElementInfo {
  name: string;
  path: string;             // max 4 levels, e.g. 'nav > .sidebar > button.primary'
  fullPath: string;
  nearbyText: string;
  cssClasses: string[];     // CSS module hashes stripped
  computedStyles: Record<string, string>;
  boundingBox: { x: number; y: number; width: number; height: number };
  accessibility: { role?: string; ariaLabel?: string; tabIndex?: number; focusable: boolean };
  nearbyElements: Array<{ tag: string; text?: string; class?: string }>;
}

function identifyElement(element: Element): ElementInfo;
function getElementPath(element: Element, maxDepth?: number): string;
function getNearbyText(element: Element): string;
function getComputedStylesForElement(element: Element): Record<string, string>;
function getAccessibilityInfo(element: Element): AccessibilityInfo;
```

**Behavioral spec (rewrite from scratch — do not copy upstream):**
- `name`: tag + significant attrs (type, role, aria-label, href, src, alt). First 50 chars of textContent for text elements.
- `path`: Walk DOM up to 4 levels / `<body>`. Prefer classes over tags. Strip CSS module hashes (`_[a-zA-Z0-9]{5,}$`).
- `nearbyText`: Own `textContent` (max 200 chars) + previous/next sibling text.
- `computedStyles`: Vary by element type — text: color/fontSize/fontWeight; interactive: backgroundColor/color/padding/borderRadius; containers: display/padding/margin/gap.
- `accessibility`: role, aria-label, aria-describedby, tabIndex, focusable check.
- `nearbyElements`: Up to 4 siblings with tag, text (first 30 chars), class list.
- Cross Shadow DOM: use `getRootNode()` + shadow host traversal.
- **Single-pass layout reads** (performance): batch all `getBoundingClientRect()` + `getComputedStyle()` calls before any DOM tree walking.

**Performance targets:**
- `identifyElement()` < 5ms on mid-range machine (measure via `performance.mark`)

**Files created:**
- `lib/element-identification.ts`

### Step 8: Annotation Markers (Shared Observer Pattern)

Markers live in **light DOM** (must overlay page content — Shadow DOM is behind stacking context).

- **`ui/markers/MarkerRegistry.ts`**:

```typescript
class MarkerRegistry {
  private markers = new Map<string, { element: Element; markerEl: HTMLElement }>();
  private elementToAnnotation = new Map<Element, string>();
  private observer: ResizeObserver;
  private scrollRafId: number = 0;
  private mutationObserver: MutationObserver;
  private positionUpdateScheduled = false;
  private styleEl: HTMLStyleElement;
  private eventBus: EventEmitter;

  constructor(eventBus: EventEmitter) {
    this.eventBus = eventBus;

    // Inject marker CSS into light DOM (not Shadow DOM)
    this.styleEl = document.createElement('style');
    this.styleEl.id = 'agt-marker-styles';
    document.head.appendChild(this.styleEl);
    this.styleEl.textContent = MARKER_CSS;

    // Single shared ResizeObserver
    this.observer = new ResizeObserver(() => this.schedulePositionUpdate());

    // Single throttled scroll handler
    window.addEventListener('scroll', () => this.schedulePositionUpdate(), { passive: true });

    // Detect annotated elements removed from DOM
    this.mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.removedNodes) {
          if (node instanceof Element) {
            for (const [element, annotationId] of this.elementToAnnotation) {
              if (node.contains(element)) this.setMarkerDetached(annotationId);
            }
          }
        }
      }
    });
    this.mutationObserver.observe(document.body, { childList: true, subtree: true });
  }

  addMarker(annotationId: string, element: Element, position: { x: number; y: number }): void {
    const markerEl = document.createElement('div');
    markerEl.setAttribute('data-agt-marker', annotationId);
    markerEl.className = 'agt-marker';
    markerEl.style.setProperty('--agt-x', `${position.x}px`);
    markerEl.style.setProperty('--agt-y', `${position.y}px`);
    document.body.appendChild(markerEl);

    markerEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.eventBus.emit('marker-click', annotationId);
    });

    this.markers.set(annotationId, { element, markerEl });
    this.elementToAnnotation.set(element, annotationId);
    this.observer.observe(element);
  }

  private schedulePositionUpdate(): void {
    if (this.positionUpdateScheduled) return;
    this.positionUpdateScheduled = true;
    requestAnimationFrame(() => {
      this.positionUpdateScheduled = false;
      this.updateAllMarkerPositions();
    });
  }

  private updateAllMarkerPositions(): void {
    for (const [annotationId, { element, markerEl }] of this.markers) {
      const rect = element.getBoundingClientRect();
      markerEl.style.setProperty('--agt-x', `${rect.left + rect.width / 2}px`);
      markerEl.style.setProperty('--agt-y', `${rect.top + rect.height / 2}px`);
    }
  }

  private setMarkerDetached(annotationId: string): void {
    const entry = this.markers.get(annotationId);
    if (entry) entry.markerEl.classList.add('agt-marker--detached');
  }

  removeAll(): void { /* remove all markers from DOM, clear maps, unobserve all */ }

  destroy(): void {
    this.removeAll();
    this.observer.disconnect();
    this.mutationObserver.disconnect();
    window.removeEventListener('scroll', this.schedulePositionUpdate);
    this.styleEl.remove();
  }
}
```

- **`ui/markers/markers.css`** — Compositor-thread positioning via CSS custom properties:

```css
.agt-marker {
  position: fixed;
  left: 0;
  top: 0;
  transform: translate(var(--agt-x), var(--agt-y)) translate(-50%, -50%);
  will-change: transform;
  z-index: 2147483646;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--agt-accent, #e94560);
  border: 2px solid white;
  cursor: pointer;
  box-shadow: var(--agt-shadow-sm);
}
.agt-marker--detached {
  opacity: 0.4;
  border-style: dashed;
}
/* Status badges */
.agt-marker[data-status="synced"]::after { content: '✓'; color: var(--agt-success); }
.agt-marker[data-status="failed"]::after { content: '●'; color: var(--agt-error); }
.agt-marker[data-status="pending"]::after { content: '○'; color: var(--agt-warning); }
```

- Markers injected via `<style>` element in `<head>` (not inline styles) — preserves cascade without `!important` on all properties.
- `transform: translate(x, y)` updates happen on compositor thread — no layout or paint triggered during scroll.

**Files created:**
- `ui/markers/MarkerRegistry.ts`
- `ui/markers/markers.css`

## Research Insights

**Capture-phase vs page handler priority:** The capture-phase `pointerdown` listener uses `stopPropagation()`. If the host page uses capture-phase listeners (analytics, modal traps), order is insertion-order dependent. This is a known limitation for Phase 2 — analytics scripts typically don't interfere.

**ResizeObserver vs rAF ordering:** Without the `positionUpdateScheduled` dirty flag, both `ResizeObserver` callbacks and scroll `rAF` callbacks can fire in the same frame, causing double updates. The dirty flag coalesces them into a single rAF per frame.

**Marker updates during animations:** When freeze mode is active, skip position updates — elements aren't moving. When unfrozen, `ResizeObserver` + `rAF` handles animated element positions naturally.

**Component lifecycle interface:** All UI classes implement `UIComponent { mount(container): void; destroy(): void }` so `AgentationApp` can manage lifecycle uniformly and prevent resource leaks.

**Accessibility requirements:**
- Toolbar: `role="toolbar"`, `aria-label="Agentation toolbar"`, each button has `role="button"`, `aria-label`, `aria-pressed`
- Keyboard: Tab through toolbar buttons, Enter/Space to activate, Escape to close
- All colors meet WCAG AA (4.5:1 contrast ratio for text)
- Respect `prefers-reduced-motion`

## Acceptance Criteria

- [ ] Extension icon click shows/hides floating toolbar on any website
- [ ] Toolbar has 6 buttons (annotate, text-select, list, freeze, copy, settings) — all keyboard accessible
- [ ] Toolbar buttons have `aria-label` and `aria-pressed` states
- [ ] Toolbar Lighthouse accessibility audit passes (no critical violations)
- [ ] Clicking "Annotate" enables mode (button shows accent glow); clicking again disables it
- [ ] In annotate mode, clicking any page element shows `ElementInfo` in console (dialog comes in Phase 3)
- [ ] Clicking extension UI elements in annotate mode does NOT trigger annotation
- [ ] `identifyElement()` unit tests pass for: text element, button, image, input, nested SVG, cross-Shadow DOM
- [ ] `identifyElement()` completes in < 5ms (verified with `performance.mark` in DevTools)
- [ ] Markers appear at correct positions after annotation creation
- [ ] Markers track element position during scroll (compositor-thread — no layout thrashing)
- [ ] Markers track element position during window resize
- [ ] Detached marker state: element removed from DOM → marker dims with dashed border
- [ ] Only one `ResizeObserver` instance exists for all markers (verified via DevTools)
- [ ] SPA navigation: URL change clears markers, loads annotations for new URL
- [ ] No CSS conflicts with host page in light DOM (markers use `[data-agt-marker]` scoped selectors)

## Sources & References

- **Master plan:** [docs/plans/2026-04-03-001-feat-agentation-chrome-clean-room-reimplementation-plan.md](./2026-04-03-001-feat-agentation-chrome-clean-room-reimplementation-plan.md)
- **Phase 1 plan:** [docs/plans/2026-04-03-002-feat-phase-1-foundation-scaffolding-storage-background.md](./2026-04-03-002-feat-phase-1-foundation-scaffolding-storage-background.md)
- **Behavioral spec:** [WALKTHROUGH.md](../../WALKTHROUGH.md) — §3.5 (element-identification)
- WXT content scripts guide: https://wxt.dev/guide/essentials/content-scripts
