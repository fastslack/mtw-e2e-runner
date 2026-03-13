<script>
  import { onMount } from 'svelte';

  let { message, type = 'info', timeout = 5000, onDismiss = () => {} } = $props();
  let fading = $state(false);

  const icons = { success: '\u2714', error: '\u2718', info: '\u2139' };

  const alertClass = {
    success: 'alert-success',
    error: 'alert-error',
    info: 'alert-info',
  };

  onMount(() => {
    const t = setTimeout(() => {
      fading = true;
      setTimeout(onDismiss, 300);
    }, timeout);
    return () => clearTimeout(t);
  });
</script>

<div class="alert {alertClass[type] || 'alert-info'} py-2 px-4 font-mono text-[11px] font-medium shadow-lg min-w-[200px] max-w-[380px] flex items-center gap-2 animate-[toastIn_0.3s_ease] {fading ? 'animate-[toastOut_0.3s_ease_forwards]' : ''}">
  <span>{icons[type] || ''}</span>
  <span>{message}</span>
</div>
