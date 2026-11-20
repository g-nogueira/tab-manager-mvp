import type { BrowserContext } from "../domain/context";
import type { ContextNavigationState } from "../domain/navigation";
import { loadBindings, loadContexts } from "./context-store";
import { createDiagnosticRequestId, diagnosticInfo } from "./diagnostics";
import { prepareDesktopForFocus } from "./desktop-companion-client";
import { switchContext } from "./window-reconciler";

const NAVIGATION_KEY = "contextNavigationState";
const MAX_RECENT_CONTEXTS = 12;

function unique(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }

  return result;
}

function sortByRecency(contexts: BrowserContext[]): BrowserContext[] {
  return [...contexts].sort(
    (a, b) =>
      (b.lastFocusedAt ?? b.updatedAt) -
      (a.lastFocusedAt ?? a.updatedAt)
  );
}

export async function loadContextNavigationState(
  contexts = await loadContexts()
): Promise<ContextNavigationState> {
  const result = await chrome.storage.local.get(NAVIGATION_KEY);
  const raw = result[NAVIGATION_KEY] as Partial<ContextNavigationState> | undefined;
  const validIds = new Set(contexts.map((context) => context.id));
  const fallbackIds = sortByRecency(contexts).map((context) => context.id);

  const recentContextIds = unique([
    ...(Array.isArray(raw?.recentContextIds) ? raw!.recentContextIds! : []),
    ...fallbackIds
  ])
    .filter((id) => validIds.has(id))
    .slice(0, MAX_RECENT_CONTEXTS);

  const currentContextId =
    raw?.currentContextId && validIds.has(raw.currentContextId)
      ? raw.currentContextId
      : recentContextIds[0];

  const previousContextId =
    raw?.previousContextId &&
    validIds.has(raw.previousContextId) &&
    raw.previousContextId !== currentContextId
      ? raw.previousContextId
      : recentContextIds.find((id) => id !== currentContextId);

  return {
    currentContextId,
    previousContextId,
    recentContextIds
  };
}

export async function saveContextNavigationState(
  state: ContextNavigationState
): Promise<void> {
  await chrome.storage.local.set({
    [NAVIGATION_KEY]: state
  });
}

export async function recordContextFocused(
  contextId: string
): Promise<ContextNavigationState> {
  const contexts = await loadContexts();

  if (!contexts.some((context) => context.id === contextId)) {
    return loadContextNavigationState(contexts);
  }

  const current = await loadContextNavigationState(contexts);

  if (current.currentContextId === contextId) {
    const unchanged: ContextNavigationState = {
      ...current,
      recentContextIds: unique([
        contextId,
        ...current.recentContextIds
      ]).slice(0, MAX_RECENT_CONTEXTS)
    };

    await saveContextNavigationState(unchanged);
    return unchanged;
  }

  const next: ContextNavigationState = {
    currentContextId: contextId,
    previousContextId: current.currentContextId,
    recentContextIds: unique([
      contextId,
      current.currentContextId,
      ...current.recentContextIds
    ]).slice(0, MAX_RECENT_CONTEXTS)
  };

  await saveContextNavigationState(next);
  return next;
}

export async function recordFocusedBrowserWindow(
  windowId: number
): Promise<void> {
  const bindings = await loadBindings();
  const contextId = bindings[String(windowId)]?.contextId;

  if (contextId) {
    await recordContextFocused(contextId);
  }
}

async function actualFocusedContextId(): Promise<string | undefined> {
  try {
    const window = await chrome.windows.getLastFocused({
      windowTypes: ["normal"]
    });

    if (window.id === undefined) return undefined;

    const bindings = await loadBindings();
    return bindings[String(window.id)]?.contextId;
  } catch {
    return undefined;
  }
}

export async function focusContextWithNavigation(
  contextId: string,
  requestId = createDiagnosticRequestId()
): Promise<void> {
  const contexts = await loadContexts();
  const context = contexts.find((item) => item.id === contextId);

  if (!context) {
    throw new Error("Context not found");
  }

  const actualCurrent = await actualFocusedContextId();

  if (actualCurrent && actualCurrent !== contextId) {
    await recordContextFocused(actualCurrent);
  }

  diagnosticInfo("navigation", "context-focus:start", {
    requestId,
    contextId,
    desktopWindowCount: context.desktopWindows.length
  });

  await prepareDesktopForFocus(
    context.desktopWindows.map((window) => window.matcher),
    requestId
  );
  await switchContext(contextId);
  await recordContextFocused(contextId);

  diagnosticInfo("navigation", "context-focus:completed", {
    requestId,
    contextId
  });
}

export async function focusPreviousContext(
  requestId = createDiagnosticRequestId()
): Promise<string> {
  const contexts = await loadContexts();
  const validIds = new Set(contexts.map((context) => context.id));
  const actualCurrent = await actualFocusedContextId();

  if (actualCurrent) {
    await recordContextFocused(actualCurrent);
  }

  const navigation = await loadContextNavigationState(contexts);
  const currentContextId =
    actualCurrent ?? navigation.currentContextId;

  const targetContextId =
    navigation.previousContextId &&
    navigation.previousContextId !== currentContextId &&
    validIds.has(navigation.previousContextId)
      ? navigation.previousContextId
      : navigation.recentContextIds.find(
          (id) => id !== currentContextId && validIds.has(id)
        );

  if (!targetContextId) {
    throw new Error("No previous context is available yet");
  }

  await focusContextWithNavigation(
    targetContextId,
    requestId
  );

  return targetContextId;
}
