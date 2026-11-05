import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const cli=fileURLToPath(new URL('../cli.mjs',import.meta.url));
const selector={method:'GET',origin:'https://api.example.invalid',path:'/health'};
const ignore={...selector,pointers:['/timestamp']};
function entry(path,value,status=200){return {request:{method:'GET',url:selector.origin+path},response:{status,content:{mimeType:'application/json',text:JSON.stringify(value)}}};}
function run(t,a,b,config){const dir=mkdtempSync(join(tmpdir(),'scope-scoped-ignore-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));for(const [name,value]of[['a.har',{log:{entries:a}}],['b.har',{log:{entries:b}}],['config.json',config]])writeFileSync(join(dir,name),JSON.stringify(value));const r=spawnSync(process.execPath,[cli,'compare','--baseline',join(dir,'a.har'),'--candidate',join(dir,'b.har'),'--config',join(dir,'config.json')],{encoding:'utf8',timeout:5000});return {...r,data:JSON.parse(r.stdout)};}
test('scoped ignore at health cannot conceal same pointer at billing',t=>{
 const a=[entry('/health',{timestamp:1}),entry('/billing',{timestamp:1})],b=[entry('/health',{timestamp:2}),entry('/billing',{timestamp:2})];
 const r=run(t,a,b,{mode:'strict',scopedIgnores:[ignore]});assert.equal(r.status,1);assert.equal(r.data.findings.length,1);assert.equal(r.data.operations.find(o=>o.id===r.data.findings[0].operation).path,'/billing');assert.equal(r.data.summary.scopedIgnoredNodes,1);
});
test('scoped pointer must match within its own operation',t=>{
 const a=[entry('/health',{}),entry('/billing',{timestamp:1})];const r=run(t,a,a,{mode:'strict',scopedIgnores:[ignore]});assert.equal(r.status,2);assert.equal(r.data.error.code,'IGNORE_UNUSED');
});
test('scoped ignore never suppresses HTTP or authored contract checks',t=>{
 const r=run(t,[entry('/health',{timestamp:1})],[entry('/health',{timestamp:2},500)],{mode:'strict',scopedIgnores:[ignore],contracts:[{...selector,allowedStatuses:[200]}]});assert.equal(r.status,1);assert.ok(r.data.findings.some(f=>f.kind==='http-failure'));assert.ok(r.data.findings.some(f=>f.kind==='contract-status'));
});
test('scoped ignores cover all exact query variants and retain strict negative control',t=>{
 const a=[entry('/health?a=1',{timestamp:1}),entry('/health?a=2',{timestamp:1})],b=[entry('/health?a=1',{timestamp:2}),entry('/health?a=2',{timestamp:2})];
 const r=run(t,a,b,{mode:'strict',scopedIgnores:[ignore]});assert.equal(r.status,0);assert.equal(r.data.summary.scopedIgnoredNodes,2);assert.equal(run(t,a,b,{mode:'strict'}).status,1);
});
for(const scopedIgnores of [[],null,[{...ignore,pointers:['timestamp']}],[{...ignore,pointers:['/user','/user/id']}],[ignore,ignore],[{...ignore,extra:true}],[{...ignore,pointers:[]}],[{...ignore,origin:'https://api.example.invalid/'}]])test('rejects malformed scoped ignore '+JSON.stringify(scopedIgnores),t=>{
 const a=[entry('/health',{timestamp:1})];assert.equal(run(t,a,a,{scopedIgnores}).status,2);
});
test('overlapping global and scoped ignores are rejected instead of shadowed',t=>{
 const a=[entry('/health',{user:{id:1}})];assert.equal(run(t,a,a,{ignoreJsonPaths:['/user'],scopedIgnores:[{...ignore,pointers:['/user/id']}]}).status,2);
});
test('scoped ignore whose operation is excluded remains an error',t=>{
 const a=[entry('/health',{timestamp:1}),entry('/billing',{timestamp:1})];const r=run(t,a,a,{includeOperations:[{...selector,path:'/billing'}],scopedIgnores:[ignore]});assert.equal(r.status,2);assert.equal(r.data.error.code,'IGNORE_UNUSED');
});
