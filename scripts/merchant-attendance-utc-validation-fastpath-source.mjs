// 210 SOURCE recipe only. No database connection or installation. The sole
// shared-function change short-circuits exact built-in UTC; every other input
// retains the complete original 061 expression, including its NULL behavior.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {dayReviewSqlFunctions} from './merchant-attendance-day-review-source.mjs';

export const utcValidationFastpathMigration='202610090210_merchant_attendance_utc_validation_fastpath.sql';
export const utcValidationFoundationMigration='202609290061_merchant_attendance_foundation.sql';
export const utcValidationOriginalHash='3681c82259aaf0653bbddf12e3904144a53030f6213b0e96cdf6f8d40702657d';
const sha=value=>createHash('sha256').update(value.replaceAll('\r\n','\n'),'utf8').digest('hex');

export function utcValidationFastpathRecipe(foundation){
 const original=dayReviewSqlFunctions(foundation).filter(f=>f.name==='faolla_attendance_valid_zone_v1');
 assert.equal(original.length,1,'utc210_unique_original_required');
 const f=original[0];assert.equal(f.hash,utcValidationOriginalHash,'utc210_exact_original_required');
 assert.deepEqual({signature:f.signature,result:f.result,language:f.language,volatility:f.volatility,definer:f.definer,
  defaults:f.defaults,defaultExpression:f.defaultExpression,args:f.args,searchPath:f.searchPath},
 {signature:'public.faolla_attendance_valid_zone_v1(text)',result:'boolean',language:'sql',volatility:'s',definer:false,
  defaults:0,defaultExpression:null,args:['p_zone'],searchPath:'search_path=pg_catalog'},'utc210_original_metadata_required');
 const expression=f.body.match(/^\n  select ([\s\S]*);\n$/)?.[1];assert(expression,'utc210_original_expression_required');
 const prefix='\n  select case when p_zone collate "C" = \'UTC\' then true else ',suffix='\n  end;\n';
 const newBody=prefix+expression+suffix;
 assert.equal(newBody.slice(prefix.length,-suffix.length),expression);
 return Object.freeze({...f,oldBody:f.body,newBody,oldHash:f.hash,newHash:sha(newBody),expression,prefix,suffix});
}

export function utcValidationFastpathApply(body,recipe){
 assert.equal(sha(body),recipe.oldHash,'utc210_exact_forward_source_required');
 assert.equal(body.replaceAll('\r\n','\n'),recipe.oldBody,'utc210_exact_forward_body_required');
 assert.equal(recipe.newBody,recipe.prefix+recipe.expression+recipe.suffix,'utc210_exact_forward_delta_required');
 assert.equal(sha(recipe.newBody),recipe.newHash,'utc210_exact_forward_hash_required');
 return recipe.newBody;
}

