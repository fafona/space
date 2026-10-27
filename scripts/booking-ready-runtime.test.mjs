import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {isDeepStrictEqual} from 'node:util';
import ts from 'typescript';
import {BOOKING_READY_BASE as BASE} from './booking-ready-policy.mjs';
import {assertBookingReadyWorkerTransition} from './booking-ready-runtime.mjs';
const source=readFileSync(new URL('./booking-ready-runtime.mjs',import.meta.url),'utf8');
const old={name:'merchant-space-booking-atomic-f274ad615550',pmId:27,pid:830152,restartCount:0,createdAt:100,executable:'/var/lib/faolla-online-code/'+BASE+'/scripts/booking-atomic-worker.mjs',
 cwd:'/private',environmentSha256:'preserved',args:[],backgroundPaused:'0'},revision='f'.repeat(40),next={...old,pid:900000,restartCount:1,createdAt:200,executable:'/var/lib/faolla-online-code/'+revision+'/scripts/booking-atomic-worker.mjs'};
test('only one source replacement of fixed gated worker may change PID/start metadata/script; all config stays exact',()=>{
 assert.equal(assertBookingReadyWorkerTransition(old,next,revision),true);
 for(const patch of [{name:'merchant-space'},{pmId:0},{pid:830152},{restartCount:2},{createdAt:99},{environmentSha256:'changed'},
 {args:['anything']},{backgroundPaused:'1'},{executable:old.executable}])assert.throws(()=>assertBookingReadyWorkerTransition(old,{...next,...patch},revision));
 for(const patch of [{pid:1590531},{pmId:0},{name:'other'},{restartCount:1}])assert.throws(()=>assertBookingReadyWorkerTransition({...old,...patch},next,revision));
});
test('continued runtime cannot manufacture a receipt, replace web identities or trust a stale readiness file alone',()=>{
 for(const token of ['assertBookingReadySource(toolRevision)','attempt.plan?.toolRevision===BASE','protected_process_changed','protected_os_changed',
 'assertBookingAtomicCohort','actual_web_runtime','actual_worker_runtime','worker_identity_binding','ready-worker-attempt.json','receipt_shape','attempt_before'])assert.ok(source.includes(token),token);
 assert.doesNotMatch(source,/process\.kill|\['restart'|\['start'|writeFileSync|unlink|rmSync|origin\/main.*BASE/);
 const ast=ts.createSourceFile('x.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='attestBookingReadyReplacement');
 const expected={schemaVersion:1,kind:'booking-ready-worker-replacement',priorTool:BASE,toolRevision:revision,before:old,after:next,identity:{name:old.name,pid:next.pid},
 attemptSha256:'attempt-hash',gateNeverOpened:true,mailEnabled:false,completedAt:'2026-10-27T21:00:00Z'};
 for(const failure of [null,'source','attempt-source','before','gate','mail','identity','hash','extra']){
  const value=structuredClone(expected);if(failure==='gate')value.gateNeverOpened=false;if(failure==='mail')value.mailEnabled=true;
  if(failure==='identity')value.identity.pid=999;if(failure==='hash')value.attemptSha256='bad';if(failure==='extra')value.extra=true;
  const need=(v,c)=>{if(!v)throw Error(c);},fn=runInNewContext(node.getText(ast).replace(/^export /,'')+'\nattestBookingReadyReplacement',{
   assertBookingReadySource:()=>{if(failure==='source')throw Error('source');},same:(a,b,c)=>need(isDeepStrictEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b))),c),need,BASE,WORKER:old.name,ROOT:'/root',Date,
   read:()=>JSON.stringify({priorTool:BASE,toolRevision:failure==='attempt-source'?'bad':revision,before:failure==='before'?{}:old}),hash:()=> 'attempt-hash',
   assertBookingReadyWorkerTransition,collect:v=>v});
  if(failure)assert.throws(()=>fn(value,revision));else assert.equal(fn(value,revision),value);
 }
});
