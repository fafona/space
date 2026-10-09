//206 inert finite SOURCE recipe. --write generates only this candidate SQL.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {dayReviewSqlFunctions} from './merchant-attendance-day-review-source.mjs';
import {managementDelegationInstallRecipe,managementDelegationMigration} from './merchant-attendance-management-delegation-source.mjs';
import {delegatedConfigurationForwardRecipes} from './merchant-attendance-delegated-configuration-source.mjs';
export const delegatedRulesMigration='202610080206_merchant_attendance_delegated_rules.sql';
export const delegatedRulesActions=Object.freeze(['rule_draft','rule_publish','rule_withdraw','personal_rule_approve','personal_rule_withdraw','operational_rule_draft','operational_rule_publish','operational_rule_withdraw']);
const sha=s=>createHash('sha256').update(s.replaceAll('\r\n','\n'),'utf8').digest('hex');
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const sources=Object.freeze([
 {family:'base',prefix:'202610040127_',name:'faolla_attendance_rules_v1',core:'faolla_attendance_delegated_rules_base_core_v1',hash:'f10892ab5cb5e4920a63b9a31e75a7f33cb2542979cfb2736553b8ec918e8f97',
  anchor:"  perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;\n  if not found then raise exception 'attendance_access_denied';end if;",
  boundary:"  perform public.faolla_attendance_delegated_rules_core_authorize_v1(site,p_auth_user_id,p_grant_id,'base',jsonb_build_object('kind',case when gid is null then 'enterprise' else 'group' end)||case when gid is null then '{}'::jsonb else jsonb_build_object('groupId',gid) end,p_command);"},
 {family:'personal',prefix:'202610040129_',name:'faolla_attendance_personal_rules_v1',core:'faolla_attendance_delegated_rules_personal_core_v1',hash:'a1f2ddd77655a5b58e7fd27f8fea54a7c0459fbe26b79edecf2d486f37260b08',
  anchor:"  perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;\n  if not found then raise exception 'attendance_access_denied';end if;",
  boundary:"  perform public.faolla_attendance_delegated_rules_core_authorize_v1(site,p_auth_user_id,p_grant_id,'personal',jsonb_build_object('kind','personal','workerId',wid),p_command);"},
 {family:'operational',prefix:'202610080191_',name:'faolla_attendance_operational_rules_v1',core:'faolla_attendance_delegated_rules_operational_core_v1',hash:'c729c0c16e81c29dec02e7f78ebc77d4a2c7f4b3448724f6c5064a3f771ef7fb',
  anchor:" select * into m from public.merchants x where x.id=site for share;\n if m.id is null or mode_name<>'recover' and m.user_id is distinct from p_auth_user_id then raise exception 'attendance_access_denied';end if;",
  boundary:"  if mode_name not in('detail','history','preview') then raise exception 'attendance_invalid_request';end if;\n  select * into m from public.merchants x where x.id=site for share;\n  perform public.faolla_attendance_delegated_rules_core_authorize_v1(site,p_auth_user_id,p_grant_id,'operational',scope_value,p_command);"},
]);
const meta=f=>{const{body,oldBody,newBody,oldHash,newHash,changes,family,coreName,core,anchor,...m}=f;void body;void oldBody;void newBody;void oldHash;void newHash;void changes;void family;void coreName;void core;void anchor;return m;};
export function delegatedRulesForwardRecipes(migrations){
 const forwards=sources.map(s=>{const file=migrations.find(m=>m.name.startsWith(s.prefix));assert(file);const f=dayReviewSqlFunctions(file.text).find(f=>f.name===s.name);assert(f);assert.equal(f.hash,s.hash);
  assert.equal(f.body.split(s.anchor).length-1,1,s.name+':single owner boundary');
  const core=f.body.replace(s.anchor,"  if p_grant_id is null then\n"+s.anchor+"\n  else\n"+s.boundary+"\n  end if;");
  const wrapper=`\nbegin\n return public.${s.core}(p_query,p_auth_user_id,p_command,p_allow_write,null);\nend;\n`;
  return{...meta(f),isRpc:true,family:s.family,coreName:s.core,core,anchor:s.anchor,oldBody:f.body,newBody:wrapper,oldHash:f.hash,newHash:sha(wrapper)};
 });
 const previous=delegatedConfigurationForwardRecipes(migrations).guard;assert.equal(previous.newHash,'0be4836fd81477e2aabd411f282f16909f3345e06cca96795e390a4b8d1115d7');
 const anchor="  if new.delegated_action in('worker_save','location_save') then perform public.faolla_attendance_delegated_config_authority_v1(new);return new;end if;";
 assert.equal(previous.newBody.split(anchor).length-1,1);
 const body=previous.newBody.replace(anchor,anchor+`\n  if new.delegated_action in(${delegatedRulesActions.map(quote).join(',')}) then perform public.faolla_attendance_delegated_rules_authority_v1(new);return new;end if;`);
 return{cores:forwards,guard:{...meta(previous),isRpc:false,oldBody:previous.newBody,newBody:body,oldHash:previous.newHash,newHash:sha(body)}};
}
export function delegatedRulesOwnManifest(sql){return dayReviewSqlFunctions(sql).filter(f=>f.name.startsWith('faolla_attendance_delegated_rules_')).map(f=>({...meta(f),isRpc:f.name==='faolla_attendance_delegated_rules_v1'}));}
function ruleTemplates(migrations){
 const statements=[],tables=[],indexes=[],headFks=[];
 for(const source of sources){const sql=migrations.find(m=>m.name.startsWith(source.prefix)).text;
  for(const m of sql.matchAll(/create table if not exists public\.(merchant_attendance_(?:personal_|operational_)?rule_\w+) \([\s\S]*?\n\);/g)){tables.push(m[1]);statements.push(m[0].replace('create table if not exists public.','create temp table ').replace(/\n\);$/,'\n) on commit drop;').replaceAll('references public.','references pg_temp.'));}
  for(const m of sql.matchAll(/^create (?:unique )?index if not exists [^\n]+;/gm))indexes.push(m[0].replace(' if not exists','').replace('on public.','on pg_temp.'));
  for(const m of sql.matchAll(/alter table public\.(merchant_attendance_(?:personal_)?rule_streams) add constraint [\s\S]*?;/g))headFks.push(m[0].replaceAll('public.','pg_temp.'));
 }
 assert.equal(tables.length,7);assert.equal(indexes.length,9);assert.equal(headFks.length,3);
 const parents=`create temp table merchant_attendance_settings(merchant_id text primary key) on commit drop;
create temp table merchant_attendance_groups(merchant_id text,group_id uuid,primary key(merchant_id,group_id)) on commit drop;
create temp table merchant_attendance_workers(id uuid,merchant_id text,primary key(merchant_id,id)) on commit drop;
create temp table merchant_enterprise_employees(id uuid,merchant_id text,primary key(merchant_id,id)) on commit drop;`;
 return{tables,sql:parents+'\n'+[...statements,...indexes,...headFks].join('\n')};
}
export function delegatedRulesInstallRecipe(sql,migrations){
 const forward=delegatedRulesForwardRecipes(migrations),own=delegatedRulesOwnManifest(sql),allForward=[...forward.cores,forward.guard];assert(own.length>=12&&own.length<=24);
 for(const f of forward.cores)assert.equal(dayReviewSqlFunctions(sql).find(x=>x.name===f.coreName)?.body,f.core);
 const get=n=>{const m=migrations.find(m=>m.name===n);assert(m);return m.text;};
 const foundation=managementDelegationInstallRecipe(get(managementDelegationMigration),migrations.filter(m=>m.name<managementDelegationMigration));
 const checks=foundation.preflight.match(/for spec in select value from jsonb_array_elements\(own_spec\) loop[\s\S]*?\n end loop;/)?.[0];assert(checks);
 const dependencies=[];
 for(const s of sources)for(const f of dayReviewSqlFunctions(migrations.find(m=>m.name.startsWith(s.prefix)).text))if(f.name!==s.name)dependencies.push({...meta(f),isRpc:false});
 const foundationOwn=JSON.parse(foundation.final.match(/\$management_post_own\$([\s\S]*?)\$management_post_own\$/)[1]);
 dependencies.push(...foundationOwn.filter(f=>f.name!=='faolla_attendance_management_insert_v1'));
 const latest=new Map();for(const file of migrations)for(const f of dayReviewSqlFunctions(file.text))latest.set(f.name,f);
 for(const name of ['faolla_attendance_group_text_v1','faolla_attendance_group_date_v1','faolla_attendance_group_checked_v1','faolla_attendance_valid_zone_v1','faolla_attendance_shift_rule_binding_object_v1','faolla_attendance_events_append_only_v1']){assert(latest.has(name),name);dependencies.push({...meta(latest.get(name)),isRpc:false});}
 const unique=[...new Map(dependencies.map(f=>[f.signature,f])).values()],templates=ruleTemplates(migrations);
 const declarations='declare ns text;expected_owner oid;installed boolean;has190 boolean;spec jsonb;forward_spec jsonb;own_spec jsonb;f regprocedure;meta record;actual_table regclass;expected_table regclass;foreign_table regclass;table_name text;constraint_spec record;actual_constraint record;index_spec record;actual_index record;trigger_spec record;reference_keys smallint[];';
 const common=`select namespace.nspname,catalog_table.relowner into ns,expected_owner from pg_class catalog_table join pg_namespace namespace on namespace.oid=catalog_table.relnamespace where catalog_table.oid='public.merchant_attendance_settings'::regclass;
 if expected_owner is distinct from (select oid from pg_roles where rolname=current_user) then raise exception 'merchant_attendance_delegated_rules_owner_conflict';end if;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080206 and name='merchant_attendance_delegated_rules');
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');`;
 const fm=(f,post)=>({...meta(f),hash:post?f.newHash:f.oldHash});
 const deps=post=>`own_spec:=$rules206_dependencies$${JSON.stringify(unique)}$rules206_dependencies$::jsonb;
 own_spec:=own_spec||jsonb_build_array((case when has190 then $rules206_catalog190$${JSON.stringify({...fm(foundation.recipe.forward.catalog190,true),isRpc:false})}$rules206_catalog190$::jsonb else $rules206_catalog185$${JSON.stringify({...fm(foundation.recipe.forward.catalog185,true),isRpc:false})}$rules206_catalog185$::jsonb end),$rules206_capture$${JSON.stringify({...fm(foundation.recipe.forward.capture,true),isRpc:false})}$rules206_capture$::jsonb);
 own_spec:=own_spec||$rules206_forwards$${JSON.stringify(allForward.map(f=>({...fm(f,false),oldHash:f.oldHash,newHash:f.newHash})))}$rules206_forwards$::jsonb;
 for forward_spec in select value from jsonb_array_elements(own_spec) loop
  if forward_spec ? 'newHash' then forward_spec:=forward_spec||jsonb_build_object('hash',forward_spec->>(case when ${post?'true':'installed'} then 'newHash' else 'oldHash' end));end if;
  own_spec:=jsonb_build_array(forward_spec);${checks}
 end loop;`;
 //Actual source DDL builds TEMP-only FK templates; no old table is altered.
 const tableChecks=`foreach table_name in array array[${templates.tables.map(quote).join(',')}] loop
 actual_table:=to_regclass(ns||'.'||table_name);expected_table:=to_regclass('pg_temp.'||table_name);
 if not exists(select 1 from pg_class catalog_table where catalog_table.oid=actual_table and catalog_table.relkind='r' and catalog_table.relowner=expected_owner and catalog_table.relrowsecurity and not catalog_table.relforcerowsecurity and catalog_table.relpersistence='p' and not catalog_table.relispartition)
  or exists(select 1 from pg_policy where polrelid=actual_table)
  or exists(select 1 from pg_class catalog_table cross join lateral aclexplode(coalesce(catalog_table.relacl,acldefault('r',catalog_table.relowner))) acl where catalog_table.oid=actual_table and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
  or exists(select 1 from pg_attribute attribute cross join lateral aclexplode(attribute.attacl) acl where attribute.attrelid=actual_table and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
  or (select count(*) from pg_attribute where attrelid=actual_table and attnum>0)<>(select count(*) from pg_attribute where attrelid=expected_table and attnum>0)
  or exists(select 1 from pg_attribute actual join pg_attribute expected on expected.attrelid=expected_table and actual.attnum=expected.attnum
   left join pg_attrdef actual_default on actual_default.adrelid=actual.attrelid and actual_default.adnum=actual.attnum
   left join pg_attrdef expected_default on expected_default.adrelid=expected.attrelid and expected_default.adnum=expected.attnum
   where actual.attrelid=actual_table and actual.attnum>0 and (row(actual.attname,actual.atttypid,actual.atttypmod,actual.attnotnull,actual.atthasdef,actual.attidentity,actual.attgenerated,actual.attndims,actual.attisdropped,actual.attcollation)
    is distinct from row(expected.attname,expected.atttypid,expected.atttypmod,expected.attnotnull,expected.atthasdef,expected.attidentity,expected.attgenerated,expected.attndims,expected.attisdropped,expected.attcollation)
    or pg_get_expr(actual_default.adbin,actual_table) is distinct from pg_get_expr(expected_default.adbin,expected_table))) then raise exception 'merchant_attendance_delegated_rules_table_conflict';end if;
 if (select count(*) from pg_constraint where conrelid=actual_table and contype<>'t')<>(select count(*) from pg_constraint where conrelid=expected_table and contype<>'t') then raise exception 'merchant_attendance_delegated_rules_constraint_conflict';end if;
 for constraint_spec in select * from pg_constraint where conrelid=expected_table and contype<>'t' loop
  select * into actual_constraint from pg_constraint where conrelid=actual_table and conname=constraint_spec.conname;
  foreign_table:=case when constraint_spec.contype='f' then to_regclass(ns||'.'||(select relname from pg_class where oid=constraint_spec.confrelid)) else 0::oid end;
  select array_agg(actual_ref.attnum::smallint order by requested.ord) into reference_keys from unnest(constraint_spec.confkey) with ordinality requested(attnum,ord)
   join pg_attribute expected_ref on expected_ref.attrelid=constraint_spec.confrelid and expected_ref.attnum=requested.attnum
   join pg_attribute actual_ref on actual_ref.attrelid=foreign_table and actual_ref.attname=expected_ref.attname;
  if actual_constraint.oid is null or row(actual_constraint.contype,actual_constraint.conkey,actual_constraint.confkey,actual_constraint.confrelid,actual_constraint.condeferrable,actual_constraint.condeferred,actual_constraint.convalidated,actual_constraint.confupdtype,actual_constraint.confdeltype,actual_constraint.confmatchtype,actual_constraint.connoinherit,actual_constraint.conislocal,actual_constraint.coninhcount)
   is distinct from row(constraint_spec.contype,constraint_spec.conkey,reference_keys,foreign_table::oid,constraint_spec.condeferrable,constraint_spec.condeferred,true,constraint_spec.confupdtype,constraint_spec.confdeltype,constraint_spec.confmatchtype,constraint_spec.connoinherit,true,0)
   or pg_get_expr(actual_constraint.conbin,actual_table) is distinct from pg_get_expr(constraint_spec.conbin,expected_table) then raise exception 'merchant_attendance_delegated_rules_constraint_conflict';end if;
 end loop;
 if (select count(*) from pg_index where indrelid=actual_table)<>(select count(*) from pg_index where indrelid=expected_table) then raise exception 'merchant_attendance_delegated_rules_index_conflict';end if;
 for index_spec in select index_row.*,index_table.relname,index_table.relam from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_row.indrelid=expected_table loop
  select index_row.*,index_table.relowner,index_table.relam,index_table.relkind into actual_index from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_row.indexrelid=to_regclass(ns||'.'||index_spec.relname);
  if actual_index.indexrelid is null or actual_index.indrelid<>actual_table or actual_index.relowner<>expected_owner or actual_index.relkind<>'i' or not actual_index.indisvalid or not actual_index.indisready or not actual_index.indislive
   or row(actual_index.relam,actual_index.indnatts,actual_index.indnkeyatts,actual_index.indisunique,actual_index.indisprimary,actual_index.indisexclusion,actual_index.indimmediate,actual_index.indnullsnotdistinct,actual_index.indkey,actual_index.indcollation,actual_index.indclass,actual_index.indoption)
   is distinct from row(index_spec.relam,index_spec.indnatts,index_spec.indnkeyatts,index_spec.indisunique,index_spec.indisprimary,index_spec.indisexclusion,index_spec.indimmediate,index_spec.indnullsnotdistinct,index_spec.indkey,index_spec.indcollation,index_spec.indclass,index_spec.indoption)
   or pg_get_expr(actual_index.indpred,actual_table) is distinct from pg_get_expr(index_spec.indpred,expected_table) or pg_get_expr(actual_index.indexprs,actual_table) is distinct from pg_get_expr(index_spec.indexprs,expected_table) then raise exception 'merchant_attendance_delegated_rules_index_conflict';end if;
 end loop;
 if table_name like '%operational%' then
  if (select count(*) from pg_trigger where tgrelid=actual_table and not tgisinternal)<>3 then raise exception 'merchant_attendance_delegated_rules_trigger_conflict';end if;
  for trigger_spec in select * from(values('operational_rule_no_truncate',34,false,false,'faolla_attendance_events_append_only_v1'),
   (case when table_name like '%operations' then 'operational_rule_immutable' else 'operational_rule_shape' end,case when table_name like '%operations' then 27 else 31 end,false,false,case when table_name like '%operations' then 'faolla_attendance_events_append_only_v1' else 'faolla_attendance_operational_rule_guard_v1' end),
   ('operational_rule_proof',case when table_name like '%operations' then 5 else 21 end,true,true,'faolla_attendance_operational_rule_guard_v1')) expected(name,kind,deferred,initially_deferred,fn) loop
   if not exists(select 1 from pg_trigger actual where actual.tgrelid=actual_table and actual.tgname=trigger_spec.name::name and actual.tgtype=trigger_spec.kind and actual.tgenabled='O' and actual.tgnargs=0 and actual.tgqual is null and actual.tgdeferrable=trigger_spec.deferred and actual.tginitdeferred=trigger_spec.initially_deferred and actual.tgfoid=to_regprocedure(ns||'.'||trigger_spec.fn||'()')) then raise exception 'merchant_attendance_delegated_rules_trigger_conflict';end if;
  end loop;
 else
  if (select count(*) from pg_trigger where tgrelid=actual_table and not tgisinternal)<>(case when table_name like '%operations' then 2 else 0 end) then raise exception 'merchant_attendance_delegated_rules_trigger_conflict';end if;
  if table_name like '%operations' then
   for trigger_spec in select * from(values(case when table_name like '%personal%' then 'attendance_personal_rule_operations_immutable' else 'merchant_attendance_rule_operations_immutable' end,27),
    (case when table_name like '%personal%' then 'attendance_personal_rule_operations_no_truncate' else 'merchant_attendance_rule_operations_no_truncate' end,34)) expected(name,kind) loop
    if not exists(select 1 from pg_trigger actual where actual.tgrelid=actual_table and actual.tgname=trigger_spec.name::name and actual.tgtype=trigger_spec.kind and actual.tgenabled='O' and actual.tgnargs=0 and actual.tgqual is null and not actual.tgdeferrable and not actual.tginitdeferred and actual.tgfoid=to_regprocedure(ns||'.faolla_attendance_events_append_only_v1()')) then raise exception 'merchant_attendance_delegated_rules_trigger_conflict';end if;
   end loop;
  end if;
 end if;
end loop;`;
 const preflight=`do $rules206_prerequisites$ begin
 if not exists(select 1 from public.faolla_schema_migrations where version=202610080205 and name='merchant_attendance_delegated_configuration') then raise exception 'merchant_attendance_delegated_rules_prerequisite_required';end if;
 if exists(select 1 from public.faolla_schema_migrations where version=202610080206 and name<>'merchant_attendance_delegated_rules') then raise exception 'merchant_attendance_delegated_rules_installation_conflict';end if;
 end;$rules206_prerequisites$;
 ${templates.sql}
 create temp table rules206_forward_metadata on commit drop as select proc.oid,to_jsonb(proc)-array['prosrc','proargdefaults'] metadata,pg_get_expr(proc.proargdefaults,0) default_expression from pg_proc proc where proc.oid in(${allForward.map(f=>quote(f.signature)+'::regprocedure').join(',')});
 do $rules206_preflight$ ${declarations} begin ${common}${deps(false)}
 if (select count(*) from pg_proc proc where proc.pronamespace=(select oid from pg_namespace where nspname=ns) and proc.proname like 'faolla_attendance_delegated_rules_%')<>(case when installed then ${own.length} else 0 end) then raise exception 'merchant_attendance_delegated_rules_installation_conflict';end if;
 if installed then own_spec:=$rules206_own$${JSON.stringify(own)}$rules206_own$::jsonb;${checks} end if;${tableChecks}
 end;$rules206_preflight$;`;
 const forwardSql=allForward.map((f,i)=>`do $rules206_forward_${i}$ declare old_body text;definition text;begin
 if exists(select 1 from public.faolla_schema_migrations where version=202610080206 and name='merchant_attendance_delegated_rules') then return;end if;
 select replace(proc.prosrc,E'\\r\\n',E'\\n'),pg_get_functiondef(proc.oid) into old_body,definition from pg_proc proc where proc.oid='${f.signature}'::regprocedure;
 if old_body is distinct from $rules206_old_${i}$${f.oldBody}$rules206_old_${i}$ or position(old_body in definition)=0 then raise exception 'merchant_attendance_delegated_rules_forward_drift';end if;
 execute replace(definition,old_body,$rules206_new_${i}$${f.newBody}$rules206_new_${i}$);
 end;$rules206_forward_${i}$;`).join('\n');
 const final=own.map(f=>`revoke all on function ${f.signature} from public,anon,authenticated,service_role;${f.isRpc?'\ngrant execute on function '+f.signature+' to service_role;':''}`).join('\n')+`
 do $rules206_postconditions$ ${declarations} begin ${common}${deps(true)}own_spec:=$rules206_post_own$${JSON.stringify(own)}$rules206_post_own$::jsonb;${checks}${tableChecks}
 if (select count(*) from rules206_forward_metadata)<>4 or exists(select 1 from rules206_forward_metadata original left join pg_proc proc on proc.oid=original.oid where proc.oid is null or to_jsonb(proc)-array['prosrc','proargdefaults'] is distinct from original.metadata or pg_get_expr(proc.proargdefaults,0) is distinct from original.default_expression) then raise exception 'merchant_attendance_delegated_rules_forward_metadata_changed';end if;
 end;$rules206_postconditions$;
 drop table pg_temp.rules206_forward_metadata,${[...templates.tables].reverse().map(n=>'pg_temp.'+n).join(',')},pg_temp.merchant_attendance_settings,pg_temp.merchant_attendance_groups,pg_temp.merchant_attendance_workers,pg_temp.merchant_enterprise_employees;`;
 return{forward,own,dependencies:unique,preflight,forwardSql,final,tableChecks,templates};
}
export function delegatedRulesFreezeSql(sql,migrations){
 let text=sql.replaceAll('\r\n','\n');const forward=delegatedRulesForwardRecipes(migrations);
 const cores=forward.cores.map(f=>`create or replace function public.${f.coreName}(p_query jsonb,p_auth_user_id uuid,p_command jsonb,p_allow_write boolean,p_grant_id uuid)\nreturns jsonb language plpgsql set search_path=pg_catalog as $$${f.core}$$;`).join('\n');
 const replace=(name,value)=>{const pattern=new RegExp('--BEGIN GENERATED DELEGATED RULES '+name+'[\\s\\S]*?--END GENERATED DELEGATED RULES '+name);assert(pattern.test(text));text=text.replace(pattern,()=>`--BEGIN GENERATED DELEGATED RULES ${name}\n${value}\n--END GENERATED DELEGATED RULES ${name}`);};
 replace('CORES',cores);const r=delegatedRulesInstallRecipe(text,migrations);for(const[name,value]of[['PREFLIGHT',r.preflight],['FORWARD',r.forwardSql],['POSTCONDITIONS',r.final]])replace(name,value);return text;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.deepEqual(process.argv.slice(2),['--write']);const dir=path.join(path.dirname(fileURLToPath(import.meta.url)),'supabase-migrations');
 const migrations=readdirSync(dir).filter(n=>/^\d+_.+\.sql$/.test(n)&&n<delegatedRulesMigration).sort().map(name=>({name,text:readFileSync(path.join(dir,name),'utf8')}));
 const file=path.join(dir,delegatedRulesMigration),output=delegatedRulesFreezeSql(readFileSync(file,'utf8'),migrations);writeFileSync(file,output,'utf8');console.log(JSON.stringify({sourceOnly:true,migration:delegatedRulesMigration,sha256:sha(output)}));
}
