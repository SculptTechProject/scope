import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixture, scenarios } from './fixture.mjs';
import { launchBrowser, launchLimitation } from './browser-runtime.mjs';

const lab = fileURLToPath(new URL('./', import.meta.url));
await mkdir(join(lab, 'output'), { recursive: true });
const output = await mkdtemp(join(lab, 'output/browser-capture-'));
let browser, fixture;
try {
  browser = await launchBrowser(process.argv[2] || 'chromium');
  fixture = await startFixture();
  for (const scenario of scenarios) {
    const blocked = [];
    const context = await browser.newContext({ serviceWorkers: 'block', recordHar: { path: join(output, scenario + '.har'), mode: 'full', content: 'embed' } });
    try {
      await context.route('**/*', route => {
        if (new URL(route.request().url()).origin === fixture.origin) return route.continue();
        blocked.push('non-loopback request');
        return route.abort('blockedbyclient');
      });
      const page = await context.newPage();
      await page.goto(fixture.origin + '/scenario/' + scenario, { waitUntil: 'load', timeout: 5000 });
      await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 5000 });
      if (blocked.length) throw new Error('Synthetic fixture attempted a request outside its own loopback origin.');
      await page.screenshot({ path: join(output, scenario + '.png'), fullPage: true });
    } finally { await context.close(); }
  }
  await writeFile(join(output, 'select-api.json'), JSON.stringify({ includeOperations: [{ method: 'GET', origin: fixture.origin, path: '/api/user' }] }, null, 2) + '\n', { flag: 'wx' });
  const receipt = { status: 'passed', source: 'Playwright full HAR from actual browser HTTP traffic', browserVersion: browser.version(), origin: fixture.origin, scenarios };
  await writeFile(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ output, ...receipt }, null, 2));
} catch (error) {
  if (!browser) {
    const receipt = { status: 'blocked', ...launchLimitation(error), screenshots: [] };
    await writeFile(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ output, ...receipt }, null, 2)); process.exitCode = 2;
  } else throw error;
} finally { await fixture?.close(); await browser?.close(); }
