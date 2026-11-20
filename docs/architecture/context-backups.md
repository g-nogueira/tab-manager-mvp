# Context backup and recovery

## Purpose

Browser extension storage is a working database, not a durable backup boundary. Reinstalling a browser/profile or uninstalling the extension can remove that storage.

Context Tab Manager therefore keeps recoverable snapshots outside the browser profile through the native companion.

## Recovery layers

1. **Browser storage** — live working state.
2. **Native local snapshots** — versioned JSON under:
   `%LOCALAPPDATA%\ContextTabManager\Backups`
3. **Optional secondary folder** — the same versioned snapshots copied to an explicitly configured absolute directory, such as a private Google Drive or OneDrive synced folder.
4. **Portable JSON export/import** — manual escape hatch that does not require the native companion.

The secondary directory is replication, not bidirectional synchronization. It never edits browser state by itself.

## Portable schema

Current schema: `schemaVersion = 1`.

A backup contains:

- creation time and extension version;
- reason: automatic, manual or pre-restore;
- contexts and persistent context/window IDs;
- context/window names and lifecycle metadata;
- tab URL/title/order/pinned/active snapshots;
- desktop-window semantic references;
- organizing-target context ID when valid.

It deliberately removes browser-session identifiers:

- browser `windowId`;
- browser `tabId`;
- session bindings and undo data.

Those values have meaning only in one browser process/profile and must never be restored onto another session.

## Automatic capture

The background process listens to local storage changes affecting:

- `contexts`;
- `organizationTargetId`.

A change schedules the named `chrome.alarms` alarm three seconds in the future. Repeated changes replace that alarm, giving a durable debounce even if the extension service worker is suspended.

Startup and extension installation also schedule a backup.

When the alarm fires:

1. normalize and load current contexts;
2. create a portable schema-v1 document;
3. send it to native companion protocol v3;
4. atomically write the local versioned file and `latest.json`;
5. best-effort copy the same files to the configured secondary directory;
6. apply retention.

A secondary-copy failure does not invalidate the successful local snapshot.

## Atomicity and retention

Each file is written to a temporary sibling and then atomically renamed over the destination.

Retention keeps:

- 20 newest snapshots;
- 7 additional daily restore points;
- 4 additional weekly restore points.

`latest.json` is a convenience pointer and is not used as the only recovery copy.

## Secondary/cloud recovery

Snapshot discovery merges local and configured secondary directories by backup ID.

Restore lookup tries local storage first, then the configured secondary directory. This matters after loss of local AppData: once the user configures the synced folder again, existing cloud snapshots become visible and restorable without copying them manually into LocalAppData.

The companion never talks directly to a cloud API. Google Drive, OneDrive or another sync client owns replication.

## Restore semantics

Before restoring a native snapshot, the current context state is saved as a `pre-restore` snapshot.

A restored backup:

1. validates schema version and context shape;
2. clears browser-session storage/bindings;
3. strips any runtime tab/window IDs defensively;
4. marks all recovered browser windows as shelved;
5. gives recovered contexts a fresh shelf timestamp;
6. restores the organizing-target ID only when that context exists;
7. reconciles currently open browser windows separately.

Recovered desktop members remain semantic references and are not launched automatically.

Keeping restored browser windows shelved prevents stale identifiers from accidentally binding to unrelated windows in the new browser session. The user chooses which recovered contexts to reopen.

## Manual JSON recovery

**Export JSON** creates the same portable schema from current browser state and downloads it directly from the popup.

**Import JSON** validates and applies that document without requiring the native companion. When the companion is reachable, import attempts a pre-restore native snapshot first; failure of that optional safety snapshot does not prevent an explicitly requested portable import.

## Security boundary

Backup files are currently plaintext JSON.

They can contain sensitive information including:

- context/task names;
- tab titles and URLs;
- desktop application/window titles and executable identity.

Secondary-folder replication is therefore opt-in. Use only a private or separately encrypted synced location. Do not place backups in a shared corporate/personal folder without reviewing the confidentiality implications.

Future encryption should use a recovery secret that survives machine reinstall; OS-user-bound encryption alone is not sufficient for cloud disaster recovery.

## Non-goals

This version does not implement:

- live multi-device synchronization;
- conflict resolution between multiple active writers;
- cloud-provider OAuth/API integration;
- automatic app launching during restore;
- encrypted backup payloads.

Those are intentionally separate from the backup/recovery contract.
