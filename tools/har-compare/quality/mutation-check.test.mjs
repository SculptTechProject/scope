import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, rm, symlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { runMutationChecks, applyMutation, MUTATIONS } from './mutation-check.mjs';

const mutant = { id: 'wrong-status', file: 'src/compare.mjs', from: 'return 200', to: 'return 500', testFile: 'test/health.test.mjs', testNamePattern: '^status must be 200$' };
async function fixture(t, testBody = 'assert.equal(status(), 200);') {
  const root = await mkdtemp(join(tmpdir(), 'scope-quality-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'source/src'), { recursive: true });
  await mkdir(join(root, 'source/test'), { recursive: true });
  await mkdir(join(root, 'source/.git'), { recursive: true });
  await mkdir(join(root, 'source/node_modules'), { recursive: true });
  await writeFile(join(root, 'source/.git/private'), 'EXCLUDED_PRIVATE_SENTINEL');
  await writeFile(join(root, 'source/node_modules/private'), 'EXCLUDED_PRIVATE_SENTINEL');
  await writeFile(join(root, 'source/.env'), 'EXCLUDED_PRIVATE_SENTINEL');
  await writeFile(join(root, 'source/cli.mjs'), 'export { status } from "./src/compare.mjs";\n');
  await writeFile(join(root, 'source/src/compare.mjs'), 'export function status() { return 200; }\n');
  if (typeof testBody === 'function') testBody = testBody(join(root, 'source/src/compare.mjs'));
  await writeFile(join(root, 'source/test/health.test.mjs'), `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {status} from '../cli.mjs';\ntest('status must be 200',async()=>{${testBody}});\n`);
  return { sourceRoot: join(root, 'source'), outputDirectory: join(root, 'output'), mutations: [mutant] };
}

test('single-anchor mutations reject missing or ambiguous anchors instead of silently changing intent', () => {
  assert.equal(applyMutation('before return 200 after', mutant), 'before return 500 after');
  assert.throws(() => applyMutation('no target', mutant), /exactly one/u);
  assert.throws(() => applyMutation('return 200 return 200', mutant), /exactly one/u);
});

test('real subprocess tests kill a behavioral mutation while preserving source and excluding private directories', async t => {
  const options = await fixture(t);
  const receipt = await runMutationChecks(options);
  assert.deepEqual(receipt.summary, { killed: 1, survived: 0, timeout: 0, invalid: 0, controlFailed: 0 });
  assert.equal(receipt.mutations[0].status, 'killed');
  assert.equal(receipt.sourceUnchanged, true);
  assert.equal(receipt.sourceDigestBefore, receipt.sourceDigestAfter);
  assert.match(receipt.sourceDigestBefore, /^[a-f0-9]{64}$/u);
  assert.ok(receipt.mutations[0].control.passed > 0);
  assert.ok(receipt.mutations[0].mutated.failed > 0);
  assert.match(await readFile(join(options.sourceRoot, 'src/compare.mjs'), 'utf8'), /return 200/u);
  for (const privatePath of ['.env', '.git', 'node_modules']) await assert.rejects(() => access(join(options.outputDirectory, 'snapshot', privatePath)));
  assert.match(await readFile(join(options.outputDirectory, 'receipt.json'), 'utf8'), /"killed"/u);
});

test('a surviving mutation is reported honestly when targeted assertions do not observe the changed behavior', async t => {
  const options = await fixture(t, 'assert.ok([200,500].includes(status()));');
  const receipt = await runMutationChecks(options);
  assert.equal(receipt.mutations[0].status, 'survived');
  assert.equal(receipt.summary.survived, 1);
});

test('red unmodified controls are not counted as killed mutants', async t => {
  const options = await fixture(t, 'assert.equal(status(), 404);');
  const receipt = await runMutationChecks(options);
  assert.equal(receipt.mutations[0].status, 'control-failed');
  assert.equal(receipt.summary.killed, 0);
  assert.equal(receipt.summary.controlFailed, 1);
});

test('mutant-only hangs are terminated and reported as timeouts rather than kills', async t => {
  const options = await fixture(t, 'if(status()===500) await new Promise(resolve=>setTimeout(resolve,5000)); assert.equal(status(),200);');
  const receipt = await runMutationChecks({ ...options, timeoutMs: 500 });
  assert.equal(receipt.mutations[0].status, 'timeout');
  assert.equal(receipt.summary.killed, 0);
});

test('malformed mutants cannot create false mutation success', async t => {
  const options = await fixture(t);
  const receipt = await runMutationChecks({ ...options, mutations: [{ ...mutant, to: 'return (' }] });
  assert.equal(receipt.mutations[0].status, 'invalid-mutant');
  assert.equal(receipt.summary.killed, 0);
});

test('a test-name filter selecting no test cannot count as a passing control', async t => {
  const options = await fixture(t);
  const receipt = await runMutationChecks({ ...options, mutations: [{ ...mutant, testNamePattern: '^nonexistent test$' }] });
  assert.equal(receipt.mutations[0].status, 'control-failed');
  assert.equal(receipt.summary.killed, 0);
});

test('a missing mutation anchor is reported as invalid instead of survived or killed', async t => {
  const options = await fixture(t);
  const receipt = await runMutationChecks({ ...options, mutations: [{ ...mutant, from: 'not a real anchor' }] });
  assert.equal(receipt.mutations[0].status, 'invalid-mutant');
  assert.equal(receipt.summary.killed, 0);
});

test('child test processes receive no inherited secret environment values', async t => {
  const key = 'SCOPE_QUALITY_SYNTHETIC_PRIVATE';
  const previous = process.env[key];
  process.env[key] = 'DO_NOT_PASS_SYNTHETIC_SENTINEL';
  t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  const options = await fixture(t, `assert.equal(process.env.${key}, undefined); assert.equal(status(),200);`);
  const receipt = await runMutationChecks(options);
  assert.equal(receipt.mutations[0].status, 'killed');
});

test('allowlisted root directory symlinks cannot copy external source-like private files', async t => {
  const options = await fixture(t);
  const external = join(dirname(options.sourceRoot), 'external');
  await mkdir(external);
  await writeFile(join(external, 'private.mjs'), 'EXCLUDED_PRIVATE_SENTINEL');
  await rm(join(options.sourceRoot, 'src'), { recursive: true });
  await symlink(external, join(options.sourceRoot, 'src'));
  await assert.rejects(() => runMutationChecks(options), /symlinks/u);
  await assert.rejects(() => access(join(options.outputDirectory, 'snapshot/src/private.mjs')));
});

test('nested dependency directories remain outside the bounded product snapshot', async t => {
  const options = await fixture(t);
  await mkdir(join(options.sourceRoot, 'src/node_modules'));
  await writeFile(join(options.sourceRoot, 'src/node_modules/private.mjs'), 'EXCLUDED_PRIVATE_SENTINEL');
  const receipt = await runMutationChecks(options);
  assert.equal(receipt.mutations[0].status, 'killed');
  await assert.rejects(() => access(join(options.outputDirectory, 'snapshot/src/node_modules')));
});

// Each added catalog item must prove a meaningful behavior with a green control.
test('fixed catalog covers integrated feature boundaries with distinct named behavioral checks', () => {
  const ids = new Set(MUTATIONS.map(mutation => mutation.id));
  for (const id of ['widen-scoped-ignore', 'disable-unused-scoped-check', 'disable-contract-json-missing', 'disable-number-roundtrip', 'disable-inspect-config-budget', 'disable-junit-failure', 'disable-junit-escaping', 'lossy-query-identity', 'disable-url-surrogate-check', 'strip-query-name-bom', 'strip-body-bom-bytes', 'reject-supported-document-bom', 'ids-leak-operation-labels', 'ids-leak-configuration']) assert.ok(ids.has(id), id);
  assert.equal(ids.size, MUTATIONS.length);
});

test('source hashes expose concurrent source edits without changing the frozen mutant inputs', async t => {
  const options = await fixture(t, sourcePath => `if(status()===200) await (await import('node:fs/promises')).writeFile(${JSON.stringify(sourcePath)}, 'export function status(){ return 201; }\\n'); assert.equal(status(),200);`);
  const receipt = await runMutationChecks(options);
  assert.equal(receipt.mutations[0].status, 'killed');
  assert.equal(receipt.sourceUnchanged, false);
  assert.notEqual(receipt.sourceDigestBefore, receipt.sourceDigestAfter);
  assert.ok(receipt.sourceFilesAfter.some(file => file.path === 'src/compare.mjs'));
  assert.match(await readFile(join(options.outputDirectory, 'snapshot/src/compare.mjs'), 'utf8'), /return 200/u);
});
