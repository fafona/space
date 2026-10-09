//243 INERT without the caller's one existing, owned synthetic cluster.
//Only prerequisite installation: do not repeat240/241/242 acceptance matrices.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runPeriodDelegatedClosureNative} from './merchant-attendance-period-delegated-closure-native.mjs';
import {assertLifecycleSandbox} from './merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {periodContinuationArchiveBytes} from './fixtures/attendance-period-continuation-native.mjs';
import {operationalRulesNativeArgs,operationalRulesNativeMigration} from './merchant-attendance-operational-rules-native.mjs';
import {operationalSourceNativeMigration} from './merchant-attendance-operational-source-native.mjs';
import {operationalPunchNativeMigration} from './merchant-attendance-operational-punch-native.mjs';

export const applicationWindowNativeMigration='202610080194_merchant_attendance_application_window.sql';
export const applicationWindowNativeTables=Object.freeze([
 'merchant_attendance_application_window_proofs','merchant_attendance_operational_consumer_activations',
]);
export const applicationWindowReplacedFunctions=Object.freeze([
 'faolla_attendance_correction_self_v2','faolla_attendance_missing_v1',
 'faolla_attendance_revision_self_v1','faolla_attendance_revision_self_v2',
]);
export const applicationWindowNativeArgs=args=>operationalRulesNativeArgs(args);
export async function runApplicationWindowNative(args){
 return runPeriodDelegatedClosureNative(applicationWindowNativeArgs(args),async ctx=>{
  const {d,h,native,scope,archive,oldArchive,periodArchive}=ctx;
  assert.equal(d.syntheticOnly,true);assert.equal(h.syntheticOnly,true);
  assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
  const original=periodContinuationArchiveBytes(archive()),sealed=periodContinuationArchiveBytes(periodArchive());
  assert.deepEqual(original,periodContinuationArchiveBytes(oldArchive));
  const initialTables=d.inventory().filter(n=>n!=='faolla_schema_migrations'),initialFacts=d.fingerprint(initialTables);
  for(const migration of [operationalRulesNativeMigration,operationalSourceNativeMigration,operationalPunchNativeMigration])d.exec(boundClockMigrationBody(native.root,migration));
  assert.equal(d.fingerprint(initialTables),initialFacts,'application_window_prerequisites_changed_facts');
  const oldTables=d.inventory().filter(n=>n!=='faolla_schema_migrations'),oldFacts=d.fingerprint(oldTables);
  const oldOids=d.exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f';`);
  const functionHash=()=>d.exec(`select md5(coalesce(jsonb_agg(jsonb_build_array(oid,pg_get_functiondef(oid),proowner,proacl,proconfig,prosecdef) order by oid),'[]')::text)
   from pg_proc where oid=any(${quote(oldOids)}::oid[]) and prokind='f' and proname not in(${applicationWindowReplacedFunctions.map(quote).join(',')});`);
  const metadata=()=>d.exec(`select jsonb_agg(jsonb_build_array(oid,proname,pg_get_function_identity_arguments(oid),proowner,proacl,proconfig,prosecdef) order by proname)::text
   from pg_proc where pronamespace=${d.owned.oid} and proname in(${applicationWindowReplacedFunctions.map(quote).join(',')});`);
  const unaffected=functionHash(),originalMetadata=metadata();assert.equal(JSON.parse(originalMetadata).length,4);
  d.exec(boundClockMigrationBody(native.root,applicationWindowNativeMigration));
  assert.equal(d.fingerprint(oldTables),oldFacts,'application_window_install_changed_old_facts');
  assert.equal(functionHash(),unaffected,'application_window_changed_unapproved_function');
  assert.equal(metadata(),originalMetadata,'application_window_changed_old_OID_signature_owner_ACL');
  assert.deepEqual(d.inventory().filter(n=>n!=='faolla_schema_migrations'&&!oldTables.includes(n)).sort(),applicationWindowNativeTables);
  const installed=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();
  for(const migration of [applicationWindowNativeMigration,operationalRulesNativeMigration,operationalSourceNativeMigration,operationalPunchNativeMigration])d.exec(boundClockMigrationBody(native.root,migration));
  assert.equal(d.fingerprint(),installed);assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  native.pass('243 install/reentry: two sidecars, four approved bodies, old OID/signature/owner/ACL and191-193 reentry preserved');
  const {verifyApplicationWindowNative}=await import('./fixtures/attendance-application-window-native.mjs');let acceptance;
  try{acceptance=await verifyApplicationWindowNative(ctx);}
  finally{
   assert.equal(d.fingerprint(),installed,'application_window_fixture_not_rolled_back');assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
   assert.equal(functionHash(),unaffected);assert.equal(metadata(),originalMetadata);
   assert.deepEqual(periodContinuationArchiveBytes(archive()),original);assert.deepEqual(periodContinuationArchiveBytes(periodArchive()),sealed);
  }
  assert.equal(acceptance.rollbackRestored,true);
  return {phase:243,acceptance,installAndReentry:true,newTables:2,approvedWriterBodies:4,oldFactsUnchanged:true,oldArchivesUnchanged:true,
   rollbackRestored:true,cleanupOwnedByParent:true,newCluster:false,browser:false,realAuth:false,productionAccess:false,deployed:false};
 },{capacity:'reuse_previous'});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runApplicationWindowNative(process.argv.slice(2))
 .then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(JSON.stringify({error:'application_window_native_failed',detail:error?.stack??String(error)}));process.exitCode=1;});
