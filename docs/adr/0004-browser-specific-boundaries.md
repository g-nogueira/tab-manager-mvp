# ADR 0004: Keep browser-specific behavior at platform boundaries

- Status: Accepted
- Date: 2026-11-11

## Context

Context Tab Manager was initially implemented for Chrome and now needs Firefox support.

Most of the product relies on standard WebExtensions tabs, windows, storage, context menu and runtime APIs. The important browser differences are the Manifest V3 background execution model, browser-specific manifest metadata, packaging validation, and Native Messaging host registration.

Duplicating the context/reconciliation implementation per browser would create unnecessary divergence.

## Decision

Use one shared extension core and isolate browser-specific behavior to:

1. browser-specific manifest sources;
2. build output selection;
3. background declaration;
4. Native Messaging registration/allowlisting;
5. narrow compatibility adapters only when testing demonstrates a real API difference.

Chrome remains built to `dist/`; Firefox is built to `dist-firefox/`.

The same bundled background entry point is declared as a Chrome service worker and as a Firefox background script/event page.

The same .NET Native Messaging executable and application protocol are used by both browsers, with separate browser-specific native manifests and registry keys.

## Consequences

Positive:

- context behavior remains consistent across browsers;
- fixes to persistence/reconciliation/search/Focus apply once;
- browser portability does not leak into the domain model;
- native companion development remains browser-agnostic.

Negative:

- two manifests and two build artifacts must stay aligned;
- Firefox must be linted/tested separately;
- browser storage remains independent, so user state does not migrate automatically.

## Follow-up rule

Do not introduce checks such as `if (isFirefox)` inside domain/reconciliation code unless there is a verified browser API behavior difference that cannot be handled at a platform boundary.
