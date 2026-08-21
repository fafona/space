-- Normalize the merchants table to the least-privilege hosted-platform,
-- browser, and service ACL required by the frozen ordinary-account object
-- contract. No table row, function body, policy, ownership, or relation shape
-- is changed.

begin;

set transaction isolation level read committed;
set local quote_all_identifiers = off;
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
    raise exception 'merchant_acl_contract_hardening_untrusted_migrator';
  end if;

  if to_regclass('public.faolla_schema_migrations') is null
     or to_regclass('public.merchants') is null
     or to_regrole('supabase_admin') is null
     or to_regrole('postgres') is null
     or to_regrole('anon') is null
     or to_regrole('authenticated') is null
     or to_regrole('service_role') is null
     or not exists (
       select 1
        from pg_catalog.pg_roles as postgres_role
       where postgres_role.rolname = 'postgres'
          and not postgres_role.rolsuper
          and postgres_role.rolinherit
          and postgres_role.rolcreatedb
          and postgres_role.rolcreaterole
          and postgres_role.rolcanlogin
          and postgres_role.rolreplication
          and postgres_role.rolbypassrls
     )
     or not exists (
       select 1
         from pg_catalog.pg_roles as authenticated_role
        where authenticated_role.rolname = 'authenticated'
          and not authenticated_role.rolsuper
          and not authenticated_role.rolbypassrls
     )
     or not exists (
       select 1
         from pg_catalog.pg_roles as anonymous_role
        where anonymous_role.rolname = 'anon'
          and not anonymous_role.rolsuper
          and not anonymous_role.rolbypassrls
     )
     or not exists (
       select 1
         from pg_catalog.pg_roles as service_role_metadata
        where service_role_metadata.rolname = 'service_role'
          and not service_role_metadata.rolsuper
          and service_role_metadata.rolbypassrls
     ) then
    raise exception 'merchant_acl_contract_hardening_prerequisite_missing';
  end if;
end;
$migrator_preflight$;

-- Use the same controlled deployment mutex as every production migration.
select pg_catalog.pg_advisory_xact_lock(20260731, 1);

-- Serialize every catalog surface participating in role identity, ownership,
-- direct table/column ACLs, policies, rules, and inheritance. These locks are
-- reader compatible and are acquired before the business relations.
lock table
  pg_catalog.pg_authid,
  pg_catalog.pg_namespace,
  pg_catalog.pg_class,
  pg_catalog.pg_attribute,
  pg_catalog.pg_policy,
  pg_catalog.pg_rewrite,
  pg_catalog.pg_inherits
in share row exclusive mode;

lock table
  public.faolla_schema_migrations,
  public.merchants
in share row exclusive mode;

-- This is the first catalog snapshot after every required lock. It accepts
-- only the observed hosted production ACL or the final target, so reruns are
-- safe while every unexpected or partially repaired state fails closed.
do $preflight$
declare
  v_registered boolean := false;
  v_object_contract_ready boolean := false;
  v_production_acl_ready boolean := false;
  v_target_acl_ready boolean := false;
