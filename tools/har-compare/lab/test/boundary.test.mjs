import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startFixture } from '../fixture.mjs';
import * as captures from '../capture.mjs';

test('boundary fixture preserves duplicate members and lossy decimals as actual response bytes', async t => {
  const fixture = await startFixture(); t.after(() => fixture.close());
  const call = name => fetch(fixture.origin + '/api/boundary/json/' + name, { headers: { 'x-scope-phase': 'candidate' } });
  const duplicate = await call('escaped-duplicate');
  assert.equal(duplicate.status, 200, 'bounded JSON boundary route must exist');
  assert.equal(duplicate.headers.get('content-type'), 'application/json');
  assert.equal(await duplicate.text(), '{"a":1,"\\u0061":2}');
  assert.equal(await (await call('lossy-decimal')).text(), '{"measure":1.0000000000000001}');
  assert.equal((await call('unbounded-input')).status, 404);
});

test('boundary scope fixture changes identical pointers at two distinct operations', async t => {
  const fixture = await startFixture(); t.after(() => fixture.close());
  const call = (path, phase) => fetch(fixture.origin + '/api/boundary/' + path, { headers: { 'x-scope-phase': phase, 'x-scope-boundary': 'scoped' } });
  const before = await call('health', 'baseline');
  assert.equal(before.status, 200, 'operation-scoped noise fixture must exist');
  const a = await before.json(), b = await (await call('health', 'candidate')).json();
  assert.notEqual(a.timestamp, b.timestamp);
  assert.notEqual(a.meta.timestamp, b.meta.timestamp);
  assert.deepEqual(b, await (await call('billing', 'candidate')).json());
  assert.equal((await call('health', 'invalid')).status, 400);
});

test('boundary recorder keeps raw numeric and duplicate text and rejects unknown/off-origin inputs', async t => {
  assert.equal(typeof captures.captureBoundary, 'function', 'bounded boundary recorder must be available');
  const fixture = await startFixture(); t.after(() => fixture.close());
  const duplicate = await captures.captureBoundary(fixture.origin, 'escaped-duplicate', 'candidate');
  assert.equal(duplicate.log.entries.length, 1);
  assert.equal(duplicate.log.entries[0].response.content.text, '{"a":1,"\\u0061":2}');
  const scopes = await captures.captureBoundary(fixture.origin, 'scoped-http-500', 'candidate');
  assert.deepEqual(scopes.log.entries.map(entry => entry.response.status), [500, 200]);
  assert.equal(fixture.requests.length, 3);
  const before = fixture.requests.length;
  await assert.rejects(() => captures.captureBoundary(fixture.origin, 'not-bounded', 'candidate'), /known bounded/u);
  await assert.rejects(() => captures.captureBoundary(fixture.origin, 'safe-decimal', 'not-phase'), /known synthetic phase/u);
  await assert.rejects(() => captures.captureBoundary('http://example.invalid', 'safe-decimal', 'baseline'), /lab loopback origin/u);
  assert.equal(fixture.requests.length, before);
});

test('HTTP boundary capture preserves invalid UTF-8 bytes as canonical HAR base64', async t => {
  const fixture = await startFixture(); t.after(() => fixture.close());
  const response = await fetch(fixture.origin + '/api/boundary/json/invalid-utf8', { headers: { 'x-scope-phase': 'candidate' } });
  assert.equal(response.status, 200, 'binary JSON boundary route must exist');
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.deepEqual([...bytes], [123, 34, 97, 34, 58, 34, 255, 34, 125]);
  const har = await captures.captureBoundary(fixture.origin, 'invalid-utf8', 'candidate');
  const content = har.log.entries[0].response.content;
  assert.equal(content.encoding, 'base64');
  assert.equal(content.text, bytes.toString('base64'));
  assert.equal(content.size, bytes.length);
  assert.equal(har.log.entries[0].response.bodySize, bytes.length);
  assert.deepEqual(Buffer.from(content.text, 'base64'), bytes);
});

test('HTTP boundary capture preserves one and two UTF-8 BOMs without fetch text normalization', async t => {
  const fixture = await startFixture(); t.after(() => fixture.close());
  for (const [name, count] of [['single-bom', 1], ['double-bom', 2]]) {
    const response = await fetch(fixture.origin + '/api/boundary/json/' + name, { headers: { 'x-scope-phase': 'candidate' } });
    assert.equal(response.status, 200, 'bounded BOM route must exist');
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(bytes.subarray(0, count * 3), Buffer.concat(Array.from({ length: count }, () => Buffer.from([239, 187, 191]))));
    const har = await captures.captureBoundary(fixture.origin, name, 'candidate');
    const content = har.log.entries[0].response.content;
    assert.equal(content.text.slice(0, count), '\uFEFF'.repeat(count));
    assert.equal(content.encoding, undefined);
    assert.deepEqual(Buffer.from(content.text, 'utf8'), bytes);
    assert.equal(content.size, bytes.length);
  }
});

test('query recorder sends bounded original percent bytes through actual HTTP', async t => {
  assert.equal(typeof captures.captureQuery, 'function', 'bounded query recorder must be available');
  const fixture = await startFixture(); t.after(() => fixture.close());
  const har = await captures.captureQuery(fixture.origin, 'invalid-versus-replacement', 'baseline');
  assert.equal(har.log.entries[0].request.url, fixture.origin + '/api/query?q=%FF');
  assert.deepEqual(fixture.requests.at(-1), { method: 'GET', path: '/api/query', rawTarget: '/api/query?q=%FF' });
  assert.equal(har.log.entries[0].response.status, 200);
  assert.equal(har.log.entries[0].response.content.text, '{"value":"SYNTHETIC_QUERY_BODY_SECRET"}');
  const count = fixture.requests.length;
  await assert.rejects(() => captures.captureQuery(fixture.origin, 'unknown', 'baseline'), /known bounded/u);
  await assert.rejects(() => captures.captureQuery(fixture.origin, 'invalid-versus-replacement', 'unknown'), /known synthetic phase/u);
  await assert.rejects(() => captures.captureQuery('http://example.invalid', 'invalid-versus-replacement', 'baseline'), /lab loopback origin/u);
  assert.equal(fixture.requests.length, count);
});
