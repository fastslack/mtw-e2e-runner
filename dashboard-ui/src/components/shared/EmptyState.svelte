<script>
  let { icon = '\u2605', message = '' } = $props();
</script>

<div class="text-center py-12 px-6 text-base-content/30">
  <div class="text-4xl mb-2 opacity-50">{icon}</div>
  <p class="text-sm">{message}</p>
</div>
