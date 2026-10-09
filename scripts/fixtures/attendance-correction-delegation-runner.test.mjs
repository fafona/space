//Pure/static runner contract; importing never starts an environment.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {correctionDelegationNativeArgs,correctionDelegationNativeMigrations,correctionDelegationChangedFunctions} from '../merchant-attendance-correction-delegation-native.mjs';
const source=readFileSync(new URL('../merchant-attendance-correction-delegation-native.mjs',import.meta.url),'utf8');
test('238 requires the explicit existing local directory; importing stays inert',()=>{
 const directory=fileURLToPath(new URL('.',import.meta.url));assert.deepEqual(correctionDelegationNativeArgs(['--run-local','--directory',directory]),['--run-local','--directory',directory]);
 for(const args of [[],['--run-local'],['--run-local','--directory','relative'],['--run-local','--directory',directory,'--new-cluster'],
  ['--run-local','--directory',directory+'\n'],['--directory',directory,'--run-local']])assert.throws(()=>correctionDelegationNativeArgs(args));
 assert.doesNotMatch(source,/spawn\(|connect\(|pg_ctl|initdb|closeAll\(|create database|drop schema/i);
 assert(source.includes('if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))'));
});
test('238 additive prerequisite and only two approved old function changes',()=>{
 assert.deepEqual(correctionDelegationNativeMigrations,['202610080189_merchant_attendance_correction_delegation.sql','202610080190_merchant_attendance_correction_delegation_permission.sql']);
 assert.deepEqual(correctionDelegationChangedFunctions,['faolla_attendance_account_capture_v1(text,uuid,uuid,uuid,boolean)','faolla_valid_merchant_enterprise_permissions_v1(text[])']);
 assert(source.includes('pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef'));
 assert(source.indexOf('assert.equal(functionHash(),allFunctions)')<source.indexOf('for(const migration of correctionDelegationNativeMigrations)'));
 assert.equal((source.match(/for\(const migration of correctionDelegationNativeMigrations\)/g)||[]).length,2);
 assert(source.includes('correction_delegation_unapproved_old_function_changed'));
});
test('238 fixture rollback, definitions and old archives are verified even on failure',()=>{
 assert(source.includes('finally{'));assert(source.includes('correction_delegation_fixture_not_rolled_back'));
 for(const fragment of ['d.definitions(),definitions','d.tableCatalog(),catalog','functionHash(true),preservedFunctions',
  'periodContinuationArchiveBytes(archive()),original','periodContinuationArchiveBytes(periodArchive()),sealed','acceptance.rollbackRestored,true'])assert(source.includes(fragment),fragment);
 assert(source.includes('runPeriodDelegatedClosureNative(correctionDelegationNativeArgs(args),async ctx=>'));
});
