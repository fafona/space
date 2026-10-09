// C15-A private day-source implementation recipe, INERT until the complete199
// migration installs it. No SQL is executed here. In particular this cannot
// create a period, change a session timezone, or accept a browser UTC frame.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export const dayReviewSourcePins=Object.freeze({
 base:'36a8dc6972a19c674d03ac99563bc5d082cd83bfb14473c5ed6be8ce700f0d07',
 wrapper:'f8e5831cc525021f0c26e833128bdcb2ec602bf7ad93289101440c3eb3061b3b',
});
const sha=value=>createHash('sha256').update(value,'utf8').digest('hex');
export function dayReviewCurrentCollectorBodies(original,migration){
 original=original.replaceAll('\r\n','\n');migration=migration.replaceAll('\r\n','\n');
 const recipes=JSON.parse(migration.match(/\$administrative_recipes\$([\s\S]*?)\$administrative_recipes\$/)?.[1]??'null');assert(Array.isArray(recipes));
 const prepare=name=>{
  const start=original.indexOf('create or replace function public.'+name+'(');assert(start>=0);
  const declaration=original.indexOf('as $$',start),end=original.indexOf('$$;',declaration+5);assert(declaration>start&&end>declaration);
  let body=original.slice(declaration+5,end);const recipe=recipes.find(r=>r.name===name);assert(recipe);assert.equal(sha(body),recipe.oldHash);
  for(const change of recipe.changes){assert.equal(body.split(change.from).length-1,change.count);body=body.split(change.from).join(change.to);}
  assert.equal(sha(body),recipe.newHash);return body;
 };
 return Object.freeze({base:prepare('faolla_attendance_period_closure_source_base_v1'),wrapper:prepare('faolla_attendance_period_closure_source_v1')});
}
export function dayReviewCollectorSql(original,migration){
 const current=dayReviewCurrentCollectorBodies(original,migration),built=dayReviewDaySourceBodies(current.base,current.wrapper);
 return `create or replace function public.faolla_attendance_day_review_day_base_v1(p_query jsonb,p_auth_user_id uuid)\nreturns jsonb language plpgsql set search_path=pg_catalog as $$${built.base}$$;\n\ncreate or replace function public.faolla_attendance_day_review_day_source_v1(p_query jsonb,p_auth_user_id uuid)\nreturns jsonb language plpgsql set search_path=pg_catalog as $$${built.wrapper}$$;`;
}
// Static install recipe. This does not connect to PostgreSQL. Its exact own
// bodies/metadata are checked before reentry, not blindly CREATE OR REPLACEd.
export function dayReviewSqlFunctions(sql){
 sql=sql.replaceAll('\r\n','\n');const result=[];
 const declaration=/^create (?:or replace )?function public\.(faolla_[a-z0-9_]+)\(([^)]*)\)\s*returns\s+([a-z0-9_. ]+?)\s+language\s+(sql|plpgsql)([\s\S]*?)as \$\$/gm;
 for(const m of sql.matchAll(declaration)){
  const start=m.index+m[0].length,end=sql.indexOf('$$;',start);assert(end>start);
  const args=m[2].trim()?m[2].split(',').map(a=>a.trim()):[],names=args.map(a=>a.split(/\s+/)[0]);
  const types=args.map(a=>a.replace(/^\S+\s+/,'').replace(/\s+default[\s\S]*/i,'').trim());
  const defaults=args.flatMap((a,i)=>{const raw=a.match(/\sdefault\s+([\s\S]*)/i)?.[1]?.trim();if(raw===undefined)return [];
   return [/^null$/i.test(raw)?'NULL::'+types[i]:/^(true|false)$/i.test(raw)?raw.toLowerCase():/^'.*'$/.test(raw)?raw+'::'+types[i]:raw];});
  const options=m[5],search=options.match(/set\s+search_path\s*=\s*([^\n]*?)(?:\s+as|$)/im)?.[1]?.trim();
  result.push({name:m[1],signature:'public.'+m[1]+'('+types.join(',')+')',hash:sha(sql.slice(start,end)),
   result:m[3].trim(),language:m[4],volatility:/\bimmutable\b/i.test(options)?'i':/\bstable\b/i.test(options)?'s':'v',
   definer:/\bsecurity definer\b/i.test(options),defaults:defaults.length,defaultExpression:defaults.length?defaults.join(', '):null,args:names,
   searchPath:search?'search_path='+search:null,isRpc:m[1]==='faolla_attendance_day_review_v1',body:sql.slice(start,end)});
 }
 return result;
}
export function dayReviewDependencyManifest(sql,migrations){
 const needed=[...new Set([...sql.matchAll(/public\.(faolla_(?:attendance_[a-z0-9_]+|valid_merchant_enterprise_permissions_v1))\(/g)].map(m=>m[1]))].filter(n=>!n.startsWith('faolla_attendance_day_review_'));
 const all=new Map();for(const file of migrations){for(const f of dayReviewSqlFunctions(file.text))all.set(f.name,f);}
 const administrative=migrations.find(f=>f.name.startsWith('202610080195_'));assert(administrative);
 const recipes=JSON.parse(administrative.text.match(/\$administrative_recipes\$([\s\S]*?)\$administrative_recipes\$/)?.[1]??'null');assert(Array.isArray(recipes));
 return needed.map(name=>{
  const f=all.get(name);assert(f,'dependency_source_'+name);assert(f.searchPath,'dependency_config_'+name);let body=f.body;
  const recipe=recipes.find(r=>r.name===name);if(recipe){assert.equal(sha(body),recipe.oldHash,'dependency_recipe_'+name);for(const change of recipe.changes){assert.equal(body.split(change.from).length-1,change.count);body=body.split(change.from).join(change.to);}assert.equal(sha(body),recipe.newHash);}
  const {body:_body,...meta}=f;void _body;meta.hash=sha(body);
  meta.isRpc=['faolla_attendance_plan_posthoc_formal_source_v1','faolla_attendance_plan_exception_source_v1'].includes(name);
  if(name==='faolla_valid_merchant_enterprise_permissions_v1'){
   const legacy=migrations.find(file=>file.name.startsWith('202610080185_'));assert(legacy);
   const old=dayReviewSqlFunctions(legacy.text).find(fn=>fn.name===name);assert(old);meta.legacyHash=old.hash;
  }
  return meta;
 });
}
export function dayReviewInstallRecipe(sql,dependencies){
 sql=sql.replaceAll('\r\n','\n');assert(Array.isArray(dependencies)&&dependencies.length>=20);
 const own=dayReviewSqlFunctions(sql).filter(f=>f.name.startsWith('faolla_attendance_day_review_')).map(f=>{const {body,...metadata}=f;void body;return metadata;});
 assert.equal(own.length,15);const json=JSON.stringify(own),dep=JSON.stringify(dependencies);
 const table=name=>sql.match(new RegExp('create table if not exists public\\.'+name+'\\([\\s\\S]*?\\n\\);'))?.[0];
 const cases=table('merchant_attendance_day_review_cases'),entries=table('merchant_attendance_day_review_entries');assert(cases&&entries);
 const temp=body=>body.replace('create table if not exists public.','create temp table ').replace(/\n\);$/,'\n) on commit drop;')
  .replaceAll('references public.merchant_attendance_settings(merchant_id)','references pg_temp.faolla_day_review_expected_settings(merchant_id)')
  .replaceAll('references public.merchant_attendance_workers(merchant_id,id)','references pg_temp.faolla_day_review_expected_workers(merchant_id,id)')
  .replaceAll('references public.merchant_enterprise_employees(merchant_id,id)','references pg_temp.faolla_day_review_expected_employees(merchant_id,id)')
  .replaceAll('references public.merchant_attendance_day_review_cases(merchant_id,case_id)','references pg_temp.merchant_attendance_day_review_cases(merchant_id,case_id)');
 const indices=sql.match(/^create (?:unique )?index if not exists [^\n]+;/gm);assert(indices?.length===5);
 const templates=`--Empty transaction-local parser templates only. TEMP FKs reference TEMP\n--skeletons; no permanent facts/DDL and no persisted manifest side table.\ncreate temp table faolla_day_review_expected_settings(merchant_id text primary key) on commit drop;\ncreate temp table faolla_day_review_expected_workers(id uuid,merchant_id text,primary key(merchant_id,id)) on commit drop;\ncreate temp table faolla_day_review_expected_employees(id uuid,merchant_id text,primary key(merchant_id,id)) on commit drop;\n${temp(cases)}\n${temp(entries)}\n${indices.map(i=>i.replace(' if not exists','').replaceAll('on public.','on pg_temp.')).join('\n')}`;
 const functions=`
 for spec in select value from jsonb_array_elements(own_spec) loop
  signature:=replace(spec->>'signature','public.',ns||'.');f:=to_regprocedure(signature);
  select p.*,l.lanname into meta from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=f;
  if f is null or meta.proowner is distinct from expected_owner or meta.prosecdef is distinct from (spec->>'definer')::boolean
   or meta.proconfig is distinct from array[replace(spec->>'searchPath','public',ns)] or meta.provolatile::text is distinct from spec->>'volatility'
   or meta.lanname is distinct from spec->>'language' or meta.prorettype is distinct from to_regtype(spec->>'result') or meta.proretset or meta.proisstrict or meta.proleakproof
   or meta.prokind<>'f' or meta.proparallel<>'u' or meta.prosupport<>0::oid or meta.proallargtypes is not null or meta.proargmodes is not null
   or meta.pronargs<>jsonb_array_length(spec->'args') or meta.procost<>100 or meta.prorows<>0
   or meta.pronargdefaults<>(spec->>'defaults')::integer or coalesce(meta.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'args'))
   or pg_get_expr(meta.proargdefaults,0) is distinct from spec->>'defaultExpression'
   or (select count(*) from pg_proc p where p.pronamespace=meta.pronamespace and p.proname=meta.proname)<>1
   or encode(sha256(convert_to(replace(replace(meta.prosrc,E'\\r\\n',E'\\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from
    (case when spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' and not has190 then spec->>'legacyHash' else spec->>'hash' end)
   then raise exception 'merchant_attendance_day_review_installation_conflict';end if;
  if has_function_privilege(expected_owner,f,'EXECUTE') is distinct from true then raise exception 'merchant_attendance_day_review_permission_conflict';end if;
  if spec->>'name'<>'faolla_valid_merchant_enterprise_permissions_v1' then
   if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
    or has_function_privilege('service_role',f,'EXECUTE') is distinct from (spec->>'isRpc')::boolean
    or exists(select 1 from aclexplode(coalesce(meta.proacl,acldefault('f',meta.proowner))) acl
     where acl.grantor<>expected_owner or acl.grantee<>expected_owner and ((spec->>'isRpc')::boolean is distinct from true
      or acl.grantee<>(select oid from pg_roles where rolname='service_role') or acl.privilege_type<>'EXECUTE' or acl.is_grantable))
    then raise exception 'merchant_attendance_day_review_permission_conflict';end if;
  end if;
 end loop;`;
 const tables=`
 foreach table_name in array array['merchant_attendance_day_review_cases','merchant_attendance_day_review_entries'] loop
  actual_table:=to_regclass(ns||'.'||table_name);expected_table:=to_regclass('pg_temp.'||table_name);
  if not exists(select 1 from pg_class catalog_table where catalog_table.oid=actual_table and catalog_table.relkind='r' and catalog_table.relowner=expected_owner and catalog_table.relrowsecurity and not catalog_table.relforcerowsecurity)
   or exists(select 1 from pg_policy where polrelid=actual_table)
   or exists(select 1 from pg_class catalog_table cross join lateral aclexplode(coalesce(catalog_table.relacl,acldefault('r',catalog_table.relowner))) acl where catalog_table.oid=actual_table and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
   or (select count(*) from pg_attribute where attrelid=actual_table and attnum>0)<>(select count(*) from pg_attribute where attrelid=expected_table and attnum>0)
   or exists(select 1 from pg_attribute actual full join pg_attribute expected on expected.attrelid=expected_table and actual.attnum=expected.attnum
    where actual.attrelid=actual_table and actual.attnum>0 and row(actual.attname,actual.atttypid,actual.atttypmod,actual.attnotnull,actual.atthasdef,actual.attidentity,actual.attgenerated,actual.attndims,actual.attisdropped,actual.attcollation)
     is distinct from row(expected.attname,expected.atttypid,expected.atttypmod,expected.attnotnull,expected.atthasdef,expected.attidentity,expected.attgenerated,expected.attndims,expected.attisdropped,expected.attcollation))
   then raise exception 'merchant_attendance_day_review_table_conflict';end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(role_name,actual_table,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'merchant_attendance_day_review_permission_conflict';end if;
  end loop;
  if (select count(*) from pg_constraint where conrelid=actual_table and contype<>'t')<>(select count(*) from pg_constraint where conrelid=expected_table and contype<>'t') then raise exception 'merchant_attendance_day_review_constraint_conflict';end if;
  for constraint_spec in select * from pg_constraint where conrelid=expected_table and contype<>'t' loop
   select * into actual_constraint from pg_constraint where conrelid=actual_table and conname=constraint_spec.conname;
   foreign_table:=case constraint_spec.confrelid when to_regclass('pg_temp.faolla_day_review_expected_settings') then to_regclass(ns||'.merchant_attendance_settings')
    when to_regclass('pg_temp.faolla_day_review_expected_workers') then to_regclass(ns||'.merchant_attendance_workers')
    when to_regclass('pg_temp.faolla_day_review_expected_employees') then to_regclass(ns||'.merchant_enterprise_employees')
    when to_regclass('pg_temp.merchant_attendance_day_review_cases') then to_regclass(ns||'.merchant_attendance_day_review_cases') else constraint_spec.confrelid end;
   if actual_constraint.oid is null or row(actual_constraint.contype,actual_constraint.conkey,actual_constraint.confkey,actual_constraint.confrelid,actual_constraint.condeferrable,actual_constraint.condeferred,actual_constraint.convalidated,actual_constraint.confupdtype,actual_constraint.confdeltype,actual_constraint.confmatchtype,actual_constraint.connoinherit)
    is distinct from row(constraint_spec.contype,constraint_spec.conkey,constraint_spec.confkey,foreign_table::oid,constraint_spec.condeferrable,constraint_spec.condeferred,constraint_spec.convalidated,constraint_spec.confupdtype,constraint_spec.confdeltype,constraint_spec.confmatchtype,constraint_spec.connoinherit)
    or pg_get_expr(actual_constraint.conbin,actual_table) is distinct from pg_get_expr(constraint_spec.conbin,expected_table) then raise exception 'merchant_attendance_day_review_constraint_conflict';end if;
  end loop;
  if (select count(*) from pg_index where indrelid=actual_table)<>(select count(*) from pg_index where indrelid=expected_table) then raise exception 'merchant_attendance_day_review_index_conflict';end if;
  for index_spec in select i.*,index_table.relname,index_table.relam from pg_index i join pg_class index_table on index_table.oid=i.indexrelid where i.indrelid=expected_table loop
   select i.*,index_table.relowner,index_table.relam,index_table.relkind into actual_index from pg_index i join pg_class index_table on index_table.oid=i.indexrelid where i.indexrelid=to_regclass(ns||'.'||index_spec.relname);
   if actual_index.indexrelid is null or actual_index.indrelid<>actual_table or actual_index.relowner<>expected_owner or actual_index.relkind<>'i' or not actual_index.indisvalid or not actual_index.indisready or not actual_index.indislive
    or row(actual_index.relam,actual_index.indnatts,actual_index.indnkeyatts,actual_index.indisunique,actual_index.indisprimary,actual_index.indisexclusion,actual_index.indimmediate,actual_index.indkey,actual_index.indcollation,actual_index.indclass,actual_index.indoption)
    is distinct from row(index_spec.relam,index_spec.indnatts,index_spec.indnkeyatts,index_spec.indisunique,index_spec.indisprimary,index_spec.indisexclusion,index_spec.indimmediate,index_spec.indkey,index_spec.indcollation,index_spec.indclass,index_spec.indoption)
    or pg_get_expr(actual_index.indpred,actual_table) is distinct from pg_get_expr(index_spec.indpred,expected_table)
    or pg_get_expr(actual_index.indexprs,actual_table) is distinct from pg_get_expr(index_spec.indexprs,expected_table) then raise exception 'merchant_attendance_day_review_index_conflict';end if;
  end loop;
  if (select count(*) from pg_trigger where tgrelid=actual_table and not tgisinternal)<>3 then raise exception 'merchant_attendance_day_review_trigger_conflict';end if;
 end loop;
 for trigger_spec in select * from (values
  ('merchant_attendance_day_review_cases','day_review_case_pair',5,true),('merchant_attendance_day_review_cases','day_review_case_immutable',27,false),('merchant_attendance_day_review_cases','day_review_case_no_truncate',34,false),
  ('merchant_attendance_day_review_entries','day_review_entry_proof',7,false),('merchant_attendance_day_review_entries','day_review_entry_immutable',27,false),('merchant_attendance_day_review_entries','day_review_entry_no_truncate',34,false)
 ) t(table_name,trigger_name,kind,deferred) loop
  if not exists(select 1 from pg_trigger where tgrelid=to_regclass(ns||'.'||trigger_spec.table_name) and tgname=trigger_spec.trigger_name and tgtype=trigger_spec.kind and tgenabled='O' and tgnargs=0 and tgqual is null
   and tgdeferrable=trigger_spec.deferred and tginitdeferred=trigger_spec.deferred and tgfoid=to_regprocedure(ns||'.faolla_attendance_day_review_guard_v1()')) then raise exception 'merchant_attendance_day_review_trigger_conflict';end if;
 end loop;`;
 const declarations=`declare ns text;expected_owner oid;installed boolean;has190 boolean;spec jsonb;signature text;f regprocedure;meta record;table_name text;role_name text;
 actual_table regclass;expected_table regclass;foreign_table regclass;constraint_spec record;actual_constraint record;index_spec record;actual_index record;trigger_spec record;
 own_spec jsonb;`;
 const shared=`select namespace.nspname,catalog_table.relowner into ns,expected_owner from pg_class catalog_table join pg_namespace namespace on namespace.oid=catalog_table.relnamespace where catalog_table.oid='public.merchant_attendance_settings'::regclass;
 if expected_owner is distinct from (select oid from pg_roles where rolname=current_user) then raise exception 'merchant_attendance_day_review_owner_conflict';end if;
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');`;
 const preflight=`do $day_review_prerequisites$
begin
 if not exists(select 1 from public.faolla_schema_migrations where version=202610080195 and name='merchant_attendance_administrative_closure')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610060173 and name='merchant_attendance_plan_posthoc_formal_source')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610070179 and name='merchant_attendance_outage_periods')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080191 and name='merchant_attendance_operational_rules')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080185 and name='merchant_attendance_period_delegations')
  then raise exception 'merchant_attendance_day_review_prerequisite_required';end if;
 if exists(select 1 from public.faolla_schema_migrations where version=202610080199 and name<>'merchant_attendance_day_reviews')
  or exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name<>'merchant_attendance_correction_delegation_permission') then raise exception 'merchant_attendance_day_review_installation_conflict';end if;
end;
$day_review_prerequisites$;
${templates}
do $day_review_preflight$
${declarations}
begin
 ${shared}
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080199 and name='merchant_attendance_day_reviews');
 own_spec:=$day_review_dependencies$${dep}$day_review_dependencies$::jsonb;
 ${functions}
 if (select count(*) from pg_proc p where p.pronamespace=(select oid from pg_namespace where nspname=ns) and p.proname like 'faolla_attendance_day_review_%')<>(case when installed then ${own.length} else 0 end)
  or (to_regclass(ns||'.merchant_attendance_day_review_cases') is not null)<>installed or (to_regclass(ns||'.merchant_attendance_day_review_entries') is not null)<>installed then raise exception 'merchant_attendance_day_review_installation_conflict';end if;
 if not installed then return;end if;
 own_spec:=$day_review_own$${json}$day_review_own$::jsonb;
 ${functions}
 ${tables}
end;
$day_review_preflight$;`;
 const acl=own.map(f=>`revoke all on function ${f.signature} from public,anon,authenticated,service_role;`).join('\n')+'\ngrant execute on function public.faolla_attendance_day_review_v1(jsonb,uuid,jsonb,boolean) to service_role;';
 const final=`${acl}
do $day_review_postconditions$
${declarations}
begin
 ${shared}
 own_spec:=$day_review_post_dependencies$${dep}$day_review_post_dependencies$::jsonb;
 ${functions}
 own_spec:=$day_review_post_own$${json}$day_review_post_own$::jsonb;
 ${functions}
 ${tables}
end;
$day_review_postconditions$;
insert into public.faolla_schema_migrations(version,name) values(202610080199,'merchant_attendance_day_reviews') on conflict(version) do nothing;`;
 return Object.freeze({preflight,final,ownCount:own.length});
}
function replaceOnce(body,from,to){
 assert.equal(body.split(from).length-1,1,'day_review_source_exact_marker');return body.replace(from,()=>to);
}
export function dayReviewDaySourceBodies(currentBase,currentWrapper){
 assert.equal(typeof currentBase,'string');assert.equal(typeof currentWrapper,'string');
 let body=currentBase.replaceAll('\r\n','\n'),wrapper=currentWrapper.replaceAll('\r\n','\n');
 assert.equal(sha(body),dayReviewSourcePins.base,'day_review_source_base_pin');
 assert.equal(sha(wrapper),dayReviewSourcePins.wrapper,'day_review_source_wrapper_pin');
 const oldDeclarations=`  fixed_head public.merchant_attendance_period_closures%rowtype;fixed_artifact public.merchant_attendance_period_artifacts%rowtype;
  fixed_version public.merchant_attendance_period_versions%rowtype;fixed_body jsonb;current_body jsonb;fixed_frame jsonb;fixed_day jsonb;fixed_pid uuid;fixed_index integer:=0;
  fixed_previous timestamptz;`;
 body=replaceOnce(body,oldDeclarations,`  day_case public.merchant_attendance_day_review_cases%rowtype;
  fixed_frame jsonb;fixed_zone text;fixed_days jsonb;requested_case uuid;`);
 const validationStart=body.indexOf("  if public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','access','workerId','fromDate','throughDate','periodId'])");
 const validationEnd=body.indexOf("  perform 1 from public.merchants where id=site",validationStart);
 assert(validationStart>0&&validationEnd>validationStart);
 const validation=body.slice(validationStart,validationEnd);
 body=replaceOnce(body,validation,`  if p_auth_user_id is null or octet_length(convert_to(p_query::text,'UTF8'))>8192
    or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','access','mode','workerId','workDate','slotId','caseId']) is distinct from true
    or jsonb_typeof(p_query->'siteId') is distinct from 'string' or p_query->>'siteId'!~'^[0-9]{8}$'
    or p_query->>'access' is distinct from 'owner' or p_query->>'mode' is distinct from 'preview'
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'workerId','uuid') is distinct from true
    or public.faolla_attendance_group_date_v1(p_query->>'workDate') is distinct from true
    or p_query->'slotId' is distinct from 'null'::jsonb
    or (p_query->'caseId'<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'caseId','uuid') is distinct from true)
    then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';wid:=(p_query->>'workerId')::uuid;access_name:='owner';
  first_day:=(p_query->>'workDate')::date;last_day:=first_day;requested_case:=(p_query->>'caseId')::uuid;
`);
 const frameStart=body.indexOf('  --155 fixed frame begins.'),frameEnd=body.indexOf('  --155 fixed frame ends.',frameStart);
 assert(frameStart>0&&frameEnd>frameStart);
 const frameBlock=body.slice(frameStart,frameEnd+'  --155 fixed frame ends.'.length);
 body=replaceOnce(body,frameBlock,`  --199 own immutable DAY frame. A case UUID is not a period identity.
  --Authorization/settings/worker/employee locks were acquired by the exact
  --pinned collector above. Never turn a missing requested case into a new day.
  if requested_case is not null then
    select * into day_case from public.merchant_attendance_day_review_cases
      where merchant_id=site and case_id=requested_case;
    if day_case.case_id is null then raise exception 'attendance_day_review_not_found';end if;
    if day_case.worker_id is distinct from wid or day_case.kind is distinct from 'day'
      or day_case.work_date is distinct from first_day or day_case.slot_id is not null
      then raise exception 'attendance_access_denied';end if;
    if day_case.employee_id is distinct from emp.id or day_case.employee_auth_user_id is distinct from emp.auth_user_id
      then raise exception 'attendance_day_review_identity_changed';end if;
    fixed_zone:=day_case.time_zone;a:=day_case.start_at;b:=day_case.end_at;
    --No current timezone calculation for a saved case. Its UTC endpoints are
    --immutable data, including the originally observed civil DST boundaries.
  else
    fixed_zone:=s.time_zone;
    a:=public.faolla_attendance_control_day_boundary_v1(first_day,fixed_zone);
    b:=public.faolla_attendance_control_day_boundary_v1(first_day+1,fixed_zone);
  end if;
  if a>=b or b-a>interval '48 hours' then raise exception 'attendance_day_review_invalid';end if;
  fixed_frame:=jsonb_build_object('timeZone',fixed_zone,'fromAt',to_char(a at time zone 'UTC',fmt),'toAt',to_char(b at time zone 'UTC',fmt));
  fixed_days:=jsonb_build_array(jsonb_build_object('date',first_day,'fromAt',fixed_frame->'fromAt','toAt',fixed_frame->'toAt','skipped',false));
  --199 own DAY frame ends. This is not a civil-day adapter for a clipped plan.`);
 body=replaceOnce(body,"  day_items:=fixed_body->'dayBoundaries';","  day_items:=fixed_days;");
 body=replaceOnce(body,"'timeZone',fixed_head.time_zone,'fromDate',first_day", "'timeZone',fixed_zone,'fromDate',first_day");
 wrapper=replaceOnce(wrapper,'public.faolla_attendance_period_closure_source_base_v1(p_query,p_auth_user_id)',
  'public.faolla_attendance_day_review_day_base_v1(p_query,p_auth_user_id)');
 // Do not permit a future upstream source to accidentally reintroduce period
 // reads/writes. This recipe only borrows the full bounded context collector.
 assert(!/merchant_attendance_period_(?:closures|artifacts|versions)|fixed_(?:head|pid|body|artifact|version)|set_config|\b(?:insert into|update public|delete from)\b/i.test(body));
 assert(!/\b(?:insert into|update public|delete from)\b/i.test(wrapper));
 return Object.freeze({base:body,wrapper,baseSha256:sha(body),wrapperSha256:sha(wrapper),
  actualSql:false,planSourceIncluded:false,oldBodiesModified:false});
}
