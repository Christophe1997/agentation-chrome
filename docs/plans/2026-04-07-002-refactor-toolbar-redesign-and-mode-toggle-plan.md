---
title: "refactor: Modern toolbar UI redesign + mode-toggle interaction model"
type: refactor
status: active
date: 2026-04-07
---

# refactor: Modern toolbar UI redesign + mode-toggle interaction model

## Overview

Two issues with the current Agentation toolbar:
1. The toolbar UI feels dated — flat dark pill with 6 icon buttons, no tooltips, no cursor feedback
2. Once annotate mode is active, the interaction model is confusing — users can't tell what mode they're in, Esc doesn't exit, and clicking outside the dialog stacks unintended captures

## Problem Statement / Motivation

**Problem 1 — Visual design.** The toolbar is a semi-transparent dark pill (`rgba(26, 26, 46, 0.92)`) with 16x16 stroke-only SVG icons. There are no labels, tooltips, or visual hierarchy. The design token system (`--agt-*`) only covers the dark theme; dialog/list/options use hardcoded light-theme colors, creating visual inconsistency.

**Problem 2 — Interaction model.** Annotate mode activates a `pointerdown` capture listener that intercepts all page clicks. While toolbar buttons technically still work (they're excluded via `SELECTORS.EXTENSION`), the UX is confusing because:
- No cursor change indicates annotate mode is active
- No global Esc handler to exit the mode
- The capture listener fires even while the dialog is open, risking stacked dialog opens
- The "Select Text" button is dead code (no handler wired)

## Proposed Solution

### Part A: Toolbar UI redesign

Replace the current flat pill toolbar with a modern floating toolbar that follows contemporary design tool conventions (Linear, Figma, Arc browser):

- **Layout**: Floating pill, bottom-right. Buttons with subtle separators between groups.
- **Tooltips**: Every button shows a label tooltip on hover (CSS-only, no JS).
- **Active mode indicator**: Active mode button gets a filled accent background (not just a border). Add a subtle pulsing dot or glow.
- **Cursor feedback**: `cursor: crosshair` on the page body when annotate mode is active.
- **Remove dead code**: Delete the "Select Text" button (no handler, no event bus wiring).
- **Design token unification**: Extend `--agt-*` tokens to cover the light theme used by dialog/list, eliminating hardcoded colors.

### Part B: Mode-toggle interaction model

Implement a clean mode system like screenshot tools:

- **Modes** (mutually exclusive): Annotate. Only one can be active at a time.
- **Independent actions/toggles**: List, Freeze, Copy, Settings. These work regardless of mode.
- **Esc key**: Layered priority — (1) close dialog if open, (2) close list panel if open, (3) exit annotate mode.
- **Dialog-open guard**: Suspend the annotate capture listener while the annotation dialog is open to prevent stacked captures.
- **List row interaction**: Clicking a list row opens the annotation dialog for editing.

## Technical Considerations

### Files to modify

| File | Change |
|------|--------|
| `ui/toolbar/Toolbar.ts` | Redesign button definitions, remove Select Text, add tooltip support, add `destroyMode()` method |
| `ui/toolbar/toolbar.css` | Complete visual redesign — new shapes, colors, tooltip styles, active state |
| `ui/shared.css` | Add light-theme tokens, new toolbar-specific tokens |
| `lib/app.ts` | Add Esc handler, dialog-open guard in capture listener, cursor management, list row click wiring |
| `ui/dialog/AnnotationDialog.ts` | Add `isOpen()` getter, restructure Esc to not stopPropagation (let it bubble) |
| `ui/list/AnnotationList.ts` | Add click handler on rows that emits `marker-click` event |
| `lib/event-emitter.ts` | No changes needed (existing events cover the new behavior) |
| `lib/constants.ts` | No changes needed |

### Architecture decisions

1. **No mode manager class needed.** The current boolean flags in `Toolbar` (`annotateMode`, `listOpen`, `frozen`) work fine since only Annotate is a "mode." No need for a state machine.

2. **Esc bubbling, not stopPropagation.** The dialog's current `e.stopPropagation()` on Esc (line ~121 of `AnnotationDialog.ts`) must be changed to let the event bubble to the app-level handler. The app handler checks what's open and dismisses topmost layer first.

3. **Cursor set on `document.documentElement`** (not `body`) because some pages have no body or body has zero height.

4. **Tooltip via CSS `::after` pseudo-element** with `data-tooltip` attribute. No JS hover listeners needed.

## System-Wide Impact

- **Interaction graph**: Annotate toggle → event bus → app.enableAnnotateMode → capture listener on document. Esc keydown → app handler → checks dialog.isOpen() / listOpen / annotateMode → dispatches close actions via event bus.
- **Error propagation**: No new error paths. The capture listener already has `try/catch` via `identifyElementWithReact`.
- **State lifecycle risks**: Dialog-open guard prevents the only real state corruption risk (stacked dialogs).
- **API surface parity**: No message protocol changes. All changes are within the content script UI layer.

## Acceptance Criteria

- [ ] Toolbar has a modern, clean visual design with clear button hierarchy
- [ ] Every toolbar button shows a tooltip label on hover
- [ ] "Select Text" button is removed (dead code)
- [ ] Active annotate mode shows cursor: crosshair on the page
- [ ] Active annotate mode button has a clear visual indicator (filled accent background + glow/pulse)
- [ ] Pressing Esc closes the dialog if open (first priority)
- [ ] Pressing Esc closes the list panel if open and no dialog (second priority)
- [ ] Pressing Esc exits annotate mode if no dialog/list is open (third priority)
- [ ] Annotate capture listener is suspended while the dialog is open (no stacked captures)
- [ ] Clicking a row in the annotation list opens the edit dialog for that annotation
- [ ] List, Freeze, Copy, Settings work independently of annotate mode
- [ ] Design tokens in `shared.css` cover both dark (toolbar) and light (dialog/list) themes
- [ ] No hardcoded colors in `dialog.css` or `list.css` — all use `--agt-*` tokens
- [ ] `npm run compile` passes with zero errors
- [ ] Existing tests pass

## Dependencies & Risks

- **Risk**: The Esc bubbling change in `AnnotationDialog` could break the focus trap's Esc handling. Mitigation: the dialog should close itself on Esc AND let the event bubble — use `e.preventDefault()` to prevent any browser default but don't `stopPropagation()`.
- **Risk**: Changing `document.documentElement.style.cursor` could conflict with pages that set their own cursor. Mitigation: store and restore the previous cursor value.
- **Risk**: Tooltip positioning could overlap with page content in edge cases. Mitigation: use `position: absolute` with `top: 100%` inside the button, not fixed positioning.

## Sources & References

- Current toolbar: `ui/toolbar/Toolbar.ts`, `ui/toolbar/toolbar.css`
- Current app wiring: `lib/app.ts:46-70` (annotate mode), `lib/app.ts:83-109` (event bus)
- Dialog Esc handling: `ui/dialog/AnnotationDialog.ts` (stopPropagation on keydown)
- Design tokens: `ui/shared.css:1-33`
- Past fix: `docs/solutions/ui-bugs/content-script-dialog-critical-fixes.md` (tabId, focus trap, coordinate threading)
- z-index constants: `lib/constants.ts:1-6`
