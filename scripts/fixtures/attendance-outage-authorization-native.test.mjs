import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
import {createOutageAuthorizationNativePlan,outageAuthorizationProtectedFingerprintSql,verifyAttendanceOutageAuthorizationNative} from './attendance-outage-authorization-native.mjs';
const source=readFileSync(new URL('./attendance-outage-authorization-native.mjs',import.meta.url),'utf8');
const input={site:'99990001',worker:id(1),employee:id(2),auth:id(3),location:id(4),workerVersion:8,employeeVersion:5,generation:2,
 sealedStart:'2026-10-04T14:00:00.000Z',sealedEnd:'2026-10-04T16:00:00.000Z',now:'2026-10-07T12:00:00.000000Z',
 session:{item:{effect:null,events:[{id:id(204710),sequence:3,action:'clock_in',occurredAt:'2026-10-05T09:40:00.000000Z'},
  {id:id(204711),sequence:4,action:'clock_out',occurredAt:'2026-10-05T09:45:00.000000Z'}]}}};

test('module imports inertly and prepares exact independent219 identity without fake original-operation conclusions',()=>{
 assert.equal(typeof verifyAttendanceOutageAuthorizationNative,'function');const p=createOutageAuthorizationNativePlan(input);
 assert.equal(p.incident.operationId,id(219300001));assert.equal(p.declaration.operationId,id(219300003));assert.equal(p.declaration.declarationId,id(219300004));
 assert.equal(p.declaration.employeeAuthUserId,input.auth);assert.equal(p.declaration.workerId,input.worker);assert.equal(p.declaration.employeeId,input.employee);
 assert.equal(p.declaration.expectedWorkerVersion,8);assert.equal(p.declaration.expectedEmployeeVersion,5);assert.equal(p.declaration.expectedGeneration,2);
 assert.equal(p.declaration.originalOperationId,null);assert.equal(p.declaration.originalChannel,null);assert.equal(p.declaration.paperReference,null);
 assert.deepEqual(p.incident.interval,p.declaration.interval);assert.equal(p.declaration.interval.startAt,'2026-10-05T09:40:00.000000Z');
 assert.equal(p.declaration.interval.endAt,'2026-10-05T09:45:00.000000Z');assert.notEqual(p.wrongAuth,input.auth);
 assert(!source.includes('process.argv'));assert(!source.includes('await verifyAttendanceOutageAuthorizationNative('));
});

test('the session reference preserves current effect operation and revision and rejects open/future prerequisites',()=>{
 const p=createOutageAuthorizationNativePlan(input);assert.deepEqual(p.reference,{kind:'session',startEventId:id(204710),lastEventId:id(204711),lastSequence:4,effectOperationId:null,effectRevision:null});
 const current=createOutageAuthorizationNativePlan({...input,session:{item:{...input.session.item,effect:{operationId:id(90),revision:7}}}});
 assert.equal(current.reference.effectOperationId,id(90));assert.equal(current.reference.effectRevision,7);
 assert.throws(()=>createOutageAuthorizationNativePlan({...input,session:{item:{effect:null,events:input.session.item.events.slice(0,1)}}}));
 assert.throws(()=>createOutageAuthorizationNativePlan({...input,now:input.sealedEnd}));
 assert.throws(()=>createOutageAuthorizationNativePlan({...input,generation:-1}));
 assert.throws(()=>createOutageAuthorizationNativePlan({...input,sealedStart:'2026-10-05T09:00:00.000000Z',sealedEnd:'2026-10-05T10:00:00.000000Z'}));
});

test('old same-table rows stay hashed and existing218 records do not require an empty ledger',()=>{
 const tables=['merchant_attendance_outage_operations','merchant_attendance_outage_incidents','merchant_attendance_outage_declarations',
  'merchant_attendance_outage_link_operations','merchant_attendance_outage_review_operations','merchant_attendance_workers'];
 for(const kind of ['outages','links','reviews']){
  const sql=outageAuthorizationProtectedFingerprintSql(tables,kind);
  for(const table of tables)assert(sql.includes('from public.'+table+' authorization_row'));
  assert(sql.includes("is distinct from authorization_command->>'operationId'"));
 }
 const outage=outageAuthorizationProtectedFingerprintSql(tables,'outages');
 assert(outage.includes("authorization_command->>'action' is distinct from 'create_incident'"));
 assert(outage.includes("authorization_row.declaration_id::text is distinct from authorization_command->>'declarationId'"));
 assert.throws(()=>outageAuthorizationProtectedFingerprintSql(['unsafe;sql'],'reviews'));
 assert(!source.includes('authorization_empty176_required'));assert(!source.includes('authorization_empty177_required'));assert(!source.includes('authorization_empty178_required'));
 assert(source.includes('authorization_source_range_unsealed'));assert(source.includes('authorization_fresh176_ids_required'));
 assert(source.includes('authorization_command:=${c};authorization_before:=${hash}'));
});

test('setup uses actual176 self declaration,177 owner apply and178 actual owner proposal plus self confirmation',()=>{
 for(const token of ["call('declaration',{kind:'outages',q:oq(),...self,c:json(p.declaration),write:true})",'faolla_attendance_outage_v1',
  "call('link_apply'",'faolla_attendance_outage_links_v1',"call('propose'","call('confirm'",'faolla_attendance_outage_review_v1',
  'projectors[row.kind](row.value,row.query,row.actor,row.command)',"parsed.get('propose').receipt.entry.actorId,d.owner",
  "parsed.get('confirm').receipt.entry.actorId,h.employeeAuthUserId"])assert(source.includes(token),token);
 assert(!/insert into|delete from|disable trigger|session_replication_role/i.test(source));
});

