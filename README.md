# Tab Manager MVP

Cross-browser WebExtension for organizing browser windows as persistent named task contexts. Chrome and Firefox are supported from the same shared extension core.

## Current model

- a context contains one or more browser windows;
- a new browser window starts as its own context;
- click a context name (or the pencil icon) to rename it;
- renaming a context makes it the current **organizing target**;
- adding a window to a context also makes that context the organizing target;
- a window menu shows **Add to <current target>** when applicable, plus **Add to another context…**;
- **Switch** restores/shows every window in the selected context and minimizes Chrome windows from other contexts;
- switching preserves each window's previous normal/maximized state;
- **Shelve** closes all windows in a context while keeping their tab snapshots;
- **Restore** recreates the windows of a shelved context;
- search matches context names, window names, tab titles and URLs;
- context/window IDs are persistent while browser window IDs are treated as session-only bindings.

Existing single-window data from the first MVP is migrated in-place.

AI-assisted title generation remains intentionally deferred until the context/workspace behavior is stable.

## Run locally

```bash
npm install
npm run check
```

### Chrome

```bash
npm run build:chrome
```

Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `dist/`.
5. Pin **Context Tab Manager** and click its toolbar icon.

The default `npm run build` remains an alias for the Chrome build.

### Firefox

```bash
npm run build:firefox
npm run lint:firefox
```

Then:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select `dist-firefox/manifest.json`.
4. Pin **Context Tab Manager** and click its toolbar icon.

After changes, rebuild the relevant target and explicitly reload the extension in the browser's extension debugging page.

The Firefox build uses the stable add-on ID `context-tab-manager@g-nogueira.local`. Browser extension storage is local to each browser, so existing Chrome contexts do not automatically appear in Firefox.

## Multi-window test pass

1. Reload the extension with existing MVP data and verify current context names survive.
2. Rename one context and confirm **Organizing into <name>** appears.
3. Open another context's `⋮` menu and use **Add to <name>**.
4. Verify both windows now render inside one context.
5. Use **Undo** and verify the original contexts return.
6. Add the window again, then use **Switch**:
   - windows in the selected context should be restored/shown;
   - other browser context windows should be minimized;
   - normal/maximized state should be preserved when switching back.
7. Test **Add to another context…** rather than the current organizing target.
8. Shelve and restore a multi-window context.
9. Restart the browser and verify both windows reconcile back to the same context.


## Native tab menu and window layout

A tab's browser context menu can now assign its whole window without opening the extension popup:

- **Add this window to <organizing target>** uses the last context renamed or assigned to.
- **Add this window to another context…** exposes the other known contexts.
- **Undo last context assignment** is available after a native-menu move.
- The current window's own context is hidden from assignment choices.

Context switching also persists a normal window's exact `left`, `top`, `width` and `height`. A maximized window keeps its last known normal bounds and returns to maximized when its context is selected again.

### Test pass

1. Open a new browser window and at least one tab.
2. Right-click the tab and assign the whole window to the current organizing target.
3. Repeat with **Add this window to another context…**.
4. Use **Undo last context assignment** from the tab menu.
5. Arrange two context windows at distinct sizes/positions.
6. Switch to another context, then switch back and verify both windows return to their previous geometry.
7. Repeat with one window maximized and one normal.
8. Manually resize/move a normal window, switch away/back, and confirm the latest committed bounds are restored.


## Create a context from an inherited window

When a tab is detached into a new browser window, that window automatically inherits the source context. If that inference is not what you want, the window can now be split back out explicitly:

- tab right-click → **Create new context from this window**
- grouped-window `⋮` menu → **Create new context from this window**

The action is only shown when the current context contains multiple windows. It keeps the existing browser window, tabs, bounds and persisted window identity intact; only the context association changes.

The new context becomes the current organizing target. The action is reversible through the existing **Undo** flow, and Undo removes the temporary empty context when appropriate.


## Shelved context lifecycle

Shelved contexts now have a lightweight lifecycle so the popup does not grow indefinitely:

- **Pin** keeps a shelved context indefinitely.
- **Remove** forgets a shelved context immediately and offers **Undo** in the popup.
- Unnamed contexts containing only New Tab / blank pages are discarded automatically once fully shelved.
- Unpinned shelved contexts expire after **30 days**.
- The popup shows every pinned context plus the **6 most recent unpinned** shelved contexts by default; **Show older** expands the rest.
- Searching bypasses the collapsed view and searches all retained shelved contexts.
- Unpinning a context starts a fresh 30-day retention window rather than deleting an old pinned context immediately.

Automatic cleanup only affects fully shelved contexts. Active contexts are never removed by the lifecycle cleanup.


## Current window orientation and tab cleanup

