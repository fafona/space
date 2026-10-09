//234 test-only acceptance. The existing parent exclusively owns the one
//explicit stopped synthetic cluster, baseline, schema disposal and shutdown.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runPeriodDelegatedClosureNative} from './merchant-attendance-period-delegated-closure-native.mjs';
import {assertLifecycleSandbox} from './merchant-attendance-lifecycle-native-support.mjs';
import {verifyPeriodDelegatedMixedNative} from './fixtures/attendance-period-delegated-mixed-native.mjs';
import {verifyPeriodDelegatedClosureRacesNative} from './fixtures/attendance-period-delegated-closure-races-native.mjs';

function checkedArgs(args){
 assert(Array.isArray(args)&&args.length===3&&args.every(v=>typeof v==='string'),'delegated_acceptance_explicit_args_required');
 const directory=args.indexOf('--directory'),run=args.indexOf('--run-local');
 assert((directory===0&&run===2||directory===1&&run===0)&&path.isAbsolute(args[directory+1])
  &&args[directory+1].trim()===args[directory+1]&&!/[\u0000-\u001f\u007f]/.test(args[directory+1]),'delegated_acceptance_explicit_args_required');
 return ['--run-local','--directory',args[directory+1]];
}
function archiveSnapshot(value){
 assert(value&&typeof value.artifactText==='string'&&value.artifactText.length>0,'delegated_acceptance_archive_required');
 assert.equal(value.artifactBytes,Buffer.byteLength(value.artifactText,'utf8'));
 assert.equal(value.artifactSha256,createHash('sha256').update(value.artifactText,'utf8').digest('hex'));
 return {artifactText:value.artifactText,artifactBytes:value.artifactBytes,artifactSha256:value.artifactSha256};
}
export async function runPeriodDelegatedAcceptanceNative(args){
 return runPeriodDelegatedClosureNative(checkedArgs(args),async ctx=>{
  const {d,h,native,scope,archive,oldArchive,periodArchive}=ctx;
  assert.equal(d.syntheticOnly,true);assert.equal(h.syntheticOnly,true);
  assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
  const facts=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();
  const original=archiveSnapshot(archive()),sealed=archiveSnapshot(periodArchive());
  assert.deepEqual(original,archiveSnapshot(oldArchive));
  let mixed,races;
  try{
   try{mixed=await verifyPeriodDelegatedMixedNative(ctx);}
   finally{assert.equal(d.fingerprint(),facts,'delegated_mixed_did_not_rollback');}
   native.pass('234 delegated nonempty mixed source, real saved v2 and self confirmation, changed-source seal rejection; complete rollback');
   //Only the race fixture may commit, and only its exact absent synthetic IDs.
   //It protects all original rows and checks the exact final new footprint.
   races=await verifyPeriodDelegatedClosureRacesNative(ctx);
  }finally{
   assert.equal(d.definitions(),definitions,'delegated_acceptance_definitions_changed');
   assert.equal(d.tableCatalog(),catalog,'delegated_acceptance_catalog_changed');
   assert.deepEqual(archiveSnapshot(archive()),original,'delegated_acceptance_old_archive_changed');
   assert.deepEqual(archiveSnapshot(periodArchive()),sealed,'delegated_acceptance_sealed_archive_changed');
  }
  native.pass('234 delegated actual lock races; original archives, definitions and catalog preserved');
  return {phase:234,mixed,races,mixedRolledBack:true,racesCommitOnlyExactSyntheticFootprint:true,
   cleanupOwnedByParent:true,newCluster:false,browser:false,realAuth:false,productionAccess:false,deployed:false};
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runPeriodDelegatedAcceptanceNative(process.argv.slice(2))
 .then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(JSON.stringify({error:'period_delegated_acceptance_failed',detail:error?.stack??String(error)}));process.exitCode=1;});
