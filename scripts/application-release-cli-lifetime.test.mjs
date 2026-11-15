import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {withApplicationCliLifetime} from './application-release-cli-lifetime.mjs';
const moduleUrl=new URL('./application-release-cli-lifetime.mjs',import.meta.url).href;
test('an unreferenced pending continuation reproduces the previous successful exit without a receipt',()=>{
 const r=spawnSync(process.execPath,['--input-type=module','-e',"new Promise(r=>setTimeout(r,50).unref()).then(()=>console.log('receipt'));"],{encoding:'utf8',timeout:3000,windowsHide:true});
 assert.equal(r.status,0);assert.equal(r.stdout,'');
});
test('the actual lifetime guard retains the event loop until receipt generation and finally cleanup',()=>{
 const r=spawnSync(process.execPath,['--input-type=module','-e',`import {withApplicationCliLifetime} from ${JSON.stringify(moduleUrl)};await withApplicationCliLifetime(()=>new Promise(r=>setTimeout(()=>r('receipt'),50).unref())).then(console.log);`],{encoding:'utf8',timeout:3000,windowsHide:true});
 assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'receipt');assert.equal(r.stderr,'');
});
test('a refused continuation releases the reference and propagates failure, never success',async()=>{
 const error=Error('unchanged_guard_refusal');await assert.rejects(withApplicationCliLifetime(()=>{throw error;}),e=>e===error);
 const r=spawnSync(process.execPath,['--input-type=module','-e',`import {withApplicationCliLifetime} from ${JSON.stringify(moduleUrl)};try{await withApplicationCliLifetime(()=>new Promise((_,r)=>setTimeout(()=>r(Error('refused')),30).unref()));}catch{process.exitCode=7;}`],{encoding:'utf8',timeout:3000,windowsHide:true});
 assert.equal(r.status,7);assert.equal(r.stdout,'');
});
