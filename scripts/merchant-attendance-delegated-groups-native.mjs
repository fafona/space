//204 INERT owned-context adapter. No CLI, cluster, dependency installer, copy,
//browser or earlier matrix. The caller alone owns the existing namespace.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {assertLifecycleSandbox,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody} from './fixtures/attendance-bound-clocks-native.mjs';
import {periodContinuationSerialization,periodContinuationArchiveBytes} from './fixtures/attendance-period-continuation-native.mjs';
import {managementAuditNativeInspectionSql,assertManagementAuditNativeOldState} from './merchant-attendance-management-audit-native.mjs';
import {delegatedGroupsMigration,delegatedGroupsInstallRecipe} from './merchant-attendance-delegated-groups-source.mjs';
import {managementDelegationMigration,managementDelegationInstallRecipe} from './merchant-attendance-management-delegation-source.mjs';

export const delegatedGroupsNativeLimits=Object.freeze({groups:8,rpcs:90,steps:140,installationSteps:12,transactionMs:90000,
 statementMs:10000,lockMs:3000,connections:1,seedRows:9,newSites:1,newClusters:0,newDatabases:0,microcommits:0,browser:0});
export const delegatedGroupsNativeSqlSha='74b10f29b03e555ddb033bf4cd70ee02c2c4bf5dffbb14e793eecbd42cfdf2f3';
const sha=s=>createHash('sha256').update(s.replaceAll('\r\n','\n'),'utf8').digest('hex');
export function delegatedGroupsNativeSources(root){
 assert(path.isAbsolute(root));const dir=path.join(root,'scripts/supabase-migrations');
 const previous=readdirSync(dir).filter(n=>/^\d+_.+\.sql$/.test(n)&&n<delegatedGroupsMigration).sort().map(name=>({name,text:readFileSync(path.join(dir,name),'utf8')}));
 const sql=readFileSync(path.join(dir,delegatedGroupsMigration),'utf8');assert.equal(sha(sql),delegatedGroupsNativeSqlSha,'delegated_groups_frozen_SQL');
 const recipe=delegatedGroupsInstallRecipe(sql,previous),parent=previous.find(f=>f.name===managementDelegationMigration);assert(parent);
 const forward=managementDelegationInstallRecipe(parent.text,previous.filter(f=>f.name<parent.name)).recipe.forward;
 const specs=[...recipe.dependencies,{...recipe.forward.legacy,hash:recipe.forward.legacy.oldHash},{...recipe.forward.guard,hash:recipe.forward.guard.oldHash},
  {...forward.catalog190,hash:forward.catalog190.newHash,legacyHash:forward.catalog185.newHash,isRpc:false},
  {...forward.capture,hash:forward.capture.newHash,isRpc:false}].map(f=>Object.fromEntries(['name','signature','hash','legacyHash','result','language','volatility','definer','defaults','defaultExpression','args','searchPath','isRpc']
   .filter(k=>Object.hasOwn(f,k)).map(k=>[k,f[k]])));
 assert.equal(new Set(specs.map(f=>f.signature)).size,specs.length);assert.equal(recipe.own.length,9);
 return Object.freeze({sql,recipe,specs:Object.freeze(specs)});
}
//Match the selected, fully body/metadata-pinned pure catalog helper's original
//ACL without modifying it:026 hardening is owner-only, while an owned parent
//created without026 retains PostgreSQL's owner+PUBLIC EXECUTE default. No
//explicit service/anon/auth/other role, grantor drift or grant option is valid.
export function delegatedGroupsNativePermissionsAclSql(){
 return `case when has_function_privilege(owned.relowner,proc.oid,'EXECUTE') is distinct from true
  or (case when spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' and spec->>'signature'='public.faolla_valid_merchant_enterprise_permissions_v1(text[])'
   then (select coalesce(jsonb_agg(jsonb_build_array(acl.grantor,acl.grantee,acl.privilege_type,acl.is_grantable) order by acl.grantee,acl.grantor,acl.privilege_type,acl.is_grantable),'[]')
    from aclexplode(coalesce(proc.proacl,acldefault('f',proc.proowner))) acl) not in(
     jsonb_build_array(jsonb_build_array(owned.relowner,owned.relowner,'EXECUTE',false)),
     jsonb_build_array(jsonb_build_array(owned.relowner,0::oid,'EXECUTE',false),jsonb_build_array(owned.relowner,owned.relowner,'EXECUTE',false)))
   else has_function_privilege('anon',proc.oid,'EXECUTE') or has_function_privilege('authenticated',proc.oid,'EXECUTE')
    or has_function_privilege('service_role',proc.oid,'EXECUTE') is distinct from (spec->>'isRpc')::boolean
    or exists(select 1 from aclexplode(coalesce(proc.proacl,acldefault('f',proc.proowner))) acl where acl.grantor<>owned.relowner or acl.grantee<>owned.relowner
     and ((spec->>'isRpc')::boolean is distinct from true or acl.grantee<>(select oid from pg_roles where rolname='service_role') or acl.privilege_type<>'EXECUTE' or acl.is_grantable)) end)
  then 'ACL' end`;
}
export function delegatedGroupsNativeDependencySql(specs){
 assert(Array.isArray(specs)&&specs.length>20&&specs.length<40);
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
 'registry',(select jsonb_agg(jsonb_build_object('version',required.version,'expected',required.name,'actual',registry.name) order by required.version) from(values(202610030124::bigint,'merchant_attendance_groups'),(202610080202::bigint,'merchant_attendance_management_delegations'),(202610080203::bigint,'merchant_attendance_delegated_audit')) required(version,name) left join public.faolla_schema_migrations registry using(version)),
 'alreadyInstalled',exists(select 1 from public.faolla_schema_migrations where version=202610080204));`;
}
export function assertDelegatedGroupsNativeDependencies(value,count){
 assert(value&&value.functions?.length===count&&value.registry?.length===3);assert.equal(value.alreadyInstalled,false,'delegated_groups_forward_order');
 assert.deepEqual(value.registry.filter(v=>v.actual!==v.expected),[],'delegated_groups_registry_prerequisites');
 assert.deepEqual(value.functions.filter(v=>v.failedFields.length),[],'delegated_groups_dependency_body_metadata');return value;
}
export async function installAndVerifyDelegatedGroupsNative(ctx,options={}){
 assert(options&&typeof options==='object'&&!Array.isArray(options)&&Object.keys(options).every(k=>k==='businessCases'),'delegated_groups_native_options_invalid');
 const {businessCases='run'}=options;assert(['run','skip'].includes(businessCases),'delegated_groups_native_business_cases_invalid');
 const {d,h,native,scope,archive,periodArchive}=ctx??{};assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);
 assert.equal(scope?.schema,d.owned.schema);assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
 const sources=delegatedGroupsNativeSources(native.root);let installationSteps=0;
 const read=sql=>{assert(++installationSteps<=12,'delegated_groups_install12steps');return d.exec(periodContinuationSerialization+sql);};
 const inventory=assertDelegatedGroupsNativeDependencies(JSON.parse(read(delegatedGroupsNativeDependencySql(sources.specs))),sources.specs.length);
 native.pass('204 read-only exact prerequisite inventory (no bodies): '+JSON.stringify(inventory));
 const names=d.inventory(),inspect=()=>JSON.parse(read(managementAuditNativeInspectionSql(names,d.owned.oid))),before=inspect();
 const old155=periodContinuationArchiveBytes(await archive()),old207=periodContinuationArchiveBytes(await periodArchive());
 const install=()=>{assert(++installationSteps<=12);d.exec(boundClockMigrationBody(native.root,delegatedGroupsMigration));};
 install();const installed=inspect();assertManagementAuditNativeOldState(before,installed,['faolla_attendance_groups_v1','faolla_attendance_management_insert_v1']);
 assert.deepEqual(d.inventory(),names,'delegated_groups_no_new_relations');assert.deepEqual(installed.tables,before.tables);assert.deepEqual(installed.indexes,before.indexes);
 assert.deepEqual(installed.registry.filter(r=>!before.registry.some(p=>p.version===r.version)).map(r=>[r.version,r.name]),[[202610080204,'merchant_attendance_delegated_groups']]);
 assert.deepEqual(installed.functions.filter(f=>!before.functions.some(p=>p.oid===f.oid)).map(f=>f.name).sort(),sources.recipe.own.map(f=>f.name).sort());
 install();assert.deepEqual(inspect(),installed,'delegated_groups_reentry_exact_all_objects');
 assert.equal(read("select count(*) from pg_class where relnamespace=pg_my_temp_schema() and relkind in('r','p');"),'0');
 native.pass('204 install/reentry:2 pinned body forwards/9 private or service functions;0 tables, old facts/OID/ACL/defaults/indexes preserved');
 const facts=d.fingerprint(),defs=d.definitions(),catalog=d.tableCatalog();let acceptance=null;
 try{if(businessCases==='run')acceptance=await(await import('./fixtures/attendance-delegated-groups-native.mjs')).verifyDelegatedGroupsNative(ctx);}
 finally{assert.equal(d.fingerprint(),facts,'delegated_groups_fixture_full_rollback');assert.equal(d.definitions(),defs);assert.equal(d.tableCatalog(),catalog);
  assert.deepEqual(periodContinuationArchiveBytes(await archive()),old155);assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),old207);}
 if(businessCases==='run'){assert.equal(acceptance.groups.length,8);assert(acceptance.rpcs<=90&&acceptance.steps<=140);}
 return{phase:204,installAndReentry:true,installationSteps,dependencyInventory:inventory,newTables:0,newFunctions:9,pinnedForwardBodies:2,acceptance,businessCasesExecuted:businessCases==='run',
  oldFactsUnchanged:true,oldOidAclDefaultsUnchanged:true,oldArchivesUnchanged:true,rollbackRestored:businessCases==='run'?true:null,cleanupOwnedByParent:true,realAuth:false,browser:false,production:false,deployed:false};
}
