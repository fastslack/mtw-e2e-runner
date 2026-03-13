<script>
  let { tabs = [], activeTab = '', onTabChange = () => {} } = $props();
</script>

<div class="tabs tabs-bordered mb-5" role="tablist">
  {#each tabs as tab}
    <button
      class="tab font-mono text-[11px] font-medium {activeTab === tab.id ? 'tab-active text-primary' : 'text-base-content/30'}"
      role="tab"
      onclick={() => onTabChange(tab.id)}
    >
      {tab.label}
      {#if tab.badge !== undefined}
        <span class="badge badge-sm badge-neutral ml-1.5">{tab.badge}</span>
      {/if}
    </button>
  {/each}
</div>
