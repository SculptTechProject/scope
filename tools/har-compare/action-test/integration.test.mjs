import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { prepare, verify } from './integration-check.mjs';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const tool = join(repository, 'tools', 'har-compare');
const action = join(repository, '.github', 'actions', 'har-compare');
// Exercise the actual metadata shell command, including the quoted action path.
const command = readFileSync(join(action, 'action.yml'), 'utf8').match(/^\s+run: (.+)$/m)[1];

for (const [scenario, current, code] of [['clean', 'baseline.har', 0], ['regression', 'missing-field.har', 1], ['invalid', null, 2]]) {
  test(`composite integration gate verifies ${scenario} and rejects broken caller evidence`, t => {
    const root = mkdtempSync(join(tmpdir(), 'scope-composite-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const workspace = join(root, 'consumer workspace');
    const checkout = join(workspace, '.scope action');
    const copiedTool = join(checkout, 'tools', 'har-compare');
    mkdirSync(copiedTool, { recursive: true });
    cpSync(action, join(checkout, '.github', 'actions', 'har-compare'), { recursive: true });
    for (const name of ['cli.mjs', 'src', 'formats', 'json', 'contracts', 'examples/fixtures']) {
      cpSync(join(tool, name), join(copiedTool, name), { recursive: true });
    }
    prepare(workspace);
    const result = { scenario, workspace };
    for (const mode of ['default', 'deferred']) {
      const outputFile = join(root, `${mode}-outputs`);
      writeFileSync(outputFile, '');
      const child = spawnSync('bash', ['-c', command], { cwd: workspace, encoding: 'utf8', timeout: 10000,
        env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
          GITHUB_WORKSPACE: workspace, GITHUB_OUTPUT: outputFile,
          SCOPE_ACTION_PATH: join(checkout, '.github', 'actions', 'har-compare'),
          SCOPE_BASELINE: '.scope action/tools/har-compare/examples/fixtures/baseline.har',
          SCOPE_CURRENT: current ? `.scope action/tools/har-compare/examples/fixtures/${current}` : 'scope-action-ci/invalid.har',
          SCOPE_CONFIG: '', SCOPE_OUTPUT: `scope-action-ci/${scenario}-${mode}`,
          SCOPE_LABELS: 'ids', SCOPE_FAIL_ON_RESULT: mode === 'default' ? 'true' : 'false' } });
      assert.equal(child.error, undefined);
      assert.equal(child.status, mode === 'default' ? code : 0, child.stderr);
      result[`${mode}Outcome`] = child.status === 0 ? 'success' : 'failure';
      result[`${mode}Outputs`] = Object.fromEntries(readFileSync(outputFile, 'utf8').trimEnd().split('\n').map(line => {
        const split = line.indexOf('=');
        return [line.slice(0, split), line.slice(split + 1)];
      }));
    }
    verify(result);
    const missing = structuredClone(result);
    delete missing.defaultOutputs['exit-code'];
    assert.throws(() => verify(missing), /all eight declared outputs/);
    assert.throws(() => verify({ ...result, deferredOutcome: 'failure' }), /deferred caller outcome/);
    const wrong = structuredClone(result);
    wrong.deferredOutputs['exit-code'] = code === 0 ? '1' : '0';
    assert.throws(() => verify(wrong), /real classified status/);
    writeFileSync(join(workspace, 'consumer-cli-executed'), 'negative control');
    assert.throws(() => verify(result), /consumer CLI must not execute/);
    rmSync(join(workspace, 'consumer-cli-executed'));
    if (code !== 2) {
      writeFileSync(result.defaultOutputs['html-report'], 'https://api.example.invalid/users/7');
      assert.throws(() => verify(result), /minimized labels/);
    }
  });
}
