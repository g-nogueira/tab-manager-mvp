# ADR 0005: Persist semantic desktop-window identity

- Status: Accepted
- Date: 2026-11-11

## Context

Desktop task contexts need to include windows from applications such as VS Code, Kiro, Rider and terminals.

Windows exposes HWND and PID values, but both are process/session lifetime identifiers. Persisting them would fail as soon as an application or window restarts.

Application-level identity alone is also insufficient because several task contexts may each contain a different window from the same application.

## Decision

Persist a semantic matcher containing:

- process name;
- executable path when accessible;
- the observed window title as a title hint.

Resolve that matcher against currently running top-level application windows each time Focus executes.

No HWND or PID crosses the Native Messaging boundary or is persisted in extension storage.

Matching is confidence-based and conservative. If a sufficiently confident unique current window cannot be found, that member is unresolved.

## Consequences

Positive:

- context membership survives process/window recreation;
- two windows from the same application can belong to different contexts;
- OS handles remain an implementation detail;
- the extension data model remains portable to future desktop implementations.

Negative:

- title changes can cause a member to become temporarily unresolved;
- two nearly identical windows from the same process can still be ambiguous;
- generic heuristics cannot provide the same identity quality as app-specific workspace APIs.

## Deferred alternatives

Future application adapters may supply stronger identifiers such as workspace paths or project IDs, but they should refine the resolver behind the same semantic `DesktopWindowMatcher` boundary rather than exposing OS handles.
