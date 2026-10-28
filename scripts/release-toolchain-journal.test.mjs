import test from 'node:test';import assert from 'node:assert/strict';import * as fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createToolchainRun,inspectToolchainRun,executeJournaledStage,toolchainRunBinding} from './release-toolchain-journal.mjs';
import {fingerprint,TOOLCHAIN_STAGES} from './release-toolchain-contracts.mjs';
async function fixture(fn){const parent=fs.mkdtempSync(path.join(os.tmpdir(),'faolla-journal-test-'));try{const binding=toolchainRunBinding({app:'fixed',tool:'fixed'}),directory=createToolchainRun(parent,binding);await fn({directory,binding});}finally{fs.rmSync(parent,{recursive:true,force:true});}}
const evidence=value=>fingerprint('evidence',value,'canonical-json-v1');
test('every stage is start-before-effect, independently verified, hash chained, and in fixed order',()=>fixture(async({directory,binding})=>{
 for(const stage of TOOLCHAIN_STAGES){let calls=0;await executeJournaledStage(directory,stage,{binding,observe:async()=>evidence({fresh:true}),execute:async()=>{
  calls++;assert.equal(inspectToolchainRun(directory).pending,stage);return 42;},verify:async value=>{assert.equal(value,42);return evidence({actual:true});}});assert.equal(calls,1);}
 const run=inspectToolchainRun(directory);assert.equal(run.status,'complete');assert.equal(run.events.length,TOOLCHAIN_STAGES.length*2);assert.equal(run.header.publicationAuthority,false);
}));
test('unknown command result is retained and cannot be automatically retried or bypassed',()=>fixture(async({directory,binding})=>{
 let calls=0;const ops={binding,observe:async()=>evidence({before:true}),execute:async()=>{calls++;throw Error('secret credential');},verify:async()=>evidence({verified:true})};
 await assert.rejects(executeJournaledStage(directory,'source',ops),/secret credential/);const run=inspectToolchainRun(directory);assert.equal(run.status,'unknown');assert.equal(run.events.at(-1).state,'unknown');
 assert.ok(!JSON.stringify(run).includes('secret credential'));await assert.rejects(executeJournaledStage(directory,'source',ops),/attempt_unknown/);await assert.rejects(executeJournaledStage(directory,'bundle',ops),/attempt_unknown/);assert.equal(calls,1);
}));
test('failed preflight observation occurs before intent/effect and may be rechecked without a mutating replay',()=>fixture(async({directory,binding})=>{
 let calls=0;await assert.rejects(executeJournaledStage(directory,'source',{binding,observe:async()=>{throw Error('blocked');},execute:async()=>{calls++;},verify:async()=>evidence({})}),/blocked/);
 assert.equal(calls,0);assert.equal(inspectToolchainRun(directory).events.length,0);
 await executeJournaledStage(directory,'source',{binding,observe:async()=>evidence({}),execute:async()=>{calls++;},verify:async()=>evidence({})});assert.equal(calls,1);
}));
test('concurrent observers cannot execute a stage twice',()=>fixture(async({directory,binding})=>{
 let calls=0,release;const barrier=new Promise(resolve=>{release=resolve;});const ops={binding,observe:async()=>{await barrier;return evidence({});},execute:async()=>{calls++;},verify:async()=>evidence({})};
 const a=executeJournaledStage(directory,'source',ops),b=executeJournaledStage(directory,'source',ops);release();const results=await Promise.allSettled([a,b]);
 assert.equal(calls,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);assert.equal(inspectToolchainRun(directory).status,'ready');
}));
test('a different binding, skipped stage or verified-stage replay is refused',()=>fixture(async({directory,binding})=>{
 const ops={binding,observe:async()=>evidence({}),execute:async()=>{},verify:async()=>evidence({})};
 await assert.rejects(executeJournaledStage(directory,'bundle',ops),/attempt_replay_forbidden/);
 await assert.rejects(executeJournaledStage(directory,'source',{...ops,binding:evidence({other:true})}),/fingerprint_mismatch/);
 await executeJournaledStage(directory,'source',ops);await assert.rejects(executeJournaledStage(directory,'source',ops),/attempt_replay_forbidden/);
}));
test('modified receipts, missing sequence numbers, extra files and stale writer locks fail closed',async()=>{
 for(const change of ['modify','gap','extra','lock'])await fixture(async({directory,binding})=>{
  const ops={binding,observe:async()=>evidence({}),execute:async()=>{},verify:async()=>evidence({})};await executeJournaledStage(directory,'source',ops);
  if(change==='modify')fs.appendFileSync(path.join(directory,'000001.json'),' ');
  if(change==='gap')fs.unlinkSync(path.join(directory,'000001.json'));
  if(change==='extra')fs.writeFileSync(path.join(directory,'arbitrary.json'),'{}');
  if(change==='lock'){fs.mkdirSync(path.join(directory,'.writer-lock'));await assert.rejects(executeJournaledStage(directory,'bundle',ops),/journal_busy/);assert.ok(fs.existsSync(path.join(directory,'.writer-lock')));}
  else assert.throws(()=>inspectToolchainRun(directory),/journal_invalid/);
 });
});
