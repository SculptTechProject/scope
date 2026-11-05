import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const cli=fileURLToPath(new URL('../cli.mjs',import.meta.url));
function run(t,bytes,base64,method='GET',status=200){
 const dir=mkdtempSync(join(tmpdir(),'scope-encoding-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const content={mimeType:'application/json',size:bytes.length,text:base64?bytes.toString('base64'):bytes.toString('utf8'),...(base64?{encoding:'base64'}:{})};
 const input=join(dir,'capture.har');writeFileSync(input,JSON.stringify({log:{entries:[{request:{method,url:'https://api.example.invalid/x'},response:{status,content}}]}}));
 const r=spawnSync(process.execPath,[cli,'compare','--baseline',input,'--candidate',input],{encoding:'utf8',timeout:10000});return {...r,data:JSON.parse(r.stdout)};
}
test('one document BOM has identical plain/base64 JSON interpretation',t=>{
 const bytes=Buffer.from('\uFEFF{"ok":true}');for(const base64 of [false,true])assert.equal(run(t,bytes,base64).status,0);
});
test('multiple document BOMs are rejected consistently',t=>{
 for(const base64 of [false,true])assert.equal(run(t,Buffer.from('\uFEFF\uFEFF{}'),base64).status,2);
});
test('BOM bytes are not an empty HEAD or204 body',t=>{
 for(const [method,status]of [['HEAD',200],['GET',204]])for(const base64 of [false,true]){const r=run(t,Buffer.from('\uFEFF'),base64,method,status);assert.equal(r.status,2);assert.equal(r.data.error.code,'BODY');}
});
test('decoded body byte limit counts document BOM before text normalization',t=>{
 for(const length of [1048577,1048578]){const bytes=Buffer.from('\uFEFF"'+'x'.repeat(length-5)+'"');assert.equal(bytes.length,length);for(const base64 of [false,true]){const r=run(t,bytes,base64);assert.equal(r.status,2);assert.equal(r.data.error.code,'LIMIT');}}
});
test('exact byte boundary and interior BOM data remain supported',t=>{
 const bytes=Buffer.from('\uFEFF"'+'x'.repeat(1048576-5)+'"');for(const base64 of [false,true])assert.equal(run(t,bytes,base64).status,0);
 for(const base64 of [false,true])assert.equal(run(t,Buffer.from('{"\uFEFFkey":"\uFEFFvalue"}'),base64).status,0);
});
