import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startFixture } from '../fixture.mjs';
import { runNode } from '../process.mjs';
import * as runners from '../process.mjs';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';

test('async child runner keeps the fixture responsive to a real child HTTP probe', { timeout: 5000 }, async t => {
  const fixture = await startFixture(); t.after(() => fixture.close());
  const run = await runNode(['--input-type=module', '-e', `const r=await fetch(${JSON.stringify(fixture.origin + '/api/user')},{headers:{'x-scope-scenario':'baseline'}});process.stdout.write(await r.text())`], { timeout: 2000 });
  assert.equal(run.status, 0, 'child HTTP request must complete while the parent fixture serves it');
  assert.equal(JSON.parse(run.stdout).user.role, 'reader');
  assert.equal(fixture.requests.length, 1, 'request counter must observe a child-process request');
});
test('child runner preserves nonzero CLI exits and bounds hung children', { timeout: 5000 }, async () => {
  const failure = await runNode(['-e', 'process.stdout.write("synthetic failure");process.exitCode=2']);
  assert.equal(failure.status, 2);
  assert.equal(failure.stdout, 'synthetic failure');
  assert.equal(failure.error, undefined);
  const timeout = await runNode(['-e', 'setInterval(()=>{},1000)'], { timeout: 100 });
  assert.equal(timeout.status, null);
  assert.ok(timeout.error, 'timeout must not be reported as a normal CLI exit');
});

const selected = { PATH: dirname(process.execPath), LANG: 'C.UTF-8', TMPDIR: tmpdir(), PLAYWRIGHT_BROWSERS_PATH: '/tmp/scope-synthetic-prepared-browser-cache', ...(process.env.HOME ? { HOME: process.env.HOME } : {}) };
const privateNames = ['SCOPE_SYNTHETIC_PRIVATE_ENV', 'NODE_OPTIONS', 'GH_TOKEN', 'HTTPS_PROXY', 'NODE_EXTRA_CA_CERTS'];
const childScript = `const blocked=${JSON.stringify(privateNames)};const allowed=${JSON.stringify(Object.keys(selected))};process.stdout.write(JSON.stringify({blockedPresent:blocked.filter(key=>Object.hasOwn(process.env,key)),selected:Object.fromEntries(allowed.map(key=>[key,process.env[key]]))}))`;
const contaminated = { ...selected, SCOPE_SYNTHETIC_PRIVATE_ENV: 'SYNTHETIC_NOT_A_REAL_SECRET', NODE_OPTIONS: '--scope-synthetic-option-must-not-reach-child', GH_TOKEN: 'SYNTHETIC_NOT_A_REAL_TOKEN', HTTPS_PROXY: 'http://synthetic:synthetic@example.invalid', NODE_EXTRA_CA_CERTS: '/tmp/scope-synthetic-not-a-real-ca.pem' };

test('actual async child receives selected runtime paths without private environment or Node options', async () => {
  const run = await runNode(['-e', childScript], { env: contaminated });
  assert.equal(run.status, 0, 'private Node options must not execute in the child');
  assert.deepEqual(JSON.parse(run.stdout), { blockedPresent: [], selected });
});

test('actual synchronous child filters inherited private environment and keeps public runtime paths', t => {
  assert.equal(typeof runners.runNodeSync, 'function', 'synchronous launcher must share the environment boundary');
  for (const name of ['SCOPE_SYNTHETIC_PRIVATE_ENV', 'NODE_OPTIONS']) {
    const original = process.env[name];
    t.after(() => { if (original === undefined) delete process.env[name]; else process.env[name] = original; });
    process.env[name] = contaminated[name];
  }
  const expected = Object.fromEntries(Object.keys(selected).filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]));
  const run = runners.runNodeSync(['-e', childScript]);
  assert.equal(run.status, 0, 'private Node options must not execute in the child');
  assert.deepEqual(JSON.parse(run.stdout), { blockedPresent: [], selected: expected });
});
