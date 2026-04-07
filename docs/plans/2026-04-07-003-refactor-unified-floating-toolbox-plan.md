---
title: "refactor: Unified floating toolbox with adaptive theming"
type: refactor
status: active
date: 2026-04-07
---

# refactor: Unified floating toolbox with adaptive theming

## Overview

Replace the current separate toolbar + annotation list with a **single floating toolbox container** that houses both. The container adapts its color theme (dark/light) based on the page background, uses modern rounded-corner card styling, and smoothly expands/collapses to show annotations.

## Problem Statement / Motivation

**Problem 1 — Annotation list is invisible on light pages.** The annotation list panel uses a white background with dark text (`--agt-light-*` tokens). On any page with a white or light background, the list blends completely into the page. Users cannot distinguish annotation cards from the underlying content.

**Problem 2 — Separate panels feel disconnected.** The toolbar sits at bottom-right, the annotation list floats at middle-right (`right: 80px; top: 50%`). They are visually and spatially unrelated, making the UI feel like a collection of independent widgets rather than a cohesive tool.

**Problem 3 — No visual feedback for actions.** Copy Markdown logs to console but shows no UI feedback. The annotation list has no empty state. There are no transitions for opening/closing the list.

## Proposed Solution

### Single floating toolbox container

Merge the toolbar buttons and annotation list into one container anchored at `bottom: 20px; right: 20px`:

- **Collapsed state**: Shows only the toolbar button row (5 icon buttons in a horizontal strip). Container width matches the button row (~230px).
- **Expanded state**: List panel slides open below the buttons. Container width becomes a constant 320px. Toolbar buttons stay at the top; annotation list scrolls below with `max-height: 400px`.
- **Transition**: Smooth `height` + `opacity` animation on the list section. Width transition from collapsed to expanded.
- **Dialog**: Stays as a separate popup near the clicked element. It remains a sibling of the toolbox container in the shadow root (not a child), avoiding overflow-clipping issues.

### Adaptive theming

Automatically detect the page background brightness and switch the toolbox between dark and light themes:

- **Detection**: On mount, read `getComputedStyle(document.body).backgroundColor` and convert to relative luminance (ITU-R BT.709). If luminance < 0.5, use dark theme; otherwise, light theme.
- **Re-detection**: Add a `MutationObserver` on `document.body` attributes to re-detect if the body's inline `style` changes. Do NOT re-detect on scroll or general DOM mutations (too expensive, too flickery).
- **Implementation**: Set a `data-agt-theme="dark|light"` attribute on the toolbox container. CSS uses this attribute to select the appropriate token set. Unify the existing `--agt-*` (dark) and `--agt-light-*` (light) token namespaces into a single `--agt-*` namespace scoped by `[data-agt-theme]`.
- **Fallback**: Default to dark theme if detection fails or returns transparent/invalid.

### Modern UI polish

- **Rounded corners**: `border-radius: 16px` on the container, `12px` on annotation cards, `8px` on buttons and status badges.
- **Annotation cards**: Each row in the list is a distinct card with subtle border, rounded corners, and hover elevation effect. Self-adjusting — card width fills the container, text truncates with ellipsis.
- **Empty state**: Show "No annotations yet" with a subtle icon when the list is empty.
- **Copy feedback**: Brief checkmark icon on the Copy button for 1.5 seconds after successful copy.
- **Tooltips**: Remove keyboard shortcut text from tooltips ("Annotate (A)" becomes "Annotate"). Shortcuts are not implemented in this refactor.
- **Backdrop**: Glassmorphism effect (blur + semi-transparent bg) on both themes for consistency.

## Technical Approach

### Architecture

```
Shadow Root
├── agt-toolbox (NEW — unified container)
│   ├── agt-toolbox-header (button row)
│   │   ├── button[Annotate]
│   │   ├── button[List]
│   │   ├── button[Freeze]
│   │   ├── button[Copy]
│   │   └── button[Settings]
│   └── agt-toolbox-list (expandable list panel)
│       ├── agt-toolbox-list-header ("Annotations" + Clear all)
│       └── agt-toolbox-list-items (scrollable)
│           └── agt-toolbox-card (per annotation)
├── agt-dialog (existing — stays as sibling, not inside toolbox)
└── (markers live on document.body, outside shadow)
```

### Implementation Phases

#### Phase 1: Unified container + list integration

Merge `Toolbar` and `AnnotationList` into a single `Toolbox` component:

