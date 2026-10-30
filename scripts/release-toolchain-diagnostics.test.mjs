import test from 'node:test';import assert from 'node:assert/strict';
import {stageFailureDiagnostic} from './release-toolchain-diagnostics.mjs';
import {sha256,ToolchainError} from './release-toolchain-contracts.mjs';
import {executeObservedReadOnlyPm2} from './release-toolchain-pm2-readonly-diagnostic.mjs';
const revision='a'.repeat(40),prefix='file:///var/lib/faolla-online-code/'+revision+'/scripts/',knownFiles=['booking-handoff-execution.mjs','booking-handoff-host-io.mjs'];
test('stage diagnostics retain known source line/column evidence without arbitrary exception text or stacks',()=>{
 // Model the supported Node 20 data property explicitly; newer workstation
 // Nodes use a lazy accessor which the reporter intentionally will not call.
 const error=Error('password=never disclose');Object.defineProperty(error,'stack',{value:'Error: password=never disclose\n at check ('+prefix+'booking-handoff-execution.mjs:81:4)\n at secret (/root/.env.local:2:1)\n at unknown ('+prefix+'private-secret.mjs:2:4)',configurable:true});
 const v=stageFailureDiagnostic(error,{stage:'admission',toolRevision:revision,knownFiles});
 assert.equal(v.exceptionMessageSha256,sha256('password=never disclose'));assert.deepEqual(v.frames,[{file:'scripts/booking-handoff-execution.mjs',line:81,column:4}]);
 assert.equal(v.code,'operation_unconfirmed');assert.doesNotMatch(JSON.stringify(v),/password|never disclose|private-secret|\.env/);
});
test('diagnostics are bounded and cannot execute message/stack getters or accept arbitrary stages and source names',()=>{
 const error={};for(const key of ['message','stack'])Object.defineProperty(error,key,{get(){assert.fail('getter');}});
 assert.deepEqual(stageFailureDiagnostic(error,{stage:'admission',toolRevision:revision,knownFiles}).frames,[]);
 const huge=Error('x');Object.defineProperty(huge,'stack',{value:'Error\n'+Array.from({length:30},()=> 'at f ('+prefix+'booking-handoff-host-io.mjs:1:2)').join('\n'),configurable:true});
 assert.equal(stageFailureDiagnostic(huge,{stage:'admission',toolRevision:revision,knownFiles}).frames.length,8);
 assert.throws(()=>stageFailureDiagnostic(error,{stage:'caller-stage',toolRevision:revision,knownFiles}));
 assert.equal(stageFailureDiagnostic(new ToolchainError('source_changed'),{stage:'source',toolRevision:revision,knownFiles}).code,'source_changed');
});

test('only fixed historical tool frames survive generic remapping, without unrelated paths or source authority',()=>{
 const old='c2f92ef696998901e5f060a40f7beee2d94ac1d5',file='production-maintenance-pm2-adapter.mjs',error=Error('secret');
 Object.defineProperty(error,'stack',{value:'Error: secret\n at exchange (file:///var/lib/faolla-online-code/'+old+'/scripts/'+file+':269:11)\n at unrelated (file:///var/lib/faolla-online-code/'+'b'.repeat(40)+'/scripts/'+file+':2:3)\n at private (/root/.env:1:2)',configurable:true});
 const d=stageFailureDiagnostic(error,{stage:'rehearsal',toolRevision:revision,knownFiles:[file]});
 assert.deepEqual(d.frames,[]);assert.deepEqual(d.historicalFrames,[{revision:old,file:'scripts/'+file,line:269,column:11}]);
 assert.doesNotMatch(JSON.stringify(d),/secret|\.env|unrelated/);assert.equal(Object.hasOwn(d,'publicationAuthority'),false);
});

test('reporter carries only schema-validated private PM2 refusal evidence',async()=>{
 let error;try{await executeObservedReadOnlyPm2({operation:'registry-read',io:{},perform:()=>{throw Error('private');}});}catch(e){error=e;}
 const d=stageFailureDiagnostic(error,{stage:'rehearsal',toolRevision:revision,knownFiles:[]});
 assert.equal(d.pm2.lastIo,'start');assert.equal(d.pm2.operation,'registry-read');assert.equal(d.pm2.automaticRetryAllowed,false);
 const forged=Error('private');Object.defineProperty(forged,'releasePm2FailureDiagnostic',{value:{...d.pm2,stdout:'secret'}});
 assert.equal(Object.hasOwn(stageFailureDiagnostic(forged,{stage:'rehearsal',toolRevision:revision,knownFiles:[]}),'pm2'),false);
});
