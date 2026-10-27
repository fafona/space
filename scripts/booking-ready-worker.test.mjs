import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {executeBookingReadyWorkerReplacement,assertBookingReadyWorkerRawTransition} from './booking-ready-worker.mjs';
test('fixed source replacement Python framing tests never contact a real PM2 daemon',()=>{
 const r=spawnSync(process.platform==='win32'?'python.exe':'python3',['-I','-S','-B',fileURLToPath(new URL('./test_booking_ready_pm2_replace.py',import.meta.url))],
 {encoding:'utf8',timeout:10000,maxBuffer:256*1024,windowsHide:true,env:{PATH:process.env.PATH??'',SystemRoot:process.env.SystemRoot??'',TEMP:process.env.TEMP??'',TMP:process.env.TMP??''}});
 assert.equal(r.error,undefined);assert.equal(r.status,0,r.stdout+'\n'+r.stderr);assert.match(r.stderr,/Ran 6 tests/);assert.match(r.stderr,/\bOK\b/);
});
test('actual single-attempt sequence preserves unknown results and never retries or enables the gate',async()=>{
 for(const failure of [null,'observe','admit','begin','restart','ack','settled','verify','complete','drift']){
  const calls=[];let n=0;const step=(name,v)=>async()=>{calls.push(name);if(failure===name)throw Error(name);return v;};
  const ops={observe:async()=>{calls.push('observe');if(failure==='observe')throw Error('observe');return {old:failure==='drift'?++n:1};},admit:step('admit'),begin:step('begin'),
   restart:step('restart',failure==='ack'?{}:{schemaVersion:1,kind:'booking-ready-worker-rpc-ack',acknowledged:true,peerVerified:true,pm2Version:'6.0.14'}),
   settled:step('settled',{new:1}),verify:step('verify'),complete:step('complete','done')};
  if(failure)await assert.rejects(executeBookingReadyWorkerReplacement(ops));else{assert.equal(await executeBookingReadyWorkerReplacement(ops),'done');assert.deepEqual(calls,['observe','admit','begin','observe','restart','settled','verify','complete']);}
  assert.ok(calls.filter(c=>c==='restart').length<=1);if(['observe','admit','begin','drift'].includes(failure))assert.ok(!calls.includes('restart'));
 }
});
test('full OS/config environment comparison accepts only separately bound PM2 metadata and source path',()=>{
 const env={kept:'exact',pm_exec_path:'/old',created_at:'100',pm_uptime:'110',restart_time:'0'},old={env:{configured:'exact'},pm_exec_path:'/old'},
 next={env:{configured:'exact'},pm_exec_path:'/new',created_at:200,pm_uptime:201,restart_time:1,exit_code:0,node_version:'20.20.1',version:'16.3.4',prev_restart_delay:0},
 after={...env,pm_exec_path:'/new',created_at:'200',pm_uptime:'201',restart_time:'1',exit_code:'0',node_version:'20.20.1',version:'16.3.4',prev_restart_delay:'0'};
 assert.equal(assertBookingReadyWorkerRawTransition(env,after,old,next),true);
 for(const patch of [{kept:'changed'},{extra:'injected'},{pm_exec_path:'/other'},{created_at:'0'},{RESEND_API_KEY:'not-allowed'}])assert.throws(()=>assertBookingReadyWorkerRawTransition(env,{...after,...patch},old,next));
 assert.throws(()=>assertBookingReadyWorkerRawTransition(env,after,old,{...next,env:{changed:true}}));
});
test('fixed replacement keeps gate closed, proves formal schema inactive and protects every unrelated process',()=>{
 const source=readFileSync(new URL('./booking-ready-worker.mjs',import.meta.url),'utf8'),python=readFileSync(new URL('./booking-ready-pm2-replace.py',import.meta.url),'utf8');
 for(const token of ['assertOnlineRetentionHeldLocks(lock)','assertBookingReadySource(toolRevision)','collectBookingReadyOriginalCohort()','verifyInactiveBookingSchema','protected_processes','protected_os',
  'ready-worker-attempt.json','ready-worker-completed.json','restart_outcome_unknown','captureTrustedPython()','verifyTrustedPython(python)','gateNeverOpened:true','mailEnabled:false'])assert.ok(source.includes(token),token);
 assert.match(python,/"id": 27, "env": \{"current_conf"/);assert.doesNotMatch(python,/subprocess|Popen|os\.system|reconnect\(|retry\(/);
 assert.doesNotMatch(source,/unlinkSync|rmSync|\['delete'|\['stop'|\['start'|\['restart'/);
});
