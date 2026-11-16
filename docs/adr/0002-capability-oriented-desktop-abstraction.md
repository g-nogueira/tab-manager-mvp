# ADR 0002: Use a capability-oriented desktop abstraction

- Status: Accepted
- Date: 2026-11-09

## Context

The first implementation targets Windows, but future support may include macOS and Linux. OS window-management primitives differ substantially, especially between X11 and Wayland.

## Decision

Expose product intentions through `IDesktopService`: `GetCapabilities()` and `PrepareForFocusAsync()`. Platform implementations remain behind the interface, and the extension consumes capabilities rather than assuming support from an OS name.

## Consequences

Windows-specific APIs remain isolated; future platforms can implement the same intent differently; unsupported environments report capability=false cleanly.

The abstraction is intentionally narrow. Do not add low-level methods such as `EnumerateWindows`, `MinimizeWindow(handle)` or raw window identifiers until a real product capability requires them.
