//195 INERT. The caller explicitly names the existing owned synthetic cluster.
//191-194 are installed prerequisites, not repeated acceptance matrices.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runPeriodDelegatedClosureNative} from './merchant-attendance-period-delegated-closure-native.mjs';
import {assertLifecycleSandbox,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {periodContinuationArchiveBytes} from './fixtures/attendance-period-continuation-native.mjs';
import {operationalRulesNativeArgs,operationalRulesNativeMigration} from './merchant-attendance-operational-rules-native.mjs';
import {operationalSourceNativeMigration} from './merchant-attendance-operational-source-native.mjs';
import {operationalPunchNativeMigration} from './merchant-attendance-operational-punch-native.mjs';
import {applicationWindowNativeMigration} from './merchant-attendance-application-window-native.mjs';

export const administrativeClosureNativeMigration='202610080195_merchant_attendance_administrative_closure.sql';
export const administrativeClosureNativeNewTables=Object.freeze([
 'merchant_attendance_administrative_closure_entries','merchant_attendance_administrative_closures',
]);
export const administrativeClosureNativeArgs=args=>operationalRulesNativeArgs(args);
export function administrativeClosureNativeManifest(body){
 assert.equal(typeof body,'string');const found=body.match(/\$administrative_recipes\$([\s\S]*?)\$administrative_recipes\$/);assert(found);
 const recipes=JSON.parse(found[1]);assert(Array.isArray(recipes)&&recipes.length===28);
 assert.equal(new Set(recipes.map(r=>r.name+'('+r.types+')')).size,28);
 for(const r of recipes){assert.match(r.name,/^faolla_attendance_[a-z0-9_]+$/);assert.equal(typeof r.types,'string');
  for(const type of r.types.split(','))assert(['text','uuid','jsonb','boolean','timestamp with time zone','public.merchant_attendance_account_suspensions','public.merchant_attendance_period_artifacts'].includes(type));
  assert.match(r.oldHash,/^[a-f0-9]{64}$/);assert.match(r.newHash,/^[a-f0-9]{64}$/);}
 return recipes;
}
export async function runAdministrativeClosureNative(args,after=null){
 assert(after===null||typeof after==='function','administrative_invalid_local_extension');
 return runPeriodDelegatedClosureNative(administrativeClosureNativeArgs(args),async ctx=>{
  const {d,h,native,scope,archive,oldArchive,periodArchive}=ctx;
  assert.equal(d.syntheticOnly,true);assert.equal(h.syntheticOnly,true);
  assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
  const old155=periodContinuationArchiveBytes(await archive()),old207=periodContinuationArchiveBytes(await periodArchive());
  assert.deepEqual(old155,periodContinuationArchiveBytes(oldArchive));
  const initialTables=d.inventory().filter(n=>n!=='faolla_schema_migrations'),initialFacts=d.fingerprint(initialTables);
  for(const migration of ['202610020110_merchant_attendance_self_history_identity.sql',operationalRulesNativeMigration,operationalSourceNativeMigration,operationalPunchNativeMigration,applicationWindowNativeMigration])d.exec(boundClockMigrationBody(native.root,migration));
  assert.equal(d.fingerprint(initialTables),initialFacts,'administrative_prerequisite_old_facts');
  const oldTables=d.inventory().filter(n=>n!=='faolla_schema_migrations'),oldFacts=d.fingerprint(oldTables);
  const body=boundClockMigrationBody(native.root,administrativeClosureNativeMigration),recipes=administrativeClosureNativeManifest(body);
  const actualPins=JSON.parse(d.exec(`select jsonb_agg(jsonb_build_object('name',r->>'name','expected',r->>'oldHash',
   'actual',encode(sha256(convert_to(replace(replace(p.prosrc,E'\\r\\n',E'\\n'),${quote(d.owned.schema+'.')},'pub'||'lic.'),'UTF8')),'hex')) order by r->>'name')::text
   from jsonb_array_elements(${json(recipes)}) r left join pg_proc p on p.oid=to_regprocedure('public.'||(r->>'name')||'('||(r->>'types')||')');`));
  assert.deepEqual(actualPins.filter(p=>p.actual!==p.expected),[],'administrative_fixture_prerequisite_body_pins');
  const oldOids=d.exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f';`);
  const replacedOids=d.exec(`select array_agg(to_regprocedure('public.'||(r->>'name')||'('||(r->>'types')||')')::oid order by r->>'name')::text from jsonb_array_elements(${json(recipes)}) r;`);
  const unaffected=()=>d.exec(`select md5(coalesce(jsonb_agg(jsonb_build_array(oid,pg_get_functiondef(oid),proowner,proacl,proconfig,prosecdef) order by oid),'[]')::text)
   from pg_proc where oid=any(${quote(oldOids)}::oid[]) and oid<>all(${quote(replacedOids)}::oid[]) and prokind='f';`);
  const metadata=()=>d.exec(`select jsonb_agg(jsonb_build_array(oid,to_jsonb(p)-array['prosrc','proargdefaults'],pg_get_expr(proargdefaults,0)) order by oid)::text
   from pg_proc p where oid=any(${quote(replacedOids)}::oid[]) and pronamespace=${d.owned.oid};`);
  const originalFunctions=unaffected(),originalMetadata=metadata();assert.equal(JSON.parse(originalMetadata).length,28);
  d.exec(body);
  assert.equal(d.fingerprint(oldTables),oldFacts,'administrative_install_old_facts');
  assert.equal(unaffected(),originalFunctions,'administrative_unapproved_function_changed');
  assert.equal(metadata(),originalMetadata,'administrative_old_OID_metadata_changed');
  assert.deepEqual(d.inventory().filter(n=>n!=='faolla_schema_migrations'&&!oldTables.includes(n)).sort(),administrativeClosureNativeNewTables);
  const installed=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();
  //Old193/194 pins intentionally precede195. Do not reapply them after a valid
  //forward upgrade and mislabel their superseded body expectations as corruption.
  d.exec(body);
  assert.equal(d.fingerprint(),installed);assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  assert.equal(unaffected(),originalFunctions);assert.equal(metadata(),originalMetadata);
  const tempCount=d.exec("select count(*) from pg_class where relnamespace=pg_my_temp_schema() and relkind in('r','p');");assert.equal(tempCount,'0');
  native.pass('195 install/reentry: 28 exact forward signatures, two private tables, all old facts/OID/metadata and fixed archives preserved');
  const {verifyAdministrativeClosureNative}=await import('./fixtures/attendance-administrative-closure-native.mjs');let acceptance;
  try{acceptance=await verifyAdministrativeClosureNative(ctx);}
  finally{
   assert.equal(d.fingerprint(),installed,'administrative_fixture_not_rolled_back');assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
   assert.equal(unaffected(),originalFunctions);assert.equal(metadata(),originalMetadata);
   assert.deepEqual(periodContinuationArchiveBytes(await archive()),old155);assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),old207);
  }
  assert.equal(acceptance.rollbackRestored,true);
  native.pass('195 A/B/C: actual present closure, four old-finish refusals and new starts, disclosed historical templates and real old/new period decisions; full rollback');
  assert(ctx.posthocAdministrativeEvents&&typeof ctx.posthocAdministrativeEvents.arm==='function'&&typeof ctx.posthocAdministrativeEvents.seal==='function','administrative_parent_event_capability_required');
  ctx.posthocAdministrativeEvents.arm();
  const {verifyAdministrativeClosureRiskNative}=await import('./fixtures/attendance-administrative-closure-risk-native.mjs');
  const risk=await verifyAdministrativeClosureRiskNative(ctx);
  assert.equal(risk.cleanupOwnedByParent,true);assert.equal(risk.oldFactsUnchanged,true);assert.equal(risk.oneSettingsLockRaceWitnessed,true);
  assert.equal(unaffected(),originalFunctions);assert.equal(metadata(),originalMetadata);
  ctx.posthocAdministrativeEvents.seal();
  native.pass('195 finite risks: direct break closure/time bounds, exact late23514 rollback, actor/body isolation and original receipts, one actual settings close/restore lock witness; micro-commits cleaned by parent');
  const extension=after===null?null:await after(ctx);
  return {phase:195,acceptance,risk,installAndReentry:true,newTables:2,approvedForwardSignatures:28,oldFactsUnchanged:true,oldArchivesUnchanged:true,
   coreRollbackRestored:true,riskMicroCommitsCleanupOwnedByParent:true,cleanupOwnedByParent:true,newCluster:false,browser:false,realAuth:false,productionAccess:false,deployed:false,...(extension===null?{}:{extension})};
 },{capacity:'reuse_previous'});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runAdministrativeClosureNative(process.argv.slice(2))
 .then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(JSON.stringify({error:'administrative_closure_native_failed',detail:error?.stack??String(error)}));process.exitCode=1;});
