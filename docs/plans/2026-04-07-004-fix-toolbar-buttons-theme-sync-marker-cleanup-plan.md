---
title: "fix: toolbar button handlers, dialog theme sync, and marker cleanup on deletion"
type: fix
status: active
date: 2026-04-07
---

# fix: toolbar button handlers, dialog theme sync, and marker cleanup on deletion

## Overview

Three bugs in the agentation-chrome extension need fixing:

1. **Freeze and Settings buttons do nothing** — a null reference crash in the Toolbox constructor cascades, preventing event listeners from being attached
2. **Annotation dialog ignores theme changes** — the dialog never sets `data-agt-theme`, so it always renders dark regardless of the detected page theme
3. **Pin markers persist after annotation deletion** — the delete handler removes storage/array data but never cleans up the marker DOM element

## Bug 1: Freeze and Settings buttons non-functional

### Root Cause

`ui/toolbox/Toolbox.ts:90` — the Settings button is fetched via `querySelector` without a null guard. If the selector fails to match, calling `.addEventListener` on `null` throws a TypeError. Because this line runs **before** the freeze button handler (line 80 is fine, but line 90's crash prevents line 95+ from executing), the clearAll handler, all eventBus subscriptions, and theme initialization are also skipped.

The real issue is that **all seven querySelector calls** (lines 57-63 and 90) lack null guards — any one of them failing causes a cascading constructor failure.

### Fix

**`ui/toolbox/Toolbox.ts`** — Add null guards with `console.warn` for all querySelector calls:

```typescript
// Replace lines 57-63:
const annotateBtn = this.containerEl.querySelector('[aria-label="Annotate"]');
if (!annotateBtn) { console.warn('[agentation] Annotate button not found'); return; }
this.annotateBtn = annotateBtn as HTMLButtonElement;
// ... repeat for listBtn, freezeBtn, copyBtn, clearAllBtn, listSectionEl, listItemsEl
```

```typescript
// Replace line 90:
const settingsBtn = this.containerEl.querySelector('[aria-label="Settings"]');
settingsBtn?.addEventListener('click', () => {
  browser.runtime.openOptionsPage?.().catch(() => {});
});
```

The Settings button uses optional chaining (`?.`) since it's not a class property and has no downstream dependencies.

### Acceptance Criteria

- [ ] All five toolbar buttons (Annotate, List, Freeze, Copy, Settings) respond to clicks
- [ ] Freeze toggles page animation state
- [ ] Settings opens the extension options page
- [ ] Constructor failure on any single selector does not cascade to other buttons

---

## Bug 2: Annotation dialog ignores light/dark theme

### Root Cause

`ui/dialog/AnnotationDialog.ts` never imports `detectTheme` or `watchBodyStyle`, never sets `data-agt-theme` on its container, and has no theme watcher. The dialog always renders with default dark tokens because `shared.css` line 29 applies dark tokens to `:root`.

The toolbox works correctly because it imports and calls theme detection (`Toolbox.ts:3,131-136`). The dialog needs the same treatment.

### Important: CSS scoping

Both the toolbox and dialog live as **siblings** inside the same Shadow DOM container (created in `entrypoints/content.ts:12`). The toolbox sets `data-agt-theme` on its own container element, but the dialog is not a descendant of the toolbox — so the dialog does not inherit the attribute selector scope. The dialog must set `data-agt-theme` on its own root element.

### Fix

**`ui/dialog/AnnotationDialog.ts`** — Mirror the toolbox pattern:

1. Import theme utilities (line 3 equivalent):
   ```typescript
   import { detectTheme, watchBodyStyle, type Theme } from '../../lib/theme-detector';
   ```

2. Add `disconnectThemeWatcher` field and call in constructor:
   ```typescript
   private disconnectThemeWatcher: (() => void) | null = null;

   // In constructor, after DOM is built:
   this._applyTheme(detectTheme());
   this.disconnectThemeWatcher = watchBodyStyle(() => {
     this._applyTheme(detectTheme());
   });
   ```

3. Add `_applyTheme` method:
   ```typescript
   private _applyTheme(theme: Theme): void {
     this.dialogEl.setAttribute('data-agt-theme', theme);
   }
   ```

4. Clean up watcher in destroy method:
   ```typescript
   if (this.disconnectThemeWatcher) this.disconnectThemeWatcher();
   ```

### Acceptance Criteria

- [ ] Dialog renders with light theme on light-background pages
- [ ] Dialog renders with dark theme on dark-background pages
- [ ] Dialog theme updates when page theme changes dynamically
- [ ] No duplicate theme watchers causing performance issues

---

## Bug 3: Pin markers remain after annotation deletion

### Root Cause

`lib/app.ts:244-250` — the `annotation-delete` handler deletes from storage and filters the in-memory array, but never tells `MarkerRegistry` to remove the marker DOM element. Additionally, `MarkerRegistry` has no `removeMarker(id)` method — only `removeAll()`.

### Design consideration: shared `document.body` observer

All markers currently use `document.body` as their tracked element (`app.ts:239`). A naive `removeMarker` that calls `this.observer.unobserve(element)` would unobserve `document.body` on the first deletion, breaking position updates for remaining markers.

**Approach:** The `removeMarker` method should remove the DOM element and delete from the `markers` map, but **skip** `observer.unobserve` when the element is `document.body` (since it's shared). Add a TODO for refactoring observer management in a future change.

### Fix

**`ui/markers/MarkerRegistry.ts`** — Add `removeMarker` method:

```typescript
removeMarker(annotationId: string): void {
  const entry = this.markers.get(annotationId);
  if (!entry) return;

  entry.markerEl.remove();
  this.markers.delete(annotationId);

  // Only unobserve non-shared elements.
  // TODO: all markers currently share document.body — refactor to track
  // actual target elements so observer cleanup works correctly.
  if (entry.element !== document.body) {
    this.observer.unobserve(entry.element);
    this.elementToAnnotation.delete(entry.element);
  }
}
```

**`lib/app.ts`** — Call `removeMarker` in the delete handler:

```typescript
this.eventBus.on('annotation-delete', async (annotationId) => {
  if (this.tabId !== null) {
    await deleteAnnotationFromStorage(this.tabId, this.url, annotationId);
  }
  this.annotations = this.annotations.filter((a) => a.id !== annotationId);
  this.markerRegistry.removeMarker(annotationId);  // <-- add this line
  this.eventBus.emit('annotations-changed', this.annotations);
});
```

### Acceptance Criteria

- [ ] Deleting an annotation removes its pin marker from the page
- [ ] Deleting from the dialog delete button removes the marker
- [ ] Deleting from the list panel "x" button removes the marker
- [ ] "Clear all" removes all markers
- [ ] Remaining markers still track position correctly after one is deleted

---

## Testing

Each fix should include at least one test:

| Bug | Test file | Test description |
|-----|-----------|-----------------|
| 1 | `ui/__tests__/Toolbox.test.ts` | Settings button click does not throw; constructor handles null selectors gracefully |
| 2 | `ui/__tests__/AnnotationDialog.test.ts` | Dialog container gets `data-agt-theme` attribute after construction |
| 3 | `ui/__tests__/MarkerRegistry.test.ts` | `removeMarker(id)` removes DOM element and clears map entry |
| 3 | `lib/__tests__/app.test.ts` | `annotation-delete` event triggers `markerRegistry.removeMarker` |

## Files to modify

- `ui/toolbox/Toolbox.ts` — null guards on querySelector calls
- `ui/dialog/AnnotationDialog.ts` — theme detection and application
- `ui/markers/MarkerRegistry.ts` — add `removeMarker` method
- `lib/app.ts` — call `removeMarker` in delete handler
- `ui/__tests__/Toolbox.test.ts` — test for null-safe constructor
- `ui/__tests__/AnnotationDialog.test.ts` — test for theme attribute
- `ui/__tests__/MarkerRegistry.test.ts` — test for `removeMarker`
- `lib/__tests__/app.test.ts` — test for marker cleanup on delete
