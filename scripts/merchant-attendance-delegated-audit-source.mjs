//203 finite SOURCE recipe. No database connection, installation, configured Auth
//or generic delegated business executor. Only --write mechanically freezes SQL.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {dayReviewSqlFunctions} from './merchant-attendance-day-review-source.mjs';
import {managementDelegationInstallRecipe,managementDelegationMigration,managementDelegationOwnManifest,managementDelegationTables} from './merchant-attendance-management-delegation-source.mjs';

export const delegatedAuditMigration='202610080203_merchant_attendance_delegated_audit.sql';
export const delegatedAuditTable='merchant_attendance_management_audit_exports';
export const delegatedAuditLimits=Object.freeze({days:31,branchRows:1001,mergedRows:1001,projectedRows:1000,page:25,export:250,bytes:1572864});
const sha=value=>createHash('sha256').update(value.replaceAll('\r\n','\n'),'utf8').digest('hex');
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const functionManifest=f=>{const {body,...meta}=f;void body;return{...meta,isRpc:f.name==='faolla_attendance_delegated_audit_v1'};};
export function delegatedAuditOwnManifest(sql){
 return dayReviewSqlFunctions(sql).filter(f=>f.name.startsWith('faolla_attendance_management_audit_')||f.name==='faolla_attendance_delegated_audit_v1').map(functionManifest);
}
export function delegatedAuditForwardRecipe(foundation){
 const original=dayReviewSqlFunctions(foundation).find(f=>f.name==='faolla_attendance_management_insert_v1');assert(original,'audit_source_guard_missing');
 const from="if tg_table_name='merchant_attendance_management_delegation_operations' then raise exception 'attendance_management_executor_unavailable';end if;";
 const to="if tg_table_name='merchant_attendance_management_delegation_operations' then\n  if new.delegated_action='audit_export' then perform public.faolla_attendance_management_audit_authority_v1(new);return new;end if;\n  raise exception 'attendance_management_executor_unavailable';\n end if;";
 assert.equal(original.body.split(from).length-1,1,'audit_source_guard_anchor');
 const next=original.body.replace(from,to);
 return Object.freeze({...functionManifest(original),oldHash:original.hash,newHash:sha(next),oldBody:original.body,newBody:next,from,to});
}
export function delegatedAuditApplyForward(body,recipe){
 assert.equal(sha(body),recipe.oldHash);assert.equal(body.split(recipe.from).length-1,1);
 const result=body.replace(recipe.from,recipe.to);assert.equal(sha(result),recipe.newHash);return result;
}
export function delegatedAuditInstallRecipe(sql,migrations){
 const foundation=migrations.find(m=>m.name===managementDelegationMigration)?.text;assert(foundation,'audit_source_foundation_missing');
 const foundationRecipe=managementDelegationInstallRecipe(foundation,migrations.filter(m=>m.name<managementDelegationMigration));
 const forward=delegatedAuditForwardRecipe(foundation),own=delegatedAuditOwnManifest(sql);assert.equal(own.length,9);assert.equal(new Set(own.map(f=>f.signature)).size,9);
 const latest=new Map();for(const file of migrations)for(const f of dayReviewSqlFunctions(file.text))latest.set(f.name,f);
 const dependencies=managementDelegationOwnManifest(foundation).filter(f=>f.name!==forward.name);
 for(const name of ['faolla_attendance_audit_value_v1','faolla_attendance_shift_rule_binding_object_v1','faolla_attendance_operational_rule_hash_v1','faolla_attendance_events_append_only_v1']){
  const f=latest.get(name);assert(f,'audit_source_dependency_missing:'+name);dependencies.push(functionManifest(f));
 }
 const {oldBody,newBody,from,to,oldHash,newHash,...forwardMeta}=forward;void oldBody;void newBody;void from;void to;void oldHash;void newHash;
 const parentForwards=foundationRecipe.recipe.forward;
 const functionChecks=foundationRecipe.preflight.match(/for spec in select value from jsonb_array_elements\(own_spec\) loop[\s\S]*?\n end loop;/)?.[0];assert(functionChecks,'audit_source_function_guard_missing');
 const parentTableStart=foundationRecipe.preflight.indexOf('foreach table_name in array array[');
 const parentTableEnd=foundationRecipe.preflight.lastIndexOf('\nend;$management_preflight$;');assert(parentTableStart>0&&parentTableEnd>parentTableStart);
 const parentTableChecks=foundationRecipe.preflight.slice(parentTableStart,parentTableEnd);
 const allTables=[...managementDelegationTables,delegatedAuditTable];
 const tableChecks=parentTableChecks.replace(/foreach table_name in array array\[[^\n]+\] loop/,`foreach table_name in array array[${allTables.map(quote).join(',')}] loop`)
  .replace("for trigger_spec in select * from (values('management_immutable',27,'faolla_attendance_events_append_only_v1'),('management_no_truncate',34,'faolla_attendance_events_append_only_v1'),('management_insert_guard',7,'faolla_attendance_management_insert_v1')) expected(name,kind,fn) loop",
   "for trigger_spec in select * from (values(case when table_name='merchant_attendance_management_audit_exports' then 'management_audit_immutable' else 'management_immutable' end,27,'faolla_attendance_events_append_only_v1'),(case when table_name='merchant_attendance_management_audit_exports' then 'management_audit_no_truncate' else 'management_no_truncate' end,34,'faolla_attendance_events_append_only_v1'),(case when table_name='merchant_attendance_management_audit_exports' then 'management_audit_insert_guard' else 'management_insert_guard' end,7,case when table_name='merchant_attendance_management_audit_exports' then 'faolla_attendance_management_audit_insert_v1' else 'faolla_attendance_management_insert_v1' end)) expected(name,kind,fn) loop");
 assert.notEqual(tableChecks,parentTableChecks);assert(tableChecks.includes('management_audit_insert_guard'));
 const onlyParentChecks=parentTableChecks;
 const tableDefinition=(text,name)=>{const found=text.match(new RegExp('create table if not exists public\\.'+name+'\\([\\s\\S]*?\\n\\);'))?.[0];assert(found,'audit_source_table_missing:'+name);return found;};
 const temp=body=>body.replace('create table if not exists public.','create temp table ').replace(/\n\);$/,'\n) on commit drop;')
  .replaceAll('references public.merchant_attendance_settings(merchant_id)','references pg_temp.management_expected_settings(merchant_id)')
  .replaceAll('references public.merchant_enterprise_employees(merchant_id,id)','references pg_temp.management_expected_employees(merchant_id,id)')
  .replaceAll('references public.merchant_attendance_management_delegations(merchant_id,grant_id)','references pg_temp.merchant_attendance_management_delegations(merchant_id,grant_id)');
 const parentIndexes=foundation.match(/^create index if not exists [^\n]+;/gm);assert.equal(parentIndexes?.length,4);
 const auditIndexes=sql.match(/^create index if not exists [^\n]+;/gm);assert.equal(auditIndexes?.length,4);
 const expectedIndex=statement=>statement.replace(' if not exists','').replace('on public.','on pg_temp.');
 const parentExtraIndexes=auditIndexes.filter(s=>!s.includes('on public.'+delegatedAuditTable+'('));assert.equal(parentExtraIndexes.length,2);
 const ownIndexes=auditIndexes.filter(s=>s.includes('on public.'+delegatedAuditTable+'('));assert.equal(ownIndexes.length,2);
 const parentTemplates=`create temp table management_expected_settings(merchant_id text primary key) on commit drop;
create temp table management_expected_employees(id uuid,merchant_id text,primary key(merchant_id,id)) on commit drop;
${managementDelegationTables.map(n=>temp(tableDefinition(foundation,n))).join('\n')}
${parentIndexes.map(expectedIndex).join('\n')}`;
 const ownTemplates=`${temp(tableDefinition(sql,delegatedAuditTable))}
${ownIndexes.map(expectedIndex).join('\n')}`;
 assert(!/references public\./.test(parentTemplates+ownTemplates),'audit_source_temp_fk_must_be_temp');
 const declarations=`declare ns text;expected_owner oid;installed boolean;has190 boolean;spec jsonb;f regprocedure;meta record;own_spec jsonb;
 actual_table regclass;expected_table regclass;foreign_table regclass;table_name text;constraint_spec record;actual_constraint record;
 index_spec record;actual_index record;trigger_spec record;`;
 const common=`select namespace.nspname,catalog_table.relowner into ns,expected_owner from pg_class catalog_table join pg_namespace namespace on namespace.oid=catalog_table.relnamespace where catalog_table.oid='public.merchant_attendance_settings'::regclass;
 if expected_owner is distinct from (select oid from pg_roles where rolname=current_user) then raise exception 'merchant_attendance_delegated_audit_owner_conflict';end if;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080203 and name='merchant_attendance_delegated_audit');
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');`;
 const checkDependencies=installedHash=>`own_spec:=$audit_dependencies$${JSON.stringify(dependencies)}$audit_dependencies$::jsonb;
 own_spec:=own_spec||jsonb_build_array($audit_guard_meta$${JSON.stringify(forwardMeta)}$audit_guard_meta$::jsonb||jsonb_build_object('hash',${installedHash}));
 own_spec:=own_spec||jsonb_build_array((case when has190 then $audit_parent190$${JSON.stringify(parentForwards.catalog190)}$audit_parent190$::jsonb else $audit_parent185$${JSON.stringify(parentForwards.catalog185)}$audit_parent185$::jsonb end)||jsonb_build_object('hash',case when has190 then '${parentForwards.catalog190.newHash}' else '${parentForwards.catalog185.newHash}' end),
 $audit_parent_capture$${JSON.stringify(parentForwards.capture)}$audit_parent_capture$::jsonb||jsonb_build_object('hash','${parentForwards.capture.newHash}'));
 ${functionChecks}`;
 const checkOwn=`own_spec:=$audit_own$${JSON.stringify(own)}$audit_own$::jsonb;
 ${functionChecks}`;
 const preflight=`do $audit_prerequisites$ begin
 if to_regclass('public.faolla_schema_migrations') is null or to_regclass('public.merchant_attendance_settings') is null
  or not exists(select 1 from public.faolla_schema_migrations where version=202609300069 and name='merchant_attendance_audit_read')
  or not exists(select 1 from public.faolla_schema_migrations where version=202609300080 and name='merchant_attendance_audit_export')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080202 and name='merchant_attendance_management_delegations') then raise exception 'merchant_attendance_delegated_audit_prerequisite_required';end if;
 if exists(select 1 from public.faolla_schema_migrations where version=202610080203 and name<>'merchant_attendance_delegated_audit') then raise exception 'merchant_attendance_delegated_audit_installation_conflict';end if;
end;$audit_prerequisites$;
${parentTemplates}
create temp table audit_forward_metadata on commit drop as select proc.oid,to_jsonb(proc)-'prosrc' metadata from pg_proc proc where proc.oid='public.faolla_attendance_management_insert_v1()'::regprocedure;
do $audit_preflight$
${declarations}
begin
 ${common}
 ${checkDependencies(`case when installed then '${forward.newHash}' else '${forward.oldHash}' end`)}
 if (select count(*) from pg_proc proc where proc.pronamespace=(select oid from pg_namespace where nspname=ns) and (proc.proname like 'faolla_attendance_management_audit_%' or proc.proname='faolla_attendance_delegated_audit_v1'))<>(case when installed then ${own.length} else 0 end)
  or (to_regclass(ns||'.${delegatedAuditTable}') is not null)<>installed then raise exception 'merchant_attendance_delegated_audit_installation_conflict';end if;
 if not installed then
  if exists(select 1 from pg_class catalog_table where catalog_table.relnamespace=(select oid from pg_namespace where nspname=ns) and catalog_table.relname in(${parentExtraIndexes.map(s=>quote(s.match(/create index if not exists (\w+)/)[1])).join(',')})) then raise exception 'merchant_attendance_delegated_audit_index_conflict';end if;
  ${onlyParentChecks}
  return;
 end if;
 ${parentExtraIndexes.map(s=>'execute '+quote(expectedIndex(s))+';').join('\n ')}
 ${checkOwn}
end;$audit_preflight$;
${ownTemplates}
do $audit_reentry_tables$
${declarations}
begin
 ${common}
 if installed then
 ${tableChecks}
 end if;
end;$audit_reentry_tables$;`;
 const forwardSql=`do $audit_one_forward$
declare old_body text;definition text;
begin
 if exists(select 1 from public.faolla_schema_migrations where version=202610080203 and name='merchant_attendance_delegated_audit') then return;end if;
 select replace(proc.prosrc,E'\\r\\n',E'\\n'),pg_get_functiondef(proc.oid) into old_body,definition from pg_proc proc where proc.oid='${forward.signature}'::regprocedure;
 if old_body is distinct from $audit_old_guard$${forward.oldBody}$audit_old_guard$ or position(old_body in definition)=0 then raise exception 'merchant_attendance_delegated_audit_forward_drift';end if;
 definition:=replace(definition,old_body,$audit_new_guard$${forward.newBody}$audit_new_guard$);execute definition;
end;$audit_one_forward$;`;
 const final=`do $audit_expected_forward_indexes$
begin
 ${parentExtraIndexes.map(s=>'execute '+quote(expectedIndex(s).replace('create index ','create index if not exists '))+';').join('\n ')}
end;$audit_expected_forward_indexes$;
do $audit_postconditions$
${declarations}
begin
 ${common}
 ${checkDependencies(quote(forward.newHash))}
 ${checkOwn}
 ${tableChecks}
 if (select count(*) from audit_forward_metadata)<>1 or exists(select 1 from audit_forward_metadata original left join pg_proc proc on proc.oid=original.oid where proc.oid is null or (to_jsonb(proc)-'prosrc') is distinct from original.metadata) then raise exception 'merchant_attendance_delegated_audit_forward_metadata_changed';end if;
end;$audit_postconditions$;
drop table pg_temp.audit_forward_metadata,pg_temp.${delegatedAuditTable},pg_temp.merchant_attendance_management_delegation_operations,pg_temp.merchant_attendance_management_delegation_revocations,pg_temp.merchant_attendance_management_delegations,pg_temp.management_expected_employees,pg_temp.management_expected_settings;`;
 return Object.freeze({preflight,forward:forwardSql,final,own,dependencies,forwardRecipe:forward,parentExtraIndexes,tableChecks,recipeHash:sha(JSON.stringify({own,dependencies,forward:forwardMeta,oldHash:forward.oldHash,newHash:forward.newHash}))});
}
export function delegatedAuditFreezeSql(sql,migrations){
 const clean=sql.replaceAll('\r\n','\n'),recipe=delegatedAuditInstallRecipe(clean,migrations);
 const replaceBlock=(text,name,replacement)=>{const re=new RegExp('--BEGIN GENERATED AUDIT '+name+'[\\s\\S]*?--END GENERATED AUDIT '+name);assert(re.test(text),'audit_source_marker:'+name);return text.replace(re,()=>`--BEGIN GENERATED AUDIT ${name}\n${replacement}\n--END GENERATED AUDIT ${name}`);};
 return replaceBlock(replaceBlock(replaceBlock(clean,'PREFLIGHT',recipe.preflight),'FORWARD',recipe.forward),'POSTCONDITIONS',recipe.final);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.deepEqual(process.argv.slice(2),['--write'],'audit_source_explicit_write_only');
 const directory=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'supabase-migrations'),target=path.join(directory,delegatedAuditMigration);
 const migrations=readdirSync(directory).filter(n=>/^\d+_.+\.sql$/.test(n)&&n<delegatedAuditMigration).sort().map(name=>({name,text:readFileSync(path.join(directory,name),'utf8')}));
 const result=delegatedAuditFreezeSql(readFileSync(target,'utf8'),migrations);writeFileSync(target,result,'utf8');
 console.log(JSON.stringify({sourceOnly:true,migration:delegatedAuditMigration,sha256:sha(result)}));
}
