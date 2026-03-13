<script>
  import { dur, prettyJson, fmtHeaders } from '../../lib/utils/format.js';

  let { networkLogs = [] } = $props();

  let panelOpen = $state(false);
  let expandedRows = $state(new Set());

  let errCount = $derived(networkLogs.filter(n => n.status >= 400).length);

  function toggleRow(idx) {
    const next = new Set(expandedRows);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    expandedRows = next;
  }

  function extractGqlOp(n) {
    if (!n.requestBody) return null;
    try {
      const body = typeof n.requestBody === 'string' ? JSON.parse(n.requestBody) : n.requestBody;
      return body.operationName || null;
    } catch { return null; }
  }

  function shortUrl(url) {
    if (!url) return '';
    try {
      const u = new URL(url);
      return u.pathname + u.search;
    } catch { return url; }
  }
</script>

<div class="collapse collapse-arrow border border-base-300 rounded-lg mb-2 bg-base-200">
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="collapse-title flex items-center gap-2 py-2 px-3 text-[11px] min-h-0 cursor-pointer"
    onclick={() => panelOpen = !panelOpen}
  >
    <span class="text-[9px] text-base-content/30 transition-transform duration-200 {panelOpen ? 'rotate-90' : ''}">{'\u25B6'}</span>
    <span class="font-semibold text-base-content">Network Requests</span>
    <div class="flex gap-2.5 ml-auto items-center">
      <span class="text-base-content/30 text-[11px]">Total: <strong class="text-base-content">{networkLogs.length}</strong></span>
      {#if errCount > 0}
        <span class="text-error text-[11px]">Errors: <strong>{errCount}</strong></span>
      {/if}
    </div>
  </div>

  {#if panelOpen}
    <div class="max-h-[500px] overflow-y-auto">
      <!-- Column headers -->
      <div class="grid grid-cols-[24px_56px_48px_1fr_56px] px-3 py-1.5 text-[9px] font-semibold text-base-content/30 uppercase tracking-wider border-b border-base-300 bg-base-200 sticky top-0 z-10">
        <span></span>
        <span>Method</span>
        <span>Status</span>
        <span>URL</span>
        <span class="text-right">Time</span>
      </div>

      {#each networkLogs as n, idx}
        {@const isErr = n.status >= 400}
        {@const gqlOp = extractGqlOp(n)}
        {@const isOpen = expandedRows.has(idx)}

        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <div
          class="grid grid-cols-[24px_56px_48px_1fr_56px] px-3 py-1.5 text-[10px] font-mono border-b border-base-300 cursor-pointer transition-colors duration-100 items-center hover:bg-base-300 {isErr ? 'bg-error/5' : ''}"
          onclick={() => toggleRow(idx)}
        >
          <span class="text-[8px] text-base-content/30">{isOpen ? '\u25BC' : '\u25B6'}</span>
          <span class="font-semibold text-primary">{n.method || 'GET'}</span>
          <span class="font-semibold {isErr ? 'text-error' : ''}">{n.status || '-'}</span>
          <span class="overflow-hidden text-ellipsis whitespace-nowrap text-base-content/50" title={n.url}>
            {gqlOp ? 'GQL: ' + gqlOp : shortUrl(n.url)}
          </span>
          <span class="text-base-content/30 text-right">{n.duration != null ? dur(n.duration) : '-'}</span>
        </div>

        {#if isOpen}
          <div class="py-2 px-3 pl-9 bg-base-100 border-b border-base-300 space-y-2">
            {#if n.requestHeaders}
              <div>
                <div class="text-[9px] font-semibold text-base-content/30 uppercase tracking-wider mb-1">Request Headers</div>
                <pre class="text-[10px] font-mono text-base-content/50 bg-base-200 p-2 rounded-md overflow-x-auto whitespace-pre-wrap break-all m-0 max-h-[200px] overflow-y-auto">{fmtHeaders(n.requestHeaders)}</pre>
              </div>
            {/if}
            {#if n.requestBody}
              <div>
                <div class="text-[9px] font-semibold text-base-content/30 uppercase tracking-wider mb-1">Request Body</div>
                <pre class="text-[10px] font-mono text-base-content/50 bg-base-200 p-2 rounded-md overflow-x-auto whitespace-pre-wrap break-all m-0 max-h-[200px] overflow-y-auto">{prettyJson(typeof n.requestBody === 'string' ? n.requestBody : JSON.stringify(n.requestBody))}</pre>
              </div>
            {/if}
            {#if n.responseHeaders}
              <div>
                <div class="text-[9px] font-semibold text-base-content/30 uppercase tracking-wider mb-1">Response Headers</div>
                <pre class="text-[10px] font-mono text-base-content/50 bg-base-200 p-2 rounded-md overflow-x-auto whitespace-pre-wrap break-all m-0 max-h-[200px] overflow-y-auto">{fmtHeaders(n.responseHeaders)}</pre>
              </div>
            {/if}
            {#if n.responseBody}
              <div>
                <div class="text-[9px] font-semibold text-base-content/30 uppercase tracking-wider mb-1">Response Body</div>
                <pre class="text-[10px] font-mono text-base-content/50 bg-base-200 p-2 rounded-md overflow-x-auto whitespace-pre-wrap break-all m-0 max-h-[200px] overflow-y-auto">{prettyJson(typeof n.responseBody === 'string' ? n.responseBody : JSON.stringify(n.responseBody))}</pre>
              </div>
            {/if}
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>
