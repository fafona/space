//240 Explicit local acceptance. Reuse the one caller-owned synthetic cluster;
//no employee account, production access, copied database or runtime rule adoption.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runPeriodDelegatedClosureNative} from './merchant-attendance-period-delegated-closure-native.mjs';
import {assertLifecycleSandbox} from './merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {periodContinuationArchiveBytes} from './fixtures/attendance-period-continuation-native.mjs';

export const operationalRulesNativeMigration='202610080191_merchant_attendance_operational_rules.sql';
export const operationalRulesNativeTables=Object.freeze([
 'merchant_attendance_operational_rule_operations',
 'merchant_attendance_operational_rule_publications',
 'merchant_attendance_operational_rule_streams',
]);
export function operationalRulesNativeArgs(args){
 assert(Array.isArray(args)&&args.length===3&&args[0]==='--run-local'&&args[1]==='--directory'
  &&typeof args[2]==='string'&&path.isAbsolute(args[2])&&args[2].trim()===args[2]&&!/[\u0000-\u001f\u007f]/.test(args[2]),
  'operational_rules_explicit_existing_directory_required');
 return [...args];
}
export async function runOperationalRulesNative(args){
 return runPeriodDelegatedClosureNative(operationalRulesNativeArgs(args),async ctx=>{
  const {d,h,native,scope,archive,oldArchive,periodArchive}=ctx;
  assert.equal(d.syntheticOnly,true);assert.equal(h.syntheticOnly,true);
  assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
  const oldTables=d.inventory().filter(n=>n!=='faolla_schema_migrations'),oldFacts=d.fingerprint(oldTables);
  const oldOids=d.exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f';`);
  const functions=()=>d.exec(`select md5(coalesce(jsonb_agg(jsonb_build_array(oid,pg_get_functiondef(oid),proowner,proacl,proconfig,prosecdef) order by oid),'[]')::text)
   from pg_proc where oid=any(${quote(oldOids)}::oid[]) and prokind='f';`),oldFunctions=functions();
  const original=periodContinuationArchiveBytes(archive()),sealed=periodContinuationArchiveBytes(periodArchive());
  assert.deepEqual(original,periodContinuationArchiveBytes(oldArchive));
  d.exec(boundClockMigrationBody(native.root,operationalRulesNativeMigration));
  assert.equal(d.fingerprint(oldTables),oldFacts,'operational_rules_install_changed_old_facts');
  assert.equal(functions(),oldFunctions,'operational_rules_install_changed_old_functions');
  assert.deepEqual(d.inventory().filter(n=>n!=='faolla_schema_migrations'&&!oldTables.includes(n)).sort(),operationalRulesNativeTables);
  const installed=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();
  d.exec(boundClockMigrationBody(native.root,operationalRulesNativeMigration));
  assert.equal(d.fingerprint(),installed);assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  native.pass('240 operational rule ledger install/reentry: three new tables, every old fact and function unchanged');
  const {verifyOperationalRulesNative}=await import('./fixtures/attendance-operational-rules-native.mjs');
  let acceptance;
  try{acceptance=await verifyOperationalRulesNative(ctx);}
  finally{
   assert.equal(d.fingerprint(),installed,'operational_rules_fixture_not_rolled_back');
   assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);assert.equal(functions(),oldFunctions);
   assert.deepEqual(periodContinuationArchiveBytes(archive()),original);assert.deepEqual(periodContinuationArchiveBytes(periodArchive()),sealed);
  }
  assert.equal(acceptance.rollbackRestored,true);
  return {phase:240,acceptance,installAndReentry:true,oldFactsUnchanged:true,oldFunctionsUnchanged:true,oldArchivesUnchanged:true,
   rollbackRestored:true,cleanupOwnedByParent:true,newCluster:false,browser:false,realAuth:false,productionAccess:false,deployed:false,ruleAdoption:false};
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runOperationalRulesNative(process.argv.slice(2))
 .then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(JSON.stringify({error:'operational_rules_native_failed',detail:error?.stack??String(error)}));process.exitCode=1;});
