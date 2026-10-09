# Tab Manager MVP

Chrome extension for organizing browser windows as persistent named task contexts.

## Current model

- a context contains one or more Chrome windows;
- a new Chrome window starts as its own context;
- click a context name (or the pencil icon) to rename it;
- renaming a context makes it the current **organizing target**;
- adding a window to a context also makes that context the organizing target;
- a window menu shows **Add to <current target>** when applicable, plus **Add to another context…**;
- **Switch** restores/shows every window in the selected context and minimizes Chrome windows from other contexts;
- switching preserves each window's previous normal/maximized state;
- **Shelve** closes all windows in a context while keeping their tab snapshots;
- **Restore** recreates the windows of a shelved context;
- search matches context names, window names, tab titles and URLs;
- context/window IDs are persistent while Chrome window IDs are treated as session-only bindings.

Existing single-window data from the first MVP is migrated in-place.

AI-assisted title generation remains intentionally deferred until the context/workspace behavior is stable.

## Run locally

```bash
npm install
npm run check
npm run build
```

Then in Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the generated `dist/` directory.
5. Pin **Context Tab Manager** and click its toolbar icon.

After changes, run `npm run build` again and click **Reload** on the extension card.

## Multi-window test pass

1. Reload the extension with existing MVP data and verify current context names survive.
2. Rename one context and confirm **Organizing into <name>** appears.
3. Open another context's `⋮` menu and use **Add to <name>**.
4. Verify both windows now render inside one context.
5. Use **Undo** and verify the original contexts return.
6. Add the window again, then use **Switch**:
   - windows in the selected context should be restored/shown;
   - other Chrome context windows should be minimized;
   - normal/maximized state should be preserved when switching back.
7. Test **Add to another context…** rather than the current organizing target.
8. Shelve and restore a multi-window context.
9. Restart Chrome and verify both windows reconcile back to the same context.


## Native tab menu and window layout

A tab's Chrome context menu can now assign its whole window without opening the extension popup:

- **Add this window to <organizing target>** uses the last context renamed or assigned to.
- **Add this window to another context…** exposes the other known contexts.
- **Undo last context assignment** is available after a native-menu move.
- The current window's own context is hidden from assignment choices.

Context switching also persists a normal window's exact `left`, `top`, `width` and `height`. A maximized window keeps its last known normal bounds and returns to maximized when its context is selected again.

### Test pass

1. Open a new Chrome window and at least one tab.
2. Right-click the tab and assign the whole window to the current organizing target.
3. Repeat with **Add this window to another context…**.
4. Use **Undo last context assignment** from the tab menu.
5. Arrange two context windows at distinct sizes/positions.
6. Switch to another context, then switch back and verify both windows return to their previous geometry.
7. Repeat with one window maximized and one normal.
8. Manually resize/move a normal window, switch away/back, and confirm the latest committed bounds are restored.
