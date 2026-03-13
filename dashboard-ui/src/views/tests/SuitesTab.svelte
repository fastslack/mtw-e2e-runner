<script>
  import { app } from '../../lib/stores/state.svelte.js';
  import { api, triggerRun } from '../../lib/api/client.js';
  import SuiteModal from './SuiteModal.svelte';

  let groups = $state([]); // Array of { projectName, projectId, suites }
  let loading = $state(false);
  let emptyMsg = $state('');
  let modalSuite = $state(null);
  let modalProjectId = $state(null);

  // Filter & sort state
  let search = $state('');
  let sortBy = $state('recent'); // recent, name-asc, name-desc, tests-desc, tests-asc

  // Flattened suites for badge count
  let suites = $derived(groups.flatMap(g => g.suites));

  // Filtered + sorted groups
  let filteredGroups = $derived.by(() => {
    const q = search.toLowerCase().trim();
    return groups
      .map(g => {
        let items = g.suites;
        if (q) {
          items = items.filter(s =>
            s.name.toLowerCase().includes(q) ||
            (s.file || '').toLowerCase().includes(q) ||
            (s.tests || []).some(t => t.toLowerCase().includes(q))
          );
        }
        const sorted = [...items].sort((a, b) => {
          if (sortBy === 'recent') return (b.id || 0) - (a.id || 0);
          if (sortBy === 'name-asc') return a.name.localeCompare(b.name);
          if (sortBy === 'name-desc') return b.name.localeCompare(a.name);
          if (sortBy === 'tests-desc') return (b.testCount || 0) - (a.testCount || 0);
          if (sortBy === 'tests-asc') return (a.testCount || 0) - (b.testCount || 0);
          return 0;
        });
        return { ...g, suites: sorted };
      })
      .filter(g => g.suites.length > 0);
  });

  let totalFiltered = $derived(filteredGroups.reduce((n, g) => n + g.suites.length, 0));

  export function refresh() {
    loading = true;
    emptyMsg = '';
    groups = [];

    if (app.project) {
      api('/api/db/projects/' + app.project + '/suites').then(data => {
        loading = false;
        if (!Array.isArray(data) || data.length === 0) {
          groups = [];
          emptyMsg = 'No test suites found for this project.';
          return;
        }
        groups = [{ projectName: null, projectId: app.project, suites: data }];
      }).catch(() => {
        loading = false;
        groups = [];
        emptyMsg = 'Failed to load suites.';
      });
    } else {
      api('/api/db/projects').then(projects => {
        if (!Array.isArray(projects) || projects.length === 0) {
          loading = false;
          emptyMsg = 'No projects registered yet.';
          return;
        }
        let loaded = 0;
        const results = [];
        projects.forEach(p => {
          api('/api/db/projects/' + p.id + '/suites').then(data => {
            loaded++;
            if (Array.isArray(data) && data.length > 0) {
              results.push({ projectName: p.name, projectId: p.id, suites: data });
            }
            if (loaded === projects.length) {
              loading = false;
              if (results.length === 0) emptyMsg = 'No test suites found.';
              groups = results;
            }
          }).catch(() => {
            loaded++;
            if (loaded === projects.length) {
              loading = false;
              if (results.length === 0) emptyMsg = 'No test suites found.';
              groups = results;
            }
          });
        });
      }).catch(() => {
        loading = false;
        emptyMsg = 'Failed to load projects.';
      });
    }
  }

  function openModal(suiteName, projectId) {
    modalSuite = suiteName;
    modalProjectId = projectId || app.project;
  }

  function closeModal() {
    modalSuite = null;
    modalProjectId = null;
  }

  const sortOptions = [
    { id: 'recent', label: 'Recent' },
    { id: 'name-asc', label: 'A\u2192Z' },
    { id: 'name-desc', label: 'Z\u2192A' },
    { id: 'tests-desc', label: 'Most tests' },
    { id: 'tests-asc', label: 'Fewest tests' },
  ];
</script>

