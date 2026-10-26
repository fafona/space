import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BOOKING_HANDOFF_CANDIDATE as C,BOOKING_HANDOFF_APPLICATION as A,BOOKING_HANDOFF_BASELINE as B} from './booking-handoff-policy.mjs';
import {selectBookingRecoveryTarget,executeBookingFailureRecovery,BOOKING_RECOVERY_BARRIER_SQL} from './booking-handoff-recovery.mjs';
const lease=()=>({schemaVersion:1,kind:'booking-handoff-independent-watchdog',candidate:C,toolRevision:'f'.repeat(40),
  window:{id:'10000000-0000-4000-8000-000000000001',startedAt:'2026-10-26T10:00:00.000Z',deadlineAt:'2026-10-26T10:10:00.000Z'},
  parent:{pid:1234,uid:0,startTicks:'100',executable:'/usr/bin/node',cwd:'/var/lib/faolla-online-code/'+'f'.repeat(40),commandSha256:'a'.repeat(64)},
  deploy:{file:'/www/wwwroot/merchant-space.deploy.lock',identity:{dev:1,ino:2,uid:0,mode:0o100600,nlink:1}},
  operation:{directory:'/var/lib/faolla-maintenance/merchant-space/operation.lock',identity:{dev:1,ino:3,uid:0,mode:0o40700,nlink:2}},
  routingPlanSha256:'a'.repeat(64),gatePlanSha256:'b'.repeat(64)});
function fixture({database={active:true,barrierCompleted:true},legacy={paused:false,originalIntact:true},failAt,completedAt='2026-10-26T10:09:00.000Z'}={}){
  const calls=[];let receipt;
  const step=(name,work=()=>{})=>async(...args)=>{calls.push(name);if(name===failAt)throw Error('unknown_'+name);return work(...args);};
  const operations={now:()=>completedAt,verify:step('verify'),parentGone:step('parentGone'),capture:step('capture',()=>({preserved:true})),
    databaseBarrier:step('databaseBarrier',()=>structuredClone(database)),legacyState:step('legacyState',()=>structuredClone(legacy)),begin:step('begin'),
    disableBookingWorker:step('disableBookingWorker'),pauseLegacyOnce:step('pauseLegacyOnce',()=>({confirmed:true,attempted:true})),route:step('route'),unfence:step('unfence'),
    publicProof:step('publicProof',()=>({verified:true})),publicationMetadata:step('publicationMetadata'),persistProcesses:step('persistProcesses'),
    complete:step('complete',v=>{receipt=v;})};
  return {operations,calls,receipt:()=>receipt};
}
test('legacy recovery requires a completed transaction barrier AND an unchanged original timer, never just a SELECT false',()=>{
  assert.equal(selectBookingRecoveryTarget({active:false,barrierCompleted:true,activationAttempted:false},{originalIntact:true}),'baseline');
  assert.equal(selectBookingRecoveryTarget({active:false,barrierCompleted:true,activationAttempted:true,originalRowsUntouched:true},{originalIntact:true}),'baseline');
  for(const [db,old]of [[{active:false},{originalIntact:true}],[{active:false,barrierCompleted:false},{originalIntact:true}],
    [{active:null,barrierCompleted:false},{originalIntact:true}],[{active:true,barrierCompleted:true},{originalIntact:true}],
    [{active:false,barrierCompleted:true},{originalIntact:false}],
    [{active:false,barrierCompleted:true,activationAttempted:true,originalRowsUntouched:false},{originalIntact:true}],
    [{active:false,barrierCompleted:true,activationAttempted:false,activationCommitted:true},{originalIntact:true}]])assert.equal(selectBookingRecoveryTarget(db,old),'rollback');
});
test('after committed activation recovery disables booking dispatch, pauses the old timer once, routes 6c and closes ingress',async()=>{
  const f=fixture(),r=await executeBookingFailureRecovery(f.operations,lease());
  assert.deepEqual(f.calls,['verify','parentGone','capture','databaseBarrier','legacyState','begin','disableBookingWorker','pauseLegacyOnce','route','unfence','publicProof','publicationMetadata','persistProcesses','complete']);
  assert.equal(r.target,A);assert.equal(r.phase,'rollback');assert.equal(r.gateClosed,true);assert.equal(r.normalHandoffCompleted,false);
});
test('proven inactive recovery restores original routing without restarting or resuming any timer',async()=>{
  const f=fixture({database:{active:false,barrierCompleted:true,activationAttempted:false}}),r=await executeBookingFailureRecovery(f.operations,lease());
  assert.equal(r.target,B);assert.equal(f.calls.includes('pauseLegacyOnce'),false);assert.equal(r.normalHandoffCompleted,false);
});
test('unknown DB outcome never routes the legacy website or attempts another authority change',async()=>{
  const f=fixture({database:{active:null,barrierCompleted:false}}),r=await executeBookingFailureRecovery(f.operations,lease());
  assert.equal(r.target,A);assert.equal(f.calls.includes('pauseLegacyOnce'),false);
});
test('already paused legacy host is not restarted twice, and uncertain prior pause is recorded as such',async()=>{
  const f=fixture({legacy:{paused:true,originalIntact:false}});await executeBookingFailureRecovery(f.operations,lease());assert.equal(f.calls.includes('pauseLegacyOnce'),false);
  const unknown=fixture();unknown.operations.pauseLegacyOnce=async()=>({confirmed:false,attempted:true,result:'unknown_no_retry'});
  const r=await executeBookingFailureRecovery(unknown.operations,lease());assert.equal(r.legacyPause.confirmed,false);assert.equal(r.normalHandoffCompleted,false);
});
test('a late gate closure is reported as late, never labelled as meeting the authorized window',async()=>{
  const f=fixture({completedAt:'2026-10-26T10:10:00.001Z'});const r=await executeBookingFailureRecovery(f.operations,lease());assert.equal(r.withinAuthorizedWindow,false);
});
for(const stage of ['verify','parentGone','capture','databaseBarrier','legacyState','begin','disableBookingWorker','pauseLegacyOnce','route','unfence','publicProof','publicationMetadata','persistProcesses','complete']){
  test('unknown '+stage+' is retained without replays or a normal completion certificate',async()=>{
    const f=fixture({failAt:stage});await assert.rejects(executeBookingFailureRecovery(f.operations,lease()),/unknown_/);
    assert.equal(f.calls.filter(c=>c===stage).length,1);assert.equal(f.receipt(),undefined);
  });
}
test('barrier and recovery expose no database writes, deactivation, old JSON restore, generic stop or duplicate RPC',()=>{
  assert.match(BOOKING_RECOVERY_BARRIER_SQL,/lock table public.pages/);assert.match(BOOKING_RECOVERY_BARRIER_SQL,/share row exclusive mode/);assert.match(BOOKING_RECOVERY_BARRIER_SQL,/rollback;/);
  assert.doesNotMatch(BOOKING_RECOVERY_BARRIER_SQL,/update|insert|delete|truncate|set active/i);
  const source=readFileSync(new URL('./booking-handoff-recovery.mjs',import.meta.url),'utf8');
  for(const token of ['assertBookingWatchdogInheritedLease','requireParentGone:true','worker-disabled-by-recovery.json','legacy-restart-attempt.json','existing_attempt_verified_without_replay',
    'rollback_actual_environment','rollback_listener','publicationMetadata','assertOnlineRetentionPersistedProcesses','normalHandoffCompleted:false'])assert.ok(source.includes(token),token);
  assert.doesNotMatch(source,/process\.kill|\['stop'|\['restart'|\['delete'|set active=false|set active=true|guardedProductionBooking/);
});
