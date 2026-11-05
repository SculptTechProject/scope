import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const selector = { method: 'GET', origin: 'https://api.example.invalid', path: '/users/7' };
const entry = (body = {}, status = 200) => ({ request: { method: 'GET', url: selector.origin + selector.path }, response: { status, content: { mimeType: 'application/json', text: JSON.stringify(body) } } });
function run(t, a, b, config, html = false) {
  const dir = mkdtempSync(join(tmpdir(), 'scope-contract-cli-'));
  t.after(() => rmSync(dir, { force: true, recursive: true }));
  const paths = ['a.har','b.har','config.json'].map(p => join(dir,p));
  writeFileSync(paths[0], JSON.stringify({ log: { entries: a } }));
  writeFileSync(paths[1], JSON.stringify({ log: { entries: b } }));
  writeFileSync(paths[2], JSON.stringify(config));
  const r = spawnSync(process.execPath, [cli,'compare','--baseline',paths[0],'--candidate',paths[1],'--config',paths[2], ...(html ? ['--html',join(dir,'report.html')] : [])], { encoding:'utf8',timeout:5000 });
  return { ...r,data:r.stdout?JSON.parse(r.stdout):null,html:html&&r.status!==2?readFileSync(join(dir,'report.html'),'utf8'):undefined };
}
test('authored status contract fails unchanged HTTP500 that comparison alone permits', t => {
  const r = run(t,[entry({},500)],[entry({},500)],{contracts:[{...selector,allowedStatuses:[200]}]},true);
  assert.equal(r.status,1); assert.equal(r.data.contracts.checks,1); assert.equal(r.data.contracts.regressions,1);
  assert.equal(r.data.findings[0].kind,'contract-status'); assert.equal(r.data.findings[0].source,'authored-contract');
  assert.deepEqual(r.data.findings[0].evidence,{baselineEntry:1,candidateEntry:1});
  assert.doesNotMatch(r.html,/undefined/); assert.match(r.html,/Authored assertions/);
});
test('authored JSON requirement can fail a field absent from both observations',t=>{
  const r=run(t,[entry({})],[entry({})],{contracts:[{...selector,requiredJson:[{pointer:'/user/id',type:'string'}]}]});
  assert.equal(r.status,1); assert.equal(r.data.findings[0].kind,'contract-json-missing'); assert.equal(r.data.findings[0].path,'/user/id');
});
test('authored checks are independent of JSON noise ignores',t=>{
  const r=run(t,[entry({id:1})],[entry({id:2})],{mode:'strict',ignoreJsonPaths:['/id'],contracts:[{...selector,requiredJson:[{pointer:'/id',type:'string'}]}]});
  assert.equal(r.status,1); assert.equal(r.data.summary.ignoredNodes,1); assert.equal(r.data.findings[0].kind,'contract-json-type');
});
test('passing authored contract preserves successful exit and reports executed checks',t=>{
  const r=run(t,[entry({id:'synthetic'})],[entry({id:'synthetic'})],{contracts:[{...selector,allowedStatuses:[200],requiredJson:[{pointer:'/id',type:'string'}]}]});
  assert.equal(r.status,0); assert.equal(r.data.contracts.checks,2); assert.equal(r.data.contracts.regressions,0); assert.equal(r.data.findings.length,0);
});
test('authored rule never escapes selected scope and typos fail closed',t=>{
  const r=run(t,[entry()],[entry()],{contracts:[{...selector,path:'/typo',allowedStatuses:[200]}]});
  assert.equal(r.status,2); assert.equal(r.data.error.code,'CONTRACT_UNUSED');
});
test('authored required operation removal is a finding with baseline evidence',t=>{
  const r=run(t,[entry()],[],{contracts:[{...selector,allowedStatuses:[200]}]});
  assert.equal(r.status,1); assert.ok(r.data.findings.some(f=>f.kind==='contract-operation-missing'));
  assert.equal(r.data.contracts.regressions,1);
});
