//205 INERT owned-context adapter. No CLI, cluster, dependency installer, copy,
//browser or earlier matrix. The caller alone owns the existing namespace.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {assertLifecycleSandbox,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody} from './fixtures/attendance-bound-clocks-native.mjs';
import {periodContinuationSerialization,periodContinuationArchiveBytes} from './fixtures/attendance-period-continuation-native.mjs';
import {managementAuditNativeInspectionSql,assertManagementAuditNativeOldState} from './merchant-attendance-management-audit-native.mjs';
import {delegatedConfigurationMigration,delegatedConfigurationInstallRecipe} from './merchant-attendance-delegated-configuration-source.mjs';
import {managementDelegationMigration,managementDelegationInstallRecipe} from './merchant-attendance-management-delegation-source.mjs';
import {delegatedGroupsNativePermissionsAclSql} from './merchant-attendance-delegated-groups-native.mjs';

export const delegatedConfigurationNativeLimits=Object.freeze({groups:8,rpcs:90,steps:140,installationSteps:12,transactionMs:90000,approvedMaximumMs:120000,
 statementMs:10000,lockMs:3000,connections:1,seedRows:7,newSites:1,newClusters:0,newDatabases:0,microcommits:0,browser:0});
export const delegatedConfigurationNativeSqlSha='4cd000b3eae1ea9b7e96308e86ffa1fd1ba4bcf097cc1cc1584f942a01b6656a';
const sha=s=>createHash('sha256').update(s.replaceAll('\r\n','\n'),'utf8').digest('hex');
export function delegatedConfigurationNativeSources(root){
 assert(path.isAbsolute(root));const dir=path.join(root,'scripts/supabase-migrations');
 const previous=readdirSync(dir).filter(n=>/^\d+_.+\.sql$/.test(n)&&n<delegatedConfigurationMigration).sort().map(name=>({name,text:readFileSync(path.join(dir,name),'utf8')}));
 const sql=readFileSync(path.join(dir,delegatedConfigurationMigration),'utf8');assert.equal(sha(sql),delegatedConfigurationNativeSqlSha,'delegated_configuration_frozen_SQL');
 const recipe=delegatedConfigurationInstallRecipe(sql,previous),parent=previous.find(f=>f.name===managementDelegationMigration);assert(parent);
 const forward=managementDelegationInstallRecipe(parent.text,previous.filter(f=>f.name<parent.name)).recipe.forward;
 const specs=[...recipe.dependencies,{...recipe.forward.legacy,hash:recipe.forward.legacy.oldHash},{...recipe.forward.guard,hash:recipe.forward.guard.oldHash},
  {...forward.catalog190,hash:forward.catalog190.newHash,legacyHash:forward.catalog185.newHash,isRpc:false},
  {...forward.capture,hash:forward.capture.newHash,isRpc:false}].map(f=>Object.fromEntries(['name','signature','hash','legacyHash','result','language','volatility','definer','defaults','defaultExpression','args','searchPath','isRpc']
   .filter(k=>Object.hasOwn(f,k)).map(k=>[k,f[k]])));
 assert.equal(new Set(specs.map(f=>f.signature)).size,specs.length);assert.equal(recipe.own.length,10);
 return Object.freeze({sql,recipe,specs:Object.freeze(specs)});
}
export function delegatedConfigurationNativeDependencySql(specs){
 assert(Array.isArray(specs)&&specs.length>40&&specs.length<50);
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
 'registry',(select jsonb_agg(jsonb_build_object('version',required.version,'expected',required.name,'actual',registry.name) order by required.version) from(values(202610060166::bigint,'merchant_attendance_employment_lifecycle'),(202610080204::bigint,'merchant_attendance_delegated_groups')) required(version,name) left join public.faolla_schema_migrations registry using(version)),
 'alreadyInstalled',exists(select 1 from public.faolla_schema_migrations where version=202610080205));`;
}
export function assertDelegatedConfigurationNativeDependencies(value,count){
 assert(value&&value.functions?.length===count&&value.registry?.length===2);assert.equal(value.alreadyInstalled,false,'delegated_configuration_forward_order');
 assert.deepEqual(value.registry.filter(v=>v.actual!==v.expected),[],'delegated_configuration_registry_prerequisites');
 assert.deepEqual(value.functions.filter(v=>v.failedFields.length),[],'delegated_configuration_dependency_body_metadata');return value;
}
export async function installAndVerifyDelegatedConfigurationNative(ctx,options={}){
 assert(options&&typeof options==='object'&&!Array.isArray(options)&&Object.keys(options).every(k=>k==='businessCases'),'delegated_configuration_native_options_invalid');
 const {businessCases='run'}=options;assert(['run','skip'].includes(businessCases),'delegated_configuration_native_business_cases_invalid');
 const {d,h,native,scope,archive,periodArchive}=ctx??{};assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);
 assert.equal(scope?.schema,d.owned.schema);assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
 const sources=delegatedConfigurationNativeSources(native.root);let installationSteps=0;
 const read=sql=>{assert(++installationSteps<=12,'delegated_configuration_install12steps');return d.exec(periodContinuationSerialization+sql);};
 const inventory=assertDelegatedConfigurationNativeDependencies(JSON.parse(read(delegatedConfigurationNativeDependencySql(sources.specs))),sources.specs.length);
 native.pass('205 read-only exact prerequisite inventory (no bodies): '+JSON.stringify(inventory));
 const names=d.inventory(),inspect=()=>JSON.parse(read(managementAuditNativeInspectionSql(names,d.owned.oid))),before=inspect();
 const old155=periodContinuationArchiveBytes(await archive()),old207=periodContinuationArchiveBytes(await periodArchive());
 const install=()=>{assert(++installationSteps<=12);d.exec(boundClockMigrationBody(native.root,delegatedConfigurationMigration));};
 install();const installed=inspect();assertManagementAuditNativeOldState(before,installed,['faolla_attendance_admin_v1','faolla_attendance_management_insert_v1']);
 assert.deepEqual(d.inventory(),names,'delegated_configuration_no_new_relations');assert.deepEqual(installed.tables,before.tables);assert.deepEqual(installed.indexes,before.indexes);
 assert.deepEqual(installed.registry.filter(r=>!before.registry.some(p=>p.version===r.version)).map(r=>[r.version,r.name]),[[202610080205,'merchant_attendance_delegated_configuration']]);
 assert.deepEqual(installed.functions.filter(f=>!before.functions.some(p=>p.oid===f.oid)).map(f=>f.name).sort(),sources.recipe.own.map(f=>f.name).sort());
 install();assert.deepEqual(inspect(),installed,'delegated_configuration_reentry_exact_all_objects');
 assert.equal(read("select count(*) from pg_class where relnamespace=pg_my_temp_schema() and relkind in('r','p');"),'0');
 native.pass('205 install/reentry:2 pinned body forwards/10 private or service functions;0 tables, old facts/OID/ACL/defaults/indexes preserved');
 const facts=d.fingerprint(),defs=d.definitions(),catalog=d.tableCatalog();let acceptance=null;
 try{if(businessCases==='run')acceptance=await(await import('./fixtures/attendance-delegated-configuration-native.mjs')).verifyDelegatedConfigurationNative(ctx);}
 finally{assert.equal(d.fingerprint(),facts,'delegated_configuration_fixture_full_rollback');assert.equal(d.definitions(),defs);assert.equal(d.tableCatalog(),catalog);
  assert.deepEqual(periodContinuationArchiveBytes(await archive()),old155);assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),old207);}
 if(businessCases==='run'){assert.equal(acceptance.groups.length,8);assert(acceptance.rpcs<=90&&acceptance.steps<=140);}
 return{phase:205,installAndReentry:true,installationSteps,dependencyInventory:inventory,newTables:0,newFunctions:10,pinnedForwardBodies:2,acceptance,businessCasesExecuted:businessCases==='run',
  oldFactsUnchanged:true,oldOidAclDefaultsUnchanged:true,oldArchivesUnchanged:true,rollbackRestored:businessCases==='run'?true:null,cleanupOwnedByParent:true,realAuth:false,browser:false,production:false,deployed:false};
}
