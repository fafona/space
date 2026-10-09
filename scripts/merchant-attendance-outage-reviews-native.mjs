//214 test-only foundation extension. Reuses the caller's single existing
//synthetic database after every212 scenario and rollback check has completed.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceOutageLinksNative} from './merchant-attendance-outage-links-native.mjs';
import {assertLifecycleSandbox} from './merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {verifyAttendanceOutageReviewsNative} from './fixtures/attendance-outage-reviews-native.mjs';

export const outageReviewsNativeMigration='202610070178_merchant_attendance_outage_reviews.sql';
export async function runAttendanceOutageReviewsNative(args,after=null){
 assert(after===null||typeof after==='function','outage_reviews_owned_extension_invalid');
 return runAttendanceOutageLinksNative(args,async ctx=>{
  const {d,native,scope,archive,oldArchive,period,pq,periodId,periodArchive,outageLinksFoundation}=ctx;
  assert.equal(outageLinksFoundation.phase,212);assert.equal(outageLinksFoundation.rollbackRestored,true);
  const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));assert.deepEqual(owned,d.owned);
  assert((await period(pq('detail','owner',periodId))).period.sealed,'outage_reviews_requires_real_seal');
  const sealedArchive=periodArchive(),names=d.inventory().filter(name=>name!=='faolla_schema_migrations'),facts=d.fingerprint(names);
  const oids=d.exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${owned.oid} and prokind='f';`);
  const oldFunctionHash=()=>d.exec(`select md5(jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef) order by p.oid)::text)
   from pg_proc p where p.pronamespace=${owned.oid} and p.oid=any(${quote(oids)}::oid[]) and p.prokind='f';`);
  const functions=oldFunctionHash();
  const install=()=>d.exec(boundClockMigrationBody(native.root,outageReviewsNativeMigration).replace(/(set search_path\s*=\s*)public\b/g,`$1${owned.schema}`));
  install();assert.equal(d.fingerprint(names),facts,'outage_reviews_install_changed_old_facts');assert.equal(oldFunctionHash(),functions,'outage_reviews_install_changed_old_functions');
  const installed=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();install();
  assert.equal(d.fingerprint(),installed,'outage_reviews_reapply_changed_facts');assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  assert.equal(oldFunctionHash(),functions);assert.equal(archive().artifactText,oldArchive.artifactText);assert.equal(archive().artifactSha256,oldArchive.artifactSha256);
  const reviews=await verifyAttendanceOutageReviewsNative(ctx);
  assert.equal(d.fingerprint(),installed,'outage_reviews_fixture_did_not_rollback');assert.equal(d.fingerprint(names),facts);
  assert.equal(oldFunctionHash(),functions);assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  assert.equal(archive().artifactText,oldArchive.artifactText);assert.equal(archive().artifactSha256,oldArchive.artifactSha256);
  assert.equal(periodArchive().artifactText,sealedArchive.artifactText);assert.equal(periodArchive().artifactSha256,sealedArchive.artifactSha256);
  assert((await period(pq('detail','owner',periodId))).period.sealed);
  native.pass('214178 additive installation/reentry and rollback-only review preserve old functions, facts, actual seal and155 archive');
  const result={phase:214,prerequisites:'existing212-with204-207-211-through177',reviews,
   oldFactsUnchanged:true,oldFunctionsUnchanged:true,old155ArchiveBytes:oldArchive.artifactBytes,old155ArchivePreserved:true,
   actualSealedArchivePreserved:true,rollbackRestored:true,browser:false,productionAccess:false,newCluster:false,deployed:false,
   periodOutageGateImplemented:false,productionUiImplemented:false};
  if(after!==null)return {...result,extension:await after({...ctx,outageReviewsFoundation:result})};
  return result;
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runAttendanceOutageReviewsNative(process.argv.slice(2))
 .then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(JSON.stringify({error:'outage_reviews_native_failed',detail:error?.stack??String(error)}));process.exitCode=1;});
