<script lang="ts">
  import { onMount } from "svelte";
  import type {
    ContextBackupDocument,
    ContextBackupListResult,
    ContextBackupMetadata
  } from "../domain/backup";
  import type {
    BrowserContext,
    ContextWindow,
    DesktopWindowReference,
    TabSnapshot
  } from "../domain/context";
  import type {
    DesktopCompanionStatus,
    DesktopWindowCandidate
  } from "../domain/desktop";
  import type { ContextNavigationState } from "../domain/navigation";
  import type { ManagerRequest, ManagerResponse } from "../domain/messages";
  import {
    createDiagnosticRequestId,
    diagnosticError,
    diagnosticInfo,
    diagnosticWarn
  } from "../services/diagnostics";

  let contexts: BrowserContext[] = [];
  let contextOrder: string[] = [];
  let hasInitializedOrder = false;
  let organizationTargetId: string | undefined;
  let canUndoWindowMove = false;
  let query = "";
  let loading = true;
  let error = "";
  let editingId: string | undefined;
  let draftName = "";
  let openContextMenuId: string | undefined;
  let openWindowMenuKey: string | undefined;
  let otherTargetsMenuKey: string | undefined;
  let toastMessage = "";
  let toastUndoKind: "window-move" | "context-remove" | undefined;
  let showAllShelved = false;
  let currentBrowserWindowId: number | undefined;
  let desktopStatus: DesktopCompanionStatus | undefined;
  let desktopPickerContextId: string | undefined;
  let desktopCandidates: DesktopWindowCandidate[] = [];
  let desktopCandidatesLoading = false;
  let desktopCandidatesError = "";
  let backupList: ContextBackupListResult | undefined;
  let latestBackup: ContextBackupMetadata | undefined;
  let backupExpanded = false;
  let backupLoading = false;
  let backupError = "";
  let secondaryBackupDirectory = "";
  let recentSnapshotCount = 20;
  let dailyRetentionDays = 30;
  let weeklyRetentionWeeks = 12;
  let showAllBackups = false;
  let displayedBackups: ContextBackupMetadata[] = [];
  let importBackupInput: HTMLInputElement;
  let contextNavigation: ContextNavigationState = {
    recentContextIds: []
  };
  let quickSwitcherMode = false;
  let quickSelectedIndex = 0;

  async function send(request: ManagerRequest): Promise<ManagerResponse> {
    return chrome.runtime.sendMessage(request) as Promise<ManagerResponse>;
  }

  function isCurrentWindow(window: ContextWindow): boolean {
    return (
      currentBrowserWindowId !== undefined &&
      window.windowId === currentBrowserWindowId
    );
  }

  function contextContainsCurrentWindow(context: BrowserContext): boolean {
    return context.windows.some(isCurrentWindow);
  }

  function orderedWindows(context: BrowserContext): ContextWindow[] {
    return [...context.windows].sort((a, b) => {
      if (isCurrentWindow(a) !== isCurrentWindow(b)) {
        return isCurrentWindow(a) ? -1 : 1;
      }

      if (a.state !== b.state) {
        return a.state === "active" ? -1 : 1;
      }

      return 0;
    });
  }

  function contextIsActive(context: BrowserContext): boolean {
    return context.windows.some(
      (window) => window.state === "active" && window.windowId !== undefined
    );
  }

  function allTabs(context: BrowserContext): TabSnapshot[] {
    return context.windows.flatMap((window) => window.tabs);
  }

  function sortContexts(items: BrowserContext[]): BrowserContext[] {
    return [...items].sort((a, b) => {
      const aActive = contextIsActive(a);
      const bActive = contextIsActive(b);

      if (aActive !== bActive) return aActive ? -1 : 1;
      return (b.lastFocusedAt ?? b.updatedAt) - (a.lastFocusedAt ?? a.updatedAt);
    });
  }

  function applyContexts(items: BrowserContext[]): void {
    if (!hasInitializedOrder) {
      contexts = sortContexts(items);
      contextOrder = contexts.map((context) => context.id);
      hasInitializedOrder = true;
      return;
    }

    const incomingIds = new Set(items.map((context) => context.id));
    const retainedOrder = contextOrder.filter((id) => incomingIds.has(id));
    const retainedIds = new Set(retainedOrder);
    const newIds = sortContexts(items)
      .filter((context) => !retainedIds.has(context.id))
      .map((context) => context.id);

    contextOrder = [...retainedOrder, ...newIds];

    const positions = new Map(
      contextOrder.map((id, index) => [id, index] as const)
    );

    contexts = [...items].sort(
      (a, b) =>
        (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER)
    );
  }

  function applyResponse(response: ManagerResponse): boolean {
    if (!response.ok) {
      error = response.error;
      return false;
    }

    applyContexts(response.contexts ?? []);
    organizationTargetId = response.organizationTargetId;
    canUndoWindowMove = response.canUndoWindowMove ?? false;
    contextNavigation =
      response.contextNavigation ?? contextNavigation;
    error = "";
    return true;
  }

  async function refresh(): Promise<void> {
    try {
      applyResponse(await send({ type: "contexts:list" }));
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  async function run(request: ManagerRequest): Promise<boolean> {
    return applyResponse(await send(request));
  }

  async function refreshDesktopStatus(): Promise<void> {
    const requestId = createDiagnosticRequestId();
    const startedAt = performance.now();

    desktopStatus = undefined;

    diagnosticInfo("popup", "desktop-status:start", {
      requestId
    });

    try {
      let timeoutId:
        | ReturnType<typeof globalThis.setTimeout>
        | undefined;

      const timeout = new Promise<ManagerResponse>((resolve) => {
        timeoutId = globalThis.setTimeout(() => {
          diagnosticWarn("popup", "desktop-status:service-worker-timeout", {
            requestId,
            elapsedMs: Math.round(performance.now() - startedAt)
          });

          resolve({
            ok: false,
            error:
              "Desktop companion status timed out waiting for the extension service worker."
          });
        }, 7000);
      });

      const response = await Promise.race([
        send({ type: "desktop:status", requestId }),
        timeout
      ]);

      if (timeoutId !== undefined) {
        globalThis.clearTimeout(timeoutId);
      }

      diagnosticInfo("popup", "desktop-status:response", {
        requestId,
        ok: response.ok,
        hasDesktopStatus: response.ok
          ? Boolean(response.desktopStatus)
          : false,
        elapsedMs: Math.round(performance.now() - startedAt)
      });

      if (!response.ok) {
        desktopStatus = {
          available: false,
          healthy: false,
          canPrepareDesktopForFocus: false,
          reason: response.error
        };
        return;
      }

      if (!response.desktopStatus) {
        diagnosticWarn("popup", "desktop-status:missing-payload", {
          requestId
        });

        desktopStatus = {
          available: false,
          healthy: false,
          canPrepareDesktopForFocus: false,
          reason:
            "The extension background process did not return companion status. Reload the extension from your browser's extension debugging page."
        };
        return;
      }

      desktopStatus = response.desktopStatus;

      diagnosticInfo("popup", "desktop-status:applied", {
        requestId,
        available: desktopStatus.available,
        healthy: desktopStatus.healthy,
        platform: desktopStatus.platform,
        hostVersion: desktopStatus.hostVersion,
        protocolVersion: desktopStatus.protocolVersion
      });
    } catch (cause) {
      diagnosticError("popup", "desktop-status:failed", cause, {
        requestId,
        elapsedMs: Math.round(performance.now() - startedAt)
      });

      desktopStatus = {
        available: false,
        healthy: false,
        canPrepareDesktopForFocus: false,
        reason: cause instanceof Error ? cause.message : String(cause)
      };
    }
  }

  async function refreshAll(): Promise<void> {
    await Promise.all([refresh(), refreshDesktopStatus()]);

    if (
      desktopStatus?.available &&
      desktopStatus.healthy &&
      desktopStatus.canBackupContexts
    ) {
      await refreshBackupInfo();
    } else {
      backupList = undefined;
    }
  }

  function canBackupContexts(
    status: DesktopCompanionStatus | undefined
  ): boolean {
    return Boolean(
      status?.available &&
        status.healthy &&
        status.canBackupContexts
    );
  }

  function backupTimeLabel(
    backup: ContextBackupMetadata | undefined
  ): string {
    if (!backup) return "No backups yet";

    const value = new Date(backup.createdAt);

    if (Number.isNaN(value.getTime())) {
      return backup.createdAt;
    }

    return value.toLocaleString();
  }

  async function refreshBackupInfo(): Promise<void> {
    if (!canBackupContexts(desktopStatus)) {
      backupList = undefined;
      return;
    }

    backupLoading = true;
    backupError = "";

    try {
      const response = await send({ type: "backup:list" });

      if (!response.ok || !response.backupList) {
        backupError = response.ok
          ? "Native companion did not return backup information."
          : response.error;
        return;
      }

      backupList = response.backupList;
      secondaryBackupDirectory =
        backupList.settings.secondaryBackupDirectory ?? "";
      recentSnapshotCount =
        backupList.settings.recentSnapshotCount ?? 20;
      dailyRetentionDays =
        backupList.settings.dailyRetentionDays ?? 30;
      weeklyRetentionWeeks =
        backupList.settings.weeklyRetentionWeeks ?? 12;
    } catch (cause) {
      backupError =
        cause instanceof Error ? cause.message : String(cause);
    } finally {
      backupLoading = false;
    }
  }

  async function backupNow(): Promise<void> {
    if (!canBackupContexts(desktopStatus)) {
      backupError =
        "Automatic backups require native companion protocol v4.";
      return;
    }

    backupLoading = true;
    backupError = "";

    try {
      const response = await send({ type: "backup:create" });

      if (!response.ok || !response.backupSave) {
        backupError = response.ok
          ? "Native companion did not return the saved backup."
          : response.error;
        return;
      }

      toastMessage =
        response.backupSave.secondaryError
          ? `Backup saved locally. Secondary copy failed: ${response.backupSave.secondaryError}`
          : "Context backup saved.";
      toastUndoKind = undefined;

      await refreshBackupInfo();
    } catch (cause) {
      backupError =
        cause instanceof Error ? cause.message : String(cause);
    } finally {
      backupLoading = false;
    }
  }

  async function saveSecondaryBackupDirectory(): Promise<void> {
    if (!canBackupContexts(desktopStatus)) return;

    backupLoading = true;
    backupError = "";

    try {
      const response = await send({
        type: "backup:set-secondary-directory",
        directory: secondaryBackupDirectory.trim() || undefined
      });

      if (!response.ok || !response.backupSettings) {
        backupError = response.ok
          ? "Native companion did not return backup settings."
          : response.error;
        return;
      }

      secondaryBackupDirectory =
        response.backupSettings.secondaryBackupDirectory ?? "";

      if (backupList) {
        backupList = {
          ...backupList,
          settings: response.backupSettings
        };
      }

      toastMessage = secondaryBackupDirectory
        ? "Secondary backup folder saved."
        : "Secondary backup folder disabled.";
      toastUndoKind = undefined;

      await refreshBackupInfo();
    } catch (cause) {
      backupError =
        cause instanceof Error ? cause.message : String(cause);
    } finally {
      backupLoading = false;
    }
  }

  async function saveBackupRetention(): Promise<void> {
    if (!canBackupContexts(desktopStatus)) return;

    if (
      recentSnapshotCount < 1 ||
      recentSnapshotCount > 500 ||
      dailyRetentionDays < 0 ||
      dailyRetentionDays > 365 ||
      weeklyRetentionWeeks < 0 ||
      weeklyRetentionWeeks > 104
    ) {
      backupError =
        "Retention must be: recent 1–500, daily 0–365 days, weekly 0–104 weeks.";
      return;
    }

    backupLoading = true;
    backupError = "";

    try {
      const response = await send({
        type: "backup:set-retention",
        recentSnapshotCount,
        dailyRetentionDays,
        weeklyRetentionWeeks
      });

      if (!response.ok || !response.backupSettings) {
        backupError = response.ok
          ? "Native companion did not return backup settings."
          : response.error;
        return;
      }

      recentSnapshotCount =
        response.backupSettings.recentSnapshotCount;
      dailyRetentionDays =
        response.backupSettings.dailyRetentionDays;
      weeklyRetentionWeeks =
        response.backupSettings.weeklyRetentionWeeks;

      if (backupList) {
        backupList = {
          ...backupList,
          settings: response.backupSettings
        };
      }

      toastMessage = "Backup retention updated.";
      toastUndoKind = undefined;

      await refreshBackupInfo();
    } catch (cause) {
      backupError =
        cause instanceof Error ? cause.message : String(cause);
    } finally {
      backupLoading = false;
    }
  }

  async function exportBackupFile(): Promise<void> {
    backupError = "";

    try {
      const response = await send({ type: "backup:export" });

      if (!response.ok || !response.backupDocument) {
        backupError = response.ok
          ? "Extension did not return an exportable backup."
          : response.error;
        return;
      }

      const blob = new Blob(
        [JSON.stringify(response.backupDocument, null, 2)],
        { type: "application/json" }
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const stamp = response.backupDocument.createdAt
        .replace(/[:.]/g, "-");

      anchor.href = url;
      anchor.download =
        `context-tab-manager-backup-${stamp}.json`;
      anchor.click();
      URL.revokeObjectURL(url);

      toastMessage = "Portable JSON backup exported.";
      toastUndoKind = undefined;
    } catch (cause) {
      backupError =
        cause instanceof Error ? cause.message : String(cause);
    }
  }

  function chooseImportBackupFile(): void {
    importBackupInput?.click();
  }

  async function importBackupFile(
    event: Event
  ): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];

    input.value = "";

    if (!file) return;

    backupError = "";

    try {
      const parsed = JSON.parse(
        await file.text()
      ) as ContextBackupDocument;

      const contextCount = Array.isArray(parsed.contexts)
        ? parsed.contexts.length
        : 0;

      const confirmed = window.confirm(
        `Import ${contextCount} context${contextCount === 1 ? "" : "s"} from ${file.name}?\n\nCurrent state will be replaced. When the native companion is available, a pre-restore safety snapshot is created first.`
      );

      if (!confirmed) return;

      backupLoading = true;

      const response = await send({
        type: "backup:import",
        backup: parsed
      });

      if (!response.ok) {
        backupError = response.error;
        return;
      }

      applyResponse(response);
      toastMessage =
        `Imported ${contextCount} context${contextCount === 1 ? "" : "s"} from JSON.`;
      toastUndoKind = undefined;

      if (canBackupContexts(desktopStatus)) {
        await refreshBackupInfo();
      }
    } catch (cause) {
      backupError =
        cause instanceof Error ? cause.message : String(cause);
    } finally {
      backupLoading = false;
    }
  }

  async function restoreBackup(
    backup: ContextBackupMetadata
  ): Promise<void> {
    const confirmed = window.confirm(
      `Restore the backup from ${backupTimeLabel(backup)}?\n\nCurrent context state will be backed up first. Restored browser windows will remain shelved until you choose Restore.`
    );

    if (!confirmed) return;

    backupLoading = true;
    backupError = "";

    try {
      const response = await send({
        type: "backup:restore",
        backupId: backup.id
      });

      if (!response.ok) {
        backupError = response.error;
        return;
      }

      applyResponse(response);
      toastMessage =
        `Restored ${backup.contextCount} context${backup.contextCount === 1 ? "" : "s"} from backup.`;
      toastUndoKind = undefined;

      await refreshBackupInfo();
    } catch (cause) {
      backupError =
        cause instanceof Error ? cause.message : String(cause);
    } finally {
      backupLoading = false;
    }
  }

  function companionStatusState(
    status: DesktopCompanionStatus | undefined
  ):
    | "checking"
    | "connected"
    | "unhealthy"
    | "unavailable" {
    if (!status) return "checking";
    if (!status.available) return "unavailable";
    if (!status.healthy) return "unhealthy";
    return "connected";
  }

  function companionStatusLabel(
    status: DesktopCompanionStatus | undefined
  ): string {
    const state = companionStatusState(status);

    if (state === "checking") return "Checking companion…";
    if (state === "unavailable") return "Companion unavailable";
    if (state === "unhealthy") return "Companion unhealthy";

    const details = [
      status?.platform,
      status?.hostVersion ? `v${status.hostVersion}` : undefined
    ].filter(Boolean);

    return details.length > 0
      ? `Companion connected · ${details.join(" · ")}`
      : "Companion connected";
  }

  function companionStatusTitle(
    status: DesktopCompanionStatus | undefined
  ): string {
    if (!status) return "Checking desktop companion…";
    if (!status.available || !status.healthy) {
      return status.reason ?? "Desktop companion is unavailable";
    }

    const protocol = status.protocolVersion
      ? `Protocol v${status.protocolVersion}`
      : "Protocol version unknown";

    return `${companionStatusLabel(status)} · ${protocol}`;
  }

  function canDesktopFocus(
    status: DesktopCompanionStatus | undefined
  ): boolean {
    return Boolean(
      status?.available &&
        status.healthy &&
        status.canPrepareDesktopForFocus
    );
  }

  function desktopFocusTitle(
    status: DesktopCompanionStatus | undefined
  ): string {
    if (canDesktopFocus(status)) {
      return "Minimize other desktop applications and focus this context";
    }

    return (
      status?.reason ??
      "Desktop Focus requires the native companion"
    );
  }

  function hostname(tab: TabSnapshot): string {
    try {
      const parsed = new URL(tab.url);
      return parsed.hostname.replace(/^www\./, "") || parsed.protocol.replace(":", "");
    } catch {
      return tab.title || "tab";
    }
  }

  function fallbackWindowName(window: ContextWindow): string {
    const hosts = [...new Set(window.tabs.map(hostname).filter(Boolean))];

    if (hosts.length === 0) return "Empty window";
    if (hosts.length <= 2) return hosts.join(", ");

    return `${hosts.slice(0, 2).join(", ")} & ${hosts.length - 2} more`;
  }

  function fallbackContextName(context: BrowserContext): string {
    const hosts = [...new Set(allTabs(context).map(hostname).filter(Boolean))];

    if (hosts.length === 0) return "Empty context";
    if (hosts.length <= 3) return hosts.join(", ");

    return `${hosts.slice(0, 3).join(", ")} & ${hosts.length - 3} more`;
  }

  function contextName(context: BrowserContext): string {
    return context.name ?? fallbackContextName(context);
  }

  function quickContextCandidates(): BrowserContext[] {
    const byId = new Map(
      contexts.map((context) => [context.id, context] as const)
    );
    const currentId = contextNavigation.currentContextId;

    const previous = contextNavigation.previousContextId
      ? byId.get(contextNavigation.previousContextId)
      : undefined;

    const recent = contextNavigation.recentContextIds
      .map((id) => byId.get(id))
      .filter((context): context is BrowserContext => Boolean(context));

    const recencyFallback = [...contexts].sort(
      (a, b) =>
        (b.lastFocusedAt ?? b.updatedAt) -
        (a.lastFocusedAt ?? a.updatedAt)
    );

    const recentCandidates = recent.filter(
      (context) =>
        context.id !== currentId &&
        context.id !== previous?.id
    );

    const pinnedMissing = recencyFallback.filter(
      (context) =>
        context.pinned &&
        context.id !== currentId &&
        context.id !== previous?.id &&
        !recentCandidates.some(
          (item) => item.id === context.id
        )
    );

    const combined = [
      previous,
      ...recentCandidates.slice(0, 4),
      ...pinnedMissing,
      ...recentCandidates.slice(4),
      ...recencyFallback
    ].filter(
      (context): context is BrowserContext =>
        context !== undefined &&
        context.id !== currentId
    );

    return combined
      .filter(
        (context, index) =>
          combined.findIndex((item) => item.id === context.id) === index
      )
      .slice(0, 8);
  }

  function windowName(context: BrowserContext, window: ContextWindow): string {
    if (context.windows.length === 1) {
      return window.name ?? context.name ?? fallbackWindowName(window);
    }

    return window.name ?? fallbackWindowName(window);
  }

  function contextNameMatches(
    context: BrowserContext,
    searchTerm: string
  ): boolean {
    return Boolean(
      searchTerm &&
        contextName(context).toLowerCase().includes(searchTerm)
    );
  }

  function windowNameMatches(
    context: BrowserContext,
    window: ContextWindow,
    searchTerm: string
  ): boolean {
    if (!searchTerm) return false;

    const explicitOrFallbackName =
      window.name ?? fallbackWindowName(window);

    return explicitOrFallbackName.toLowerCase().includes(searchTerm);
  }

  function tabMatches(tab: TabSnapshot, searchTerm: string): boolean {
    if (!searchTerm) return true;

    return (
      tab.title.toLowerCase().includes(searchTerm) ||
      tab.url.toLowerCase().includes(searchTerm)
    );
  }

  function desktopWindowMatches(
    window: DesktopWindowReference,
    searchTerm: string
  ): boolean {
    if (!searchTerm) return true;

    return (
      window.displayName.toLowerCase().includes(searchTerm) ||
      window.applicationName.toLowerCase().includes(searchTerm) ||
      window.matcher.processName.toLowerCase().includes(searchTerm) ||
      window.matcher.titleHint.toLowerCase().includes(searchTerm)
    );
  }

  function visibleDesktopWindows(
    context: BrowserContext,
    searchTerm: string
  ): DesktopWindowReference[] {
    if (!searchTerm || contextNameMatches(context, searchTerm)) {
      return context.desktopWindows;
    }

    return context.desktopWindows.filter((window) =>
      desktopWindowMatches(window, searchTerm)
    );
  }

  function candidateAlreadyAdded(
    context: BrowserContext,
    candidate: DesktopWindowCandidate
  ): boolean {
    return context.desktopWindows.some((window) => {
      const leftPath = window.matcher.executablePath?.toLowerCase();
      const rightPath = candidate.matcher.executablePath?.toLowerCase();

      return (
        window.matcher.processName.toLowerCase() ===
          candidate.matcher.processName.toLowerCase() &&
        (leftPath && rightPath ? leftPath === rightPath : true) &&
        window.matcher.titleHint.toLowerCase() ===
          candidate.matcher.titleHint.toLowerCase()
      );
    });
  }

  function contextMatches(
    context: BrowserContext,
    searchTerm: string
  ): boolean {
    if (!searchTerm) return true;

    if (contextNameMatches(context, searchTerm)) return true;

    return (
      context.windows.some(
        (window) =>
          windowNameMatches(context, window, searchTerm) ||
          window.tabs.some((tab) => tabMatches(tab, searchTerm))
      ) ||
      context.desktopWindows.some((window) =>
        desktopWindowMatches(window, searchTerm)
      )
    );
  }

  function visibleWindows(
    context: BrowserContext,
    searchTerm: string
  ): ContextWindow[] {
    const windows = orderedWindows(context);

    if (!searchTerm || contextNameMatches(context, searchTerm)) {
      return windows;
    }

    return windows.filter(
      (window) =>
        windowNameMatches(context, window, searchTerm) ||
        window.tabs.some((tab) => tabMatches(tab, searchTerm))
    );
  }

  function matchingTabs(
    context: BrowserContext,
    window: ContextWindow,
    searchTerm: string
  ): TabSnapshot[] {
    if (!searchTerm) {
      return isCurrentWindow(window) ? window.tabs : window.tabs.slice(0, 12);
    }

    // A context/window-name hit keeps the normal hierarchy visible. A tab-only
    // hit is strict: show only the tabs that actually matched the query.
    if (
      contextNameMatches(context, searchTerm) ||
      windowNameMatches(context, window, searchTerm)
    ) {
      return isCurrentWindow(window) ? window.tabs : window.tabs.slice(0, 12);
    }

    return window.tabs.filter((tab) => tabMatches(tab, searchTerm));
  }

  function beginEdit(context: BrowserContext): void {
    closeMenus();
    editingId = context.id;
    draftName = context.name ?? fallbackContextName(context);

    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(
        `[data-context-name="${context.id}"]`
      );
      input?.focus();
      input?.select();
    });
  }

  async function saveName(contextId: string): Promise<void> {
    if (await run({ type: "contexts:rename", contextId, name: draftName })) {
      editingId = undefined;
      draftName = "";
    }
  }

  function cancelEdit(): void {
    editingId = undefined;
    draftName = "";
  }

  function closeMenus(): void {
    openContextMenuId = undefined;
    openWindowMenuKey = undefined;
    otherTargetsMenuKey = undefined;
  }

  function windowMenuKey(contextId: string, contextWindowId: string): string {
    return `${contextId}:${contextWindowId}`;
  }

  function toggleContextMenu(event: MouseEvent, contextId: string): void {
    event.stopPropagation();
    openWindowMenuKey = undefined;
    otherTargetsMenuKey = undefined;
    openContextMenuId =
      openContextMenuId === contextId ? undefined : contextId;
  }

  function toggleWindowMenu(
    event: MouseEvent,
    contextId: string,
    contextWindowId: string
  ): void {
    event.stopPropagation();
    openContextMenuId = undefined;
    otherTargetsMenuKey = undefined;
    const key = windowMenuKey(contextId, contextWindowId);
    openWindowMenuKey = openWindowMenuKey === key ? undefined : key;
  }

  function eligibleTargets(sourceContextId: string): BrowserContext[] {
    return contexts.filter((context) => context.id !== sourceContextId);
  }

  async function addWindow(
    sourceContext: BrowserContext,
    contextWindow: ContextWindow,
    targetContext: BrowserContext
  ): Promise<void> {
    const sourceWindowName = windowName(sourceContext, contextWindow);
    const targetName = contextName(targetContext);

    closeMenus();

    const success = await run({
      type: "contexts:add-window",
      sourceContextId: sourceContext.id,
      contextWindowId: contextWindow.id,
      targetContextId: targetContext.id
    });

    if (success) {
      const desktopTransferCount =
        sourceContext.windows.length === 1
          ? sourceContext.desktopWindows.length
          : 0;

      toastMessage =
        desktopTransferCount > 0
          ? `Added "${sourceWindowName}" and ${desktopTransferCount} desktop ${desktopTransferCount === 1 ? "window" : "windows"} to ${targetName}.`
          : `Added "${sourceWindowName}" to ${targetName}.`;
      toastUndoKind = "window-move";
    }
  }

  async function createContextFromWindow(
    sourceContext: BrowserContext,
    contextWindow: ContextWindow
  ): Promise<void> {
    const sourceWindowName = windowName(sourceContext, contextWindow);
    closeMenus();

    const success = await run({
      type: "contexts:create-from-window",
      sourceContextId: sourceContext.id,
      contextWindowId: contextWindow.id
    });

    if (success) {
      toastMessage = `Created a new context from "${sourceWindowName}".`;
      toastUndoKind = "window-move";
    }
  }

  async function closeTab(tab: TabSnapshot): Promise<void> {
    if (tab.tabId === undefined) return;

    await run({ type: "tabs:close", tabId: tab.tabId });
  }

  async function undoWindowMove(): Promise<void> {
    if (await run({ type: "contexts:undo-window-move" })) {
      toastMessage = "Move undone.";
      toastUndoKind = undefined;
    }
  }

  async function setPinned(contextId: string, pinned: boolean): Promise<void> {
    await run({ type: "contexts:set-pinned", contextId, pinned });
  }

  async function removeShelved(context: BrowserContext): Promise<void> {
    const name = contextName(context);

    if (await run({ type: "contexts:remove", contextId: context.id })) {
      toastMessage = `Removed "${name}".`;
      toastUndoKind = "context-remove";
    }
  }

  async function undoContextRemoval(): Promise<void> {
    if (await run({ type: "contexts:undo-remove" })) {
      toastMessage = "Removal undone.";
      toastUndoKind = undefined;
    }
  }

  function dismissToast(): void {
    toastMessage = "";
    toastUndoKind = undefined;
  }

  async function openDesktopWindowPicker(
    context: BrowserContext
  ): Promise<void> {
    closeMenus();

    if (
      !desktopStatus?.available ||
      !desktopStatus.healthy ||
      !desktopStatus.canEnumerateDesktopWindows
    ) {
      error =
        desktopStatus?.reason ??
        "Desktop window discovery requires the native companion.";
      return;
    }

    desktopPickerContextId = context.id;
    desktopCandidates = [];
    desktopCandidatesError = "";
    desktopCandidatesLoading = true;

    const requestId = createDiagnosticRequestId();

    diagnosticInfo("popup", "desktop-windows:list-start", {
      requestId,
      contextId: context.id
    });

    try {
      const response = await send({
        type: "desktop:list-windows",
        requestId
      });

      if (!response.ok) {
        desktopCandidatesError = response.error;
        return;
      }

      desktopCandidates = (response.desktopCandidates ?? []).filter(
        (candidate) => !candidateAlreadyAdded(context, candidate)
      );

      diagnosticInfo("popup", "desktop-windows:list-applied", {
        requestId,
        contextId: context.id,
        count: desktopCandidates.length
      });
    } catch (cause) {
      desktopCandidatesError =
        cause instanceof Error ? cause.message : String(cause);
    } finally {
      desktopCandidatesLoading = false;
    }
  }

  function closeDesktopWindowPicker(): void {
    desktopPickerContextId = undefined;
    desktopCandidates = [];
    desktopCandidatesError = "";
    desktopCandidatesLoading = false;
  }

  async function addDesktopWindow(
    context: BrowserContext,
    candidate: DesktopWindowCandidate
  ): Promise<void> {
    const success = await run({
      type: "contexts:add-desktop-window",
      contextId: context.id,
      candidate
    });

    if (!success) return;

    desktopCandidates = desktopCandidates.filter(
      (item) =>
        item.processName !== candidate.processName ||
        item.title !== candidate.title
    );

    toastMessage = `Added ${candidate.applicationName}: ${candidate.title}.`;
    toastUndoKind = undefined;
  }

  async function removeDesktopWindow(
    contextId: string,
    desktopWindowId: string
  ): Promise<void> {
    await run({
      type: "contexts:remove-desktop-window",
      contextId,
      desktopWindowId
    });
  }

  async function quickFocusContext(
    context: BrowserContext
  ): Promise<void> {
    error = "";

    const response = await send({
      type: "contexts:focus",
      contextId: context.id,
      requestId: createDiagnosticRequestId()
    });

    if (!response.ok) {
      error = response.error;
      return;
    }

    applyResponse(response);
    window.close();
  }

  function handleQuickSwitcherKeydown(
    event: KeyboardEvent
  ): void {
    if (!quickSwitcherMode || quickContexts.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      quickSelectedIndex =
        (quickSelectedIndex + 1) % quickContexts.length;
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      quickSelectedIndex =
        (quickSelectedIndex - 1 + quickContexts.length) %
        quickContexts.length;
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const selected = quickContexts[quickSelectedIndex];
      if (selected) void quickFocusContext(selected);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      window.close();
      return;
    }

    if (/^[1-8]$/.test(event.key)) {
      const index = Number(event.key) - 1;
      const selected = quickContexts[index];

      if (selected) {
        event.preventDefault();
        void quickFocusContext(selected);
      }
    }
  }

  async function switchToContext(contextId: string): Promise<void> {
    closeMenus();
    await run({ type: "contexts:switch", contextId });
  }

  async function focusContext(contextId: string): Promise<void> {
    closeMenus();

    if (!canDesktopFocus(desktopStatus)) {
      error = desktopFocusTitle(desktopStatus);
      return;
    }

    const requestId = createDiagnosticRequestId();

    diagnosticInfo("popup", "desktop-focus:start", {
      requestId,
      contextId
    });

    const success = await run({
      type: "contexts:focus",
      contextId,
      requestId
    });

    diagnosticInfo("popup", "desktop-focus:completed", {
      requestId,
      contextId,
      success
    });
  }

  async function shelve(contextId: string): Promise<void> {
    closeMenus();
    await run({ type: "contexts:shelve", contextId });
  }

  $: searchTerm = query.trim().toLowerCase();

  $: targetContext = organizationTargetId
    ? contexts.find((context) => context.id === organizationTargetId)
    : undefined;

  // Pass searchTerm explicitly so Svelte tracks query changes as a dependency.
  $: visibleContexts = contexts.filter((context) =>
    contextMatches(context, searchTerm)
  );
  $: activeContexts = visibleContexts
    .filter(contextIsActive)
    .sort((a, b) => {
      if (contextContainsCurrentWindow(a) !== contextContainsCurrentWindow(b)) {
        return contextContainsCurrentWindow(a) ? -1 : 1;
      }

      return 0;
    });
  $: shelvedContexts = visibleContexts.filter((context) => !contextIsActive(context));
  $: pinnedShelvedContexts = shelvedContexts.filter((context) => context.pinned);
  $: unpinnedShelvedContexts = shelvedContexts.filter((context) => !context.pinned);
  $: displayedShelvedContexts =
    query.trim() || showAllShelved
      ? [...pinnedShelvedContexts, ...unpinnedShelvedContexts]
      : [...pinnedShelvedContexts, ...unpinnedShelvedContexts.slice(0, 6)];
  $: hiddenShelvedCount =
    Math.max(0, unpinnedShelvedContexts.length - 6);
  $: latestBackup = backupList?.backups[0];
  $: displayedBackups =
    backupList?.backups
      ? showAllBackups
        ? backupList.backups
        : backupList.backups.slice(0, 6)
      : [];
  $: quickContexts = quickContextCandidates();
  $: if (
    quickContexts.length > 0 &&
    quickSelectedIndex >= quickContexts.length
  ) {
    quickSelectedIndex = 0;
  }

  onMount(() => {
    void (async () => {
      try {
        const quickState = await chrome.storage.session.get(
          "quickContextSwitcherRequestedAt"
        );
        const requestedAt =
          quickState.quickContextSwitcherRequestedAt;

        quickSwitcherMode =
          typeof requestedAt === "number" &&
          Date.now() - requestedAt < 15000;

        await chrome.storage.session.remove(
          "quickContextSwitcherRequestedAt"
        );
      } catch {
        quickSwitcherMode = false;
      }

      try {
        const currentWindow = await chrome.windows.getCurrent();
        currentBrowserWindowId = currentWindow.id;
      } catch {
        currentBrowserWindowId = undefined;
      }

      await refreshAll();
    })();

    const handleChange = () => void refresh();
    const handleDocumentClick = () => closeMenus();
    const handleStorageChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (
        areaName === "session" &&
        quickSwitcherMode &&
        changes.quickContextSwitcherCycleToken &&
        quickContexts.length > 0
      ) {
        quickSelectedIndex =
          (quickSelectedIndex + 1) % quickContexts.length;
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    chrome.tabs.onCreated.addListener(handleChange);
    chrome.tabs.onRemoved.addListener(handleChange);
    chrome.tabs.onUpdated.addListener(handleChange);
    chrome.windows.onCreated.addListener(handleChange);
    chrome.windows.onRemoved.addListener(handleChange);
    chrome.windows.onFocusChanged.addListener(handleChange);
    document.addEventListener("click", handleDocumentClick);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
      chrome.tabs.onCreated.removeListener(handleChange);
      chrome.tabs.onRemoved.removeListener(handleChange);
      chrome.tabs.onUpdated.removeListener(handleChange);
      chrome.windows.onCreated.removeListener(handleChange);
      chrome.windows.onRemoved.removeListener(handleChange);
      chrome.windows.onFocusChanged.removeListener(handleChange);
      document.removeEventListener("click", handleDocumentClick);
    };
  });
