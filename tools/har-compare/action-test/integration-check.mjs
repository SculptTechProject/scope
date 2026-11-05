import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const names = ['exit-code', 'result', 'regressions', 'informational', 'error-code', 'json-report', 'html-report', 'junit-report'];
const reportNames = { 'json-report': 'analysis.json', 'html-report': 'report.html', 'junit-report': 'results.xml' };
const expected = {
  clean: { code: '0', result: 'clean', regressions: '0', informational: '0', error: '' },
  regression: { code: '1', result: 'regression', regressions: '1', informational: '0', error: '' },
  invalid: { code: '2', result: 'invalid', regressions: '', informational: '', error: 'JSON' },
};

export function prepare(workspace) {
  mkdirSync(join(workspace, 'scope-action-ci'));
  writeFileSync(join(workspace, 'scope-action-ci', 'invalid.har'), '{SYNTHETIC_INVALID_CAPTURE');
  // A consumer checkout must never supply the executable used by the Action.
  const spoof = join(workspace, 'tools', 'har-compare');
  mkdirSync(spoof, { recursive: true });
  writeFileSync(join(spoof, 'cli.mjs'), "import { writeFileSync } from 'node:fs'; writeFileSync('consumer-cli-executed', 'spoofed'); process.exit(0);\n");
}

export function verify({ scenario, workspace, defaultOutcome, deferredOutcome, defaultOutputs, deferredOutputs }) {
  const result = expected[scenario];
  assert.ok(result, 'known synthetic scenario');
  assert.equal(defaultOutcome, result.code === '0' ? 'success' : 'failure', 'default caller outcome');
  assert.equal(deferredOutcome, 'success', 'deferred caller outcome');
  assert.equal(existsSync(join(workspace, 'consumer-cli-executed')), false, 'consumer CLI must not execute');
  for (const [mode, outputs] of [['default', defaultOutputs], ['deferred', deferredOutputs]]) {
    assert.deepEqual(Object.keys(outputs).sort(), [...names].sort(), `${mode}: all eight declared outputs`);
    assert.equal(outputs['exit-code'], result.code, `${mode}: real classified status`);
    assert.equal(outputs.result, result.result, `${mode}: result`);
    assert.equal(outputs.regressions, result.regressions, `${mode}: regression count`);
    assert.equal(outputs.informational, result.informational, `${mode}: informational count`);
    assert.equal(outputs['error-code'], result.error, `${mode}: diagnostic code`);
    for (const [key, filename] of Object.entries(reportNames)) {
      if (scenario === 'invalid') {
        assert.equal(outputs[key], '', `${mode}: invalid analysis exposes no report path`);
        continue;
      }
      const path = outputs[key];
      assert.ok(isAbsolute(path), `${mode}: absolute report path`);
      assert.equal(path, join(workspace, 'scope-action-ci', `${scenario}-${mode}`, filename), `${mode}: fresh report path`);
      assert.ok(statSync(path).isFile(), `${mode}: report exists`);
      const text = readFileSync(path, 'utf8');
      assert.doesNotMatch(text, /api\.example\.invalid|\/users\/7|\/user\/role|Synthetic/, `${mode}: minimized labels`);
    }
    if (scenario !== 'invalid') {
      const report = JSON.parse(readFileSync(outputs['json-report'], 'utf8'));
      assert.equal(report.privacy.labels, 'ids');
      assert.equal(report.summary.regressions, Number(result.regressions));
      assert.equal(report.summary.informational, Number(result.informational));
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'prepare') prepare(process.env.GITHUB_WORKSPACE);
  else if (process.argv[2] === 'verify') {
    verify({ scenario: process.env.SCENARIO, workspace: process.env.GITHUB_WORKSPACE,
      defaultOutcome: process.env.DEFAULT_OUTCOME, deferredOutcome: process.env.DEFERRED_OUTCOME,
      defaultOutputs: JSON.parse(process.env.DEFAULT_OUTPUTS), deferredOutputs: JSON.parse(process.env.DEFERRED_OUTPUTS) });
    console.log(`Composite Action ${process.env.SCENARIO}: default/deferred outcomes, all outputs and local reports verified.`);
  } else throw new Error('Expected prepare or verify.');
}
