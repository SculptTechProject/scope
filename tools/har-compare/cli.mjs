#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { AnalysisError, fail, LIMITS, validateConfig } from './src/config.mjs';
import { parseHar, readJsonFile } from './src/input.mjs';
import { selectionCoverage } from './src/selection.mjs';
import { compareHar } from './src/compare.mjs';
import { jsonReport, htmlReport, writeReports } from './src/report.mjs';

const help = `Scope HAR compare (offline prototype)
Usage:
  node cli.mjs compare --baseline FILE --candidate FILE [--config FILE]
                      [--json NEW_FILE] [--html NEW_FILE]
  node cli.mjs doctor
  node cli.mjs --help

Analysis JSON is always written to stdout; --json also saves those exact bytes.
Only new output files are created. Paths are relative to the working directory.
Config: {"mode":"shape|strict","ignoreJsonPaths":["/timestamp"]}
Optional includeOperations: [{"method":"GET","origin":"https://api.example.invalid","path":"/users/7"}]
Exit: 0 no configured regression, 1 regression candidates, 2 invalid/incomplete analysis.
No network, auth, replay or model call. See README.md for matching/privacy limits.
`;
try {
  if (Number(process.versions.node.split('.')[0]) < 22) fail('RUNTIME', 'Node 22 or later is required; tested with 22.22.3.');
  let parsed;
  try {
    parsed = parseArgs({ options: { help: { type: 'boolean', short: 'h' }, baseline: { type: 'string' }, candidate: { type: 'string' }, config: { type: 'string' }, json: { type: 'string' }, html: { type: 'string' } }, allowPositionals: true, tokens: true });
  } catch { fail('ARGUMENT', 'Invalid arguments. Run --help for usage.'); }
  const { values, positionals, tokens } = parsed;
  if (tokens.filter(t => t.kind === 'option').some((t, i, all) => all.findIndex(x => x.name === t.name) !== i)) fail('ARGUMENT', 'Duplicate flags are not allowed.');
  if (values.help) { process.stdout.write(help); }
  else if (positionals.length === 1 && positionals[0] === 'doctor' && Object.keys(values).length === 0) {
    process.stdout.write(jsonReport({ schemaVersion: 1, tool: 'scope-har-compare', offline: true, authRequired: false, node: process.versions.node, limits: LIMITS }));
  } else {
    if (positionals.length !== 1 || positionals[0] !== 'compare' || !values.baseline || !values.candidate) fail('ARGUMENT', 'compare requires --baseline and --candidate. Run --help for usage.');
    const config = validateConfig(values.config ? await readJsonFile(values.config, LIMITS.configBytes, 'Config') : {});
    const baseline = parseHar(await readJsonFile(values.baseline, LIMITS.fileBytes, 'Baseline HAR'), config);
    const candidate = parseHar(await readJsonFile(values.candidate, LIMITS.fileBytes, 'Candidate HAR'), config);
    const coverage = selectionCoverage(baseline, candidate, config);
    const report = compareHar(baseline.entries, candidate.entries, config);
    if (coverage) report.coverage = coverage;
    const json = jsonReport(report);
    await writeReports([...(values.json ? [[values.json, json]] : []), ...(values.html ? [[values.html, htmlReport(report)]] : [])]);
    process.stdout.write(json);
    process.exitCode = report.summary.regressions ? 1 : 0;
  }
} catch (error) {
  const safe = error instanceof AnalysisError ? error : new AnalysisError('ANALYSIS', 'Analysis failed; no complete comparison is available.');
  process.stdout.write(jsonReport({ schemaVersion: 1, error: { code: safe.code, message: safe.message } }));
  process.exitCode = 2;
}
