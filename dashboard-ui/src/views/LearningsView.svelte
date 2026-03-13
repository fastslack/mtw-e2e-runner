<script>
  import { onMount } from 'svelte';
  import LearningsTab from './LearningsTab.svelte';

  let learningsTab;

  export function refresh() {
    learningsTab?.refresh();
  }

  onMount(() => {
    learningsTab?.refresh();
  });
</script>

<div class="w-full p-6">
  <LearningsTab bind:this={learningsTab} />
</div>
