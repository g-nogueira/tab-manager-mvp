import type {
  BrowserContext,
  ContextWindow,
  RestorableWindowState,
  TabSnapshot,
  UndoWindowMove,
  WindowBindings
} from "../domain/context";
import {
  loadBindings,
  loadContexts,
  loadUndoWindowMove,
  saveBindings,
  saveContexts,
  saveOrganizationTargetId,
  saveUndoWindowMove
} from "./context-store";

const ownExtensionPrefix = chrome.runtime.getURL("");

function now(): number {
  return Date.now();
}

function newId(): string {
  return crypto.randomUUID();
}

function isOwnExtensionUrl(url?: string): boolean {
  return Boolean(url && url.startsWith(ownExtensionPrefix));
}

function snapshotTabs(tabs: chrome.tabs.Tab[] = []): TabSnapshot[] {
  return tabs
    .filter((tab) => !isOwnExtensionUrl(tab.url))
    .map((tab) => ({
      tabId: tab.id,
      url: tab.url ?? "",
      title: tab.title ?? tab.url ?? "Untitled tab",
      favIconUrl: tab.favIconUrl,
      pinned: tab.pinned,
      index: tab.index,
      active: tab.active
    }))
    .sort((a, b) => a.index - b.index);
}

function preferredStateFromChrome(
  state: chrome.windows.WindowState | undefined,
  fallback: RestorableWindowState = "normal"
): RestorableWindowState {
  if (state === "maximized" || state === "fullscreen" || state === "locked-fullscreen") {
    return "maximized";
  }

  if (state === "normal") return "normal";
  return fallback;
}

function contextWindowFromWindow(window: chrome.windows.Window): ContextWindow {
  const timestamp = now();

  return {
    id: newId(),
    state: "active",
    windowId: window.id,
    tabs: snapshotTabs(window.tabs),
    preferredState: preferredStateFromChrome(window.state),
    createdAt: timestamp,
    updatedAt: timestamp,
    lastFocusedAt: window.focused ? timestamp : undefined
  };
}

function contextFromWindow(window: chrome.windows.Window): BrowserContext {
  const timestamp = now();
  const contextWindow = contextWindowFromWindow(window);

  return {
    id: newId(),
    windows: [contextWindow],
    createdAt: timestamp,
    updatedAt: timestamp,
    lastFocusedAt: window.focused ? timestamp : undefined
  };
}

