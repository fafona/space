//Pure construction/static tests only. Root alone runs PostgreSQL acceptance.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
import {createOutageLinksNativePlan,outageLinksNativeExpression,outageLinksNativeTables} from './attendance-outage-links-native.mjs';
const source=readFileSync(new URL('./attendance-outage-links-native.mjs',import.meta.url),'utf8');
const input={site:'99990001',owner:id(1),employee:id(2),auth:id(3),worker:id(4),location:id(5),workerVersion:8,employeeVersion:4,generation:2,
 sealedStart:'2026-10-04T14:00:00.000Z',sealedEnd:'2026-10-04T16:00:00.000Z',sessionStart:'2026-10-05T09:40:00.000000Z',sessionEnd:'2026-10-05T09:45:00.000000Z',
 missingStart:'2026-10-05T09:50:00.000000Z',missingEnd:'2026-10-05T09:55:00.000000Z',now:'2026-10-07T12:00:00.000000Z',originalOperationId:id(204712),
 sessionReference:{kind:'session',startEventId:id(204710),lastEventId:id(204711),lastSequence:4,effectOperationId:null,effectRevision:null},
 missingReference:{kind:'missing',requestId:id(204715),rootRequestId:id(204715),approvalOperationId:id(204716)}};
test('plans bind176 declarations to actual profile and keep unrelated concepts separate',()=>{
 const session=createOutageLinksNativePlan(input),missing=createOutageLinksNativePlan(input,'missing');
 for(const p of [session,missing]){
  assert.equal(p.declaration.workerId,input.worker);assert.equal(p.declaration.employeeId,input.employee);assert.equal(p.declaration.employeeAuthUserId,input.auth);
  assert.equal(p.declaration.expectedWorkerVersion,8);assert.equal(p.declaration.expectedEmployeeVersion,4);assert.equal(p.declaration.expectedGeneration,2);
  assert.equal(p.declaration.interval.startAt,'2026-10-04T14:00:00.000000Z');assert.equal(p.declaration.interval.endAt,'2026-10-05T10:10:00.000000Z');
  assert.deepEqual(p.incident.interval,p.declaration.interval);assert.equal(p.declaration.paperReference,null);
 }
 assert.equal(session.declaration.originalOperationId,input.originalOperationId);assert.equal(session.declaration.originalChannel,'web');
 assert.equal(missing.declaration.originalOperationId,null);assert.equal(missing.declaration.originalChannel,null);
 assert.notEqual(session.declaration.declarationId,missing.declaration.declarationId);assert.notEqual(session.fresh(10),missing.fresh(10));
 assert.match(session.declaration.statement,/unresolved/);assert.match(session.declaration.statement,/do not close or count work/);
 assert.throws(()=>createOutageLinksNativePlan({...input,now:input.sealedStart}));assert.throws(()=>createOutageLinksNativePlan(input,'unknown'));
});
test('queries are exact unions and helper cannot select another RPC',()=>{
 const p=createOutageLinksNativePlan(input);
 assert.deepEqual(Object.keys(p.q()).sort(),['access','declarationId','mode','siteId']);
 assert.deepEqual(p.q('preview','owner',[input.sessionReference]).sources,[input.sessionReference]);
 assert.equal(p.q('history','self',2).beforeRevision,2);assert.equal(p.q('recover','owner',p.fresh(10)).operationId,p.fresh(10));
 const sql=outageLinksNativeExpression(p.q(),"owner's",null,false);
 assert(sql.startsWith('public.faolla_attendance_outage_links_v1('));assert(sql.includes("'owner''s'"));assert(sql.endsWith(',null,false)'));
 assert.throws(()=>outageLinksNativeExpression(p.q(),input.owner,null,'true'));
 assert.deepEqual(outageLinksNativeTables,['merchant_attendance_outage_link_operations']);
});
test('native imports are inert, use querySteps and retain every owned guard/deadline',()=>{
 for(const token of ['assertLifecycleSandbox','assert.deepEqual(owned,d.owned)','h?.syntheticOnly===true','d.guard','native.querySteps(steps.map(sql=>scope.sql(sql)))','steps.length<=55'])assert(source.includes(token),token);
 for(const forbidden of ['native.connect(','initdb','CREATE DATABASE','pg_dump','spawn(','listen(','disable trigger','session_replication_role','set statement_timeout','set lock_timeout','supabase.co'])assert(!source.includes(forbidden),forbidden);
});
test('real176 precedes177 and exact projected receipt commands come from transaction state',()=>{
 assert(source.indexOf("call('incident'")<source.indexOf("call('apply'"));assert(source.indexOf("call('declaration'")<source.indexOf("call('apply'"));
 assert(source.includes('public.faolla_attendance_outage_v1(link_query,'));assert(source.includes('link_command:=${c};link_query:=${q};set local role service_role;'));
 assert(source.includes("'command',link_command,'value',link_value"));assert(source.includes("perform set_config(${quote('faolla.outage212_'+label)},link_record::text,true)"));
 assert(source.includes('projectOutageLinksResult(row.value,row.query,row.actor,row.command)'));
 assert(source.includes('projectOutageResult(row.value,row.query,row.actor,row.command)'));
 assert(source.includes('parseOutageLinksCommand(row.command)'));
 assert.match(source,/set constraints all immediate;set constraints all deferred;reset role/);
});
test('source data is real148/current103 over disclosed unchanged204 synthetic history',()=>{
 for(const token of ['knownSessionStart=id(204710)','knownSessionEnd=id(204711)','knownMissingRoot=id(204715)','public.faolla_attendance_period_session_v1(',
  'public.merchant_attendance_missing_current_v1','a.action=\'approve\' and a.revision=2','profile.session.ruleBinding.employeeAuthUserId,h.employeeAuthUserId',
  "profile.session.ruleBinding.reason,'source_unavailable'",'actualHistoricalClockRequests:false,newSyntheticClockRows:0'])assert(source.includes(token),token);
 assert(!source.includes('insert into public.merchant_attendance_events'));assert(!source.includes('update public.merchant_attendance_events'));
});
test('actual old source writers use explicit current review evidence and canonical proposals',()=>{
 for(const token of ['public.faolla_attendance_correction_self_v3(','public.faolla_attendance_correction_decide_v2(',
  'public.faolla_attendance_missing_v1(','expectedPolicyRevision','expectedSettingsVersion',"->'review'->'item'->'revision'",'expectedEvidence',
  "->'detail'->'evidenceToken'",'outage_links_utc6_proposal_required','merchant_attendance_correction_rule_bindings'])assert(source.includes(token),token);
 assert(source.includes('outage_links_old_writer_range_must_not_be_sealed'));assert(!source.includes('set sealed='));
 assert(!source.includes('set active=true'));assert(!source.includes('set accepted_at='));
});

