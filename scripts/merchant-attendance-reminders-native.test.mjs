//Small SOURCE/pure/transport-double tests, NOT actual PG or PID acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {reminderNativeBudget as caps,reminderNativeSha,reminderNativeMigration,reminderNativeOldCatalogSql,installAndVerifyRemindersNative} from './merchant-attendance-reminders-native.mjs';
import {assertAttendanceNativeCatalogEqual} from './merchant-attendance-cycle-native.mjs';
import {reminderNativeSite as site,reminderNativeId as uid,reminderNativeFixedUuids,reminderNativeGroups,reminderNativeDispatchForecast as forecast,
 reminderNativeRules,reminderNativeIdentitySeed,reminderNativeHistoricalSeed,reminderNativeFactsSql,reminderNativeRpcExpression as rpc,
 reminderNativeFailure,reminderNativePidRace,verifyRemindersNative} from './fixtures/attendance-reminders-native.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),schema='attendance_race_'+'a'.repeat(32);
const source=readFileSync(path.join(root,'scripts/fixtures/attendance-reminders-native.mjs'),'utf8');
const adapter=readFileSync(path.join(root,'scripts/merchant-attendance-reminders-native.mjs'),'utf8');
const q={siteId:site,mode:'run',operationId:uid(1200),cursor:null};

