/** Theme store — light/dark toggle. */

const STORAGE_KEY = 'e2e-runner-theme';
const DEFAULT_THEME = 'light';

export const themes = [
  { id: 'light', label: 'Light', icon: '\u2600', scheme: 'light' },
  { id: 'dark',  label: 'Dark',  icon: '\u263E', scheme: 'dark'  },
];

function loadSaved() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && themes.some(t => t.id === saved)) return saved;
  } catch {}
  return DEFAULT_THEME;
}

export const theme = $state({ current: loadSaved() });

export function setTheme(id) {
  theme.current = id;
  applyTheme(id);
}

export function applyTheme(id) {
  if (id === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
  localStorage.setItem(STORAGE_KEY, id);
}

// Apply on load
applyTheme(theme.current);