test('raw missing SQL uses the existing service projection boundary and labels failures',()=>{
 const service=readFileSync(new URL('../../src/lib/merchantAttendanceMissing.server.ts',import.meta.url),'utf8');
 const compact=value=>value.replace(/\s/g,'');
 assert(compact(service).includes('parseMissingResult(result.data,{...query,operationId:command?.operationId??query.operationId},false)'));
 assert(compact(source).includes('parseMissingResult(row.value,{...row.query,operationId:row.command?.operationId??row.query.operationId},false)'));
 assert(source.includes('assert.deepEqual(value.receipt.command,row.command)'));
 assert(!source.includes('moduleEnabled:true'));assert(!source.includes('moduleEnabled: true'));
 assert(source.includes("'outage_links_projection_failed:'+group+':'+row.label"));assert(source.includes('{cause:error}'));
});
test('unknown, failed, replayed and read operations are hash-checked without local success guesses',()=>{
 for(const label of ['fresh_gate_off','stale_preview','duplicate_source','operation_conflict','unknown_operation','employee_cannot_owner_read','other_merchant','platform_paused_fresh',
  'self_permission_revoked','old_self_after_rebind','new_self_cannot_see_old','fresh_after_rebind'])assert(source.includes(label),label);
 assert(source.includes("assert ${fullHash}=link_before,'outage_links_rejected_write'"));
 assert(source.includes("assert link_after=link_before,'outage_links_read_or_protected_facts_changed'"));
 assert(source.includes('!write||replay?fullHash:'));assert(source.includes('assert.equal(row.before,row.after)'));
 assert(source.includes("'replay_off','recover_off','old_recover_after_change','old_recover_after_revoke','rebound_owner_recover'"));
});
test('pending/current changes cannot relabel saved source and no resolution is claimed',()=>{
 for(const token of ["'detail','self_detail','pending_detail','changed_detail'",'immutable_saved_entry',"preview.observations[0].pending,true",'pending evidence is preparation, not resolution',
  "preview.blockers.includes('source_changed')",'assert.notDeepEqual(latest.sources,applied.sources)',"latest.evidence.items[0].original,applied.evidence.items[0].original",
  "history.map(e=>e.revision),[3,2,1]","history.map(e=>e.revision),[1]",'sourceResolutionImplemented:false,periodOutageGateImplemented:false'])assert(source.includes(token),token);
});
test('pending correction and missing previews compare realUTC/Madrid canonical evidence',()=>{
 assert(source.includes("timeZone='UTC'"));assert(source.includes("assert(['UTC','Europe/Madrid'].includes(timeZone))"));
 assert.equal(source.split("call('pending_preview_madrid',{q:previewQ(json(initialRefs)),timeZone:'Europe/Madrid'})").length-1,2);
 assert(source.includes('set local time zone ${quote(timeZone)};do $outage_link_call$'));
 assert(source.includes("parsed.get('pending_preview_madrid').preview,parsed.get('pending_preview').preview"));
 assert(source.includes("parsed.get('pending_preview_madrid').current,applied"));
 assert(source.includes('pendingCanonicalSessionTimeZoneStable:true'));
});
test('every transaction and synthetic identity savepoint restores facts and both archives',()=>{
 for(const token of ['savepoint outage_links_identity','rollback to savepoint outage_links_identity;release savepoint outage_links_identity',
  'outage_links_identity_fixture_not_restored','outage_links_rollback_','new AggregateError(failures',
  'archive().artifactText,oldArchive.artifactText','archive().artifactSha256,oldArchive.artifactSha256',
  'periodArchive().artifactText,savedArchive.artifactText','periodArchive().artifactSha256,savedArchive.artifactSha256',
  "{kind:'counts',links:3,incidents:1,declarations:1,operations:2}",'set constraints all immediate;','));rollback;'])assert(source.includes(token),token);
 assert(source.includes("await scenario('session');await scenario('missing')"));
});
