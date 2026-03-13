<script>
  let { source = 'unknown' } = $props();
  const labels = { dashboard: 'Dashboard', mcp: 'MCP', cli: 'CLI', watch: 'Watch', unknown: '--' };
  const icons = { dashboard: '\u{1F464}', mcp: '\u{1F916}', cli: '>_', watch: '\u23F1', unknown: '\u2022' };

  const colorClass = {
    dashboard: 'badge-ghost',
    mcp: 'badge-secondary',
    cli: 'badge-primary',
    watch: 'badge-warning',
    unknown: 'badge-ghost opacity-60',
  };
</script>

<span class="badge badge-sm font-semibold font-mono gap-1 {colorClass[source] || colorClass.unknown}">
  <span class="text-[11px] leading-none">{icons[source] || icons.unknown}</span>
  {labels[source] || source}
</span>
