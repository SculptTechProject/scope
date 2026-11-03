import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const cli=fileURLToPath(new URL('../cli.mjs',import.meta.url));
function run(t,left,right,command='compare'){
 const dir=mkdtempSync(join(tmpdir(),'scope-query-id-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const entry=url=>({request:{method:'GET',url:'https://api.example.invalid'+url},response:{status:200,content:{mimeType:'application/json',text:'{}'}}});
 const a=join(dir,'a.har'),b=join(dir,'b.har');writeFileSync(a,JSON.stringify({log:{entries:left.map(entry)}}));writeFileSync(b,JSON.stringify({log:{entries:right.map(entry)}}));
 const args=command==='inspect'?['inspect','--input',a]:['compare','--baseline',a,'--candidate',b];
 const r=spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:5000});return {...r,data:JSON.parse(r.stdout)};
}
for(const [a,b]of[['/x?token=%FF','/x?token=%FE'],['/x?%C0%AF=a','/x?%FE%FF=a'],['/x?token=%C0%AF','/x?token=%FE%FF']])test('lossless query matching distinguishes non-UTF8 octets '+a,t=>{
 const r=run(t,[a],[b]);assert.equal(r.status,1);assert.deepEqual(r.data.findings.map(f=>f.kind).sort(),['operation-added','operation-removed']);assert.doesNotMatch(r.stdout,/%FF|%FE|%C0|token/);
});
test('inspect counts distinct binary query variants without revealing bytes',t=>{
 const r=run(t,['/x?token=%FF','/x?token=%FE'],[],'inspect');assert.equal(r.status,0);assert.equal(r.data.operations[0].queryVariants,2);assert.doesNotMatch(r.stdout,/%FF|%FE|token/);
});
for(const url of ['/\ud800','/x?token=\ud801'])test('unpaired URL surrogate fails before lossy WHATWG conversion '+JSON.stringify(url),t=>{
 const r=run(t,[url],[url]);assert.equal(r.status,2);assert.equal(r.data.error.code,'HAR');
});
test('query canonicalization keeps form equivalents, stable duplicate order and one decoding pass',t=>{
 assert.equal(run(t,['/x?b=two+words&a=%41'],['/x?a=A&b=two%20words']).status,0);
 assert.equal(run(t,['/x?a=1&a=2'],['/x?a=2&a=1']).status,1);
 assert.equal(run(t,['/x?a=%252F'],['/x?a=%2F']).status,1);
 assert.equal(run(t,['/x?%FF=b&a=1'],['/x?a=1&%ff=b']).status,0);
});

test('query-name BOM is data and does not collapse stable sort order',t=>{
 assert.equal(run(t,['/x?%EF%BB%BFa=1&a=2'],['/x?a=2&%EF%BB%BFa=1']).status,0);
});
