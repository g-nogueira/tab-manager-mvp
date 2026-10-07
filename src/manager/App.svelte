<script lang="ts">
  import { onMount } from "svelte";
  import type { BrowserContext, TabSnapshot } from "../domain/context";
  import type { ManagerRequest, ManagerResponse } from "../domain/messages";

  let contexts: BrowserContext[] = [];
  let query = "";
  let loading = true;
  let error = "";
  let editingId: string | undefined;
  let draftName = "";

  async function send(request: ManagerRequest): Promise<ManagerResponse> {
    return chrome.runtime.sendMessage(request) as Promise<ManagerResponse>;
  }

  function sortContexts(items: BrowserContext[]): BrowserContext[] {
    return [...items].sort((a, b) => {
      if (a.state !== b.state) return a.state === "active" ? -1 : 1;
      return (b.lastFocusedAt ?? b.updatedAt) - (a.lastFocusedAt ?? a.updatedAt);
    });
  }

  async function refresh(): Promise<void> {
    try {
      const response = await send({ type: "contexts:list" });
      if (!response.ok) throw new Error(response.error);

      contexts = sortContexts(response.contexts ?? []);
      error = "";
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  async function run(request: ManagerRequest): Promise<void> {
    const response = await send(request);

    if (!response.ok) {
      error = response.error;
      return;
    }

    contexts = sortContexts(response.contexts ?? []);
    error = "";
  }

  function hostname(tab: TabSnapshot): string {
    try {
      const parsed = new URL(tab.url);
      return parsed.hostname.replace(/^www\./, "") || parsed.protocol.replace(":", "");
    } catch {
      return tab.title || "tab";
    }
  }

  function fallbackName(context: BrowserContext): string {
    const hosts = [...new Set(context.tabs.map(hostname).filter(Boolean))];

    if (hosts.length === 0) return "Empty context";
    if (hosts.length <= 3) return hosts.join(", ");

    return `${hosts.slice(0, 3).join(", ")} & ${hosts.length - 3} more`;
  }

  function contextMatches(context: BrowserContext): boolean {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return true;

    if ((context.name ?? "").toLowerCase().includes(normalized)) return true;
    if (fallbackName(context).toLowerCase().includes(normalized)) return true;

    return context.tabs.some(
      (tab) =>
        tab.title.toLowerCase().includes(normalized) ||
        tab.url.toLowerCase().includes(normalized)
    );
  }

  function matchingTabs(context: BrowserContext): TabSnapshot[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return context.tabs.slice(0, 12);

    const matches = context.tabs.filter(
      (tab) =>
        tab.title.toLowerCase().includes(normalized) ||
        tab.url.toLowerCase().includes(normalized)
    );

    return matches.length > 0 ? matches : context.tabs.slice(0, 12);
  }

  function beginEdit(context: BrowserContext): void {
    editingId = context.id;
    draftName = context.name ?? fallbackName(context);

    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(
        `[data-context-name="${context.id}"]`
      );
      input?.focus();
      input?.select();
    });
  }

  async function saveName(contextId: string): Promise<void> {
    await run({ type: "contexts:rename", contextId, name: draftName });
    editingId = undefined;
    draftName = "";
  }

  function cancelEdit(): void {
    editingId = undefined;
    draftName = "";
  }

  $: visibleContexts = contexts.filter(contextMatches);
  $: activeContexts = visibleContexts.filter((context) => context.state === "active");
  $: shelvedContexts = visibleContexts.filter((context) => context.state === "shelved");

  onMount(() => {
    void refresh();

    const handleChange = () => void refresh();

    chrome.tabs.onCreated.addListener(handleChange);
    chrome.tabs.onRemoved.addListener(handleChange);
    chrome.tabs.onUpdated.addListener(handleChange);
    chrome.windows.onCreated.addListener(handleChange);
    chrome.windows.onRemoved.addListener(handleChange);
    chrome.windows.onFocusChanged.addListener(handleChange);

    return () => {
      chrome.tabs.onCreated.removeListener(handleChange);
      chrome.tabs.onRemoved.removeListener(handleChange);
      chrome.tabs.onUpdated.removeListener(handleChange);
      chrome.windows.onCreated.removeListener(handleChange);
      chrome.windows.onRemoved.removeListener(handleChange);
      chrome.windows.onFocusChanged.removeListener(handleChange);
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
      <p>Each Chrome window is one context.</p>
    </div>
    <button class="icon-button" title="Refresh" aria-label="Refresh" on:click={refresh}>↻</button>
  </header>

  <label class="search">
    <span>⌕</span>
    <input bind:value={query} placeholder="Search contexts and tabs…" />
  </label>

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
          <article class="card active-card">
            <div class="card-heading">
              {#if editingId === context.id}
                <div class="edit-row">
                  <input
                    data-context-name={context.id}
                    bind:value={draftName}
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
                  on:dblclick={() => beginEdit(context)}
                  on:click={() => run({ type: "contexts:focus", contextId: context.id })}
                >
                  <strong>{context.name ?? fallbackName(context)}</strong>
                </button>
                <button class="icon-button" title="Rename context" on:click={() => beginEdit(context)}>✎</button>
              {/if}
            </div>

            <div class="tabs">
              {#each matchingTabs(context) as tab}
                <button
                  class="tab"
                  title={tab.title}
                  disabled={tab.tabId === undefined}
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
              {/each}
            </div>

            <footer>
              <span>{context.tabs.length} {context.tabs.length === 1 ? "tab" : "tabs"}</span>
              <button class="secondary" on:click={() => run({ type: "contexts:shelve", contextId: context.id })}>
                Shelve
              </button>
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
        {#each shelvedContexts as context (context.id)}
          <article class="card">
            <div class="card-heading">
              {#if editingId === context.id}
                <div class="edit-row">
                  <input
                    data-context-name={context.id}
                    bind:value={draftName}
                    on:keydown={(event) => {
                      if (event.key === "Enter") void saveName(context.id);
                      if (event.key === "Escape") cancelEdit();
                    }}
                  />
                  <button title="Save name" on:click={() => saveName(context.id)}>✓</button>
                  <button title="Cancel" on:click={cancelEdit}>×</button>
                </div>
              {:else}
                <button class="title-button" on:dblclick={() => beginEdit(context)}>
                  <strong>{context.name ?? fallbackName(context)}</strong>
                </button>
                <button class="icon-button" title="Rename context" on:click={() => beginEdit(context)}>✎</button>
              {/if}
            </div>

            <div class="tabs">
              {#each matchingTabs(context) as tab}
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

            <footer>
              <span>{context.tabs.length} {context.tabs.length === 1 ? "tab" : "tabs"}</span>
              <button class="primary" on:click={() => run({ type: "contexts:restore", contextId: context.id })}>
                Restore
              </button>
            </footer>
          </article>
        {/each}
      </div>

      {#if shelvedContexts.length === 0}
        <div class="empty">No shelved contexts match.</div>
      {/if}
    </section>
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

  .card-heading {
    display: flex;
    align-items: center;
    min-height: 30px;
    gap: 6px;
  }

  .title-button {
    min-width: 0;
    flex: 1;
    padding: 4px 2px;
    overflow: hidden;
    border: 0;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  .title-button strong {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
  }

  .icon-button {
    width: 30px;
    height: 30px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
  }

  .icon-button:hover {
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

  .tabs {
    display: grid;
    gap: 5px;
    margin-top: 9px;
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

  button.tab {
    cursor: pointer;
  }

  button.tab:hover {
    background: #21363c;
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
    margin-top: 10px;
    padding-top: 9px;
    border-top: 1px solid #24383e;
    color: #8fa2a7;
    font-size: 11px;
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

  @media (max-width: 700px) {
    :global(body) {
      min-width: 420px;
    }

    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
