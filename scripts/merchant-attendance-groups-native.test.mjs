// Pure construction/source checks, not live PostgreSQL or browser proof.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {groupsMigrationPlan,groupsNativePlan,groupsQueryInput,groupsNativeSave,groupsNativeAssign,groupsNativeEnd,groupsNativeCancel,groupsNativeFailure,
  prepareGroupsNativeFixture,checkAttendanceGroupsNative} from './merchant-attendance-groups-native.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),source=readFileSync(new URL('./merchant-attendance-groups-native.mjs',import.meta.url),'utf8').replaceAll('\r\n','\n');
const owned={schema:'attendance_race_'+'c'.repeat(32),oid:300,tableOid:301,owner:'postgres',marker:'faolla-synthetic-concurrency:00000000-0000-4000-8000-000000000001'};
const scope={schema:owned.schema,sql:s=>s.replaceAll('public.',owned.schema+'.')};
const tables=['merchants','faolla_schema_migrations','merchant_enterprise_roles','merchant_enterprise_employees','merchant_attendance_settings','merchant_attendance_workers',
  'merchant_attendance_events','merchant_attendance_groups','merchant_attendance_group_operations','merchant_attendance_group_assignments','merchant_attendance_group_assignment_operations'];
const changed=tables.slice(-4),plan=()=>groupsNativePlan(owned,tables);

