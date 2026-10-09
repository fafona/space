-- Opt-in wrappers for NEW clock_in only. Old RPC definitions, authentication,
-- receipt shapes, replays, safe finishes and event-writing logic stay intact.
-- These wrappers and133's private binder run in the original clock transaction.
begin;
set local lock_timeout='3s';

do $bound_clocks_prerequisites$
declare installed boolean;v bigint;n text;p text;
begin
  if to_regclass('public.faolla_schema_migrations') is null then raise exception 'merchant_attendance_bound_clocks_prerequisite_required';end if;
  for v,n in select * from (values
    (202610010108::bigint,'merchant_attendance_onsite_qr'),(202610020111::bigint,'merchant_attendance_self_clock_identity'),
    (202610020112::bigint,'merchant_attendance_pin_clock_identity'),(202610020113::bigint,'merchant_attendance_location_receipt_identity'),
    (202610040133::bigint,'merchant_attendance_shift_rule_bindings')) x(version,name) loop
    if not exists(select 1 from public.faolla_schema_migrations where version=v and name=n) then raise exception 'merchant_attendance_bound_clocks_prerequisite_required';end if;
  end loop;
  foreach p in array array['public.faolla_attendance_self_v1(text,uuid,jsonb,uuid)',
    'public.faolla_attendance_location_clock_v2(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean)',
    'public.faolla_attendance_pin_clock_v1(text,uuid,text,text,uuid,boolean,jsonb,boolean)',
    'public.faolla_attendance_onsite_clock_v1(text,uuid,jsonb,jsonb,uuid,boolean)',
    'public.faolla_attendance_bind_shift_rules_v1(uuid,text,uuid)'] loop
    if to_regprocedure(p) is null then raise exception 'merchant_attendance_bound_clocks_prerequisite_required';end if;
  end loop;
  select exists(select 1 from public.faolla_schema_migrations where version=202610040134 and name='merchant_attendance_bound_clocks') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610040134 and name<>'merchant_attendance_bound_clocks') then
    raise exception 'merchant_attendance_bound_clocks_installation_conflict';end if;
  foreach p in array array['public.faolla_attendance_self_bound_v1(text,uuid,jsonb,uuid)',
    'public.faolla_attendance_location_clock_bound_v1(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean)',
    'public.faolla_attendance_pin_clock_bound_v1(text,uuid,text,text,uuid,boolean,jsonb,boolean)',
    'public.faolla_attendance_onsite_clock_bound_v1(text,uuid,jsonb,jsonb,uuid,boolean)'] loop
    if installed<>(to_regprocedure(p) is not null) then raise exception 'merchant_attendance_bound_clocks_installation_conflict';end if;
  end loop;
end;
$bound_clocks_prerequisites$;

