//SOURCE only: no PG/installed package/UI/real Auth evidence is claimed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
import {attendanceNativeConnectionLifetime} from '../merchant-attendance-native-connections.mjs';
import {delegatedConfigurationNativeLimits,delegatedConfigurationNativeSources,delegatedConfigurationNativeDependencySql,assertDelegatedConfigurationNativeDependencies} from '../merchant-attendance-delegated-configuration-native.mjs';
import {delegatedConfigurationNativeSite,delegatedConfigurationNativeIds,delegatedConfigurationNativeGroupBudgets,delegatedConfigurationNativeRpcExpression,delegatedConfigurationNativeFaultSql} from './attendance-delegated-configuration-native.mjs';
const root=fileURLToPath(new URL('../..',import.meta.url)),source=readFileSync(new URL('./attendance-delegated-configuration-native.mjs',import.meta.url),'utf8'),adapter=readFileSync(new URL('../merchant-attendance-delegated-configuration-native.mjs',import.meta.url),'utf8');
test('205 fixed eight groups/90RPC/140SQL/one90s connection/no microcommit within120s approved cap',()=>{
 assert.deepEqual(delegatedConfigurationNativeLimits,{groups:8,rpcs:90,steps:140,installationSteps:12,transactionMs:90000,approvedMaximumMs:120000,statementMs:10000,lockMs:3000,connections:1,seedRows:7,newSites:1,newClusters:0,newDatabases:0,microcommits:0,browser:0});
 assert.equal(delegatedConfigurationNativeGroupBudgets.length,8);assert.equal(new Set(delegatedConfigurationNativeGroupBudgets.map(g=>g.name)).size,8);
 assert.equal(delegatedConfigurationNativeGroupBudgets.reduce((n,g)=>n+g.rpcs,0),88);assert.equal(delegatedConfigurationNativeGroupBudgets.reduce((n,g)=>n+g.steps,0),117);
 assert.equal(attendanceNativeConnectionLifetime({lifetimeMs:90000}),90000);assert.equal(delegatedConfigurationNativeSite,'99990205');assert(Object.values(delegatedConfigurationNativeIds).every(v=>/^[a-f0-9-]{36}$/.test(v)));
 for(const code of[source,adapter])assert(!/initdb|createdb|pg_ctl|browser\.launch|session_replication_role|disable trigger|process\.argv|setSystemTime|fakeTimers/i.test(code));
 assert(source.includes('native.connect({lifetimeMs:90000})'));assert(source.includes('if(!rolledBack)await connection.step'));assert(source.includes('await connection.close()'));
});
test('205 one exact43-body/metadata inventory before install, no silent dependency install',()=>{
 const f=delegatedConfigurationNativeSources(root);assert.equal(f.specs.length,43);assert.equal(f.recipe.own.length,10);assert.equal(new Set(f.specs.map(x=>x.signature)).size,43);
 const sql=delegatedConfigurationNativeDependencySql(f.specs);for(const token of['source_hash','security_config','language_volatility','result_flags','execution_metadata','argnames','defaults','cost_overload','ACL','legacyHash','merchant_attendance_employment_lifecycle','merchant_attendance_delegated_groups'])assert(sql.includes(token),token);
 assert(!/insert into|update public\.|delete from|create table|create function|alter table/i.test(sql));
 const good={functions:f.specs.map(x=>({signature:x.signature,failedFields:[]})),registry:[1,2].map(version=>({version,expected:'exact',actual:'exact'})),alreadyInstalled:false};assert.equal(assertDelegatedConfigurationNativeDependencies(good,43),good);
 for(const mutate of[v=>{v.alreadyInstalled=true;},v=>{v.functions[0].failedFields=['ACL'];},v=>{v.registry[0].actual='wrong';}]){const bad=structuredClone(good);mutate(bad);assert.throws(()=>assertDelegatedConfigurationNativeDependencies(bad,43));}
 assert(adapter.includes('boundClockMigrationBody(native.root,delegatedConfigurationMigration)'));assert(!adapter.includes('installAndVerifyDelegatedGroupsNative'));
});
test('205 only two forwarded bodies,10 functions,0 tables; allold facts/catalog/OID/ACL/defaults/archives exact',()=>{
 for(const token of["['faolla_attendance_admin_v1','faolla_attendance_management_insert_v1']",'assertManagementAuditNativeOldState(before,installed','installed.tables,before.tables','installed.indexes,before.indexes',
  'delegated_configuration_no_new_relations','delegated_configuration_reentry_exact_all_objects','pg_my_temp_schema()','delegated_configuration_fixture_full_rollback','periodContinuationArchiveBytes(await archive())','periodContinuationArchiveBytes(await periodArchive())'])assert(adapter.includes(token),token);
 const f=delegatedConfigurationNativeSources(root);assert.equal(f.recipe.forward.legacy.oldHash,'67aa7c785dec53199a500517e05c0f58646e24f7bd5be0041a23679e32d19949');assert.equal(f.recipe.forward.guard.oldHash,'5d2636f3b1eacfaf0dcb6f249e234bd641e50657df5a71e0cc9fbd7600427183');
});
test('205 actual RPC parameter names reject invented actors, helpers or private contexts',()=>{
 const q={siteId:delegatedConfigurationNativeSite,grantId:id(1),mode:'context',operationId:null},body={p_query:q,p_auth_user_id:id(2),p_command:null,p_allow_write:false};
 assert.match(delegatedConfigurationNativeRpcExpression('faolla_attendance_delegated_config_v1',body),/^public\.faolla_attendance_delegated_config_v1\(/);
 assert.throws(()=>delegatedConfigurationNativeRpcExpression('faolla_attendance_admin_core_v2',body));assert.throws(()=>delegatedConfigurationNativeRpcExpression('faolla_attendance_delegated_config_v1',{...body,p_actor:'owner'}));
 assert.throws(()=>delegatedConfigurationNativeRpcExpression('faolla_attendance_delegated_config_v1',{...body,p_allow_write:'true'}));assert.throws(()=>delegatedConfigurationNativeRpcExpression('faolla_attendance_delegated_config_v1',{...body,p_auth_user_id:'system'}));
 const admin={p_site_id:delegatedConfigurationNativeSite,p_auth_user_id:id(2),p_query:{view:'settings',cursor:null,search:''},p_command:null,p_operation_id:null};
 assert.match(delegatedConfigurationNativeRpcExpression('faolla_attendance_admin_v1',admin),/^public\.faolla_attendance_admin_v1\(/);assert.throws(()=>delegatedConfigurationNativeRpcExpression('faolla_attendance_admin_v1',{...admin,p_grant_id:id(3)}));
});
test('205 trueproduction Node four scoped saves realowner grants, existingemployment and sameactual actor sidecar',()=>{
 for(const token of['createDelegatedConfigurationService','executeManagementDelegation','executeAttendanceAdmin','delegatedConfigurationCommandFingerprint',
  "'attendance.workers.manage'","'attendance.locations.manage'",'actual_same_actor_old_configop_and_authority_proofs','authority.actor_auth_user_id=',
  'actual.actor_auth_user_id=authority.actor_auth_user_id','faolla_attendance_delegated_config_operation_v1(authority,false)',
  'createdLocation={','updatedLocation={','createdWorker={','updatedWorker={','actualOwnerFourWrites:true','actualDelegatedFourWrites:true'])assert(source.includes(token),token);
 assert(!/insert into public\.merchant_attendance_(?:workers|locations|employment_periods|config_operations|management_delegations|events)/i.test(source));
 assert(source.includes('authUserId:actor'));assert(source.includes('actor=p.delegateAuth'));
});
test('205 scope,threeidentity,CAS,createonce,oldopcollision,revoke/validity/defaultoff and bothrealepochs covered finitely',()=>{
 for(const token of['employeeAuthUserId:p.authB','worker(p.workerA,p.employeeB,p.locationA)','worker(p.workerA,p.employeeA,p.locationB)','worker(p.workerNew,p.employeeA,p.locationA)',
  'siteId:d.site','private205_core_','execute(otherGrant)','attendance_version_conflict','old_owner_operation_is_never_retro_authorized','attendance_operation_conflict',
  'offNode.execute','futureUntil',"action:'revoke'",'actual205_two_paused_generations',"status(p.delegate,'disabled')","status(p.employeeB,'disabled')",'expectedGeneration:1',
  'prepared.detail.canRestore','current.item.authorityCurrent,false','current.item.targetGeneration,0','enabled:false','receiptOnlyRecovery:true'])assert(source.includes(token),token);
 assert(!/update public\.merchant_attendance_account_epochs|insert into public\.merchant_attendance_account_epochs|update public\.merchant_enterprise_employees/i.test(source));
});
test('205 late23514 fault is uniqueowned AFTER, withzero-halfwrite fullsnapshot and same-number retry/catalog rollback',()=>{
 const sql=delegatedConfigurationNativeFaultSql(id(44));for(const token of['synthetic205_owned_late_config_fault_v1','after insert on public.merchant_attendance_management_delegation_operations',"errcode='23514'","constraint='synthetic205_owned_late_config_fault'"])assert(sql.includes(token),token);
 assert(!/disable trigger|alter table|create or replace|update public\.|delete from|truncate/i.test(sql));assert.throws(()=>delegatedConfigurationNativeFaultSql(id(44),'99990204'));
 for(const token of["save('dc205_fault')",'lastRpc.sqlstate,\'23514\'',"restore('dc205_fault',branch)",'fault_catalog_and_objects_exact_restored','retried=await execute(freshGrant,c)',
  'dc205_read_rejection_replay_wrote','dc205_unrelated_table_changed','dc205_old_row_changed:','dc205_external_scope_added:','dc205_full_rollback_facts','dc205_clock_or_source_side_effect','d.definitions(),definitions','d.tableCatalog(),catalog'])assert(source.includes(token),token);
});
