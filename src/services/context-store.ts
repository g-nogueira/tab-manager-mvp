import type {
  BrowserContext,
  TabSnapshot,
  UndoWindowMove,
  WindowBinding,
  WindowBindings
} from "../domain/context";

const CONTEXTS_KEY = "contexts";
const BINDINGS_KEY = "windowBindings";
const ORGANIZATION_TARGET_KEY = "organizationTargetId";
const UNDO_WINDOW_MOVE_KEY = "undoWindowMove";

interface LegacyBrowserContext {
  id: string;
  name?: string;
  state?: "active" | "shelved";
  windowId?: number;
  tabs?: TabSnapshot[];
  createdAt?: number;
  updatedAt?: number;
  lastFocusedAt?: number;
}

function isBrowserContext(value: unknown): value is BrowserContext {
  return Boolean(
    value &&
      typeof value === "object" &&
      Array.isArray((value as BrowserContext).windows)
  );
}

function migrateLegacyContext(legacy: LegacyBrowserContext): BrowserContext {
  const timestamp = Date.now();
  const createdAt = legacy.createdAt ?? timestamp;
  const updatedAt = legacy.updatedAt ?? createdAt;

  return {
    id: legacy.id,
    name: legacy.name,
    windows: [
      {
        id: `legacy-${legacy.id}`,
        name: legacy.name,
        state: legacy.state ?? (legacy.windowId === undefined ? "shelved" : "active"),
        windowId: legacy.windowId,
        tabs: legacy.tabs ?? [],
        preferredState: "normal",
        createdAt,
        updatedAt,
        lastFocusedAt: legacy.lastFocusedAt
      }
    ],
    createdAt,
    updatedAt,
    lastFocusedAt: legacy.lastFocusedAt
  };
}

function normalizeContext(context: BrowserContext): BrowserContext {
  return {
    ...context,
    windows: context.windows.map((window) => ({
      ...window,
      preferredState: window.preferredState ?? "normal"
    }))
  };
}

export async function loadContexts(): Promise<BrowserContext[]> {
  const result = await chrome.storage.local.get(CONTEXTS_KEY);
  const raw = result[CONTEXTS_KEY];

  if (!Array.isArray(raw)) return [];

  let migrated = false;
  const contexts = raw.map((item) => {
    if (isBrowserContext(item)) return normalizeContext(item);

    migrated = true;
    return migrateLegacyContext(item as LegacyBrowserContext);
  });

  if (migrated) {
    await chrome.storage.local.set({ [CONTEXTS_KEY]: contexts });
  }

  return contexts;
}

export async function saveContexts(contexts: BrowserContext[]): Promise<void> {
  await chrome.storage.local.set({ [CONTEXTS_KEY]: contexts });
}

export async function loadBindings(): Promise<WindowBindings> {
  const result = await chrome.storage.session.get(BINDINGS_KEY);
  const raw = result[BINDINGS_KEY];

  if (!raw || typeof raw !== "object") return {};

  const bindings: WindowBindings = {};

  for (const [windowId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") {
      bindings[windowId] = {
        contextId: value,
        contextWindowId: `legacy-${value}`
      };
      continue;
    }

    if (
      value &&
      typeof value === "object" &&
      typeof (value as WindowBinding).contextId === "string" &&
      typeof (value as WindowBinding).contextWindowId === "string"
    ) {
      bindings[windowId] = value as WindowBinding;
    }
  }

  return bindings;
}

export async function saveBindings(bindings: WindowBindings): Promise<void> {
  await chrome.storage.session.set({ [BINDINGS_KEY]: bindings });
}

export async function loadOrganizationTargetId(): Promise<string | undefined> {
  const result = await chrome.storage.local.get(ORGANIZATION_TARGET_KEY);
  const value = result[ORGANIZATION_TARGET_KEY];
  return typeof value === "string" ? value : undefined;
}

export async function saveOrganizationTargetId(
  contextId: string | undefined
): Promise<void> {
  if (contextId) {
    await chrome.storage.local.set({ [ORGANIZATION_TARGET_KEY]: contextId });
  } else {
    await chrome.storage.local.remove(ORGANIZATION_TARGET_KEY);
  }
}

export async function loadUndoWindowMove(): Promise<UndoWindowMove | undefined> {
  const result = await chrome.storage.session.get(UNDO_WINDOW_MOVE_KEY);
  const value = result[UNDO_WINDOW_MOVE_KEY];

  return value && typeof value === "object"
    ? (value as UndoWindowMove)
    : undefined;
}

export async function saveUndoWindowMove(
  move: UndoWindowMove | undefined
): Promise<void> {
  if (move) {
    await chrome.storage.session.set({ [UNDO_WINDOW_MOVE_KEY]: move });
  } else {
    await chrome.storage.session.remove(UNDO_WINDOW_MOVE_KEY);
  }
}
