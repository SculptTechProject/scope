import { spawnSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
/** Explicit form-query equivalence/separation cases, not random fuzzing. */
export const CASES = Object.freeze([
  ['binary-values', 'q=%FF', 'q=%FE', 1],
  ['binary-vs-replacement', 'q=%FF', 'q=%EF%BF%BD', 1],
  ['binary-names', '%FF=value', '%FE=value', 1],
  ['binary-name-vs-replacement', '%FF=value', '%EF%BF%BD=value', 1],
  ['different-invalid-sequences', 'q=%C0%AF', 'q=%FE%FF', 1],
  ['surrogate-encoded-bytes', 'q=%ED%A0%80', 'q=%FF%FF%FF', 1],
  ['truncated-utf8', 'q=%C2', 'q=%C3', 1],
  ['continuation-bytes', 'q=%80', 'q=%81', 1],
  ['binary-hex-case', 'q=%ff', 'q=%FF', 0],
  ['binary-name-order', '%FF=one&%FE=two', '%FE=two&%FF=one', 0],
  ['binary-duplicate-order', '%FF=one&%FF=two', '%FF=two&%FF=one', 1],
  ['decoded-name-aliases', 'a=one&%61=two', '%61=one&a=two', 0],
  ['decoded-name-duplicate-order', 'a=one&%61=two', '%61=two&a=one', 1],
  ['form-space-equivalence', 'q=a+b', 'q=a%20b', 0],
  ['encoded-plus-vs-space', 'q=%2B', 'q=+', 1],
  ['one-decode-only', 'q=%252F', 'q=%2F', 1],
  ['one-decode-retains-case', 'q=%252F', 'q=%252f', 1],
  ['decoded-hex-case', 'q=%2f', 'q=%2F', 0],
  ['literal-percent', 'q=%', 'q=%25', 0],
  ['truncated-percent', 'q=%2', 'q=%252', 0],
  ['invalid-percent', 'q=%GG', 'q=%25GG', 0],
  ['invalid-percent-case-is-data', 'q=%GG', 'q=%gg', 1],
  ['blank-value', 'a', 'a=', 0],
  ['empty-pairs', '&&a=1&&', 'a=1', 0],
  ['empty-name', '=one', '=two', 1],
  ['first-equals-only', 'a=1=2', 'a=1%3D2', 0],
  ['encoded-nul', 'q=%00', 'q=', 1],
  ['unicode-utf8-equivalence', 'q=é', 'q=%C3%A9', 0],
  ['unicode-not-normalized', 'q=é', 'q=e%CC%81', 1],
  ['replacement-is-valid-unicode', 'q=�', 'q=%EF%BF%BD', 0],
  ['name-order', 'z=3&a=1&b=2', 'b=2&z=3&a=1', 0],
  ['unicode-name-order', '🦊=3&é=2&a=1', 'a=1&🦊=3&é=2', 0],
  ['bom-name-order', '%EF%BB%BFa=one&a=two', 'a=two&%EF%BB%BFa=one', 0],
  ['bom-empty-name-order', '%EF%BB%BF=one&=two', '=two&%EF%BB%BF=one', 0],
  ['bom-value-is-data', 'q=%EF%BB%BFvalue', 'q=value', 1],
  ['unicode-duplicate-order', 'é=one&%C3%A9=two', '%C3%A9=two&é=one', 1],
  ['binary-value-order', 'a=%FF&b=%FE', 'b=%FE&a=%FF', 0],
  ['lone-high-surrogate', 'q=\ud800', 'q=\ud801', 2],
  ['lone-low-surrogate', 'q=\udc00', 'q=\udc01', 2],
].map(([name, baseline, candidate, expected]) => Object.freeze({ name, baseline, candidate, expected })));

async function manifest(root) {
  const paths = ['cli.mjs'];
  for (const directory of ['src', 'contracts', 'json', 'formats']) {
    for (const file of (await readdir(join(root, directory))).sort()) {
      if (/^[a-z][a-z0-9-]*\.mjs$/u.test(file) && !file.endsWith('.test.mjs')) paths.push(directory + '/' + file);
    }
  }
  const files = [];
  for (const path of paths.sort()) {
    const bytes = await readFile(join(root, path));
    if (bytes.length > 1024 * 1024) throw new Error('Corpus source exceeds per-file bounds.');
    files.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return { files, digest: createHash('sha256').update(JSON.stringify(files)).digest('hex') };
}

/** Execute only the offline CLI against synthetic captures; do not mutate source. */
export async function runQueryCorpus({ sourceRoot = defaultRoot, outputDirectory }) {
  sourceRoot = resolve(sourceRoot);
  outputDirectory = resolve(outputDirectory);
  if (outputDirectory === sourceRoot || outputDirectory.startsWith(sourceRoot + sep)) throw new Error('Corpus output must be outside the product tool.');
  const before = await manifest(sourceRoot);
  await mkdir(outputDirectory, { mode: 0o700 });
  const config = join(outputDirectory, 'strict.json');
  await writeFile(config, '{"mode":"strict"}\n', { flag: 'wx', mode: 0o600 });
  const receipt = { schemaVersion: 1, kind: 'lossless-form-query-corpus', node: process.version, sourceFiles: before.files, sourceDigestBefore: before.digest, cases: [], summary: { passed: 0, failed: 0, total: CASES.length } };
  const entry = query => ({ request: { method: 'GET', url: 'https://api.example.invalid/x?' + query, headers: [{ name: 'Authorization', value: 'SYNTHETIC_HEADER_SECRET' }] }, response: { status: 200, content: { mimeType: 'application/json', text: '{"value":"SYNTHETIC_BODY_SECRET"}' } } });
  function run(args) {
    const result = spawnSync(process.execPath, [join(sourceRoot, 'cli.mjs'), ...args], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', TMPDIR: '/tmp', LC_ALL: 'C.UTF-8' }, timeout: 5000, maxBuffer: 1024 * 1024 });
    let report;
    try { report = JSON.parse(result.stdout); } catch {}
    return { status: result.status, error: result.error?.code, report, stdout: result.stdout, stderr: result.stderr };
  }
  for (const item of CASES) {
    const baseline = join(outputDirectory, item.name + '-baseline.har'), candidate = join(outputDirectory, item.name + '-candidate.har'), both = join(outputDirectory, item.name + '-both.har');
    for (const [path, entries] of [[baseline, [entry(item.baseline)]], [candidate, [entry(item.candidate)]], [both, [entry(item.baseline), entry(item.candidate)]]]) await writeFile(path, JSON.stringify({ log: { entries } }), { flag: 'wx', mode: 0o600 });
    const compared = run(['compare', '--baseline', baseline, '--candidate', candidate, '--config', config]);
    const inspected = run(['inspect', '--input', both]);
    const expectedInspect = item.expected === 2 ? 2 : 0;
    const queryVariants = inspected.report?.operations?.[0]?.queryVariants;
    const privateDataOmitted = !/SYNTHETIC_HEADER_SECRET|SYNTHETIC_BODY_SECRET/.test(compared.stdout + compared.stderr + inspected.stdout + inspected.stderr);
    const passed = !compared.error && !inspected.error && compared.status === item.expected && inspected.status === expectedInspect && (item.expected === 2 || queryVariants === (item.expected === 0 ? 1 : 2)) && privateDataOmitted;
    const result = { name: item.name, expectedCompare: item.expected, compared: { status: compared.status, ...(compared.error ? { launchError: compared.error } : {}), ...(compared.report?.error ? { analysisError: compared.report.error.code } : {}), regressions: compared.report?.summary?.regressions }, expectedInspect, inspected: { status: inspected.status, queryVariants, ...(inspected.error ? { launchError: inspected.error } : {}), ...(inspected.report?.error ? { analysisError: inspected.report.error.code } : {}) }, privateDataOmitted, passed };
    await writeFile(join(outputDirectory, item.name + '-compare.json'), compared.stdout, { flag: 'wx', mode: 0o600 });
    await writeFile(join(outputDirectory, item.name + '-inspect.json'), inspected.stdout, { flag: 'wx', mode: 0o600 });
    receipt.cases.push(result);
    receipt.summary[passed ? 'passed' : 'failed']++;
  }
  const after = await manifest(sourceRoot);
  receipt.sourceDigestAfter = after.digest;
  receipt.sourceUnchanged = before.digest === after.digest;
  if (!receipt.sourceUnchanged) receipt.sourceFilesAfter = after.files;
  await writeFile(join(outputDirectory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { source: { type: 'string' }, output: { type: 'string' } }, strict: true });
    if (!values.output) throw new Error('An output directory is required.');
    const receipt = await runQueryCorpus({ sourceRoot: values.source, outputDirectory: values.output });
    console.log(JSON.stringify({ summary: receipt.summary, sourceUnchanged: receipt.sourceUnchanged, failedCases: receipt.cases.filter(item => !item.passed).map(item => item.name) }, null, 2));
    process.exitCode = receipt.summary.failed ? 1 : 0;
  } catch { console.error('Query corpus could not complete; use a new output directory outside the source tool.'); process.exitCode = 2; }
}
