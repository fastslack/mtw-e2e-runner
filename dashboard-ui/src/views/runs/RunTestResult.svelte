<script>
  import { dur } from '../../lib/utils/format.js';
  import { ssHash } from '../../lib/utils/hash.js';
  import Badge from '../../components/shared/Badge.svelte';
  import HashBadge from '../../components/shared/HashBadge.svelte';
  import CopyButton from '../../components/shared/CopyButton.svelte';
  import NetworkPanel from '../../components/shared/NetworkPanel.svelte';

  let { test } = $props();

  let expanded = $state(false);
  let actionsOpen = $state(false);
  let consoleOpen = $state(false);
  let netErrorsOpen = $state(false);
  let visualDiffOpen = $state(false);
  let ssHashes = $state({});

  let testDur = $derived(
    test.durationMs ? dur(test.durationMs) :
    test.endTime && test.startTime ? dur(new Date(test.endTime) - new Date(test.startTime)) : '-'
  );

  let isFlaky = $derived(test.success && test.attempt > 1);
  let borderCls = $derived(isFlaky ? 'border-l-warning' : test.success ? 'border-l-success' : 'border-l-error');

  let actionPassCount = $derived(test.actions ? test.actions.filter(a => a.success).length : 0);
  let actionFailCount = $derived(test.actions ? test.actions.length - actionPassCount : 0);

  let shots = $derived.by(() => {
    const result = [];
    const hashes = test.screenshotHashes || {};
    (test.screenshots || []).forEach(p => {
      result.push({ path: p, label: p.split('/').pop(), type: 'screenshot', hash: hashes[p] || null });
    });
    if (test.errorScreenshot) {
      result.push({ path: test.errorScreenshot, label: test.errorScreenshot.split('/').pop(), type: 'error', hash: hashes[test.errorScreenshot] || null });
    }
    return result;
  });

  let consoleIssues = $derived(
    (test.consoleLogs || []).filter(l => l.type === 'error' || l.type === 'warn' || l.type === 'warning')
  );
  let consoleErrors = $derived(consoleIssues.filter(l => l.type === 'error').length);
  let consoleWarns = $derived(consoleIssues.length - consoleErrors);

  let poolLabel = $derived(
    test.poolUrl ? test.poolUrl.replace('ws://', '').replace('wss://', '') : null
  );

  // Resolve missing hashes
  $effect(() => {
    shots.forEach(s => {
      if (!s.hash && !ssHashes[s.path]) {
        ssHash(s.path).then(h => {
          ssHashes = { ...ssHashes, [s.path]: h };
        });
      }
    });
  });

  function openScreenshot(src, e) {
    e.stopPropagation();
    if (globalThis.__openModal) globalThis.__openModal(src);
  }

  function toggle() {
    expanded = !expanded;
  }
</script>

