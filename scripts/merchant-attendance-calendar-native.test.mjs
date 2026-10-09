// Pure construction/source checks, not live SQL or browser acceptance evidence.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {calendarMigrationPlan,calendarNativePlan,calendarQueryInput,calendarNativeCreate,calendarNativeCancel,calendarNativeFailure,
  prepareCalendarNativeFixture,checkAttendanceCalendarNative} from './merchant-attendance-calendar-native.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),source=readFileSync(new URL('./merchant-attendance-calendar-native.mjs',import.meta.url),'utf8').replaceAll('\r\n','\n');
const owned={schema:'attendance_race_'+'c'.repeat(32),oid:300,tableOid:301,owner:'postgres',marker:'faolla-synthetic-concurrency:00000000-0000-4000-8000-000000000001'};
const scope={schema:owned.schema,sql:s=>s.replaceAll('public.',owned.schema+'.')};
const tables=['merchants','faolla_schema_migrations','merchant_enterprise_roles','merchant_enterprise_employees','merchant_attendance_settings','merchant_attendance_locations','merchant_attendance_workers',
  'merchant_attendance_events','merchant_attendance_calendar_entries','merchant_attendance_calendar_operations'];
const plan=()=>calendarNativePlan(owned,tables,'2026-10-03');
test('prepare/check imports do not start services and remain callable only inside existing owned cluster machinery',()=>{
  assert.equal(typeof prepareCalendarNativeFixture,'function');assert.equal(typeof checkAttendanceCalendarNative,'function');
  assert.match(source,/if\(process\.argv\[1\]&&path\.resolve\(process\.argv\[1\]\)===fileURLToPath\(import\.meta\.url\)\)/);
  assert.match(source,/runAttendanceLabelsReuse\(args,native=>withAttendanceConcurrencySandbox/);assert.doesNotMatch(source,/spawn\(|pg_ctl|initdb|fetch\(|dotenv|disable trigger/i);
});
test('only123 original source is installed/reapplied with transaction-shell/schema adaptation and owner/ACL/fact checks',()=>{
  const m=calendarMigrationPlan(root,scope);assert.equal(m.name,'202610030123_merchant_attendance_calendar.sql');
  assert.equal(m.source,readFileSync(new URL(`./supabase-migrations/${m.name}`,import.meta.url),'utf8'));
  assert.equal(m.body,m.source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''));assert.equal(m.statement,scope.sql(m.body));assert.doesNotMatch(m.statement,/\bpublic\./);
  assert.throws(()=>calendarMigrationPlan(root,{...scope,schema:'public'}));
  assert.match(source,/exec\(migration\.body\);assert\.equal\(installed\(\),definition/);assert(source.includes('calendar_reapply_changed_facts'));
});
test('exact schema/table OIDs, owner and marker guard each transaction, rejecting arbitrary inventory identifiers',()=>{
  const p=plan();for(const marker of [owned.schema,owned.marker,'n.oid=300','c.oid=301',"n.nspowner::regrole::text='postgres'"])assert(p.guard.includes(marker));
  for(const patch of [{schema:'public'},{oid:0},{tableOid:2.5},{owner:'service_role'},{marker:'not-owned'}])assert.throws(()=>calendarNativePlan({...owned,...patch},tables,'2026-10-03'));
  for(const list of [[...tables,'arbitrary;select'],[...tables,'public.foreign'],[...tables,'merchants']])assert.throws(()=>calendarNativePlan(owned,list,'2026-10-03'));
  assert.match(source,/assert\.deepEqual\(assertLifecycleSandbox\(raw\),owned/);assert.match(source,/start\.test\(source\)\?source\.replace\(start,`\$1reset role;\$\{guard\}/);
});
test('fresh preparation seeds only merchant/settings/locations, never calendar, employee, worker or attendance business facts',()=>{
  const p=plan();assert(p.seed.includes("assert not exists(select 1 from public.merchants)"));
  assert.deepEqual([...p.seed.matchAll(/insert into public\.(\w+)/g)].map(m=>m[1]),['merchants','merchant_attendance_settings','merchant_attendance_locations']);
  assert(p.seed.includes("'Europe/Madrid',true"));assert(p.seed.includes("'UTC',false"));assert(p.seed.includes("'UTC',false,false"));
  assert.equal(p.fromDate,'2026-10-05');assert.equal(p.throughDate,'2026-10-07');
  assert.match(source,/seededCalendarEntries:0,seededAttendanceEvents:0/);
});
test('query and command factories preserve exact8/11/5 protocol fields and do not silently convert local dates to instants',()=>{
  const p=plan(),q=calendarQueryInput(),c=calendarNativeCreate(1001,p.fromDate,p.throughDate);
  assert.deepEqual(Object.keys(q),['siteId','locationId','fromDate','throughDate','entryId','operationId','beforeAt','beforeId']);
  assert.equal(q.fromDate,null);assert.equal(q.locationId,null);assert.equal(Object.keys(c).length,11);assert.equal(c.expectedLocationVersion,null);assert.equal(c.timeZone,'UTC');
  assert.equal(c.fromDate,'2026-10-05');assert.equal(c.throughDate,'2026-10-07');
  const cancelled=calendarNativeCancel(2001,c.operationId);assert.equal(Object.keys(cancelled).length,5);assert.equal(cancelled.expectedRevision,1);assert.equal(cancelled.entryId,c.operationId);
});
test('normal records use actual RPC and independently fixed counts, preserving historical receipts and current detail across later cancel',()=>{
  assert.match(source,/for\(let n=1001;n<=1028;n\+\+\)/);assert.match(source,/for\(let n=1101;n<=1102;n\+\+\)/);
  assert.match(source,/JSON\.parse\(exec\(`set local role service_role;select \$\{expression/);
  assert(source.includes('Array.from({length:28},(_,n)=>id(1028-n))'));assert(source.includes('Object.keys(row).length===11'));
  assert(source.includes('entries:30,operations:33,exactLockWitnesses:1'));assert(source.includes("receipt.item.status,'created'"));assert(source.includes("detail.status,'cancelled'"));
  assert.doesNotMatch(source,/insert into public\.merchant_attendance_calendar_entries|update public\.merchant_attendance_calendar_(?:entries|operations)/);
  assert(source.includes('New inconsistent synthetic operation only, rolled back'));
});
test('scope/date/version/actor negative cases roll back while a genuine exact-blocker race tests cancellation CAS without sleeping as evidence',()=>{
  for(const marker of ['attendance_calendar_not_found','attendance_calendar_location_inactive','attendance_calendar_closed','attendance_version_conflict','attendance_operation_conflict',
    'inactive changed location can be cancelled','other actor receipt is opaque','current new owner may cancel older record','internal skipped label','DST23h','DST25h','366 inclusive dates',
    'calendar_browser_execute_allowed','calendar_private_privilege_allowed'])assert(source.includes(marker));
  assert.match(source,/end;\$checks\$;rollback;/);assert.match(source,/await lifecycleRace\(/);assert(source.includes('assert.equal(race.witnessed,true)'));
  assert(source.includes('waiter must observe committed cancellation'));assert.doesNotMatch(source,/setTimeout|grant |disable trigger/);
  const p=plan();for(const t of tables)assert(p.fingerprint.includes(`from public.${t} r`));
  for(const t of tables.filter(t=>!t.startsWith('merchant_attendance_calendar_')))assert(p.protectedFingerprint.includes(`from public.${t} r`));
  for(const t of tables.filter(t=>t.startsWith('merchant_attendance_calendar_')))assert(!p.protectedFingerprint.includes(`from public.${t} r`));
});
test('diagnostics expose bounded codes/phase/line only and never raw reasons, SQL or credentials',()=>{
  const e=calendarNativeFailure(Error('ERROR: attendance_calendar_closed\nSECRET reason/token\nPL/pgSQL function x line 12 at RAISE'));
  assert.equal(e.code,'attendance_calendar_closed');assert.equal(e.sourceLine,12);assert(!JSON.stringify(e).includes('SECRET'));
  assert.equal(calendarNativeFailure(Error('ERROR: secret_password')).code,'local_check_failed');assert.equal(plan().labels.length,9);
});
