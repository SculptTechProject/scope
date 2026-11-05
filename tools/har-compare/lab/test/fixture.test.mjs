import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startFixture } from '../fixture.mjs';

test('synthetic API preserves stable URLs while changing a nested field', async t => {
  const fixture = await startFixture();
  assert.ok(fixture?.origin, 'fixture must expose its bound localhost origin');
  t.after(() => fixture.close());
  assert.equal(new URL(fixture.origin).hostname, '127.0.0.1');
  const call = scenario => fetch(fixture.origin + '/api/user', { headers: { 'x-scope-scenario': scenario } });
  const before = await (await call('baseline')).json();
  const missing = await (await call('missing-field')).json();
  assert.equal(before.user.role, 'reader');
  assert.equal(Object.hasOwn(missing.user, 'role'), false);
  assert.equal(missing.user.name, before.user.name);
});
test('HTTP failure and timestamp variants are independent regression controls', async t => {
  const fixture = await startFixture();
  assert.ok(fixture?.origin, 'fixture must expose its bound localhost origin');
  t.after(() => fixture.close());
  const call = scenario => fetch(fixture.origin + '/api/user', { headers: { 'x-scope-scenario': scenario } });
  const failure = await call('http-500');
  assert.equal(failure.status, 500);
  assert.equal((await failure.json()).user.role, 'reader');
  const before = await (await call('baseline')).json();
  const after = await (await call('timestamp')).json();
  assert.notEqual(before.timestamp, after.timestamp);
  assert.deepEqual(before.user, after.user);
});
test('browser fixture uses only same-origin assets and rejects unknown scenarios', async t => {
  const fixture = await startFixture();
  assert.ok(fixture?.origin, 'fixture must expose its bound localhost origin');
  t.after(() => fixture.close());
  const page = await fetch(fixture.origin + '/scenario/baseline');
  assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.match(await page.text(), /\/api\/user/);
  assert.equal((await fetch(fixture.origin + '/scenario/unknown')).status, 404);
  assert.equal((await fetch(fixture.origin + '/api/user', { headers: { 'x-scope-scenario': 'unknown' } })).status, 400);
});

test('selected API can return a real HTML error or an empty JSON response', async t => {
  const fixture = await startFixture(); t.after(() => fixture.close());
  const html = await fetch(fixture.origin + '/api/user', { headers: { 'x-scope-scenario': 'http-500-html' } });
  assert.equal(html.status, 500, 'HTML error must be served as actual HTTP 500');
  assert.equal(html.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.match(await html.text(), /Synthetic server error/);
  const empty = await fetch(fixture.origin + '/api/user', { headers: { 'x-scope-scenario': 'empty-json' } });
  assert.equal(empty.status, 200);
  assert.equal(empty.headers.get('content-type'), 'application/json');
  assert.equal(await empty.text(), '');
});

test('bounded generated responses vary escaped field keys without losing control semantics', async t => {
  const fixture = await startFixture(); t.after(() => fixture.close());
  const call = (seed, variant, phase = 'baseline') => fetch(fixture.origin + '/api/generated?seed=' + seed, { headers: { 'x-scope-variant': variant, 'x-scope-phase': phase } });
  const normal = await call(1, 'baseline');
  assert.equal(normal.status, 200, 'generated fixture route must exist');
  const before = await normal.json();
  assert.deepEqual(Object.keys(before.record), ['a/b']);
  const missing = await (await call(1, 'missing', 'candidate')).json();
  assert.deepEqual(missing.record, {});
  assert.notEqual(before.noise, missing.noise);
  const typed = await (await call(1, 'type')).json();
  assert.equal(typeof typed.record['a/b'], 'number');
  assert.equal((await call(8, 'baseline')).status, 400, 'seed space must be bounded');
  assert.equal((await call(1, 'unknown')).status, 400);
});

test('payload gallery serves original hostile field names as JSON data only', async t => {
  const fixture = await startFixture(); t.after(() => fixture.close());
  const response = await fetch(fixture.origin + '/api/payloads', { headers: { 'x-scope-phase': 'baseline' } });
  assert.equal(response.status, 200, 'payload route must exist');
  const body = await response.json();
  assert.equal(Object.keys(body).length, 12);
  assert.equal(Object.hasOwn(body, '__proto__'), true);
  assert.equal(Object.hasOwn(body, 'line\rbreak'), true);
  const after = await fetch(fixture.origin + '/api/payloads', { headers: { 'x-scope-phase': 'candidate' } });
  assert.deepEqual(await after.json(), {});
});
