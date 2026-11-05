import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHar } from '../src/input.mjs';
import { validateConfig } from '../src/config.mjs';
import { compareHar } from '../src/compare.mjs';
import { applyContracts } from '../src/contracts.mjs';
import { htmlReport } from '../src/report.mjs';
const entry=(body,path='/x')=>({request:{method:'GET',url:'https://api.example.invalid'+path},response:{status:200,content:{mimeType:'application/json',text:JSON.stringify(body)}}});
function report(a,b,raw={}){const c=validateConfig(raw),left=parseHar({log:{entries:a}},c),right=parseHar({log:{entries:b}},c);return applyContracts(compareHar(left.entries,right.entries,c),left.entries,right.entries,c);}
test('HTML groups multiple findings under one operation identity and exposes coverage navigation',()=>{
 const r=report([entry({id:1,role:'reader'})],[entry({id:2})],{mode:'strict'});const h=htmlReport(r);
 assert.equal(r.findings.length,2);assert.equal((h.match(/class="operation-group"/g)||[]).length,1);
 assert.match(h,/<nav aria-label="Report sections">/);assert.match(h,/<table id="operation-coverage">/);assert.match(h,/<caption>Operation coverage<\/caption>/);
 assert.match(h,/href="#operation-0001"/);assert.match(h,/id="operation-0001"/);
});
test('HTML distinguishes authored expected type from an observed before-value',()=>{
 const selector={method:'GET',origin:'https://api.example.invalid',path:'/x'};
 const r=report([entry({id:1})],[entry({id:1})],{contracts:[{...selector,requiredJson:[{pointer:'/id',type:'string'}]}]});const h=htmlReport(r);
 assert.match(h,/Required type: <code>string<\/code>/);assert.match(h,/Observed type: <code>number<\/code>/);assert.match(h,/Authored contract/);
});
test('HTML coverage includes operations without findings and labels incomplete pairing',()=>{
 const r=report([entry({},'/a'),entry({},'/b')],[entry({},'/a')]);const h=htmlReport(r);
 assert.match(h,/https:\/\/api\.example\.invalid\/a/);assert.match(h,/https:\/\/api\.example\.invalid\/b/);assert.match(h,/Baseline entries/);assert.match(h,/Candidate entries/);
});
