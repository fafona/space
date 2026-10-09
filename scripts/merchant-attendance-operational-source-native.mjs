//241 Private source acceptance in the one explicitly supplied owned PG cluster.
//No public endpoint, authentication substitute, rule adoption or new database.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runPeriodDelegatedClosureNative} from './merchant-attendance-period-delegated-closure-native.mjs';
import {assertLifecycleSandbox} from './merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {periodContinuationArchiveBytes} from './fixtures/attendance-period-continuation-native.mjs';
import {operationalRulesNativeArgs,operationalRulesNativeMigration,operationalRulesNativeTables} from './merchant-attendance-operational-rules-native.mjs';

export const operationalSourceNativeMigration='202610080192_merchant_attendance_operational_source.sql';
export const operationalSourceNativeFunctions=Object.freeze([
 'faolla_attendance_operational_source_baseline_v1',
 'faolla_attendance_operational_source_layer_v1',
 'faolla_attendance_operational_source_stamp_v1',
 'faolla_attendance_operational_source_tuple_v1',
 'faolla_attendance_operational_source_v1',
]);
export const operationalSourceNativeArgs=args=>operationalRulesNativeArgs(args);
export async function runOperationalSourceNative(args){
 return runPeriodDelegatedClosureNative(operationalSourceNativeArgs(args),async ctx=>{
  const {d,h,native,scope,archive,oldArchive,periodArchive}=ctx;
  assert.equal(d.syntheticOnly,true);assert.equal(h.syntheticOnly,true);
  assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
  const original=periodContinuationArchiveBytes(archive()),sealed=periodContinuationArchiveBytes(periodArchive());
  assert.deepEqual(original,periodContinuationArchiveBytes(oldArchive));
  const tablesBefore191=d.inventory().filter(n=>n!=='faolla_schema_migrations'),factsBefore191=d.fingerprint(tablesBefore191);
  const preOids=d.exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f';`);
  const selectedFunctions=oids=>d.exec(`select md5(coalesce(jsonb_agg(jsonb_build_array(oid,pg_get_functiondef(oid),proowner,proacl,proconfig,prosecdef) order by oid),'[]')::text)
   from pg_proc where oid=any(${quote(oids)}::oid[]) and prokind='f';`),before191Functions=selectedFunctions(preOids);
  //Install191 only as a prerequisite; do not rerun240's UI/history-capacity suite.
  d.exec(boundClockMigrationBody(native.root,operationalRulesNativeMigration));
  assert.equal(d.fingerprint(tablesBefore191),factsBefore191);assert.equal(selectedFunctions(preOids),before191Functions);
  assert.deepEqual(d.inventory().filter(n=>n!=='faolla_schema_migrations'&&!tablesBefore191.includes(n)).sort(),operationalRulesNativeTables);
  const oldTables=d.inventory().filter(n=>n!=='faolla_schema_migrations'),oldFacts=d.fingerprint(oldTables),oldCatalog=d.tableCatalog();
  const oldOids=d.exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f';`);
  const oldFunctions=selectedFunctions(oldOids);
  d.exec(boundClockMigrationBody(native.root,operationalSourceNativeMigration));
  assert.equal(d.fingerprint(oldTables),oldFacts,'operational_source_install_changed_old_facts');
  assert.equal(selectedFunctions(oldOids),oldFunctions,'operational_source_install_changed_old_functions');
  assert.equal(d.tableCatalog(),oldCatalog,'operational_source_must_not_add_or_change_tables');
  const added=JSON.parse(d.exec(`select coalesce(jsonb_agg(proname order by proname),'[]') from pg_proc
   where pronamespace=${d.owned.oid} and prokind='f' and not(oid=any(${quote(oldOids)}::oid[]));`));
  assert.deepEqual(added,operationalSourceNativeFunctions);
  const installed=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();
  d.exec(boundClockMigrationBody(native.root,operationalSourceNativeMigration));
  assert.equal(d.fingerprint(),installed);assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  //The separate source namespace must not break191's exact16-function reentry.
  d.exec(boundClockMigrationBody(native.root,operationalRulesNativeMigration));
  assert.equal(d.fingerprint(),installed);assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  native.pass('241 private source install/reentry: five invoker functions, no table changes, old facts/functions/191 reentry unchanged');
  const {verifyOperationalSourceNative}=await import('./fixtures/attendance-operational-source-native.mjs');
  let acceptance;
  try{acceptance=await verifyOperationalSourceNative(ctx);}
  finally{
   assert.equal(d.fingerprint(),installed,'operational_source_fixture_not_rolled_back');
   assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);assert.equal(selectedFunctions(oldOids),oldFunctions);
   assert.deepEqual(periodContinuationArchiveBytes(archive()),original);assert.deepEqual(periodContinuationArchiveBytes(periodArchive()),sealed);
  }
  assert.equal(acceptance.rollbackRestored,true);
  return {phase:241,acceptance,installAndReentry:true,newPrivateFunctions:5,newTables:0,oldFactsUnchanged:true,oldFunctionsUnchanged:true,
   oldArchivesUnchanged:true,rollbackRestored:true,cleanupOwnedByParent:true,newCluster:false,browser:false,realAuth:false,
   productionAccess:false,deployed:false,ruleAdoption:false};
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runOperationalSourceNative(process.argv.slice(2))
 .then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(JSON.stringify({error:'operational_source_native_failed',detail:error?.stack??String(error)}));process.exitCode=1;});
