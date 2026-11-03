import { createHash } from 'node:crypto';
import { mkdir, open, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fail } from './config.mjs';

const escape = value => String(value).replace(/[&<>"']/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const css = `:root{font-family:system-ui,sans-serif;color:#182431;background:#eef2f6}body{max-width:1100px;margin:40px auto;padding:0 24px}h1{letter-spacing:-.04em}h2{margin-top:32px}p{line-height:1.6}.badge{display:inline-block;background:#dce8ee;padding:8px 14px;border-radius:8px}.regression{border-left:4px solid #b53248}.info{border-left:4px solid #27856d}article{background:white;border-radius:8px;padding:16px 20px;margin:12px 0;overflow-wrap:anywhere}code,pre{font-family:ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}small{color:#506174}details{background:white;padding:14px;border-radius:8px}summary{cursor:pointer}a{color:inherit}`;
export const jsonReport = report => JSON.stringify(report, null, 2) + '\n';
export function htmlReport(report) {
  const hash = createHash('sha256').update(css).digest('base64');
  const operations = new Map(report.operations.map(o => [o.id, o]));
  const cards = report.findings.map(f => {
    const o = operations.get(f.operation);
    return `<article class="${f.severity}"><small>${escape(f.id)} · ${escape(f.severity)}</small><h3>${escape(f.kind)}</h3><code>${escape(o.method)} ${escape(o.origin)}${escape(o.path)}</code><p>${escape(f.operation)} · occurrence ${f.occurrence} · baseline entry ${f.evidence.baselineEntry ?? '—'} → candidate entry ${f.evidence.candidateEntry ?? '—'}</p>${f.path !== undefined ? `<p>JSON pointer: <code>${escape(f.path || '(root)')}</code></p>` : ''}${f.status ? `<p>HTTP ${f.status.before ?? 'unasserted'} → ${f.status.after}</p>` : ''}${f.types ? `<p>Type: ${escape(f.types.before ?? 'absent')} → ${escape(f.types.after ?? 'absent')}</p>` : ''}</article>`;
  }).join('\n');
  const coverage = report.coverage;
  const selection = coverage ? `<h2>Selection scope</h2><p>Baseline: ${coverage.baseline.selectedEntries} selected / ${coverage.baseline.totalEntries} total; ${coverage.baseline.excludedEntries} excluded. Candidate: ${coverage.candidate.selectedEntries} selected / ${coverage.candidate.totalEntries} total; ${coverage.candidate.excludedEntries} excluded.</p><p>Excluded responses were not analyzed. This result applies only to the configured method/origin/path selectors; it is not a health check of the entire capture.</p>` : '';
  const assertions = report.contracts ? `<h2>Authored assertions</h2><p>${report.contracts.checks} checks across ${report.contracts.rules} explicitly configured operation rules; ${report.contracts.regressions} failures. These requirements were authored by the user, not inferred from HAR observations.</p>` : '';
  // No script, embedded executable JSON, remote resources, or captured URLs as links.
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'sha256-${hash}'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Scope HAR comparison</title><style>${css}</style></head><body>
<h1>Scope · HAR comparison</h1><p>Observed API changes · local CI experiment · report schema 1</p>
<p class="badge">${report.summary.regressions} regression candidates · ${report.summary.informational} informational changes · ${report.summary.pairedEntries} paired responses</p>
<p>Mode: <strong>${escape(report.config.mode)}</strong>. Ignored JSON nodes: ${report.summary.ignoredNodes}.</p>
${selection}${assertions}<h2>Findings</h2>${cards || '<article>No configured regression or informational changes were found.</article>'}
<h2>How to read this report</h2><p>Fields describe captured observations, not required schema fields or proven incompatibility. Repeated requests pair by encounter order; reordered responses and request-body variants may be ambiguous. Origins and query values participate in matching; query values are omitted from labels. Different operations can therefore have identical labels. Entry numbers refer to the original HAR log.entries, starting at 1.</p>
<p>Headers, cookies, body values, URL credentials, query values and fragments are excluded. Origin/path and JSON field names can still be sensitive: review this artifact before sharing. No traffic is replayed and no model or external asset is loaded.</p>
<details><summary>Analysis JSON, configuration and evidence</summary><pre>${escape(jsonReport(report))}</pre></details>
</body></html>\n`;
}
/** Exclusive output creation: never overwrite HAR/config, existing reports or symlinks. */
export async function writeReports(outputs) {
  const paths = outputs.map(([path]) => resolve(path));
  if (new Set(paths).size !== paths.length) fail('OUTPUT', 'Report output paths must be distinct.');
  const opened = [];
  try {
    for (const [index, [, content]] of outputs.entries()) {
      await mkdir(dirname(paths[index]), { recursive: true });
      const handle = await open(paths[index], 'wx', 0o600);
      opened.push({ handle, path: paths[index], content });
    }
    for (const { handle, content } of opened) await handle.writeFile(content, 'utf8');
  } catch {
    for (const { path } of opened) await unlink(path).catch(() => {});
    fail('OUTPUT', 'Could not create reports; use distinct new output paths in a trusted directory.');
  } finally { await Promise.all(opened.map(({ handle }) => handle.close())); }
}
