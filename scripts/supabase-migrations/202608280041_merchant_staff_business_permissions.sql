-- Add the staff business permission catalog to the existing enterprise roles.
-- The migration changes validation and mutation entry points only: existing
-- role rows and future role defaults remain untouched.

begin;

set transaction isolation level read committed;
set local search_path = pg_catalog, public;
set local lock_timeout = '15s';
set local statement_timeout = '60s';

do $migrator_preflight$
begin
  if current_user <> 'supabase_admin'
     or not exists (
       select 1
         from pg_catalog.pg_roles as role_metadata
        where role_metadata.rolname = current_user
          and role_metadata.rolsuper
     ) then
    raise exception 'merchant_staff_business_permissions_untrusted_migrator';
  end if;
end;
$migrator_preflight$;

select pg_catalog.pg_advisory_xact_lock(20260731, 1);

-- Freeze the same security catalogs and in the same order as migration 039.
-- This prevents role attributes, memberships, owners, definitions, and ACLs
-- from changing between the inherited-security preflight and postcondition.
lock table
  pg_catalog.pg_database,
  pg_catalog.pg_authid,
  pg_catalog.pg_auth_members,
  pg_catalog.pg_namespace,
  pg_catalog.pg_language,
  pg_catalog.pg_type,
  pg_catalog.pg_proc,
  pg_catalog.pg_default_acl,
  pg_catalog.pg_class,
  pg_catalog.pg_attribute
in share row exclusive mode;

lock table public.faolla_schema_migrations in share row exclusive mode;

do $preflight$
begin
  if current_user <> 'supabase_admin'
     or not exists (
       select 1
         from pg_catalog.pg_roles as role_metadata
        where role_metadata.rolname = current_user
          and role_metadata.rolsuper
     ) then
    raise exception 'merchant_staff_business_permissions_untrusted_migrator';
  end if;

  if to_regrole('supabase_admin') is null
     or to_regrole('service_role') is null
     or to_regrole('anon') is null
     or to_regrole('authenticated') is null
     or to_regrole('authenticator') is null
     or to_regrole('supabase_storage_admin') is null
     or to_regclass('auth.users') is null
     or to_regclass('public.merchant_enterprise_roles') is null
     or to_regclass('public.faolla_schema_migrations') is null
     or to_regprocedure(
       'public.faolla_valid_merchant_enterprise_permissions_v1(text[])'
     ) is null
     or to_regprocedure(
       'public.faolla_create_merchant_enterprise_role_v2(jsonb)'
     ) is null
     or to_regprocedure(
       'public.faolla_update_merchant_enterprise_role_v2(jsonb)'
     ) is null
     or to_regprocedure(
       'public.faolla_create_merchant_enterprise_role_v1_preaudit_019(jsonb)'
     ) is null
     or to_regprocedure(
       'public.faolla_update_merchant_enterprise_role_v1_preaudit_019(jsonb)'
     ) is null
     or to_regprocedure(
       'public.faolla_create_merchant_enterprise_role_v2_preaudit_019(jsonb)'
     ) is null
     or to_regprocedure(
       'public.faolla_update_merchant_enterprise_role_v2_preaudit_019(jsonb)'
     ) is null
     or to_regprocedure(
       'public.faolla_grant_merchant_enterprise_role_workflow_permissions_v1(jsonb)'
     ) is null then
    raise exception 'merchant_staff_business_permissions_prerequisite_missing';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_roles
     where rolname in ('anon', 'authenticated')
       and (
         rolsuper or rolcreaterole or rolcreatedb or rolcanlogin
         or rolreplication or rolbypassrls
       )
  ) or exists (
    select 1
      from pg_catalog.pg_roles
     where rolname = 'service_role'
       and (
         rolsuper or rolcreaterole or rolcreatedb or rolcanlogin
         or rolreplication or not rolbypassrls
       )
  ) or not exists (
    select 1
      from pg_catalog.pg_roles
     where rolname = 'authenticator'
       and rolcanlogin
       and not rolinherit
       and not rolsuper
       and not rolcreaterole
       and not rolcreatedb
       and not rolreplication
       and not rolbypassrls
  ) or exists (
    select 1
      from pg_catalog.pg_roles
     where rolname = 'supabase_storage_admin'
       and rolinherit
  ) or exists (
    select 1
      from pg_catalog.pg_roles
     where rolname = 'cli_login_postgres'
       and (
         not rolcanlogin or rolsuper or rolcreaterole or rolcreatedb
         or rolreplication or rolbypassrls
       )
  ) or exists (
    select 1
      from pg_catalog.pg_roles
     where rolname !~ '^pg_'
       and (rolsuper or rolcreaterole)
       and rolname not in (
         'dashboard_user', 'postgres', 'supabase_admin',
         'supabase_auth_admin', 'supabase_functions_admin',
         'supabase_storage_admin'
       )
  ) then
    raise exception
      'merchant_staff_business_permissions_role_attribute_prerequisite_invalid';
  end if;

  -- Reassert the protected role graph normalized by migration 039. Raw ACLs
  -- are insufficient because even a NOINHERIT edge can be reached with SET
  -- ROLE; reject every unexpected direct or transitive path before mutation.
  if 3 <> (
    select count(*)
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as granted_role
        on granted_role.oid = membership.roleid
      join pg_catalog.pg_roles as member_role
        on member_role.oid = membership.member
     where granted_role.rolname in ('anon', 'authenticated', 'service_role')
       and member_role.rolname = 'authenticator'
       and not membership.admin_option
  ) or (
    select count(*)
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as granted_role
        on granted_role.oid = membership.roleid
      join pg_catalog.pg_roles as member_role
        on member_role.oid = membership.member
     where granted_role.rolname in ('anon', 'authenticated', 'service_role')
       and member_role.rolname = 'postgres'
       and not membership.admin_option
  ) not in (0, 3) or exists (
    with allowed_membership(granted_role, member_role, admin_option) as (
      values
        ('anon', 'authenticator', false),
        ('authenticated', 'authenticator', false),
        ('service_role', 'authenticator', false),
        ('anon', 'postgres', false),
        ('authenticated', 'postgres', false),
        ('service_role', 'postgres', false),
        ('authenticator', 'supabase_storage_admin', false),
        ('postgres', 'cli_login_postgres', false)
    ), actual_protected_membership as (
      select granted_role.rolname::text, member_role.rolname::text,
             membership.admin_option
        from pg_catalog.pg_auth_members as membership
        join pg_catalog.pg_roles as granted_role
          on granted_role.oid = membership.roleid
        join pg_catalog.pg_roles as member_role
          on member_role.oid = membership.member
       where granted_role.rolname in (
           'anon', 'authenticated', 'service_role', 'supabase_admin',
           'authenticator', 'postgres'
         )
          or member_role.rolname in (
            'anon', 'authenticated', 'service_role', 'authenticator',
            'supabase_storage_admin', 'cli_login_postgres'
          )
    )
    select 1 from (
      select * from actual_protected_membership
      except
      select * from allowed_membership
    ) as unexpected_membership
  ) or exists (
    select 1
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as granted_role
        on granted_role.oid = membership.roleid
      join pg_catalog.pg_roles as member_role
        on member_role.oid = membership.member
      join pg_catalog.pg_roles as grantor_role
        on grantor_role.oid = membership.grantor
     where (
       granted_role.rolname in (
         'anon', 'authenticated', 'service_role', 'supabase_admin',
         'authenticator', 'postgres'
       )
       or member_role.rolname in (
         'anon', 'authenticated', 'service_role', 'authenticator',
         'supabase_storage_admin', 'cli_login_postgres'
       )
     )
       and (
         grantor_role.rolname not in ('postgres', 'supabase_admin')
         or (
           granted_role.rolname = 'postgres'
           and member_role.rolname = 'cli_login_postgres'
           and grantor_role.rolname <> 'supabase_admin'
         )
       )
  ) or exists (
    with recursive role_path(start_role, reachable_role) as (
      select membership.member, membership.roleid
        from pg_catalog.pg_auth_members as membership
      union
      select role_path.start_role, membership.roleid
        from role_path
        join pg_catalog.pg_auth_members as membership
          on membership.member = role_path.reachable_role
    )
    select 1
      from role_path
      join pg_catalog.pg_roles as start_metadata
        on start_metadata.oid = role_path.start_role
      join pg_catalog.pg_roles as reachable_metadata
        on reachable_metadata.oid = role_path.reachable_role
     where start_metadata.rolname not in (
         'anon', 'authenticated', 'service_role', 'supabase_admin',
         'supabase_storage_admin', 'authenticator', 'postgres',
         'dashboard_user', 'supabase_auth_admin',
         'supabase_functions_admin', 'cli_login_postgres'
       )
       and reachable_metadata.rolname in (
         'anon', 'authenticated', 'service_role', 'supabase_admin',
         'supabase_storage_admin', 'authenticator', 'postgres',
         'dashboard_user', 'supabase_auth_admin',
         'supabase_functions_admin', 'cli_login_postgres'
       )
  ) then
    raise exception
      'merchant_staff_business_permissions_membership_prerequisite_invalid';
  end if;

  if not exists (
    select 1
      from public.faolla_schema_migrations
     where version = 202608190040
       and name = 'merchant_acl_contract_hardening'
  ) then
    raise exception 'merchant_staff_business_permissions_registry_prerequisite_missing';
  end if;

  if exists (
    select 1
      from public.faolla_schema_migrations
     where version = 202608280041
  ) then
    raise exception 'merchant_staff_business_permissions_registry_conflict';
  end if;

  -- v3 is introduced by this migration. Refuse a pre-created signature or
  -- overload instead of replacing an object whose owner/ACL may be hostile.
  if exists (
    select 1
      from pg_catalog.pg_proc as procedure_row
     where procedure_row.pronamespace = 'public'::pg_catalog.regnamespace
       and procedure_row.proname in (
         'faolla_role_has_staff_business_permissions_v1',
         'faolla_assert_staff_business_role_owner_v1',
         'faolla_guard_staff_business_role_owner_v1',
         'faolla_create_merchant_enterprise_role_v3',
         'faolla_update_merchant_enterprise_role_v3',
         'faolla_create_merchant_enterprise_role_v2_core_041',
         'faolla_update_merchant_enterprise_role_v2_core_041'
       )
  ) then
    raise exception 'merchant_staff_business_permissions_rpc_prestate_conflict';
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.merchant_enterprise_roles'::regclass
       and conname = 'merchant_enterprise_roles_permissions_check'
       and contype = 'c'
       and convalidated
  ) then
    raise exception 'merchant_staff_business_permissions_constraint_prerequisite_missing';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_class as relation
     where relation.oid = 'public.merchant_enterprise_roles'::pg_catalog.regclass
       and relation.relowner = pg_catalog.to_regrole('supabase_admin')
  ) then
    raise exception 'merchant_staff_business_permissions_role_owner_invalid';
  end if;

  -- These definitions become the owner-only write chain below. Refuse to pin
  -- and trust a drifted SECURITY DEFINER body, overload, owner, or signature.
  if exists (
    select 1
      from (values
        (
          'public.faolla_create_merchant_enterprise_role_v1(jsonb)',
          'faolla_create_merchant_enterprise_role_v1',
          '4b9bffe16eda040e6ad647fca4dbc986'
        ),
        (
          'public.faolla_update_merchant_enterprise_role_v1(jsonb)',
          'faolla_update_merchant_enterprise_role_v1',
          '54e95a08a261f8f4ca6ec4afccde7fe1'
        ),
        (
          'public.faolla_create_merchant_enterprise_role_v2(jsonb)',
          'faolla_create_merchant_enterprise_role_v2',
          '75c2019c420b36bc48e49b9f49d082a5'
        ),
        (
          'public.faolla_update_merchant_enterprise_role_v2(jsonb)',
          'faolla_update_merchant_enterprise_role_v2',
          '1a72c9c1dc484cf21e0cb9ed21e7e591'
        ),
        (
          'public.faolla_create_merchant_enterprise_role_v1_preaudit_019(jsonb)',
          'faolla_create_merchant_enterprise_role_v1_preaudit_019',
          'f924054f3d6d0583ca5ca5f6d3c37b8b'
        ),
        (
          'public.faolla_update_merchant_enterprise_role_v1_preaudit_019(jsonb)',
          'faolla_update_merchant_enterprise_role_v1_preaudit_019',
          'e6001f91ab4130c263792635af736d25'
        ),
        (
          'public.faolla_create_merchant_enterprise_role_v2_preaudit_019(jsonb)',
          'faolla_create_merchant_enterprise_role_v2_preaudit_019',
          'a8c1fba3d8afe5d38533cb86c4cfda84'
        ),
        (
          'public.faolla_update_merchant_enterprise_role_v2_preaudit_019(jsonb)',
          'faolla_update_merchant_enterprise_role_v2_preaudit_019',
          '10a9a8eb8ee9ebde36191561c1bd1e10'
        ),
        (
          'public.faolla_grant_merchant_enterprise_role_workflow_permissions_v1(jsonb)',
          'faolla_grant_merchant_enterprise_role_workflow_permissions_v1',
          '968d8933b879a5030d71acd0bc3d6db4'
        )
      ) as expected(signature, function_name, source_md5)
      left join pg_catalog.pg_proc as function_metadata
        on function_metadata.oid = pg_catalog.to_regprocedure(
          expected.signature
        )
      left join pg_catalog.pg_language as language_metadata
        on language_metadata.oid = function_metadata.prolang
     where function_metadata.oid is null
        or function_metadata.pronamespace <>
          'public'::pg_catalog.regnamespace
        or function_metadata.proname <> expected.function_name
        or function_metadata.proowner <>
          pg_catalog.to_regrole('supabase_admin')
        or function_metadata.prokind <> 'f'
        or language_metadata.lanname <> 'plpgsql'
        or function_metadata.prorettype <>
          'jsonb'::pg_catalog.regtype
        or function_metadata.proretset
        or not function_metadata.prosecdef
        or function_metadata.provolatile <> 'v'
        or function_metadata.proparallel <> 'u'
        or function_metadata.proconfig is distinct from
          array['search_path=public']::text[]
        or function_metadata.proisstrict
        or function_metadata.proleakproof
        or function_metadata.pronargs <> 1
        or function_metadata.pronargdefaults <> 0
        or function_metadata.proargnames is distinct from
          array['p_input']::text[]
        or function_metadata.proargmodes is not null
        or function_metadata.proallargtypes is not null
        or function_metadata.proargtypes[0] <>
          'jsonb'::pg_catalog.regtype
        or pg_catalog.md5(pg_catalog.replace(
          function_metadata.prosrc,
          E'\r\n',
          E'\n'
        )) <> expected.source_md5
        or 1 <> (
          select count(*)
            from pg_catalog.pg_proc as overload
           where overload.pronamespace =
             'public'::pg_catalog.regnamespace
             and overload.proname = expected.function_name
        )
  ) then
    raise exception
      'merchant_staff_business_permissions_write_chain_definition_invalid';
  end if;
