<script>
  import { onMount, onDestroy } from 'svelte';
  import { live, app } from '../lib/stores/state.svelte.js';
  import { anyLiveRunning, setRenderLiveCallback } from '../lib/stores/websocket.svelte.js';
  import LiveRunSection from './live/LiveRunSection.svelte';
  import ScreencastPanel from './live/ScreencastPanel.svelte';

  let tick = $state(0);

  function bumpTick() { tick++; }

  onMount(() => {
    setRenderLiveCallback(bumpTick);
  });

  onDestroy(() => {
    setRenderLiveCallback(null);
  });

  let runEntries = $derived.by(() => {
    void tick;
    return Object.entries(live.runs);
  });

  let gTotal = $derived.by(() => {
    void tick;
    let t = 0;
    for (const [, r] of runEntries) t += r.total;
    return t;
  });

  let gCompleted = $derived.by(() => {
    void tick;
    let c = 0;
    for (const [, r] of runEntries) c += r.completed;
    return c;
  });

  let gPassed = $derived.by(() => {
    void tick;
    let p = 0;
    for (const [, r] of runEntries) p += r.passed;
    return p;
  });

  let gFailed = $derived.by(() => {
    void tick;
    let f = 0;
    for (const [, r] of runEntries) f += r.failed;
    return f;
  });

  let gActive = $derived.by(() => {
    void tick;
    let a = 0;
    for (const [, r] of runEntries) a += r.active;
    return a;
  });

  let isRunning = $derived.by(() => {
    void tick;
    return anyLiveRunning();
  });

  let allDone = $derived.by(() => {
    void tick;
    for (const [, r] of runEntries) {
      if (!r.done) return false;
    }
    return runEntries.length > 0;
  });

  let anyStale = $derived.by(() => {
    void tick;
    return runEntries.some(([, r]) => r.stale);
  });

  let hasFinished = $derived.by(() => {
    void tick;
    return runEntries.some(([, r]) => r.done || !r.on);
  });

  let progressPct = $derived(gTotal > 0 ? (gCompleted / gTotal) * 100 : 0);

  let statusLabel = $derived.by(() => {
    if (isRunning || !allDone) return 'RUNNING';
    if (anyStale) return 'COMPLETED (connection lost)';
    if (gFailed > 0) return 'COMPLETED WITH FAILURES';
    return 'ALL TESTS PASSED';
  });

  let statusBadgeClass = $derived.by(() => {
    if (isRunning || !allDone) return 'badge-primary';
    if (anyStale) return 'badge-warning';
    if (gFailed > 0) return 'badge-error';
    return 'badge-success';
  });

  let progressClass = $derived.by(() => {
    if (isRunning || !allDone) return 'progress-primary';
    if (anyStale) return 'progress-warning';
    if (gFailed > 0) return 'progress-error';
    return 'progress-success';
  });

  function clearFinished() {
    for (const k in live.runs) {
      if (live.runs[k].done || !live.runs[k].on) delete live.runs[k];
    }
    tick++;
  }

  function dismissRun(rid) {
    delete live.runs[rid];
    tick++;
  }
</script>

<div class="flex flex-col flex-1 min-h-0 px-6 py-4">
  {#if runEntries.length === 0}
    <div class="flex flex-col items-center justify-center flex-1 gap-2 text-base-content/40">
      <div class="text-4xl opacity-50">&#9889;</div>
      <p class="font-sans text-sm">No live executions. Run a test suite to see real-time progress.</p>
    </div>
  {:else}
    <div class="flex flex-col flex-1 min-h-0 border rounded-lg border-primary bg-base-200 overflow-hidden animate-[fadeSlide_0.3s_ease]">
      <!-- Header -->
      <div class="flex items-center gap-4 px-4 py-3.5 border-b border-base-300 bg-primary/5">
        <div class="flex items-center gap-2">
          {#if isRunning && !allDone}
            <span class="inline-block w-2 h-2 rounded-full bg-primary animate-pulse shrink-0"></span>
          {/if}
          <span class="badge badge-lg font-mono font-semibold text-xs {statusBadgeClass}">{statusLabel}</span>
        </div>

        <div class="stats stats-horizontal bg-transparent border-none shadow-none ml-auto">
          <div class="stat py-0 px-3 gap-0">
            <div class="stat-title font-sans text-[10px]">Total</div>
            <div class="stat-value text-sm font-mono">{gTotal}</div>
          </div>
          <div class="stat py-0 px-3 gap-0">
            <div class="stat-title font-sans text-[10px]">Passed</div>
            <div class="stat-value text-sm font-mono text-success">{gPassed}</div>
          </div>
          <div class="stat py-0 px-3 gap-0">
            <div class="stat-title font-sans text-[10px]">Failed</div>
            <div class="stat-value text-sm font-mono text-error">{gFailed}</div>
          </div>
          <div class="stat py-0 px-3 gap-0">
            <div class="stat-title font-sans text-[10px]">Active</div>
            <div class="stat-value text-sm font-mono text-primary">{gActive}</div>
          </div>
        </div>

        {#if hasFinished}
          <button class="btn btn-sm btn-ghost font-mono text-[10px]" onclick={clearFinished}>Clear finished</button>
        {/if}
      </div>

      <!-- Progress bar -->
      <progress
        class="progress {progressClass} h-[3px] rounded-none w-full"
        value={progressPct}
        max="100"
      ></progress>

      <!-- Content area: tests + optional screencast sidebar -->
      <div class="flex flex-1 min-h-0 overflow-hidden">
        <!-- Test runs -->
        <div class="flex flex-col gap-0.5 flex-1 overflow-y-auto min-h-0 p-3 px-4">
          {#each runEntries as [runId, run] (runId)}
            <LiveRunSection {runId} {run} {tick} onDismiss={dismissRun} />
          {/each}
        </div>

        <!-- Screencast sidebar -->
        {#if app.screencast}
          <div class="w-[340px] shrink-0 border-l border-base-300 p-3 overflow-y-auto">
            <ScreencastPanel {tick} />
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