create or replace function public.faolla_attendance_self_bound_v1(
  p_site_id text,p_auth_user_id uuid,p_command jsonb default null,p_operation_id uuid default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
  result:=public.faolla_attendance_self_v1(p_site_id,p_auth_user_id,p_command,p_operation_id);
  if p_command is not null and p_command->>'action'='clock_in' then
    if result->'replayed' is distinct from 'true'::jsonb and result->'replayed' is distinct from 'false'::jsonb then
      raise exception 'attendance_shift_rule_binding_invalid';end if;
    if result->'replayed'='false'::jsonb then
      if result->'receipt'->>'action' is distinct from 'clock_in' or result->'receipt'->>'operationId' is distinct from p_command->>'operationId'
        or result->'receipt'->>'siteId' is distinct from p_site_id or jsonb_typeof(result->'receipt'->'id') is distinct from 'string' then
        raise exception 'attendance_shift_rule_binding_invalid';end if;
      perform public.faolla_attendance_bind_shift_rules_v1((result->'receipt'->>'id')::uuid,'self',p_auth_user_id);
    end if;
  end if;
  return result;
end;
$$;

create or replace function public.faolla_attendance_location_clock_bound_v1(
  p_site_id text,p_auth_user_id uuid,p_expected_worker_id uuid,p_command jsonb default null,p_operation_id uuid default null,
  p_assertion jsonb default null,p_allow_new_sessions boolean default false,p_require_clock boolean default false
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
  result:=public.faolla_attendance_location_clock_v2(p_site_id,p_auth_user_id,p_expected_worker_id,p_command,p_operation_id,p_assertion,p_allow_new_sessions,p_require_clock);
  if p_command is not null and p_command->>'action'='clock_in' then
    if result->'replayed' is distinct from 'true'::jsonb and result->'replayed' is distinct from 'false'::jsonb then
      raise exception 'attendance_shift_rule_binding_invalid';end if;
    if result->'replayed'='false'::jsonb then
      if result->'receipt'->>'action' is distinct from 'clock_in' or result->'receipt'->>'operationId' is distinct from p_command->>'operationId'
        or result->'receipt'->>'siteId' is distinct from p_site_id or jsonb_typeof(result->'receipt'->'id') is distinct from 'string' then
        raise exception 'attendance_shift_rule_binding_invalid';end if;
      perform public.faolla_attendance_bind_shift_rules_v1((result->'receipt'->>'id')::uuid,'location',p_auth_user_id);
    end if;
  end if;
  return result;
end;
$$;

create or replace function public.faolla_attendance_pin_clock_bound_v1(
  p_site text,p_terminal uuid,p_secret_hash text,p_no text,p_lease uuid,p_verified boolean,p_request jsonb,p_allow_new boolean
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;command jsonb;
begin
  -- DO NOT put the old call in an EXCEPTION subtransaction:112 deliberately
  -- consumes a PIN lease outside its caught business-denial subtransaction.
  result:=public.faolla_attendance_pin_clock_v1(p_site,p_terminal,p_secret_hash,p_no,p_lease,p_verified,p_request,p_allow_new);
  if result ? 'error' then return result;end if;
  command:=nullif(p_request->'command','null'::jsonb);
  if command is not null and command->>'action'='clock_in' then
    if result->'replayed' is distinct from 'true'::jsonb and result->'replayed' is distinct from 'false'::jsonb then
      raise exception 'attendance_shift_rule_binding_invalid';end if;
    if result->'replayed'='false'::jsonb then
      if result->'receipt'->>'action' is distinct from 'clock_in' or result->'receipt'->>'operationId' is distinct from command->>'operationId'
        or result->'receipt'->>'siteId' is distinct from p_site or jsonb_typeof(result->'receipt'->'id') is distinct from 'string' then
        raise exception 'attendance_shift_rule_binding_invalid';end if;
      perform public.faolla_attendance_bind_shift_rules_v1((result->'receipt'->>'id')::uuid,'pin',null);
    end if;
  end if;
  return result;
end;
$$;

create or replace function public.faolla_attendance_onsite_clock_bound_v1(
  p_site text,p_auth uuid,p_claims jsonb,p_command jsonb,p_operation uuid,p_allow_new boolean
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
  result:=public.faolla_attendance_onsite_clock_v1(p_site,p_auth,p_claims,p_command,p_operation,p_allow_new);
  if p_command is not null and p_command->>'action'='clock_in' then
    if result->'replayed' is distinct from 'true'::jsonb and result->'replayed' is distinct from 'false'::jsonb then
      raise exception 'attendance_shift_rule_binding_invalid';end if;
    if result->'replayed'='false'::jsonb then
      if result->'receipt'->>'action' is distinct from 'clock_in' or result->'receipt'->>'operationId' is distinct from p_command->>'operationId'
        or result->'receipt'->>'siteId' is distinct from p_site or jsonb_typeof(result->'receipt'->'id') is distinct from 'string' then
        raise exception 'attendance_shift_rule_binding_invalid';end if;
      perform public.faolla_attendance_bind_shift_rules_v1((result->'receipt'->>'id')::uuid,'onsite',p_auth);
    end if;
  end if;
  return result;
end;
$$;

-- These grants affect only the new opt-in wrappers. Existing endpoints and
-- private helper permissions remain unchanged; no trigger intercepts old calls.
revoke all on function public.faolla_attendance_self_bound_v1(text,uuid,jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_location_clock_bound_v1(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_pin_clock_bound_v1(text,uuid,text,text,uuid,boolean,jsonb,boolean) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_onsite_clock_bound_v1(text,uuid,jsonb,jsonb,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_self_bound_v1(text,uuid,jsonb,uuid) to service_role;
grant execute on function public.faolla_attendance_location_clock_bound_v1(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean) to service_role;
grant execute on function public.faolla_attendance_pin_clock_bound_v1(text,uuid,text,text,uuid,boolean,jsonb,boolean) to service_role;
grant execute on function public.faolla_attendance_onsite_clock_bound_v1(text,uuid,jsonb,jsonb,uuid,boolean) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610040134,'merchant_attendance_bound_clocks') on conflict(version) do nothing;
do $bound_clocks_postconditions$
declare p regprocedure;r text;
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610040134 and name='merchant_attendance_bound_clocks') then
    raise exception 'merchant_attendance_bound_clocks_registry_postcondition_failed';end if;
  foreach p in array array['public.faolla_attendance_self_bound_v1(text,uuid,jsonb,uuid)'::regprocedure,
    'public.faolla_attendance_location_clock_bound_v1(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean)'::regprocedure,
    'public.faolla_attendance_pin_clock_bound_v1(text,uuid,text,text,uuid,boolean,jsonb,boolean)'::regprocedure,
    'public.faolla_attendance_onsite_clock_bound_v1(text,uuid,jsonb,jsonb,uuid,boolean)'::regprocedure] loop
    if not has_function_privilege('service_role',p,'EXECUTE') or has_function_privilege('anon',p,'EXECUTE') or has_function_privilege('authenticated',p,'EXECUTE')
      or exists(select 1 from pg_proc f cross join lateral aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
        where f.oid=p and a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'merchant_attendance_bound_clocks_acl_postcondition_failed';end if;
  end loop;
  foreach r in array array['anon','authenticated','service_role'] loop
    if has_function_privilege(r,'public.faolla_attendance_bind_shift_rules_v1(uuid,text,uuid)','EXECUTE') then
      raise exception 'merchant_attendance_bound_clocks_acl_postcondition_failed';end if;
  end loop;
  if exists(select 1 from pg_proc f cross join lateral aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
    where f.oid='public.faolla_attendance_bind_shift_rules_v1(uuid,text,uuid)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE') then
    raise exception 'merchant_attendance_bound_clocks_acl_postcondition_failed';end if;
end;
$bound_clocks_postconditions$;
notify pgrst, 'reload schema';
commit;
