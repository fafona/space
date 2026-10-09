//Static runner checks only; these are not evidence of PostgreSQL acceptance.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const source=readFileSync(new URL('./merchant-attendance-outage-native.mjs',import.meta.url),'utf8');
test('211 uses the existing175 owned context and discloses204/207 prerequisite replay',()=>{
 assert(source.includes('runPlanPosthocReviewNative(args,async ctx=>'));
 assert(source.includes("prerequisites:'existing204-and207-through175'"));
 assert(source.includes('assertLifecycleSandbox(sql=>native.query(scope.sql(sql)))'));
 assert(source.includes('assert.deepEqual(owned,d.owned)'));
 for(const forbidden of ['initdb','CREATE DATABASE','pg_dump','spawn(','chromium','playwright','npm run build','supabase.co'])assert(!source.includes(forbidden),forbidden);
});
test('176 is one explicit migration; installation preserves old function bodies and ACLs',()=>{
 assert(source.includes("outageNativeMigration='202610070176_merchant_attendance_outage_foundation.sql'"));
 assert(source.includes('pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef'));
 assert(source.includes('p.oid=any('));assert(source.includes('outage_install_changed_old_functions'));
 assert(source.includes('outage_install_changed_old_facts'));assert(source.includes('outage_reapply_changed_rows'));
 assert(source.includes('assert.equal(d.definitions(),definitions)'));assert(source.includes('assert.equal(d.tableCatalog(),catalog)'));
});
test('all fixture writes must roll back before the211 result is reported',()=>{
 const call=source.indexOf('await verifyAttendanceOutageNative(ctx)'),proof=source.indexOf('outage_fixture_did_not_rollback'),result=source.indexOf('return {phase:211');
 assert(call>=0&&proof>call&&result>proof);
 for(const proof of ['d.fingerprint(oldNames),oldFacts','oldFunctionHash(),originalFunctions','archive().artifactText,oldArchive.artifactText','archive().artifactSha256,oldArchive.artifactSha256'])assert(source.includes(proof),proof);
 assert(source.includes('completeRecoveryWorkflow:false'));assert(source.includes('browser:false,productionAccess:false,newCluster:false,deployed:false'));
});
test('import remains inert and direct CLI failure is propagated as nonzero',()=>{
 assert(source.includes("if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))"));
 assert(source.includes('process.exitCode=1'));assert(!source.includes('process.exit(0)'));
});
test('declarations are exercised after a real decision and seal, not a forged sealed state',()=>{
 assert(source.includes('onFullLeavePrepared:async full=>'));
 assert(source.includes("full.make(full.read(),'not_applicable')"));
 assert(source.includes("full.review(full.rq('decide','owner',decision.operationId),decision)"));
 const seal=source.indexOf('await full.seal()'),fixture=source.indexOf('await checkOutageAtSealedPeriod(full)');
 assert(seal>=0&&fixture>seal);assert(source.includes('assert(sealed.period.sealed)'));
 assert(source.includes('return {operationId:decision.operationId}'));assert(!source.includes('set sealed='));
});
test('later owned foundations opt in only after the sealed211 rollback proof',()=>{
 assert(source.includes('runAttendanceOutageNative(args,after=null)'));
 assert(source.includes("assert(after===null||typeof after==='function','outage_owned_extension_invalid')"));
 const checked=source.indexOf('result=await checkOutageAtSealedPeriod(full)'),extension=source.indexOf('extension:await after({...full,outageFoundation:result})');
 assert(checked>=0&&extension>checked);assert(source.includes('if(after!==null)'));
 assert(source.includes('return {operationId:decision.operationId}'));
});
