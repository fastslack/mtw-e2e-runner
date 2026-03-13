import { app } from '../stores/state.svelte.js';
import { showToast } from '../stores/toast.svelte.js';

export function api(path) {
  return fetch(path).then(r => r.json());
}

export function triggerRun(suite, projectId) {
  const body = {};
  if (suite) body.suite = suite;
  if (projectId) body.projectId = projectId;
  else if (app.project) body.projectId = app.project;
  if (app.screencast) body.screencast = true;
  const label = suite || 'all tests';
  fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(r => r.json())
    .then(d => {
      if (d.status === 'started') {
        showToast('Running ' + label, 'success');
        app.liveActive = true;
      } else {
        showToast(d.error || 'Failed to start run', 'error');
      }
    })
    .catch(() => showToast('Failed to start run', 'error'));
}
