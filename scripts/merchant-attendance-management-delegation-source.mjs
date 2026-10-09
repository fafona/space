//202 SOURCE recipe only. No database, configured Auth, role writes or executor.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {dayReviewSqlFunctions} from './merchant-attendance-day-review-source.mjs';
import {independentPermissionHelperName,independentPermissionAclConflictSql} from './merchant-attendance-independent-installation.mjs';

export const managementDelegationMigration='202610080202_merchant_attendance_management_delegations.sql';
export const managementDelegationTables=Object.freeze(['merchant_attendance_management_delegations',
 'merchant_attendance_management_delegation_revocations','merchant_attendance_management_delegation_operations']);
export const managementDelegationCapabilities=Object.freeze(['attendance.workers.manage','attendance.groups.manage','attendance.locations.manage',
 'attendance.rules.draft','attendance.rules.publish','attendance.rules.withdraw','attendance.terminals.pair','attendance.terminals.revoke',
 'attendance.pin.issue','attendance.pin.revoke','attendance.correction.revision.review','attendance.plan_exception.review','attendance.audit.view','attendance.audit.export']);
const sha=value=>createHash('sha256').update(value.replaceAll('\r\n','\n'),'utf8').digest('hex');
export function managementDelegationForwardRecipes({legacyCatalog,currentCatalog,capture}){
 const get=(sql,name)=>{const item=dayReviewSqlFunctions(sql).find(f=>f.name===name);assert(item,'management_source_missing:'+name);return item;};
 const permissionName='faolla_valid_merchant_enterprise_permissions_v1',captureName='faolla_attendance_account_capture_v1';
 const legacy=get(legacyCatalog,permissionName),current=get(currentCatalog,permissionName),account=get(capture,captureName);
 const anchor="      ('redemptions.view', array[]::text[]),",extra=managementDelegationCapabilities.map(c=>`      ('${c}', array['enterprise.view']::text[]),`).join('\n')+'\n';
 const catalog=old=>{assert.equal(old.body.split(anchor).length-1,1);const body=old.body.replace(anchor,extra+anchor);
  return{...old,oldHash:old.hash,newHash:sha(body),oldBody:old.body,newBody:body,changes:[{from:anchor,to:extra+anchor,count:1}]};};
 const from='and not exists(select 1 from public.merchant_attendance_correction_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee)) then return null;end if;';
 const to=from.replace(' then return null;end if;','\n    and not exists(select 1 from public.merchant_attendance_management_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee)) then return null;end if;');
 assert.equal(account.body.split(from).length-1,2);const next=account.body.split(from).join(to);
 return Object.freeze({catalog185:catalog(legacy),catalog190:catalog(current),capture:{...account,oldHash:account.hash,newHash:sha(next),oldBody:account.body,newBody:next,changes:[{from,to,count:2}]}});
}
export function managementDelegationOwnManifest(sql){
 return dayReviewSqlFunctions(sql).filter(f=>f.name.startsWith('faolla_attendance_management_')).map(f=>{
  const {body,...meta}=f;void body;meta.isRpc=f.name==='faolla_attendance_management_delegations_v1';return meta;
 });
}
export function managementDelegationSourceRecipe(sql,forward){
 assert(forward?.catalog185&&forward?.catalog190&&forward?.capture);const own=managementDelegationOwnManifest(sql);
 assert(own.length>=10&&own.length<=20);assert.equal(new Set(own.map(f=>f.signature)).size,own.length);
 const forwards=Object.fromEntries(Object.entries(forward).map(([k,v])=>{const {body,oldBody,newBody,changes,...meta}=v;void body;void oldBody;void newBody;void changes;return[k,meta];}));
 return Object.freeze({own,forward:forwards,recipeHash:sha(JSON.stringify({own,forward:forwards}))});
}
export function managementDelegationApplyForward(body,recipe){
 assert.equal(sha(body),recipe.oldHash);let next=body;for(const c of recipe.changes){assert.equal(next.split(c.from).length-1,c.count);next=next.split(c.from).join(c.to);}assert.equal(sha(next),recipe.newHash);return next;
}
export function managementDelegationInstallRecipe(sql,migrations){
 const byPrefix=n=>{const found=migrations.find(m=>m.name.startsWith(n));assert(found,'management_missing_source:'+n);return found.text;};
 const forward=managementDelegationForwardRecipes({legacyCatalog:byPrefix('202610080185_'),currentCatalog:byPrefix('202610080190_'),capture:byPrefix('202610080189_')});
 const recipe=managementDelegationSourceRecipe(sql,forward),own=recipe.own;
 const latest=new Map();for(const file of migrations)for(const f of dayReviewSqlFunctions(file.text))latest.set(f.name,f);
 const dependencies=['faolla_attendance_shift_rule_binding_object_v1','faolla_attendance_operational_rule_hash_v1','faolla_attendance_events_append_only_v1'].map(name=>{
  const f=latest.get(name);assert(f,'management_dependency_missing:'+name);const {body,...meta}=f;void body;meta.isRpc=false;return meta;});
 const minimal=f=>{const {body,oldBody,newBody,changes,oldHash,newHash,...m}=f;void body;void oldBody;void newBody;void changes;return{...m,oldHash,newHash};};
 const manifests=JSON.stringify({catalog185:minimal(forward.catalog185),catalog190:minimal(forward.catalog190),capture:minimal(forward.capture)});
 const quote=v=>"'"+v.replaceAll("'","''")+"'";
 const table=name=>{const found=sql.match(new RegExp('create table if not exists public\\.'+name+'\\([\\s\\S]*?\\n\\);'))?.[0];assert(found);return found;};
 const temp=body=>body.replace('create table if not exists public.','create temp table ').replace(/\n\);$/,'\n) on commit drop;')
  .replaceAll('references public.merchant_attendance_settings(merchant_id)','references pg_temp.management_expected_settings(merchant_id)')
  .replaceAll('references public.merchant_enterprise_employees(merchant_id,id)','references pg_temp.management_expected_employees(merchant_id,id)')
  .replaceAll('references public.merchant_attendance_management_delegations(merchant_id,grant_id)','references pg_temp.merchant_attendance_management_delegations(merchant_id,grant_id)');
 const indexes=sql.match(/^create index if not exists [^\n]+;/gm);assert.equal(indexes?.length,4);
 const templates=`create temp table management_expected_settings(merchant_id text primary key) on commit drop;
create temp table management_expected_employees(id uuid,merchant_id text,primary key(merchant_id,id)) on commit drop;
${managementDelegationTables.map(n=>temp(table(n))).join('\n')}
${indexes.map(s=>s.replace(' if not exists','').replace('on public.','on pg_temp.')).join('\n')}`;
 assert(!/references public\./.test(templates),'management_temp_fk_must_be_temp');
 const declarations=`declare ns text;expected_owner oid;installed boolean;has190 boolean;spec jsonb;f regprocedure;meta record;own_spec jsonb;forwards jsonb;
 actual_table regclass;expected_table regclass;foreign_table regclass;table_name text;constraint_spec record;actual_constraint record;
 index_spec record;actual_index record;trigger_spec record;`;
 const shared=`select namespace.nspname,catalog_table.relowner into ns,expected_owner from pg_class catalog_table join pg_namespace namespace on namespace.oid=catalog_table.relnamespace where catalog_table.oid='public.merchant_attendance_settings'::regclass;
 if expected_owner is distinct from (select oid from pg_roles where rolname=current_user) then raise exception 'merchant_attendance_management_owner_conflict';end if;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080202 and name='merchant_attendance_management_delegations');
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');
 forwards:=$management_forward_manifest$${manifests}$management_forward_manifest$::jsonb;`;
 const functions=`for spec in select value from jsonb_array_elements(own_spec) loop
  f:=to_regprocedure(replace(spec->>'signature','public.',ns||'.'));
  select proc.*,language.lanname into meta from pg_proc proc join pg_language language on language.oid=proc.prolang where proc.oid=f;
  if f is null or meta.proowner is distinct from expected_owner or meta.prosecdef is distinct from (spec->>'definer')::boolean
   or meta.proconfig is distinct from array[replace(spec->>'searchPath','public',ns)] or meta.provolatile::text is distinct from spec->>'volatility'
   or meta.lanname is distinct from spec->>'language' or meta.prorettype is distinct from to_regtype(replace(spec->>'result','public.',ns||'.'))
   or meta.proretset or meta.proisstrict or meta.proleakproof or meta.prokind<>'f' or meta.proparallel<>'u' or meta.prosupport<>0::oid
   or meta.proallargtypes is not null or meta.proargmodes is not null or meta.pronargs<>jsonb_array_length(spec->'args')
   or meta.procost<>100 or meta.prorows<>0 or meta.pronargdefaults<>(spec->>'defaults')::integer
   or coalesce(meta.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'args'))
   or pg_get_expr(meta.proargdefaults,0) is distinct from spec->>'defaultExpression'
   or (select count(*) from pg_proc proc where proc.pronamespace=meta.pronamespace and proc.proname=meta.proname)<>1
   or encode(sha256(convert_to(replace(replace(meta.prosrc,E'\\r\\n',E'\\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from spec->>'hash'
   or has_function_privilege(expected_owner,f,'EXECUTE') is distinct from true
   or (case when spec->>'name'='${independentPermissionHelperName}' then ${independentPermissionAclConflictSql('meta','expected_owner')}
    else has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or has_function_privilege('service_role',f,'EXECUTE') is distinct from (spec->>'isRpc')::boolean
   or exists(select 1 from aclexplode(coalesce(meta.proacl,acldefault('f',meta.proowner))) acl where acl.grantor<>expected_owner
    or acl.grantee<>expected_owner and ((spec->>'isRpc')::boolean is distinct from true or acl.grantee<>(select oid from pg_roles where rolname='service_role') or acl.privilege_type<>'EXECUTE' or acl.is_grantable)) end)
   then raise exception 'merchant_attendance_management_function_conflict';end if;
 end loop;`;
 const tables=`foreach table_name in array array[${managementDelegationTables.map(quote).join(',')}] loop
  actual_table:=to_regclass(ns||'.'||table_name);expected_table:=to_regclass('pg_temp.'||table_name);
  if not exists(select 1 from pg_class catalog_table where catalog_table.oid=actual_table and catalog_table.relkind='r' and catalog_table.relowner=expected_owner and catalog_table.relrowsecurity and not catalog_table.relforcerowsecurity)
   or exists(select 1 from pg_policy where polrelid=actual_table)
   or exists(select 1 from pg_class catalog_table cross join lateral aclexplode(coalesce(catalog_table.relacl,acldefault('r',catalog_table.relowner))) acl where catalog_table.oid=actual_table and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
   or exists(select 1 from pg_attribute attribute cross join lateral aclexplode(attribute.attacl) acl where attribute.attrelid=actual_table and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
   or (select count(*) from pg_attribute where attrelid=actual_table and attnum>0)<>(select count(*) from pg_attribute where attrelid=expected_table and attnum>0)
   or exists(select 1 from pg_attribute actual full join pg_attribute expected on expected.attrelid=expected_table and actual.attnum=expected.attnum
    where actual.attrelid=actual_table and actual.attnum>0 and row(actual.attname,actual.atttypid,actual.atttypmod,actual.attnotnull,actual.atthasdef,actual.attidentity,actual.attgenerated,actual.attndims,actual.attisdropped,actual.attcollation)
     is distinct from row(expected.attname,expected.atttypid,expected.atttypmod,expected.attnotnull,expected.atthasdef,expected.attidentity,expected.attgenerated,expected.attndims,expected.attisdropped,expected.attcollation))
   then raise exception 'merchant_attendance_management_table_conflict';end if;
  if (select count(*) from pg_constraint where conrelid=actual_table and contype<>'t')<>(select count(*) from pg_constraint where conrelid=expected_table and contype<>'t') then raise exception 'merchant_attendance_management_constraint_conflict';end if;
  for constraint_spec in select * from pg_constraint where conrelid=expected_table and contype<>'t' loop
   select * into actual_constraint from pg_constraint where conrelid=actual_table and conname=constraint_spec.conname;
   foreign_table:=case constraint_spec.confrelid when to_regclass('pg_temp.management_expected_settings') then to_regclass(ns||'.merchant_attendance_settings')
    when to_regclass('pg_temp.management_expected_employees') then to_regclass(ns||'.merchant_enterprise_employees')
    when to_regclass('pg_temp.merchant_attendance_management_delegations') then to_regclass(ns||'.merchant_attendance_management_delegations') else constraint_spec.confrelid end;
   if actual_constraint.oid is null or row(actual_constraint.contype,actual_constraint.conkey,actual_constraint.confkey,actual_constraint.confrelid,actual_constraint.condeferrable,actual_constraint.condeferred,actual_constraint.convalidated,actual_constraint.confupdtype,actual_constraint.confdeltype,actual_constraint.confmatchtype,actual_constraint.connoinherit)
    is distinct from row(constraint_spec.contype,constraint_spec.conkey,constraint_spec.confkey,foreign_table::oid,constraint_spec.condeferrable,constraint_spec.condeferred,constraint_spec.convalidated,constraint_spec.confupdtype,constraint_spec.confdeltype,constraint_spec.confmatchtype,constraint_spec.connoinherit)
    or pg_get_expr(actual_constraint.conbin,actual_table) is distinct from pg_get_expr(constraint_spec.conbin,expected_table) then raise exception 'merchant_attendance_management_constraint_conflict';end if;
  end loop;
  if (select count(*) from pg_index where indrelid=actual_table)<>(select count(*) from pg_index where indrelid=expected_table) then raise exception 'merchant_attendance_management_index_conflict';end if;
  for index_spec in select index_row.*,index_table.relname,index_table.relam from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_row.indrelid=expected_table loop
   select index_row.*,index_table.relowner,index_table.relam,index_table.relkind into actual_index from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_row.indexrelid=to_regclass(ns||'.'||index_spec.relname);
   if actual_index.indexrelid is null or actual_index.indrelid<>actual_table or actual_index.relowner<>expected_owner or actual_index.relkind<>'i' or not actual_index.indisvalid or not actual_index.indisready or not actual_index.indislive
    or row(actual_index.relam,actual_index.indnatts,actual_index.indnkeyatts,actual_index.indisunique,actual_index.indisprimary,actual_index.indisexclusion,actual_index.indimmediate,actual_index.indkey,actual_index.indcollation,actual_index.indclass,actual_index.indoption)
    is distinct from row(index_spec.relam,index_spec.indnatts,index_spec.indnkeyatts,index_spec.indisunique,index_spec.indisprimary,index_spec.indisexclusion,index_spec.indimmediate,index_spec.indkey,index_spec.indcollation,index_spec.indclass,index_spec.indoption)
    or pg_get_expr(actual_index.indpred,actual_table) is distinct from pg_get_expr(index_spec.indpred,expected_table)
    or pg_get_expr(actual_index.indexprs,actual_table) is distinct from pg_get_expr(index_spec.indexprs,expected_table) then raise exception 'merchant_attendance_management_index_conflict';end if;
  end loop;
  if (select count(*) from pg_trigger where tgrelid=actual_table and not tgisinternal)<>3 then raise exception 'merchant_attendance_management_trigger_conflict';end if;
  for trigger_spec in select * from (values('management_immutable',27,'faolla_attendance_events_append_only_v1'),('management_no_truncate',34,'faolla_attendance_events_append_only_v1'),('management_insert_guard',7,'faolla_attendance_management_insert_v1')) expected(name,kind,fn) loop
   if not exists(select 1 from pg_trigger actual where actual.tgrelid=actual_table and actual.tgname=trigger_spec.name::name and actual.tgtype=trigger_spec.kind and actual.tgenabled='O' and actual.tgnargs=0 and actual.tgqual is null and not actual.tgdeferrable and not actual.tginitdeferred and actual.tgfoid=to_regprocedure(ns||'.'||trigger_spec.fn||'()')) then raise exception 'merchant_attendance_management_trigger_conflict';end if;
  end loop;
 end loop;`;
 const oldForward=`own_spec:=jsonb_build_array((forwards->(case when has190 then 'catalog190' else 'catalog185' end))||jsonb_build_object('hash',(forwards->(case when has190 then 'catalog190' else 'catalog185' end))->>(case when installed then 'newHash' else 'oldHash' end)),
 (forwards->'capture')||jsonb_build_object('hash',forwards->'capture'->>(case when installed then 'newHash' else 'oldHash' end)));`;
 const newForward=`own_spec:=jsonb_build_array((forwards->(case when has190 then 'catalog190' else 'catalog185' end))||jsonb_build_object('hash',(forwards->(case when has190 then 'catalog190' else 'catalog185' end))->>'newHash'),(forwards->'capture')||jsonb_build_object('hash',forwards->'capture'->>'newHash'));`;
 //Snapshot shared OIDs/ACL/defaults/metadata in TEMP before the two replacement
 //bodies. The expected own/new body hashes remain separately frozen above.
 const preflight=`do $management_prerequisites$ begin
 if to_regclass('public.faolla_schema_migrations') is null or to_regclass('public.merchant_attendance_settings') is null
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080189 and name='merchant_attendance_correction_delegation')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080196 and name='merchant_attendance_independent_workers')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080198 and name='merchant_attendance_review_routing')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080199 and name='merchant_attendance_day_reviews') then raise exception 'merchant_attendance_management_prerequisite_required';end if;
 if exists(select 1 from public.faolla_schema_migrations where version=202610080202 and name<>'merchant_attendance_management_delegations')
  or exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name<>'merchant_attendance_correction_delegation_permission') then raise exception 'merchant_attendance_management_installation_conflict';end if;
end;$management_prerequisites$;
${templates}
create temp table management_shared_metadata on commit drop as select proc.oid,to_jsonb(proc)-'prosrc' metadata from pg_proc proc where proc.oid=any(array['public.faolla_valid_merchant_enterprise_permissions_v1(text[])'::regprocedure::oid,'public.faolla_attendance_account_capture_v1(text,uuid,uuid,uuid,boolean)'::regprocedure::oid]);
do $management_preflight$
${declarations}
begin
 ${shared}
 own_spec:=$management_dependencies$${JSON.stringify(dependencies)}$management_dependencies$::jsonb;
 ${functions}
 ${oldForward}
 ${functions}
 if (select count(*) from pg_proc proc where proc.pronamespace=(select oid from pg_namespace where nspname=ns) and proc.proname like 'faolla_attendance_management_%')<>(case when installed then ${own.length} else 0 end)
  or exists(select 1 from unnest(array[${managementDelegationTables.map(quote).join(',')}]) expected(table_name) where (to_regclass(ns||'.'||expected.table_name) is not null)<>installed) then raise exception 'merchant_attendance_management_installation_conflict';end if;
 if not installed then return;end if;
 own_spec:=$management_own_manifest$${JSON.stringify(own)}$management_own_manifest$::jsonb;
 ${functions}
 ${tables}
end;$management_preflight$;`;
 const forwardSql=`do $management_two_forwards$
declare installed boolean;has190 boolean;item record;old_body text;next_body text;definition text;
begin
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080202);if installed then return;end if;
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');
 for item in select * from (values
  ('public.faolla_valid_merchant_enterprise_permissions_v1(text[])',case when has190 then $management_old190$${forward.catalog190.oldBody}$management_old190$ else $management_old185$${forward.catalog185.oldBody}$management_old185$ end,
   case when has190 then $management_new190$${forward.catalog190.newBody}$management_new190$ else $management_new185$${forward.catalog185.newBody}$management_new185$ end),
  ('public.faolla_attendance_account_capture_v1(text,uuid,uuid,uuid,boolean)',$management_old_capture$${forward.capture.oldBody}$management_old_capture$,$management_new_capture$${forward.capture.newBody}$management_new_capture$)) forward_source(signature,old_body,new_body) loop
  select replace(proc.prosrc,E'\\r\\n',E'\\n'),pg_get_functiondef(proc.oid) into old_body,definition from pg_proc proc where proc.oid=to_regprocedure(item.signature);
  if old_body is distinct from item.old_body or position(old_body in definition)=0 then raise exception 'merchant_attendance_management_forward_drift';end if;
  next_body:=item.new_body;definition:=replace(definition,old_body,next_body);execute definition;
 end loop;
end;$management_two_forwards$;`;
 const final=`do $management_postconditions$
${declarations}
begin
 ${shared}
 own_spec:=$management_post_dependencies$${JSON.stringify(dependencies)}$management_post_dependencies$::jsonb;
 ${functions}
 ${newForward}
 ${functions}
 own_spec:=$management_post_own$${JSON.stringify(own)}$management_post_own$::jsonb;
 ${functions}
 ${tables}
 if (select count(*) from management_shared_metadata)<>2 or exists(select 1 from management_shared_metadata original left join pg_proc proc on proc.oid=original.oid where proc.oid is null or (to_jsonb(proc)-'prosrc') is distinct from original.metadata) then raise exception 'merchant_attendance_management_forward_metadata_changed';end if;
end;$management_postconditions$;
drop table pg_temp.management_shared_metadata,pg_temp.merchant_attendance_management_delegation_operations,pg_temp.merchant_attendance_management_delegation_revocations,pg_temp.merchant_attendance_management_delegations,pg_temp.management_expected_employees,pg_temp.management_expected_settings;`;
 return Object.freeze({preflight,forward:forwardSql,final,recipe,dependencies,ownCount:own.length});
}
export function managementDelegationFreezeSql(sql,migrations){
 const clean=sql.replaceAll('\r\n','\n'),recipe=managementDelegationInstallRecipe(clean,migrations);
 const replaceBlock=(text,name,replacement)=>{const re=new RegExp('--BEGIN GENERATED '+name+'[\\s\\S]*?--END GENERATED '+name);assert(re.test(text),'management_generator_marker:'+name);return text.replace(re,()=>`--BEGIN GENERATED ${name}\n${replacement}\n--END GENERATED ${name}`);};
 let result=replaceBlock(clean,'PREFLIGHT',recipe.preflight);result=replaceBlock(result,'FORWARD',recipe.forward);result=replaceBlock(result,'POSTCONDITIONS',recipe.final);return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.deepEqual(process.argv.slice(2),['--write'],'management_source_explicit_write_only');
 const directory=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'supabase-migrations'),target=path.join(directory,managementDelegationMigration);
 const migrations=readdirSync(directory).filter(n=>/^\d+_.+\.sql$/.test(n)&&n<managementDelegationMigration).sort().map(name=>({name,text:readFileSync(path.join(directory,name),'utf8')}));
 const output=managementDelegationFreezeSql(readFileSync(target,'utf8'),migrations);writeFileSync(target,output,'utf8');
 console.log(JSON.stringify({sourceOnly:true,migration:managementDelegationMigration,sha256:sha(output)}));
}
