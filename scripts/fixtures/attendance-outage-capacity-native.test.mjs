import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
import {createOutageCapacityNativePlan,verifyAttendanceOutageCapacityNative} from './attendance-outage-capacity-native.mjs';
const source=readFileSync(new URL('./attendance-outage-capacity-native.mjs',import.meta.url),'utf8');
const person=n=>({workerId:id(n),employeeId:id(n+1),employeeAuthUserId:id(n+2),workerVersion:4,employeeVersion:7,generation:2});
const input={site:'99990001',location:id(90),fromAt:'2026-10-04T00:00:00.000000Z',toAt:'2026-10-05T00:00:00.000000Z',
 now:'2026-10-07T12:00:00.000000Z',subject:person(10),other:person(20)};

test('import is inert and all101 relevant declarations are distinct exact current identity intents',()=>{
 assert.equal(typeof verifyAttendanceOutageCapacityNative,'function');const plan=createOutageCapacityNativePlan(input);
 assert.equal(plan.relevant.length,101);assert.equal(new Set(plan.relevant.map(v=>v.declarationId)).size,101);
 const records=[plan.incident,...plan.relevant,...plan.irrelevant,plan.mismatched];
 assert.equal(new Set(records.map(v=>v.operationId)).size,records.length);
 for(const command of plan.relevant){assert.equal(command.action,'declare');assert.equal(command.incidentId,plan.incident.incidentId);
  assert.equal(command.workerId,input.subject.workerId);assert.equal(command.employeeId,input.subject.employeeId);assert.equal(command.employeeAuthUserId,input.subject.employeeAuthUserId);
  assert.equal(command.expectedWorkerVersion,4);assert.equal(command.expectedEmployeeVersion,7);assert.equal(command.expectedGeneration,2);
  assert.deepEqual(command.interval,{startAt:input.fromAt,endAt:input.toAt,timeZone:'UTC',startOffsetMinutes:0,endOffsetMinutes:0});
  assert.equal(command.originalOperationId,null);assert.equal(command.originalChannel,null);assert.equal(command.paperReference,null);
 }
 assert.deepEqual(plan.relevant.map(v=>v.declarationId),plan.relevant.map(v=>v.declarationId).sort());
 assert(!source.includes('process.argv'));assert(!source.includes('await verifyAttendanceOutageCapacityNative('));
});

test('four excluded declarations prove worker scope, outside interval and both exact half-open boundaries',()=>{
 const {irrelevant,incident}=createOutageCapacityNativePlan(input),[other,outside,left,right]=irrelevant;
 assert.equal(other.workerId,input.other.workerId);assert.equal(other.interval.startAt,input.fromAt);assert.equal(other.interval.endAt,input.toAt);
 assert(outside.interval.endAt<input.fromAt);assert.equal(left.interval.endAt,input.fromAt);assert.equal(right.interval.startAt,input.toAt);
 assert.equal(irrelevant.filter(v=>v.workerId===input.subject.workerId&&v.interval.startAt<input.toAt&&v.interval.endAt>input.fromAt).length,0);
 for(const command of irrelevant){assert(command.interval.startAt<incident.interval.endAt);assert(command.interval.endAt>incident.interval.startAt);}
});

test('plan fails closed on nonexact fixed-frame timestamps, present/future ranges and duplicate subjects',()=>{
 for(const bad of [{fromAt:'2026-10-04T00:00:00.000001Z'},{toAt:input.fromAt},{now:input.toAt},
  {toAt:'2026-12-01T00:00:00.000000Z',now:'2027-01-01T00:00:00.000000Z'},{other:input.subject},
  {subject:{...input.subject,workerVersion:0}},{other:{...input.other,generation:-1}}])assert.throws(()=>createOutageCapacityNativePlan({...input,...bad}));
});

test('only real176 supplies immutable records, with service-role deferred constraints exercised in bounded batches',()=>{
 for(const evidence of ['public.faolla_attendance_outage_v1(capacity_query','set local role service_role;capacity_value',
  'set constraints all immediate;set constraints all deferred;reset role','commands.length<=10','steps.length<=40',
  'assert.equal(submissions,107)','projectOutageResult(item.value,item.query,d.owner,item.command)','assert.equal(projectedWrites,submissions)'])assert(source.includes(evidence),evidence);
 assert(!/insert into|delete from|disable trigger|session_replication_role|create database|initdb|pg_ctl|spawn\(|listen\(/i.test(source));
});

test('100 is fully projected in both scopes and101 is an exact error, not a truncated successful page',()=>{
 for(const evidence of ["read('hundred_owner',{count:100})","read('hundred_self',{access:'self',count:100})",
  "read('hundred_first_owner',{error:'attendance_period_source_too_large'})","read('hundred_first_self',{access:'self',error:'attendance_period_source_too_large'})",
  'projectPeriodClosureSource(row.value,q(expected.access))','assert.equal(entries.length,expected.count)',
  "assert.deepEqual(parsed.get('hundred_owner').artifact.source,parsed.get('hundred_self').artifact.source",
  'p.relevant.slice(0,expected.count).map(c=>c.declarationId)','capacity_other_context_preserved'])assert(source.includes(evidence),evidence);
 assert(!source.includes('entries.slice('));assert(!source.includes('blockers.filter('));
});

test('saved mismatch is produced under a temporary real current binding and current Auth restored before179 read',()=>{
 const {mismatched,wrongAuth}=createOutageCapacityNativePlan(input);
 assert.equal(mismatched.employeeAuthUserId,wrongAuth);assert.notEqual(wrongAuth,input.subject.employeeAuthUserId);
 const save=source.indexOf('savepoint outage_capacity_identity;'),write=source.indexOf("append('saved_mismatch'"),restore=source.indexOf('set auth_user_id=${auth}'),
  reject=source.indexOf("read('identity_not_filtered'"),rollback=source.indexOf('rollback to savepoint outage_capacity_identity;');
 assert(save<write&&write<restore&&restore<reject&&reject<rollback);
 for(const evidence of ['dynamicIdentity:true','capacity_saved_identity_differs',"error:'attendance_period_source_identity_changed'",'capacity_identity_full_rollback',
  'syntheticDirectAuthRebinding:true','actualAccountRebindingApi:false'])assert(source.includes(evidence),evidence);
 assert.equal((source.match(/update public\.merchant_enterprise_employees/g)??[]).length,2);
 assert(!source.includes('update public.merchant_attendance_outage_declarations'));
});

test('every read/rejection is zero-write and the owned single connection rolls back facts, definitions and both archives',()=>{
 for(const evidence of ['assertLifecycleSandbox','d?.syntheticOnly===true&&h?.syntheticOnly===true','assert.equal(owned.schema,scope.schema)',
  'native.querySteps(steps.map(sql=>scope.sql(sql)))','capacity_read_or_rejection_wrote_facts','capacity_write_changed_old_facts',
  'capacity_all_guards_enabled','capacity_seal_preserved','assert.equal(row.before,row.after)','finally{',
  'd.fingerprint()','d.definitions()','d.tableCatalog()','oldArchive.artifactText','oldArchive.artifactSha256','sealed.artifactText','sealed.artifactSha256',
  "'capacity_rollback_'+label",'new AggregateError(failures','));rollback;'])assert(source.includes(evidence),evidence);
});
