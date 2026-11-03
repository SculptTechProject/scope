import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixture } from './fixture.mjs';
import { captureBoundary, captureQuery } from './capture.mjs';
import { jsonBoundaryBodies, scopeBoundaryScenarios, queryBoundaryCases } from './boundary-data.mjs';
import { runNode } from './process.mjs';
import { validateJUnit } from './junit-check.mjs';

const lab = fileURLToPath(new URL('./', import.meta.url));
const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const secrets = /SYNTHETIC_(?:BOUNDARY_(?:QUERY|HEADER)_SECRET|(?:DUPLICATE|MALFORMED)_SECRET|QUERY_(?:BODY|HEADER)_SECRET|STAMP_(?:BEFORE|AFTER)_SECRET)/u;

/** Process-level checks over captured bytes, not JSON values reconstructed after capture. */
export async function runBoundaryChecks(output) {
  await mkdir(output, { recursive: true });
  const fixture = await startFixture(), results = [], offlineChecks = [];
  let closed = false;
  try {
    for (const name of [...Object.keys(jsonBoundaryBodies), ...scopeBoundaryScenarios, ...queryBoundaryCases.map(item => item.name)]) {
      for (const phase of ['baseline', 'candidate']) {
        await writeFile(join(output, name + '.' + phase + '.har'), JSON.stringify(await (queryBoundaryCases.some(item => item.name === name) ? captureQuery : captureBoundary)(fixture.origin, name, phase), null, 2) + '\n', { flag: 'wx' });
      }
    }
    const captureRequests = fixture.requests.length;
    assert.equal(captureRequests, 66);
    assert.deepEqual(fixture.requests.filter(request => request.path === '/api/query').map(request => request.rawTarget), queryBoundaryCases.flatMap(item => ['/api/query?' + item.before, '/api/query?' + item.after]));
    const probe = await runNode(['--input-type=module', '-e', `const r=await fetch(${JSON.stringify(fixture.origin + '/boundary-detector-positive-control')});process.stdout.write(String(r.status))`], { cwd: output });
    assert.equal(probe.status, 0); assert.equal(probe.stdout, '404');
    assert.equal(fixture.requests.length, captureRequests + 1);
    const snapshot = fixture.requests.length;
    const selector = path => ({ method: 'GET', origin: fixture.origin, path: '/api/boundary/' + path });
    const scope = path => ({ ...selector(path), pointers: ['/timestamp', '/meta/timestamp'] });
    const bothScopes = [scope('health'), scope('billing')];
    const controls = Object.keys(jsonBoundaryBodies).map(name => ({
      name, capture: name, config: { mode: 'strict' },
      exit: ['duplicate-member', 'escaped-duplicate', 'nested-duplicate', 'malformed-string', 'invalid-utf8', 'double-bom'].includes(name) ? 2 : ['lossy-decimal', 'underflow', 'overflow'].includes(name) ? 2 : name === 'changed-decimal' ? 1 : 0,
      ...(['duplicate-member', 'escaped-duplicate', 'nested-duplicate', 'malformed-string', 'double-bom'].includes(name) ? { error: 'JSON' } : ['lossy-decimal', 'underflow', 'overflow'].includes(name) ? { error: 'NUMBER' } : name === 'invalid-utf8' ? { error: 'ENCODING' } : { regressions: name === 'changed-decimal' ? 1 : 0 }),
    }));
    controls.push(
      { name: 'scoped-strict-control', capture: 'scoped', config: { mode: 'strict' }, exit: 1, regressions: 4, ignored: 0 },
      { name: 'scoped-health-only', capture: 'scoped', config: { mode: 'strict', scopedIgnores: [scope('health')] }, exit: 1, regressions: 2, ignored: 2, scopedIgnored: 2, onlyFindingPath: '/api/boundary/billing' },
      { name: 'scoped-both-operations', capture: 'scoped', config: { mode: 'strict', scopedIgnores: bothScopes }, exit: 0, regressions: 0, ignored: 4, scopedIgnored: 4 },
      { name: 'scoped-wrong-operation', capture: 'scoped', config: { mode: 'strict', scopedIgnores: [scope('typo')] }, exit: 2, error: 'IGNORE_UNUSED' },
      { name: 'scoped-excluded-operation', capture: 'scoped', config: { mode: 'strict', includeOperations: [selector('billing')], scopedIgnores: [scope('health')] }, exit: 2, error: 'IGNORE_UNUSED' },
      { name: 'scoped-http-status-persists', capture: 'scoped-http-500', config: { mode: 'strict', scopedIgnores: bothScopes }, exit: 1, regressions: 1, ignored: 4, scopedIgnored: 4, kind: 'http-failure' },
      { name: 'scoped-authored-missing-persists', capture: 'scoped-missing', config: { mode: 'strict', scopedIgnores: bothScopes, contracts: [{ ...selector('health'), requiredJson: [{ pointer: '/timestamp', type: 'string' }] }] }, exit: 1, regressions: 1, ignored: 4, scopedIgnored: 4, kind: 'contract-json-missing' },
      { name: 'scoped-parent-change-invalidates-ignore', capture: 'scoped-parent', config: { mode: 'strict', scopedIgnores: bothScopes }, exit: 2, error: 'IGNORE_UNUSED' },
      { name: 'scoped-global-overlap-rejected', capture: 'scoped', config: { mode: 'strict', ignoreJsonPaths: ['/timestamp'], scopedIgnores: [scope('health')] }, exit: 2, error: 'CONFIG' },
      { name: 'scoped-shape-control', capture: 'scoped', config: { mode: 'shape' }, exit: 0, regressions: 0, ignored: 0 },
    );
    controls.push(...queryBoundaryCases.map(item => ({ name: item.name, capture: item.name, config: { mode: 'strict' }, exit: item.equivalent ? 0 : 1, regressions: item.equivalent ? 0 : 1, operations: item.equivalent ? 1 : 2, pairedEntries: item.equivalent ? 1 : 0 })));
    for (const item of controls) {
      const before = join(output, item.capture + '.baseline.har'), after = join(output, item.capture + '.candidate.har');
      const inventory = await runNode([cli, 'inspect', '--input', before], { cwd: output });
      assert.equal(inventory.status, 0, item.name + ': baseline inventory');
      assert.doesNotMatch(inventory.stdout, secrets);
      const template = JSON.parse(inventory.stdout).configTemplate;
      const config = join(output, item.name + '.config.json');
      await writeFile(config, JSON.stringify({ ...template, ...item.config }, null, 2) + '\n', { flag: 'wx' });
      const args = [cli, 'compare', '--baseline', before, '--candidate', after, '--config', config];
      const outputs = ['--json', join(output, item.name + '.json'), '--html', join(output, item.name + '.html'), '--junit', join(output, item.name + '.xml')];
      const run = await runNode([...args, ...outputs], { cwd: output });
      assert.equal(run.error, undefined);
      assert.equal(run.status, item.exit, item.name + ': ' + run.stdout + run.stderr);
      assert.doesNotMatch(run.stdout + run.stderr, secrets);
      const report = JSON.parse(run.stdout);
      if (item.error) {
        assert.equal(report.error.code, item.error, item.name);
        for (const extension of ['json', 'html', 'xml']) await assert.rejects(lstat(join(output, item.name + '.' + extension)), { code: 'ENOENT' }, 'invalid analysis must not produce success artifacts');
      }
      else {
        assert.equal(report.summary.regressions, item.regressions, item.name);
        if (item.operations !== undefined) {
          assert.equal(report.summary.operations, item.operations, item.name);
          assert.equal(report.summary.pairedEntries, item.pairedEntries, item.name);
          assert.deepEqual(report.findings.map(finding => finding.kind).sort(), item.exit === 0 ? [] : ['operation-added', 'operation-removed'], item.name);
          assert.doesNotMatch(run.stdout, /%ff|%fe|%ef%bb%bf|q=/iu);
        }
        if (item.ignored !== undefined) assert.equal(report.summary.ignoredNodes, item.ignored, item.name);
        if (item.scopedIgnored !== undefined) assert.equal(report.summary.scopedIgnoredNodes, item.scopedIgnored, item.name);
        if (item.kind) assert.deepEqual(report.findings.map(finding => finding.kind), [item.kind]);
        if (item.onlyFindingPath) {
          for (const finding of report.findings) assert.equal(report.operations.find(operation => operation.id === finding.operation).path, item.onlyFindingPath);
        }
        const html = await readFile(join(output, item.name + '.html'), 'utf8');
        const xml = await readFile(join(output, item.name + '.xml'), 'utf8');
        assert.doesNotMatch(html + xml, secrets);
        const parsed = validateJUnit(xml, report);
        assert.equal(await readFile(join(output, item.name + '.json'), 'utf8'), run.stdout);
        const repeat = await runNode(args, { cwd: output });
        assert.equal(repeat.status, item.exit); assert.equal(repeat.stdout, run.stdout);
        results.push({ name: item.name, exit: run.status, regressions: report.summary.regressions, ignoredNodes: report.summary.ignoredNodes, ...(item.operations !== undefined ? { operations: report.summary.operations, pairedEntries: report.summary.pairedEntries } : {}), ...(item.scopedIgnored !== undefined ? { scopedIgnoredNodes: report.summary.scopedIgnoredNodes } : {}), junit: parsed });
      }
      if (item.error) results.push({ name: item.name, exit: run.status, error: report.error.code });
      if (['escaped-duplicate', 'safe-decimal', 'scoped-health-only', 'invalid-hex-case', 'invalid-versus-replacement'].includes(item.name)) offlineChecks.push({ args, exit: run.status, stdout: run.stdout });
    }
    assert.equal(fixture.requests.length, snapshot, 'boundary CLI invocations must not replay the fixture');
    await fixture.close(); closed = true;
    for (const item of offlineChecks) {
      const offline = await runNode(item.args, { cwd: output });
      assert.equal(offline.status, item.exit); assert.equal(offline.stdout, item.stdout, 'saved analysis must be identical after server shutdown');
    }
    const receipt = { source: '66 actual localhost HTTP responses; fixed JSON/UTF-8/BOM, query-byte and operation-scope boundaries, not random fuzzing or browser capture', captureRequests, queryRequestTargetsVerified: queryBoundaryCases.length * 2, bomControls: ['single-bom', 'double-bom'], detectorPositiveControlRequests: 1, cliNetworkRequestsObservedAtFixture: 0, offlineRepeats: offlineChecks.length, independentXmlParser: '@xmldom/xmldom 0.9.12', cases: results };
    await writeFile(join(output, 'boundary-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    return receipt;
  } finally { if (!closed) await fixture.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await mkdir(join(lab, 'output'), { recursive: true });
  const output = await mkdtemp(join(lab, 'output/boundary-'));
  console.log(JSON.stringify({ output, ...await runBoundaryChecks(output) }, null, 2));
}
