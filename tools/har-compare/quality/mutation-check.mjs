import { constants } from 'node:fs';
import { open, mkdir, readdir, readFile, writeFile, mkdtemp, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const directories = ['src', 'contracts', 'json', 'formats', 'test', 'examples/fixtures'];
const childEnvironment = temp => ({ PATH: '/usr/bin:/bin', TMPDIR: temp, LC_ALL: 'C.UTF-8' });

/** Fixed, reviewable behavioral changes. No random mutation selection. */
export const MUTATIONS = Object.freeze([
  { id: 'disable-http-status', file: 'src/compare.mjs', from: 'if (before.status !== after.status) emit(', to: 'if (false && before.status !== after.status) emit(', testFile: 'test/cli.test.mjs', testNamePattern: '^200 to 500 is a regression even when JSON subtree is ignored$' },
  { id: 'collapse-occurrences', file: 'src/compare.mjs', from: "else if (before.body.kind === 'json') walk(", to: "else if (before.body.kind === 'json' && i === 0) walk(", testFile: 'test/cli.test.mjs', testNamePattern: '^per-occurrence comparison cannot hide a field behind a union$' },
  { id: 'ignore-all-values', file: 'src/compare.mjs', from: "config.mode === 'strict' && a !== b", to: "false && config.mode === 'strict' && a !== b", testFile: 'test/cli.test.mjs', testNamePattern: '^timestamp ignore has a strict value-aware negative control$' },
  { id: 'skip-selected-body-validation', file: 'src/input.mjs', from: 'body: body(response, method, index, budget)', to: "body: { kind: 'empty' }", testFile: 'test/cli.test.mjs', testNamePattern: '^missing JSON body fails closed without raw input in diagnostics$' },
  { id: 'disable-duplicate-check', file: 'json/parse.mjs', from: 'if (object.keys.has(key)) fail(', to: 'if (false && object.keys.has(key)) fail(', testFile: 'test/json-cli.test.mjs', testNamePattern: '^strict JSON rejects ambiguous/rounded selected body' },
  { id: 'disable-contract-status', file: 'contracts/index.mjs', from: 'if (!rule.allowedStatuses.includes(entry.status)) emit(', to: 'if (false && !rule.allowedStatuses.includes(entry.status)) emit(', testFile: 'test/contract-cli.test.mjs', testNamePattern: '^authored status contract fails unchanged HTTP500 that comparison alone permits$' },
  { id: 'widen-scoped-ignore', file: 'src/compare.mjs', from: 'scopedRules.findIndex(r => r.method === sample.method && r.origin === sample.origin && r.path === sample.path)', to: 'scopedRules.findIndex(() => true)', testFile: 'test/scoped-ignore.test.mjs', testNamePattern: '^scoped ignore at health cannot conceal same pointer at billing$' },
  { id: 'disable-unused-scoped-check', file: 'src/compare.mjs', from: 'if ([...scopedHits.values()].some(n => n === 0)) fail(', to: 'if (false && [...scopedHits.values()].some(n => n === 0)) fail(', testFile: 'test/scoped-ignore.test.mjs', testNamePattern: '^scoped pointer must match within its own operation$' },
  { id: 'disable-contract-json-missing', file: 'contracts/index.mjs', from: 'if (value === missing) emit(', to: 'if (false && value === missing) emit(', testFile: 'test/contract-cli.test.mjs', testNamePattern: '^authored JSON requirement can fail a field absent from both observations$' },
  { id: 'disable-number-roundtrip', file: 'json/parse.mjs', from: 'validateNumber(text.slice(start, index + 1));', to: 'void text.slice(start, index + 1);', testFile: 'test/json-cli.test.mjs', testNamePattern: '^strict JSON rejects ambiguous/rounded selected body' },
  { id: 'disable-inspect-config-budget', file: 'src/inspect.mjs', from: 'if (configTemplate && Buffer.byteLength(', to: 'if (false && configTemplate && Buffer.byteLength(', testFile: 'test/inspect.test.mjs', testNamePattern: '^inspect never advertises a config template exceeding the CLI config byte limit$' },
  { id: 'disable-junit-failure', file: 'formats/junit.mjs', from: "if (finding.severity === 'regression') append(", to: "if (false && finding.severity === 'regression') append(", testFile: 'test/junit-cli.test.mjs', testNamePattern: '^JUnit output preserves regression exit1 and emits failure evidence$' },
  { id: 'disable-junit-escaping', file: 'formats/junit.mjs', from: ".replace(/[&<>\"']/gu, char =>", to: ".replace(/(?!) /gu, char =>", testFile: 'formats/junit.test.mjs', testNamePattern: '^every emitted untrusted label and evidence value is XML-escaped$' },
  { id: 'lossy-query-identity', file: 'src/input.mjs', from: 'query: queryIdentity(url.search)', to: 'query: (() => { const params = new URLSearchParams(url.search); params.sort(); return params.toString(); })()', testFile: 'test/query-identity.test.mjs', testNamePattern: '^lossless query matching distinguishes non-UTF8 octets ' },
  { id: 'disable-url-surrogate-check', file: 'src/input.mjs', from: '|| !request.url.isWellFormed()', to: '', testFile: 'test/query-identity.test.mjs', testNamePattern: '^unpaired URL surrogate fails before lossy WHATWG conversion ' },
  { id: 'strip-query-name-bom', file: 'src/query.mjs', from: "name.toString('utf8')", to: "name.toString('utf8').replace(/^\\uFEFF/u, '')", testFile: 'test/query-identity.test.mjs', testNamePattern: '^query-name BOM is data and does not collapse stable sort order$' },
  { id: 'strip-body-bom-bytes', file: 'src/input.mjs', from: 'ignoreBOM: true', to: 'ignoreBOM: false', testFile: 'test/encoding-cli.test.mjs', testNamePattern: '^BOM bytes are not an empty HEAD or204 body$' },
  { id: 'reject-supported-document-bom', file: 'src/input.mjs', from: 'text.charCodeAt(0) === 0xfeff ? text.slice(1) : text', to: 'text', testFile: 'test/encoding-cli.test.mjs', testNamePattern: '^one document BOM has identical plain/base64 JSON interpretation$' },
  { id: 'ids-leak-operation-labels', file: 'src/privacy.mjs', from: 'id: operation.id,', to: 'id: operation.id, method: operation.method, origin: operation.origin, path: operation.path,', testFile: 'test/privacy-cli.test.mjs', testNamePattern: '^ids labels omit captured and configured names across stdout JSON HTML JUnit$' },
  { id: 'ids-leak-configuration', file: 'src/privacy.mjs', from: 'redacted: true,', to: '...config, redacted: true,', testFile: 'test/privacy-cli.test.mjs', testNamePattern: '^ids labels omit captured and configured names across stdout JSON HTML JUnit$' },
].map(mutation => Object.freeze(mutation)));

export function applyMutation(source, mutation) {
  const pieces = source.split(mutation.from);
  if (pieces.length !== 2) throw new Error('Mutation requires exactly one matching source anchor.');
  return pieces[0] + mutation.to + pieces[1];
}

async function sourceFiles(root) {
  const files = ['cli.mjs'];
  async function walk(relative) {
    let entries;
    try {
      if ((await lstat(join(root, relative))).isSymbolicLink()) throw new Error('Source snapshots reject symlinks.');
      entries = await readdir(join(root, relative), { withFileTypes: true });
    }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      if (entry.isSymbolicLink()) throw new Error('Source snapshots reject symlinks.');
      const path = relative + '/' + entry.name;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && /\.(?:mjs|json|har)$/u.test(entry.name)) files.push(path);
      if (files.length > 256) throw new Error('Source snapshot exceeds its file-count limit.');
    }
  }
  for (const directory of directories) await walk(directory);
  return files.sort();
}

