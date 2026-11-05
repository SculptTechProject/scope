import { evaluateContracts } from '../contracts/index.mjs';
import { fail, LIMITS } from './config.mjs';

/** Attach explicitly authored assertions; observational comparison remains separate. */
export function applyContracts(report, baseline, candidate, config) {
  if (!config.contracts) return report;
  const result = evaluateContracts(baseline, candidate, config.contracts);
  const before = new Map(), after = new Map();
  for (const op of report.operations) {
    op.baseline.forEach((e, i) => before.set(e.entry, { operation: op.id, occurrence: i + 1 }));
    op.candidate.forEach((e, i) => after.set(e.entry, { operation: op.id, occurrence: i + 1 }));
  }
  const authored = result.findings.map(finding => {
    const location = after.get(finding.evidence.candidateEntry) ?? before.get(finding.evidence.baselineEntry);
    if (!location) fail('REPORT', 'Contract evidence could not be mapped to a selected operation.');
    const requirement = finding.requirement ? config.contracts[finding.rule - 1].requiredJson[finding.requirement - 1] : undefined;
    return { ...finding, source: 'authored-contract', ...location, ...(requirement ? { path: requirement.pointer } : {}) };
  });
  const findings = [...report.findings, ...authored];
  if (findings.length > LIMITS.findings || Buffer.byteLength(JSON.stringify(findings)) > 4 * 1024 * 1024) fail('LIMIT', 'Combined comparison and contract findings exceed report limits.');
  return { ...report, summary: { ...report.summary, regressions: report.summary.regressions + authored.length }, findings, contracts: { rules: config.contracts.length, checks: result.checks, regressions: authored.length } };
}
