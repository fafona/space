//Finite SOURCE and orchestration unit checks. No PostgreSQL/Auth/browser/KDF.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {operationalCycleNativeMigration,operationalCycleNativeSha,operationalCycleNativeBudget,
 operationalCycleNativePrerequisites,operationalCycleNativeDependencyDiagnosticSql,operationalCycleNativeOptions,installAndVerifyOperationalCycleNative} from '../merchant-attendance-cycle-native.mjs';
import {cycleInstallationManifest} from '../merchant-attendance-cycle-installation.mjs';
import {cycleNativeGroups,cycleNativeDispatchForecast,cycleNativeFactsSql,cycleNativeRpcExpression,cycleNativeFailure,
 cycleNativePidRace,cycleNativeRaceExpectedFacts,verifyOperationalCycleNative} from './attendance-cycle-native.mjs';
import {cycleNativeSite,cycleNativeId,cycleNativePeople,cycleNativeFixedUuids,
 cycleNativeIdentitySeed,cycleNativeHistoricalRuleSeed,cycleNativeRules} from './attendance-cycle-native-seed.mjs';
import {attendanceNativeConnectionLifetime} from '../merchant-attendance-native-connections.mjs';
const schema='attendance_race_'+'a'.repeat(32),root=fileURLToPath(new URL('../../',import.meta.url));
const source=readFileSync(new URL('./attendance-cycle-native.mjs',import.meta.url),'utf8');
const runner=readFileSync(new URL('../merchant-attendance-cycle-native.mjs',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase-migrations/'+operationalCycleNativeMigration,import.meta.url));
const manifest=cycleInstallationManifest(root,migration.toString('utf8').replaceAll('\r\n','\n'));

test('200 imports are inert and refuse unowned context before touching transport',async()=>{
 let calls=0;const bad={d:{syntheticOnly:false},h:{syntheticOnly:true},native:{query(){calls++;}}};
 await assert.rejects(()=>installAndVerifyOperationalCycleNative(),/cycle_owned_context_required/);
 await assert.rejects(()=>installAndVerifyOperationalCycleNative(bad),/cycle_owned_context_required/);
 await assert.rejects(()=>verifyOperationalCycleNative(bad),/cycle200_owned_parent_required/);assert.equal(calls,0);
 for(const s of [source,runner])assert(!/child_process|spawn\(|execFile|process\.argv|\.listen\(|runAdministrativeClosureNative\(/.test(s));
 assert(!/scrypt\(|deriveIndependentAttendanceIssuePin\(|attendancePinPepper\(/.test(source));
});

test('200 explicit reuse skips only already-passed business cases, never installation or protection and never claims a new pass',()=>{
 assert.deepEqual(operationalCycleNativeOptions(),{businessCases:'run'});assert.deepEqual(operationalCycleNativeOptions({businessCases:'skip'}),{businessCases:'skip'});
 for(const v of [null,[],false,{businessCases:'all'},{businessCases:'skip',unsafe:true}])assert.throws(()=>operationalCycleNativeOptions(v));
 assert(runner.includes("if(businessCases==='run')acceptance=await"));assert(runner.includes("businessCasesExecuted:businessCases==='run'"));
 assert(runner.includes('cycle_skip_installed_facts_changed'));assert(runner.includes('cycle200_final_catalog'));assert(runner.includes("audit.archiveBytes('155'),archive155"));
});
test('200 owned chain requires exact195197198 and never replays old migrations or recipes',()=>{
 assert.deepEqual(operationalCycleNativePrerequisites.map(p=>p.version),[202610080195,202610080197,202610080198]);
 assert.equal(createHash('sha256').update(migration).digest('hex').toUpperCase(),operationalCycleNativeSha);
 assert.equal(operationalCycleNativeSha,'203104A41C59D526BDD9740268D6FA3D835E21AE02C7386872737169F18A110E');
 assert.equal(manifest.tables.length,4);assert.equal(manifest.functions.length,20);assert.equal(manifest.forward.length,5);
 assert(!/boundClockMigrationBody|installReviewRouting|cycleForwardSql\(|installVerifyRetention/.test(runner));
 for(const t of ['cycle_exact_dependency_mismatch','approved_function_oids','assert.equal(JSON.parse(metadata).length,5)','audit.install(body)','oldArchivesUnchanged:true'])assert(runner.includes(t));
});
test('200 business SQL and real RPC are separately bounded; observer polls are actual dispatches',()=>{
 assert.equal(operationalCycleNativeBudget.groups,8);assert.equal(operationalCycleNativeBudget.steps,180);assert.equal(operationalCycleNativeBudget.milliseconds,120000);
 assert.equal(operationalCycleNativeBudget.maxConnections,3);assert.equal(operationalCycleNativeBudget.protectionQueries,64);
 assert.equal(cycleNativeGroups.length,8);assert.equal(new Set(cycleNativeGroups).size,8);
 assert.equal(cycleNativeDispatchForecast.estimatedSqlStepsWithMaxPolls,177);assert.equal(cycleNativeDispatchForecast.estimatedRpcCalls,101);
 assert(cycleNativeDispatchForecast.estimatedSqlStepsWithMaxPolls<=180);assert.equal(cycleNativeDispatchForecast.maximumPidObserverQueries,68);
 for(const t of ['cycle200_max180_actual_SQL_dispatches','cycle200_max120_RPC','race_PID_observer','race_holder_PID','race_holder_commit','rpcByName','dispatches','statistics','cycle200_120s_business_deadline'])assert(source.includes(t));
 for(const value of [...source.matchAll(/native\.connect\(\{lifetimeMs:(\d+)\}\)/g)].map(m=>Number(m[1])))assert.equal(attendanceNativeConnectionLifetime({lifetimeMs:value}),value);
 assert(!source.includes('lifetimeMs:120000'));assert(!source.includes('lifetimeMs:30000'));
});
test('200 manifest diagnostic compares exact complete metadata/source/ACL without writing',()=>{
 const s=operationalCycleNativeDependencyDiagnosticSql(manifest,schema);
 for(const t of ['failedFields','source_hash','function_shape','argnames','defaults','owner','definer','language','acl','a.grantor<>o.relowner','a.is_grantable','proparallel','proargmodes','pronargdefaults'])assert(s.includes(t));
 assert(!/\b(?:insert|update|delete|alter|create|grant|revoke)\b/i.test(s));assert.throws(()=>operationalCycleNativeDependencyDiagnosticSql(manifest,'public'));
});

test('200 SOURCE diagnostic normalizes only unnamed zero-argument catalog NULL like the product guard',()=>{
 const s=operationalCycleNativeDependencyDiagnosticSql(manifest,schema);
 const capture=manifest.dependencies.find(f=>f.name==='faolla_attendance_disposal_artifact_capture_v1');
 assert(capture);assert.equal(capture.types,'');assert.deepEqual(capture.argumentNames,[]);
 assert(s.includes("coalesce(p.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(s.v->'argumentNames'))"));
 assert(!s.includes("case when p.proargnames is distinct from"));
 // Parameterized dependencies retain their exact nonempty name arrays. NULL,
 // missing names, or a different name still cannot match those arrays; arity,
 // modes, complete types, source, owner and ACL checks are not normalized away.
 const refs=manifest.dependencies.find(f=>f.name==='faolla_attendance_disposal_artifact_refs_v1');
 assert.deepEqual(refs.argumentNames,['p']);
 assert(s.includes("p.pronargs is distinct from jsonb_array_length(s.v->'argumentNames')"));
 assert(s.includes('p.proargmodes is not null or p.proallargtypes is not null'));
 assert(migration.toString('utf8').includes("coalesce(f.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'argumentNames'))"));
});
test('200 exact public RPC surface rejects extra arguments/scalars/private helpers',()=>{
 const q={siteId:cycleNativeSite,access:'owner',workerId:cycleNativePeople.main.worker,grantId:null,mode:'detail',intentId:cycleNativeId(2000)};
 const args={p_query:q,p_auth_user_id:cycleNativePeople.main.auth,p_command:null,p_allow_accept:false};
 assert.match(cycleNativeRpcExpression('faolla_attendance_operational_cycle_v1',args),/,null,false\)$/);
 for(const a of [{...args,pin:'12345678'},{...args,p_allow_accept:'false'},{...args,p_query:{...q,siteId:'99990197'}}])assert.throws(()=>cycleNativeRpcExpression('faolla_attendance_operational_cycle_v1',a));
 assert.throws(()=>cycleNativeRpcExpression('faolla_attendance_cycle_core_owner_v2',args));
 const r={p_query:{...q,mode:'recover'},p_auth_user_id:args.p_auth_user_id,p_intent:{intentId:q.intentId,expectedIntentFingerprint:'a'.repeat(64)},p_expected_fingerprint:'b'.repeat(64)};
 assert.match(cycleNativeRpcExpression('faolla_attendance_operational_cycle_send_recover_v1',r),/send_recover_v1/);
 assert.throws(()=>cycleNativeRpcExpression('faolla_attendance_operational_cycle_send_recover_v1',{...r,p_command:null}));
});
test('200 new identities and all fixed UUIDs are unused before either approved seed',()=>{
 assert.equal(cycleNativeSite,'99990200');assert(!['99990196','99990197','99990198'].includes(cycleNativeSite));
 assert.equal(cycleNativeFixedUuids.length,26);assert.equal(new Set(cycleNativeFixedUuids).size,26);assert.equal(Object.keys(cycleNativePeople).length,6);
 const s=cycleNativeIdentitySeed(cycleNativeId(999),['merchants','faolla_schema_migrations','merchant_attendance_workers'],schema);
 for(const t of ['cycle200_unused_site_required','cycle200_all_fixed_UUIDs_unused','Synthetic200 explicit self','attendance.self.request','Synthetic200 explicit supervisor','attendance.period.send'])assert(s.includes(t));
 assert.throws(()=>cycleNativeIdentitySeed(cycleNativeId(999),['x;drop table'],schema));
});
test('200 one historical SOURCE template uses actual191 private tuple/item/relation checks, not past RPC or fake clock',()=>{
 const seed=cycleNativeHistoricalRuleSeed(cycleNativeId(999));
 for(const t of ['not a past publish RPC','faolla_attendance_operational_rule_values_v1','faolla_attendance_operational_rule_command_v1','faolla_attendance_operational_rule_item_v1(op)',
  'faolla_attendance_operational_rule_check_v1','faolla_attendance_operational_rule_references_tuple_v1','faolla_attendance_operational_rule_context_tuple_v1','set constraints all immediate'])assert(seed.includes(t));
 assert.equal((seed.match(/perform public\.faolla_attendance_operational_rule_check_v1/g)??[]).length,2);
 assert(!/disable trigger|session_replication_role|clock_timestamp\s*:=|faolla_attendance_operational_rules_v1\(/.test(seed));
 assert.equal(cycleNativeRules().timesheetCycle.value.kind,'weekly');assert.equal(cycleNativeRules('monthly').timesheetCycle.value.kind,'monthly');assert.throws(()=>cycleNativeRules('manual'));
 assert.equal(cycleNativeDispatchForecast.actualHistoricalPublishCalls,0);assert.equal(cycleNativeDispatchForecast.disclosedHistoricalTemplates,1);
});
test('200 protects preexisting facts/archives and bounds committed footprint without claiming parent cleanup done',()=>{
 const names=['merchants','faolla_schema_migrations','merchant_attendance_location_results','merchant_attendance_workers'];
 const s=cycleNativeFactsSql(names,true);assert(s.includes("x.id<>'99990200'"));assert(s.includes('e.id=x.event_id'));assert(s.includes("e.merchant_id<>'99990200'"));
 assert(s.includes('from public.faolla_schema_migrations x where true'));assert.throws(()=>cycleNativeFactsSql(['unsafe-table']));
 for(const t of ['main_rollback_all_facts_exact','preexisting_facts_changed','microcommit_footprint','fixedUuids:cycleNativeFixedUuids','cleanupOwnedByParent:true','cleanupConfirmed:false'])assert(source.includes(t));
 for(const t of ["audit.archiveBytes('155')","audit.archiveBytes('207')",'audit.functions(oldOids,replaced)','audit.metadata(replaced)'])assert(runner.includes(t));
});
test('200 eight groups use actualNode source/lifecycle and explicit GET-only saved recovery',()=>{
 for(const t of ['executeCycleIntent','executeCycleSend','executePeriodClosuresV2','executePeriodDelegatedClosures','executePeriodDelegation','executeOperationalRuleLedger','parseCycleSendResult','cycleSendCommandFingerprint',
  "state,'consumer_disabled'",'attendance_operational_cycle_protocol_required','attendance_operation_conflict',"expectedFrameRevision,2","last.sqlstate,'23514'",'actualPastPublishRpc:false'])assert(source.includes(t),t);
 for(const t of ['owner','delegate'])assert(source.includes("'"+t+"'"));
 assert(source.includes('recoverSend(frame,c)'));assert(source.includes('recoverSend(ef,ec,ids.delegateAuth)'));assert(!source.includes('p_verified'));
 const preview=source.slice(source.indexOf('const preview=(f,'),source.indexOf('const firstCommand='));
 assert(preview.includes("executePeriodClosuresV2({query:{...oldQ(f,'preview'),periodId:null}"));
 assert(preview.includes("executePeriodDelegatedClosures({query:{...oldQ(f,'preview'),periodId:null}"));
 const primary=source.slice(source.indexOf('//B actual new Node coordinator:'),source.indexOf('//C cancellation'));
 assert(primary.includes('linked=await executeCycleSend({body:{frame,command:c},authUserId:d.owner,allowWrite:true},service)'));
 assert(!primary.includes('linked=await send('));assert(source.includes('actualNodeFirstSendCoordinator:true'));
});
test('200 race orchestrator requires an actual witnessed blocking PID and closes exactly both participants (mock only)',async()=>{
 const charges=[],closed=[],seen=[];let n=0;
 const env={connect:()=>{const index=++n;return{name:'attendance_race_'+String(index).repeat(32),step:async s=>{seen.push(s);return s==='select pg_backend_pid();'?'123':index===1?'left':'right';},close:async()=>closed.push(index)};},
  observe:s=>{seen.push(s);return'1';},sql:s=>s,charge:s=>charges.push(s)};
 const r=await cycleNativePidRace(env,'holder-real-write;','waiter-real-write;');
 assert.equal(r.witnessed,true);assert.equal(r.polls,1);assert.deepEqual(closed.sort(),[1,2]);assert.equal(n,2);
 assert(seen.some(s=>s.includes('pg_blocking_pids(pid)')));assert.deepEqual(charges,['race_holder_PID','race_holder_actual_RPC','race_waiter_actual_RPC','race_PID_observer','race_holder_commit']);
});
test('200 failed observer never invents success and still closes both mocked connections',async()=>{
 const closed=[];let n=0;
 await assert.rejects(()=>cycleNativePidRace({connect:()=>{const index=++n;return{name:'attendance_race_'+String(index).repeat(32),step:async s=>s==='select pg_backend_pid();'?'123':'ok',close:async()=>closed.push(index)};},
  observe(){throw Error('observer failure');},sql:s=>s,charge(){}},'actual-holder;','actual-waiter;'),/observer failure/);
 assert.deepEqual(closed.sort(),[1,2]);assert.equal(n,2);
});

test('200 race private postimage requires successful holder and exact complete-hash shape',()=>{
 const valid={value:{receipt:{operationId:cycleNativeId(2000)}},error:null,sqlstate:null,context:null,expectedFactsHash:'a'.repeat(32)};
 assert.equal(cycleNativeRaceExpectedFacts(JSON.stringify(valid)),'a'.repeat(32));
 for(const bad of [{...valid,expectedFactsHash:'a'.repeat(31)},{...valid,expectedFactsHash:'A'.repeat(32)},{...valid,expectedFactsHash:"'; select 1;"},
  {...valid,expectedFactsHash:null},{...valid,error:'actual RPC failed'},{...valid,sqlstate:'23514'},{...valid,context:'unexpected'},
  {...valid,value:null},{...valid,extra:true},[]])assert.throws(()=>cycleNativeRaceExpectedFacts(JSON.stringify(bad)));
 assert.throws(()=>cycleNativeRaceExpectedFacts('{'));
});

test('200 race waiter is built only from holder actual postimage before commit, with unchanged full facts and calls',async()=>{
 const hash='b'.repeat(32),left=JSON.stringify({value:{kind:'receipt'},error:null,sqlstate:null,context:null,expectedFactsHash:hash}),events=[],closed=[];let n=0;
 const env={connect:()=>{const index=++n;events.push('connect'+index);return{name:'attendance_race_'+String(index).repeat(32),step:async s=>{events.push(s);return s==='select pg_backend_pid();'?'123':index===1?left:'waiter-rejected-with-zero-delta';},close:async()=>closed.push(index)};},observe(){events.push('witness');return'1';},sql:s=>s,charge(){}};
 const r=await cycleNativePidRace(env,'actual-holder;',output=>{events.push('factory');return 'actual-waiter-expected-'+cycleNativeRaceExpectedFacts(output)+';';});
 assert.equal(r.witnessed,true);assert.equal(r.left,left);assert.equal(r.right,'waiter-rejected-with-zero-delta');
 assert(events.indexOf('begin;actual-holder;')<events.indexOf('factory'));assert(events.indexOf('factory')<events.indexOf('connect2'));
 assert(events.indexOf('begin;actual-waiter-expected-'+hash+';commit;')<events.indexOf('commit;'));
 assert.deepEqual(closed.sort(),[1,2]);assert.equal(n,2);
 assert.equal((source.match(/captureRaceFacts:true/g)??[]).length,2);assert.equal((source.match(/expectedFactsHash:cycleNativeRaceExpectedFacts\(left\)/g)??[]).length,2);
 assert(source.includes("before_hash:=${expectedFactsHash===null?small:quote(expectedFactsHash)}"));
 assert(source.includes("!write||replay||expectedFactsHash!==null"));assert(source.includes("assert ${small}=before_hash,'cycle200_read_reject_replay_changed_facts'"));
 assert(!/small\s*=\s*cycleNativeFactsSql\([^)]*,\s*true\)/.test(source));
});

test('200 factory failure makes no waiter connection or RPC and closes the actual holder',async()=>{
 let connections=0,observations=0;const calls=[],closed=[];
 const env={connect:()=>{const index=++connections;return{name:'attendance_race_'+String(index).repeat(32),step:async s=>{calls.push(s);return s==='select pg_backend_pid();'?'123':'holder-output';},close:async()=>closed.push(index)};},observe(){observations++;return'1';},sql:s=>s,charge(){}};
 await assert.rejects(()=>cycleNativePidRace(env,'actual-holder;',()=>{throw Error('invalid holder proof');}),/invalid holder proof/);
 assert.deepEqual(calls,['select pg_backend_pid();','begin;actual-holder;']);assert.equal(connections,1);assert.equal(observations,0);assert.deepEqual(closed,[1]);
});
test('200 bounded failure output preserves SQLstate/context before any giant artifact',()=>{
 const r=cycleNativeFailure('stage',4,{error:'x'.repeat(1000),sqlstate:'23514',context:'y'.repeat(8000),value:{artifactText:'z'.repeat(99999)}});
 assert.equal(r.error.length,500);assert.equal(r.context.length,4000);assert.equal(r.sqlstate,'23514');assert(!JSON.stringify(r).includes('artifactText'));
});
