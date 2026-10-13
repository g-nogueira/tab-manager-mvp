import type { BrowserContext } from "../domain/context";
import {
  loadBindings,
  loadContexts,
  loadOrganizationTargetId,
  loadUndoContextRemoval,
  saveBindings,
  saveContexts,
  saveOrganizationTargetId,
  saveUndoContextRemoval
} from "./context-store";

const SHELF_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function now(): number {
  return Date.now();
}

function contextIsActive(context: BrowserContext): boolean {
  return context.windows.some(
    (window) => window.state === "active" && window.windowId !== undefined
  );
}

function isTrivialTabUrl(url: string): boolean {
  const normalized = url.trim().toLowerCase();

  return (
    normalized === "" ||
    normalized === "about:blank" ||
    normalized === "chrome://newtab" ||
    normalized === "chrome://newtab/" ||
    normalized === "chrome://new-tab-page" ||
    normalized === "chrome://new-tab-page/"
  );
}

function isDisposableShelvedContext(context: BrowserContext): boolean {
  if (contextIsActive(context)) return false;
  if (context.pinned) return false;
  if (context.name?.trim()) return false;
  if (context.windows.length !== 1) return false;

  const tabs = context.windows[0].tabs;
  return tabs.length === 0 || tabs.every((tab) => isTrivialTabUrl(tab.url));
}

function isExpiredShelvedContext(
  context: BrowserContext,
  timestamp: number
): boolean {
  if (contextIsActive(context) || context.pinned) return false;

  const shelvedAt = context.shelvedAt ?? context.updatedAt;
  return timestamp - shelvedAt >= SHELF_RETENTION_MS;
}

export async function cleanupShelvedContexts(): Promise<void> {
  const contexts = await loadContexts();
  const timestamp = now();
  const removedIds = new Set<string>();

  const kept = contexts.filter((context) => {
    const remove =
      isDisposableShelvedContext(context) ||
      isExpiredShelvedContext(context, timestamp);

    if (remove) removedIds.add(context.id);
    return !remove;
  });

  if (removedIds.size === 0) return;

  const bindings = await loadBindings();
  for (const [windowId, binding] of Object.entries(bindings)) {
    if (removedIds.has(binding.contextId)) {
      delete bindings[windowId];
    }
  }

  const organizationTargetId = await loadOrganizationTargetId();
  if (organizationTargetId && removedIds.has(organizationTargetId)) {
    await saveOrganizationTargetId(undefined);
  }

  await saveContexts(kept);
  await saveBindings(bindings);
}

export async function setContextPinned(
  contextId: string,
  pinned: boolean
): Promise<void> {
  const contexts = await loadContexts();
  const context = contexts.find((item) => item.id === contextId);

  if (!context) throw new Error("Context not found");

  context.pinned = pinned;
  context.updatedAt = now();

  // Unpinning should start a fresh retention window rather than immediately
  // deleting an old context that happened to be pinned for a long time.
  if (!pinned && !contextIsActive(context)) {
    context.shelvedAt = now();
  }

  await saveContexts(contexts);
}

export async function removeShelvedContext(contextId: string): Promise<void> {
  const contexts = await loadContexts();
  const index = contexts.findIndex((context) => context.id === contextId);

  if (index < 0) throw new Error("Context not found");

  const context = contexts[index];

  if (contextIsActive(context)) {
    throw new Error("Active contexts cannot be removed");
  }

  const previousOrganizationTargetId = await loadOrganizationTargetId();

  contexts.splice(index, 1);
  await saveContexts(contexts);

  if (previousOrganizationTargetId === context.id) {
    await saveOrganizationTargetId(undefined);
  }

  await saveUndoContextRemoval({
    context,
    index,
    previousOrganizationTargetId
  });
}

export async function undoLastContextRemoval(): Promise<void> {
  const removal = await loadUndoContextRemoval();
  if (!removal) throw new Error("Nothing to undo");

  const contexts = await loadContexts();

  if (contexts.some((context) => context.id === removal.context.id)) {
    await saveUndoContextRemoval(undefined);
    return;
  }

  contexts.splice(
    Math.min(removal.index, contexts.length),
    0,
    removal.context
  );

  await saveContexts(contexts);

  if (
    removal.previousOrganizationTargetId === removal.context.id
  ) {
    await saveOrganizationTargetId(removal.context.id);
  }

  await saveUndoContextRemoval(undefined);
}
