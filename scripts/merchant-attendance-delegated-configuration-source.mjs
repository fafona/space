//205 inert exact SOURCE recipe. --write freezes generated SQL, never connects.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {dayReviewSqlFunctions} from './merchant-attendance-day-review-source.mjs';
import {delegatedGroupsInstallRecipe,delegatedGroupsForwardRecipes,delegatedGroupsMigration} from './merchant-attendance-delegated-groups-source.mjs';
import {managementDelegationInstallRecipe,managementDelegationMigration} from './merchant-attendance-management-delegation-source.mjs';

export const delegatedConfigurationMigration='202610080205_merchant_attendance_delegated_configuration.sql';
export const delegatedConfigurationActions=Object.freeze(['worker_save','location_save']);
const sha=v=>createHash('sha256').update(v.replaceAll('\r\n','\n'),'utf8').digest('hex');
const quote=v=>"'"+v.replaceAll("'","''")+"'";
const manifest=f=>{const{body,oldBody,newBody,oldHash,newHash,changes,...meta}=f;void body;void oldBody;void newBody;void oldHash;void newHash;void changes;return{...meta,isRpc:f.name==='faolla_attendance_admin_v1'||f.name==='faolla_attendance_delegated_config_v1'};};
const ownerAnchor=`  -- Match existing owner identity columns; never trust a client actor/role claim.
  -- Holding this row makes an ownership transfer precede or follow this transaction.
  select * into v_merchant from public.merchants where id=p_site_id for share;
  if not found or not coalesce(p_auth_user_id=any(array[
    v_merchant.user_id,v_merchant.auth_user_id,v_merchant.owner_user_id,v_merchant.owner_id,
    v_merchant.auth_id,v_merchant.created_by,v_merchant.created_by_user_id]),false)
  then raise exception 'attendance_access_denied'; end if;`;
