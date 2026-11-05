import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const cli=fileURLToPath(new URL('../cli.mjs',import.meta.url));
function setup(t){
 const dir=mkdtempSync(join(tmpdir(),'scope-labels-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const selector={method:'METHOD_SECRET',origin:'https://api.example.invalid',path:'/URL_SECRET'};
 const item=value=>({request:{method:selector.method,url:'https://USER_SECRET:PASS_SECRET@api.example.invalid/URL_SECRET?token=QUERY_SECRET',headers:[{name:'Authorization',value:'HEADER_SECRET'}]},response:{status:200,content:{mimeType:'application/json',text:JSON.stringify({FIELD_SECRET:value})}},_scope:{completed:true,provenance:'upstream',edited:false,appliedRules:['RULE_SECRET']}});
 writeFileSync(join(dir,'a.har'),JSON.stringify({log:{entries:[item('BODY_SECRET')]}}));writeFileSync(join(dir,'b.har'),JSON.stringify({log:{entries:[item(2)]}}));
 writeFileSync(join(dir,'config.json'),JSON.stringify({mode:'strict',includeOperations:[selector],ignoreJsonPaths:['/FIELD_SECRET'],contracts:[{...selector,requiredJson:[{pointer:'/FIELD_SECRET',type:'string'}]}]}));
 const run=(labels,out)=>spawnSync(process.execPath,[cli,'compare','--baseline',join(dir,'a.har'),'--candidate',join(dir,'b.har'),'--config',join(dir,'config.json'),...(labels?['--labels',labels]:[]),...(out?['--json',join(dir,'report.json'),'--html',join(dir,'report.html'),'--junit',join(dir,'report.xml')]:[])],{encoding:'utf8',timeout:5000});
 return {dir,run};
}
test('ids labels omit captured and configured names across stdout JSON HTML JUnit',t=>{
 const {dir,run}=setup(t);const r=run('ids',true);assert.equal(r.status,1);const report=JSON.parse(r.stdout);
 assert.equal(report.privacy.labels,'ids');assert.equal(report.summary.regressions,1);assert.equal(report.contracts.checks,1);
 assert.equal(report.operations[0].id,'operation-0001');assert.equal(report.operations[0].origin,undefined);assert.equal(report.operations[0].method,undefined);assert.equal(report.findings[0].path,undefined);assert.equal(report.config.contracts,undefined);assert.equal(report.config.redacted,true);
 assert.deepEqual(report.findings[0].evidence,{baselineEntry:1,candidateEntry:1});
 const artifacts=[r.stdout,...['json','html','xml'].map(ext=>readFileSync(join(dir,'report.'+ext),'utf8'))].join('\n');
 for(const secret of ['METHOD_SECRET','URL_SECRET','FIELD_SECRET','USER_SECRET','PASS_SECRET','QUERY_SECRET','HEADER_SECRET','BODY_SECRET','RULE_SECRET'])assert.ok(!artifacts.includes(secret),secret);
 assert.match(readFileSync(join(dir,'report.html'),'utf8'),/Captured labels omitted/);
 assert.equal(readFileSync(join(dir,'report.json'),'utf8'),r.stdout);
});
test('ids output keeps semantics while readable default really contains useful labels',t=>{
 const {run}=setup(t),readable=run(),explicit=run('readable'),ids=run('ids');
 assert.equal(readable.status,1);assert.equal(readable.stdout,explicit.stdout);assert.match(readable.stdout,/METHOD_SECRET/);assert.match(readable.stdout,/FIELD_SECRET/);
 assert.deepEqual(JSON.parse(readable.stdout).summary,JSON.parse(ids.stdout).summary);assert.equal(JSON.parse(ids.stdout).findings[0].kind,'contract-json-type');
 assert.equal(run('unexpected').status,2);
});
test('ids clean output remains deterministic and read-only discovery rejects irrelevant flag',t=>{
 const dir=mkdtempSync(join(tmpdir(),'scope-labels-clean-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const input=join(dir,'empty.har');writeFileSync(input,'{"log":{"entries":[]}}');
 const call=args=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:5000});
 const args=['compare','--baseline',input,'--candidate',input,'--labels','ids'];const a=call(args),b=call(args);assert.equal(a.status,0);assert.equal(a.stdout,b.stdout);assert.equal(JSON.parse(a.stdout).privacy.labels,'ids');assert.equal(call(['inspect','--input',input,'--labels','ids']).status,2);
});

test('ids authored status failure explains hidden policy without implying a baseline status',t=>{
 const {dir,run}=setup(t),path=join(dir,'config.json'),config=JSON.parse(readFileSync(path,'utf8'));
 config.contracts=[{...config.includeOperations[0],allowedStatuses:[201]}];writeFileSync(path,JSON.stringify(config));
 const r=run('ids',true);assert.equal(r.status,1);const html=readFileSync(join(dir,'report.html'),'utf8');assert.match(html,/Configured status list omitted/);assert.doesNotMatch(html,/unasserted/);
});
