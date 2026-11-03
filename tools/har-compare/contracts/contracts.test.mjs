import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHar } from '../src/input.mjs';
import { validateContracts, evaluateContracts } from './index.mjs';

const selector = { method: 'GET', origin: 'https://api.example.test', path: '/users' };
const rule = extra => ({ ...selector, ...extra });
function capture(responses) {
  return parseHar({ log: { entries: responses.map(({ status = 200, value = {}, url = 'https://api.example.test/users', method = 'GET', empty = false }) => ({
    request: { method, url },
    response: { status, content: empty ? { size: 0, mimeType: 'text/plain', text: '' } : { mimeType: 'application/json', text: JSON.stringify(value) } },
  })) } }).entries;
}
const evaluate = (before, after, rules) => evaluateContracts(capture(before), capture(after), validateContracts(rules));

// Wrong status membership or treating the contract as a baseline delta must fail these.
test('allowed status contract rejects a HTTP error present in both captures', () => {
  const result = evaluate([{ status: 500 }], [{ status: 500 }], [rule({ allowedStatuses: [200] })]);
  assert.equal(result.checks, 1);
  assert.deepEqual(result.findings, [{
    id: 'contract-finding-00001', rule: 1, kind: 'contract-status', severity: 'regression',
    evidence: { baselineEntry: 1, candidateEntry: 1 }, status: { after: 500 },
  }]);
});

test('allowed statuses accept a candidate explicitly included in its rule', () => {
  assert.deepEqual(evaluate([{}], [{ status: 201 }], [rule({ allowedStatuses: [201, 200] })]), { checks: 1, findings: [] });
});

test('explicitly allowed existing HTTP error remains allowed by the authored contract', () => {
  assert.deepEqual(evaluate([{ status: 404 }], [{ status: 404 }], [rule({ allowedStatuses: [404] })]), { checks: 1, findings: [] });
});

test('a required field absent from both captures produces a contract regression', () => {
  const result = evaluate([{}], [{}], [rule({ requiredJson: [{ pointer: '/user/id', type: 'string' }] })]);
  assert.equal(result.checks, 1);
  assert.deepEqual(result.findings, [{
    id: 'contract-finding-00001', rule: 1, kind: 'contract-json-missing', severity: 'regression',
    evidence: { baselineEntry: 1, candidateEntry: 1 }, requirement: 1,
  }]);
});

test('required types are enforced even when baseline has the same wrong type', () => {
  const value = { user: { id: 37 } };
  const result = evaluate([{ value }], [{ value }], [rule({ requiredJson: [{ pointer: '/user/id', type: 'string' }] })]);
  assert.deepEqual(result.findings[0], {
    id: 'contract-finding-00001', rule: 1, kind: 'contract-json-type', severity: 'regression',
    evidence: { baselineEntry: 1, candidateEntry: 1 }, requirement: 1, types: { before: 'string', after: 'number' },
  });
});

test('all six JSON types support root-pointer contracts without coercion', () => {
  for (const [value, type] of [[{}, 'object'], [[], 'array'], ['', 'string'], [0, 'number'], [false, 'boolean'], [null, 'null']]) {
    assert.deepEqual(evaluate([{ value }], [{ value }], [rule({ requiredJson: [{ pointer: '', type }] })]), { checks: 1, findings: [] });
  }
});

test('empty response body cannot satisfy a required JSON contract', () => {
  const result = evaluate([{ status: 204, empty: true }], [{ status: 204, empty: true }], [rule({ requiredJson: [{ pointer: '/a', type: 'number' }, { pointer: '/b', type: 'string' }] })]);
  assert.equal(result.checks, 2);
  assert.deepEqual(result.findings[0], {
    id: 'contract-finding-00001', rule: 1, kind: 'contract-json-body', severity: 'regression',
    evidence: { baselineEntry: 1, candidateEntry: 1 }, types: { before: 'json', after: 'empty' },
  });
  assert.equal(result.findings.length, 1);
});

test('JSON pointer escaping preserves slash, tilde, empty keys and one-pass decoding', () => {
  const value = { 'a/b': { '~key': ['ok'] }, '~1': 'literal', '': false };
  const requirements = [
    { pointer: '/a~1b/~0key/0', type: 'string' },
    { pointer: '/~01', type: 'string' },
    { pointer: '/', type: 'boolean' },
  ];
  assert.deepEqual(evaluate([{ value }], [{ value }], [rule({ requiredJson: requirements })]), { checks: 3, findings: [] });
});

test('arrays require canonical numeric indices and never expose length or inherited members', () => {
  const value = { items: ['ok'] };
  for (const pointer of ['/items/01', '/items/-', '/items/length', '/items/__proto__', '/items/1']) {
    const result = evaluate([{ value }], [{ value }], [rule({ requiredJson: [{ pointer, type: 'string' }] })]);
    assert.equal(result.findings[0].kind, 'contract-json-missing', pointer);
  }
});

