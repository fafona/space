-- Add a service-only, aggregate observer for one fixed ordinary-account
-- recovery target. It exposes no UUID, email, account ID, or metadata and does
-- not mutate identity state or broaden any source-table ACL.

begin;

set local quote_all_identifiers = off;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

do $$
declare
  v_registered boolean := false;
  v_existing_function pg_catalog.pg_proc%rowtype;
  v_service_role_oid oid;
  v_readiness jsonb;
begin
  if to_regclass('auth.users') is null
     or to_regclass('public.merchants') is null
     or to_regclass('public.faolla_personal_accounts') is null
     or to_regclass('public.merchant_enterprise_staff_identities') is null
     or to_regclass('public.merchant_enterprise_employees') is null
     or to_regclass('public.faolla_schema_migrations') is null
     or to_regprocedure(
       'public.faolla_resolve_ordinary_account_authorization_v1(uuid)'
     ) is null
     or to_regprocedure(
       'public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()'
     ) is null
     or not exists (
       select 1
         from public.faolla_schema_migrations as migration
        where migration.version = 202608190035
          and migration.name =
            'ordinary_account_authorization_foundation'
     )
     or not exists (
       select 1
         from public.faolla_schema_migrations as migration
        where migration.version = 202608190036
          and migration.name =
            'ordinary_account_authorization_bootstrap'
     )
     or not exists (
       select 1
         from public.faolla_schema_migrations as migration
        where migration.version = 202608190037
          and migration.name =
            'ordinary_account_system_site_principal_isolation'
     ) then
    raise exception 'ordinary_account_recovery_observer_prerequisite_missing';
  end if;

  select role_metadata.oid
    into v_service_role_oid
    from pg_catalog.pg_roles as role_metadata
   where role_metadata.rolname = 'service_role';
  if v_service_role_oid is null then
    raise exception 'ordinary_account_recovery_observer_role_invalid';
  end if;

  if exists (
    select 1
      from public.faolla_schema_migrations as migration
     where migration.version = 202608190038
       and migration.name <> 'ordinary_account_recovery_observer'
  ) then
    raise exception 'ordinary_account_recovery_observer_registry_conflict';
  end if;

  select exists (
    select 1
      from public.faolla_schema_migrations as migration
     where migration.version = 202608190038
       and migration.name = 'ordinary_account_recovery_observer'
  ) into v_registered;

  if exists (
    select 1
      from (values
        ('auth.users', 'id', 'uuid'::regtype),
        ('public.merchants', 'id', 'text'::regtype),
        ('public.merchants', 'user_id', 'uuid'::regtype),
        ('public.merchants', 'auth_user_id', 'uuid'::regtype),
        ('public.merchants', 'owner_user_id', 'uuid'::regtype),
        ('public.merchants', 'owner_id', 'uuid'::regtype),
        ('public.merchants', 'auth_id', 'uuid'::regtype),
        ('public.merchants', 'created_by', 'uuid'::regtype),
        ('public.merchants', 'created_by_user_id', 'uuid'::regtype),
        ('public.faolla_personal_accounts', 'auth_user_id', 'uuid'::regtype),
        ('public.faolla_personal_accounts', 'personal_account_id', 'text'::regtype),
        ('public.faolla_personal_accounts', 'status', 'text'::regtype),
        ('public.merchant_enterprise_staff_identities', 'auth_user_id', 'uuid'::regtype),
        ('public.merchant_enterprise_employees', 'auth_user_id', 'uuid'::regtype)
      ) as expected_column(table_name, column_name, type_oid)
     where not exists (
       select 1
         from pg_catalog.pg_attribute as table_attribute
        where table_attribute.attrelid =
          to_regclass(expected_column.table_name)
          and table_attribute.attname = expected_column.column_name
          and table_attribute.atttypid = expected_column.type_oid
          and table_attribute.attidentity = ''
          and table_attribute.attgenerated = ''
          and not table_attribute.attisdropped
     )
  ) then
    raise exception 'ordinary_account_recovery_observer_schema_invalid';
  end if;

  v_readiness :=
    public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1();
  if jsonb_typeof(v_readiness) is distinct from 'object'
     or v_readiness -> 'schemaVersion' is distinct from '1'::jsonb
     or v_readiness #> '{invariants,schemaReady}' is distinct from 'true'::jsonb
     or v_readiness #> '{invariants,aclReady}' is distinct from 'true'::jsonb
     or v_readiness #>
       '{security,systemSitePrincipalOverlapCount}' is distinct from '0'::jsonb then
    raise exception 'ordinary_account_recovery_observer_readiness_invalid';
  end if;

  if v_registered then
    select function_metadata.*
      into v_existing_function
      from pg_catalog.pg_proc as function_metadata
     where function_metadata.oid = to_regprocedure(
       'public.faolla_observe_ordinary_account_recovery_v1(uuid,text)'
     );
    if not found
       or v_existing_function.proowner <> current_user::regrole
       or not v_existing_function.prosecdef
       or v_existing_function.prokind <> 'f'
       or v_existing_function.proretset
       or v_existing_function.prorettype <> 'jsonb'::regtype
       or v_existing_function.provolatile <> 's'
       or v_existing_function.proconfig is distinct from
         array['search_path=pg_catalog, public']::text[]
       or exists (
         select 1
           from pg_catalog.aclexplode(coalesce(
             v_existing_function.proacl,
             pg_catalog.acldefault(
               'f',
               v_existing_function.proowner
             )
           )) as function_acl
          where function_acl.privilege_type = 'EXECUTE'
            and function_acl.grantee not in (
              v_existing_function.proowner,
              v_service_role_oid
            )
       )
       or not exists (
         select 1
           from pg_catalog.aclexplode(coalesce(
             v_existing_function.proacl,
             pg_catalog.acldefault(
               'f',
               v_existing_function.proowner
             )
           )) as function_acl
          where function_acl.privilege_type = 'EXECUTE'
            and function_acl.grantee = v_service_role_oid
            and not function_acl.is_grantable
       ) then
      raise exception
        'ordinary_account_recovery_observer_registered_state_invalid';
    end if;
  end if;
