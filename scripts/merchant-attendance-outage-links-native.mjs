//212 test-only extension: the SAME211 owned context and actual sealed window.
//No production route, browser, new cluster or reconstructed clock event.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceOutageNative} from './merchant-attendance-outage-native.mjs';
import {assertLifecycleSandbox} from './merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {verifyAttendanceOutageLinksNative} from './fixtures/attendance-outage-links-native.mjs';

export const outageLinksNativeMigration='202610070177_merchant_attendance_outage_links.sql';
export async function runAttendanceOutageLinksNative(args,after=null){
 assert(after===null||typeof after==='function','outage_links_owned_extension_invalid');
 return runAttendanceOutageNative(args,async ctx=>{
  const {d,native,scope,archive,oldArchive,period,pq,periodId,periodArchive,outageFoundation}=ctx;
  assert.equal(outageFoundation.phase,211);assert.equal(outageFoundation.rollbackRestored,true);
  const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));assert.deepEqual(owned,d.owned);
  assert((await period(pq('detail','owner',periodId))).period.sealed,'outage_links_requires_real_seal');
  const sealedArchive=periodArchive(),names=d.inventory().filter(name=>name!=='faolla_schema_migrations'),facts=d.fingerprint(names);
  const oids=d.exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${owned.oid} and prokind='f';`);
  const oldFunctionHash=()=>d.exec(`select md5(jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef) order by p.oid)::text)
   from pg_proc p where p.pronamespace=${owned.oid} and p.oid=any(${quote(oids)}::oid[]) and p.prokind='f';`);
  const functions=oldFunctionHash();
  const install=()=>d.exec(boundClockMigrationBody(native.root,outageLinksNativeMigration).replace(/(set search_path\s*=\s*)public\b/g,`$1${owned.schema}`));
  install();assert.equal(d.fingerprint(names),facts,'outage_links_install_changed_old_facts');assert.equal(oldFunctionHash(),functions,'outage_links_install_changed_old_functions');
  const installed=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();install();
  assert.equal(d.fingerprint(),installed,'outage_links_reapply_changed_facts');assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  assert.equal(oldFunctionHash(),functions);assert.equal(archive().artifactText,oldArchive.artifactText);assert.equal(archive().artifactSha256,oldArchive.artifactSha256);
  const links=await verifyAttendanceOutageLinksNative(ctx);
  assert.equal(d.fingerprint(),installed,'outage_links_fixture_did_not_rollback');assert.equal(d.fingerprint(names),facts);
  assert.equal(oldFunctionHash(),functions);assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  assert.equal(archive().artifactText,oldArchive.artifactText);assert.equal(archive().artifactSha256,oldArchive.artifactSha256);
  assert.equal(periodArchive().artifactText,sealedArchive.artifactText);assert.equal(periodArchive().artifactSha256,sealedArchive.artifactSha256);
  assert((await period(pq('detail','owner',periodId))).period.sealed);
  native.pass('212177 additive installation/reentry and rollback-only outage links preserve old functions, facts, actual seal and155 archive');
  const result={phase:212,prerequisites:'existing211-with204-and207-through176',links,
   oldFactsUnchanged:true,oldFunctionsUnchanged:true,old155ArchiveBytes:oldArchive.artifactBytes,old155ArchivePreserved:true,
   actualSealedArchivePreserved:true,rollbackRestored:true,browser:false,productionAccess:false,newCluster:false,deployed:false,
   sourceResolutionImplemented:false,periodOutageGateImplemented:false};
  //Opt-in foundations receive this SAME context only after all212 scenarios
  //have rolled back. They own their additive install and rollback assertions.
  if(after!==null)return {...result,extension:await after({...ctx,outageLinksFoundation:result})};
  return result;
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runAttendanceOutageLinksNative(process.argv.slice(2))
 .then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(JSON.stringify({error:'outage_links_native_failed',detail:error?.stack??String(error)}));process.exitCode=1;});
