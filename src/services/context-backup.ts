import type { BrowserContext } from "../domain/context";
import {
  CONTEXT_BACKUP_SCHEMA_VERSION,
  type ContextBackupDocument,
  type ContextBackupListResult,
  type ContextBackupSaveResult,
  type ContextBackupSettings
} from "../domain/backup";
import {
  loadContexts,
  loadOrganizationTargetId
} from "./context-store";
import {
  createDiagnosticRequestId,
  diagnosticInfo
} from "./diagnostics";
import { sendNativeCompanion } from "./desktop-companion-client";

export const CONTEXT_BACKUP_ALARM = "context-tab-manager:auto-backup";
export const CONTEXT_BACKUP_DEBOUNCE_MS = 3000;

interface NativeReadBackupResult {
  backup: ContextBackupDocument;
}

function portableContexts(
  contexts: BrowserContext[]
): BrowserContext[] {
  return contexts.map((context) => ({
    ...context,
    windows: context.windows.map((window) => ({
      ...window,
      windowId: undefined,
      tabs: window.tabs.map((tab) => ({
        ...tab,
        tabId: undefined
      }))
    }))
  }));
}

function validateBackup(
  value: unknown
): asserts value is ContextBackupDocument {
  if (!value || typeof value !== "object") {
    throw new Error("Backup is not a JSON object");
  }

  const backup = value as Partial<ContextBackupDocument>;

  if (backup.schemaVersion !== CONTEXT_BACKUP_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported backup schema: ${String(backup.schemaVersion)}`
    );
  }

  if (!Array.isArray(backup.contexts)) {
    throw new Error("Backup does not contain a context list");
  }
}

export async function createContextBackupDocument(
  reason: ContextBackupDocument["reason"]
): Promise<ContextBackupDocument> {
  const [contexts, organizationTargetId] = await Promise.all([
    loadContexts(),
    loadOrganizationTargetId()
  ]);

  return {
    schemaVersion: CONTEXT_BACKUP_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    extensionVersion: chrome.runtime.getManifest().version,
    reason,
    contexts: portableContexts(contexts),
    organizationTargetId
  };
}

export async function saveContextBackup(
  reason: ContextBackupDocument["reason"] = "automatic",
  requestId = createDiagnosticRequestId()
): Promise<ContextBackupSaveResult> {
  const backup = await createContextBackupDocument(reason);

  diagnosticInfo("backup", "save:start", {
    requestId,
    reason,
    contextCount: backup.contexts.length
  });

  const response = await sendNativeCompanion(
    "backupContextState",
    requestId,
    { backup },
    10000
  );

  if (!response.ok) {
    throw new Error(
      response.error ?? "Native companion could not save the context backup"
    );
  }

  const result = response.result as ContextBackupSaveResult | undefined;

  if (!result?.backup || !result.settings) {
    throw new Error("Native companion returned an invalid backup result");
  }

  diagnosticInfo("backup", "save:completed", {
    requestId,
    backupId: result.backup.id,
    secondaryCopyWritten: result.secondaryCopyWritten,
    secondaryError: result.secondaryError
  });

  return result;
}

export async function listContextBackups(
  requestId = createDiagnosticRequestId()
): Promise<ContextBackupListResult> {
  const response = await sendNativeCompanion(
    "listContextBackups",
    requestId
  );

  if (!response.ok) {
    throw new Error(
      response.error ?? "Native companion could not list context backups"
    );
  }

  const result = response.result as ContextBackupListResult | undefined;

  if (!result?.backups || !result.settings) {
    throw new Error("Native companion returned an invalid backup list");
  }

  return result;
}

export async function setContextBackupSecondaryDirectory(
  directory: string | undefined,
  requestId = createDiagnosticRequestId()
): Promise<ContextBackupSettings> {
  const response = await sendNativeCompanion(
    "setContextBackupSecondaryDirectory",
    requestId,
    {
      secondaryBackupDirectory:
        directory?.trim() || null
    }
  );

  if (!response.ok) {
    throw new Error(
      response.error ?? "Native companion could not update backup settings"
    );
  }

  const settings =
    response.result as ContextBackupSettings | undefined;

  if (!settings?.localBackupDirectory) {
    throw new Error("Native companion returned invalid backup settings");
  }

  return settings;
}

export async function restoreContextBackup(
  backupId: string,
  requestId = createDiagnosticRequestId()
): Promise<ContextBackupDocument> {
  const currentContexts = await loadContexts();

  if (currentContexts.length > 0) {
    await saveContextBackup(
      "pre-restore",
      createDiagnosticRequestId()
    );
  }

  const response = await sendNativeCompanion(
    "readContextBackup",
    requestId,
    { backupId }
  );

  if (!response.ok) {
    throw new Error(
      response.error ?? "Native companion could not read the context backup"
    );
  }

  const result = response.result as NativeReadBackupResult | undefined;
  validateBackup(result?.backup);

  const restoredAt = Date.now();
  const restoredContexts = result.backup.contexts.map((context) => ({
    ...context,
    shelvedAt: restoredAt,
    updatedAt: Math.max(context.updatedAt, restoredAt),
    windows: context.windows.map((window) => ({
      ...window,
      state: "shelved" as const,
      windowId: undefined,
      updatedAt: Math.max(window.updatedAt, restoredAt),
      tabs: window.tabs.map((tab) => ({
        ...tab,
        tabId: undefined
      }))
    }))
  }));

  const organizationTargetId =
    result.backup.organizationTargetId &&
    restoredContexts.some(
      (context) =>
        context.id === result.backup.organizationTargetId
    )
      ? result.backup.organizationTargetId
      : undefined;

  await chrome.storage.session.clear();
  await chrome.storage.local.set({
    contexts: restoredContexts,
    ...(organizationTargetId
      ? { organizationTargetId }
      : {})
  });

  if (!organizationTargetId) {
    await chrome.storage.local.remove(
      "organizationTargetId"
    );
  }

  diagnosticInfo("backup", "restore:completed", {
    requestId,
    backupId,
    contextCount: restoredContexts.length
  });

  return result.backup;
}
