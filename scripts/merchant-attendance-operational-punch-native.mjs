//242 INERT unless the caller names the one existing owned synthetic cluster.
//No production credentials, database copy, old-row rewrite or real account.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runPeriodDelegatedClosureNative} from './merchant-attendance-period-delegated-closure-native.mjs';
import {assertLifecycleSandbox} from './merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {periodContinuationArchiveBytes} from './fixtures/attendance-period-continuation-native.mjs';
import {operationalRulesNativeArgs,operationalRulesNativeMigration,operationalRulesNativeTables} from './merchant-attendance-operational-rules-native.mjs';
import {operationalSourceNativeMigration} from './merchant-attendance-operational-source-native.mjs';

export const operationalPunchNativeMigration='202610080193_merchant_attendance_operational_punch.sql';
export const operationalPunchNativeTables=Object.freeze([
 'merchant_attendance_operational_punch_activations',
 'merchant_attendance_operational_punch_operations',
 'merchant_attendance_operational_punch_sessions',
]);
export const operationalPunchReplacedFunctions=Object.freeze([
 'faolla_attendance_location_clock_v1', 'faolla_attendance_location_clock_v2',
 'faolla_attendance_onsite_clock_v1','faolla_attendance_pin_clock_v1',
 'faolla_attendance_pin_schedule_v1','faolla_attendance_self_v1',
]);
export const operationalPunchNativeArgs=args=>operationalRulesNativeArgs(args);
export async function runOperationalPunchNative(args){
 return runPeriodDelegatedClosureNative(operationalPunchNativeArgs(args),async ctx=>{
  const {d,h,native,scope,archive,oldArchive,periodArchive}=ctx;
  assert.equal(d.syntheticOnly,true);assert.equal(h.syntheticOnly,true);
  assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
  const original=periodContinuationArchiveBytes(archive()),sealed=periodContinuationArchiveBytes(periodArchive());
  assert.deepEqual(original,periodContinuationArchiveBytes(oldArchive));
  const initialTables=d.inventory().filter(n=>n!=='faolla_schema_migrations'),initialFacts=d.fingerprint(initialTables);
  const initialOids=d.exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f';`);
  const functionHash=(oids,exclude=false)=>d.exec(`select md5(coalesce(jsonb_agg(jsonb_build_array(oid,pg_get_functiondef(oid),proowner,proacl,proconfig,prosecdef) order by oid),'[]')::text)
   from pg_proc where oid=any(${quote(oids)}::oid[]) and prokind='f' ${exclude?`and proname not in(${operationalPunchReplacedFunctions.map(quote).join(',')})`:''};`);
  const initialFunctions=functionHash(initialOids);
  //Prerequisites only: do not repeat240 history/UI or241 source matrices.
  for(const migration of [operationalRulesNativeMigration,operationalSourceNativeMigration])d.exec(boundClockMigrationBody(native.root,migration));
  assert.equal(d.fingerprint(initialTables),initialFacts);assert.equal(functionHash(initialOids),initialFunctions);
  assert.deepEqual(d.inventory().filter(n=>n!=='faolla_schema_migrations'&&!initialTables.includes(n)).sort(),operationalRulesNativeTables);
  const oldTables=d.inventory().filter(n=>n!=='faolla_schema_migrations'),oldFacts=d.fingerprint(oldTables);
  const oldOids=d.exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f';`);
  const unaffected=functionHash(oldOids,true);
  const replacedMetadata=()=>d.exec(`select jsonb_agg(jsonb_build_array(oid,proname,pg_get_function_identity_arguments(oid),proowner,proacl,proconfig,prosecdef) order by proname)::text
   from pg_proc where pronamespace=${d.owned.oid} and proname in(${operationalPunchReplacedFunctions.map(quote).join(',')});`);
  const metadata=replacedMetadata();assert.equal(JSON.parse(metadata).length,6);
  d.exec(boundClockMigrationBody(native.root,operationalPunchNativeMigration));
  assert.equal(d.fingerprint(oldTables),oldFacts,'operational_punch_install_changed_old_facts');
  assert.equal(functionHash(oldOids,true),unaffected,'operational_punch_changed_unapproved_function');
  assert.equal(replacedMetadata(),metadata,'operational_punch_old_OID_signature_ACL_owner_changed');
  assert.deepEqual(d.inventory().filter(n=>n!=='faolla_schema_migrations'&&!oldTables.includes(n)).sort(),operationalPunchNativeTables);
  const installed=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();
  d.exec(boundClockMigrationBody(native.root,operationalPunchNativeMigration));
  assert.equal(d.fingerprint(),installed);assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  for(const migration of [operationalRulesNativeMigration,operationalSourceNativeMigration])d.exec(boundClockMigrationBody(native.root,migration));
  assert.equal(d.fingerprint(),installed);assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  native.pass('242 install/reentry: three sidecar tables, six approved writer bodies only, original OID/signature/owner/ACL and191/192 reentry preserved');
  const {verifyOperationalPunchNative}=await import('./fixtures/attendance-operational-punch-native.mjs');
  let acceptance;
  try{acceptance=await verifyOperationalPunchNative(ctx);}
  finally{
   assert.equal(d.fingerprint(),installed,'operational_punch_fixture_not_rolled_back');
   assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);assert.equal(functionHash(oldOids,true),unaffected);
   assert.equal(replacedMetadata(),metadata);assert.deepEqual(periodContinuationArchiveBytes(archive()),original);assert.deepEqual(periodContinuationArchiveBytes(periodArchive()),sealed);
  }
  assert.equal(acceptance.rollbackRestored,true);
  return {phase:242,acceptance,installAndReentry:true,newTables:3,approvedWriterBodies:6,oldFactsUnchanged:true,oldArchivesUnchanged:true,
   rollbackRestored:true,cleanupOwnedByParent:true,newCluster:false,browser:false,realAuth:false,productionAccess:false,deployed:false};
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runOperationalPunchNative(process.argv.slice(2))
 .then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(JSON.stringify({error:'operational_punch_native_failed',detail:error?.stack??String(error)}));process.exitCode=1;});
