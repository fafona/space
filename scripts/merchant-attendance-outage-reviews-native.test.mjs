//Inert/static driver checks. These do not run or substitute for SQL acceptance.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const source=readFileSync(new URL('./merchant-attendance-outage-reviews-native.mjs',import.meta.url),'utf8');
test('214 reuses the complete212 rollback context and exactly178',()=>{
 for(const token of ['return runAttendanceOutageLinksNative(args,async ctx=>','outageLinksFoundation.rollbackRestored,true',
  "outageReviewsNativeMigration='202610070178_merchant_attendance_outage_reviews.sql'",'assertLifecycleSandbox(sql=>native.query(scope.sql(sql)))',
  'assert.deepEqual(owned,d.owned)'])assert(source.includes(token),token);
 for(const forbidden of ['initdb','CREATE DATABASE','pg_dump','spawn(','chromium','playwright','npm run build','supabase.co'])assert(!source.includes(forbidden),forbidden);
});
test('install, reentry and scenarios preserve old facts, functions and both actual archives',()=>{
 for(const token of ['pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef','p.oid=any(',
  'outage_reviews_install_changed_old_facts','outage_reviews_install_changed_old_functions','outage_reviews_reapply_changed_facts',
  'outage_reviews_fixture_did_not_rollback','assert.equal(d.definitions(),definitions)','assert.equal(d.tableCatalog(),catalog)',
  'archive().artifactText,oldArchive.artifactText','archive().artifactSha256,oldArchive.artifactSha256',
  'periodArchive().artifactText,sealedArchive.artifactText','periodArchive().artifactSha256,sealedArchive.artifactSha256'])assert(source.includes(token),token);
 assert(source.indexOf('const result={phase:214')>source.indexOf('outage_reviews_fixture_did_not_rollback'));
 assert(!source.includes('set sealed='));assert(!source.includes('reopen'));
});
test('215 can opt in only after all214 rollback checks, without changing default214',()=>{
 assert(source.includes('runAttendanceOutageReviewsNative(args,after=null)'));
 assert(source.includes("assert(after===null||typeof after==='function','outage_reviews_owned_extension_invalid')"));
 const hook=source.indexOf('if(after!==null)return {...result,extension:await after({...ctx,outageReviewsFoundation:result})}');
 assert(hook>source.indexOf('outage_reviews_fixture_did_not_rollback'));assert(source.slice(hook).includes('return result;'));
});
test('import remains inert and failures propagate without claiming UI or period integration',()=>{
 assert(source.includes('path.resolve(process.argv[1])===fileURLToPath(import.meta.url)'));
 assert(source.includes('process.exitCode=1'));assert(!source.includes('process.exit(0)'));
 assert(source.includes('periodOutageGateImplemented:false,productionUiImplemented:false'));
});
