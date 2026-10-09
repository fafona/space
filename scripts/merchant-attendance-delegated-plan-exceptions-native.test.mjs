import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {delegatedPlanExceptionsNativeLimits as limits,delegatedPlanExceptionsNativeSqlSha,
 delegatedPlanExceptionsNativeSources,delegatedPlanExceptionsNativeOptions,installAndVerifyDelegatedPlanExceptionsNative,
 delegatedPlanExceptionsNativeDependencySql,assertDelegatedPlanExceptionsNativeDependencies} from './merchant-attendance-delegated-plan-exceptions-native.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),source=readFileSync(new URL('./merchant-attendance-delegated-plan-exceptions-native.mjs',import.meta.url),'utf8');
test('209 frozen recipe pins159 exact dependencies/13 own functions/three forwards/25 existing table templates and52 triggers',()=>{
 const s=delegatedPlanExceptionsNativeSources(root);assert.match(delegatedPlanExceptionsNativeSqlSha,/^[a-f0-9]{64}$/);
 assert.equal(s.recipe.dependencies.length,159);assert.equal(s.recipe.own.length,13);assert.equal(s.forwards.length,3);
 assert.equal(s.recipe.templates.tables.length,25);assert.equal(s.recipe.templates.extraTables.length,7);assert.equal(s.recipe.triggerManifest.length,52);
 assert.equal(s.recipe.own.filter(f=>f.isRpc).length,1);assert.equal(limits.newTables,0);
 assert.deepEqual(s.forwards.map(f=>f.name),['faolla_attendance_plan_exception_clearance_execute_v1','faolla_attendance_plan_exception_posthoc_execute_v1','faolla_attendance_management_insert_v1']);
});
test('209 bounded read-only163 diagnostics preserve all function metadata/ACL guards and disclose only failed fields/hashes/signatures',()=>{
 const s=delegatedPlanExceptionsNativeSources(root);assert.equal(s.specs.length,163);const query=delegatedPlanExceptionsNativeDependencySql(s.specs);
 for(const field of ['proowner','prosecdef','proconfig','provolatile','prorettype','proretset','proisstrict','proleakproof','prokind','proparallel','prosupport','proallargtypes','proargmodes','pronargs','proargnames','pronargdefaults','proargdefaults','procost','prorows'])assert(query.includes(field),field);
 for(const check of ['same_name.proname=proc.proname','has_function_privilege','aclexplode','acl.grantor','acl.is_grantable','sha256','legacyHash',"version=202610080190",'source_hash'])assert(query.includes(check),check);
 assert(!/\b(?:insert into|update public|delete from|alter |create |drop )/i.test(query));
 assert(!/jsonb_build_object\([^;]*['"](?:body|prosrc|definition)['"]\s*,/.test(query));
 assert.throws(()=>delegatedPlanExceptionsNativeDependencySql(s.specs.slice(1)),/dependency163/);
 const baseline={functions:s.specs.map(spec=>({signature:spec.signature,expectedHash:spec.hash,actualHash:spec.hash,failedFields:[]})),
  registry:[1,2,3,4,5].map(n=>({version:n,expected:'expected',actual:'expected'})),alreadyInstalled:false};
 assert.equal(assertDelegatedPlanExceptionsNativeDependencies(baseline),baseline);
 for(const field of ['ACL','source_hash','owner','defaults','argnames','security_config'])assert.throws(()=>assertDelegatedPlanExceptionsNativeDependencies({...baseline,functions:baseline.functions.map((f,i)=>i?f:{...f,failedFields:[field]})}),/dependency_body_metadata/);
 assert.throws(()=>assertDelegatedPlanExceptionsNativeDependencies({...baseline,alreadyInstalled:true}),/forward_order/);
 assert.throws(()=>assertDelegatedPlanExceptionsNativeDependencies({...baseline,registry:baseline.registry.map((r,i)=>i?r:{...r,actual:'foreign'})}),/registry_prerequisites/);
});
test('209 actual evidence defaults to run; explicit skip never claims business success or rollback evidence',()=>{
 assert.deepEqual(delegatedPlanExceptionsNativeOptions(),{businessCases:'run'});assert.deepEqual(delegatedPlanExceptionsNativeOptions({businessCases:'skip'}),{businessCases:'skip'});
 for(const bad of [null,[],{businessCases:'all'},{businessCases:'skip',unlimited:true}])assert.throws(()=>delegatedPlanExceptionsNativeOptions(bad));
 assert.equal(limits.groups,8);assert.equal(limits.rpcs,90);assert.equal(limits.steps,140);assert.equal(limits.transactionMs,120000);
 assert.equal(limits.connections,3);assert.equal(limits.races,1);assert.equal(limits.polls,16);
 for(const key of ['newClusters','newDatabases','microcommits','browser','realAuth','kdf','production'])assert.equal(limits[key],0);
 assert(source.includes("businessCasesExecuted:businessCases==='run'"));assert(source.includes("rollbackRestored:businessCases==='run'?true:null"));
});
test('209 absent or foreign owned context refuses before any socket, process or source install',async()=>{
 let calls=0;await assert.rejects(()=>installAndVerifyDelegatedPlanExceptionsNative({native:{query:()=>{calls++;}}}),/owned_context/);assert.equal(calls,0);
 assert(!/child_process|process\.argv|process\.env|pg_ctl|new Pool|createBrowser|runAdministrativeClosureNative/.test(source));
});
test('209 preserves complete old facts/OID/ACL/defaults/catalog, exact reentry, released templates and two archives around whole rollback',()=>{
 for(const part of ['assertManagementAuditNativeOldState(before,installed','sources.forwards.map(f=>f.name)',
  'delegated_plan_exceptions_no_new_business_relations','delegated_plan_exceptions_reentry_exact_all_objects','delegated_plan_exceptions_fixture_full_rollback',
  'd.definitions(),definitions','d.tableCatalog(),catalog','periodContinuationArchiveBytes(await archive()),old155',
  'periodContinuationArchiveBytes(await periodArchive()),oldPeriod','delegated_plan_exceptions_install12steps',"relkind in('r','p','v')"])assert(source.includes(part),part);
 assert(!/disable trigger|session_replication_role|substring\(pg_get_functiondef/i.test(source));
});


