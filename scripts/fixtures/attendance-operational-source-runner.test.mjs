import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {operationalSourceNativeArgs,operationalSourceNativeMigration,operationalSourceNativeFunctions} from '../merchant-attendance-operational-source-native.mjs';
const source=readFileSync(new URL('../merchant-attendance-operational-source-native.mjs',import.meta.url),'utf8');
test('241 runner is inert on import and requires one explicitly supplied absolute owned directory',()=>{
 const args=['--run-local','--directory','C:/Users/User/AppData/Local/Temp/faolla-attendance-foundation-LKtY4L'];
 assert.deepEqual(operationalSourceNativeArgs(args),args);
 for(const bad of [[],['--run-local'],['--directory',args[2]],['--run-local','--directory','relative'],[...args,'--create']])
  assert.throws(()=>operationalSourceNativeArgs(bad));
 assert.match(source,/path\.resolve\(process\.argv\[1\]\)===fileURLToPath\(import\.meta\.url\)/);
});
test('241 source installation admits exactly five new functions and zero table changes',()=>{
 assert.equal(operationalSourceNativeMigration,'202610080192_merchant_attendance_operational_source.sql');
 assert.equal(operationalSourceNativeFunctions.length,5);assert(Object.isFrozen(operationalSourceNativeFunctions));
 assert.match(source,/assert\.deepEqual\(added,operationalSourceNativeFunctions\)/);
 assert.match(source,/operational_source_must_not_add_or_change_tables/);
 assert.match(source,/operational_source_install_changed_old_facts/);
 assert.match(source,/operational_source_install_changed_old_functions/);
});
test('241 runs the narrow fixture rather than240 capacity acceptance and preserves both migration reentries',()=>{
 assert.match(source,/runPeriodDelegatedClosureNative\(operationalSourceNativeArgs\(args\)/);
 assert.doesNotMatch(source,/runOperationalRulesNative\(/);
 assert.equal((source.match(/d\.exec\(boundClockMigrationBody\(native\.root,operationalSourceNativeMigration\)\)/g)||[]).length,2);
 assert.equal((source.match(/d\.exec\(boundClockMigrationBody\(native\.root,operationalRulesNativeMigration\)\)/g)||[]).length,2);
});
test('241 verifies every old archive, function and fact in finally and never claims runtime adoption',()=>{
 assert.match(source,/finally\{[\s\S]*operational_source_fixture_not_rolled_back/);
 assert.match(source,/periodContinuationArchiveBytes\(archive\(\)\),original/);
 assert.match(source,/periodContinuationArchiveBytes\(periodArchive\(\)\),sealed/);
 assert.match(source,/assert\.equal\(acceptance\.rollbackRestored,true\)/);
 assert.match(source,/realAuth:false/);assert.match(source,/ruleAdoption:false/);
 assert.match(source,/cleanupOwnedByParent:true,newCluster:false/);
});
