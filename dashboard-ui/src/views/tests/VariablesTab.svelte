<script>
  import { app } from '../../lib/stores/state.svelte.js';
  import { api } from '../../lib/api/client.js';
  import { showToast } from '../../lib/stores/toast.svelte.js';

  let variables = $state([]);
  let loading = $state(false);
  let emptyMsg = $state('');
  let showForm = $state(false);
  let newKey = $state('');
  let newValue = $state('');
  let newSecret = $state(false);
  let saving = $state(false);

  export function refresh() {
    if (!app.project) {
      variables = [];
      emptyMsg = 'Select a project to manage variables.';
      return;
    }
    loading = true;
    emptyMsg = '';
    api('/api/db/projects/' + app.project + '/variables').then(data => {
      loading = false;
      if (!Array.isArray(data) || data.length === 0) {
        variables = [];
        emptyMsg = 'No variables set. Add variables to use {{var.KEY}} in your tests.';
        return;
      }
      variables = data;
    }).catch(() => {
      loading = false;
      variables = [];
      emptyMsg = 'Failed to load variables.';
    });
  }

  function toggleForm() {
    showForm = !showForm;
    if (showForm) {
      newKey = '';
      newValue = '';
      newSecret = false;
    }
  }

  function saveVariable() {
    const k = newKey.trim();
    if (!k) {
      showToast('Key is required', 'error');
      return;
    }
    if (!app.project) {
      showToast('Select a project first', 'error');
      return;
    }
    saving = true;
    fetch('/api/db/projects/' + app.project + '/variables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: k, value: newValue, is_secret: newSecret })
    }).then(r => r.json()).then(() => {
      saving = false;
      showForm = false;
      showToast('Variable saved', 'success');
      refresh();
    }).catch(() => {
      saving = false;
      showToast('Save failed', 'error');
    });
  }

  function deleteVariable(key) {
    if (!confirm('Delete variable "' + key + '"?')) return;
    fetch('/api/db/projects/' + app.project + '/variables/' + encodeURIComponent(key), {
      method: 'DELETE'
    }).then(() => {
      showToast('Variable deleted', 'success');
      refresh();
    }).catch(() => {
      showToast('Delete failed', 'error');
    });
  }
</script>

<div class="flex items-center justify-end mb-3.5">
  <button class="btn btn-sm {showForm ? 'btn-ghost' : 'btn-primary'}" onclick={toggleForm}>
    {showForm ? 'Cancel' : '+ Add Variable'}
  </button>
</div>

{#if showForm}
  <div class="flex items-center gap-2 flex-wrap p-3 bg-base-300 border border-base-content/10 rounded-lg mb-3.5">
    <input
      type="text"
      placeholder="KEY"
      class="input input-sm input-bordered font-mono text-xs w-[120px] bg-base-200"
      bind:value={newKey}
    />
    <input
      type="text"
      placeholder="Value"
      class="input input-sm input-bordered font-mono text-xs w-[200px] bg-base-200"
      bind:value={newValue}
    />
    <label class="flex items-center gap-1.5 text-xs text-base-content/50 cursor-pointer">
      <input type="checkbox" class="checkbox checkbox-xs checkbox-primary" bind:checked={newSecret} />
      Secret
    </label>
    <button class="btn btn-sm btn-primary" onclick={saveVariable} disabled={saving}>
      {saving ? 'Saving...' : 'Save'}
    </button>
  </div>
{/if}

{#if loading}
  <div class="flex flex-col items-center justify-center py-16 text-base-content/40">
    <span class="loading loading-spinner loading-sm"></span>
    <p class="mt-3 text-xs">Loading variables...</p>
  </div>
{:else if variables.length === 0}
  <div class="flex flex-col items-center justify-center py-16 text-base-content/40">
    <div class="text-4xl mb-3">{'\uD83D\uDD10'}</div>
    <p class="text-xs">{emptyMsg || 'No variables found.'}</p>
  </div>
{:else}
  <div class="overflow-x-auto bg-base-300 border border-base-content/10 rounded-lg">
    <table class="table table-xs">
      <thead>
        <tr class="text-base-content/40">
          <th>Key</th>
          <th>Value</th>
          <th>Scope</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each variables as v (v.key)}
          <tr class="hover:bg-base-200">
            <td>
              <code class="font-mono text-xs text-primary bg-primary/10 px-1.5 py-0.5 rounded">{v.key}</code>
            </td>
            <td class="max-w-[300px] truncate text-base-content/50 font-mono text-xs">
              {v.is_secret ? '\u2022\u2022\u2022\u2022\u2022\u2022' : v.value}
            </td>
            <td class="text-base-content/30 text-xs">{v.scope || 'project'}</td>
            <td>
              <button class="btn btn-xs btn-error btn-ghost" onclick={() => deleteVariable(v.key)}>{'\u2715'}</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