test('prepare/check imports are inert and use the existing owned namespace/reused cluster runner only',()=>{
  assert.equal(typeof prepareGroupsNativeFixture,'function');assert.equal(typeof checkAttendanceGroupsNative,'function');
  assert.match(source,/if\(process\.argv\[1\]&&path\.resolve\(process\.argv\[1\]\)===fileURLToPath\(import\.meta\.url\)\)/);
  assert.match(source,/runAttendanceLabelsReuse\(args,native=>withAttendanceConcurrencySandbox/);assert.doesNotMatch(source,/spawn\(|pg_ctl|initdb|fetch\(|dotenv|disable trigger/i);
});
test('only original124 is installed/reapplied, with no business-source rewrite and owner/ACL/index/fact equality',()=>{
  const m=groupsMigrationPlan(root,scope);assert.equal(m.name,'202610030124_merchant_attendance_groups.sql');
  assert.equal(m.source,readFileSync(new URL(`./supabase-migrations/${m.name}`,import.meta.url),'utf8'));
  assert.equal(m.body,m.source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''));assert.equal(m.statement,scope.sql(m.body));assert.doesNotMatch(m.statement,/\bpublic\./);
  assert.throws(()=>groupsMigrationPlan(root,{...scope,schema:'public'}));assert(source.includes('groups_reapply_changed_definition_acl'));assert(source.includes('groups_reapply_changed_facts'));
});
test('every constructed transaction has exact namespace/table OIDs, owner and marker and closed inventory identifiers',()=>{
  const p=plan();for(const marker of [owned.schema,owned.marker,'n.oid=300','c.oid=301',"n.nspowner::regrole::text='postgres'"])assert(p.guard.includes(marker));
  for(const patch of [{schema:'public'},{oid:0},{tableOid:2.5},{owner:'service_role'},{marker:'not-owned'}])assert.throws(()=>groupsNativePlan({...owned,...patch},tables));
  for(const list of [[...tables,'arbitrary;select'],[...tables,'public.foreign'],[...tables,'merchants']])assert.throws(()=>groupsNativePlan(owned,list));
  assert.match(source,/assert\.deepEqual\(assertLifecycleSandbox\(raw\),owned/);assert.match(source,/start\.test\(source\)\?source\.replace\(start,`\$1reset role;\$\{guard\}/);
});
test('fresh seed contains only merchant/membership/settings/worker infrastructure, zero groups/assignments/clock facts',()=>{
  const p=plan();assert(p.seed.includes("assert not exists(select 1 from public.merchants)"));
  assert.deepEqual([...p.seed.matchAll(/insert into public\.(\w+)/g)].map(m=>m[1]),['merchants','merchant_enterprise_roles','merchant_enterprise_employees','merchant_attendance_settings','merchant_attendance_workers']);
  assert(p.seed.includes("array['enterprise.view']"));assert(p.seed.includes("'UTC',false,false"));assert(p.seed.includes("'GROUP-INACTIVE','合成停用档案',false"));
  assert.match(source,/seededGroups:0,seededAssignments:0,seededAttendanceEvents:0/);assert.doesNotMatch(p.seed,/employment_periods|default_location_id|attendance\.self\.clock/);
});
test('query and command factories preserve exact8/8/11/6/5 contracts and endsOn null does not become a UTC instant',()=>{
  const p=plan(),q=groupsQueryInput(),save=groupsNativeSave(1001),assign=groupsNativeAssign(2001,save.groupId,p.workerId),end=groupsNativeEnd(3001,assign.operationId,'2026-03-31'),cancel=groupsNativeCancel(3002,assign.operationId,{expectedRevision:2});
  assert.deepEqual(Object.keys(q),['siteId','view','groupId','workerId','onDate','assignmentId','operationId','cursorId']);assert.equal(q.view,'context');
  assert.deepEqual([save,assign,end,cancel].map(c=>Object.keys(c).length),[8,11,6,5]);assert.equal(save.groupId,save.operationId);assert.equal(save.expectedRevision,0);
  assert.equal(assign.endsOn,null);assert.equal(assign.timeZone,'UTC');assert.equal(end.endsOn,'2026-03-31');assert.equal(cancel.expectedRevision,2);
});
test('normal group/assignment rows are actual RPC writes with independent count and ordered-ID oracles, including historical end/cancel snapshots',()=>{
  assert.match(source,/for\(let n=1001;n<=1028;n\+\+\)/);assert.match(source,/for\(let i=0;i<28;i\+\+\)/);
  assert.match(source,/JSON\.parse\(exec\(`set local role service_role;select \$\{expression/);
  assert(source.includes('Array.from({length:28},(_,n)=>id(2028-n))'));assert(source.includes('Object.keys(r).length===14'));assert(source.includes("['assign','end','cancel']"));
  assert(source.includes('groups:28,groupOperations:29,assignments:31,assignmentOperations:35,exactLockWitnesses:1'));
  assert.doesNotMatch(source,/insert into public\.merchant_attendance_groups|insert into public\.merchant_attendance_group_assignments|update public\.merchant_attendance_group/);
  assert(source.includes('new synthetic inconsistent operation, always rolled back'));
});
test('rollback probes cover bounds/identity/actor/cross-ledger errors and a real exact-blocker race tests committed cross-group overlap',()=>{
  for(const marker of ['attendance_group_overlap','attendance_group_inactive','attendance_group_worker_inactive','attendance_group_closed','attendance_version_conflict','attendance_operation_conflict',
    'worker/group inactivity does not prevent ending','snapshot does not inherit current name/binding/zone','new owner cannot inherit old actor receipt','internal skipped day',
    'groups_private_privilege_allowed','groups_helper_execute_allowed'])assert(source.includes(marker));
  assert.match(source,/end;\$checks\$;rollback;/);assert.match(source,/await lifecycleRace\(/);assert(source.includes('assert.equal(race.witnessed,true)'));
  assert(source.includes('waiter must observe committed cross-group assignment'));assert.doesNotMatch(source,/setTimeout|grant |disable trigger/);
  const p=plan();for(const t of tables)assert(p.fingerprint.includes(`from public.${t} r`));
  for(const t of tables.filter(t=>!changed.includes(t)))assert(p.protectedFingerprint.includes(`from public.${t} r`));
  for(const t of changed)assert(!p.protectedFingerprint.includes(`from public.${t} r`));
});
test('safe diagnostic projection exposes only phase/known code/line, never raw SQL or user values',()=>{
  const e=groupsNativeFailure(Error('ERROR: attendance_group_overlap\nSECRET reason/token\nPL/pgSQL function x line 12 at RAISE'));
  assert.equal(e.code,'attendance_group_overlap');assert.equal(e.sourceLine,12);assert(!JSON.stringify(e).includes('SECRET'));
  assert.equal(groupsNativeFailure(Error('ERROR: secret_password')).code,'local_check_failed');assert.equal(plan().labels.length,9);
});
