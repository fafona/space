//SOURCE-only checks. Never install SQL, create a database, use real Auth or
//start a browser. Actual native evidence is intentionally reported separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {lifecycleId as id} from './merchant-attendance-lifecycle-native-support.mjs';
import {attendanceNativeConnectionLifetime} from './merchant-attendance-native-connections.mjs';
import {delegatedGroupsNativeLimits,delegatedGroupsNativeSources,delegatedGroupsNativeDependencySql,delegatedGroupsNativePermissionsAclSql,assertDelegatedGroupsNativeDependencies,installAndVerifyDelegatedGroupsNative} from './merchant-attendance-delegated-groups-native.mjs';
import {delegatedConfigurationNativeDependencySql,assertDelegatedConfigurationNativeDependencies} from './merchant-attendance-delegated-configuration-native.mjs';
import {delegatedGroupsNativeSite,delegatedGroupsNativeIds,delegatedGroupsNativeGroupBudgets,delegatedGroupsNativeRpcExpression,delegatedGroupsNativeFaultSql} from './fixtures/attendance-delegated-groups-native.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),source=readFileSync(new URL('./fixtures/attendance-delegated-groups-native.mjs',import.meta.url),'utf8'),adapter=readFileSync(new URL('./merchant-attendance-delegated-groups-native.mjs',import.meta.url),'utf8');

test('204 explicit install-only options are validated before reading the owned context',async()=>{
 let reads=0;const ctx={get d(){reads++;throw new Error('synthetic_context_read');}};
 for(const options of [{businessCases:'unknown'},{businessCases:false},{unexpected:true},null,[],false,1,'skip'])
  await assert.rejects(()=>installAndVerifyDelegatedGroupsNative(ctx,options),/delegated_groups_native_(?:options|business_cases)_invalid/);
 assert.equal(reads,0);
 for(const options of [{},{businessCases:'run'},{businessCases:'skip'}])
  await assert.rejects(()=>installAndVerifyDelegatedGroupsNative(ctx,options),/synthetic_context_read/);
 await assert.rejects(()=>installAndVerifyDelegatedGroupsNative(ctx),/synthetic_context_read/);assert.equal(reads,4);
});

