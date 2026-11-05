import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateJUnit } from '../junit-check.mjs';

const clean = { summary: { regressions: 0 }, findings: [] };
const xml = '<?xml version="1.0"?><testsuites tests="1" failures="0" errors="0" skipped="0"><testsuite tests="1" failures="0" errors="0" skipped="0"><testcase name="clean-analysis"/></testsuite></testsuites>';
test('independent JUnit validator reads actual test and failure counts', () => {
  assert.deepEqual(validateJUnit(xml, clean), { tests: 1, failures: 0, skipped: 0 });
});
test('JUnit detector controls reject a count mismatch, malformed escaping and markup injection', () => {
  assert.throws(() => validateJUnit(xml.replace('tests="1"', 'tests="2"'), clean));
  assert.throws(() => validateJUnit(xml.replace('clean-analysis', 'A&B'), clean));
  assert.throws(() => validateJUnit(xml.replace('<testcase name="clean-analysis"/>', '<testcase name="clean-analysis"><img/></testcase>'), clean));
  assert.throws(() => validateJUnit('<!DOCTYPE testsuites SYSTEM "http://127.0.0.1:9/no-connect">' + xml, clean));
});

test('independent XML validation rejects undeclared attributes and wrong structural parents', () => {
  assert.throws(() => validateJUnit(xml.replace('<testcase name=', '<testcase onclick="synthetic()" name='), clean));
  assert.throws(() => validateJUnit(xml.replace('<testcase name="clean-analysis"/>', '<system-out><testcase name="clean-analysis"/></system-out>'), clean));
  assert.throws(() => validateJUnit(xml.replace('?><testsuites', '?><?xml-stylesheet href="http://127.0.0.1:9/no-connect"?><testsuites'), clean));
});

test('independent XML evidence comparison accounts for XML-invalid characters and line-ending normalization', () => {
  const report = { summary: { regressions: 1 }, findings: [{ id: 'finding-00001', kind: 'field-removed', severity: 'regression', path: '/nul:\u0000/lone:\ud800/line\rbreak' }] };
  const text = 'JSON pointer: /nul:�/lone:�/line\rbreak';
  const document = '<?xml version="1.0"?><testsuites tests="1" failures="1" errors="0" skipped="0"><testsuite tests="1" failures="1" errors="0" skipped="0"><testcase name="finding-00001: field-removed"><failure message="field-removed" type="field-removed">' + text + '</failure></testcase></testsuite></testsuites>';
  assert.deepEqual(validateJUnit(document, report), { tests: 1, failures: 1, skipped: 0 });
});
