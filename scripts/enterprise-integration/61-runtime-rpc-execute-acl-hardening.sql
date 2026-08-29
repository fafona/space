\set ON_ERROR_STOP on

begin;

create schema rpc_acl_default_supabase_039 authorization supabase_admin;
create schema rpc_acl_default_postgres_039 authorization postgres;
set local role supabase_admin;
create function public.faolla_rpc_acl_default_supabase_public_039()
returns integer language sql as 'select 1';
create function rpc_acl_default_supabase_039.faolla_rpc_acl_default_039()
returns integer language sql as 'select 1';
reset role;
set local role postgres;
create function rpc_acl_default_postgres_039.faolla_rpc_acl_default_039()
returns integer language sql as 'select 1';
reset role;
set local role "redteam rpc acl 039";
create function public.faolla_rpc_acl_default_custom_039()
returns integer language sql as 'select 1';
reset role;

create or replace function enterprise_integration.expect_sqlstate(
  p_sql text,
  p_expected_state text
)
returns void
language plpgsql
as $$
declare
  v_state text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state is distinct from p_expected_state then
      raise exception 'integration_unexpected_sqlstate: expected %, got %',
        p_expected_state, coalesce(v_state, '<null>');
    end if;
    return;
  end;
  raise exception 'integration_expected_sqlstate_missing: %', p_expected_state;
end;
$$;
grant execute on function enterprise_integration.expect_sqlstate(text, text)
  to service_role;

do $acceptance$
declare
  v_registry_owner oid;
