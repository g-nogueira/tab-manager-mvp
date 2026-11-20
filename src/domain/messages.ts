import type {
  ContextBackupDocument,
  ContextBackupListResult,
  ContextBackupSaveResult,
  ContextBackupSettings
} from "./backup";
import type { BrowserContext } from "./context";
import type { ContextNavigationState } from "./navigation";
import type {
  DesktopCompanionStatus,
  DesktopWindowCandidate
} from "./desktop";

export type ManagerRequest =
  | { type: "contexts:list" }
  | { type: "contexts:rename"; contextId: string; name: string }
  | { type: "contexts:switch"; contextId: string }
  | { type: "contexts:focus"; contextId: string; requestId?: string }
  | { type: "desktop:status"; requestId: string }
  | { type: "desktop:list-windows"; requestId: string }
  | { type: "backup:list" }
  | { type: "backup:create" }
  | { type: "backup:export" }
  | { type: "backup:import"; backup: ContextBackupDocument }
  | { type: "backup:restore"; backupId: string }
  | {
      type: "backup:set-secondary-directory";
      directory?: string;
    }
  | {
      type: "contexts:add-desktop-window";
      contextId: string;
      candidate: DesktopWindowCandidate;
    }
  | {
      type: "contexts:remove-desktop-window";
      contextId: string;
      desktopWindowId: string;
    }
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
      desktopStatus?: DesktopCompanionStatus;
      desktopCandidates?: DesktopWindowCandidate[];
      backupList?: ContextBackupListResult;
      backupSave?: ContextBackupSaveResult;
      backupSettings?: ContextBackupSettings;
      backupDocument?: ContextBackupDocument;
      contextNavigation?: ContextNavigationState;
    }
  | { ok: false; error: string };
