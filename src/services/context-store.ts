import type { BrowserContext, WindowBindings } from "../domain/context";

const CONTEXTS_KEY = "contexts";
const BINDINGS_KEY = "windowBindings";

export async function loadContexts(): Promise<BrowserContext[]> {
  const result = await chrome.storage.local.get(CONTEXTS_KEY);
  return Array.isArray(result[CONTEXTS_KEY])
    ? (result[CONTEXTS_KEY] as BrowserContext[])
    : [];
}

export async function saveContexts(contexts: BrowserContext[]): Promise<void> {
  await chrome.storage.local.set({ [CONTEXTS_KEY]: contexts });
}

export async function loadBindings(): Promise<WindowBindings> {
  const result = await chrome.storage.session.get(BINDINGS_KEY);
  const bindings = result[BINDINGS_KEY];
  return bindings && typeof bindings === "object"
    ? (bindings as WindowBindings)
    : {};
}

export async function saveBindings(bindings: WindowBindings): Promise<void> {
  await chrome.storage.session.set({ [BINDINGS_KEY]: bindings });
}
