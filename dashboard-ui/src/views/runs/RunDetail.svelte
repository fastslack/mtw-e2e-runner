<script>
  import { api } from '../../lib/api/client.js';
  import { dur } from '../../lib/utils/format.js';
  import { downloadFile } from '../../lib/utils/download.js';
  import TriggerBadge from '../../components/shared/TriggerBadge.svelte';
  import PoolDistribution from '../../components/shared/PoolDistribution.svelte';
  import RunTestResult from './RunTestResult.svelte';

  let { run } = $props();

  let detail = $state(null);
  let insights = $state(null);
  let loading = $state(true);
  let error = $state(false);

  let results = $derived(detail?.results || []);

  let poolDist = $derived.by(() => {
    if (!results.length) return {};
    const counts = {};
    results.forEach(r => {
      if (!r.poolUrl) return;
      const key = r.poolUrl.replace('ws://', '').replace('wss://', '');
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.keys(counts).length > 1 ? counts : {};
  });

  let healthInfo = $derived.by(() => {
    const h = insights?.health;
    if (!h) return null;
    const rc = h.passRate >= 90 ? 'text-success' : h.passRate >= 70 ? 'text-warning' : 'text-error';
    const trendIcon = h.passRateTrend === 'improving' ? '\u25B2' : h.passRateTrend === 'declining' ? '\u25BC' : '=';
    const trendCls = h.passRateTrend === 'improving' ? 'text-success' : h.passRateTrend === 'declining' ? 'text-error' : '';
    return { rc, trendIcon, trendCls, h };
  });

  let insightItems = $derived(insights?.insights || []);

  function exportJson(e) {
    e.stopPropagation();
    if (!detail) return;
    downloadFile('run-' + run.id + '.json', JSON.stringify(detail, null, 2), 'application/json');
  }

  $effect(() => {
    if (run?.id) {
      loading = true;
      error = false;
      api('/api/db/runs/' + run.id).then(d => {
        if (d.error) { error = true; loading = false; return; }
        detail = d;
        loading = false;
      }).catch(() => { error = true; loading = false; });

      fetch('/api/db/runs/' + run.id + '/insights').then(r => r.json()).then(ins => {
        if (!ins || ins.error) { insights = null; return; }
        insights = ins;
      }).catch(() => { insights = null; });
    }
  });
</script>

<div class="p-4">
  {#if loading}
    <div class="flex items-center gap-2 p-3 text-base-content/30 text-xs">
      <span class="loading loading-spinner loading-xs"></span> Loading...
    </div>
  {:else if error}
    <div class="text-error text-xs p-3">Failed to load run detail</div>
  {:else if detail}
    <!-- Summary -->
    <div class="flex flex-wrap gap-5 px-4 py-3 bg-base-200 rounded-lg mb-3">
      <div>
        <div class="text-[10px] text-base-content/30 uppercase tracking-wider">Suite</div>
        <div class="text-sm text-primary font-mono mt-0.5">{detail.suiteName || 'all'}</div>
      </div>
      <div>
        <div class="text-[10px] text-base-content/30 uppercase tracking-wider">Source</div>
        <div class="mt-1"><TriggerBadge source={detail.triggeredBy || 'cli'} /></div>
      </div>
      <div>
        <div class="text-[10px] text-base-content/30 uppercase tracking-wider">Total</div>
        <div class="text-lg font-bold font-mono mt-0.5">{detail.summary.total}</div>
      </div>
      <div>
        <div class="text-[10px] text-base-content/30 uppercase tracking-wider">Passed</div>
        <div class="text-lg font-bold font-mono text-success mt-0.5">{detail.summary.passed}</div>
      </div>
      <div>
        <div class="text-[10px] text-base-content/30 uppercase tracking-wider">Failed</div>
        <div class="text-lg font-bold font-mono mt-0.5 {detail.summary.failed > 0 ? 'text-error' : 'text-base-content/30'}">{detail.summary.failed}</div>
      </div>
      <div>
        <div class="text-[10px] text-base-content/30 uppercase tracking-wider">Duration</div>
        <div class="text-sm font-mono text-base-content/50 mt-0.5">{detail.summary.duration || '-'}</div>
      </div>
      <div>
        <div class="text-[10px] text-base-content/30 uppercase tracking-wider">Export</div>
        <div class="mt-1">
          <button class="btn btn-xs btn-ghost" onclick={exportJson}>JSON</button>
        </div>
      </div>
    </div>

    <!-- Insights -->
    {#if healthInfo || insightItems.length > 0}
      <div class="flex flex-col gap-1.5 mb-3 p-3 bg-base-300 border border-base-content/10 rounded-lg">
        {#if healthInfo}
          <div class="flex items-center gap-2.5 flex-wrap">
            <span class="text-base font-bold font-mono {healthInfo.rc}">{healthInfo.h.passRate}%</span>
            <span class="text-xs {healthInfo.trendCls}">{healthInfo.trendIcon} {healthInfo.h.passRateTrend}</span>
            {#if healthInfo.h.flakyCount > 0}
              <span class="badge badge-xs badge-warning">{healthInfo.h.flakyCount} flaky</span>
            {/if}
            {#if healthInfo.h.unstableSelectorCount > 0}
              <span class="badge badge-xs badge-error">{healthInfo.h.unstableSelectorCount} unstable sel.</span>
            {/if}
          </div>
        {/if}
        {#each insightItems as i}
          {@const icon = i.type === 'new-failure' ? '\u2718' : i.type === 'recovered' ? '\u2714' : i.type === 'flaky' ? '\u223C' : '!'}
          {@const cls = i.type === 'new-failure' ? 'text-error' : i.type === 'recovered' ? 'text-success' : i.type === 'flaky' ? 'text-warning' : ''}
          <div class="flex items-center gap-2 text-xs {cls}">
            <span class="text-sm shrink-0">{icon}</span>
            <span>{i.message}</span>
          </div>
        {/each}
      </div>
    {/if}

    <!-- Pool Distribution -->
    {#if Object.keys(poolDist).length > 0}
      <PoolDistribution tests={poolDist} />
    {/if}

    <!-- Test Results -->
    {#each results as r (r.name + '-' + r.attempt)}
      <RunTestResult test={r} />
    {/each}
  {/if}
</div>
