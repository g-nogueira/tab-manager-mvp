# ADR 0003: Focus is a one-way desktop preparation operation

- Status: Accepted
- Date: 2026-11-09

## Context

Focus could remember every non-context desktop window and later restore its previous state. That would create long-lived desktop session state and ambiguity when applications are opened, closed, moved or manually minimized during focus.

## Decision

Focus is one-way:

1. minimize eligible desktop application windows;
2. restore/switch to every Chrome window in the selected context;
3. do not automatically restore unrelated applications later.

The selected Chrome context continues using the extension's existing normal/maximized state and bounds persistence.

## Consequences

The behavior is predictable and avoids turning the companion into a general desktop window manager. The tradeoff is that users restore unrelated applications manually when needed.

A future `RestorePreviousDesktopState` capability requires a separate product decision and ADR.
