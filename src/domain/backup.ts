import type { BrowserContext } from "./context";

export const CONTEXT_BACKUP_SCHEMA_VERSION = 1 as const;

export interface ContextBackupDocument {
  schemaVersion: typeof CONTEXT_BACKUP_SCHEMA_VERSION;
  createdAt: string;
  extensionVersion: string;
  reason: "automatic" | "manual" | "pre-restore";
  contexts: BrowserContext[];
  organizationTargetId?: string;
}

export interface ContextBackupMetadata {
  id: string;
  createdAt: string;
  reason?: string;
  contextCount: number;
  windowCount: number;
  tabCount: number;
  desktopWindowCount: number;
  sizeBytes: number;
}

export interface ContextBackupSettings {
  localBackupDirectory: string;
  secondaryBackupDirectory?: string;
}

export interface ContextBackupSaveResult {
  backup: ContextBackupMetadata;
  settings: ContextBackupSettings;
  secondaryCopyWritten: boolean;
  secondaryError?: string;
}

export interface ContextBackupListResult {
  backups: ContextBackupMetadata[];
  settings: ContextBackupSettings;
}
