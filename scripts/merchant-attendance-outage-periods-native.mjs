//215 bounded caller-owned period extension after all214 rollback checks.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceOutageReviewsNative} from './merchant-attendance-outage-reviews-native.mjs';
import {assertLifecycleSandbox,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {verifyAttendanceOutagePeriodsNative} from './fixtures/attendance-outage-periods-native.mjs';
export const outagePeriodsNativeMigration='202610070179_merchant_attendance_outage_periods.sql';
export const outagePeriodsChangedFunctions=Object.freeze([
 'faolla_attendance_period_closure_source_base_v1(jsonb,uuid)',
 'faolla_attendance_period_closure_source_v1(jsonb,uuid)',
 'faolla_attendance_period_closure_v1(jsonb,uuid,jsonb,jsonb,boolean)']);
export async function runAttendanceOutagePeriodsNative(args,after=null){
 assert(after===null||typeof after==='function','outage_periods_owned_extension_invalid');
 return runAttendanceOutageReviewsNative(args,async ctx=>{
  const {d,native,scope,archive,oldArchive,period,pq,periodId,periodArchive,outageReviewsFoundation}=ctx;
  assert.equal(outageReviewsFoundation.phase,214);assert.equal(outageReviewsFoundation.rollbackRestored,true);
  const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));assert.deepEqual(owned,d.owned);
  assert((await period(pq('detail','owner',periodId))).period.sealed);
  const names=d.inventory().filter(n=>n!=='faolla_schema_migrations'),facts=d.fingerprint(names),sealedArchive=periodArchive();
  const sourceQuery=access=>{const q=pq('preview',access,periodId);return Object.fromEntries(['siteId','access','workerId','fromDate','throughDate','periodId'].map(k=>[k,q[k]]));};
  const readSource=access=>JSON.parse(d.exec(`select public.faolla_attendance_period_closure_source_v1(${json(sourceQuery(access))},${quote(access==='owner'?d.owner:ctx.h.employeeAuthUserId)})::text;`));
  const legacySources={owner:readSource('owner'),self:readSource('self')};assert.equal(d.fingerprint(names),facts);
  const replacements=outagePeriodsChangedFunctions.map(sig=>`'public.${sig}'::regprocedure::oid`).join(',');
  const oids=d.exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${owned.oid} and prokind='f' and oid<>all(array[${replacements}]);`);
  const oldFunctions=()=>d.exec(`select md5(jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef) order by p.oid)::text)
   from pg_proc p where p.pronamespace=${owned.oid} and p.oid=any(${quote(oids)}::oid[]) and p.prokind='f';`);
  const oldHash=oldFunctions();
  const install=()=>d.exec(boundClockMigrationBody(native.root,outagePeriodsNativeMigration).replace(/(set search_path\s*=\s*)public\b/g,`$1${owned.schema}`));
  install();assert.equal(d.fingerprint(names),facts,'outage_period_install_changed_facts');assert.equal(oldFunctions(),oldHash,'outage_period_changed_unapproved_function');
  const installed=d.fingerprint(),defs=d.definitions(),catalog=d.tableCatalog();install();
  assert.equal(d.fingerprint(),installed);assert.equal(d.definitions(),defs);assert.equal(d.tableCatalog(),catalog);assert.equal(oldFunctions(),oldHash);
  for(const access of ['owner','self']){
   const current=readSource(access),previous=legacySources[access];
   assert.equal(current.sourceText,previous.sourceText,'outage_period_no_declaration_canonical_unchanged');assert.equal(current.sourceFingerprint,previous.sourceFingerprint);
   assert.equal(current.sourceVersion,previous.sourceVersion);assert.deepEqual(current.blockers,previous.blockers);
  }
  const periods=await verifyAttendanceOutagePeriodsNative({...ctx,legacySources});
  assert.equal(d.fingerprint(),installed,'outage_period_fixture_did_not_rollback');assert.equal(d.fingerprint(names),facts);
  assert.equal(d.definitions(),defs);assert.equal(d.tableCatalog(),catalog);assert.equal(oldFunctions(),oldHash);
  assert.equal(archive().artifactText,oldArchive.artifactText);assert.equal(archive().artifactSha256,oldArchive.artifactSha256);
  assert.equal(periodArchive().artifactText,sealedArchive.artifactText);assert.equal(periodArchive().artifactSha256,sealedArchive.artifactSha256);
  const unchanged=await period(pq('detail','owner',periodId));assert(unchanged.period.sealed);assert.equal(unchanged.sourceChanged,false);
  native.pass('215179 same-context period outage gates, unchanged no-declaration sources and archived bytes, exact rollback');
  const result={phase:215,prerequisites:'existing214-with204-207-211-212-through178',periods,
   approvedChangedFunctions:[...outagePeriodsChangedFunctions],oldOtherFunctionsUnchanged:true,oldFactsUnchanged:true,
   noDeclarationCanonicalUnchanged:true,old155ArchiveBytes:oldArchive.artifactBytes,old155ArchivePreserved:true,
   actualSealedArchivePreserved:true,rollbackRestored:true,browser:false,productionAccess:false,newCluster:false,deployed:false};
  if(after!==null)return {...result,extension:await after({...ctx,outagePeriodsFoundation:result})};
  return result;
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runAttendanceOutagePeriodsNative(process.argv.slice(2))
 .then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(JSON.stringify({error:'outage_periods_native_failed',detail:error?.stack??String(error)}));process.exitCode=1;});