end;
$preflight$;

-- Freeze role writes so the old-validator preflight and new-validator
-- postcondition observe one stable set of role rows.
lock table public.merchant_enterprise_roles in share row exclusive mode;

do $role_preflight$
begin
  if exists (
    select 1
      from public.merchant_enterprise_roles as role_row
     where not public.faolla_valid_merchant_enterprise_permissions_v1(
       role_row.permissions
     )
        or role_row.permissions && array[
          'redemptions.view',
          'redemptions.customer_data.view',
          'redemptions.checkout',
          'redemptions.recharge',
          'redemptions.recharge.cancel',
          'redemptions.catalog.manage',
          'redemptions.print',
          'bookings.view',
          'bookings.customer_data.view',
          'bookings.update',
          'bookings.status.manage',
          'bookings.email.send',
          'bookings.analytics.view',
          'bookings.export',
          'bookings.settings.manage',
          'bookings.automation.manage',
          'bookings.calendar.manage',
          'orders.view',
          'orders.customer_data.view',
          'orders.status.manage',
          'orders.complete',
          'orders.items.update',
          'orders.print',
          'orders.analytics.view',
          'orders.export',
          'orders.export.customer_data',
          'orders.catalog.view',
          'orders.catalog.manage',
          'conversations.view',
          'conversations.search',
          'conversations.start',
          'conversations.send',
          'members.view',
          'members.customer_data.view',
          'members.account.view',
          'members.account.adjust',
          'members.allergens.manage',
          'members.insights.view',
          'members.settings.manage'
        ]::text[]
        or cardinality(role_row.permissions) <> (
          select count(distinct permission)::integer
            from unnest(role_row.permissions) as item(permission)
        )
  ) then
    raise exception 'merchant_staff_business_permissions_role_prestate_invalid';
  end if;
end;
$role_preflight$;

