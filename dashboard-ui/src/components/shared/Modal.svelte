<script>
  let { src = '', open = false, onClose = () => {} } = $props();
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="modal modal-open" onclick={onClose}>
    <div class="modal-box max-w-[90vw] max-h-[90vh] p-4 bg-transparent shadow-none flex items-center justify-center" onclick={(e) => e.stopPropagation()}>
      <img src={src} alt="" class="max-w-full max-h-[85vh] rounded-lg" />
    </div>
    <div class="modal-backdrop" onclick={onClose}></div>
  </div>
{/if}