test('object prototype members and descendants of primitives are absent', () => {
  const value = { text: 'ok', number: 0, nil: null };
  for (const pointer of ['/constructor', '/__proto__', '/text/0', '/text/length', '/number/toString', '/nil/key']) {
    const result = evaluate([{ value }], [{ value }], [rule({ requiredJson: [{ pointer, type: 'string' }] })]);
    assert.equal(result.findings[0].kind, 'contract-json-missing', pointer);
  }
});

test('literal own prototype-named JSON properties can satisfy a requirement safely', () => {
  const value = JSON.parse('{"__proto__":{"constructor":"owned"}}');
  assert.deepEqual(evaluate([{ value }], [{ value }], [rule({ requiredJson: [{ pointer: '/__proto__/constructor', type: 'string' }] })]), { checks: 1, findings: [] });
});

const rejectsConfig = input => assert.throws(() => validateContracts(input), error => error.code === 'CONFIG');

test('contract configuration rejects unknown keys and assertion-free or empty rules', () => {
  for (const input of [undefined, null, {}, [], [null], [rule({})], [rule({ allowedStatuses: [] })],
    [rule({ requiredJson: [] })], [rule({ allowedStatuses: [200], typo: true })],
    [rule({ requiredJson: [{ pointer: '/id', type: 'string', optional: true }] })]]) rejectsConfig(input);
});

test('status allowlists reject invalid, duplicated, coercible and non-final statuses', () => {
  for (const allowedStatuses of [[199], [600], [200.5], ['200'], [null], [200, 200], [NaN], [Infinity], '200']) {
    rejectsConfig([rule({ allowedStatuses })]);
  }
});

test('selectors reject wildcard methods and noncanonical or credential-bearing URL components', () => {
  for (const override of [
    { method: '*' }, { method: 'G*ET' }, { method: 'GET POST' }, { method: '' },
    { origin: 'https://api.example.test/' }, { origin: 'https://user:password@api.example.test' },
    { origin: 'https://api.example.test:443' }, { origin: 'https://API.example.test' },
    { origin: 'ftp://api.example.test' }, { origin: 'https://api.example.test?x=secret' },
    { path: 'users' }, { path: '/users?x=secret' }, { path: '/users#fragment' }, { path: '/a/../users' },
    { path: '/users\\admin' }, { path: '/a b' },
  ]) rejectsConfig([rule({ ...override, allowedStatuses: [200] })]);
});

test('requirements reject malformed pointers, URI fragments, unknown types and duplicate pointers', () => {
  for (const requiredJson of [
    [{ pointer: 'id', type: 'string' }], [{ pointer: '#/id', type: 'string' }],
    [{ pointer: '/~', type: 'string' }], [{ pointer: '/~2', type: 'string' }],
    [{ pointer: '/id', type: 'integer' }], [{ pointer: '/id', type: ['string', 'null'] }],
    [{ pointer: '/id' }], [{ type: 'string' }], [null],
    [{ pointer: '/id', type: 'string' }, { pointer: '/id', type: 'number' }],
  ]) rejectsConfig([rule({ requiredJson })]);
});

test('canonical configuration sorts rules, statuses and pointers without mutating caller values', () => {
  const input = [rule({ method: 'post', allowedStatuses: [202, 200] }), rule({ requiredJson: [{ pointer: '/z', type: 'number' }, { pointer: '/a', type: 'string' }] })];
  const original = JSON.stringify(input);
  assert.deepEqual(validateContracts(input), [
    rule({ requiredJson: [{ pointer: '/a', type: 'string' }, { pointer: '/z', type: 'number' }] }),
    rule({ method: 'POST', allowedStatuses: [200, 202] }),
  ]);
  assert.equal(JSON.stringify(input), original);
});

test('same normalized selector cannot appear in multiple rules', () => {
  rejectsConfig([rule({ method: 'get', allowedStatuses: [200] }), rule({ requiredJson: [{ pointer: '/id', type: 'string' }] })]);
});

test('configuration limits bound rule count, status count, pointer count, pointer length and depth', () => {
  rejectsConfig(Array.from({ length: 101 }, (_, index) => rule({ path: `/users/${index}`, allowedStatuses: [200] })));
  rejectsConfig([rule({ allowedStatuses: Array.from({ length: 101 }, (_, index) => index + 200) })]);
  rejectsConfig([rule({ requiredJson: Array.from({ length: 101 }, (_, index) => ({ pointer: `/${index}`, type: 'string' })) })]);
  rejectsConfig([rule({ requiredJson: [{ pointer: '/' + 'a'.repeat(1024), type: 'string' }] })]);
  rejectsConfig([rule({ requiredJson: [{ pointer: '/a'.repeat(65), type: 'string' }] })]);
  rejectsConfig(Array.from({ length: 11 }, (_, ruleIndex) => rule({ path: `/users/${ruleIndex}`, requiredJson: Array.from({ length: 100 }, (_, index) => ({ pointer: `/${index}`, type: 'string' })) })));
});

test('maximum configured pointer depth remains usable at the body depth boundary', () => {
  let value = 'ok';
  for (let index = 0; index < 64; index++) value = { a: value };
  assert.deepEqual(evaluate([{ value }], [{ value }], [rule({ requiredJson: [{ pointer: '/a'.repeat(64), type: 'string' }] })]), { checks: 1, findings: [] });
});

