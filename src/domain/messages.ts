import type { BrowserContext } from "./context";

export type ManagerRequest =
  | { type: "contexts:list" }
  | { type: "contexts:rename"; contextId: string; name: string }
  | { type: "contexts:focus"; contextId: string }
  | { type: "contexts:shelve"; contextId: string }
  | { type: "contexts:restore"; contextId: string }
  | { type: "tabs:focus"; contextId: string; tabId: number };

export type ManagerResponse =
  | { ok: true; contexts?: BrowserContext[] }
  | { ok: false; error: string };
