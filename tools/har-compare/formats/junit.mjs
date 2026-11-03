import { fail } from '../src/errors.mjs';

const byteLimit = 4 * 1024 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const escape = value => String(value)
  // XML 1.0 permits supplementary code points but not lone UTF-16 surrogates.
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/gu, '�')
  .replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);

/** Deterministic JUnit-style XML from the already-redacted comparison report. */
export function junitReport(report) {
  if (!object(report) || !Array.isArray(report.operations) || !Array.isArray(report.findings)
    || report.operations.some(operation => !object(operation) || typeof operation.id !== 'string')
    || report.findings.some(finding => !object(finding) || typeof finding.id !== 'string' || typeof finding.kind !== 'string' || !['regression', 'info'].includes(finding.severity))) fail('REPORT', 'JUnit output requires a valid comparison report and known finding severities.');
  if (report.findings.length > 10000 || report.operations.length > 4000) fail('LIMIT', 'JUnit input exceeds its operation or finding limit.');
  const operations = new Map(report.operations.map(operation => [operation.id, operation]));
  const failures = report.findings.filter(finding => finding.severity === 'regression').length;
  const skipped = report.findings.length - failures;
  const tests = report.findings.length || 1;
  const counts = `tests="${tests}" failures="${failures}" errors="0" skipped="${skipped}"`;
  const chunks = [];
  let bytes = 0;
  function append(...parts) {
    for (const part of parts) {
      bytes += Buffer.byteLength(part);
      if (bytes > byteLimit) fail('LIMIT', 'JUnit XML exceeds the 4 MiB output budget.');
      chunks.push(part);
    }
  }
  append('<?xml version="1.0" encoding="UTF-8"?>\n', `<testsuites ${counts}>\n`, `  <testsuite name="scope-har-compare" ${counts}>\n`);
  if (report.findings.length === 0) append('    <testcase classname="scope-har-compare" name="clean-analysis"/>\n');
  for (const finding of report.findings) {
    const operation = operations.get(finding.operation);
    const label = operation ? [operation.method, `${operation.origin ?? ''}${operation.path ?? ''}`].filter(Boolean).join(' ') : finding.operation ?? 'scope-har-compare';
    const name = `${finding.id}: ${finding.kind}${label ? ` · ${label}` : ''}`;
    const details = evidence(finding);
    append(`    <testcase classname="scope-har-compare" name="${escape(name)}">\n`);
    if (finding.severity === 'regression') append(`      <failure message="${escape(finding.kind)}" type="${escape(finding.kind)}">${escape(details)}</failure>\n`);
    else append('      <skipped message="Informational finding; not a configured regression"/>\n');
    append(`      <system-out>${escape(details)}</system-out>\n`, '    </testcase>\n');
  }
  append('  </testsuite>\n</testsuites>\n');
  return chunks.join('');
}

function evidence(finding) {
  const lines = [
    `finding: ${finding.id}`,
    `kind: ${finding.kind}`,
    `baseline entry: ${finding.evidence?.baselineEntry ?? 'absent'}`,
    `candidate entry: ${finding.evidence?.candidateEntry ?? 'absent'}`,
  ];
  if (finding.occurrence !== undefined) lines.push(`occurrence: ${finding.occurrence}`);
  if (finding.path !== undefined) lines.push(`JSON pointer: ${finding.path || '(root)'}`);
  if (finding.status) lines.push(`status: ${finding.status.before ?? 'unspecified'} -> ${finding.status.after ?? 'unspecified'}`);
  if (finding.types) lines.push(`type: ${finding.types.before ?? 'absent'} -> ${finding.types.after ?? 'absent'}`);
  if (finding.rule !== undefined) lines.push(`contract rule: ${finding.rule}`);
  if (finding.requirement !== undefined) lines.push(`contract requirement: ${finding.requirement}`);
  return lines.join('\n');
}
