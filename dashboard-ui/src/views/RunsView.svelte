<script>
  import { app } from '../lib/stores/state.svelte.js';
  import HistoryTab from './runs/HistoryTab.svelte';
  import ScreenshotsTab from './runs/ScreenshotsTab.svelte';

  const VALID_TABS = ['history', 'screenshots'];
  let activeTab = $state(VALID_TABS.includes(app._tab) ? app._tab : 'history');
  let historyTab;
  let screenshotsTab;

  // Sync from URL when _tab changes (e.g. browser back/forward)
  $effect(() => {
    if (app.view === 'runs' && app._tab && VALID_TABS.includes(app._tab)) {
      activeTab = app._tab;
    }
  });

  const tabs = [
    { id: 'history', label: 'History' },
    { id: 'screenshots', label: 'Screenshots' },
  ];

  function onTabChange(id) {
    activeTab = id;
    app._tab = id;
    if (id === 'history') historyTab?.refresh();
    if (id === 'screenshots') screenshotsTab?.refresh();
  }

  export function refresh() {
    if (activeTab === 'history') historyTab?.refresh();
    else if (activeTab === 'screenshots') screenshotsTab?.refresh();
  }
</script>

<div class="w-full p-6">
  <div class="flex items-center justify-between mb-5">
    <div class="font-sans text-[13px] font-semibold text-base-content/70">Runs</div>
    <div role="tablist" class="flex gap-1 bg-base-200 border border-base-content/6 rounded-lg p-1">
      {#each tabs as t (t.id)}
        <button
          role="tab"
          class="px-4 py-1.5 rounded-md text-[12px] font-sans font-medium transition-all duration-200
            {activeTab === t.id
              ? 'bg-primary/10 text-primary shadow-sm'
              : 'text-base-content/40 hover:text-base-content/60 hover:bg-base-content/4'}"
          onclick={() => onTabChange(t.id)}
        >{t.label}</button>
      {/each}
    </div>
  </div>

  <div>
    {#if activeTab === 'history'}
      <HistoryTab bind:this={historyTab} />
    {:else if activeTab === 'screenshots'}
      <ScreenshotsTab bind:this={screenshotsTab} />
    {/if}
  </div>
</div>
