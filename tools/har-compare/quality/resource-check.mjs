import { constants } from 'node:fs';
import { open, mkdir, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const digest = manifest => createHash('sha256').update(JSON.stringify(manifest)).digest('hex');

/** Freeze only runtime modules. No tests, dependencies, environment or Git data. */
async function snapshot(root, destination) {
  const paths = ['cli.mjs'];
  for (const directory of ['src', 'contracts', 'json', 'formats']) {
    const handle = await open(join(root, directory), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    await handle.close();
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      if (/^[a-z][a-z0-9-]*\.mjs$/u.test(entry.name) && !entry.name.endsWith('.test.mjs')) {
        if (!entry.isFile()) throw new Error('Runtime snapshots require regular files.');
        paths.push(directory + '/' + entry.name);
      }
    }
  }
  if (paths.length > 64) throw new Error('Runtime source exceeds file-count bounds.');
  const manifest = [];
  for (const path of paths.sort()) {
    const handle = await open(join(root, path), constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    let bytes;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Runtime source exceeds file bounds.');
      const buffer = Buffer.alloc(1024 * 1024 + 1);
      let length = 0;
      while (length < buffer.length) {
        const read = await handle.read(buffer, length, buffer.length - length, null);
        if (!read.bytesRead) break;
        length += read.bytesRead;
      }
      if (length > 1024 * 1024) throw new Error('Runtime source grew beyond bounds.');
      bytes = buffer.subarray(0, length);
    } finally { await handle.close(); }
    manifest.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    if (destination) {
      const slash = path.lastIndexOf('/');
      if (slash !== -1) await mkdir(join(destination, path.slice(0, slash)), { recursive: true });
      await writeFile(join(destination, path), bytes, { flag: 'wx', mode: 0o600 });
    }
  }
  return manifest;
}

const entry = (url, text = '{}') => ({ request: { method: 'GET', url }, response: { status: 200, content: { mimeType: 'application/json', text } } });
const har = entries => JSON.stringify({ log: { entries } });
const prefix = 'https://api.example.invalid/x?';
const longUrl = pair => prefix + pair.repeat(Math.ceil((4096 - prefix.length) / pair.length)).slice(0, 4096 - prefix.length);

/** Fixed synthetic boundary controls, not a throughput benchmark or load test. */
export function cases() {
  const simple = entry(prefix + 'q=1');
  const exactFile = har([simple]);
  const padded = bytes => exactFile.slice(0, -1) + ',"padding":"' + 'x'.repeat(bytes - Buffer.byteLength(exactFile) - 13) + '"}';
  return [
    ...[['ascii-pairs', 'q=a&'], ['binary-values', 'q=%FF&'], ['binary-names', '%FF=a&']].map(([name, pair]) => ({ name: 'query-' + name + '-max', input: har(Array(2000).fill(entry(longUrl(pair)))), expected: 0 })),
    { name: 'url-over-4096', input: har([entry(longUrl('q=a&') + 'x')]), expected: 2, code: 'HAR' },
    { name: 'nodes-exact-100000', input: har(Array(2000).fill(entry(prefix + 'q=1', JSON.stringify(Object.fromEntries(Array.from({ length: 49 }, (_, index) => ['f' + index, 0])))))), expected: 0 },
    { name: 'nodes-over-100000', input: har([entry(prefix + 'q=1', JSON.stringify(Array(100000).fill(0)))]), expected: 2, code: 'LIMIT' },
    { name: 'entries-over-2000', input: har(Array(2001).fill(simple)), expected: 2, code: 'LIMIT' },
    { name: 'file-exact-10mib', input: padded(10 * 1024 * 1024), expected: 0 },
    { name: 'file-over-10mib', input: padded(10 * 1024 * 1024 + 1), expected: 2, code: 'LIMIT' },
    { name: 'body-depth-exact-64', input: har([entry(prefix + 'q=1', '['.repeat(64) + '0' + ']'.repeat(64))]), expected: 0 },
    { name: 'body-depth-over-64', input: har([entry(prefix + 'q=1', '['.repeat(65) + '0' + ']'.repeat(65))]), expected: 2, code: 'LIMIT' },
  ];
}

async function run(cli, input, temporary) {
  return await new Promise(resolveResult => {
    const start = Date.now();
    const child = spawn('/usr/bin/time', ['-f', 'SCOPE_RESOURCE %e %M', process.execPath, '--max-old-space-size=256', cli, 'compare', '--baseline', input, '--candidate', input], { cwd: temporary, env: { PATH: '/usr/bin:/bin', TMPDIR: temporary, LC_ALL: 'C.UTF-8' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', bytes = 0, timedOut = false, outputLimit = false, launchError = false;
    const stop = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } };
    const timer = setTimeout(() => { timedOut = true; stop(); }, 30000);
    const receive = (chunk, stream) => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) { outputLimit = true; stop(); return; }
      if (stream === 'stdout') stdout += chunk.toString('utf8'); else stderr += chunk.toString('utf8');
    };
    child.stdout.on('data', chunk => receive(chunk, 'stdout'));
    child.stderr.on('data', chunk => receive(chunk, 'stderr'));
    child.once('error', () => { launchError = true; });
    child.once('close', (status, signal) => {
      clearTimeout(timer);
      const metrics = /SCOPE_RESOURCE ([\d.]+) (\d+)/u.exec(stderr);
      let report; try { report = JSON.parse(stdout); } catch {}
      resolveResult({ status, signal, timedOut, outputLimit, launchError, elapsedMs: Date.now() - start, ...(metrics ? { timeSeconds: Number(metrics[1]), maxRssKiB: Number(metrics[2]) } : {}), ...(report?.error ? { code: report.error.code } : {}), regressions: report?.summary?.regressions, validJson: Boolean(report), stdout, stderr });
    });
  });
}

