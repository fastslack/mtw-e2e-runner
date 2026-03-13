<script>
  let { tests = {} } = $props();

  const poolColors = [
    'oklch(var(--p))',
    'oklch(var(--su))',
    'oklch(var(--wa))',
    'oklch(var(--er))',
    '#8b5cf6',
    '#06b6d4',
    '#f97316',
    '#ec4899'
  ];

  let segments = $derived.by(() => {
    const entries = Object.entries(tests);
    if (entries.length === 0) return [];
    const total = entries.reduce((sum, [, count]) => sum + count, 0);
    if (total === 0) return [];
    return entries.map(([pool, count], i) => ({
      pool,
      count,
      pct: (count / total) * 100,
      color: poolColors[i % poolColors.length]
    }));
  });

  let total = $derived(segments.reduce((sum, s) => sum + s.count, 0));
</script>

<div class="space-y-1.5">
  <div class="flex h-2 rounded-full overflow-hidden bg-base-300">
    {#each segments as seg}
      <div
        class="h-full transition-all duration-300"
        style="width:{seg.pct}%;background:{seg.color}"
        title="{seg.pool}: {seg.count} tests ({seg.pct.toFixed(1)}%)"
      ></div>
    {/each}
  </div>
  <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
    {#each segments as seg}
      <span class="flex items-center gap-1 text-[10px] text-base-content/50 font-mono">
        <span class="inline-block w-2 h-2 rounded-full flex-shrink-0" style="background:{seg.color}"></span>
        {seg.pool}: {seg.count}
      </span>
    {/each}
    {#if total > 0}
      <span class="text-[10px] text-base-content/30 font-mono ml-auto">Total: {total}</span>
    {/if}
  </div>
</div>
