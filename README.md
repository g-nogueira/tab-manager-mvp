# Tab Manager MVP

Chrome extension for organizing browser windows as persistent named contexts.

## MVP model

For the first version:

- one Chrome window = one context;
- context names are manually editable;
- unnamed contexts fall back to a generated hostname summary;
- closing or shelving a window keeps its tabs as a shelved context;
- restoring a context recreates its Chrome window;
- search matches both context names and tab title/URL;
- Chrome window IDs are treated as session-only bindings, not persistent IDs.

AI-assisted title generation is intentionally left for a follow-up after the first real-world tests.

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

## First test pass

Please exercise these before we add title generation:

1. Rename several current windows.
2. Open/close/move tabs and confirm each context stays in sync.
3. Close a named Chrome window and confirm it appears under **Shelved**.
4. Restore it and verify tab order, pinned tabs and active tab are reasonable.
5. Restart Chrome with restore-on-startup enabled and verify names remain attached to the correct windows.
6. Search for a context by both its custom name and a tab title/URL.

The restart reconciliation currently matches windows to saved contexts using normalized URL overlap. Real browsing examples will be useful to tune that heuristic.
