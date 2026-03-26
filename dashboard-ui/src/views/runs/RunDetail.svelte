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

<div class="p-5">
  {#if loading}
    <div class="flex items-center gap-3 p-4 text-base-content/30 text-sm">
      <span class="loading loading-spinner loading-sm"></span> Loading run details...
    </div>
  {:else if error}
    <div class="text-error text-sm p-4 font-semibold">Failed to load run detail</div>
  {:else if detail}
    <!-- Summary -->
    <div class="run-summary-card flex flex-wrap gap-6 px-5 py-4 mb-4">
      <div>
        <div class="text-xs text-base-content/35 uppercase tracking-wider font-sans font-semibold">Suite</div>
        <div class="text-base text-primary font-mono font-semibold mt-1">{detail.suiteName || 'all'}</div>
      </div>
      <div>
        <div class="text-xs text-base-content/35 uppercase tracking-wider font-sans font-semibold">Source</div>
        <div class="mt-1.5"><TriggerBadge source={detail.triggeredBy || 'cli'} /></div>
      </div>
      <div>
        <div class="text-xs text-base-content/35 uppercase tracking-wider font-sans font-semibold">Total</div>
        <div class="text-2xl font-bold font-mono mt-1 text-base-content">{detail.summary.total}</div>
      </div>
      <div>
        <div class="text-xs text-base-content/35 uppercase tracking-wider font-sans font-semibold">Passed</div>
        <div class="text-2xl font-bold font-mono text-success mt-1" style="text-shadow: 0 0 12px oklch(var(--su) / 0.3)">{detail.summary.passed}</div>
      </div>
      <div>
        <div class="text-xs text-base-content/35 uppercase tracking-wider font-sans font-semibold">Failed</div>
        <div class="text-2xl font-bold font-mono mt-1 {detail.summary.failed > 0 ? 'text-error' : 'text-base-content/20'}" style="{detail.summary.failed > 0 ? 'text-shadow: 0 0 12px oklch(var(--er) / 0.3)' : ''}">{detail.summary.failed}</div>
      </div>
      <div>
        <div class="text-xs text-base-content/35 uppercase tracking-wider font-sans font-semibold">Duration</div>
        <div class="text-base font-mono text-base-content/60 mt-1 font-semibold">{detail.summary.duration || '-'}</div>
      </div>
      <div>
        <div class="text-xs text-base-content/35 uppercase tracking-wider font-sans font-semibold">Export</div>
        <div class="mt-1.5">
          <button class="btn btn-sm btn-ghost text-base-content/50 hover:text-primary" onclick={exportJson}>JSON</button>
        </div>
      </div>
    </div>

    <!-- Insights -->
    {#if healthInfo || insightItems.length > 0}
      <div class="detail-section mb-4">
        <div class="p-4">
          {#if healthInfo}
            <div class="flex items-center gap-3 flex-wrap mb-2">
              <span class="text-xl font-bold font-mono {healthInfo.rc}" style="text-shadow: 0 0 12px oklch(var(--p) / 0.3)">{healthInfo.h.passRate}%</span>
              <span class="text-sm font-semibold {healthInfo.trendCls}">{healthInfo.trendIcon} {healthInfo.h.passRateTrend}</span>
              {#if healthInfo.h.flakyCount > 0}
                <span class="badge badge-sm badge-warning font-semibold">{healthInfo.h.flakyCount} flaky</span>
              {/if}
              {#if healthInfo.h.unstableSelectorCount > 0}
                <span class="badge badge-sm badge-error font-semibold">{healthInfo.h.unstableSelectorCount} unstable sel.</span>
              {/if}
            </div>
          {/if}
          {#each insightItems as i}
            {@const icon = i.type === 'new-failure' ? '\u2718' : i.type === 'recovered' ? '\u2714' : i.type === 'flaky' ? '\u223C' : '!'}
            {@const cls = i.type === 'new-failure' ? 'text-error' : i.type === 'recovered' ? 'text-success' : i.type === 'flaky' ? 'text-warning' : ''}
            <div class="flex items-center gap-2.5 text-sm py-0.5 {cls}">
              <span class="text-base shrink-0">{icon}</span>
              <span>{i.message}</span>
            </div>
          {/each}
        </div>
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
