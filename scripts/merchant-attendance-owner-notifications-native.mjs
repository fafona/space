//236 inert local-only extension. The original parent owns runtime and cleanup.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runPeriodDelegatedClosureNative} from './merchant-attendance-period-delegated-closure-native.mjs';
import {assertLifecycleSandbox} from './merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody} from './fixtures/attendance-bound-clocks-native.mjs';
import {periodContinuationArchiveBytes} from './fixtures/attendance-period-continuation-native.mjs';
import {verifyOwnerNotificationsNative} from './fixtures/attendance-owner-notifications-native.mjs';

export const ownerNotificationsMigration='202610080188_merchant_attendance_owner_notifications.sql';
export function ownerNotificationsNativeArgs(args){
 assert(Array.isArray(args)&&args.length===3&&args.every(x=>typeof x==='string'),'owner_notifications_explicit_args_required');
 const run=args.indexOf('--run-local'),directory=args.indexOf('--directory');
 assert((run===0&&directory===1||directory===0&&run===2)&&path.isAbsolute(args[directory+1])
  &&args[directory+1].trim()===args[directory+1]&&!/[\u0000-\u001f\u007f]/.test(args[directory+1]),'owner_notifications_explicit_args_required');
 return ['--run-local','--directory',args[directory+1]];
}
export async function runOwnerNotificationsNative(args){
 return runPeriodDelegatedClosureNative(ownerNotificationsNativeArgs(args),async ctx=>{
  const {d,h,native,scope,archive,oldArchive,periodArchive}=ctx;
  assert.equal(d.syntheticOnly,true);assert.equal(h.syntheticOnly,true);
  assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
  const names=d.inventory().filter(n=>n!=='faolla_schema_migrations'),facts=d.fingerprint(names);
  const original=periodContinuationArchiveBytes(archive()),sealed=periodContinuationArchiveBytes(periodArchive());
  assert.deepEqual(original,periodContinuationArchiveBytes(oldArchive));
  const oldOids=JSON.parse(d.exec(`select coalesce(jsonb_agg(p.oid order by p.oid),'[]')::text from pg_proc p where p.pronamespace=${d.owned.oid} and p.prokind='f';`)).map(Number);
  assert(oldOids.length&&oldOids.every(Number.isSafeInteger));
  const functionHashSql=`select md5(coalesce(jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef) order by p.oid),'[]')::text) from pg_proc p where p.oid=any(array[${oldOids.join(',')}]::oid[]) and p.prokind='f';`;
  const oldFunctions=d.exec(functionHashSql),checkOldFunctions=()=>assert.equal(d.exec(functionHashSql),oldFunctions,'owner_notifications_old_functions_changed');
  d.exec(boundClockMigrationBody(native.root,ownerNotificationsMigration));
  assert.equal(d.fingerprint(names),facts);checkOldFunctions();
  const installed=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();
  d.exec(boundClockMigrationBody(native.root,ownerNotificationsMigration));
  assert.equal(d.fingerprint(),installed);assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);checkOldFunctions();
  native.pass('236 owner notifications additive install/reentry; old facts and functions unchanged');
  let acceptance;
  try{acceptance=await verifyOwnerNotificationsNative(ctx);}
  finally{
   assert.equal(d.fingerprint(),installed,'owner_notifications_fixture_not_rolled_back');
   assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);checkOldFunctions();
   assert.deepEqual(periodContinuationArchiveBytes(archive()),original);assert.deepEqual(periodContinuationArchiveBytes(periodArchive()),sealed);
  }
  assert.equal(acceptance.rollbackRestored,true);
  return {phase:236,acceptance,installAndReentry:true,oldFunctionsUnchanged:true,rollbackRestored:true,cleanupOwnedByParent:true,
   newCluster:false,browser:false,realAuth:false,productionAccess:false,deployed:false};
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runOwnerNotificationsNative(process.argv.slice(2))
 .then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(JSON.stringify({error:'owner_notifications_native_failed',detail:error?.stack??String(error)}));process.exitCode=1;});
