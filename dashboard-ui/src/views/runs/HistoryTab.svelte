<script>
  import { app } from '../../lib/stores/state.svelte.js';
  import { api } from '../../lib/api/client.js';
  import { dur, fdate, rateColor } from '../../lib/utils/format.js';
  import FilterBar from '../../components/shared/FilterBar.svelte';
  import TriggerBadge from '../../components/shared/TriggerBadge.svelte';
  import Badge from '../../components/shared/Badge.svelte';
  import RunDetail from './RunDetail.svelte';

  let runs = $state([]);
  let health = $state(null);
  let loading = $state(false);

  const filters = [
    { label: 'All', value: 'all' },
    { label: 'Pass', value: 'pass' },
    { label: 'Fail', value: 'fail' },
  ];

  let filteredRuns = $derived.by(() => {
    let result = runs;
    const status = app.runFilter.status;
    const search = app.runFilter.search;
    if (status !== 'all') {
      result = result.filter(r => {
        const total = r.total || 0;
        const failed = r.failed || 0;
        if (status === 'pass' && (failed > 0 || total === 0)) return false;
        if (status === 'fail' && failed === 0) return false;
        return true;
      });
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(r => {
        const suite = (r.suite_name || 'all').toLowerCase();
        const proj = (r.project_name || '').toLowerCase();
        return suite.includes(q) || proj.includes(q);
      });
    }
    return result;
  });

  let chartBars = $derived.by(() => {
    return runs.slice(0, 40).slice().reverse().map(r => {
      const rate = parseFloat(r.pass_rate) || 0;
      const color = rate >= 90 ? 'bg-success' : rate >= 70 ? 'bg-warning' : 'bg-error';
      return { rate, color, label: (r.project_name || '') + (r.suite_name ? ' / ' + r.suite_name : '') + ': ' + r.pass_rate };
    });
  });

  let healthBanner = $derived.by(() => {
    if (!health || !health.passRate) return null;
    const rc = health.passRate >= 90 ? 'text-success' : health.passRate >= 70 ? 'text-warning' : 'text-error';
    const trendIcon = health.passRateTrend === 'improving' ? '\u25B2' : health.passRateTrend === 'declining' ? '\u25BC' : '=';
    const trendCls = health.passRateTrend === 'improving' ? 'text-success' : health.passRateTrend === 'declining' ? 'text-error' : 'text-base-content/30';
    const delta = health.trendDelta !== 0 ? (health.trendDelta > 0 ? '+' : '') + health.trendDelta + '%' : '';
    return { rc, trendIcon, trendCls, delta };
  });

  function onFilterChange(val) {
    app.runFilter.status = val;
  }

  function onSearchChange(val) {
    app.runFilter.search = val.trim();
  }

  function toggleRun(id) {
    if (app.selectedRun === id) {
      app.selectedRun = null;
    } else {
      app.selectedRun = id;
    }
  }

  function handleKeydown(e) {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    if (e.key === 'j') {
      e.preventDefault();
      if (app.highlightedRunIdx < filteredRuns.length - 1) app.highlightedRunIdx++;
    } else if (e.key === 'k') {
      e.preventDefault();
      if (app.highlightedRunIdx > 0) app.highlightedRunIdx--;
    } else if (e.key === 'Enter' && app.highlightedRunIdx >= 0) {
      e.preventDefault();
      const r = filteredRuns[app.highlightedRunIdx];
      if (r) toggleRun(r.id);
    }
  }

  export function refresh() {
    loading = true;
    app.highlightedRunIdx = -1;

    const healthUrl = app.project ? '/api/db/projects/' + app.project + '/health' : '/api/db/health';
    fetch(healthUrl).then(r => r.json()).then(h => {
      health = h;
    }).catch(() => { health = null; });

    const runsUrl = app.project ? '/api/db/projects/' + app.project + '/runs' : '/api/db/runs';
    api(runsUrl).then(rows => {
      if (Array.isArray(rows)) runs = rows;
      else runs = [];
      loading = false;
    }).catch(() => { runs = []; loading = false; });
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Health Banner -->
{#if healthBanner}
  <div class="stats stats-horizontal bg-base-300 border border-base-content/10 w-full mb-4">
    <div class="stat py-3 px-5">
      <div class="stat-title text-[10px] uppercase tracking-wider">Pass Rate</div>
      <div class="stat-value text-2xl font-mono {healthBanner.rc}">{health.passRate}%</div>
      <div class="stat-desc text-xs {healthBanner.trendCls}">
        {healthBanner.trendIcon} {health.passRateTrend}{healthBanner.delta ? ' (' + healthBanner.delta + ')' : ''}
      </div>
    </div>
    {#if health.flakyCount > 0}
      <div class="stat py-3 px-5">
        <div class="stat-title text-[10px] uppercase tracking-wider">Flaky Tests</div>
        <div class="stat-value text-2xl font-mono text-warning">{health.flakyCount}</div>
      </div>
    {/if}
    {#if health.topErrorPattern}
      {@const pat = (health.topErrorPattern.category || health.topErrorPattern.pattern || 'unknown').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
      <div class="stat py-3 px-5">
        <div class="stat-title text-[10px] uppercase tracking-wider">Top Error ({health.topErrorPattern.count}x)</div>
        <div class="stat-value text-sm font-mono text-error">{pat}</div>
      </div>
    {/if}
  </div>
{/if}

<!-- Trend Chart -->
{#if chartBars.length > 0}
  <div class="flex items-end gap-0.5 h-[60px] px-3 py-2 bg-base-300 border border-base-content/10 rounded-lg mb-4">
    {#each chartBars as bar}
      <div
        class="flex-1 min-w-1 rounded-t-sm transition-all duration-300 {bar.color}"
        style="height:{Math.max(bar.rate, 4)}%"
        title={bar.label}
      ></div>
    {/each}
  </div>
{/if}

<!-- Filters -->
<FilterBar
  {filters}
  activeFilter={app.runFilter.status}
  {onFilterChange}
  searchValue={app.runFilter.search}
  {onSearchChange}
/>

<!-- Runs Table -->
{#if runs.length === 0 && !loading}
  <div class="flex flex-col items-center justify-center py-12 text-base-content/30">
    <div class="text-4xl mb-3">{'\u{1F4CA}'}</div>
    <p class="text-xs">No runs recorded yet. Execute some tests to see history here.</p>
  </div>
{:else}
  <div class="overflow-x-auto bg-base-300 border border-base-content/10 rounded-lg">
    <table class="table table-xs table-zebra w-full">
      <thead>
        <tr class="bg-base-200 border-b border-base-content/10">
          {#if !app.project}<th class="text-[10px] font-semibold text-base-content/40 uppercase tracking-wider">Project</th>{/if}
          <th class="text-[10px] font-semibold text-base-content/40 uppercase tracking-wider">Suite</th>
          <th class="text-[10px] font-semibold text-base-content/40 uppercase tracking-wider">Source</th>
          <th class="text-[10px] font-semibold text-base-content/40 uppercase tracking-wider">Date</th>
          <th class="text-[10px] font-semibold text-base-content/40 uppercase tracking-wider">Total</th>
          <th class="text-[10px] font-semibold text-base-content/40 uppercase tracking-wider">Pass</th>
          <th class="text-[10px] font-semibold text-base-content/40 uppercase tracking-wider">Fail</th>
          <th class="text-[10px] font-semibold text-base-content/40 uppercase tracking-wider">Rate</th>
          <th class="text-[10px] font-semibold text-base-content/40 uppercase tracking-wider">Time</th>
        </tr>
      </thead>
      <tbody>
        {#each filteredRuns as r, idx (r.id)}
          {@const rate = parseFloat(r.pass_rate) || 0}
          {@const isExpanded = app.selectedRun === r.id}
          {@const isHighlighted = app.highlightedRunIdx === idx}
          <tr
            class="cursor-pointer transition-colors duration-100 hover:bg-base-200 {isExpanded ? 'bg-base-200' : ''} {isHighlighted ? 'outline outline-1 outline-primary -outline-offset-1' : ''}"
            onclick={() => toggleRun(r.id)}
          >
            {#if !app.project}
              <td class="font-semibold font-mono text-xs">{r.project_name || '-'}</td>
            {/if}
            <td class="text-primary font-mono text-xs">{r.suite_name || 'all'}</td>
            <td><TriggerBadge source={r.triggered_by || 'cli'} /></td>
            <td class="font-mono text-xs text-base-content/50">{fdate(r.generated_at)}</td>
            <td class="font-mono text-xs">{r.total || 0}</td>
            <td class="font-mono text-xs text-success">{r.passed || 0}</td>
            <td class="font-mono text-xs text-error">{r.failed || 0}</td>
            <td class="font-mono text-xs font-semibold" style="color:{rateColor(rate)}">{r.pass_rate || '-'}</td>
            <td class="font-mono text-xs text-base-content/50">{r.duration || '-'}</td>
          </tr>
          {#if isExpanded}
            <tr>
              <td colspan={app.project ? 8 : 9} class="p-0 border-b border-base-content/10">
                <div class="bg-base-300/50">
                  <RunDetail run={r} />
                </div>
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </div>
{/if}