export function delegatedConfigurationForwardRecipes(migrations){
 const find=prefix=>{const f=migrations.find(m=>m.name.startsWith(prefix));assert(f,'configuration_source_missing:'+prefix);return f.text.replaceAll('\r\n','\n');};
 const old=dayReviewSqlFunctions(find('202609290064_')).find(f=>f.name==='faolla_attendance_admin_v1');assert(old);
 assert.equal(old.hash,'cbc6ec52e36b318879cde6e68880a0881d55a56250bf667707aa62056332f89e');
 const from=`or (select count(*) from public.merchant_attendance_employment_periods where merchant_id=p_site_id and worker_id=v_id)<>1
          or not exists(select 1 from public.merchant_attendance_employment_periods where merchant_id=p_site_id and worker_id=v_id and starts_on=v_start and ends_on is null)`;
 const to="or not public.faolla_attendance_employment_config_v1(p_site_id,v_id,v_employee.id,v_start,(v_values->>'active')::boolean)";
 assert(find('202610060166_').includes(from));assert.equal(old.body.split(from).length-1,1);
 const current=old.body.replace(from,to);assert.equal(sha(current),'67aa7c785dec53199a500517e05c0f58646e24f7bd5be0041a23679e32d19949');
 assert.equal(current.split(ownerAnchor).length-1,1);
 const boundary=`  if p_grant_id is null then
${ownerAnchor}
  else
    if p_command is null or v_kind not in('worker','location') or p_operation_id is not null
      or p_query is distinct from jsonb_build_object('view','settings','cursor',null,'search','') then raise exception 'attendance_invalid_request';end if;
    perform public.faolla_attendance_delegated_config_authorize_v1(p_site_id,p_auth_user_id,p_grant_id,v_kind,false);
  end if;`;
 const core=current.replace(ownerAnchor,boundary),wrapper='\nbegin\n return public.faolla_attendance_admin_core_v2(p_site_id,p_auth_user_id,p_query,p_command,p_operation_id,null);\nend;\n';
 const prior=delegatedGroupsForwardRecipes(find('202610030124_'),find('202610080202_')).guard;
 assert.equal(prior.newHash,'5d2636f3b1eacfaf0dcb6f249e234bd641e50657df5a71e0cc9fbd7600427183');
 const anchor="  if new.delegated_action in('group_save','group_assign','group_end','group_cancel') then perform public.faolla_attendance_delegated_groups_authority_v1(new);return new;end if;";
 assert.equal(prior.newBody.split(anchor).length-1,1);
 const next=prior.newBody.replace(anchor,anchor+"\n  if new.delegated_action in('worker_save','location_save') then perform public.faolla_attendance_delegated_config_authority_v1(new);return new;end if;");
 return Object.freeze({core,boundary,current,ownerAnchor,legacy:Object.freeze({...manifest(old),oldHash:sha(current),newHash:sha(wrapper),oldBody:current,newBody:wrapper}),guard:Object.freeze({...manifest(prior),oldHash:prior.newHash,newHash:sha(next),oldBody:prior.newBody,newBody:next})});
}
export function delegatedConfigurationOwnManifest(sql){return dayReviewSqlFunctions(sql).filter(f=>f.name.startsWith('faolla_attendance_delegated_config_')||f.name==='faolla_attendance_admin_core_v2').map(manifest);}
export function delegatedConfigurationInstallRecipe(sql,migrations){
 const get=name=>{const m=migrations.find(m=>m.name===name);assert(m);return m.text;};
 const forward=delegatedConfigurationForwardRecipes(migrations),own=delegatedConfigurationOwnManifest(sql);assert.equal(own.length,10);
 assert.equal(dayReviewSqlFunctions(sql).find(f=>f.name==='faolla_attendance_admin_core_v2')?.body,forward.core);
 const groups=delegatedGroupsInstallRecipe(get(delegatedGroupsMigration),migrations.filter(m=>m.name<delegatedGroupsMigration));
 const foundation=managementDelegationInstallRecipe(get(managementDelegationMigration),migrations.filter(m=>m.name<managementDelegationMigration));
 const checks=foundation.preflight.match(/for spec in select value from jsonb_array_elements\(own_spec\) loop[\s\S]*?\n end loop;/)?.[0];assert(checks);
 const latest=new Map();for(const m of migrations)for(const f of dayReviewSqlFunctions(m.text))latest.set(f.name,f);
 const dependencies=[...groups.dependencies,...groups.own];
 for(const name of ['faolla_attendance_valid_zone_v1','faolla_attendance_employment_config_v1','faolla_attendance_employment_chain_v1','faolla_attendance_employment_receipt_v1','faolla_attendance_employment_hash_v1','faolla_attendance_employment_command_v1','faolla_attendance_account_activation_guard_v1','faolla_attendance_events_append_only_v1']){const f=latest.get(name);assert(f,'configuration_dependency_missing:'+name);dependencies.push(manifest(f));}
 dependencies.push({...manifest(groups.forward.legacy),hash:groups.forward.legacy.newHash,isRpc:true});
 const unique=[...new Map(dependencies.map(f=>[f.signature,f])).values()];
 const old064=migrations.find(m=>m.name.startsWith('202609290064_')).text;
 const originalTable=old064.match(/create table public\.merchant_attendance_config_operations \([\s\S]*?\n\);/)?.[0];assert(originalTable);
 const templates=`create temp table groups_expected_settings(merchant_id text primary key) on commit drop;\n`+originalTable.replace('create table public.','create temp table ').replace(/\n\);$/,'\n) on commit drop;').replace('references public.merchant_attendance_settings','references pg_temp.groups_expected_settings')+`\ncreate index merchant_attendance_config_audit_time_idx on pg_temp.merchant_attendance_config_operations(merchant_id,recorded_at desc,operation_id desc);`;
 assert(!templates.includes('references public.'));
 let tableChecks=groups.tableChecks;
 tableChecks=tableChecks.replace(/foreach table_name in array array\[[^\n]+\] loop/,"foreach table_name in array array['merchant_attendance_config_operations'] loop");
 tableChecks=tableChecks.replace(/foreign_table:=case constraint_spec\.confrelid [^\n]+ end;/,"foreign_table:=case constraint_spec.confrelid when to_regclass('pg_temp.groups_expected_settings') then to_regclass(ns||'.merchant_attendance_settings') else constraint_spec.confrelid end;");
 tableChecks=tableChecks.replace('acl.grantee<>expected_owner))',"(acl.grantee<>expected_owner and not(acl.grantee=(select oid from pg_roles where rolname='service_role') and acl.privilege_type='SELECT' and not acl.is_grantable))))");
 const triggerStart=tableChecks.indexOf('  if (select count(*) from pg_trigger');assert(triggerStart>0);
 tableChecks=tableChecks.slice(0,triggerStart)+`  if not has_table_privilege('service_role',actual_table,'SELECT') or (select count(*) from pg_trigger where tgrelid=actual_table and not tgisinternal)<>2 then raise exception 'merchant_attendance_delegated_configuration_trigger_conflict';end if;
  for trigger_spec in select * from(values('merchant_attendance_config_no_rewrite',27),('merchant_attendance_config_no_truncate',34)) expected(name,kind) loop
   if not exists(select 1 from pg_trigger actual where actual.tgrelid=actual_table and actual.tgname=trigger_spec.name::name and actual.tgtype=trigger_spec.kind and actual.tgenabled='O' and actual.tgnargs=0 and actual.tgqual is null and not actual.tgdeferrable and not actual.tginitdeferred and actual.tgfoid=to_regprocedure(ns||'.faolla_attendance_events_append_only_v1()')) then raise exception 'merchant_attendance_delegated_configuration_trigger_conflict';end if;
  end loop;
  if exists(select 1 from pg_attribute actual left join pg_attrdef actual_default on actual_default.adrelid=actual.attrelid and actual_default.adnum=actual.attnum left join pg_attrdef expected_default on expected_default.adrelid=expected_table and expected_default.adnum=actual.attnum
   where actual.attrelid=actual_table and actual.attnum>0 and pg_get_expr(actual_default.adbin,actual_table) is distinct from pg_get_expr(expected_default.adbin,expected_table)) then raise exception 'merchant_attendance_delegated_configuration_default_conflict';end if;
 end loop;`;
 tableChecks=tableChecks.replaceAll('merchant_attendance_delegated_groups_','merchant_attendance_delegated_configuration_');
 const declarations='declare ns text;expected_owner oid;installed boolean;has190 boolean;spec jsonb;own_spec jsonb;f regprocedure;meta record;table_name text;actual_table regclass;expected_table regclass;foreign_table regclass;constraint_spec record;actual_constraint record;index_spec record;actual_index record;trigger_spec record;';
 const common=`select namespace.nspname,catalog_table.relowner into ns,expected_owner from pg_class catalog_table join pg_namespace namespace on namespace.oid=catalog_table.relnamespace where catalog_table.oid='public.merchant_attendance_settings'::regclass;
 if expected_owner is distinct from (select oid from pg_roles where rolname=current_user) then raise exception 'merchant_attendance_delegated_configuration_owner_conflict';end if;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080205 and name='merchant_attendance_delegated_configuration');
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');`;
 const fm=(f,post)=>({...manifest(f),hash:post?f.newHash:f.oldHash});
 const deps=post=>`own_spec:=$config205_dependencies$${JSON.stringify(unique)}$config205_dependencies$::jsonb;
 own_spec:=own_spec||jsonb_build_array((case when has190 then $config205_catalog190$${JSON.stringify(fm(foundation.recipe.forward.catalog190,true))}$config205_catalog190$::jsonb else $config205_catalog185$${JSON.stringify(fm(foundation.recipe.forward.catalog185,true))}$config205_catalog185$::jsonb end),$config205_capture$${JSON.stringify(fm(foundation.recipe.forward.capture,true))}$config205_capture$::jsonb);
 own_spec:=own_spec||jsonb_build_array($config205_admin$${JSON.stringify(fm(forward.legacy,false))}$config205_admin$::jsonb||jsonb_build_object('hash',${post?quote(forward.legacy.newHash):`case when installed then '${forward.legacy.newHash}' else '${forward.legacy.oldHash}' end`}),$config205_guard$${JSON.stringify(fm(forward.guard,false))}$config205_guard$::jsonb||jsonb_build_object('hash',${post?quote(forward.guard.newHash):`case when installed then '${forward.guard.newHash}' else '${forward.guard.oldHash}' end`}));
 ${checks}`;
 const ownChecks=`own_spec:=$config205_own$${JSON.stringify(own)}$config205_own$::jsonb;${checks}`;
 const preflight=`do $config205_prerequisites$ begin
 if to_regclass('public.faolla_schema_migrations') is null or not exists(select 1 from public.faolla_schema_migrations where version=202610060166 and name='merchant_attendance_employment_lifecycle') or not exists(select 1 from public.faolla_schema_migrations where version=202610080204 and name='merchant_attendance_delegated_groups') then raise exception 'merchant_attendance_delegated_configuration_prerequisite_required';end if;
 if exists(select 1 from public.faolla_schema_migrations where version=202610080205 and name<>'merchant_attendance_delegated_configuration') then raise exception 'merchant_attendance_delegated_configuration_installation_conflict';end if;
 end;$config205_prerequisites$;
 ${templates}
 create temp table config205_forward_metadata on commit drop as select proc.oid,to_jsonb(proc)-array['prosrc','proargdefaults'] metadata,pg_get_expr(proc.proargdefaults,0) default_expression from pg_proc proc where proc.oid in('${forward.legacy.signature}'::regprocedure,'${forward.guard.signature}'::regprocedure);
 do $config205_preflight$ ${declarations} begin ${common}${deps(false)}
 if (select count(*) from pg_proc proc where proc.pronamespace=(select oid from pg_namespace where nspname=ns) and (proc.proname like 'faolla_attendance_delegated_config_%' or proc.proname='faolla_attendance_admin_core_v2'))<>(case when installed then 10 else 0 end) then raise exception 'merchant_attendance_delegated_configuration_installation_conflict';end if;
 if installed then ${ownChecks} end if;${tableChecks}
 end;$config205_preflight$;`;
 const forwardSql=[forward.legacy,forward.guard].map((f,i)=>`do $config205_forward_${i}$ declare old_body text;definition text;begin
 if exists(select 1 from public.faolla_schema_migrations where version=202610080205 and name='merchant_attendance_delegated_configuration') then return;end if;
 select replace(proc.prosrc,E'\\r\\n',E'\\n'),pg_get_functiondef(proc.oid) into old_body,definition from pg_proc proc where proc.oid='${f.signature}'::regprocedure;
 if old_body is distinct from $config205_old_${i}$${f.oldBody}$config205_old_${i}$ or position(old_body in definition)=0 then raise exception 'merchant_attendance_delegated_configuration_forward_drift';end if;
 execute replace(definition,old_body,$config205_new_${i}$${f.newBody}$config205_new_${i}$);
 end;$config205_forward_${i}$;`).join('\n');
 const final=own.map(f=>`revoke all on function ${f.signature} from public,anon,authenticated,service_role;${f.isRpc?`\ngrant execute on function ${f.signature} to service_role;`:''}`).join('\n')+`
 do $config205_postconditions$ ${declarations} begin ${common}${deps(true)}${ownChecks}${tableChecks}
 if (select count(*) from config205_forward_metadata)<>2 or exists(select 1 from config205_forward_metadata original left join pg_proc proc on proc.oid=original.oid where proc.oid is null or to_jsonb(proc)-array['prosrc','proargdefaults'] is distinct from original.metadata or pg_get_expr(proc.proargdefaults,0) is distinct from original.default_expression) then raise exception 'merchant_attendance_delegated_configuration_forward_metadata_changed';end if;
 end;$config205_postconditions$;
 drop table pg_temp.config205_forward_metadata,pg_temp.merchant_attendance_config_operations,pg_temp.groups_expected_settings;`;
 return Object.freeze({own,dependencies:unique,forward,preflight,forwardSql,final,tableChecks});
}
export function delegatedConfigurationFreezeSql(sql,migrations){
 let text=sql.replaceAll('\r\n','\n'),forward=delegatedConfigurationForwardRecipes(migrations);
 const core=`create or replace function public.faolla_attendance_admin_core_v2(p_site_id text,p_auth_user_id uuid,p_query jsonb,p_command jsonb,p_operation_id uuid,p_grant_id uuid)\nreturns jsonb language plpgsql set search_path=pg_catalog as $$${forward.core}$$;`;
 text=text.replace(/--BEGIN GENERATED DELEGATED CONFIGURATION CORE[\s\S]*?--END GENERATED DELEGATED CONFIGURATION CORE/,()=>`--BEGIN GENERATED DELEGATED CONFIGURATION CORE\n${core}\n--END GENERATED DELEGATED CONFIGURATION CORE`);
 const r=delegatedConfigurationInstallRecipe(text,migrations);
 for(const[name,body]of[['PREFLIGHT',r.preflight],['FORWARD',r.forwardSql],['POSTCONDITIONS',r.final]]){const marker=new RegExp('--BEGIN GENERATED DELEGATED CONFIGURATION '+name+'[\\s\\S]*?--END GENERATED DELEGATED CONFIGURATION '+name);assert(marker.test(text));text=text.replace(marker,()=>`--BEGIN GENERATED DELEGATED CONFIGURATION ${name}\n${body}\n--END GENERATED DELEGATED CONFIGURATION ${name}`);}return text;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.deepEqual(process.argv.slice(2),['--write']);const dir=path.join(path.dirname(fileURLToPath(import.meta.url)),'supabase-migrations');
 const migrations=readdirSync(dir).filter(n=>/^\d+_.+\.sql$/.test(n)&&n<delegatedConfigurationMigration).sort().map(name=>({name,text:readFileSync(path.join(dir,name),'utf8')}));
 const file=path.join(dir,delegatedConfigurationMigration),result=delegatedConfigurationFreezeSql(readFileSync(file,'utf8'),migrations);writeFileSync(file,result,'utf8');
 console.log(JSON.stringify({sourceOnly:true,migration:delegatedConfigurationMigration,sha256:sha(result)}));
}
