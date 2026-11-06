import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Only Cargo's external discovery is a fixture. Execute the actual notice generator
// and inspect its redistributable output, including the absence of private paths.
function generateNotices(packages, workspaceNames = []) {
  const root = mkdtempSync(join(tmpdir(), 'scope-license-attribution-'));
  try {
    mkdirSync(join(root, 'scripts'));
    copyFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'licenses.mjs'),
      join(root, 'scripts/licenses.mjs'),
    );
    writeFileSync(join(root, 'Cargo.lock'), '# fixture lockfile\n');
    writeFileSync(join(root, 'package-lock.json'), '{}\n');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: {} }));
    const crates = packages.map((p) => ({
      id: `path+file://${root}/${p.directory}#${p.name}@${p.version}`,
      license: 'MIT',
      authors: [],
      source: null,
      repository: null,
      ...p,
      manifest_path: join(root, p.directory, 'Cargo.toml'),
    }));
    const about = {
      licenses: [
        {
          id: 'MIT',
          name: 'MIT License',
          text: 'Fixture license text',
          used_by: crates.map((crate) => ({ crate, path: null })),
        },
      ],
    };
    const metadata = {
      packages: crates.filter((p) => workspaceNames.includes(p.name)),
      workspace_members: crates.filter((p) => workspaceNames.includes(p.name)).map((p) => p.id),
    };
    const cargo = join(root, 'cargo-fixture');
    writeFileSync(
      cargo,
      `#!${process.execPath}\nconst args = process.argv.slice(2);\nif (args[0] === 'about') process.stdout.write(${JSON.stringify(JSON.stringify(about))});\nelse if (args[0] === 'metadata' && args.includes('--locked') && args.includes('--no-deps')) process.stdout.write(${JSON.stringify(JSON.stringify(metadata))});\nelse process.exit(1);\n`,
      { mode: 0o755 },
    );
    const result = spawnSync(process.execPath, [join(root, 'scripts/licenses.mjs')], {
      env: { ...process.env, CARGO: cargo },
      encoding: 'utf8',
    });
    if (result.status !== 0) return { result };
    const json = readFileSync(join(root, 'resources/licenses/rust.json'), 'utf8');
    assert(!json.includes(root), 'redistributable notices must not expose private checkout paths');
    return {
      result,
      packages: JSON.parse(json).licenses[0].packages,
      html: readFileSync(join(root, 'resources/licenses/index.html'), 'utf8'),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('workspace path dependencies use the current Scope repository', () => {
  const { result, packages } = generateNotices(
    [{ name: 'scope-core', version: '1.2.1', directory: 'crates/scope-core' }],
    ['scope-core'],
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(packages[0].source, 'https://github.com/dalkedev/scope');
});

test('vendored GLib preserves upstream attribution and identifies the Scope backport', () => {
  const { result, packages, html } = generateNotices([
    {
      name: 'glib',
      version: '0.18.5',
      directory: 'vendor/glib',
      repository: 'https://github.com/gtk-rs/gtk-rs-core',
    },
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(packages[0].repository, 'https://github.com/gtk-rs/gtk-rs-core');
  assert.equal(packages[0].source, 'https://github.com/dalkedev/scope/tree/main/vendor/glib');
  assert.equal(packages[0].upstreamSource, 'https://crates.io/crates/glib/0.18.5');
  assert.equal(
    packages[0].provenance,
    'https://github.com/dalkedev/scope/blob/main/vendor/glib-provenance/README.md',
  );
  assert.match(html, /href="https:\/\/crates\.io\/crates\/glib\/0\.18\.5">upstream<\/a>/);
  assert.match(
    html,
    /href="https:\/\/github\.com\/dalkedev\/scope\/blob\/main\/vendor\/glib-provenance\/README\.md">Scope backport provenance<\/a>/,
  );
});

test('other local path dependencies retain their declared repository instead of becoming Scope', () => {
  const { result, packages } = generateNotices([
    {
      name: 'scope-helper',
      version: '0.1.0',
      directory: 'vendor/helper',
      repository: 'https://example.test/upstream',
    },
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(packages[0].source, 'https://example.test/upstream');
});

test('registry packages keep their exact published package source', () => {
  const { result, packages } = generateNotices([
    {
      name: 'glib',
      version: '0.18.5',
      directory: 'registry/glib',
      source: 'registry+https://github.com/rust-lang/crates.io-index',
      repository: 'https://github.com/gtk-rs/gtk-rs-core',
    },
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(packages[0].source, 'https://crates.io/crates/glib/0.18.5');
  assert.equal(packages[0].provenance, undefined);
});

test('unknown local dependencies without a public source fail rather than claiming Scope ownership', () => {
  const { result } = generateNotices([
    { name: 'unattributed', version: '0.1.0', directory: 'vendor/unattributed' },
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No public source attribution for unattributed 0\.1\.0/);
});

test('local filesystem repository metadata cannot become a redistributable source URL', () => {
  const { result } = generateNotices([
    {
      name: 'private-path',
      version: '0.1.0',
      directory: 'vendor/private-path',
      repository: 'file:///private/upstream',
    },
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No public source attribution for private-path 0\.1\.0/);
});
