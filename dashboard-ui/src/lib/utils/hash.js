const cache = {};
export async function ssHash(filePath) {
  if (cache[filePath]) return cache[filePath];
  const data = new TextEncoder().encode(filePath);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  const h = hex.slice(0, 8);
  cache[filePath] = h;
  return h;
}
export function ssHashSync(filePath) { return cache[filePath] || null; }