export async function runResourceChecks({ sourceRoot = defaultRoot, outputDirectory }) {
  sourceRoot = resolve(sourceRoot); outputDirectory = resolve(outputDirectory);
  if (outputDirectory === sourceRoot || outputDirectory.startsWith(sourceRoot + sep)) throw new Error('Use a new directory outside the source tool.');
  await mkdir(outputDirectory, { mode: 0o700 });
  const frozen = join(outputDirectory, 'snapshot'); await mkdir(frozen);
  const manifest = await snapshot(sourceRoot, frozen);
  const temporary = join(outputDirectory, 'tmp'); await mkdir(temporary);
  const receipt = { schemaVersion: 1, kind: 'fixed-resource-boundary-controls', node: process.version, timeoutMs: 30000, v8OldSpaceMiB: 256, childOutputBytes: 1024 * 1024, sourceFiles: manifest, sourceDigestBefore: digest(manifest), cases: [], summary: { passed: 0, failed: 0, timedOut: 0 } };
  for (const item of cases()) {
    const input = join(outputDirectory, item.name + '.har');
    await writeFile(input, item.input, { flag: 'wx', mode: 0o600 });
    const { stdout, stderr, ...result } = await run(join(frozen, 'cli.mjs'), input, temporary);
    await writeFile(join(outputDirectory, item.name + '-result.json'), stdout, { flag: 'wx', mode: 0o600 });
    await writeFile(join(outputDirectory, item.name + '-metrics.txt'), stderr, { flag: 'wx', mode: 0o600 });
    const passed = !result.timedOut && !result.outputLimit && !result.launchError && result.validJson && result.status === item.expected && result.code === item.code && (item.expected !== 0 || result.regressions === 0);
    const record = { name: item.name, inputBytes: Buffer.byteLength(item.input), expected: item.expected, ...(item.code ? { expectedCode: item.code } : {}), ...result, passed };
    receipt.cases.push(record); receipt.summary[passed ? 'passed' : 'failed']++;
    if (result.timedOut) receipt.summary.timedOut++;
    await writeFile(join(outputDirectory, 'progress.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify(record));
  }
  receipt.sourceDigestAfter = digest(await snapshot(sourceRoot));
  receipt.sourceUnchanged = receipt.sourceDigestBefore === receipt.sourceDigestAfter;
  await writeFile(join(outputDirectory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { source: { type: 'string' }, output: { type: 'string' } }, strict: true });
    if (!values.output) throw new Error('An output directory is required.');
    const receipt = await runResourceChecks({ sourceRoot: values.source, outputDirectory: values.output });
    console.log(JSON.stringify({ summary: receipt.summary, sourceUnchanged: receipt.sourceUnchanged }));
    process.exitCode = receipt.summary.failed ? 1 : 0;
  } catch { console.error('Resource checks could not complete; inspect preserved progress and use a new output directory.'); process.exitCode = 2; }
}
