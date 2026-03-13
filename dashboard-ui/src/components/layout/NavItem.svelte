<script>
  let { view, icon, label, active = false, badge = '', badgeId = '', isLive = false, onclick = () => {} } = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
  class="group flex items-center gap-2.5 px-3 py-2 text-[12px] cursor-pointer rounded-lg transition-all duration-200 relative
    {active
      ? 'text-primary bg-primary/8'
      : 'text-base-content/40 hover:text-base-content/70 hover:bg-base-content/4'}"
  data-view={view}
  onclick={onclick}
>
  <!-- Active indicator bar -->
  {#if active}
    <div class="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full bg-primary shadow-[0_0_8px_oklch(var(--p)/0.4)]"></div>
  {/if}

  <span class="w-5 text-center not-italic text-[13px] shrink-0 {active ? 'drop-shadow-[0_0_6px_oklch(var(--p)/0.4)]' : ''}">
    {#if isLive}
      <span class="inline-block w-2 h-2 rounded-full bg-primary animate-pulse shadow-[0_0_8px_oklch(var(--p)/0.5)]"></span>
    {:else}
      {icon}
    {/if}
  </span>

  <span class="font-sans font-medium max-md:hidden {active ? '' : ''}">{label}</span>

  {#if badgeId}
    <span
      class="badge badge-xs ml-auto max-md:hidden font-mono text-[9px] font-semibold border-0
        {active ? 'bg-primary/15 text-primary' : 'bg-base-content/6 text-base-content/30'}"
      id="badge{badgeId}"
    >-</span>
  {/if}

  {#if isLive}
    <span
      class="badge badge-xs ml-auto max-md:hidden font-mono text-[9px] font-semibold bg-primary/15 text-primary border-0"
      id="liveBadge"
    >0</span>
  {/if}
</div>
