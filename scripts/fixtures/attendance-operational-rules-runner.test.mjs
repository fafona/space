import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {operationalRulesNativeArgs,operationalRulesNativeMigration,operationalRulesNativeTables} from '../merchant-attendance-operational-rules-native.mjs';
const source=readFileSync(new URL('../merchant-attendance-operational-rules-native.mjs',import.meta.url),'utf8');

test('240 importing is inert and execution requires exactly one explicit existing local directory',()=>{
 const directory='D:/owned/synthetic';assert.deepEqual(operationalRulesNativeArgs(['--run-local','--directory',directory]),['--run-local','--directory',directory]);
 for(const args of [[],['--run-local'],['--run-local','--directory','relative'],['--run-local','--directory',directory,'--new-cluster'],
  ['--run-local','--directory',directory+'\n'],['--directory',directory,'--run-local']])assert.throws(()=>operationalRulesNativeArgs(args));
 assert.doesNotMatch(source,/spawn\(|connect\(|pg_ctl|initdb|closeAll\(|create database|drop schema/i);
 assert(source.includes('if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))'));
});

test('240 installs only its additive migration twice and allows no old function change',()=>{
 assert.equal(operationalRulesNativeMigration,'202610080191_merchant_attendance_operational_rules.sql');
 assert.deepEqual(operationalRulesNativeTables,['merchant_attendance_operational_rule_operations','merchant_attendance_operational_rule_publications','merchant_attendance_operational_rule_streams']);
 assert.equal((source.match(/d\.exec\(boundClockMigrationBody\(native.root,operationalRulesNativeMigration\)\)/g)||[]).length,2);
 assert(source.includes('pg_get_functiondef(oid),proowner,proacl,proconfig,prosecdef'));
 assert(source.includes('operational_rules_install_changed_old_facts'));
 assert(source.includes('operational_rules_install_changed_old_functions'));
 assert.doesNotMatch(source,/oid<>all|approvedChangedFunctions/);
});

test('240 checks rollback, exact old archives, functions and catalog even if its fixture fails',()=>{
 assert(source.includes('finally{'));
 for(const fragment of ['operational_rules_fixture_not_rolled_back','d.definitions(),definitions','d.tableCatalog(),catalog',
  'functions(),oldFunctions','periodContinuationArchiveBytes(archive()),original','periodContinuationArchiveBytes(periodArchive()),sealed',
  'acceptance.rollbackRestored,true','ruleAdoption:false'])assert(source.includes(fragment),fragment);
 assert(source.includes('runPeriodDelegatedClosureNative(operationalRulesNativeArgs(args),async ctx=>'));
 assert.doesNotMatch(source,/runCorrectionDelegationNative|verifyCorrectionDelegationNative/);
});
