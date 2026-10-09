//202→203 INERT, caller-owned acceptance adapter. No CLI, cluster, dependency
//implicit installer, browser or earlier acceptance matrix is started on import.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {assertLifecycleSandbox,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody} from './fixtures/attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './fixtures/attendance-outage-native.mjs';
import {periodContinuationSerialization,periodContinuationArchiveBytes} from './fixtures/attendance-period-continuation-native.mjs';
import {managementDelegationInstallRecipe,managementDelegationMigration,managementDelegationTables} from './merchant-attendance-management-delegation-source.mjs';
import {delegatedAuditInstallRecipe,delegatedAuditMigration,delegatedAuditTable} from './merchant-attendance-delegated-audit-source.mjs';
import {dayReviewSqlFunctions} from './merchant-attendance-day-review-source.mjs';
import {independentPermissionHelperName,independentPermissionAclConflictSql} from './merchant-attendance-independent-installation.mjs';

export const managementAuditNativeLimits=Object.freeze({groups:8,rpcs:90,steps:140,installationSteps:20,transactionMs:90000,
 approvedMaximumMs:120000,statementMs:10000,lockMs:3000,connections:1,seedRows:20,newSites:1,newClusters:0,newDatabases:0,microcommits:0,browser:0});
export const managementAuditNativePins=Object.freeze({
 [managementDelegationMigration]:'205ad7bd42860e5d71882fe42596af631f0e59b7242b514ba71e79eca39969c8',
 [delegatedAuditMigration]:'71cf9d25ccc2f3d53d60f0490fd02c8bb86939f2e99f00f9c90453a54648c0d0',
});
export const managementAuditNativePrerequisites=Object.freeze([
 {version:202609290064,name:'merchant_attendance_owner_configuration'},
 {version:202609290066,name:'merchant_attendance_scopes_records'},
 {version:202609300069,name:'merchant_attendance_audit_read'},
 {version:202609300080,name:'merchant_attendance_audit_export'},
 {version:202610080189,name:'merchant_attendance_correction_delegation'},
 {version:202610080196,name:'merchant_attendance_independent_workers'},
 {version:202610080198,name:'merchant_attendance_review_routing'},
 {version:202610080199,name:'merchant_attendance_day_reviews'},
].map(Object.freeze));
const sha=value=>createHash('sha256').update(value.replaceAll('\r\n','\n'),'utf8').digest('hex');
//Explicit, separately invoked setup for the two old read-only migrations that
//the existing195 parent does not install. Never a fallback inside202/203.
export const managementAuditNativeLegacyPins=Object.freeze({
 '202609300069_merchant_attendance_audit_read.sql':'8ebc5b4ebbd24d3aa263f044b847356f984e27e0c9139a00e115ad7c0a109b92',
 '202609300080_merchant_attendance_audit_export.sql':'eb6d2ecdcc1907050bd22fb5fcd96caf568e421bf0708b11e4691004a6ef0511',
});
export function managementAuditNativeLegacySources(root){
 assert(path.isAbsolute(root));
 const files=Object.entries(managementAuditNativeLegacyPins).map(([name,pin])=>{
  const text=readFileSync(path.join(root,'scripts/supabase-migrations',name),'utf8').replaceAll('\r\n','\n');
  assert.equal(sha(text),pin,'management_audit_legacy_frozen_SQL:'+name);return{name,text};
 });
 const functions=files.flatMap(f=>dayReviewSqlFunctions(f.text)).map(({body,...meta})=>{void body;return{...meta,
  isRpc:['faolla_attendance_audit_v1','faolla_attendance_audit_export_v1'].includes(meta.name)};});
 assert.equal(functions.length,3);assert.equal(new Set(functions.map(f=>f.signature)).size,3);
 return{files,functions,indexes:['merchant_attendance_config_audit_time_idx','merchant_attendance_scope_audit_time_idx']};
}
export function managementAuditNativeLegacyFunctionsSql(functions){
 assert.equal(functions.length,3);
 return `select jsonb_agg(jsonb_build_object('name',p.proname,'hash',encode(sha256(convert_to(replace(replace(p.prosrc,E'\\r\\n',E'\\n'),
  (select nspname from pg_namespace where oid=p.pronamespace)||'.','pub'||'lic.'),'UTF8')),'hex'),
  'result',p.prorettype::regtype::text,'language',l.lanname,'volatility',p.provolatile::text,'definer',p.prosecdef,
  'defaults',p.pronargdefaults,'defaultExpression',pg_get_expr(p.proargdefaults,0),'args',p.proargnames,'searchPath',p.proconfig,
  'safeMetadata',p.prokind='f' and p.proparallel='u' and p.prosupport=0::oid and p.proallargtypes is null and p.proargmodes is null
    and not p.proretset and not p.proisstrict and not p.proleakproof and p.procost=100 and p.prorows=0
    and p.pronargs=jsonb_array_length(spec->'args') and p.proowner=(select relowner from pg_class where oid='public.merchant_attendance_settings'::regclass)
    and (select count(*) from pg_proc same_name where same_name.pronamespace=p.pronamespace and same_name.proname=p.proname)=1,
  'ownerExecute',has_function_privilege(p.proowner,p.oid,'EXECUTE'),'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE'),
  'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),'serviceExecute',has_function_privilege('service_role',p.oid,'EXECUTE'),
  'safeAcl',not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where acl.grantor<>p.proowner or acl.grantee<>p.proowner
   and ((spec->>'isRpc')::boolean is distinct from true or acl.grantee<>(select oid from pg_roles where rolname='service_role') or acl.privilege_type<>'EXECUTE' or acl.is_grantable))) order by p.proname)
  from jsonb_array_elements(${json(functions)}) spec left join pg_proc p on p.oid=to_regprocedure(spec->>'signature') left join pg_language l on l.oid=p.prolang;`;
}
export async function installManagementAuditNativeAuditPrerequisites(ctx){
 const {d,h,native,scope,archive,periodArchive}=ctx??{};
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true,'management_audit_legacy_owned_context_required');
 assert.equal(typeof archive,'function');assert.equal(typeof periodArchive,'function');
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);assert.equal(scope.schema,d.owned.schema);
 const source=managementAuditNativeLegacySources(native.root),names=d.inventory();
 const inspect=()=>JSON.parse(d.exec(periodContinuationSerialization+managementAuditNativeInspectionSql(names,d.owned.oid))),before=inspect();
 const versions=[202609300069,202609300080];
 assert.deepEqual(before.registry.filter(r=>versions.includes(r.version)),[],'management_audit_legacy_fresh_registry');
 for(const version of [202609290064,202609290066])assert(before.registry.some(r=>r.version===version),'management_audit_legacy_missing_base');
 for(const f of source.functions)assert(!before.functions.some(p=>p.name===f.name),'management_audit_legacy_function_already_exists');
 for(const name of source.indexes)assert(!before.indexes.some(p=>p[2]===name||String(p[4]).includes(name)),'management_audit_legacy_index_already_exists');
 const old155=periodContinuationArchiveBytes(await archive()),old207=periodContinuationArchiveBytes(await periodArchive());
 try{
  for(const file of source.files)d.exec(boundClockMigrationBody(native.root,file.name));
  const after=inspect();assertManagementAuditNativeOldState(before,after);assert.deepEqual(d.inventory(),names,'management_audit_legacy_no_new_business_tables');
  assert.deepEqual(after.registry.filter(r=>!before.registry.some(p=>p.version===r.version)).map(r=>[r.version,r.name]),
   [[202609300069,'merchant_attendance_audit_read'],[202609300080,'merchant_attendance_audit_export']]);
  assert.deepEqual(after.functions.filter(f=>!before.functions.some(p=>p.oid===f.oid)).map(f=>f.name).sort(),source.functions.map(f=>f.name).sort());
  const indexes=after.indexes.filter(i=>!before.indexes.some(p=>p[0]===i[0]));assert.equal(indexes.length,2);
  for(const [n,table] of [['merchant_attendance_config_audit_time_idx','merchant_attendance_config_operations'],['merchant_attendance_scope_audit_time_idx','merchant_attendance_scope_operations']]){
   const entry=indexes.find(i=>i[4].includes(n));assert(entry,'management_audit_legacy_new_index');assert.equal(entry[1],before.tables.find(t=>t[1]===table)?.[0]);
  }
  const actual=JSON.parse(d.exec(managementAuditNativeLegacyFunctionsSql(source.functions)));
  assert.deepEqual(actual,source.functions.map(f=>({name:f.name,hash:f.hash,result:f.result,language:f.language,volatility:f.volatility,definer:f.definer,
   defaults:f.defaults,defaultExpression:f.defaultExpression,args:f.args,searchPath:[f.searchPath],safeMetadata:true,
   ownerExecute:true,anonExecute:false,authenticatedExecute:false,serviceExecute:f.isRpc,safeAcl:true})).sort((a,b)=>a.name.localeCompare(b.name)),'management_audit_legacy_exact_function_metadata');
 }finally{assert.deepEqual(periodContinuationArchiveBytes(await archive()),old155);assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),old207);}
 native.pass('202 prerequisites069/080 explicitly installed:3 exact read-only functions/2 indexes, old facts/OID/ACL/catalog/archives preserved; no repeated legacy matrix');
 return{versions,functions:3,indexes:2,newTables:0,businessCasesExecuted:false,oldFactsUnchanged:true,oldArchivesUnchanged:true,cleanupOwnedByParent:true};
}
export function managementAuditNativeSources(root){
 assert(path.isAbsolute(root));const directory=path.join(root,'scripts/supabase-migrations');
 const files=readdirSync(directory).filter(name=>/^\d+_.+\.sql$/.test(name)&&name<=delegatedAuditMigration).sort()
  .map(name=>({name,text:readFileSync(path.join(directory,name),'utf8').replaceAll('\r\n','\n')}));
 const foundation=files.find(f=>f.name===managementDelegationMigration),audit=files.find(f=>f.name===delegatedAuditMigration);assert(foundation&&audit);
 for(const source of [foundation,audit])assert.equal(sha(source.text),managementAuditNativePins[source.name],'management_audit_frozen_SQL:'+source.name);
 return {foundation,audit,foundationRecipe:managementDelegationInstallRecipe(foundation.text,files.filter(f=>f.name<foundation.name)),
  auditRecipe:delegatedAuditInstallRecipe(audit.text,files.filter(f=>f.name<audit.name))};
}
//One read-only inventory lists all required registries and body/metadata failures
//before the first install. It never installs a missing prerequisite or logs bodies.
export function managementAuditNativeDependencySql(sources,{audit=false}={}){
 assert.equal(typeof audit,'boolean');
 const recipe=sources.foundationRecipe,forward=recipe.recipe.forward;
 const selected=audit?[...sources.auditRecipe.dependencies,{...sources.auditRecipe.forwardRecipe,hash:sources.auditRecipe.forwardRecipe.oldHash},
  {...forward.catalog190,hash:forward.catalog190.newHash,legacyHash:forward.catalog185.newHash},{...forward.capture,hash:forward.capture.newHash}]
  :[...recipe.dependencies,{...forward.catalog190,hash:forward.catalog190.oldHash,legacyHash:forward.catalog185.oldHash},{...forward.capture,hash:forward.capture.oldHash}];
 const specs=selected.map(spec=>Object.fromEntries(['name','signature','hash','legacyHash','result','language','volatility','definer','defaults','defaultExpression','args','searchPath','isRpc']
  .filter(key=>Object.hasOwn(spec,key)).map(key=>[key,spec[key]])));
 assert.equal(specs.length,audit?19:5);
 const prerequisites=audit?[...managementAuditNativePrerequisites,{version:202610080202,name:'merchant_attendance_management_delegations'}]:managementAuditNativePrerequisites;
 return `with specs as(select value spec from jsonb_array_elements(${json(specs)})),
 owned as(select namespace.nspname,catalog_table.relowner from pg_class catalog_table join pg_namespace namespace on namespace.oid=catalog_table.relnamespace
  where catalog_table.oid='public.merchant_attendance_settings'::regclass),
 checked as(select spec->>'signature' signature,case when spec ? 'legacyHash' and not exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission') then spec->>'legacyHash' else spec->>'hash' end expected_hash,
  encode(sha256(convert_to(replace(replace(proc.prosrc,E'\\r\\n',E'\\n'),owned.nspname||'.','pub'||'lic.'),'UTF8')),'hex') actual_hash,
  array_remove(array[
   case when proc.oid is null then 'missing' end,
   case when proc.proowner is distinct from owned.relowner then 'owner' end,
   case when proc.prosecdef is distinct from (spec->>'definer')::boolean then 'security_definer' end,
   case when proc.proconfig is distinct from array[replace(spec->>'searchPath','public',owned.nspname)] then 'config' end,
   case when proc.provolatile::text is distinct from spec->>'volatility' or language.lanname is distinct from spec->>'language' then 'language_volatility' end,
   case when proc.prorettype is distinct from to_regtype(spec->>'result') or proc.proretset or proc.proisstrict or proc.proleakproof then 'result_flags' end,
   case when proc.prokind<>'f' or proc.proparallel<>'u' or proc.prosupport<>0::oid or proc.proallargtypes is not null or proc.proargmodes is not null then 'execution_metadata' end,
   case when coalesce(proc.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'args')) or proc.pronargs is distinct from jsonb_array_length(spec->'args') then 'argnames' end,
   case when proc.pronargdefaults is distinct from (spec->>'defaults')::integer or pg_get_expr(proc.proargdefaults,0) is distinct from spec->>'defaultExpression' then 'defaults' end,
   case when proc.procost<>100 or proc.prorows<>0 or (select count(*) from pg_proc same_name where same_name.pronamespace=proc.pronamespace and same_name.proname=proc.proname)<>1 then 'cost_or_overload' end,
   case when case when spec->>'name'='${independentPermissionHelperName}' then ${independentPermissionAclConflictSql('proc','owned.relowner')}
    else has_function_privilege(owned.relowner,proc.oid,'EXECUTE') is distinct from true or has_function_privilege('anon',proc.oid,'EXECUTE') or has_function_privilege('authenticated',proc.oid,'EXECUTE')
    or has_function_privilege('service_role',proc.oid,'EXECUTE') is distinct from (spec->>'isRpc')::boolean
    or exists(select 1 from aclexplode(coalesce(proc.proacl,acldefault('f',proc.proowner))) acl where acl.grantor<>owned.relowner or acl.grantee<>owned.relowner
     and ((spec->>'isRpc')::boolean is distinct from true or acl.grantee<>(select oid from pg_roles where rolname='service_role') or acl.privilege_type<>'EXECUTE' or acl.is_grantable)) end then 'ACL' end
  ]::text[],null) failures from specs cross join owned left join pg_proc proc on proc.oid=to_regprocedure(spec->>'signature') left join pg_language language on language.oid=proc.prolang)
 select jsonb_build_object('functions',(select jsonb_agg(jsonb_build_object('signature',signature,'actualHash',actual_hash,'expectedHash',expected_hash,'failedFields',to_jsonb(failures)||case when actual_hash is distinct from expected_hash then '["source_hash"]'::jsonb else '[]'::jsonb end) order by signature) from checked),
 'registry',(select jsonb_agg(jsonb_build_object('version',wanted->'version','expected',wanted->'name','actual',registry.name) order by wanted->>'version') from jsonb_array_elements(${json(prerequisites)}) wanted left join public.faolla_schema_migrations registry on registry.version=(wanted->>'version')::bigint),
 'alreadyInstalled',(select coalesce(jsonb_agg(version order by version),'[]') from public.faolla_schema_migrations where version in(${audit?'202610080203':'202610080202,202610080203'})));`;
}
export function assertManagementAuditNativeDependencies(value,{audit=false}={}){
 assert.equal(typeof audit,'boolean');
 assert(value&&Array.isArray(value.functions)&&value.functions.length===(audit?19:5)&&Array.isArray(value.registry)&&value.registry.length===(audit?9:8));
 assert.deepEqual(value.alreadyInstalled,[],'management_audit_forward_order_requires_fresh202203');
 assert.deepEqual(value.registry.filter(f=>f.actual!==f.expected),[],'management_audit_prerequisite_registry');
 assert.deepEqual(value.functions.filter(f=>f.failedFields.length),[],'management_audit_prerequisite_body_metadata');return value;
}
export function managementAuditNativeInspectionSql(names,schemaOid){
 assert(names.length>0&&names.every(n=>/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(n)));
 assert(Number.isSafeInteger(schemaOid)&&schemaOid>0);
 return `select jsonb_build_object('facts',${outageNativeFingerprintSql(names.filter(n=>n!=='faolla_schema_migrations'))},
 'registry',(select jsonb_agg(to_jsonb(registry) order by version) from public.faolla_schema_migrations registry),
 --Hash the COMPLETE definition in PostgreSQL; never transmit every large old
 --body through the parent's2MB pipe. Metadata stays complete and independent.
 'functions',(select jsonb_agg(jsonb_build_object('oid',proc.oid::bigint,'name',proc.proname,'metadata',to_jsonb(proc)-'prosrc',
  'defaultExpression',pg_get_expr(proc.proargdefaults,0),
  'definition',encode(sha256(convert_to(pg_get_functiondef(proc.oid),'UTF8')),'hex')) order by proc.oid) from pg_proc proc where proc.pronamespace=${schemaOid} and proc.prokind='f'),
 'tables',(select jsonb_agg(jsonb_build_array(catalog_table.oid,catalog_table.relname,catalog_table.relowner,catalog_table.relacl,catalog_table.relrowsecurity,
  (select jsonb_agg(pg_get_constraintdef(constraint_row.oid) order by constraint_row.conname) from pg_constraint constraint_row where constraint_row.conrelid=catalog_table.oid),
  (select jsonb_agg(pg_get_triggerdef(trigger_row.oid) order by trigger_row.tgname) from pg_trigger trigger_row where trigger_row.tgrelid=catalog_table.oid and not trigger_row.tgisinternal)) order by catalog_table.oid)
  from pg_class catalog_table where catalog_table.relnamespace=${schemaOid} and catalog_table.relkind in('r','p')),
 'indexes',(select jsonb_agg(jsonb_build_array(index_row.indexrelid,index_row.indrelid,index_table.relowner,index_table.relacl,pg_get_indexdef(index_row.indexrelid),to_jsonb(index_row)) order by index_row.indexrelid)
  from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_table.relnamespace=${schemaOid}));`;
}
export function assertManagementAuditNativeOldState(before,after,approvedBodies=[]){
 assert.equal(after.facts,before.facts,'management_audit_install_old_facts');
 for(const original of before.registry)assert(after.registry.some(row=>JSON.stringify(row)===JSON.stringify(original)),'management_audit_old_registry_row_changed');
 for(const original of before.functions){const current=after.functions.find(f=>f.oid===original.oid);assert(current,'management_audit_old_function_OID');
  for(const value of [original,current])assert(Object.hasOwn(value,'defaultExpression')&&(value.defaultExpression===null||typeof value.defaultExpression==='string'),'management_audit_old_function_default_expression_required');
  assert.equal(current.defaultExpression,original.defaultExpression,'management_audit_old_function_default_expression');
  const approved=approvedBodies.includes(original.name);
  if(approved){
   //Only an explicitly approved CREATE OR REPLACE may change pg_node_tree
   //source locations. Keep the canonical expression, count and all other
   //metadata exact; every unapproved function retains its raw AST comparison.
   const priorMetadata={...original.metadata},currentMetadata={...current.metadata};
   delete priorMetadata.proargdefaults;delete currentMetadata.proargdefaults;
   assert.deepEqual(currentMetadata,priorMetadata,'management_audit_old_function_metadata_ACL_defaults');
  }else{
   assert.deepEqual(current.metadata,original.metadata,'management_audit_old_function_metadata_ACL_defaults');
   assert.equal(current.definition,original.definition,'management_audit_unapproved_old_body:'+original.name);
  }}
 for(const key of ['tables','indexes'])for(const original of before[key])assert.deepEqual(after[key].find(row=>row[0]===original[0]),original,'management_audit_old_'+key+'_OID_catalog');
}
export async function installAndVerifyManagementAuditNative(ctx,options={}){
 assert(options&&typeof options==='object'&&!Array.isArray(options)&&Object.keys(options).every(k=>k==='businessCases'),'management_audit_native_options_invalid');
 const {businessCases='run'}=options;assert(['run','skip'].includes(businessCases),'management_audit_native_business_cases_invalid');
 const {d,h,native,scope,archive,periodArchive}=ctx??{};assert(d?.syntheticOnly===true&&h?.syntheticOnly===true,'management_audit_owned_context_required');
 assert.equal(typeof native?.query,'function');assert.equal(typeof native?.connect,'function');assert.equal(typeof archive,'function');assert.equal(typeof periodArchive,'function');
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);assert.equal(d.owned.schema,scope.schema);
 const sources=managementAuditNativeSources(native.root);let installationSteps=0;
 const read=sql=>{assert(++installationSteps<=managementAuditNativeLimits.installationSteps,'management_audit_installation20steps');return d.exec(periodContinuationSerialization+sql);};
 const inventory=assertManagementAuditNativeDependencies(JSON.parse(read(managementAuditNativeDependencySql(sources))));
 native.pass('202→203 read-only prerequisite inventory: '+JSON.stringify(inventory));
 const names=d.inventory();for(const name of [...managementDelegationTables,delegatedAuditTable])assert(!names.includes(name),'management_audit_new_relation_already_exists:'+name);
 const old155=periodContinuationArchiveBytes(await archive()),old207=periodContinuationArchiveBytes(await periodArchive());
 const inspect=tableNames=>JSON.parse(read(managementAuditNativeInspectionSql(tableNames,d.owned.oid))),old=inspect(names);
 const install=filename=>{assert(++installationSteps<=managementAuditNativeLimits.installationSteps);d.exec(boundClockMigrationBody(native.root,filename));};
 install(managementDelegationMigration);const foundation=inspect(names);
 assertManagementAuditNativeOldState(old,foundation,['faolla_valid_merchant_enterprise_permissions_v1','faolla_attendance_account_capture_v1']);
 assert.deepEqual(foundation.registry.filter(row=>!old.registry.some(prior=>prior.version===row.version)).map(row=>[row.version,row.name]),[[202610080202,'merchant_attendance_management_delegations']]);
 assert.deepEqual(foundation.tables.filter(row=>!old.tables.some(prior=>prior[0]===row[0])).map(row=>row[1]).sort(),[...managementDelegationTables].sort());
 const foundationNames=[...names,...managementDelegationTables],foundationBaseline=inspect(foundationNames);
 install(managementDelegationMigration);assert.deepEqual(inspect(foundationNames),foundationBaseline,'management_audit202_reentry_facts_defs_catalog');
 //Never reenter202 after203:203 intentionally advances its new private guard.
 const auditInventory=assertManagementAuditNativeDependencies(JSON.parse(read(managementAuditNativeDependencySql(sources,{audit:true}))),{audit:true});
 native.pass('203 read-only prerequisite inventory (all19 before installation): '+JSON.stringify(auditInventory));
 install(delegatedAuditMigration);const audit=inspect(foundationNames);
 assertManagementAuditNativeOldState(foundationBaseline,audit,['faolla_attendance_management_insert_v1']);
 assert.deepEqual(audit.registry.filter(row=>!foundationBaseline.registry.some(prior=>prior.version===row.version)).map(row=>[row.version,row.name]),[[202610080203,'merchant_attendance_delegated_audit']]);
 assert.deepEqual(audit.tables.filter(row=>!foundationBaseline.tables.some(prior=>prior[0]===row[0])).map(row=>row[1]),[delegatedAuditTable]);
 const allNames=[...foundationNames,delegatedAuditTable],installed=inspect(allNames);
 install(delegatedAuditMigration);assert.deepEqual(inspect(allNames),installed,'management_audit203_reentry_facts_defs_catalog');
 native.pass('202 then203 installation/reentry: four private tables, exact catalog/capture/audit guard forwards; old facts/OIDs/ACL/defaults/catalog preserved');
 let acceptance=null;const facts=d.fingerprint(),defs=d.definitions(),catalog=d.tableCatalog();
 try{if(businessCases==='run')acceptance=await (await import('./fixtures/attendance-management-audit-native.mjs')).verifyManagementAuditNative(ctx);}
 finally{assert.equal(d.fingerprint(),facts,'management_audit_fixture_rollback_facts');assert.equal(d.definitions(),defs);assert.equal(d.tableCatalog(),catalog);
  assert.deepEqual(periodContinuationArchiveBytes(await archive()),old155);assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),old207);}
 if(businessCases==='run'){assert.equal(acceptance.groups.length,8);assert(acceptance.rpcs<=90&&acceptance.steps<=140);}
 return {phases:[202,203],installAndReentry:true,installationSteps,dependencyInventory:{foundation:inventory,audit:auditInventory},acceptance,businessCasesExecuted:businessCases==='run',newTables:4,oldFactsUnchanged:true,oldOidAclDefaultsUnchanged:true,
  oldArchivesUnchanged:true,rollbackRestored:businessCases==='run'?true:null,cleanupOwnedByParent:true,newCluster:false,newDatabase:false,browser:false,realAuth:false,production:false,deployed:false};
}
