-- Exact built-in UTC fast path only. No user-data rewrite, runtime grants,
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
 old_body:=replace(meta.prosrc,E'\r\n',E'\n');
 if encode(sha256(convert_to(old_body,'UTF8')),'hex') is distinct from (case when installed then '03b6beb68f9e439e7d1761f2970f8520d80c28491ec1ddc1891c496774eb1ac6' else '3681c82259aaf0653bbddf12e3904144a53030f6213b0e96cdf6f8d40702657d' end)
  or old_body is distinct from (case when installed then $utc210_new$
  select case when p_zone collate "C" = 'UTC' then true else p_zone is not null and char_length(p_zone) <= 100
    and (p_zone = 'UTC' or p_zone ~ '^[A-Za-z_+-]+(/[A-Za-z0-9_+-]+)+$')
    and exists (select 1 from pg_catalog.pg_timezone_names where name = p_zone)
  end;
$utc210_new$ else $utc210_old$
  select p_zone is not null and char_length(p_zone) <= 100
    and (p_zone = 'UTC' or p_zone ~ '^[A-Za-z_+-]+(/[A-Za-z0-9_+-]+)+$')
    and exists (select 1 from pg_catalog.pg_timezone_names where name = p_zone);
$utc210_old$ end)
  then raise exception 'merchant_attendance_utc_validation_forward_drift';end if;
 if (select count(*) from pg_catalog.pg_timezone_names where name collate "C"='UTC')<>1
  or public.faolla_attendance_valid_zone_v1('UTC') is distinct from true
  then raise exception 'merchant_attendance_utc_validation_builtin_required';end if;
 select proc.oid,to_jsonb(proc)-'prosrc',pg_get_functiondef(proc.oid) into original_oid,original_metadata,definition from pg_proc proc where proc.oid=f;
 if not installed then
  if old_body='' or (length(definition)-length(replace(definition,old_body,'')))/length(old_body)<>1
   then raise exception 'merchant_attendance_utc_validation_forward_drift';end if;
  execute replace(definition,old_body,$utc210_new$
  select case when p_zone collate "C" = 'UTC' then true else p_zone is not null and char_length(p_zone) <= 100
    and (p_zone = 'UTC' or p_zone ~ '^[A-Za-z_+-]+(/[A-Za-z0-9_+-]+)+$')
    and exists (select 1 from pg_catalog.pg_timezone_names where name = p_zone)
  end;
$utc210_new$);
 end if;
 if to_regprocedure('public.faolla_attendance_valid_zone_v1(text)')::oid is distinct from original_oid
  or not exists(select 1 from pg_proc proc where proc.oid=original_oid and to_jsonb(proc)-'prosrc'=original_metadata
   and replace(proc.prosrc,E'\r\n',E'\n')=$utc210_new$
  select case when p_zone collate "C" = 'UTC' then true else p_zone is not null and char_length(p_zone) <= 100
    and (p_zone = 'UTC' or p_zone ~ '^[A-Za-z_+-]+(/[A-Za-z0-9_+-]+)+$')
    and exists (select 1 from pg_catalog.pg_timezone_names where name = p_zone)
  end;
$utc210_new$
   and encode(sha256(convert_to(replace(proc.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')='03b6beb68f9e439e7d1761f2970f8520d80c28491ec1ddc1891c496774eb1ac6')
  then raise exception 'merchant_attendance_utc_validation_forward_metadata_changed';end if;
end;$utc210_forward$;
insert into public.faolla_schema_migrations(version,name) values(202610090210,'merchant_attendance_utc_validation_fastpath') on conflict(version) do nothing;
commit;
