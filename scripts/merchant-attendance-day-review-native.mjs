//199 INERT owned-context adapter. Importing never starts a database, installs
//dependencies, opens a browser or reruns an earlier acceptance matrix.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {assertLifecycleSandbox,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './fixtures/attendance-outage-native.mjs';
import {periodContinuationSerialization,periodContinuationArchiveBytes} from './fixtures/attendance-period-continuation-native.mjs';

export const dayReviewNativeMigration='202610080199_merchant_attendance_day_reviews.sql';
export const dayReviewNativeTables=Object.freeze(['merchant_attendance_day_review_cases','merchant_attendance_day_review_entries']);
export const dayReviewNativeLimits=Object.freeze({groups:8,steps:220,fixtureMs:180000,statementMs:10000,lockMs:3000,
 rpcs:180,raceSteps:12,maxConnections:3,newClusters:0,newDatabases:0,browser:0,externalAuth:0,kdfCalls:0});
export const dayReviewNativePrerequisites=Object.freeze([
 Object.freeze({version:202610060173,name:'merchant_attendance_plan_posthoc_formal_source'}),
 Object.freeze({version:202610070179,name:'merchant_attendance_outage_periods'}),
 Object.freeze({version:202610080185,name:'merchant_attendance_period_delegations'}),
 Object.freeze({version:202610080191,name:'merchant_attendance_operational_rules'}),
 Object.freeze({version:202610080195,name:'merchant_attendance_administrative_closure'}),
]);
export function dayReviewNativeDependencies(body){
 assert.equal(typeof body,'string');
 const found=body.match(/\$day_review_dependencies\$([\s\S]*?)\$day_review_dependencies\$/);assert(found,'day_review_exact_dependency_manifest');
 const functions=JSON.parse(found[1]);assert.equal(functions.length,25);assert.equal(new Set(functions.map(f=>f.signature)).size,25);
 for(const f of functions){assert.match(f.name,/^faolla_[a-z0-9_]+$/);assert.match(f.signature,/^public\.faolla_[a-z0-9_]+\([a-z0-9_.,\[\] ]+\)$/);
  assert.match(f.hash,/^[a-f0-9]{64}$/);assert(Array.isArray(f.args)&&f.args.length<=8);assert.equal(typeof f.isRpc,'boolean');}
 const relations=[...new Set([...body.matchAll(/\bpublic\.((?:merchant_[a-z0-9_]+|merchants|faolla_schema_migrations))\b/g)].map(m=>m[1]))]
  .filter(n=>!dayReviewNativeTables.includes(n)).sort();assert(relations.length>20&&relations.length<=80);
 return Object.freeze({functions:Object.freeze(functions),relations:Object.freeze(relations)});
}
//All25 actual/expected hashes and finite metadata failure names are returned
//together before installation; no bodies, PINs or source evidence are logged.
export function dayReviewNativeDependencyDiagnosticSql(body){
 const {functions,relations}=dayReviewNativeDependencies(body);
 return `with dependency as(select value spec from jsonb_array_elements(${json(functions)})),
 owned as(select namespace.nspname,catalog_table.relowner from pg_class catalog_table join pg_namespace namespace on namespace.oid=catalog_table.relnamespace
  where catalog_table.oid='public.merchant_attendance_settings'::regclass),
 checked as(select spec->>'signature' signature,case when spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1'
  and not exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission')
  then spec->>'legacyHash' else spec->>'hash' end expected_hash,
  encode(sha256(convert_to(replace(replace(proc.prosrc,E'\\r\\n',E'\\n'),owned.nspname||'.','pub'||'lic.'),'UTF8')),'hex') actual_hash,
  array_remove(array[
   case when proc.oid is null then 'missing' end,
   case when proc.proowner is distinct from owned.relowner then 'owner' end,
   case when proc.prosecdef is distinct from (spec->>'definer')::boolean then 'security_definer' end,
   case when proc.proconfig is distinct from array[replace(spec->>'searchPath','public',owned.nspname)] then 'config' end,
   case when proc.provolatile::text is distinct from spec->>'volatility' then 'volatility' end,
   case when language.lanname is distinct from spec->>'language' then 'language' end,
   case when proc.prorettype is distinct from to_regtype(spec->>'result') then 'result' end,
   case when proc.prokind is distinct from 'f'::"char" or proc.proparallel is distinct from 'u'::"char" or proc.prosupport is distinct from 0::oid then 'execution_metadata' end,
   case when proc.proretset is distinct from false or proc.proisstrict is distinct from false or proc.proleakproof is distinct from false then 'execution_flags' end,
   case when proc.proallargtypes is not null or proc.proargmodes is not null or proc.pronargs is distinct from jsonb_array_length(spec->'args') then 'argument_modes' end,
   case when coalesce(proc.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'args')) then 'argnames' end,
   case when proc.pronargdefaults is distinct from (spec->>'defaults')::integer or pg_get_expr(proc.proargdefaults,0) is distinct from spec->>'defaultExpression' then 'defaults' end,
   case when proc.procost is distinct from 100::real or proc.prorows is distinct from 0::real then 'cost_rows' end,
   case when (select count(*) from pg_proc same_name where same_name.pronamespace=proc.pronamespace and same_name.proname=proc.proname)<>1 then 'overload' end,
   case when has_function_privilege(owned.relowner,proc.oid,'EXECUTE') is distinct from true then 'owner_execute' end,
   case when spec->>'name'<>'faolla_valid_merchant_enterprise_permissions_v1' and (has_function_privilege('anon',proc.oid,'EXECUTE')
    or has_function_privilege('authenticated',proc.oid,'EXECUTE') or has_function_privilege('service_role',proc.oid,'EXECUTE') is distinct from (spec->>'isRpc')::boolean
    or exists(select 1 from aclexplode(coalesce(proc.proacl,acldefault('f',proc.proowner))) acl where acl.grantor<>owned.relowner or acl.grantee<>owned.relowner
     and ((spec->>'isRpc')::boolean is distinct from true or acl.grantee<>(select oid from pg_roles where rolname='service_role') or acl.privilege_type<>'EXECUTE' or acl.is_grantable))) then 'acl' end
  ]::text[],null) failed_fields
 from dependency cross join owned left join pg_proc proc on proc.oid=to_regprocedure(spec->>'signature') left join pg_language language on language.oid=proc.prolang)
 select jsonb_build_object('dependencies',(select jsonb_agg(jsonb_build_object('signature',signature,'expectedHash',expected_hash,'actualHash',actual_hash,
  'failedFields',to_jsonb(failed_fields)||case when actual_hash is distinct from expected_hash then '["source_hash"]'::jsonb else '[]'::jsonb end) order by signature) from checked),
  'missingRelations',(select coalesce(jsonb_agg(name order by name),'[]') from jsonb_array_elements_text(${json(relations)}) relation_names(name) where to_regclass('public.'||name) is null),
  'registry',(select jsonb_agg(jsonb_build_object('version',wanted->'version','expected',wanted->'name','actual',registry.name) order by wanted->>'version')
   from jsonb_array_elements(${json(dayReviewNativePrerequisites)}) wanted left join public.faolla_schema_migrations registry on registry.version=(wanted->>'version')::bigint));`;
}
export function assertDayReviewNativeDependencies(d,body,report=null){
 assert(report===null||typeof report==='function','day_review_local_dependency_report_invalid');
 const inventory=JSON.parse(d.exec(dayReviewNativeDependencyDiagnosticSql(body)));
 assert.deepEqual(Object.keys(inventory).sort(),['dependencies','missingRelations','registry']);assert.equal(inventory.dependencies.length,25);
 if(report!==null)report(inventory);
 const failures=inventory.dependencies.filter(x=>x.failedFields.length>0);
 assert.deepEqual(inventory.missingRelations,[],'day_review_missing_relations');
 assert.deepEqual(inventory.registry.filter(x=>x.actual!==x.expected),[],'day_review_registry_prerequisites');
 assert.deepEqual(failures,[],`day_review_dependency_metadata_mismatch:${JSON.stringify(failures)}`);return inventory;
}
export const dayReviewNativeFacts=(d,tables)=>d.exec('begin;'+periodContinuationSerialization+'select '+outageNativeFingerprintSql(tables)+';rollback;');
export async function installAndVerifyDayReviewNative(ctx,options={}){
 assert(options&&typeof options==='object'&&!Array.isArray(options)&&Object.keys(options).every(k=>k==='businessCases'),'day_review_native_options_invalid');
 const {businessCases='run'}=options;assert(['run','skip'].includes(businessCases),'day_review_native_business_cases_invalid');
 const {d,h,native,scope,archive,periodArchive}=ctx??{};
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true,'day_review_owned_context_required');
 assert.equal(typeof native?.query,'function');assert.equal(typeof native?.connect,'function');assert.equal(scope?.schema,d.owned.schema);
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
 const raw=readFileSync(path.join(native.root,'scripts/supabase-migrations',dayReviewNativeMigration),'utf8');
 const inventory=assertDayReviewNativeDependencies(d,raw,value=>native.pass('199 read-only prerequisite inventory (all25; no source bodies): '+JSON.stringify(value)));
 const oldTables=d.inventory().filter(n=>n!=='faolla_schema_migrations'),oldFacts=dayReviewNativeFacts(d,oldTables),oldCatalog=JSON.parse(d.tableCatalog());
 const old155=periodContinuationArchiveBytes(await archive()),old207=periodContinuationArchiveBytes(await periodArchive());
 const oldOids=d.exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f';`);
 const oldFunctions=()=>d.exec(`select md5(jsonb_agg(jsonb_build_array(to_jsonb(proc),pg_get_functiondef(proc.oid)) order by proc.oid)::text)
  from pg_proc proc where proc.oid=any(${quote(oldOids)}::oid[]);`),oldDefinitions=oldFunctions();
 const install=()=>d.exec(boundClockMigrationBody(native.root,dayReviewNativeMigration));install();
 assert.equal(dayReviewNativeFacts(d,oldTables),oldFacts,'day_review_install_old_facts');assert.equal(oldFunctions(),oldDefinitions,'day_review_install_old_OID_metadata_ACL');
 assert.deepEqual(JSON.parse(d.tableCatalog()).filter(t=>oldCatalog.some(old=>old[0]===t[0])),oldCatalog,'day_review_install_old_catalog');
 assert.deepEqual(d.inventory().filter(n=>n!=='faolla_schema_migrations'&&!oldTables.includes(n)).sort(),dayReviewNativeTables);
 const installed=dayReviewNativeFacts(d,d.inventory()),definitions=d.definitions(),catalog=d.tableCatalog();install();
 assert.equal(dayReviewNativeFacts(d,d.inventory()),installed,'day_review_reentry_facts');assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
 assert.equal(oldFunctions(),oldDefinitions);assert.equal(d.exec("select count(*) from pg_class where relnamespace=pg_my_temp_schema() and relkind in('r','p');"),'0');
 native.pass('199 installation/reentry: only2 new private tables/15 own functions; exact old facts/OIDs/ACL/catalog unchanged; TEMP parser templates released');
 if(businessCases==='skip'){
  assert.equal(dayReviewNativeFacts(d,d.inventory()),installed,'day_review_skip_installed_facts');
  assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);assert.equal(oldFunctions(),oldDefinitions);
  assert.deepEqual(periodContinuationArchiveBytes(await archive()),old155);assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),old207);
  return {phase:199,dependencyInventory:inventory,acceptance:null,businessCasesExecuted:false,installAndReentry:true,newTables:2,
   oldFactsUnchanged:true,oldFunctionsOidAclUnchanged:true,oldArchivesUnchanged:true,coreRollbackRestored:null,race:null,rollbackRestored:null,raceCommittedOwnRows:0,
   cleanupOwnedByParent:true,newCluster:false,browser:false,realAuth:false,productionAccess:false,deployed:false};
 }
 const fixture=await import('./fixtures/attendance-day-review-native.mjs');let acceptance;
 try{acceptance=await fixture.verifyDayReviewNative(ctx);}
 finally{
  assert.equal(dayReviewNativeFacts(d,d.inventory()),installed,'day_review_fixture_not_rolled_back');assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  assert.equal(oldFunctions(),oldDefinitions);assert.deepEqual(periodContinuationArchiveBytes(await archive()),old155);assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),old207);
 }
 assert.equal(acceptance.groups.length,dayReviewNativeLimits.groups);assert(acceptance.steps<=dayReviewNativeLimits.steps);assert(acceptance.rpcs<=dayReviewNativeLimits.rpcs);
 //Only after the complete main rollback guard: a single exact settings-lock
 //race may microcommit one case+entry. Never erase append-only rows; the parent
 //owns namespace cleanup, including error paths. All OLD tables remain exact.
 const raceOutside=d.inventory().filter(n=>!dayReviewNativeTables.includes(n)),raceFacts=dayReviewNativeFacts(d,raceOutside);let race;
 try{race=await fixture.verifyDayReviewNativeRace(ctx);}
 finally{
  assert.equal(dayReviewNativeFacts(d,raceOutside),raceFacts,'day_review_race_changed_old_facts');assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  assert.equal(oldFunctions(),oldDefinitions);assert.deepEqual(periodContinuationArchiveBytes(await archive()),old155);assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),old207);
 }
 assert.equal(race.committedOwnRows,2);assert(race.sqlStepsUpperBound<=dayReviewNativeLimits.raceSteps);
 return {phase:199,dependencyInventory:inventory,acceptance,businessCasesExecuted:true,installAndReentry:true,newTables:2,oldFactsUnchanged:true,oldFunctionsOidAclUnchanged:true,
  oldArchivesUnchanged:true,coreRollbackRestored:true,race,rollbackRestored:false,raceCommittedOwnRows:2,
  cleanupOwnedByParent:true,newCluster:false,browser:false,realAuth:false,productionAccess:false,deployed:false};
}
