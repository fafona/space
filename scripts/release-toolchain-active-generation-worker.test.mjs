import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import {readFileSync} from 'node:fs';
import {prepareActiveBookingGatedWorker} from './release-toolchain-active-generation-worker.mjs';
test('serialized worker readiness, source and held-lock objects cannot initiate the fixed formal transition',async()=>{await assert.rejects(prepareActiveBookingGatedWorker({lock:{deployFd:3},toolRevision:'a'.repeat(40),window:{id:'10000000-0000-4000-8000-000000000001'},directory:'/tmp/worker',ready:{verified:true}}));});
test('new fixed worker framing preserves witness ordering and rejects replay without contacting a daemon in unit tests',()=>{
 const result=spawnSync(process.platform==='win32'?'python.exe':'python3',['-I','-S','-B',fileURLToPath(new URL('./release-toolchain-active-generation-pm2-worker.test.py',import.meta.url))],{encoding:'utf8',timeout:10000,maxBuffer:262144,windowsHide:true,env:{PATH:process.env.PATH??'',SystemRoot:process.env.SystemRoot??'',TEMP:process.env.TEMP??'',TMP:process.env.TMP??''}});
 assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,0,result.stdout+'\n'+result.stderr);assert.match(result.stderr,/Ran 6 tests/);assert.match(result.stderr,/\bOK\b/);
});
test('formal worker entry keeps its old helper unchanged and can only transition the fixed closed-gate source under inherited lock and actual controller',()=>{
 const helper=readFileSync(new URL('./release-toolchain-active-generation-pm2-worker.py',import.meta.url),'utf8'),js=readFileSync(new URL('./release-toolchain-active-generation-worker.mjs',import.meta.url),'utf8');
 for(const token of ['_transport._Session','_worker.snapshot','3889167','closed_directory','FLOCK','WRITE','os.fstat(3)','os.getppid()','commandLineDigest','release-toolchain-active-generation-publish-entry.mjs','active_worker_script_changed'])assert.ok(helper.includes(token),token);
 for(const token of ['inspectClosedActiveBookingIncidentUnderHeldLocks','reviewedBookingExecution','lock.deployFd','assertExecutionWorkerTransition','assertBookingReadyWorkerRawTransition','identityProofs','gateNeverOpened:true','automaticRetryAllowed:false','businessDataWrittenByTool:false'])assert.ok(js.includes(token),token);
 assert.doesNotMatch(js,/\['save'\]|\['jlist'\]|process\.kill|bookingHostReplace|guardedProductionBookingActivationSql|verifyInactiveBookingSchema/);
});
test('real owned PM2 acceptance covers an actual non-aliased third worker and stale refusal',()=>{
 const text=readFileSync(new URL('./release-toolchain-pm2-real-acceptance.mjs',import.meta.url),'utf8');for(const token of ["name:'owned-gated-worker'",'workerBefore?.pm_id===2',"python(workerRequest,{reject:true,rejectLastLine:'RuntimeError: active_worker_unverified'})",'otherTwoProcessesUnchanged:true','formalPm2IdNotAliased:true','assertBookingReadyWorkerRawTransition(workerBeforeRaw'])assert.ok(text.includes(token),token);
});
