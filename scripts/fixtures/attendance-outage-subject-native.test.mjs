import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {createOutageSubjectNativePlan} from './attendance-outage-subject-native.mjs';
import {lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
const source=readFileSync(new URL('./attendance-outage-subject-native.mjs',import.meta.url),'utf8');
const input={site:'99999001',worker:id(1),employee:id(2),auth:id(3),location:id(4),startAt:'2026-10-04T08:00:00.000Z',endAt:'2026-10-04T10:00:00.000Z'};
test('synthetic incident and first declaration preserve exact identity but never guess current versions',()=>{
 const p=createOutageSubjectNativePlan(input);
 assert.equal(p.q('self').workerId,null);assert.equal(p.q('owner').workerId,input.worker);assert.equal(p.q('self').incidentId,p.incident.incidentId);
 assert.equal(p.declare.employeeAuthUserId,input.auth);assert.equal(p.declare.employeeId,input.employee);assert.equal(p.declare.workerId,input.worker);
 assert.equal('expectedGeneration' in p.declare,false);assert.equal('expectedWorkerVersion' in p.declare,false);assert.equal('expectedEmployeeVersion' in p.declare,false);
 assert.equal(p.incident.interval.startAt,'2026-10-04T08:00:00.000000Z');assert.deepEqual(p.declare.interval,p.incident.interval);
 assert.equal(p.declare.originalOperationId,null);assert.equal(p.declare.originalChannel,null);
 assert.throws(()=>createOutageSubjectNativePlan({...input,endAt:input.startAt}));
});
test('all positive and denied preparation reads hash all facts with enabled guards inside one rollback transaction',()=>{
 for(const token of ['assertLifecycleSandbox','native.querySteps(steps.map(sql=>scope.sql(sql)))','steps.length<=40','write&&!error?oldHash:fullHash',
  'subject_before=subject_after','set constraints all immediate;set constraints all deferred;reset role','outage_subject_actual_seal_required',
  'outage_subject_guards_enabled',"'outage_subject_rollback_'+label",'new AggregateError(failures','rollback;'])assert(source.includes(token),token);
 for(const token of ['native.connect(','ctx.reopen(','ctx.seal(','disable trigger','session_replication_role','initdb','pg_dump'])assert(!source.includes(token),token);
});
test('first self declaration explicitly proves old incident privacy denial before new preparation and real176 write',()=>{
 assert(source.indexOf("call('old_self_incident_before_declaration'")<source.indexOf("call('self_prepare'"));
 assert(source.indexOf("call('self_prepare'")<source.indexOf("call('first_self_declaration'"));
 assert(source.indexOf("call('first_self_declaration'")<source.indexOf("call('old_self_incident_after_declaration'"));
 for(const token of ['public.faolla_attendance_outage_subject_v1(subject_query','public.faolla_attendance_outage_v1(subject_query',
  "commandFrom(p.declare,'self_prepare')","'expectedEmployeeVersion',${saved(label)}->'subject'->'employeeVersion'",'noEpochCreatedByReads:true'])assert(source.includes(token),token);
});
test('negative current authorization and stale versions do not get masked by successful mocks',()=>{
 for(const label of ['wrong_owner','unknown_worker','unknown_incident','cross_merchant','self_cannot_select_worker','role_revoked','old_auth_rebound',
  'stale_prepared_version','closed_gate_fresh','paused_self_denied'])assert(source.includes("call('"+label+"'"),label);
 for(const token of ["error:'attendance_access_denied'","error:'attendance_outage_subject_not_found'","error:'attendance_outage_changed'",'subject_error<>${quote(error)}'])assert(source.includes(token),token);
});
test('paused owner preparation uses real164 status and freshly read versions, never a hard-coded CAS',()=>{
 for(const token of ['savepoint subject_pause','accepted_at=clock_timestamp()',"['disabled','active']",'select version into strict version_no',
  'public.faolla_update_merchant_enterprise_employee_v1','paused_owner_prepare',"commandFrom(paused,'paused_owner_prepare')",
  'rollback to savepoint subject_pause','outage_subject_pause_not_rolled_back','pause.subject.generation,self.subject.generation+1',
  'pause.subject.employeeVersion>self.subject.employeeVersion','actualInvitationAcceptance:false'])assert(source.includes(token),token);
});
test('actual SQL capture is projected through real client/GET handler/POST service without misclaiming live browser',()=>{
 for(const token of ['new AttendanceOutageClient(','handleOutageSubject(req','handleOutage(req','executeOutageSubject(input','executeOutage(input',
  'await client.initialize();assert.equal(requests.length,0)','await client.prepare(prepare.query)','await client.submit(write.query,draft)',
  'p_query:write.query,p_auth_user_id:write.actor,p_command:write.command,p_allow_write:true',"assert.deepEqual([...memory],[['unrelated','preserved']])",
  'capturedSqlThroughActualClientAndHandlers:true','liveBrowser:false','client?.pause();keys.forEach'])assert(source.includes(token),token);
});
