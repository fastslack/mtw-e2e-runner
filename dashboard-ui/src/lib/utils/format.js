export function dur(ms) { return ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms'; }
export function fdate(iso) { return iso ? new Date(iso).toLocaleString() : '--'; }
export function css(n) { return n.replace(/[^a-zA-Z0-9\-_]/g, '_'); }
export function prettyJson(str) { if (!str) return ''; try { return JSON.stringify(JSON.parse(str), null, 2); } catch { return str; } }
export function fmtHeaders(h) { if (!h || typeof h !== 'object') return ''; return Object.keys(h).map(k => k + ': ' + h[k]).join('\n'); }
export function rateColor(v) { return v >= 90 ? 'var(--green)' : v >= 70 ? 'var(--amber)' : 'var(--red)'; }
export function rateClass(v) { return v >= 90 ? 'good' : v >= 70 ? 'warn' : 'bad'; }
