//208 source/contract regression only; this does not execute PostgreSQL races.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const source=readFileSync(new URL('./attendance-plan-posthoc-concurrency-native.mjs',import.meta.url),'utf8');
const has=(...parts)=>parts.forEach(part=>assert(source.includes(part),part));
const ordered=(...parts)=>{let index=-1;for(const part of parts){const next=source.indexOf(part,index+1);assert(next>index,part);index=next;}};

test('208 imports inertly and only consumes the parent-owned sandbox/runtime',async()=>{
  assert.equal(typeof(await import('./attendance-plan-posthoc-concurrency-native.mjs')).verifyPlanPosthocConcurrencyNative,'function');
  has('assertLifecycleSandbox(sql=>native.query(scope.sql(sql)))','assert.equal(scope.schema,d.owned.schema)','callerOwnsRuntimeAndCleanup:true');
  assert.doesNotMatch(source,/initdb|CREATE DATABASE|pg_dump|npm run build|supabase\.co|child_process|process\.env|process\.argv|disable trigger|delete from|drop (?:table|trigger|function)/i);
});

test('six different races use exact blocker PID and the committed winner hash, not sleep as evidence',()=>{
  const cases=[...source.matchAll(/await race\('([^']+)'/g)].map(match=>match[1]);
  assert.deepEqual(cases,['leave_approve_vs_review','correction_approve_vs_review','period_seal_vs_review','review_vs_period_seal','missing_approve_vs_review','two_plans_same_missing_root']);
  ordered('const raced=await lifecycleRace','assert.equal(raced.witnessed,true,label)','assert(raced.right.error,label)',"assert.equal(all(),committedHash,label+':failed_waiter_zero_residue')");
  const support=readFileSync(new URL('../merchant-attendance-lifecycle-native-support.mjs',import.meta.url),'utf8');
  assert(support.includes('select pg_backend_pid()')&&support.includes('pg_blocking_pids(pid)'));
});

test('source-changing holders are real old writers with fresh evidence and actual approval commands',()=>{
  has('executeLeave','executeAttendanceMissing','parseCurrentCorrectionDecision',"assert(correctionView.canApprove,JSON.stringify(correctionView.blockers))",
    'expectedEvidence:correctionView.evidenceToken','evidenceToken:v.detail.evidenceToken','supersedesRequestId:parent.requestId',
    'expectedApprovalOperationId:parent.approvalOperationId',"assert(review().detail.current.blockers.includes('pending_correction'))",
    "assert(review().detail.current.blockers.includes('pending_missing'))");
  assert.equal((source.match(/'attendance_plan_exception_review_source_changed'/g)||[]).length,3);
  assert.doesNotMatch(source,/insert into public\.merchant_attendance_(?:leave|missing|correction|revision)_(?:requests|entries|decisions|effects|effect_versions)/i);
});

test('both period directions use send and self-confirm first and keep sealed guard exact',()=>{
  ordered("async function race(","const confirmCurrent=async()=>", "pc('send',v,preview.preview.artifact.sourceFingerprint)","pc('confirm',v)",
    "await race('period_seal_vs_review'","'attendance_period_sealed'","pc('reopen',closed)","await race('review_vs_period_seal'","'attendance_period_source_changed'");
  has('assert.equal(closed.sourceChanged,true)','assert.equal(closed.period.sealed,false)');
  assert.doesNotMatch(source,/update public\.merchant_attendance_period_closures|sealed\s*=\s*(?:true|false)/i);
});

test('the only direct inserts are six new guarded adjacent historical plan records',()=>{
  assert.deepEqual([...source.matchAll(/insert into public\.([a-z_]+)/g)].map(match=>match[1]),[
    'merchant_attendance_schedule_commands','merchant_attendance_schedule_slots','merchant_attendance_schedule_publication_evidence',
    'merchant_attendance_plan_rule_artifacts','merchant_attendance_plan_rule_operations','merchant_attendance_plan_rule_streams']);
  has('set constraints all deferred','set constraints all immediate',"'208_adjacent_history_no_overlap'",'assert.equal(secondSlot.startAt,h.slot.endAt)',
    'public.faolla_attendance_period_plan_rule_v1','public.faolla_attendance_self_schedule_slot_v1','actualPastPublication:false','actualPastApproval:false');
  assert.doesNotMatch(source,/update public\.|delete from public\./i);
});

test('cross-plan contention retains one root claim until explicit release and does not silently retarget',()=>{
  ordered("await race('two_plans_same_missing_root'","contested.blockers.includes('claimed_elsewhere')",'assert.equal(contested.claim.slotId,h.slot.id)',
    '/attendance_plan_posthoc_adoption_blocked/','release();adopt(applyCommand(adoption(slotId),[revised.reference]),slotId);release(slotId)',
    'const restored=await prepareMissing(revised.reference','reapply();assert(review().detail.current.eligible)');
  has('changed.detail.current.source.evaluation.posthoc.selected,beforeMissing.detail.current.source.evaluation.posthoc.selected');
});

test('every pre-existing row except exact legitimate projections and every old archive byte is protected',()=>{
  has("merchant_attendance_period_closures:[['period_id',[periodId]]]","merchant_attendance_plan_posthoc_claims:[['source_id',[sessionRef.startEventId,missingRef.rootRequestId]]]",
    "'208_all_preexisting_rows_preserved_except_exact_claim_and_period_projections'","'208_same_duration_declared_sources_do_not_change_total_minutes'",
    'assert.equal(d.definitions(),defs)','assert.equal(d.tableCatalog(),catalog)','archive().artifactText,oldBytes.artifactText','archive().artifactSha256,oldBytes.artifactSha256',
    'syntheticHistory:{merchant_attendance_schedule_commands');
  assert.doesNotMatch(source,/filter\(.*(?:missing|correction|plan_rule|leave).*includes\(t\)/);
});
