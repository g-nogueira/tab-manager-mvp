import type { BrowserContext, TabSnapshot, WindowBindings } from "../domain/context";
import {
  loadBindings,
  loadContexts,
  saveBindings,
  saveContexts
} from "./context-store";

const ownExtensionPrefix = chrome.runtime.getURL("");

function now(): number {
  return Date.now();
}

function newContextId(): string {
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

function similarity(windowTabs: TabSnapshot[], contextTabs: TabSnapshot[]): number {
  const left = urlsForTabs(windowTabs);
  const right = urlsForTabs(contextTabs);

  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  for (const url of left) {
    if (right.has(url)) intersection += 1;
  }

  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

function contextFromWindow(window: chrome.windows.Window): BrowserContext {
  const timestamp = now();

  return {
    id: newContextId(),
    state: "active",
    windowId: window.id,
    tabs: snapshotTabs(window.tabs),
    createdAt: timestamp,
    updatedAt: timestamp,
    lastFocusedAt: window.focused ? timestamp : undefined
  };
}

function bestMatch(
  tabs: TabSnapshot[],
  contexts: BrowserContext[],
  usedContextIds: Set<string>
): BrowserContext | undefined {
  let best: BrowserContext | undefined;
  let bestScore = 0;

  for (const context of contexts) {
    if (usedContextIds.has(context.id)) continue;

    const score = similarity(tabs, context.tabs);
    if (score > bestScore) {
      bestScore = score;
      best = context;
    }
  }

  return bestScore >= 0.45 ? best : undefined;
}

export async function reconcileAllWindows(): Promise<void> {
  const windows = await chrome.windows.getAll({
    populate: true,
    windowTypes: ["normal"]
  });

  const contexts = await loadContexts();
  const nextContexts = contexts.map((context) => ({
    ...context,
    state: "shelved" as const,
    windowId: undefined
  }));
  const bindings: WindowBindings = {};
  const usedContextIds = new Set<string>();

  for (const window of windows) {
    if (window.id === undefined) continue;

    const tabs = snapshotTabs(window.tabs);
    let context = bestMatch(tabs, nextContexts, usedContextIds);

    if (!context) {
      context = contextFromWindow(window);
      nextContexts.push(context);
    } else {
      context.state = "active";
      context.windowId = window.id;
      context.tabs = tabs;
      context.updatedAt = now();
      if (window.focused) context.lastFocusedAt = now();
    }

    usedContextIds.add(context.id);
    bindings[String(window.id)] = context.id;
  }

  await saveContexts(nextContexts);
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
  let contextId = bindings[String(windowId)];
  let context = contexts.find((item) => item.id === contextId);

  if (!context) {
    context = contextFromWindow(window);
    contexts.push(context);
    contextId = context.id;
    bindings[String(windowId)] = context.id;
  } else {
    context.state = "active";
    context.windowId = windowId;
    context.tabs = snapshotTabs(window.tabs);
    context.updatedAt = now();
  }

  if (options.touchedFocus) {
    context.lastFocusedAt = now();
  }

  await saveContexts(contexts);
  await saveBindings(bindings);
}

export async function markWindowShelved(windowId: number): Promise<void> {
  const bindings = await loadBindings();
  const contextId = bindings[String(windowId)];
  if (!contextId) return;

  const contexts = await loadContexts();
  const context = contexts.find((item) => item.id === contextId);

  if (context) {
    context.state = "shelved";
    context.windowId = undefined;
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

  const normalized = name.trim();
  context.name = normalized || undefined;
  context.updatedAt = now();

  await saveContexts(contexts);
}

export async function focusContext(contextId: string): Promise<void> {
  const contexts = await loadContexts();
  const context = contexts.find((item) => item.id === contextId);

  if (!context?.windowId || context.state !== "active") {
    throw new Error("Context is not active");
  }

  await chrome.windows.update(context.windowId, { focused: true });
}

export async function focusTab(contextId: string, tabId: number): Promise<void> {
  const contexts = await loadContexts();
  const context = contexts.find((item) => item.id === contextId);

  if (!context?.windowId || context.state !== "active") {
    throw new Error("Context is not active");
  }

  await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(context.windowId, { focused: true });
}

export async function shelveContext(contextId: string): Promise<void> {
  const contexts = await loadContexts();
  const context = contexts.find((item) => item.id === contextId);

  if (!context?.windowId || context.state !== "active") {
    throw new Error("Context is not active");
  }

  await syncWindow(context.windowId);

  const refreshedContexts = await loadContexts();
  const refreshed = refreshedContexts.find((item) => item.id === contextId);

  if (!refreshed?.windowId) {
    throw new Error("Context window disappeared");
  }

  const windowId = refreshed.windowId;
  refreshed.state = "shelved";
  refreshed.windowId = undefined;
  refreshed.updatedAt = now();
  await saveContexts(refreshedContexts);

  const bindings = await loadBindings();
  delete bindings[String(windowId)];
  await saveBindings(bindings);

  await chrome.windows.remove(windowId);
}

function canRestoreUrl(url: string): boolean {
  if (!url || isOwnExtensionUrl(url)) return false;
  return !url.startsWith("devtools://");
}

export async function restoreContext(contextId: string): Promise<void> {
  const contexts = await loadContexts();
  const context = contexts.find((item) => item.id === contextId);

  if (!context) throw new Error("Context not found");

  if (context.state === "active" && context.windowId) {
    await chrome.windows.update(context.windowId, { focused: true });
    return;
  }

  const snapshots = context.tabs
    .filter((tab) => canRestoreUrl(tab.url))
    .sort((a, b) => a.index - b.index);

  const urls = snapshots.map((tab) => tab.url);
  const created = await chrome.windows.create(
    urls.length > 0 ? { url: urls, focused: true } : { focused: true }
  );

  if (created.id === undefined) {
    throw new Error("Chrome did not return a window id");
  }

  const bindings = await loadBindings();
  bindings[String(created.id)] = context.id;
  await saveBindings(bindings);

  context.state = "active";
  context.windowId = created.id;
  context.updatedAt = now();
  context.lastFocusedAt = now();
  await saveContexts(contexts);

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

  await syncWindow(created.id);
}
