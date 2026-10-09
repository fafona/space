//238 explicit local-only acceptance; the existing parent owns the one cluster.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runPeriodDelegatedClosureNative} from './merchant-attendance-period-delegated-closure-native.mjs';
import {assertLifecycleSandbox} from './merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {periodContinuationArchiveBytes} from './fixtures/attendance-period-continuation-native.mjs';

export const correctionDelegationNativeMigrations=Object.freeze([
 '202610080189_merchant_attendance_correction_delegation.sql',
 '202610080190_merchant_attendance_correction_delegation_permission.sql',
]);
export const correctionDelegationChangedFunctions=Object.freeze([
 'faolla_attendance_account_capture_v1(text,uuid,uuid,uuid,boolean)',
 'faolla_valid_merchant_enterprise_permissions_v1(text[])',
]);
export function correctionDelegationNativeArgs(args){
 assert(Array.isArray(args)&&args.length===3&&args[0]==='--run-local'&&args[1]==='--directory'
  &&typeof args[2]==='string'&&path.isAbsolute(args[2])&&args[2].trim()===args[2]&&!/[\u0000-\u001f\u007f]/.test(args[2]),
  'correction_delegation_explicit_local_args_required');
 return [...args];
}
export async function runCorrectionDelegationNative(args){
 return runPeriodDelegatedClosureNative(correctionDelegationNativeArgs(args),async ctx=>{
  const {d,h,native,scope,archive,oldArchive,periodArchive}=ctx;
  assert.equal(d.syntheticOnly,true);assert.equal(h.syntheticOnly,true);
  assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
  const names=d.inventory().filter(n=>n!=='faolla_schema_migrations'),facts=d.fingerprint(names);
  const original=periodContinuationArchiveBytes(archive()),sealed=periodContinuationArchiveBytes(periodArchive());
  assert.deepEqual(original,periodContinuationArchiveBytes(oldArchive));
  const signatures=correctionDelegationChangedFunctions.map(s=>`'public.${s}'::regprocedure::oid`).join(',');
  const oldOids=d.exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f';`);
  const functionHash=(exclude=false)=>d.exec(`select md5(coalesce(jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef) order by p.oid),'[]')::text)
   from pg_proc p where p.oid=any(${quote(oldOids)}::oid[]) and p.prokind='f' ${exclude?`and p.oid<>all(array[${signatures}])`:''};`);
  const allFunctions=functionHash(),preservedFunctions=functionHash(true);
  //Additive prerequisite only; no repetition of unrelated notification tests.
  d.exec(boundClockMigrationBody(native.root,'202610080188_merchant_attendance_owner_notifications.sql'));
  assert.equal(d.fingerprint(names),facts);assert.equal(functionHash(),allFunctions);
  for(const migration of correctionDelegationNativeMigrations)d.exec(boundClockMigrationBody(native.root,migration));
  assert.equal(d.fingerprint(names),facts);assert.equal(functionHash(true),preservedFunctions,'correction_delegation_unapproved_old_function_changed');
  const installed=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();
  for(const migration of correctionDelegationNativeMigrations)d.exec(boundClockMigrationBody(native.root,migration));
  assert.equal(d.fingerprint(),installed);assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  native.pass('238 correction delegation install/reentry; old facts preserved and exactly two approved old helpers may change');
  const {verifyCorrectionDelegationNative}=await import('./fixtures/attendance-correction-delegation-native.mjs');
  let acceptance;
  try{acceptance=await verifyCorrectionDelegationNative(ctx);}
  finally{
   assert.equal(d.fingerprint(),installed,'correction_delegation_fixture_not_rolled_back');
   assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);assert.equal(functionHash(true),preservedFunctions);
   assert.deepEqual(periodContinuationArchiveBytes(archive()),original);assert.deepEqual(periodContinuationArchiveBytes(periodArchive()),sealed);
  }
  assert.equal(acceptance.rollbackRestored,true);
  return {phase:238,acceptance,installAndReentry:true,approvedChangedFunctions:correctionDelegationChangedFunctions,oldFactsUnchanged:true,
   oldOtherFunctionsUnchanged:true,oldArchivesUnchanged:true,rollbackRestored:true,cleanupOwnedByParent:true,
   newCluster:false,browser:false,realAuth:false,productionAccess:false,deployed:false};
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runCorrectionDelegationNative(process.argv.slice(2))
 .then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(JSON.stringify({error:'correction_delegation_native_failed',detail:error?.stack??String(error)}));process.exitCode=1;});
