/**
 * Hash-based router — syncs app.view and sub-tabs with the URL hash.
 *
 * Routes:
 *   #watch, #tests, #tests/suites, #tests/modules, #tests/variables
 *   #runs, #runs/history, #runs/screenshots, #runs/learnings
 *   #live
 */
import { app } from './state.svelte.js';

const VALID_VIEWS = ['watch', 'tests', 'runs', 'learnings', 'live'];

/** Parse hash into { view, tab } */
function parseHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '');
  const parts = raw.split('/');
  const view = VALID_VIEWS.includes(parts[0]) ? parts[0] : 'watch';
  const tab = parts[1] || null;
  return { view, tab };
}

/** Update the URL hash without triggering hashchange */
let suppressHashChange = false;

export function pushHash(view, tab) {
  const hash = tab ? '#' + view + '/' + tab : '#' + view;
  if (location.hash !== hash) {
    suppressHashChange = true;
    location.hash = hash;
    // Reset flag after the event would fire
    queueMicrotask(() => { suppressHashChange = false; });
  }
}

/** Read initial route from URL */
export function initRouter() {
  const { view, tab } = parseHash();
  app.view = view;
  app._tab = tab;

  window.addEventListener('hashchange', () => {
    if (suppressHashChange) return;
    const { view, tab } = parseHash();
    app.view = view;
    app._tab = tab;
  });
}
