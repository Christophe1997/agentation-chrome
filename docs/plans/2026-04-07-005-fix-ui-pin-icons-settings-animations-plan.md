---
title: fix: UI Polish — Pin Marker Style, Icon Centering, Settings Button, Animation Removal
type: fix
status: active
date: 2026-04-07
---

# fix: UI Polish — Pin Marker Style, Icon Centering, Settings Button, Animation Removal

## Overview

Four targeted UI fixes to polish the toolbox after the toolbar redesign:

1. **Pin/marker badge** — update visual style to match the toolbox (color, shape, border)
2. **Toggle animation** — remove the pulsing box-shadow animation on active buttons
3. **Icon centering** — fix off-center copy and settings SVG icons
4. **Settings button** — fix the settings button click handler not working

## Problem Statement

After the toolbar redesign (`refactor/toolbar-redesign-and-mode-toggle`), several visual and functional issues remain:

- The annotation pin markers still use a red accent (`#e94560`) and circular badge style that does not match the toolbox's purple (`#7c6aef`) and modern card aesthetic.
- Active toolbar buttons (Annotate, List, Freeze) pulse with a `box-shadow` animation — distracting and inconsistent with a minimal tool.
- The copy and settings button icons are visually off-center despite the button having correct flex centering — the SVG paths themselves are geometrically asymmetric within the 18×18 viewBox.
- The settings button does not open the options page when clicked. The handler is attached with optional chaining (`settingsBtn?.addEventListener`) so failure is silent.

## Files to Change

| File | Purpose |
|---|---|
| `ui/toolbox/toolbox.css` | Remove pulse animation and `@keyframes agt-pulse` |
| `ui/toolbox/Toolbox.ts` | Fix `copyIcon()`, `settingsIcon()` SVG paths; diagnose settings button wiring |
| `ui/markers/MarkerRegistry.ts` | Update inline `MARKER_CSS` constant (lines 3–26) to match toolbar style |

> **Note:** `ui/markers/markers.css` is **not imported** by the content script — all active marker styles are in the inline `MARKER_CSS` string inside `MarkerRegistry.ts`. Edit there, not the `.css` file.

## Acceptance Criteria

- [ ] Annotation pin markers use the toolbar purple (`#7c6aef`) and a style consistent with the toolbox (pill or rounded-square shape, cleaner badge)
- [ ] No pulsing animation on any active toolbar button; transitions may remain
- [ ] Copy and Settings SVG icons are visually centered within their 36×36 button
- [ ] Clicking the Settings button reliably opens the extension options page
- [ ] No regressions on Annotate, List, Freeze button behavior or theme switching

## Implementation Notes

### 1. Pin/Marker Style (`MarkerRegistry.ts` lines 3–26)

The `MARKER_CSS` string is injected into `document.head` (not the shadow root), so it **cannot access shadow root CSS variables** like `--agt-accent`. Use hardcoded values to match the toolbox:

- Change background from `var(--agt-accent, #e94560)` → `#7c6aef`
- Optionally change `border-radius: 50%` to `border-radius: 6px` for a rounded-square badge to better match toolbox card style
- Update `border: 2px solid white` — keep or switch to `rgba(255,255,255,0.9)` for subtlety
- Consider matching the pin number label to the toolbox font/weight

Watch for **layout thrashing** (`MarkerRegistry.ts:118`): `getBoundingClientRect()` reads are interleaved with `setProperty()` writes. Do not introduce more mixed read/write operations if touching the marker positioning loop (batch reads first, then writes).

### 2. Remove Pulse Animation (`toolbox.css`)

- Remove `animation: agt-pulse 2s ease-in-out infinite;` from `.agt-toolbox-btn[aria-pressed="true"]` rule (approx. line 66)
- Remove the `@keyframes agt-pulse` block (approx. lines 3–6)
- Keep `transition: background 150ms ease, color 150ms ease` on buttons — this is fine

### 3. Center SVG Icons (`Toolbox.ts`)

The button CSS is correct (`display: flex; align-items: center; justify-content: center; padding: 0`). The issue is the SVG path geometry itself.

For `copyIcon()` and `settingsIcon()`:
- Inspect the path data and verify visual centering in the 18×18 viewBox
- Option A: Redraw the paths to be geometrically centered
- Option B: Add `style="display:block"` to the `<svg>` element and verify `width="18" height="18"` attributes are set (they currently are)
- Option C: Shift the entire path via a `transform="translate(dx, dy)"` on a wrapper `<g>` element — minimal change, easy to verify

### 4. Fix Settings Button (`Toolbox.ts`)

Investigate in order:

1. **Check the query** — `containerEl.querySelector('[aria-label="Settings"]')` at line 110. Verify the Settings button is in the DOM at the time this runs (it should be, since `BUTTONS` is iterated and appended before this query).

2. **Check `openOptionsPage` availability** — `browser.runtime.openOptionsPage?.()` requires the manifest `"options_page"` or `"options_ui"` key. Verify `wxt.config.ts` has an options entry point and the built manifest includes this key.

3. **Check the options entry point** — `entrypoints/options/` must exist and be a valid WXT entry point (with `index.html` or equivalent).

4. **Add error logging** — Replace silent optional chaining with explicit error handling:
   ```ts
   settingsBtn?.addEventListener('click', () => {
     browser.runtime.openOptionsPage().catch((err) => {
       console.error('[agentation] openOptionsPage failed:', err);
     });
   });
   ```

5. **If `openOptionsPage` is unavailable in MV3** — use `browser.tabs.create({ url: browser.runtime.getURL('/options.html') })` as fallback.

## Dependencies & Risks

- **Markers outside shadow DOM:** Color/style changes to markers use hardcoded values. If the toolbar accent color ever changes, markers must be updated separately. Low risk for now.
- **MutationObserver in MarkerRegistry:** Existing broad observer on `document.body` (`subtree: true`, no batching at line 67). Do not add expensive work inside marker style update if triggered from the observer callback.
- **Options page existence:** If `entrypoints/options/` does not exist or is not built, the settings button will always fail. Verify before debugging the event wiring.

## Sources

- Repo research: `ui/toolbox/Toolbox.ts`, `ui/toolbox/toolbox.css`, `ui/markers/MarkerRegistry.ts`
- Institutional learning: `docs/solutions/ui-bugs/content-script-dialog-critical-fixes.md` — marker layout thrashing at `MarkerRegistry.ts:118`, shadow DOM scoping rules
- Related plan: `docs/plans/2026-04-07-004-fix-toolbar-buttons-theme-sync-marker-cleanup-plan.md`
