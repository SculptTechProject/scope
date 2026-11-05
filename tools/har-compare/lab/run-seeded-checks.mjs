import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixture } from './fixture.mjs';
import { captureGenerated } from './capture.mjs';
import { runNode } from './process.mjs';
import { validateJUnit } from './junit-check.mjs';

const lab = fileURLToPath(new URL('./', import.meta.url));
const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const secretValues = /SYNTHETIC_(?:PRIVATE_VALUE_\d+|CHANGED_VALUE_\d+|QUERY_SECRET|HEADER_SECRET)/u;
const shapePaths = ['/record/a~1b', '/record/<img src=x onerror=scopeLabExecuted=true>', '/record/tilde~0key', '/record/__proto__'].sort();
const strictPaths = [...shapePaths, '/record/日本語', '/record/constructor'].sort();

export async function runSeededChecks(output) {
  await mkdir(output, { recursive: true });
  const fixture = await startFixture();
  const results = [];
  try {
    for (const phase of ['baseline', 'candidate']) await writeFile(join(output, phase + '.har'), JSON.stringify(await captureGenerated(fixture.origin, phase), null, 2) + '\n', { flag: 'wx' });
    const captureRequests = fixture.requests.length;
    const probe = await runNode(['--input-type=module', '-e', `const r=await fetch(${JSON.stringify(fixture.origin + '/detector-positive-control')});process.stdout.write(String(r.status))`], { cwd: output });
    assert.equal(probe.status, 0); assert.equal(probe.stdout, '404');
    assert.equal(fixture.requests.length, captureRequests + 1);
    const snapshot = fixture.requests.length;
    const inventory = await runNode([cli, 'inspect', '--input', join(output, 'baseline.har')], { cwd: output });
    assert.equal(inventory.status, 0);
    assert.doesNotMatch(inventory.stdout, secretValues);
    const data = JSON.parse(inventory.stdout);
    assert.deepEqual(data.summary, { entries: 16, operations: 1 });
    assert.equal(data.operations[0].queryVariants, 8);
    assert.deepEqual(data.configTemplate.includeOperations, [{ method: 'GET', origin: fixture.origin, path: '/api/generated' }]);
    await writeFile(join(output, 'inventory.json'), inventory.stdout, { flag: 'wx' });
    for (const item of [
      { name: 'shape-ignored', config: { mode: 'shape', ignoreJsonPaths: ['/noise'] }, regressions: 4, paths: shapePaths, ignored: 16 },
      { name: 'strict-ignored', config: { mode: 'strict', ignoreJsonPaths: ['/noise'] }, regressions: 6, paths: strictPaths, ignored: 16 },
      { name: 'strict-no-ignore', config: { mode: 'strict' }, regressions: 22, paths: [...strictPaths, ...new Array(16).fill('/noise')].sort(), ignored: 0 },
      { name: 'shape-scoped-noise', config: { mode: 'shape', scopedIgnores: [{ ...data.configTemplate.includeOperations[0], pointers: ['/noise'] }] }, regressions: 4, paths: shapePaths, ignored: 16, scopedIgnored: 16 },
      { name: 'strict-scoped-noise', config: { mode: 'strict', scopedIgnores: [{ ...data.configTemplate.includeOperations[0], pointers: ['/noise'] }] }, regressions: 6, paths: strictPaths, ignored: 16, scopedIgnored: 16 },
      { name: 'strict-global-noise-scoped-record', config: { mode: 'strict', ignoreJsonPaths: ['/noise'], scopedIgnores: [{ ...data.configTemplate.includeOperations[0], pointers: ['/record'] }] }, exit: 0, regressions: 0, paths: [], ignored: 32, scopedIgnored: 16 },
    ]) {
      const configPath = join(output, item.name + '.config.json');
      await writeFile(configPath, JSON.stringify({ ...data.configTemplate, ...item.config }, null, 2) + '\n', { flag: 'wx' });
      const args = [cli, 'compare', '--baseline', join(output, 'baseline.har'), '--candidate', join(output, 'candidate.har'), '--config', configPath];
      const run = await runNode([...args, '--json', join(output, item.name + '.json'), '--html', join(output, item.name + '.html'), '--junit', join(output, item.name + '.xml')], { cwd: output });
      assert.equal(run.status, item.exit ?? 1, item.name + ': ' + run.stdout + run.stderr);
      assert.equal(run.error, undefined);
      assert.doesNotMatch(run.stdout, secretValues);
      const report = JSON.parse(run.stdout);
      const xml = await readFile(join(output, item.name + '.xml'), 'utf8');
      validateJUnit(xml, report);
      assert.doesNotMatch(xml, secretValues);
      assert.doesNotMatch(xml, /<img\b/iu);
      assert.equal(report.summary.operations, 8, 'query variants must remain distinct operations');
      assert.equal(report.summary.pairedEntries, 16, 'query reordering must preserve all pairs');
      assert.equal(report.summary.regressions, item.regressions, item.name);
      assert.equal(report.summary.ignoredNodes, item.ignored, item.name);
      if (item.scopedIgnored !== undefined) assert.equal(report.summary.scopedIgnoredNodes, item.scopedIgnored, item.name);
      assert.deepEqual(report.findings.filter(f => f.severity === 'regression').map(f => f.path).sort(), item.paths, item.name);
      assert.equal(report.notices.filter(n => n.kind === 'ordinal-pairing').length, 8);
      for (const finding of report.findings) {
        assert.equal(finding.evidence.baselineEntry, finding.evidence.candidateEntry);
        if (finding.path !== '/noise') assert.equal(finding.occurrence, 2, 'one intact repeated response must not hide the changed second response');
      }
      const html = await readFile(join(output, item.name + '.html'), 'utf8');
      assert.doesNotMatch(html, secretValues);
      assert.doesNotMatch(html, /<img\b|<script\b/iu);
      if (item.paths.includes('/record/<img src=x onerror=scopeLabExecuted=true>')) assert.match(html, /&lt;img src=x onerror=scopeLabExecuted=true&gt;/u);
      const repeat = await runNode(args, { cwd: output });
      assert.equal(repeat.status, item.exit ?? 1); assert.equal(repeat.stdout, run.stdout);
      results.push({ name: item.name, exit: run.status, operations: report.summary.operations, pairs: report.summary.pairedEntries, regressions: report.summary.regressions, ignoredNodes: report.summary.ignoredNodes, ...(item.scopedIgnored !== undefined ? { scopedIgnoredNodes: report.summary.scopedIgnoredNodes } : {}) });
    }
    assert.equal(fixture.requests.length, snapshot, 'seed checks must not replay captured URLs');
    const receipt = { source: '32 actual localhost HTTP responses, fixed eight-seed corpus; not randomized fuzzing or browser capture', seedRange: [0, 7], repeatedResponsesPerSeed: 2, captureRequests, detectorPositiveControlRequests: 1, cliNetworkRequestsObservedAtFixture: 0, cases: results };
    await writeFile(join(output, 'seeded-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    return receipt;
  } finally { await fixture.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await mkdir(join(lab, 'output'), { recursive: true });
  const output = await mkdtemp(join(lab, 'output/seeded-'));
  console.log(JSON.stringify({ output, ...await runSeededChecks(output) }, null, 2));
}