test('204 skip does not import the business fixture or claim acceptance and keeps all installation and final guards',()=>{
 const entry=adapter.slice(adapter.indexOf('export async function installAndVerifyDelegatedGroupsNative'));
 assert.match(entry,/businessCases='run'/);assert.match(entry,/let acceptance=null/);
 assert.match(entry,/try\{if\(businessCases==='run'\)acceptance=await\(await import\('\.\/fixtures\/attendance-delegated-groups-native\.mjs'\)\)/);
 assert.equal((entry.match(/import\(/g)||[]).length,1);
 assert.match(entry,/if\(businessCases==='run'\)\{assert\.equal\(acceptance\.groups\.length,8\)/);
 assert.match(entry,/businessCasesExecuted:businessCases==='run'/);assert.match(entry,/rollbackRestored:businessCases==='run'\?true:null/);
 const branch=entry.indexOf("try{if(businessCases==='run')"),final=entry.slice(entry.indexOf(' finally{',branch),entry.indexOf("\n if(businessCases==='run'){",branch));
 for(const token of ['assertDelegatedGroupsNativeDependencies','assertManagementAuditNativeOldState(before,installed',
  'delegated_groups_no_new_relations','installed.tables,before.tables','installed.indexes,before.indexes',
  'delegated_groups_reentry_exact_all_objects','pg_my_temp_schema()'])assert(entry.indexOf(token)<branch&&entry.indexOf(token)>=0,token);
 for(const token of ['d.fingerprint(),facts','d.definitions(),defs','d.tableCatalog(),catalog','periodContinuationArchiveBytes(await archive()),old155','periodContinuationArchiveBytes(await periodArchive()),old207'])assert(final.includes(token),token);
 assert.doesNotMatch(final,/businessCases|\breturn\b/);
});

test('204/205 exact pure catalog ACL alone accepts only original owner-only or owner+PUBLIC tuples, retaining every other strict field',()=>{
 const acl=delegatedGroupsNativePermissionsAclSql(),pure=acl.slice(acl.indexOf("then (select"),acl.indexOf("   else has_function_privilege"));
 assert.match(acl,/spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' and spec->>'signature'='public\.faolla_valid_merchant_enterprise_permissions_v1\(text\[\]\)'/);
 assert.match(acl,/has_function_privilege\(owned\.relowner,proc\.oid,'EXECUTE'\) is distinct from true/);
 assert.match(pure,/jsonb_build_array\(acl\.grantor,acl\.grantee,acl\.privilege_type,acl\.is_grantable\) order by acl\.grantee,acl\.grantor,acl\.privilege_type,acl\.is_grantable/);
 const alternatives=pure.slice(pure.indexOf(' not in('));
 assert.equal(alternatives,` not in(
     jsonb_build_array(jsonb_build_array(owned.relowner,owned.relowner,'EXECUTE',false)),
     jsonb_build_array(jsonb_build_array(owned.relowner,0::oid,'EXECUTE',false),jsonb_build_array(owned.relowner,owned.relowner,'EXECUTE',false)))\n`);
 //Exact-array equality, not subset matching: no missing owner/duplicate/extra
 //role, changed grantor, privilege or grant option can fit these two arrays.
 assert.doesNotMatch(pure,/service_role|authenticated|anon|@>|<@/);
 const unchanged=acl.slice(acl.indexOf('   else has_function_privilege'));
 for(const token of["has_function_privilege('anon'","has_function_privilege('authenticated'","has_function_privilege('service_role'",'acl.grantor<>owned.relowner',"acl.privilege_type<>'EXECUTE'",'acl.is_grantable'])assert(unchanged.includes(token));
 for(const [make,count] of[[delegatedGroupsNativeDependencySql,25],[delegatedConfigurationNativeDependencySql,44]]){
  const sql=make(Array.from({length:count},()=>({signature:'public.exact_dependency()',name:'exact_dependency'})));assert(sql.includes(acl));
  for(const check of['missing','owner','security_config','language_volatility','result_flags','execution_metadata','argnames','defaults','cost_overload','source_hash','ACL'])assert(sql.includes(check),check);
  assert.doesNotMatch(sql,/\bgrant\s|\brevoke\s|\bupdate\s|\binsert\s|\bdelete\s/i);
 }
});

test('204/205 catalog ACL expectation matches026 hardening or untouched PostgreSQL defaults and never ignores a reported ACL/hash/metadata failure',()=>{
 const migration=name=>readFileSync(new URL('./supabase-migrations/'+name,import.meta.url),'utf8');
 const old026=migration('202608040026_merchant_enterprise_workflow_automations.sql');
 assert.match(old026,/revoke all on function public\.faolla_valid_merchant_enterprise_permissions_v1\(text\[\]\)\s+from public, anon, authenticated, service_role;/);
 for(const name of['202610080185_merchant_attendance_period_delegations.sql','202610080190_merchant_attendance_correction_delegation_permission.sql']){
  const sql=migration(name);assert.match(sql,/create or replace function public\.faolla_valid_merchant_enterprise_permissions_v1/);
  assert.doesNotMatch(sql,/(?:grant|revoke)[^;]*on function public\.faolla_valid_merchant_enterprise_permissions_v1\(text\[\]\)/);
 }
 for(const [check,count,registryCount] of[[assertDelegatedGroupsNativeDependencies,25,3],[assertDelegatedConfigurationNativeDependencies,44,2]]){
  const good={functions:Array.from({length:count},(_,n)=>({signature:'exact'+n,failedFields:[]})),registry:Array.from({length:registryCount},()=>({expected:'exact',actual:'exact'})),alreadyInstalled:false};
  assert.equal(check(good,count),good);
  for(const failure of['ACL','source_hash','owner','security_config','language_volatility','argnames','defaults']){
   const bad=structuredClone(good);bad.functions[0].failedFields=[failure];assert.throws(()=>check(bad,count));
  }
 }
});

test('204 fixed eight-group, one-connection, rollback-only source stays within approved budgets',()=>{
 assert.deepEqual(delegatedGroupsNativeLimits,{groups:8,rpcs:90,steps:140,installationSteps:12,transactionMs:90000,statementMs:10000,lockMs:3000,connections:1,seedRows:9,newSites:1,newClusters:0,newDatabases:0,microcommits:0,browser:0});
 assert.equal(delegatedGroupsNativeGroupBudgets.length,8);assert.equal(new Set(delegatedGroupsNativeGroupBudgets.map(g=>g.name)).size,8);
 assert.deepEqual(delegatedGroupsNativeGroupBudgets.map(g=>g.rpcs),[14,8,10,17,12,10,12,7]);assert.equal(delegatedGroupsNativeGroupBudgets.reduce((n,g)=>n+g.rpcs,0),90);
 assert.equal(delegatedGroupsNativeGroupBudgets.reduce((n,g)=>n+g.steps,0),124);assert.equal(attendanceNativeConnectionLifetime({lifetimeMs:90000}),90000);
 assert.equal(delegatedGroupsNativeSite,'99990204');assert(Object.values(delegatedGroupsNativeIds).every(v=>/^[a-f0-9-]{36}$/.test(v)));
 for(const code of[source,adapter])assert(!/initdb|createdb|pg_ctl|browser\.launch|session_replication_role|disable trigger|process\.argv|setSystemTime|fakeTimers/i.test(code));
 assert(source.includes('native.connect({lifetimeMs:90000})'));assert(source.includes('if(!rolledBack)await connection.step'));assert(source.includes('await connection.close()'));
});

test('204 prerequisite preflight lists all25 exact hashes and metadata once and never silently installs parents',()=>{
 const frozen=delegatedGroupsNativeSources(root);assert.equal(frozen.specs.length,25);assert.equal(frozen.recipe.own.length,9);
 assert.equal(new Set(frozen.specs.map(f=>f.signature)).size,25);assert(frozen.specs.every(f=>/^[a-f0-9]{64}$/.test(f.hash)&&Array.isArray(f.args)&&typeof f.definer==='boolean'&&typeof f.isRpc==='boolean'));
 const sql=delegatedGroupsNativeDependencySql(frozen.specs);
 for(const token of['source_hash','security_config','language_volatility','result_flags','execution_metadata','argnames','defaults','cost_overload','ACL','coalesce(proc.proargnames,array[]::text[])',
  'merchant_attendance_groups','merchant_attendance_management_delegations','merchant_attendance_delegated_audit','legacyHash','alreadyInstalled'])assert(sql.includes(token),token);
 assert(!/insert into|update public\.|delete from|create table|create function|alter table/i.test(sql));
 const good={functions:frozen.specs.map(f=>({signature:f.signature,failedFields:[]})),registry:[1,2,3].map(version=>({version,expected:'exact',actual:'exact'})),alreadyInstalled:false};
 assert.equal(assertDelegatedGroupsNativeDependencies(good,25),good);
 for(const mutate of[v=>{v.alreadyInstalled=true;},v=>{v.functions[0].failedFields=['argnames'];},v=>{v.registry[0].actual='wrong';},v=>{v.functions.pop();}]){
  const bad=structuredClone(good);mutate(bad);assert.throws(()=>assertDelegatedGroupsNativeDependencies(bad,25));
 }
 assert(adapter.includes('boundClockMigrationBody(native.root,delegatedGroupsMigration)'));assert(!adapter.includes('install(managementDelegationMigration)'));
});

test('204 only two approved body forwards may change; all prior OIDs/ACL/defaults/indexes and archives remain protected',()=>{
 for(const token of["['faolla_attendance_groups_v1','faolla_attendance_management_insert_v1']",'assertManagementAuditNativeOldState(before,installed',
  'delegated_groups_no_new_relations','installed.tables,before.tables','installed.indexes,before.indexes','sources.recipe.own.map',
  'delegated_groups_reentry_exact_all_objects','pg_my_temp_schema()','delegated_groups_fixture_full_rollback','periodContinuationArchiveBytes(await archive())','periodContinuationArchiveBytes(await periodArchive())'])assert(adapter.includes(token),token);
 const frozen=delegatedGroupsNativeSources(root);assert.equal(frozen.recipe.forward.legacy.oldHash,'d130e4c2de2fef57ce6f18c15cc9ddb99b1d0fedb029b4e44872aee071bb9068');
 assert.equal(frozen.recipe.forward.guard.oldHash,'46d4e3edf8aba8d474b0e6e19651adc80fb7466a94c785f70e6681dc13a55110');
});

test('204 actual RPC boundary rejects invented actors, RPCs and private source parameters',()=>{
 const q={siteId:delegatedGroupsNativeSite,grantId:id(1),mode:'context',operationId:null},body={p_query:q,p_auth_user_id:id(2),p_command:null,p_allow_write:false};
 assert.match(delegatedGroupsNativeRpcExpression('faolla_attendance_delegated_groups_v1',body),/^public\.faolla_attendance_delegated_groups_v1\(/);
 assert.throws(()=>delegatedGroupsNativeRpcExpression('faolla_attendance_groups_core_v2',body));assert.throws(()=>delegatedGroupsNativeRpcExpression('faolla_attendance_delegated_groups_v1',{...body,p_actor:'owner'}));
 assert.throws(()=>delegatedGroupsNativeRpcExpression('faolla_attendance_delegated_groups_v1',{...body,p_allow_write:'true'}));
 assert.throws(()=>delegatedGroupsNativeRpcExpression('faolla_attendance_delegated_groups_v1',{...body,p_auth_user_id:'system'}));
 assert.throws(()=>delegatedGroupsNativeRpcExpression('faolla_attendance_delegated_groups_v1',{...body,p_query:{...q,siteId:'12345678'}}));
});

test('204 production Node exercises finite create/update/assign/end/cancel and original minimal receipts, not owner impersonation',()=>{
 for(const token of['createDelegatedGroupsService','executeManagementDelegation','executeGroups','delegatedGroupsCommandFingerprint',
  "'attendance.groups.manage'",'createContext.context.group,null','assignContext.context.worker.employeeId,p.employeeA',
  "groupScope(p.createdGroup,true)","'group_assign'","'group_end'","'group_cancel'","'assign','end','cancel'",
  'actual_actor_business_and_authority_proofs','authority.actor_auth_user_id=', 'authority.delegate_generation=0',
  'faolla_attendance_delegated_groups_operation_v1(authority,false)', 'attendance_operation_conflict', 'recover(createGrant,command)',
  'recover(endGrant,end)','receiptOnlyRecovery:true'])assert(source.includes(token),token);
 assert(source.includes('authUserId:actor'));assert(source.includes('actor=p.delegateAuth'));assert(!source.includes('authUserId:d.owner,allowWrite'));
 assert(!/insert into public\.merchant_attendance_groups|insert into public\.merchant_attendance_group_assignments|insert into public\.merchant_attendance_management_delegations|insert into public\.merchant_attendance_events/i.test(source));
});

test('204 failures cover exact scopes/CAS/overlap/revoke and real dual-generation suspension+restore',()=>{
 for(const token of['attendance_version_conflict','attendance_group_overlap','locationIds:[p.locationB]','workerId:p.workerB','assignmentId:p.ownerAssignment',
  'siteId:d.site','private204_core_service_denied','private204_core_anon_denied','futureUntil',"action:'revoke'",'actual204_two_paused_generations',
  "status(p.delegate,'disabled')","status(p.employeeA,'disabled')",'faolla_update_merchant_enterprise_employee_v1',
  'faolla_attendance_account_suspensions_v1','prepared.detail.canRestore','expectedGeneration:1','current.item.authorityCurrent,false',
  'current.item.delegate.generation,0','current.item.targetGeneration,0','restored_generations_do_not_rewrite_old_grants'])assert(source.includes(token),token);
 assert(!/update public\.merchant_attendance_account_epochs|insert into public\.merchant_attendance_account_epochs|update public\.merchant_enterprise_employees/i.test(source));
});

test('204 late atomic failure uses only a uniquely named owned AFTER test trigger, then exact catalog rollback and same-number retry',()=>{
 const sql=delegatedGroupsNativeFaultSql(id(44));for(const token of['synthetic204_owned_late_group_fault_v1','after insert on public.merchant_attendance_management_delegation_operations',
  "new.operation_id='"+id(44)+"'",'synthetic204_late_sidecar_failure'])assert(sql.includes(token),token);
 assert(!/disable trigger|alter table|create or replace|update public\.|delete from|truncate/i.test(sql));assert.throws(()=>delegatedGroupsNativeFaultSql(id(44),'99990203'));
 for(const token of['fault_catalog_before',"save('dg204_fault')",'delegatedGroupsNativeFaultSql(command.operationId)',"lastRpc.error,'synthetic204_late_sidecar_failure'",
  '(await recover(freshGrant,command)).receipt,null',"restore('dg204_fault',branch)",'fault_objects_exactly_rolled_back','beforeCatalog',
  '(await execute(freshGrant,command)).receipt.revision,3','attendance_events_append_only'])assert(source.includes(token),token);
});

test('204 every read/reject/replay is zero-write, all pre-existing rows/other merchants and clock-source facts survive',()=>{
 for(const token of['dg204_read_rejection_replay_wrote','dg204_unrelated_table_changed','dg204_old_row_changed:', 'dg204_external_scope_added:',
  'dg204_savepoint_not_exact','dg204_full_rollback_facts','dg204_clock_or_source_side_effect','d.definitions(),definitions','d.tableCatalog(),catalog',
  'periodContinuationArchiveBytes(await archive())','periodContinuationArchiveBytes(await periodArchive())','lastRpc={error:','r.context?.slice(0,6000)',
  'Actual Auth/browser UI and settings-lock race are not claimed'])assert(source.includes(token),token);
 assert(source.includes('source.includes')===false);assert(source.includes("['merchant_attendance_management_delegations','merchant_attendance_management_delegation_revocations','merchant_attendance_management_delegation_operations']"));
});
