//211 local-only foundation acceptance. The existing204/207 prerequisites are
//deliberately replayed to supply a real155 archive and installed175 readers.
//No production configuration, second cluster, dependency copy or browser.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runPlanPosthocReviewNative} from './merchant-attendance-plan-posthoc-review-native.mjs';
import {assertLifecycleSandbox} from './merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {verifyAttendanceOutageNative} from './fixtures/attendance-outage-native.mjs';

export const outageNativeMigration='202610070176_merchant_attendance_outage_foundation.sql';
async function checkOutageAtSealedPeriod(ctx){
  const {d,native,scope,all,archive,oldArchive}=ctx;
  const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));assert.deepEqual(owned,d.owned);
  const oldNames=d.inventory().filter(name=>name!=='faolla_schema_migrations'),oldFacts=d.fingerprint(oldNames);
  const oldOids=d.exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${owned.oid} and prokind='f';`);
  const oldFunctionHash=()=>d.exec(`select md5(jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef) order by p.oid)::text)
   from pg_proc p where p.pronamespace=${owned.oid} and p.oid=any(${quote(oldOids)}::oid[]) and p.prokind='f';`);
  const originalFunctions=oldFunctionHash();
  const install=()=>{
   const source=readFileSync(path.join(native.root,'scripts/supabase-migrations',outageNativeMigration),'utf8');
   if(/create index concurrently/i.test(source))return native.query(scope.sql(source));
   return d.exec(boundClockMigrationBody(native.root,outageNativeMigration).replace(/(set search_path\s*=\s*)public\b/g,`$1${owned.schema}`));
  };
  install();assert.equal(d.fingerprint(oldNames),oldFacts,'outage_install_changed_old_facts');
  assert.equal(oldFunctionHash(),originalFunctions,'outage_install_changed_old_functions');
  const installed=all(),definitions=d.definitions(),catalog=d.tableCatalog();install();
  assert.equal(all(),installed,'outage_reapply_changed_rows');assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  assert.equal(oldFunctionHash(),originalFunctions);assert.equal(archive().artifactText,oldArchive.artifactText);assert.equal(archive().artifactSha256,oldArchive.artifactSha256);
  native.pass('211176 additive installation/reentry keeps old function ACLs, old facts and155 archive');
  const outage=await verifyAttendanceOutageNative(ctx);
  assert.equal(all(),installed,'outage_fixture_did_not_rollback');assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  assert.equal(d.fingerprint(oldNames),oldFacts);assert.equal(oldFunctionHash(),originalFunctions);
  assert.equal(archive().artifactText,oldArchive.artifactText);assert.equal(archive().artifactSha256,oldArchive.artifactSha256);
  return {phase:211,prerequisites:'existing204-and207-through175',outage,old155ArchiveBytes:oldArchive.artifactBytes,
   old155ArchivePreserved:true,oldFactsUnchanged:true,oldFunctionsUnchanged:true,rollbackRestored:true,
   browser:false,productionAccess:false,newCluster:false,deployed:false,completeRecoveryWorkflow:false};
}
export async function runAttendanceOutageNative(args,after=null){
 assert(after===null||typeof after==='function','outage_owned_extension_invalid');
 let result=null;
 return runPlanPosthocReviewNative(args,async ctx=>{
  assert(result,'outage_sealed_fixture_required');
  assert.equal(ctx.archive().artifactText,ctx.oldArchive.artifactText);
  assert.equal(ctx.archive().artifactSha256,ctx.oldArchive.artifactSha256);
  return result;
 },{onFullLeavePrepared:async full=>{
  //Do exactly the existing default preparation: a real174 decision followed by
  //real149 send/confirm/seal. Do not fabricate a sealed summary or table state.
  const decision=full.make(full.read(),'not_applicable');
  full.review(full.rq('decide','owner',decision.operationId),decision);
  const sealed=await full.seal();assert(sealed.period.sealed);
  result=await checkOutageAtSealedPeriod(full);
  //An opt-in later foundation may reuse this SAME owned, actually sealed
  //context.211 is completely checked/rolled back before the extension starts.
  //The extension owns its own baseline/rollback and must leave this seal intact.
  if(after!==null)result={...result,extension:await after({...full,outageFoundation:result})};
  return {operationId:decision.operationId};
 }});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runAttendanceOutageNative(process.argv.slice(2))
 .then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(JSON.stringify({error:'outage_native_failed',detail:error?.stack??String(error)}));process.exitCode=1;});
