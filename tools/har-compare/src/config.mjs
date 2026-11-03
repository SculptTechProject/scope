import { validateContracts } from '../contracts/index.mjs';
import { fail } from './errors.mjs';
export { AnalysisError, fail } from './errors.mjs';
export const LIMITS = Object.freeze({ fileBytes: 10 * 1024 * 1024, configBytes: 65536, entries: 2000, bodyBytes: 1024 * 1024, depth: 64, nodes: 100000, findings: 10000 });
export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const pointerPart = key => key.replaceAll('~', '~0').replaceAll('/', '~1');

export function validateConfig(raw = {}) {
  if (!isObject(raw) || Object.keys(raw).some(k => !['mode', 'ignoreJsonPaths', 'includeOperations', 'contracts', 'scopedIgnores'].includes(k))) fail('CONFIG', 'Config must contain only mode, ignoreJsonPaths includeOperations, contracts and scopedIgnores.');
  const mode = raw.mode === undefined ? 'shape' : raw.mode;
  if (!['shape', 'strict'].includes(mode)) fail('CONFIG', 'mode must be shape or strict.');
  const sorted = validatePointers(raw.ignoreJsonPaths === undefined ? [] : raw.ignoreJsonPaths);
  const config = { mode, ignoreJsonPaths: sorted };
  if (raw.includeOperations !== undefined) config.includeOperations = validateSelection(raw.includeOperations);
  if (raw.contracts !== undefined) config.contracts = validateContracts(raw.contracts);
  if (raw.scopedIgnores !== undefined) config.scopedIgnores = validateScopedIgnores(raw.scopedIgnores, sorted);
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

function validatePointers(paths) {
  if (!Array.isArray(paths) || paths.length > 100 || paths.some(p => typeof p !== 'string' || !p.startsWith('/') || p.length > 1024 || /~(?![01])/u.test(p) || p.slice(1).split('/').length > 64)) fail('CONFIG', 'Ignore rules must be up to 100 non-root RFC 6901 pointers within 64 tokens.');
  const sorted = [...paths].sort(compareText);
  if (sorted.some((p, i) => sorted.some((other, j) => j < i && overlaps(p, other)))) fail('CONFIG', 'Duplicate or overlapping ignore pointers are not allowed.');
  return sorted;
}
const overlaps = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
function validateScopedIgnores(raw, globalPointers) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) fail('CONFIG', 'scopedIgnores must contain 1–100 exact operation rules.');
  let total = 0;
  const rules = raw.map(rule => {
    if (!isObject(rule) || Object.keys(rule).length !== 4 || Object.keys(rule).some(k => !['method', 'origin', 'path', 'pointers'].includes(k))) fail('CONFIG', 'Scoped ignore rules require only method, origin, path and pointers.');
    const selector = validateSelection([{ method: rule.method, origin: rule.origin, path: rule.path }])[0];
    const pointers = validatePointers(rule.pointers);
    total += pointers.length;
    if (pointers.length === 0 || total > 1000) fail('CONFIG', 'Scoped ignores require nonempty pointers and at most 1000 total pointers.');
    if (pointers.some(p => globalPointers.some(g => overlaps(p, g)))) fail('CONFIG', 'Global and scoped ignore pointers must not overlap.');
    return { ...selector, pointers };
  }).sort((a, b) => compareText(JSON.stringify([a.method, a.origin, a.path]), JSON.stringify([b.method, b.origin, b.path])));
  if (rules.some((r, i) => i > 0 && r.method === rules[i - 1].method && r.origin === rules[i - 1].origin && r.path === rules[i - 1].path)) fail('CONFIG', 'Duplicate scoped ignore operation selectors are not allowed.');
  return rules;
}
