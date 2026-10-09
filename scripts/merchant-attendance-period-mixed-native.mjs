//228 test-only mixed-source period extension. Importing this module is inert.
//Usage: node --import tsx scripts/merchant-attendance-period-mixed-native.mjs --run-local --directory <existing-stopped-directory>
//The existing215 parent owns startup, synthetic schema cleanup, baseline and
//shutdown; this wrapper neither installs migrations nor creates an environment.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceOutagePeriodsNative} from './merchant-attendance-outage-periods-native.mjs';
import {assertLifecycleSandbox} from './merchant-attendance-lifecycle-native-support.mjs';
import {verifyAttendancePeriodMixedNative} from './fixtures/attendance-period-mixed-native.mjs';

function checkedArgs(args){
 assert(Array.isArray(args)&&args.length===3&&args.every(value=>typeof value==='string'),'period_mixed_explicit_native_args_required');
 const directory=args.indexOf('--directory'),run=args.indexOf('--run-local');
 assert((directory===0&&run===2||directory===1&&run===0)&&path.isAbsolute(args[directory+1])
  &&args[directory+1].trim()===args[directory+1]&&!/[\u0000-\u001f\u007f]/.test(args[directory+1]),'period_mixed_explicit_native_args_required');
 return ['--run-local','--directory',args[directory+1]];
}
function archiveSnapshot(value){
 assert(value&&typeof value.artifactText==='string'&&value.artifactText.length>0,'period_mixed_archive_required');
 const bytes=Buffer.byteLength(value.artifactText,'utf8'),sha=createHash('sha256').update(value.artifactText,'utf8').digest('hex');
 assert.equal(value.artifactBytes,bytes,'period_mixed_archive_bytes_invalid');
 assert.equal(value.artifactSha256,sha,'period_mixed_archive_sha_invalid');
 return {artifactText:value.artifactText,artifactBytes:bytes,artifactSha256:sha};
}
export async function runAttendancePeriodMixedNative(args){
 return runAttendanceOutagePeriodsNative(checkedArgs(args),async ctx=>{
  const {d,native,scope,archive,oldArchive,period,pq,periodId,periodArchive,outagePeriodsFoundation}=ctx;
  assert.equal(outagePeriodsFoundation.phase,215,'period_mixed_requires215');
  assert.equal(outagePeriodsFoundation.rollbackRestored,true,'period_mixed_requires215_rollback');
  assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
  const facts=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();
  const original=archiveSnapshot(archive()),sealedArchive=archiveSnapshot(periodArchive());
  assert.deepEqual(original,archiveSnapshot(oldArchive),'period_mixed_original_archive_mismatch');
  const before=await period(pq('detail','owner',periodId));
  assert.equal(before.period.sealed,true,'period_mixed_requires_real_seal');
  assert.equal(before.sourceChanged,false,'period_mixed_requires_unchanged_source');
  assert.equal(d.fingerprint(),facts,'period_mixed_guard_read_wrote');
  let mixed;
  try{
   //The fixture may use the approved single bounded connection/step flow;
   //only its complete rollback boundary is required here, not querySteps.
   mixed=await verifyAttendancePeriodMixedNative(ctx);
  }finally{
   //Also enforce rollback on fixture failure; the original parent still owns
   //cleanup and stop in its finally. No rollback/delete is attempted here.
   assert.equal(d.fingerprint(),facts,'period_mixed_fixture_did_not_rollback');
   assert.equal(d.definitions(),definitions,'period_mixed_definitions_changed');
   assert.equal(d.tableCatalog(),catalog,'period_mixed_catalog_changed');
   assert.deepEqual(archiveSnapshot(archive()),original,'period_mixed_old_archive_changed');
   assert.deepEqual(archiveSnapshot(periodArchive()),sealedArchive,'period_mixed_sealed_archive_changed');
   const current=await period(pq('detail','owner',periodId));
   assert.deepEqual(current.period,before.period,'period_mixed_old_period_changed');
   assert.equal(current.period.sealed,true,'period_mixed_seal_changed');
   assert.equal(current.sourceChanged,false,'period_mixed_old_source_changed');
   assert.equal(d.fingerprint(),facts,'period_mixed_final_read_wrote');
  }
  native.pass('228 mixed-source period checks rolled back; full facts, definitions, catalog, actual seal and both archives unchanged');
  return {phase:228,prerequisites:215,mixed,rollbackRestored:true,oldFactsUnchanged:true,oldDefinitionsUnchanged:true,
   oldCatalogUnchanged:true,old155ArchivePreserved:true,actualSealedArchivePreserved:true,
   lifecycle:'existing215 parent exclusively owns baseline restoration, synthetic schema cleanup and shutdown',
   browser:false,newCluster:false,productionAccess:false,deployed:false};
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runAttendancePeriodMixedNative(process.argv.slice(2))
 .then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(JSON.stringify({error:'period_mixed_native_failed',detail:error?.stack??String(error)}));process.exitCode=1;});
