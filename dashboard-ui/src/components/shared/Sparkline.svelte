<script>
  let { data = [] } = $props();

  let points = $derived.by(() => {
    if (data.length < 2) return '';
    const n = data.length;
    const w = 200 / (n - 1 || 1);
    return data.map((v, i) => `${i * w},${40 - v * 0.4}`).join(' ');
  });

  let fillPoints = $derived.by(() => {
    if (data.length < 2) return '';
    const n = data.length;
    const w = 200 / (n - 1 || 1);
    const pts = data.map((v, i) => `${i * w},${40 - v * 0.4}`).join(' ');
    return `0,40 ${pts} ${(n - 1) * w},40`;
  });

  let lastDot = $derived.by(() => {
    if (!data.length) return null;
    const n = data.length;
    const w = 200 / (n - 1 || 1);
    const v = data[n - 1];
    return { cx: (n - 1) * w, cy: 40 - v * 0.4, color: v >= 90 ? 'oklch(var(--su))' : v >= 70 ? 'oklch(var(--wa))' : 'oklch(var(--er))' };
  });
</script>

<div class="w-full h-full block">
  <svg viewBox="0 0 200 40" preserveAspectRatio="none" class="w-full h-full block">
    {#if data.length >= 2}
      <polygon points={fillPoints} fill="oklch(var(--p) / 0.15)" />
      <polyline points={points} fill="none" stroke="oklch(var(--p))" stroke-width="1.5" />
      {#if lastDot}
        <circle cx={lastDot.cx} cy={lastDot.cy} r="3" fill={lastDot.color} />
      {/if}
    {/if}
  </svg>
</div>
