import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import {readFileSync} from 'node:fs';
import {prepareActiveBookingGatedWorker,observeActiveBookingPreparedWorker,parseActiveWorkerPreConnectRefusal} from './release-toolchain-active-generation-worker.mjs';
import {canonicalJson} from './release-toolchain-contracts.mjs';
import {executeBookingReadyWorkerReplacement} from './booking-ready-worker.mjs';
test('read-only preparation never latches a mutation; intent persistence and every later failure remain conservative',async()=>{
 for(const failing of ['first-observation','admission','intent-write','second-observation','control','settlement','postconditions','completion',null]){
  let intent=0,control=0,observations=0;const before={pid:1},fail=name=>{if(failing===name)throw Error('fixed-refusal');};
  const operations={observe:()=>{fail(++observations===1?'first-observation':'second-observation');return before;},admit:()=>fail('admission'),begin:()=>{intent++;fail('intent-write');},restart:()=>{control++;fail('control');return{kind:'booking-ready-worker-rpc-ack',schemaVersion:1,acknowledged:true,peerVerified:true,pm2Version:'6.0.14'};},settled:()=>{fail('settlement');return{};},verify:()=>fail('postconditions'),complete:()=>{fail('completion');return'completed';}};
  if(failing)await assert.rejects(executeBookingReadyWorkerReplacement(operations),{message:'fixed-refusal'});else assert.equal(await executeBookingReadyWorkerReplacement(operations),'completed');
  assert.equal(intent,['first-observation','admission'].includes(failing)?0:1,failing??'success');
  assert.equal(control,['first-observation','admission','intent-write','second-observation'].includes(failing)?0:1,failing??'success');
 }
});
test('the real controller latches at the private begin callback, not before asynchronous read-only worker preparation',()=>{
 const publication=readFileSync(new URL('./release-toolchain-active-generation-publication.mjs',import.meta.url),'utf8'),scope=readFileSync(new URL('./release-toolchain-active-generation-publication-scope.mjs',import.meta.url),'utf8'),worker=readFileSync(new URL('./release-toolchain-active-generation-worker.mjs',import.meta.url),'utf8');
 assert.match(publication,/prepareActiveBookingPublicationWorker\(scope,\{beforeWorkerIntent:\(\)=>\{mutationPossible=true;\}\}\)/);
 assert.doesNotMatch(publication,/prepareGatedWorker:async\(\)=>\{mutationPossible=true/);
 assert.ok(scope.includes('value.workerIntentStarted=true;beforeWorkerIntent();'));
 const begin=worker.slice(worker.indexOf('begin:before=>'),worker.indexOf('restart:before=>'));
 assert.ok(begin.indexOf('beforeIntent();')<begin.indexOf("seal(directory+'/worker-attempt.json'"));
 assert.ok(begin.includes('beforeIntent();intentStarted=true;'));
 assert.ok(worker.indexOf('const closed=await inspectClosedActiveBookingIncidentUnderHeldLocks')<worker.indexOf('begin:before=>'));
 assert.ok(scope.includes("value.phase=value.workerIntentStarted?'unknown':'worker-preflight-refused'"));
});
test('only a closed canonical pre-connect diagnostic is recognizable; it cannot authorize retry',()=>{const child={schemaVersion:1,kind:'active-gated-worker-refused-before-connect',stage:'formal-witness',code:'active_worker_closure',socketOpened:false,controlSent:false,mutationPossible:false,automaticRetryAllowed:false,detailsRedacted:true},response={status:1,signal:null,error:null,stdout:'',stderr:canonicalJson(child)+'\n'};assert.deepEqual(parseActiveWorkerPreConnectRefusal(response),child);for(const mutate of [v=>v.status=0,v=>v.signal='SIGKILL',v=>v.error={code:'ETIMEDOUT'},v=>v.stdout='unexpected',v=>v.stderr='SENSITIVE_SENTINEL',v=>v.stderr=canonicalJson({...child,stage:'transport'})+'\n',v=>v.stderr=canonicalJson({...child,controlSent:null})+'\n',v=>v.stderr=canonicalJson({...child,code:'unreviewed_secret'})+'\n',v=>v.stderr=canonicalJson({...child,extra:true})+'\n',v=>v.stderr=JSON.stringify(child)+'\n']){const v=structuredClone(response);mutate(v);assert.equal(parseActiveWorkerPreConnectRefusal(v),null);}});
test('serialized worker readiness, source and held-lock objects cannot initiate the fixed formal transition',async()=>{await assert.rejects(prepareActiveBookingGatedWorker({lock:{deployFd:3},toolRevision:'a'.repeat(40),window:{id:'10000000-0000-4000-8000-000000000001'},directory:'/tmp/worker',ready:{verified:true}}));});
test('post-transition observation has separate held admission and cannot accept a supplied ready/worker exception',()=>{assert.throws(()=>observeActiveBookingPreparedWorker({lock:{deployFd:3},toolRevision:'a'.repeat(40),window:{id:'10000000-0000-4000-8000-000000000001'},directory:'/tmp/worker',ready:{verified:true}}));});
test('new fixed worker framing preserves witness ordering and rejects replay without contacting a daemon in unit tests',()=>{
 const result=spawnSync(process.platform==='win32'?'python.exe':'python3',['-I','-S','-B',fileURLToPath(new URL('./release-toolchain-active-generation-pm2-worker.test.py',import.meta.url))],{encoding:'utf8',timeout:10000,maxBuffer:262144,windowsHide:true,env:{PATH:process.env.PATH??'',SystemRoot:process.env.SystemRoot??'',TEMP:process.env.TEMP??'',TMP:process.env.TMP??''}});
 assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,0,result.stdout+'\n'+result.stderr);assert.match(result.stderr,/Ran 11 tests/);assert.match(result.stderr,/\bOK\b/);
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
