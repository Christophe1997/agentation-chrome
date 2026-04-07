---
title: feat: DevTools-style element picker for annotate mode
type: feat
status: active
date: 2026-04-07
---

# feat: DevTools-style element picker for annotate mode

## Overview

Replace the current rubber-band rectangle selection in annotate mode with a Chrome DevTools-style element inspector: as the user moves their mouse, the element under the cursor is highlighted with a colored overlay showing its bounding box; clicking picks that element and opens the annotation dialog.

## Problem Statement

The current annotate mode requires drawing a selection rectangle (drag to select), which is unintuitive and imprecise — the target element is determined by the geometric center of the drawn rectangle. Chrome DevTools' element inspector is the well-understood mental model: hover to see what you're about to select, click to confirm.

## Proposed Solution

When annotate mode is active:

1. On `pointermove`: find the element under the cursor via `document.elementFromPoint`, read its bounding rect, and position a highlight overlay (border + translucent fill) over it.
2. On `pointerdown` (not drag): immediately identify the element under the cursor and open the annotation dialog.
3. On `Escape` or annotate button toggle off: remove the highlight overlay and exit mode.

## Files to Change

| File | Change |
|---|---|
| `lib/app.ts` | Replace rubber-band logic with hover-picker logic |
| `ui/markers/markers.css` | *(no change — marker style unchanged)* |

**All changes are in `lib/app.ts` only.** No other files need modification.

## Technical Approach

### Remove (rubber-band fields and listeners)

From `AgentationApp` class, remove:
- `private selectionOverlay: HTMLElement | null` field
- `private selectStartX: number` field
- `private selectStartY: number` field
- `private moveListener` field
- `private upListener` field
- All rubber-band logic inside `captureListener` (overlay creation, move/up sub-listeners)
- The `10×10 minimum size` guard (no longer needed)

### Add (hover picker)

New private field:
```ts
// lib/app.ts
private hoverOverlay: HTMLElement | null = null;
private hoverListener: ((e: PointerEvent) => void) | null = null;
```

**`enableAnnotateMode()` new shape:**

```ts
enableAnnotateMode(): void {
  if (this.captureListener) return;
  this.savedCursor = document.documentElement.style.cursor;
  document.documentElement.style.cursor = 'default'; // keep default — highlight makes selection obvious

  // Create persistent hover overlay
  const overlay = document.createElement('div');
  overlay.setAttribute('data-agt-ext', '');
  overlay.style.cssText =
    'position:fixed;pointer-events:none;z-index:2147483645;' +
    'border:2px solid rgba(99,102,241,0.9);background:rgba(99,102,241,0.08);' +
    'border-radius:2px;transition:none;box-sizing:border-box;display:none;';
  document.body.appendChild(overlay);
  this.hoverOverlay = overlay;

  // Hover: highlight element under cursor
  this.hoverListener = (e: PointerEvent) => {
    if (this.dialog.isOpen) { overlay.style.display = 'none'; return; }
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target || target === document.body || target === document.documentElement) {
      overlay.style.display = 'none';
      return;
    }
    if ((target as HTMLElement).closest(SELECTORS.EXTENSION) ||
        (target as HTMLElement).closest(SELECTORS.ROOT)) {
      overlay.style.display = 'none';
      return;
    }
    // Batch: read rect, then write styles
    const rect = target.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.left   = `${rect.left}px`;
    overlay.style.top    = `${rect.top}px`;
    overlay.style.width  = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
  };
  document.addEventListener('pointermove', this.hoverListener);

  // Click: pick element and open dialog
  this.captureListener = async (e: PointerEvent) => {
    if (this.dialog.isOpen) return;
    const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement;
    if (!target) return;
    if (target.closest(SELECTORS.EXTENSION) || target.closest(SELECTORS.ROOT)) return;

    e.preventDefault();
    e.stopPropagation();

    overlay.style.display = 'none';

    const elementInfo = await identifyElementWithReact(target, identifyElement);
    this.dialog.open(elementInfo, { x: e.clientX, y: e.clientY }, window.getSelection()?.toString());
  };
  document.addEventListener('pointerdown', this.captureListener, { capture: true });
}
```

**`disableAnnotateMode()` new shape:**

```ts
disableAnnotateMode(): void {
  if (this.captureListener) {
    document.removeEventListener('pointerdown', this.captureListener, { capture: true });
    this.captureListener = null;
  }
  if (this.hoverListener) {
    document.removeEventListener('pointermove', this.hoverListener);
    this.hoverListener = null;
  }
  if (this.hoverOverlay) {
    this.hoverOverlay.remove();
    this.hoverOverlay = null;
  }
  document.documentElement.style.cursor = this.savedCursor;
  this.savedCursor = '';
}
```