- **`ui/toolbox/Toolbox.ts`**: New class that combines toolbar button logic and annotation list rendering. Builds a single container DOM element with header (buttons) and expandable list section.
- **`ui/toolbox/toolbox.css`**: New stylesheet for the unified container. Collapsed/expanded states via CSS class `.agt-toolbox--expanded`. Smooth height transition on the list section.
- **`ui/shared.css`**: Restructure token system. Add `[data-agt-theme="dark"]` and `[data-agt-theme="light"]` selectors that remap `--agt-*` tokens. Keep the existing `--agt-light-*` tokens as fallbacks during migration.
- **`lib/app.ts`**: Replace `new Toolbar(container, ...)` + `new AnnotationList(container, ...)` with `new Toolbox(container, ...)`. Update `list-toggle` event handling. Dialog remains separate.
- **Remove**: `ui/toolbar/Toolbar.ts`, `ui/toolbar/toolbar.css`, `ui/list/AnnotationList.ts`, `ui/list/list.css` after migration.

Key DOM changes:
- The toolbox container has `overflow: visible` to avoid clipping the dialog (which is a sibling, not a child — but the dialog's `position: fixed` should still work relative to the viewport inside the shadow root).
- The list section uses `max-height: 0; opacity: 0; overflow: hidden` when collapsed, transitioning to `max-height: 400px; opacity: 1` when expanded.
- Annotation rows become cards with `border-radius: 12px`, `margin: 4px 8px`, subtle border and shadow.

#### Phase 2: Adaptive theming

Add automatic dark/light theme detection:

- **`lib/theme-detector.ts`**: New utility module. Exports `detectTheme(): 'dark' | 'light'` function. Uses `getComputedStyle(document.body).backgroundColor` → parse RGB → compute luminance. Returns `'dark'` if luminance < 0.5, else `'light'`. Handles edge cases: transparent backgrounds (recurse to parent element), invalid colors (default to dark).
- **Integration in Toolbox constructor**: Call `detectTheme()` on mount, set `data-agt-theme` attribute on container. Set up `MutationObserver` on `document.body` to watch for `style` attribute changes.
- **CSS token remapping**: In `shared.css`, define two blocks:
  ```css
  [data-agt-theme="dark"] {
    --agt-bg: rgba(15, 15, 20, 0.88);
    --agt-surface: rgba(255, 255, 255, 0.06);
    --agt-border: rgba(255, 255, 255, 0.1);
    --agt-text: #eaeaea;
    --agt-text-secondary: #8892a4;
    --agt-accent: #e94560;
    /* ... */
  }
  [data-agt-theme="light"] {
    --agt-bg: rgba(255, 255, 255, 0.92);
    --agt-surface: rgba(0, 0, 0, 0.04);
    --agt-border: rgba(0, 0, 0, 0.1);
    --agt-text: #1a1a1a;
    --agt-text-secondary: #666;
    --agt-accent: #6366f1;
    /* ... */
  }
  ```
  All toolbox CSS references `var(--agt-*)` — no hardcoded theme colors.

#### Phase 3: Polish

- **Copy feedback**: In `Toolbox`, after copy event succeeds, add `.agt-copied` class to the copy button. CSS shows a checkmark SVG (replace icon content) for 1.5s, then reverts.
- **Empty state**: In the list rendering, if `annotations.length === 0`, render a centered "No annotations yet" message with a subtle pencil icon.
- **Scroll to new**: When `annotations-changed` fires with a new annotation (length increased), scroll the list to bottom.
- **Tooltips cleanup**: Update tooltip strings to remove keyboard shortcuts: "Annotate", "Annotations", "Freeze", "Copy Markdown", "Settings".

### Files to modify

| File | Change |
|------|--------|
| `ui/toolbox/Toolbox.ts` | **NEW** — unified toolbox component (toolbar + list) |
| `ui/toolbox/toolbox.css` | **NEW** — styling for unified container |
| `lib/theme-detector.ts` | **NEW** — adaptive theme detection utility |
| `lib/app.ts` | Replace Toolbar + AnnotationList with Toolbox; remove keyboard shortcut text |
| `ui/shared.css` | Add `[data-agt-theme]` selectors, remap tokens to unified namespace |
| `ui/dialog/dialog.css` | Update to use unified `var(--agt-*)` tokens instead of `--agt-light-*` |
| `ui/markers/markers.css` | No changes (markers live outside shadow DOM) |
| `lib/event-emitter.ts` | No changes (existing events cover the new behavior) |
| `lib/constants.ts` | No changes |
| `ui/toolbar/Toolbar.ts` | **DELETE** after migration |
| `ui/toolbar/toolbar.css` | **DELETE** after migration |
| `ui/list/AnnotationList.ts` | **DELETE** after migration |
| `ui/list/list.css` | **DELETE** after migration |

### Key technical decisions

1. **No mode manager class.** The existing boolean flags (`annotateActive`, `listVisible`) in `AgentationApp` are sufficient. Only Annotate is a "mode"; List is a panel toggle.

2. **Dialog stays outside the toolbox container.** The dialog uses `position: fixed` and needs to appear near the clicked element anywhere on the page. Placing it inside the toolbox container risks overflow clipping if the list section has `overflow: auto`. It remains a sibling of the toolbox in the shadow root.

3. **Single z-index for the toolbox.** `z-index: 2147483647` (max int32). The dialog also stays at this level and renders on top when overlapping (acceptable since the dialog is modal).

4. **CSS-only expanded state.** The list toggle uses a CSS class `.agt-toolbox--expanded` on the container. The CSS handles the transition. No JS animation frames needed.

5. **Theme detection is lightweight.** One `getComputedStyle` call on mount + one `MutationObserver` on body attributes. No canvas sampling, no scroll listeners, no pixel averaging.

## System-Wide Impact

- **Interaction graph**: List toggle → event bus → `Toolbox.toggleList(open)` → CSS class toggle → transition plays. Annotation submit → event bus → `Toolbox.renderList()` → scroll to bottom if new.
- **Error propagation**: No new error paths. Theme detection has a fallback (default to dark).
- **State lifecycle risks**: MutationObserver for theme detection needs cleanup in `destroy()`. If missed, it leaks. The `Toolbox.destroy()` method must disconnect the observer.
- **API surface parity**: No message protocol changes. All changes are within the content script UI layer. The dialog, markers, and background communication are unaffected.

## Acceptance Criteria

- [ ] Toolbar buttons and annotation list are inside a single floating container (bottom-right)
- [ ] Container expands smoothly when "List" is clicked, collapses smoothly when dismissed
- [ ] Container width is constant 320px when expanded; toolbar buttons are visible at top
- [ ] Annotation list scrolls independently with max-height ~400px
- [ ] Each annotation row renders as a distinct card with rounded corners and hover elevation
- [ ] Adaptive theme detection runs on mount — dark theme on dark pages, light theme on light pages
- [ ] Theme re-detects when `document.body` inline style changes
- [ ] No hardcoded colors in toolbox CSS — all use `var(--agt-*)` tokens
- [ ] Dialog remains a separate popup near the clicked element (not inside the toolbox)
- [ ] Dialog renders on top of the toolbox when overlapping (no clipping)
- [ ] Copy Markdown button shows brief checkmark feedback on success
- [ ] Empty annotation list shows "No annotations yet" message
- [ ] New annotation scrolls the list to show it
- [ ] Esc key still works: close dialog → close list → exit annotate mode
- [ ] Keyboard shortcut text removed from tooltips
- [ ] Old `ui/toolbar/` and `ui/list/` directories are removed
- [ ] `npm run compile` passes with zero errors
- [ ] Existing tests pass (updated to reference `Toolbox` instead of `Toolbar` + `AnnotationList`)

## Success Metrics

- Users can distinguish annotation cards from the underlying page on any background (light or dark)
- All annotation data (list, status, actions) is accessible within the floating toolbox — no separate panels
- Theme adapts automatically without user intervention
- UI feels cohesive — one tool, not scattered widgets

## Dependencies & Risks

- **Risk**: `position: fixed` behavior inside shadow root may vary across browsers. Mitigation: test in Chrome (primary target). If needed, use `position: absolute` on the shadow host with the host itself being `position: fixed`.
- **Risk**: Theme detection on pages with gradient or image backgrounds returns ambiguous results. Mitigation: `getComputedStyle` returns the computed background color (not gradient/image), so this is inherently handled. For transparent backgrounds, recurse to parent element up to `<html>`.
- **Risk**: MutationObserver on body attributes may fire frequently on some SPA pages. Mitigation: debounce re-detection with 300ms timeout.
- **Risk**: Unified `--agt-*` token namespace may conflict if the dialog still references `--agt-light-*` tokens. Mitigation: Phase 1 keeps `--agt-light-*` tokens as aliases. Phase 2 removes them once dialog CSS is migrated.

## Sources & References

- Current toolbar: `ui/toolbar/Toolbar.ts`, `ui/toolbar/toolbar.css`
- Current list: `ui/list/AnnotationList.ts`, `ui/list/list.css`
- Current app wiring: `lib/app.ts:36-56` (constructor), `lib/app.ts:200-272` (event bus)
- Design tokens: `ui/shared.css:1-75`
- Dialog: `ui/dialog/AnnotationDialog.ts`, `ui/dialog/dialog.css`
- Content script mount: `entrypoints/content.ts:9-18` (Shadow DOM setup)
- Markers: `ui/markers/MarkerRegistry.ts` (appended to `document.body`, outside shadow)
- Past fix: `docs/solutions/ui-bugs/content-script-dialog-critical-fixes.md` (focus trap, coordinate threading)
- Existing toolbar plan: `docs/plans/2026-04-07-002-refactor-toolbar-redesign-and-mode-toggle-plan.md` (superseded by this plan)
- z-index constants: `lib/constants.ts:1-6`