begin
  if current_user <> 'supabase_admin'
     or not exists (
       select 1
         from pg_catalog.pg_roles as role_metadata
        where role_metadata.rolname = current_user
          and role_metadata.rolsuper
     ) then
    raise exception 'merchant_acl_contract_hardening_untrusted_migrator';
  end if;

  if exists (
    select 1
      from public.faolla_schema_migrations as migration
     where migration.version = 202608190040
       and migration.name <> 'merchant_acl_contract_hardening'
  ) then
    raise exception 'merchant_acl_contract_hardening_registry_conflict';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_roles as postgres_role
     where postgres_role.rolname = 'postgres'
       and not postgres_role.rolsuper
       and postgres_role.rolinherit
       and postgres_role.rolcreatedb
       and postgres_role.rolcreaterole
       and postgres_role.rolcanlogin
       and postgres_role.rolreplication
       and postgres_role.rolbypassrls
  )
     or exists (
       select 1
         from (values
           (202608190035::bigint,
            'ordinary_account_authorization_foundation'::text),
           (202608190036::bigint,
            'ordinary_account_authorization_bootstrap'::text),
           (202608190037::bigint,
            'ordinary_account_system_site_principal_isolation'::text),
           (202608190038::bigint,
            'ordinary_account_recovery_observer'::text),
           (202608190039::bigint,
            'runtime_rpc_execute_acl_hardening'::text)
         ) as required(version, name)
        where not exists (
          select 1
            from public.faolla_schema_migrations as applied
           where applied.version = required.version
             and applied.name = required.name
        )
     ) then
    raise exception 'merchant_acl_contract_hardening_prerequisite_missing';
  end if;

  if not coalesce((
    select registry.relkind = 'r'
       and registry.relpersistence = 'p'
       and registry.relnamespace = to_regnamespace('public')
       and registry.relowner = to_regrole('supabase_admin')
       and registry.relrowsecurity
       and not registry.relforcerowsecurity
       and not registry.relispartition
       and registry.relreplident = 'd'
       and not exists (
         select 1
           from pg_catalog.pg_trigger as trigger_metadata
          where trigger_metadata.tgrelid = registry.oid
            and not trigger_metadata.tgisinternal
       )
       and not exists (
         select 1
           from pg_catalog.pg_policy as policy_metadata
          where policy_metadata.polrelid = registry.oid
       )
       and not exists (
         select 1
           from pg_catalog.pg_rewrite as rule_metadata
          where rule_metadata.ev_class = registry.oid
       )
       and not exists (
         select 1
           from pg_catalog.pg_inherits as inheritance
          where inheritance.inhrelid = registry.oid
             or inheritance.inhparent = registry.oid
       )
      from pg_catalog.pg_class as registry
     where registry.oid = 'public.faolla_schema_migrations'::regclass
  ), false) then
    raise exception 'merchant_acl_contract_hardening_registry_invalid';
  end if;

  select exists (
    select 1
      from public.faolla_schema_migrations as migration
     where migration.version = 202608190040
       and migration.name = 'merchant_acl_contract_hardening'
  ) into v_registered;

  select coalesce((
    select merchant.relkind = 'r'
       and merchant.relpersistence = 'p'
       and merchant.relnamespace = to_regnamespace('public')
       and merchant.relowner = to_regrole('supabase_admin')
       and merchant.relrowsecurity
       and not merchant.relforcerowsecurity
       and not merchant.relispartition
       and merchant.relreplident = 'd'
       and 5 = (
         select count(*)
           from pg_catalog.pg_policy as policy
          where policy.polrelid = merchant.oid
       )
       and not exists (
         select 1
           from (values
             ('merchants_select_own', 'r', true,
              '42205aae07118e35699a5507ffe3385a', null::text),
             ('merchants_insert_self', 'a', true, null::text,
              '899af52ac5bbc8824aa635183199f48a'),
             ('merchants_update_own', 'w', true,
              '42205aae07118e35699a5507ffe3385a',
              '42205aae07118e35699a5507ffe3385a'),
             ('merchants_system_site_principal_isolation', 'w', false,
              '1c08e1341a191bbc45013950a337671d',
              '1c08e1341a191bbc45013950a337671d'),
             ('merchants_system_site_principal_insert_isolation', 'a', false,
              null::text, '1c08e1341a191bbc45013950a337671d')
           ) as expected(
             policy_name, command, permissive, qual_md5, check_md5
           )
          where not exists (
            select 1
              from pg_catalog.pg_policy as policy
             where policy.polrelid = merchant.oid
               and policy.polname = expected.policy_name
               and policy.polcmd::text = expected.command
               and policy.polpermissive = expected.permissive
               and policy.polroles =
                 array[to_regrole('authenticated')]::oid[]
               and pg_catalog.md5(pg_catalog.pg_get_expr(
                     policy.polqual, policy.polrelid, false
                   )) is not distinct from expected.qual_md5
               and pg_catalog.md5(pg_catalog.pg_get_expr(
                     policy.polwithcheck, policy.polrelid, false
                   )) is not distinct from expected.check_md5
          )
       )
       and not exists (
         select 1
           from pg_catalog.pg_attribute as attribute
          where attribute.attrelid = merchant.oid
            and attribute.attnum > 0
            and not attribute.attisdropped
            and attribute.attacl is not null
       )
       and not exists (
         select 1
           from pg_catalog.pg_inherits as inheritance
          where inheritance.inhrelid = merchant.oid
             or inheritance.inhparent = merchant.oid
       )
       and not exists (
         select 1
           from pg_catalog.pg_rewrite as rule_metadata
          where rule_metadata.ev_class = merchant.oid
       )
      from pg_catalog.pg_class as merchant
     where merchant.oid = 'public.merchants'::regclass
  ), false) into v_object_contract_ready;

  if not v_object_contract_ready then
    raise exception 'merchant_acl_contract_hardening_object_contract_invalid';
  end if;

  with merchant as materialized (
    select relation.oid, relation.relowner, relation.relacl
      from pg_catalog.pg_class as relation
     where relation.oid = 'public.merchants'::regclass
  ), actual_acl as materialized (
    select acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
      from merchant
      cross join lateral pg_catalog.aclexplode(coalesce(
        merchant.relacl,
        pg_catalog.acldefault('r', merchant.relowner)
      )) as acl
  ), owner_acl as materialized (
    select acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
      from merchant
      cross join lateral pg_catalog.aclexplode(
        pg_catalog.acldefault('r', merchant.relowner)
      ) as acl
  ), expected_production_acl as materialized (
    select owner_acl.grantor, owner_acl.grantee,
           owner_acl.privilege_type, owner_acl.is_grantable
      from owner_acl
    union all
    select merchant.relowner, to_regrole(grantee.role_name),
           owner_privilege.privilege_type, false
      from merchant
      cross join (values
        ('postgres'::text),
        ('anon'::text),
        ('authenticated'::text),
        ('service_role'::text)
      ) as grantee(role_name)
      cross join owner_acl as owner_privilege
  ), expected_target_acl as materialized (
    select owner_acl.grantor, owner_acl.grantee,
           owner_acl.privilege_type, owner_acl.is_grantable
      from owner_acl
    union all
    select merchant.relowner, to_regrole('postgres'),
           owner_acl.privilege_type, false
      from merchant
      cross join owner_acl
    union all
    select merchant.relowner, to_regrole('authenticated'),
           privilege.privilege_type, false
      from merchant
      cross join unnest(array['SELECT','INSERT','UPDATE']::text[])
        as privilege(privilege_type)
    union all
    select merchant.relowner, to_regrole('service_role'),
           privilege.privilege_type, false
      from merchant
      cross join unnest(
        array['SELECT','INSERT','UPDATE','DELETE']::text[]
      ) as privilege(privilege_type)
  )
  select
    (select count(*) = 35 from actual_acl)
    and not exists (
      (select * from actual_acl
       except all
       select * from expected_production_acl)
      union all
      (select * from expected_production_acl
       except all
       select * from actual_acl)
    ),
    (select count(*) = 21 from actual_acl)
    and not exists (
      (select * from actual_acl
       except all
       select * from expected_target_acl)
      union all
      (select * from expected_target_acl
       except all
       select * from actual_acl)
    )
    into v_production_acl_ready, v_target_acl_ready;

  if not v_production_acl_ready and not v_target_acl_ready then
    raise exception 'merchant_acl_contract_hardening_acl_prestate_invalid';
  end if;

  if v_registered and not v_target_acl_ready then
    raise exception 'merchant_acl_contract_hardening_registered_state_invalid';
  end if;
