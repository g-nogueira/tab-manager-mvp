# ADR 0006 — Native versioned backups instead of browser sync as source of truth

## Status

Accepted.

## Context

Context Tab Manager stores increasingly valuable task-workspace state: multiple browser windows, tab snapshots and desktop-window references.

Browser-local storage is tied to the installed extension/profile and can disappear during uninstall, profile replacement or browser reinstall.

Browser sync storage is useful for small preferences but is not a suitable authoritative recovery database for the growing context model. It also couples durability to browser/account sync behavior and introduces storage quotas.

The project already has an optional native companion with a stable installation independent of the browser profile.

## Decision

Use the native companion as the primary durable backup boundary.

The extension emits a versioned portable JSON document. The native companion:

- writes atomic versioned snapshots outside browser profile storage;
- retains multiple restore points;
- optionally replicates snapshots into a user-selected cloud-synced filesystem directory;
- discovers and restores from both local and secondary directories.

The browser remains the live writer. Cloud storage is backup replication only, not an active peer.

Manual JSON export/import provides recovery when the native companion itself is unavailable.

Browser runtime identifiers are excluded from the portable format. Restored windows are shelved and recreated through normal extension restore behavior.

## Consequences

### Positive

- browser/profile reinstall no longer implies context loss;
- no cloud OAuth tokens/scopes are required;
- backup provider is interchangeable;
- recovery retains multiple historical versions;
- cloud conflicts cannot overwrite live extension state;
- existing native diagnostics can expose backup failures;
- portable JSON remains inspectable and migration-friendly.

### Negative

- native companion protocol must be upgraded for automatic backups;
- secondary backup files are plaintext and may contain sensitive URLs/titles;
- this is backup/restore, not seamless multi-device sync;
- user must reselect/re-enter the secondary folder after complete machine/AppData loss.

## Rejected alternatives

### Use `storage.sync` as the authoritative store

Rejected because context data is larger and more volatile than browser sync is designed for, and durability would depend on browser-account sync state.

### Direct Google Drive/OneDrive API integration

Deferred. It would add OAuth credentials, provider-specific code and external API failure modes without improving the core recovery model.

### Bidirectional synced JSON file

Rejected for this phase because simultaneous machines would require merge/conflict semantics for contexts, browser windows and desktop application identity.

## Future work

- passphrase/recovery-key encryption for backup files;
- backup health/age warnings;
- optional restore preview/diff;
- cross-device sync built on explicit conflict semantics rather than filesystem last-write-wins.
