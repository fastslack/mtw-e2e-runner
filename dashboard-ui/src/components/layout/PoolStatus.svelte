<script>
  import { onMount } from 'svelte';
  import { api } from '../../lib/api/client.js';
  import { wsState } from '../../lib/stores/websocket.svelte.js';

  let poolData = $state(null);

  export function updatePool(d) { poolData = d; }

  onMount(() => {
    api('/api/status').then(d => { if (d.pool) poolData = d.pool; }).catch(() => {});
  });

  let isOnline = $derived(
    poolData
      ? (poolData.availableCount > 0 || (!poolData.error && poolData.available))
      : false
  );

  let label = $derived.by(() => {
    if (!poolData) return 'Checking...';
    if (poolData.pools?.length > 1) return poolData.availableCount + '/' + poolData.totalPools + ' ready';
    const p = poolData.pools?.[0] || poolData;
    return p.error ? 'Offline' : p.available ? 'Ready' : 'Busy';
  });

  let sessions = $derived.by(() => {
    if (!poolData) return '0/0';
    if (poolData.pools?.length > 1) return (poolData.totalRunning || 0) + '/' + (poolData.totalMaxConcurrent || 0);
    const p = poolData.pools?.[0] || poolData;
    return (p.running || 0) + '/' + (p.maxConcurrent || 0);
  });

  let multiPools = $derived(poolData?.pools?.length > 1 ? poolData.pools : []);
</script>

<div class="mt-auto px-4 py-4">
  <!-- Divider -->
  <div class="h-px bg-gradient-to-r from-transparent via-base-content/8 to-transparent mb-4"></div>

  <!-- System Status -->
  <div class="text-[9px] font-semibold text-base-content/25 uppercase tracking-[0.15em] font-sans mb-2.5 max-md:hidden">System</div>

  <div class="flex flex-col gap-2 text-[11px] max-md:items-center">
    <!-- Chrome Pool -->
    <div class="flex items-center gap-2">
      <span class="relative flex h-2 w-2 shrink-0">
        {#if isOnline}
          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-40"></span>
          <span class="relative inline-flex rounded-full h-2 w-2 bg-success shadow-[0_0_6px_oklch(var(--su)/0.5)]"></span>
        {:else}
          <span class="relative inline-flex rounded-full h-2 w-2 bg-error shadow-[0_0_6px_oklch(var(--er)/0.5)]"></span>
        {/if}
      </span>
      <span class="text-base-content/60 font-sans max-md:hidden">
        Pool: <strong class="text-base-content font-semibold">{label}</strong>
      </span>
    </div>

    <!-- Sessions -->
    <div class="flex items-center gap-2 max-md:hidden">
      <span class="w-2 shrink-0"></span>
      <span class="text-base-content/40 font-mono text-[10px]">
        Sessions: <strong class="text-base-content/70">{sessions}</strong>
      </span>
    </div>

    <!-- WebSocket -->
    <div class="flex items-center gap-2">
      <span class="inline-flex rounded-full h-2 w-2 shrink-0
        {wsState.connected
          ? 'bg-success shadow-[0_0_6px_oklch(var(--su)/0.4)]'
          : 'bg-error shadow-[0_0_6px_oklch(var(--er)/0.4)]'}"></span>
      <span class="text-base-content/40 font-mono text-[10px] max-md:hidden">
        WS: <strong class="{wsState.connected ? 'text-success/80' : 'text-error/80'}">{wsState.connected ? 'connected' : 'disconnected'}</strong>
      </span>
    </div>
  </div>

  <!-- Multi-pool details -->
  {#if multiPools.length > 0}
    <div class="mt-3 flex flex-col gap-1 max-md:hidden">
      {#each multiPools as p}
        {@const plabel = (p.url || '').replace('ws://', '').replace('wss://', '')}
        {@const ok = !p.error && p.available}
        <div class="flex items-center gap-2 text-[10px] text-base-content/35 font-mono py-0.5 pl-4">
          <span class="inline-block w-1.5 h-1.5 rounded-full shrink-0
            {ok ? 'bg-success shadow-[0_0_4px_oklch(var(--su)/0.4)]' : 'bg-error shadow-[0_0_4px_oklch(var(--er)/0.4)]'}"></span>
          <span class="text-base-content/50 font-medium truncate">{plabel}</span>
          <span class="ml-auto text-[9px] text-base-content/25">{(p.running || 0)}/{(p.maxConcurrent || 0)}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>
