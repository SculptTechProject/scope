import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixture } from './fixture.mjs';
import { captureWithNode } from './capture.mjs';
import { runNode } from './process.mjs';
import { validateJUnit } from './junit-check.mjs';

const lab = fileURLToPath(new URL('./', import.meta.url));
const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
export async function runContractChecks(output) {
  await mkdir(output, { recursive: true });
  const fixture = await startFixture();
  const results = [];
  try {
    for (const scenario of ['baseline', 'http-500', 'missing-field', 'timestamp']) await writeFile(join(output, scenario + '.har'), JSON.stringify(await captureWithNode(fixture.origin, scenario), null, 2) + '\n', { flag: 'wx' });
    const captureRequests = fixture.requests.length;
    const probe = await runNode(['--input-type=module', '-e', `const r=await fetch(${JSON.stringify(fixture.origin + '/detector-positive-control')});process.stdout.write(String(r.status))`], { cwd: output });
    assert.equal(probe.status, 0); assert.equal(probe.stdout, '404'); assert.equal(fixture.requests.length, captureRequests + 1);
    const snapshot = fixture.requests.length;
    const selector = { method: 'GET', origin: fixture.origin, path: '/api/user' };
    const includeOperations = [selector];
    const requiredJson = [{ pointer: '/user/role', type: 'string' }];
    const cases = [
      { name: 'explicit-pass', before: 'baseline', after: 'baseline', rule: { ...selector, allowedStatuses: [200], requiredJson }, exit: 0, checks: 2, authored: 0, total: 0 },
      { name: 'unchanged-500-allowed-without-contract', before: 'http-500', after: 'http-500', exit: 0, total: 0 },
      { name: 'unchanged-500-authored-failure', before: 'http-500', after: 'http-500', rule: { ...selector, allowedStatuses: [200] }, exit: 1, checks: 1, authored: 1, total: 1, kind: 'contract-status' },
      { name: 'absent-from-both-without-contract', before: 'missing-field', after: 'missing-field', exit: 0, total: 0 },
      { name: 'absent-from-both-authored-failure', before: 'missing-field', after: 'missing-field', rule: { ...selector, requiredJson }, exit: 1, checks: 1, authored: 1, total: 1, kind: 'contract-json-missing', path: '/user/role' },
      { name: 'ignore-does-not-hide-contract', before: 'baseline', after: 'missing-field', config: { ignoreJsonPaths: ['/user'] }, rule: { ...selector, requiredJson }, exit: 1, checks: 1, authored: 1, total: 1, ignored: 1, kind: 'contract-json-missing', path: '/user/role' },
      { name: 'ignore-and-contract-pass', before: 'baseline', after: 'timestamp', config: { mode: 'strict', ignoreJsonPaths: ['/timestamp'] }, rule: { ...selector, allowedStatuses: [200], requiredJson }, exit: 0, checks: 2, authored: 0, total: 0, ignored: 1 },
      { name: 'ordinary-failure-persists-when-contract-allows-500', before: 'baseline', after: 'http-500', rule: { ...selector, allowedStatuses: [500] }, exit: 1, checks: 1, authored: 0, total: 1, kind: 'http-failure' },
      { name: 'ordinary-plus-authored-failure', before: 'baseline', after: 'http-500', rule: { ...selector, allowedStatuses: [200] }, exit: 1, checks: 1, authored: 1, total: 2, kind: 'contract-status' },
      { name: 'contract-typo', before: 'baseline', after: 'baseline', rule: { ...selector, path: '/api/typo', allowedStatuses: [200] }, exit: 2, error: 'CONTRACT_UNUSED' },
      { name: 'contract-excluded-by-selection', before: 'baseline', after: 'baseline', rule: { ...selector, path: '/fixture.css', allowedStatuses: [200] }, exit: 2, error: 'CONTRACT_UNUSED' },
    ];
    for (const item of cases) {
      const configPath = join(output, item.name + '.config.json');
      await writeFile(configPath, JSON.stringify({ includeOperations, ...item.config, ...(item.rule ? { contracts: [item.rule] } : {}) }, null, 2) + '\n', { flag: 'wx' });
      const args = [cli, 'compare', '--baseline', join(output, item.before + '.har'), '--candidate', join(output, item.after + '.har'), '--config', configPath];
      const run = await runNode(item.error ? args : [...args, '--json', join(output, item.name + '.json'), '--html', join(output, item.name + '.html'), '--junit', join(output, item.name + '.xml')], { cwd: output });
      assert.equal(run.error, undefined); assert.equal(run.status, item.exit, item.name + ': ' + run.stdout + run.stderr);
      const report = JSON.parse(run.stdout);
      if (item.error) assert.equal(report.error.code, item.error, item.name);
      else {
        assert.equal(report.summary.regressions, item.total, item.name);
        if (item.rule) assert.deepEqual(report.contracts, { rules: 1, checks: item.checks, regressions: item.authored }, item.name);
        else assert.equal(report.contracts, undefined);
        if (item.kind) assert.ok(report.findings.some(f => f.kind === item.kind && (!item.path || f.path === item.path)), item.name);
        for (const finding of report.findings) assert.deepEqual(finding.evidence, { baselineEntry: 4, candidateEntry: 4 });
        if (item.ignored !== undefined) assert.equal(report.summary.ignoredNodes, item.ignored);
        const xml = await readFile(join(output, item.name + '.xml'), 'utf8');
        const parsed = validateJUnit(xml, report);
        const html = await readFile(join(output, item.name + '.html'), 'utf8');
        assert.doesNotMatch(run.stdout + html + xml, /Synthetic Alice|2026-11-03T00:00:0[01]Z/u, 'raw response values must not enter any report');
        if (item.rule) assert.match(html, /Authored assertions/u);
        results.push({ name: item.name, exit: run.status, authoredChecks: report.contracts?.checks, authoredFailures: report.contracts?.regressions, totalRegressions: report.summary.regressions, junit: parsed });
      }
      if (item.error) results.push({ name: item.name, exit: run.status, error: report.error.code });
    }
    assert.equal(fixture.requests.length, snapshot, 'authored assertions must not replay captured traffic');
    const receipt = { source: 'Actual localhost HTTP captures plus explicitly authored rules', captureRequests, detectorPositiveControlRequests: 1, cliNetworkRequestsObservedAtFixture: 0, independentXmlParser: '@xmldom/xmldom 0.9.12', cases: results };
    await writeFile(join(output, 'contracts-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    return receipt;
  } finally { await fixture.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await mkdir(join(lab, 'output'), { recursive: true });
  const output = await mkdtemp(join(lab, 'output/contracts-'));
  console.log(JSON.stringify({ output, ...await runContractChecks(output) }, null, 2));
}
