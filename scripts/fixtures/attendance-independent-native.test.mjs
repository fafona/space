//196 SOURCE/unit only. No PostgreSQL/native process, Auth, browser or KDF.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {independentNativeBudget,independentNativeMigration,independentNativeSha,independentNativeManifest,independentNativeDependencyDiagnostics,installAndVerifyIndependentWorkersNative} from '../merchant-attendance-independent-native.mjs';
import {independentNativeSite,independentNativeIds,independentNativeGroups,independentNativeAcceptanceCaps,independentNativeRpcPlan,independentNativeRpcExpression,
 independentNativeOutsideSql,independentNativePidRace,independentNativeSyntheticVerifier,verifyIndependentWorkersNative} from './attendance-independent-native.mjs';
import {createIndependentNativeProtection} from './attendance-independent-native-protection.mjs';
import {administrativeClosureRiskSite} from './attendance-administrative-closure-risk-native.mjs';
import {lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
import {attendanceNativeConnectionLifetime} from '../merchant-attendance-native-connections.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),schema='attendance_race_'+'a'.repeat(32);
const migration=readFileSync(new URL('../supabase-migrations/'+independentNativeMigration,import.meta.url));
const runner=readFileSync(new URL('../merchant-attendance-independent-native.mjs',import.meta.url),'utf8');
const fixture=readFileSync(new URL('./attendance-independent-native.mjs',import.meta.url),'utf8');
const protections=readFileSync(new URL('./attendance-independent-native-protection.mjs',import.meta.url),'utf8');
const manifest=independentNativeManifest(root,migration.toString('utf8'));

test('196 synthetic verifier binds field values, not owner/terminal DTO property order (no KDF)',()=>{
 const sha=value=>createHash('sha256').update(value).digest('hex');
 const owner={siteId:independentNativeSite,subjectId:id(2),workerId:id(3),generation:0,credentialRevision:1};
 const terminal={siteId:owner.siteId,workerId:owner.workerId,subjectId:owner.subjectId,generation:0,credentialRevision:1};
 assert.notEqual(sha(JSON.stringify(['synthetic196-not-KDF','19619619','a'.repeat(32),owner])),sha(JSON.stringify(['synthetic196-not-KDF','19619619','a'.repeat(32),terminal])));
 const result=independentNativeSyntheticVerifier('19619619','a'.repeat(32),owner);
 assert.equal(independentNativeSyntheticVerifier('19619619','a'.repeat(32),terminal),result);
 for(const changed of [{...terminal,generation:1},{...terminal,credentialRevision:2},{...terminal,workerId:id(4)},{...terminal,subjectId:id(4)},{...terminal,siteId:'99990001'}])
  assert.notEqual(independentNativeSyntheticVerifier('19619619','a'.repeat(32),changed),result);
 assert.notEqual(independentNativeSyntheticVerifier('00000000','a'.repeat(32),terminal),result);
 assert.notEqual(independentNativeSyntheticVerifier('19619619','b'.repeat(32),terminal),result);
});

test('196 all own connection options use the existing transport allowlist while keeping the 120s hard fixture deadline',()=>{
 const durations=[...fixture.matchAll(/native\.connect\(\{lifetimeMs:(\d+)\}\)/g)].map(match=>Number(match[1]));
 assert.deepEqual(durations,[180000,90000,25000,90000]);
 for(const lifetimeMs of durations)assert.equal(attendanceNativeConnectionLifetime({lifetimeMs}),lifetimeMs);
 assert(fixture.includes('deadline=Date.now()+independentNativeBudget.milliseconds'));
 assert(fixture.includes("assert(Date.now()<deadline,'independent_120s_deadline')"));
 assert(fixture.includes('phaseDeadline=Math.min(deadline,Date.now()+45000)'));
 assert(fixture.includes('phaseDeadline=Math.min(deadline,Date.now()+30000)'));
 assert(fixture.includes("assert(Date.now()<phaseDeadline,'independent_phase_deadline')"));
 assert.equal(independentNativeBudget.milliseconds,120000);
});

test('196 inert exports refuse nonowned context before touching a transport',async()=>{
 let called=0;const bad={d:{syntheticOnly:false},h:{syntheticOnly:true},native:{query(){called++;}}};
 await assert.rejects(()=>installAndVerifyIndependentWorkersNative(),/independent_synthetic_context_required/);
 await assert.rejects(()=>installAndVerifyIndependentWorkersNative(bad),/independent_synthetic_context_required/);
 await assert.rejects(()=>verifyIndependentWorkersNative(bad),/independent_synthetic_context_required/);assert.equal(called,0);
 for(const source of [runner,fixture,protections])assert(!/child_process|spawn\(|execFile|withAttendanceConcurrencySandbox|runAdministrativeClosureNative\(|process\.argv|\.listen\(/.test(source));
 assert(!/scrypt\(|deriveIndependentAttendanceIssuePin\(|attendancePinPepper\(/.test(fixture));
});

test('196 SOURCE finite budget accounts every real RPC separately from top-level coordination and SQL',()=>{
 assert.deepEqual(independentNativeBudget,{groups:8,logicalSteps:180,milliseconds:120000,maxConnections:3,exactPidRaces:2,newClusters:0,newDatabases:0,browser:0,realAuth:0,kdf:0,production:0});
 assert.deepEqual(independentNativeAcceptanceCaps,{rpcCalls:180,businessSqlSteps:250,pidPollsPerRace:34,pidPollIntervalMs:75,pidPollDeadlineMs:2500});
 assert.equal(independentNativeGroups.length,8);assert.equal(new Set(independentNativeGroups).size,8);
 assert.deepEqual(independentNativeRpcPlan.groups,[23,19,9,5,16,80,16,12]);assert.equal(independentNativeRpcPlan.groups.reduce((a,b)=>a+b),180);
 assert.equal(independentNativeRpcPlan.owner.total+independentNativeRpcPlan.terminal.total+independentNativeRpcPlan.oldAndSetup,180);
 assert.deepEqual(independentNativeRpcPlan.owner,{detail:30,candidates:2,history:2,recover:12,write:34,total:80});assert.deepEqual(independentNativeRpcPlan.terminal,{begin:41,finish:30,total:71});
 assert.equal(independentNativeRpcPlan.businessSqlEstimate,233);
 for(const token of ['independent_max180_actual_RPC','independent_max250_business_SQL','rpcByName','rpcCategories','groupStats','independent_group_RPC_forecast_drift','syntheticVerifierInjection:true'])assert(fixture.includes(token));
});

test('196 setup returns the actual database day in its one existing SQL dispatch without dropping final race facts',async()=>{
 assert(fixture.includes(";select (clock_timestamp() at time zone 'UTC')::date::text;`"));
 assert(fixture.includes("await step('begin',`begin;${prefix}select 1;`);mainToday=await setup();"));
 assert(!/step\('today'/.test(fixture));
 assert(fixture.includes("charge('final_race_facts');assert(++sqlSteps<=250)"));
 assert(fixture.includes('assert.deepEqual(final,{events:1,sources:1});mark(7)'));
 const body=fixture.match(/const setup=async\(\)=>\{([\s\S]*?)\n \};\n const create=/)?.[1];assert(body);
 const run=new Function('step','committed','prefix','seed','admin','countRpc','ok','site','owner','p','terminalHash','pair','secretHash','json','quote',
  `return (async()=>{${body}})();`);
 for(const committed of [false,true]){
  const steps=[],rpcs=[],date='2026-10-08',seed="select (clock_timestamp() at time zone 'UTC')::date::text;";
  const actual=await run(async(label,sql)=>{steps.push({label,sql});return date;},committed,'GUARD;',()=>seed,
   async kind=>{rpcs.push(kind);return {unrelated:'admin result'};},name=>rpcs.push(name),async label=>{rpcs.push(label);return {unrelated:'terminal result'};},
   "'99990198'","'owner'",independentNativeIds,value=>value,'pair','secret',JSON.stringify,value=>`'${value}'`);
  assert.equal(actual,date);assert.deepEqual(steps,[{label:'new_site_setup',sql:committed?`begin;GUARD;${seed}commit;`:seed}]);
  assert.deepEqual(rpcs,['settings','location','faolla_attendance_terminal_admin_v1','terminal_create','faolla_attendance_terminal_device_v1','terminal_pair']);
 }
});

test('196 new-site and fixed identities do not collide with195/197 fixture sites',()=>{
 assert.equal(independentNativeSite,'99990198');assert.notEqual(independentNativeSite,administrativeClosureRiskSite);assert.notEqual(independentNativeSite,'99990197');
 const p=independentNativeIds,identities=[p.main,p.self,p.pin,p.onsite,p.locationWorker,p.raceRevoke,p.raceBind];
 const values=[p.role,p.location,p.terminal,p.otherOwner,...identities.flatMap(v=>[v.subject,v.worker,v.employee,v.auth])];assert.equal(new Set(values).size,32);
 assert(fixture.includes('ind196_all_fixed_UUIDs_must_be_unused'));assert(fixture.includes('independent_unused_site_required'));
 assert(fixture.includes("assert.equal(d.syntheticOnly" )===false); //No weaker truthy-only synthetic admission.
});

test('196 exact reviewed migration and seven forward metadata/source pins are preserved',()=>{
 assert.equal(createHash('sha256').update(migration).digest('hex').toUpperCase(),independentNativeSha);
 assert.equal(manifest.tables.length,6);assert.equal(manifest.functions.length,20);assert.equal(manifest.forward.length,7);
 for(const token of ['independent_install_old_facts','independent_preexisting_facts_changed','beforeFunctions','beforeMetadata','old_oids','forward_oids','audit.run(\'reentry\'','oldArchivesUnchanged:true'])assert(runner.includes(token));
 const sql=independentNativeDependencyDiagnostics(manifest,schema);
 for(const token of ['failedFields','source_hash','language','arguments_defaults','acl','202610080185','202610080190','merchant_attendance_period_delegations','proparallel',
  'permissionHelperAcl','effectiveOwnerExecute','grantor','grantOption'])assert(sql.includes(token));
 assert(!/insert into|update |delete from|create table|alter /i.test(sql));assert.throws(()=>independentNativeDependencyDiagnostics(manifest,'public'));
 assert(!/install.*(?:105|189)|boundClockMigrationBody\([^\n]*202610010105/.test(runner));
});

test('196 service RPC mapping enforces exact argument keys and trusted scalar gates',()=>{
 const admin={p_site:independentNativeSite,p_auth:id(1),p_query:{siteId:independentNativeSite,mode:'detail',subjectId:id(2)},p_command:null,p_material:null,p_allow_new:false};
 assert.match(independentNativeRpcExpression('faolla_attendance_independent_admin_v1',admin),/independent_admin_v1\(.+,null,null,false\)$/);
 const begin={p_site:independentNativeSite,p_terminal:id(3),p_secret_hash:'a'.repeat(64),p_no:'SYNTHETIC196',p_lease:id(4),p_allow_new:true};
 assert.match(independentNativeRpcExpression('faolla_attendance_independent_begin_v1',begin),/independent_begin_v1/);
 assert.match(independentNativeRpcExpression('faolla_attendance_independent_finish_v1',{...begin,p_verified:false,p_request:{kind:'state'}}),/,false,.+,true\)$/);
 for(const value of [{...admin,pin:'12345678'},{...admin,p_allow_new:'true'},{...admin,p_site:'99990001'}])assert.throws(()=>independentNativeRpcExpression('faolla_attendance_independent_admin_v1',value));
 assert.throws(()=>independentNativeRpcExpression('faolla_attendance_independent_head_v1',admin));
});

test('196 preservation excludes only newly committed site rows and explicitly scopes old location results by event',()=>{
 const sql=independentNativeOutsideSql(['merchants','faolla_schema_migrations','merchant_attendance_events','merchant_attendance_location_results']);
 assert(sql.includes("x.id<>'99990198'"));assert(sql.includes("x.merchant_id<>'99990198'"));assert(sql.includes("e.id=x.event_id and e.merchant_id<>'99990198'"));
 assert.throws(()=>independentNativeOutsideSql(['auth.users']));assert.throws(()=>independentNativeOutsideSql(['merchants'],'99990001'));
 for(const token of ['core_rollback','independent_core_not_rolled_back','cleanupOwnedByParent:true','microCommitsForRealRaces:true','exactPidRaces:2','ind196_preexisting_fact_changed'])assert(fixture.includes(token));
});

test('196 finite actual acceptance source retains atomic sidecar, NULL nonadoption, safe end, owner handoff and four distinct old writers',()=>{
 for(const token of ["sqlstate:'23514'",'ind196_owned_exact_source_fault','ind196_atomic','legacy_null','attendance_independent_identity_changed','owner_handoff',
  "if(action==='break_end')flag=false",'attendance_independent_disabled','faolla_attendance_self_v1','faolla_attendance_pin_clock_v1','faolla_attendance_onsite_clock_v1',
  'faolla_attendance_location_clock_v2','parsePinClockResult','executeAttendanceLocationClock','old_actor_tail_exact','private_acl_immutable'])assert(fixture.includes(token),token);
 assert(!/disable trigger|session_replication_role|pg_sleep\(|lock table|pg_advisory_lock/i.test(fixture));
});

test('196 PID helper source requires actual blocker evidence with bounded observer polls (mock unit, not PostgreSQL)',async()=>{
 let participant=0,queries=0,resolveWaiter;const closed=[],steps=[];
 const connect=()=>{const i=participant++;return{name:'attendance_race_'+(i?'c':'b').repeat(32),
  step:async sql=>{steps.push([i,sql]);if(sql==='select pg_backend_pid();')return'1234';if(i===1)return new Promise(resolve=>{resolveWaiter=resolve;});
   if(sql==='commit;'){resolveWaiter('{"ok":true}');return'';}return'{"holder":true}';},close:async()=>{closed.push(i);}};};
 const race=await independentNativePidRace({connect,sql:s=>s,query:sql=>{queries++;assert(sql.includes('pg_blocking_pids(pid)'));assert(sql.includes('1234=any'));assert(sql.includes("wait_event_type='Lock'"));return'1';}},'select actual_owner_rpc();','select actual_finish_rpc();');
 assert.equal(race.polls,1);assert.equal(queries,1);assert(race.witnessed);assert.deepEqual(closed.sort(),[0,1]);assert.equal(steps.length,4);
 assert(fixture.includes('await connection.close();connection=null;charge(\'race_revoke_holder_finish_waiter\')'));
});

test('196 protection group counts each explicit owned query separately and keeps parent archive callbacks opaque',async()=>{
 const calls=[],artifact={x:1},artifactText=JSON.stringify(artifact),saved={artifact,artifactText,artifactBytes:Buffer.byteLength(artifactText),artifactSha256:createHash('sha256').update(artifactText).digest('hex')};
 const ctx={d:{syntheticOnly:true,owned:{schema,oid:42},guard:'do $guard$ begin assert current_user=\'postgres\';end;$guard$;'},h:{syntheticOnly:true},scope:{schema,sql:s=>s},native:{query:s=>{calls.push(s);return'[]';}},archive:async()=>saved,periodArchive:async()=>saved};
 const p=createIndependentNativeProtection(ctx);p.inventory();p.definitions();p.catalog();p.run('write_probe','select 1;',{write:true});await p.archiveBytes('155');await p.archiveBytes('207');
 const s=p.summary();assert.equal(s.protectionDispatches,4);assert.equal(s.archiveCallbacks,2);assert.equal(s.businessRpcCalls,0);assert.equal(s.archiveInternalTransportCount,'opaque_parent_callback_not_claimed');
 assert(calls.slice(0,3).every(q=>q.startsWith('begin read only;')&&q.includes(ctx.d.guard)));assert(calls[3].startsWith('begin;'));
 assert.throws(()=>p.run('bad label','select 1;'));assert.throws(()=>createIndependentNativeProtection({...ctx,scope:{schema:'public',sql:s=>s}}));
});
