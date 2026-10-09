//SOURCE/pure evidence only. This file never connects to PostgreSQL.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {delegatedRulesNativeLimits,delegatedRulesNativeOptions,delegatedRulesNativeSources,installAndVerifyDelegatedRulesNative} from './merchant-attendance-delegated-rules-native.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
test('206 frozen native sources require exactly four forwards/19 own functions/44 dependencies',()=>{
 const s=delegatedRulesNativeSources(root);assert.equal(s.forwards.length,4);assert.equal(s.recipe.own.length,19);assert.equal(s.recipe.dependencies.length,44);
 assert.equal(s.recipe.own.filter(f=>f.isRpc).length,1);assert.equal(s.recipe.own.find(f=>f.isRpc).name,'faolla_attendance_delegated_rules_v1');
 assert(s.forwards.every(f=>f.oldHash!==f.newHash));assert(Object.isFrozen(s));
});
test('206 business evidence is explicit/default-run; skip is not a hidden success or scope expansion',()=>{
 assert.deepEqual(delegatedRulesNativeOptions(),{businessCases:'run'});assert.deepEqual(delegatedRulesNativeOptions({businessCases:'skip'}),{businessCases:'skip'});
 for(const value of [null,[],true,{businessCases:'all'},{businessCases:'skip',production:true}])assert.throws(()=>delegatedRulesNativeOptions(value));
 assert(Object.isFrozen(delegatedRulesNativeLimits));assert.equal(delegatedRulesNativeLimits.groups,8);assert.equal(delegatedRulesNativeLimits.steps,140);
 assert.equal(delegatedRulesNativeLimits.rpcs,90);assert.equal(delegatedRulesNativeLimits.connections,1);assert.equal(delegatedRulesNativeLimits.newClusters,0);
});
test('206 invalid context refuses before source, process or network access',async()=>{
 for(const value of [undefined,{}, {d:{syntheticOnly:false},h:{syntheticOnly:true}}])await assert.rejects(installAndVerifyDelegatedRulesNative(value),/delegated_rules_owned_context_required/);
});
test('206 native adapter keeps complete install/reentry/rollback protections and no command-line executor',()=>{
 const text=readFileSync(path.join(root,'scripts/merchant-attendance-delegated-rules-native.mjs'),'utf8');
 for(const proof of ['assertManagementAuditNativeOldState(before,installed','assert.deepEqual(installed.tables,before.tables)','assert.deepEqual(installed.indexes,before.indexes)',
  'delegated_rules_reentry_exact_all_objects','delegated_rules_fixture_full_rollback',"archive()),old155","periodArchive()),old207",'businessCasesExecuted:businessCases===\'run\''])assert(text.includes(proof),proof);
 for(const operation of ['spawn(', 'spawnSync(', 'execFile(', 'process.argv','newCluster:true','newDatabase:true'])assert(!text.includes(operation),operation);
});
