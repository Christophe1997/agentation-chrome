---
title: "feat: Add Configurable Keyboard Shortcuts via Chrome Commands API"
type: feat
status: active
date: 2026-04-08
---

# feat: Add Configurable Keyboard Shortcuts via Chrome Commands API

## Overview

Register additional Chrome extension commands so users can configure keyboard shortcuts for toolbar actions at `chrome://extensions/shortcuts`. Currently only `toggle-toolbar` (Ctrl+Shift+A) is registered. This plan adds 3 new commands: `toggle-annotate`, `toggle-freeze`, and `copy-markdown`. No default key bindings — users set their own.

## Problem Statement / Motivation

Power users want keyboard-driven workflows for annotation tasks. Currently, toggling annotate mode, freeze, and copying markdown require clicking toolbar buttons. The Chrome commands API is the standard way to expose configurable shortcuts in extensions — users rebind them at `chrome://extensions/shortcuts`, no in-extension UI needed.

## Proposed Solution

1. Register 3 new commands in `wxt.config.ts` (no `suggested_key` — users configure at `chrome://extensions/shortcuts`)
2. Route new commands through the existing background → content script message protocol
3. Content script checks `ui.mounted` before forwarding to event bus (silent no-op if toolbar not open)
4. Expose state getters on `AgentationApp` for correct toggle behavior

## Technical Considerations

- **No default bindings**: Avoids conflicts with Chrome DevTools (Ctrl+Shift+C) and other extensions. Users opt in by setting bindings themselves.
- **No retry for new commands**: Unlike `toggle-toolbar` (which mounts the UI asynchronously), the 3 new commands only work when the toolbar is already mounted. Single-send, no retry.
- **Silent no-op when toolbar closed**: Pressing annotate/freeze/copy shortcuts without the toolbar open does nothing — no auto-mount, no notification.
- **Toggle state**: `AgentationApp` must expose `isAnnotateActive` getter. Freeze state read from `isFrozen()` in `lib/freeze-animations.ts`.
- **No `_global` suffix**: All commands require Chrome focus (matches existing `toggle-toolbar` behavior).
- **Copy feedback**: If the toolbar is visible, the existing checkmark animation plays. If collapsed, no visual feedback for v1.

## Acceptance Criteria

- [ ] 3 new commands registered in `wxt.config.ts` with descriptions but no `suggested_key`
- [ ] All 4 commands appear at `chrome://extensions/shortcuts` with clear descriptions
- [ ] Background `onCommand` handler routes all 4 commands (no early-return guard on `toggle-toolbar` only)
- [ ] New commands use single message send (no retry); `toggle-toolbar` keeps existing retry logic
- [ ] 3 new message types added to `BackgroundPush` union in `shared/messages.ts`
- [ ] Content script `onMessage` handler processes new message types with `ui.mounted` guard
- [ ] `AgentationApp` exposes `isAnnotateActive` public getter
- [ ] `toggle-freeze` reads current state via `isFrozen()`, `toggle-annotate` via `app.isAnnotateActive`
- [ ] `copy-markdown` emits `'copy'` event on event bus (existing event name, not `'copy-markdown'`)
- [ ] Commands are no-op on restricted pages (`chrome://`, `about:`, etc.) — matches existing behavior
- [ ] Tests cover: background command routing, content script message handling, toggle state logic

## Implementation Plan

### Step 1: Register commands in `wxt.config.ts`

File: `wxt.config.ts` (lines 14-19)

Add 3 new entries to the `commands` block:

```typescript
commands: {
  'toggle-toolbar': {
    suggested_key: { default: 'Ctrl+Shift+A', mac: 'Command+Shift+A' },
    description: 'Toggle Agentation toolbar',
  },
  'toggle-annotate': {
    description: 'Toggle annotate mode',
  },
  'toggle-freeze': {
    description: 'Toggle page freeze',
  },
  'copy-markdown': {
    description: 'Copy annotations as markdown',
  },
},
```

### Step 2: Add message types to `shared/messages.ts`

File: `shared/messages.ts`