### Key Design Decisions

**`pointer-events: none` on the overlay** — the highlight overlay must never intercept pointer events. If it did, `elementFromPoint` on the next `pointermove` would return the overlay element itself rather than the page element beneath it.

**`data-agt-ext` on the overlay** — the overlay is injected into `document.body` (like markers), so it must carry `data-agt-ext` so the `captureListener`'s guard filters it out.

**`elementFromPoint` returns shadow host** — when the cursor is over the toolbox, `document.elementFromPoint` returns the WXT shadow host element (`[data-agt-root]`). The `target.closest(SELECTORS.ROOT)` guard handles this by hiding the overlay and returning early.

**`display: none` vs removing the overlay** — a single persistent overlay element is used (not created/destroyed each frame) to avoid GC pressure on `pointermove` which fires at 60fps+. Toggling `display: none` is cheaper than DOM insertion/removal.

**No `moveListener` / `upListener`** — the drag mechanics are gone entirely. `captureListener` is now a simple click handler (still registered at capture phase so it fires before the page's own handlers).

**Cursor** — change from `crosshair` to `default` since the hover highlight makes the selection obvious. Alternatively keep `crosshair` as a secondary affordance — defer to implementation preference.

**Batch reads before writes** — inside `hoverListener`, `getBoundingClientRect()` is called once (read), then all four style properties are set (writes). This avoids layout thrashing. Do NOT interleave reads and writes.

## Acceptance Criteria

- [ ] Moving the mouse in annotate mode highlights the DOM element under the cursor with a translucent purple border+fill overlay
- [ ] The overlay correctly tracks the element's bounding box, including partially off-screen elements
- [ ] Clicking any element opens the annotation dialog pre-filled with that element's info
- [ ] Clicking extension UI (toolbox, dialog, markers) is ignored — overlay hides, no dialog opens
- [ ] `Escape` and the annotate button toggle correctly tear down the hover overlay
- [ ] No overlay is left in the DOM after `disableAnnotateMode()`
- [ ] The rubber-band drag-to-select behavior is removed entirely
- [ ] Existing tests for `enableAnnotateMode` / `disableAnnotateMode` in `lib/__tests__/app.test.ts` pass (update as needed)
- [ ] No visual flickering or layout thrashing on fast mouse movement

## System-Wide Impact

**Interaction graph:**
- `annotate-mode` event → `enableAnnotateMode()` → `pointermove` listener added to `document` — fires at up to 60fps while annotate mode is active. This is a hot path; keep the handler lean.
- `pointerdown` (capture) still fires before page handlers — same priority as before, no regression.
- `dialog.open()` call path unchanged — same downstream effects (dialog shown, textarea focused, etc.)

**State lifecycle risks:**
- If the user navigates (SPA navigation detected by `handleNavigation`) while annotate mode is active, `disableAnnotateMode` is NOT called automatically (navigation handler calls `removeAll` on markers but doesn't reset annotate mode). This is a pre-existing issue, not introduced here. The hover overlay would persist across navigation if this path is hit.
- Mitigation: `handleNavigation` should call `this.disableAnnotateMode()` if `this.annotateActive` — worth adding while in this file.

**Removed fields to clean up:**
- `private selectionOverlay`, `private selectStartX`, `private selectStartY`, `private moveListener`, `private upListener` — removing them reduces class size and eliminates null-safety checks in `destroy()`.

## Dependencies & Risks

- **60fps `pointermove` performance**: `getBoundingClientRect()` triggers a style recalculation. On complex pages, this could cause jank. Mitigation: keep the handler synchronous and minimal (no async, no DOM queries beyond `elementFromPoint` + one `getBoundingClientRect`). A `requestAnimationFrame` throttle is an option if jank is observed in testing.
- **`elementFromPoint` and iframes**: Returns `null` for iframe content — the guard handles null cleanly.
- **Pointer capture**: If a page element has `pointer capture` active, `pointermove` events will route to the capturing element regardless of physical position. This is an edge case; no mitigation needed.

## Sources

- Repo research: `lib/app.ts:56–158` (enableAnnotateMode/disableAnnotateMode), `lib/constants.ts` (SELECTORS), `lib/element-identification.ts`, `ui/markers/MarkerRegistry.ts`
- Institutional learning: `docs/solutions/ui-bugs/content-script-dialog-critical-fixes.md` — layout thrashing anti-pattern (batch reads before writes), event listener cleanup
