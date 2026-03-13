<script>
  import { onMount } from 'svelte';
  import { app } from './lib/stores/state.svelte.js';
  import { connectWS, setPoolCallback, setRefreshCallback } from './lib/stores/websocket.svelte.js';
  import { initRouter, pushHash } from './lib/stores/router.svelte.js';

  import Sidebar from './components/layout/Sidebar.svelte';
  import ToastContainer from './components/shared/ToastContainer.svelte';
  import Modal from './components/shared/Modal.svelte';
  import WatchView from './views/WatchView.svelte';
  import TestsView from './views/TestsView.svelte';
  import RunsView from './views/RunsView.svelte';
  import LearningsView from './views/LearningsView.svelte';
  import LiveView from './views/LiveView.svelte';

  let sidebar;
  let watchView;
  let testsView;
  let runsView;
  let learningsView;
  let liveView;
  let modalSrc = $state('');
  let modalOpen = $state(false);

  globalThis.__openModal = (src) => { modalSrc = src; modalOpen = true; };

  function refreshAll() {
    sidebar?.refreshProjects();
    if (app.view === 'watch') watchView?.refresh();
    else if (app.view === 'tests') testsView?.refresh();
    else if (app.view === 'runs') runsView?.refresh();
    else if (app.view === 'learnings') learningsView?.refresh();
  }

  setRefreshCallback(refreshAll);
  setPoolCallback((d) => sidebar?.poolStatus?.updatePool(d));

  onMount(() => {
    initRouter();
    connectWS();
    refreshAll();
    if (app.view === 'watch') watchView?.startPolling();
  });

  // Sync URL hash when view changes
  $effect(() => {
    pushHash(app.view, app._tab);
  });

  $effect(() => {
    if (app.view === 'watch') watchView?.startPolling();
    else watchView?.stopPolling();
  });

  function handleKeydown(e) {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    if (e.key === 'Escape') {
      if (modalOpen) { modalOpen = false; return; }
      return;
    }

    const viewMap = { '1': 'watch', '2': 'tests', '3': 'runs', '4': 'learnings', '5': 'live' };
    if (viewMap[e.key]) { app.view = viewMap[e.key]; app._tab = null; return; }

    if (e.key === 'r') { refreshAll(); return; }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex min-h-screen bg-base-100">
  <Sidebar bind:this={sidebar} />

  <main class="ml-58 flex-1 flex flex-col min-h-screen max-md:ml-15">
    {#if app.view === 'watch'}
      <WatchView bind:this={watchView} />
    {:else if app.view === 'tests'}
      <TestsView bind:this={testsView} />
    {:else if app.view === 'runs'}
      <RunsView bind:this={runsView} />
    {:else if app.view === 'learnings'}
      <LearningsView bind:this={learningsView} />
    {:else if app.view === 'live'}
      <LiveView bind:this={liveView} />
    {/if}
  </main>
</div>

<ToastContainer />
<Modal src={modalSrc} open={modalOpen} onClose={() => modalOpen = false} />
