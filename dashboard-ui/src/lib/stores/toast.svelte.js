export let toasts = $state([]);
let nextId = 0;

export function showToast(message, type = 'info', timeout = 5000) {
  const id = nextId++;
  toasts.push({ id, message, type, timeout });
  setTimeout(() => {
    const idx = toasts.findIndex(t => t.id === id);
    if (idx !== -1) toasts.splice(idx, 1);
  }, timeout + 300);
}