</script>

<svelte:head>
  <title>Context Tab Manager</title>
</svelte:head>

<svelte:window on:keydown={handleQuickSwitcherKeydown} />

<main class:quick-mode={quickSwitcherMode}>
  {#if quickSwitcherMode}
    <section class="quick-switcher">
      <div class="quick-header">
        <div>
          <h1>Switch context</h1>
          <p>Most recently used workspaces</p>
        </div>
        <button
          class="quick-close"
          aria-label="Close"
          title="Close"
          on:click={() => window.close()}
        >×</button>
      </div>

      {#if loading}
        <div class="quick-empty">Loading contexts…</div>
      {:else if quickContexts.length === 0}
        <div class="quick-empty">
          No previous context is available yet.
        </div>
      {:else}
        <div class="quick-list">
          {#each quickContexts as context, index (context.id)}
            <button
              class="quick-context"
              class:selected={index === quickSelectedIndex}
              on:mouseenter={() => (quickSelectedIndex = index)}
              on:click={() => quickFocusContext(context)}
            >
              <span class="quick-number">{index + 1}</span>
              <span class="quick-context-text">
                <strong>{contextName(context)}</strong>
                <small>
                  {contextIsActive(context) ? "Active" : context.pinned ? "Shelved · pinned" : "Shelved"}
                  · {context.windows.length} {context.windows.length === 1 ? "window" : "windows"}
                  {#if context.desktopWindows.length > 0}
                    · {context.desktopWindows.length} desktop
                  {/if}
                </small>
              </span>
            </button>
          {/each}
        </div>
        <div class="quick-help">
          ↑/↓ select · Enter switch · 1–8 direct · Esc close
        </div>
      {/if}

      {#if error}
        <div class="error">{error}</div>
      {/if}
    </section>
  {:else}
  <header>
    <div>
      <h1>Contexts</h1>
      <p>Group browser windows into task contexts.</p>
    </div>
    <button class="icon-button" title="Refresh" aria-label="Refresh" on:click={refreshAll}>↻</button>
  </header>

  <label class="search">
    <span>⌕</span>
    <input bind:value={query} placeholder="Search contexts and tabs…" />
  </label>

  <div class="companion-status">
    <div
      class="companion-indicator"
      class:connected={companionStatusState(desktopStatus) === "connected"}
      class:unhealthy={companionStatusState(desktopStatus) === "unhealthy"}
      class:unavailable={companionStatusState(desktopStatus) === "unavailable"}
      title={companionStatusTitle(desktopStatus)}
    >
      <span class="companion-dot"></span>
      <span>{companionStatusLabel(desktopStatus)}</span>
      {#if companionStatusState(desktopStatus) !== "connected"}
        <button
          class="companion-retry"
          title="Retry companion health check"
          on:click={refreshDesktopStatus}
        >Retry</button>
      {/if}
    </div>

    {#if desktopStatus?.reason && companionStatusState(desktopStatus) !== "connected"}
      <div class="companion-reason" title={desktopStatus.reason}>
        {desktopStatus.reason}
      </div>
    {/if}
  </div>

  <div class="backup-panel">
    <div class="backup-summary">
      <button
        class="backup-toggle"
        title="Context backup and recovery"
        on:click={() => (backupExpanded = !backupExpanded)}
      >
        <span class="backup-dot" class:ready={Boolean(latestBackup)}></span>
        <span>
          {#if !canBackupContexts(desktopStatus)}
            Backups unavailable
          {:else if backupLoading && !backupList}
            Checking backups…
          {:else if latestBackup}
            Backup · {backupTimeLabel(latestBackup)}
          {:else}
            No context backup yet
          {/if}
        </span>
        <span class="backup-chevron">{backupExpanded ? "▴" : "▾"}</span>
      </button>

      <button
        class="backup-now"
        disabled={!canBackupContexts(desktopStatus) || backupLoading}
        title="Save a context backup now"
        on:click={backupNow}
      >
        Backup now
      </button>
    </div>

    {#if backupExpanded}
      <div class="backup-details">
        {#if !canBackupContexts(desktopStatus)}
          <div class="backup-message">
            Update/reinstall the native companion to protocol v4 to enable automatic backups.
          </div>
        {:else}
          {#if backupList}
            <div class="backup-path">
              <span>Local</span>
              <code title={backupList.settings.localBackupDirectory}>
                {backupList.settings.localBackupDirectory}
              </code>
            </div>
          {/if}

          <label class="backup-secondary">
            <span>Secondary/cloud-synced folder</span>
            <div>
              <input
                bind:value={secondaryBackupDirectory}
                placeholder="G:\My Drive\ContextTabManager"
                disabled={backupLoading}
              />
              <button
                disabled={backupLoading}
                on:click={saveSecondaryBackupDirectory}
              >Save</button>
            </div>
          </label>

          <div class="backup-retention">
            <span>Retention</span>
            <div class="backup-retention-grid">
              <label>
                <span>Recent</span>
                <input
                  type="number"
                  min="1"
                  max="500"
                  bind:value={recentSnapshotCount}
                  disabled={backupLoading}
                />
              </label>
              <label>
                <span>Daily days</span>
                <input
                  type="number"
                  min="0"
                  max="365"
                  bind:value={dailyRetentionDays}
                  disabled={backupLoading}
                />
              </label>
              <label>
                <span>Weekly weeks</span>
                <input
                  type="number"
                  min="0"
                  max="104"
                  bind:value={weeklyRetentionWeeks}
                  disabled={backupLoading}
                />
              </label>
              <button
                disabled={backupLoading}
                on:click={saveBackupRetention}
              >Save retention</button>
            </div>
            <small>
              Keeps the newest snapshots, plus one restore point per day and per week.
            </small>
          </div>

          <div class="backup-warning">
            Backup JSON contains context names, tab titles/URLs and desktop-window references. Use a private or encrypted synced folder.
          </div>

          <div class="backup-portable-actions">
            <button
              disabled={backupLoading}
              on:click={exportBackupFile}
            >Export JSON</button>
            <button
              disabled={backupLoading}
              on:click={chooseImportBackupFile}
            >Import JSON</button>
            <input
              class="backup-file-input"
              bind:this={importBackupInput}
              type="file"
              accept="application/json,.json"
              on:change={importBackupFile}
            />
          </div>

          {#if backupError}
            <div class="backup-error">{backupError}</div>
          {/if}

          {#if backupList?.backups.length}
            <div class="backup-history">
              <strong>Restore points</strong>
              {#each displayedBackups as backup (backup.id)}
                <div class="backup-row">
                  <div>
                    <span>{backupTimeLabel(backup)}</span>
                    <small>
                      {backup.browserTarget ?? "browser"} ·
                      {backup.contextCount} contexts ·
                      {backup.windowCount} windows ·
                      {backup.tabCount} tabs
                    </small>
                  </div>
                  <button
                    disabled={backupLoading}
                    on:click={() => restoreBackup(backup)}
                  >Restore</button>
                </div>
              {/each}
            </div>
          {:else if !backupLoading}
            <div class="backup-message">
              No restore points have been created yet.
            </div>
          {/if}
        {/if}
      </div>
    {/if}
  </div>

  {#if targetContext}
    <div class="target-indicator">
      <span>Organizing into</span>
      <strong>{contextName(targetContext)}</strong>
    </div>
  {/if}

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if loading}
    <div class="empty">Loading…</div>
  {:else}
    <section>
      <div class="section-title">
        <span>Active</span>
        <span>{activeContexts.length}</span>
      </div>

      <div class="grid">
        {#each activeContexts as context (context.id)}
          <article
            class="card active-card"
            class:current-context-card={contextContainsCurrentWindow(context)}
          >
            <div class="card-heading">
              {#if editingId === context.id}
                <div class="edit-row">
                  <input
                    data-context-name={context.id}
                    bind:value={draftName}
                    on:click={(event) => event.stopPropagation()}
                    on:keydown={(event) => {
                      if (event.key === "Enter") void saveName(context.id);
                      if (event.key === "Escape") cancelEdit();
                    }}
                  />
                  <button title="Save name" on:click={() => saveName(context.id)}>✓</button>
                  <button title="Cancel" on:click={cancelEdit}>×</button>
                </div>
              {:else}
                <button
                  class="title-button"
                  title="Rename context"
                  on:click={() => beginEdit(context)}
                >
                  <strong>{contextName(context)}</strong>
                </button>
                {#if context.windows.length === 1 && isCurrentWindow(context.windows[0])}
                  <span class="current-window-badge">Current window</span>
                {/if}
                <button class="icon-button" title="Rename context" on:click={() => beginEdit(context)}>✎</button>
                <div class="menu-anchor">
                  <button
                    class="icon-button"
                    title="Context actions"
                    aria-label="Context actions"
                    on:click={(event) => toggleContextMenu(event, context.id)}
                  >⋮</button>

                  {#if openContextMenuId === context.id}
                    <div
                      class="menu"
                      role="menu"
                      tabindex="-1"
                      on:click={(event) => event.stopPropagation()}
                      on:keydown={(event) => event.stopPropagation()}
                    >
                      {#if context.windows.length === 1}
                        {@const onlyWindow = context.windows[0]}
                        {#if targetContext && targetContext.id !== context.id}
                          <button on:click={() => addWindow(context, onlyWindow, targetContext)}>
                            Add to {contextName(targetContext)}
                          </button>
                        {/if}

                        {#if eligibleTargets(context.id).length > 0}
                          <button
                            on:click={() => {
                              const key = windowMenuKey(context.id, onlyWindow.id);
                              otherTargetsMenuKey =
                                otherTargetsMenuKey === key ? undefined : key;
                            }}
                          >
                            Add to another context…
                          </button>

                          {#if otherTargetsMenuKey === windowMenuKey(context.id, onlyWindow.id)}
                            <div class="target-list">
                              {#each eligibleTargets(context.id) as target}
                                <button on:click={() => addWindow(context, onlyWindow, target)}>
                                  {contextName(target)}
                                </button>
                              {/each}
                            </div>
                          {/if}

                          <div class="menu-separator"></div>
                        {/if}
                      {/if}

                      <button on:click={() => switchToContext(context.id)}>Switch to context</button>
                      <button on:click={() => shelve(context.id)}>Shelve</button>
                    </div>
                  {/if}
                </div>
              {/if}
            </div>

            {#if context.windows.length === 1}
              {@const onlyWindow = context.windows[0]}
              <div class="tabs" data-current-window={isCurrentWindow(onlyWindow) || undefined}>
                {#each matchingTabs(context, onlyWindow, searchTerm) as tab}
                  <div class="tab-row">
                    <button
                      class="tab tab-main"
                      title={tab.title}
                      disabled={tab.tabId === undefined || onlyWindow.state !== "active"}
                      on:click={() =>
                        tab.tabId !== undefined &&
                        run({
                          type: "tabs:focus",
                          contextId: context.id,
                          tabId: tab.tabId
                        })}
                    >
                      {#if tab.favIconUrl}
                        <img src={tab.favIconUrl} alt="" />
                      {:else}
                        <span class="fallback-icon">•</span>
                      {/if}
                      <span>{tab.title}</span>
                    </button>
                    <button
                      class="tab-close"
                      title="Close tab"
                      aria-label={`Close ${tab.title}`}
                      disabled={tab.tabId === undefined}
                      on:click={() => closeTab(tab)}
                    >×</button>
                  </div>
                {/each}
              </div>
            {:else}
              <div class="windows">
                {#each visibleWindows(context, searchTerm) as contextWindow (contextWindow.id)}
                  <div
                    class="window-block"
                    class:current-window-block={isCurrentWindow(contextWindow)}
                    data-current-window={isCurrentWindow(contextWindow) || undefined}
                  >
                    <div class="window-heading">
                      <div class="window-title">
                        <strong>{windowName(context, contextWindow)}</strong>
                        <span>{contextWindow.tabs.length} {contextWindow.tabs.length === 1 ? "tab" : "tabs"}</span>
                        {#if isCurrentWindow(contextWindow)}
                          <span class="current-window-badge">Current window</span>
                        {/if}
                        {#if contextWindow.state === "shelved"}
                          <span>closed</span>
                        {/if}
                      </div>

                      <div class="menu-anchor">
                        <button
                          class="small-icon-button"
                          title="Window actions"
                          aria-label="Window actions"
                          on:click={(event) =>
                            toggleWindowMenu(event, context.id, contextWindow.id)}
                        >⋮</button>

                        {#if openWindowMenuKey === windowMenuKey(context.id, contextWindow.id)}
                          <div
                            class="menu window-menu"
                            role="menu"
                            tabindex="-1"
                            on:click={(event) => event.stopPropagation()}
                            on:keydown={(event) => event.stopPropagation()}
                          >
                            <button on:click={() => createContextFromWindow(context, contextWindow)}>
                              Create new context from this window
                            </button>

                            <div class="menu-separator"></div>

                            {#if targetContext && targetContext.id !== context.id}
                              <button on:click={() => addWindow(context, contextWindow, targetContext)}>
                                Add to {contextName(targetContext)}
                              </button>
                            {/if}

                            {#if eligibleTargets(context.id).length > 0}
                              <button
                                on:click={() => {
                                  const key = windowMenuKey(context.id, contextWindow.id);
                                  otherTargetsMenuKey =
                                    otherTargetsMenuKey === key ? undefined : key;
                                }}
                              >
                                Add to another context…
                              </button>

                              {#if otherTargetsMenuKey === windowMenuKey(context.id, contextWindow.id)}
                                <div class="target-list">
                                  {#each eligibleTargets(context.id) as target}
                                    <button on:click={() => addWindow(context, contextWindow, target)}>
                                      {contextName(target)}
                                    </button>
                                  {/each}
                                </div>
                              {/if}
                            {/if}
                          </div>
                        {/if}
                      </div>
                    </div>

                    <div class="tabs compact-tabs">
                      {#each matchingTabs(context, contextWindow, searchTerm) as tab}
                        <div class="tab-row">
                          <button
                            class="tab tab-main"
                            title={tab.title}
                            disabled={tab.tabId === undefined || contextWindow.state !== "active"}
                            on:click={() =>
                              tab.tabId !== undefined &&
                              run({
                                type: "tabs:focus",
                                contextId: context.id,
                                tabId: tab.tabId
                              })}
                          >
                            {#if tab.favIconUrl}
                              <img src={tab.favIconUrl} alt="" />
                            {:else}
                              <span class="fallback-icon">•</span>
                            {/if}
                            <span>{tab.title}</span>
                          </button>
                          <button
                            class="tab-close"
                            title="Close tab"
                            aria-label={`Close ${tab.title}`}
                            disabled={tab.tabId === undefined}
                            on:click={() => closeTab(tab)}
                          >×</button>
                        </div>
                      {/each}
                    </div>
                  </div>
                {/each}
              </div>
            {/if}

            <div class="desktop-members">
              <div class="desktop-members-heading">
                <span>
                  Desktop windows
                  {#if context.desktopWindows.length > 0}
                    <small>{context.desktopWindows.length}</small>
                  {/if}
                </span>
                <button
                  class="desktop-add"
                  title="Add a desktop application window to this context"
                  disabled={
                    !desktopStatus?.available ||
                    !desktopStatus.healthy ||
                    !desktopStatus.canEnumerateDesktopWindows
                  }
                  on:click={() =>
                    desktopPickerContextId === context.id
                      ? closeDesktopWindowPicker()
                      : openDesktopWindowPicker(context)}
                >
                  {desktopPickerContextId === context.id ? "Close" : "+ Add"}
                </button>
              </div>

              {#if visibleDesktopWindows(context, searchTerm).length > 0}
                <div class="desktop-member-list">
                  {#each visibleDesktopWindows(context, searchTerm) as desktopWindow (desktopWindow.id)}
                    <div class="desktop-member">
                      <div class="desktop-member-text">
                        <strong>{desktopWindow.applicationName}</strong>
                        <span title={desktopWindow.displayName}>
                          {desktopWindow.displayName}
                        </span>
                      </div>
                      <button
                        class="desktop-remove"
                        title="Remove desktop window from context"
                        aria-label={`Remove ${desktopWindow.displayName} from context`}
                        on:click={() =>
                          removeDesktopWindow(context.id, desktopWindow.id)}
                      >×</button>
                    </div>
                  {/each}
                </div>
              {/if}

              {#if desktopPickerContextId === context.id}
                <div class="desktop-picker">
                  {#if desktopCandidatesLoading}
                    <div class="desktop-picker-message">Scanning desktop windows…</div>
                  {:else if desktopCandidatesError}
                    <div class="desktop-picker-error">{desktopCandidatesError}</div>
                  {:else if desktopCandidates.length === 0}
                    <div class="desktop-picker-message">
                      No additional eligible desktop windows found.
                    </div>
                  {:else}
                    {#each desktopCandidates as candidate}
                      <button
                        class="desktop-candidate"
                        title={candidate.title}
                        on:click={() => addDesktopWindow(context, candidate)}
                      >
                        <strong>{candidate.applicationName}</strong>
                        <span>{candidate.title}</span>
                      </button>
                    {/each}
                  {/if}
                </div>
              {/if}
            </div>

            <footer>
              <span>
                {#if context.windows.length > 1}
                  {context.windows.length} windows · {allTabs(context).length} tabs
                {:else}
                  {allTabs(context).length} {allTabs(context).length === 1 ? "tab" : "tabs"}
                {/if}
                {#if context.desktopWindows.length > 0}
                  · {context.desktopWindows.length} desktop
                {/if}
              </span>
              <div class="footer-actions">
                <button
                  class="primary"
                  title={desktopFocusTitle(desktopStatus)}
                  disabled={!canDesktopFocus(desktopStatus)}
                  on:click={() => focusContext(context.id)}
                >Focus</button>
                <button class="secondary" on:click={() => switchToContext(context.id)}>Switch</button>
                <button class="secondary" on:click={() => shelve(context.id)}>Shelve</button>
              </div>
            </footer>
          </article>
        {/each}
      </div>

      {#if activeContexts.length === 0}
        <div class="empty">No active contexts match.</div>
      {/if}
    </section>

    <section>
      <div class="section-title">
        <span>Shelved</span>
        <span>{shelvedContexts.length}</span>
      </div>

      <div class="grid">
        {#each displayedShelvedContexts as context (context.id)}
          <article class="card">
            <div class="card-heading">
              {#if editingId === context.id}
                <div class="edit-row">
                  <input
                    data-context-name={context.id}
                    bind:value={draftName}
                    on:click={(event) => event.stopPropagation()}
                    on:keydown={(event) => {
                      if (event.key === "Enter") void saveName(context.id);
                      if (event.key === "Escape") cancelEdit();
                    }}
                  />
                  <button title="Save name" on:click={() => saveName(context.id)}>✓</button>
                  <button title="Cancel" on:click={cancelEdit}>×</button>
                </div>
              {:else}
                <button class="title-button" title="Rename context" on:click={() => beginEdit(context)}>
                  <strong>{contextName(context)}</strong>
                </button>
                {#if context.pinned}
                  <span class="pin-label">Pinned</span>
                {/if}
                <button class="icon-button" title="Rename context" on:click={() => beginEdit(context)}>✎</button>
              {/if}
            </div>

            {#each visibleWindows(context, searchTerm) as contextWindow (contextWindow.id)}
              {#if context.windows.length > 1}
                <div class="window-heading shelved-window-heading">
                  <div class="window-title">
                    <strong>{windowName(context, contextWindow)}</strong>
                    <span>{contextWindow.tabs.length} {contextWindow.tabs.length === 1 ? "tab" : "tabs"}</span>
                  </div>
                </div>
              {/if}

              <div class="tabs compact-tabs">
                {#each matchingTabs(context, contextWindow, searchTerm) as tab}
                  <div class="tab static-tab" title={tab.title}>
                    {#if tab.favIconUrl}
                      <img src={tab.favIconUrl} alt="" />
                    {:else}
                      <span class="fallback-icon">•</span>
                    {/if}
                    <span>{tab.title}</span>
                  </div>
                {/each}
              </div>
            {/each}

            <div class="desktop-members">
              <div class="desktop-members-heading">
                <span>
                  Desktop windows
                  {#if context.desktopWindows.length > 0}
                    <small>{context.desktopWindows.length}</small>
                  {/if}
                </span>
                <button
                  class="desktop-add"
                  title="Add a desktop application window to this context"
                  disabled={
                    !desktopStatus?.available ||
                    !desktopStatus.healthy ||
                    !desktopStatus.canEnumerateDesktopWindows
                  }
                  on:click={() =>
                    desktopPickerContextId === context.id
                      ? closeDesktopWindowPicker()
                      : openDesktopWindowPicker(context)}
                >
                  {desktopPickerContextId === context.id ? "Close" : "+ Add"}
                </button>
              </div>

              {#if visibleDesktopWindows(context, searchTerm).length > 0}
                <div class="desktop-member-list">
                  {#each visibleDesktopWindows(context, searchTerm) as desktopWindow (desktopWindow.id)}
                    <div class="desktop-member">
                      <div class="desktop-member-text">
                        <strong>{desktopWindow.applicationName}</strong>
                        <span title={desktopWindow.displayName}>
                          {desktopWindow.displayName}
                        </span>
                      </div>
                      <button
                        class="desktop-remove"
                        title="Remove desktop window from context"
                        aria-label={`Remove ${desktopWindow.displayName} from context`}
                        on:click={() =>
                          removeDesktopWindow(context.id, desktopWindow.id)}
                      >×</button>
                    </div>
                  {/each}
                </div>
              {/if}

              {#if desktopPickerContextId === context.id}
                <div class="desktop-picker">
                  {#if desktopCandidatesLoading}
                    <div class="desktop-picker-message">Scanning desktop windows…</div>
                  {:else if desktopCandidatesError}
                    <div class="desktop-picker-error">{desktopCandidatesError}</div>
                  {:else if desktopCandidates.length === 0}
                    <div class="desktop-picker-message">
                      No additional eligible desktop windows found.
                    </div>
                  {:else}
                    {#each desktopCandidates as candidate}
                      <button
                        class="desktop-candidate"
                        title={candidate.title}
                        on:click={() => addDesktopWindow(context, candidate)}
                      >
                        <strong>{candidate.applicationName}</strong>
                        <span>{candidate.title}</span>
                      </button>
                    {/each}
                  {/if}
                </div>
              {/if}
            </div>

            <footer>
              <span>
                {#if context.windows.length > 1}
                  {context.windows.length} windows · {allTabs(context).length} tabs
                {:else}
                  {allTabs(context).length} {allTabs(context).length === 1 ? "tab" : "tabs"}
                {/if}
                {#if context.desktopWindows.length > 0}
                  · {context.desktopWindows.length} desktop
                {/if}
              </span>
              <div class="footer-actions">
                <button class="secondary" on:click={() => setPinned(context.id, !context.pinned)}>
                  {context.pinned ? "Unpin" : "Pin"}
                </button>
                <button class="secondary danger" on:click={() => removeShelved(context)}>
                  Remove
                </button>
                <button class="secondary" on:click={() => run({ type: "contexts:restore", contextId: context.id })}>
                  Restore
                </button>
                <button
                  class="primary"
                  title={desktopFocusTitle(desktopStatus)}
                  disabled={!canDesktopFocus(desktopStatus)}
                  on:click={() => focusContext(context.id)}
                >Focus</button>
              </div>
            </footer>
          </article>
        {/each}
      </div>

      {#if !query.trim() && hiddenShelvedCount > 0}
        <button class="shelf-toggle" on:click={() => (showAllShelved = !showAllShelved)}>
          {showAllShelved ? "Show fewer" : `Show older (${hiddenShelvedCount})`}
        </button>
      {/if}

      {#if shelvedContexts.length === 0}
        <div class="empty">No shelved contexts match.</div>
      {/if}
    </section>
  {/if}

  {/if}

  {#if toastMessage}
    <div class="toast">
      <span>{toastMessage}</span>
      {#if toastUndoKind === "context-remove"}
        <button on:click={undoContextRemoval}>Undo</button>
      {:else if toastUndoKind === "window-move" && canUndoWindowMove}
        <button on:click={undoWindowMove}>Undo</button>
      {/if}
      <button class="toast-close" aria-label="Dismiss" on:click={dismissToast}>×</button>
    </div>
  {/if}
</main>

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(html) {
    width: 100%;
    max-width: 100%;
    overflow-x: hidden;
    color-scheme: dark;
    background: #10181b;
  }

  :global(body) {
    width: 420px;
    max-width: 100%;
    margin: 0;
    min-width: 0;
    min-height: 0;
    overflow-x: hidden;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
      sans-serif;
    background: #10181b;
    color: #e7f0f2;
  }

  button,
  input {
    font: inherit;
  }

  button {
    color: inherit;
  }

  main {
    width: 100%;
    min-width: 0;
    max-width: 100%;
    min-height: 560px;
    padding: 18px;
    overflow-x: hidden;
  }

  main.quick-mode {
    min-height: 0;
    padding: 14px;
  }

  .quick-switcher {
    margin: 0;
  }

  .quick-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
  }

  .quick-header h1 {
    margin: 0;
    font-size: 17px;
  }

  .quick-header p {
    margin: 2px 0 0;
    color: #84999e;
    font-size: 10px;
  }

  .quick-close {
    width: 28px;
    height: 28px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: #91a5aa;
    cursor: pointer;
  }

  .quick-close:hover {
    border-color: #39535b;
    background: #21363c;
  }

  .quick-list {
    display: grid;
    gap: 5px;
  }

  .quick-context {
    display: flex;
    width: 100%;
    min-width: 0;
    align-items: center;
    gap: 9px;
    padding: 9px 10px;
    border: 1px solid #263d44;
    border-radius: 8px;
    background: #142227;
    color: #c8d5d8;
    text-align: left;
    cursor: pointer;
  }

  .quick-context:hover,
  .quick-context.selected {
    border-color: #4c9fa6;
    background: #172a30;
  }

  .quick-number {
    display: grid;
    width: 22px;
    height: 22px;
    flex: 0 0 22px;
    place-items: center;
    border: 1px solid #355159;
    border-radius: 6px;
    color: #89bfc4;
    font-size: 10px;
  }

  .quick-context-text {
    display: grid;
    min-width: 0;
    flex: 1;
    gap: 2px;
  }

  .quick-context-text strong,
  .quick-context-text small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .quick-context-text strong {
    font-size: 12px;
  }

  .quick-context-text small {
    color: #7f969b;
    font-size: 9px;
  }

  .quick-help,
  .quick-empty {
    color: #7f9297;
    font-size: 9px;
  }

  .quick-help {
    margin-top: 9px;
    text-align: center;
  }

  .quick-empty {
    padding: 16px 8px;
    border: 1px dashed #30464d;
    border-radius: 7px;
    text-align: center;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 14px;
  }

  h1 {
    margin: 0;
    font-size: 20px;
  }

  header p {
    margin: 3px 0 0;
    color: #93a4aa;
    font-size: 12px;
  }

  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 12px;
    border: 1px solid #47616a;
    border-radius: 8px;
    background: #142126;
  }

  .search:focus-within {
    border-color: #55b9c0;
  }

  .search input {
    width: 100%;
    border: 0;
    outline: 0;
    background: transparent;
    color: #eef9fa;
  }

  .companion-status {
    margin-top: 9px;
  }

  .companion-indicator,
  .target-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #8fa2a7;
    font-size: 11px;
  }

  .target-indicator {
    margin-top: 9px;
  }

  .backup-panel {
    margin-top: 10px;
    border: 1px solid #263d44;
    border-radius: 8px;
    background: #142126;
  }

  .backup-summary {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px;
  }

  .backup-toggle {
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: center;
    gap: 6px;
    padding: 4px 5px;
    overflow: hidden;
    border: 0;
    background: transparent;
    color: #9fb1b5;
    font-size: 10px;
    text-align: left;
    cursor: pointer;
  }

  .backup-toggle > span:nth-child(2) {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .backup-dot {
    width: 7px;
    height: 7px;
    flex: 0 0 7px;
    border-radius: 999px;
    background: #687b80;
  }

  .backup-dot.ready {
    background: #55a88a;
  }

  .backup-chevron {
    flex: 0 0 auto;
    color: #71878c;
  }

  .backup-now,
  .backup-details button {
    border: 1px solid #35515a;
    border-radius: 6px;
    background: #1c3036;
    color: #b8c9cc;
    cursor: pointer;
  }

  .backup-now {
    flex: 0 0 auto;
    padding: 5px 7px;
    font-size: 10px;
  }

  .backup-now:disabled,
  .backup-details button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .backup-details {
    display: grid;
    gap: 9px;
    padding: 9px;
    border-top: 1px solid #263d44;
  }

  .backup-path {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 7px;
    align-items: baseline;
    color: #82979c;
    font-size: 9px;
  }

  .backup-path code {
    min-width: 0;
    overflow: hidden;
    color: #aebfc2;
    font-family: inherit;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .backup-secondary {
    display: grid;
    gap: 5px;
    color: #8fa2a7;
    font-size: 9px;
  }

  .backup-secondary > div {
    display: flex;
    min-width: 0;
    gap: 5px;
  }

  .backup-secondary input {
    min-width: 0;
    flex: 1;
    padding: 6px 7px;
    border: 1px solid #35515a;
    border-radius: 6px;
    outline: 0;
    background: #101b1f;
    color: #dce8ea;
    font-size: 10px;
  }

  .backup-secondary input:focus {
    border-color: #55b9c0;
  }

  .backup-secondary button {
    padding: 5px 8px;
    font-size: 10px;
  }

  .backup-retention {
    display: grid;
    gap: 5px;
    color: #8fa2a7;
    font-size: 9px;
  }

  .backup-retention-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 5px;
  }

  .backup-retention-grid label {
    display: grid;
    min-width: 0;
    gap: 3px;
  }

  .backup-retention-grid input {
    min-width: 0;
    width: 100%;
    padding: 5px 6px;
    border: 1px solid #35515a;
    border-radius: 6px;
    outline: 0;
    background: #101b1f;
    color: #dce8ea;
    font-size: 10px;
  }

  .backup-retention-grid button {
    grid-column: 1 / -1;
    padding: 5px 8px;
    font-size: 9px;
  }

  .backup-retention small {
    color: #71878c;
    font-size: 8px;
    line-height: 1.35;
  }

  .backup-portable-actions {
    display: flex;
    gap: 5px;
  }

  .backup-portable-actions button {
    padding: 5px 8px;
    font-size: 9px;
  }

  .backup-file-input {
    display: none;
  }

  .backup-history {
    display: grid;
    gap: 5px;
  }

  .backup-history > strong {
    color: #91a6aa;
    font-size: 9px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .backup-history-toggle {
    justify-self: center;
    margin-top: 3px;
    padding: 5px 8px;
    font-size: 9px;
  }

  .backup-row {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 7px;
    border: 1px solid #263d44;
    border-radius: 6px;
    background: #101b1f;
  }

  .backup-row > div {
    display: grid;
    min-width: 0;
    gap: 2px;
  }

  .backup-row span,
  .backup-row small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .backup-row span {
    color: #c7d6d9;
    font-size: 10px;
  }

  .backup-row small {
    color: #778d92;
    font-size: 9px;
  }

  .backup-row button {
    flex: 0 0 auto;
    padding: 4px 7px;
    font-size: 9px;
  }

  .backup-message,
  .backup-error,
  .backup-warning {
    color: #83979c;
    font-size: 9px;
    line-height: 1.4;
  }

  .backup-warning {
    color: #a99272;
  }

  .backup-error {
    color: #dfa6a6;
  }

  .companion-indicator {
    width: fit-content;
  }

  .companion-dot {
    width: 7px;
    height: 7px;
    flex: 0 0 7px;
    border-radius: 999px;
    background: #6d7c80;
  }

  .companion-indicator.connected .companion-dot {
    background: #55a88a;
  }

  .companion-indicator.unhealthy .companion-dot {
    background: #b68a55;
  }

  .companion-indicator.unavailable .companion-dot {
    background: #7e8588;
  }

  .companion-retry {
    padding: 0 4px;
    border: 0;
    background: transparent;
    color: #7ed0d6;
    cursor: pointer;
  }

  .companion-reason {
    max-width: 100%;
    margin: 3px 0 0 13px;
    overflow: hidden;
    color: #a98e90;
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .target-indicator strong {
    max-width: 260px;
    overflow: hidden;
    color: #cfe3e6;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  section {
    min-width: 0;
    max-width: 100%;
    margin-top: 18px;
  }

  .section-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    color: #a9b9bd;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .grid {
    display: grid;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
  }

  .card {
    position: relative;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    padding: 12px;
    border: 1px solid #24383e;
    border-radius: 10px;
    background: #18272c;
    box-shadow: 0 4px 16px rgb(0 0 0 / 14%);
  }

  .active-card {
    border-top-color: #337f86;
  }

  .current-context-card {
    border-color: #4c9fa6;
    box-shadow:
      0 0 0 1px rgb(76 159 166 / 20%),
      0 4px 16px rgb(0 0 0 / 14%);
  }

  .current-window-block {
    border-color: #4c9fa6;
    background: #172a30;
  }

  .current-window-badge {
    flex: 0 0 auto;
    padding: 2px 5px;
    border: 1px solid #4c8389;
    border-radius: 999px;
    color: #a9e0e4;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.03em;
    white-space: nowrap;
  }

  .card-heading {
    display: flex;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    align-items: center;
    min-height: 30px;
    gap: 3px;
  }

  .title-button {
    min-width: 0;
    flex: 1;
    padding: 4px 2px;
    overflow: hidden;
    border: 0;
    border-radius: 5px;
    background: transparent;
    text-align: left;
    cursor: text;
  }

  .title-button:hover {
    background: #1d3036;
  }

  .title-button strong {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
  }

  .icon-button,
  .small-icon-button {
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
  }

  .icon-button {
    width: 30px;
    height: 30px;
  }

  .small-icon-button {
    width: 26px;
    height: 26px;
  }

  .icon-button:hover,
  .small-icon-button:hover {
    border-color: #39535b;
    background: #21363c;
  }

  .edit-row {
    display: flex;
    width: 100%;
    gap: 5px;
  }

  .edit-row input {
    min-width: 0;
    flex: 1;
    padding: 6px 8px;
    border: 1px solid #4fa0a7;
    border-radius: 6px;
    outline: 0;
    background: #101b1f;
    color: #f3fbfc;
  }

  .edit-row button,
  footer button {
    border: 1px solid #3b565e;
    border-radius: 6px;
    background: #21363c;
    cursor: pointer;
  }

  .menu-anchor {
    position: relative;
    flex: 0 0 auto;
  }

  .menu {
    position: absolute;
    z-index: 20;
    top: 32px;
    right: 0;
    width: 215px;
    padding: 5px;
    border: 1px solid #3a5259;
    border-radius: 8px;
    background: #101b1f;
    box-shadow: 0 10px 26px rgb(0 0 0 / 38%);
  }

  .window-menu {
    top: 28px;
  }

  .menu button,
  .target-list button {
    display: block;
    width: 100%;
    padding: 7px 8px;
    overflow: hidden;
    border: 0;
    border-radius: 5px;
    background: transparent;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }

  .menu button:hover,
  .target-list button:hover {
    background: #21363c;
  }

  .menu-separator {
    height: 1px;
    margin: 4px 3px;
    background: #2a4148;
  }

  .target-list {
    max-height: 150px;
    margin: 2px 0 4px 8px;
    padding-left: 5px;
    overflow-y: auto;
    border-left: 1px solid #345059;
  }

  .windows {
    display: grid;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    grid-template-columns: minmax(0, 1fr);
    gap: 9px;
    margin-top: 8px;
  }

  .window-block {
    position: relative;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    padding: 8px;
    border: 1px solid #263d44;
    border-radius: 8px;
    background: #142227;
  }

  .window-heading {
    display: flex;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .shelved-window-heading {
    margin-top: 9px;
  }

  .window-title {
    display: flex;
    min-width: 0;
    max-width: 100%;
    flex: 1;
    align-items: baseline;
    gap: 7px;
    overflow: hidden;
  }

  .window-title strong {
    min-width: 0;
    overflow: hidden;
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .window-title span {
    flex: 0 0 auto;
    color: #81959a;
    font-size: 10px;
  }

  .tabs {
    display: grid;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    grid-template-columns: minmax(0, 1fr);
    gap: 5px;
    margin-top: 9px;
  }

  .compact-tabs {
    margin-top: 6px;
  }

  .tab-row {
    display: flex;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    align-items: center;
    border-radius: 6px;
    overflow: hidden;
  }

  .tab-row:hover,
  .tab-row:focus-within {
    background: #21363c;
  }

  .tab {
    display: flex;
    align-items: center;
    width: 100%;
    min-width: 0;
    gap: 7px;
    padding: 5px 7px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: #c8d5d8;
    text-align: left;
  }

  .tab-main {
    min-width: 0;
    flex: 1 1 auto;
  }

  .tab-close {
    width: 27px;
    height: 27px;
    flex: 0 0 27px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: #91a5aa;
    opacity: 0;
    cursor: pointer;
  }

  .tab-row:hover .tab-close,
  .tab-row:focus-within .tab-close {
    opacity: 1;
  }

  .tab-close:hover:not(:disabled) {
    background: #314950;
    color: #f2fbfc;
  }

  .tab-close:disabled {
    cursor: default;
  }

  button.tab {
    cursor: pointer;
  }

  button.tab:hover:not(:disabled) {
    background: transparent;
  }

  button.tab:disabled {
    opacity: 0.68;
    cursor: default;
  }

  .tab img {
    width: 16px;
    height: 16px;
    flex: 0 0 16px;
  }

  .tab span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
  }

  .fallback-icon {
    display: grid;
    width: 16px;
    height: 16px;
    flex: 0 0 16px;
    place-items: center;
    border: 1px solid #4c646a;
    border-radius: 4px;
  }

  .desktop-members {
    width: 100%;
    min-width: 0;
    max-width: 100%;
    margin-top: 10px;
    padding-top: 9px;
    border-top: 1px solid #24383e;
  }

  .desktop-members-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    color: #91a6aa;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .desktop-members-heading span {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .desktop-members-heading small {
    color: #71878c;
    font-size: 9px;
    font-weight: 600;
  }

  .desktop-add,
  .desktop-remove {
    border: 0;
    background: transparent;
    color: #7ed0d6;
    cursor: pointer;
  }

  .desktop-add {
    padding: 3px 5px;
    font-size: 10px;
    text-transform: none;
  }

  .desktop-add:disabled {
    color: #687b80;
    cursor: default;
  }

  .desktop-member-list {
    display: grid;
    gap: 4px;
    margin-top: 6px;
  }

  .desktop-member {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 5px 7px;
    border: 1px solid #263d44;
    border-radius: 6px;
    background: #142227;
  }

  .desktop-member-text {
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: baseline;
    gap: 7px;
  }

  .desktop-member-text strong {
    flex: 0 0 auto;
    font-size: 10px;
  }

  .desktop-member-text span {
    min-width: 0;
    overflow: hidden;
    color: #91a4a9;
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .desktop-remove {
    width: 22px;
    height: 22px;
    flex: 0 0 22px;
    border-radius: 4px;
    color: #879b9f;
  }

  .desktop-remove:hover {
    background: #2a4148;
    color: #f0b8b8;
  }

  .desktop-picker {
    display: grid;
    gap: 4px;
    max-height: 190px;
    margin-top: 7px;
    padding: 5px;
    overflow-y: auto;
    border: 1px solid #365159;
    border-radius: 7px;
    background: #101b1f;
  }

  .desktop-candidate {
    display: flex;
    min-width: 0;
    align-items: baseline;
    gap: 7px;
    padding: 6px 7px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: #c8d5d8;
    text-align: left;
    cursor: pointer;
  }

  .desktop-candidate:hover {
    background: #21363c;
  }

  .desktop-candidate strong {
    flex: 0 0 auto;
    font-size: 10px;
  }

  .desktop-candidate span {
    min-width: 0;
    overflow: hidden;
    color: #91a4a9;
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .desktop-picker-message,
  .desktop-picker-error {
    padding: 7px;
    color: #87999d;
    font-size: 10px;
  }

  .desktop-picker-error {
    color: #e0a5a5;
  }

  footer {
    display: flex;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 10px;
    padding-top: 9px;
    border-top: 1px solid #24383e;
    color: #8fa2a7;
    font-size: 11px;
  }

  .footer-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-left: auto;
  }

  footer button {
    padding: 5px 9px;
  }

  footer button:hover:not(:disabled) {
    background: #29464d;
  }

  footer button:disabled {
    opacity: 0.48;
    cursor: not-allowed;
  }

  .primary {
    border-color: #348c93;
  }

  .danger {
    border-color: #704447;
  }

  .pin-label {
    flex: 0 0 auto;
    padding: 2px 5px;
    border: 1px solid #425c63;
    border-radius: 999px;
    color: #a9c0c4;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .shelf-toggle {
    display: block;
    margin: 10px auto 0;
    padding: 6px 10px;
    border: 1px solid #30464d;
    border-radius: 6px;
    background: transparent;
    color: #9fb1b5;
    cursor: pointer;
  }

  .shelf-toggle:hover {
    background: #1d3036;
  }

  .error,
  .empty {
    margin-top: 12px;
    padding: 10px;
    border-radius: 7px;
    color: #aab9bd;
    font-size: 12px;
  }

  .error {
    border: 1px solid #844a4a;
    background: #321f20;
    color: #f0b9b9;
  }

  .empty {
    border: 1px dashed #30464d;
    text-align: center;
  }

  .toast {
    position: sticky;
    z-index: 30;
    bottom: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 12px auto 0;
    padding: 9px 10px;
    border: 1px solid #3b565e;
    border-radius: 8px;
    background: #101b1f;
    box-shadow: 0 8px 24px rgb(0 0 0 / 32%);
    color: #cbdadd;
    font-size: 11px;
  }

  .toast span {
    min-width: 0;
    flex: 1;
  }

  .toast button {
    border: 0;
    background: transparent;
    color: #7ed0d6;
    cursor: pointer;
  }

  .toast-close {
    color: #9aabad !important;
  }

  @media (max-width: 700px) {
    :global(body) {
      min-width: 420px;
    }

    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
