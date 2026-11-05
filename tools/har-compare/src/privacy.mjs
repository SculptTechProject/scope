/** Opt-in projection: keep assertion/evidence metadata, omit all captured label/config strings. */
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
const evidence = value => pick(value, ['entry', 'provenance', 'edited']);
export function minimizeLabels(report) {
  const config = report.config;
  const result = {
    schemaVersion: report.schemaVersion,
    tool: report.tool,
    config: {
      mode: config.mode,
      redacted: true,
      ignorePointerCount: config.ignoreJsonPaths.length + (config.scopedIgnores ?? []).reduce((total, rule) => total + rule.pointers.length, 0),
      selectionRuleCount: config.includeOperations?.length ?? null,
      contractRuleCount: config.contracts?.length ?? 0,
    },
    summary: pick(report.summary, ['baselineEntries', 'candidateEntries', 'pairedEntries', 'operations', 'regressions', 'informational', 'ignoredNodes', 'scopedIgnoredNodes']),
    notices: report.notices.map(notice => pick(notice, ['kind', 'operation'])),
    operations: report.operations.map(operation => ({
      id: operation.id,
      queryValuesOmitted: operation.queryValuesOmitted,
      baseline: operation.baseline.map(evidence),
      candidate: operation.candidate.map(evidence),
    })),
    findings: report.findings.map(finding => ({
      ...pick(finding, ['id', 'operation', 'occurrence', 'kind', 'severity', 'source', 'rule', 'requirement']),
      evidence: pick(finding.evidence, ['baselineEntry', 'candidateEntry']),
      ...(finding.status ? { status: pick(finding.status, ['before', 'after']) } : {}),
      ...(finding.types ? { types: pick(finding.types, ['before', 'after']) } : {}),
    })),
    privacy: { labels: 'ids', capturedLabelsOmitted: true },
  };
  if (report.contracts) result.contracts = pick(report.contracts, ['rules', 'checks', 'regressions']);
  if (report.coverage) {
    const keys = ['totalEntries', 'selectedEntries', 'excludedEntries'];
    result.coverage = { baseline: pick(report.coverage.baseline, keys), candidate: pick(report.coverage.candidate, keys) };
  }
  return result;
}
