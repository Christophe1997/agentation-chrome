---
title: "Content script tabId, dialog marker position, and focus trap fixes"
category: ui-bugs
date: 2026-04-07
tags:
  - chrome-extension
  - wxt
  - mv3
  - content-script
  - shadow-dom
  - focus-trap
  - accessibility
  - annotation-dialog
  - marker-positioning
  - tab-id
  - sse-lifecycle
component:
  - entrypoints/content.ts
  - ui/dialog/AnnotationDialog.ts
---

# Content Script tabId, Dialog Marker Position, and Focus Trap Fixes

## Problem

Three P1 critical bugs were found during a multi-agent code review of the Agentation Chrome Extension (MV3, WXT + TypeScript). The content script sent `tabId: -1` for toolbar activation messages, preventing the background service worker from correctly managing SSE connections per tab. The annotation dialog submitted new annotations with hardcoded `(0, 0)` coordinates instead of the user's click position, causing all markers to render at the viewport top-left corner. The annotation dialog declared `aria-modal="true"` without implementing an actual focus trap, allowing keyboard users to tab out of the dialog into the underlying page.

## Root Cause

### Bug 1: Hardcoded tabId placeholder

The content script hardcoded `tabId: -1` when dispatching `TOOLBAR_ACTIVATED` and `TOOLBAR_DEACTIVATED` messages to the background service worker. The background's `handleFireAndForget()` blindly inserted this sentinel value into the `activeToolbarTabs` Set. Since the set never reached zero, SSE connections persisted indefinitely, broadcast messages silently targeted a nonexistent tab, and active-toolbar tracking was completely non-functional.

### Bug 2: Click coordinates not threaded through dialog lifecycle

`AnnotationDialog._handleSubmit()` constructed new `Annotation` objects with hardcoded `x: 0, y: 0`. The click coordinates were passed into `open()` as the `position` parameter but were never stored on the instance, so `_handleSubmit()` had no access to them.

### Bug 3: ARIA attribute without behavioral implementation

The dialog declared `aria-modal="true"` which signals to assistive technology that focus should be trapped, but no programmatic focus trap was implemented. Tab and Shift+Tab moved focus behind the dialog into the host page, violating WAI-ARIA modal dialog requirements.

## Solution

### Fix 1: Resolve actual tab ID before sending messages

Changed the content script message listener to resolve the real tab ID via `browser.tabs.getCurrent()` before sending activation/deactivation messages.

**`entrypoints/content.ts` — message listener:**
```typescript
// Before
browser.runtime.sendMessage({ type: 'TOOLBAR_DEACTIVATED', tabId: -1 }).catch(() => {});

// After
const sendToggle = async (type: 'TOOLBAR_ACTIVATED' | 'TOOLBAR_DEACTIVATED') => {
  try {
    const tab = await browser.tabs.getCurrent();
    const tabId = tab?.id ?? -1;
    await browser.runtime.sendMessage({ type, tabId });
  } catch { /* extension context may be invalidated */ }
};
```

### Fix 2: Store position in dialog, use in submit

Added a `currentPosition` field to `AnnotationDialog`. Stored on `open()`, read in `_handleSubmit()`, cleared on `close()`.

**`ui/dialog/AnnotationDialog.ts`:**
```typescript
// Field
private currentPosition: { x: number; y: number } | null = null;

// In open()
this.currentPosition = position;

// In _handleSubmit()
x: this.currentPosition?.x ?? 0,
y: this.currentPosition?.y ?? 0,

// In close()
this.currentPosition = null;
```

### Fix 3: Implement focus trap in keydown handler

Added Tab/Shift+Tab cycling through focusable children. Also captured `document.activeElement` in `open()` as `triggerButton` for focus restoration on close.

**`ui/dialog/AnnotationDialog.ts` — keydown handler addition:**
```typescript
// In open()
this.triggerButton = document.activeElement as HTMLElement;

// In keydown handler (alongside existing Escape logic)
if (e.key === 'Tab') {
  const focusable = this.container.querySelectorAll<HTMLElement>(
    'button, textarea, [tabindex]:not([tabindex="-1"])',
  );
  if (focusable.length === 0) return;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
```

## Verification

- 157 tests pass (`npx vitest run`) — no regressions
- TypeScript clean (`tsc --noEmit`) — strict mode, zero errors
- All fixes localized to two files: `entrypoints/content.ts` and `ui/dialog/AnnotationDialog.ts`

## Prevention Strategies

### Hardcoded IDs in cross-context messaging

- Ban magic numbers in IPC message payloads. Tab IDs should only come from resolved runtime values.
- Use typed factory functions for message construction that require a valid `tabId` parameter.
- Write integration tests that verify message payloads contain valid positive integer tab IDs.

### State threading through component lifecycle

- When `open()` receives state that `_handleSubmit()` depends on, store it as a class field immediately.
- Design submit handlers to receive dependencies explicitly rather than relying on implicit `this` state.
- Test the full method chain (`open` → `_handleSubmit` → event emitted) and assert output contains all inputs.

### ARIA attributes without behavior

- Establish an audit rule: adding `aria-modal`, `aria-expanded`, or `role="dialog"` requires a corresponding implementation.
- Add axe-core smoke tests in CI that fail on `aria-modal` without a focus trap.
- Extract a `FocusTrapMixin` or component base class so any component setting `aria-modal="true"` automatically gets the trap.

### Test cases that would have caught these

| Bug | Test |
|-----|------|
| tabId: -1 | Assert `sendMessage` payload's `tabId` is not `-1` |
| Marker position | Call `open(100, 200)` then `_handleSubmit()`, assert payload includes `x: 100, y: 200` |
| Marker position | Call `_handleSubmit()` without `open()`, assert it throws or errors |
| Focus trap | Open dialog, press Tab N times (N > focusable count), assert focus never leaves dialog |
| Focus trap | Open dialog, press Escape, assert focus returns to trigger element |

## Related Documentation

- **Phase 1 plan:** `docs/plans/2026-04-03-002-feat-phase-1-foundation-scaffolding-storage-background.md` — MV3 architecture, message protocol design
- **Phase 2 plan:** `docs/plans/2026-04-03-003-feat-phase-2-core-ui-shadow-dom-toolbar-markers.md` — Shadow DOM, content script registration, marker positioning spec
- **Phase 3 plan:** `docs/plans/2026-04-03-004-feat-phase-3-features-dialog-copy-freeze-options.md` — Dialog requirements, focus trap acceptance criteria (lines 361-363)
- **P2/P3 findings:** `docs/plans/2026-04-07-001-fix-p2-p3-review-findings-plan.md` — Remaining issues from the same review
- **Storage test patterns:** `docs/solutions/test-failures/wxt-storage-coverage-timing-flakiness.md` — WXT mock patterns used in tests

## Anti-Patterns Identified

| Pattern | Description | Location |
|---------|-------------|----------|
| Message listener leak | `onMessage.addListener` without `ctx.onInvalidated` cleanup | `content.ts:25` (still open P2-3) |
| Layout thrashing | `getBoundingClientRect()` reads interleaved with `setProperty()` writes | `MarkerRegistry.ts:118` (open P3-10) |
| Broad MutationObserver | `document.body` with `subtree: true` without batching | `MarkerRegistry.ts:67` (open P2-7) |
| Unsafe type casting | `as` casts on external SSE data without validation | `background.ts:304` (open P2-4) |
