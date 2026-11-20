# Fast context navigation

## Goal

Context Tab Manager has two distinct interaction surfaces:

- the full manager for organization, search, rename, lifecycle and membership work;
- fast navigation for moving between task workspaces while actively working.

Fast navigation must not reorder or otherwise mutate the manager's organizational presentation.

## Navigation state

The extension stores a small independent MRU model:

```ts
interface ContextNavigationState {
  currentContextId?: string;
  previousContextId?: string;
  recentContextIds: string[];
}
```

It is updated when a context is actually focused, including when the user focuses one of its browser windows directly.

Opening, searching or scrolling the manager does not update navigation recency.

The recent list is capped at 12 persistent context IDs. Invalid/deleted IDs are filtered on read. Existing context `lastFocusedAt` values seed the list after upgrading from an older extension version.

## Previous-context toggle

Command:

`focus-previous-context`

Default shortcut:

`Alt+Shift+Q`

The current focused browser context is reconciled first. The target is the previous context when valid, otherwise the next MRU context.

After a successful focus, current and previous swap naturally:

```text
A → B
current=B previous=A

shortcut

B → A
current=A previous=B
```

The operation uses the normal full **Focus** semantics: desktop member matching/minimization plus browser context restoration.

## Quick switcher

Command:

`open-quick-context-switcher`

Default shortcut:

`Alt+Shift+W`

The command marks a short-lived session request and opens the extension action popup. The popup detects that request and renders an MRU-only surface instead of the full manager.

Candidates:

- exclude the current context;
- prioritize the five most recent candidates;
- include missing pinned contexts before filling remaining MRU slots;
- cap the visible list at eight contexts.

Controls:

- repeated quick-switch shortcut: advance selection while the popup remains open;
- Up / Down: move selection;
- Enter: focus selected context;
- 1–8: focus directly;
- Escape: close;
- hover/click: mouse selection/focus.

The popup is intentionally compact and does not show backup, search or organization controls.

## Browser shortcut scope

The MVP uses the browser extension commands API. Therefore shortcuts are intended for use while the browser is the active application.

A future global implementation requires a resident desktop process capable of registering Windows global hotkeys. The current Native Messaging host is launched on demand and is not an appropriate global-hotkey daemon.

## Non-goals

- no hold-to-peek behavior;
- no task timer or automatic return;
- no global Windows hotkey yet;
- no changes to normal popup ordering;
- no automatic switching based on tab navigation.
