import { mkdir, mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNodeSync } from './process.mjs';
import { runNodeDemo } from './run-node-demo.mjs';
import { runSeededChecks } from './run-seeded-checks.mjs';
import { runContractChecks } from './run-contract-checks.mjs';
import { runBoundaryChecks } from './run-boundary-checks.mjs';
import { runOutputChecks } from './run-output-checks.mjs';
import { runPayloadChecks } from './run-payload-checks.mjs';
import { snapshotProductSources } from './source-snapshot.mjs';
import { launchBrowser, launchLimitation } from './browser-runtime.mjs';
import { runBrowserChecks } from './browser-check.mjs';

const lab = fileURLToPath(new URL('./', import.meta.url));
const product = fileURLToPath(new URL('../', import.meta.url));
await mkdir(join(lab, 'output'), { recursive: true });
const output = await mkdtemp(join(lab, 'output/verify-'));
const receipt = { schemaVersion: 1, checkedAt: new Date().toISOString(), nodeVersion: process.version, playwrightVersion: JSON.parse(await readFile(new URL('./node_modules/playwright/package.json', import.meta.url))).version, output, productSource: {}, fixtureTests: {}, localhostDemo: {}, seededChecks: {}, authoredContracts: {}, jsonAndScopeBoundaries: {}, reportOutputs: {}, hostilePayloads: {}, browser: {} };
let browser;
try {
  receipt.productSource.before = await snapshotProductSources(product);
  const tests = (await readdir(join(lab, 'test'))).filter(name => name.endsWith('.test.mjs')).sort().map(name => join(lab, 'test', name));
  const test = runNodeSync(['--test', ...tests], { timeout: 30000 });
  receipt.fixtureTests = { status: test.status === 0 ? 'passed' : 'failed', exit: test.status };
  await writeFile(join(output, 'fixture-tests.tap'), test.stdout + test.stderr, { flag: 'wx' });
  if (test.status !== 0) throw new Error('Local fixture integration tests failed; inspect fixture-tests.tap.');
  const demo = await runNodeDemo(join(output, 'localhost-demo'));
  receipt.localhostDemo = { status: 'passed', cases: demo.cases.length, captureRequests: demo.captureRequests, cliNetworkRequestsObservedAtFixture: demo.cliNetworkRequestsObservedAtFixture, receipt: join(output, 'localhost-demo/node-demo-receipt.json') };
  const seeded = await runSeededChecks(join(output, 'seeded'));
  receipt.seededChecks = { status: 'passed', seedRange: seeded.seedRange, cases: seeded.cases.length, captureRequests: seeded.captureRequests, cliNetworkRequestsObservedAtFixture: seeded.cliNetworkRequestsObservedAtFixture, receipt: join(output, 'seeded/seeded-receipt.json') };
  const contracts = await runContractChecks(join(output, 'contracts'));
  receipt.authoredContracts = { status: 'passed', cases: contracts.cases.length, captureRequests: contracts.captureRequests, independentXmlParser: contracts.independentXmlParser, cliNetworkRequestsObservedAtFixture: contracts.cliNetworkRequestsObservedAtFixture, receipt: join(output, 'contracts/contracts-receipt.json') };
  const boundaries = await runBoundaryChecks(join(output, 'boundaries'));
  receipt.jsonAndScopeBoundaries = { status: 'passed', cases: boundaries.cases.length, captureRequests: boundaries.captureRequests, independentXmlParser: boundaries.independentXmlParser, cliNetworkRequestsObservedAtFixture: boundaries.cliNetworkRequestsObservedAtFixture, offlineRepeats: boundaries.offlineRepeats, receipt: join(output, 'boundaries/boundary-receipt.json') };
  const outputs = await runOutputChecks(join(output, 'artifacts'));
  receipt.reportOutputs = { status: 'passed', cases: outputs.cases.length, captureRequests: outputs.captureRequests, independentXmlParser: outputs.independentXmlParser, cliNetworkRequestsObservedAtFixture: outputs.cliNetworkRequestsObservedAtFixture, receipt: join(output, 'artifacts/output-receipt.json') };
  const payloads = await runPayloadChecks(join(output, 'payloads'));
  receipt.hostilePayloads = { status: 'passed', cases: payloads.cases.length, payloadCount: payloads.payloads.length, captureRequests: payloads.captureRequests, independentXmlParser: payloads.independentXmlParser, cliNetworkRequestsObservedAtFixture: payloads.cliNetworkRequestsObservedAtFixture, browserExecutionVerified: false, receipt: join(output, 'payloads/payload-receipt.json') };
  try { browser = await launchBrowser(process.argv[2] || 'chromium'); }
  catch (error) { receipt.browser = { status: 'blocked', ...launchLimitation(error), screenshots: [] }; }
  if (browser) receipt.browser = await runBrowserChecks(browser, join(output, 'browser'));
  receipt.status = receipt.browser.status === 'passed' ? 'passed' : 'partial';
  process.exitCode = receipt.status === 'passed' ? 0 : 2;
} catch (error) {
  receipt.status = 'failed'; receipt.failure = error.message; process.exitCode = 1;
} finally {
  await browser?.close();
  try {
    receipt.productSource.after = await snapshotProductSources(product);
    receipt.productSource.unchanged = receipt.productSource.before?.sha256 === receipt.productSource.after.sha256;
    if (receipt.productSource.before && !receipt.productSource.unchanged) {
      receipt.productSource.warning = 'Product source changed during verification; repeat against a stable source snapshot.';
      if (receipt.status !== 'failed') { receipt.status = 'inconclusive'; receipt.failure = receipt.productSource.warning; }
      process.exitCode = 1;
    }
  } catch {
    receipt.status = 'failed'; receipt.productSource.failure = 'Product source provenance could not be checked.';
    receipt.failure ??= receipt.productSource.failure; process.exitCode = 1;
  }
  await writeFile(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(receipt, null, 2));
}
