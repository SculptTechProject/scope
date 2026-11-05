import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixtures = join(root, 'examples/fixtures');
// A new directory on each run avoids overwriting reports or input captures.
import { mkdirSync } from 'node:fs';
mkdirSync(join(root, 'out'), { recursive: true });
const out = mkdtempSync(join(root, 'out/demo-'));
const scenarios = [
  ['missing-field', 'missing-field.har', undefined, 1, 'field-removed'],
  ['http-500', 'http-500.har', undefined, 1, 'http-failure'],
  ['timestamp-ignored', 'timestamp.har', 'ignore-timestamp.json', 0, undefined],
  ['timestamp-strict', 'timestamp.har', 'strict.json', 1, 'value-changed'],
];
scenarios.push(
  ['mixed-selected', 'mixed-candidate.har', 'include-api.json', 1, 'field-removed', 'mixed-baseline.har'],
  ['mixed-clean', 'mixed-baseline.har', 'include-api.json', 0, undefined, 'mixed-baseline.har'],
);
for (const [name, candidate, config, expected, finding, baseline = 'baseline.har'] of scenarios) {
  const args = [join(root, 'cli.mjs'), 'compare', '--baseline', join(fixtures, baseline), '--candidate', join(fixtures, candidate), '--json', join(out, name + '.json'), '--html', join(out, name + '.html')];
  if (config) args.push('--config', join(fixtures, config));
  const run = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, expected, `${name}: ${run.stdout} ${run.stderr}`);
  const report = JSON.parse(run.stdout);
  assert.equal(report.summary.regressions, expected === 1 ? 1 : 0);
  if (finding) assert.equal(report.findings[0].kind, finding);
  // Checked-in reports are reproducibility evidence, not manually curated expectations.
  assert.equal(run.stdout, readFileSync(join(root, 'examples/reports', name + '.json'), 'utf8'));
  assert.equal(readFileSync(join(out, name + '.html'), 'utf8'), readFileSync(join(root, 'examples/reports', name + '.html'), 'utf8'));
  console.log(`${name}: exit ${run.status}, ${report.summary.regressions} regression candidates`);
}
console.log(`Reports: ${resolve(out)}`);

// Negative control: this mixed capture is unsupported without explicit selection.
const unfiltered = spawnSync(process.execPath, [join(root, 'cli.mjs'), 'compare', '--baseline', join(fixtures, 'mixed-baseline.har'), '--candidate', join(fixtures, 'mixed-candidate.har')], { encoding: 'utf8', timeout: 10000 });
assert.equal(unfiltered.status, 2);
assert.equal(JSON.parse(unfiltered.stdout).error.code, 'BODY');
console.log('mixed-unfiltered: exit 2, unsupported body analysis rejected');