export function utcValidationFastpathSql(foundation){
 const r=utcValidationFastpathRecipe(foundation);
 return `-- Exact built-in UTC fast path only. No user-data rewrite, runtime grants,
-- policy changes, cache, new RPC, permanent helper table, or weakened old pins.
-- Install only after the previous attendance installation/reentry checks.
begin;
do $utc210_forward$
declare f regprocedure;meta record;expected_owner oid;installed boolean;old_body text;definition text;original_metadata jsonb;original_oid oid;
begin
 if to_regclass('public.faolla_schema_migrations') is null or to_regclass('public.merchant_attendance_settings') is null
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080208 and name='merchant_attendance_delegated_revisions')
  then raise exception 'merchant_attendance_utc_validation_prerequisite_required';end if;
 if exists(select 1 from public.faolla_schema_migrations where version=202610090210 and name<>'merchant_attendance_utc_validation_fastpath')
  then raise exception 'merchant_attendance_utc_validation_installation_conflict';end if;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610090210 and name='merchant_attendance_utc_validation_fastpath');
 select relowner into expected_owner from pg_class where oid='public.merchant_attendance_settings'::regclass;
 if expected_owner is distinct from (select oid from pg_roles where rolname=current_user)
  then raise exception 'merchant_attendance_utc_validation_owner_conflict';end if;
 f:=to_regprocedure('public.faolla_attendance_valid_zone_v1(text)');
 select proc.*,lang.lanname into meta from pg_proc proc join pg_language lang on lang.oid=proc.prolang where proc.oid=f;
 if f is null or meta.proowner is distinct from expected_owner or meta.lanname is distinct from 'sql' or meta.provolatile<>'s'
  or meta.prosecdef or meta.proconfig is distinct from array['search_path=pg_catalog'] or meta.prorettype<>'boolean'::regtype
  or meta.proargtypes is distinct from '25'::oidvector or meta.pronargs<>1 or meta.proargnames is distinct from array['p_zone']
  or meta.pronargdefaults<>0 or meta.proargdefaults is not null or meta.proallargtypes is not null or meta.proargmodes is not null
  or meta.proretset or meta.proisstrict or meta.proleakproof or meta.prokind<>'f' or meta.proparallel<>'u' or meta.prosupport<>0::oid
  or meta.procost<>100 or meta.prorows<>0 or meta.protrftypes is not null or meta.prosqlbody is not null
  or (select count(*) from pg_proc proc where proc.pronamespace=meta.pronamespace and proc.proname=meta.proname)<>1
  then raise exception 'merchant_attendance_utc_validation_installation_conflict';end if;
 if has_function_privilege(expected_owner,f,'EXECUTE') is distinct from true
  or has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE') or has_function_privilege('service_role',f,'EXECUTE')
  or exists(select 1 from aclexplode(coalesce(meta.proacl,acldefault('f',meta.proowner))) acl
   where acl.grantor<>expected_owner or acl.grantee<>expected_owner or acl.privilege_type<>'EXECUTE' or acl.is_grantable)
  then raise exception 'merchant_attendance_utc_validation_permission_conflict';end if;
 old_body:=replace(meta.prosrc,E'\\r\\n',E'\\n');
 if encode(sha256(convert_to(old_body,'UTF8')),'hex') is distinct from (case when installed then '${r.newHash}' else '${r.oldHash}' end)
  or old_body is distinct from (case when installed then $utc210_new$${r.newBody}$utc210_new$ else $utc210_old$${r.oldBody}$utc210_old$ end)
  then raise exception 'merchant_attendance_utc_validation_forward_drift';end if;
 if (select count(*) from pg_catalog.pg_timezone_names where name collate "C"='UTC')<>1
  or public.faolla_attendance_valid_zone_v1('UTC') is distinct from true
  then raise exception 'merchant_attendance_utc_validation_builtin_required';end if;
 select proc.oid,to_jsonb(proc)-'prosrc',pg_get_functiondef(proc.oid) into original_oid,original_metadata,definition from pg_proc proc where proc.oid=f;
 if not installed then
  if old_body='' or (length(definition)-length(replace(definition,old_body,'')))/length(old_body)<>1
   then raise exception 'merchant_attendance_utc_validation_forward_drift';end if;
  execute replace(definition,old_body,$utc210_new$${r.newBody}$utc210_new$);
 end if;
 if to_regprocedure('public.faolla_attendance_valid_zone_v1(text)')::oid is distinct from original_oid
  or not exists(select 1 from pg_proc proc where proc.oid=original_oid and to_jsonb(proc)-'prosrc'=original_metadata
   and replace(proc.prosrc,E'\\r\\n',E'\\n')=$utc210_new$${r.newBody}$utc210_new$
   and encode(sha256(convert_to(replace(proc.prosrc,E'\\r\\n',E'\\n'),'UTF8')),'hex')='${r.newHash}')
  then raise exception 'merchant_attendance_utc_validation_forward_metadata_changed';end if;
end;$utc210_forward$;
insert into public.faolla_schema_migrations(version,name) values(202610090210,'merchant_attendance_utc_validation_fastpath') on conflict(version) do nothing;
commit;
`;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.deepEqual(process.argv.slice(2),['--write']);
 const dir=path.join(path.dirname(fileURLToPath(import.meta.url)),'supabase-migrations');
 const foundation=readFileSync(path.join(dir,utcValidationFoundationMigration),'utf8');
 const output=utcValidationFastpathSql(foundation);writeFileSync(path.join(dir,utcValidationFastpathMigration),output,'utf8');
 console.log(JSON.stringify({sourceOnly:true,migration:utcValidationFastpathMigration,sha256:sha(output),newBodyHash:utcValidationFastpathRecipe(foundation).newHash}));
}
