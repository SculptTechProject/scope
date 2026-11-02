import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preparePublicResources, verifyPublicResources } from './public-resources.mjs';

test('public staging excludes optional native Frida while preserving local binaries and source setup', () => {
  const root = mkdtempSync(join(tmpdir(), 'scope-release-'));
  try {
    mkdirSync(join(root, 'resources/bin'), { recursive: true });
    mkdirSync(join(root, 'resources/device'), { recursive: true });
    for (const name of [
      'scope-frida-worker',
      'scope-frida-worker.exe',
      'frida-server-17.9.1-android-arm64',
      'scope-mcp',
    ]) {
      writeFileSync(join(root, 'resources/bin', name), name);
    }
    writeFileSync(join(root, 'resources/device/install-runtime.py'), 'source setup');
    const config = preparePublicResources(root);
    const patch = JSON.parse(readFileSync(config));
    assert.equal(patch.bundle.resources['../resources/'], null);
    const stage = join(root, '.runtime/public-resources');
    assert(existsSync(join(stage, 'bin/scope-mcp')));
    assert(!existsSync(join(stage, 'bin/scope-frida-worker')));
    assert(!existsSync(join(stage, 'bin/frida-server-17.9.1-android-arm64')));
    assert(existsSync(join(root, 'resources/bin/scope-frida-worker')));
    assert(verifyPublicResources(stage).includes(join('device', 'install-runtime.py')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release resource verification rejects accidentally included private session data', () => {
  const root = mkdtempSync(join(tmpdir(), 'scope-release-secret-'));
  try {
    writeFileSync(join(root, 'install-runtime.py'), 'source');
    writeFileSync(join(root, 'scope-ca-key.pem'), 'not a real key');
    assert.throws(() => verifyPublicResources(root), /Private runtime data/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
