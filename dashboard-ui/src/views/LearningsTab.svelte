<script>
  import { app } from '../lib/stores/state.svelte.js';
  import { rateColor, rateClass, dur as durFmt } from '../lib/utils/format.js';
  import { downloadFile } from '../lib/utils/download.js';
  import { showToast } from '../lib/stores/toast.svelte.js';

  let data = $state(null);
  let days = $state(30);
  let loading = $state(false);

  export function refresh() {
    loading = true;
    const url = app.project
      ? '/api/db/projects/' + app.project + '/learnings?days=' + days
      : '/api/db/learnings?days=' + days;
    fetch(url).then(r => r.json()).then(d => {
      if (!d || d.totalRuns === 0) { data = null; loading = false; return; }
      data = d;
      app.lastLearningsData = d;
      loading = false;
    }).catch(() => { data = null; loading = false; });
  }

  // Badge state for parent to read
  export function getBadge() {
    if (!data) return { text: '-', color: '', bg: '' };
    const flakyCount = data.flakyTests?.length || 0;
    const passRate = data.overallPassRate || 0;
    const declining = isDeclinig();
    if (passRate < 70) return { text: '\u26A0', color: 'text-error', bg: 'bg-error/15' };
    if (flakyCount > 0 || declining) return { text: flakyCount > 0 ? String(flakyCount) : (declining ? '\u25BC' : '\u2714'), color: 'text-warning', bg: 'bg-warning/15' };
    return { text: '\u2714', color: 'text-success', bg: 'bg-success/15' };
  }

  function isDeclinig() {
    const td = data?.recentTrend?.data || data?.recentTrend;
    if (!Array.isArray(td) || td.length < 2) return false;
    const last = td[td.length - 1].pass_rate;
    const prior = td.slice(0, -1).reduce((s, t) => s + t.pass_rate, 0) / (td.length - 1);
    return last - prior < -2;
  }

  function onDaysChange(e) {
    days = parseInt(e.target.value, 10);
    refresh();
  }

  function exportMd() {
    if (!data) { showToast('No learnings data to export', 'error'); return; }
    let md = '# E2E Learnings Report\n\n';
    md += '| Metric | Value |\n|--------|-------|\n';
    md += '| Total Runs | ' + data.totalRuns + ' |\n';
    md += '| Total Tests | ' + data.totalTests + ' |\n';
    md += '| Pass Rate | ' + data.overallPassRate + '% |\n';
    md += '| Avg Duration | ' + durFmt(data.avgDurationMs) + ' |\n\n';
    if (data.flakyTests?.length) {
      md += '## Flaky Tests\n\n| Test | Flaky Rate | Occurrences |\n|------|-----------|-------------|\n';
      data.flakyTests.forEach(f => { md += '| ' + f.test_name + ' | ' + f.flaky_rate + '% | ' + f.flaky_count + ' |\n'; });
      md += '\n';
    }
    if (data.unstableSelectors?.length) {
      md += '## Unstable Selectors\n\n| Selector | Action | Fail Rate |\n|----------|--------|-----------|\n';
      data.unstableSelectors.forEach(s => { md += '| `' + s.selector + '` | ' + s.action_type + ' | ' + s.fail_rate + '% |\n'; });
      md += '\n';
    }
    downloadFile('learnings-report.md', md, 'text/markdown');
    showToast('Learnings exported', 'success');
  }

  // Derived values
  let passRate = $derived(data?.overallPassRate || 0);
  let flakyCount = $derived(data?.flakyTests?.length || 0);
  let badSels = $derived(data?.unstableSelectors?.length || 0);
  let slowPages = $derived(data?.failingPages?.length || 0);
  let apiIssues = $derived(data?.apiIssues?.length || 0);
  let topErrHits = $derived(data?.topErrors?.length > 0 ? data.topErrors[0].occurrence_count : 0);
  let ringCirc = $derived(2 * Math.PI * 15.9);
  let ringOffset = $derived(ringCirc * (1 - passRate / 100));

  let heroStats = $derived([
    { val: String(data?.totalRuns || 0), lbl: 'Runs', color: 'oklch(var(--p))' },
    { val: String(data?.totalTests || 0), lbl: 'Tests', color: 'oklch(var(--p))' },
    { val: durFmt(data?.avgDurationMs || 0), lbl: 'Avg Duration', color: '#8b5cf6' },
    { val: String(flakyCount), lbl: 'Flaky', color: flakyCount > 0 ? 'oklch(var(--wa))' : 'oklch(var(--su))' },
    { val: String(badSels), lbl: 'Bad Selectors', color: badSels > 0 ? 'oklch(var(--er))' : 'oklch(var(--su))' },
    { val: String(slowPages), lbl: 'Slow Pages', color: slowPages > 0 ? 'oklch(var(--wa))' : 'oklch(var(--su))' },
    { val: String(apiIssues), lbl: 'API Issues', color: apiIssues > 0 ? 'oklch(var(--er))' : 'oklch(var(--su))' },
    { val: String(topErrHits), lbl: 'Top Error Hits', color: topErrHits > 0 ? 'oklch(var(--er))' : 'oklch(var(--su))' },
  ]);

  let trend = $derived(data?.recentTrend || []);
  let trendW = $derived(trend.length > 0 ? 100 / trend.length : 1);
  let trendPts = $derived(trend.map((t, i) => (i * trendW + trendW / 2) + ',' + (100 - t.pass_rate)).join(' '));
  let selectors = $derived((data?.unstableSelectors || []).slice(0, 5));
  let pages = $derived((data?.failingPages || []).slice(0, 5));
  let flaky = $derived((data?.flakyTests || []).slice(0, 5));
  let apis = $derived((data?.apiIssues || []).slice(0, 5));
  let errors = $derived((data?.topErrors || []).slice(0, 5));

  // Slowest tests — aggregated from flaky tests (>2s) and failing pages (>3s)
  let slowTests = $derived.by(() => {
    const results = [];
    if (data?.flakyTests) {
      data.flakyTests.forEach(f => {
        if (f.avg_duration_ms && f.avg_duration_ms > 2000) results.push({ name: f.test_name, dur: f.avg_duration_ms });
      });
    }
    if (data?.failingPages) {
      data.failingPages.forEach(p => {
        if (p.avg_load_time_ms && p.avg_load_time_ms > 3000) results.push({ name: p.url_path, dur: p.avg_load_time_ms });
      });
    }
    results.sort((a, b) => b.dur - a.dur);
    return results.slice(0, 5);
  });

  function truncate(s, max) { return s.length > max ? s.slice(0, max - 3) + '...' : s; }

  function verdictClass(v) {
    const cls = rateClass(v);
    if (cls === 'good') return 'badge-success';
    if (cls === 'warn') return 'badge-warning';
    return 'badge-error';
  }
