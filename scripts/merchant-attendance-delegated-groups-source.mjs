//204 finite SOURCE only. --write mechanically freezes recipes; no connection.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {dayReviewSqlFunctions} from './merchant-attendance-day-review-source.mjs';
import {managementDelegationInstallRecipe,managementDelegationMigration,managementDelegationOwnManifest} from './merchant-attendance-management-delegation-source.mjs';
import {delegatedAuditForwardRecipe} from './merchant-attendance-delegated-audit-source.mjs';

export const delegatedGroupsMigration='202610080204_merchant_attendance_delegated_groups.sql';
export const delegatedGroupsActions=Object.freeze(['group_save','group_assign','group_end','group_cancel']);
export const delegatedGroupsTables=Object.freeze(['merchant_attendance_groups','merchant_attendance_group_operations','merchant_attendance_group_assignments','merchant_attendance_group_assignment_operations']);
const sha=v=>createHash('sha256').update(v.replaceAll('\r\n','\n'),'utf8').digest('hex');
const quote=v=>"'"+v.replaceAll("'","''")+"'";
const manifest=f=>{const {body,...m}=f;void body;return{...m,isRpc:f.name==='faolla_attendance_delegated_groups_v1'||f.name==='faolla_attendance_groups_v1'};};
const ownerAnchor="  perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;\n  if not found then raise exception 'attendance_access_denied';end if;";
export function delegatedGroupsForwardRecipes(groups,foundation){
 const old=dayReviewSqlFunctions(groups).find(f=>f.name==='faolla_attendance_groups_v1');assert(old);
 assert.equal(old.hash,'d130e4c2de2fef57ce6f18c15cc9ddb99b1d0fedb029b4e44872aee071bb9068');
 assert.equal(old.body.split(ownerAnchor).length-1,1);
 const core=old.body.replace(ownerAnchor,`  if p_grant_id is null then\n${ownerAnchor}\n  else\n    if view_name<>'context' or p_query->'operationId'<>'null'::jsonb then raise exception 'attendance_invalid_request';end if;\n    perform public.faolla_attendance_delegated_groups_authorize_v1(site,p_auth_user_id,p_grant_id,action_name,false);\n  end if;`);
 const wrapper='\nbegin\n return public.faolla_attendance_groups_core_v2(p_query,p_auth_user_id,p_command,p_allow_write,null);\nend;\n';
 const parent=delegatedAuditForwardRecipe(foundation);assert.equal(parent.newHash,'46d4e3edf8aba8d474b0e6e19651adc80fb7466a94c785f70e6681dc13a55110');
 const from="  if new.delegated_action='audit_export' then perform public.faolla_attendance_management_audit_authority_v1(new);return new;end if;";
 assert.equal(parent.newBody.split(from).length-1,1);
 const guard=parent.newBody.replace(from,from+"\n  if new.delegated_action in('group_save','group_assign','group_end','group_cancel') then perform public.faolla_attendance_delegated_groups_authority_v1(new);return new;end if;");
 return Object.freeze({core,legacy:Object.freeze({...manifest(old),oldHash:old.hash,newHash:sha(wrapper),oldBody:old.body,newBody:wrapper}),guard:Object.freeze({...manifest(parent),oldHash:parent.newHash,newHash:sha(guard),oldBody:parent.newBody,newBody:guard})});
}
export function delegatedGroupsOwnManifest(sql){return dayReviewSqlFunctions(sql).filter(f=>f.name.startsWith('faolla_attendance_delegated_groups_')||f.name==='faolla_attendance_groups_core_v2').map(manifest);}
export function delegatedGroupsInstallRecipe(sql,migrations){
 const groups=migrations.find(f=>f.name==='202610030124_merchant_attendance_groups.sql')?.text;
 const foundation=migrations.find(f=>f.name===managementDelegationMigration)?.text;assert(groups&&foundation);
 const forward=delegatedGroupsForwardRecipes(groups,foundation),own=delegatedGroupsOwnManifest(sql);assert.equal(own.length,9);
 assert.equal(dayReviewSqlFunctions(sql).find(f=>f.name==='faolla_attendance_groups_core_v2')?.body,forward.core);
 const parent=managementDelegationInstallRecipe(foundation,migrations.filter(f=>f.name<managementDelegationMigration));
 const functionChecks=parent.preflight.match(/for spec in select value from jsonb_array_elements\(own_spec\) loop[\s\S]*?\n end loop;/)?.[0];assert(functionChecks);
 const deps=dayReviewSqlFunctions(groups).filter(f=>f.name!=='faolla_attendance_groups_v1').map(manifest);
 deps.push(...managementDelegationOwnManifest(foundation).filter(f=>f.name!=='faolla_attendance_management_insert_v1'));
 const latest=new Map();for(const m of migrations)for(const f of dayReviewSqlFunctions(m.text))latest.set(f.name,f);
 deps.push(manifest(latest.get('faolla_attendance_operational_rule_hash_v1')));
 const foreignMap=[['groups_expected_settings','merchant_attendance_settings'],['groups_expected_workers','merchant_attendance_workers'],...delegatedGroupsTables.map(n=>[n,n])];
 //061 stores workers.id before merchant_id. Preserve their physical column
 //numbers so the exact referenced-key comparison is meaningful, not {1,2}
 //against the real FK's {2,1}. This is only a temporary parser stub.
 const templates=`create temp table groups_expected_settings(merchant_id text primary key) on commit drop;\ncreate temp table groups_expected_workers(id uuid,merchant_id text,primary key(merchant_id,id)) on commit drop;\n`+delegatedGroupsTables.map(n=>{
  const table=groups.match(new RegExp('create table if not exists public\\.'+n+' \\([\\s\\S]*?\\n\\);'))?.[0];assert(table);
  return table.replace('create table if not exists public.','create temp table ').replace(/\n\);$/,'\n) on commit drop;').replaceAll('references public.merchant_attendance_settings','references pg_temp.groups_expected_settings').replaceAll('references public.merchant_attendance_workers','references pg_temp.groups_expected_workers').replaceAll('references public.','references pg_temp.');
 }).join('\n')+`\nalter table pg_temp.merchant_attendance_groups add constraint attendance_group_create_receipt_fk foreign key(merchant_id,group_id) references pg_temp.merchant_attendance_group_operations(merchant_id,operation_id) deferrable initially deferred;\nalter table pg_temp.merchant_attendance_group_assignments add constraint attendance_group_assignment_receipt_fk foreign key(merchant_id,assignment_id) references pg_temp.merchant_attendance_group_assignment_operations(merchant_id,operation_id) deferrable initially deferred;\n`+(groups.match(/^create index if not exists [^\n]+;/gm)??[]).map(i=>i.replace(' if not exists','').replace('on public.','on pg_temp.')).join('\n');
 assert(!templates.includes('references public.'));
 const tableChecks=`foreach table_name in array array[${delegatedGroupsTables.map(quote).join(',')}] loop
  actual_table:=to_regclass(ns||'.'||table_name);expected_table:=to_regclass('pg_temp.'||table_name);
  if not exists(select 1 from pg_class catalog_table where catalog_table.oid=actual_table and catalog_table.relkind='r' and catalog_table.relowner=expected_owner and catalog_table.relrowsecurity and not catalog_table.relforcerowsecurity)
   or exists(select 1 from pg_policy where polrelid=actual_table)
   or exists(select 1 from pg_class catalog_table cross join lateral aclexplode(coalesce(catalog_table.relacl,acldefault('r',catalog_table.relowner))) acl where catalog_table.oid=actual_table and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
   or exists(select 1 from pg_attribute attribute cross join lateral aclexplode(attribute.attacl) acl where attribute.attrelid=actual_table and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
   or (select count(*) from pg_attribute where attrelid=actual_table and attnum>0)<>(select count(*) from pg_attribute where attrelid=expected_table and attnum>0)
   or exists(select 1 from pg_attribute actual full join pg_attribute expected on expected.attrelid=expected_table and actual.attnum=expected.attnum where actual.attrelid=actual_table and actual.attnum>0 and row(actual.attname,actual.atttypid,actual.atttypmod,actual.attnotnull,actual.atthasdef,actual.attidentity,actual.attgenerated,actual.attndims,actual.attisdropped,actual.attcollation) is distinct from row(expected.attname,expected.atttypid,expected.atttypmod,expected.attnotnull,expected.atthasdef,expected.attidentity,expected.attgenerated,expected.attndims,expected.attisdropped,expected.attcollation)) then raise exception 'merchant_attendance_delegated_groups_table_conflict';end if;
  if (select count(*) from pg_constraint where conrelid=actual_table and contype<>'t')<>(select count(*) from pg_constraint where conrelid=expected_table and contype<>'t') then raise exception 'merchant_attendance_delegated_groups_constraint_conflict';end if;
  for constraint_spec in select * from pg_constraint where conrelid=expected_table and contype<>'t' loop
   select * into actual_constraint from pg_constraint where conrelid=actual_table and conname=constraint_spec.conname;
   foreign_table:=case constraint_spec.confrelid ${foreignMap.map(([temp,real])=>`when to_regclass('pg_temp.${temp}') then to_regclass(ns||'.${real}')`).join(' ')} else constraint_spec.confrelid end;
   if actual_constraint.oid is null or row(actual_constraint.contype,actual_constraint.conkey,actual_constraint.confkey,actual_constraint.confrelid,actual_constraint.condeferrable,actual_constraint.condeferred,actual_constraint.convalidated,actual_constraint.confupdtype,actual_constraint.confdeltype,actual_constraint.confmatchtype,actual_constraint.connoinherit) is distinct from row(constraint_spec.contype,constraint_spec.conkey,constraint_spec.confkey,foreign_table::oid,constraint_spec.condeferrable,constraint_spec.condeferred,constraint_spec.convalidated,constraint_spec.confupdtype,constraint_spec.confdeltype,constraint_spec.confmatchtype,constraint_spec.connoinherit)
    or pg_get_expr(actual_constraint.conbin,actual_table) is distinct from pg_get_expr(constraint_spec.conbin,expected_table) then raise exception 'merchant_attendance_delegated_groups_constraint_conflict';end if;
  end loop;
  if (select count(*) from pg_index where indrelid=actual_table)<>(select count(*) from pg_index where indrelid=expected_table) then raise exception 'merchant_attendance_delegated_groups_index_conflict';end if;
  for index_spec in select index_row.*,index_table.relname,index_table.relam from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_row.indrelid=expected_table loop
   select index_row.*,index_table.relowner,index_table.relam,index_table.relkind into actual_index from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_row.indexrelid=to_regclass(ns||'.'||index_spec.relname);
   if actual_index.indexrelid is null or actual_index.indrelid<>actual_table or actual_index.relowner<>expected_owner or actual_index.relkind<>'i' or not actual_index.indisvalid or not actual_index.indisready or not actual_index.indislive
    or row(actual_index.relam,actual_index.indnatts,actual_index.indnkeyatts,actual_index.indisunique,actual_index.indisprimary,actual_index.indisexclusion,actual_index.indimmediate,actual_index.indkey,actual_index.indcollation,actual_index.indclass,actual_index.indoption) is distinct from row(index_spec.relam,index_spec.indnatts,index_spec.indnkeyatts,index_spec.indisunique,index_spec.indisprimary,index_spec.indisexclusion,index_spec.indimmediate,index_spec.indkey,index_spec.indcollation,index_spec.indclass,index_spec.indoption)
    or pg_get_expr(actual_index.indpred,actual_table) is distinct from pg_get_expr(index_spec.indpred,expected_table) or pg_get_expr(actual_index.indexprs,actual_table) is distinct from pg_get_expr(index_spec.indexprs,expected_table) then raise exception 'merchant_attendance_delegated_groups_index_conflict';end if;
  end loop;
  if (select count(*) from pg_trigger where tgrelid=actual_table and not tgisinternal)<>(case when table_name like '%operations' then 2 else 0 end) then raise exception 'merchant_attendance_delegated_groups_trigger_conflict';end if;
  if table_name like '%operations' then for trigger_spec in select * from(values('_immutable',27),('_no_truncate',34)) expected(suffix,kind) loop
   if not exists(select 1 from pg_trigger actual where actual.tgrelid=actual_table and actual.tgname=(table_name||trigger_spec.suffix)::name and actual.tgtype=trigger_spec.kind and actual.tgenabled='O' and actual.tgnargs=0 and actual.tgqual is null and not actual.tgdeferrable and not actual.tginitdeferred and actual.tgfoid=to_regprocedure(ns||'.faolla_attendance_events_append_only_v1()')) then raise exception 'merchant_attendance_delegated_groups_trigger_conflict';end if;
  end loop;end if;
 end loop;`;
 const declarations='declare ns text;expected_owner oid;installed boolean;has190 boolean;spec jsonb;own_spec jsonb;f regprocedure;meta record;table_name text;actual_table regclass;expected_table regclass;foreign_table regclass;constraint_spec record;actual_constraint record;index_spec record;actual_index record;trigger_spec record;';
 const common=`select namespace.nspname,catalog_table.relowner into ns,expected_owner from pg_class catalog_table join pg_namespace namespace on namespace.oid=catalog_table.relnamespace where catalog_table.oid='public.merchant_attendance_settings'::regclass;
 if expected_owner is distinct from (select oid from pg_roles where rolname=current_user) then raise exception 'merchant_attendance_delegated_groups_owner_conflict';end if;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080204 and name='merchant_attendance_delegated_groups');
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');`;
 const forwardMeta=(f,after)=>{const{oldBody,newBody,oldHash,newHash,...meta}=f;void oldBody;void newBody;void oldHash;void newHash;return{...meta,hash:after?f.newHash:f.oldHash};};
 const dependencies=post=>`own_spec:=$groups_dependencies$${JSON.stringify(deps)}$groups_dependencies$::jsonb;
 own_spec:=own_spec||jsonb_build_array((case when has190 then $groups_catalog190$${JSON.stringify(manifest(parent.recipe.forward.catalog190))}$groups_catalog190$::jsonb else $groups_catalog185$${JSON.stringify(manifest(parent.recipe.forward.catalog185))}$groups_catalog185$::jsonb end)||jsonb_build_object('hash',case when has190 then '${parent.recipe.forward.catalog190.newHash}' else '${parent.recipe.forward.catalog185.newHash}' end),$groups_capture$${JSON.stringify(manifest(parent.recipe.forward.capture))}$groups_capture$::jsonb||jsonb_build_object('hash','${parent.recipe.forward.capture.newHash}'));
 own_spec:=own_spec||jsonb_build_array($groups_legacy_meta$${JSON.stringify(forwardMeta(forward.legacy,false))}$groups_legacy_meta$::jsonb||jsonb_build_object('hash',${post?quote(forward.legacy.newHash):`case when installed then '${forward.legacy.newHash}' else '${forward.legacy.oldHash}' end`}),$groups_guard_meta$${JSON.stringify(forwardMeta(forward.guard,false))}$groups_guard_meta$::jsonb||jsonb_build_object('hash',${post?quote(forward.guard.newHash):`case when installed then '${forward.guard.newHash}' else '${forward.guard.oldHash}' end`}));
 ${functionChecks}`;
 const ownChecks=`own_spec:=$groups_own$${JSON.stringify(own)}$groups_own$::jsonb;${functionChecks}`;
 const preflight=`do $groups204_prerequisites$ begin
 if to_regclass('public.faolla_schema_migrations') is null or not exists(select 1 from public.faolla_schema_migrations where version=202610030124 and name='merchant_attendance_groups') or not exists(select 1 from public.faolla_schema_migrations where version=202610080203 and name='merchant_attendance_delegated_audit') then raise exception 'merchant_attendance_delegated_groups_prerequisite_required';end if;
 if exists(select 1 from public.faolla_schema_migrations where version=202610080204 and name<>'merchant_attendance_delegated_groups') then raise exception 'merchant_attendance_delegated_groups_installation_conflict';end if;
 end;$groups204_prerequisites$;
 ${templates}
 create temp table groups204_forward_metadata on commit drop as select proc.oid,to_jsonb(proc)-array['prosrc','proargdefaults'] metadata,pg_get_expr(proc.proargdefaults,0) default_expression from pg_proc proc where proc.oid in('${forward.legacy.signature}'::regprocedure,'${forward.guard.signature}'::regprocedure);
 do $groups204_preflight$ ${declarations} begin ${common}
 ${dependencies(false)}
 if (select count(*) from pg_proc proc where proc.pronamespace=(select oid from pg_namespace where nspname=ns) and (proc.proname like 'faolla_attendance_delegated_groups_%' or proc.proname='faolla_attendance_groups_core_v2'))<>(case when installed then 9 else 0 end) then raise exception 'merchant_attendance_delegated_groups_installation_conflict';end if;
 if installed then ${ownChecks} end if;
 ${tableChecks}
 end;$groups204_preflight$;`;
 const forwardSql=[forward.legacy,forward.guard].map((f,i)=>`do $groups204_forward_${i}$ declare old_body text;definition text;begin
 if exists(select 1 from public.faolla_schema_migrations where version=202610080204 and name='merchant_attendance_delegated_groups') then return;end if;
 select replace(proc.prosrc,E'\\r\\n',E'\\n'),pg_get_functiondef(proc.oid) into old_body,definition from pg_proc proc where proc.oid='${f.signature}'::regprocedure;
 if old_body is distinct from $groups204_old_${i}$${f.oldBody}$groups204_old_${i}$ or position(old_body in definition)=0 then raise exception 'merchant_attendance_delegated_groups_forward_drift';end if;
 execute replace(definition,old_body,$groups204_new_${i}$${f.newBody}$groups204_new_${i}$);
 end;$groups204_forward_${i}$;`).join('\n');
 const final=own.map(f=>`revoke all on function ${f.signature} from public,anon,authenticated,service_role;${f.isRpc?`\ngrant execute on function ${f.signature} to service_role;`:''}`).join('\n')+`
 do $groups204_postconditions$ ${declarations} begin ${common}
 ${dependencies(true)}${ownChecks}${tableChecks}
 if (select count(*) from groups204_forward_metadata)<>2 or exists(select 1 from groups204_forward_metadata original left join pg_proc proc on proc.oid=original.oid where proc.oid is null or to_jsonb(proc)-array['prosrc','proargdefaults'] is distinct from original.metadata or pg_get_expr(proc.proargdefaults,0) is distinct from original.default_expression) then raise exception 'merchant_attendance_delegated_groups_forward_metadata_changed';end if;
 end;$groups204_postconditions$;
 drop table pg_temp.groups204_forward_metadata,${[...delegatedGroupsTables,'groups_expected_workers','groups_expected_settings'].map(n=>'pg_temp.'+n).join(',')};`;
 return Object.freeze({own,dependencies:deps,forward,preflight,forwardSql,final,tableChecks});
}
export function delegatedGroupsFreezeSql(sql,migrations){
 let text=sql.replaceAll('\r\n','\n');const recipe=delegatedGroupsInstallRecipe(text,migrations);
 for(const [name,body]of[['PREFLIGHT',recipe.preflight],['FORWARD',recipe.forwardSql],['POSTCONDITIONS',recipe.final]]){const marker=new RegExp('--BEGIN GENERATED DELEGATED GROUPS '+name+'[\\s\\S]*?--END GENERATED DELEGATED GROUPS '+name);assert(marker.test(text));text=text.replace(marker,()=>`--BEGIN GENERATED DELEGATED GROUPS ${name}\n${body}\n--END GENERATED DELEGATED GROUPS ${name}`);}return text;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.deepEqual(process.argv.slice(2),['--write']);const dir=path.join(path.dirname(fileURLToPath(import.meta.url)),'supabase-migrations');
 const migrations=readdirSync(dir).filter(n=>/^\d+_.+\.sql$/.test(n)&&n<delegatedGroupsMigration).sort().map(name=>({name,text:readFileSync(path.join(dir,name),'utf8')}));
 const file=path.join(dir,delegatedGroupsMigration),result=delegatedGroupsFreezeSql(readFileSync(file,'utf8'),migrations);writeFileSync(file,result,'utf8');
 console.log(JSON.stringify({sourceOnly:true,migration:delegatedGroupsMigration,sha256:sha(result)}));
}
