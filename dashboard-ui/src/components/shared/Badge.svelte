<script>
  let { type = 'run', text = '' } = $props();

  const typeClass = {
    pass: 'badge-success',
    fail: 'badge-error',
    flaky: 'badge-warning',
    run: 'badge-info',
  };
</script>

<span class="badge badge-sm font-semibold {typeClass[type] || 'badge-ghost'}">{text}</span>
