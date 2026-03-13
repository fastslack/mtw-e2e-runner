<script>
  let { filters = [], activeFilter = 'all', onFilterChange = () => {}, searchValue = '', onSearchChange = () => {} } = $props();
</script>

<div class="flex items-center gap-2 mb-4 flex-wrap">
  <div class="join">
    {#each filters as f}
      <button
        class="join-item btn btn-sm font-mono text-[11px] {activeFilter === f.value ? 'btn-primary' : 'btn-ghost border border-base-300'}"
        onclick={() => onFilterChange(f.value)}
      >{f.label}</button>
    {/each}
  </div>
  <input
    type="text"
    placeholder="Search..."
    class="input input-sm input-bordered font-mono text-[11px] max-w-[200px] bg-base-200"
    value={searchValue}
    oninput={(e) => onSearchChange(e.target.value)}
  />
</div>
