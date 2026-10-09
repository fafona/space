// Pure/static assertions, not a claim that PostgreSQL/Chromium was run.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {checkAttendanceShiftCheckNative,runAttendanceShiftCheckNative,shiftCheckNativeLabels,shiftCheckDenseEventsSql,assertShiftCheckBrowserProjection} from './merchant-attendance-shift-check-native.mjs';
import {prepareShiftCheckNativeFixture,shiftCheckExpression,shiftCheckMigration} from './fixtures/attendance-shift-check-native.mjs';
import {lifecycleId as id} from './merchant-attendance-lifecycle-native-support.mjs';
const source=readFileSync(new URL('./merchant-attendance-shift-check-native.mjs',import.meta.url),'utf8');
const fixture=readFileSync(new URL('./fixtures/attendance-shift-check-native.mjs',import.meta.url),'utf8');

test('inert native exports bounded checks and reuses the owned stopped-PG wrapper, not broad old suites',()=>{
  for(const fn of [checkAttendanceShiftCheckNative,runAttendanceShiftCheckNative,prepareShiftCheckNativeFixture])assert.equal(typeof fn,'function');
  assert.equal(shiftCheckNativeLabels.length,7);assert(Object.isFrozen(shiftCheckNativeLabels));
  assert.match(source,/withAttendanceConcurrencySandbox\(native,async scope/);assert.match(source,/if\(process\.argv\[1\]/);
  assert.doesNotMatch(source+fixture,/checkAttendanceBoundClocksNative|checkAttendanceSelfSchedule\(|\bspawn\s*\(|session_replication_role|disable trigger/i);
});
test('new138 installation reapplication protects old facts and exact old function identities',()=>{
  assert.equal(shiftCheckMigration,'202610050138_merchant_attendance_shift_check.sql');
  for(const marker of ['oldOids','assert.equal(definitions(true),beforeDefs)','assert.deepEqual(inventory(),tables)','assert.equal(fingerprint(),installedFacts)'])assert(fixture.includes(marker));
  assert.match(fixture,/native.query\(scope.sql\(readFileSync\(path.join\(native.root,'scripts\/supabase-migrations\/202610050136/);
  assert.match(fixture,/sourcesNativeDependencies/);assert.match(fixture,/boundClockMigrationBody\(native.root,'202610050137/);
});
test('read expression fixes RPC and quotes both JSON query and actor',()=>{
  const query={siteId:'99990001',workerId:id(201),startEventId:id(401)};
  assert.equal(shiftCheckExpression(query,id(99)),`public.faolla_attendance_shift_check_v1('${JSON.stringify(query)}'::jsonb,'${id(99)}')`);
  assert.match(shiftCheckExpression({...query,extra:"O'Hara"},"x'y"),/O''Hara/);assert(shiftCheckExpression(query,"x'y").endsWith(",'x''y')"));
});
test('fixtures use real self services and correction approval plus revision RPCs, not injected approved JSON',()=>{
  for(const marker of ['executeAttendanceSelfSchedule({','executeAttendanceSelf({','faolla_attendance_correction_self_v3','faolla_attendance_correction_decide_v1',
    'faolla_attendance_revision_self_v2','faolla_attendance_revision_decide_v2','expectedEvidence','expectedEffectiveOperationId','proposal(30)'])assert(fixture.includes(marker));
  for(const marker of ['d.approveRevision(60)',"durationUs,'60000000'","state,'not_triggered'",'assert.deepEqual(latest.rule.evidence,first.rule.evidence)','assert.deepEqual(latest.events,first.events)'])assert(source.includes(marker));
  assert.match(fixture,/finally\{for\(const\[key,value\]of previous\)/);
});
test('synthetic cross-night is honest missing evidence with exact full UTC end beyond source window',()=>{
  assert.match(fixture,/NOT an actual cross-midnight clock wait/);assert.match(fixture,/NO historical binding/);
  for(const marker of ['cross.original.endAt>d.crossSource.toAt',"cross.rule.status,'missing'",'syntheticCrossNight:true','realCrossMidnightWait:false'])assert(source.includes(marker));
  assert.doesNotMatch(fixture,/update public\.merchant_attendance_events|update public\.merchant_attendance_shift_rule_/);
});
test('density has exact complete2002 and sentinel2003 with no trigger or constraint bypass',()=>{
  const d={site:'99990001',geoWorker:id(202),geoLocation:id(302),geoEmployee:id(102),day:()=> '2026-10-01'};
  const complete=shiftCheckDenseEventsSql(d,2002),over=shiftCheckDenseEventsSql(d,2003);
  assert.match(complete,/generate_series\(0,2001\)/);assert.match(complete,/when n=2001 then 'clock_out'/);
  assert.match(over,/generate_series\(0,2002\)/);assert.doesNotMatch(over,/then 'clock_out'/);
  for(const sql of [complete,over]){assert.match(sql,/set constraints all immediate/);assert.doesNotMatch(sql,/\bupdate\b|\bdelete\b|\balter\b|\bdisable\b/i);}
  assert.throws(()=>shiftCheckDenseEventsSql(d,2001));assert.throws(()=>shiftCheckDenseEventsSql({...d,site:"x';"},2002));
  assert.match(shiftCheckDenseEventsSql(d,2002,1900,100),/generate_series\(1900,1999\)/);
  assert.throws(()=>shiftCheckDenseEventsSql(d,2002,2000,3));
  for(const marker of ['offset+=100','native.querySteps(steps.map(scope.sql))','d.foundation.plan.guard',"'shift_check_dense_read_changed_facts'"])assert(source.includes(marker));
  assert.match(source,/dense.events.length,2002/);assert.match(source,/dense.original.breaks.length,1000/);assert.match(source,/attendance_shift_check_too_large/);
});
test('native checks actual owner and identity denial, paused matching read, and handler auth before SQL',()=>{
  for(const marker of ["status='disabled',auth_user_id=null",'employee_id=null,version=version+1',"paused.rule.worker.active,false",
    'handleShiftCheck(request(),dependencies)','executeShiftCheck(input,service)',"['p_auth_user_id','p_query']",'handlerSql,before',
    "allowEmployeeAttendance:false","forbidden.status,403","private, no-store"])assert(source.includes(marker));
  assert.match(source,/set constraints all immediate;rollback/);assert.match(source,/shift_check_changed_facts/);
});
test('browser projection audit recursively rejects private source text and history but keeps approved evidence',()=>{
  assertShiftCheckBrowserProjection({rule:{evidence:{sourceSha256:'abc'}},effect:{proposal:{breaks:[]}}});
  for(const key of ['sourceText','sourceGraph','history'])assert.throws(()=>assertShiftCheckBrowserProjection({nested:[{[key]:'sensitive'}]}));
  assert.match(source,/realAuthentication:false/);assert.match(source,/readsWriteNothing:true/);assert.match(source,/productionAccess:false/);
});
