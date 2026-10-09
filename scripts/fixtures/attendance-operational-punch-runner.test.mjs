import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {operationalPunchNativeArgs,operationalPunchNativeMigration,operationalPunchNativeTables,operationalPunchReplacedFunctions} from '../merchant-attendance-operational-punch-native.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
test('242 runner is import-inert and accepts only explicit existing-directory argument shape',()=>{
 const args=['--run-local','--directory',path.join(root,'.synthetic-owned')];assert.deepEqual(operationalPunchNativeArgs(args),args);
 for(const bad of [[],['--run-local'],['--run-local','--directory','relative'],[...args,'--production'],['--run-local','--directory',args[2]+'\n']])assert.throws(()=>operationalPunchNativeArgs(bad));
});
test('242 runner allows exactly six old writer bodies and three new tables',()=>{
 assert.equal(operationalPunchNativeMigration,'202610080193_merchant_attendance_operational_punch.sql');
 assert.equal(operationalPunchNativeTables.length,3);assert.equal(operationalPunchReplacedFunctions.length,6);assert.equal(new Set(operationalPunchReplacedFunctions).size,6);
 assert(operationalPunchReplacedFunctions.includes('faolla_attendance_pin_schedule_v1'));
});
test('242 runner checks rollback, old facts, other definitions, old metadata and both archives',()=>{
 const text=readFileSync(path.join(root,'scripts/merchant-attendance-operational-punch-native.mjs'),'utf8');
 for(const pattern of [/runPeriodDelegatedClosureNative/,/assertLifecycleSandbox/,/initialFunctions/,/old_OID_signature_ACL_owner_changed/,/old_facts/,/changed_unapproved_function/,/fixture_not_rolled_back/,/periodContinuationArchiveBytes\(archive\(\)\)/,/periodContinuationArchiveBytes\(periodArchive\(\)\)/,/cleanupOwnedByParent:true/,/newCluster:false/])assert.match(text,pattern);
 assert.doesNotMatch(text,/runOperationalRulesNative\(|runOperationalSourceNative\(/);
});
