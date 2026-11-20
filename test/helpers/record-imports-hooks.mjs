// Module hooks for record-imports.mjs: remember every resolved URL and expose
// the list as a JSON module at the virtual URL "record-imports:list".
const seen = new Set();
export async function resolve(specifier, context, next) {
  if (specifier === 'record-imports:list') return { url: specifier, shortCircuit: true };
  const r = await next(specifier, context);
  seen.add(r.url);
  return r;
}
export async function load(url, context, next) {
  if (url === 'record-imports:list') {
    return { format: 'json', source: JSON.stringify([...seen]), shortCircuit: true };
  }
  return next(url, context);
}
