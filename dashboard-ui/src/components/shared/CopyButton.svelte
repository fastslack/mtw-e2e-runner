<script>
  let { getText } = $props();
  let label = $state('\u2398 Copy');
  let isCopied = $state(false);

  function copy(e) {
    e.stopPropagation();
    const text = typeof getText === 'function' ? getText() : String(getText);
    navigator.clipboard.writeText(text).then(() => {
      label = '\u2713 Copied';
      isCopied = true;
      setTimeout(() => { label = '\u2398 Copy'; isCopied = false; }, 1200);
    });
  }
</script>

<button
  class="btn btn-ghost btn-xs font-mono text-[9px] font-medium select-none transition-all duration-150
    {isCopied ? 'text-success' : 'text-base-content/30 hover:text-primary'}"
  onclick={copy}
>{label}</button>
