import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, lstat, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixture } from './fixture.mjs';
import { captureBoundary } from './capture.mjs';
import { runNode } from './process.mjs';
import { validateJUnit } from './junit-check.mjs';

const lab = fileURLToPath(new URL('./', import.meta.url));
const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const marker = 'SYNTHETIC_EXISTING_ARTIFACT_MUST_STAY_UNCHANGED\n';

/** Actual saved HTTP captures exercise exclusive file creation and multi-output rollback. */
export async function runOutputChecks(output) {
  await mkdir(output, { recursive: true });
  const fixture = await startFixture(), results = [];
  try {
    const baseline = join(output, 'baseline.har'), candidate = join(output, 'candidate.har');
    await writeFile(baseline, JSON.stringify(await captureBoundary(fixture.origin, 'changed-decimal', 'baseline')) + '\n', { flag: 'wx' });
    await writeFile(candidate, JSON.stringify(await captureBoundary(fixture.origin, 'changed-decimal', 'candidate')) + '\n', { flag: 'wx' });
    const beforeHar = await readFile(baseline, 'utf8'), afterHar = await readFile(candidate, 'utf8');
    const config = join(output, 'config.json');
    await writeFile(config, '{"mode":"strict"}\n', { flag: 'wx' });
    const captureRequests = fixture.requests.length;
    assert.equal(captureRequests, 2);
    const probe = await runNode(['--input-type=module', '-e', `const r=await fetch(${JSON.stringify(fixture.origin + '/output-detector-positive-control')});process.stdout.write(String(r.status))`], { cwd: output });
    assert.equal(probe.status, 0); assert.equal(probe.stdout, '404'); assert.equal(fixture.requests.length, captureRequests + 1);
    const snapshot = fixture.requests.length;
    const compare = (extra, before = baseline, after = candidate) => runNode([cli, 'compare', '--baseline', before, '--candidate', after, '--config', config, ...extra], { cwd: output });
    const absent = path => assert.rejects(lstat(path), { code: 'ENOENT' });
    const failure = (run, name, code = 'OUTPUT') => {
      assert.equal(run.error, undefined); assert.equal(run.status, 2, name + ': ' + run.stdout + run.stderr);
      assert.equal(JSON.parse(run.stdout).error.code, code, name);
      assert.doesNotMatch(run.stdout + run.stderr, /SYNTHETIC_(?:BOUNDARY_(?:QUERY|HEADER)_SECRET|EXISTING_ARTIFACT)/u);
    };
    for (const collision of ['json', 'html', 'xml']) {
      const directory = join(output, 'existing-' + collision); await mkdir(directory);
      const files = Object.fromEntries(['json', 'html', 'xml'].map(extension => [extension, join(directory, 'report.' + extension)]));
      await writeFile(files[collision], marker, { flag: 'wx' });
      const run = await compare(['--json', files.json, '--html', files.html, '--junit', files.xml]);
      failure(run, 'existing-' + collision);
      for (const [extension, path] of Object.entries(files)) {
        if (extension === collision) assert.equal(await readFile(path, 'utf8'), marker);
        else await absent(path);
      }
      results.push({ name: 'existing-' + collision, exit: run.status, preservedExisting: true, partialReportsRemaining: 0 });
    }
    {
      const file = join(output, 'alias-report.json');
      const run = await compare(['--json', file, '--html', join(output, '.', 'alias-report.json')]);
      failure(run, 'same-output-alias'); await absent(file);
      results.push({ name: 'same-output-alias', exit: run.status, partialReportsRemaining: 0 });
    }
    for (const [name, input] of [['baseline', baseline], ['candidate', candidate], ['config', config]]) {
      const bytes = await readFile(input, 'utf8');
      const run = await compare(['--junit', input]);
      failure(run, name + '-as-output'); assert.equal(await readFile(input, 'utf8'), bytes);
      results.push({ name: name + '-as-output', exit: run.status, preservedInput: true });
    }
    {
      const target = join(output, 'symlink-target.txt'), link = join(output, 'symlink-report.xml');
      await writeFile(target, marker, { flag: 'wx' }); await symlink(target, link);
      const run = await compare(['--junit', link]);
      failure(run, 'symlink-output'); assert.equal(await readFile(target, 'utf8'), marker); assert.equal((await lstat(link)).isSymbolicLink(), true);
      results.push({ name: 'symlink-output', exit: run.status, preservedTarget: true, preservedSymlink: true });
    }
    {
      const directory = join(output, 'directory-output'); await mkdir(directory);
      const json = join(output, 'directory-rollback.json');
      const run = await compare(['--json', json, '--junit', directory]);
      failure(run, 'directory-output'); assert.equal((await lstat(directory)).isDirectory(), true); await absent(json);
      results.push({ name: 'directory-output', exit: run.status, partialReportsRemaining: 0 });
    }
    for (const [name, after, expectedExit] of [['clean', baseline, 0], ['regression', candidate, 1]]) {
      const directory = join(output, name, 'created', 'parents');
      const json = join(directory, 'report.json'), html = join(directory, 'report.html'), xml = join(directory, 'report.xml');
      const run = await compare(['--json', json, '--html', html, '--junit', xml], baseline, after);
      assert.equal(run.status, expectedExit, name + ': ' + run.stdout + run.stderr);
      assert.equal(await readFile(json, 'utf8'), run.stdout);
      const report = JSON.parse(run.stdout), parsed = validateJUnit(await readFile(xml, 'utf8'), report);
      for (const path of [json, html, xml]) assert.equal((await lstat(path)).mode & 0o777, 0o600);
      assert.doesNotMatch((await readFile(html, 'utf8')) + (await readFile(xml, 'utf8')) + run.stdout, /SYNTHETIC_BOUNDARY_(?:QUERY|HEADER)_SECRET/u);
      results.push({ name: 'new-' + name + '-outputs', exit: run.status, fileMode: '0600', exactJsonStdout: true, junit: parsed });
    }
    assert.equal(await readFile(baseline, 'utf8'), beforeHar); assert.equal(await readFile(candidate, 'utf8'), afterHar);
    assert.equal(fixture.requests.length, snapshot, 'output checks must not replay saved capture URLs');
    const receipt = { source: 'Two actual localhost HTTP captures plus exclusive-output/rollback checks; synthetic artifacts only', captureRequests, detectorPositiveControlRequests: 1, cliNetworkRequestsObservedAtFixture: 0, independentXmlParser: '@xmldom/xmldom 0.9.12', cases: results };
    await writeFile(join(output, 'output-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    return receipt;
  } finally { await fixture.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await mkdir(join(lab, 'output'), { recursive: true });
  const output = await mkdtemp(join(lab, 'output/artifacts-'));
  console.log(JSON.stringify({ output, ...await runOutputChecks(output) }, null, 2));
}
