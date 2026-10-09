// Pure construction/source checks only. Importing these files starts no DB,
// browser, service or listener, and supplies no evidence of live SQL acceptance.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {rulesNativeTables,rulesQueryInput,rulesNativeChoices,rulesNativeSave,rulesNativePublish,rulesNativeWithdraw,
  rulesNativeFailure,rulesMigrationPlan,rulesNativePlan,prepareRulesNativeFixture,checkAttendanceRulesNative,runAttendanceRulesNative} from './merchant-attendance-rules-native.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const source=readFileSync(new URL('./merchant-attendance-rules-native.mjs',import.meta.url),'utf8').replaceAll('\r\n','\n');
const owned={schema:'attendance_race_'+'c'.repeat(32),oid:300,tableOid:301,owner:'postgres',marker:'faolla-synthetic-concurrency:00000000-0000-4000-8000-000000000001'};
const scope={schema:owned.schema,sql:s=>s.replaceAll('public.',owned.schema+'.')};
const tables=['merchants','faolla_schema_migrations','merchant_enterprise_roles','merchant_enterprise_employees','merchant_attendance_settings','merchant_attendance_workers',
  'merchant_attendance_events','merchant_attendance_groups','merchant_attendance_group_operations','merchant_attendance_group_assignments','merchant_attendance_group_assignment_operations',...rulesNativeTables];
const plan=()=>rulesNativePlan(owned,tables);

