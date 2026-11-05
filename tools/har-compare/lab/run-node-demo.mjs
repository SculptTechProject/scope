import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixture, scenarios, errorScenarios } from './fixture.mjs';
import { captureWithNode } from './capture.mjs';
import { runNode } from './process.mjs';
import { validateJUnit } from './junit-check.mjs';

const lab = fileURLToPath(new URL('./', import.meta.url));
const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
export async function runNodeDemo(output) {
  await mkdir(output, { recursive: true });
  const fixture = await startFixture();
  const results = [];
  let receipt, offlineArgs, offlineExpected;
  try {
    for (const scenario of [...scenarios, ...errorScenarios]) await writeFile(join(output, scenario + '.har'), JSON.stringify(await captureWithNode(fixture.origin, scenario), null, 2) + '\n', { flag: 'wx' });
    // Model an exporter that omits an actually available JSON body; keep the gap explicit.
    const captureGap = JSON.parse(await readFile(join(output, 'baseline.har'), 'utf8'));
    delete captureGap.log.entries[3].response.content.text;
    captureGap.log.creator.name += ' / deliberately omitted API body negative control';
    await writeFile(join(output, 'missing-json-capture.har'), JSON.stringify(captureGap, null, 2) + '\n', { flag: 'wx' });
    const captureRequests = fixture.requests.length;
    // This runs in a separate Node process, proving that the live counter detects child traffic.
    const probe = await runNode(['--input-type=module', '-e', `const r=await fetch(${JSON.stringify(fixture.origin + '/detector-positive-control')});process.stdout.write(String(r.status))`], { cwd: output });
    assert.equal(probe.status, 0); assert.equal(probe.stdout, '404');
    assert.equal(fixture.requests.length, captureRequests + 1, 'positive control must increment the live fixture counter exactly once');
    const requestCount = fixture.requests.length;
    const inventoryRun = await runNode([cli, 'inspect', '--input', join(output, 'baseline.har')], { cwd: output });
    assert.equal(inventoryRun.error, undefined);
    assert.equal(inventoryRun.status, 0, inventoryRun.stderr + inventoryRun.stdout);
    const inventory = JSON.parse(inventoryRun.stdout);
    assert.equal(inventory.analysisPerformed, false);
    assert.deepEqual(inventory.summary, { entries: 4, operations: 4 });
    assert.deepEqual(inventory.configTemplate, { includeOperations: [{ method: 'GET', origin: fixture.origin, path: '/api/user' }] });
    assert.deepEqual(inventory.operations.find(operation => operation.selector.path === '/api/user').entries, [4]);
    await writeFile(join(output, 'inventory.json'), inventoryRun.stdout, { flag: 'wx' });
    const { includeOperations } = inventory.configTemplate;
    const cases = [
      { name: 'missing-field', candidate: 'missing-field', config: { includeOperations }, exit: 1, kind: 'field-removed', path: '/user/role' },
      { name: 'http-500', candidate: 'http-500', config: { includeOperations }, exit: 1, kind: 'http-failure' },
      { name: 'timestamp-strict', candidate: 'timestamp', config: { includeOperations, mode: 'strict' }, exit: 1, kind: 'value-changed', path: '/timestamp' },
      { name: 'timestamp-ignored', candidate: 'timestamp', config: { includeOperations, mode: 'strict', ignoreJsonPaths: ['/timestamp'] }, exit: 0 },
      { name: 'unchanged', candidate: 'baseline', config: { includeOperations, mode: 'strict' }, exit: 0 },
      { name: 'mixed-unselected', candidate: 'baseline', config: {}, exit: 2, error: 'BODY' },
      { name: 'wrong-selector', candidate: 'baseline', config: { includeOperations: [{ ...includeOperations[0], path: '/api/typo' }] }, exit: 2, error: 'SELECTION_UNUSED' },
      { name: 'missing-json-capture', candidate: 'missing-json-capture', config: { includeOperations }, exit: 2, error: 'BODY' },
      { name: 'selected-html-error', candidate: 'http-500-html', config: { includeOperations }, exit: 2, error: 'BODY' },
      { name: 'selected-empty-json', candidate: 'empty-json', config: { includeOperations }, exit: 2, error: 'JSON' },
    ];
    for (const item of cases) {
      const configPath = join(output, item.name + '.config.json');
      await writeFile(configPath, JSON.stringify(item.config, null, 2) + '\n', { flag: 'wx' });
      const analysisArgs = [cli, 'compare', '--baseline', join(output, 'baseline.har'), '--candidate', join(output, item.candidate + '.har'), '--config', configPath];
      const args = item.error ? analysisArgs : [...analysisArgs, '--json', join(output, item.name + '.json'), '--html', join(output, item.name + '.html'), '--junit', join(output, item.name + '.xml')];
      const run = await runNode(args, { cwd: output });
      assert.equal(run.error, undefined, item.name + ': child execution must complete');
      assert.equal(run.status, item.exit, item.name + ': ' + run.stderr + run.stdout);
      const report = JSON.parse(run.stdout);
      if (item.error) assert.equal(report.error.code, item.error, item.name);
      else {
        validateJUnit(await readFile(join(output, item.name + '.xml'), 'utf8'), report);
        assert.deepEqual(report.coverage, { baseline: { totalEntries: 4, selectedEntries: 1, excludedEntries: 3 }, candidate: { totalEntries: 4, selectedEntries: 1, excludedEntries: 3 } });
        if (item.kind) assert.ok(report.findings.some(f => f.kind === item.kind && (!item.path || f.path === item.path)), item.name + ': expected meaningful finding');
        else assert.equal(report.summary.regressions, 0);
        const rerun = await runNode(analysisArgs, { cwd: output });
        assert.equal(rerun.status, item.exit);
        assert.equal(rerun.stdout, run.stdout, item.name + ': unchanged inputs must produce byte-identical JSON');
        assert.equal(await readFile(join(output, item.name + '.json'), 'utf8'), run.stdout);
        if (item.name === 'unchanged') { offlineArgs = analysisArgs; offlineExpected = run.stdout; }
      }
      results.push({ name: item.name, expectedExit: item.exit, actualExit: run.status, findings: report.findings?.map(f => ({ kind: f.kind, path: f.path, evidence: f.evidence })), error: report.error?.code });
    }
    assert.equal(fixture.requests.length, requestCount, 'inspect and compare must not replay any captured localhost URL while the detector remains live');
    receipt = { source: 'Actual Node fetch localhost exchanges; not browser capture', origin: fixture.origin, captureRequests, detectorPositiveControlRequests: 1, detectorServerAliveDuringCli: true, cliNetworkRequestsObservedAtFixture: 0, inventory: { entries: inventory.summary.entries, operations: inventory.summary.operations, selectedApiEntries: [4], configurationSource: 'CLI inspect configTemplate' }, cases: results };
  } finally { await fixture.close(); }
  const offline = await runNode(offlineArgs, { cwd: output });
  assert.equal(offline.status, 0, 'saved HAR analysis must succeed after the fixture server stops');
  assert.equal(offline.stdout, offlineExpected, 'saved HAR analysis must remain identical after the server stops');
  receipt.offlineAfterServerStopped = { exit: offline.status, byteIdenticalJson: true };
  await writeFile(join(output, 'node-demo-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  return receipt;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await mkdir(join(lab, 'output'), { recursive: true });
  const output = await mkdtemp(join(lab, 'output/node-demo-'));
  const receipt = await runNodeDemo(output);
  console.log(JSON.stringify({ output, ...receipt }, null, 2));
}