end;
$preflight$;

-- A registered replay is a true no-op. An unregistered target only registers;
-- the observed production state is the sole state allowed to reach mutation.
do $acl_mutation$
declare
  v_target_acl_ready boolean := false;
begin
  with merchant as materialized (
    select relation.relowner, relation.relacl
      from pg_catalog.pg_class as relation
     where relation.oid = 'public.merchants'::regclass
  ), actual_acl as materialized (
    select acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
      from merchant
      cross join lateral pg_catalog.aclexplode(coalesce(
        merchant.relacl,
        pg_catalog.acldefault('r', merchant.relowner)
      )) as acl
  ), owner_acl as materialized (
    select acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
      from merchant
      cross join lateral pg_catalog.aclexplode(
        pg_catalog.acldefault('r', merchant.relowner)
      ) as acl
  ), expected_target_acl as materialized (
    select owner_acl.grantor, owner_acl.grantee,
           owner_acl.privilege_type, owner_acl.is_grantable
      from owner_acl
    union all
    select merchant.relowner, to_regrole('postgres'),
           owner_acl.privilege_type, false
      from merchant
      cross join owner_acl
    union all
    select merchant.relowner, to_regrole('authenticated'),
           privilege.privilege_type, false
      from merchant
      cross join unnest(array['SELECT','INSERT','UPDATE']::text[])
        as privilege(privilege_type)
    union all
    select merchant.relowner, to_regrole('service_role'),
           privilege.privilege_type, false
      from merchant
      cross join unnest(
        array['SELECT','INSERT','UPDATE','DELETE']::text[]
      ) as privilege(privilege_type)
  )
  select (select count(*) = 21 from actual_acl)
     and not exists (
       (select * from actual_acl
        except all
        select * from expected_target_acl)
       union all
       (select * from expected_target_acl
        except all
        select * from actual_acl)
     )
    into v_target_acl_ready;

  if not v_target_acl_ready then
    execute 'revoke all privileges on table public.merchants from public, anon, authenticated, service_role';
    execute 'grant select, insert, update on table public.merchants to authenticated';
    execute 'grant select, insert, update, delete on table public.merchants to service_role';
  end if;
