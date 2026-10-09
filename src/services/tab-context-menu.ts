import type { BrowserContext } from "../domain/context";
import {
  loadBindings,
  loadContexts,
  loadOrganizationTargetId,
  loadUndoWindowMove
} from "./context-store";
import {
  addChromeWindowToContext,
  undoLastWindowMove
} from "./window-reconciler";

const ADD_TO_TARGET_ID = "tab-context:add-to-target";
const ADD_TO_ANOTHER_ID = "tab-context:add-to-another";
const ADD_TO_CONTEXT_PREFIX = "tab-context:add-to:";
const UNDO_ID = "tab-context:undo";
const UNDO_SEPARATOR_ID = "tab-context:undo-separator";

function hostLabel(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function contextLabel(context: BrowserContext): string {
  if (context.name?.trim()) return context.name.trim();

  const hosts = [
    ...new Set(
      context.windows
        .flatMap((window) => window.tabs)
        .map((tab) => hostLabel(tab.url))
        .filter((host): host is string => Boolean(host))
    )
  ];

  const label =
    hosts.length === 0
      ? "Unnamed context"
      : hosts.length <= 2
        ? hosts.join(", ")
        : `${hosts.slice(0, 2).join(", ")} & ${hosts.length - 2} more`;

  return label.length > 60 ? `${label.slice(0, 57)}…` : label;
}

function contextItemId(contextId: string): string {
  return `${ADD_TO_CONTEXT_PREFIX}${contextId}`;
}

function createMenu(properties: chrome.contextMenus.CreateProperties): void {
  chrome.contextMenus.create(properties, () => {
    // Reading lastError prevents benign duplicate/removal races from surfacing
    // as unchecked extension errors while the menu is being rebuilt.
    void chrome.runtime.lastError;
  });
}

function removeAllMenus(): Promise<void> {
  return new Promise((resolve) => {
    chrome.contextMenus.removeAll(() => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function updateMenu(
  id: string,
  properties: chrome.contextMenus.UpdateProperties
): Promise<void> {
  return new Promise((resolve) => {
    chrome.contextMenus.update(id, properties, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function refreshMenus(): Promise<void> {
  return new Promise((resolve) => {
    chrome.contextMenus.refresh(() => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

export async function rebuildTabContextMenus(): Promise<void> {
  const [contexts, organizationTargetId, undo] = await Promise.all([
    loadContexts(),
    loadOrganizationTargetId(),
    loadUndoWindowMove()
  ]);

  await removeAllMenus();

  const target = organizationTargetId
    ? contexts.find((context) => context.id === organizationTargetId)
    : undefined;

  if (target) {
    createMenu({
      id: ADD_TO_TARGET_ID,
      title: `Add this window to ${contextLabel(target)}`,
      contexts: ["tab"]
    });
  }

  if (contexts.length > 0) {
    createMenu({
      id: ADD_TO_ANOTHER_ID,
      title: target
        ? "Add this window to another context…"
        : "Add this window to context…",
      contexts: ["tab"]
    });

    for (const context of contexts) {
      createMenu({
        id: contextItemId(context.id),
        parentId: ADD_TO_ANOTHER_ID,
        title: contextLabel(context),
        contexts: ["tab"]
      });
    }
  }

  if (undo) {
    createMenu({
      id: UNDO_SEPARATOR_ID,
      type: "separator",
      contexts: ["tab"]
    });
    createMenu({
      id: UNDO_ID,
      title: "Undo last context assignment",
      contexts: ["tab"]
    });
  }
}

export async function prepareTabContextMenusForWindow(
  windowId: number
): Promise<void> {
  const [contexts, bindings, organizationTargetId, undo] = await Promise.all([
    loadContexts(),
    loadBindings(),
    loadOrganizationTargetId(),
    loadUndoWindowMove()
  ]);

  const sourceContextId = bindings[String(windowId)]?.contextId;
  const target = organizationTargetId
    ? contexts.find((context) => context.id === organizationTargetId)
    : undefined;

  const tasks: Promise<void>[] = [];

  if (target) {
    tasks.push(
      updateMenu(ADD_TO_TARGET_ID, {
        title: `Add this window to ${contextLabel(target)}`,
        visible: target.id !== sourceContextId
      })
    );
  }

  let eligibleCount = 0;

  for (const context of contexts) {
    const visible = context.id !== sourceContextId;
    if (visible) eligibleCount += 1;

    tasks.push(
      updateMenu(contextItemId(context.id), {
        title: contextLabel(context),
        visible
      })
    );
  }

  if (contexts.length > 0) {
    tasks.push(
      updateMenu(ADD_TO_ANOTHER_ID, {
        title: target
          ? "Add this window to another context…"
          : "Add this window to context…",
        visible: eligibleCount > 0
      })
    );
  }

  if (undo) {
    tasks.push(updateMenu(UNDO_ID, { visible: true }));
    tasks.push(updateMenu(UNDO_SEPARATOR_ID, { visible: true }));
  }

  await Promise.all(tasks);
  await refreshMenus();
}

export async function handleTabContextMenuClick(
  menuItemId: string | number,
  tab: chrome.tabs.Tab | undefined
): Promise<void> {
  if (tab?.windowId === undefined) return;

  const id = String(menuItemId);

  if (id === UNDO_ID) {
    await undoLastWindowMove();
    await rebuildTabContextMenus();
    return;
  }

  let targetContextId: string | undefined;

  if (id === ADD_TO_TARGET_ID) {
    targetContextId = await loadOrganizationTargetId();
  } else if (id.startsWith(ADD_TO_CONTEXT_PREFIX)) {
    targetContextId = id.slice(ADD_TO_CONTEXT_PREFIX.length);
  }

  if (!targetContextId) return;

  await addChromeWindowToContext(tab.windowId, targetContextId);
  await rebuildTabContextMenus();
}
