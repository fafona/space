// Pure harness contracts only. These tests never start a database or listener.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {sourcesNativeDependencies,sourcesQueryInput,sourcesNativeProposal,sourcesNativePlan,sourcesMigrationPlan,sourcesNativeFailure,assertSourcesSections,
  prepareSourcesNativeFixture,checkAttendanceSourcesNative,runAttendanceSourcesNative} from './merchant-attendance-sources-native.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const source=readFileSync(new URL('./merchant-attendance-sources-native.mjs',import.meta.url),'utf8').replaceAll('\r\n','\n');
const owned={schema:'attendance_race_'+'d'.repeat(32),oid:300,tableOid:301,owner:'postgres',marker:'faolla-synthetic-concurrency:00000000-0000-4000-8000-000000000001'};
const scope={schema:owned.schema,sql:s=>s.replaceAll('public.',owned.schema+'.')};
const tables=['merchants','faolla_schema_migrations','merchant_enterprise_roles','merchant_enterprise_employees','merchant_attendance_settings','merchant_attendance_workers',
  'merchant_attendance_events','merchant_attendance_groups','merchant_attendance_group_operations','merchant_attendance_group_assignments','merchant_attendance_group_assignment_operations',
  'merchant_attendance_rule_streams','merchant_attendance_rule_operations','merchant_attendance_leave_requests','merchant_attendance_leave_entries'];
const result=()=>({protocol:'sources-v1',attendance:{complete:true,payrollReady:false},
  ...Object.fromEntries(['assignments','rules','schedule','leave','calendar'].map(key=>[key,{limited:false,items:[]} ])),
  warnings:['candidate_rules_not_applied','historical_context_not_pinned','personal_exceptions_not_supported']});

