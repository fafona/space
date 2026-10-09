// Additive pure-projection checks in the caller's already owned128 fixture.
// Importing starts no database, browser, listener or synthetic setup/writes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {lifecycleId as id} from './merchant-attendance-lifecycle-native-support.mjs';

const require=createRequire(import.meta.url);
const micros=value=>value.replace(/\.([0-9]{3})Z$/,'.$1000Z');
function objects(value,found=new Set()){
  if(!value||typeof value!=='object'||found.has(value))return found;
  found.add(value);for(const child of Object.values(value))objects(child,found);return found;
}
function detachedFrozen(source,result){
  const input=objects(source);
  for(const object of objects(result)){
    assert(Object.isFrozen(object),'schedule_evidence_result_not_deeply_frozen');
    assert(!input.has(object),'schedule_evidence_result_aliases_source');
  }
}
function envelope(result,source){
  assert.equal(result.protocol,'schedule-evidence-v1');assert.equal(result.applied,false);assert.equal(result.formalReady,false);
  for(const key of ['siteId','actorId','timeZone','readAt'])assert.equal(result[key],source[key]);
  assert.equal(result.workerId,source.worker.workerId);assert.equal(result.asOf,source.attendance.base.asOf);
  assert.equal(result.fromAt,micros(source.fromAt));assert.equal(result.toAt,micros(source.toAt));
  assert.deepEqual(result.views.map(view=>view.kind),['original','selected']);
  assert.deepEqual(result.coverage,{schedule:'complete',leave:'complete',calendar:'complete',identityChanged:false});
  for(const limitation of ['temporal_candidates_only','location_not_proven','historical_identity_not_proven','clock_rule_binding_not_loaded','current_sources_not_frozen'])assert(result.limitations.includes(limitation));
}

export async function checkAttendanceScheduleEvidenceNative(native,scope,data){
  assert.equal(data.syntheticOnly,true,'synthetic_fixture_required');assert.equal(data.sql,scope.sql,'caller_owned_scope_required');
  assert.equal(data.site,'99990001');assert.equal(data.owner,id(99));assert.equal(data.worker,id(201));
  const {resolveAttendanceScheduleEvidence}=require('../src/lib/merchantAttendanceScheduleEvidence.ts');
  const baseline=data.protectedFingerprint(),beforeReads=data.readCount();
  // Exactly two actual128 reads, each already parsed and independently protected
  // by the reused fixture's all-table fingerprint guard.
  const past=data.read(),future=data.read(data.futureQuery);
  assert.equal(data.readCount()-beforeReads,2,'schedule_evidence_unexpected_read_count');
  const pastBefore=JSON.stringify(past),futureBefore=JSON.stringify(future);
  const pastResult=resolveAttendanceScheduleEvidence(past),futureResult=resolveAttendanceScheduleEvidence(future);
  assert.equal(JSON.stringify(past),pastBefore,'schedule_evidence_mutated_past');assert.equal(JSON.stringify(future),futureBefore,'schedule_evidence_mutated_future');
  detachedFrozen(past,pastResult);detachedFrozen(future,futureResult);envelope(pastResult,past);envelope(futureResult,future);

  const original=pastResult.views.find(view=>view.kind==='original'),selected=pastResult.views.find(view=>view.kind==='selected');
  assert.equal(original.records.length,3);assert.equal(selected.records.length,4);assert(original.records.every(row=>row.kind==='original'));
  const corrected=selected.records.find(row=>row.startEventId===id(8101));assert(corrected);assert.equal(corrected.kind,'approved');
  assert.equal(corrected.operationId,id(8113));assert.equal(corrected.startAt,micros(data.at(-1,'02:00')));assert.equal(corrected.endAt,micros(data.at(-1,'03:30')));
  assert.equal(original.records.find(row=>row.startEventId===id(8101)).startAt,micros(data.at(-1,'01:00')));
  const missing=selected.records.find(row=>row.kind==='missing-approved');assert(missing);assert.equal(missing.referenceId,id(8203));
  assert.equal(missing.operationId,id(8204));assert.equal(missing.startEventId,null);assert.equal(missing.revision,null);
  for(const view of [original,selected]){
    const open=view.records.find(row=>row.startEventId===id(8105));assert(open);assert.equal(open.endAt,null);
    assert.equal(open.observedUntilAt,past.attendance.base.asOf);assert(open.reasons.includes('open_record'));assert.equal(open.timeDifference,null);
    assert.equal(view.schedules.length,0);assert(view.records.every(row=>row.candidateScheduleIds.length===0&&row.timeDifference===null));
  }
  assert.equal(pastResult.slots.length,0);

  assert.equal(futureResult.slots.length,2);const live=futureResult.slots.filter(slot=>!slot.cancelled),cancelled=futureResult.slots.filter(slot=>slot.cancelled);
  assert.equal(live.length,1);assert.equal(cancelled.length,1);const carry=live[0];
  assert.equal(carry.startAt,micros(data.at(2,'22:00')));assert.equal(carry.endAt,micros(data.at(3,'06:00')));
  assert.equal(carry.windowPartial,true);assert.equal(carry.phase,'future');assert.equal(carry.locationId,data.location);
  assert.equal(cancelled[0].startAt,micros(data.at(3,'10:00')));
  for(const view of futureResult.views){
    assert.deepEqual(view.records,[]);assert.equal(view.schedules.length,1);assert.equal(view.schedules[0].id,carry.id);
    assert.equal(view.schedules[0].relation,'no-time-candidate');assert.deepEqual(view.schedules[0].recordKeys,[]);
  }
  assert.deepEqual(carry.calendar.map(item=>item.entryId).sort(),[id(7401),id(7403)].sort());
  assert.equal(carry.calendar.find(item=>item.entryId===id(7401)).status,'cancelled');
  assert.equal(carry.calendar.find(item=>item.entryId===id(7403)).status,'created');
  for(const slot of futureResult.slots)for(const hint of slot.calendar){
    assert(hint.locationId===null||hint.locationId===slot.locationId,'calendar_scope_widened');
    assert(hint.fromAt>=futureResult.fromAt&&hint.toAt<=futureResult.toAt&&hint.fromAt<hint.toAt,'calendar_intersection_not_query_bounded');
  }
  assert.deepEqual(carry.leave.map(item=>item.requestId),[id(7301)]);assert.equal(carry.leave[0].status,'cancelled');
  assert.equal(carry.leave[0].fromAt,futureResult.fromAt);assert.equal(carry.leave[0].toAt,carry.endAt);
  assert.equal(data.readCount()-beforeReads,2);assert.equal(data.protectedFingerprint(),baseline,'schedule_evidence_changed_SQL_facts');
  native.pass('schedule evidence actual128 past separates original latest correction whole-missing and unclosed records without mutation');
  native.pass('schedule evidence actual128 future preserves cancelled plans and UTC carry-in with query-clipped correctly scoped context, not absence');
  return {checks:2,sourceReads:2,businessWrites:0,actualSourcesSql:true,projectionOnly:true,formalAssessmentPerformed:false,
    shiftRuleBindingsLoaded:false,allTableFingerprintsUnchanged:true,syntheticOnly:true};
}
