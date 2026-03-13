<script>
  import { toasts } from '../../lib/stores/toast.svelte.js';
</script>

<div class="toast toast-end toast-bottom z-[300] pointer-events-none">
  {#each toasts as toast (toast.id)}
    <div class="alert {toast.type === 'success' ? 'alert-success' : toast.type === 'error' ? 'alert-error' : 'alert-info'} py-2 px-4 font-mono text-[11px] font-medium shadow-lg min-w-[200px] max-w-[380px] pointer-events-auto animate-[toastIn_0.3s_ease]">
      <span>{toast.type === 'success' ? '\u2714' : toast.type === 'error' ? '\u2718' : '\u2139'}</span>
      <span>{toast.message}</span>
    </div>
  {/each}
</div>
