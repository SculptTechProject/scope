import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function allowedPublicResource(path) {
  const name = basename(path);
  return (
    !/^scope-frida-worker(?:\.exe)?$/.test(name) &&
    !/^frida-server(?:-|$)/.test(name) &&
    name !== '__pycache__' &&
    name !== '.gitignore' &&
    !name.endsWith('.pyc')
  );
}

export function preparePublicResources(root) {
  const runtime = join(root, '.runtime');
  const stage = join(runtime, 'public-resources');
  mkdirSync(runtime, { recursive: true });
  rmSync(stage, { force: true, recursive: true });
  cpSync(join(root, 'resources'), stage, { recursive: true, filter: allowedPublicResource });
  const resources = {
    '../resources/': null,
    '../.runtime/public-resources/': 'resources/',
    '../LICENSE': 'LICENSE',
    '../THIRD_PARTY_NOTICES.md': 'THIRD_PARTY_NOTICES.md',
  };
  const config = join(runtime, 'public-bundle.json');
  writeFileSync(config, JSON.stringify({ bundle: { resources } }, null, 2) + '\n');
  verifyPublicResources(stage);
  return config;
}

export function verifyPublicResources(directory) {
  if (!existsSync(directory)) throw new Error(`Resource directory not found: ${directory}`);
  const files = [];
  const visit = (path) => {
    for (const entry of readdirSync(path)) {
      const child = join(path, entry);
      if (!allowedPublicResource(child))
        throw new Error(`Excluded Frida/cache artifact found: ${child}`);
      if (
        /^(?:scope\.sqlite3(?:-shm|-wal)?|scope-ca(?:-key)?\.pem|mcp-bridge\.json|device-recovery\.json)$/.test(
          entry,
        )
      ) {
        throw new Error(`Private runtime data found in release resources: ${child}`);
      }
      if (statSync(child).isDirectory()) visit(child);
      else files.push(relative(directory, child));
    }
  };
  visit(directory);
  if (!files.some((name) => /(?:^|[\\/])install-runtime\.py$/.test(name))) {
    throw new Error('Public resources must include the explicit optional Frida setup helper');
  }
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  if (process.argv[2] === 'prepare') console.log(preparePublicResources(root));
  else if (process.argv[2])
    console.log(
      `Verified ${verifyPublicResources(resolve(process.argv[2])).length} public resource files`,
    );
  else throw new Error('Usage: node scripts/public-resources.mjs prepare|RESOURCE_DIRECTORY');
}
