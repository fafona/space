// Pure construction/source tests only. They do not claim live SQL acceptance.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {scheduleOverviewMigrationPlan,scheduleOverviewNativePlan,scheduleOverviewQueryInput,scheduleOverviewNativeFailure,
  prepareScheduleOverviewNativeFixture,checkAttendanceScheduleOverviewNative} from './merchant-attendance-schedule-overview-native.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),source=readFileSync(new URL('./merchant-attendance-schedule-overview-native.mjs',import.meta.url),'utf8').replaceAll('\r\n','\n');
const owned={schema:'attendance_race_'+ 'a'.repeat(32),oid:300,tableOid:301,owner:'postgres',marker:'faolla-synthetic-concurrency:00000000-0000-4000-8000-000000000001'};
const tables=['merchants','merchant_attendance_settings','merchant_attendance_events','merchant_enterprise_roles','merchant_enterprise_employees','merchant_attendance_locations','merchant_attendance_workers','merchant_attendance_employment_periods',
  'merchant_attendance_schedule_commands','merchant_attendance_schedule_slots','merchant_attendance_schedule_cancellations','faolla_schema_migrations'];
const scope={schema:owned.schema,sql:s=>s.replaceAll('public.',owned.schema+'.')};
const plan=()=>scheduleOverviewNativePlan(owned,tables,'2026-10-05');

