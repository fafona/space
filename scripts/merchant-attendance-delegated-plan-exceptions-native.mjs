//209 INERT owned-context extension. Only the existing parent owns the local
//synthetic database and cleanup. Import starts no process, Auth, KDF or browser.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {assertLifecycleSandbox,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody} from './fixtures/attendance-bound-clocks-native.mjs';
import {periodContinuationSerialization,periodContinuationArchiveBytes} from './fixtures/attendance-period-continuation-native.mjs';
import {managementAuditNativeInspectionSql,assertManagementAuditNativeOldState} from './merchant-attendance-management-audit-native.mjs';
import {delegatedPlanExceptionsMigration,delegatedPlanExceptionsInstallRecipe} from './merchant-attendance-delegated-plan-exceptions-source.mjs';
import {delegatedGroupsNativePermissionsAclSql} from './merchant-attendance-delegated-groups-native.mjs';

export const delegatedPlanExceptionsNativeLimits=Object.freeze({groups:8,rpcs:90,steps:140,installationSteps:12,transactionMs:120000,
 statementMs:10000,lockMs:3000,connections:3,races:1,polls:16,newSites:1,newTables:0,newClusters:0,newDatabases:0,microcommits:0,
 browser:0,realAuth:0,kdf:0,production:0});
export const delegatedPlanExceptionsNativeSqlSha='779836ce3a3d13e9a817deb31a49cbd9151f33571f1f5d360ce085dc7b23da49';
const sha=s=>createHash('sha256').update(s.replaceAll('\r\n','\n'),'utf8').digest('hex');
export function delegatedPlanExceptionsNativeSources(root){
 assert(path.isAbsolute(root));const directory=path.join(root,'scripts/supabase-migrations');
 const previous=readdirSync(directory).filter(name=>/^\d+_.+\.sql$/.test(name)&&name<delegatedPlanExceptionsMigration).sort()
  .map(name=>({name,text:readFileSync(path.join(directory,name),'utf8')}));
 const sql=readFileSync(path.join(directory,delegatedPlanExceptionsMigration),'utf8');assert.equal(sha(sql),delegatedPlanExceptionsNativeSqlSha,'delegated_plan_exceptions_frozen_SQL');
 const recipe=delegatedPlanExceptionsInstallRecipe(sql,previous),forwards=[...recipe.forward.cores,recipe.forward.guard];
 assert.equal(forwards.length,3);assert.equal(new Set(forwards.map(f=>f.signature)).size,3);
 assert.equal(recipe.own.length,13);assert.equal(recipe.own.filter(f=>f.isRpc).length,1);assert.equal(recipe.dependencies.length,159);
 assert.equal(recipe.templates.tables.length,25);assert.equal(recipe.templates.extraTables.length,7);assert.equal(recipe.triggerManifest.length,52);
 const specs=recipe.dependencySpecs.map(f=>Object.fromEntries(['name','signature','hash','legacyHash','result','language','volatility','definer','defaults','defaultExpression','args','searchPath','isRpc']
  .filter(k=>Object.hasOwn(f,k)).map(k=>[k,f[k]])));
 assert.equal(specs.length,163);assert.equal(new Set(specs.map(f=>f.signature)).size,163);
 return Object.freeze({sql,recipe,forwards:Object.freeze(forwards),specs:Object.freeze(specs)});
}
// Bounded, read-only failure diagnostics for the SAME163 pinned function specs
// and every metadata/ACL predicate used by the generated preflight. No bodies,
// employee records or permission values are returned. Installation still runs
// every original guard, including all table/index/trigger/view predicates.
export function delegatedPlanExceptionsNativeDependencySql(specs){
 assert(Array.isArray(specs)&&specs.length===163&&new Set(specs.map(f=>f.signature)).size===163,'delegated_plan_exceptions_dependency163');
 return `with specs as(select value spec from jsonb_array_elements(${json(specs)})),
 owned as(select namespace.nspname,catalog_table.relowner from pg_class catalog_table join pg_namespace namespace on namespace.oid=catalog_table.relnamespace where catalog_table.oid='public.merchant_attendance_settings'::regclass),
 checked as(select spec->>'signature' signature,case when spec ? 'legacyHash' and not exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission') then spec->>'legacyHash' else spec->>'hash' end expected_hash,
 encode(sha256(convert_to(replace(replace(proc.prosrc,E'\\r\\n',E'\\n'),owned.nspname||'.','pub'||'lic.'),'UTF8')),'hex') actual_hash,
 array_remove(array[
 case when proc.oid is null then 'missing' end,case when proc.proowner is distinct from owned.relowner then 'owner' end,
 case when proc.prosecdef is distinct from (spec->>'definer')::boolean or proc.proconfig is distinct from array[replace(spec->>'searchPath','public',owned.nspname)] then 'security_config' end,
 case when proc.provolatile::text is distinct from spec->>'volatility' or language.lanname is distinct from spec->>'language' then 'language_volatility' end,
 case when proc.prorettype is distinct from to_regtype(replace(spec->>'result','public.',owned.nspname||'.')) or proc.proretset or proc.proisstrict or proc.proleakproof then 'result_flags' end,
 case when proc.prokind<>'f' or proc.proparallel<>'u' or proc.prosupport<>0::oid or proc.proallargtypes is not null or proc.proargmodes is not null then 'execution_metadata' end,
 case when coalesce(proc.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'args')) or proc.pronargs is distinct from jsonb_array_length(spec->'args') then 'argnames' end,
 case when proc.pronargdefaults is distinct from (spec->>'defaults')::integer or pg_get_expr(proc.proargdefaults,0) is distinct from spec->>'defaultExpression' then 'defaults' end,
 case when proc.procost<>100 or proc.prorows<>0 or (select count(*) from pg_proc same_name where same_name.pronamespace=proc.pronamespace and same_name.proname=proc.proname)<>1 then 'cost_overload' end,
 ${delegatedGroupsNativePermissionsAclSql()}
 ]::text[],null) failures from specs cross join owned left join pg_proc proc on proc.oid=to_regprocedure(replace(spec->>'signature','public.',owned.nspname||'.')) left join pg_language language on language.oid=proc.prolang)
 select jsonb_build_object('functions',(select jsonb_agg(jsonb_build_object('signature',signature,'expectedHash',expected_hash,'actualHash',actual_hash,'failedFields',to_jsonb(failures)||case when actual_hash is distinct from expected_hash then '["source_hash"]'::jsonb else '[]'::jsonb end) order by signature) from checked),
 'registry',(select jsonb_agg(jsonb_build_object('version',required.version,'expected',required.name,'actual',registry.name) order by required.version) from(values(202610050136::bigint,'merchant_attendance_schedule_publication_evidence'),(202610060174::bigint,'merchant_attendance_plan_posthoc_reviews'),(202610080184::bigint,'merchant_attendance_period_delegated_source'),(202610080195::bigint,'merchant_attendance_administrative_closure'),(202610080208::bigint,'merchant_attendance_delegated_revisions')) required(version,name) left join public.faolla_schema_migrations registry using(version)),
 'alreadyInstalled',exists(select 1 from public.faolla_schema_migrations where version=202610090209));`;
}
export function assertDelegatedPlanExceptionsNativeDependencies(value){
 assert(value&&value.functions?.length===163&&value.registry?.length===5,'delegated_plan_exceptions_dependency_inventory');
 assert.equal(value.alreadyInstalled,false,'delegated_plan_exceptions_forward_order');
 assert.deepEqual(value.registry.filter(v=>v.actual!==v.expected),[],'delegated_plan_exceptions_registry_prerequisites');
 assert.deepEqual(value.functions.filter(v=>v.failedFields.length),[],'delegated_plan_exceptions_dependency_body_metadata');return value;
}
export function delegatedPlanExceptionsNativeOptions(options={}){
 assert(options&&typeof options==='object'&&!Array.isArray(options)&&Object.keys(options).every(k=>k==='businessCases'),'delegated_plan_exceptions_native_options');
 const {businessCases='run'}=options;assert(['run','skip'].includes(businessCases),'delegated_plan_exceptions_native_business_cases');return Object.freeze({businessCases});
}
export async function installAndVerifyDelegatedPlanExceptionsNative(ctx,options={}){
 const {businessCases}=delegatedPlanExceptionsNativeOptions(options),{d,h,native,scope,archive,periodArchive}=ctx??{};
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true,'delegated_plan_exceptions_owned_context_required');
 assert.equal(scope?.schema,d.owned.schema);assert.equal(typeof archive,'function');assert.equal(typeof periodArchive,'function');
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
 const sources=delegatedPlanExceptionsNativeSources(native.root);let installationSteps=0;
 const read=sql=>{assert(++installationSteps<=12,'delegated_plan_exceptions_install12steps');return d.exec(periodContinuationSerialization+sql);};
 const inventory=assertDelegatedPlanExceptionsNativeDependencies(JSON.parse(read(delegatedPlanExceptionsNativeDependencySql(sources.specs))));
 native.pass('209 read-only exact prerequisite inventory:163 function signatures/hashes/metadata/ACL;5 required registries; no bodies');
 assert.equal(read("select name from public.faolla_schema_migrations where version=202610080208;"),'merchant_attendance_delegated_revisions');
 const names=d.inventory(),inspect=()=>JSON.parse(read(managementAuditNativeInspectionSql(names,d.owned.oid))),before=inspect();
 const old155=periodContinuationArchiveBytes(await archive()),oldPeriod=periodContinuationArchiveBytes(await periodArchive());
 const install=()=>{assert(++installationSteps<=12,'delegated_plan_exceptions_install12steps');d.exec(boundClockMigrationBody(native.root,delegatedPlanExceptionsMigration));};
 //The migration pins all159 recursive dependencies, the selected catalog,
 //three exact forwards,25 old tables,52 triggers and the current-effect view.
 install();const installed=inspect();
 assertManagementAuditNativeOldState(before,installed,sources.forwards.map(f=>f.name));
 assert.deepEqual(d.inventory(),names,'delegated_plan_exceptions_no_new_business_relations');
 assert.deepEqual(installed.registry.filter(row=>!before.registry.some(old=>old.version===row.version)).map(row=>[row.version,row.name]),[[202610090209,'merchant_attendance_delegated_plan_exceptions']]);
 assert.deepEqual(installed.functions.filter(f=>!before.functions.some(old=>old.oid===f.oid)).map(f=>f.name).sort(),sources.recipe.own.map(f=>f.name).sort());
 const baseline=inspect();install();assert.deepEqual(inspect(),baseline,'delegated_plan_exceptions_reentry_exact_all_objects');
 assert.equal(read("select count(*) from pg_class where relnamespace=pg_my_temp_schema() and relkind in('r','p','v');"),'0');
 native.pass('209 install/reentry:3 exact body forwards/13 own functions/no new permanent tables; full old facts/OID/ACL/catalog preserved');
 const facts=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();let acceptance=null;
 try{if(businessCases==='run')acceptance=await(await import('./fixtures/attendance-delegated-plan-exceptions-native.mjs')).verifyDelegatedPlanExceptionsNative(ctx);}
 finally{
  assert.equal(d.fingerprint(),facts,'delegated_plan_exceptions_fixture_full_rollback');assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  assert.deepEqual(periodContinuationArchiveBytes(await archive()),old155);assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),oldPeriod);
 }
 if(businessCases==='run'){assert.equal(acceptance.groups.length,8);assert(acceptance.rpcs<=90&&acceptance.steps<=140);assert.equal(acceptance.rollbackRestored,true);}
 return{phase:209,businessCasesExecuted:businessCases==='run',installAndReentry:true,installationSteps,dependencyInventory:inventory,newTables:0,newFunctions:13,pinnedForwardBodies:3,acceptance,
  oldFactsUnchanged:true,oldOidAclDefaultsUnchanged:true,oldArchivesUnchanged:true,rollbackRestored:businessCases==='run'?true:null,
  cleanupOwnedByParent:true,newCluster:false,newDatabase:false,realAuth:false,browser:false,kdf:false,production:false,deployed:false};
}


