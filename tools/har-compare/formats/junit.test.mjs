import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { junitReport } from './junit.mjs';

function report(findings = []) {
  return {
    schemaVersion: 1, tool: 'scope-har-compare', config: { mode: 'shape', ignoreJsonPaths: [] },
    operations: [{ id: 'operation-0001', method: 'GET', origin: 'https://api.example.test', path: '/users' }],
    findings,
  };
}
const finding = extra => ({
  id: 'finding-00001', operation: 'operation-0001', occurrence: 1,
  kind: 'field-removed', severity: 'regression', path: '/user/id',
  evidence: { baselineEntry: 1, candidateEntry: 2 }, ...extra,
});

test('a clean analysis emits one passing testcase with consistent suite counts', () => {
  const xml = junitReport(report());
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n/u);
  assert.match(xml, /<testsuites tests="1" failures="0" errors="0" skipped="0">/u);
  assert.match(xml, /<testsuite name="scope-har-compare" tests="1" failures="0" errors="0" skipped="0">/u);
  assert.match(xml, /<testcase classname="scope-har-compare" name="clean-analysis"\/>/u);
  assert.doesNotMatch(xml, /<failure|<skipped/u);
});

test('regressions fail while informational findings are skipped and counted individually', () => {
  const xml = junitReport(report([
    finding({ status: { before: 200, after: 500 }, kind: 'http-failure', path: undefined }),
    finding({ id: 'finding-00002', severity: 'info', kind: 'field-added', types: { after: 'string' } }),
  ]));
  assert.match(xml, /tests="2" failures="1" errors="0" skipped="1"/u);
  assert.equal((xml.match(/<testcase /gu) ?? []).length, 2);
  assert.equal((xml.match(/<failure /gu) ?? []).length, 1);
  assert.equal((xml.match(/<skipped /gu) ?? []).length, 1);
  assert.match(xml, /baseline entry: 1/u);
  assert.match(xml, /candidate entry: 2/u);
  assert.match(xml, /status: 200 -&gt; 500/u);
  assert.match(xml, /GET https:\/\/api.example.test\/users/u);
  assert.doesNotMatch(xml, /clean-analysis/u);
});

test('JSON pointers, type evidence and authored contract indices appear without full report data', () => {
  const input = report([finding({ id: 'contract-finding-00001', rule: 2, requirement: 3, types: { before: 'string', after: 'number' } })]);
  input.config.SYNTHETIC_SECRET = 'DO_NOT_EXPORT_CONFIG';
  input.body = 'DO_NOT_EXPORT_BODY';
  input.operations[0].key = 'DO_NOT_EXPORT_QUERY';
  const xml = junitReport(input);
  assert.match(xml, /JSON pointer: \/user\/id/u);
  assert.match(xml, /type: string -&gt; number/u);
  assert.match(xml, /contract rule: 2/u);
  assert.match(xml, /contract requirement: 3/u);
  assert.doesNotMatch(xml, /DO_NOT_EXPORT|SYNTHETIC_SECRET/u);
});

test('every emitted untrusted label and evidence value is XML-escaped', () => {
  const payload = '\"><injected attr="x">&\'<![CDATA[</failure>]]>';
  const input = report([finding({ id: payload, kind: payload, path: payload, occurrence: payload,
    evidence: { baselineEntry: payload, candidateEntry: payload }, status: { before: payload, after: payload },
    types: { before: payload, after: payload }, rule: payload, requirement: payload,
  })]);
  input.operations[0] = { id: 'operation-0001', method: payload, origin: payload, path: payload };
  const xml = junitReport(input);
  assert.doesNotMatch(xml, /<injected|<!\[CDATA\[|attr="x"/u);
  assert.match(xml, /&quot;&gt;&lt;injected attr=&quot;x&quot;&gt;&amp;&apos;&lt;!\[CDATA\[&lt;\/failure&gt;\]\]&gt;/u);
  assert.equal((xml.match(/<failure /gu) ?? []).length, 1);
  assert.equal((xml.match(/<testcase /gu) ?? []).length, 1);
});

test('XML-invalid control characters and lone surrogates are replaced while valid Unicode survives', () => {
  const input = report([finding({ path: '/before\u0000\u0001\u000b\u001f\ud800\ufffe\uffffafter/Żółw/🦊' })]);
  const xml = junitReport(input);
  assert.doesNotMatch(xml, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u);
  assert.match(xml, /before�{7}after\/Żółw\/🦊/u);
});

test('formatted output is deterministic and excludes run metadata and durations', () => {
  const first = report([finding()]);
  first.run = { timestamp: 'SYNTHETIC_TIME_SECRET', hostname: 'PRIVATE_HOST', path: '/PRIVATE_FILE' };
  const second = structuredClone(first);
  second.run.timestamp = 'DIFFERENT_TIME';
  assert.equal(junitReport(first), junitReport(second));
  assert.doesNotMatch(junitReport(first), /timestamp=|time=|hostname=|SYNTHETIC_TIME_SECRET|PRIVATE_HOST|PRIVATE_FILE/u);
});

test('missing operation labels after a privacy transform retain stable finding references', () => {
  const input = report([finding({ operation: 'operation-0009' })]);
  input.operations = [{ id: 'operation-0009' }];
  const xml = junitReport(input);
  assert.match(xml, /finding-00001: field-removed/u);
  assert.doesNotMatch(xml, /undefined|null/u);
});

test('invalid internal report shapes and unknown severities fail closed with redacted diagnostics', () => {
  for (const input of [null, {}, { operations: [], findings: null }, report([finding({ severity: 'SYNTHETIC_SECRET' })]), report([null])]) {
    assert.throws(() => junitReport(input), error => error.code === 'REPORT' && !error.message.includes('SYNTHETIC_SECRET'));
  }
});

test('suite counts derive from actual findings rather than stale summary counts', () => {
  const input = report([finding()]);
  input.summary = { regressions: 0, informational: 99 };
  assert.match(junitReport(input), /tests="1" failures="1" errors="0" skipped="0"/u);
});

test('excessive XML expansion fails at its byte budget without partial output', () => {
  const input = report(Array.from({ length: 1000 }, (_, index) => finding({ id: `finding-${index}`, path: '/' + '&'.repeat(1023) })));
  assert.throws(() => junitReport(input), error => error.code === 'LIMIT');
});

const python = spawnSync('python3', ['--version'], { encoding: 'utf8', timeout: 5000 });
test('optional Python standard XML parser reads escaped malicious labels and evidence', { skip: python.error?.code === 'ENOENT' }, () => {
  const payload = '\"><injected/> & \'\\n\u0000\ud800\uffff🦊';
  const input = report([finding({ path: payload, kind: payload }), finding({ id: 'info-2', severity: 'info' })]);
  input.operations[0].path = '/' + payload;
  const parsed = spawnSync('python3', ['-c', 'import json,sys,xml.etree.ElementTree as ET\nr=ET.fromstring(sys.stdin.read())\ns=r.find("testsuite")\nprint(json.dumps({"root":r.tag,"counts":s.attrib,"cases":len(s.findall("testcase")),"failures":len(s.findall("testcase/failure")),"skipped":len(s.findall("testcase/skipped")),"injected":len(list(r.iter("injected")))}))'], { input: junitReport(input), encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 });
  assert.equal(parsed.status, 0, parsed.stderr);
  const result = JSON.parse(parsed.stdout);
  assert.deepEqual(result, { root: 'testsuites', counts: { name: 'scope-har-compare', tests: '2', failures: '1', errors: '0', skipped: '1' }, cases: 2, failures: 1, skipped: 1, injected: 0 });
});