test('bounded revoked authorization probes distinguish forbidden self177 recovery from current membership reads',()=>{
 for(const token of ["'self_link_recover_invalid'","error:'attendance_invalid_request'","array_remove(permissions,'attendance.self.request')", "set status='archived'",
  "'permission_outage_recovery'","'permission_link_history'","'permission_review_recovery'","'permission_review_replay'",
  "'archived_role_link_detail'","'archived_role_review_history'","'old_auth_link_history'","'old_auth_review_recovery'",
  "'new_auth_link_detail'","'new_auth_review_recovery'","'disabled_employee_link_history'","'disabled_employee_review_recovery'"])assert(source.includes(token),token);
 const labels=[...source.matchAll(/call\('([^']+)'/g)].map(match=>match[1]);assert.equal(new Set(labels).size,labels.length);
 for(const label of labels)assert.match(label,/^[a-z_]+$/);
 assert(!source.includes("set status='inactive'"));
});

test('existing receipts remain exact but fresh safety actions do not bypass allow=false or source readiness',()=>{
 for(const token of ["'inactive_worker_review_recovery'","'settings_owner_proposal_recovery'","'settings_self_confirmation_recovery'",
  "'settings_confirmation_replay'","'allow_off_outage_recovery'","'allow_off_link_replay'","'allow_off_self_replay'",
  "'allow_off_safety_fresh'","error:'attendance_outage_review_disabled'","'settings_fresh_proposal'","error:'attendance_platform_paused'",
  "'inactive_worker_resolve'","'paused_fresh_resolve'","error:'attendance_outage_review_blocked'",
  "'inactive_worker_dispute'","'settings_safety_dispute'","'paused_safety_dispute'",
  "assert.deepEqual(result.receipt,parsed.get(expected.receiptOf).receipt"])assert(source.includes(token),token);
 for(const label of ['outage_conflict','link_conflict','confirmation_conflict']){
  const call=source.slice(source.indexOf("call('"+label+"'"));assert(call.slice(0,call.indexOf('\n')).includes("error:'attendance_operation_conflict'"));
 }
});

test('revoke uses177 exact five-field command, not the persisted entry sources array',()=>{
 const line=source.split('\n').find(value=>value.includes('const revoke=n=>'));
 assert(line);assert(!line.includes("'sources'"));assert(!line.includes("'[]'::jsonb"));
 for(const field of ['action','operationId','expectedRevision','expectedFingerprint','reason'])assert(line.includes("'"+field+"'"));
 assert(line.includes("${saved('link_apply')}->'receipt'->'entry'->'fingerprint'"));
 const sql=readFileSync(new URL('../supabase-migrations/202610070177_merchant_attendance_outage_links.sql',import.meta.url),'utf8');
 assert(sql.includes("else array['action','operationId','expectedRevision','expectedFingerprint','reason'] end)"));
 const strict=readFileSync(new URL('../../src/lib/merchantAttendanceOutageLinks.ts',import.meta.url),'utf8');
 assert(strict.includes('...(action === "apply" ? ["sources"] : [])'));
 assert(source.includes('get stacked diagnostics authorization_context=pg_exception_context'));
 assert(source.includes("'authorization_case:'+label+' expected:'+error+' actual:'"));
 assert(source.includes('errcode=sqlstate'));assert(source.includes('detail=authorization_context'));
});

test('real164 controls pause and reactivation; synthetic invitation/role/Auth/settings inputs remain disclosed savepoint facts',()=>{
 for(const token of ["status('disabled',60)","status('active',61)",'public.faolla_update_merchant_enterprise_employee_v1(',
  "attendance_suspension_enabled:true","offboarding_mode:'unassign'",'authorization_actual_pause_retained',"'synthetic_acceptance'",
  'accepted_at is null',"beginScenario('actual_pause'","endScenario('actual_pause')",'actualInvitationAcceptance:false',
  'syntheticDirectRoleAuthWorkerSettingsChanges:true',"status.blockers.includes('account_suspended')"])assert(source.includes(token),token);
 assert(!source.includes('update public.merchant_attendance_account_epochs'));
});

test('each rejection/read and each scenario are guarded by full facts with final owned archive and definition rollback',()=>{
 for(const token of ['assertLifecycleSandbox','assert.equal(owned.schema,scope.schema)','d?.syntheticOnly===true&&h?.syntheticOnly===true',
  'native.querySteps(steps.map(sql=>scope.sql(sql)))','steps.length<=80','authorization_read_reject_or_old_facts_changed','authorization_scenario_full_rollback',
  'set constraints all immediate;set constraints all deferred;reset role','authorization_guards_enabled','authorization_seal_preserved',
  'assert.equal(row.before,row.after)','finally{','d.fingerprint()','d.definitions()','d.tableCatalog()','oldArchive.artifactText','oldArchive.artifactSha256',
  'sealed.artifactText','sealed.artifactSha256',"'authorization_rollback_'+label",'new AggregateError(failures','));rollback;'])assert(source.includes(token),token);
 assert(!/initdb|pg_ctl|create database|spawn\(|listen\(|set statement_timeout|set lock_timeout/i.test(source));
});
