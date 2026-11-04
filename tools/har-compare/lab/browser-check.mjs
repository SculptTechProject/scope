import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runNodeSync } from './process.mjs';
import { launchBrowser, launchLimitation } from './browser-runtime.mjs';

const lab = fileURLToPath(new URL('./', import.meta.url));
const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const probe = 'http://127.0.0.1:9/scope-lab-must-not-connect';
const payload = `</script><script>globalThis.scopeLabExecuted=true;fetch('${probe}').catch(()=>{})</script><img src="${probe}" onerror="globalThis.scopeLabExecuted=true"><iframe src="${probe}"></iframe>`;

/** Layout navigation is allowed only within this document, to an unambiguous target. */
export function assertLocalNavigation(links, ids) {
  assert.equal(new Set(ids).size, ids.length, 'generated report IDs must be unique');
  for (const link of links) {
    assert.equal(link.tag, 'A', 'only anchors may carry href');
    assert.match(link.href, /^#[A-Za-z0-9-]+$/u, 'href must be a local generated fragment');
    assert.equal(ids.filter(id => id === link.href.slice(1)).length, 1, 'local anchor must have one matching target');
  }
  return links.length;
}

async function observeDocument(browser, path) {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  const requests = [], errors = [], dialogs = [], popups = [];
  const target = pathToFileURL(path).href;
  await context.route('**/*', route => {
    if (route.request().url() === target && route.request().isNavigationRequest()) return route.continue();
    requests.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  await context.addInitScript(() => { globalThis.scopeLabExecuted = false; });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.name));
  page.on('dialog', dialog => { dialogs.push(dialog.type()); void dialog.dismiss(); });
  page.on('popup', popup => { popups.push('popup'); void popup.close(); });
  page.setDefaultTimeout(5000);
  await page.goto(target, { waitUntil: 'load', timeout: 5000 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return { context, page, requests, errors, dialogs, popups };
}

export async function runBrowserChecks(browser, output) {
  await mkdir(output, { recursive: true });
  const before = { log: { version: '1.2', entries: [{ request: { method: 'GET', url: 'http://127.0.0.1:9/api/synthetic?token=SYNTHETIC_QUERY_SECRET', headers: [{ name: 'Authorization', value: 'SYNTHETIC_HEADER_SECRET' }] }, response: { status: 200, content: { mimeType: 'application/json', text: JSON.stringify({ [payload]: 'SYNTHETIC_BODY_SECRET' }) } } }] } };
  const after = structuredClone(before); after.log.entries[0].response.content.text = '{}';
  await writeFile(join(output, 'hostile-baseline.har'), JSON.stringify(before), { flag: 'wx' });
  await writeFile(join(output, 'hostile-candidate.har'), JSON.stringify(after), { flag: 'wx' });
  const path = join(output, 'hostile-report.html');
  const run = runNodeSync([cli, 'compare', '--baseline', join(output, 'hostile-baseline.har'), '--candidate', join(output, 'hostile-candidate.har'), '--html', path]);
  assert.equal(run.status, 1, 'hostile field removal must produce a regression report');
  const controlPath = join(output, 'unsafe-detector-control.html');
  await writeFile(controlPath, '<!doctype html><meta charset="utf-8"><title>Synthetic detector control</title>' + payload, { flag: 'wx' });
  const control = await observeDocument(browser, controlPath);
  try {
    assert.equal(await control.page.evaluate(() => globalThis.scopeLabExecuted), true, 'positive control proves script execution detection works');
    assert.ok(control.requests.some(url => url.startsWith(probe)), 'positive control proves request interception observes attempted network');
  } finally { await control.context.close(); }
  const report = await observeDocument(browser, path);
  try {
    assert.equal(await report.page.evaluate(() => globalThis.scopeLabExecuted), false);
    assert.equal(await report.page.locator('script,iframe,img,object,embed,link,base,form,meta[http-equiv="refresh"]').count(), 0);
    assert.equal(await report.page.locator('[src],[srcset],[action],[formaction],[poster],[data],[ping],[background],[style]').count(), 0);
    const eventAttributes = await report.page.locator('*').evaluateAll(elements => elements.flatMap(element => [...element.attributes].filter(attribute => /^on/iu.test(attribute.name) || attribute.name === 'xlink:href').map(attribute => attribute.name)));
    assert.deepEqual(eventAttributes, []);
    const links = await report.page.locator('[href]').evaluateAll(elements => elements.map(element => ({ tag: element.tagName, href: element.getAttribute('href') })));
    const ids = await report.page.locator('[id]').evaluateAll(elements => elements.map(element => element.id));
    const localLinks = assertLocalNavigation(links, ids);
    assert.ok(localLinks >= 4, 'report section navigation must be present');
    assert.equal(await report.page.locator('article').count(), 1);
    const text = await report.page.locator('body').innerText();
    assert.ok(text.includes('<script>globalThis.scopeLabExecuted=true'));
    assert.doesNotMatch(text, /SYNTHETIC_(?:BODY|QUERY|HEADER)_SECRET/);
    assert.deepEqual(report.requests, []);
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.dialogs, []);
    assert.deepEqual(report.popups, []);
    const background = await report.page.locator('body').evaluate(element => getComputedStyle(element).backgroundColor);
    const rootBackground = await report.page.locator('html').evaluate(element => getComputedStyle(element).backgroundColor);
    assert.ok([background, rootBackground].includes('rgb(247, 250, 252)'), 'the exact hash-authorized report CSS must render');
    // Escaping removes executable nodes; independently exercise the report's CSP.
    const csp = await report.page.evaluate(async () => {
      globalThis.scopeCspProbeExecuted = false;
      const violations = [];
      const observe = event => violations.push(event.effectiveDirective);
      document.addEventListener('securitypolicyviolation', observe);
      const script = document.createElement('script');
      script.textContent = 'globalThis.scopeCspProbeExecuted = true';
      const style = document.createElement('style');
      style.textContent = '#scope-csp-probe { color: rgb(255, 0, 1) !important; }';
      const probe = document.createElement('span');
      probe.id = 'scope-csp-probe';
      document.body.append(script, style, probe);
      // Policy violation events are queued after rejected resource processing.
      await new Promise(resolve => setTimeout(resolve, 100));
      const result = { scriptExecuted: globalThis.scopeCspProbeExecuted, color: getComputedStyle(probe).color, violations };
      script.remove(); style.remove(); probe.remove();
      document.removeEventListener('securitypolicyviolation', observe);
      return result;
    });
    assert.equal(csp.scriptExecuted, false, 'CSP must block an injected inline script');
    assert.notEqual(csp.color, 'rgb(255, 0, 1)', 'CSP must block unhashed inline CSS');
    assert.ok(csp.violations.some(value => value.startsWith('script-src')), 'script policy enforcement must be observed');
    assert.ok(csp.violations.some(value => value.startsWith('style-src')), 'style policy enforcement must be observed');
    await report.page.screenshot({ path: join(output, 'hostile-report.png'), fullPage: true });
    await report.page.locator('details summary').click();
    assert.equal(await report.page.locator('details').getAttribute('open'), '');
    await report.page.screenshot({ path: join(output, 'hostile-report-expanded.png'), fullPage: true });
    return { status: 'passed', browserVersion: browser.version(), scriptExecution: false, attemptedNetworkRequests: 0, localLinks, detectorPositiveControl: { scriptExecution: true, attemptedNetworkDetected: true }, csp: { inlineScriptBlocked: true, unhashedStyleBlocked: true, authorizedStyleRendered: true }, screenshots: ['hostile-report.png', 'hostile-report-expanded.png'] };
  } finally { await report.context.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await mkdir(join(lab, 'output'), { recursive: true });
  const output = await mkdtemp(join(lab, 'output/browser-'));
  let browser;
  try {
    browser = await launchBrowser(process.argv[2] || 'chromium');
    const receipt = await runBrowserChecks(browser, output);
    await writeFile(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ output, ...receipt }, null, 2));
  } catch (error) {
    if (!browser) {
      const receipt = { status: 'blocked', ...launchLimitation(error), screenshots: [] };
      await writeFile(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
      console.log(JSON.stringify({ output, ...receipt }, null, 2));
      process.exitCode = 2;
    } else throw error;
  } finally { await browser?.close(); }
}