end;
$acl_mutation$;

-- Recheck the complete frozen object contract and exact 21-entry ACL before
-- the registry can claim success.
do $postcondition$
declare
  v_object_contract_ready boolean := false;
  v_target_acl_ready boolean := false;
begin
  select coalesce((
    select merchant.relkind = 'r'
       and merchant.relpersistence = 'p'
       and merchant.relnamespace = to_regnamespace('public')
       and merchant.relowner = to_regrole('supabase_admin')
       and merchant.relrowsecurity
       and not merchant.relforcerowsecurity
       and not merchant.relispartition
       and merchant.relreplident = 'd'
       and 5 = (
         select count(*)
           from pg_catalog.pg_policy as policy
          where policy.polrelid = merchant.oid
       )
       and not exists (
         select 1
           from (values
             ('merchants_select_own', 'r', true,
              '42205aae07118e35699a5507ffe3385a', null::text),
             ('merchants_insert_self', 'a', true, null::text,
              '899af52ac5bbc8824aa635183199f48a'),
             ('merchants_update_own', 'w', true,
              '42205aae07118e35699a5507ffe3385a',
              '42205aae07118e35699a5507ffe3385a'),
             ('merchants_system_site_principal_isolation', 'w', false,
              '1c08e1341a191bbc45013950a337671d',
              '1c08e1341a191bbc45013950a337671d'),
             ('merchants_system_site_principal_insert_isolation', 'a', false,
              null::text, '1c08e1341a191bbc45013950a337671d')
           ) as expected(
             policy_name, command, permissive, qual_md5, check_md5
           )
          where not exists (
            select 1
              from pg_catalog.pg_policy as policy
             where policy.polrelid = merchant.oid
               and policy.polname = expected.policy_name
               and policy.polcmd::text = expected.command
               and policy.polpermissive = expected.permissive
               and policy.polroles =
                 array[to_regrole('authenticated')]::oid[]
               and pg_catalog.md5(pg_catalog.pg_get_expr(
                     policy.polqual, policy.polrelid, false
                   )) is not distinct from expected.qual_md5
               and pg_catalog.md5(pg_catalog.pg_get_expr(
                     policy.polwithcheck, policy.polrelid, false
                   )) is not distinct from expected.check_md5
          )
       )
       and not exists (
         select 1
           from pg_catalog.pg_attribute as attribute
          where attribute.attrelid = merchant.oid
            and attribute.attnum > 0
            and not attribute.attisdropped
            and attribute.attacl is not null
       )
       and not exists (
         select 1
           from pg_catalog.pg_inherits as inheritance
          where inheritance.inhrelid = merchant.oid
             or inheritance.inhparent = merchant.oid
       )
       and not exists (
         select 1
           from pg_catalog.pg_rewrite as rule_metadata
          where rule_metadata.ev_class = merchant.oid
       )
      from pg_catalog.pg_class as merchant
     where merchant.oid = 'public.merchants'::regclass
  ), false) into v_object_contract_ready;

  with merchant as materialized (
    select relation.relowner, relation.relacl
      from pg_catalog.pg_class as relation
     where relation.oid = 'public.merchants'::regclass
  ), actual_acl as materialized (
    select acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
      from merchant
      cross join lateral pg_catalog.aclexplode(coalesce(
        merchant.relacl,
        pg_catalog.acldefault('r', merchant.relowner)
      )) as acl
  ), owner_acl as materialized (
    select acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
      from merchant
      cross join lateral pg_catalog.aclexplode(
        pg_catalog.acldefault('r', merchant.relowner)
      ) as acl
  ), expected_target_acl as materialized (
    select owner_acl.grantor, owner_acl.grantee,
           owner_acl.privilege_type, owner_acl.is_grantable
      from owner_acl
    union all
    select merchant.relowner, to_regrole('postgres'),
           owner_acl.privilege_type, false
      from merchant
      cross join owner_acl
    union all
    select merchant.relowner, to_regrole('authenticated'),
           privilege.privilege_type, false
      from merchant
      cross join unnest(array['SELECT','INSERT','UPDATE']::text[])
        as privilege(privilege_type)
    union all
    select merchant.relowner, to_regrole('service_role'),
           privilege.privilege_type, false
      from merchant
      cross join unnest(
        array['SELECT','INSERT','UPDATE','DELETE']::text[]
      ) as privilege(privilege_type)
  )
  select (select count(*) = 21 from actual_acl)
     and not exists (
       (select * from actual_acl
        except all
        select * from expected_target_acl)
       union all
       (select * from expected_target_acl
        except all
        select * from actual_acl)
     )
    into v_target_acl_ready;

  if not v_object_contract_ready or not v_target_acl_ready then
    raise exception 'merchant_acl_contract_hardening_postcondition_failed';
  end if;
