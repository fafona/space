import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RECOVERY_STEPS,recoveryFailureDiagnostic,assertRecoveryFailureDiagnostic,recoveryChildExitEvidence} from './release-toolchain-recovery-diagnostics.mjs';
import {executeBookingFailureRecoverySequence} from './booking-handoff-recovery.mjs';
import {sha256} from './release-toolchain-contracts.mjs';
const context={operationId:'10000000-0000-4000-8000-000000000001',toolRevision:'f'.repeat(40)},at='2026-10-28T20:00:00.000Z';
function diagnostic(step='publicProof'){
 const error=Error('secret-password-and-address');Object.defineProperty(error,'stack',{value:`Error: private\n at verify (file:///var/lib/faolla-online-code/${context.toolRevision}/scripts/booking-handoff-recovery.mjs:180:17)\n at unknown (file:///private/secret.mjs:1:2)`,configurable:true});
 return recoveryFailureDiagnostic(error,{...context,step,at,knownFiles:['booking-handoff-recovery.mjs']});
}
test('recovery diagnostics bind the exact phase, operation and tool while redacting exception text and foreign paths',()=>{
 const d=diagnostic();assert.equal(assertRecoveryFailureDiagnostic(d,context),true);
 assert.equal(d.step,'publicProof');assert.deepEqual(d.diagnostic.frames,[{file:'scripts/booking-handoff-recovery.mjs',line:180,column:17}]);
 assert.equal(d.diagnostic.exceptionMessageSha256,sha256('secret-password-and-address'));
 assert.doesNotMatch(JSON.stringify(d),/secret-password|private\/secret|Error: private/);
});
test('arbitrary error getters are not executed',()=>{
 let accessed=false;const e={};for(const k of ['message','stack'])Object.defineProperty(e,k,{get(){accessed=true;throw Error('secret');}});
 const d=recoveryFailureDiagnostic(e,{...context,step:'route',at,knownFiles:[]});assert.equal(accessed,false);assert.equal(d.diagnostic.exceptionMessageSha256,sha256(''));assert.deepEqual(d.diagnostic.frames,[]);
});
for(const [name,mutate]of [
 ['foreign operation',d=>d.operationId='20000000-0000-4000-8000-000000000001'],['foreign tool',d=>d.diagnostic.toolRevision='a'.repeat(40)],
 ['unknown phase',d=>d.step='reset'],['extra top-level field',d=>d.password='private'],['extra diagnostic field',d=>d.diagnostic.message='private'],
 ['unredacted details',d=>d.diagnostic.detailsRedacted=false],['unknown code',d=>d.diagnostic.code='arbitrary-private'],
 ['invalid date',d=>d.at='yesterday'],['foreign frame',d=>d.diagnostic.frames[0].file='/root/private.mjs'],
 ['zero line',d=>d.diagnostic.frames[0].line=0],['too many frames',d=>d.diagnostic.frames=Array(9).fill(d.diagnostic.frames[0])],
 ['extra frame field',d=>d.diagnostic.frames[0].message='private'],['invalid message hash',d=>d.diagnostic.exceptionMessageSha256='invalid'],
])test('recovery diagnostic rejects '+name,()=>{const d=diagnostic();mutate(d);assert.throws(()=>assertRecoveryFailureDiagnostic(d,context));});
test('watchdog retains bounded child exit details and verified structured cause without raw output',()=>{
 const child=diagnostic(),stderr=JSON.stringify(child)+'\n',r=recoveryChildExitEvidence({status:1,signal:null,stdout:'',stderr},{...context,at});
 assert.equal(r.status,1);assert.equal(r.outputEmpty,false);assert.equal(r.publicationAuthority,false);assert.equal(r.stderrSha256,sha256(stderr));assert.deepEqual(r.childDiagnostic,child);
 assert.equal(r.stderrBytes,Buffer.byteLength(stderr));assert.equal(Object.hasOwn(r,'stderr'),false);
});
for(const [name,result,expected]of [
 ['timeout',{status:null,signal:'SIGKILL',error:{code:'ETIMEDOUT'}},{status:null,signal:'SIGKILL',errorCode:'ETIMEDOUT'}],
 ['buffer limit',{status:null,error:{code:'ENOBUFS'}},{status:null,signal:null,errorCode:'ENOBUFS'}],
 ['unknown error',{status:1,error:{code:'PRIVATE_VALUE'}},{status:1,signal:null,errorCode:'unclassified'}],
 ['successful silent child',{status:0,stdout:'',stderr:''},{status:0,signal:null,errorCode:null}],
])test('watchdog preserves '+name+' and never grants publication authority',()=>{
 const r=recoveryChildExitEvidence(result,{...context,at});for(const [k,v]of Object.entries(expected))assert.equal(r[k],v);assert.equal(r.publicationAuthority,false);assert.equal(r.childDiagnostic,null);
});
for(const text of ['private error',JSON.stringify({...diagnostic(),operationId:'20000000-0000-4000-8000-000000000001'}),JSON.stringify(diagnostic())+'\n'+JSON.stringify(diagnostic()),JSON.stringify(diagnostic())+'\nforeign error'])test('untrusted stderr is hashed, never accepted as a recovery cause: '+sha256(text).slice(0,8),()=>{
 const r=recoveryChildExitEvidence({status:1,stdout:'',stderr:text},{...context,at});assert.equal(r.childDiagnostic,null);assert.equal(r.outputEmpty,false);assert.equal(r.stderrSha256,sha256(text));assert.doesNotMatch(JSON.stringify(r),/private error|foreign error/);
});
test('oversized output is refused rather than silently truncated',()=>{
 assert.throws(()=>recoveryChildExitEvidence({status:1,stderr:'x'.repeat(65537)},context),/size/);
});
function operations(failAt,progressFails=false){
 const calls=[],steps=[],failures=[],original=Error('fixed-original-error');let completed=false;
 const run=name=>async()=>{calls.push(name);if(name===failAt&&!progressFails)throw original;
  if(name==='databaseBarrier')return{active:true,barrierCompleted:true};if(name==='legacyState')return{paused:false,originalIntact:true};
  if(name==='pauseLegacyOnce')return{confirmed:true,attempted:true};if(name==='publicProof')return[{status:200}];if(name==='complete')completed=true;};
 const value=Object.fromEntries(RECOVERY_STEPS.filter(s=>s!=='startup').map(name=>[name,run(name)]));
 return{value:{...value,now:()=>at,progress:async s=>{steps.push(s);if(progressFails&&s===failAt)throw original;},failure:async(e,s)=>failures.push({e,s})},calls,steps,failures,original,completed:()=>completed};
}
for(const phase of RECOVERY_STEPS.filter(s=>s!=='startup'))for(const progressFails of [false,true])test('failure at '+phase+(progressFails?' progress':' action')+' is diagnosed exactly once without replay',async()=>{
 const f=operations(phase,progressFails),lease={window:{id:context.operationId,deadlineAt:'2026-10-28T20:10:00.000Z'}};
 await assert.rejects(executeBookingFailureRecoverySequence(f.value,lease),e=>e===f.original);
 assert.deepEqual(f.failures,[{e:f.original,s:phase}]);assert.equal(f.steps.at(-1),phase);assert.equal(f.steps.filter(s=>s===phase).length,1);
 assert.equal(f.calls.filter(s=>s===phase).length,progressFails?0:1);assert.equal(f.completed(),false);
 const index=RECOVERY_STEPS.indexOf(phase);for(const later of RECOVERY_STEPS.slice(index+1))assert.equal(f.calls.includes(later),false);
});
test('a completely observed recovery remains a recovery, not normal publication completion',async()=>{
 const f=operations();const r=await executeBookingFailureRecoverySequence(f.value,{window:{id:context.operationId,deadlineAt:'2026-10-28T20:10:00.000Z'}});
 assert.deepEqual(f.steps,RECOVERY_STEPS.filter(s=>s!=='startup'));assert.equal(f.completed(),true);assert.equal(r.normalHandoffCompleted,false);assert.equal(r.gateClosed,true);
});
test('failure of diagnostic persistence cannot replace the original error or retry a mutation',async t=>{
 const f=operations('route');f.value.failure=async()=>{throw Error('disk-full');};const output=t.mock.method(console,'error',()=>{});
 await assert.rejects(executeBookingFailureRecoverySequence(f.value,{window:{id:context.operationId,deadlineAt:'2026-10-28T20:10:00.000Z'}}),e=>e===f.original);
 assert.equal(f.calls.filter(s=>s==='route').length,1);assert.equal(f.completed(),false);assert.deepEqual(output.mock.calls.map(c=>c.arguments),[['booking_recovery_diagnostic_unconfirmed']]);
});
test('production wiring records every phase under the inherited lease and retains the child result before requiring success',()=>{
 const recovery=readFileSync(new URL('./booking-handoff-recovery.mjs',import.meta.url),'utf8'),watchdog=readFileSync(new URL('./booking-handoff-watchdog.mjs',import.meta.url),'utf8');
 assert.match(recovery,/progress:step=>\{lastRecoveryStep=step;need\(RECOVERY_STEPS.includes\(step\),'diagnostic_step'\);verify\(\);write\(ROOT\+'\/recovery-step-'/);
 assert.match(recovery,/failure:\(error,step\)=>\{verify\(\);write\(ROOT\+'\/recovery-failure.json'/);
 assert.ok(watchdog.indexOf("write(ROOT+'/watchdog-recovery-exit.json'")<watchdog.indexOf("need(r.status===0&&!r.error&&!r.signal&&exit.outputEmpty"));
 assert.match(recovery,/console.error\(JSON.stringify\(recoveryFailureDiagnostic/);
});
