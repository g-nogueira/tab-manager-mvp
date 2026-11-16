import type {
  DesktopWindowReference
} from "../domain/context";
import type { DesktopWindowCandidate } from "../domain/desktop";
import {
  loadContexts,
  saveContexts
} from "./context-store";

function sameCandidate(
  reference: DesktopWindowReference,
  candidate: DesktopWindowCandidate
): boolean {
  const leftPath = reference.matcher.executablePath?.toLowerCase();
  const rightPath = candidate.matcher.executablePath?.toLowerCase();

  return (
    reference.matcher.processName.toLowerCase() ===
      candidate.matcher.processName.toLowerCase() &&
    (leftPath && rightPath ? leftPath === rightPath : true) &&
    reference.matcher.titleHint.toLowerCase() ===
      candidate.matcher.titleHint.toLowerCase()
  );
}

export async function addDesktopWindowToContext(
  contextId: string,
  candidate: DesktopWindowCandidate
): Promise<void> {
  const contexts = await loadContexts();
  const context = contexts.find((item) => item.id === contextId);

  if (!context) throw new Error("Context not found");

  if (context.desktopWindows.some((item) => sameCandidate(item, candidate))) {
    return;
  }

  const timestamp = Date.now();

  context.desktopWindows.push({
    id: crypto.randomUUID(),
    displayName: candidate.title || candidate.applicationName,
    applicationName: candidate.applicationName,
    matcher: candidate.matcher,
    createdAt: timestamp
  });
  context.updatedAt = timestamp;

  await saveContexts(contexts);
}

export async function removeDesktopWindowFromContext(
  contextId: string,
  desktopWindowId: string
): Promise<void> {
  const contexts = await loadContexts();
  const context = contexts.find((item) => item.id === contextId);

  if (!context) throw new Error("Context not found");

  const index = context.desktopWindows.findIndex(
    (item) => item.id === desktopWindowId
  );

  if (index < 0) return;

  context.desktopWindows.splice(index, 1);
  context.updatedAt = Date.now();

  await saveContexts(contexts);
}
