<script>
  let { hash } = $props();
  let copied = $state(false);

  function copy(e) {
    e.stopPropagation();
    navigator.clipboard.writeText('ss:' + hash).then(() => {
      copied = true;
      setTimeout(() => copied = false, 1200);
    });
  }
</script>

<span
  class="badge badge-sm font-mono text-[9px] font-medium cursor-pointer select-none transition-all duration-150 gap-1
    {copied ? 'badge-success badge-outline' : 'badge-neutral badge-outline hover:badge-primary hover:badge-outline'}"
  onclick={copy}
>
  <span class="text-[10px] leading-none">{'\u2318'}</span>
  ss:{hash}
</span>
