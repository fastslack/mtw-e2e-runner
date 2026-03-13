<script>
  import { onMount, onDestroy } from 'svelte';
  import { api, triggerRun } from '../../lib/api/client.js';

  let { suiteName, projectId, onclose } = $props();

  let suiteData = $state(null);
  let loading = $state(true);
  let error = $state('');
  let expandedTests = $state(new Set());

  function toggleTest(name) {
    if (expandedTests.has(name)) {
      expandedTests.delete(name);
    } else {
      expandedTests.add(name);
    }
    expandedTests = new Set(expandedTests);
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') onclose();
  }

  function handleBackdrop(e) {
    if (e.target === e.currentTarget) onclose();
  }

  function formatDetail(action) {
    if (action.selector && (action.value || action.text)) {
      return { selector: action.selector, arrow: true, value: action.text || action.value };
    }
    return { text: action.selector || action.value || action.text || '' };
  }

  onMount(() => {
    document.addEventListener('keydown', handleKeydown);
    api('/api/db/projects/' + projectId + '/suites/' + encodeURIComponent(suiteName))
      .then(data => {
        loading = false;
        suiteData = data;
      })
      .catch(() => {
        loading = false;
        error = 'Failed to load suite';
      });
  });

  onDestroy(() => {
    document.removeEventListener('keydown', handleKeydown);
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal modal-open" onclick={handleBackdrop}>
  <div class="modal-box max-w-2xl max-h-[80vh] flex flex-col p-0 bg-base-300">
    <div class="flex items-center justify-between px-5 py-4 border-b border-base-content/10 bg-base-200 shrink-0">
      <div class="min-w-0 flex-1">
        <div class="font-sans text-[15px] font-bold text-base-content truncate">{suiteName}</div>
        <div class="font-mono text-[10px] text-base-content/30 mt-0.5">{suiteName}.json</div>
      </div>
      <div class="flex gap-2 shrink-0 ml-3">
        <button class="btn btn-sm btn-primary" onclick={() => triggerRun(suiteName, projectId)}>Run Suite</button>
        <button class="btn btn-sm btn-ghost" onclick={onclose}>{'\u2715'}</button>
      </div>
    </div>

    <div class="overflow-y-auto flex-1 p-5 pt-3">
      {#if loading}
        <div class="flex items-center justify-center gap-2 py-8 text-base-content/30 text-xs">
          <span class="loading loading-spinner loading-sm"></span>
          <span>Loading...</span>
        </div>
      {:else if error}
        <div class="flex items-center justify-center py-8 text-error text-xs">{error}</div>
      {:else if !suiteData || !suiteData.tests || !suiteData.tests.length}
        <div class="flex items-center justify-center py-8 text-base-content/30 text-xs">No tests found</div>
      {:else}
        {#each suiteData.tests as test (test.name)}
          {@const isOpen = expandedTests.has(test.name)}
          <div class="collapse collapse-arrow border border-base-content/10 hover:border-base-content/20 mb-2 bg-base-300 rounded-lg overflow-hidden transition-colors duration-150">
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="flex items-center gap-2 px-3.5 py-2.5 cursor-pointer hover:bg-base-200 transition-colors duration-100"
              onclick={() => toggleTest(test.name)}
            >
              <span class="text-[9px] text-base-content/30 shrink-0 w-3">{isOpen ? '\u25BC' : '\u25B6'}</span>
              <span class="font-sans text-xs font-semibold text-base-content flex-1 min-w-0 truncate">{test.name}</span>
              {#if test.serial}
                <span class="badge badge-xs badge-warning">Serial</span>
              {/if}
              <span class="badge badge-xs badge-ghost text-[9px]">{(test.actions || []).length} actions</span>
            </div>
            {#if test.expect}
              <div class="px-3.5 py-1.5 pl-9 text-xs text-warning bg-warning/10 border-t border-base-content/10">
                <span class="font-semibold mr-1.5">Expect:</span>
                {Array.isArray(test.expect) ? test.expect.join(', ') : test.expect}
              </div>
            {/if}
            {#if isOpen}
              <div class="border-t border-base-content/10 px-3.5 py-2 pl-9 bg-base-200">
                {#each (test.actions || []) as action, i}
                  {@const detail = formatDetail(action)}
                  <div class="flex items-baseline gap-2 py-1 text-xs">
                    <span class="font-mono text-[9px] text-base-content/30 min-w-[16px] text-right shrink-0">{i + 1}</span>
                    <span class="font-mono text-[10px] font-semibold text-primary min-w-[80px] shrink-0">{action.type}</span>
                    <span class="text-base-content/50 text-[10px] min-w-0 truncate">
                      {#if detail.arrow}
                        <span class="text-base-content font-mono text-[10px]">{detail.selector}</span>
                        <span class="text-base-content/30 mx-1">{'\u2192'}</span>
                        <span class="text-success text-[10px]">{detail.value}</span>
                      {:else}
                        {detail.text}
                      {/if}
                    </span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  </div>
</div>
