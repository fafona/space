// One explicit, owned, synthetic cluster; no production or real employee login.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runPeriodDelegationFoundationNative} from './merchant-attendance-period-delegation-foundation-native.mjs';
import {boundClockMigrationBody,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {verifyPeriodDelegatedClosureNative} from './fixtures/attendance-period-delegated-closure-native.mjs';
export async function runPeriodDelegatedClosureNative(args,after=null,acceptanceOptions={}){
 if(after!==null)assert.equal(typeof after,'function','period_delegated_closure_invalid_local_extension');
 return runPeriodDelegationFoundationNative(args,async ctx=>{
  const {d,native}=ctx;assert.equal(d.syntheticOnly,true);
  const tables=d.inventory().filter(x=>x!=='faolla_schema_migrations'),facts=d.fingerprint(tables);
  const oids=d.exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f'
    and oid<>all(array['public.faolla_attendance_period_artifact_checked_v1(public.merchant_attendance_period_artifacts)'::regprocedure::oid,
     'public.faolla_attendance_period_storage_insert_v2()'::regprocedure::oid]);`);
  const functions=()=>d.exec(`select md5(jsonb_agg(jsonb_build_array(oid,pg_get_functiondef(oid),proowner,proacl,proconfig,prosecdef) order by oid)::text)
    from pg_proc where oid=any(${quote(oids)}::oid[]) and prokind='f';`),defs=functions();
  const migrations=['202610080186_merchant_attendance_period_delegated_artifacts.sql','202610080187_merchant_attendance_period_delegated_closure.sql'];
  for(const migration of migrations)d.exec(boundClockMigrationBody(native.root,migration));
  assert.equal(d.fingerprint(tables),facts);assert.equal(functions(),defs);assert.deepEqual(d.inventory().filter(x=>x!=='faolla_schema_migrations'),tables);
  const installed=d.fingerprint(),definition=d.definitions(),catalog=d.tableCatalog();
  for(const migration of migrations)d.exec(boundClockMigrationBody(native.root,migration));
  assert.equal(d.fingerprint(),installed);assert.equal(d.definitions(),definition);assert.equal(d.tableCatalog(),catalog);
  native.pass('233 delegated archive/writer install and reentry preserve old rows and all but two approved helpers');
  let acceptance;try{acceptance=await verifyPeriodDelegatedClosureNative(ctx);}
  finally{assert.equal(d.fingerprint(),installed);assert.equal(d.definitions(),definition);assert.equal(d.tableCatalog(),catalog);}
  native.pass('233 actual delegated send/respond/seal/reopen, genuine self confirmation and old archive compatibility; complete rollback');
  const extension=after===null?null:await after(ctx);
  return {phase:233,acceptance,rollbackRestored:true,browser:false,realAuth:false,production:false,deployed:false,...(extension?{extension}:{})};
 },acceptanceOptions);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runPeriodDelegatedClosureNative(process.argv.slice(2))
 .then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(JSON.stringify({error:'period_delegated_closure_failed',detail:error?.stack??String(error)}));process.exitCode=1;});
