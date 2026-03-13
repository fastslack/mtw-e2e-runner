<script>
  import { app } from '../../lib/stores/state.svelte.js';
  import { api } from '../../lib/api/client.js';

  let modules = $state([]);
  let loading = $state(false);
  let emptyMsg = $state('');

  export function refresh() {
    loading = true;
    emptyMsg = '';
    modules = [];

    if (app.project) {
      api('/api/db/projects/' + app.project + '/modules').then(data => {
        loading = false;
        if (!Array.isArray(data) || data.length === 0) {
          modules = [];
          emptyMsg = 'No reusable modules found for this project.';
          return;
        }
        modules = data;
      }).catch(() => {
        loading = false;
        modules = [];
        emptyMsg = 'Failed to load modules.';
      });
    } else {
      // Load modules from all projects
      api('/api/db/projects').then(projects => {
        if (!Array.isArray(projects) || projects.length === 0) {
          loading = false;
          emptyMsg = 'No projects registered yet.';
          return;
        }
        let loaded = 0;
        const allModules = [];
        projects.forEach(p => {
          api('/api/db/projects/' + p.id + '/modules').then(data => {
            loaded++;
            if (Array.isArray(data) && data.length > 0) {
              allModules.push(...data);
            }
            if (loaded === projects.length) {
              loading = false;
              modules = allModules;
              if (allModules.length === 0) emptyMsg = 'No reusable modules found.';
            }
          }).catch(() => {
            loaded++;
            if (loaded === projects.length) {
              loading = false;
              modules = allModules;
              if (allModules.length === 0) emptyMsg = 'No reusable modules found.';
            }
          });
        });
      }).catch(() => {
        loading = false;
        emptyMsg = 'Failed to load projects.';
      });
    }
  }

  function paramName(p) {
    return typeof p === 'string' ? p : (p.name || String(p));
  }
</script>

{#if loading}
  <div class="flex flex-col items-center justify-center py-16 text-base-content/40">
    <span class="loading loading-spinner loading-sm"></span>
    <p class="mt-3 text-xs">Loading modules...</p>
  </div>
{:else if modules.length === 0}
  <div class="flex flex-col items-center justify-center py-16 text-base-content/40">
    <div class="text-4xl mb-3">{'\uD83E\uDDE9'}</div>
    <p class="text-xs">{emptyMsg || 'No modules found.'}</p>
  </div>
{:else}
  <div class="flex items-center gap-2 font-sans text-sm font-semibold text-base-content mb-3.5">
    <span class="text-base">{'\uD83E\uDDE9'}</span>
    Reusable Modules ({modules.length})
  </div>
  <div class="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
    {#each modules as m (m.name)}
      <div class="card card-compact bg-base-300 border border-base-content/10 hover:border-base-content/20 hover:shadow-lg transition-all duration-200">
        <div class="card-body gap-0 p-4">
          <div class="font-sans text-[13px] font-semibold text-base-content mb-1">{m.name}</div>
          {#if m.description}
            <div class="text-xs text-base-content/50 mb-2 leading-relaxed">{m.description}</div>
          {/if}
          <div class="flex gap-3 text-[10px] text-base-content/30 mb-1.5">
            <span>{m.actionCount} actions</span>
            {#if m.params && m.params.length}
              <span>{m.params.length} params</span>
            {/if}
          </div>
          {#if m.params && m.params.length}
            <div class="border-t border-base-content/10 mt-2 pt-2 flex flex-wrap gap-1.5">
              {#each m.params as p}
                <span class="badge badge-xs badge-primary badge-outline font-mono">{paramName(p)}</span>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}
