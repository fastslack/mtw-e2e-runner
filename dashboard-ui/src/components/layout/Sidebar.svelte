<script>
  import { app } from '../../lib/stores/state.svelte.js';
  import { api } from '../../lib/api/client.js';
  import PoolStatus from './PoolStatus.svelte';
  import NavItem from './NavItem.svelte';

  let projects = $state([]);

  export function refreshProjects() {
    api('/api/db/projects').then(list => {
      if (Array.isArray(list)) projects = list;
    }).catch(() => {});
  }

  function selectProject(e) {
    app.project = e.target.value ? parseInt(e.target.value, 10) : null;
    app.selectedRun = null;
  }

  const navItems = [
    { view: 'watch', icon: '\u23F2', label: 'Watch' },
    { view: 'tests', icon: '\u25B7', label: 'Tests', badgeId: 'Suites' },
    { view: 'runs', icon: '\u2630', label: 'Runs', badgeId: 'Runs' },
    { view: 'learnings', icon: '\u2733', label: 'Learnings', badgeId: 'Learnings' },
    { view: 'live', icon: null, label: 'Live', isLive: true },
  ];
</script>

<aside class="fixed top-0 left-0 bottom-0 z-50 w-58 flex flex-col overflow-y-auto max-md:w-15
  bg-base-200 border-r border-base-content/6">

  <!-- Brand -->
  <div class="px-5 pt-6 pb-5 max-md:px-3 max-md:pt-4">
    <div class="flex items-center gap-2.5 max-md:justify-center">
      <div class="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="oklch(var(--p))" stroke-width="2.5" stroke-linecap="round">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
        </svg>
      </div>
      <div class="max-md:hidden">
        <h1 class="font-sans text-[14px] font-bold tracking-tight text-base-content">
          E2E <span class="text-primary">Runner</span>
        </h1>
        <div class="text-[9px] text-base-content/20 font-mono tracking-widest uppercase mt-px">Dashboard</div>
      </div>
    </div>
  </div>

  <!-- Divider -->
  <div class="mx-4 h-px bg-gradient-to-r from-transparent via-base-content/8 to-transparent max-md:mx-2"></div>

  <!-- Project Selector -->
  <div class="px-4 pt-4 pb-2 max-md:hidden">
    <label class="text-[9px] font-semibold text-base-content/25 uppercase tracking-[0.15em] block mb-2 font-sans">Project</label>
    <select
      class="select select-sm w-full font-mono text-[11px] bg-base-100/50 border-base-content/8 focus:border-primary/40 rounded-lg"
      onchange={selectProject}
      value={app.project || ''}
    >
      <option value="">All Projects</option>
      {#each projects as p}
        <option value={p.id}>{p.name}</option>
      {/each}
    </select>
  </div>

  <!-- Navigation -->
  <div class="px-4 pt-4 pb-1.5 max-md:hidden">
    <span class="text-[9px] font-semibold text-base-content/25 uppercase tracking-[0.15em] font-sans">Navigation</span>
  </div>
  <nav class="py-1 flex flex-col gap-0.5 px-2 max-md:px-1">
    {#each navItems as item}
      {#if item.isLive && !app.liveActive}
        <!-- Live hidden when no tests running -->
      {:else}
        <NavItem
          view={item.view}
          icon={item.icon}
          label={item.label}
          active={app.view === item.view}
          badgeId={item.badgeId || ''}
          isLive={item.isLive || false}
          onclick={() => { app.view = item.view; app._tab = null; }}
        />
      {/if}
    {/each}
  </nav>

  <!-- Pool Status -->
  <PoolStatus />
</aside>
