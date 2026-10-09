import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {delegatedCredentialsNativeLimits as limits,delegatedCredentialsNativeSqlSha,delegatedCredentialsNativeNewTables,
 delegatedCredentialsNativeSources,delegatedCredentialsNativeOptions,installAndVerifyDelegatedCredentialsNative} from './merchant-attendance-delegated-credentials-native.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),source=readFileSync(new URL('./merchant-attendance-delegated-credentials-native.mjs',import.meta.url),'utf8');
test('207 frozen source has36 exact dependencies/19 own functions/five forwards/one private proof, not a broad installer',()=>{
 const s=delegatedCredentialsNativeSources(root);assert.match(delegatedCredentialsNativeSqlSha,/^[a-f0-9]{64}$/);
 assert.equal(s.recipe.dependencies.length,36);assert.equal(s.recipe.own.length,19);assert.equal(s.forwards.length,5);
 assert.deepEqual(delegatedCredentialsNativeNewTables,['merchant_attendance_delegated_credential_proofs']);
 assert.equal(s.recipe.templates.tables.length,15);assert.equal(s.recipe.triggerManifest.length,24);
 assert.equal(s.recipe.own.filter(f=>f.isRpc).length,2);assert(s.recipe.own.find(f=>f.name==='faolla_attendance_delegated_credentials_pair_v1').definer);
});
test('207 business evidence defaults to run; explicit skip remains non-evidence, with finite120s/90RPC/140SQL/one connection',()=>{
 assert.deepEqual(delegatedCredentialsNativeOptions(),{businessCases:'run'});assert.deepEqual(delegatedCredentialsNativeOptions({businessCases:'skip'}),{businessCases:'skip'});
 for(const bad of [null,[],{businessCases:'all'},{businessCases:'skip',unlimited:true}])assert.throws(()=>delegatedCredentialsNativeOptions(bad));
 assert.equal(limits.groups,8);assert.equal(limits.rpcs,90);assert.equal(limits.steps,140);assert.equal(limits.transactionMs,120000);assert.equal(limits.connections,1);
 for(const key of ['newClusters','newDatabases','microcommits','browser','realAuth','kdf','production'])assert.equal(limits[key],0);
 assert(source.includes("businessCasesExecuted:businessCases==='run'"));assert(source.includes("rollbackRestored:businessCases==='run'?true:null"));
});
test('207 foreign or absent owned context refuses before source/process/socket calls',async()=>{
 let calls=0;await assert.rejects(()=>installAndVerifyDelegatedCredentialsNative({native:{query:()=>{calls++;}}}),/owned_context/);assert.equal(calls,0);
 assert(!/child_process|process\.argv|process\.env|pg_ctl|new Pool|createBrowser|runAdministrativeClosureNative/.test(source));
});
test('207 adapter keeps complete old facts/OID/ACL/defaults/indexes, exact reentry and both archive bytes before/after rollback',()=>{
 for(const part of ['assertManagementAuditNativeOldState(before,installed','sources.forwards.map(f=>f.name)',
  'delegated_credentials_reentry_exact_all_objects','delegated_credentials_fixture_full_rollback','d.definitions(),definitions','d.tableCatalog(),catalog',
  'periodContinuationArchiveBytes(await archive()),old155','periodContinuationArchiveBytes(await periodArchive()),old207','delegated_credentials_install12steps'])assert(source.includes(part),part);
 assert(!/disable trigger|session_replication_role|substring\(pg_get_functiondef/i.test(source));
});
