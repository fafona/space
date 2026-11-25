// Caller-owned empty hosted CI DB only. Preserve the old five-source tests;
// this separately upgrades the fixture dependency, not production data.
import assert from 'node:assert/strict';
import {loadInstallationPlan} from './member-checkout-installation-plan.mjs';
import {inspectCompatibilityCatalog} from './member-checkout-compatibility-check.mjs';
import {loadCheckout047Compatibility,readCheckout047Compatibility,inspectCheckout047Compatibility} from './member-checkout-047-compatibility.mjs';
import {assertOwnedLifecycleTarget} from './member-checkout-runtime-lifecycle-cases.mjs';
import {assertIsolatedCi} from './member-checkout-real-auth-support.mjs';

export function assertCheckout047CiOptIn(env=process.env){
 const value=env.FAOLLA_CHECKOUT_047_REVISION_ACCEPTANCE;
 assert.ok(value===undefined||value==='0'||value==='1','checkout_047_ci_flag_invalid');return value==='1';
}
export async function installOwnedCheckout047Revision(t,db){
 assertIsolatedCi();assertOwnedLifecycleTarget(db);assert.equal(assertCheckout047CiOptIn(),true);
 assert.equal((await db.query('select count(*)::int n from public.faolla_schema_migrations')).rows[0].n,5);
 for(const table of ['bundle_results','bundle_cancellations','intent_claims'])
  assert.equal((await db.query('select count(*)::int n from faolla_checkout_design.'+table)).rows[0].n,0);
 const contract=await loadCheckout047Compatibility(),plan=await loadInstallationPlan();
 await db.query(contract.revision.legacySql);
 // 047 replaces the old public wrapper. Preserve precisely the ordinary-v1
 // grant already required by the frozen runtime; never grant its renamed writer.
 await db.query('GRANT EXECUTE ON FUNCTION public.faolla_commit_redemption_v1(text,jsonb) TO faolla_checkout_executor');
 await db.query(contract.revision.adapterSql);for(const patch of contract.revision.patches)await db.query(patch.sql);
 const read=()=>readCheckout047Compatibility((sql,args)=>db.query(sql,args),contract);
 const inspect=value=>inspectCheckout047Compatibility(contract,value.catalog,value.legacyDetails);
 const baseline=await read();
 const check=async(name,run)=>{let passed=false;await t.test(name,async()=>{await run();passed=true;});assert.equal(passed,true,'checkout_047_ci_prerequisite_failed:'+name);};
 await check('separate pinned 047 metadata and effective privileges match without changing the old compatibility guard',async()=>{
  const result=inspect(baseline);assert.deepEqual(result.issues,[]);assert.equal(result.protocolObjectsMatch,true);assert.equal(result.deploymentReady,false);
  assert.ok(inspectCompatibilityCatalog(plan.expected,baseline.catalog).issues.some(issue=>issue.startsWith('function_changed:public.faolla_commit_redemption_v1')));
  assert.equal((await db.query('select count(*)::int n from public.faolla_schema_migrations')).rows[0].n,6);
 });
 for(const [name,sql,issue] of [
  ['bridge direct API execution','GRANT EXECUTE ON FUNCTION faolla_checkout_design.commit_redemption_047(text,text,text,text,jsonb) TO service_role','private_function_exposed:faolla_checkout_design.commit_redemption_047(text,text,text,text,jsonb)'],
  ['renamed original direct executor execution','GRANT EXECUTE ON FUNCTION public.faolla_commit_redemption_internal_v1(text,jsonb) TO faolla_checkout_executor','legacy_047_invocation_changed:public.faolla_commit_redemption_internal_v1(text,jsonb)'],
  ['bridge wrong security mode','ALTER FUNCTION faolla_checkout_design.commit_redemption_047(text,text,text,text,jsonb) SECURITY INVOKER','function_changed:faolla_checkout_design.commit_redemption_047(text,text,text,text,jsonb)'],
  ['audit RLS disabled','ALTER TABLE faolla_checkout_design.redemption_047_audits DISABLE ROW LEVEL SECURITY','table_boundary_changed:faolla_checkout_design.redemption_047_audits'],
  ['audit original proof disabled','ALTER TABLE faolla_checkout_design.redemption_047_audits DISABLE TRIGGER redemption_047_original_required','trigger_changed:faolla_checkout_design.redemption_047_audits:redemption_047_original_required'],
 ])await check('047 inspection refuses '+name+' and restores only the owned fixture mutation',async()=>{
  await db.query('BEGIN');try{await db.query(sql);const mutated=await read(),result=inspect(mutated);assert.ok(result.issues.includes(issue),result.issues.join(','));
   assert.equal(result.protocolObjectsMatch,false);assert.equal(result.deploymentReady,false);assert.deepEqual(await read(),mutated);
  }finally{await db.query('ROLLBACK');}assert.deepEqual(await read(),baseline);
 });
 return {revisionSha256:contract.revision.sha256,legacySources:6,functions:contract.expected.functions.length,tables:contract.expected.tables.length,
  triggers:contract.expected.triggers.length,productionAuthorized:false,deploymentReady:false};
}
