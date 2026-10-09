import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {delegatedRevisionsNativeLimits as limits,delegatedRevisionsNativeSqlSha,
 delegatedRevisionsNativeSources,delegatedRevisionsNativeOptions,installAndVerifyDelegatedRevisionsNative} from './merchant-attendance-delegated-revisions-native.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),source=readFileSync(new URL('./merchant-attendance-delegated-revisions-native.mjs',import.meta.url),'utf8');
test('208 frozen recipe pins89 exact dependencies/13 own functions/three forwards/18 existing table templates and37 triggers',()=>{
 const s=delegatedRevisionsNativeSources(root);assert.match(delegatedRevisionsNativeSqlSha,/^[a-f0-9]{64}$/);
 assert.equal(s.recipe.dependencies.length,89);assert.equal(s.recipe.own.length,13);assert.equal(s.forwards.length,3);
 assert.equal(s.recipe.templates.tables.length,18);assert.equal(s.recipe.templates.extraTables.length,3);assert.equal(s.recipe.triggerManifest.length,37);
 assert.equal(s.recipe.own.filter(f=>f.isRpc).length,1);assert.equal(limits.newTables,0);
 assert.deepEqual(s.forwards.map(f=>f.name),['faolla_attendance_revision_owner_review_v3','faolla_attendance_revision_decide_v2','faolla_attendance_management_insert_v1']);
});
test('208 actual evidence defaults to run; explicit skip never claims business success or rollback evidence',()=>{
 assert.deepEqual(delegatedRevisionsNativeOptions(),{businessCases:'run'});assert.deepEqual(delegatedRevisionsNativeOptions({businessCases:'skip'}),{businessCases:'skip'});
 for(const bad of [null,[],{businessCases:'all'},{businessCases:'skip',unlimited:true}])assert.throws(()=>delegatedRevisionsNativeOptions(bad));
 assert.equal(limits.groups,8);assert.equal(limits.rpcs,90);assert.equal(limits.steps,140);assert.equal(limits.transactionMs,120000);
 assert.equal(limits.connections,3);assert.equal(limits.races,1);assert.equal(limits.polls,16);
 for(const key of ['newClusters','newDatabases','microcommits','browser','realAuth','kdf','production'])assert.equal(limits[key],0);
 assert(source.includes("businessCasesExecuted:businessCases==='run'"));assert(source.includes("rollbackRestored:businessCases==='run'?true:null"));
});
test('208 absent or foreign owned context refuses before any socket, process or source install',async()=>{
 let calls=0;await assert.rejects(()=>installAndVerifyDelegatedRevisionsNative({native:{query:()=>{calls++;}}}),/owned_context/);assert.equal(calls,0);
 assert(!/child_process|process\.argv|process\.env|pg_ctl|new Pool|createBrowser|runAdministrativeClosureNative/.test(source));
});
test('208 preserves complete old facts/OID/ACL/defaults/catalog, exact reentry, released templates and two archives around whole rollback',()=>{
 for(const part of ['assertManagementAuditNativeOldState(before,installed','sources.forwards.map(f=>f.name)',
  'delegated_revisions_no_new_business_relations','delegated_revisions_reentry_exact_all_objects','delegated_revisions_fixture_full_rollback',
  'd.definitions(),definitions','d.tableCatalog(),catalog','periodContinuationArchiveBytes(await archive()),old155',
  'periodContinuationArchiveBytes(await periodArchive()),oldPeriod','delegated_revisions_install12steps',"relkind in('r','p','v')"])assert(source.includes(part),part);
 assert(!/disable trigger|session_replication_role|substring\(pg_get_functiondef/i.test(source));
});
