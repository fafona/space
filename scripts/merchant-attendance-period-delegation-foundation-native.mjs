// Explicit local-only acceptance of the authorization foundation. This does
// NOT claim the delegated period writer/new archive or browser is delivered.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runPeriodContinuationNative} from './merchant-attendance-period-continuation-native.mjs';
import {assertLifecycleSandbox} from './merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {verifyPeriodDelegationFoundation} from './fixtures/attendance-period-delegation-foundation-native.mjs';

export const periodDelegationFoundationMigrations=Object.freeze([
 '202610080184_merchant_attendance_period_delegated_source.sql',
 '202610080185_merchant_attendance_period_delegations.sql',
]);
export async function runPeriodDelegationFoundationNative(args,after=null,acceptanceOptions={}){
 if(after!==null)assert.equal(typeof after,'function','period_delegation_invalid_local_extension');
 return runPeriodContinuationNative(args,async ctx=>{
  const {d,native,scope}=ctx;assert.equal(d.syntheticOnly,true);
  assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
  const oldTables=d.inventory().filter(x=>x!=='faolla_schema_migrations'),facts=d.fingerprint(oldTables);
  const oldOids=d.exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f';`);
  const functions=(exclude=false)=>d.exec(`select md5(jsonb_agg(jsonb_build_array(oid,pg_get_functiondef(oid),proowner,proacl,proconfig,prosecdef) order by oid)::text)
   from pg_proc where oid=any(${quote(oldOids)}::oid[]) and prokind='f' ${exclude?"and oid<>all(array['public.faolla_valid_merchant_enterprise_permissions_v1(text[])'::regprocedure::oid,'public.faolla_attendance_account_capture_v1(text,uuid,uuid,uuid,boolean)'::regprocedure::oid])":''};`);
  const original=functions(),preserved=functions(true);
  d.exec(boundClockMigrationBody(native.root,periodDelegationFoundationMigrations[0]));
  assert.equal(d.fingerprint(oldTables),facts);assert.equal(functions(),original,'delegated_source_changed_old_function');
  assert.deepEqual(d.inventory().filter(x=>x!=='faolla_schema_migrations'),oldTables);
  d.exec(boundClockMigrationBody(native.root,periodDelegationFoundationMigrations[1]));
  assert.equal(d.fingerprint(oldTables),facts);assert.equal(functions(true),preserved,'period_grant_changed_unapproved_function');
  assert.deepEqual(d.inventory().filter(x=>x!=='faolla_schema_migrations'&&!oldTables.includes(x)).sort(),
   ['merchant_attendance_period_delegation_operations','merchant_attendance_period_delegation_revocations','merchant_attendance_period_delegations']);
  const installed=d.fingerprint(),defs=d.definitions(),catalog=d.tableCatalog();
  for(const name of periodDelegationFoundationMigrations)d.exec(boundClockMigrationBody(native.root,name));
  assert.equal(d.fingerprint(),installed);assert.equal(d.definitions(),defs);assert.equal(d.tableCatalog(),catalog);
  native.pass('232 private source and grant foundation install/reentry preserve old rows and all but two approved function implementations');
  let acceptance;
  try{acceptance=await verifyPeriodDelegationFoundation(ctx);}
  finally{assert.equal(d.fingerprint(),installed,'period_delegation_foundation_did_not_rollback');assert.equal(d.definitions(),defs);assert.equal(d.tableCatalog(),catalog);}
  native.pass('232 real grant/revoke, original receipt, scoped private authority/source, forbidden direct service helper; full rollback');
  const extension=after===null?null:await after(ctx);
  return {phase:232,acceptance,installAndReentry:true,rollbackRestored:true,sourceOldFunctionsUntouched:true,
   delegatedPeriodWriter:false,newArchiveProtocol:false,browser:false,realAuth:false,productionAccess:false,deployed:false,...(extension?{extension}:{})};
 },acceptanceOptions);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runPeriodDelegationFoundationNative(process.argv.slice(2))
 .then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(JSON.stringify({error:'period_delegation_foundation_failed',detail:error?.stack??String(error)}));process.exitCode=1;});
