import { fail } from '../src/errors.mjs';

const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const selectorKey = rule => JSON.stringify([rule.method, rule.origin, rule.path]);
const jsonTypes = new Set(['object', 'array', 'string', 'number', 'boolean', 'null']);

/** Canonical JSON-safe configuration. Errors never echo rejected input. */
export function validateContracts(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) fail('CONFIG', 'contracts must contain 1–100 exact operation rules.');
  let requirements = 0;
  const rules = raw.map(rule => {
    if (!isObject(rule) || Object.keys(rule).some(key => !['method', 'origin', 'path', 'allowedStatuses', 'requiredJson'].includes(key))) fail('CONFIG', 'Contract rules require exact selectors and only allowedStatuses or requiredJson assertions.');
    const result = validateSelector(rule);
    if (rule.allowedStatuses !== undefined) {
      const statuses = rule.allowedStatuses;
      if (!Array.isArray(statuses) || statuses.length === 0 || statuses.length > 100 || statuses.some(status => !Number.isInteger(status) || status < 200 || status > 599) || new Set(statuses).size !== statuses.length) fail('CONFIG', 'Contract allowedStatuses must contain 1–100 unique final HTTP status integers from 200 to 599.');
      result.allowedStatuses = [...statuses].sort((a, b) => a - b);
    }
    if (rule.requiredJson !== undefined) {
      const required = rule.requiredJson;
      if (!Array.isArray(required) || required.length === 0 || required.length > 100) fail('CONFIG', 'Contract requiredJson must contain 1–100 pointer/type requirements.');
      requirements += required.length;
      if (requirements > 1000) fail('CONFIG', 'Contracts exceed 1000 total JSON requirements.');
      result.requiredJson = required.map(item => {
        if (!isObject(item) || Object.keys(item).length !== 2 || Object.keys(item).some(key => !['pointer', 'type'].includes(key))) fail('CONFIG', 'Each JSON requirement must contain only pointer and type.');
        const { pointer, type } = item;
        if (typeof pointer !== 'string' || (pointer !== '' && !pointer.startsWith('/')) || pointer.length > 1024 || /~(?![01])/u.test(pointer) || (pointer !== '' && pointer.slice(1).split('/').length > 64)) fail('CONFIG', 'Contract pointers must be RFC 6901 strings within 1024 code units and 64 reference tokens.');
        if (!jsonTypes.has(type)) fail('CONFIG', 'Contract JSON types must be object, array, string, number, boolean or null.');
        return { pointer, type };
      }).sort((a, b) => compareText(a.pointer, b.pointer));
      if (result.requiredJson.some((item, index, items) => index > 0 && item.pointer === items[index - 1].pointer)) fail('CONFIG', 'Duplicate contract JSON pointers are not allowed.');
    }
    if (!result.allowedStatuses && !result.requiredJson) fail('CONFIG', 'Each contract rule must contain an allowedStatuses or requiredJson assertion.');
    return result;
  }).sort((a, b) => compareText(selectorKey(a), selectorKey(b)));
  if (rules.some((rule, index) => index > 0 && selectorKey(rule) === selectorKey(rules[index - 1]))) fail('CONFIG', 'Duplicate contract operation selectors are not allowed.');
  return rules;
}

function validateSelector(rule) {
  const { method, origin, path } = rule;
  if (typeof method !== 'string' || !/^[!#$%&'+.^_`|~0-9A-Za-z-]{1,32}$/u.test(method)) fail('CONFIG', 'Contract method must be an HTTP token without a wildcard.');
  if (typeof origin !== 'string' || origin.length > 2048 || typeof path !== 'string' || path.length > 4096 || !path.startsWith('/') || /[?#\\\u0000-\u0020\u007f]/u.test(path)) fail('CONFIG', 'Contract origin/path must be exact canonical HTTP(S) URL components.');
  let url, target;
  try { url = new URL(origin); target = new URL(origin + path); } catch { fail('CONFIG', 'Contract origin/path is invalid.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin || target.origin !== origin || target.pathname !== path || target.search || target.hash) fail('CONFIG', 'Contract origin/path must be canonical without credentials, query or fragment.');
  return { method: method.toUpperCase(), origin, path };
}

export function evaluateContracts(baselineEntries, candidateEntries, contracts) {
  const findings = [];
  let checks = 0, findingBytes = 0;
  const baselineByKey = new Map();
  for (const entry of baselineEntries) {
    if (!baselineByKey.has(entry.key)) baselineByKey.set(entry.key, []);
    baselineByKey.get(entry.key).push(entry);
  }
  function add(rule, evidence, finding) {
    if (findings.length >= 10000) fail('LIMIT', 'Contract evaluation exceeds 10000 findings.');
    const result = {
      id: `contract-finding-${String(findings.length + 1).padStart(5, '0')}`,
      rule, severity: 'regression', evidence, ...finding,
    };
    findingBytes += Buffer.byteLength(JSON.stringify(result));
    if (findingBytes > 4 * 1024 * 1024) fail('LIMIT', 'Contract finding evidence exceeds the 4 MiB report budget.');
    findings.push(result);
  }
  for (const [index, rule] of contracts.entries()) {
    const before = baselineEntries.filter(entry => matches(entry, rule));
    const after = candidateEntries.filter(entry => matches(entry, rule));
    if (before.length === 0 && after.length === 0) fail('CONTRACT_UNUSED', 'A contract selector matched neither selected capture; check method, origin, path and selection scope.');
    if (after.length === 0) {
      checks++;
      add(index + 1, { baselineEntry: before[0].evidence.entry, candidateEntry: null }, { kind: 'contract-operation-missing' });
      continue;
    }
    const occurrences = new Map();
    for (const entry of after) {
      const occurrence = occurrences.get(entry.key) ?? 0;
      occurrences.set(entry.key, occurrence + 1);
      const evidence = { baselineEntry: baselineByKey.get(entry.key)?.[occurrence]?.evidence.entry ?? null, candidateEntry: entry.evidence.entry };
      const emit = finding => add(index + 1, evidence, finding);
      if (rule.allowedStatuses) {
        checks++;
        if (!rule.allowedStatuses.includes(entry.status)) emit({ kind: 'contract-status', status: { after: entry.status } });
      }
      if (rule.requiredJson) {
        checks += rule.requiredJson.length;
        if (entry.body.kind !== 'json') {
          emit({ kind: 'contract-json-body', types: { before: 'json', after: entry.body.kind } });
          continue;
        }
        for (const [offset, requirement] of rule.requiredJson.entries()) {
          const value = resolvePointer(entry.body.value, requirement.pointer);
          if (value === missing) emit({ kind: 'contract-json-missing', requirement: offset + 1 });
          else if (kind(value) !== requirement.type) emit({ kind: 'contract-json-type', requirement: offset + 1, types: { before: requirement.type, after: kind(value) } });
        }
      }
    }
  }
  return { checks, findings };
}

function matches(entry, rule) {
  return entry.method === rule.method && entry.origin === rule.origin && entry.path === rule.path;
}

const kind = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
const missing = Symbol('missing');
function resolvePointer(value, pointer) {
  if (pointer === '') return value;
  for (const encoded of pointer.slice(1).split('/')) {
    const token = encoded.replaceAll('~1', '/').replaceAll('~0', '~');
    if (value === null || typeof value !== 'object') return missing;
    if (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/u.test(token)) return missing;
    if (!Object.hasOwn(value, token)) return missing;
    value = value[token];
  }
  return value;
}
