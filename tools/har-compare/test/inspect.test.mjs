import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
function inspect(t, entries, tail = []) {
  const dir = mkdtempSync(join(tmpdir(), 'scope-inventory-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = join(dir, 'capture.har');
  writeFileSync(input, JSON.stringify({ log: { entries } }));
  const run = args => spawnSync(process.execPath, [cli, 'inspect', '--input', input, ...args.map(v => v.replaceAll('$DIR', dir))], { encoding: 'utf8', cwd: '/tmp', timeout: 5000 });
  const result = run(tail);
  return { ...result, data: result.stdout ? JSON.parse(result.stdout) : null, run, dir };
}
const e = (url, mime = 'application/json', text = '{}', status = 200) => ({ request: { method: 'GET', url, headers: [{ name: 'Authorization', value: 'HEADER_SECRET' }] }, response: { status, content: { mimeType: mime, text } } });

test('inspect inventories mixed captures without pretending body analysis', t => {
  const r = inspect(t, [e('https://app.example.invalid/', 'text/html', '<h1>BODY_SECRET</h1>'), e('https://api.example.invalid/users/7?token=QUERY_SECRET'), e('https://api.example.invalid/users/7?token=ANOTHER_SECRET'), e('https://app.example.invalid/logo.png', 'image/png', undefined)]);
  assert.equal(r.status, 0); assert.equal(r.data.kind, 'inventory'); assert.equal(r.data.analysisPerformed, false);
  assert.equal(r.data.summary.entries, 4); assert.equal(r.data.summary.operations, 3);
  const op = r.data.operations.find(o => o.selector.origin === 'https://api.example.invalid');
  assert.deepEqual(op.entries, [2, 3]); assert.equal(op.queryVariants, 2); assert.equal(op.jsonResponses, 2);
  assert.deepEqual(r.data.configTemplate, { includeOperations: [{ method: 'GET', origin: 'https://api.example.invalid', path: '/users/7' }] });
  assert.doesNotMatch(r.stdout, /HEADER_SECRET|BODY_SECRET|QUERY_SECRET|ANOTHER_SECRET|token/);
});
test('inspect reports missing JSON capture and unavailable status without emitting payloads', t => {
  const missing = e('https://api.example.invalid/x'); delete missing.response.content.text;
  const incomplete = { request: { method: 'GET', url: 'https://api.example.invalid/x' } };
  const r = inspect(t, [missing, incomplete]);
  assert.equal(r.status, 0); assert.equal(r.data.operations[0].missingJsonBodies, 1);
  assert.equal(r.data.operations[0].unavailableStatuses, 1); assert.equal(r.data.analysisPerformed, false);
});
test('inspect keeps origins distinct, canonicalizes query ordering and omits credentials/fragments', t => {
  const r = inspect(t, [e('https://USER_SECRET:PASS_SECRET@api.example.invalid:8443/x?a=1&b=2#FRAGMENT_SECRET'), e('https://api.example.invalid:8443/x?b=2&a=1'), e('http://api.example.invalid/x')]);
  assert.equal(r.status, 0); assert.equal(r.data.operations.length, 2);
  const op = r.data.operations.find(o => o.selector.origin.includes('8443'));
  assert.equal(op.queryVariants, 1); assert.doesNotMatch(r.stdout, /USER_SECRET|PASS_SECRET|FRAGMENT_SECRET/);
});
test('inspect writes deterministic JSON to a new path and refuses overwrite', t => {
  const r = inspect(t, [e('https://api.example.invalid/x')], ['--json', '$DIR/inventory.json']);
  assert.equal(r.status, 0); assert.equal(readFileSync(join(r.dir, 'inventory.json'), 'utf8'), r.stdout);
  assert.equal(r.run([]).stdout, r.stdout); assert.equal(r.run(['--json', join(r.dir, 'inventory.json')]).status, 2);
});
test('inspect rejects malformed request identities and irrelevant flags', t => {
  assert.equal(inspect(t, [e('file:///etc/passwd')]).status, 2);
  assert.equal(inspect(t, [e('https://api.example.invalid/x')], ['--html', '$DIR/ignored.html']).status, 2);
  assert.equal(inspect(t, [e('https://api.example.invalid/x')], ['--baseline', 'unused.har']).status, 2);
});
test('inspect never truncates a config template into a silently incomplete selection', t => {
  const r = inspect(t, Array.from({ length: 101 }, (_, i) => e('https://api.example.invalid/x/' + i)));
  assert.equal(r.status, 0); assert.equal(r.data.operations.length, 101); assert.equal(r.data.configTemplate, null);
  assert.equal(r.data.templateUnavailable, 'too-many-json-operations');
});
test('inspect gives no invalid empty selector template when no JSON operation exists', t => {
  const r = inspect(t, [e('https://app.example.invalid/', 'text/html', '')]);
  assert.equal(r.status, 0); assert.equal(r.data.configTemplate, null); assert.equal(r.data.templateUnavailable, 'no-json-operations');
});

test('inspect never advertises a config template exceeding the CLI config byte limit', t => {
  const r = inspect(t, Array.from({ length: 20 }, (_, i) => e('https://api.example.invalid/' + 'x'.repeat(3500) + i)));
  assert.equal(r.status, 0); assert.equal(r.data.operations.length, 20);
  assert.equal(r.data.configTemplate, null); assert.equal(r.data.templateUnavailable, 'config-byte-limit');
});