begin
  if not exists (
    select 1 from public.faolla_schema_migrations
     where version = 202608190039
       and name = 'runtime_rpc_execute_acl_hardening'
  ) then
    raise exception '039 runtime RPC ACL registry row missing';
  end if;

  select relowner into v_registry_owner
    from pg_catalog.pg_class
   where oid = 'public.faolla_schema_migrations'::regclass;

  if exists (
    select 1
      from (values
        ('public.faolla_is_merchant_owner(text)', 'faolla_is_merchant_owner',
          '2550db5fceadbc06c3f640c28cba596b', 'sql', 'boolean', 1,
          true, 's', 'u', array['search_path=public']::text[], 'authenticated_only'),
        ('public.faolla_upsert_merchant_order_v1(jsonb,jsonb,jsonb)',
          'faolla_upsert_merchant_order_v1', '5b66943fa0f00091bc3f98a486b8a3fc',
          'plpgsql', 'void', 3, true, 'v', 'u', array['search_path=public']::text[], 'owner_only'),
        ('public.faolla_upsert_merchant_orders_v1(jsonb)',
          'faolla_upsert_merchant_orders_v1', '80fc055c83d0b6dafb6c50cce8ecd3d2',
          'plpgsql', 'integer', 1, true, 'v', 'u', array['search_path=public']::text[], 'service_only'),
        ('public.faolla_upsert_merchant_membership_ledger_v1(jsonb)',
          'faolla_upsert_merchant_membership_ledger_v1', '70e51fb43366605c8b654440b6820663',
          'plpgsql', 'integer', 1, true, 'v', 'u', array['search_path=public']::text[], 'service_only'),
        ('public.faolla_upsert_merchant_bookings_v1(jsonb)',
          'faolla_upsert_merchant_bookings_v1', '4de6159dcb1edd76659297849b9f5562',
          'plpgsql', 'integer', 1, true, 'v', 'u', array['search_path=public']::text[], 'service_only'),
        ('public.faolla_resolve_merchant_customer_v1(text,jsonb,text)',
          'faolla_resolve_merchant_customer_v1', 'e8311560cc1388d3602562d03e4410f9',
          'plpgsql', 'uuid', 3, true, 'v', 'u', array['search_path=public']::text[], 'service_only'),
        ('public.faolla_upsert_merchant_coupons_v1(jsonb)',
          'faolla_upsert_merchant_coupons_v1', 'ce60afd21a2d1b0644c17e8cfe205a6c',
          'plpgsql', 'integer', 1, true, 'v', 'u', array['search_path=public']::text[], 'service_only'),
        ('public.faolla_upsert_merchant_conversations_v1(jsonb)',
          'faolla_upsert_merchant_conversations_v1', '955d4b2a5c71fd35c27b29fa8e5930b6',
          'plpgsql', 'integer', 1, true, 'v', 'u', array['search_path=public']::text[], 'service_only'),
        ('public.faolla_enqueue_merchant_outbox_v1(jsonb)',
          'faolla_enqueue_merchant_outbox_v1', '607e96cfe9866788fe51d9213fdd09b3',
          'plpgsql', 'jsonb', 1, true, 'v', 'u', array['search_path=public']::text[], 'service_only'),
        ('public.faolla_claim_merchant_outbox_v1(text,integer,integer,text[])',
          'faolla_claim_merchant_outbox_v1', '093ee3ad734776481a9c0c1cb8cc106b',
          'plpgsql', 'public.merchant_outbox_events', 4, true, 'v', 'u', array['search_path=public']::text[], 'service_only'),
        ('public.faolla_renew_merchant_outbox_lease_v1(uuid,text,integer)',
          'faolla_renew_merchant_outbox_lease_v1', 'fc5e7b5c87b145ad2aa36e4d69640d33',
          'plpgsql', 'boolean', 3, true, 'v', 'u', array['search_path=public']::text[], 'service_only'),
        ('public.faolla_complete_merchant_outbox_v1(uuid,text,jsonb)',
          'faolla_complete_merchant_outbox_v1', 'ef0b107dd380ca3911d81458a6d65ddc',
          'plpgsql', 'boolean', 3, true, 'v', 'u', array['search_path=public']::text[], 'service_only'),
        ('public.faolla_fail_merchant_outbox_v1(uuid,text,text,text,boolean,integer)',
          'faolla_fail_merchant_outbox_v1', case
            when exists (
              select 1
                from public.faolla_schema_migrations
               where version = 202608300042
                 and name = 'merchant_enterprise_pgcrypto_schema_repair'
            ) then '36c3010e94db4ba1618a4c636faa4577'
            else '8257998a8a5121e8d4076ff0cc66a883'
          end,
          'plpgsql', 'jsonb', 6, true, 'v', 'u', array['search_path=public']::text[], 'service_only'),
        ('public.faolla_replay_merchant_outbox_v1(uuid,text,text)',
          'faolla_replay_merchant_outbox_v1', 'c22704e4f5509abad6af841cef776f4c',
          'plpgsql', 'boolean', 3, true, 'v', 'u', array['search_path=public']::text[], 'service_only'),
        ('public.faolla_claim_merchant_outbox_scoped_v1(text,text[],text[],integer,integer)',
          'faolla_claim_merchant_outbox_scoped_v1', '798846e64dc8981d068da499ed455312',
          'plpgsql', 'public.merchant_outbox_events', 5, true, 'v', 'u', array['search_path=public']::text[], 'service_only'),
        ('public.faolla_get_merchant_outbox_health_v1(text,integer)',
          'faolla_get_merchant_outbox_health_v1', 'd6e551d94023bd72764e7589381e4d14',
          'plpgsql', 'jsonb', 2, true, 's', 'u', array['search_path=public']::text[], 'service_only')
      ) as expected(signature, function_name, source_md5, language_name,
        return_type, argument_count, security_definer, volatility,
        parallel_mode, expected_config, acl_mode)
      left join pg_catalog.pg_proc as metadata
        on metadata.oid = to_regprocedure(expected.signature)
      left join pg_catalog.pg_language as language_metadata
        on language_metadata.oid = metadata.prolang
     where metadata.oid is null
        or metadata.proowner <> v_registry_owner
        or metadata.pronamespace <> 'public'::regnamespace
        or metadata.proname <> expected.function_name
        or metadata.prokind <> 'f'
        or metadata.pronargs <> expected.argument_count
        or metadata.prosecdef <> expected.security_definer
        or metadata.provolatile <> expected.volatility
        or metadata.proparallel <> expected.parallel_mode
        or metadata.proconfig is distinct from expected.expected_config
        or language_metadata.lanname <> expected.language_name
        or metadata.prorettype <> to_regtype(expected.return_type)
        or pg_catalog.md5(pg_catalog.replace(metadata.prosrc, E'\r\n', E'\n'))
          <> expected.source_md5
        or 1 <> (select count(*) from pg_catalog.pg_proc as overload
          where overload.pronamespace = 'public'::regnamespace
            and overload.proname = expected.function_name)
  ) then
    raise exception '16 frozen runtime RPC definitions changed';
  end if;

  if exists (
    select 1
      from (values
        ('public.faolla_is_merchant_owner(text)', false, 0,
          array['target_merchant_id']::text[], null::text),
        ('public.faolla_upsert_merchant_order_v1(jsonb,jsonb,jsonb)', false, 0,
          array['p_order','p_items','p_event']::text[], null::text),
        ('public.faolla_upsert_merchant_orders_v1(jsonb)', false, 0,
          array['p_mutations']::text[], null::text),
        ('public.faolla_upsert_merchant_membership_ledger_v1(jsonb)', false, 0,
          array['p_mutations']::text[], null::text),
        ('public.faolla_upsert_merchant_bookings_v1(jsonb)', false, 0,
          array['p_mutations']::text[], null::text),
        ('public.faolla_resolve_merchant_customer_v1(text,jsonb,text)', false, 0,
          array['p_merchant_id','p_customer','p_source']::text[], null::text),
        ('public.faolla_upsert_merchant_coupons_v1(jsonb)', false, 0,
          array['p_mutations']::text[], null::text),
        ('public.faolla_upsert_merchant_conversations_v1(jsonb)', false, 0,
          array['p_mutations']::text[], null::text),
        ('public.faolla_enqueue_merchant_outbox_v1(jsonb)', false, 0,
          array['p_event']::text[], null::text),
        ('public.faolla_claim_merchant_outbox_v1(text,integer,integer,text[])',
          true, 3, array['p_worker_id','p_limit','p_lease_seconds','p_event_types']::text[],
          '10, 60, NULL::text[]'),
        ('public.faolla_renew_merchant_outbox_lease_v1(uuid,text,integer)',
          false, 1, array['p_event_id','p_worker_id','p_lease_seconds']::text[], '60'),
        ('public.faolla_complete_merchant_outbox_v1(uuid,text,jsonb)', false, 1,
          array['p_event_id','p_worker_id','p_result']::text[], '''{}''::jsonb'),
        ('public.faolla_fail_merchant_outbox_v1(uuid,text,text,text,boolean,integer)',
          false, 3, array['p_event_id','p_worker_id','p_error_code',
            'p_error_message','p_retryable','p_retry_after_seconds']::text[],
          'NULL::text, true, NULL::integer'),
        ('public.faolla_replay_merchant_outbox_v1(uuid,text,text)', false, 0,
          array['p_event_id','p_replayed_by','p_reason_code']::text[], null::text),
        ('public.faolla_claim_merchant_outbox_scoped_v1(text,text[],text[],integer,integer)',
          true, 2, array['p_worker_id','p_merchant_ids','p_event_types',
            'p_limit','p_lease_seconds']::text[], '10, 60'),
        ('public.faolla_get_merchant_outbox_health_v1(text,integer)', false, 2,
          array['p_merchant_id','p_window_hours']::text[], 'NULL::text, 24')
      ) as expected(signature, returns_set, argument_defaults,
        argument_names, default_expression)
      join pg_catalog.pg_proc as metadata
        on metadata.oid = to_regprocedure(expected.signature)
     where metadata.proretset <> expected.returns_set
        or metadata.proisstrict
        or metadata.proleakproof
        or metadata.pronargdefaults <> expected.argument_defaults
        or metadata.proargnames is distinct from expected.argument_names
        or pg_catalog.pg_get_expr(metadata.proargdefaults, 0)
          is distinct from expected.default_expression
        or metadata.proargmodes is not null
        or metadata.proallargtypes is not null
  ) then
    raise exception 'runtime RPC argument/default metadata changed';
  end if;

  if exists (
    select 1
      from (values
        ('public.faolla_is_merchant_owner(text)', 'authenticated_only'),
        ('public.faolla_upsert_merchant_order_v1(jsonb,jsonb,jsonb)', 'owner_only'),
        ('public.faolla_upsert_merchant_orders_v1(jsonb)', 'service_only'),
        ('public.faolla_upsert_merchant_membership_ledger_v1(jsonb)', 'service_only'),
        ('public.faolla_upsert_merchant_bookings_v1(jsonb)', 'service_only'),
        ('public.faolla_resolve_merchant_customer_v1(text,jsonb,text)', 'service_only'),
        ('public.faolla_upsert_merchant_coupons_v1(jsonb)', 'service_only'),
        ('public.faolla_upsert_merchant_conversations_v1(jsonb)', 'service_only'),
        ('public.faolla_enqueue_merchant_outbox_v1(jsonb)', 'service_only'),
        ('public.faolla_claim_merchant_outbox_v1(text,integer,integer,text[])', 'service_only'),
        ('public.faolla_renew_merchant_outbox_lease_v1(uuid,text,integer)', 'service_only'),
        ('public.faolla_complete_merchant_outbox_v1(uuid,text,jsonb)', 'service_only'),
        ('public.faolla_fail_merchant_outbox_v1(uuid,text,text,text,boolean,integer)', 'service_only'),
        ('public.faolla_replay_merchant_outbox_v1(uuid,text,text)', 'service_only'),
        ('public.faolla_claim_merchant_outbox_scoped_v1(text,text[],text[],integer,integer)', 'service_only'),
        ('public.faolla_get_merchant_outbox_health_v1(text,integer)', 'service_only')
      ) as target(signature, acl_mode)
      join pg_catalog.pg_proc as metadata
        on metadata.oid = to_regprocedure(target.signature)
     where exists (
       select 1
         from pg_catalog.aclexplode(coalesce(
           metadata.proacl, pg_catalog.acldefault('f', metadata.proowner)
         )) as acl
         left join pg_catalog.pg_roles as grantee on grantee.oid = acl.grantee
        where acl.grantor <> metadata.proowner
           or acl.privilege_type <> 'EXECUTE'
           or acl.is_grantable
           or (
             acl.grantee <> metadata.proowner
             and not (target.acl_mode = 'authenticated_only'
               and grantee.rolname = 'authenticated')
             and not (target.acl_mode = 'service_only'
               and grantee.rolname = 'service_role')
           )
     )
       or (select count(*) from pg_catalog.aclexplode(coalesce(
         metadata.proacl, pg_catalog.acldefault('f', metadata.proowner)
       ))) <> case when target.acl_mode = 'owner_only' then 1 else 2 end
  ) then
    raise exception 'runtime RPC raw ACL is not exact';
  end if;

  if to_regrole('anon') is null
     or to_regrole('authenticated') is null
     or to_regrole('service_role') is null
     or to_regrole('authenticator') is null
     or to_regrole('postgres') is null
     or to_regrole('supabase_admin') is null
     or exists (
    select 1 from pg_catalog.pg_roles
     where rolname in ('anon', 'authenticated')
       and (rolsuper or rolcreaterole or rolcreatedb or rolcanlogin
         or rolreplication or rolbypassrls)
  ) or exists (
    select 1 from pg_catalog.pg_roles
     where rolname = 'service_role'
       and (rolsuper or rolcreaterole or rolcreatedb or rolcanlogin
         or rolreplication or not rolbypassrls)
  ) or not exists (
    select 1 from pg_catalog.pg_roles
     where rolname = 'authenticator' and rolcanlogin and not rolinherit
       and not rolsuper and not rolcreaterole and not rolcreatedb
       and not rolreplication and not rolbypassrls
  ) or exists (
    select 1 from pg_catalog.pg_roles
     where rolname = 'supabase_storage_admin' and rolinherit
  ) or exists (
    select 1 from pg_catalog.pg_roles
     where rolname = 'cli_login_postgres'
       and (not rolcanlogin or rolsuper or rolcreaterole
         or rolcreatedb or rolreplication or rolbypassrls)
  ) or (
    to_regrole('cli_login_postgres') is not null and 1 <> (
      select count(*) from pg_catalog.pg_auth_members
       where roleid = to_regrole('postgres')
         and member = to_regrole('cli_login_postgres')
         and not admin_option
    )
  ) or exists (
    select 1 from pg_catalog.pg_roles
     where rolname !~ '^pg_' and (rolsuper or rolcreaterole)
       and rolname not in ('dashboard_user', 'postgres', 'supabase_admin',
         'supabase_auth_admin', 'supabase_functions_admin',
         'supabase_storage_admin')
  ) or 3 <> (
    select count(*)
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as granted_role on granted_role.oid = membership.roleid
      join pg_catalog.pg_roles as member_role on member_role.oid = membership.member
     where granted_role.rolname in ('anon', 'authenticated', 'service_role')
       and member_role.rolname = 'authenticator' and not membership.admin_option
  ) or (
    select count(*)
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as granted_role on granted_role.oid = membership.roleid
      join pg_catalog.pg_roles as member_role on member_role.oid = membership.member
     where granted_role.rolname in ('anon', 'authenticated', 'service_role')
       and member_role.rolname = 'postgres' and not membership.admin_option
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
        join pg_catalog.pg_roles as granted_role on granted_role.oid = membership.roleid
        join pg_catalog.pg_roles as member_role on member_role.oid = membership.member
       where granted_role.rolname in ('anon', 'authenticated', 'service_role',
           'supabase_admin', 'authenticator', 'postgres')
          or member_role.rolname in ('anon', 'authenticated', 'service_role',
            'authenticator', 'supabase_storage_admin', 'cli_login_postgres')
    )
    select 1 from (
      select * from actual_protected_membership
      except select * from allowed_membership
    ) as unexpected_membership
  ) or exists (
    select 1
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as granted_role on granted_role.oid = membership.roleid
      join pg_catalog.pg_roles as member_role on member_role.oid = membership.member
      join pg_catalog.pg_roles as grantor_role on grantor_role.oid = membership.grantor
     where (granted_role.rolname in ('anon', 'authenticated', 'service_role',
              'supabase_admin', 'authenticator', 'postgres')
         or member_role.rolname in ('anon', 'authenticated', 'service_role',
              'authenticator', 'supabase_storage_admin', 'cli_login_postgres'))
       and (grantor_role.rolname not in ('postgres', 'supabase_admin')
         or (granted_role.rolname = 'postgres'
           and member_role.rolname = 'cli_login_postgres'
           and grantor_role.rolname <> 'supabase_admin'))
  ) or exists (
    with recursive role_path(start_role, reachable_role) as (
      select member, roleid from pg_catalog.pg_auth_members
      union
      select role_path.start_role, membership.roleid
        from role_path
        join pg_catalog.pg_auth_members as membership
          on membership.member = role_path.reachable_role
    )
    select 1
      from role_path
      join pg_catalog.pg_roles as start_metadata on start_metadata.oid = start_role
      join pg_catalog.pg_roles as reachable_metadata on reachable_metadata.oid = reachable_role
     where start_metadata.rolname not in ('anon', 'authenticated', 'service_role',
         'supabase_admin', 'supabase_storage_admin', 'authenticator', 'postgres',
         'dashboard_user', 'supabase_auth_admin', 'supabase_functions_admin',
         'cli_login_postgres')
       and reachable_metadata.rolname in ('anon', 'authenticated', 'service_role',
         'supabase_admin', 'supabase_storage_admin', 'authenticator', 'postgres',
         'dashboard_user', 'supabase_auth_admin', 'supabase_functions_admin',
         'cli_login_postgres')
  ) then
    raise exception 'runtime RPC protected role graph is not exact';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_roles as creator
     where creator.rolname !~ '^pg_'
       and (creator.oid in (v_registry_owner, to_regrole('postgres'),
              to_regrole('supabase_admin'))
         or pg_catalog.has_schema_privilege(
              creator.oid, 'public'::regnamespace, 'CREATE'))
       and (not exists (
         select 1 from pg_catalog.pg_default_acl as defaults
          where defaults.defaclrole = creator.oid
            and defaults.defaclnamespace = 0 and defaults.defaclobjtype = 'f'
       ) or 1 <> (
         select count(*)
           from pg_catalog.pg_default_acl as defaults
           cross join lateral pg_catalog.aclexplode(defaults.defaclacl) as acl
          where defaults.defaclrole = creator.oid
            and defaults.defaclnamespace = 0 and defaults.defaclobjtype = 'f'
            and acl.grantee = creator.oid and acl.grantor = creator.oid
            and acl.privilege_type = 'EXECUTE' and not acl.is_grantable
       ))
  ) or exists (
    select 1
      from pg_catalog.pg_default_acl as defaults
      cross join lateral pg_catalog.aclexplode(defaults.defaclacl) as acl
     where defaults.defaclnamespace in (0, 'public'::regnamespace)
       and defaults.defaclobjtype = 'f'
       and (acl.grantee <> defaults.defaclrole
         or acl.grantor <> defaults.defaclrole
         or acl.privilege_type <> 'EXECUTE'
         or acl.is_grantable)
  ) then
    raise exception 'future function default EXECUTE ACL is not owner-only';
  end if;

  if exists (
    select 1
      from (values
        ('public.faolla_rpc_acl_default_supabase_public_039()', 'supabase_admin'),
        ('rpc_acl_default_supabase_039.faolla_rpc_acl_default_039()', 'supabase_admin'),
        ('rpc_acl_default_postgres_039.faolla_rpc_acl_default_039()', 'postgres'),
        ('public.faolla_rpc_acl_default_custom_039()', 'redteam rpc acl 039')
      ) as expected(signature, owner_name)
      left join pg_catalog.pg_proc as metadata
        on metadata.oid = to_regprocedure(expected.signature)
     where metadata.oid is null
        or metadata.proowner <> (
          select oid from pg_catalog.pg_roles
           where rolname = expected.owner_name
        )
        or 1 <> (
          select count(*)
            from pg_catalog.aclexplode(coalesce(
              metadata.proacl, pg_catalog.acldefault('f', metadata.proowner)
            )) as acl
           where acl.grantee = metadata.proowner
             and acl.grantor = metadata.proowner
             and acl.privilege_type = 'EXECUTE'
             and not acl.is_grantable
        )
        or exists (
          select 1
            from pg_catalog.aclexplode(coalesce(
              metadata.proacl, pg_catalog.acldefault('f', metadata.proowner)
            )) as acl
           where acl.grantee <> metadata.proowner
              or acl.grantor <> metadata.proowner
              or acl.privilege_type <> 'EXECUTE'
              or acl.is_grantable
        )
  ) then
    raise exception 'future function owner-only canary failed';
  end if;

  if exists (
    with actual as (
      select acl.grantee, acl.grantor, acl.privilege_type,
             acl.is_grantable
        from pg_catalog.pg_class as registry_metadata
        cross join lateral pg_catalog.aclexplode(coalesce(
          registry_metadata.relacl,
          pg_catalog.acldefault('r', registry_metadata.relowner)
        )) as acl
       where registry_metadata.oid =
         'public.faolla_schema_migrations'::regclass
    ), expected(grantee, grantor, privilege_type, is_grantable) as (
      select owner_acl.grantee, owner_acl.grantor,
             owner_acl.privilege_type, owner_acl.is_grantable
        from pg_catalog.aclexplode(
          pg_catalog.acldefault('r', v_registry_owner)
        ) as owner_acl
      union all
      select to_regrole('service_role'), v_registry_owner,
             'SELECT'::text, false
    )
    (select * from actual except select * from expected)
    union all
    (select * from expected except select * from actual)
  ) or exists (
    select 1
      from pg_catalog.pg_attribute as attribute
     where attribute.attrelid =
       'public.faolla_schema_migrations'::regclass
       and attribute.attnum > 0
       and not attribute.attisdropped
       and attribute.attacl is not null
  ) then
    raise exception '039 registry raw ACL is not exact';
  end if;

  if v_registry_owner <> to_regrole('supabase_admin')
     or not exists (select 1 from pg_catalog.pg_class
       where oid = 'public.faolla_schema_migrations'::regclass
         and relkind = 'r' and relrowsecurity and not relforcerowsecurity)
     or 1 <> (select count(*) from public.faolla_schema_migrations
       where version = 202608190039
         and name = 'runtime_rpc_execute_acl_hardening')
     or exists (select 1 from public.faolla_schema_migrations
       where version = 202608190039
         and name <> 'runtime_rpc_execute_acl_hardening')
     or 3 <> (select count(*) from pg_catalog.pg_attribute
       where attrelid = 'public.faolla_schema_migrations'::regclass
         and attnum > 0 and not attisdropped)
     or not exists (select 1 from pg_catalog.pg_attribute
       where attrelid = 'public.faolla_schema_migrations'::regclass
         and attname = 'version' and attnum = 1
         and atttypid = 'pg_catalog.int8'::regtype and attnotnull)
     or not exists (select 1 from pg_catalog.pg_attribute
       where attrelid = 'public.faolla_schema_migrations'::regclass
         and attname = 'name' and attnum = 2
         and atttypid = 'pg_catalog.text'::regtype and attnotnull)
     or not exists (
       select 1
         from pg_catalog.pg_attribute as attribute
         join pg_catalog.pg_attrdef as default_metadata
           on default_metadata.adrelid = attribute.attrelid
          and default_metadata.adnum = attribute.attnum
        where attribute.attrelid = 'public.faolla_schema_migrations'::regclass
          and attribute.attname = 'applied_at' and attribute.attnum = 3
          and attribute.atttypid = 'pg_catalog.timestamptz'::regtype
          and attribute.attnotnull
          and pg_catalog.pg_get_expr(
            default_metadata.adbin, default_metadata.adrelid
          ) = 'now()'
     )
     or 1 <> (select count(*) from pg_catalog.pg_constraint
       where conrelid = 'public.faolla_schema_migrations'::regclass
         and contype = 'p' and conkey = array[1]::smallint[])
     or 1 <> (select count(*) from pg_catalog.pg_constraint
       where conrelid = 'public.faolla_schema_migrations'::regclass)
     or exists (select 1 from pg_catalog.pg_trigger
       where tgrelid = 'public.faolla_schema_migrations'::regclass
         and not tgisinternal)
     or exists (select 1 from pg_catalog.pg_policy
       where polrelid = 'public.faolla_schema_migrations'::regclass) then
    raise exception '039 registry catalog invariant changed';
  end if;
end;
$acceptance$;

set local role service_role;
select enterprise_integration.assert_true(
  exists (
    select 1 from public.faolla_schema_migrations
     where version = 202608190039
       and name = 'runtime_rpc_execute_acl_hardening'
  ),
  'service_role cannot read the migration registry'
);
select enterprise_integration.expect_sqlstate(
  $sql$insert into public.faolla_schema_migrations(version, name)
       values (209608190039, 'forbidden')$sql$,
  '42501'
);
select enterprise_integration.expect_sqlstate(
  $sql$update public.faolla_schema_migrations
          set name = name where version = 202608190039$sql$,
  '42501'
);
select enterprise_integration.expect_sqlstate(
  $sql$update public.faolla_schema_migrations
          set applied_at = applied_at where version = 202608190039$sql$,
  '42501'
);
select enterprise_integration.expect_sqlstate(
  $sql$delete from public.faolla_schema_migrations
          where version = 202608190039$sql$,
  '42501'
);
select enterprise_integration.expect_sqlstate(
  $sql$truncate table public.faolla_schema_migrations$sql$,
  '42501'
);
reset role;

rollback;
