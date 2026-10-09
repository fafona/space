// Additive, inert local acceptance module. The caller alone owns PostgreSQL,
// the synthetic namespace and the bounded native connection pool.
import assert from 'node:assert/strict';
import {assertLifecycleSandbox,lifecycleId,lifecycleJson,lifecycleRace} from './merchant-attendance-lifecycle-native-support.mjs';

export const shiftCheckRaceLabels=Object.freeze([
  '138 read retains settings SHARE and blocks an exact-PID settings FOR UPDATE waiter',
  '138 read retains worker SHARE and blocks an exact-PID worker FOR UPDATE waiter',
  'committed synthetic owner transfer makes the already-waiting138 old-owner read fail and guarded restoration preserves all facts',
]);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Pure SQL plan; no connection is created by importing or calling this helper.
export function shiftCheckRacePlan(owned,{siteId,ownerId,workerId,startEventId}){
  assert(owned&&/^attendance_race_[a-f0-9]{32}$/.test(owned.schema)&&owned.owner==='postgres'
    &&/^faolla-synthetic-concurrency:[a-f0-9-]{36}$/.test(owned.marker)
    &&Number.isSafeInteger(owned.oid)&&owned.oid>0&&Number.isSafeInteger(owned.tableOid)&&owned.tableOid>0,
  'shift_check_races_owned_schema_required');
  assert.match(siteId,/^\d{8}$/);
  for(const value of [ownerId,workerId,startEventId])assert.match(value,uuid);
  const replacementOwner=lifecycleId(162990);
  assert.notEqual(ownerId,replacementOwner,'shift_check_races_distinct_owner_required');
  const query=Object.freeze({siteId,workerId,startEventId});
  const guard=`reset role;do $owned$ begin
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.oid='public.merchants'::regclass and c.oid=${owned.tableOid} and n.oid=${owned.oid}
      and n.nspname='${owned.schema}' and n.nspowner::regrole::text='postgres'
      and obj_description(n.oid,'pg_namespace')='${owned.marker}')
    then raise exception 'shift_check_races_owned_schema_required';end if;end;$owned$;`;
  const read=`${guard}set local role service_role;
    select public.faolla_attendance_shift_check_v1(${lifecycleJson(query)},'${ownerId}');`;
  const settingsWaiter=`${guard}select merchant_id from public.merchant_attendance_settings
    where merchant_id='${siteId}' for update;`;
  const workerWaiter=`${guard}select id from public.merchant_attendance_workers
    where merchant_id='${siteId}' and id='${workerId}' for update;`;
  const ownerHolder=`${guard}do $transfer$ declare changed integer;begin
    update public.merchants set user_id='${replacementOwner}' where id='${siteId}' and user_id='${ownerId}';
    get diagnostics changed=row_count;
    assert changed=1,'shift_check_races_owner_compare_and_set';end;$transfer$;`;
  const restore=`${guard}do $restore$ declare current_owner uuid;changed integer;begin
    select user_id into current_owner from public.merchants where id='${siteId}' for update;
    if not found or (current_owner is distinct from '${ownerId}'::uuid
      and current_owner is distinct from '${replacementOwner}'::uuid)
    then raise exception 'shift_check_races_restore_identity_mismatch';end if;
    if current_owner='${replacementOwner}'::uuid then
      update public.merchants set user_id='${ownerId}' where id='${siteId}' and user_id='${replacementOwner}';
      get diagnostics changed=row_count;
      assert changed=1,'shift_check_races_restore_compare_and_set';end if;end;$restore$;`;
  return Object.freeze({query,replacementOwner,guard,read,settingsWaiter,workerWaiter,ownerHolder,restore});
}

function withoutObservation(raw){
  const copy=structuredClone(raw);
  assert.equal(copy.protocol,'shift-check-source-v1');
  assert(copy.binding&&typeof copy.binding==='object');
  delete copy.asOf;delete copy.binding.readAt;
  return copy;
}

export async function checkAttendanceShiftCheckRaces(native,scope,d){
  for(const method of ['connect','query','pass'])assert.equal(typeof native[method],'function');
  for(const method of ['exec','readRaw','fingerprint','definitions','sql'])assert.equal(typeof d[method],'function');
  assert.equal(scope.schema,d.owned.schema,'shift_check_races_scope_mismatch');
  assert.equal(scope.sql,d.sql,'shift_check_races_rewriter_mismatch');
  assert.deepEqual(assertLifecycleSandbox(d.exec),d.owned);
  const plan=shiftCheckRacePlan(d.owned,{siteId:d.site,ownerId:d.owner,workerId:d.worker,startEventId:d.anchors.verified});
  const connection={connect:native.connect,query:native.query,sql:scope.sql};
  const facts=d.fingerprint(),definitions=d.definitions();
  let transferAttempted=false;
  try{
    const before=withoutObservation(d.readRaw(plan.query,d.owner));
    // These are real UPDATE-lock attempts, not real settings edits, correction
    // approvals, clocks or worker edits. No business writer is invoked here.
    const settings=await lifecycleRace(connection,plan.read,plan.settingsWaiter);
    assert.equal(settings.witnessed,true);assert.equal(settings.right.error,null);
    assert.equal(settings.right.output,d.site);
    assert.deepEqual(withoutObservation(JSON.parse(settings.left)),before);
    assert.equal(d.fingerprint(),facts);assert.equal(d.definitions(),definitions);
    native.pass(shiftCheckRaceLabels[0]);

    const worker=await lifecycleRace(connection,plan.read,plan.workerWaiter);
    assert.equal(worker.witnessed,true);assert.equal(worker.right.error,null);
    assert.equal(worker.right.output,d.worker);
    assert.deepEqual(withoutObservation(JSON.parse(worker.left)),before);
    assert.equal(d.fingerprint(),facts);assert.equal(d.definitions(),definitions);
    native.pass(shiftCheckRaceLabels[1]);

    transferAttempted=true;
    const owner=await lifecycleRace(connection,plan.ownerHolder,plan.read);
    assert.equal(owner.witnessed,true);assert.equal(owner.right.output,null);
    assert(owner.right.error instanceof Error,'shift_check_races_old_owner_must_fail');
    assert.match(String(owner.right.error),/ERROR:\s+attendance_access_denied(?:\s|$)/);
  }finally{
    // lifecycleRace has already closed/drained both exact sessions. Restore
    // only this owned merchant and only the old/synthetic expected identity.
    if(transferAttempted)d.exec(plan.restore);
    assert.equal(d.fingerprint(),facts,'shift_check_races_changed_facts');
    assert.equal(d.definitions(),definitions,'shift_check_races_changed_definitions');
  }
  const restored=d.readRaw(plan.query,d.owner);
  assert.equal(restored.binding.actorId,d.owner);
  assert.equal(d.fingerprint(),facts);assert.equal(d.definitions(),definitions);
  native.pass(shiftCheckRaceLabels[2]);
  return {checks:shiftCheckRaceLabels.length,exactPidLockWitnesses:3,successfulReads:4,deniedReads:1,
    settingsUpdateLock:true,workerUpdateLock:true,syntheticOwnerTransfer:true,ownerRestored:true,
    actualApprovalRace:false,actualClockRace:false,factsUnchanged:true,definitionsUnchanged:true,
    realAuthentication:false,productionAccess:false,newCluster:false};
}
