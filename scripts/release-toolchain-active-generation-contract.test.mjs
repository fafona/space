import test from 'node:test';import assert from 'node:assert/strict';
import {ACTIVE_BOOKING_INCIDENT as P,ACTIVE_BOOKING_PM2_RECORDS,assertHistoricalPausedBookingHost,assertActiveBookingWindow,assertActiveBookingDatabase,assertActiveBookingHistoricalEvidence,ACTIVE_RECONCILIATION_STEPS,ACTIVE_PUBLICATION_STEPS,ACTIVE_RECOVERY_STEPS,executeActiveBookingReconciliation,executeActiveBookingPublication,executeActiveBookingRecovery} from './release-toolchain-active-generation-contract.mjs';
import {historicalPauseFixture} from './test-support/release-toolchain-pause-fixture.mjs';
import {sha256} from './release-toolchain-contracts.mjs';
const window={id:'10000000-0000-4000-8000-000000000001',startedAt:'2026-10-29T10:00:00.000Z',deadlineAt:'2026-10-29T10:10:00.000Z'},nowMs=Date.parse('2026-10-29T10:01:00.000Z');
test('active-generation continuation requires a genuinely new exact ten-minute window',()=>{
 assertActiveBookingWindow(window,{nowMs});for(const patch of [{id:P.operationId},{deadlineAt:'2026-10-29T10:11:00.000Z'},{deadlineAt:'2026-10-29T10:09:00.000Z'}])assert.throws(()=>assertActiveBookingWindow({...window,...patch},{nowMs}));
 assert.throws(()=>assertActiveBookingWindow(P.originalWindow,{nowMs}));assert.throws(()=>assertActiveBookingWindow(window,{nowMs:Date.parse(window.deadlineAt)}));
});
const database=()=>({systemIdentifier:'7612049595342295079',databaseOid:'5',serverVersionNum:'150008',generation:P.generation,revision:'0',protocol:2,active:true,savedBookingRowsSha256:'a'.repeat(64),commands:0,mailJobs:0}),identity={systemIdentifier:'7612049595342295079',databaseOid:'5'};
test('active admission binds the real database generation rather than replaying a false-to-true activation',()=>{
 assert.equal(assertActiveBookingDatabase(database(),identity),true);
 for(const patch of [{active:false},{generation:'foreign'},{protocol:1},{databaseOid:'6'},{systemIdentifier:'7612049595342295080'},{revision:'-1'},{commands:-1},{mailJobs:'0'},{savedBookingRowsSha256:'bad'},{extra:true}])assert.throws(()=>assertActiveBookingDatabase({...database(),...patch},identity));
 assert.throws(()=>assertActiveBookingDatabase(database()));
 // Real bookings after activation are not grounds for restoring old JSON.
 assert.equal(assertActiveBookingDatabase({...database(),revision:'2',commands:2,savedBookingRowsSha256:'b'.repeat(64)},identity),true);
});
function history(){const before={...database(),active:false};return{lease:{toolRevision:P.toolRevision,window:{...P.originalWindow}},activation:{before,after:{...before,active:true}},originalPause:{window:{...P.originalWindow},before:{legacy:{pid:1590381,backgroundPaused:'0'}}},recoveryAttempt:{operationId:P.operationId,startedAt:'2026-10-28T18:50:30.310Z',before:{processes:[{name:'merchant-space',pid:P.legacyPid,backgroundPaused:'1',restartCount:1}]}},failure:{operationId:P.operationId}};}
test('historical activation and observed paused successor explain the incident but never become a backdated success',()=>{
 const result=assertActiveBookingHistoricalEvidence(history());assert.equal(result.publicationCompleted,false);assert.equal(result.publicationAuthority,false);
 for(const mutate of [h=>h.lease.window.id=window.id,h=>h.activation.after.revision='1',h=>h.recoveryAttempt.before.processes[0].restartCount=2,h=>h.recoveryAttempt.startedAt='2026-10-28T19:00:00.000Z',h=>h.originalPause.before.legacy.pid=1]){const h=history();mutate(h);assert.throws(()=>assertActiveBookingHistoricalEvidence(h));}
});
function record(){return{kind:'pm2-existing-record-sequence-observation',file:'/root/.pm2/pm2.log',identity:{dev:1,ino:2,uid:0,mode:0o100600,nlink:1},fromOffset:100,toOffset:100+Buffer.byteLength(ACTIVE_BOOKING_PM2_RECORDS.join('\n')+'\n'),sequenceSha256:sha256(ACTIVE_BOOKING_PM2_RECORDS.join('\n')+'\n'),observedAt:'2026-10-29T10:00:29.000Z',observationOfExistingRecords:true,eventTimeNotReissued:true,publicationAuthority:false};}
test('new current observation adopts only the exact already-paused historical successor, not a reissued restart',()=>{
 const value=historicalPauseFixture(),before=structuredClone(value),proof=record(),result=assertHistoricalPausedBookingHost(value,proof,window,{nowMs});
 assert.equal(result.newRestartPerformed,false);assert.equal(result.publicationAuthority,false);assert.equal(result.oldOperationId,P.operationId);assert.deepEqual(value,before);
 assert.throws(()=>assertHistoricalPausedBookingHost(value,proof,P.originalWindow,{nowMs}));
});
for(const mutate of [v=>v.legacyAfter.pid++,v=>v.legacyAfter.restartCount++,v=>v.afterRaw.KEEP='changed',v=>v.afterConfigured.EXTRA='added',v=>v.afterRaw.RESEND_API_KEY='forbidden',v=>v.afterPmDerived.exitCode=0,v=>v.afterRaw.exit_code='137',v=>v.afterPmUptime=nowMs,v=>v.beforePmUptime=nowMs,v=>v.window.id=window.id,v=>v.observedAt=P.originalWindow.startedAt,v=>v.observedAt='2026-10-29T10:00:30Z',v=>v.observedAt=window.deadlineAt,v=>v.extra=true])test('historical adoption rejects altered host, counters, credentials, time and fields',()=>{const value=historicalPauseFixture();mutate(value);assert.throws(()=>assertHistoricalPausedBookingHost(value,record(),window,{nowMs}));});
for(const mutate of [r=>r.sequenceSha256='a'.repeat(64),r=>r.fromOffset++,r=>r.toOffset=Number.MAX_SAFE_INTEGER,r=>r.identity.uid=1,r=>r.identity.dev=-1,r=>r.identity.ino=0,r=>r.identity.mode=0o100666,r=>r.identity.nlink=2,r=>r.identity.extra=true,r=>r.file='/tmp/pm2.log',r=>r.eventTimeNotReissued=false,r=>r.publicationAuthority=true,r=>r.observedAt=P.originalWindow.startedAt,r=>r.observedAt='2026-10-29T10:00:31.000Z',r=>r.observedAt=window.deadlineAt,r=>r.extra=true])test('old log observation cannot substitute another record, file identity, range or observation window',()=>{const proof=record();mutate(proof);assert.throws(()=>assertHistoricalPausedBookingHost(historicalPauseFixture(),proof,window,{nowMs}));});
for(const [name,steps,execute]of [['reconciliation',ACTIVE_RECONCILIATION_STEPS,executeActiveBookingReconciliation],['publication',ACTIVE_PUBLICATION_STEPS,executeActiveBookingPublication],['recovery',ACTIVE_RECOVERY_STEPS,executeActiveBookingRecovery]]){
 test(name+' has no activation, legacy restart, mail enable or business-state restore operation',async()=>{
  const calls=[];let checks=0;const ops=Object.fromEntries(steps.map(s=>[s,async()=>{calls.push(s);return s;}]));ops.assertHeld=()=>{checks++;};
  for(const forbidden of ['activate','pauseOriginalOnce','restartLegacy','restoreData','enableMail'])ops[forbidden]=()=>assert.fail(forbidden);
  assert.equal(await execute(ops),steps.at(-1));assert.deepEqual(calls,steps);assert.equal(checks,steps.length*2);
  if(name==='publication'){assert.ok(steps.indexOf('certificate')<steps.indexOf('enableBookingWorker'));assert.ok(steps.indexOf('armSupervisor')<steps.indexOf('gateAndDrain'));}
  if(name==='reconciliation')assert.ok(steps.indexOf('sealClosure')<steps.indexOf('archiveOldOperation'));
 });
 for(const stage of steps)test(name+' unknown '+stage+' retains its cause and never advances or retries',async()=>{
  const calls=[],original=Error('synthetic-'+stage),failures=[],ops=Object.fromEntries(steps.map(s=>[s,async()=>{calls.push(s);if(s===stage)throw original;}]));ops.assertHeld=()=>{};ops.failure=(e,s)=>failures.push({e,s});
  await assert.rejects(execute(ops),e=>e===original);assert.deepEqual(calls,steps.slice(0,steps.indexOf(stage)+1));assert.deepEqual(failures,[{e:original,s:stage}]);
 });
 test(name+' cannot execute the next action after losing the real ownership check',async()=>{
  const calls=[];let checks=0;const original=Error('lost-owner'),ops=Object.fromEntries(steps.map(s=>[s,async()=>calls.push(s)]));ops.assertHeld=()=>{if(++checks===2)throw original;};
  await assert.rejects(execute(ops),e=>e===original);assert.deepEqual(calls,[steps[0]]);
 });
}
