//Static SOURCE only. These do not run PostgreSQL or claim the eight groups.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dayReviewNativeDependencies,dayReviewNativeDependencyDiagnosticSql,dayReviewNativeLimits,installAndVerifyDayReviewNative} from './merchant-attendance-day-review-native.mjs';
const sql=readFileSync(new URL('./supabase-migrations/202610080199_merchant_attendance_day_reviews.sql',import.meta.url),'utf8');

test('199 installation-only option rejects unknown authority and invalid values before any transport',async()=>{
 for(const options of [null,[],{businessCases:'maybe'},{businessCases:'skip',allowWrite:true}])
  await assert.rejects(installAndVerifyDayReviewNative(undefined,options),/day_review_native_(?:options|business_cases)_invalid/);
});
test('199 SOURCE skip is only after exact install/reentry and full saved facts/metadata/archives; no fixture or race claim',()=>{
 const source=readFileSync(new URL('./merchant-attendance-day-review-native.mjs',import.meta.url),'utf8');
 assert(source.includes("const {businessCases='run'}=options"));
 const start=source.indexOf("if(businessCases==='skip')"),end=source.indexOf("const fixture=await import",start),branch=source.slice(start,end);
 assert(start>source.indexOf('day_review_reentry_facts'));assert(end>start);
 for(const token of ['day_review_skip_installed_facts','d.definitions()','d.tableCatalog()','oldFunctions(),oldDefinitions','await archive()','await periodArchive()',
  'acceptance:null,businessCasesExecuted:false','coreRollbackRestored:null,race:null,rollbackRestored:null,raceCommittedOwnRows:0'])assert(branch.includes(token),token);
 assert(!branch.includes('verifyDayReviewNative(')&&!branch.includes('verifyDayReviewNativeRace('));
});
test('199 native adapter inventories exact25 functions and required relations without installation',()=>{
 const d=dayReviewNativeDependencies(sql);assert.equal(d.functions.length,25);assert(d.relations.includes('merchant_attendance_events'));
 assert(d.relations.includes('merchant_attendance_schedule_slots'));assert(!d.relations.includes('merchant_attendance_day_review_cases'));
 for(const f of d.functions)assert('defaultExpression'in f);
});
test('199 preflight diagnostic reports actual/expected source hashes and complete bounded metadata once',()=>{
 const diagnostic=dayReviewNativeDependencyDiagnosticSql(sql);
 for(const m of ['expectedHash','actualHash','failedFields','source_hash','owner_execute','argument_modes','defaults','acl','registry','missingRelations','prosupport','cost_rows'])assert(diagnostic.includes(m),m);
 assert(!/insert into|update public|delete from|create table|create function/i.test(diagnostic));
 assert(!diagnostic.includes('pg_exception_context'));assert(!diagnostic.includes("'prosrc'")&&!diagnostic.includes("'body'"));
});
test('199 native entry is inert, main rollback guarded before separate2-row race, owned ctx and no old matrix',()=>{
 const source=readFileSync(new URL('./merchant-attendance-day-review-native.mjs',import.meta.url),'utf8');
 assert(source.includes('assertLifecycleSandbox'));assert(source.includes('old_OID_metadata_ACL'));assert(source.includes('day_review_fixture_not_rolled_back'));
 assert(!source.includes('process.argv'));assert(!source.includes('runAdministrativeClosureNative'));assert(!source.includes('initdb'));assert(!source.includes('execSync'));
 assert(source.indexOf('day_review_fixture_not_rolled_back')<source.indexOf('fixture.verifyDayReviewNativeRace(ctx)'));
 assert(source.includes('raceCommittedOwnRows:2'));assert(source.includes('coreRollbackRestored:true'));assert(source.includes('rollbackRestored:false'));
 assert(source.includes('report(inventory)'));assert(source.indexOf('report(inventory)')<source.indexOf('const failures='));
 assert.deepEqual(dayReviewNativeLimits,{groups:8,steps:220,fixtureMs:180000,statementMs:10000,lockMs:3000,rpcs:180,raceSteps:12,maxConnections:3,newClusters:0,newDatabases:0,browser:0,externalAuth:0,kdfCalls:0});
});
