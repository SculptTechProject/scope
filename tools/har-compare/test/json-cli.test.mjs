import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
function run(t, body, configText = '{"mode":"strict"}', rawHar) {
 const dir = mkdtempSync(join(tmpdir(),'scope-json-cli-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const capture={log:{entries:[{request:{method:'GET',url:'https://api.example.invalid/x'},response:{status:200,content:{mimeType:'application/json',text:body}}}]}};
 const input=join(dir,'capture.har'),config=join(dir,'config.json');writeFileSync(input,rawHar??JSON.stringify(capture));writeFileSync(config,configText);
 const r=spawnSync(process.execPath,[cli,'compare','--baseline',input,'--candidate',input,'--config',config],{encoding:'utf8',timeout:5000});return {...r,data:JSON.parse(r.stdout)};
}
for(const body of ['{"a":1,"a":2}','{"a":1,"\\u0061":2}','{"value":1.0000000000000001}','{"value":1e-324}','{"value":9007199254740990.9}'])test('strict JSON rejects ambiguous/rounded selected body '+body,t=>{
 const r=run(t,body);assert.equal(r.status,2);assert.ok(['JSON','NUMBER'].includes(r.data.error.code));assert.doesNotMatch(r.stdout,/"value"|"a"/);
});
test('duplicate config and envelope fields fail with safe JSON diagnostics',t=>{
 assert.equal(run(t,'{}','{"mode":"shape","mode":"strict"}').status,2);
 assert.equal(run(t,'{}',undefined,'{"log":{"entries":[]},"log":{"entries":[]}}').status,2);
});
test('ordinary decimal equivalent spellings and independent object names remain valid',t=>{
 assert.equal(run(t,'{"a":0.1,"nested":{"a":1.00},"other":1000e-3}').status,0);
});
