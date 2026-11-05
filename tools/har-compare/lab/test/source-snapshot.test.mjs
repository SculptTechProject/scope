import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as snapshots from '../source-snapshot.mjs';
async function source(t) {
  assert.equal(typeof snapshots.snapshotProductSources, 'function', 'product-source provenance must be available');
  const root = await mkdtemp(join(tmpdir(), 'scope-lab-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of ['src', 'contracts', 'json', 'formats']) await mkdir(join(root, directory));
  await writeFile(join(root, 'cli.mjs'), 'export const cli = true;\n');
  await writeFile(join(root, 'src', 'parse.mjs'), 'export const parse = true;\n');
  return root;
}

test('source snapshot is deterministic and excludes tests, memory, dependencies and output', async t => {
  const root = await source(t);
  for (const path of ['src/parse.test.mjs', 'src/.private.mjs', '.env', 'memory.mjs']) await writeFile(join(root, path), 'SYNTHETIC_EXCLUDED_CONTENT');
  await mkdir(join(root, 'node_modules')); await writeFile(join(root, 'node_modules', 'private.mjs'), 'SYNTHETIC_EXCLUDED_CONTENT');
  const first = await snapshots.snapshotProductSources(root), second = await snapshots.snapshotProductSources(root);
  assert.deepEqual(first, second);
  assert.deepEqual(first.files.map(file => file.path), ['cli.mjs', 'src/parse.mjs']);
  assert.match(first.sha256, /^[a-f0-9]{64}$/u);
  assert.doesNotMatch(JSON.stringify(first), /SYNTHETIC_EXCLUDED_CONTENT|export const/u);
});

test('source snapshot changes for edited, added or removed product modules', async t => {
  const root = await source(t), original = await snapshots.snapshotProductSources(root);
  await writeFile(join(root, 'src', 'parse.mjs'), 'export const parse = false;\n');
  const changed = await snapshots.snapshotProductSources(root); assert.notEqual(changed.sha256, original.sha256);
  await writeFile(join(root, 'formats', 'new.mjs'), 'export const format = true;\n');
  const added = await snapshots.snapshotProductSources(root); assert.notEqual(added.sha256, changed.sha256);
  await rm(join(root, 'formats', 'new.mjs'));
  assert.deepEqual(await snapshots.snapshotProductSources(root), changed);
});

test('source provenance refuses symlinked source modules and source directories', async t => {
  const root = await source(t), target = join(root, 'outside.txt');
  await writeFile(target, 'SYNTHETIC_EXCLUDED_CONTENT');
  await symlink(target, join(root, 'src', 'linked.mjs'));
  await assert.rejects(snapshots.snapshotProductSources(root), /regular files|symbolic links/u);
  await rm(join(root, 'src', 'linked.mjs'));
  await symlink(join(root, 'json'), join(root, 'src', 'linked-directory'));
  await assert.rejects(snapshots.snapshotProductSources(root), /directories|symbolic links/u);
  await rm(join(root, 'src', 'linked-directory'));
  await rm(join(root, 'formats'), { recursive: true }); await symlink(join(root, 'src'), join(root, 'formats'));
  await assert.rejects(snapshots.snapshotProductSources(root), /directories|symbolic links/u);
});
