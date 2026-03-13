<script>
  import { onMount } from 'svelte';
  import { live } from '../../lib/stores/state.svelte.js';
  import { dur } from '../../lib/utils/format.js';
  import { ssHash } from '../../lib/utils/hash.js';
  import HashBadge from '../../components/shared/HashBadge.svelte';

  let { name, test, runId, tick = 0 } = $props();

  let actionsEl = $state(null);
  let ssOpen = $state(false);
  let netOpen = $state(false);

  let testKey = $derived(runId + '::' + name);
  let isFinished = $derived(test.status === 'passed' || test.status === 'failed');
  let isCollapsed = $derived(isFinished && live.collapsed.has(testKey));

  let iconText = $derived(
    test.status === 'passed' ? '\u2714' :
    test.status === 'failed' ? '\u2718' : '\u25CF'
  );

  let borderClass = $derived.by(() => {
    if (test.status === 'running') return 'border-l-primary';
    if (test.status === 'passed') return 'border-l-success';
    if (test.status === 'failed') return 'border-l-error';
    return 'border-l-base-content/30';
  });

  let iconColorClass = $derived.by(() => {
    if (test.status === 'passed') return 'text-success';
    if (test.status === 'failed') return 'text-error';
    return 'text-primary';
  });

  let meta = $derived.by(() => {
    void tick;
    if (test.status === 'running') {
      if (test.retry) return 'Retry ' + test.retry;
      return test.actionType ? ('Step ' + (test.actions || 0) + '/' + (test.totalActions || '?')) : 'starting...';
    }
    if (test.status === 'passed') return test.duration || 'done';
    if (test.status === 'failed') return test.error || 'failed';
    return '';
  });

  let actionLog = $derived.by(() => {
    void tick;
    return test.actionLog || [];
  });

  let allScreenshots = $derived.by(() => {
    void tick;
    const ss = (test.screenshots || []).slice();
    if (test.errorScreenshot) ss.push(test.errorScreenshot);
    return ss;
  });

  let networkLogs = $derived.by(() => {
    void tick;
    return test.networkLogs || [];
  });

  let netErrCount = $derived(networkLogs.filter(n => n.status >= 400).length);

  // Track hashes for screenshots
  let ssHashes = $state({});

  $effect(() => {
    for (const ssPath of allScreenshots) {
      if (!ssHashes[ssPath]) {
        ssHash(ssPath).then(h => {
          ssHashes[ssPath] = h;
          ssHashes = ssHashes; // trigger reactivity
        });
      }
    }
  });

  // Auto-scroll action log to bottom
  $effect(() => {
    void actionLog.length;
    if (actionsEl && !isCollapsed) {
      actionsEl.scrollTop = actionsEl.scrollHeight;
    }
  });

  function toggleCollapse() {
    if (!isFinished) return;
    if (window.getSelection().toString()) return;
    if (live.collapsed.has(testKey)) {
      live.collapsed.delete(testKey);
    } else {
      live.collapsed.add(testKey);
    }
  }

  function toggleSS(e) {
    e.stopPropagation();
    ssOpen = !ssOpen;
  }

  function toggleNet(e) {
    e.stopPropagation();
    netOpen = !netOpen;
  }

  function openScreenshot(ssPath, fname) {
    if (globalThis.__openModal) {
      globalThis.__openModal('/api/image?path=' + encodeURIComponent(ssPath));
    }
  }

  function actionDetail(a) {
    return a.narrative || a.selector || a.value || a.text || '';
  }

  function actionDur(a) {
    if (a.duration == null) return '';
    return a.duration < 1000 ? a.duration + 'ms' : (a.duration / 1000).toFixed(1) + 's';
  }

  // Network detail expand
  let expandedNetRows = $state(new Set());

  function toggleNetRow(idx, e) {
    e.stopPropagation();
    if (expandedNetRows.has(idx)) {
      expandedNetRows.delete(idx);
    } else {
      expandedNetRows.add(idx);
    }
    expandedNetRows = new Set(expandedNetRows);
  }

  function prettyBody(body) {
    if (!body) return '';
    try { return JSON.stringify(JSON.parse(body), null, 2); } catch { return body; }
  }

  function fmtHeaders(h) {
    if (!h || typeof h !== 'object') return '';
    return Object.keys(h).map(k => k + ': ' + h[k]).join('\n');
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="card card-compact bg-base-200 border-l-[3px] text-[11px] transition-all duration-200 {borderClass}"
  class:cursor-pointer={isCollapsed}
  class:hover:bg-base-300={isCollapsed}
  class:py-1.5={isCollapsed}
  onclick={toggleCollapse}
>
  <div class="card-body p-2.5 gap-1">
    <!-- Test name row -->
    <div class="flex items-center gap-1.5 font-semibold">
      {#if test.status === 'running'}
        <span class="loading loading-spinner loading-xs text-primary"></span>
      {:else}
        <span class="text-xs shrink-0 {iconColorClass}">{iconText}</span>
      {/if}
      <span class="truncate min-w-0">{name}</span>
      {#if test.serial}
        <span class="badge badge-xs bg-primary/15 text-primary border-none font-semibold uppercase tracking-wide text-[8px]">Serial</span>
      {/if}
      {#if test.poolUrl}
        <span class="badge badge-xs bg-info/10 text-info border-none font-mono font-normal text-[8px]">{test.poolUrl.replace('ws://', '').replace('wss://', '')}</span>
      {/if}
      {#if test.retry}
        <span class="badge badge-xs badge-warning font-mono font-semibold text-[8px]">{'\u21BB'} {test.retry}</span>
      {/if}
      {#if isCollapsed}
        <div class="flex items-center gap-2 ml-auto font-mono text-[10px]">
          <span class="text-base-content/60">{test.duration || ''}</span>
          <span class="text-primary text-[9px] opacity-60">{'\u25BC'}</span>
        </div>
      {:else if isFinished}
        <div class="flex items-center gap-2 ml-auto font-mono text-[10px]">
          <span class="text-base-content/60">{test.duration || ''}</span>
          <span class="text-primary text-[9px] opacity-60">{'\u25B2'}</span>
        </div>
      {/if}
    </div>

    <!-- Meta info -->
    {#if !isCollapsed}
      <div class="text-base-content/50 text-[10px]">{meta}</div>

      <!-- Action log -->
      <div class="max-h-[260px] overflow-y-auto border-t border-base-300 pt-1.5 mt-1" bind:this={actionsEl}>
        {#if actionLog.length > 0}
          {#each actionLog as a}
            <div class="flex items-start gap-1.5 py-0.5 font-mono text-[10px] leading-relaxed {a.isPoolLog ? 'bg-info/5 border-l-2 border-info/30 pl-2' : ''}">
              <span class="shrink-0 w-3.5 text-center {a.isPoolLog ? 'text-indigo-400' : a.success ? 'text-success' : 'text-error'}">
                {a.isPoolLog ? '\uD83D\uDD17' : a.success ? '\u2714' : '\u2718'}
              </span>
              <span class="shrink-0 font-semibold {a.isPoolLog ? 'text-indigo-400' : 'text-primary'}">{a.isPoolLog ? 'pool' : a.type}</span>
              <span class="flex-1 min-w-0 text-base-content/50 whitespace-pre-wrap break-words">{a.isPoolLog ? a.narrative : actionDetail(a)}</span>
              {#if a.actionRetries && a.actionRetries > 0}
                <span class="badge badge-warning badge-xs font-mono text-[9px]">{'\u21BB'} x{a.actionRetries}</span>
              {/if}
              {#if !a.isPoolLog}
                <span class="shrink-0 ml-auto text-base-content/30">{actionDur(a)}</span>
              {/if}
            </div>
          {/each}
          {#if test.status === 'running' && test.actions < test.totalActions}
            <div class="flex items-start gap-1.5 py-0.5 font-mono text-[10px]">
              <span class="shrink-0 w-3.5 text-center text-primary"><span class="loading loading-spinner" style="width:8px;height:8px"></span></span>
              <span class="opacity-60">waiting...</span>
            </div>
          {/if}
        {:else if test.status === 'running'}
          <div class="flex items-start gap-1.5 py-0.5 font-mono text-[10px]">
            <span class="shrink-0 w-3.5 text-center text-primary"><span class="loading loading-spinner" style="width:8px;height:8px"></span></span>
            <span class="opacity-60">connecting...</span>
          </div>
        {/if}
      </div>

      <!-- Screenshots -->
      {#if allScreenshots.length > 0}
        <div class="border-t border-base-300 mt-1.5 pt-1.5">
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="flex items-center gap-1.5 cursor-pointer font-mono text-[10px] text-base-content/30 py-0.5 select-none hover:text-base-content"
            onclick={toggleSS}
          >
            <span class="text-[8px] transition-transform duration-200 {ssOpen ? 'rotate-90' : ''}">{'\u25B6'}</span>
            <span>Screenshots ({allScreenshots.length})</span>
          </div>
          {#if ssOpen}
            <div class="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-1.5 pt-1.5">
              {#each allScreenshots as ssPath}
                {@const fname = ssPath.split('/').pop()}
                {@const isErr = test.errorScreenshot && ssPath === test.errorScreenshot}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div class="flex flex-col">
                  <div
                    class="relative rounded-sm overflow-hidden cursor-pointer aspect-[16/10] bg-base-300 border {isErr ? 'border-error hover:shadow-[0_0_0_1px] hover:shadow-error' : 'border-base-300 hover:border-primary hover:shadow-[0_0_0_1px] hover:shadow-primary'}"
                    onclick={(e) => { e.stopPropagation(); openScreenshot(ssPath, fname); }}
                  >
                    <img
                      src="/api/image?path={encodeURIComponent(ssPath)}"
                      alt={fname}
                      loading="lazy"
                      class="w-full h-full object-cover block"
                    />
                  </div>
                  <div class="flex items-center justify-center gap-1 flex-wrap text-center font-mono text-[8px] text-base-content/30 pt-0.5 px-0.5">
                    <span class="truncate">{fname}</span>
                    {#if ssHashes[ssPath]}
                      <HashBadge hash={ssHashes[ssPath]} />
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <!-- Network panel -->
      {#if networkLogs.length > 0}
        <div class="border-t border-base-300 mt-1.5 pt-1.5">
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="flex items-center gap-2 cursor-pointer font-mono text-[10px] text-base-content/30 py-0.5 select-none hover:text-base-content"
            onclick={toggleNet}
          >
            <span class="text-[8px] transition-transform duration-200 {netOpen ? 'rotate-90' : ''}">{'\u25B6'}</span>
            <span class="font-semibold text-base-content/60">Network Requests</span>
            <div class="flex gap-2.5 ml-auto">
              <span class="text-[9px] text-base-content/30">Total: <strong class="text-base-content/60">{networkLogs.length}</strong></span>
              {#if netErrCount > 0}
                <span class="text-[9px] text-error">Errors: <strong>{netErrCount}</strong></span>
              {/if}
            </div>
          </div>
          {#if netOpen}
            <div class="max-h-[300px] overflow-y-auto">
              <!-- Column headers -->
              <div class="grid grid-cols-[20px_50px_44px_1fr_50px] gap-1 text-[9px] font-semibold text-base-content/30 uppercase tracking-wide py-1 border-b border-base-300 sticky top-0 bg-base-200">
                <span></span>
                <span>Method</span>
                <span>Status</span>
                <span>URL</span>
                <span>Time</span>
              </div>
              {#each networkLogs as n, idx}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div>
                  <div
                    class="grid grid-cols-[20px_50px_44px_1fr_50px] gap-1 font-mono text-[10px] py-0.5 border-b border-base-content/[0.03] cursor-pointer transition-colors hover:bg-base-300 {n.status >= 400 ? 'text-error' : ''}"
                    onclick={(e) => toggleNetRow(idx, e)}
                  >
                    <span class="text-[7px] opacity-50 text-center">{expandedNetRows.has(idx) ? '\u25BC' : '\u25B6'}</span>
                    <span>{n.method || 'GET'}</span>
                    <span class="{n.status >= 400 ? 'text-error font-semibold' : 'text-base-content/60'}">{n.status || '--'}</span>
                    <span class="truncate text-base-content/50" title={n.url}>{n.url || ''}</span>
                    <span class="text-right text-base-content/30">{n.duration != null ? dur(n.duration) : '--'}</span>
                  </div>
                  {#if expandedNetRows.has(idx)}
                    <div class="py-1.5 px-2 pl-6 bg-black/15 border-b border-base-300 text-[9px]">
                      {#if n.requestHeaders || n.responseHeaders}
                        <div class="mb-1.5">
                          <strong class="block text-base-content/60 text-[9px] mb-0.5">Headers</strong>
                          {#if n.requestHeaders}
                            <div class="ml-2 my-0.5 mb-1">
                              <em class="block text-base-content/30 text-[8px] mb-0.5">Request:</em>
                              <pre class="m-0 p-1 px-1.5 bg-base-300 rounded-sm font-mono text-[9px] text-base-content/60 whitespace-pre-wrap break-all max-h-[150px] overflow-y-auto">{fmtHeaders(n.requestHeaders)}</pre>
                            </div>
                          {/if}
                          {#if n.responseHeaders}
                            <div class="ml-2 my-0.5 mb-1">
                              <em class="block text-base-content/30 text-[8px] mb-0.5">Response:</em>
                              <pre class="m-0 p-1 px-1.5 bg-base-300 rounded-sm font-mono text-[9px] text-base-content/60 whitespace-pre-wrap break-all max-h-[150px] overflow-y-auto">{fmtHeaders(n.responseHeaders)}</pre>
                            </div>
                          {/if}
                        </div>
                      {/if}
                      {#if n.requestBody || n.responseBody}
                        <div class="mb-1.5">
                          <strong class="block text-base-content/60 text-[9px] mb-0.5">Body</strong>
                          {#if n.requestBody}
                            <div class="ml-2 my-0.5 mb-1">
                              <em class="block text-base-content/30 text-[8px] mb-0.5">Request:</em>
                              <pre class="m-0 p-1 px-1.5 bg-base-300 rounded-sm font-mono text-[9px] text-base-content/60 whitespace-pre-wrap break-all max-h-[150px] overflow-y-auto">{prettyBody(n.requestBody)}</pre>
                            </div>
                          {/if}
                          {#if n.responseBody}
                            <div class="ml-2 my-0.5 mb-1">
                              <em class="block text-base-content/30 text-[8px] mb-0.5">Response:</em>
                              <pre class="m-0 p-1 px-1.5 bg-base-300 rounded-sm font-mono text-[9px] text-base-content/60 whitespace-pre-wrap break-all max-h-[150px] overflow-y-auto">{prettyBody(n.responseBody)}</pre>
                            </div>
                          {/if}
                        </div>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    {/if}
  </div>
</div>
