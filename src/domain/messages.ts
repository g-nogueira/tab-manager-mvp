import type { BrowserContext } from "./context";

export type ManagerRequest =
  | { type: "contexts:list" }
  | { type: "contexts:rename"; contextId: string; name: string }
  | { type: "contexts:switch"; contextId: string }
  | { type: "contexts:shelve"; contextId: string }
  | { type: "contexts:restore"; contextId: string }
  | {
      type: "contexts:add-window";
      sourceContextId: string;
      contextWindowId: string;
      targetContextId: string;
    }
  | { type: "contexts:undo-window-move" }
  | { type: "tabs:focus"; contextId: string; tabId: number };

export type ManagerResponse =
  | {
      ok: true;
      contexts?: BrowserContext[];
      organizationTargetId?: string;
      canUndoWindowMove?: boolean;
    }
  | { ok: false; error: string };