end;
$postcondition$;

insert into public.faolla_schema_migrations (version, name)
values (202608190040, 'merchant_acl_contract_hardening')
on conflict (version) do nothing;

do $registry_postcondition$
declare
  v_target_acl_ready boolean := false;
begin
  with merchant as materialized (
    select relation.relowner, relation.relacl
      from pg_catalog.pg_class as relation
     where relation.oid = 'public.merchants'::regclass
  ), actual_acl as materialized (
    select acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
      from merchant
      cross join lateral pg_catalog.aclexplode(coalesce(
        merchant.relacl,
        pg_catalog.acldefault('r', merchant.relowner)
      )) as acl
  ), owner_acl as materialized (
    select acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
      from merchant
      cross join lateral pg_catalog.aclexplode(
        pg_catalog.acldefault('r', merchant.relowner)
      ) as acl
  ), expected_target_acl as materialized (
    select owner_acl.grantor, owner_acl.grantee,
           owner_acl.privilege_type, owner_acl.is_grantable
      from owner_acl
    union all
    select merchant.relowner, to_regrole('postgres'),
           owner_acl.privilege_type, false
      from merchant
      cross join owner_acl
    union all
    select merchant.relowner, to_regrole('authenticated'),
           privilege.privilege_type, false
      from merchant
      cross join unnest(array['SELECT','INSERT','UPDATE']::text[])
        as privilege(privilege_type)
    union all
    select merchant.relowner, to_regrole('service_role'),
           privilege.privilege_type, false
      from merchant
      cross join unnest(
        array['SELECT','INSERT','UPDATE','DELETE']::text[]
      ) as privilege(privilege_type)
  )
  select (select count(*) = 21 from actual_acl)
     and not exists (
       (select * from actual_acl
        except all
        select * from expected_target_acl)
       union all
       (select * from expected_target_acl
        except all
        select * from actual_acl)
     )
    into v_target_acl_ready;

  if 1 <> (
       select count(*)
         from public.faolla_schema_migrations as migration
        where migration.version = 202608190040
          and migration.name = 'merchant_acl_contract_hardening'
     )
     or not v_target_acl_ready then
    raise exception
      'merchant_acl_contract_hardening_registry_postcondition_failed';
  end if;
end;
$registry_postcondition$;

commit;
