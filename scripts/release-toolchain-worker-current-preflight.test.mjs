import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {ACTIVE_BOOKING_INCIDENT as P} from './release-toolchain-active-generation-contract.mjs';
import {observeActiveBookingWorkerCurrentPreflight,assertActiveBookingWorkerCurrentPreflight} from './release-toolchain-worker-current-preflight.mjs';
import {readAdmittedActiveBookingWorkerContext} from './release-toolchain-active-generation-publication-scope.mjs';
import {canonicalJson,sha256} from './release-toolchain-contracts.mjs';
const revision='a'.repeat(40),inventory='b'.repeat(64);
function fixture(){const now=Date.now(),window={id:'10000000-0000-4000-8000-000000000001',startedAt:new Date(now-1000).toISOString(),deadlineAt:new Date(now+599000).toISOString()},database={systemIdentifier:'7612049595342295079',databaseOid:'5',serverVersionNum:'150008',generation:P.generation,revision:'0',protocol:2,active:true,savedBookingRowsSha256:'c'.repeat(64),commands:0,mailJobs:0};
 const proof={kind:'active-booking-worker-current-preflight',toolRevision:revision,inventorySha256:inventory,window,databaseBeforeSha256:sha256(canonicalJson(database)),current:{database,publicProof:['https://faolla.com','https://launch.faolla.com'].map(origin=>({origin,status:200,buildId:P.compatibleRollback})),actualRoute:P.compatibleRollback,actualWorkerUnchanged:true,gateEnabled:false,processControlPerformed:false,mailEnabled:false,publicationAuthority:false,observedAt:new Date(now).toISOString()},proxyRollbackVerified:true,ingressRestored:true,formalPilotsStopped:true,processControlPerformed:false,processSavePerformed:false,businessDataWritten:false,mailEnabled:false,publicationAuthority:false};
 return{proof,options:{toolRevision:revision,inventorySha256:inventory,window,databaseBefore:database}};
}
test('neither a JSON closed checkpoint nor fake scope/held-lock can authorize live worker preflight',async()=>{
 const fake={lock:{deployFd:3},toolRevision:revision,window:{ready:true},databaseBefore:{verified:true},closed:{verified:true}};
 await assert.rejects(observeActiveBookingWorkerCurrentPreflight(fake));await assert.rejects(readAdmittedActiveBookingWorkerContext({...fake,kind:'active-booking-publication-private-scope',phase:'worker-attempted',workerIntentStarted:false},fake));
 await assert.rejects(readAdmittedActiveBookingWorkerContext(null,fake));
});
test('proof reader binds exact source/window/database, real rollback probes and all no-effects flags',()=>{
 const{proof,options}=fixture();assertActiveBookingWorkerCurrentPreflight(proof,options);
 for(const change of [v=>{v.toolRevision='d'.repeat(40);},v=>{v.inventorySha256='d'.repeat(64);},v=>{v.window.id='20000000-0000-4000-8000-000000000001';},v=>{v.databaseBeforeSha256='d'.repeat(64);},v=>{v.current.database.revision='-1';},v=>{v.current.publicProof[0].buildId=P.candidate;},v=>{v.current.publicProof[1].origin=v.current.publicProof[0].origin;},v=>{v.current.observedAt=new Date(Date.parse(v.window.deadlineAt)).toISOString();},...['proxyRollbackVerified','ingressRestored','formalPilotsStopped'].map(key=>v=>{v[key]=false;}),...['processControlPerformed','processSavePerformed','businessDataWritten','mailEnabled','publicationAuthority'].map(key=>v=>{v[key]=true;}),...['gateEnabled','processControlPerformed','mailEnabled','publicationAuthority'].map(key=>v=>{v.current[key]=true;})]){const bad=structuredClone(proof);change(bad);assert.throws(()=>assertActiveBookingWorkerCurrentPreflight(bad,options));}
});
test('production reuses only its private pre-window checkpoint and keeps complete post-transition inspection',()=>{
 const text=name=>readFileSync(new URL('./'+name,import.meta.url),'utf8'),scope=text('release-toolchain-active-generation-publication-scope.mjs'),worker=text('release-toolchain-active-generation-worker.mjs'),readiness=text('release-toolchain-active-generation-readiness.mjs');
 assert.ok(readiness.includes('closedObservation:closed'));assert.ok(scope.includes('assertClosedSourceObservationProgress(closed,readiness.closedObservation)'));assert.ok(scope.includes('closed=readiness.closedObservation'));assert.ok(scope.includes('Date.parse(closed.observedAt)<=Date.parse(window.startedAt)'));assert.ok(scope.includes('scope:capability'));
 for(const token of ['scopes.get(capability)',"value.phase==='worker-attempted'",'value.workerIntentStarted===false','value.lock===lock','value.toolRevision===toolRevision','value.directory===directory','same(value.window,window)','await observeActiveBookingWorkerCurrentPreflight','return freeze(structuredClone(value.closed))'])assert.ok(scope.includes(token),token);
 const body=scope.slice(scope.indexOf('export async function readAdmittedActiveBookingWorkerContext'),scope.indexOf('// Evidence only;'));
 assert.ok(body.indexOf('verify();const current=await')<body.indexOf('return freeze'));assert.ok(body.includes('});verify();'));assert.doesNotMatch(body,/seal\(|observedAt\s*[:=]|workerIntentStarted\s*=(?!=)/);
 assert.ok(worker.includes('scope===undefined?await inspectClosedActiveBookingIncidentUnderHeldLocks'));assert.ok(worker.includes('await readAdmittedActiveBookingWorkerContext(scope,{lock,toolRevision,window,directory});held();'));
 const bodyWorker=scope.slice(scope.indexOf('export async function prepareActiveBookingPublicationWorker'),scope.indexOf('// Only OUR'));
 assert.ok(bodyWorker.indexOf('await prepareActiveBookingGatedWorker')<bodyWorker.indexOf('await inspectClosedActiveBookingIncidentWithPreparedWorker'));assert.ok(bodyWorker.indexOf('await inspectClosedActiveBookingIncidentWithPreparedWorker')<bodyWorker.indexOf("value.phase='worker-prepared'"));
});
test('live reader retains fresh full cohort, DB, proxy, ingress and all five stopped pilots; never scans history or controls',()=>{
 const text=readFileSync(new URL('./release-toolchain-worker-current-preflight.mjs',import.meta.url),'utf8');
 for(const token of ['assertOnlineRetentionHeldLocks(lock)','assertActiveBookingWindow(window)','reviewedBookingExecution(toolRevision)===authority','observeUnchangedPreIntentHost(databaseBefore,{verify})',"phase:'rollback'",'ingress.beforeText','BOOKING_FORMAL_PILOT_IDS',"pilots.length===5&&pilots.every(value=>value==='false')"])assert.ok(text.includes(token),token);
 assert.doesNotMatch(text,/inspectClosedActive|verifyPinned|bookingHostWrite|bookingHostReplace|process\.kill|renameSync|unlinkSync|restart|save\(/);
});
test('formal qualification seals and independently rereads the actual live-preflight report',()=>{
 const text=readFileSync(new URL('./release-toolchain-active-generation-qualification.mjs',import.meta.url),'utf8');
 for(const token of ["stage='fresh-worker-current-preflight'",'await observeActiveBookingWorkerCurrentPreflight','worker-current-preflight.json','workerCurrentPreflightSha256','beforeObservationSha256:sha256(canonicalJson(before))','elapsedMs:Date.now()-start','assertActiveBookingWorkerCurrentPreflight(preflight.current','Date.parse(preflight.current.current.observedAt)>=Date.parse(started.at)'])assert.ok(text.includes(token),token);
});