test('201 imports inertly; owned ctx and frozen SQL required before actual execution',async()=>{
 assert.equal(typeof installAndVerifyRemindersNative,'function');assert.equal(typeof verifyRemindersNative,'function');
 await assert.rejects(()=>installAndVerifyRemindersNative({}));await assert.rejects(()=>verifyRemindersNative({}));
 for(const s of [source,adapter])assert.doesNotMatch(s,/import .*child_process|pg_ctl|initdb|createdb|process\.argv|listen\(/);
 assert.equal(createHash('sha256').update(readFileSync(path.join(root,'scripts/supabase-migrations',reminderNativeMigration))).digest('hex').toUpperCase(),reminderNativeSha);
});
test('201 explicit install-only mode preserves default full acceptance and does not report skipped business success',async()=>{
 for(const options of [{businessCases:'unknown'},{unexpected:true},null,[]])
  await assert.rejects(()=>installAndVerifyRemindersNative({},options),/reminder_native_(?:options|business_cases)_invalid/);
 assert.match(adapter,/businessCases='run'/);
 assert.match(adapter,/if\(businessCases==='run'\)acceptance=await\(await import/);
 assert.match(adapter,/else assert\.equal\(audit\.fingerprint\(names\),installed,'reminder_skip_installed_facts_changed'\)/);
 assert.match(adapter,/businessCasesExecuted:businessCases==='run'/);
 assert.match(adapter,/finally\{[\s\S]*reminder201_final_catalog[\s\S]*audit\.archiveBytes\('207'\)/);
});
test('201 exact eight groups and honest bounded RPC/SQL forecast, not execution evidence',()=>{
 assert.equal(reminderNativeGroups.length,8);assert.equal(new Set(reminderNativeGroups).size,8);
 assert.equal(Object.values(forecast.rpcByGroup).reduce((a,b)=>a+b,0),78);assert.equal(forecast.rpcCalls,78);
 assert.equal(forecast.rpcCalls+forecast.nonRpcSql+forecast.pidObserverQueries,176);
 assert.equal(caps.sql,180);assert.equal(caps.rpc,120);assert.equal(caps.milliseconds,120000);assert.equal(caps.protectionQueries,64);assert.equal(caps.maxConnections,3);
 assert.equal(caps.pidRaces,2);assert.equal(caps.pidPollsPerRace,34);assert.equal(caps.pidPollIntervalMs,75);assert.equal(caps.pidPollDeadlineMs,2500);
 assert.equal(forecast.repeat60MinuteExpiryActuallyWaited,false);assert.match(source,/distinctOperationConcurrentRunActuallyTested:false/);
 assert.match(source,/reminder201_group_actual_RPC_forecast/);assert.match(source,/\+\+sqlSteps<=caps\.sql/);assert.match(source,/\+\+rpcCalls<=caps\.rpc/);
});
test('201 site and all fixed/event pool UUIDs must not collide before synthetic write',()=>{
 assert.equal(site,'99990201');assert(!['99990196','99990197','99990198','99990200'].includes(site));
 assert.equal(new Set(reminderNativeFixedUuids).size,reminderNativeFixedUuids.length);
 const seed=reminderNativeIdentitySeed(uid(999),['merchants','merchant_attendance_events'],schema);
 for(const id of reminderNativeFixedUuids)assert(seed.includes(id));assert.match(seed,/unused_site_required/);assert.match(seed,/all_fixed_UUIDs_unused/);
 assert.match(seed,/attendance\.self\.view/);assert.match(seed,/attendance\.self\.clock/);assert.match(seed,/attendance\.self\.leave/);
 assert.match(seed,/attendance\.leave\.review/);assert.doesNotMatch(seed,/work_arrangement\.review|attendance\.self\.work_arrangement/);
});

test('201 leave source uses the actual122 self.leave permission, not the correction request permission',()=>{
 const leave=readFileSync(path.join(root,'scripts/supabase-migrations/202610030122_merchant_attendance_leave_requests.sql'),'utf8');
 assert.match(leave,/can_submit:=coalesce\(w\.active and 'attendance\.self\.leave'=any\(r\.permissions\),false\);/);
 const seed=reminderNativeIdentitySeed(uid(999),['merchants','merchant_attendance_events'],schema);
 assert.match(seed,/'Synthetic201 explicit self',array\['enterprise\.view','attendance\.self\.view','attendance\.self\.clock','attendance\.self\.leave'\]/);
 assert.doesNotMatch(seed,/'attendance\.self\.request'/);
 assert.match(source,/home=await leave\(leaveQ\(\)\);assert\(home\.canSubmit\)/);
});
test('201 only one explicitly disclosed historical rule template, actual canonical191 validators retained',()=>{
 const rules=reminderNativeRules();assert.equal(rules.reviewRouting.value.leave,'owner');
 assert.deepEqual(rules.reminders.value.pending_review,{mode:'enabled',afterMinutes:1,repeatMinutes:60,maxOccurrences:2});
 const seed=reminderNativeHistoricalSeed(uid(999));assert.doesNotMatch(seed,/99990200|Synthetic200/);assert.match(seed,/not a past publish RPC/);
 assert.match(seed,/operational_rule_context_v1/);assert.match(seed,/operational_rule_item_v1/);assert.match(seed,/operational_rule_check_v1/);
 assert.match(seed,/set constraints all immediate/);assert.doesNotMatch(seed,/set_config\('.*(?:now|clock)|pg_sleep/);
});
test('201 RPC exact positional allowlist rejects extra system actor, wrong site and unknown writer',()=>{
 assert.equal(rpc('faolla_attendance_reminders_run_v1',{p_query:q,p_allow_run:true}),`public.faolla_attendance_reminders_run_v1('${JSON.stringify(q)}'::jsonb,true)`);
 assert.throws(()=>rpc('faolla_attendance_reminders_run_v1',{p_query:q,p_allow_run:true,p_actor:uid(10)}));
 assert.throws(()=>rpc('faolla_attendance_reminders_run_v1',{p_query:{...q,siteId:'99990202'},p_allow_run:true}));
 assert.throws(()=>rpc('faolla_attendance_unknown_v1',{p_query:q}));assert.throws(()=>rpc('faolla_attendance_reminders_run_v1',{p_query:q,p_allow_run:'true'}));
 const app={p_query:{siteId:site},p_auth_user_id:uid(1),p_command:null,p_allow_write:true,p_capture_notifications:false};
 assert.match(rpc('faolla_attendance_application_delegations_v1',app),/,true,false\)$/);
});
test('201 outside facts preserve all old rows including unscoped location results and registry',()=>{
 const sql=reminderNativeFactsSql(['merchants','faolla_schema_migrations','merchant_attendance_location_results','merchant_attendance_events'],true);
 assert.match(sql,/x\.id<>'99990201'/);assert.match(sql,/e\.merchant_id<>'99990201'/);assert.match(sql,/faolla_schema_migrations.*?where true/);
 assert.throws(()=>reminderNativeFactsSql(['injected;drop table merchants']));
 const old=reminderNativeOldCatalogSql(1);assert.match(old,/t\.tgname='reminder_capture' and c\.relname in/);assert.match(old,/merchant_attendance_cycle_operations/);
 assert.doesNotMatch(old,/and t\.tgname<>'reminder_capture'/);assert.throws(()=>reminderNativeOldCatalogSql('1;drop'));
});
test('200201 catalog diagnostics retain strict bytes and every old metadata field, without another SQL dispatch',()=>{
 const row=[42,'merchant_attendance_cycle_operations',10,null,true,['CHECK (revision > 0)'],['CREATE TRIGGER old_guard BEFORE INSERT ON old_table EXECUTE FUNCTION old_guard()']];
 const expected=JSON.stringify([row]);assertAttendanceNativeCatalogEqual(expected,expected,'same_catalog');
 for(let field=0;field<row.length;field++){
  const changed=structuredClone(row);changed[field]=field===0?43:field===1?'different_table':field===2?11:field===3?['service_role=r/postgres']:field===4?false:field===5?['CHECK (revision >= 0)']:['CREATE TRIGGER replacement'];
  assert.throws(()=>assertAttendanceNativeCatalogEqual(JSON.stringify([changed]),expected,'strict_metadata'),error=>{
   assert.equal(error.code,'ERR_ASSERTION');assert.match(error.message,/attendance_native_catalog_mismatch:/);assert.match(error.message,/"path":\[0,/);
   assert(error.message.length<1900);assert.equal(error.actual,undefined);assert.equal(error.expected,undefined);return true;
  });
 }
 assert.throws(()=>assertAttendanceNativeCatalogEqual(JSON.stringify([row],null,2),expected,'format_not_normalized'),/serialization_mismatch/);
 assert.throws(()=>assertAttendanceNativeCatalogEqual(JSON.stringify([]),expected,'missing_old_table'),/"kind":"length"/);
 assert.throws(()=>assertAttendanceNativeCatalogEqual('not JSON',expected,'invalid_catalog'),/unparseable_catalog/);
});
test('201 old catalog excludes only the two exact deferred capture companions, never other old constraints',()=>{
 const sql=reminderNativeOldCatalogSql(123);
 const constraints=sql.slice(sql.indexOf('(select jsonb_agg(pg_get_constraintdef'),sql.indexOf('(select jsonb_agg(pg_get_triggerdef'));
 for(const clause of ['where k.conrelid=c.oid','and not exists(select 1 from pg_trigger capture where capture.tgconstraint=k.oid and capture.tgrelid=c.oid',
  "k.contype='t' and c.relnamespace=123",
  "(c.relname='merchant_attendance_cycle_operations' and capture.tgtype=5)",
  "(c.relname='merchant_attendance_review_responsibility_heads' and capture.tgtype=21)",
  "capture.tgname='reminder_capture' and capture.tgfoid=to_regprocedure(format('%I.faolla_attendance_reminder_capture_v1()'",
  '(select nspname from pg_namespace where oid=123)',
  "not capture.tgisinternal and capture.tgenabled='O' and capture.tgnargs=0 and capture.tgqual is null",
  'capture.tgdeferrable and capture.tginitdeferred and capture.tgparentid=0'])assert(constraints.includes(clause));
 //A CHECK/FK/PK/UQ, another table, unrelated trigger constraint, function or
 //parent relation cannot match all correlated terms. No generic contype/name
 //mask, substring suppression or post-capture catalog normalization is used.
 assert.doesNotMatch(constraints,/k\.contype\s*(?:<>|!=|not in)|k\.conname\s*(?:<>|!=|not in)|k\.conname\s*=|relname in/);
 assert.equal(constraints.split('not exists(').length-1,1);
 assert.match(constraints,/jsonb_agg\(pg_get_constraintdef\(k\.oid\) order by k\.conname\)/);
 assert.match(adapter,/const installed=audit\.fingerprint\(names\),definitions=audit\.definitions\(\),catalog=audit\.catalog\(\)/);
 assert.match(adapter,/assertAttendanceNativeCatalogEqual\(audit\.catalog\(\),catalog,'reminder201_reentry_catalog'\)/);
 assert.match(adapter,/assertAttendanceNativeCatalogEqual\(audit\.catalog\(\),catalog,'reminder201_final_catalog'\)/);
});
test('200201 catalog first-leaf excerpt is bounded and all six equality callsites keep their original captures',()=>{
 const text='CHECK ('+'z'.repeat(5000)+')',expected=JSON.stringify([[42,'old_table',10,null,true,[text],[]]]),actual=JSON.stringify([[42,'old_table',10,null,true,[text.slice(0,3000)+'changed'+text.slice(3000)],[]]]);
 assert.throws(()=>assertAttendanceNativeCatalogEqual(actual,expected,'bounded_constraint'),error=>{
  assert(error.message.length<1900);assert.match(error.message,/"field":"constraints"/);assert.match(error.message,/changed/);assert(!error.message.includes(text));return true;
 });
 const cycle=readFileSync(path.join(root,'scripts/merchant-attendance-cycle-native.mjs'),'utf8');
 for(const label of ['cycle200_reentry_catalog','cycle200_final_catalog'])assert(cycle.includes(`assertAttendanceNativeCatalogEqual(audit.catalog(),catalog,'${label}')`));
 for(const label of ['reminder201_reentry_catalog','reminder201_final_catalog'])assert(adapter.includes(`assertAttendanceNativeCatalogEqual(audit.catalog(),catalog,'${label}')`));
 assert.match(adapter,/assertAttendanceNativeCatalogEqual\(audit\.run\('reminder_old_catalog_after',reminderNativeOldCatalogSql\(d\.owned\.oid\)\),oldCatalog,'reminder201_after_install_old_catalog'\)/);
 assert.match(adapter,/assertAttendanceNativeCatalogEqual\(audit\.run\('reminder_final_old_catalog',reminderNativeOldCatalogSql\(d\.owned\.oid\)\),oldCatalog,'reminder201_final_old_catalog'\)/);
 assert.doesNotMatch(cycle.slice(cycle.indexOf('export function assertAttendanceNativeCatalogEqual'),cycle.indexOf('//One bounded manifest diagnostic')),/native\.query|audit\.run|pg_get_|replaceAll|\.filter\(/);
});
test('201 registration and late receipt faults force full transaction proof without changing real timestamps',()=>{
 assert.match(source,/synthetic201_registration_fault.*?errcode='23514'/s);assert.match(source,/assert\.equal\(last\.sqlstate,'23514'\)/);
 assert.match(source,/synthetic201_late_fault check\(operation_id<>/);assert.match(source,/reminder201_read_reject_replay_changed_facts/);
 assert.doesNotMatch(source,/update public\.merchant_attendance_(?:events|reminder_heads).*?(?:occurred_at|next_due_at)\s*=/);
 assert.match(source,/waitMs<=60000/);assert.match(source,/setTimeout\(resolve,waitMs\)/);assert.equal(source.split('setTimeout(resolve,waitMs)').length-1,1);
});

test('201 one real due wait precedes activation due-only scan and leaves the unchanged 25plus1 delivery assertions',()=>{
 const initial=source.indexOf("step('initial_sources_savepoint'"),wait=source.indexOf('await new Promise(resolve=>setTimeout(resolve,waitMs))');
 const probe=source.indexOf("const probe=await save('reminder201_activation')"),restore=source.indexOf("await restore('reminder201_activation',probe)");
 const delivery=source.indexOf('const b=await executeReminderRunner(');
 assert(initial>=0&&wait>initial&&probe>wait&&restore>probe&&delivery>restore);
 assert.equal(source.split('real_due_wait_duration').length-1,1);assert.equal(source.split('setTimeout(resolve,waitMs)').length-1,1);
 assert.match(source,/select max\(next_due_at\) from public\.merchant_attendance_reminder_heads/);
 assert.match(source,/quote\(sourceState\.maxDueAt\)\}::timestamptz-clock_timestamp\(\)/);
 assert.match(source,/assert\.equal\(pr\.receipt\.result\.stoppedCount,25\)/);
 for(const field of ['checkedCount,25','deliveredCount,25','deferredCount,0','stoppedCount,0'])assert(source.includes('assert.equal(br.'+field+')'));
 assert.match(source,/assert\(br\.nextCursor\)/);assert.equal(forecast.actualWaits,1);assert.equal(caps.sql,180);assert.equal(caps.rpc,120);assert.equal(caps.milliseconds,120000);
});
test('201 real Node source/finish/mark/runner paths retained; owner cannot read employee open summary',()=>{
 for(const text of ['executeOperationalPunch(','executeLeave(','executeCycleIntent(','executeCycleSend(','executePeriodClosuresV2(','runner.run(','authService.execute('])assert(source.includes(text));
 assert.match(source,/periodId:null/);assert.match(source,/itemCount===23/);assert.match(source,/\?2:3/);
 assert.match(source,/e=>e\.code==='attendance_access_denied'/);assert.match(source,/assert\.equal\(carry\.count,1\)/);
 assert.match(source,/repeat60MinuteExpiryActuallyWaited:false/);
});
test('201 replaces exactly one existing B system run with strict explicit entry, retaining id cursor environment and budgets',()=>{
 assert.match(source,/await import\('\.\.\/run-merchant-attendance-reminders\.ts'\)/);
 assert.equal(source.split('await executeReminderRunner(').length-1,1);
 assert.equal(source.split('parseReminderRunnerArgs([').length-1,1);
 const group=source.slice(source.indexOf('//B one explicit CLI-parse/Node entry'),source.indexOf("const continuationBefore=await save('reminder201_continuation')"));
 assert.match(group,/const bq=runQ\(\),entry=parseReminderRunnerArgs\(\['--once','--site',bq\.siteId,'--operation',bq\.operationId,'--cursor',JSON\.stringify\(bq\.cursor\)\]\)/);
 assert.match(group,/assert\.deepEqual\(entry\.originalRun,bq\)/);
 assert.match(group,/await executeReminderRunner\(entry,\{service,environment\}\)/);
 assert.doesNotMatch(group,/runner\.run\(|count\(|await step\(|randomUUID|new AbortController/);
 for(const assertion of ['assert.equal(br.checkedCount,25)','assert.equal(br.deliveredCount,25)','assert.equal(br.deferredCount,0)','assert.equal(br.stoppedCount,0)','assert.equal(br.batchIds.length,3)','assert(br.nextCursor)'])assert(group.includes(assertion));
 assert.equal(forecast.rpcByGroup.B,2);assert.equal(forecast.rpcCalls,78);assert.equal(forecast.sqlSteps,176);
});
test('201 two PID races only; second proves same original mark despite allowfalse, no extra distinct race claim',()=>{
 assert.equal(source.split('await reminderNativePidRace(raceEnv').length-1,2);
 assert.match(source,/markArgs\(true\)/);assert.match(source,/markArgs\(false\)/);assert.match(source,/same_mark_after_settings_wait_allow_false/);
 assert.match(source,/assert\.deepEqual\(markedLeft\.receipt,markedRight\.receipt\)/);
 assert.match(source,/group by recipient_key,category,window_start having count\(\*\)>1/);assert.match(source,/group by budget_key,ordinal having count\(\*\)>1/);
});
test('201 microcommit occurs only after exact rollback of every case to original new source proof',()=>{
 assert.match(source,/rollback to savepoint reminder201_sources;release savepoint reminder201_sources;set constraints all immediate/);
 assert.match(source,/assert\.equal\(committedFacts,sourceState\.facts/);assert.match(source,/cleanupConfirmed:false/);
 for(const text of ['audit.archiveBytes(\'155\')','audit.archiveBytes(\'207\')','audit.functions(oids,replaced)','audit.metadata(replaced)','audit.catalog()'])assert(adapter.includes(text));
 assert.match(adapter,/clusterStopConfirmedByParent:false/);assert.match(source,/outsideCheck\('finally'\)/);
});
test('201 failure metadata is bounded and retains SQLSTATE/context rather than transport-only success',()=>{
 const f=reminderNativeFailure('x',1,{error:'e'.repeat(900),sqlstate:'23514',context:'c'.repeat(5000)});
 assert.equal(f.error.length,500);assert.equal(f.context.length,4000);assert.equal(f.sqlstate,'23514');assert.match(source,/get stacked diagnostics/);
});
test('201 PID transport-double witnesses specific blocker and always closes both owned connections',async()=>{
 const labels=[],closed=[];let n=0;
 const env={connect:()=>{const i=++n;return{name:schema,step:async text=>text.includes('pg_backend_pid')?'42':i===1?'left':'right',close:async()=>closed.push(i)};},
  observe:text=>{assert.match(text,/42=any\(pg_blocking_pids\(pid\)\)/);return '1';},sql:s=>s,charge:s=>labels.push(s)};
 const result=await reminderNativePidRace(env,'select 1;','select 1;');assert.equal(result.witnessed,true);assert.equal(result.polls,1);assert.equal(result.left,'left');assert.equal(result.right,'right');
 assert.deepEqual(closed.sort(),[1,2]);assert.equal(labels.length,5);
});
test('201 missing real blocker never treated as success; transport-double observer failure still cleans both',async()=>{
 const closed=[];let n=0;const env={connect:()=>{const i=++n;return{name:schema,step:async s=>s.includes('pg_backend_pid')?'42':'value',close:async()=>closed.push(i)};},
  observe:()=>{throw new Error('observer_unavailable');},sql:s=>s,charge:()=>{}};
 await assert.rejects(()=>reminderNativePidRace(env,'select 1;','select 1;'),/observer_unavailable/);assert.deepEqual(closed.sort(),[1,2]);
});
