// Pure/static contracts only. These tests neither start PG nor claim the native
// assertions ran; root runs the explicit owned-namespace checker separately.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {boundClockMigrationBody} from './fixtures/attendance-bound-clocks-native.mjs';
import {lifecycleId as id} from './merchant-attendance-lifecycle-native-support.mjs';
import {checkAttendanceShiftRuleBindingReaderNative,runAttendanceShiftRuleBindingReaderNative,shiftRuleBindingReaderExpression,
  shiftRuleBindingReaderProbeSql,shiftRuleBindingReaderLabels,shiftRuleBindingReaderMigration,shiftRuleBindingReaderNativeFailure} from './merchant-attendance-shift-rule-binding-reader-native.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const source=readFileSync(new URL('./merchant-attendance-shift-rule-binding-reader-native.mjs',import.meta.url),'utf8');

test('inert entry exports seven bounded checks without importing or executing the old full clock suite',()=>{
  assert.equal(typeof checkAttendanceShiftRuleBindingReaderNative,'function');assert.equal(typeof runAttendanceShiftRuleBindingReaderNative,'function');
  assert(Object.isFrozen(shiftRuleBindingReaderLabels));assert.equal(shiftRuleBindingReaderLabels.length,7);assert.equal(new Set(shiftRuleBindingReaderLabels).size,7);
  assert.match(source,/if\(process\.argv\[1\]&&path\.resolve\(process\.argv\[1\]\)===fileURLToPath\(import\.meta\.url\)\)/);
  assert.match(source,/prepareBoundClocksNativeFixture\(native,scope\)/);assert.doesNotMatch(source,/checkAttendanceBoundClocksNative|runAttendanceBoundClocksNative|\b(?:spawn|execSync|spawnSync|createServer|listen)\s*\(/);
});

test('migration is only new135 and surrounding transactions are delegated to the owned fixture',()=>{
  assert.equal(shiftRuleBindingReaderMigration,'202610040135_merchant_attendance_shift_rule_binding_reader.sql');
  const migration=boundClockMigrationBody(root,shiftRuleBindingReaderMigration);
  assert.doesNotMatch(migration,/^begin;\s*$|^commit;\s*$/m);assert.match(migration,/faolla_attendance_shift_rule_binding_v1/);
  for(const marker of ['reader_install_changed_old_definitions','reader_reapply_changed_definition','afterObjects.functions.length-beforeObjects.functions.length,4',"['tables','indexes','triggers']"])assert(source.includes(marker),marker);
  assert.match(source,/withAttendanceConcurrencySandbox\(native,async scope/);
});

test('one exact read expression JSON-quotes values and does not accept a caller-chosen RPC name',()=>{
  const query={siteId:'99990001',workerId:id(201),startEventId:id(701)};
  assert.equal(shiftRuleBindingReaderExpression(query,id(99)),`public.faolla_attendance_shift_rule_binding_v1('${JSON.stringify(query)}'::jsonb,'${id(99)}')`);
  assert.match(shiftRuleBindingReaderExpression({...query,extra:"O'Hara"},"x'y"),/O''Hara/);
  assert(shiftRuleBindingReaderExpression(query,"x'y").endsWith(",'x''y')"));
});

test('synthetic relational probe copies one real row without rewriting any existing event or binding',()=>{
  const sql=shiftRuleBindingReaderProbeSql(id(701),id(702),{sequence:99});
  assert.match(sql,/select \* into strict b from public\.merchant_attendance_shift_rule_bindings/);
  assert.match(sql,/select \* into strict e from public\.merchant_attendance_events/);
  assert.match(sql,/e\.action='clock_in' and e\.worker_id=b\.worker_id and e\.merchant_id=b\.merchant_id/);
  assert.match(sql,/b\.occurred_at:=e\.occurred_at;b\.event_time_zone:=e\.time_zone/);
  assert.match(sql,/jsonb_populate_record\(b,'\{"sequence":99\}'::jsonb\)/);
  assert.match(sql,/insert into public\.merchant_attendance_shift_rule_bindings select\(b\)\.\*/);
  assert.match(sql,/set constraints all immediate/);
  assert.doesNotMatch(sql,/\b(?:update|delete|truncate|alter|disable)\b|session_replication_role/i);
  assert.throws(()=>shiftRuleBindingReaderProbeSql("bad';drop x;--",id(702)));
  assert.throws(()=>shiftRuleBindingReaderProbeSql(id(701),id(702),{status:'verified'}));
  assert.throws(()=>shiftRuleBindingReaderProbeSql(id(701),id(702),Object.create(null)));
});

test('three real self cycles are exact six events two bindings one source and current group write is separate',()=>{
  for(const call of ["clock('clock_in',0)","clock('clock_out',1)","clock('clock_in',2)","clock('clock_out',3)","clock('clock_in',4)","clock('clock_out',5)"])assert(source.includes(call),call);
  assert.match(source,/executeAttendanceSelf\(/);assert.match(source,/boundClockRpcExpression\(name,args\)/);
  assert.match(source,/assert\.deepEqual\(counts\(\),\{events:6,bindings:2,sources:1\}\)/);assert.match(source,/assert\.equal\(clockCalls,6\)/);
  assert.match(source,/groupsNativeSave\(7801,\{groupId:d\.group,expectedRevision:1,active:false/);
  assert.match(source,/current_group_replaced_saved_binding/);assert.match(source,/assert\.equal\(unresolved\.reason,'inactive_group'\)/);
  assert.match(source,/assert\.equal\(missing\.binding,null\)/);
});

test('owner and current dual identity probes cannot fabricate old Auth proof for an unbound legacy start',()=>{
  for(const marker of ["workerId:id(204)",'q(legacyOut.receipt.id)','q(id(9998))',"status='disabled',auth_user_id=null",'employee_id=null,version=version+1',
    "transferred.actorId,id(98)","assert.deepEqual(transferred.binding,original.binding)","assert.equal((await probe(rebound,q(legacy.receipt.id))).status,'missing')",
    "paused.worker.active,false","paused.worker.employeeActive,false","time_zone='Pacific/Apia'"])assert(source.includes(marker),marker);
  assert.match(source,/for\(const anchor of \[verified\.receipt\.id,unverified\.receipt\.id\]\)/);
});

test('native corruption coverage distinguishes parser bytes CHECK rejection and relational stored-row failure',()=>{
  for(const marker of ['sourceText+=','sourceSha256=','sourceBytes++','assert.throws(()=>parseShiftRuleBindingResult',
    'assert.notEqual(copied.event.startEventId,copied.binding.source.sourceId)','{sequence:99}','{operation_id:id(9502)}',"{event_time_zone:'Europe/Madrid'}",
    "'{workerVersion}','2'::jsonb",'sha256(convert_to(body,\'UTF8\'))','violates check constraint'])assert(source.includes(marker),marker);
  assert.doesNotMatch(source,/disable\s+trigger|session_replication_role|drop\s+(?:table|schema)|update public\.merchant_attendance_shift_rule_(?:bindings|sources)/i);
  assert.match(source,/begin;reset role;\$\{setup\}/);assert.match(source,/set constraints all immediate;rollback/);
});

test('handler check calls actual service and SQL, keeps paused reads, and tests method flag and auth before SQL',()=>{
  for(const marker of ["require('../src/lib/merchantAttendanceShiftRuleBinding.server.ts')",'handleShiftRuleBinding(request',
    'execute:input=>executeShiftRuleBinding(input,readService)',"assert.equal(name,rpc)","['p_auth_user_id','p_query']",
    'allowEmployeeAttendance:false',"response.headers.get('cache-control'),'private, no-store'",'parseShiftRuleBindingResponse(await response.json()',
    "['POST',{},405]","['GET',{enabled:()=>false},404]","MerchantEnterpriseAccessError('unauthorized',401)",'rejected_handler_called_SQL'])assert(source.includes(marker),marker);
});

test('all reads and rollback probes fingerprint every table plus definitions and private ACLs',()=>{
  for(const marker of ['const before=fingerprint();try{return await run();}finally','reader_changed_fixture_facts','reader_changed_definitions','const baseline=fingerprint()',
    "['anon','authenticated','service_role']",'has_function_privilege',"SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER",'assert.equal(fingerprint(),baseline)',
    'assert.equal(oldDefinitions(),oldBefore)','assert.equal(definitions(),installed)'])assert(source.includes(marker),marker);
  for(const helper of ['object','scalar','graph'])assert(source.includes(`faolla_attendance_shift_rule_binding_${helper}_v1`));
});

test('flags restore on every exit and summary makes no production Auth four-channel or midnight claims',()=>{
  assert.match(source,/finally\{for\(const \[key,value\] of previous\)\{if\(value===undefined\)delete process\.env\[key\];else process\.env\[key\]=value;/);
  for(const marker of ['realAuth:false','syntheticPastRules:true','otherClockChannelsRetested:false','wallClockChanged:false','noBrowser:true','noListDiscovery:true',
    'productionAccess:false','newCluster:false','businessWritesFromReads:0','callerOwnedNamespaceCleanup:true'])assert(source.includes(marker),marker);
  assert.deepEqual(shiftRuleBindingReaderNativeFailure(Error('SQL secret token SELECT ...')),{error:'shift_rule_binding_reader_native_failed',phase:'entry',code:'local_check_failed'});
  assert.equal(shiftRuleBindingReaderNativeFailure(Error('ERROR: attendance_shift_rule_binding_invalid\nDETAIL secret')).code,'attendance_shift_rule_binding_invalid');
});
