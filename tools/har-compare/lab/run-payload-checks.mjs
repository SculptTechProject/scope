import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixture } from './fixture.mjs';
import { capturePayloads } from './capture.mjs';
import { payloads } from './payloads.mjs';
import { runNode } from './process.mjs';
import { validateJUnit } from './junit-check.mjs';

const lab = fileURLToPath(new URL('./', import.meta.url));
const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const secrets = /SYNTHETIC_PAYLOAD_(?:BODY_SECRET_\d+|QUERY_SECRET|HEADER_SECRET)/u;

/** Fixed hostile field names cross the real HTTP -> CLI -> XML/HTML boundaries as data. */
export async function runPayloadChecks(output) {
  await mkdir(output, { recursive: true });
  const fixture = await startFixture(), results = [];
  try {
    for (const phase of ['baseline', 'candidate']) await writeFile(join(output, phase + '.har'), JSON.stringify(await capturePayloads(fixture.origin, phase), null, 2) + '\n', { flag: 'wx' });
    const captureRequests = fixture.requests.length;
    assert.equal(captureRequests, 2);
    const probe = await runNode(['--input-type=module', '-e', `const r=await fetch(${JSON.stringify(fixture.origin + '/payload-detector-positive-control')});process.stdout.write(String(r.status))`], { cwd: output });
    assert.equal(probe.status, 0); assert.equal(probe.stdout, '404'); assert.equal(fixture.requests.length, captureRequests + 1);
    const snapshot = fixture.requests.length;
    const selector = { method: 'GET', origin: fixture.origin, path: '/api/payloads' };
    const paths = payloads.map(payload => payload.pointer).sort();
    for (const item of [
      { name: 'removed-hostile-fields', before: 'baseline', after: 'candidate', exit: 1, regressions: 12, informational: 0, kind: 'field-removed' },
      { name: 'added-hostile-fields', before: 'candidate', after: 'baseline', exit: 0, regressions: 0, informational: 12, kind: 'field-added' },
      { name: 'unchanged-hostile-fields', before: 'baseline', after: 'baseline', exit: 0, regressions: 0, informational: 0 },
      { name: 'hostile-required-fields-despite-ignore', before: 'baseline', after: 'candidate', exit: 1, regressions: 12, informational: 0, kind: 'contract-json-missing', config: { ignoreJsonPaths: paths, contracts: [{ ...selector, requiredJson: paths.map(pointer => ({ pointer, type: 'string' })) }] } },
    ]) {
      const config = join(output, item.name + '.config.json');
      await writeFile(config, JSON.stringify({ includeOperations: [selector], ...item.config }, null, 2) + '\n', { flag: 'wx' });
      const args = [cli, 'compare', '--baseline', join(output, item.before + '.har'), '--candidate', join(output, item.after + '.har'), '--config', config];
      const run = await runNode([...args, '--json', join(output, item.name + '.json'), '--html', join(output, item.name + '.html'), '--junit', join(output, item.name + '.xml')], { cwd: output });
      assert.equal(run.error, undefined); assert.equal(run.status, item.exit, item.name + ': ' + run.stdout + run.stderr);
      const report = JSON.parse(run.stdout);
      assert.equal(report.summary.regressions, item.regressions); assert.equal(report.summary.informational, item.informational);
      if (item.kind) {
        assert.deepEqual(report.findings.map(finding => finding.path).sort(), paths, item.name);
        for (const finding of report.findings) { assert.equal(finding.kind, item.kind); assert.deepEqual(finding.evidence, { baselineEntry: 1, candidateEntry: 1 }); }
      }
      if (item.config) { assert.equal(report.summary.ignoredNodes, 12); assert.deepEqual(report.contracts, { rules: 1, checks: 12, regressions: 12 }); }
      const xml = await readFile(join(output, item.name + '.xml'), 'utf8'), html = await readFile(join(output, item.name + '.html'), 'utf8');
      const parsed = validateJUnit(xml, report);
      assert.doesNotMatch(xml + html + run.stdout, secrets);
      assert.doesNotMatch(xml, /<script\b|<svg\b|<img\b|<!\[CDATA\[|<testcase name="SYNTHETIC_XML_INJECTION"/iu);
      assert.doesNotMatch(html, /<script\b|<svg\b|<img\b|<iframe\b|<object\b|<embed\b|<link\b/iu);
      assert.equal(await readFile(join(output, item.name + '.json'), 'utf8'), run.stdout);
      const repeat = await runNode(args, { cwd: output }); assert.equal(repeat.status, item.exit); assert.equal(repeat.stdout, run.stdout);
      results.push({ name: item.name, exit: run.status, regressions: report.summary.regressions, informational: report.summary.informational, junit: parsed });
    }
    assert.equal(fixture.requests.length, snapshot, 'payload analysis must not replay saved requests');
    const receipt = { source: 'Two actual localhost captures with twelve fixed hostile JSON field names; static HTML/XML checks, not browser execution', captureRequests, payloads: payloads.map(payload => payload.name), detectorPositiveControlRequests: 1, cliNetworkRequestsObservedAtFixture: 0, independentXmlParser: '@xmldom/xmldom 0.9.12', xmlInvalidCharacters: 'U+FFFD replacement; XML line-ending normalization accounted for independently', browserExecutionVerified: false, cases: results };
    await writeFile(join(output, 'payload-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    return receipt;
  } finally { await fixture.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await mkdir(join(lab, 'output'), { recursive: true });
  const output = await mkdtemp(join(lab, 'output/payloads-'));
  console.log(JSON.stringify({ output, ...await runPayloadChecks(output) }, null, 2));
}