end;
$$;

create or replace function
  public.faolla_observe_ordinary_account_recovery_v1(
    p_auth_user_id uuid,
    p_personal_account_id text
  )
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_readiness jsonb;
  v_result jsonb;
begin
  if p_auth_user_id is null
     or p_personal_account_id is null
     or p_personal_account_id !~ '^[0-9]{8}$' then
    raise exception 'ordinary_account_recovery_observer_invalid_query';
  end if;
  if p_personal_account_id::bigint not between 50010105 and 59999999 then
    raise exception 'ordinary_account_recovery_observer_invalid_query';
  end if;

  if not exists (
    select 1
      from auth.users as auth_user
     where auth_user.id = p_auth_user_id
  ) then
    raise exception 'ordinary_account_recovery_observer_auth_user_not_found';
  end if;

  v_readiness :=
    public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1();
  if jsonb_typeof(v_readiness) is distinct from 'object'
     or v_readiness -> 'schemaVersion' is distinct from '1'::jsonb
     or v_readiness #> '{invariants,schemaReady}' is distinct from 'true'::jsonb
     or v_readiness #> '{invariants,aclReady}' is distinct from 'true'::jsonb
     or v_readiness #>
       '{security,systemSitePrincipalOverlapCount}' is distinct from '0'::jsonb then
    raise exception 'ordinary_account_recovery_observer_readiness_invalid';
  end if;

  with merchant_bindings as materialized (
    select merchant.id
      from public.merchants as merchant
     where p_auth_user_id = any(array_remove(array[
       merchant.user_id,
       merchant.auth_user_id,
       merchant.owner_user_id,
       merchant.owner_id,
       merchant.auth_id,
       merchant.created_by,
       merchant.created_by_user_id
     ]::uuid[], null::uuid))
  ), personal_bindings as materialized (
    select
      personal_account.auth_user_id,
      personal_account.personal_account_id,
      personal_account.status
      from public.faolla_personal_accounts as personal_account
     where personal_account.auth_user_id = p_auth_user_id
        or personal_account.personal_account_id = p_personal_account_id
  )
  select jsonb_build_object(
    'schemaVersion', 1,
    'merchantBindingCount', (
      select count(*)::integer
        from merchant_bindings as merchant_binding
       where merchant_binding.id <> 'site-main'
    ),
    'systemSiteBindingCount', (
      select count(*)::integer
        from merchant_bindings as merchant_binding
       where merchant_binding.id = 'site-main'
    ),
    'staffBindingCount', (
      select count(*)::integer
        from public.merchant_enterprise_staff_identities as staff_identity
       where staff_identity.auth_user_id = p_auth_user_id
    ),
    'employeeBindingCount', (
      select count(*)::integer
        from public.merchant_enterprise_employees as employee
       where employee.auth_user_id = p_auth_user_id
    ),
    'accountIdentifierCollisionCount', (
      select count(*)::integer
        from public.merchants as merchant
       where merchant.id = p_personal_account_id
    ),
    'personalAuthBindingCount', (
      select count(*)::integer
        from personal_bindings as personal_binding
       where personal_binding.auth_user_id = p_auth_user_id
    ),
    'personalIdBindingCount', (
      select count(*)::integer
        from personal_bindings as personal_binding
       where personal_binding.personal_account_id = p_personal_account_id
    ),
    'personalOtherAuthBindingCount', (
      select count(*)::integer
        from personal_bindings as personal_binding
       where personal_binding.personal_account_id = p_personal_account_id
         and personal_binding.auth_user_id <> p_auth_user_id
    ),
    'exactCanonicalBindingCount', (
      select count(*)::integer
        from personal_bindings as personal_binding
       where personal_binding.auth_user_id = p_auth_user_id
         and personal_binding.personal_account_id = p_personal_account_id
         and personal_binding.status = 'active'
    )
  ) into v_result;

  return v_result;
