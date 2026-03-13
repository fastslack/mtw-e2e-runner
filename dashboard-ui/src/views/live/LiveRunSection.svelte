<script>
  import TriggerBadge from '../../components/shared/TriggerBadge.svelte';
  import LiveTestCard from './LiveTestCard.svelte';

  let { runId, run, tick = 0, onDismiss = () => {} } = $props();

  let projLabel = $derived(run.project || (run.cwd ? run.cwd.split('/').pop() : 'Run'));
  let runStatus = $derived(run.done ? (run.failed > 0 ? 'fail' : 'pass') : 'running');
  let canDismiss = $derived(run.done || !run.on);

  let testEntries = $derived.by(() => {
    void tick;
    return Object.entries(run.tests).filter(([name]) => name !== '__error');
  });

  let poolDistribution = $derived.by(() => {
    const pools = {};
    for (const [, t] of testEntries) {
      if (t.poolUrl) {
        const label = t.poolUrl.replace('ws://', '').replace('wss://', '');
        pools[label] = (pools[label] || 0) + 1;
      }
    }
    const keys = Object.keys(pools);
    return keys.length > 1 ? pools : null;
  });

  let headerBorderClass = $derived.by(() => {
    if (runStatus === 'pass') return 'border-l-success bg-success/5 text-success';
    if (runStatus === 'fail') return 'border-l-error bg-error/5 text-error';
    return 'border-l-primary bg-primary/5 text-primary';
  });

  const poolColors = [
    'oklch(var(--p))', 'oklch(var(--su))', 'oklch(var(--wa))', 'oklch(var(--er))',
    '#8b5cf6', '#06b6d4', '#f97316', '#ec4899'
  ];
</script>

<div class="mb-2">
  <!-- Section header -->
  <div class="flex items-center gap-2 px-3.5 py-2 my-1.5 rounded-md font-mono text-xs font-bold border-l-[3px] {headerBorderClass}">
    <span class="tracking-wide">{projLabel}</span>
    {#if run.triggeredBy}
      <TriggerBadge source={run.triggeredBy} />
    {/if}
    <span class="flex items-center gap-1 text-[10px] text-base-content/50 font-normal ml-auto">
      <span>{run.completed}/{run.total}</span>
      {#if run.failed > 0}
        <span class="text-error ml-1.5">{run.failed} failed</span>
      {/if}
      {#if run.on}
        <span class="loading loading-spinner loading-xs ml-1.5"></span>
      {/if}
    </span>
    {#if canDismiss}
      <button
        class="btn btn-ghost btn-xs px-1.5 text-[9px] font-mono text-base-content/30 hover:text-error hover:bg-error/10"
        onclick={(e) => { e.stopPropagation(); onDismiss(runId); }}
      >{'\u2715'}</button>
    {/if}
  </div>

  <!-- Pool distribution bar -->
  {#if poolDistribution}
    {@const entries = Object.entries(poolDistribution)}
    {@const total = entries.reduce((sum, [, c]) => sum + c, 0)}
    <div class="px-3.5 pt-1 pb-0.5">
      <div class="flex h-1 rounded-sm overflow-hidden bg-base-300 mb-1">
        {#each entries as [pool, count], i}
          <div
            class="h-full transition-[width] duration-300"
            style="width:{(count / total) * 100}%;background:{poolColors[i % poolColors.length]}"
            title="{pool}: {count} tests"
          ></div>
        {/each}
      </div>
      <div class="flex gap-2.5 flex-wrap text-[9px] text-base-content/30">
        {#each entries as [pool, count], i}
          <span class="flex items-center gap-1">
            <span class="inline-block w-1.5 h-1.5 rounded-full shrink-0" style="background:{poolColors[i % poolColors.length]}"></span>
            {pool}: {count}
          </span>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Test cards grid -->
  <div class="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-2 py-1 pb-2">
    {#each testEntries as [name, test] (name)}
      <LiveTestCard {name} {test} {runId} {tick} />
    {/each}
  </div>
</div>
