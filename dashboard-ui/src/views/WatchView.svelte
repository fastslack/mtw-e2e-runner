<script>
  import { onMount, onDestroy } from 'svelte';
  import { app } from '../lib/stores/state.svelte.js';
  import { api, triggerRun } from '../lib/api/client.js';
  import { dur, fdate, rateColor } from '../lib/utils/format.js';
  import Sparkline from '../components/shared/Sparkline.svelte';
  import TriggerBadge from '../components/shared/TriggerBadge.svelte';

  let projects = $state([]);
  let runs = $state([]);
  let watchInterval = null;
  let countdownInterval = null;

  export function refresh() {
    api('/api/db/projects/overview').then(list => {
      if (Array.isArray(list) && list.length) projects = list;
    }).catch(() => {
      api('/api/db/projects').then(list => {
        if (Array.isArray(list)) projects = list.map(p => ({ ...p, sparkline: [] }));
      }).catch(() => {});
    });

    const runsUrl = app.project ? '/api/db/projects/' + app.project + '/runs' : '/api/db/runs';
    api(runsUrl).then(r => { if (Array.isArray(r)) runs = r; }).catch(() => {});

    fetch('/api/watch/status').then(r => {
      if (!r.ok) throw new Error();
      return r.json();
    }).then(jobs => {
      if (jobs?.length) applyWatchJobData(jobs);
    }).catch(() => {});
  }

  function applyWatchJobData(jobs) {
    jobs.forEach(j => {
      const match = projects.find(p => p.name === j.name || p.cwd === j.cwd);
      if (match && j.nextRunAt) match._nextRunAt = j.nextRunAt;
    });
    startCountdown();
  }

  function startCountdown() {
    if (countdownInterval) return;
    countdownInterval = setInterval(() => { projects = projects; }, 1000);
  }

  function countdownText(nextRunAt) {
    if (!nextRunAt) return '';
    const diff = new Date(nextRunAt) - Date.now();
    if (diff <= 0) return 'Running...';
    const m = Math.floor(diff / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    return m + 'm ' + String(s).padStart(2, '0') + 's';
  }

  export function startPolling() {
    if (watchInterval) return;
    refresh();
    watchInterval = setInterval(refresh, 10000);
  }

  export function stopPolling() {
    if (watchInterval) { clearInterval(watchInterval); watchInterval = null; }
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
  }

  function goToProject(projectId) {
    app.project = projectId;
    app.view = 'runs';
  }

  function rateColorClass(v) {
    return v >= 90 ? 'text-success' : v >= 70 ? 'text-warning' : v == null ? 'text-base-content/30' : 'text-error';
  }

  function dotColorClass(v) {
    return v >= 90 ? 'bg-success shadow-[0_0_6px_oklch(var(--su)/0.5)]'
      : v >= 70 ? 'bg-warning shadow-[0_0_6px_oklch(var(--wa)/0.5)]'
      : v == null ? 'bg-base-content/20'
      : 'bg-error shadow-[0_0_6px_oklch(var(--er)/0.5)]';
  }

  onDestroy(() => stopPolling());
</script>

<div class="w-full p-6" id="view-watch">
  {#if projects.length === 0}
    <div class="flex flex-col items-center justify-center py-24 text-base-content/30">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="opacity-40 mb-4">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 6v6l4 2"/>
      </svg>
      <p class="text-sm font-sans">No projects registered yet. Run some tests to get started.</p>
    </div>
  {:else}
    <!-- Project Cards -->
    <div class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4 mb-8">
      {#each projects as p, idx (p.id)}
        {@const sparkline = p.sparkline || []}
        {@const lastRate = sparkline.length ? sparkline[sparkline.length - 1] : null}
        {@const colorCls = rateColorClass(lastRate)}
        {@const dotCls = dotColorClass(lastRate)}
        <div
          class="card bg-base-200 border border-base-content/6 overflow-hidden"
          style="animation: fadeSlide 0.3s ease {idx * 0.04}s both"
        >
          <div class="card-body gap-0 p-4">
            <!-- Header -->
            <div class="flex items-center justify-between mb-3">
              <div class="font-sans text-[13px] font-semibold text-base-content truncate flex-1 min-w-0">{p.name}</div>
              <div class="flex gap-1 shrink-0 ml-2">
                <button
                  class="btn btn-xs btn-ghost text-base-content/30 hover:text-primary"
                  title="Run all tests"
                  onclick={() => triggerRun(null, p.id)}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                </button>
                <button
                  class="btn btn-xs btn-ghost text-base-content/30 hover:text-primary"
                  title="View runs"
                  onclick={() => goToProject(p.id)}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
                </button>
              </div>
            </div>

            <!-- Sparkline -->
            <div class="h-10 mb-3">
              {#if sparkline.length >= 2}
                <Sparkline data={sparkline} />
              {:else}
                <div class="h-10 flex items-center justify-center text-base-content/20 text-[10px] font-mono">
                  {sparkline.length ? '1 run' : 'No runs yet'}
                </div>
              {/if}
            </div>

            <!-- Rate -->
            <div class="flex items-center justify-between text-xs">
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full shrink-0 {dotCls}"></span>
                <span class="font-semibold font-mono {colorCls}">{lastRate != null ? lastRate + '%' : '\u2014'}</span>
              </div>
              <span class="text-base-content/25 text-[10px] font-mono">{p.runCount ? p.runCount + ' runs' : ''}</span>
            </div>

            <!-- Countdown / Commit -->
            {#if p._nextRunAt || p.lastCommit}
              <div class="flex items-center gap-3 mt-2.5 text-[10px] text-base-content/25">
                {#if p._nextRunAt}
                  <span class="text-primary font-medium font-mono flex items-center gap-1">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                    {countdownText(p._nextRunAt)}
                  </span>
                {/if}
                {#if p.lastCommit}
                  <span class="font-mono truncate">{p.lastCommit.slice(0, 8)}</span>
                {/if}
              </div>
            {/if}
          </div>
        </div>
      {/each}
    </div>

    <!-- Recent Runs Table -->
    <div class="bg-base-200 border border-base-content/6 rounded-xl overflow-hidden">
      <div class="flex items-center justify-between px-5 py-3.5 border-b border-base-content/6">
        <span class="font-sans text-[13px] font-semibold text-base-content/80">Recent Runs</span>
        <span class="text-[10px] font-mono text-base-content/25">{runs.length} total</span>
      </div>
      <div class="max-h-[420px] overflow-y-auto">
        {#if runs.length === 0}
          <div class="p-8 text-center text-base-content/25 text-xs font-sans">No runs recorded yet.</div>
        {:else}
          <table class="table table-xs w-full">
            <thead>
              <tr class="text-[9px] font-semibold text-base-content/30 uppercase tracking-wider bg-base-300/30">
                <th class="font-sans">Time</th>
                <th class="font-sans">Project</th>
                <th class="font-sans">Suite</th>
                <th class="text-center font-sans">Status</th>
                <th class="text-center font-sans">Tests</th>
                <th class="text-right font-sans">Rate</th>
                <th class="text-right font-sans">Duration</th>
                <th class="text-right font-sans">Source</th>
              </tr>
            </thead>
            <tbody>
              {#each runs.slice(0, 30) as r}
                {@const rate = parseFloat(r.pass_rate) || 0}
                <tr
                  class="cursor-pointer hover:bg-base-content/3 transition-colors duration-100"
                  onclick={() => { app.project = r.project_id; app.view = 'runs'; }}
                >
                  <td class="text-base-content/35 tabular-nums font-mono text-[10px]">{fdate(r.generated_at)}</td>
                  <td class="text-base-content/70 font-sans font-medium text-xs">{r.project_name || '\u2014'}</td>
                  <td class="text-primary/80 font-mono text-[10px]">{r.suite_name || 'all'}</td>
                  <td class="text-center">
                    <span class="badge badge-xs {r.failed > 0 ? 'badge-error' : 'badge-success'}">{r.failed > 0 ? 'FAIL' : 'PASS'}</span>
                  </td>
                  <td class="font-mono text-[10px] text-base-content/40 text-center whitespace-nowrap">
                    <span class="text-success/80">{r.passed}</span>/<span class="text-base-content/50">{r.total}</span>
                    {#if r.failed > 0}
                      <span class="text-error/70 ml-1">({r.failed})</span>
                    {/if}
                  </td>
                  <td class="font-semibold tabular-nums text-right font-mono text-[11px]" style="color:{rateColor(rate)}">{rate > 0 ? rate.toFixed(0) + '%' : '\u2014'}</td>
                  <td class="text-base-content/25 font-mono text-[10px] text-right">{r.duration ? dur(r.duration) : '\u2014'}</td>
                  <td class="text-right"><TriggerBadge source={r.triggered_by || 'cli'} /></td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
    </div>
  {/if}
</div>