test('native exports import inertly and delegate only to the established reused-cluster/owned-schema harness',()=>{
  for(const value of [prepareRulesNativeFixture,checkAttendanceRulesNative,runAttendanceRulesNative])assert.equal(typeof value,'function');
  assert.match(source,/if\(process\.argv\[1\]&&path\.resolve\(process\.argv\[1\]\)===fileURLToPath\(import\.meta\.url\)\)/);
  assert.match(source,/runAttendanceLabelsReuse\(args,native=>withAttendanceConcurrencySandbox/);
  assert.doesNotMatch(source,/spawn\(|pg_ctl|initdb|fetch\(|dotenv|disable trigger|create database|drop database/i);
});

test('only unchanged127 body is installed/reapplied after reusable124 preparation',()=>{
  const migration=rulesMigrationPlan(root,scope);assert.equal(migration.name,'202610040127_merchant_attendance_rule_versions.sql');
  assert.equal(migration.source,readFileSync(new URL(`./supabase-migrations/${migration.name}`,import.meta.url),'utf8'));
  assert.equal(migration.body,migration.source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''));assert.equal(migration.statement,scope.sql(migration.body));
  assert.doesNotMatch(migration.statement,/\bpublic\./);assert.throws(()=>rulesMigrationPlan(root,{...scope,schema:'public'}));
  assert(source.includes('await prepareGroupsNativeFixture(native,scope)'));assert(source.includes('rules_reapply_changed_definition_acl'));assert(source.includes('rules_reapply_changed_facts'));
  assert.doesNotMatch(source,/checkAttendanceGroupsNative\(/);assert(source.includes("for(const table of rulesNativeTables)assert.equal(exec(`select count(*) from public.${table};`),'0')"));
});

test('exact schema ownership guard and closed inventory protect every old table, including groups and settings',()=>{
  const p=plan();for(const marker of [owned.schema,owned.marker,'n.oid=300','c.oid=301',"n.nspowner::regrole::text='postgres'"])assert(p.guard.includes(marker));
  for(const patch of [{schema:'public'},{oid:0},{tableOid:2.5},{owner:'service_role'},{marker:'not-owned'}])assert.throws(()=>rulesNativePlan({...owned,...patch},tables));
  for(const inventory of [[...tables,'arbitrary;select'],[...tables,'public.foreign'],[...tables,'merchants'],tables.filter(t=>t!==rulesNativeTables[0])])assert.throws(()=>rulesNativePlan(owned,inventory));
  assert.deepEqual(rulesNativeTables,['merchant_attendance_rule_streams','merchant_attendance_rule_operations']);assert(Object.isFrozen(rulesNativeTables));
  for(const table of tables)assert(p.fingerprint.includes(`from public.${table} r`));
  for(const table of tables.filter(t=>!rulesNativeTables.includes(t)))assert(p.protectedFingerprint.includes(`from public.${table} r`));
  for(const table of rulesNativeTables)assert(!p.protectedFingerprint.includes(`from public.${table} r`));
});

test('exact four-key query and8/8/5 command contracts contain no silently inferred context',()=>{
  const query=rulesQueryInput(),save=rulesNativeSave(1001),publish=rulesNativePublish(1002,1,'2030-01-02'),withdraw=rulesNativeWithdraw(1003,2,2);
  assert.deepEqual(Object.keys(query),['siteId','groupId','operationId','beforeRevision']);assert.equal(query.groupId,null);assert.equal(query.operationId,null);assert.equal(query.beforeRevision,null);
  assert.deepEqual([save,publish,withdraw].map(value=>Object.keys(value).length),[8,8,5]);
  assert.equal(save.action,'save_draft');assert.equal(save.expectedRevision,0);assert.equal(save.expectedSettingsVersion,1);assert.equal(save.expectedGroupRevision,null);assert.equal(save.timeZone,'UTC');
  assert.equal(publish.effectiveOn,'2030-01-02');assert.equal(publish.expectedRevision,1);assert(!Object.hasOwn(publish,'rules'));assert.equal(withdraw.publishedRevision,2);assert(!Object.hasOwn(withdraw,'timeZone'));
  assert.equal(rulesNativeSave(2001,0,{expectedGroupRevision:1}).expectedGroupRevision,1);
});

test('synthetic rule fixture distinguishes zero, disabled, inherit and explicit positive value without shared aliases',()=>{
  const first=rulesNativeChoices(),second=rulesNativeChoices();
  assert.deepEqual(Object.keys(first),['lateGraceMinutes','earlyGraceMinutes','openSpanWarningMinutes','completedBreakMinimumMinutes']);
  assert.deepEqual(first,{lateGraceMinutes:{mode:'value',minutes:0},earlyGraceMinutes:{mode:'disabled'},openSpanWarningMinutes:{mode:'inherit'},completedBreakMinimumMinutes:{mode:'value',minutes:1}});
  for(const key of Object.keys(first))assert.notEqual(first[key],second[key]);first.lateGraceMinutes.minutes=20;assert.equal(second.lateGraceMinutes.minutes,0);
  assert.notEqual(rulesNativeSave(1).rules,rulesNativeSave(2).rules);
});

test('normal rule facts use actual RPC and parser projection; count/page oracles are independent of route statuses',()=>{
  assert.match(source,/JSON\.parse\(exec\(`set local role service_role;select \$\{expression/);assert(source.includes('parseRulesResult(raw,query,command,actor)'));
  assert(source.includes('for(let revision=4;revision<=26;revision++)'));assert(source.includes('assert.equal(first.items.length,25)'));assert(source.includes('assert.equal(second.items.length,1)'));
  assert(source.includes('Array.from({length:26},(_,n)=>26-n)'));assert(source.includes('streams:2,operations:31,enterpriseRevisions:26,groupRevisions:5,exactLockWitnesses:1'));
  assert.doesNotMatch(source,/insert into public\.merchant_attendance_rule_(?:streams|operations)/);
  assert.match(source,/rules_context_probe_not_restored/);assert.match(source,/rules_rollback_probes_changed_facts/);assert.match(source,/rules_final_changed_old_tables/);
});

test('bounded rejection/recovery probes cover owner, foreign group, original actor/stream, strict choices and DB-relative future boundaries',()=>{
  for(const marker of ['attendance_access_denied','attendance_group_not_found','attendance_settings_required','attendance_operation_conflict','attendance_platform_paused',
    'attendance_version_conflict','attendance_rule_group_inactive','attendance_rule_draft_required','attendance_rule_future_required','attendance_rule_already_withdrawn','attendance_rule_order_conflict',
    'original group receipt changed','paused original replay changed','current owner sees history with original actor provenance','withdrawal must retain unrelated current draft'])assert(source.includes(marker));
  assert(source.includes("clock_timestamp() at time zone 'UTC'"));assert(source.includes("clock_timestamp() at time zone 'Europe/Madrid'"));
  assert(source.includes("Date.parse(dates.future+'T00:00:00.000Z')"));assert(source.includes('future local midnight UTC binding'));assert.match(source,/end;\$checks\$;rollback;/);
  assert(source.includes('expectedGroupRevision:1},groupId,false'));assert(source.includes('completedBreakMinimumMinutes:{mode:\'value\',minutes:1440}'));
});

test('real exact-PID race, handler/service injection and private append-only fences remain bounded',()=>{
  assert.match(source,/await lifecycleRace\(/);assert(source.includes('assert.equal(race.witnessed,true)'));assert(source.includes('waiter must observe committed revision'));
  for(const marker of ['handleRules(request(query,command),dependencies)','executeRules(input,service)','parseRulesResponse(await response.json(),query,command,owner)',
    'unauthenticated handler must not reach SQL','rules_handler_recovery_changed_facts','rules_private_privilege_allowed','rules_update_allowed','rules_delete_allowed','rules_truncate_allowed'])assert(source.includes(marker));
  assert(source.includes('assert.equal(serviceCalls,4)'));assert.equal(plan().labels.length,11);assert.doesNotMatch(source,/setTimeout|grant |disable trigger/);
});

test('failure projection never emits raw SQL, arbitrary error strings, reason text or credentials',()=>{
  const result=rulesNativeFailure(Error('ERROR: attendance_operation_conflict\nSECRET SQL/reason/password\nPL/pgSQL function x line 12 at RAISE'));
  assert.equal(result.code,'attendance_operation_conflict');assert.equal(result.sourceLine,12);assert.equal(result.error,'rules_native_failed');assert(!JSON.stringify(result).includes('SECRET'));
  assert.equal(rulesNativeFailure(Error('ERROR: secret_password')).code,'local_check_failed');assert.equal(rulesNativeFailure({message:'private'}).sourceLine,null);
});

test('owned rollback truncate probe reaches the append-only trigger despite circular new-ledger foreign keys, with bounded SQL diagnostics',()=>{
  assert(source.includes("begin truncate public.merchant_attendance_rule_operations cascade;raise exception 'rules_truncate_allowed';exception when insufficient_privilege then null;end;"));
  const failure=rulesNativeFailure(Error('ERROR: 0A000: cannot truncate a table referenced in a foreign key constraint\nDETAIL: PRIVATE table/SQL\nPL/pgSQL function inline_code_block line 4 at SQL statement'));
  assert.equal(failure.code,'foreign_key_truncate_restriction');assert.equal(failure.sqlState,'0A000');assert.equal(failure.sqlMessage,'cannot truncate a table referenced in a foreign key constraint');assert.equal(failure.sourceLine,4);
  assert(!JSON.stringify(failure).includes('PRIVATE'));
  const denied=rulesNativeFailure(Error('ERROR: permission denied for table secret_table'));
  assert.equal(denied.code,'permission_denied');assert.equal(denied.sqlMessage,'permission denied for a protected database object');assert(!JSON.stringify(denied).includes('secret_table'));
});
