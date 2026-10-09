//Only pure plan and static bridge checks. Native correctness remains root-run.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
import {createOutagePeriodNativePlan,outagePeriodWriteTables} from './attendance-outage-periods-native.mjs';
const source=readFileSync(new URL('./attendance-outage-periods-native.mjs',import.meta.url),'utf8');
const input={site:'99990001',employee:id(2),auth:id(3),worker:id(4),location:id(5),workerVersion:8,employeeVersion:4,generation:2,
 sealedStart:'2026-10-04T14:00:00.000Z',sealedEnd:'2026-10-04T16:00:00.000Z',startAt:'2026-10-05T09:40:00.000000Z',endAt:'2026-10-05T09:45:00.000000Z',now:'2026-10-07T12:00:00.000000Z'};
test('both real declaration intents bind current identity and explicitly span seal and linked source',()=>{
 const p=createOutagePeriodNativePlan(input);
 assert.equal(p.declaration.employeeId,input.employee);assert.equal(p.declaration.employeeAuthUserId,input.auth);assert.equal(p.declaration.workerId,input.worker);
 assert.equal(p.declaration.expectedWorkerVersion,8);assert.equal(p.declaration.expectedEmployeeVersion,4);assert.equal(p.declaration.expectedGeneration,2);
 assert.equal(p.declaration.interval.startAt,'2026-10-04T14:00:00.000000Z');assert.equal(p.declaration.interval.endAt,'2026-10-05T10:00:00.000000Z');
 assert.deepEqual(p.incident.interval,p.declaration.interval);assert.deepEqual(p.second.interval,p.declaration.interval);
 assert.notEqual(p.second.declarationId,p.declaration.declarationId);assert.notEqual(p.second.operationId,p.declaration.operationId);
 assert.equal(p.second.incidentId,p.incident.incidentId);assert.equal(p.declaration.originalOperationId,null);assert.equal(p.declaration.originalChannel,null);
 assert.equal(p.reference.startEventId,id(204710));assert.equal(p.reference.effectOperationId,null);
 assert.throws(()=>createOutagePeriodNativePlan({...input,now:input.startAt}));
 assert.deepEqual(outagePeriodWriteTables,['merchant_attendance_period_closures','merchant_attendance_period_artifacts','merchant_attendance_period_versions','merchant_attendance_period_entries']);
});
test('the transaction never mutates upper one-shot closures or starts an environment',()=>{
 const labels=[...source.matchAll(/call\('([^']+)'/g)].map(match=>match[1]);
 assert(labels.length>20);assert.equal(new Set(labels).size,labels.length);
 for(const label of labels)assert.match(label,/^[a-z_]+$/,'every generated label must satisfy the runtime guard');
 for(const token of ['assertLifecycleSandbox','h?.syntheticOnly===true','d.guard','native.querySteps(steps.map(sql=>scope.sql(sql)))','steps.length<=60'])assert(source.includes(token),token);
 for(const token of ['native.connect(','ctx.reopen(','ctx.seal(','initdb','CREATE DATABASE','pg_dump','spawn(','listen(','disable trigger','session_replication_role','set statement_timeout','set lock_timeout'])assert(!source.includes(token),token);
 assert(source.includes("call('reopen',{command:pc(100,'reopen','original_detail')"));assert(source.includes('));rollback;'));
});
test('SQL artifact bridge reuses only unchanged real computed work and actual current source fields',()=>{
 for(const token of ['projectPeriodClosureSource(sourceBefore',"baselineArtifact.report.base.openSessionCount,0",'baselineArtifact.report.base.periodInProgress,false',
  "((period_source->'sourceCanonical')-'context'-'sourceVersion')=${json(sourceScope)}",
  "((period_source->'sourceCanonical'->'context')-'outages')=${json(originalSource.context)}",
  "period_source->'dayBoundaries'=${json(baselineArtifact.dayBoundaries)}",'outage_period_report_or_frame_changed','outage_period_source_time_regressed',
  "'{report,base,asOf}',period_source->'report'->'base'->'asOf'",'outage_period_expected_new_operation'])assert(source.includes(token),token);
 assert(!source.includes("'reason','Synthetic215 '+"));assert(!source.includes("'reason','Synthetic215 explicit period '+"));
});
test('each captured send is verified through real service recovery-source-write ordering',()=>{
 for(const token of ["row.recoveryError,'attendance_operation_not_found'",'assert(recoveryUsed)','assert(sourceUsed)',
  "a.p_artifact,row.artifact,'outage_period_real_projector_matches_actual_sent_artifact'",'executePeriodClosures(input,service)',
  'executePeriodClosures(input,replayService)','assert.deepEqual(a.p_command,row.command)',"'outage_period_projection_failed:'+row.label",'{cause:error}'])assert(source.includes(token),token);
 assert(source.includes("'source',period_source,'artifact',period_artifact,'recoveryError',period_recovery_error"));
});
test('gates are tested on a valid existing period, not masked by already-sealed state',()=>{
 assert(source.indexOf("call('reopen'")<source.indexOf("call('unresolved_send_denied'"));
 assert(source.indexOf("call('clean_confirm'")<source.indexOf("call('declaration'"));
 for(const token of ["'unresolved_send_denied'","error:'attendance_period_blocked'","'old_confirm_denied'","'old_seal_denied'",
  "error:'attendance_period_source_changed'","'seal_without_reconfirmation'","error:'attendance_period_not_confirmed'",
  "'resolved_send').period.confirmedVersion,null","'reconfirm').period.confirmedVersion,savedVersion"])assert(source.includes(token),token);
});
test('outage resolve is real176-177-178 and fresh period self confirmation is independent',()=>{
 for(const token of ['public.faolla_attendance_outage_v1(','public.faolla_attendance_outage_links_v1(','public.faolla_attendance_outage_review_v1(',
  "call('confirm_review'","call('resolve_review'","call('reconfirm'","call('reseal'",'projectOutageReviewResult(row.value,row.query,row.actor,row.command)'])assert(source.includes(token),token);
 assert(source.indexOf("call('resolve_review'")<source.indexOf("call('resolved_send'"));
 assert(source.indexOf("call('reconfirm'")<source.indexOf("call('reseal'"));
});
test('owner and self preserve their actual no-outage blockers, including legacy self review limits',()=>{
 for(const token of ["Object.fromEntries(['owner','self'].map(access=>",'json(sourceQ(access))',"${access==='owner'?owner:auth}",
  'legacySources[access]',"projectPeriodClosureSource(sourceBefore,q('preview',access))",
  "assert.equal(d.fingerprint(),baseline,'outage_period_baseline_read_zero_writes_'+access)",
  "assert(!preview.blockers.includes('unresolved_outage')",
  "['unresolved_preview','owner'],['unresolved_self_preview','self']","['later_preview','owner']",
  "parsed.get(label).preview.blockers,[...baselinePreviews[access].blockers,'unresolved_outage'],label",
  "['resolved_preview','owner'],['resolved_self_preview','self']",
  'parsed.get(label).preview.blockers,baselinePreviews[access].blockers,label'])assert(source.includes(token),token);
 assert(!source.includes('parsed.get(label).preview.blockers,[]'));
 assert(!source.includes('blockers.filter('));
});
test('later declaration changes live source but never rewrites fixed versions or original operations',()=>{
 assert(source.indexOf("call('later_declaration'")>source.indexOf("call('reseal'"));
 for(const token of ["'sealed_detail').sourceChanged,false","'later_detail').sourceChanged,true","['artifactText','artifactSha256','artifactBytes']",
  "raw.get('fixed_new_archive').value[k],raw.get('new_archive').value[k]","raw.get('fixed_old_archive').value.artifactText,sealedArchive.artifactText",
  "['send_recovery','send_exact_replay']","parsed.get('self_confirm_recovery').operation,parsed.get('reconfirm').operation"])assert(source.includes(token),token);
});
test('all zero-write and rollback claims have fact, definition, catalog and dual archive checks',()=>{
 for(const token of ['error||!write||replay?fullHash:protectedHash(tables(kind))',"assert period_before=period_after,'outage_period_read_or_protected_facts_changed'",
  'assert.equal(row.before,row.after)','new AggregateError(failures',"'outage_period_rollback_'+label",'oldArchive.artifactText','oldArchive.artifactSha256',
  'sealedArchive.artifactText','sealedArchive.artifactSha256','defs','catalog','browser:false,productionAccess:false,newCluster:false,concurrency:false'])assert(source.includes(token),token);
});
test('a second independent first-v4 period uses a genuinely empty nonoverlapping day and fixed reread',()=>{
 for(const token of ['verifyAttendanceOutagePeriodsNative(ctx,{firstV4=false}={})','periodId=firstV4?fresh(500):existingPeriodId',
  'baselineArtifact.report.base.rows.length,0','baselineArtifact.report.missing.length,0','outage_period_fresh_range_must_not_overlap',
  "const savedVersion=firstV4?1:3","call('first_new_version_fixed_preview',{query:{...q('preview'),periodId}})",
  "parsed.get('new_archive').artifactVersion,1",'outage_period_first_v4_real_seal_required',
  "parsed.get('first_new_version_fixed_preview').preview.artifact.source,parsed.get('resolved_send').artifact.source",
  'firstV4:await verifyAttendanceOutagePeriodsNative(ctx,{firstV4:true})'])assert(source.includes(token),token);
 assert(!source.includes('delete from'));assert(!source.includes('insert into public.merchant_attendance_period_artifacts'));
});