test('configuration errors omit rejected selector strings, pointer content and values', () => {
  const secret = 'SYNTHETIC_SECRET_NOT_FOR_DIAGNOSTICS';
  for (const input of [[rule({ allowedStatuses: [secret] })], [rule({ origin: secret, allowedStatuses: [200] })], [rule({ requiredJson: [{ pointer: '/' + secret + '~2', type: 'string' }] })]]) {
    assert.throws(() => validateContracts(input), error => error.code === 'CONFIG' && !error.message.includes(secret));
  }
});

test('all repeated candidate responses are checked and retain ordinal baseline evidence', () => {
  const result = evaluate([{}, {}, {}], [{}, { status: 500 }, { status: 503 }], [rule({ allowedStatuses: [200] })]);
  assert.equal(result.checks, 3);
  assert.deepEqual(result.findings.map(finding => [finding.status.after, finding.evidence]), [
    [500, { baselineEntry: 2, candidateEntry: 2 }],
    [503, { baselineEntry: 3, candidateEntry: 3 }],
  ]);
});

test('exact operation contract checks every query variant without disclosing query strings', () => {
  const result = evaluate(
    [{ url: 'https://api.example.test/users?key=BASELINE_SECRET' }],
    [{ url: 'https://api.example.test/users?key=SECRET_B', status: 500 }, { url: 'https://api.example.test/users?key=BASELINE_SECRET', status: 503 }],
    [rule({ allowedStatuses: [200] })],
  );
  assert.equal(result.checks, 2);
  assert.deepEqual(result.findings.map(finding => finding.evidence), [{ baselineEntry: null, candidateEntry: 1 }, { baselineEntry: 1, candidateEntry: 2 }]);
  assert.equal(JSON.stringify(result).includes('SECRET'), false);
});

test('contract selector does not match a different method, origin, port or path', () => {
  for (const response of [{ method: 'POST' }, { url: 'http://api.example.test/users' }, { url: 'https://api.example.test:8443/users' }, { url: 'https://api.example.test/users/' }]) {
    assert.throws(() => evaluate([response], [response], [rule({ allowedStatuses: [200] })]), error => error.code === 'CONTRACT_UNUSED');
  }
});

test('a selector matching neither selected capture fails closed with a redacted error', () => {
  const configured = rule({ path: '/SYNTHETIC_PRIVATE_PATH', allowedStatuses: [200] });
  assert.throws(() => evaluate([{}], [{}], [configured]), error => error.code === 'CONTRACT_UNUSED' && !error.message.includes('SYNTHETIC_PRIVATE_PATH'));
});

test('baseline-only contracted operation is a regression rather than an unused-config error', () => {
  const result = evaluate([{}, {}], [], [rule({ allowedStatuses: [200] })]);
  assert.deepEqual(result, {
    checks: 1,
    findings: [{ id: 'contract-finding-00001', rule: 1, kind: 'contract-operation-missing', severity: 'regression', evidence: { baselineEntry: 1, candidateEntry: null } }],
  });
});

test('newly added contracted responses are evaluated without fabricated baseline evidence', () => {
  const result = evaluate([], [{ status: 500 }], [rule({ allowedStatuses: [200] })]);
  assert.equal(result.findings[0].kind, 'contract-status');
  assert.deepEqual(result.findings[0].evidence, { baselineEntry: null, candidateEntry: 1 });
});

test('canonical rule and pointer ordering makes output stable across config ordering', () => {
  const baseline = [{ value: {} }, { value: {}, method: 'POST' }];
  const candidate = [{ value: {} }, { value: {}, method: 'POST', status: 500 }];
  const a = rule({ requiredJson: [{ pointer: '/z', type: 'string' }, { pointer: '/a', type: 'number' }] });
  const b = rule({ method: 'post', allowedStatuses: [201, 200] });
  const first = evaluate(baseline, candidate, [b, a]);
  const second = evaluate(baseline, candidate, [{ ...a, requiredJson: [...a.requiredJson].reverse() }, { ...b, allowedStatuses: [200, 201] }]);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(first.findings.map(finding => [finding.rule, finding.requirement ?? null, finding.evidence.candidateEntry]), [[1, 1, 1], [1, 2, 1], [2, null, 2]]);
});

test('findings do not expose body values, keys, URLs, pointers or statuses authored in configuration', () => {
  const secret = 'SYNTHETIC_SECRET_NOT_FOR_REPORT';
  const value = { [secret]: { field: secret } };
  const result = evaluate([{ value }], [{ value }], [rule({ requiredJson: [{ pointer: `/${secret}/field`, type: 'number' }, { pointer: `/${secret}/missing`, type: 'string' }] })]);
  assert.equal(result.findings.length, 2);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(result).includes('https:'), false);
});

test('more than 10000 contract failures stops analysis rather than silently truncating', () => {
  const responses = Array.from({ length: 101 }, () => ({}));
  const requiredJson = Array.from({ length: 100 }, (_, index) => ({ pointer: `/missing${index}`, type: 'string' }));
  assert.throws(() => evaluate(responses, responses, [rule({ requiredJson })]), error => error.code === 'LIMIT');
});
