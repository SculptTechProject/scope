import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';

const attributes = {
  testsuites: ['tests', 'failures', 'errors', 'skipped'],
  testsuite: ['name', 'tests', 'failures', 'errors', 'skipped'],
  testcase: ['name', 'classname'], failure: ['message', 'type'], skipped: ['message'], 'system-out': [],
};
const parents = { testsuites: '#document', testsuite: 'testsuites', testcase: 'testsuite', failure: 'testcase', skipped: 'testcase', 'system-out': 'testcase' };
// XML 1.0 character ranges plus the XML parser's required line-end normalization.
function xmlText(value) {
  return Array.from(value, char => {
    const code = char.codePointAt(0);
    return [9, 10, 13].includes(code) || code >= 32 && code <= 0xd7ff || code >= 0xe000 && code <= 0xfffd || code >= 0x10000 && code <= 0x10ffff ? char : '�';
  }).join('').replace(/\r\n?/gu, '\n');
}

/** Independent parser-backed boundary checks; no DTD/entity/network expansion is needed. */
export function validateJUnit(xml, report) {
  assert.equal(typeof xml, 'string');
  assert.doesNotMatch(xml, /<!DOCTYPE/iu, 'generated JUnit must not contain a DTD');
  assert.doesNotMatch(xml, /<\?(?!xml(?:\s|\?>))/u, 'generated JUnit must not contain processing instructions');
  const document = new DOMParser({ onError: (level, message) => {
    // xmldom warns about U+FFFD, which the writer deliberately uses for XML-invalid input.
    if (level === 'warning' && message === 'Unicode replacement character detected, source encoding issues?') return;
    throw new Error('Generated JUnit is not well-formed XML.');
  } }).parseFromString(xml, 'application/xml');
  assert.equal(document.documentElement.tagName, 'testsuites');
  for (const element of Array.from(document.getElementsByTagName('*'))) {
    assert.ok(Object.hasOwn(attributes, element.tagName), 'unexpected XML markup');
    assert.equal(element.parentNode.nodeName, parents[element.tagName], 'unexpected XML structural parent');
    for (const attribute of Array.from(element.attributes)) assert.ok(attributes[element.tagName].includes(attribute.name), 'unexpected XML attribute');
  }
  const cases = Array.from(document.getElementsByTagName('testcase'));
  const failures = document.getElementsByTagName('failure').length;
  const skipped = document.getElementsByTagName('skipped').length;
  const expectedFailures = report.findings.filter(finding => finding.severity === 'regression').length;
  const expectedSkipped = report.findings.length - expectedFailures;
  assert.equal(report.summary.regressions, expectedFailures, 'JSON summary must agree with its findings');
  assert.equal(cases.length, report.findings.length || 1);
  assert.equal(failures, expectedFailures);
  assert.equal(skipped, expectedSkipped);
  const suites = document.getElementsByTagName('testsuite');
  assert.equal(suites.length, 1);
  for (const suite of [document.documentElement, suites.item(0)]) {
    assert.equal(suite.getAttribute('tests'), String(cases.length));
    assert.equal(suite.getAttribute('failures'), String(failures));
    assert.equal(suite.getAttribute('errors'), '0');
    assert.equal(suite.getAttribute('skipped'), String(skipped));
  }
  for (const [index, finding] of report.findings.entries()) {
    const testcase = cases[index];
    assert.ok(testcase.getAttribute('name').startsWith(finding.id + ': ' + finding.kind));
    assert.equal(testcase.getElementsByTagName('failure').length, finding.severity === 'regression' ? 1 : 0);
    assert.equal(testcase.getElementsByTagName('skipped').length, finding.severity === 'info' ? 1 : 0);
    if (finding.path !== undefined) assert.ok(testcase.textContent.includes('JSON pointer: ' + xmlText(finding.path || '(root)')));
  }
  if (report.findings.length === 0) assert.equal(cases[0].getAttribute('name'), 'clean-analysis');
  return { tests: cases.length, failures, skipped };
}