end;
$$;

alter function
  public.faolla_observe_ordinary_account_recovery_v1(uuid, text)
  owner to current_user;

-- CREATE OR REPLACE preserves old ACLs. Remove every non-owner direct grant,
-- including grants delegated through arbitrary custom roles, before restoring
-- the one service bridge without grant option.
do $$
declare
  v_function_oid oid := to_regprocedure(
    'public.faolla_observe_ordinary_account_recovery_v1(uuid,text)'
  );
  v_function_owner oid;
  v_grantee record;
begin
  select function_metadata.proowner
    into v_function_owner
    from pg_catalog.pg_proc as function_metadata
   where function_metadata.oid = v_function_oid;

  for v_grantee in
    select distinct function_acl.grantee, grantee_role.rolname
      from pg_catalog.pg_proc as function_metadata
      cross join lateral pg_catalog.aclexplode(coalesce(
        function_metadata.proacl,
        pg_catalog.acldefault('f', function_metadata.proowner)
      )) as function_acl
      left join pg_catalog.pg_roles as grantee_role
        on grantee_role.oid = function_acl.grantee
     where function_metadata.oid = v_function_oid
       and function_acl.privilege_type = 'EXECUTE'
       and function_acl.grantee <> v_function_owner
  loop
    if v_grantee.grantee = 0 then
      execute format(
        'revoke all on function public.faolla_observe_ordinary_account_recovery_v1(uuid,text) from public cascade'
      );
    else
      execute format(
        'revoke all on function public.faolla_observe_ordinary_account_recovery_v1(uuid,text) from %I cascade',
        v_grantee.rolname
      );
    end if;
  end loop;
end;
$$;

revoke all on function
  public.faolla_observe_ordinary_account_recovery_v1(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function
  public.faolla_observe_ordinary_account_recovery_v1(uuid, text)
  to service_role;

do $$
declare
  v_function pg_catalog.pg_proc%rowtype;
  v_service_role_oid oid;
begin
  select role_metadata.oid
    into v_service_role_oid
    from pg_catalog.pg_roles as role_metadata
   where role_metadata.rolname = 'service_role';
  select function_metadata.*
    into v_function
    from pg_catalog.pg_proc as function_metadata
   where function_metadata.oid = to_regprocedure(
     'public.faolla_observe_ordinary_account_recovery_v1(uuid,text)'
   );

  if not found
     or v_function.proowner <> current_user::regrole
     or not v_function.prosecdef
     or v_function.prokind <> 'f'
     or v_function.proretset
     or v_function.prorettype <> 'jsonb'::regtype
     or v_function.provolatile <> 's'
     or v_function.proconfig is distinct from
       array['search_path=pg_catalog, public']::text[]
     or exists (
       select 1
         from pg_catalog.aclexplode(coalesce(
           v_function.proacl,
           pg_catalog.acldefault('f', v_function.proowner)
         )) as function_acl
        where function_acl.privilege_type = 'EXECUTE'
          and function_acl.grantee not in (
            v_function.proowner,
            v_service_role_oid
          )
     )
     or not exists (
       select 1
         from pg_catalog.aclexplode(coalesce(
           v_function.proacl,
           pg_catalog.acldefault('f', v_function.proowner)
         )) as function_acl
        where function_acl.privilege_type = 'EXECUTE'
          and function_acl.grantee = v_service_role_oid
          and not function_acl.is_grantable
     ) then
    raise exception 'ordinary_account_recovery_observer_grant_invalid';
  end if;
end;
$$;

insert into public.faolla_schema_migrations (version, name)
values (202608190038, 'ordinary_account_recovery_observer')
on conflict (version) do nothing;

do $$
begin
  if not exists (
    select 1
      from public.faolla_schema_migrations as migration
     where migration.version = 202608190038
       and migration.name = 'ordinary_account_recovery_observer'
  ) then
    raise exception 'ordinary_account_recovery_observer_registry_invalid';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
