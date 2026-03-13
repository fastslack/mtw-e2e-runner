<script>
  import { live, screencast, app } from '../../lib/stores/state.svelte.js';

  let { tick = 0 } = $props();

  // List of currently running test names for the dropdown
  let runningTests = $derived.by(() => {
    void tick;
    const names = [];
    for (const rid in live.runs) {
      const r = live.runs[rid];
      if (!r.tests) continue;
      for (const tName in r.tests) {
        if (tName === '__error') continue;
        const t = r.tests[tName];
        if (t.status === 'running') names.push(tName);
      }
    }
    return names;
  });

  // Auto-select first running test if none selected
  $effect(() => {
    if (!screencast.watching && runningTests.length > 0) {
      screencast.watching = runningTests[0];
    }
  });

  function selectTest(name) {
    screencast.watching = name;
  }

  let hasFrame = $derived(!!screencast.frame);
  let isActive = $derived(app.screencast && app.liveActive);
</script>

{#if isActive || hasFrame}
  <div class="flex flex-col bg-black/90 rounded-lg border border-base-content/10 overflow-hidden animate-[fadeSlide_0.3s_ease]">
    <!-- Header -->
    <div class="flex items-center gap-2 px-3 py-2 bg-base-content/5 border-b border-base-content/10">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5 text-error">
        <circle cx="10" cy="10" r="5" class="{hasFrame && isActive ? 'animate-pulse' : ''}" />
      </svg>
      <span class="font-mono text-[10px] font-semibold text-base-content/70 uppercase tracking-wider">Screencast</span>

      {#if runningTests.length > 1}
        <select
          class="select select-xs bg-transparent border-base-content/10 text-[10px] font-mono ml-auto h-6 min-h-0 leading-none"
          value={screencast.watching || ''}
          onchange={(e) => selectTest(e.target.value)}
        >
          {#each runningTests as t}
            <option value={t}>{t}</option>
          {/each}
        </select>
      {:else if screencast.testName}
        <span class="font-mono text-[10px] text-primary/70 ml-auto truncate max-w-[200px]">{screencast.testName}</span>
      {/if}
    </div>

    <!-- Frame viewport -->
    <div class="relative aspect-[4/3] bg-black flex items-center justify-center min-h-[180px]">
      {#if hasFrame}
        <img
          src="data:image/jpeg;base64,{screencast.frame}"
          alt="Live browser screencast"
          class="w-full h-full object-contain"
        />
      {:else}
        <div class="flex flex-col items-center gap-2 text-base-content/20">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-8 h-8">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          <span class="font-mono text-[10px]">Waiting for frames...</span>
        </div>
      {/if}
    </div>
  </div>
{/if}
