import { compareText, isObject, LIMITS, validateConfig } from './config.mjs';
import { harEntries, isJsonMime, requestIdentity } from './input.mjs';

/** Inventory metadata only: response bodies/encodings are deliberately not analyzed. */
export function inspectHar(raw) {
  const entries = harEntries(raw), groups = new Map();
  for (const [offset, entry] of entries.entries()) {
    const { method, url, query } = requestIdentity(entry, offset + 1);
    const selector = { method, origin: url.origin, path: url.pathname };
    const key = JSON.stringify(selector);
    if (!groups.has(key)) groups.set(key, { selector, entries: [], queries: new Set(), statuses: new Map(), unavailableStatuses: 0, jsonResponses: 0, missingJsonBodies: 0, otherResponses: 0 });
    const group = groups.get(key), response = entry.response;
    group.entries.push(offset + 1);
    group.queries.add(query);
    if (isObject(response) && Number.isInteger(response.status) && response.status >= 100 && response.status <= 599) group.statuses.set(response.status, (group.statuses.get(response.status) ?? 0) + 1);
    else group.unavailableStatuses++;
    if (isObject(response?.content) && isJsonMime(response.content.mimeType)) {
      group.jsonResponses++;
      if (typeof response.content.text !== 'string' && method !== 'HEAD' && ![204, 205, 304].includes(response.status)) group.missingJsonBodies++;
    } else group.otherResponses++;
  }
  const operations = [...groups].sort(([a], [b]) => compareText(a, b)).map(([, group], i) => ({
    id: `inventory-operation-${String(i + 1).padStart(4, '0')}`,
    selector: group.selector,
    entries: group.entries,
    queryVariants: group.queries.size,
    statuses: [...group.statuses].sort(([a], [b]) => a - b).map(([status, entries]) => ({ status, entries })),
    unavailableStatuses: group.unavailableStatuses,
    jsonResponses: group.jsonResponses,
    missingJsonBodies: group.missingJsonBodies,
    otherResponses: group.otherResponses,
  }));
  const suggestions = operations.filter(o => o.jsonResponses > 0).map(o => o.selector);
  let configTemplate = null, templateUnavailable;
  if (suggestions.length === 0) templateUnavailable = 'no-json-operations';
  else if (suggestions.length > 100) templateUnavailable = 'too-many-json-operations';
  else {
    try { configTemplate = { includeOperations: validateConfig({ includeOperations: suggestions }).includeOperations }; }
    catch { templateUnavailable = 'unsupported-selector'; }
  }
  if (configTemplate && Buffer.byteLength(JSON.stringify(configTemplate, null, 2) + '\n') > LIMITS.configBytes) { configTemplate = null; templateUnavailable = 'config-byte-limit'; }
  return { schemaVersion: 1, tool: 'scope-har-compare', kind: 'inventory', analysisPerformed: false, summary: { entries: entries.length, operations: operations.length }, operations, configTemplate, ...(templateUnavailable ? { templateUnavailable } : {}) };
}
