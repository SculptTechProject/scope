import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as browserChecks from '../browser-check.mjs';

test('browser navigation policy accepts only local anchor targets that exist exactly once', () => {
  assert.equal(typeof browserChecks.assertLocalNavigation, 'function', 'local report navigation policy must be available');
  assert.equal(browserChecks.assertLocalNavigation([{ tag: 'A', href: '#coverage' }, { tag: 'A', href: '#operation-0001' }], ['coverage', 'operation-0001']), 2);
  assert.throws(() => browserChecks.assertLocalNavigation([{ tag: 'A', href: '#missing' }], ['coverage']));
  assert.throws(() => browserChecks.assertLocalNavigation([{ tag: 'A', href: '#coverage' }], ['coverage', 'coverage']));
});

test('browser navigation policy rejects remote, script, data, empty and non-anchor hrefs', () => {
  assert.equal(typeof browserChecks.assertLocalNavigation, 'function');
  for (const href of ['https://example.invalid/#coverage', '//example.invalid/#coverage', 'javascript:synthetic()', 'data:text/html,synthetic', '', '#', '#coverage extra', '#/coverage', 'file:///synthetic#coverage']) {
    assert.throws(() => browserChecks.assertLocalNavigation([{ tag: 'A', href }], ['coverage']), href);
  }
  assert.throws(() => browserChecks.assertLocalNavigation([{ tag: 'LINK', href: '#coverage' }], ['coverage']));
});
