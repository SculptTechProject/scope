import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Hash only product modules, without copying code, credentials, output or Git state. */
export async function snapshotProductSources(root) {
  const paths = ['cli.mjs'];
  let directories = 0;
  async function visit(relative, depth = 0) {
    if (++directories > 64 || depth > 8) throw new Error('Product source directories exceed snapshot bounds.');
    const path = join(root, relative), stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Product source directories must not be symbolic links.');
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      if (entry.isSymbolicLink()) throw new Error('Product source snapshot does not follow symbolic links.');
      const name = relative + '/' + entry.name;
      if (entry.isDirectory()) await visit(name, depth + 1);
      else if (entry.name.endsWith('.mjs') && !entry.name.endsWith('.test.mjs')) paths.push(name);
    }
  }
  for (const directory of ['src', 'contracts', 'json', 'formats']) await visit(directory);
  if (paths.length > 128) throw new Error('Product source snapshot exceeds its file bound.');
  const files = [];
  let totalBytes = 0;
  for (const path of paths.sort()) {
    const handle = await open(join(root, path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => { throw new Error('Product source snapshot requires regular files without symbolic links.'); });
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Product source snapshot requires bounded regular files.');
      const bytes = Buffer.alloc(1024 * 1024 + 1);
      let length = 0;
      while (length < bytes.length) {
        const part = await handle.read(bytes, length, bytes.length - length, null);
        if (!part.bytesRead) break;
        length += part.bytesRead;
      }
      totalBytes += length;
      if (length > 1024 * 1024 || totalBytes > 8 * 1024 * 1024) throw new Error('Product source snapshot exceeds its byte bound.');
      files.push({ path, bytes: length, sha256: createHash('sha256').update(bytes.subarray(0, length)).digest('hex') });
    } finally { await handle.close(); }
  }
  return { algorithm: 'sha256', sha256: createHash('sha256').update(JSON.stringify(files)).digest('hex'), files };
}
