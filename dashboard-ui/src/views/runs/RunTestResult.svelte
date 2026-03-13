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

<div class="border border-base-content/10 border-l-[3px] {borderCls} rounded-lg mb-2 overflow-hidden transition-colors duration-200">
  <div class="flex items-center gap-2.5 px-3.5 py-2.5 cursor-pointer hover:bg-base-200 transition-colors duration-100" onclick={toggle}>
    <div class="flex gap-1.5 items-center shrink-0">
      <Badge type={test.success ? 'pass' : 'fail'} text={test.success ? 'PASS' : 'FAIL'} />
      {#if isFlaky}
        <Badge type="flaky" text="FLAKY" />
      {/if}
    </div>
    <div class="flex-1 text-xs font-mono text-base-content truncate flex items-center gap-2">
      {test.name}
      {#if poolLabel}
        <span class="badge badge-xs badge-ghost border border-base-content/10 text-[9px]">{poolLabel}</span>
      {/if}
    </div>
    <div class="text-xs font-mono text-base-content/30 shrink-0">{testDur}</div>
  </div>

  {#if expanded}
    <div class="px-3.5 pb-3.5">
      {#if test.maxAttempts > 1}
        <div class="text-xs text-warning font-mono py-1">Attempt {test.attempt} of {test.maxAttempts}</div>
      {/if}

      {#if test.error}
        <div class="bg-error/10 border border-error/20 rounded-lg px-3 py-2.5 text-xs font-mono text-error mb-2 flex items-start gap-2 break-words">
          {test.error}
          <CopyButton getText={test.error} />
        </div>
      {/if}

      <!-- Actions Panel -->
      {#if test.actions?.length}
        <div class="border border-base-content/10 rounded-lg mb-2 overflow-hidden">
          <div
            class="flex items-center gap-2 px-3 py-2 cursor-pointer bg-base-200 hover:bg-base-200/80 transition-colors duration-100 text-xs"
            onclick={() => actionsOpen = !actionsOpen}
          >
            <span class="text-[9px] text-base-content/30 transition-transform duration-200 {actionsOpen ? 'rotate-90' : ''}">{'\u25B6'}</span>
            <span class="font-semibold text-base-content">Actions</span>
            <div class="flex gap-2.5 ml-auto items-center">
              <span class="text-base-content/30">Steps: <strong class="text-base-content/50">{test.actions.length}</strong></span>
              {#if actionFailCount > 0}
                <span class="text-error">Failed: <strong>{actionFailCount}</strong></span>
              {/if}
            </div>
          </div>
          {#if actionsOpen}
            <div class="px-3.5 py-2">
              {#each test.actions as a}
                {@const label = a.narrative || a.type}
                {@const durText = a.duration != null ? dur(a.duration) : ''}
                <div class="flex items-center gap-2 py-0.5 text-xs">
                  <span class="text-sm shrink-0 {a.success ? 'text-success' : 'text-error'}">{a.success ? '\u2714' : '\u2718'}</span>
                  <span class="flex-1 text-base-content/50 font-mono text-[10px] truncate">{label}</span>
                  {#if a.actionRetries > 0}
                    <span class="badge badge-xs badge-warning text-[9px]">{'\u21BB'} x{a.actionRetries}</span>
                  {/if}
                  <span class="text-[10px] font-mono text-base-content/30 shrink-0">{durText}</span>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <!-- Screenshots -->
      {#if shots.length > 0}
        <div class="flex flex-wrap gap-2.5 my-2.5">
          {#each shots as s}
            {@const src = '/api/image?path=' + encodeURIComponent(s.path)}
            {@const resolvedHash = s.hash || ssHashes[s.path] || null}
            <div
              class="cursor-pointer border rounded-lg overflow-hidden w-[180px] transition-colors duration-200 hover:border-primary {s.type === 'error' ? 'border-error' : 'border-base-content/10'}"
              onclick={(e) => openScreenshot(src, e)}
            >
              <img src={src} alt={s.label} loading="lazy" class="w-full h-auto block" />
              <div class="px-2 py-1.5 text-[10px] text-base-content/30 flex items-center gap-1.5 flex-wrap bg-base-200">
                <span class="truncate flex-1 min-w-0">{s.label}</span>
                {#if resolvedHash}
                  <HashBadge hash={resolvedHash} />
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Console Logs -->
      {#if consoleIssues.length > 0}
        <div class="border border-base-content/10 rounded-lg mb-2 overflow-hidden">
          <div
            class="flex items-center gap-2 px-3 py-2 cursor-pointer bg-base-200 hover:bg-base-200/80 transition-colors duration-100 text-xs"
            onclick={() => consoleOpen = !consoleOpen}
          >
            <span class="text-[9px] text-base-content/30 transition-transform duration-200 {consoleOpen ? 'rotate-90' : ''}">{'\u25B6'}</span>
            <span class="font-semibold text-base-content">Console</span>
            <div class="flex gap-2.5 ml-auto items-center">
              {#if consoleErrors > 0}
                <span class="text-error text-xs">Errors: <strong>{consoleErrors}</strong></span>
              {/if}
              {#if consoleWarns > 0}
                <span class="text-base-content/30 text-xs">Warnings: <strong>{consoleWarns}</strong></span>
              {/if}
            </div>
            <CopyButton getText={() => consoleIssues.map(l => '[' + l.type + '] ' + l.text).join('\n')} />
          </div>
          {#if consoleOpen}
            <div class="max-h-[400px] overflow-y-auto">
              {#each consoleIssues as l}
                <div class="px-3 py-1 text-[10px] font-mono border-b border-base-content/5 break-all {l.type === 'error' ? 'text-error' : 'text-warning'}">
                  [{l.type}] {l.text}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <!-- Network Errors -->
      {#if test.networkErrors?.length}
        <div class="border border-base-content/10 rounded-lg mb-2 overflow-hidden">
          <div
            class="flex items-center gap-2 px-3 py-2 cursor-pointer bg-base-200 hover:bg-base-200/80 transition-colors duration-100 text-xs"
            onclick={() => netErrorsOpen = !netErrorsOpen}
          >
            <span class="text-[9px] text-base-content/30 transition-transform duration-200 {netErrorsOpen ? 'rotate-90' : ''}">{'\u25B6'}</span>
            <span class="font-semibold text-base-content">Network Errors</span>
            <div class="flex gap-2.5 ml-auto items-center">
              <span class="text-error text-xs">Errors: <strong>{test.networkErrors.length}</strong></span>
            </div>
            <CopyButton getText={() => test.networkErrors.map(ne => '[' + ne.error + '] ' + ne.url).join('\n')} />
          </div>
          {#if netErrorsOpen}
            <div class="max-h-[400px] overflow-y-auto">
              {#each test.networkErrors as ne}
                <div class="px-3 py-1 text-[10px] font-mono text-error border-b border-base-content/5 break-all">
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
