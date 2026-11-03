import { compareText, fail, LIMITS, pointerPart } from './config.mjs';

const kind = v => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
const absent = Symbol('absent');
const group = entries => {
  const map = new Map();
  for (const entry of entries) {
    if (!map.has(entry.key)) map.set(entry.key, []);
    map.get(entry.key).push(entry);
  }
  return map;
};
/** Pure analysis. Captured bodies/keys never cross the returned report boundary. */
export function compareHar(baseline, candidate, config) {
  const left = group(baseline), right = group(candidate);
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort(compareText);
  const findings = [], operations = [], notices = [];
  const hits = new Map(config.ignoreJsonPaths.map(p => [p, 0]));
  let ignoredNodes = 0, pairs = 0, findingBytes = 0;
  function add(operation, occurrence, evidence, finding) {
    if (findings.length >= LIMITS.findings) fail('LIMIT', 'Comparison exceeds 10000 findings.');
    const result = { id: `finding-${String(findings.length + 1).padStart(5, '0')}`, operation, occurrence, evidence, ...finding };
    findingBytes += Buffer.byteLength(JSON.stringify(result));
    if (findingBytes > 4 * 1024 * 1024) fail('LIMIT', 'Finding evidence exceeds the 4 MiB report budget.');
    findings.push(result);
  }
  function walk(a, b, path, addFinding) {
    if (hits.has(path)) { hits.set(path, hits.get(path) + 1); ignoredNodes++; return; }
    if (a === absent) { addFinding({ kind: 'field-added', severity: 'info', path, types: { after: kind(b) } }); return; }
    if (b === absent) { addFinding({ kind: 'field-removed', severity: 'regression', path, types: { before: kind(a) } }); return; }
    if (kind(a) !== kind(b)) { addFinding({ kind: 'type-changed', severity: 'regression', path, types: { before: kind(a), after: kind(b) } }); return; }
    if (Array.isArray(a)) {
      if (a.length !== b.length) addFinding({ kind: 'array-length-changed', severity: 'regression', path });
      for (let i = 0; i < Math.max(a.length, b.length); i++) walk(i < a.length ? a[i] : absent, i < b.length ? b[i] : absent, `${path}/${i}`, addFinding);
    } else if (a !== null && typeof a === 'object') {
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort(compareText);
      for (const key of keys) walk(Object.hasOwn(a, key) ? a[key] : absent, Object.hasOwn(b, key) ? b[key] : absent, `${path}/${pointerPart(key)}`, addFinding);
    } else if (config.mode === 'strict' && a !== b) addFinding({ kind: 'value-changed', severity: 'regression', path });
  }
  for (const [offset, key] of keys.entries()) {
    const a = left.get(key) ?? [], b = right.get(key) ?? [], sample = a[0] ?? b[0];
    const operation = `operation-${String(offset + 1).padStart(4, '0')}`;
    operations.push({ id: operation, method: sample.method, origin: sample.origin, path: sample.path, queryValuesOmitted: sample.hasQuery, baseline: a.map(e => e.evidence), candidate: b.map(e => e.evidence) });
    if (a.length > 1 || b.length > 1) notices.push({ kind: 'ordinal-pairing', operation });
    if (sample.hasQuery) notices.push({ kind: 'query-omitted', operation });
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const before = a[i], after = b[i];
      const evidence = { baselineEntry: before?.evidence.entry ?? null, candidateEntry: after?.evidence.entry ?? null };
      const emit = finding => add(operation, i + 1, evidence, finding);
      if (!before || !after) {
        emit({ kind: before ? 'operation-removed' : 'operation-added', severity: before ? 'regression' : 'info' });
        continue;
      }
      pairs++;
      if (before.status !== after.status) emit({ kind: before.status < 400 && after.status >= 400 ? 'http-failure' : 'status-changed', severity: after.status >= 400 ? 'regression' : 'info', status: { before: before.status, after: after.status } });
      if (before.body.kind !== after.body.kind) emit({ kind: 'body-kind-changed', severity: 'regression', types: { before: before.body.kind, after: after.body.kind } });
      else if (before.body.kind === 'json') walk(before.body.value, after.body.value, '', emit);
    }
  }
  if ([...hits.values()].some(n => n === 0)) fail('IGNORE_UNUSED', 'An ignore pointer did not match a compared JSON node; check spelling and parent changes.');
  const regressions = findings.filter(f => f.severity === 'regression').length;
  return {
    schemaVersion: 1,
    tool: 'scope-har-compare',
    config,
    summary: { baselineEntries: baseline.length, candidateEntries: candidate.length, pairedEntries: pairs, operations: operations.length, regressions, informational: findings.length - regressions, ignoredNodes },
    notices,
    operations,
    findings,
  };
}
