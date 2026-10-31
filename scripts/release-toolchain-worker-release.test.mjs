import test from 'node:test';import assert from 'node:assert/strict';
import {bookingHandoffFixture} from './test-support/booking-handoff-retention-fixture.mjs';
import {buildOnlineRetentionReceipt} from './online-release-retention.mjs';
import {assertOnlineRetentionHistory,assertOnlineRetentionPublication,retentionHash,retentionCanonicalText,inspectOnlineRetentionWindow} from './online-release-retention-policy.mjs';
import {assertBookingAtomicWorkerGate} from './booking-atomic-worker.mjs';
import {assertBookingWorkerReleasePlan,assertBookingWorkerReleaseCompletion,assertBookingWorkerExecutionRevision} from './release-toolchain-worker-release-contract.mjs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {WEB_RELEASE_FILES,WEB_RELEASE_PROXY,WEB_RELEASE_MARKER} from './web-presentation-release-policy.mjs';
import {assertOnlineToolOwnedPath} from './prepare-online-release-tool.mjs';
const clone=structuredClone,sha=s=>s.repeat(40),hash=s=>s.repeat(64),digest=s=>createHash('sha256').update(s).digest('hex');
function fixture(){
 const f=bookingHandoffFixture(),name='merchant-space-booking-atomic-f274ad615550';
 for(const p of [f.before.processes.find(p=>p.name===name),f.before.bookingHandoff.added.find(p=>p.name===name)])Object.assign(p,{pmId:27,killTimeout:null});
 f.before.activeState.bookingHandoffSha256=retentionHash(f.before.bookingHandoff);
 const activeProof=f.before.releaseProofs.find(p=>p.target===f.before.active.target);activeProof.state=clone(f.before.activeState);activeProof.stateText=JSON.stringify(activeProof.state);activeProof.stateSha256=digest(activeProof.stateText);
 const first=buildOnlineRetentionReceipt(f.before,clone(f.before),{version:2,process:null},f.history,{preparedAt:'2026-10-26T10:01:00.000Z',completedAt:'2026-10-26T10:01:00.000Z'});
 const history={...f.history,entries:[...f.history.entries,first.certificate],headSha256:retentionHash(first.certificate)},prior=history.entries.at(-1),old=prior.processes.find(p=>p.name===name);
 const gate={schemaVersion:1,kind:'booking-atomic-worker-gate',candidate:prior.active.target,toolRevision:sha('f'),certificateSha256:history.headSha256,generation:f.handoff.databaseAfter.generation,enabled:true};
 const workerRelease={version:1,kind:'booking-worker-source-only',candidate:prior.active.target,toolRevision:sha('e'),priorToolRevision:sha('f'),priorWorker:clone(old),gateSha256:digest(retentionCanonicalText(gate)),publicationCertificateSha256:history.headSha256,inventorySha256:hash('a'),nativeEvidenceSha256:hash('b'),protectedHostSha256:hash('c'),window:{id:'10000000-0000-4000-8000-000000000002',startedAt:'2026-10-31T14:00:00.000Z',deadlineAt:'2026-10-31T14:10:00.000Z'},mailEnabled:false};
 const before={...Object.fromEntries(['version','policy','legacySha256','rollingHeadSha256','rollingHistorySha256','active','rollback','victim'].map(k=>[k,clone(prior[k])])),kind:'booking-worker',sequence:history.entries.length+1,previousSha256:history.headSha256,toolRevision:sha('e'),workerRelease,processes:clone(prior.processes),workerIdentity:{pid:old.pid,uid:0,startTicks:'100'},protectedHostSha256:hash('c'),persistenceSha256:null};
 const after={...clone(before),processes:before.processes.map(p=>p.name===name?{...p,pid:77777,restartCount:p.restartCount+1,executable:'/var/lib/faolla-online-code/'+sha('e')+'/scripts/booking-atomic-worker.mjs'}:clone(p)),workerIdentity:{pid:77777,uid:0,startTicks:'200'},persistenceSha256:hash('d')};
 return{history,gate,before,after,old,name,websiteState:clone(f.before.activeState)};
}
test('worker protected-file observation resolves policy basenames and includes the existing routing marker, without weakening owned-path checks',async()=>{
 const {bookingWorkerProtectedFilePlan}=await import('./release-toolchain-worker-release-host.mjs'),plan=bookingWorkerProtectedFilePlan();
 assert.equal(plan.length,9);assert.equal(new Set(plan.map(v=>v.file)).size,9);
 for(const row of plan){assert.equal(path.posix.isAbsolute(row.file),true);assert.equal(path.posix.normalize(row.file),row.file);assert.equal(row.file.includes('\\'),false);}
 assert.deepEqual(plan.filter(v=>!v.privateMode).map(v=>v.file),[...WEB_RELEASE_FILES.map(name=>WEB_RELEASE_PROXY+'/'+name),WEB_RELEASE_MARKER]);
 assert.equal(plan.filter(v=>v.privateMode).length,5);
 for(const name of WEB_RELEASE_FILES)assert.throws(()=>assertOnlineToolOwnedPath(name,'file'),/online_tool_path_invalid/);
 if(process.platform==='linux'){
  let checked=0;const io={lstatSync:file=>({uid:0,mode:0o100600,nlink:1,isSymbolicLink:()=>false,isFile:()=>plan.some(v=>v.file===file),isDirectory:()=>!plan.some(v=>v.file===file)}),realpathSync:file=>{checked++;return file;}};
  for(const {file}of plan)assertOnlineToolOwnedPath(file,'file',io);assert.ok(checked>plan.length);
 }
});
test('a worker-only receipt preserves website, rollback, original gate and every other process',()=>{
 const f=fixture();assertBookingWorkerReleasePlan(f.before,f.history);assertBookingWorkerReleaseCompletion(f.before,f.after,f.history);
 const bytes=retentionCanonicalText(f.history),receipt=buildOnlineRetentionReceipt(f.before,f.after,{version:2,process:null},f.history,{preparedAt:'2026-10-31T14:00:00.000Z',completedAt:'2026-10-31T14:01:00.000Z'}),history={...clone(f.history),entries:[...clone(f.history.entries),receipt.certificate],headSha256:retentionHash(receipt.certificate)};
 assertOnlineRetentionHistory(history);assert.equal(retentionCanonicalText(f.history),bytes);
 const actualActive=Object.fromEntries(['target','name','directory','port'].map(k=>[k,f.before.active[k]]));
 assertBookingAtomicWorkerGate({gate:f.gate,history,current:f.after.processes,actualActive,toolRevision:f.gate.toolRevision});
 assertBookingWorkerExecutionRevision({gate:f.gate,history,toolRevision:f.before.toolRevision});
 assert.equal(inspectOnlineRetentionWindow({history,actualActive,current:f.after.processes,saved:f.before.processes}).phase,'stable');
 assert.equal(assertOnlineRetentionPublication({history,state:f.websiteState,actualActive,current:f.after.processes,action:'stage'}).phase,'published');
});
test('pending, unrelated or fabricated tool revisions cannot dispatch against the old gate',()=>{
 const f=fixture();assert.throws(()=>assertBookingWorkerExecutionRevision({gate:f.gate,history:f.history,toolRevision:f.before.toolRevision}));
 assert.throws(()=>assertBookingWorkerExecutionRevision({gate:f.gate,history:f.history,toolRevision:sha('a')}));
});
test('a second audited source successor keeps the original website gate and chains both saved-process replacements',()=>{
 const f=fixture(),first=buildOnlineRetentionReceipt(f.before,f.after,{version:2,process:null},f.history,{preparedAt:'2026-10-31T14:00:00.000Z',completedAt:'2026-10-31T14:01:00.000Z'}),history={...clone(f.history),entries:[...clone(f.history.entries),first.certificate],headSha256:retentionHash(first.certificate)};
 const before={...clone(f.after),sequence:history.entries.length+1,previousSha256:history.headSha256,toolRevision:sha('d'),persistenceSha256:null};before.workerRelease={...clone(before.workerRelease),toolRevision:sha('d'),priorToolRevision:sha('e'),priorWorker:clone(before.processes.find(p=>p.name===f.name)),window:{id:'10000000-0000-4000-8000-000000000003',startedAt:'2026-10-31T14:02:00.000Z',deadlineAt:'2026-10-31T14:12:00.000Z'}};
 const after={...clone(before),processes:before.processes.map(p=>p.name===f.name?{...clone(p),pid:88888,restartCount:p.restartCount+1,executable:'/var/lib/faolla-online-code/'+sha('d')+'/scripts/booking-atomic-worker.mjs'}:clone(p)),workerIdentity:{pid:88888,uid:0,startTicks:'300'},persistenceSha256:hash('9')};
 const next=buildOnlineRetentionReceipt(before,after,{version:2,process:null},history,{preparedAt:'2026-10-31T14:02:00.000Z',completedAt:'2026-10-31T14:03:00.000Z'}),current={...clone(history),entries:[...clone(history.entries),next.certificate],headSha256:retentionHash(next.certificate)},actualActive=Object.fromEntries(['target','name','directory','port'].map(k=>[k,before.active[k]]));
 assertOnlineRetentionHistory(current);assertBookingAtomicWorkerGate({gate:f.gate,history:current,current:after.processes,actualActive,toolRevision:f.gate.toolRevision});assertBookingWorkerExecutionRevision({gate:f.gate,history:current,toolRevision:sha('d')});
 for(const saved of [f.before.processes,f.after.processes])assert.equal(inspectOnlineRetentionWindow({history:current,actualActive,current:after.processes,saved}).phase,'stable');
 assert.equal(assertOnlineRetentionPublication({history:current,state:f.websiteState,actualActive,current:after.processes,action:'stage'}).phase,'published');
});
test('only one exact worker source restart is permitted; no environment, website, extra process or mail change',()=>{
 const f=fixture();for(const mutate of [v=>v.processes[0].pid++,v=>v.processes.push(clone(v.processes[0])),v=>v.processes.find(p=>p.name===f.name).restartCount++,v=>v.processes.find(p=>p.name===f.name).environmentSha256=hash('9'),v=>v.processes.find(p=>p.name===f.name).nodeArgs=['--eval'],v=>v.active.port++,v=>v.workerRelease.mailEnabled=true,v=>v.protectedHostSha256=hash('9'),v=>v.persistenceSha256=null]){const changed=clone(f.after);mutate(changed);assert.throws(()=>assertBookingWorkerReleaseCompletion(f.before,changed,f.history));}
});
test('missing, stale-context, foreign predecessor and unknown worker fields are refused',()=>{
 const f=fixture();for(const mutate of [v=>v.previousSha256=hash('9'),v=>v.workerRelease.priorToolRevision=sha('9'),v=>v.workerRelease.extra=true,v=>v.workerRelease.priorWorker.pid++,v=>v.sequence++,v=>v.workerRelease.window.deadlineAt='2026-10-31T15:00:00.000Z']){const changed=clone(f.before);mutate(changed);assert.throws(()=>assertBookingWorkerReleasePlan(changed,f.history));}
});
test('worker successor uses the unchanged one-mutation peer transport with strict real parent and inherited lock guards',()=>{
 const result=spawnSync(process.platform==='win32'?'python.exe':'python3',['-I','-S','-B',fileURLToPath(new URL('./release-toolchain-worker-release-pm2.test.py',import.meta.url))],{encoding:'utf8',timeout:10000,maxBuffer:262144,windowsHide:true,env:{PATH:process.env.PATH??'',SystemRoot:process.env.SystemRoot??'',TEMP:process.env.TEMP??'',TMP:process.env.TMP??''}});assert.equal(result.status,0,result.stderr);assert.match(result.stderr,/Ran 3 tests/);assert.match(result.stderr,/OK/);
});