async function readSource(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Source snapshot accepts regular files only.');
    const buffer = Buffer.alloc(1024 * 1024 + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const result = await handle.read(buffer, bytes, buffer.length - bytes, null);
      if (!result.bytesRead) break;
      bytes += result.bytesRead;
    }
    if (bytes > 1024 * 1024) throw new Error('Source snapshot exceeds its per-file byte limit.');
    return buffer.subarray(0, bytes);
  } finally { await handle.close(); }
}

async function snapshot(sourceRoot, destination) {
  const manifest = [];
  let bytes = 0;
  for (const path of await sourceFiles(sourceRoot)) {
    const content = await readSource(join(sourceRoot, path));
    bytes += content.length;
    if (bytes > 32 * 1024 * 1024) throw new Error('Source snapshot exceeds its total byte limit.');
    await mkdir(dirname(join(destination, path)), { recursive: true });
    await writeFile(join(destination, path), content, { flag: 'wx', mode: 0o600 });
    manifest.push({ path, bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') });
  }
  return manifest;
}

async function sourceManifest(sourceRoot) {
  const manifest = [];
  let bytes = 0;
  for (const path of await sourceFiles(sourceRoot)) {
    const content = await readSource(join(sourceRoot, path));
    bytes += content.length;
    if (bytes > 32 * 1024 * 1024) throw new Error('Source manifest exceeds its total byte limit.');
    manifest.push({ path, bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') });
  }
  return manifest;
}
const manifestDigest = manifest => createHash('sha256').update(JSON.stringify(manifest)).digest('hex');

/** Kill the child process group, including test workers and their CLI children. */
async function runNode(args, cwd, temp, timeoutMs) {
  return await new Promise(resolveResult => {
    const started = Date.now();
    const child = spawn(process.execPath, args, { cwd, env: childEnvironment(temp), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', bytes = 0, timedOut = false, outputLimit = false, launchError = false;
    const stop = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    function receive(chunk, stream) {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) { outputLimit = true; stop(); return; }
      if (stream === 'stdout') stdout += chunk.toString('utf8');
      else stderr += chunk.toString('utf8');
    }
    child.stdout.on('data', chunk => receive(chunk, 'stdout'));
    child.stderr.on('data', chunk => receive(chunk, 'stderr'));
    child.once('error', () => { launchError = true; });
    child.once('close', (status, signal) => {
      clearTimeout(timer);
      const count = name => Number([...stdout.matchAll(new RegExp(`^# ${name} (\\d+)$`, 'gmu'))].at(-1)?.[1] ?? 0);
      const tests = count('tests'), skipped = count('skipped');
      resolveResult({ status, signal, timedOut, outputLimit, launchError, tests, executed: tests - skipped, passed: count('pass'), failed: count('fail'), cancelled: count('cancelled'), skipped, elapsedMs: Date.now() - started, stdout, stderr });
    });
  });
}

function validateMutation(mutation) {
  const path = value => typeof value === 'string' && value.split('/').every(part => /^[A-Za-z0-9_.-]+$/u.test(part) && part !== '.' && part !== '..');
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(mutation.id) || !path(mutation.file) || !path(mutation.testFile) || !mutation.from || typeof mutation.to !== 'string' || typeof mutation.testNamePattern !== 'string') throw new Error('Invalid mutation definition.');
}

/** Only allowlisted product files are copied; the live tree is never mutated. */
export async function runMutationChecks({ sourceRoot = defaultRoot, outputDirectory, mutations = MUTATIONS, timeoutMs = 15000 }) {
  sourceRoot = resolve(sourceRoot);
  outputDirectory = resolve(outputDirectory);
  if (outputDirectory === sourceRoot || outputDirectory.startsWith(sourceRoot + sep)) throw new Error('Mutation output must be outside the source tool directory.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000 || !Array.isArray(mutations) || mutations.length === 0 || mutations.length > 20) throw new Error('Mutation run exceeds its configured bounds.');
  mutations.forEach(validateMutation);
  if (new Set(mutations.map(mutation => mutation.id)).size !== mutations.length) throw new Error('Mutation IDs must be distinct.');
  await mkdir(outputDirectory, { mode: 0o700 });
  const baseline = join(outputDirectory, 'snapshot');
  const manifest = await snapshot(sourceRoot, baseline);
  const receipt = { schemaVersion: 1, kind: 'mutation-check', selection: 'scope-fixed-twenty-v5', seed: null, node: process.version, sourceFiles: manifest, sourceDigestBefore: manifestDigest(manifest), summary: { killed: 0, survived: 0, timeout: 0, invalid: 0, controlFailed: 0 }, mutations: [] };
  for (const mutation of mutations) {
    const work = join(outputDirectory, 'mutants', mutation.id);
    await snapshot(baseline, work);
    const temp = join(work, 'tmp');
    await mkdir(temp);
    const args = ['--test', '--test-reporter=tap', '--test-name-pattern=' + mutation.testNamePattern, mutation.testFile];
    const item = { id: mutation.id, file: mutation.file, testFile: mutation.testFile, testNamePattern: mutation.testNamePattern };
    async function record(name, args) {
      const run = await runNode(args, work, temp, timeoutMs);
      const { stdout, stderr, ...summary } = run;
      const pattern = new RegExp(mutation.testNamePattern, 'u');
      summary.matchedTests = [...stdout.matchAll(/^# Subtest: (.*)$/gmu)].filter(match => pattern.test(match[1])).length;
      await writeFile(join(work, name + '.tap'), stdout + stderr, { flag: 'wx', mode: 0o600 });
      item[name] = summary;
      return { ...run, matchedTests: summary.matchedTests };
    }
    const control = await record('control', args);
    if (control.status !== 0 || control.executed === 0 || control.matchedTests === 0 || control.passed === 0 || control.timedOut || control.outputLimit || control.launchError) {
      item.status = 'control-failed'; receipt.summary.controlFailed++;
    } else {
      try {
        const target = join(work, mutation.file);
        const changed = applyMutation(await readFile(target, 'utf8'), mutation);
        await writeFile(target, changed, { mode: 0o600 });
        const syntax = await record('syntax', ['--check', mutation.file]);
        if (syntax.status !== 0 || syntax.timedOut || syntax.outputLimit || syntax.launchError) throw new Error('Mutated source failed its syntax check.');
        const mutated = await record('mutated', args);
        if (mutated.timedOut) { item.status = 'timeout'; receipt.summary.timeout++; }
        else if (mutated.status === 0 && mutated.executed > 0 && mutated.matchedTests > 0 && mutated.passed > 0 && !mutated.outputLimit && !mutated.launchError) { item.status = 'survived'; receipt.summary.survived++; }
        else if (mutated.status !== 0 && mutated.matchedTests > 0 && mutated.failed > 0 && mutated.cancelled === 0 && !mutated.outputLimit && !mutated.launchError && mutated.stdout.includes('ERR_ASSERTION')) { item.status = 'killed'; receipt.summary.killed++; }
        else { item.status = 'invalid-run'; receipt.summary.invalid++; }
      } catch (error) {
        item.status = 'invalid-mutant'; item.diagnostic = error.message; receipt.summary.invalid++;
      }
    }
    receipt.mutations.push(item);
  }
  const after = await sourceManifest(sourceRoot);
  receipt.sourceDigestAfter = manifestDigest(after);
  receipt.sourceUnchanged = receipt.sourceDigestBefore === receipt.sourceDigestAfter;
  if (!receipt.sourceUnchanged) receipt.sourceFilesAfter = after;
  await writeFile(join(outputDirectory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values, positionals } = parseArgs({ options: { output: { type: 'string' }, only: { type: 'string' } }, strict: true, allowPositionals: true });
    if (positionals.length) throw new Error('Only --output and optional --only are accepted.');
    const mutations = values.only ? MUTATIONS.filter(mutation => mutation.id === values.only) : MUTATIONS;
    if (!mutations.length) throw new Error('Unknown mutation ID.');
    const outputDirectory = values.output || join(await mkdtemp(join(tmpdir(), 'scope-mutations-')), 'run');
    const receipt = await runMutationChecks({ outputDirectory, mutations });
    console.log(JSON.stringify({ outputDirectory: resolve(outputDirectory), summary: receipt.summary, mutations: receipt.mutations.map(({ id, status }) => ({ id, status })) }, null, 2));
    process.exitCode = receipt.summary.killed === mutations.length ? 0 : 1;
  } catch {
    console.error('Mutation check could not complete; use a new output directory outside the product tool.');
    process.exitCode = 2;
  }
}
