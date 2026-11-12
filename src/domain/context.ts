export type ContextWindowState = "active" | "shelved";
export type RestorableWindowState = "normal" | "maximized";

export interface WindowBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TabSnapshot {
  tabId?: number;
  url: string;
  title: string;
  favIconUrl?: string;
  pinned: boolean;
  index: number;
  active: boolean;
}

export interface ContextWindow {
  id: string;
  name?: string;
  state: ContextWindowState;
  windowId?: number;
  tabs: TabSnapshot[];
  preferredState: RestorableWindowState;
  normalBounds?: WindowBounds;
  createdAt: number;
  updatedAt: number;
  lastFocusedAt?: number;
}

export interface DesktopWindowMatcher {
  processName: string;
  executablePath?: string;
  titleHint: string;
}

export interface DesktopWindowReference {
  id: string;
  displayName: string;
  applicationName: string;
  matcher: DesktopWindowMatcher;
  createdAt: number;
}

export interface BrowserContext {
  id: string;
  name?: string;
  windows: ContextWindow[];
  desktopWindows: DesktopWindowReference[];
  pinned: boolean;
  shelvedAt?: number;
  createdAt: number;
  updatedAt: number;
  lastFocusedAt?: number;
}

export interface WindowBinding {
  contextId: string;
  contextWindowId: string;
}

export interface WindowBindings {
  [windowId: string]: WindowBinding;
}

export interface UndoWindowMove {
  sourceContextId: string;
  sourceContextName?: string;
  sourceContextCreatedAt: number;
  sourceContextLastFocusedAt?: number;
  sourceWindowIndex: number;
  contextWindowId: string;
  targetContextId: string;
  sourceDesktopWindows?: DesktopWindowReference[];
  desktopWindowIdsAddedToTarget?: string[];
}


export interface UndoContextRemoval {
  context: BrowserContext;
  index: number;
  previousOrganizationTargetId?: string;
}
