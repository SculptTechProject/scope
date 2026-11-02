#!/usr/bin/env node
// Regenerate redistributable notices from the exact Cargo and npm lockfiles.
// Requires cargo-about 0.9.3 (`cargo install cargo-about --locked --features cli --version 0.9.3`).
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = join(root, 'resources/licenses');
const digest = (name) =>
  createHash('sha256')
    .update(readFileSync(join(root, name)))
    .digest('hex');
const result = spawnSync(
  process.env.CARGO || 'cargo',
  ['about', 'generate', '--workspace', '--locked', '--format', 'json', '--fail'],
  { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
if (result.status !== 0)
  throw new Error(result.stderr || result.error?.message || 'cargo-about failed');
const rust = JSON.parse(result.stdout);
const rustNotices = {
  generator: 'cargo-about 0.9.3; scripts/licenses.mjs',
  lockfileSha256: digest('Cargo.lock'),
  scope:
    'Workspace runtime dependencies across supported target configurations; build and dev dependencies excluded. Includes target-specific crates not necessarily present in each artifact.',
  licenses: rust.licenses.map((license) => ({
    id: license.id,
    name: license.name,
    text: license.text,
    packages: license.used_by.map(({ crate: p }) => ({
      name: p.name,
      version: p.version,
      license: p.license,
      repository: p.repository,
      authors: p.authors,
      source: p.source
        ? `https://crates.io/crates/${p.name}/${p.version}`
        : 'https://github.com/SculptTechProject/scope',
    })),
  })),
};

const runtimePackages = new Map();
function visit(name, from = root) {
  let directory = from;
  let packageDirectory;
  for (;;) {
    const candidate = join(directory, 'node_modules', name);
    try {
      readFileSync(join(candidate, 'package.json'));
      packageDirectory = candidate;
      break;
    } catch {
      /* Search parent node_modules. */
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Missing installed runtime dependency: ${name}`);
    directory = parent;
  }
  const p = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8'));
  const id = `${p.name}@${p.version}`;
  if (runtimePackages.has(id)) return;
  const files = readdirSync(packageDirectory).filter((file) =>
    /^(licen[cs]e|copying|notice|copyright|ofl)([.\-_]|$)/i.test(file),
  );
  if (!files.length) throw new Error(`No packaged license text for ${id}`);
  runtimePackages.set(id, {
    name: p.name,
    version: p.version,
    license: p.license,
    repository: p.repository,
    source: `https://www.npmjs.com/package/${p.name}/v/${p.version}`,
    notices: files.map((file) => ({
      file,
      text: readFileSync(join(packageDirectory, file), 'utf8'),
    })),
  });
  for (const dependency of Object.keys(p.dependencies || {})) visit(dependency, packageDirectory);
}
for (const name of Object.keys(
  JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies,
))
  visit(name);
const frontendNotices = {
  generator: 'scripts/licenses.mjs',
  lockfileSha256: digest('package-lock.json'),
  scope: 'Installed npm runtime dependencies, including fonts; development tools excluded.',
  packages: [...runtimePackages.values()].sort((a, b) => a.name.localeCompare(b.name, 'en')),
};
const escape = (text) =>
  String(text ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const sections = rustNotices.licenses.map(
  (license) =>
    `<section><h2>${escape(license.name)} (${escape(license.id)})</h2><p>${license.packages.map((p) => `${escape(p.name)} ${escape(p.version)}`).join(', ')}</p><pre>${escape(license.text)}</pre></section>`,
);
for (const p of frontendNotices.packages)
  sections.push(
    `<section><h2>${escape(p.name)} ${escape(p.version)}</h2><p>${escape(p.license)}</p>${p.notices.map((notice) => `<h3>${escape(notice.file)}</h3><pre>${escape(notice.text)}</pre>`).join('')}</section>`,
  );
mkdirSync(destination, { recursive: true });
writeFileSync(join(destination, 'rust.json'), JSON.stringify(rustNotices, null, 2) + '\n');
writeFileSync(join(destination, 'frontend.json'), JSON.stringify(frontendNotices, null, 2) + '\n');
writeFileSync(
  join(destination, 'index.html'),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Scope — third-party licenses</title><style>body{max-width:1000px;margin:3rem auto;padding:0 1.5rem;font:16px/1.6 system-ui,sans-serif;color:#20272b}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 monospace}section{border-top:1px solid #ccd3d4;margin-top:3rem}h2{font-size:20px}</style><h1>Scope — third-party licenses</h1><p>Generated from Cargo.lock ${rustNotices.lockfileSha256} and package-lock.json ${frontendNotices.lockfileSha256}. See THIRD_PARTY_NOTICES.md for vendored interception scripts and optional runtimes. ${escape(rustNotices.scope)}</p>${sections.join('\n')}</html>\n`,
);
console.log(
  `Wrote ${rustNotices.licenses.length} Rust license sections and ${frontendNotices.packages.length} npm package notices.`,
);