Add to the `BackgroundPush` union type:

```typescript
| { type: 'TOGGLE_ANNOTATE' }
| { type: 'TOGGLE_FREEZE' }
| { type: 'COPY_MARKDOWN' }
```

### Step 3: Update background `onCommand` handler

File: `entrypoints/background.ts` (lines 56-62)

Replace the early-return guard with a switch or if-else that routes all 4 commands:

```typescript
browser.commands.onCommand.addListener(async (command) => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  if (command === 'toggle-toolbar') {
    await ensureContentScriptRegistered(tab.id);
    await sendToggleWithRetry(tab.id);
    return;
  }

  // Commands that require toolbar to be mounted — single send, no retry
  const messageType = commandToMessageType(command);
  if (!messageType) return;
  try {
    await browser.tabs.sendMessage(tab.id, { type: messageType });
  } catch {
    // Content script not ready or on restricted page — silent no-op
  }
});
```

Add a helper to map command names to message types:

```typescript
function commandToMessageType(command: string): string | null {
  switch (command) {
    case 'toggle-annotate': return 'TOGGLE_ANNOTATE';
    case 'toggle-freeze': return 'TOGGLE_FREEZE';
    case 'copy-markdown': return 'COPY_MARKDOWN';
    default: return null;
  }
}
```

### Step 4: Expose state on `AgentationApp`

File: `lib/app.ts`

Add a public getter for annotate state:

```typescript
get isAnnotateActive(): boolean {
  return this.annotateActive;
}
```

Freeze state is already readable via `isFrozen()` from `lib/freeze-animations.ts`.

### Step 5: Handle new messages in content script

File: `entrypoints/content.ts` (lines 28-51)

Expand the `onMessage` listener to handle the 3 new message types. Each checks `ui.mounted` before acting:

```typescript
browser.runtime.onMessage.addListener((msg: { type: string }, sender) => {
  if (sender.tab) return;

  switch (msg.type) {
    case 'TOGGLE_TOOLBAR':
      // existing logic
      break;
    case 'TOGGLE_ANNOTATE':
      if (ui.mounted) {
        const current = ui.app.isAnnotateActive;
        ui.app.eventBus.emit('annotate-mode', !current);
      }
      break;
    case 'TOGGLE_FREEZE':
      if (ui.mounted) {
        const current = isFrozen();
        ui.app.eventBus.emit('freeze-toggle', !current);
      }
      break;
    case 'COPY_MARKDOWN':
      if (ui.mounted) {
        ui.app.eventBus.emit('copy', '');
      }
      break;
  }
});
```

Note: The `ui.app` access pattern depends on how the content script exposes the `AgentationApp` instance. If the current pattern stores it as a module-level variable, use that directly. If it's encapsulated, expose it via a getter on the `ui` object.

### Step 6: Update README shortcut reference table

File: `README.md`

Update the shortcuts table to reflect the new commands and note that users configure them at `chrome://extensions/shortcuts`.

## Files Changed

| File | Change |
|------|--------|
| `wxt.config.ts` | Add 3 new command definitions |
| `shared/messages.ts` | Add 3 new `BackgroundPush` message types |
| `entrypoints/background.ts` | Refactor `onCommand` handler, add `commandToMessageType` helper |
| `entrypoints/content.ts` | Handle 3 new message types with `ui.mounted` guard |
| `lib/app.ts` | Add `isAnnotateActive` public getter |
| `README.md` | Update shortcuts table |
| `entrypoints/background.test.ts` | Test command routing (if exists) or new test file |

## Sources & References

- Chrome commands API: https://developer.chrome.com/docs/extensions/reference/api/commands
- WXT commands config: https://wxt.dev/guide/essentials/config.html#commands
- Current toggle flow: `wxt.config.ts:14-19`, `entrypoints/background.ts:56-62`, `entrypoints/content.ts:28-51`
- Event bus events: `lib/event-emitter.ts:7` (`'copy'`), `lib/app.ts:305`
- Freeze state: `lib/freeze-animations.ts` (`isFrozen()`)
