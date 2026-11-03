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
  if (!isObject(raw) || Object.keys(raw).some(k => !['mode', 'ignoreJsonPaths'].includes(k))) fail('CONFIG', 'Config must contain only mode and ignoreJsonPaths.');
  const mode = raw.mode === undefined ? 'shape' : raw.mode;
  if (!['shape', 'strict'].includes(mode)) fail('CONFIG', 'mode must be shape or strict.');
  const paths = raw.ignoreJsonPaths === undefined ? [] : raw.ignoreJsonPaths;
  if (!Array.isArray(paths) || paths.length > 100 || paths.some(p => typeof p !== 'string' || !p.startsWith('/') || p.length > 1024 || /~(?![01])/u.test(p))) fail('CONFIG', 'Ignore rules must be up to 100 non-root RFC 6901 pointers.');
  const sorted = [...paths].sort(compareText);
  if (sorted.some((p, i) => sorted.some((other, j) => j < i && (p === other || p.startsWith(other + '/'))))) fail('CONFIG', 'Duplicate or overlapping ignore pointers are not allowed.');
  return { mode, ignoreJsonPaths: sorted };
}