function comparableUrl(url: string): string | undefined {
  if (!url) return undefined;

  try {
    const parsed = new URL(url);

    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}`;
    }

    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function urlsForTabs(tabs: TabSnapshot[]): Set<string> {
  return new Set(
    tabs
      .map((tab) => comparableUrl(tab.url))
      .filter((url): url is string => Boolean(url))
  );
}

function similarity(windowTabs: TabSnapshot[], savedTabs: TabSnapshot[]): number {
  const left = urlsForTabs(windowTabs);
  const right = urlsForTabs(savedTabs);

  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  for (const url of left) {
    if (right.has(url)) intersection += 1;
  }

  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

interface SavedWindowCandidate {
  context: BrowserContext;
  contextWindow: ContextWindow;
}

function bestWindowMatch(
  tabs: TabSnapshot[],
  contexts: BrowserContext[],
  usedContextWindowIds: Set<string>
): SavedWindowCandidate | undefined {
  let best: SavedWindowCandidate | undefined;
  let bestScore = 0;

  for (const context of contexts) {
    for (const contextWindow of context.windows) {
      if (usedContextWindowIds.has(contextWindow.id)) continue;

      const score = similarity(tabs, contextWindow.tabs);
      if (score > bestScore) {
        bestScore = score;
        best = { context, contextWindow };
      }
    }
  }

  return bestScore >= 0.45 ? best : undefined;
}

function findBoundWindow(
  contexts: BrowserContext[],
  bindings: WindowBindings,
  windowId: number
): { context: BrowserContext; contextWindow: ContextWindow } | undefined {
  const binding = bindings[String(windowId)];
  if (!binding) return undefined;

  const context = contexts.find((item) => item.id === binding.contextId);
  const contextWindow = context?.windows.find(
    (item) => item.id === binding.contextWindowId
  );

  if (!context || !contextWindow) return undefined;
  return { context, contextWindow };
}

function contextIsActive(context: BrowserContext): boolean {
  return context.windows.some((window) => window.state === "active" && window.windowId !== undefined);
}

export async function reconcileAllWindows(): Promise<void> {
  const windows = await chrome.windows.getAll({
    populate: true,
    windowTypes: ["normal"]
  });

  const contexts = await loadContexts();

  for (const context of contexts) {
    for (const contextWindow of context.windows) {
      contextWindow.state = "shelved";
      contextWindow.windowId = undefined;
    }
  }

  const bindings: WindowBindings = {};
  const usedContextWindowIds = new Set<string>();

  for (const window of windows) {
    if (window.id === undefined) continue;

    const tabs = snapshotTabs(window.tabs);
    const match = bestWindowMatch(tabs, contexts, usedContextWindowIds);

    if (!match) {
      const context = contextFromWindow(window);
      const contextWindow = context.windows[0];
      contexts.push(context);
      usedContextWindowIds.add(contextWindow.id);
      bindings[String(window.id)] = {
        contextId: context.id,
        contextWindowId: contextWindow.id
      };
      continue;
    }

    const { context, contextWindow } = match;
    contextWindow.state = "active";
    contextWindow.windowId = window.id;
    contextWindow.tabs = tabs;
    contextWindow.preferredState = preferredStateFromChrome(
      window.state,
      contextWindow.preferredState
    );
    contextWindow.updatedAt = now();

    if (window.focused) {
      const timestamp = now();
      contextWindow.lastFocusedAt = timestamp;
      context.lastFocusedAt = timestamp;
    }

    context.updatedAt = now();
    usedContextWindowIds.add(contextWindow.id);
    bindings[String(window.id)] = {
      contextId: context.id,
      contextWindowId: contextWindow.id
    };
  }

  await saveContexts(contexts);
  await saveBindings(bindings);
}

export async function ensureBootstrapped(): Promise<void> {
  const bindings = await loadBindings();
  if (Object.keys(bindings).length > 0) return;

  await reconcileAllWindows();
}

export async function syncWindow(
  windowId: number,
  options: { touchedFocus?: boolean } = {}
): Promise<void> {
  let window: chrome.windows.Window;

  try {
    window = await chrome.windows.get(windowId, { populate: true });
  } catch {
    return;
  }

  if (window.type !== "normal") return;

  const contexts = await loadContexts();
  const bindings = await loadBindings();
  const bound = findBoundWindow(contexts, bindings, windowId);

  let context: BrowserContext;
  let contextWindow: ContextWindow;

  if (!bound) {
    context = contextFromWindow(window);
    contextWindow = context.windows[0];
    contexts.push(context);

    bindings[String(windowId)] = {
      contextId: context.id,
      contextWindowId: contextWindow.id
    };
  } else {
    ({ context, contextWindow } = bound);
    contextWindow.state = "active";
    contextWindow.windowId = windowId;
    contextWindow.tabs = snapshotTabs(window.tabs);
    contextWindow.preferredState = preferredStateFromChrome(
      window.state,
      contextWindow.preferredState
    );
    contextWindow.updatedAt = now();
    context.updatedAt = now();
  }

  if (options.touchedFocus) {
    const timestamp = now();
    contextWindow.lastFocusedAt = timestamp;
    context.lastFocusedAt = timestamp;
  }

  await saveContexts(contexts);
  await saveBindings(bindings);
}

export async function markWindowShelved(windowId: number): Promise<void> {
  const bindings = await loadBindings();
  const binding = bindings[String(windowId)];
  if (!binding) return;

  const contexts = await loadContexts();
  const context = contexts.find((item) => item.id === binding.contextId);
  const contextWindow = context?.windows.find(
    (item) => item.id === binding.contextWindowId
  );

  if (context && contextWindow) {
    contextWindow.state = "shelved";
    contextWindow.windowId = undefined;
    contextWindow.updatedAt = now();
    context.updatedAt = now();
    await saveContexts(contexts);
  }

  delete bindings[String(windowId)];
  await saveBindings(bindings);
}

export async function renameContext(contextId: string, name: string): Promise<void> {
  const contexts = await loadContexts();
  const context = contexts.find((item) => item.id === contextId);

  if (!context) throw new Error("Context not found");

  const previousName = context.name;
  const normalized = name.trim();
  context.name = normalized || undefined;
  context.updatedAt = now();

  if (context.windows.length === 1) {
    const onlyWindow = context.windows[0];

    if (!onlyWindow.name || onlyWindow.name === previousName) {
      onlyWindow.name = context.name;
    }
  }

  await saveContexts(contexts);
  await saveOrganizationTargetId(context.id);
}

async function createChromeWindowFromSnapshot(
  context: BrowserContext,
  contextWindow: ContextWindow,
  bindings: WindowBindings,
  focused: boolean
): Promise<void> {
  const snapshots = contextWindow.tabs
    .filter((tab) => canRestoreUrl(tab.url))
    .sort((a, b) => a.index - b.index);

  const urls = snapshots.map((tab) => tab.url);
  const created = await chrome.windows.create(
    urls.length > 0 ? { url: urls, focused } : { focused }
  );

  if (created.id === undefined) {
    throw new Error("Chrome did not return a window id");
  }

  contextWindow.state = "active";
  contextWindow.windowId = created.id;
  contextWindow.updatedAt = now();

  bindings[String(created.id)] = {
    contextId: context.id,
    contextWindowId: contextWindow.id
  };

  const createdTabs = await chrome.tabs.query({ windowId: created.id });

  for (
    let index = 0;
    index < Math.min(createdTabs.length, snapshots.length);
    index += 1
  ) {
    const tab = createdTabs[index];
    const snapshot = snapshots[index];

    if (tab.id !== undefined && snapshot.pinned !== tab.pinned) {
      await chrome.tabs.update(tab.id, { pinned: snapshot.pinned });
    }
  }

  const activeIndex = snapshots.findIndex((tab) => tab.active);
  const activeTab = createdTabs[activeIndex >= 0 ? activeIndex : 0];

  if (activeTab?.id !== undefined) {
    await chrome.tabs.update(activeTab.id, { active: true });
  }

  const refreshedTabs = await chrome.tabs.query({ windowId: created.id });
  contextWindow.tabs = snapshotTabs(refreshedTabs);
}

async function restoreMissingWindows(
  context: BrowserContext,
  bindings: WindowBindings
): Promise<void> {
  for (const contextWindow of context.windows) {
    if (contextWindow.state === "active" && contextWindow.windowId !== undefined) {
      continue;
    }

    await createChromeWindowFromSnapshot(context, contextWindow, bindings, false);
  }

  context.updatedAt = now();
}

async function saveCurrentWindowState(
  contexts: BrowserContext[],
  bindings: WindowBindings,
  window: chrome.windows.Window
): Promise<void> {
  if (window.id === undefined) return;

  const bound = findBoundWindow(contexts, bindings, window.id);
  if (!bound) return;

  bound.contextWindow.preferredState = preferredStateFromChrome(
    window.state,
    bound.contextWindow.preferredState
  );
  bound.contextWindow.updatedAt = now();
  bound.context.updatedAt = now();
}

export async function switchContext(contextId: string): Promise<void> {
  const contexts = await loadContexts();
  const bindings = await loadBindings();
  const target = contexts.find((item) => item.id === contextId);

  if (!target) throw new Error("Context not found");

  await restoreMissingWindows(target, bindings);

  const chromeWindows = await chrome.windows.getAll({
    windowTypes: ["normal"]
  });

  for (const window of chromeWindows) {
    if (window.id === undefined) continue;

    const binding = bindings[String(window.id)];
    if (binding?.contextId === contextId) continue;

    await saveCurrentWindowState(contexts, bindings, window);

    if (window.state !== "minimized") {
      await chrome.windows.update(window.id, { state: "minimized" });
    }
  }

  const targetWindows = target.windows
    .filter((window) => window.state === "active" && window.windowId !== undefined)
    .sort(
      (a, b) =>
        (a.lastFocusedAt ?? a.updatedAt) - (b.lastFocusedAt ?? b.updatedAt)
    );

  for (const contextWindow of targetWindows) {
    await chrome.windows.update(contextWindow.windowId!, {
      state: contextWindow.preferredState
    });
  }

  const focusWindow = targetWindows[targetWindows.length - 1];

  if (focusWindow?.windowId !== undefined) {
    await chrome.windows.update(focusWindow.windowId, { focused: true });

    const timestamp = now();
    focusWindow.lastFocusedAt = timestamp;
    target.lastFocusedAt = timestamp;
  }

  target.updatedAt = now();

  await saveContexts(contexts);
  await saveBindings(bindings);
}

export async function focusTab(contextId: string, tabId: number): Promise<void> {
  const contexts = await loadContexts();
  const context = contexts.find((item) => item.id === contextId);

  if (!context || !contextIsActive(context)) {
    throw new Error("Context is not active");
  }

  const contextWindow = context.windows.find((window) =>
    window.tabs.some((tab) => tab.tabId === tabId)
  );

  if (!contextWindow?.windowId) {
    throw new Error("Tab window is not active");
  }

  await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(contextWindow.windowId, { focused: true });
}

export async function shelveContext(contextId: string): Promise<void> {
  let contexts = await loadContexts();
  let bindings = await loadBindings();
  let context = contexts.find((item) => item.id === contextId);

  if (!context || !contextIsActive(context)) {
    throw new Error("Context is not active");
  }

  const activeWindowIds = context.windows
    .map((window) => window.windowId)
    .filter((windowId): windowId is number => windowId !== undefined);

  for (const windowId of activeWindowIds) {
    await syncWindow(windowId);
  }

  contexts = await loadContexts();
  bindings = await loadBindings();
  context = contexts.find((item) => item.id === contextId);

  if (!context) throw new Error("Context disappeared");

  for (const contextWindow of context.windows) {
    if (contextWindow.windowId !== undefined) {
      delete bindings[String(contextWindow.windowId)];
    }

    contextWindow.state = "shelved";
    contextWindow.windowId = undefined;
    contextWindow.updatedAt = now();
  }

  context.updatedAt = now();

  await saveContexts(contexts);
  await saveBindings(bindings);

  for (const windowId of activeWindowIds) {
    try {
      await chrome.windows.remove(windowId);
    } catch {
      // Window may already have been closed manually.
    }
  }
}

function canRestoreUrl(url: string): boolean {
  if (!url || isOwnExtensionUrl(url)) return false;
  return !url.startsWith("devtools://");
}

export async function restoreContext(contextId: string): Promise<void> {
  const contexts = await loadContexts();
  const bindings = await loadBindings();
  const context = contexts.find((item) => item.id === contextId);

  if (!context) throw new Error("Context not found");

  await restoreMissingWindows(context, bindings);

  const focusWindow = [...context.windows]
    .filter((window) => window.windowId !== undefined)
    .sort(
      (a, b) =>
        (a.lastFocusedAt ?? a.updatedAt) - (b.lastFocusedAt ?? b.updatedAt)
    )
    .at(-1);

  if (focusWindow?.windowId !== undefined) {
    await chrome.windows.update(focusWindow.windowId, {
      state: focusWindow.preferredState,
      focused: true
    });
  }

  context.updatedAt = now();

  await saveContexts(contexts);
  await saveBindings(bindings);
}

export async function addWindowToContext(
  sourceContextId: string,
  contextWindowId: string,
  targetContextId: string
): Promise<void> {
  if (sourceContextId === targetContextId) {
    throw new Error("Window already belongs to this context");
  }

  const contexts = await loadContexts();
  const bindings = await loadBindings();

  const sourceIndex = contexts.findIndex((item) => item.id === sourceContextId);
  const target = contexts.find((item) => item.id === targetContextId);

  if (sourceIndex < 0) throw new Error("Source context not found");
  if (!target) throw new Error("Target context not found");

  const source = contexts[sourceIndex];
  const windowIndex = source.windows.findIndex(
    (window) => window.id === contextWindowId
  );

  if (windowIndex < 0) throw new Error("Window not found");

  const contextWindow = source.windows[windowIndex];

  if (!contextWindow.name && source.windows.length === 1) {
    contextWindow.name = source.name;
  }

  if (target.windows.length === 1 && !target.windows[0].name) {
    target.windows[0].name = target.name;
  }

  const undo: UndoWindowMove = {
    sourceContextId: source.id,
    sourceContextName: source.name,
    sourceContextCreatedAt: source.createdAt,
    sourceContextLastFocusedAt: source.lastFocusedAt,
    sourceWindowIndex: windowIndex,
    contextWindowId: contextWindow.id,
    targetContextId: target.id
  };

  source.windows.splice(windowIndex, 1);
  target.windows.push(contextWindow);

  const timestamp = now();
  source.updatedAt = timestamp;
  target.updatedAt = timestamp;

  if (contextWindow.windowId !== undefined) {
    bindings[String(contextWindow.windowId)] = {
      contextId: target.id,
      contextWindowId: contextWindow.id
    };
  }

  if (source.windows.length === 0) {
    contexts.splice(sourceIndex, 1);
  }

  await saveContexts(contexts);
  await saveBindings(bindings);
  await saveOrganizationTargetId(target.id);
  await saveUndoWindowMove(undo);
}

export async function undoLastWindowMove(): Promise<void> {
  const undo = await loadUndoWindowMove();
  if (!undo) throw new Error("Nothing to undo");

  const contexts = await loadContexts();
  const bindings = await loadBindings();
  const target = contexts.find((item) => item.id === undo.targetContextId);

  if (!target) throw new Error("Target context no longer exists");

  const movedIndex = target.windows.findIndex(
    (window) => window.id === undo.contextWindowId
  );

  if (movedIndex < 0) throw new Error("Moved window no longer exists");

  const [contextWindow] = target.windows.splice(movedIndex, 1);
  let source = contexts.find((item) => item.id === undo.sourceContextId);

  if (!source) {
    source = {
      id: undo.sourceContextId,
      name: undo.sourceContextName,
      windows: [],
      createdAt: undo.sourceContextCreatedAt,
      updatedAt: now(),
      lastFocusedAt: undo.sourceContextLastFocusedAt
    };
    contexts.push(source);
  }

  source.windows.splice(
    Math.min(undo.sourceWindowIndex, source.windows.length),
    0,
    contextWindow
  );

  source.updatedAt = now();
  target.updatedAt = now();

  if (contextWindow.windowId !== undefined) {
    bindings[String(contextWindow.windowId)] = {
      contextId: source.id,
      contextWindowId: contextWindow.id
    };
  }

  await saveContexts(contexts);
  await saveBindings(bindings);
  await saveUndoWindowMove(undefined);
}
