import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {verifyWorkArrangementCapacityNative,workArrangementCapacityFixturePlan} from './attendance-work-arrangements-capacity-native.mjs';
const source=readFileSync(new URL('./attendance-work-arrangements-capacity-native.mjs',import.meta.url),'utf8');
const home={settingsVersion:7,policy:{revision:3},timeZone:'Europe/Madrid',readAt:'2026-10-06T12:00:00.000001Z'};
const worker='00000000-0000-4000-8000-000000000123';

test('capacity fixture is inert and rejects non-owned inputs before runtime',async()=>{
  let called=false;
  await assert.rejects(verifyWorkArrangementCapacityNative({d:{syntheticOnly:false},native:{query(){called=true;}}}));
  assert.equal(called,false);
  assert.doesNotMatch(source,/spawn\(|execFile|pg_ctl|initdb|disable trigger|session_replication_role|statement_timeout|create table|alter table/i);
  for(const text of ['assertLifecycleSandbox','assert.deepEqual(owned,d.owned)','assert.equal(owned.schema,scope.schema)',
    'h.workerId,d.otherWorker','h.employeeAuthUserId,d.otherAuth'])assert(source.includes(text),text);
});

test('bounded pure plan uses actual home versions and 203 distinct paired-copy identities',()=>{
  const p=workArrangementCapacityFixturePlan(home,worker);
  assert.equal(p.command.expectedPolicyRevision,3);assert.equal(p.command.expectedSettingsVersion,7);
  assert.equal(p.command.expectedWorkerId,worker);assert.equal(p.command.timeZone,'Europe/Madrid');
  assert.equal(p.ids.length,204);assert.equal(new Set(p.ids).size,204);
  assert.equal(p.unrelated.length,101);assert.equal(p.related.length,99);assert.equal(p.adjacent.length,2);
  assert.equal(p.span.startAt,'2027-01-04T09:00:00.000Z');
  assert.equal(p.command.operationId,p.ids[0]);assert(p.unrelated.every(row=>row.endAt<p.span.startAt));
  assert(p.related.every(row=>row.startAt===p.span.startAt&&row.endAt===p.span.endAt));
  assert.equal(p.adjacent[0].endAt,p.span.startAt);assert.equal(p.adjacent[1].startAt,p.span.endAt);
  assert.equal(p.overflow.startAt,p.span.startAt);assert.equal(p.overflow.endAt,p.span.endAt);
  assert.throws(()=>workArrangementCapacityFixturePlan({...home,policy:{revision:-1}},worker));
});

test('real template precedes paired copies; all copy receipts and deferred constraints are validated',()=>{
  for(const text of ['set local role service_role;select jsonb_build_object',
    'public.faolla_attendance_work_arrangement_v1(', '${json(wq())},${auth},${json(plan.command)},true',
    'expectedPolicyRevision:home.policy.revision','wa_entry.operation_id:=wa_request.request_id',
    "'operationId',wa_request.request_id,'startAt',wa_copy->>'startAt','endAt',wa_copy->>'endAt','reason',wa_request.reason",
    "'requestId',wa_request.request_id,'startAt',wa_copy->>'startAt','endAt',wa_copy->>'endAt'",
    'faolla_attendance_work_arrangement_summary_v1(wa_request)',
    'set constraints all immediate;set constraints all deferred;', 'rows.length<=10',
    "conname='attendance_work_arrangement_submit_fk' and condeferrable and condeferred",
    'public.merchant_attendance_settings where merchant_id=${site} for update',
    'public.merchant_attendance_workers where merchant_id=${site} and id=${worker} for update',
    "const counts=`${prefix}set constraints all immediate;"])assert(source.includes(text),text);
  assert.doesNotMatch(source,/update public\.|delete from public\.|grant\s/i);
});

test('both real helpers prove exact related IDs at 100 and exact errors at 101 without read writes',()=>{
  for(const text of ['faolla_attendance_work_arrangement_context_v1','faolla_attendance_work_arrangement_conflicts_v1',
    "...checkPair('empty_target')","...checkPair('one_real_template')","...checkPair('unrelated_101_and_half_open_edges')",
    "...checkPair('exact_100')","reject('context'),reject('conflicts')",'assert.equal(successful.length,8)',
    "assert.deepEqual(actual,[...expected[row.label]].sort()",'assert.equal(before.hash,after.hash',
    "if sqlerrm<>'attendance_work_arrangement_too_large' then raise",'assert ${allHash}=wa_before_hash',
    'privateSuccessfulReads:8','exactTooLargeRejections:2'])assert(source.includes(text),text);
});

test('one bounded rollback preserves old rows including prior arrangements and archived bytes',()=>{
  for(const text of ["const steps=['begin;'",'steps.length<=40',"mark('protected_after')+'rollback;'",
    'wa_cap_row.request_id=any(array[${excluded}])','cap_table_name,cap_table_rows order by cap_table_name','wa_cap_fact_rows',
    'finally{',"['capacity_rollback_all_facts',()=>d.fingerprint(),baseline]","['capacity_definitions',()=>d.definitions(),defs]",
    "['capacity_catalog',()=>d.tableCatalog(),catalog]",'new AggregateError(failures','capacity_old_rows_and_archives_changed',
    'actualRpcSubmissions:1,syntheticRequestCopies:203,syntheticSubmitEntryCopies:203,syntheticCopyRows:406',
    'privilegedPrivateHelperProbe:true','actualMassUserSubmissions:false','productionPerformanceProven:false'])assert(source.includes(text),text);
  assert.doesNotMatch(source,/declare[^;]*\b(?:cap_table_name|cap_table_rows|wa_cap_row|wa_cap_fact_rows)\b/);
  for(const count of ["'requests'","'entries'"]){
    const line=source.split(/\r?\n/).find(value=>value.trim().startsWith(count+',('));assert(line);
    assert(line.includes("plan.ids.map(value=>quote(value)+'::uuid').join(',')"),'count_uuid_array:'+count);
  }
});