test('construction imports without starting a server and exposes the agreed fixture/check interfaces',()=>{
  assert.equal(typeof prepareScheduleOverviewNativeFixture,'function');assert.equal(typeof checkAttendanceScheduleOverviewNative,'function');
  assert.match(source,/if\(process\.argv\[1\]&&path\.resolve\(process\.argv\[1\]\)===fileURLToPath\(import\.meta\.url\)\)/);
  assert.match(source,/runAttendanceLabelsReuse\(args,native=>withAttendanceConcurrencySandbox/);
  assert.doesNotMatch(source,/spawn\(|pg_ctl|initdb|fetch\(|dotenv|\.env\b|disable trigger/i);
});

test('only099 and120 are installed as exact source with transaction-shell/schema adaptation, never119 or writer-body rewrites',()=>{
  const migration=scheduleOverviewMigrationPlan(root,scope);
  assert.deepEqual(migration.map(m=>m.name),['202610010099_merchant_attendance_schedule.sql','202610030120_merchant_attendance_schedule_overview.sql']);
  for(const m of migration){
    assert.equal(m.source,readFileSync(new URL(`./supabase-migrations/${m.name}`,import.meta.url),'utf8'));
    assert.equal(m.body,m.source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''));
    assert.equal(m.statement,scope.sql(m.body));assert.doesNotMatch(m.statement,/\bpublic\./);
  }
  assert.throws(()=>scheduleOverviewMigrationPlan(root,{...scope,schema:'public'}));
});

test('every transaction requires exact schema OID/table OID/owner/marker and cannot interpolate arbitrary table identifiers',()=>{
  const p=plan();for(const value of [owned.schema,owned.marker,'n.oid=300','c.oid=301',"n.nspowner::regrole::text='postgres'"])assert(p.guard.includes(value));
  for(const change of [{schema:'public'},{oid:0},{tableOid:1.5},{owner:'service_role'},{marker:'unknown'}])assert.throws(()=>scheduleOverviewNativePlan({...owned,...change},tables,'2026-10-05'));
  for(const bad of [['merchants;select secret'],[...tables,'public.foreign'],[...tables,'merchants']])assert.throws(()=>scheduleOverviewNativePlan(owned,bad,'2026-10-05'));
  assert.match(source,/assert\.deepEqual\(assertLifecycleSandbox\(raw\),owned/);
  assert.match(source,/start\.test\(source\)\?source\.replace\(start,`\$1reset role;\$\{guard\}/);
});

test('seed creates only synthetic identity/configuration in an empty namespace; all72 planned rows use original099',()=>{
  const p=plan();assert(p.seed.includes("assert not exists(select 1 from public.merchants)"));
  assert.deepEqual([...p.seed.matchAll(/insert into public\.(\w+)/g)].map(m=>m[1]),['merchants','merchant_enterprise_roles','merchant_enterprise_employees','merchant_attendance_settings','merchant_attendance_locations','merchant_attendance_workers','merchant_attendance_employment_periods']);
  assert.doesNotMatch(p.seed,/schedule_(slots|commands|cancellations)|attendance_events/);
  assert.equal(p.workers.length,3);assert.equal(p.locations.length,3);assert.deepEqual(p.zones,['UTC','Europe/Madrid','Pacific/Kiritimati']);
  assert.equal(p.slots.length,24);for(const [start,end] of p.slots){assert.equal(Date.parse(end)-Date.parse(start),900000);assert.equal(Date.parse(start)%60000,0);}
  assert.match(source,/for\(let n=0;n<workers\.length;n\+\+\)publish\(n,plan\.slots\);cancel\(rows\(\)\[0\]\.id\)/);
  assert.match(source,/return JSON\.parse\(exec\(`set local role service_role;select \$\{writer/);
  assert.match(source,/assert\.equal\(expectedRows\.length,72\)/);
});

test('oracle independently projects old slots/cancellations at selected revision with snapshot fields and supplies selectable worker labels',()=>{
  const rows=source.slice(source.indexOf('const rows='),source.indexOf('const cancel='));
  assert(rows.includes('from public.merchant_attendance_schedule_slots s left join public.merchant_attendance_schedule_cancellations c'));
  assert(rows.includes('and c.revision<=${asOf}'));assert(rows.includes('and s.revision<=${asOf}'));
  assert(rows.includes('order by s.work_date,s.start_at,s.id'));
  assert.doesNotMatch(rows,/overview_v1|data\.read|read\(/);
  assert.match(source,/workerChoices:workers\.map\(\(worker,n\)=>\(\{id:worker,displayName:names\[n\],workerNo:/);
  assert.match(source,/assert\.deepEqual\(all,data\.expectedRows\)/);assert.match(source,/assert\.deepEqual\(scans,\[50,22\]\)/);
});

test('version snapshots include real later099 writes and empty50-row page, while rollback checks preserve all facts',()=>{
  assert.match(source,/later rows must yield a bounded empty page/);assert.match(source,/frozen snapshot complete/);assert.match(source,/fresh snapshot sees real later publications/);
  assert.match(source,/expectedRevision:4\+n/);assert.match(source,/expectedRevision:6/);
  assert.match(source,/assert total=72/);assert.match(source,/assert total=132/);
  assert.match(source,/native\.querySteps\(/);assert.match(source,/end;\$future\$;rollback;/);
  assert.match(source,/read\(\{revision:0\}\)/);assert.match(source,/read\(\{revision:3\}\)/);
  const p=plan();for(const table of tables)assert(p.fingerprint.includes(`from public.${table} r`));
  for(const table of tables.filter(t=>!t.startsWith('merchant_attendance_schedule_')))assert(p.protectedFingerprint.includes(`from public.${table} r`));
  for(const table of tables.filter(t=>t.startsWith('merchant_attendance_schedule_')))assert(!p.protectedFingerprint.includes(`from public.${table} r`));
});

test('current revocation, foreign selection, inactive/rebound history, malformed rows and original private ACLs have explicit negative assertions',()=>{
  for(const marker of ["update public.merchants set user_id=",'employee_id=null',"status='disabled'",'workerIds:[foreignWorker]',"denied('attendance_settings_required'",'schedule_overview_browser_execute_allowed','schedule_overview_private_table_read_allowed'])assert(source.includes(marker));
  assert(source.includes("denied('attendance_schedule_overview_invalid'"));
  assert(source.includes('Existing immutable rows/triggers are untouched'));
  assert.match(source,/rollback\(`insert into public\.merchant_attendance_schedule_slots/);
  assert.doesNotMatch(source,/update public\.merchant_attendance_schedule_(commands|slots|cancellations)|delete from public\./);
  assert.match(source,/assert\.equal\(data\.fingerprint\(\),baseline,'schedule_overview_reads_or_rollback_changed_facts'\)/);
});

test('query factory is exact8 and diagnostic errors never expose raw SQL, private strings or credentials',()=>{
  const q=scheduleOverviewQueryInput('2026-10-05','2026-10-08');
  assert.deepEqual(Object.keys(q),['siteId','workerIds','fromDate','throughDate','revision','cursorDate','cursorStart','cursorId']);
  assert.equal(q.revision,null);assert.deepEqual(q.workerIds,plan().workers);
  assert.equal(scheduleOverviewQueryInput(q.fromDate,q.throughDate,{revision:0}).revision,0);
  const boundary=scheduleOverviewQueryInput('2000-01-01','2000-01-01',{revision:4,cursorDate:'2000-01-01',cursorStart:'1999-12-31T12:00:00.000Z',cursorId:plan().workers[0]});
  assert.equal(boundary.cursorStart,'1999-12-31T12:00:00.000Z');
  assert(source.includes("cursorDate:'2000-01-01',cursorStart:'1999-12-31T12:00:00.000Z'"));
  const safe=scheduleOverviewNativeFailure(Error('ERROR: attendance_access_denied\nSQL secret\nPL/pgSQL function fixture line 8 at RAISE'));
  assert.equal(safe.code,'attendance_access_denied');assert.equal(safe.sourceLine,8);assert(!JSON.stringify(safe).includes('secret'));
  assert.equal(scheduleOverviewNativeFailure(Error('ERROR: secret_password')).code,'local_check_failed');
});
