//235 inert, explicit existing-cluster acceptance. No startup/install/cleanup is
//owned here; the original parent restores its public baseline and stops.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runPeriodDelegatedClosureNative} from './merchant-attendance-period-delegated-closure-native.mjs';
import {assertLifecycleSandbox} from './merchant-attendance-lifecycle-native-support.mjs';
import {periodContinuationArchiveBytes} from './fixtures/attendance-period-continuation-native.mjs';
import {verifyPeriodDelegatedCapacityNative} from './fixtures/attendance-period-delegated-capacity-native.mjs';

function checkedArgs(args){
 assert(Array.isArray(args)&&args.length===3&&args.every(v=>typeof v==='string'),'delegated_capacity_explicit_args_required');
 const directory=args.indexOf('--directory'),run=args.indexOf('--run-local');
 assert((directory===0&&run===2||directory===1&&run===0)&&path.isAbsolute(args[directory+1])
  &&args[directory+1].trim()===args[directory+1]&&!/[\u0000-\u001f\u007f]/.test(args[directory+1]),'delegated_capacity_explicit_args_required');
 return ['--run-local','--directory',args[directory+1]];
}
export async function runPeriodDelegatedCapacityNative(args){
 return runPeriodDelegatedClosureNative(checkedArgs(args),async ctx=>{
  const {d,h,native,scope,archive,oldArchive,periodArchive}=ctx;
  assert.equal(d.syntheticOnly,true);assert.equal(h.syntheticOnly,true);
  assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
  const facts=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();
  const original=periodContinuationArchiveBytes(archive()),sealed=periodContinuationArchiveBytes(periodArchive());
  assert.deepEqual(original,periodContinuationArchiveBytes(oldArchive));
  let capacity;
  try{capacity=await verifyPeriodDelegatedCapacityNative(ctx);}
  finally{
   assert.equal(d.fingerprint(),facts,'delegated_capacity_did_not_rollback');
   assert.equal(d.definitions(),definitions,'delegated_capacity_definitions_changed');
   assert.equal(d.tableCatalog(),catalog,'delegated_capacity_catalog_changed');
   assert.deepEqual(periodContinuationArchiveBytes(archive()),original,'delegated_capacity_old_archive_changed');
   assert.deepEqual(periodContinuationArchiveBytes(periodArchive()),sealed,'delegated_capacity_sealed_archive_changed');
  }
  assert.equal(capacity.rollbackRestored,true,'delegated_capacity_fixture_incomplete');
  native.pass('235 delegated quota boundary, reuse and original recovery; full rollback, definitions, catalog and both archives preserved');
  return {phase:235,capacity,rollbackRestored:true,cleanupOwnedByParent:true,newCluster:false,
   browser:false,realAuth:false,productionAccess:false,deployed:false};
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runPeriodDelegatedCapacityNative(process.argv.slice(2))
 .then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(JSON.stringify({error:'period_delegated_capacity_failed',detail:error?.stack??String(error)}));process.exitCode=1;});