<div class="test-result-card {isFlaky ? 'flaky' : test.success ? 'pass' : 'fail'}">
  <div class="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-base-content/3 transition-colors duration-100" onclick={toggle}>
    <div class="flex gap-2 items-center shrink-0">
      <Badge type={test.success ? 'pass' : 'fail'} text={test.success ? 'PASS' : 'FAIL'} />
      {#if isFlaky}
        <Badge type="flaky" text="FLAKY" />
      {/if}
    </div>
    <div class="flex-1 text-sm font-mono text-base-content truncate flex items-center gap-2 font-medium">
      {test.name}
      {#if poolLabel}
        <span class="badge badge-xs badge-ghost border border-base-content/10 text-[9px]">{poolLabel}</span>
      {/if}
    </div>
    <div class="text-sm font-mono text-base-content/40 shrink-0 font-semibold">{testDur}</div>
  </div>

  {#if expanded}
    <div class="px-4 pb-4 pt-1" style="animation: fadeSlide 0.2s ease">
      {#if test.maxAttempts > 1}
        <div class="text-sm text-warning font-mono py-1.5 font-semibold">Attempt {test.attempt} of {test.maxAttempts}</div>
      {/if}

      {#if test.error}
        <div class="bg-error/10 border border-error/25 rounded-lg px-4 py-3 text-sm font-mono text-error mb-3 flex items-start gap-2 break-words" style="box-shadow: 0 0 12px oklch(var(--er) / 0.08)">
          {test.error}
          <CopyButton getText={test.error} />
        </div>
      {/if}

      <!-- Actions Panel -->
      {#if test.actions?.length}
        <div class="detail-section">
          <div
            class="detail-section-header flex items-center gap-2.5 text-sm"
            onclick={() => actionsOpen = !actionsOpen}
          >
            <span class="text-xs text-primary transition-transform duration-200 {actionsOpen ? 'rotate-90' : ''}">{'\u25B6'}</span>
            <span class="font-bold text-base-content">Actions</span>
            <div class="flex gap-3 ml-auto items-center">
              <span class="text-base-content/40">Steps: <strong class="text-base-content/60">{test.actions.length}</strong></span>
              {#if actionFailCount > 0}
                <span class="text-error font-semibold">Failed: <strong>{actionFailCount}</strong></span>
              {/if}
            </div>
          </div>
          {#if actionsOpen}
            <div class="px-4 py-3">
              {#each test.actions as a}
                {@const label = a.narrative || a.type}
                {@const durText = a.duration != null ? dur(a.duration) : ''}
                <div class="flex items-center gap-2.5 py-1 text-sm">
                  <span class="text-base shrink-0 {a.success ? 'text-success' : 'text-error'}">{a.success ? '\u2714' : '\u2718'}</span>
                  <span class="flex-1 text-base-content/60 font-mono text-xs truncate">{label}</span>
                  {#if a.actionRetries > 0}
                    <span class="badge badge-sm badge-warning text-[10px]">{'\u21BB'} x{a.actionRetries}</span>
                  {/if}
                  <span class="text-xs font-mono text-base-content/30 shrink-0">{durText}</span>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <!-- Screenshots -->
      {#if shots.length > 0}
        <div class="flex flex-wrap gap-3 my-3">
          {#each shots as s}
            {@const src = '/api/image?path=' + encodeURIComponent(s.path)}
            {@const resolvedHash = s.hash || ssHashes[s.path] || null}
            <div
              class="cursor-pointer border rounded-lg overflow-hidden w-[220px] transition-all duration-200 hover:border-primary hover:shadow-[0_0_12px_oklch(var(--p)/0.15)] {s.type === 'error' ? 'border-error shadow-[0_0_8px_oklch(var(--er)/0.1)]' : 'border-base-content/10'}"
              onclick={(e) => openScreenshot(src, e)}
            >
              <img src={src} alt={s.label} loading="lazy" class="w-full h-auto block" />
              <div class="px-2.5 py-2 text-xs text-base-content/40 flex items-center gap-2 flex-wrap bg-base-200">
                <span class="truncate flex-1 min-w-0">{s.label}</span>
                {#if resolvedHash}
                  <HashBadge hash={resolvedHash} />
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Visual Diff -->
      {#if test.visualDiff}
        {@const vd = test.visualDiff}
        {@const pct = (vd.diffPercentage * 100).toFixed(2)}
        {@const matchPct = ((1 - vd.diffPercentage) * 100).toFixed(1)}
        {@const threshPct = ((vd.threshold || 0.02) * 100).toFixed(1)}
        <div class="detail-section">
          <div
            class="detail-section-header flex items-center gap-2.5 text-sm"
            onclick={() => visualDiffOpen = !visualDiffOpen}
          >
            <span class="text-xs {vd.passed ? 'text-success' : 'text-error'} transition-transform duration-200 {visualDiffOpen ? 'rotate-90' : ''}">{'\u25B6'}</span>
            <span class="font-bold text-base-content">Visual Diff</span>
            <div class="flex gap-3 ml-auto items-center">
              <span class="{vd.passed ? 'text-success' : 'text-error'} font-semibold">
                {vd.passed ? '\u2714' : '\u2718'} {pct}% diff
              </span>
              <span class="text-base-content/40 text-xs">threshold: {threshPct}%</span>
              <span class="text-base-content/40 text-xs">{vd.differentPixels?.toLocaleString()} / {vd.totalPixels?.toLocaleString()} px</span>
            </div>
          </div>
          {#if visualDiffOpen}
            <div class="px-4 py-3">
              <!-- Progress bar showing match percentage -->
              <div class="w-full bg-base-300 rounded-full h-2 mb-4 overflow-hidden">
                <div
                  class="h-full rounded-full transition-all duration-500 {vd.passed ? 'bg-success' : 'bg-error'}"
                  style="width: {matchPct}%"
                ></div>
              </div>
              <!-- Side-by-side screenshots -->
              <div class="grid grid-cols-3 gap-3">
                {#if test.baselineScreenshot}
                  {@const blSrc = '/api/image?path=' + encodeURIComponent(test.baselineScreenshot)}
                  <div class="text-center">
                    <div class="text-xs text-base-content/40 mb-1.5 font-semibold uppercase tracking-wider">Baseline</div>
                    <div
                      class="cursor-pointer border border-base-content/10 rounded-lg overflow-hidden hover:border-primary transition-colors"
                      onclick={(e) => openScreenshot(blSrc, e)}
                    >
                      <img src={blSrc} alt="Baseline" loading="lazy" class="w-full h-auto block" />
                    </div>
                  </div>
                {/if}
                {#if test.verificationScreenshot}
                  {@const vfSrc = '/api/image?path=' + encodeURIComponent(test.verificationScreenshot)}
                  <div class="text-center">
                    <div class="text-xs text-base-content/40 mb-1.5 font-semibold uppercase tracking-wider">Current</div>
                    <div
                      class="cursor-pointer border border-base-content/10 rounded-lg overflow-hidden hover:border-primary transition-colors"
                      onclick={(e) => openScreenshot(vfSrc, e)}
                    >
                      <img src={vfSrc} alt="Current" loading="lazy" class="w-full h-auto block" />
                    </div>
                  </div>
                {/if}
                {#if test.diffScreenshot || vd.diffImagePath}
                  {@const diffSrc = '/api/image?path=' + encodeURIComponent(test.diffScreenshot || vd.diffImagePath)}
                  <div class="text-center">
                    <div class="text-xs text-base-content/40 mb-1.5 font-semibold uppercase tracking-wider">
                      Diff <span class="{vd.passed ? 'text-success' : 'text-error'}">{pct}%</span>
                    </div>
                    <div
                      class="cursor-pointer border rounded-lg overflow-hidden hover:border-primary transition-colors {vd.passed ? 'border-success/30' : 'border-error/30'}"
                      onclick={(e) => openScreenshot(diffSrc, e)}
                    >
                      <img src={diffSrc} alt="Diff overlay" loading="lazy" class="w-full h-auto block" style="background: #111" />
                    </div>
                  </div>
                {/if}
              </div>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Console Logs -->
      {#if consoleIssues.length > 0}
        <div class="detail-section">
          <div
            class="detail-section-header flex items-center gap-2.5 text-sm"
            onclick={() => consoleOpen = !consoleOpen}
          >
            <span class="text-xs text-warning transition-transform duration-200 {consoleOpen ? 'rotate-90' : ''}">{'\u25B6'}</span>
            <span class="font-bold text-base-content">Console</span>
            <div class="flex gap-3 ml-auto items-center">
              {#if consoleErrors > 0}
                <span class="text-error font-semibold">Errors: <strong>{consoleErrors}</strong></span>
              {/if}
              {#if consoleWarns > 0}
                <span class="text-base-content/40">Warnings: <strong>{consoleWarns}</strong></span>
              {/if}
            </div>
            <CopyButton getText={() => consoleIssues.map(l => '[' + l.type + '] ' + l.text).join('\n')} />
          </div>
          {#if consoleOpen}
            <div class="max-h-[400px] overflow-y-auto">
              {#each consoleIssues as l}
                <div class="px-4 py-1.5 text-xs font-mono border-b border-base-content/5 break-all {l.type === 'error' ? 'text-error' : 'text-warning'}">
                  [{l.type}] {l.text}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <!-- Network Errors -->
      {#if test.networkErrors?.length}
        <div class="detail-section">
          <div
            class="detail-section-header flex items-center gap-2.5 text-sm"
            onclick={() => netErrorsOpen = !netErrorsOpen}
          >
            <span class="text-xs text-error transition-transform duration-200 {netErrorsOpen ? 'rotate-90' : ''}">{'\u25B6'}</span>
            <span class="font-bold text-base-content">Network Errors</span>
            <div class="flex gap-3 ml-auto items-center">
              <span class="text-error font-semibold">Errors: <strong>{test.networkErrors.length}</strong></span>
            </div>
            <CopyButton getText={() => test.networkErrors.map(ne => '[' + ne.error + '] ' + ne.url).join('\n')} />
          </div>
          {#if netErrorsOpen}
            <div class="max-h-[400px] overflow-y-auto">
              {#each test.networkErrors as ne}
                <div class="px-4 py-1.5 text-xs font-mono text-error border-b border-base-content/5 break-all">
                  [{ne.error}] {ne.url}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <!-- Network Requests -->
      {#if test.networkLogs?.length}
        <NetworkPanel networkLogs={test.networkLogs} />
      {/if}
    </div>
  {/if}
</div>
