import type { BrowserContext } from "./context";

export type ManagerRequest =
  | { type: "contexts:list" }
  | { type: "contexts:rename"; contextId: string; name: string }
  | { type: "contexts:switch"; contextId: string }
  | { type: "contexts:shelve"; contextId: string }
  | { type: "contexts:restore"; contextId: string }
  | { type: "contexts:set-pinned"; contextId: string; pinned: boolean }
  | { type: "contexts:remove"; contextId: string }
  | { type: "contexts:undo-remove" }
  | {
      type: "contexts:add-window";
      sourceContextId: string;
      contextWindowId: string;
      targetContextId: string;
    }
  | {
      type: "contexts:create-from-window";
      sourceContextId: string;
      contextWindowId: string;
    }
  | { type: "contexts:undo-window-move" }
  | { type: "tabs:focus"; contextId: string; tabId: number }
  | { type: "tabs:close"; tabId: number };

export type ManagerResponse =
  | {
      ok: true;
      contexts?: BrowserContext[];
      organizationTargetId?: string;
      canUndoWindowMove?: boolean;
    }
  | { ok: false; error: string };
