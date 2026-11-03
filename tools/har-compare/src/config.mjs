/** Errors deliberately contain no captured strings, file names or parser excerpts. */
export class AnalysisError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export function fail(code, message) { throw new AnalysisError(code, message); }
export const LIMITS = Object.freeze({ fileBytes: 10 * 1024 * 1024, configBytes: 65536, entries: 2000, bodyBytes: 1024 * 1024, depth: 64, nodes: 100000, findings: 10000 });
export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const pointerPart = key => key.replaceAll('~', '~0').replaceAll('/', '~1');

export function validateConfig(raw = {}) {
  if (!isObject(raw) || Object.keys(raw).some(k => !['mode', 'ignoreJsonPaths', 'includeOperations'].includes(k))) fail('CONFIG', 'Config must contain only mode, ignoreJsonPaths and includeOperations.');
  const mode = raw.mode === undefined ? 'shape' : raw.mode;
  if (!['shape', 'strict'].includes(mode)) fail('CONFIG', 'mode must be shape or strict.');
  const paths = raw.ignoreJsonPaths === undefined ? [] : raw.ignoreJsonPaths;
  if (!Array.isArray(paths) || paths.length > 100 || paths.some(p => typeof p !== 'string' || !p.startsWith('/') || p.length > 1024 || /~(?![01])/u.test(p))) fail('CONFIG', 'Ignore rules must be up to 100 non-root RFC 6901 pointers.');
  const sorted = [...paths].sort(compareText);
  if (sorted.some((p, i) => sorted.some((other, j) => j < i && (p === other || p.startsWith(other + '/'))))) fail('CONFIG', 'Duplicate or overlapping ignore pointers are not allowed.');
  const config = { mode, ignoreJsonPaths: sorted };
  if (raw.includeOperations !== undefined) config.includeOperations = validateSelection(raw.includeOperations);
  return config;
}

function validateSelection(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) fail('CONFIG', 'includeOperations must contain 1–100 exact selectors.');
  const selectors = raw.map(selector => {
    if (!isObject(selector) || Object.keys(selector).length !== 3 || Object.keys(selector).some(k => !['method', 'origin', 'path'].includes(k))) fail('CONFIG', 'Each selector requires only method, origin and path.');
    const { method, origin, path } = selector;
    if (typeof method !== 'string' || !/^[!#$%&'+.^_`|~0-9A-Za-z-]{1,32}$/u.test(method) || method.includes('*')) fail('CONFIG', 'Selector method must be an HTTP token, not a wildcard.');
    if (typeof origin !== 'string' || origin.length > 2048 || typeof path !== 'string' || path.length > 4096 || !path.startsWith('/') || /[?#\\\u0000-\u0020\u007f]/u.test(path)) fail('CONFIG', 'Selector origin/path must be exact canonical HTTP(S) URL components.');
    let url, target;
    try { url = new URL(origin); target = new URL(origin + path); } catch { fail('CONFIG', 'Selector origin/path is invalid.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin || target.origin !== origin || target.pathname !== path || target.search || target.hash) fail('CONFIG', 'Selector origin/path must be canonical, without credentials, query or fragment.');
    return { method: method.toUpperCase(), origin, path };
  }).sort((a, b) => compareText(JSON.stringify(a), JSON.stringify(b)));
  if (selectors.some((selector, i) => i > 0 && JSON.stringify(selector) === JSON.stringify(selectors[i - 1]))) fail('CONFIG', 'Duplicate operation selectors are not allowed.');
  return selectors;
}