</script>

<div class="flex flex-col h-[calc(100vh-120px)] min-h-0">
  <!-- Fixed toolbar -->
  <div class="flex items-center justify-between mb-4 shrink-0">
    <div class="font-sans text-[13px] font-semibold text-base-content/70">Learnings</div>
    <div class="flex items-center gap-2">
      <select class="select select-xs font-mono text-[11px] bg-base-100/50 border-base-content/8 rounded-lg" value={days} onchange={onDaysChange}>
        <option value={7}>7 days</option>
        <option value={14}>14 days</option>
        <option value={30}>30 days</option>
        <option value={90}>90 days</option>
      </select>
      <button class="btn btn-sm btn-ghost text-base-content/30 hover:text-primary font-mono text-[10px]" onclick={exportMd}>Export</button>
      <button class="btn btn-sm btn-ghost text-base-content/30 hover:text-primary font-mono text-[10px]" onclick={refresh}>Refresh</button>
    </div>
  </div>

  {#if !data}
    <div class="flex flex-col items-center justify-center flex-1 text-base-content/20">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="opacity-40 mb-4">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
      </svg>
      <p class="font-sans text-sm">No learnings data yet. Run some tests to start building knowledge.</p>
    </div>
  {:else}
    <!-- Hero: donut ring + stats -->
    <div class="flex items-center gap-6 px-6 py-4 bg-base-200 border border-base-content/6 rounded-xl mb-4 shrink-0"
         style="animation: fadeSlide 0.3s ease both">
      <!-- Donut ring -->
      <div class="relative w-20 h-20 shrink-0">
        <svg viewBox="0 0 36 36" class="w-full h-full -rotate-90">
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="oklch(var(--bc) / 0.06)" stroke-width="7" />
          <circle cx="18" cy="18" r="15.9" fill="none"
            stroke={rateColor(passRate)}
            stroke-width="7"
            stroke-linecap="round"
            stroke-dasharray={ringCirc.toFixed(1)}
            stroke-dashoffset={ringOffset.toFixed(1)}
            class="transition-[stroke-dashoffset] duration-600 ease-out"
            style="filter: drop-shadow(0 0 4px {rateColor(passRate)}40)" />
        </svg>
        <div class="absolute inset-0 flex items-center justify-center text-lg font-bold font-mono" style="color:{rateColor(passRate)}; text-shadow: 0 0 12px {rateColor(passRate)}30">{passRate}%</div>
      </div>

      <!-- Stats grid -->
      <div class="flex-1 grid grid-cols-4 gap-3">
        {#each heroStats as s}
          <div class="text-center">
            <div class="text-[15px] font-bold font-mono" style="color:{s.color}">{s.val}</div>
            <div class="text-[8px] text-base-content/25 uppercase tracking-widest mt-0.5 font-sans">{s.lbl}</div>
          </div>
        {/each}
      </div>
    </div>

    <!-- Scrollable body -->
    <div class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4">
      <!-- 4 knowledge cards in 2x2 grid -->
      <div class="grid grid-cols-2 gap-4 shrink-0 max-md:grid-cols-1">
        <!-- Risky Selectors -->
        <div class="bg-base-200 border border-base-content/6 rounded-xl overflow-hidden" style="animation: fadeSlide 0.3s ease 0.05s both">
          <div class="p-4">
            <h3 class="text-[10px] font-semibold text-base-content/40 uppercase tracking-[0.12em] flex items-center gap-2 font-sans shrink-0 mb-3">
              <span class="w-5 h-5 rounded-md bg-warning/10 flex items-center justify-center text-warning text-[11px]">{'\u26A0'}</span> Risky Selectors
            </h3>
            <div class="max-h-44 overflow-y-auto">
              {#if selectors.length === 0}
                <div class="text-[11px] text-base-content/30 italic">No unstable selectors</div>
              {:else}
                {#each selectors as s}
                  {@const rate = parseFloat(s.fail_rate)}
                  <div class="flex items-center gap-2.5 py-1.5 border-b border-base-content/5 last:border-b-0">
                    <div class="flex-1 min-w-0">
                      <div class="text-[11px] text-base-content truncate mb-0.5"><code class="bg-base-100 px-1 py-px rounded-sm text-[10px]">{truncate(s.selector, 40)}</code></div>
                      <div class="text-[9px] text-base-content/30">{s.action_type} &middot; {s.total_uses} uses</div>
                      <div class="w-full bg-base-100 rounded-full h-1 mt-1 overflow-hidden">
                        <div class="h-full rounded-full transition-[width] duration-400 {rate > 30 ? 'bg-error' : 'bg-warning'}" style="width:{Math.min(rate, 100)}%"></div>
                      </div>
                    </div>
                    <div class="text-[13px] font-bold font-mono shrink-0 min-w-[44px] text-right {rate > 30 ? 'text-error' : 'text-warning'}">{s.fail_rate}%</div>
                  </div>
                {/each}
              {/if}
            </div>
          </div>
        </div>

        <!-- Problem Pages -->
        <div class="bg-base-200 border border-base-content/6 rounded-xl overflow-hidden" style="animation: fadeSlide 0.3s ease 0.1s both">
          <div class="p-4">
            <h3 class="text-[10px] font-semibold text-base-content/40 uppercase tracking-[0.12em] flex items-center gap-2 font-sans shrink-0 mb-3">
              <span class="w-5 h-5 rounded-md bg-error/10 flex items-center justify-center text-error text-[11px]">{'\u23F1'}</span> Problem Pages
            </h3>
            <div class="max-h-44 overflow-y-auto">
              {#if pages.length === 0}
                <div class="text-[11px] text-base-content/30 italic">No failing pages</div>
              {:else}
                {#each pages as p}
                  {@const rate = parseFloat(p.fail_rate)}
                  <div class="flex items-center gap-2.5 py-1.5 border-b border-base-content/5 last:border-b-0">
                    <div class="flex-1 min-w-0">
                      <div class="text-[11px] text-base-content truncate mb-0.5"><code class="bg-base-100 px-1 py-px rounded-sm text-[10px]">{truncate(p.url_path, 40)}</code></div>
                      <div class="text-[9px] text-base-content/30">{p.total_visits} visits &middot; {p.console_errors} console errs</div>
                      <div class="w-full bg-base-100 rounded-full h-1 mt-1 overflow-hidden">
                        <div class="h-full rounded-full transition-[width] duration-400 {rate > 30 ? 'bg-error' : 'bg-warning'}" style="width:{Math.min(rate, 100)}%"></div>
                      </div>
                    </div>
                    <div class="text-[13px] font-bold font-mono shrink-0 min-w-[44px] text-right {rate > 30 ? 'text-error' : 'text-warning'}">{p.fail_rate}%</div>
                  </div>
                {/each}
              {/if}
            </div>
          </div>
        </div>

        <!-- Flaky Tests -->
        <div class="bg-base-200 border border-base-content/6 rounded-xl overflow-hidden" style="animation: fadeSlide 0.3s ease 0.15s both">
          <div class="p-4">
            <h3 class="text-[10px] font-semibold text-base-content/40 uppercase tracking-[0.12em] flex items-center gap-2 font-sans shrink-0 mb-3">
              <span class="w-5 h-5 rounded-md bg-warning/10 flex items-center justify-center text-warning text-[11px]">{'\u223C'}</span> Flaky Tests
            </h3>
            <div class="max-h-44 overflow-y-auto">
              {#if flaky.length === 0}
                <div class="text-[11px] text-base-content/30 italic">No flaky tests detected</div>
              {:else}
                {#each flaky as f}
                  {@const rate = parseFloat(f.flaky_rate)}
                  <div class="flex items-center gap-2.5 py-1.5 border-b border-base-content/5 last:border-b-0">
                    <div class="flex-1 min-w-0">
                      <div class="text-[11px] text-base-content truncate mb-0.5"><code class="bg-base-100 px-1 py-px rounded-sm text-[10px]">{truncate(f.test_name, 40)}</code></div>
                      <div class="text-[9px] text-base-content/30">Attempt avg {f.avg_attempts} &middot; {f.total_runs} runs</div>
                      <div class="w-full bg-base-100 rounded-full h-1 mt-1 overflow-hidden">
                        <div class="h-full rounded-full transition-[width] duration-400 {rate > 30 ? 'bg-error' : 'bg-warning'}" style="width:{Math.min(rate, 100)}%"></div>
                      </div>
                    </div>
                    <div class="text-[13px] font-bold font-mono shrink-0 min-w-[44px] text-right {rate > 30 ? 'text-error' : 'text-warning'}">{f.flaky_rate}%</div>
                  </div>
                {/each}
              {/if}
            </div>
          </div>
        </div>

        <!-- API Issues -->
        <div class="bg-base-200 border border-base-content/6 rounded-xl overflow-hidden" style="animation: fadeSlide 0.3s ease 0.2s both">
          <div class="p-4">
            <h3 class="text-[10px] font-semibold text-base-content/40 uppercase tracking-[0.12em] flex items-center gap-2 font-sans shrink-0 mb-3">
              <span class="w-5 h-5 rounded-md bg-secondary/10 flex items-center justify-center text-secondary text-[11px]">{'\u21C4'}</span> API Issues
            </h3>
            <div class="max-h-44 overflow-y-auto">
              {#if apis.length === 0}
                <div class="text-[11px] text-base-content/30 italic">No API issues</div>
              {:else}
                {#each apis as a}
                  {@const rate = parseFloat(a.error_rate)}
                  <div class="flex items-center gap-2.5 py-1.5 border-b border-base-content/5 last:border-b-0">
                    <div class="flex-1 min-w-0">
                      <div class="text-[11px] text-base-content truncate mb-0.5"><code class="bg-base-100 px-1 py-px rounded-sm text-[10px]">{truncate(a.endpoint, 40)}</code></div>
                      <div class="text-[9px] text-base-content/30">{a.total_calls} calls &middot; {durFmt(a.avg_duration_ms)}</div>
                      <div class="w-full bg-base-100 rounded-full h-1 mt-1 overflow-hidden">
                        <div class="h-full rounded-full transition-[width] duration-400 {rate > 20 ? 'bg-error' : 'bg-warning'}" style="width:{Math.min(rate, 100)}%"></div>
                      </div>
                    </div>
                    <div class="text-[13px] font-bold font-mono shrink-0 min-w-[44px] text-right {rate > 20 ? 'text-error' : 'text-warning'}">{a.error_rate}%</div>
                  </div>
                {/each}
              {/if}
            </div>
          </div>
        </div>
      </div>

      <!-- Pass Rate Trend (own row, like vanilla) -->
      {#if trend.length > 0}
        <div class="shrink-0" style="animation: fadeSlide 0.3s ease 0.25s both">
          <div class="bg-base-200 border border-base-content/6 rounded-xl overflow-hidden">
            <div class="p-4">
              <h3 class="text-[10px] font-semibold text-base-content/40 uppercase tracking-[0.12em] flex items-center gap-2 font-sans shrink-0 mb-3">
                <span class="w-5 h-5 rounded-md bg-primary/10 flex items-center justify-center text-primary text-[11px]">{'\u2197'}</span> Pass Rate Trend
              </h3>
              <div class="h-20 w-full">
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="w-full h-full">
                  <rect x="0" y="0" width="100" height="100" fill="oklch(var(--b2))" rx="2" />
                  <line x1="0" y1="50" x2="100" y2="50" stroke="oklch(var(--bc) / 0.1)" stroke-width="0.3" stroke-dasharray="2,2" />
                  <polygon points="{0 * trendW + trendW / 2},100 {trendPts} {(trend.length - 1) * trendW + trendW / 2},100" fill="oklch(var(--p) / 0.15)" />
                  <polyline points={trendPts} fill="none" stroke="oklch(var(--p))" stroke-width="1.5" />
                  {#each trend as t, i}
                    <circle cx={i * trendW + trendW / 2} cy={100 - t.pass_rate} r="2.5" fill={rateColor(t.pass_rate)}>
                      <title>{t.date}: {t.pass_rate}% ({t.total_tests} tests)</title>
                    </circle>
                  {/each}
                </svg>
              </div>
              <div class="flex justify-between text-[10px] text-base-content/30 mt-1 font-mono">
                <span>{trend[0].date}</span>
                <span>{trend[trend.length - 1].date}</span>
              </div>
            </div>
          </div>
        </div>
      {/if}

      <!-- Errors + Slowest Tests row (2 columns, like vanilla) -->
      <div class="grid grid-cols-2 gap-4 shrink-0 max-md:grid-cols-1">
        <!-- Most Common Errors -->
        <div class="bg-base-200 border border-base-content/6 rounded-xl overflow-hidden" style="animation: fadeSlide 0.3s ease 0.3s both">
          <div class="p-4">
            <h3 class="text-[10px] font-semibold text-base-content/40 uppercase tracking-[0.12em] flex items-center gap-2 font-sans shrink-0 mb-3">
              <span class="w-5 h-5 rounded-md bg-error/10 flex items-center justify-center text-error text-[11px]">{'\u2718'}</span> Most Common Errors
            </h3>
            <div class="max-h-44 overflow-y-auto">
              {#if errors.length === 0}
                <div class="text-[11px] text-base-content/30 italic">No errors recorded</div>
              {:else}
                {#each errors as e}
                  {@const maxCount = errors[0].occurrence_count || 1}
                  {@const pct = (e.occurrence_count / maxCount) * 100}
                  <div class="flex items-center gap-2.5 py-1.5 border-b border-base-content/5 last:border-b-0">
                    <div class="flex-1 min-w-0">
                      <div class="text-[11px] text-base-content truncate mb-0.5"><code class="bg-base-100 px-1 py-px rounded-sm text-[10px]">{truncate(e.pattern, 45)}</code></div>
                      <div class="text-[9px] text-base-content/30">{(e.last_seen || '').split('T')[0]} &middot; {e.occurrence_count}x</div>
                      <div class="w-full bg-base-100 rounded-full h-1 mt-1 overflow-hidden">
                        <div class="h-full rounded-full bg-error transition-[width] duration-400" style="width:{Math.min(pct, 100)}%"></div>
                      </div>
                    </div>
                    <span class="badge badge-sm {verdictClass(100 - pct)}">{e.category.replace(/-/g, ' ')}</span>
                    <div class="text-[13px] font-bold font-mono shrink-0 min-w-[44px] text-right text-error">{e.occurrence_count}x</div>
                  </div>
                {/each}
              {/if}
            </div>
          </div>
        </div>

        <!-- Slowest Tests -->
        <div class="bg-base-200 border border-base-content/6 rounded-xl overflow-hidden" style="animation: fadeSlide 0.3s ease 0.35s both">
          <div class="p-4">
            <h3 class="text-[10px] font-semibold text-base-content/40 uppercase tracking-[0.12em] flex items-center gap-2 font-sans shrink-0 mb-3">
              <span class="w-5 h-5 rounded-md bg-warning/10 flex items-center justify-center text-warning text-[11px]">{'\u23F3'}</span> Slowest Tests
            </h3>
            <div class="max-h-44 overflow-y-auto">
              {#if slowTests.length === 0}
                <div class="text-[11px] text-base-content/30 italic">No slow test data</div>
              {:else}
                {@const maxDur = slowTests[0].dur}
                {#each slowTests as t}
                  {@const pct = (t.dur / maxDur) * 100}
                  <div class="flex items-center gap-2.5 py-1.5 border-b border-base-content/5 last:border-b-0">
                    <div class="flex-1 min-w-0">
                      <div class="text-[11px] text-base-content truncate mb-0.5"><code class="bg-base-100 px-1 py-px rounded-sm text-[10px]">{truncate(t.name, 40)}</code></div>
                      <div class="w-full bg-base-100 rounded-full h-1 mt-1 overflow-hidden">
                        <div class="h-full rounded-full transition-[width] duration-400 {t.dur > 5000 ? 'bg-error' : 'bg-warning'}" style="width:{Math.min(pct, 100)}%"></div>
                      </div>
                    </div>
                    <div class="text-[13px] font-bold font-mono shrink-0 min-w-[44px] text-right {t.dur > 5000 ? 'text-error' : 'text-warning'}">{durFmt(t.dur)}</div>
                  </div>
                {/each}
              {/if}
            </div>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>
