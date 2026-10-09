//Pure fixture/static assertions, not a claim of successful PostgreSQL execution.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createOutageNativePlan,outageNativeExpression,outageNativeFingerprintSql,outageNativeTables} from './attendance-outage-native.mjs';
const source=readFileSync(new URL('./attendance-outage-native.mjs',import.meta.url),'utf8');
const input={site:'99990001',owner:'owner',employee:'employee',auth:'auth',worker:'worker',location:'location',workerVersion:8,employeeVersion:4,generation:2,
 startAt:'2026-10-01T08:00:00.000Z',endAt:'2026-10-01T10:00:00.000Z',now:'2026-10-07T12:00:00.000000Z'};
test('fixture commands bind current versions and identity without inventing raw clock events',()=>{
 const p=createOutageNativePlan(input);
 assert.equal(p.declaration.expectedWorkerVersion,8);assert.equal(p.declaration.expectedEmployeeVersion,4);assert.equal(p.declaration.expectedGeneration,2);
 assert.equal(p.declaration.employeeAuthUserId,input.auth);assert.equal(p.declaration.workerId,input.worker);
 assert.equal(p.declaration.originalChannel,'web');assert.equal(p.self.originalOperationId,null);assert.equal(p.self.originalChannel,null);
 assert.equal(p.self.paperReference,null);assert.equal(p.declaration.paperReference,'PAPER-211-A');
 const commands=[p.incident,p.declaration,p.self,p.partial,p.dst,p.paused,p.future];
 assert.equal(new Set(commands.map(c=>c.operationId)).size,commands.length);
 assert(commands.every(c=>/^00000000-0000-4000-8000-/.test(c.operationId)));
 //The paused intent is only a template; actual post-touch versions are read
 //inside the SQL savepoint, never predicted from these original versions.
 assert.equal(p.paused.expectedWorkerVersion,8);assert.equal(p.paused.expectedEmployeeVersion,4);assert.equal(p.paused.expectedGeneration,2);
});
test('past UTC6 spans, partial overlap and DST fold are separate disclosed cases',()=>{
 const p=createOutageNativePlan(input);
 assert.equal(p.interval.startAt,'2026-10-01T08:00:00.000000Z');assert.equal(p.incident.interval.startAt,'2026-10-01T07:30:00.000000Z');
 assert(p.partial.interval.startAt<p.incident.interval.startAt);assert(p.partial.interval.endAt>p.incident.interval.startAt);
 assert.equal(p.dst.interval.timeZone,'Europe/Madrid');assert.equal(p.dst.interval.startOffsetMinutes,120);assert.equal(p.dst.interval.endOffsetMinutes,60);
 assert.equal(p.dst.interval.startAt,'2025-10-26T00:15:00.000000Z');assert.equal(p.dst.interval.endAt,'2025-10-26T01:45:00.000000Z');
 assert(p.future.interval.startAt>input.now);assert.throws(()=>createOutageNativePlan({...input,workerVersion:0}));
 assert.throws(()=>createOutageNativePlan({...input,now:'2025-01-01T00:00:00.000000Z'}));
});
test('strict query variants have no accidental union fields and RPC is fixed',()=>{
 const p=createOutageNativePlan(input);
 assert.deepEqual(Object.keys(p.query('owner','incidents')).sort(),['access','afterId','mode','siteId']);
 assert.deepEqual(Object.keys(p.query('self','declarations')).sort(),['access','afterId','incidentId','mode','siteId']);
 assert.deepEqual(Object.keys(p.query('self','recover','op')).sort(),['access','mode','operationId','siteId']);
 const expression=outageNativeExpression(p.query('owner','incident'),"owner's",p.incident,true);
 assert(expression.startsWith('public.faolla_attendance_outage_v1('));assert(expression.includes("'owner''s'"));assert(expression.endsWith(',true)'));
 assert.throws(()=>outageNativeExpression(p.query('owner','incident'),input.owner,null,'true'));
});
test('whole-fact hash uses deterministic nonshadowing aliases and validates table identifiers',()=>{
 const sql=outageNativeFingerprintSql(['merchants',...outageNativeTables]);
 assert(sql.includes('jsonb_object_agg(outage_fact_name,outage_fact_rows order by outage_fact_name)'));
 assert(sql.includes('to_jsonb(outage_row) order by to_jsonb(outage_row)::text'));
 assert.throws(()=>outageNativeFingerprintSql([]));assert.throws(()=>outageNativeFingerprintSql(['merchants','merchants']));
 assert.throws(()=>outageNativeFingerprintSql(['merchants;drop table anything']));
});
test('fixture cannot install/start a database or widen old writer authority',()=>{
 for(const required of ['assertLifecycleSandbox','assert.deepEqual(owned,d.owned)','h?.syntheticOnly===true','scope.sql(step)','d.guard','native.querySteps'])assert(source.includes(required),required);
 for(const forbidden of ['initdb','CREATE DATABASE','pg_dump','spawn(','listen(','chromium','playwright','disable trigger','session_replication_role','set statement_timeout','set lock_timeout'])assert(!source.includes(forbidden),forbidden);
 assert(source.includes('projectOutageResult(row.value,metadata.q,metadata.auth,command)'));
 assert(source.includes('steps.length<=75'));assert(source.includes('set local role service_role;'));
});
test('positive reads/replay and failed operations prove hashes before rollback',()=>{
 for(const label of ['incident_replay_gate_off','self_replay_gate_off','incident_recover','self_recover_gate_off','same_id_different_body','unknown_original_receipt',
  'revoked_permission_detail','revoked_permission_recover','old_auth_after_rebinding','new_auth_cannot_read_old_declaration','cross_merchant','future_time','utc_offset_mismatch','dst_fold_wrong_occurrence_offset','half_open_touch_is_not_overlap'])assert(source.includes(label),label);
 assert(source.includes("assert ${fullHash}=outage_before,'outage_failed_operation_wrote'"));
 assert(source.includes('readOnly?fullHash:oldHash'));assert(source.includes('rows[at-1].hash,rows[at+1].hash'));
 assert(source.includes('assert.deepEqual(parsed.get(replay).receipt,parsed.get(first).receipt)'));
 assert(source.includes('assert.deepEqual(parsed.get(recovery).receipt,parsed.get(first).receipt)'));
});
test('deferred receipt pairing is validated before resetting the actual service_role',()=>{
 const call=source.slice(source.indexOf('const call=(label'),source.indexOf('const reject=(label'));
 assert.match(call,/set local role service_role;[\s\S]*set constraints all immediate;set constraints all deferred;reset role;/);
 assert.doesNotMatch(call,/reset role;set constraints all immediate/);
 assert.match(source,/outage_status_result:=public\.faolla_update_merchant_enterprise_employee_v1\(outage_status_input\);\s*set constraints all immediate;set constraints all deferred;reset role;/);
});
test('actual account disable/active is rollback-scoped and paused owner record is not restoration',()=>{
 assert(source.includes('savepoint outage_pause'));assert(source.includes("['disabled','active'].entries()"));
 assert(source.includes('public.faolla_update_merchant_enterprise_employee_v1('));assert(source.includes('attendance_suspension_enabled:true'));
 assert(source.includes('outage_actual_pause_required'));assert(source.includes('paused_owner_declaration'));assert(source.includes('paused_self_fresh_denied'));
 assert(source.includes('rollback to savepoint outage_pause;release savepoint outage_pause;'));assert(source.includes('beforePause.hash,afterPause.hash'));
 assert(!source.includes('set paused=false'));assert(!source.includes('faolla_attendance_account_suspensions_v1('));
});
test('synthetic acceptance is savepoint-only and every later command reads real touched versions',()=>{
 const savepoint=source.indexOf("savepoint outage_pause;"),seed=source.indexOf('set accepted_at=clock_timestamp()'),status=source.indexOf("for(const [index,status]of ['disabled','active'].entries())"),rollback=source.indexOf('rollback to savepoint outage_pause;');
 assert(savepoint>=0&&seed>savepoint&&status>seed&&rollback>status);
 assert.match(source,/where merchant_id=\$\{quote\(d\.site\)\} and id=\$\{quote\(p\.employee\)\} and auth_user_id=\$\{quote\(p\.auth\)\} and accepted_at is null/);
 assert(source.includes('select version into strict outage_employee_version'));
 assert(source.includes("jsonb_build_object('expected_version',outage_employee_version)"));
 assert(source.includes("jsonb_build_object('expectedWorkerVersion',w.version,'expectedEmployeeVersion',e.version,'expectedGeneration',ep.generation)"));
 assert(source.includes('outage_dynamic_versions_changed_intent'));assert(source.includes('projectOutageResult(row.value,metadata.q,metadata.auth,command)'));
 assert(source.includes('syntheticInvitationAcceptanceRows:acceptance.rows,actualInvitationAcceptance:false'));
 assert(!source.includes('expected_version:profile.employeeVersion+index'));assert(!source.includes('expectedEmployeeVersion:employeeVersion+2'));
 assert(!source.includes('set version='));assert(!source.includes('disable trigger'));
});
test('real sealed period and both immutable archives are verified independently of new records',()=>{
 assert(source.includes('assert(sealed.period.sealed'));assert(source.includes('outage_actual_seal_missing'));
 for(const label of ['outage_rollback_facts','outage_definitions','outage_catalog','outage_old155_text','outage_old155_sha','outage_current_sealed_text','outage_current_sealed_sha'])assert(source.includes(label),label);
 assert(source.includes('new AggregateError(failures'));assert(source.includes('rollback;'));
 assert(source.includes('committedOutageRows:0'));assert(source.includes('sourceResolutionImplemented:false,periodOutageGateImplemented:false'));
});
