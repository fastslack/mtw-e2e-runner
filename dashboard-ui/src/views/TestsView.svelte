<script>
  import { app } from '../lib/stores/state.svelte.js';
  import { triggerRun } from '../lib/api/client.js';
  import SuitesTab from './tests/SuitesTab.svelte';
  import ModulesTab from './tests/ModulesTab.svelte';
  import VariablesTab from './tests/VariablesTab.svelte';

  const VALID_TABS = ['suites', 'modules', 'variables'];
  let activeTab = $state(VALID_TABS.includes(app._tab) ? app._tab : 'suites');
  let suitesRef = $state(null);
  let modulesRef = $state(null);
  let variablesRef = $state(null);

  // Sync from URL when _tab changes
  $effect(() => {
    if (app.view === 'tests' && app._tab && VALID_TABS.includes(app._tab)) {
      activeTab = app._tab;
    }
  });

  const tabs = [
    { id: 'suites', label: 'Suites' },
    { id: 'modules', label: 'Modules' },
    { id: 'variables', label: 'Variables' },
  ];

  export function refresh() {
    if (activeTab === 'suites' && suitesRef) suitesRef.refresh();
    else if (activeTab === 'modules' && modulesRef) modulesRef.refresh();
    else if (activeTab === 'variables' && variablesRef) variablesRef.refresh();
  }

  function switchTab(id) {
    activeTab = id;
    app._tab = id;
    queueMicrotask(() => {
      if (id === 'suites' && suitesRef) suitesRef.refresh();
      else if (id === 'modules' && modulesRef) modulesRef.refresh();
      else if (id === 'variables' && variablesRef) variablesRef.refresh();
    });
  }

  $effect(() => {
    // Re-fetch when project changes
    const _proj = app.project;
    queueMicrotask(() => {
      if (activeTab === 'suites' && suitesRef) suitesRef.refresh();
      else if (activeTab === 'modules' && modulesRef) modulesRef.refresh();
      else if (activeTab === 'variables' && variablesRef) variablesRef.refresh();
    });
  });
</script>

<div class="w-full p-6" id="view-tests">
  <div class="flex items-center justify-between mb-5">
    <div role="tablist" class="flex gap-1 bg-base-200 border border-base-content/6 rounded-lg p-1">
      {#each tabs as t (t.id)}
        <button
          role="tab"
          class="px-4 py-1.5 rounded-md text-[12px] font-sans font-medium transition-all duration-200
            {activeTab === t.id
              ? 'bg-primary/10 text-primary shadow-sm'
              : 'text-base-content/40 hover:text-base-content/60 hover:bg-base-content/4'}"
          onclick={() => switchTab(t.id)}
        >{t.label}</button>
      {/each}
    </div>
    <div class="flex items-center gap-3">
      <label class="flex items-center gap-2 text-[11px] text-base-content/35 cursor-pointer font-sans hover:text-base-content/50 transition-colors">
        <input type="checkbox" class="checkbox checkbox-xs checkbox-primary" bind:checked={app.screencast} />
        Screencast
      </label>
      <button class="btn btn-sm btn-primary font-sans text-[11px]" onclick={() => triggerRun()}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
        Run All
      </button>
    </div>
  </div>

  <div class="min-h-[200px]">
    {#if activeTab === 'suites'}
      <SuitesTab bind:this={suitesRef} />
    {:else if activeTab === 'modules'}
      <ModulesTab bind:this={modulesRef} />
    {:else if activeTab === 'variables'}
      <VariablesTab bind:this={variablesRef} />
    {/if}
  </div>
</div>
