//231 explicit local acceptance. Reuse the existing215 owned synthetic schema;
//never create another cluster, touch a real account, or publish a migration.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {runAttendanceOutagePeriodsNative} from './merchant-attendance-outage-periods-native.mjs';
import {assertLifecycleSandbox} from './merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {verifyPeriodContinuationNative} from './fixtures/attendance-period-continuation-native.mjs';
import {verifyPeriodContinuationCapacityNative} from './fixtures/attendance-period-continuation-capacity-native.mjs';
import {verifyPeriodContinuationCountsNative} from './fixtures/attendance-period-continuation-counts-native.mjs';

export const continuationMigration='202610080183_merchant_attendance_period_continuation.sql';
export const continuationChangedFunctions=Object.freeze([
 'faolla_attendance_period_closure_v1(jsonb,uuid,jsonb,jsonb,boolean)',
 'faolla_attendance_period_assert_open_v1(text,uuid,jsonb)',
 'faolla_attendance_retention_source_v1(text,text,uuid)',
]);
export function continuationNativeArgs(args){
 assert(Array.isArray(args)&&args.length===3&&args[0]==='--run-local'&&args[1]==='--directory'
  &&typeof args[2]==='string'&&path.isAbsolute(args[2])&&args[2].trim()===args[2]&&!/[\u0000-\u001f\u007f]/.test(args[2]),'continuation_explicit_local_args_required');
 return [...args];
}
function archiveBytes(value){
 assert.equal(typeof value.artifactText,'string');assert.equal(Buffer.byteLength(value.artifactText,'utf8'),value.artifactBytes);
 assert.equal(createHash('sha256').update(value.artifactText,'utf8').digest('hex'),value.artifactSha256);
 return {artifactText:value.artifactText,artifactBytes:value.artifactBytes,artifactSha256:value.artifactSha256};
}
export function continuationCapacityMode(after,acceptanceOptions={}){
 assert(acceptanceOptions&&typeof acceptanceOptions==='object'&&!Array.isArray(acceptanceOptions)
  &&Object.keys(acceptanceOptions).every(k=>k==='capacity'),'continuation_invalid_acceptance_options');
 const mode=acceptanceOptions.capacity??'full';assert(mode==='full'||mode==='reuse_previous','continuation_invalid_capacity_mode');
 assert(mode==='full'||typeof after==='function','continuation_capacity_reuse_requires_new_local_extension');return mode;
}
export async function runPeriodContinuationNative(args,after=null,acceptanceOptions={}){
 assert(after===null||typeof after==='function','continuation_invalid_local_extension');
 const capacityMode=continuationCapacityMode(after,acceptanceOptions);
 const options=continuationNativeArgs(args);
 return runAttendanceOutagePeriodsNative(options,async ctx=>{
  const {d,h,native,scope,archive,oldArchive,periodArchive}=ctx;
  assert.equal(d.syntheticOnly,true);assert.equal(h.syntheticOnly,true);assert.equal(ctx.outagePeriodsFoundation.phase,215);
  assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
  const old155=archiveBytes(archive()),old207=archiveBytes(periodArchive());assert.deepEqual(old155,archiveBytes(oldArchive));
  //182 is an additive prerequisite, not a request to rerun its unrelated UI or
  //metadata race matrix. Every original row/function stays protected here.
  const beforeNames=d.inventory().filter(n=>n!=='faolla_schema_migrations'),beforeFacts=d.fingerprint(beforeNames);
  const originalOids=d.exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f';`);
  const originalFunctions=()=>d.exec(`select md5(jsonb_agg(jsonb_build_array(oid,pg_get_functiondef(oid),proowner,proacl,proconfig,prosecdef) order by oid)::text)
   from pg_proc where pronamespace=${d.owned.oid} and oid=any(${quote(originalOids)}::oid[]) and prokind='f';`);
  const originalDefs=originalFunctions();
  d.exec(boundClockMigrationBody(native.root,'202610070182_merchant_attendance_retention.sql'));
  assert.equal(d.fingerprint(beforeNames),beforeFacts);assert.equal(originalFunctions(),originalDefs,'continuation_prerequisite_changed_existing_functions');
  const oldNames=d.inventory().filter(n=>n!=='faolla_schema_migrations'),facts=d.fingerprint(oldNames);
  const signatures=continuationChangedFunctions.map(s=>`'public.${s}'::regprocedure::oid`).join(',');
  const oids=d.exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f' and oid<>all(array[${signatures}]);`);
  const functions=()=>d.exec(`select md5(jsonb_agg(jsonb_build_array(oid,pg_get_functiondef(oid),proowner,proacl,proconfig,prosecdef) order by oid)::text)
   from pg_proc where pronamespace=${d.owned.oid} and oid=any(${quote(oids)}::oid[]) and prokind='f';`);
  const defs=functions();
  const oldIndexes=JSON.parse(d.exec(`select coalesce(jsonb_object_agg(c.oid::text,jsonb_build_array(c.relname,pg_get_indexdef(c.oid),i.indisvalid,i.indisready,i.indislive)),'{}'::jsonb)
   from pg_class c join pg_index i on i.indexrelid=c.oid where c.relnamespace=${d.owned.oid};`));
  const install=()=>{
   d.exec(boundClockMigrationBody(native.root,continuationMigration));
   assert.equal(d.exec(`select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relname='attendance_period_continuation_check_probe' and (n.oid=${d.owned.oid} or n.nspname like 'pg_temp_%');`),'0','continuation_probe_relation_retained');
  };
  install();assert.equal(d.fingerprint(oldNames),facts,'continuation_install_changed_existing_rows');assert.equal(functions(),defs,'continuation_install_changed_unapproved_functions');
  const installed=d.fingerprint(),installedDefs=d.definitions(),installedCatalog=d.tableCatalog();
  const indexes=JSON.parse(d.exec(`select coalesce(jsonb_object_agg(c.oid::text,jsonb_build_array(c.relname,pg_get_indexdef(c.oid),i.indisvalid,i.indisready,i.indislive)),'{}'::jsonb)
   from pg_class c join pg_index i on i.indexrelid=c.oid where c.relnamespace=${d.owned.oid};`));
  for(const [oid,value]of Object.entries(oldIndexes))assert.deepEqual(indexes[oid],value,'continuation_existing_index_changed');
  assert.deepEqual(d.inventory().filter(n=>!oldNames.includes(n)&&n!=='faolla_schema_migrations').sort(),
   ['merchant_attendance_period_artifact_metadata','merchant_attendance_period_storage']);
  install();assert.equal(d.fingerprint(),installed);assert.equal(d.definitions(),installedDefs);assert.equal(d.tableCatalog(),installedCatalog);assert.equal(functions(),defs);
  assert.deepEqual(archiveBytes(archive()),old155);assert.deepEqual(archiveBytes(periodArchive()),old207);
  native.pass('231183 installation and reentry preserve existing rows, immutable archives and all but three approved function definitions');
  let acceptance,capacity,counts;
  try {
   acceptance=await verifyPeriodContinuationNative(ctx);
   if(capacityMode==='full'){
    capacity=await verifyPeriodContinuationCapacityNative(ctx);
    counts=await verifyPeriodContinuationCountsNative(ctx);
   }else{
    //These rollback-only capacity probes produce no prerequisite facts. New
    //feature acceptance may reuse the recorded231/242 result without repeating
    //the1001 synthetic-prefix workload. No CLI switch or production guard skips.
    capacity={skipped:true,reason:'unchanged231_capacity_previously_verified'};
    counts={skipped:true,reason:'unchanged231_counts_previously_verified'};
   }
  }
  finally {
   assert.equal(d.fingerprint(),installed,'continuation_probe_did_not_rollback');assert.equal(d.definitions(),installedDefs);
   assert.equal(d.tableCatalog(),installedCatalog);assert.equal(functions(),defs);
   assert.deepEqual(archiveBytes(archive()),old155);assert.deepEqual(archiveBytes(periodArchive()),old207);
  }
  assert.equal(acceptance.rollbackRestored,true);
  if(capacityMode==='full'){assert.equal(capacity.rollbackRestored,true);assert.equal(counts.rollbackRestored,true);}
  else native.pass('231 unchanged quota/counts matrices explicitly reused, not rerun; current core/install/archive guards still passed');
  native.pass('231 v2 period continuation, bounded history/version pages, original recovery and unchanged archive budget; rollback restored');
  //Optional acceptance runs only AFTER all rollback-only probes and their full
  //baseline guards. Its exact new-row footprint has separate checks; the parent
  //still owns schema cleanup and the unchanged public-database baseline.
  const extension=after?await after(ctx):undefined;
  return {phase:231,acceptance,capacity,counts,approvedChangedFunctions:continuationChangedFunctions,oldRowsUnchanged:true,oldArchivesUnchanged:true,
   oldOtherFunctionsUnchanged:true,installationReentryVerified:true,coreRollbackRestored:true,rollbackRestored:after===null,
   newCluster:false,productionAccess:false,browser:false,deployed:false,...(after?{extension}:{} )};
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runPeriodContinuationNative(process.argv.slice(2))
 .then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(JSON.stringify({error:'period_continuation_native_failed',detail:error?.stack??String(error)}));process.exitCode=1;});
