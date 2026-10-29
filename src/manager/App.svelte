<script lang="ts">
  import { onMount } from "svelte";
  import type {
    BrowserContext,
    ContextWindow,
    TabSnapshot
  } from "../domain/context";
  import type { ManagerRequest, ManagerResponse } from "../domain/messages";

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
  let currentChromeWindowId: number | undefined;

  async function send(request: ManagerRequest): Promise<ManagerResponse> {
    return chrome.runtime.sendMessage(request) as Promise<ManagerResponse>;
  }

  function isCurrentWindow(window: ContextWindow): boolean {
    return (
      currentChromeWindowId !== undefined &&
      window.windowId === currentChromeWindowId
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

  function windowName(context: BrowserContext, window: ContextWindow): string {
    if (context.windows.length === 1) {
      return window.name ?? context.name ?? fallbackWindowName(window);
    }

    return window.name ?? fallbackWindowName(window);
  }

  function contextMatches(context: BrowserContext): boolean {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return true;

    if (contextName(context).toLowerCase().includes(normalized)) return true;

    return context.windows.some((window) => {
      if ((window.name ?? "").toLowerCase().includes(normalized)) return true;

      return window.tabs.some(
        (tab) =>
          tab.title.toLowerCase().includes(normalized) ||
          tab.url.toLowerCase().includes(normalized)
      );
    });
  }

  function matchingTabs(window: ContextWindow): TabSnapshot[] {
    const normalized = query.trim().toLowerCase();

    if (!normalized) {
      return isCurrentWindow(window) ? window.tabs : window.tabs.slice(0, 12);
    }

    const matches = window.tabs.filter(
      (tab) =>
        tab.title.toLowerCase().includes(normalized) ||
        tab.url.toLowerCase().includes(normalized)
    );

    return matches.length > 0 ? matches : window.tabs.slice(0, 12);
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
      toastMessage = `Added "${sourceWindowName}" to ${targetName}.`;
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

  async function switchToContext(contextId: string): Promise<void> {
    closeMenus();
    await run({ type: "contexts:switch", contextId });
  }

  async function shelve(contextId: string): Promise<void> {
    closeMenus();
    await run({ type: "contexts:shelve", contextId });
  }

  $: targetContext = organizationTargetId
    ? contexts.find((context) => context.id === organizationTargetId)
    : undefined;

  $: visibleContexts = contexts.filter(contextMatches);
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

  onMount(() => {
    void (async () => {
      try {
        const currentWindow = await chrome.windows.getCurrent();
        currentChromeWindowId = currentWindow.id;
      } catch {
        currentChromeWindowId = undefined;
      }

      await refresh();
    })();

    const handleChange = () => void refresh();
    const handleDocumentClick = () => closeMenus();

    chrome.tabs.onCreated.addListener(handleChange);
    chrome.tabs.onRemoved.addListener(handleChange);
    chrome.tabs.onUpdated.addListener(handleChange);
    chrome.windows.onCreated.addListener(handleChange);
    chrome.windows.onRemoved.addListener(handleChange);
    chrome.windows.onFocusChanged.addListener(handleChange);
    document.addEventListener("click", handleDocumentClick);

    return () => {
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

<main>
  <header>
    <div>
      <h1>Contexts</h1>
      <p>Group Chrome windows into task contexts.</p>
    </div>
    <button class="icon-button" title="Refresh" aria-label="Refresh" on:click={refresh}>↻</button>
  </header>

  <label class="search">
    <span>⌕</span>
    <input bind:value={query} placeholder="Search contexts and tabs…" />
  </label>

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
                {#each matchingTabs(onlyWindow) as tab}
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
                {#each orderedWindows(context) as contextWindow (contextWindow.id)}
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
                      {#each matchingTabs(contextWindow) as tab}
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

            <footer>
              <span>
                {#if context.windows.length > 1}
                  {context.windows.length} windows · {allTabs(context).length} tabs
                {:else}
                  {allTabs(context).length} {allTabs(context).length === 1 ? "tab" : "tabs"}
                {/if}
              </span>
              <div class="footer-actions">
                <button class="primary" on:click={() => switchToContext(context.id)}>Switch</button>
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

            {#each context.windows as contextWindow (contextWindow.id)}
              {#if context.windows.length > 1}
                <div class="window-heading shelved-window-heading">
                  <div class="window-title">
                    <strong>{windowName(context, contextWindow)}</strong>
                    <span>{contextWindow.tabs.length} {contextWindow.tabs.length === 1 ? "tab" : "tabs"}</span>
                  </div>
                </div>
              {/if}

              <div class="tabs compact-tabs">
                {#each matchingTabs(contextWindow) as tab}
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

            <footer>
              <span>
                {#if context.windows.length > 1}
                  {context.windows.length} windows · {allTabs(context).length} tabs
                {:else}
                  {allTabs(context).length} {allTabs(context).length === 1 ? "tab" : "tabs"}
                {/if}
              </span>
              <div class="footer-actions">
                <button class="secondary" on:click={() => setPinned(context.id, !context.pinned)}>
                  {context.pinned ? "Unpin" : "Pin"}
                </button>
                <button class="secondary danger" on:click={() => removeShelved(context)}>
                  Remove
                </button>
                <button class="primary" on:click={() => run({ type: "contexts:restore", contextId: context.id })}>
                  Restore
                </button>
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
    color-scheme: dark;
    background: #10181b;
  }

  :global(body) {
    margin: 0;
    min-width: 760px;
    min-height: 560px;
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
    min-height: 560px;
    padding: 18px;
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

  .target-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 9px;
    color: #8fa2a7;
    font-size: 11px;
  }

  .target-indicator strong {
    max-width: 260px;
    overflow: hidden;
    color: #cfe3e6;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  section {
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
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .card {
    position: relative;
    min-width: 0;
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
    gap: 9px;
    margin-top: 8px;
  }

  .window-block {
    padding: 8px;
    border: 1px solid #263d44;
    border-radius: 8px;
    background: #142227;
  }

  .window-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .shelved-window-heading {
    margin-top: 9px;
  }

  .window-title {
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 7px;
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
    gap: 5px;
    margin-top: 9px;
  }

  .compact-tabs {
    margin-top: 6px;
  }

  .tab-row {
    display: flex;
    align-items: center;
    min-width: 0;
    border-radius: 6px;
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
    flex: 1;
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

  footer {
    display: flex;
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
    gap: 5px;
  }

  footer button {
    padding: 5px 9px;
  }

  footer button:hover {
    background: #29464d;
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