<!-- Toolbar: search + sort -->
{#if suites.length > 0}
  <div class="flex items-center gap-3 mb-4">
    <!-- Search -->
    <div class="relative flex-1 max-w-xs">
      <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-base-content/25 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
      </svg>
      <input
        type="text"
        placeholder="Search suites or tests..."
        class="input input-sm w-full pl-8 font-mono text-[11px] bg-base-200 border-base-content/8 rounded-lg"
        bind:value={search}
      />
      {#if search}
        <button
          class="absolute right-2 top-1/2 -translate-y-1/2 text-base-content/30 hover:text-base-content/60 transition-colors text-xs"
          onclick={() => search = ''}
        >{'\u2715'}</button>
      {/if}
    </div>

    <!-- Sort options -->
    <div class="flex items-center gap-1 bg-base-200 border border-base-content/6 rounded-lg p-0.5">
      {#each sortOptions as opt (opt.id)}
        <button
          class="px-2.5 py-1 rounded-md text-[10px] font-mono transition-all duration-150
            {sortBy === opt.id
              ? 'bg-primary/10 text-primary shadow-sm'
              : 'text-base-content/30 hover:text-base-content/50 hover:bg-base-content/4'}"
          onclick={() => sortBy = opt.id}
        >{opt.label}</button>
      {/each}
    </div>

    <!-- Count -->
    <span class="text-[10px] font-mono text-base-content/25 ml-auto">
      {totalFiltered}{totalFiltered !== suites.length ? '/' + suites.length : ''} suites
    </span>
  </div>
{/if}

{#if loading}
  <div class="flex flex-col items-center justify-center py-20 text-base-content/25">
    <span class="loading loading-spinner loading-sm text-primary"></span>
    <p class="mt-3 text-xs font-sans">Loading suites...</p>
  </div>
{:else if suites.length === 0}
  <div class="flex flex-col items-center justify-center py-20 text-base-content/20">
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="opacity-40 mb-3">
      <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M3 9h18"/>
    </svg>
    <p class="text-xs font-sans">{emptyMsg || 'No test suites found.'}</p>
  </div>
{:else if totalFiltered === 0}
  <div class="flex flex-col items-center justify-center py-16 text-base-content/20">
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="opacity-40 mb-3">
      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
    </svg>
    <p class="text-xs font-sans">No suites match "<span class="text-primary">{search}</span>"</p>
    <button class="btn btn-xs btn-ghost text-primary mt-2 font-sans" onclick={() => search = ''}>Clear search</button>
  </div>
{:else}
  {#each filteredGroups as g, gIdx (g.projectName || '_single')}
    {#if g.projectName}
      <div class="font-sans text-[12px] font-semibold text-base-content/40 uppercase tracking-[0.1em] {gIdx > 0 ? 'mt-6' : ''} pb-2 mb-3 border-b border-base-content/6">{g.projectName}</div>
    {/if}
    <div class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4 {g.projectName ? 'mb-2' : ''}">
      {#each g.suites as s, sIdx (s.name)}
        <div class="bg-base-200 border border-base-content/6 rounded-xl overflow-hidden transition-all duration-250 hover:border-primary/25 hover:shadow-[0_4px_20px_oklch(var(--p)/0.06)]"
             style="animation: fadeSlide 0.3s ease {sIdx * 0.04}s both">
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <div
            class="flex items-center gap-3 px-4 py-3.5 cursor-pointer hover:bg-base-content/3 transition-colors duration-150"
            onclick={() => openModal(s.name, g.projectId)}
          >
            <div class="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="oklch(var(--p))"><polygon points="5,3 19,12 5,21"/></svg>
            </div>
            <div class="flex-1 min-w-0">
              <div class="font-sans text-[13px] font-semibold text-base-content/80 truncate">{s.name}</div>
              <div class="font-mono text-[10px] text-base-content/25 mt-0.5 truncate">{s.file || s.name + '.json'}</div>
            </div>
            <div class="text-center shrink-0">
              <div class="font-sans text-lg font-bold text-primary leading-none" style="text-shadow: 0 0 12px oklch(var(--p) / 0.2)">{s.testCount || 0}</div>
              <div class="text-[8px] text-base-content/25 uppercase tracking-widest mt-0.5 font-sans">tests</div>
            </div>
          </div>
          {#if s.tests && s.tests.length}
            <div class="px-4 border-t border-base-content/5">
              <ul class="py-2">
                {#each s.tests as t}
                  <li class="text-[11px] text-base-content/40 py-1 px-2 rounded-md hover:bg-base-content/4 hover:text-base-content/70 transition-colors duration-100 font-mono">{t}</li>
                {/each}
              </ul>
            </div>
          {/if}
          <div class="px-4 py-2.5 border-t border-base-content/5 flex justify-end">
            <button class="btn btn-xs btn-primary font-sans text-[10px]" onclick={() => triggerRun(s.name, g.projectId)}>Run Suite</button>
          </div>
        </div>
      {/each}
    </div>
  {/each}
{/if}

{#if modalSuite}
  <SuiteModal suiteName={modalSuite} projectId={modalProjectId} onclose={closeModal} />
{/if}
