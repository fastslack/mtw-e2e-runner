<script>
  import { app } from '../../lib/stores/state.svelte.js';
  import { api } from '../../lib/api/client.js';
  import { ssHash } from '../../lib/utils/hash.js';
  import HashBadge from '../../components/shared/HashBadge.svelte';

  let files = $state([]);
  let loading = $state(false);
  let hashInput = $state('');
  let searchResult = $state(null);
  let searchError = $state('');
  let fileHashes = $state({});

  export function refresh() {
    if (!app.project) {
      files = [];
      return;
    }
    loading = true;
    api('/api/db/projects/' + app.project + '/screenshots').then(list => {
      if (Array.isArray(list)) files = list;
      else files = [];
      loading = false;
      // Resolve hashes
      files.forEach(f => {
        if (!fileHashes[f.path]) {
          ssHash(f.path).then(h => {
            fileHashes = { ...fileHashes, [f.path]: h };
          });
        }
      });
    }).catch(() => { files = []; loading = false; });
  }

  function openImage(src) {
    if (globalThis.__openModal) globalThis.__openModal(src);
  }

  function searchByHash() {
    searchResult = null;
    searchError = '';
    const raw = hashInput.trim();
    if (!raw) return;
    const hash = raw.replace(/^ss:/, '');
    if (!/^[a-f0-9]{1,8}$/i.test(hash)) {
      searchError = 'Invalid hash format. Expected 8 hex characters (e.g. ss:a3f2b1c9).';
      return;
    }
    fetch('/api/screenshot-hash/' + hash).then(res => {
      if (!res.ok) { searchError = 'Screenshot not found for hash: ss:' + hash; return; }
      return res.blob();
    }).then(blob => {
      if (!blob) return;
      searchResult = { url: URL.createObjectURL(blob), hash };
    }).catch(() => { searchError = 'Error searching for screenshot.'; });
  }

  function onHashKeydown(e) {
    if (e.key === 'Enter') searchByHash();
  }
</script>

<div class="pt-1">
  <!-- Hash Search -->
  <div class="flex gap-2 mb-4 items-center">
    <input
      type="text"
      placeholder="Search by hash (ss:a3f2b1c9)"
      bind:value={hashInput}
      onkeydown={onHashKeydown}
      class="input input-sm input-bordered font-mono text-xs flex-1 max-w-xs bg-base-300"
    />
    <button class="btn btn-sm btn-ghost" onclick={searchByHash}>Search</button>
  </div>

  {#if searchError}
    <div class="text-error text-xs mb-3 px-3 py-2 bg-error/10 rounded-lg">{searchError}</div>
  {/if}

  {#if searchResult}
    <div class="mb-4 p-3 bg-base-300 border border-base-content/10 rounded-lg">
      <div class="flex items-center gap-2 mb-2 text-xs text-success">
        <HashBadge hash={searchResult.hash} />
        <span>Found</span>
      </div>
      <img
        src={searchResult.url}
        alt="ss:{searchResult.hash}"
        class="max-w-full max-h-[400px] rounded-lg cursor-pointer"
        onclick={() => openImage(searchResult.url)}
      />
    </div>
  {/if}

  <!-- Gallery -->
  {#if !app.project}
    <div class="flex flex-col items-center justify-center py-12 text-base-content/30">
      <div class="text-4xl mb-3">{'\u{1F5BC}'}</div>
      <p class="text-xs">Select a project to view screenshots.</p>
    </div>
  {:else if files.length === 0 && !loading}
    <div class="flex flex-col items-center justify-center py-12 text-base-content/30">
      <div class="text-4xl mb-3">{'\u{1F5BC}'}</div>
      <p class="text-xs">No screenshots for this project.</p>
    </div>
  {:else}
    <div class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
      {#each files as f}
        {@const src = '/api/image?path=' + encodeURIComponent(f.path)}
        <div
          class="card card-compact bg-base-300 border border-base-content/10 hover:border-primary hover:shadow-lg cursor-pointer transition-all duration-200 overflow-hidden"
          onclick={() => openImage(src)}
        >
          <figure>
            <img src={src} alt={f.name} loading="lazy" class="w-full h-auto block" />
          </figure>
          <div class="px-2.5 py-2 text-[10px] text-base-content/30 flex items-center gap-1.5 flex-wrap bg-base-200">
            <span class="truncate flex-1 min-w-0">{f.name}</span>
            {#if fileHashes[f.path]}
              <HashBadge hash={fileHashes[f.path]} />
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