create or replace function public.faolla_valid_merchant_enterprise_permissions_v1(
  p_permissions text[]
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  with permission_catalog(permission, dependencies) as (
    values
      ('enterprise.view'::text, array[]::text[]),
      ('tasks.view', array['enterprise.view']::text[]),
      ('tasks.create', array['enterprise.view', 'tasks.view']::text[]),
      ('tasks.update', array['enterprise.view', 'tasks.view']::text[]),
      ('tasks.assign', array['enterprise.view', 'tasks.view']::text[]),
      ('tasks.archive', array['enterprise.view', 'tasks.view']::text[]),
      ('orders.linked.view', array['enterprise.view', 'tasks.view']::text[]),
      ('boards.manage', array['enterprise.view', 'tasks.view']::text[]),
      ('employees.view', array['enterprise.view', 'roles.view']::text[]),
      ('employees.manage', array['enterprise.view', 'employees.view', 'roles.view']::text[]),
      ('roles.view', array['enterprise.view']::text[]),
      ('roles.manage', array['enterprise.view', 'roles.view']::text[]),
      ('workflows.view', array['enterprise.view']::text[]),
      ('workflows.manage', array['enterprise.view', 'workflows.view']::text[]),
      ('workflows.publish', array['enterprise.view', 'workflows.view']::text[]),
      ('automations.view', array['enterprise.view', 'tasks.view', 'workflows.view']::text[]),
      (
        'automations.manage',
        array[
          'enterprise.view',
          'tasks.view',
          'tasks.create',
          'tasks.assign',
          'workflows.view',
          'automations.view',
          'roles.view',
          'employees.view'
        ]::text[]
      ),
      ('audit.view', array['enterprise.view']::text[]),
      ('redemptions.view', array[]::text[]),
      ('redemptions.customer_data.view', array['redemptions.view']::text[]),
      (
        'redemptions.checkout',
        array['redemptions.view', 'redemptions.customer_data.view']::text[]
      ),
      (
        'redemptions.recharge',
        array['redemptions.view', 'redemptions.customer_data.view']::text[]
      ),
      (
        'redemptions.recharge.cancel',
        array[
          'redemptions.view',
          'redemptions.customer_data.view',
          'redemptions.recharge'
        ]::text[]
      ),
      ('redemptions.catalog.manage', array['redemptions.view']::text[]),
      ('redemptions.print', array['redemptions.view']::text[]),
      ('bookings.view', array[]::text[]),
      ('bookings.customer_data.view', array['bookings.view']::text[]),
      (
        'bookings.update',
        array['bookings.view', 'bookings.customer_data.view']::text[]
      ),
      ('bookings.status.manage', array['bookings.view']::text[]),
      (
        'bookings.email.send',
        array['bookings.view', 'bookings.customer_data.view']::text[]
      ),
      ('bookings.analytics.view', array['bookings.view']::text[]),
      ('bookings.export', array['bookings.view']::text[]),
      ('bookings.settings.manage', array['bookings.view']::text[]),
      ('bookings.automation.manage', array['bookings.view']::text[]),
      ('bookings.calendar.manage', array['bookings.view']::text[]),
      ('orders.view', array[]::text[]),
      ('orders.customer_data.view', array['orders.view']::text[]),
      ('orders.status.manage', array['orders.view']::text[]),
      ('orders.complete', array['orders.view']::text[]),
      ('orders.items.update', array['orders.view']::text[]),
      ('orders.print', array['orders.view']::text[]),
      ('orders.analytics.view', array['orders.view']::text[]),
      ('orders.export', array['orders.view']::text[]),
      (
        'orders.export.customer_data',
        array['orders.view', 'orders.customer_data.view', 'orders.export']::text[]
      ),
      ('orders.catalog.view', array['orders.view']::text[]),
      (
        'orders.catalog.manage',
        array['orders.view', 'orders.catalog.view']::text[]
      ),
      ('conversations.view', array[]::text[]),
      ('conversations.search', array['conversations.view']::text[]),
      (
        'conversations.start',
        array['conversations.view', 'conversations.search']::text[]
      ),
      ('conversations.send', array['conversations.view']::text[]),
      ('members.view', array[]::text[]),
      ('members.customer_data.view', array['members.view']::text[]),
      ('members.account.view', array['members.view']::text[]),
      (
        'members.account.adjust',
        array['members.view', 'members.account.view']::text[]
      ),
      (
        'members.allergens.manage',
        array['members.view', 'members.customer_data.view']::text[]
      ),
      ('members.insights.view', array['members.view']::text[]),
      ('members.settings.manage', array['members.view']::text[])
  ),
  requested_permissions(permission) as (
    select item.permission
      from unnest(coalesce(p_permissions, '{}'::text[])) as item(permission)
  )
  select
    p_permissions is not null
    and cardinality(p_permissions) = (
      select count(distinct requested.permission)::integer
        from requested_permissions as requested
    )
    and not exists (
      select 1
        from requested_permissions as requested
        left join permission_catalog as catalog
          on catalog.permission = requested.permission
       where catalog.permission is null
    )
    and not exists (
      select 1
        from permission_catalog as catalog
       where catalog.permission = any(p_permissions)
         and not (catalog.dependencies <@ p_permissions)
    );
$$;

alter table public.merchant_enterprise_roles
  add constraint merchant_enterprise_roles_permissions_check_041
  check (
    permissions <@ array[
      'enterprise.view',
      'tasks.view',
      'tasks.create',
      'tasks.update',
      'tasks.assign',
      'tasks.archive',
      'orders.linked.view',
      'boards.manage',
      'employees.view',
      'employees.manage',
      'roles.view',
      'roles.manage',
      'workflows.view',
      'workflows.manage',
      'workflows.publish',
      'automations.view',
      'automations.manage',
      'audit.view',
      'redemptions.view',
      'redemptions.customer_data.view',
      'redemptions.checkout',
      'redemptions.recharge',
      'redemptions.recharge.cancel',
      'redemptions.catalog.manage',
      'redemptions.print',
      'bookings.view',
      'bookings.customer_data.view',
      'bookings.update',
      'bookings.status.manage',
      'bookings.email.send',
      'bookings.analytics.view',
      'bookings.export',
      'bookings.settings.manage',
      'bookings.automation.manage',
      'bookings.calendar.manage',
      'orders.view',
      'orders.customer_data.view',
      'orders.status.manage',
      'orders.complete',
      'orders.items.update',
      'orders.print',
      'orders.analytics.view',
      'orders.export',
      'orders.export.customer_data',
      'orders.catalog.view',
      'orders.catalog.manage',
      'conversations.view',
      'conversations.search',
      'conversations.start',
      'conversations.send',
      'members.view',
      'members.customer_data.view',
      'members.account.view',
      'members.account.adjust',
      'members.allergens.manage',
      'members.insights.view',
      'members.settings.manage'
    ]::text[]
    and public.faolla_valid_merchant_enterprise_permissions_v1(permissions)
  ) not valid;

alter table public.merchant_enterprise_roles
  validate constraint merchant_enterprise_roles_permissions_check_041;
alter table public.merchant_enterprise_roles
  drop constraint merchant_enterprise_roles_permissions_check;
alter table public.merchant_enterprise_roles
  rename constraint merchant_enterprise_roles_permissions_check_041
  to merchant_enterprise_roles_permissions_check;

create function public.faolla_role_has_staff_business_permissions_v1(
  p_permissions text[]
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select coalesce(
    p_permissions && array[
      'redemptions.view',
      'redemptions.customer_data.view',
      'redemptions.checkout',
      'redemptions.recharge',
      'redemptions.recharge.cancel',
      'redemptions.catalog.manage',
      'redemptions.print',
      'bookings.view',
      'bookings.customer_data.view',
      'bookings.update',
      'bookings.status.manage',
      'bookings.email.send',
      'bookings.analytics.view',
      'bookings.export',
      'bookings.settings.manage',
      'bookings.automation.manage',
      'bookings.calendar.manage',
      'orders.view',
      'orders.customer_data.view',
      'orders.status.manage',
      'orders.complete',
      'orders.items.update',
      'orders.print',
      'orders.analytics.view',
      'orders.export',
      'orders.export.customer_data',
      'orders.catalog.view',
      'orders.catalog.manage',
      'conversations.view',
      'conversations.search',
      'conversations.start',
      'conversations.send',
      'members.view',
      'members.customer_data.view',
      'members.account.view',
      'members.account.adjust',
      'members.allergens.manage',
      'members.insights.view',
      'members.settings.manage'
    ]::text[],
    false
  );
$$;

create function public.faolla_assert_staff_business_role_owner_v1(
  p_site_id text,
  p_actor_id_text text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid;
  v_owner_ids uuid[];
begin
  if p_site_id is null
     or p_site_id !~ '^[0-9]{8}$'
     or p_actor_id_text is null
     or p_actor_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'permission_escalation_denied';
  end if;
  v_actor_id := p_actor_id_text::uuid;

  -- Keep the authoritative Auth principal alive through the business write.
  -- This row lock is deliberately taken before the merchant row lock, matching
  -- the ordinary-account binding lock order and avoiding an Auth/merchant
  -- inversion with the Auth DELETE guard.
  perform 1
    from auth.users as auth_user
   where auth_user.id = v_actor_id
   for key share;
  if not found then
    raise exception 'permission_escalation_denied';
  end if;

  select array[
           merchant.user_id,
           merchant.auth_user_id,
           merchant.owner_user_id,
           merchant.owner_id,
           merchant.auth_id,
           merchant.created_by,
           merchant.created_by_user_id
         ]::uuid[]
    into v_owner_ids
    from public.merchants as merchant
   where merchant.id = p_site_id
   for share;

  if not found
     or cardinality(array_remove(v_owner_ids, null::uuid)) <> 7
     or 1 <> (
       select count(distinct owner_id)
         from unnest(v_owner_ids) as owner(owner_id)
     )
     or v_actor_id is distinct from v_owner_ids[1] then
    raise exception 'permission_escalation_denied';
  end if;
end;
$$;

-- The context below is defense in depth, not a bearer capability: service_role
-- loses table DML and cannot execute v1, preaudit, or the renamed v2 cores.
-- The service-callable v2 compatibility wrappers reject every business role;
-- only v3 and the independently owner-authorized workflow grant can mark a
-- business write, and each restores the transaction-local context.
create function public.faolla_guard_staff_business_role_owner_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_actor_type text := nullif(
    current_setting('faolla.staff_business_role_internal_actor_type', true),
    ''
  );
begin
  if tg_op = 'INSERT'
     and public.faolla_role_has_staff_business_permissions_v1(new.permissions)
     and v_actor_type is distinct from 'owner' then
    raise exception 'permission_escalation_denied';
  end if;
  if tg_op = 'UPDATE'
     and (
       public.faolla_role_has_staff_business_permissions_v1(old.permissions)
       or public.faolla_role_has_staff_business_permissions_v1(new.permissions)
     )
     and v_actor_type is distinct from 'owner' then
    raise exception 'permission_escalation_denied';
  end if;
  if tg_op = 'DELETE'
     and public.faolla_role_has_staff_business_permissions_v1(old.permissions)
     and v_actor_type is distinct from 'owner' then
    raise exception 'permission_escalation_denied';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger merchant_enterprise_roles_staff_business_owner_guard
before insert or update or delete on public.merchant_enterprise_roles
for each row execute function public.faolla_guard_staff_business_role_owner_v1();

-- Preserve rollback compatibility for old applications: move the audited,
-- actor-aware v2 implementations behind owner-only core names, then recreate
-- service-callable v2 wrappers that categorically reject current or next
-- business permissions under the same merchant advisory lock.
alter function public.faolla_create_merchant_enterprise_role_v2(jsonb)
  rename to faolla_create_merchant_enterprise_role_v2_core_041;
alter function public.faolla_update_merchant_enterprise_role_v2(jsonb)
  rename to faolla_update_merchant_enterprise_role_v2_core_041;

create function public.faolla_create_merchant_enterprise_role_v2(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_site_id text;
  v_requested_permissions text[] := '{}'::text[];
begin
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  if p_input is null
     or jsonb_typeof(p_input) <> 'object'
     or v_site_id is null
     or v_site_id !~ '^[0-9]{8}$' then
    raise exception 'invalid_role';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('faolla:enterprise:role:' || v_site_id, 0)
  );
  if jsonb_typeof(p_input -> 'permissions') = 'array' then
    select coalesce(array_agg(item.value #>> '{}'), '{}'::text[])
      into v_requested_permissions
      from jsonb_array_elements(p_input -> 'permissions') as item(value)
     where jsonb_typeof(item.value) = 'string';
  end if;
  if public.faolla_role_has_staff_business_permissions_v1(
    v_requested_permissions
  ) then
    raise exception 'permission_escalation_denied';
  end if;
  return public.faolla_create_merchant_enterprise_role_v2_core_041(p_input);
end;
$$;

create function public.faolla_update_merchant_enterprise_role_v2(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_site_id text;
  v_role_id_text text;
  v_role_id uuid;
  v_current_permissions text[] := '{}'::text[];
  v_next_permissions text[] := '{}'::text[];
begin
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_role_id_text := nullif(btrim(p_input ->> 'role_id'), '');
  if p_input is null
     or jsonb_typeof(p_input) <> 'object'
     or v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or v_role_id_text is null
     or v_role_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_role_update';
  end if;
  v_role_id := v_role_id_text::uuid;
  perform pg_advisory_xact_lock(
    hashtextextended('faolla:enterprise:role:' || v_site_id, 0)
  );
  select role_row.permissions
    into v_current_permissions
    from public.merchant_enterprise_roles as role_row
   where role_row.merchant_id = v_site_id
     and role_row.id = v_role_id;
  if jsonb_typeof(p_input -> 'permissions') = 'array' then
    select coalesce(array_agg(item.value #>> '{}'), '{}'::text[])
      into v_next_permissions
      from jsonb_array_elements(p_input -> 'permissions') as item(value)
     where jsonb_typeof(item.value) = 'string';
  end if;
  if public.faolla_role_has_staff_business_permissions_v1(
       v_current_permissions
     )
     or public.faolla_role_has_staff_business_permissions_v1(
       v_next_permissions
     ) then
    raise exception 'permission_escalation_denied';
  end if;
  return public.faolla_update_merchant_enterprise_role_v2_core_041(p_input);
end;
$$;

-- v3 is the only API-reachable business create/update path. It performs the
-- stronger business-owner checks before delegating to the owner-only v2 core,
-- which retains authoritative actor, scope, row-lock, audit, and CAS logic.
create function public.faolla_create_merchant_enterprise_role_v3(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_site_id text;
  v_actor_id_text text;
  v_actor_type text := case
    when p_input is not null and jsonb_typeof(p_input) = 'object'
      then nullif(p_input ->> 'actor_type', '')
    else null
  end;
  v_requested_permissions text[] := '{}'::text[];
  v_previous_actor_type text := current_setting(
    'faolla.staff_business_role_internal_actor_type',
    true
  );
  v_response jsonb;
begin
  if p_input is null
     or jsonb_typeof(p_input) <> 'object'
     or not (p_input ? 'actor_type')
     or jsonb_typeof(p_input -> 'actor_type') <> 'string'
     or v_actor_type is null
     or v_actor_type not in ('owner', 'employee') then
    raise exception 'invalid_role_actor';
  end if;

  if jsonb_typeof(p_input -> 'permissions') = 'array' then
    select coalesce(array_agg(item.value #>> '{}'), '{}'::text[])
      into v_requested_permissions
      from jsonb_array_elements(p_input -> 'permissions') as item(value)
     where jsonb_typeof(item.value) = 'string';
    if public.faolla_role_has_staff_business_permissions_v1(
      v_requested_permissions
    ) then
      if v_actor_type <> 'owner' then
        raise exception 'permission_escalation_denied';
      end if;
      v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
      v_actor_id_text := nullif(btrim(p_input ->> 'actor_id'), '');
      if v_site_id is null or v_site_id !~ '^[0-9]{8}$' then
        raise exception 'invalid_role';
      end if;
      perform pg_advisory_xact_lock(
        hashtextextended('faolla:enterprise:role:' || v_site_id, 0)
      );
      perform public.faolla_assert_staff_business_role_owner_v1(
        v_site_id,
        v_actor_id_text
      );
    end if;
  end if;

  perform set_config(
    'faolla.staff_business_role_internal_actor_type',
    v_actor_type,
    true
  );
  begin
    v_response := public.faolla_create_merchant_enterprise_role_v2_core_041(p_input);
  exception when others then
    perform set_config(
      'faolla.staff_business_role_internal_actor_type',
      coalesce(v_previous_actor_type, ''),
      true
    );
    raise;
  end;
  perform set_config(
    'faolla.staff_business_role_internal_actor_type',
    coalesce(v_previous_actor_type, ''),
    true
  );
  return v_response;
end;
$$;

create function public.faolla_update_merchant_enterprise_role_v3(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_site_id text;
  v_role_id_text text;
  v_role_id uuid;
  v_actor_id_text text;
  v_actor_type text := case
    when p_input is not null and jsonb_typeof(p_input) = 'object'
      then nullif(p_input ->> 'actor_type', '')
    else null
  end;
  v_current_permissions text[] := '{}'::text[];
  v_next_permissions text[] := '{}'::text[];
  v_previous_actor_type text := current_setting(
    'faolla.staff_business_role_internal_actor_type',
    true
  );
  v_response jsonb;
begin
  if p_input is null
     or jsonb_typeof(p_input) <> 'object'
     or not (p_input ? 'actor_type')
     or jsonb_typeof(p_input -> 'actor_type') <> 'string'
     or v_actor_type is null
     or v_actor_type not in ('owner', 'employee') then
    raise exception 'invalid_role_actor';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_role_id_text := nullif(btrim(p_input ->> 'role_id'), '');
  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or v_role_id_text is null
     or v_role_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_role_update';
  end if;
  v_role_id := v_role_id_text::uuid;

  -- This is the same merchant-scoped serialization point used by v2. Holding
  -- it while reading the current permissions closes the current/next race;
  -- v2 reacquires it reentrantly and then follows its established row order.
  perform pg_advisory_xact_lock(
    hashtextextended('faolla:enterprise:role:' || v_site_id, 0)
  );

  select role_row.permissions
    into v_current_permissions
    from public.merchant_enterprise_roles as role_row
   where role_row.merchant_id = v_site_id
     and role_row.id = v_role_id;

  -- Omitted or malformed permissions are not a downgrade: preserve current
  -- for the authorization decision and let the core reject malformed input.
  v_next_permissions := v_current_permissions;
  if jsonb_typeof(p_input -> 'permissions') = 'array' then
    select coalesce(array_agg(item.value #>> '{}'), '{}'::text[])
      into v_next_permissions
      from jsonb_array_elements(p_input -> 'permissions') as item(value)
     where jsonb_typeof(item.value) = 'string';
  end if;

  if public.faolla_role_has_staff_business_permissions_v1(
       v_next_permissions
     ) then
    if v_actor_type <> 'owner' then
      raise exception 'permission_escalation_denied';
    end if;
    v_actor_id_text := nullif(btrim(p_input ->> 'actor_id'), '');
    perform public.faolla_assert_staff_business_role_owner_v1(
      v_site_id,
      v_actor_id_text
    );
  elsif public.faolla_role_has_staff_business_permissions_v1(
    v_current_permissions
  ) then
    -- Employees cannot remove owner-managed capabilities. A legacy-valid owner
    -- may only make an exact, permissions-only monotonic strip while aliases
    -- drift: no metadata, lifecycle, access-scope, or board mutation may ride
    -- along with the emergency downgrade.
    if v_actor_type <> 'owner'
       or exists (
         select 1
           from jsonb_object_keys(p_input) as input_key(key_name)
          where not (
            input_key.key_name = any(array[
              'merchant_id', 'role_id', 'expected_version',
              'actor_type', 'actor_id', 'permissions'
            ]::text[])
          )
       )
       or not (
         p_input ?& array[
           'merchant_id', 'role_id', 'expected_version',
           'actor_type', 'actor_id', 'permissions'
         ]::text[]
       )
       or exists (
         select 1
           from unnest(v_next_permissions) as next_permission(permission)
          where not (
            next_permission.permission = any(v_current_permissions)
          )
       ) then
      raise exception 'permission_escalation_denied';
    end if;
  end if;

  perform set_config(
    'faolla.staff_business_role_internal_actor_type',
    v_actor_type,
    true
  );
  begin
    v_response := public.faolla_update_merchant_enterprise_role_v2_core_041(p_input);
  exception when others then
    perform set_config(
      'faolla.staff_business_role_internal_actor_type',
      coalesce(v_previous_actor_type, ''),
      true
    );
    raise;
  end;
  perform set_config(
    'faolla.staff_business_role_internal_actor_type',
    coalesce(v_previous_actor_type, ''),
    true
  );
  return v_response;
end;
$$;

-- Preserve the existing owner-only workflow permission grant for ordinary
-- collaboration roles. Business-bearing roles are unconditionally routed to
-- the role editor so this legacy additive RPC cannot retain capabilities while
-- rollout is disabled or aliases are changing.
create or replace function public.faolla_grant_merchant_enterprise_role_workflow_permissions_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_site_id text;
  v_role_id_text text;
  v_role_id uuid;
  v_expected_version bigint;
  v_operation_id text;
  v_idempotency_key text;
  v_claim jsonb;
  v_auth jsonb;
  v_role public.merchant_enterprise_roles%rowtype;
  v_requested text[];
  v_added text[];
  v_next_permissions text[];
  v_response jsonb;
begin
  if not public.faolla_merchant_workflow_object_has_only_keys_v1(
    p_input,
    array[
      'merchant_id', 'actor_type', 'actor_id', 'role_id',
      'expected_version', 'workflow_permissions', 'operation_id'
    ]::text[]
  ) then
    raise exception 'invalid_workflow_permission_grant';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_role_id_text := nullif(btrim(p_input ->> 'role_id'), '');
  v_operation_id := nullif(btrim(p_input ->> 'operation_id'), '');
  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or coalesce(jsonb_typeof(p_input -> 'role_id'), '') <> 'string'
     or v_role_id_text is null
     or v_role_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(jsonb_typeof(p_input -> 'expected_version'), '') <> 'number'
     or (p_input ->> 'expected_version') !~ '^[1-9][0-9]*$'
     or coalesce(jsonb_typeof(p_input -> 'workflow_permissions'), '') <> 'array'
     or coalesce(jsonb_typeof(p_input -> 'operation_id'), '') <> 'string'
     or v_operation_id is null
     or char_length(v_operation_id) > 120 then
    raise exception 'invalid_workflow_permission_grant';
  end if;
  if jsonb_array_length(p_input -> 'workflow_permissions') not between 1 and 3 then
    raise exception 'invalid_workflow_permission_grant';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_input -> 'workflow_permissions') as requested(value)
     where jsonb_typeof(requested.value) <> 'string'
        or requested.value #>> '{}' not in (
          'workflows.view', 'workflows.manage', 'workflows.publish'
        )
  ) then
    raise exception 'invalid_workflow_permission_grant';
  end if;
  select coalesce(array_agg(distinct permission order by permission), '{}'::text[])
    into v_requested
    from jsonb_array_elements_text(p_input -> 'workflow_permissions')
      as requested(permission);
  if cardinality(v_requested) <> jsonb_array_length(p_input -> 'workflow_permissions') then
    raise exception 'invalid_workflow_permission_grant';
  end if;
  v_role_id := v_role_id_text::uuid;
  begin
    v_expected_version := (p_input ->> 'expected_version')::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_workflow_permission_grant';
  end;

  v_auth := public.faolla_authorize_merchant_enterprise_workflow_actor_v1(
    p_input,
    array['enterprise.view']::text[]
  );
  if v_auth ->> 'actor_type' <> 'owner' then
    raise exception 'permission_denied';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('faolla:enterprise:role:' || v_site_id, 0)
  );

  v_idempotency_key := 'enterprise-workflow-permission-grant-v1:' || v_operation_id;
  v_claim := public.faolla_claim_enterprise_structure_operation_v1(
    v_site_id,
    v_idempotency_key,
    'enterprise_workflow_permission_grant_v1',
    md5(p_input::text)
  );
  if not coalesce((v_claim ->> 'claimed')::boolean, false) then
    return v_claim -> 'response';
  end if;

  select * into v_role
    from public.merchant_enterprise_roles as role_row
   where role_row.merchant_id = v_site_id
     and role_row.id = v_role_id
     and role_row.status = 'active'
   for update;
  if not found then
    raise exception 'role_not_found';
  end if;
  if v_role.version <> v_expected_version then
    raise exception 'enterprise_version_conflict';
  end if;
  if public.faolla_role_has_staff_business_permissions_v1(
    v_role.permissions
  ) then
    raise exception 'business_role_workflow_grant_requires_role_editor';
  end if;

  select array_agg(distinct permission order by permission)
    into v_next_permissions
    from unnest(v_role.permissions || v_requested) as permission;
  if not public.faolla_valid_merchant_enterprise_permissions_v1(v_next_permissions) then
    raise exception 'invalid_permission_dependencies';
  end if;
  select coalesce(array_agg(permission order by permission), '{}'::text[])
    into v_added
    from unnest(v_requested) as permission
   where not (permission = any(v_role.permissions));

  if cardinality(v_added) > 0 then
    perform public.faolla_set_merchant_enterprise_audit_context_v1(
      p_input, 'role.grant_workflow_permissions', 'input'
    );
    update public.merchant_enterprise_roles
       set permissions = v_next_permissions,
           updated_at = updated_at
     where merchant_id = v_site_id
       and id = v_role_id
       and version = v_expected_version
    returning * into v_role;
    if not found then
      raise exception 'enterprise_version_conflict';
    end if;
  end if;

  v_response := jsonb_build_object(
    'merchantId', v_site_id,
    'role', jsonb_build_object(
      'id', v_role.id,
      'name', v_role.name,
      'status', v_role.status,
      'is_system', v_role.is_system,
      'version', v_role.version,
      'permissions', to_jsonb(v_role.permissions)
    ),
    'added_permissions', to_jsonb(v_added)
  );
  return public.faolla_complete_enterprise_structure_operation_v1(
    v_site_id, v_idempotency_key, v_response
  );
end;
$$;

-- Pin every role-write layer to the trusted migration owner. v1, preaudit, and
-- the renamed v2 cores are owner-only; the service-callable public v2 wrappers
-- remain rollback-compatible for ordinary collaboration roles only.
alter function public.faolla_create_merchant_enterprise_role_v1(jsonb)
  owner to supabase_admin;
alter function public.faolla_update_merchant_enterprise_role_v1(jsonb)
  owner to supabase_admin;
alter function public.faolla_create_merchant_enterprise_role_v2(jsonb)
  owner to supabase_admin;
alter function public.faolla_update_merchant_enterprise_role_v2(jsonb)
  owner to supabase_admin;
alter function public.faolla_create_merchant_enterprise_role_v2_core_041(jsonb)
  owner to supabase_admin;
alter function public.faolla_update_merchant_enterprise_role_v2_core_041(jsonb)
  owner to supabase_admin;
alter function public.faolla_create_merchant_enterprise_role_v1_preaudit_019(jsonb)
  owner to supabase_admin;
alter function public.faolla_update_merchant_enterprise_role_v1_preaudit_019(jsonb)
  owner to supabase_admin;
alter function public.faolla_create_merchant_enterprise_role_v2_preaudit_019(jsonb)
  owner to supabase_admin;
alter function public.faolla_update_merchant_enterprise_role_v2_preaudit_019(jsonb)
  owner to supabase_admin;
alter function public.faolla_grant_merchant_enterprise_role_workflow_permissions_v1(jsonb)
  owner to supabase_admin;
alter function public.faolla_valid_merchant_enterprise_permissions_v1(text[])
  owner to supabase_admin;
alter function public.faolla_role_has_staff_business_permissions_v1(text[])
  owner to supabase_admin;
alter function public.faolla_assert_staff_business_role_owner_v1(text, text)
  owner to supabase_admin;
alter function public.faolla_guard_staff_business_role_owner_v1()
  owner to supabase_admin;
alter function public.faolla_create_merchant_enterprise_role_v3(jsonb)
  owner to supabase_admin;
alter function public.faolla_update_merchant_enterprise_role_v3(jsonb)
  owner to supabase_admin;

alter function public.faolla_create_merchant_enterprise_role_v1(jsonb)
  set search_path to pg_catalog, public;
alter function public.faolla_update_merchant_enterprise_role_v1(jsonb)
  set search_path to pg_catalog, public;
alter function public.faolla_create_merchant_enterprise_role_v2(jsonb)
  set search_path to pg_catalog, public;
alter function public.faolla_update_merchant_enterprise_role_v2(jsonb)
  set search_path to pg_catalog, public;
alter function public.faolla_create_merchant_enterprise_role_v2_core_041(jsonb)
  set search_path to pg_catalog, public;
alter function public.faolla_update_merchant_enterprise_role_v2_core_041(jsonb)
  set search_path to pg_catalog, public;
alter function public.faolla_create_merchant_enterprise_role_v1_preaudit_019(jsonb)
  set search_path to pg_catalog, public;
alter function public.faolla_update_merchant_enterprise_role_v1_preaudit_019(jsonb)
  set search_path to pg_catalog, public;
alter function public.faolla_create_merchant_enterprise_role_v2_preaudit_019(jsonb)
  set search_path to pg_catalog, public;
alter function public.faolla_update_merchant_enterprise_role_v2_preaudit_019(jsonb)
  set search_path to pg_catalog, public;
alter function public.faolla_grant_merchant_enterprise_role_workflow_permissions_v1(jsonb)
  set search_path to pg_catalog, public;
alter function public.faolla_valid_merchant_enterprise_permissions_v1(text[])
  set search_path to pg_catalog, public;
alter function public.faolla_role_has_staff_business_permissions_v1(text[])
  set search_path to pg_catalog, public;
alter function public.faolla_assert_staff_business_role_owner_v1(text, text)
  set search_path to pg_catalog, public;
alter function public.faolla_guard_staff_business_role_owner_v1()
  set search_path to pg_catalog, public;
alter function public.faolla_create_merchant_enterprise_role_v3(jsonb)
  set search_path to pg_catalog, public;
alter function public.faolla_update_merchant_enterprise_role_v3(jsonb)
  set search_path to pg_catalog, public;

do $role_table_acl$
declare
  v_grantee record;
  v_grantee_sql text;
  v_column record;
begin
  for v_grantee in
    select distinct acl.grantee, role_metadata.rolname
      from pg_catalog.pg_class as relation
      cross join lateral pg_catalog.aclexplode(
        coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
      ) as acl
      left join pg_catalog.pg_roles as role_metadata
        on role_metadata.oid = acl.grantee
     where relation.oid = 'public.merchant_enterprise_roles'::pg_catalog.regclass
  loop
    if v_grantee.grantee <> 0 and v_grantee.rolname is null then
      raise exception 'merchant_staff_business_permissions_acl_grantee_missing';
    end if;
    v_grantee_sql := case
      when v_grantee.grantee = 0 then 'public'
      else pg_catalog.format('%I', v_grantee.rolname)
    end;
    execute pg_catalog.format(
      'revoke all privileges on table public.merchant_enterprise_roles from %s cascade',
      v_grantee_sql
    );
  end loop;

  for v_column in
    select attribute.attname, attribute.attacl
      from pg_catalog.pg_attribute as attribute
     where attribute.attrelid = 'public.merchant_enterprise_roles'::pg_catalog.regclass
       and attribute.attnum > 0
       and not attribute.attisdropped
  loop
    for v_grantee in
      select distinct acl.grantee, role_metadata.rolname
        from pg_catalog.aclexplode(v_column.attacl) as acl
        left join pg_catalog.pg_roles as role_metadata
          on role_metadata.oid = acl.grantee
       where true
    loop
      if v_grantee.grantee <> 0 and v_grantee.rolname is null then
        raise exception 'merchant_staff_business_permissions_acl_grantee_missing';
      end if;
      v_grantee_sql := case
        when v_grantee.grantee = 0 then 'public'
        else pg_catalog.format('%I', v_grantee.rolname)
      end;
      execute pg_catalog.format(
        'revoke all privileges (%I) on table public.merchant_enterprise_roles from %s cascade',
        v_column.attname,
        v_grantee_sql
      );
    end loop;
  end loop;
end;
$role_table_acl$;

grant all privileges on table public.merchant_enterprise_roles
  to supabase_admin;
grant select on table public.merchant_enterprise_roles to service_role;

do $function_acl$
declare
  v_function record;
  v_grantee record;
  v_grantee_sql text;
begin
  for v_function in
    select procedure_row.oid,
           procedure_row.oid::pg_catalog.regprocedure as signature,
           procedure_row.proowner
      from pg_catalog.pg_proc as procedure_row
     where procedure_row.oid = any(array[
       'public.faolla_create_merchant_enterprise_role_v1(jsonb)'::pg_catalog.regprocedure::pg_catalog.oid,
       'public.faolla_update_merchant_enterprise_role_v1(jsonb)'::pg_catalog.regprocedure::pg_catalog.oid,
       'public.faolla_create_merchant_enterprise_role_v2(jsonb)'::pg_catalog.regprocedure::pg_catalog.oid,
       'public.faolla_update_merchant_enterprise_role_v2(jsonb)'::pg_catalog.regprocedure::pg_catalog.oid,
       'public.faolla_create_merchant_enterprise_role_v2_core_041(jsonb)'::pg_catalog.regprocedure::pg_catalog.oid,
       'public.faolla_update_merchant_enterprise_role_v2_core_041(jsonb)'::pg_catalog.regprocedure::pg_catalog.oid,
       'public.faolla_create_merchant_enterprise_role_v1_preaudit_019(jsonb)'::pg_catalog.regprocedure::pg_catalog.oid,
       'public.faolla_update_merchant_enterprise_role_v1_preaudit_019(jsonb)'::pg_catalog.regprocedure::pg_catalog.oid,
       'public.faolla_create_merchant_enterprise_role_v2_preaudit_019(jsonb)'::pg_catalog.regprocedure::pg_catalog.oid,
       'public.faolla_update_merchant_enterprise_role_v2_preaudit_019(jsonb)'::pg_catalog.regprocedure::pg_catalog.oid,
       'public.faolla_grant_merchant_enterprise_role_workflow_permissions_v1(jsonb)'::pg_catalog.regprocedure::pg_catalog.oid,
       'public.faolla_valid_merchant_enterprise_permissions_v1(text[])'::pg_catalog.regprocedure::pg_catalog.oid,
       'public.faolla_role_has_staff_business_permissions_v1(text[])'::pg_catalog.regprocedure::pg_catalog.oid,
       'public.faolla_assert_staff_business_role_owner_v1(text,text)'::pg_catalog.regprocedure::pg_catalog.oid,
       'public.faolla_guard_staff_business_role_owner_v1()'::pg_catalog.regprocedure::pg_catalog.oid,
       'public.faolla_create_merchant_enterprise_role_v3(jsonb)'::pg_catalog.regprocedure::pg_catalog.oid,
       'public.faolla_update_merchant_enterprise_role_v3(jsonb)'::pg_catalog.regprocedure::pg_catalog.oid
     ])
  loop
    for v_grantee in
      select distinct acl.grantee, role_metadata.rolname
        from pg_catalog.pg_proc as procedure_row
        cross join lateral pg_catalog.aclexplode(
          coalesce(
            procedure_row.proacl,
            pg_catalog.acldefault('f', procedure_row.proowner)
          )
        ) as acl
        left join pg_catalog.pg_roles as role_metadata
          on role_metadata.oid = acl.grantee
       where procedure_row.oid = v_function.oid
    loop
      if v_grantee.grantee <> 0 and v_grantee.rolname is null then
        raise exception 'merchant_staff_business_permissions_acl_grantee_missing';
      end if;
      v_grantee_sql := case
        when v_grantee.grantee = 0 then 'public'
        else pg_catalog.format('%I', v_grantee.rolname)
      end;
      execute pg_catalog.format(
        'revoke all privileges on function %s from %s cascade',
        v_function.signature,
        v_grantee_sql
      );
    end loop;
    execute pg_catalog.format(
      'grant execute on function %s to supabase_admin',
      v_function.signature
    );
  end loop;
end;
$function_acl$;

grant execute on function public.faolla_create_merchant_enterprise_role_v3(jsonb)
  to service_role;
grant execute on function public.faolla_update_merchant_enterprise_role_v3(jsonb)
  to service_role;
grant execute on function public.faolla_create_merchant_enterprise_role_v2(jsonb)
  to service_role;
grant execute on function public.faolla_update_merchant_enterprise_role_v2(jsonb)
  to service_role;
grant execute on function public.faolla_grant_merchant_enterprise_role_workflow_permissions_v1(jsonb)
  to service_role;

do $postcondition$
declare
  v_owner oid := pg_catalog.to_regrole('supabase_admin');
  v_service oid := pg_catalog.to_regrole('service_role');
  v_owner_only_functions oid[];
  v_service_functions oid[];
  v_all_functions oid[];
begin
  v_owner_only_functions := array[
    'public.faolla_create_merchant_enterprise_role_v1(jsonb)'::pg_catalog.regprocedure::pg_catalog.oid,
    'public.faolla_update_merchant_enterprise_role_v1(jsonb)'::pg_catalog.regprocedure::pg_catalog.oid,
    'public.faolla_create_merchant_enterprise_role_v2_core_041(jsonb)'::pg_catalog.regprocedure::pg_catalog.oid,
    'public.faolla_update_merchant_enterprise_role_v2_core_041(jsonb)'::pg_catalog.regprocedure::pg_catalog.oid,
    'public.faolla_create_merchant_enterprise_role_v1_preaudit_019(jsonb)'::pg_catalog.regprocedure::pg_catalog.oid,
    'public.faolla_update_merchant_enterprise_role_v1_preaudit_019(jsonb)'::pg_catalog.regprocedure::pg_catalog.oid,
    'public.faolla_create_merchant_enterprise_role_v2_preaudit_019(jsonb)'::pg_catalog.regprocedure::pg_catalog.oid,
    'public.faolla_update_merchant_enterprise_role_v2_preaudit_019(jsonb)'::pg_catalog.regprocedure::pg_catalog.oid,
    'public.faolla_valid_merchant_enterprise_permissions_v1(text[])'::pg_catalog.regprocedure::pg_catalog.oid,
    'public.faolla_role_has_staff_business_permissions_v1(text[])'::pg_catalog.regprocedure::pg_catalog.oid,
    'public.faolla_assert_staff_business_role_owner_v1(text,text)'::pg_catalog.regprocedure::pg_catalog.oid,
    'public.faolla_guard_staff_business_role_owner_v1()'::pg_catalog.regprocedure::pg_catalog.oid
  ];
  v_service_functions := array[
    'public.faolla_create_merchant_enterprise_role_v2(jsonb)'::pg_catalog.regprocedure::pg_catalog.oid,
    'public.faolla_update_merchant_enterprise_role_v2(jsonb)'::pg_catalog.regprocedure::pg_catalog.oid,
    'public.faolla_create_merchant_enterprise_role_v3(jsonb)'::pg_catalog.regprocedure::pg_catalog.oid,
    'public.faolla_update_merchant_enterprise_role_v3(jsonb)'::pg_catalog.regprocedure::pg_catalog.oid,
    'public.faolla_grant_merchant_enterprise_role_workflow_permissions_v1(jsonb)'::pg_catalog.regprocedure::pg_catalog.oid
  ];
  v_all_functions := v_owner_only_functions || v_service_functions;

  if exists (
    select 1
      from public.merchant_enterprise_roles as role_row
     where not public.faolla_valid_merchant_enterprise_permissions_v1(
       role_row.permissions
     )
        or pg_catalog.cardinality(role_row.permissions) <> (
          select count(distinct permission)::integer
            from pg_catalog.unnest(role_row.permissions) as item(permission)
        )
  ) then
    raise exception 'merchant_staff_business_permissions_role_postcondition_failed';
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.merchant_enterprise_roles'::regclass
       and conname = 'merchant_enterprise_roles_permissions_check'
       and contype = 'c'
       and convalidated
  ) then
    raise exception 'merchant_staff_business_permissions_constraint_postcondition_failed';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_class as relation_metadata
     where relation_metadata.oid =
       'public.merchant_enterprise_roles'::pg_catalog.regclass
       and relation_metadata.relkind = 'r'
       and relation_metadata.relowner = v_owner
  ) then
    raise exception 'merchant_staff_business_permissions_role_owner_failed';
  end if;

  if exists (
    with relation_metadata as (
      select relation.relowner, relation.relacl
        from pg_catalog.pg_class as relation
       where relation.oid =
         'public.merchant_enterprise_roles'::pg_catalog.regclass
    ), actual(grantee, grantor, privilege_type, is_grantable) as (
      select acl.grantee, acl.grantor, acl.privilege_type,
             acl.is_grantable
        from relation_metadata
        cross join lateral pg_catalog.aclexplode(coalesce(
          relation_metadata.relacl,
          pg_catalog.acldefault('r', relation_metadata.relowner)
        )) as acl
    ), expected(grantee, grantor, privilege_type, is_grantable) as (
      select acl.grantee, acl.grantor, acl.privilege_type,
             acl.is_grantable
        from pg_catalog.aclexplode(
          pg_catalog.acldefault('r', v_owner)
        ) as acl
      union all
      select v_service, v_owner, 'SELECT'::text, false
    ), delta as (
      (select * from actual except all select * from expected)
      union all
      (select * from expected except all select * from actual)
    )
    select 1 from delta
  ) or exists (
    select 1
      from pg_catalog.pg_attribute as attribute
     where attribute.attrelid =
       'public.merchant_enterprise_roles'::pg_catalog.regclass
       and attribute.attnum > 0
       and not attribute.attisdropped
       and attribute.attacl is not null
  ) or not pg_catalog.has_table_privilege(
    'service_role', 'public.merchant_enterprise_roles', 'SELECT'
  ) or pg_catalog.has_table_privilege(
    'service_role', 'public.merchant_enterprise_roles', 'INSERT'
  ) or pg_catalog.has_table_privilege(
    'service_role', 'public.merchant_enterprise_roles', 'UPDATE'
  ) or pg_catalog.has_table_privilege(
    'service_role', 'public.merchant_enterprise_roles', 'DELETE'
  ) or pg_catalog.has_table_privilege(
    'service_role', 'public.merchant_enterprise_roles', 'TRUN' || 'CATE'
  ) or pg_catalog.has_table_privilege(
    'service_role', 'public.merchant_enterprise_roles', 'REFERENCES'
  ) or pg_catalog.has_table_privilege(
    'service_role', 'public.merchant_enterprise_roles', 'TRIGGER'
  ) then
    raise exception 'merchant_staff_business_permissions_role_acl_failed';
  end if;

  if exists (
    select 1
      from (values ('anon'), ('authenticated'), ('authenticator'))
        as subject(role_name)
      cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'))
        as privilege(privilege_name)
     where pg_catalog.has_table_privilege(
       subject.role_name,
       'public.merchant_enterprise_roles',
       privilege.privilege_name
     )
  ) or exists (
    select 1
      from (values ('anon'), ('authenticated'), ('authenticator'))
        as subject(role_name)
      cross join pg_catalog.unnest(v_service_functions)
        as exposed(function_oid)
     where pg_catalog.has_function_privilege(
       subject.role_name, exposed.function_oid, 'EXECUTE'
     )
  ) then
    raise exception
      'merchant_staff_business_permissions_effective_acl_failed';
  end if;

  if exists (
    with target(function_oid, service_exposed) as (
      select owner_target.function_oid, false
        from pg_catalog.unnest(v_owner_only_functions)
          as owner_target(function_oid)
      union all
      select service_target.function_oid, true
        from pg_catalog.unnest(v_service_functions)
          as service_target(function_oid)
    ), actual(
      function_oid, grantee, grantor, privilege_type, is_grantable
    ) as (
      select target.function_oid, acl.grantee, acl.grantor,
             acl.privilege_type, acl.is_grantable
        from target
        join pg_catalog.pg_proc as function_metadata
          on function_metadata.oid = target.function_oid
        cross join lateral pg_catalog.aclexplode(coalesce(
          function_metadata.proacl,
          pg_catalog.acldefault('f', function_metadata.proowner)
        )) as acl
    ), expected(
      function_oid, grantee, grantor, privilege_type, is_grantable
    ) as (
      select target.function_oid, v_owner, v_owner, 'EXECUTE'::text,
             false
        from target
      union all
      select target.function_oid, v_service, v_owner, 'EXECUTE'::text,
             false
        from target
       where target.service_exposed
    ), delta as (
      (select * from actual except all select * from expected)
      union all
      (select * from expected except all select * from actual)
    )
    select 1 from delta
  ) or exists (
    with target(function_oid, service_exposed) as (
      select owner_target.function_oid, false
        from pg_catalog.unnest(v_owner_only_functions)
          as owner_target(function_oid)
      union all
      select service_target.function_oid, true
        from pg_catalog.unnest(v_service_functions)
          as service_target(function_oid)
    )
    select 1
      from target
     where pg_catalog.has_function_privilege(
       'service_role', target.function_oid, 'EXECUTE'
     ) is distinct from target.service_exposed
  ) then
    raise exception 'merchant_staff_business_permissions_function_acl_failed';
  end if;

  if exists (
    select 1
      from (values
        ('public.faolla_create_merchant_enterprise_role_v1(jsonb)',
          'faolla_create_merchant_enterprise_role_v1',
          '4b9bffe16eda040e6ad647fca4dbc986', 'plpgsql', 'jsonb',
          true, 'v', array['p_input']::text[]),
        ('public.faolla_update_merchant_enterprise_role_v1(jsonb)',
          'faolla_update_merchant_enterprise_role_v1',
          '54e95a08a261f8f4ca6ec4afccde7fe1', 'plpgsql', 'jsonb',
          true, 'v', array['p_input']::text[]),
        ('public.faolla_create_merchant_enterprise_role_v2(jsonb)',
          'faolla_create_merchant_enterprise_role_v2',
          'd37ccaef7aec71e6c2bcf1d259cabf90', 'plpgsql', 'jsonb',
          true, 'v', array['p_input']::text[]),
        ('public.faolla_update_merchant_enterprise_role_v2(jsonb)',
          'faolla_update_merchant_enterprise_role_v2',
          '2dfd567036dfe654b3aa38129907f997', 'plpgsql', 'jsonb',
          true, 'v', array['p_input']::text[]),
        ('public.faolla_create_merchant_enterprise_role_v2_core_041(jsonb)',
          'faolla_create_merchant_enterprise_role_v2_core_041',
          '75c2019c420b36bc48e49b9f49d082a5', 'plpgsql', 'jsonb',
          true, 'v', array['p_input']::text[]),
        ('public.faolla_update_merchant_enterprise_role_v2_core_041(jsonb)',
          'faolla_update_merchant_enterprise_role_v2_core_041',
          '1a72c9c1dc484cf21e0cb9ed21e7e591', 'plpgsql', 'jsonb',
          true, 'v', array['p_input']::text[]),
        ('public.faolla_create_merchant_enterprise_role_v1_preaudit_019(jsonb)',
          'faolla_create_merchant_enterprise_role_v1_preaudit_019',
          'f924054f3d6d0583ca5ca5f6d3c37b8b', 'plpgsql', 'jsonb',
          true, 'v', array['p_input']::text[]),
        ('public.faolla_update_merchant_enterprise_role_v1_preaudit_019(jsonb)',
          'faolla_update_merchant_enterprise_role_v1_preaudit_019',
          'e6001f91ab4130c263792635af736d25', 'plpgsql', 'jsonb',
          true, 'v', array['p_input']::text[]),
        ('public.faolla_create_merchant_enterprise_role_v2_preaudit_019(jsonb)',
          'faolla_create_merchant_enterprise_role_v2_preaudit_019',
          'a8c1fba3d8afe5d38533cb86c4cfda84', 'plpgsql', 'jsonb',
          true, 'v', array['p_input']::text[]),
        ('public.faolla_update_merchant_enterprise_role_v2_preaudit_019(jsonb)',
          'faolla_update_merchant_enterprise_role_v2_preaudit_019',
          '10a9a8eb8ee9ebde36191561c1bd1e10', 'plpgsql', 'jsonb',
          true, 'v', array['p_input']::text[]),
        ('public.faolla_grant_merchant_enterprise_role_workflow_permissions_v1(jsonb)',
          'faolla_grant_merchant_enterprise_role_workflow_permissions_v1',
          '14b713d862fd2b06e285a26ce578c015', 'plpgsql', 'jsonb',
          true, 'v', array['p_input']::text[]),
        ('public.faolla_valid_merchant_enterprise_permissions_v1(text[])',
          'faolla_valid_merchant_enterprise_permissions_v1',
          'c133b94875756eaa6234a67d68ca499b', 'sql', 'boolean',
          false, 'i', array['p_permissions']::text[]),
        ('public.faolla_role_has_staff_business_permissions_v1(text[])',
          'faolla_role_has_staff_business_permissions_v1',
          'a75d1cab4a973b9be29e65acab1bcef3', 'sql', 'boolean',
          false, 'i', array['p_permissions']::text[]),
        ('public.faolla_assert_staff_business_role_owner_v1(text,text)',
          'faolla_assert_staff_business_role_owner_v1',
          '46ae08f3ace9dd9c66481b22cbb9cd29', 'plpgsql', 'void',
          true, 'v', array['p_site_id', 'p_actor_id_text']::text[]),
        ('public.faolla_guard_staff_business_role_owner_v1()',
          'faolla_guard_staff_business_role_owner_v1',
          '786970aff0029fbf37040c3204f5f372', 'plpgsql', 'trigger',
          false, 'v', null::text[]),
        ('public.faolla_create_merchant_enterprise_role_v3(jsonb)',
          'faolla_create_merchant_enterprise_role_v3',
          '56f713019517c756839995101df8fba7', 'plpgsql', 'jsonb',
          true, 'v', array['p_input']::text[]),
        ('public.faolla_update_merchant_enterprise_role_v3(jsonb)',
          'faolla_update_merchant_enterprise_role_v3',
          'e901660ad48de75ce70978cdff3540e7', 'plpgsql', 'jsonb',
          true, 'v', array['p_input']::text[])
      ) as expected(
        signature, function_name, source_md5, language_name, return_type,
        security_definer, volatility, argument_names
      )
      left join pg_catalog.pg_proc as function_metadata
        on function_metadata.oid = pg_catalog.to_regprocedure(
          expected.signature
        )
      left join pg_catalog.pg_language as language_metadata
        on language_metadata.oid = function_metadata.prolang
     where function_metadata.oid is null
        or function_metadata.pronamespace <>
          'public'::pg_catalog.regnamespace
        or function_metadata.proname <> expected.function_name
        or function_metadata.proowner <> v_owner
        or function_metadata.prokind <> 'f'
        or language_metadata.lanname <> expected.language_name
        or function_metadata.prorettype <>
          pg_catalog.to_regtype(expected.return_type)
        or function_metadata.proretset
        or function_metadata.prosecdef <> expected.security_definer
        or function_metadata.provolatile <> expected.volatility
        or function_metadata.proparallel <> 'u'
        or function_metadata.proconfig is distinct from
          array['search_path=pg_catalog, public']::text[]
        or function_metadata.proisstrict
        or function_metadata.proleakproof
        or function_metadata.pronargs <>
          coalesce(pg_catalog.cardinality(expected.argument_names), 0)
        or function_metadata.pronargdefaults <> 0
        or function_metadata.proargnames is distinct from
          expected.argument_names
        or function_metadata.proargmodes is not null
        or function_metadata.proallargtypes is not null
        or pg_catalog.md5(pg_catalog.replace(
          function_metadata.prosrc,
          E'\r\n',
          E'\n'
        )) <> expected.source_md5
        or 1 <> (
          select count(*)
            from pg_catalog.pg_proc as overload
           where overload.pronamespace =
             'public'::pg_catalog.regnamespace
             and overload.proname = expected.function_name
        )
  ) then
    raise exception
      'merchant_staff_business_permissions_function_definition_failed';
  end if;

  if 1 <> (
    select count(*)
      from pg_catalog.pg_trigger as trigger_metadata
     where trigger_metadata.tgrelid =
       'public.merchant_enterprise_roles'::pg_catalog.regclass
       and trigger_metadata.tgname =
         'merchant_enterprise_roles_staff_business_owner_guard'
       and trigger_metadata.tgfoid =
         'public.faolla_guard_staff_business_role_owner_v1()'::pg_catalog.regprocedure
       and trigger_metadata.tgtype = 31
       and trigger_metadata.tgenabled = 'O'
       and trigger_metadata.tgnargs = 0
       and trigger_metadata.tgattr = ''::pg_catalog.int2vector
       and trigger_metadata.tgqual is null
       and not trigger_metadata.tgisinternal
  ) then
    raise exception 'merchant_staff_business_permissions_guard_postcondition_failed';
  end if;
end;
$postcondition$;

insert into public.faolla_schema_migrations (version, name)
values (202608280041, 'merchant_staff_business_permissions')
on conflict (version) do nothing;

do $registry_postcondition$
begin
  if not exists (
    select 1
      from public.faolla_schema_migrations
     where version = 202608280041
       and name = 'merchant_staff_business_permissions'
  ) then
    raise exception 'merchant_staff_business_permissions_registry_postcondition_failed';
  end if;
end;
$registry_postcondition$;

notify pgrst, 'reload schema';

commit;