test('module is inert on import and delegates only to the existing owned reused-cluster runner',()=>{
  for(const fn of [prepareSourcesNativeFixture,checkAttendanceSourcesNative,runAttendanceSourcesNative])assert.equal(typeof fn,'function');
  assert.match(source,/if\(process\.argv\[1\]&&path\.resolve\(process\.argv\[1\]\)===fileURLToPath\(import\.meta\.url\)\)/);
  assert.match(source,/runAttendanceLabelsReuse\(args,native=>withAttendanceConcurrencySandbox/);
  assert.doesNotMatch(source,/spawn\(|pg_ctl|initdb|fetch\(|dotenv|disable trigger|create database|drop database/i);
  assert(source.includes('await prepareGroupsNativeFixture(native,scope)'));assert.doesNotMatch(source,/checkUnifiedReport\(|prepareOwnerBacklogNativeFixture\(|checkAttendanceGroupsNative\(/);
});

test('exact actual dependency bodies include latest approved revisions without duplicating foundation/groups seed or changing old code',()=>{
  assert(Object.isFrozen(sourcesNativeDependencies));assert.equal(new Set(sourcesNativeDependencies).size,sourcesNativeDependencies.length);
  for(const revision of ['093','098','099','103','121','122','123','127'])assert(sourcesNativeDependencies.some(name=>name.slice(9,12)===revision));
  assert(!sourcesNativeDependencies.some(name=>name.includes('124_')||name.includes('061_')));
  for(const name of sourcesNativeDependencies)assert(readFileSync(new URL(`./supabase-migrations/${name}`,import.meta.url),'utf8').length>0);
  const migration=sourcesMigrationPlan(root,scope);assert.equal(migration.name,'202610040128_merchant_attendance_sources.sql');
  assert.equal(migration.source,readFileSync(new URL(`./supabase-migrations/${migration.name}`,import.meta.url),'utf8'));
  assert.equal(migration.body,migration.source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''));assert.equal(migration.statement,scope.sql(migration.body));
  assert.doesNotMatch(migration.statement,/\bpublic\./);assert.throws(()=>sourcesMigrationPlan(root,{...scope,schema:'public'}));
  for(const marker of ['sources_install_changed_prior_definition_acl','sources_install_changed_business','sources_reapply_changed_installation','sources_reapply_changed_facts'])assert(source.includes(marker));
});

test('exact namespace OID owner marker guard and closed inventory fingerprint every table with no exempt writer tables',()=>{
  const plan=sourcesNativePlan(owned,tables);assert.equal(plan.labels.length,8);
  for(const marker of [owned.schema,owned.marker,'n.oid=300','c.oid=301',"n.nspowner::regrole::text='postgres'"])assert(plan.guard.includes(marker));
  for(const patch of [{schema:'public'},{oid:0},{tableOid:2.5},{owner:'service_role'},{marker:'not-owned'}])assert.throws(()=>sourcesNativePlan({...owned,...patch},tables));
  for(const inventory of [[...tables,'unsafe;sql'],[...tables,'public.foreign'],[...tables,'merchants']])assert.throws(()=>sourcesNativePlan(owned,inventory));
  for(const table of tables)assert(plan.fingerprint.includes(`from public.${table} r`));
  for(const table of tables.filter(t=>t!=='faolla_schema_migrations'))assert(plan.businessFingerprint.includes(`from public.${table} r`));
  assert(!plan.businessFingerprint.includes('from public.faolla_schema_migrations r'));
  assert.match(plan.fingerprint,/jsonb_object_agg\(name,facts order by name\)/);assert.match(source,/protectedFingerprint:fingerprint/);
});

test('single-worker four-key query does not invent historical asOf, implicit source filters, rule settings or worker identity',()=>{
  const q=sourcesQueryInput('2030-01-02');assert.deepEqual(Object.keys(q),['siteId','workerId','fromDate','throughDate']);assert.equal(q.fromDate,q.throughDate);
  assert.equal(q.siteId,'99990001');assert.equal(q.workerId,'00000000-0000-4000-8000-000000000201');
  assert.equal(sourcesQueryInput('2030-01-02','2030-01-08').throughDate,'2030-01-08');
  assert(source.includes("clock_timestamp() at time zone 'UTC'"));assert(source.includes('parseSourcesResult(raw,query,actor)'));
  assert(source.includes('select ${expression(query,actor)}'));assert(source.includes('exact seven inclusive local dates'));
});

test('normal contextual and latest approved source facts are generated by actual RPCs, never fabricated approval/source responses',()=>{
  for(const rpc of ['faolla_attendance_correction_self_v3','faolla_attendance_correction_decide_v2','faolla_attendance_revision_self_v2','faolla_attendance_revision_decide_v2',
    'faolla_attendance_missing_v1','faolla_attendance_schedule_v1','faolla_attendance_leave_v1','faolla_attendance_calendar_v1','faolla_attendance_rules_v1'])assert(source.includes(rpc));
  assert.doesNotMatch(source,/insert into public\.merchant_attendance_(?:rule_|group_|leave_|calendar_|correction_|effect_|missing_|schedule_)/);
  assert(source.includes('insert into public.merchant_attendance_events'));assert(source.includes('action:\'revise\''));
  assert(source.includes('assert.equal(corrected.correction.operationId,id(8113))'));assert(source.includes('assert.deepEqual(past.attendance.missing.map(row=>row.requestId),[id(8203)])'));
  assert(source.includes('assert.equal(ongoing.original.totals,null)'));assert(source.includes('zero completed-source sum is not evidence of absence'));
});

test('revision proposal fixture uses the existing effect guard canonical six-digit timestamps, separate from schedule/leave milliseconds',()=>{
  const p=sourcesNativeProposal('2030-01-02','02:00','03:30');
  assert.deepEqual(p,{startAt:'2030-01-02T02:00:00.000000Z',endAt:'2030-01-02T03:30:00.000000Z',breaks:[]});
  assert.notEqual(p.startAt,new Date(p.startAt).toISOString());assert.equal(Date.parse(p.startAt),Date.parse(new Date(p.startAt).toISOString()));
  assert(source.includes('sourcesNativeProposal(day(-1),start,end)'));assert(source.includes('`${day(offset)}T${time}:00.000Z`'));
  for(const time of ['24:00','02:60','2:00'])assert.throws(()=>sourcesNativeProposal('2030-01-02',time,'03:30'));
  assert.equal(sourcesNativeFailure(Error('ERROR: attendance_effect_version_invalid\nPRIVATE')).code,'attendance_effect_version_invalid');
});

test('future interval oracle never projects a currently open session beyond the report read time',()=>{
  assert(source.includes('assert.equal(past.attendance.base.openSessionCount,1)'));
  assert(source.includes('assert.equal(ongoing.original.totals,null)'));
  assert(source.includes('assert.equal(future.attendance.base.openSessionCount,0)'));
  assert(source.includes('assert.deepEqual(future.attendance.base.rows,[])'));
  assert(source.includes('assert(future.attendance.base.asOf<future.attendance.base.fromAt)'));
  assert(source.includes('assert.equal(future.attendance.base.periodInProgress,true'));
  const oldSql=readFileSync(new URL('./supabase-migrations/202610010093_merchant_attendance_versioned_reports.sql',import.meta.url),'utf8');
  assert(oldSql.includes('case when end_sequence is null then now_at>from_at'));
  const oldParser=readFileSync(new URL('../src/lib/merchantAttendanceTimesheet.ts',import.meta.url),'utf8');
  assert(oldParser.includes('r.endAt===null?r.startAt<toAt&&asOf>fromAt'));
});

test('bounded interval, cancellation, old-rule carry-in, identity and101-context probes have exact semantic oracles',()=>{
  for(const marker of ['row.startAt===at(2,\'22:00\')&&row.endAt===at(3,\'06:00\')','[\'assigned\',\'cancelled\']',
    "assert.equal(containing.summary.status,'cancelled')","assert.equal(containing.summary.startAt,at(2,'08:00'))","assert.equal(containing.summary.endAt,at(5,'16:00'))",
    'for(let n=0;n<30;n++)','assert.equal(enterprise.revision,35)','assert.deepEqual(enterprise.publications.map(row=>row.operationId),[id(7502)])',
    "rebound.warnings.includes('identity_changed')",'Array.from({length:98}',"limited.warnings.includes('calendar_truncated')",
    'attendance_access_denied','attendance_worker_not_found','attendance_invalid_request'])assert(source.includes(marker),marker);
  assert(source.includes('assert.equal(limited.calendar.limited,true)'));assert(source.includes('assert.deepEqual(limited.calendar.items,[])'));
  assert(source.includes('assert.equal(limited.schedule.items.length,2)'));
});

test('one rollback sequence proves exact100 complete then101 empty without a second98-row seed or timeout increase',()=>{
  assert(source.includes('const [complete,limited]=data.probeSequence('));assert(source.includes('create(9098)'));
  assert(source.includes('assert.equal(complete.calendar.limited,false)'));assert(source.includes('assert.equal(complete.calendar.items.length,100)'));
  assert(source.includes('new Set([id(7401),id(7403),...Array.from({length:98},(_,n)=>id(9000+n))])'));
  assert(source.includes("assert(!complete.warnings.includes('calendar_truncated'))"));
  assert(source.includes('setups.length>=1&&setups.length<=2'));assert(source.includes('readCount+=raw.length'));
  assert.match(source,/setups\.map\(\(setup,index\)=>[\s\S]*?before_read:=\$\{plan\.fingerprint\}[\s\S]*?result:=\$\{expression\(query,actor\)\}[\s\S]*?assert \$\{plan\.fingerprint\}=before_read/);
  assert.doesNotMatch(source,/statement_timeout|timeout_ms|pg_sleep|setTimeout/);
});

test('complete-section oracle forbids partial truncation and assessment claims while preserving explicit limitations',()=>{
  assert.doesNotThrow(()=>assertSourcesSections(result()));
  for(const key of ['assignments','rules','schedule','leave','calendar']){
    const limited=result();limited[key]={limited:true,items:[]};assert.doesNotThrow(()=>assertSourcesSections(limited));
    limited[key].items.push({id:'partial'});assert.throws(()=>assertSourcesSections(limited));
    const tooMany=result();tooMany[key].items=Array.from({length:101},()=>({}));assert.throws(()=>assertSourcesSections(tooMany));
  }
  for(const key of ['assessment','absence','payroll']){const r=result();r[key]=false;assert.throws(()=>assertSourcesSections(r));}
  const ready=result();ready.attendance.payrollReady=true;assert.throws(()=>assertSourcesSections(ready));
  const noWarning=result();noWarning.warnings=[];assert.throws(()=>assertSourcesSections(noWarning));
});

test('each source read, denied read and rollback probe checks all facts and optional browser callback cannot mutate source tables',()=>{
  for(const marker of ['finally{assert.equal(fingerprint(),before,\'sources_read_changed_all_table_fingerprint\')',
    'sources_probe_read_changed_facts','sources_probe_not_restored','sources_denied_read_changed_facts',
    'sources_final_read_or_rollback_changed_all_tables','sources_browser_changed_all_tables',
    'sources_anon_execute','sources_authenticated_execute','sources_service_execute_required','sources_definer_required'])assert(source.includes(marker));
  assert.match(source,/select jsonb_agg\(value order by ordinal\) from sources_probe_result;rollback;/);assert.match(source,/assessmentPerformed:false/);
});

test('bounded failure diagnostics never echo SQL, arbitrary strings, identity fields or private reason text',()=>{
  const failure=sourcesNativeFailure(Error('ERROR: attendance_sources_invalid\nDETAIL: PRIVATE SQL/reason\nPL/pgSQL function x line 12 at RAISE'));
  assert.equal(failure.error,'sources_native_failed');assert.equal(failure.code,'attendance_sources_invalid');assert.equal(failure.sourceLine,12);assert(!JSON.stringify(failure).includes('PRIVATE'));
  assert.equal(sourcesNativeFailure(Error('ERROR: private_password')).code,'local_check_failed');assert.equal(sourcesNativeFailure({message:'private'}).sourceLine,null);
});
