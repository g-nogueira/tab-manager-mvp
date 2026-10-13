import type { WindowBinding } from "../domain/context";
import type { ManagerRequest, ManagerResponse } from "../domain/messages";
import {
  handleTabContextMenuClick,
  rebuildTabContextMenus
} from "../services/tab-context-menu";
import {
  loadBindings,
  loadContexts,
  loadOrganizationTargetId,
  loadUndoWindowMove,
  saveOrganizationTargetId
} from "../services/context-store";
import {
  addWindowToContext,
  ensureBootstrapped,
  focusTab,
  inheritDetachedTabWindow,
  markWindowShelved,
  reconcileAllWindows,
  renameContext,
  restoreContext,
  shelveContext,
  switchContext,
  syncWindow,
  undoLastWindowMove
} from "../services/window-reconciler";

interface PendingDetachedTab {
  sourceBinding: WindowBinding;
  oldWindowId: number;
  sourceWindowHadRemainingTabs: boolean;
}

const pendingDetachedTabs = new Map<number, PendingDetachedTab>();

let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function sync(windowId?: number, touchedFocus = false): void {
  if (windowId === undefined) return;
  void enqueue(() => syncWindow(windowId, { touchedFocus }));
}

async function managerState(): Promise<ManagerResponse> {
  const contexts = await loadContexts();
  let organizationTargetId = await loadOrganizationTargetId();

  if (
    organizationTargetId &&
    !contexts.some((context) => context.id === organizationTargetId)
  ) {
    organizationTargetId = undefined;
    await saveOrganizationTargetId(undefined);
  }

  return {
    ok: true,
    contexts,
    organizationTargetId,
    canUndoWindowMove: Boolean(await loadUndoWindowMove())
  };
}

chrome.runtime.onInstalled.addListener(() => {
  void enqueue(async () => {
    await reconcileAllWindows();
    await rebuildTabContextMenus();
  });
});

chrome.runtime.onStartup.addListener(() => {
  setTimeout(() => {
    void enqueue(async () => {
      await reconcileAllWindows();
      await rebuildTabContextMenus();
    });
  }, 1000);
});

chrome.windows.onCreated.addListener((window) => {
  if (window.type !== "normal" || window.id === undefined) return;

  setTimeout(() => {
    void enqueue(async () => {
      await syncWindow(window.id!);
      await rebuildTabContextMenus();
    });
  }, 150);
});

chrome.windows.onRemoved.addListener((windowId) => {
  void enqueue(() => markWindowShelved(windowId));
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;

  void enqueue(async () => {
    await syncWindow(windowId, { touchedFocus: true });
    await rebuildTabContextMenus(windowId);
  });
});

chrome.windows.onBoundsChanged.addListener((window) => {
  if (window.id === undefined || window.type !== "normal") return;
  sync(window.id);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void enqueue(async () => {
    try {
      await handleTabContextMenuClick(info.menuItemId, tab);
    } catch (error) {
      console.error("Context menu action failed", error);
    }
  });
});

chrome.tabs.onCreated.addListener((tab) => sync(tab.windowId));
chrome.tabs.onUpdated.addListener((_tabId, _changeInfo, tab) => sync(tab.windowId));
chrome.tabs.onRemoved.addListener((_tabId, removeInfo) => sync(removeInfo.windowId));
chrome.tabs.onMoved.addListener((_tabId, moveInfo) => sync(moveInfo.windowId));

chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
  void enqueue(async () => {
    const bindings = await loadBindings();
    const sourceBinding = bindings[String(detachInfo.oldWindowId)];

    if (!sourceBinding) {
      await syncWindow(detachInfo.oldWindowId);
      return;
    }

    let sourceWindowHadRemainingTabs = false;

    try {
      const remainingTabs = await chrome.tabs.query({
        windowId: detachInfo.oldWindowId
      });
      sourceWindowHadRemainingTabs = remainingTabs.length > 0;
    } catch {
      sourceWindowHadRemainingTabs = false;
    }

    pendingDetachedTabs.set(tabId, {
      sourceBinding,
      oldWindowId: detachInfo.oldWindowId,
      sourceWindowHadRemainingTabs
    });

    if (sourceWindowHadRemainingTabs) {
      await syncWindow(detachInfo.oldWindowId);
    }
  });
});

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
  void enqueue(async () => {
    const pending = pendingDetachedTabs.get(tabId);
    pendingDetachedTabs.delete(tabId);

    let destinationTabs: chrome.tabs.Tab[] = [];

    try {
      destinationTabs = await chrome.tabs.query({
        windowId: attachInfo.newWindowId
      });
    } catch {
      return;
    }

    const becameNewWindow =
      destinationTabs.length === 1 && destinationTabs[0]?.id === tabId;

    if (!pending || !becameNewWindow) {
      await syncWindow(attachInfo.newWindowId);
      return;
    }

    await inheritDetachedTabWindow(
      pending.oldWindowId,
      pending.sourceBinding.contextId,
      pending.sourceBinding.contextWindowId,
      attachInfo.newWindowId,
      pending.sourceWindowHadRemainingTabs
    );

    await rebuildTabContextMenus(attachInfo.newWindowId);
  });
});

chrome.tabs.onActivated.addListener((activeInfo) => sync(activeInfo.windowId));

chrome.runtime.onMessage.addListener(
  (
    request: ManagerRequest,
    _sender,
    sendResponse: (response: ManagerResponse) => void
  ) => {
    void enqueue(async () => {
      try {
        await ensureBootstrapped();

        switch (request.type) {
          case "contexts:list":
            return managerState();

          case "contexts:rename":
            await renameContext(request.contextId, request.name);
            break;

          case "contexts:switch":
            await switchContext(request.contextId);
            break;

          case "contexts:shelve":
            await shelveContext(request.contextId);
            break;

          case "contexts:restore":
            await restoreContext(request.contextId);
            break;

          case "contexts:add-window":
            await addWindowToContext(
              request.sourceContextId,
              request.contextWindowId,
              request.targetContextId
            );
            break;

          case "contexts:undo-window-move":
            await undoLastWindowMove();
            break;

          case "tabs:focus":
            await focusTab(request.contextId, request.tabId);
            break;
        }

        await rebuildTabContextMenus();
        return managerState();
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        } satisfies ManagerResponse;
      }
    }).then(sendResponse);

    return true;
  }
);