When the manager popup opens, it identifies the browser window that opened it with `chrome.windows.getCurrent()` and uses the existing live `windowId` bindings for exact matching.

- the current context is shown first in **Active**;
- within a multi-window context, the current window is shown first;
- the current context/window gets an explicit **Current window** badge and stronger border;
- the current window shows all of its tabs instead of the normal 12-tab preview limit;
- active tab rows expose an inline **×** action on hover/focus to close the real browser tab;
- closing a tab refreshes the window snapshot immediately so the popup can be used as a lightweight tab-cleanup surface.

No URL/title heuristics are used to identify the current window.

### Test pass

1. Open the extension from a browser window whose tabs are easy to recognize.
2. Confirm its context appears first in **Active**.
3. Confirm the exact window is marked **Current window**.
4. In a multi-window context, confirm the current member window appears first.
5. Use a current window with more than 12 tabs and confirm all tabs are visible.
6. Hover a tab and click **×**; verify the real browser tab closes and disappears from the popup.
7. Open the popup from another browser window and confirm the highlight moves to that window.
8. Verify non-current windows still use the compact preview limit.


## Manual window close semantics

Closing a browser window now follows the context model instead of creating hidden `closed` members:

- if the context has multiple windows, closing one window removes that window from the context;
- if it is the context's only window, closing it shelves the whole context so it can still be restored;
- closing the last tab in a window naturally follows the same rule through the browser's window-close event;
- legacy mixed active/`closed` member windows are pruned during reconciliation so they are not unexpectedly restored by a later context switch.

Explicit **Shelve** remains different: it intentionally preserves all context windows for restoration.


## Desktop Focus companion

Desktop-level **Focus** is provided by an optional .NET 10 Native Messaging companion. The same native executable and protocol are shared by Chrome and Firefox. Focus minimizes eligible desktop application windows and then restores/switches to the selected browser context.

- Architecture: [docs/architecture/desktop-focus.md](docs/architecture/desktop-focus.md)
- ADR 0001: [Native Messaging](docs/adr/0001-native-messaging-desktop-companion.md)
- ADR 0002: [Desktop abstraction](docs/adr/0002-capability-oriented-desktop-abstraction.md)
- ADR 0003: [Focus semantics](docs/adr/0003-focus-is-one-way.md)
- Cross-browser architecture: [docs/architecture/browser-portability.md](docs/architecture/browser-portability.md)
- ADR 0004: [Browser-specific boundaries](docs/adr/0004-browser-specific-boundaries.md)

### Windows Native Messaging registration

For Chrome:

```powershell
./native/ContextTabManager.NativeHost/install-windows.ps1 `
  -Browser Chrome `
  -ChromeExtensionId <chrome-extension-id>
```

The legacy `-ExtensionId <chrome-extension-id>` parameter remains supported.

For Firefox:

```powershell
./native/ContextTabManager.NativeHost/install-windows.ps1 -Browser Firefox
```

Firefox uses the stable add-on ID `context-tab-manager@g-nogueira.local`, so no generated extension ID needs to be copied.

To register the same companion for both browsers:

```powershell
./native/ContextTabManager.NativeHost/install-windows.ps1 `
  -Browser Both `
  -ChromeExtensionId <chrome-extension-id>
```

After registration, reload the extension in the target browser before testing **Focus**.

Diagnostics:

```powershell
# Chrome
./native/ContextTabManager.NativeHost/diagnose-windows.ps1 `
  -Browser Chrome `
  -ChromeExtensionId <chrome-extension-id>

# Firefox
./native/ContextTabManager.NativeHost/diagnose-windows.ps1 -Browser Firefox
```

The diagnostic checks the browser-specific Native Messaging registry key, manifest, extension allowlist, executable path, and a direct framed `getStatus` round-trip with the host.

The rest of the extension remains fully functional without the companion.


### Companion diagnostics

Health and Focus calls carry a short correlation/request ID through:

```text
popup DevTools
  → MV3 service-worker DevTools
    → Native Messaging client
      → .NET native host
```

Extension logs use the prefix `[ContextTabManager]` and include the request ID, command, timing and result/error.

The native host also appends to:

`%LOCALAPPDATA%\ContextTabManager\NativeHost\logs\native-host.log`

On Windows, tail it while clicking **Retry**:

```powershell
Get-Content "$env:LOCALAPPDATA\ContextTabManager\NativeHost\logs\native-host.log" -Tail 50 -Wait
```

The same request ID should appear in the background-process console and native log. If the background process logs `send:dispatched` but the ID never appears in the native log, the browser did not launch/reach the registered host. If the ID reaches the native log and a response is logged but the extension times out, the failure is on the browser return path.
