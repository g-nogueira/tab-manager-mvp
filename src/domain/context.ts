export type ContextState = "active" | "shelved";

export interface TabSnapshot {
  tabId?: number;
  url: string;
  title: string;
  favIconUrl?: string;
  pinned: boolean;
  index: number;
  active: boolean;
}

export interface BrowserContext {
  id: string;
  name?: string;
  state: ContextState;
  windowId?: number;
  tabs: TabSnapshot[];
  createdAt: number;
  updatedAt: number;
  lastFocusedAt?: number;
}

export interface WindowBindings {
  [windowId: string]: string;
}
