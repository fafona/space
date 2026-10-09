//Pure plan and bounded static integration checks, never database acceptance.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
import {createOutageReviewsNativePlan,outageReviewsNativeTables} from './attendance-outage-reviews-native.mjs';
const source=readFileSync(new URL('./attendance-outage-reviews-native.mjs',import.meta.url),'utf8');
const input={site:'99990001',owner:id(1),employee:id(2),auth:id(3),worker:id(4),location:id(5),workerVersion:8,employeeVersion:4,generation:2,
 sealedStart:'2026-10-04T14:00:00.000Z',sealedEnd:'2026-10-04T16:00:00.000Z',startAt:'2026-10-05T09:40:00.000000Z',endAt:'2026-10-05T09:45:00.000000Z',
 now:'2026-10-07T12:00:00.000000Z',originalOperationId:id(204712)};
test('plans distinguish absent, historically known and unverified original operations without clocks',()=>{
 const none=createOutageReviewsNativePlan(input),known=createOutageReviewsNativePlan(input,'known_original'),unknown=createOutageReviewsNativePlan(input,'unknown_original');
 for(const p of [none,known,unknown]){
  assert.equal(p.declaration.workerId,input.worker);assert.equal(p.declaration.employeeId,input.employee);assert.equal(p.declaration.employeeAuthUserId,input.auth);
  assert.equal(p.declaration.expectedWorkerVersion,8);assert.equal(p.declaration.expectedEmployeeVersion,4);assert.equal(p.declaration.expectedGeneration,2);
  assert.equal(p.declaration.interval.startAt,'2026-10-04T14:00:00.000000Z');assert.equal(p.declaration.interval.endAt,'2026-10-05T10:00:00.000000Z');
  assert.deepEqual(p.incident.interval,p.declaration.interval);assert.equal(p.reference.startEventId,id(204710));assert.equal(p.reference.effectOperationId,null);
  assert.deepEqual(Object.keys(p.q()).sort(),['access','declarationId','mode','siteId']);
  assert.equal(p.q('history','self',2).beforeRevision,2);assert.equal(p.q('recover','owner',p.fresh(10)).operationId,p.fresh(10));
 }
 assert.equal(none.declaration.originalOperationId,null);assert.equal(none.declaration.originalChannel,null);
 assert.equal(known.declaration.originalOperationId,input.originalOperationId);assert.equal(known.declaration.originalChannel,'web');
 assert.notEqual(unknown.declaration.originalOperationId,input.originalOperationId);assert.equal(unknown.declaration.originalChannel,'web');
 assert.equal(new Set([none,known,unknown].map(p=>p.declaration.declarationId)).size,3);
 assert.throws(()=>createOutageReviewsNativePlan(input,'invented'));assert.throws(()=>createOutageReviewsNativePlan({...input,now:input.startAt}));
 assert.deepEqual(outageReviewsNativeTables,['merchant_attendance_outage_review_operations']);
});
test('all runtime surfaces stay caller owned, bounded and inert on import',()=>{
 for(const token of ['assertLifecycleSandbox','assert.deepEqual(owned,d.owned)','h?.syntheticOnly===true','d.guard','native.querySteps(steps.map(sql=>scope.sql(sql)))','steps.length<=70'])assert(source.includes(token),token);
 for(const forbidden of ['native.connect(','initdb','CREATE DATABASE','pg_dump','spawn(','listen(','disable trigger','session_replication_role','set statement_timeout','set lock_timeout','supabase.co'])assert(!source.includes(forbidden),forbidden);
});
test('real176 and177 precede178; command CAS comes only from returned current detail',()=>{
 assert(source.indexOf("call('incident'")<source.indexOf("call('propose'"));assert(source.indexOf("call('link_apply'")<source.indexOf("call('propose'"));
 for(const token of ['public.faolla_attendance_outage_v1(','public.faolla_attendance_outage_links_v1(','public.faolla_attendance_outage_review_v1(',
  "'expectedRevision',${saved(basis)}->'revision'","'expectedResultVersion',${saved(basis)}->'resultVersion'","->'status'->'basisFingerprint'","->'proposal'->'resultFingerprint'",
  'review_query:=${q};review_command:=${c};set local role service_role;'])assert(source.includes(token),token);
 assert.match(source,/set constraints all immediate;set constraints all deferred;reset role/);
});
test('each result uses actual projectors and commands, with labeled failures',()=>{
 for(const token of ['projectOutageReviewResult(row.value,row.query,row.actor,row.command)','projectOutageLinksResult(row.value,row.query,row.actor,row.command)',
  'projectOutageResult(row.value,row.query,row.actor,row.command)','parseOutageReviewCommand(row.command)',"'outage_reviews_projection_failed:'+group+':'+row.label",'{cause:error}'])assert(source.includes(token),token);
});
test('real old source changes preserve current seal, canonical timestamps and actual approval evidence',()=>{
 for(const token of ['public.faolla_attendance_period_session_v1(',"[[startId,3,'clock_in'],[endId,4,'clock_out']]",'outage_reviews_old_writer_range_must_not_be_sealed',
  'outage_reviews_utc6_proposal_required','public.faolla_attendance_correction_self_v3(','merchant_attendance_correction_rule_bindings',
  'public.faolla_attendance_correction_decide_v2(',"->'review'->'item'->'revision'",'expectedEvidence','effectRevision:1'])assert(source.includes(token),token);
 for(const forbidden of ['insert into public.merchant_attendance_events','update public.merchant_attendance_events','set sealed=','set accepted_at='])assert(!source.includes(forbidden),forbidden);
 assert(source.includes('syntheticHistoricalOriginalEvent:true,actualHistoricalClockRequests:false,newSyntheticClockRows:0'));
});
test('source invalidation is dynamic while proposal and original recovery stay immutable',()=>{
 for(const token of ["['pending_detail','changed_detail']",'assert.deepEqual(parsed.get(label).proposal,proposal)',
  "parsed.get(label).current,parsed.get('resolve').receipt.entry","status.blockers.includes('pending_source')","status.blockers.includes('source_changed')",
  "parsed.get('resolve_recover_after_pending').receipt,parsed.get('resolve').receipt",'assert.notEqual(next.resultFingerprint,proposal.resultFingerprint)',
  "['proposal_replay_off','proposal_recover_off','old_proposal_after_all']"])assert(source.includes(token),token);
});
test('real employee dispute blocks resolve and reopen requires a new explicit confirmation',()=>{
 for(const token of ["'dispute_blocks_resolve'","'reopened_requires_new_confirmation'","'unknown_original_confirm'","'unknown_original_resolve'",
  "'confirm_after_dispute'","'final_reopen'","'new_self_proposal').response,null","'confirm').receipt.entry.actorId,h.employeeAuthUserId",
  "'resolve').receipt.entry.actorId,d.owner","status.blockers.includes('original_unknown')"])assert(source.includes(token),token);
 assert(source.indexOf("call('reopen'")<source.indexOf("call('new_propose'"));
});
test('every read, replay and rejection has a full hash check; fresh writes use exact table scopes',()=>{
 for(const token of ['write&&!replay?protect(',"assert review_after=review_before,'outage_reviews_read_or_protected_facts_changed'",
  "assert ${fullHash}=review_before,'outage_reviews_rejected_write'",'assert.equal(row.before,row.after)',
  "'self_permission_revoked'","'employee_cannot_owner_read'","'other_merchant'","'fresh_gate_off'","'same_operation_conflict'","'unknown_recovery'"])assert(source.includes(token),token);
});
test('all scenarios roll back, preserve both archives and verify real history without period claims',()=>{
 for(const token of ['new AggregateError(failures','outage_reviews_rollback_',
  'archive().artifactText,oldArchive.artifactText','archive().artifactSha256,oldArchive.artifactSha256',
  'periodArchive().artifactText,sealedArchive.artifactText','periodArchive().artifactSha256,sealedArchive.artifactSha256',
  '));rollback;','Array.from({length:counts.reviews}',"parsed.get('self_history').history.map(e=>e.revision),[1]",
  "await scenario('no_original');await scenario('known_original');await scenario('unknown_original')",
  'periodOutageGateImplemented:false,productionUiImplemented:false'])assert(source.includes(token),token);
});
