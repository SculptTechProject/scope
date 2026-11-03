import assert from 'node:assert/strict';
import test from 'node:test';
import { parseJsonSafe } from './parse.mjs';

// Removing duplicate-name validation must expose this ambiguity again.
test('rejects duplicate object keys without disclosing their names or values', () => {
  for (const text of ['{"secret-key":"secret-value","secret-key":0}', '{"a":1,"\\u0061":2}', '{"x":{"a":1,"a":2}}', '{"__proto__":1,"__proto__":2}']) {
    assert.throws(() => parseJsonSafe(text, 'Input'), error => error.code === 'JSON' && !error.message.includes('secret'));
  }
});

test('keeps separate object scopes and quoted punctuation independent', () => {
  const parsed = parseJsonSafe('{"a":{"x":1},"b":{"x":2},"c":[{"x":3},{"x":4}],"text":"[{}],:\\\"x\\\"","__proto__":5}', 'Input');
  assert.deepEqual(parsed.a, { x: 1 });
  assert.equal(parsed.b.x, 2);
  assert.equal(parsed.c[1].x, 4);
  assert.equal(parsed.text, '[{}],:\"x\"');
  assert.equal(Object.hasOwn(parsed, '__proto__'), true);
  assert.equal(Object.getPrototypeOf(parsed), Object.prototype);
});

test('reports malformed syntax using bounded generic diagnostics', () => {
  for (const text of ['{"secret":', '[1,]', '{"x":1 "y":2}', '{"a":1e}', '"unterminated', '{"x":"\\x20"}']) {
    assert.throws(() => parseJsonSafe(text, 'Input'), error => error.code === 'JSON' && !error.message.includes('secret'));
  }
});

// Removing the source-token check would silently erase these changes.
test('rejects decimal tokens whose mathematical value changes on number round trip', () => {
  for (const token of ['1.0000000000000001', '1e-324', '9007199254740990.9', '0.10000000000000001', '-1.0000000000000001', '4e-324', '1e400']) {
    assert.throws(() => parseJsonSafe(`{"balance":${token}}`, 'Input'), error => error.code === 'NUMBER');
  }
});

test('accepts ordinary decimal values and mathematically equivalent spellings', () => {
  for (const [token, expected] of [['1.00', 1], ['1e0', 1], ['0.1', 0.1], ['1000e-3', 1], ['-0.00e2', -0], ['5e-324', 5e-324], ['1.7976931348623157e308', 1.7976931348623157e308], ['2.2250738585072014e-308', 2.2250738585072014e-308], ['1e+00001', 10], ['9007199254740992', 9007199254740992]]) {
    assert.equal(parseJsonSafe(token, 'Input'), expected);
  }
  assert.deepEqual(parseJsonSafe('[1e0,{"0.10000000000000001":"1e-324"}]', 'Input'), [1, { '0.10000000000000001': '1e-324' }]);
});

test('bounds depth and numeric-token complexity with safe diagnostics', () => {
  for (const text of ['['.repeat(129) + '0' + ']'.repeat(129), '1' + '0'.repeat(4096), '0e1000001']) {
    assert.throws(() => parseJsonSafe(text, 'Input'), error => error.code === 'LIMIT');
  }
});

test('rejects escaped duplicate slashes, backslashes and surrogate-pair names', () => {
  for (const text of ['{"a/b":1,"a\\/b":2}', '{"\\u005c":1,"\\\\":2}', '{"😀":1,"\\ud83d\\ude00":2}']) {
    assert.throws(() => parseJsonSafe(text, 'Input'), error => error.code === 'JSON');
  }
  assert.deepEqual(parseJsonSafe('{"é":1,"e\\u0301":2}', 'Input'), { 'é': 1, 'é': 2 });
});

test('bounds standalone text inputs before parsing or coercing them', () => {
  assert.throws(() => parseJsonSafe(' '.repeat(10 * 1024 * 1024 + 1), 'Input'), error => error.code === 'LIMIT');
  assert.throws(() => parseJsonSafe({ toString() { throw new Error('must not coerce'); } }, 'Input'), error => error.code === 'JSON');
  assert.equal(parseJsonSafe('['.repeat(128) + '0' + ']'.repeat(128), 'Input').length, 1);
});
