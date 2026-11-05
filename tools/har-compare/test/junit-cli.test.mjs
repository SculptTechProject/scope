import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
function run(t,candidate='missing-field.har',extra=[]){
 const dir=mkdtempSync(join(tmpdir(),'scope-junit-cli-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const args=[join(root,'cli.mjs'),'compare','--baseline',join(root,'examples/fixtures/baseline.har'),'--candidate',join(root,'examples/fixtures',candidate),'--junit',join(dir,'report.xml'),...extra.map(a=>a.replaceAll('$DIR',dir))];
 const r=spawnSync(process.execPath,args,{encoding:'utf8',timeout:5000});return {...r,data:JSON.parse(r.stdout),dir,xml:existsSync(join(dir,'report.xml'))?readFileSync(join(dir,'report.xml'),'utf8'):undefined};
}
test('JUnit output preserves regression exit1 and emits failure evidence',t=>{
 const r=run(t);assert.equal(r.status,1);assert.match(r.xml,/<failure/);assert.match(r.xml,/field-removed/);assert.match(r.xml,/baseline entry: 1/);
});
test('JUnit clean output preserves exit0 and has no failures',t=>{
 const r=run(t,'baseline.har');assert.equal(r.status,0);assert.match(r.xml,/failures="0"/);assert.doesNotMatch(r.xml,/<failure\b/);
});
test('JUnit and JSON cannot overwrite each other',t=>{
 const r=run(t,'baseline.har',['--json','$DIR/report.xml']);assert.equal(r.status,2);assert.equal(r.xml,undefined);
});
test('analysis errors never produce misleading JUnit success files',t=>{
 const r=run(t,'baseline.har',['--config','$DIR/missing-config.json']);assert.equal(r.status,2);assert.equal(r.xml,undefined);
});
