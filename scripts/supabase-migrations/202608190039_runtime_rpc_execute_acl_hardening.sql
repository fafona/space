-- Normalize callable runtime RPC EXECUTE ACLs, future function defaults, and
-- the migration-registry table/column ACL. This migration changes no function
-- body or business result.

begin;

set transaction isolation level read committed;
set local quote_all_identifiers = off;
set local lock_timeout = '15s';
set local statement_timeout = '60s';

do $migrator_preflight$
begin
  if current_user <> 'supabase_admin'
     or not exists (
       select 1 from pg_catalog.pg_roles as role_metadata
        where role_metadata.rolname = current_user
          and role_metadata.rolsuper
     ) then
    raise exception 'runtime_rpc_execute_acl_hardening_untrusted_migrator';
  end if;
end;
$migrator_preflight$;

-- The production migration runner holds this same deployment mutex around the
-- complete source file. The transaction-level acquisition also protects a
-- direct, controlled psql retry and is re-entrant when the runner already owns
-- the session-level lock.
select pg_catalog.pg_advisory_xact_lock(20260731, 1);

-- Database ownership, CREATE/REPLACE FUNCTION, ALTER DEFAULT PRIVILEGES, role
-- membership/attribute, schema, language and type writers all touch at least
-- one of these catalogs. Table and column GRANT/REVOKE writers touch pg_class
-- or pg_attribute. Database ownership participates in the implicit
-- pg_database_owner -> public CREATE privilege used by creator discovery.
-- SHARE ROW EXCLUSIVE conflicts with their catalog RowExclusiveLock while
-- keeping ordinary catalog reads available. The order is frozen to avoid
-- migration-to-migration lock inversions.
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

-- A writer that completed its catalog statement before these gates but has not
-- committed still owns an XID. This is the transaction's first statistics
-- snapshot: reject every other cluster-wide XID except this backend and its
-- parallel children, and reject every prepared transaction. The conservative
-- gate may also reject unrelated writes, so production applies in a maintenance
-- window and safely retries after the writer finishes.
do $catalog_quiescence_postlock$
begin
  perform pg_catalog.pg_stat_clear_snapshot();

  if exists (
       select 1
         from pg_catalog.pg_stat_activity as activity
        where activity.pid <> pg_catalog.pg_backend_pid()
          and activity.leader_pid is distinct from pg_catalog.pg_backend_pid()
          and activity.backend_xid is not null
     ) then
    raise exception 'runtime_rpc_execute_acl_hardening_concurrent_transaction';
  end if;

  if exists (select 1 from pg_catalog.pg_prepared_xacts) then
    raise exception 'runtime_rpc_execute_acl_hardening_concurrent_transaction';
  end if;
end;
$catalog_quiescence_postlock$;

-- Quiescence is proven before touching the registry lock. A transaction that
-- already modified the registry has an XID and fails above; an XID-less session
-- holding only an explicit registry lock is safely serialized here.
lock table public.faolla_schema_migrations in share row exclusive mode;

-- This must be the next SQL statement: READ COMMITTED takes a fresh snapshot
-- after the registry lock, so a writer that committed while a lock was being
-- acquired cannot remain invisible to the complete preflight.
do $preflight$
declare
  v_registry_owner oid;
begin
  if current_user <> 'supabase_admin'
     or not exists (
       select 1 from pg_catalog.pg_roles as role_metadata
        where role_metadata.rolname = current_user
          and role_metadata.rolsuper
     ) then
    raise exception 'runtime_rpc_execute_acl_hardening_untrusted_migrator';
  end if;

  if exists (
    select 1
      from public.faolla_schema_migrations
     where version = 202608190039
       and name <> 'runtime_rpc_execute_acl_hardening'
  ) then
    raise exception 'runtime_rpc_execute_acl_hardening_registry_conflict';
  end if;

  if to_regrole('anon') is null
     or to_regrole('authenticated') is null
     or to_regrole('service_role') is null
     or to_regrole('postgres') is null
     or to_regrole('supabase_admin') is null
     or not exists (
       select 1
         from public.faolla_schema_migrations
        where version = 202608190038
          and name = 'ordinary_account_recovery_observer'
     )
     or exists (
       select 1
         from (values
           (202607250001::bigint, 'core_transaction_foundation'),
           (202607250002::bigint, 'order_shadow_write_rpc'),
           (202607250003::bigint, 'membership_ledger_shadow_write_rpc'),
           (202607250004::bigint, 'booking_shadow_write_rpc'),
           (202607250005::bigint, 'coupon_shadow_write_rpc'),
           (202607250006::bigint, 'conversation_shadow_write_rpc'),
           (202607250007::bigint, 'reliable_outbox_runtime'),
           (202607250008::bigint, 'scoped_outbox_claim')
         ) as required(version, name)
        where not exists (
          select 1
            from public.faolla_schema_migrations as applied
           where applied.version = required.version
             and applied.name = required.name
        )
     ) then
    raise exception 'runtime_rpc_execute_acl_hardening_prerequisite_missing';
  end if;

  select relowner into v_registry_owner
    from pg_catalog.pg_class
   where oid = 'public.faolla_schema_migrations'::regclass;
  if v_registry_owner is null or v_registry_owner <> to_regrole(current_user)
     or not exists (
       select 1 from pg_catalog.pg_class as registry_metadata
        where registry_metadata.oid = 'public.faolla_schema_migrations'::regclass
          and registry_metadata.relkind = 'r'
          and registry_metadata.relrowsecurity
          and not registry_metadata.relforcerowsecurity
     )
     or 3 <> (
       select count(*) from pg_catalog.pg_attribute as attribute
        where attribute.attrelid = 'public.faolla_schema_migrations'::regclass
          and attribute.attnum > 0 and not attribute.attisdropped
     )
     or not exists (
       select 1 from pg_catalog.pg_attribute as attribute
        where attribute.attrelid = 'public.faolla_schema_migrations'::regclass
          and attribute.attname = 'version' and attribute.attnum = 1
          and attribute.atttypid = 'pg_catalog.int8'::regtype
          and attribute.attnotnull
     )
     or not exists (
       select 1 from pg_catalog.pg_attribute as attribute
        where attribute.attrelid = 'public.faolla_schema_migrations'::regclass
          and attribute.attname = 'name' and attribute.attnum = 2
          and attribute.atttypid = 'pg_catalog.text'::regtype
          and attribute.attnotnull
     )
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
     or 1 <> (
       select count(*) from pg_catalog.pg_constraint as constraint_metadata
        where constraint_metadata.conrelid =
          'public.faolla_schema_migrations'::regclass
          and constraint_metadata.contype = 'p'
          and constraint_metadata.conkey = array[1]::smallint[]
     )
     or 1 <> (
       select count(*) from pg_catalog.pg_constraint as constraint_metadata
        where constraint_metadata.conrelid =
          'public.faolla_schema_migrations'::regclass
     )
     or exists (
       select 1 from pg_catalog.pg_trigger as trigger_metadata
        where trigger_metadata.tgrelid =
          'public.faolla_schema_migrations'::regclass
          and not trigger_metadata.tgisinternal
     )
     or exists (
       select 1 from pg_catalog.pg_policy as policy_metadata
        where policy_metadata.polrelid =
          'public.faolla_schema_migrations'::regclass
     ) then
    raise exception 'runtime_rpc_execute_acl_hardening_prerequisite_missing';
  end if;

  if exists (
    select 1
      from (values
        ('public.faolla_is_merchant_owner(text)',
          'faolla_is_merchant_owner', '2550db5fceadbc06c3f640c28cba596b',
          'sql', 'boolean', 1, true, 's', 'u',
          array['search_path=public']::text[]),
        ('public.faolla_upsert_merchant_order_v1(jsonb,jsonb,jsonb)',
          'faolla_upsert_merchant_order_v1', '5b66943fa0f00091bc3f98a486b8a3fc',
          'plpgsql', 'void', 3, true, 'v', 'u',
          array['search_path=public']::text[]),
        ('public.faolla_upsert_merchant_orders_v1(jsonb)',
          'faolla_upsert_merchant_orders_v1', '80fc055c83d0b6dafb6c50cce8ecd3d2',
          'plpgsql', 'integer', 1, true, 'v', 'u',
          array['search_path=public']::text[]),
        ('public.faolla_upsert_merchant_membership_ledger_v1(jsonb)',
          'faolla_upsert_merchant_membership_ledger_v1',
          '70e51fb43366605c8b654440b6820663', 'plpgsql', 'integer', 1,
          true, 'v', 'u', array['search_path=public']::text[]),
        ('public.faolla_upsert_merchant_bookings_v1(jsonb)',
          'faolla_upsert_merchant_bookings_v1', '4de6159dcb1edd76659297849b9f5562',
          'plpgsql', 'integer', 1, true, 'v', 'u',
          array['search_path=public']::text[]),
        ('public.faolla_resolve_merchant_customer_v1(text,jsonb,text)',
          'faolla_resolve_merchant_customer_v1', 'e8311560cc1388d3602562d03e4410f9',
          'plpgsql', 'uuid', 3, true, 'v', 'u',
          array['search_path=public']::text[]),
        ('public.faolla_upsert_merchant_coupons_v1(jsonb)',
          'faolla_upsert_merchant_coupons_v1', 'ce60afd21a2d1b0644c17e8cfe205a6c',
          'plpgsql', 'integer', 1, true, 'v', 'u',
          array['search_path=public']::text[]),
        ('public.faolla_upsert_merchant_conversations_v1(jsonb)',
          'faolla_upsert_merchant_conversations_v1',
          '955d4b2a5c71fd35c27b29fa8e5930b6', 'plpgsql', 'integer', 1,
          true, 'v', 'u', array['search_path=public']::text[]),
        ('public.faolla_enqueue_merchant_outbox_v1(jsonb)',
          'faolla_enqueue_merchant_outbox_v1', '607e96cfe9866788fe51d9213fdd09b3',
          'plpgsql', 'jsonb', 1, true, 'v', 'u',
          array['search_path=public']::text[]),
        ('public.faolla_claim_merchant_outbox_v1(text,integer,integer,text[])',
          'faolla_claim_merchant_outbox_v1', '093ee3ad734776481a9c0c1cb8cc106b',
          'plpgsql', 'public.merchant_outbox_events', 4, true, 'v', 'u',
          array['search_path=public']::text[]),
        ('public.faolla_renew_merchant_outbox_lease_v1(uuid,text,integer)',
          'faolla_renew_merchant_outbox_lease_v1',
          'fc5e7b5c87b145ad2aa36e4d69640d33', 'plpgsql', 'boolean', 3,
          true, 'v', 'u', array['search_path=public']::text[]),
        ('public.faolla_complete_merchant_outbox_v1(uuid,text,jsonb)',
          'faolla_complete_merchant_outbox_v1',
          'ef0b107dd380ca3911d81458a6d65ddc', 'plpgsql', 'boolean', 3,
          true, 'v', 'u', array['search_path=public']::text[]),
        ('public.faolla_fail_merchant_outbox_v1(uuid,text,text,text,boolean,integer)',
          'faolla_fail_merchant_outbox_v1', '8257998a8a5121e8d4076ff0cc66a883',
          'plpgsql', 'jsonb', 6, true, 'v', 'u',
          array['search_path=public']::text[]),
        ('public.faolla_replay_merchant_outbox_v1(uuid,text,text)',
          'faolla_replay_merchant_outbox_v1', 'c22704e4f5509abad6af841cef776f4c',
          'plpgsql', 'boolean', 3, true, 'v', 'u',
          array['search_path=public']::text[]),
        ('public.faolla_claim_merchant_outbox_scoped_v1(text,text[],text[],integer,integer)',
          'faolla_claim_merchant_outbox_scoped_v1',
          '798846e64dc8981d068da499ed455312', 'plpgsql',
          'public.merchant_outbox_events', 5, true, 'v', 'u',
          array['search_path=public']::text[]),
        ('public.faolla_get_merchant_outbox_health_v1(text,integer)',
          'faolla_get_merchant_outbox_health_v1', 'd6e551d94023bd72764e7589381e4d14',
          'plpgsql', 'jsonb', 2, true, 's', 'u',
          array['search_path=public']::text[])
      ) as expected(
        signature, function_name, source_md5, language_name, return_type,
        argument_count, security_definer, volatility, parallel_mode,
        expected_config
      )
      left join pg_catalog.pg_proc as function_metadata
        on function_metadata.oid = to_regprocedure(expected.signature)
      left join pg_catalog.pg_language as language_metadata
        on language_metadata.oid = function_metadata.prolang
     where function_metadata.oid is null
        or function_metadata.proname <> expected.function_name
        or function_metadata.pronamespace <> 'public'::regnamespace
        or function_metadata.proowner <> to_regrole(current_user)
        or function_metadata.prokind <> 'f'
        or function_metadata.pronargs <> expected.argument_count
        or function_metadata.prosecdef <> expected.security_definer
        or function_metadata.provolatile <> expected.volatility
        or function_metadata.proparallel <> expected.parallel_mode
        or function_metadata.proconfig is distinct from expected.expected_config
        or language_metadata.lanname <> expected.language_name
        or function_metadata.prorettype <> to_regtype(expected.return_type)
        or pg_catalog.md5(pg_catalog.replace(
          function_metadata.prosrc, E'\r\n', E'\n'
        )) <> expected.source_md5
        or 1 <> (
          select count(*)
            from pg_catalog.pg_proc as overload
           where overload.pronamespace = 'public'::regnamespace
             and overload.proname = expected.function_name
        )
  ) then
    raise exception 'runtime_rpc_execute_acl_hardening_definition_mismatch';
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
      ) as expected(
        signature, returns_set, argument_defaults, argument_names,
        default_expression
      )
      join pg_catalog.pg_proc as function_metadata
        on function_metadata.oid = to_regprocedure(expected.signature)
     where function_metadata.proretset <> expected.returns_set
        or function_metadata.proisstrict
        or function_metadata.proleakproof
        or function_metadata.pronargdefaults <> expected.argument_defaults
        or function_metadata.proargnames is distinct from expected.argument_names
        or pg_catalog.pg_get_expr(function_metadata.proargdefaults, 0)
          is distinct from expected.default_expression
        or function_metadata.proargmodes is not null
        or function_metadata.proallargtypes is not null
  ) then
    raise exception 'runtime_rpc_execute_acl_hardening_definition_mismatch';
  end if;

  if to_regrole('authenticator') is null or exists (
    select 1
      from pg_catalog.pg_roles
     where rolname in ('anon', 'authenticated')
       and (rolsuper or rolcreaterole or rolcreatedb or rolcanlogin
         or rolreplication or rolbypassrls)
  ) or exists (
    select 1
      from pg_catalog.pg_roles
     where rolname = 'service_role'
       and (rolsuper or rolcreaterole or rolcreatedb or rolcanlogin
         or rolreplication or not rolbypassrls)
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
      select count(*)
        from pg_catalog.pg_auth_members as membership
       where membership.roleid = to_regrole('postgres')
         and membership.member = to_regrole('cli_login_postgres')
         and not membership.admin_option
    )
  ) or 3 <> (
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
        ('supabase_admin', 'authenticator', false),
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
         or (granted_role.rolname = 'postgres'
           and member_role.rolname = 'cli_login_postgres'
           and grantor_role.rolname <> 'supabase_admin')
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
     where (
       start_metadata.rolname not in (
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
     )
  ) then
    raise exception 'runtime_rpc_execute_acl_hardening_role_attribute_mismatch';
  end if;
end;
$preflight$;

do $registry_acl$
declare
  v_acl record;
  v_registry_owner text;
  v_grantee_sql text;
begin
  select pg_catalog.pg_get_userbyid(registry_metadata.relowner)
    into strict v_registry_owner
    from pg_catalog.pg_class as registry_metadata
   where registry_metadata.oid =
     'public.faolla_schema_migrations'::regclass;

  -- Rebuild the table ACL from raw catalog tuples. This removes PUBLIC,
  -- custom, delegated, grant-option and stale standard-role privileges while
  -- preserving the service-role SELECT needed by runtime health/readiness.
  for v_acl in
    select distinct acl.grantee, grantee_metadata.rolname
      from pg_catalog.pg_class as registry_metadata
      cross join lateral pg_catalog.aclexplode(coalesce(
        registry_metadata.relacl,
        pg_catalog.acldefault('r', registry_metadata.relowner)
      )) as acl
      left join pg_catalog.pg_roles as grantee_metadata
        on grantee_metadata.oid = acl.grantee
     where registry_metadata.oid =
       'public.faolla_schema_migrations'::regclass
  loop
    if v_acl.grantee <> 0 and v_acl.rolname is null then
      raise exception 'runtime_rpc_execute_acl_hardening_acl_grantee_missing';
    end if;
    v_grantee_sql := case when v_acl.grantee = 0 then 'public'
      else format('%I', v_acl.rolname) end;
    execute format(
      'revoke all privileges on table public.faolla_schema_migrations from %s cascade',
      v_grantee_sql
    );
  end loop;

  -- Table-level REVOKE does not clear per-column ACLs. Remove every raw live-
  -- column tuple explicitly so no delegated read or mutation survives.
  for v_acl in
    select distinct attribute.attname, acl.grantee,
           grantee_metadata.rolname
      from pg_catalog.pg_attribute as attribute
      cross join lateral pg_catalog.aclexplode(attribute.attacl) as acl
      left join pg_catalog.pg_roles as grantee_metadata
        on grantee_metadata.oid = acl.grantee
     where attribute.attrelid =
       'public.faolla_schema_migrations'::regclass
       and attribute.attnum > 0
       and not attribute.attisdropped
  loop
    if v_acl.grantee <> 0 and v_acl.rolname is null then
      raise exception 'runtime_rpc_execute_acl_hardening_acl_grantee_missing';
    end if;
    v_grantee_sql := case when v_acl.grantee = 0 then 'public'
      else format('%I', v_acl.rolname) end;
    execute format(
      'revoke all privileges (%I) on table public.faolla_schema_migrations from %s cascade',
      v_acl.attname, v_grantee_sql
    );
  end loop;

  execute format(
    'grant all privileges on table public.faolla_schema_migrations to %I',
    v_registry_owner
  );
  grant select on table public.faolla_schema_migrations to service_role;
end;
$registry_acl$;

do $acl$
declare
  v_function record;
  v_grantee record;
  v_creator record;
  v_default_grantee record;
  v_grantee_sql text;
begin
  -- Older Supabase role snapshots granted the SUPERUSER migration role to the
  -- login authenticator. Accept that one legacy edge only so this same atomic
  -- transaction can remove it before any runtime EXECUTE ACL is published.
  if exists (
    select 1
      from pg_catalog.pg_auth_members as membership
     where membership.roleid = to_regrole('supabase_admin')
       and membership.member = to_regrole('authenticator')
  ) then
    revoke supabase_admin from authenticator;
  end if;

  for v_function in
    select target.signature, target.acl_mode,
           function_metadata.proowner, function_metadata.proacl
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
      join pg_catalog.pg_proc as function_metadata
        on function_metadata.oid = to_regprocedure(target.signature)
  loop
    for v_grantee in
      select distinct acl.grantee, role_metadata.rolname
        from pg_catalog.aclexplode(coalesce(
          v_function.proacl,
          pg_catalog.acldefault('f', v_function.proowner)
       )) as acl
        left join pg_catalog.pg_roles as role_metadata
          on role_metadata.oid = acl.grantee
       where acl.privilege_type = 'EXECUTE'
    loop
      if v_grantee.grantee <> 0 and v_grantee.rolname is null then
        raise exception 'runtime_rpc_execute_acl_hardening_acl_grantee_missing';
      end if;
      v_grantee_sql := case when v_grantee.grantee = 0 then 'public'
        else format('%I', v_grantee.rolname) end;
      execute format(
        'revoke all privileges on function %s from %s cascade',
        v_function.signature, v_grantee_sql
      );
    end loop;
    execute format(
      'grant execute on function %s to %I',
      v_function.signature, pg_catalog.pg_get_userbyid(v_function.proowner)
    );
    if v_function.acl_mode = 'authenticated_only' then
      execute format('grant execute on function %s to authenticated',
        v_function.signature);
    elsif v_function.acl_mode = 'service_only' then
      execute format('grant execute on function %s to service_role',
        v_function.signature);
    end if;
  end loop;

  -- PostgreSQL grants PUBLIC EXECUTE on new functions by default. Normalize
  -- every relevant creator's global (all-schema) default to owner-only,
  -- including custom/delegated defaults. This intentionally changes future
  -- function defaults in every schema for each audited creator; individual
  -- runtime RPC grants must always be explicit.
  for v_creator in
    select role_metadata.oid as creator_oid, role_metadata.rolname
      from pg_catalog.pg_roles as role_metadata
     where role_metadata.rolname !~ '^pg_'
       and (
         role_metadata.oid in (
           to_regrole(current_user), to_regrole(session_user),
           to_regrole('postgres'), to_regrole('supabase_admin'),
           (select relowner from pg_catalog.pg_class
             where oid = 'public.faolla_schema_migrations'::regclass)
         )
         or pg_catalog.has_schema_privilege(
           role_metadata.oid, 'public'::regnamespace, 'CREATE'
         )
          or exists (
           select 1
             from pg_catalog.pg_default_acl as default_acl
             cross join lateral pg_catalog.aclexplode(
               default_acl.defaclacl
             ) as acl
            where default_acl.defaclrole = role_metadata.oid
              and default_acl.defaclnamespace in (0, 'public'::regnamespace)
              and default_acl.defaclobjtype = 'f'
              and (
                acl.privilege_type <> 'EXECUTE'
                or acl.grantee <> role_metadata.oid
                or acl.grantor <> role_metadata.oid
                or acl.is_grantable
              )
         )
       )
  loop
    execute format(
      'alter default privileges for role %I revoke execute on functions from public cascade',
      v_creator.rolname
    );
    execute format(
      'alter default privileges for role %I revoke all privileges on functions from %I cascade',
      v_creator.rolname, v_creator.rolname
    );
    execute format(
      'alter default privileges for role %I grant execute on functions to %I',
      v_creator.rolname, v_creator.rolname
    );
    execute format(
      'alter default privileges for role %I in schema public revoke all privileges on functions from %I cascade',
      v_creator.rolname, v_creator.rolname
    );
    for v_default_grantee in
      select distinct default_acl.defaclnamespace, acl.grantee,
             grantee_metadata.rolname
        from pg_catalog.pg_default_acl as default_acl
        cross join lateral pg_catalog.aclexplode(default_acl.defaclacl) as acl
        left join pg_catalog.pg_roles as grantee_metadata
          on grantee_metadata.oid = acl.grantee
       where default_acl.defaclrole = v_creator.creator_oid
         and default_acl.defaclnamespace in (0, 'public'::regnamespace)
         and default_acl.defaclobjtype = 'f'
         and acl.privilege_type = 'EXECUTE'
         and acl.grantee <> v_creator.creator_oid
    loop
      if v_default_grantee.grantee <> 0
         and v_default_grantee.rolname is null then
        raise exception 'runtime_rpc_execute_acl_hardening_acl_grantee_missing';
      end if;
      v_grantee_sql := case when v_default_grantee.grantee = 0 then 'public'
        else format('%I', v_default_grantee.rolname) end;
      if v_default_grantee.defaclnamespace = 0 then
        execute format(
          'alter default privileges for role %I revoke execute on functions from %s cascade',
          v_creator.rolname, v_grantee_sql
        );
      else
        execute format(
          'alter default privileges for role %I in schema public revoke execute on functions from %s cascade',
          v_creator.rolname, v_grantee_sql
        );
      end if;
    end loop;
  end loop;
end;
$acl$;

do $role_graph_postcondition$
begin
  if exists (
    select 1
      from pg_catalog.pg_roles
     where rolname in ('anon', 'authenticated')
       and (rolsuper or rolcreaterole or rolcreatedb or rolcanlogin
         or rolreplication or rolbypassrls)
  ) or exists (
    select 1
      from pg_catalog.pg_roles
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
      select count(*)
        from pg_catalog.pg_auth_members as membership
       where membership.roleid = to_regrole('postgres')
         and membership.member = to_regrole('cli_login_postgres')
         and not membership.admin_option
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
  ) or 3 <> (
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
         or (granted_role.rolname = 'postgres'
           and member_role.rolname = 'cli_login_postgres'
           and grantor_role.rolname <> 'supabase_admin')
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
    raise exception 'runtime_rpc_execute_acl_hardening_role_graph_postcondition_failed';
  end if;
end;
$role_graph_postcondition$;

do $postcondition$
declare
  v_registry_owner oid;
begin
  select relowner into v_registry_owner
    from pg_catalog.pg_class
   where oid = 'public.faolla_schema_migrations'::regclass;

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
    raise exception
      'runtime_rpc_execute_acl_hardening_registry_acl_invariant_failed';
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
      join pg_catalog.pg_proc as function_metadata
        on function_metadata.oid = to_regprocedure(target.signature)
      cross join lateral pg_catalog.aclexplode(coalesce(
        function_metadata.proacl,
        pg_catalog.acldefault('f', function_metadata.proowner)
      )) as acl
      left join pg_catalog.pg_roles as grantee_metadata
        on grantee_metadata.oid = acl.grantee
     where function_metadata.proowner <> to_regrole(current_user)
        or acl.grantor <> function_metadata.proowner
        or acl.privilege_type <> 'EXECUTE'
        or acl.is_grantable
        or (
          acl.grantee <> function_metadata.proowner
          and not (
            target.acl_mode = 'authenticated_only'
            and grantee_metadata.rolname = 'authenticated'
            and acl.privilege_type = 'EXECUTE' and not acl.is_grantable
          )
          and not (
            target.acl_mode = 'service_only'
            and grantee_metadata.rolname = 'service_role'
            and acl.privilege_type = 'EXECUTE' and not acl.is_grantable
          )
        )
  ) or exists (
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
      join pg_catalog.pg_proc as function_metadata
        on function_metadata.oid = to_regprocedure(target.signature)
     where 1 <> (
       select count(*)
         from pg_catalog.aclexplode(coalesce(
           function_metadata.proacl,
           pg_catalog.acldefault('f', function_metadata.proowner)
         )) as owner_acl
        where owner_acl.grantee = function_metadata.proowner
          and owner_acl.grantor = function_metadata.proowner
          and owner_acl.privilege_type = 'EXECUTE'
          and not owner_acl.is_grantable
     ) or (
       target.acl_mode <> 'owner_only'
       and 1 <> (
         select count(*)
           from pg_catalog.aclexplode(coalesce(
             function_metadata.proacl,
             pg_catalog.acldefault('f', function_metadata.proowner)
           )) as allowed_acl
           join pg_catalog.pg_roles as allowed_role
             on allowed_role.oid = allowed_acl.grantee
          where allowed_acl.grantor = function_metadata.proowner
            and allowed_acl.privilege_type = 'EXECUTE'
            and not allowed_acl.is_grantable
            and (
              (target.acl_mode = 'authenticated_only'
                and allowed_role.rolname = 'authenticated')
              or (target.acl_mode = 'service_only'
                and allowed_role.rolname = 'service_role')
            )
       )
     )
  ) then
    raise exception 'runtime_rpc_execute_acl_hardening_acl_invariant_failed';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_roles as creator
     where creator.rolname !~ '^pg_'
       and (
         creator.oid in (
           to_regrole(current_user), to_regrole(session_user),
           to_regrole('postgres'), to_regrole('supabase_admin'),
           (select relowner from pg_catalog.pg_class
             where oid = 'public.faolla_schema_migrations'::regclass)
         )
         or pg_catalog.has_schema_privilege(
           creator.oid, 'public'::regnamespace, 'CREATE'
         )
       )
       and (
         not exists (
           select 1
             from pg_catalog.pg_default_acl as default_acl
            where default_acl.defaclrole = creator.oid
              and default_acl.defaclnamespace = 0
              and default_acl.defaclobjtype = 'f'
         )
         or 1 <> (
           select count(*)
             from pg_catalog.pg_default_acl as default_acl
             cross join lateral pg_catalog.aclexplode(
               default_acl.defaclacl
             ) as acl
            where default_acl.defaclrole = creator.oid
              and default_acl.defaclnamespace = 0
              and default_acl.defaclobjtype = 'f'
              and acl.privilege_type = 'EXECUTE'
              and acl.grantee = creator.oid
              and acl.grantor = creator.oid
              and not acl.is_grantable
         )
       )
  ) or exists (
    select 1
      from pg_catalog.pg_default_acl as default_acl
      cross join lateral pg_catalog.aclexplode(default_acl.defaclacl) as acl
     where default_acl.defaclnamespace in (0, 'public'::regnamespace)
       and default_acl.defaclobjtype = 'f'
       and (
         acl.privilege_type <> 'EXECUTE'
         or acl.grantee <> default_acl.defaclrole
         or acl.grantor <> default_acl.defaclrole
         or acl.is_grantable
       )
  ) then
    raise exception 'runtime_rpc_execute_acl_hardening_default_acl_invariant_failed';
  end if;
end;
$postcondition$;

-- GRANT/REVOKE has now taken catalog locks on every target. Recheck the full
-- immutable definition contract before registration so a concurrent
-- CREATE OR REPLACE, owner change, or overload cannot be authorized in the
-- preflight-to-ACL window.
do $definition_postcondition$
begin
  if exists (
    select 1
      from (values
        ('public.faolla_is_merchant_owner(text)', 'faolla_is_merchant_owner',
          '2550db5fceadbc06c3f640c28cba596b', 'sql', 'boolean', false, 's',
          array['target_merchant_id']::text[], 0, null::text),
        ('public.faolla_upsert_merchant_order_v1(jsonb,jsonb,jsonb)',
          'faolla_upsert_merchant_order_v1', '5b66943fa0f00091bc3f98a486b8a3fc',
          'plpgsql', 'void', false, 'v', array['p_order','p_items','p_event']::text[], 0, null::text),
        ('public.faolla_upsert_merchant_orders_v1(jsonb)',
          'faolla_upsert_merchant_orders_v1', '80fc055c83d0b6dafb6c50cce8ecd3d2',
          'plpgsql', 'integer', false, 'v', array['p_mutations']::text[], 0, null::text),
        ('public.faolla_upsert_merchant_membership_ledger_v1(jsonb)',
          'faolla_upsert_merchant_membership_ledger_v1', '70e51fb43366605c8b654440b6820663',
          'plpgsql', 'integer', false, 'v', array['p_mutations']::text[], 0, null::text),
        ('public.faolla_upsert_merchant_bookings_v1(jsonb)',
          'faolla_upsert_merchant_bookings_v1', '4de6159dcb1edd76659297849b9f5562',
          'plpgsql', 'integer', false, 'v', array['p_mutations']::text[], 0, null::text),
        ('public.faolla_resolve_merchant_customer_v1(text,jsonb,text)',
          'faolla_resolve_merchant_customer_v1', 'e8311560cc1388d3602562d03e4410f9',
          'plpgsql', 'uuid', false, 'v', array['p_merchant_id','p_customer','p_source']::text[], 0, null::text),
        ('public.faolla_upsert_merchant_coupons_v1(jsonb)',
          'faolla_upsert_merchant_coupons_v1', 'ce60afd21a2d1b0644c17e8cfe205a6c',
          'plpgsql', 'integer', false, 'v', array['p_mutations']::text[], 0, null::text),
        ('public.faolla_upsert_merchant_conversations_v1(jsonb)',
          'faolla_upsert_merchant_conversations_v1', '955d4b2a5c71fd35c27b29fa8e5930b6',
          'plpgsql', 'integer', false, 'v', array['p_mutations']::text[], 0, null::text),
        ('public.faolla_enqueue_merchant_outbox_v1(jsonb)',
          'faolla_enqueue_merchant_outbox_v1', '607e96cfe9866788fe51d9213fdd09b3',
          'plpgsql', 'jsonb', false, 'v', array['p_event']::text[], 0, null::text),
        ('public.faolla_claim_merchant_outbox_v1(text,integer,integer,text[])',
          'faolla_claim_merchant_outbox_v1', '093ee3ad734776481a9c0c1cb8cc106b',
          'plpgsql', 'public.merchant_outbox_events', true, 'v',
          array['p_worker_id','p_limit','p_lease_seconds','p_event_types']::text[], 3,
          '10, 60, NULL::text[]'),
        ('public.faolla_renew_merchant_outbox_lease_v1(uuid,text,integer)',
          'faolla_renew_merchant_outbox_lease_v1', 'fc5e7b5c87b145ad2aa36e4d69640d33',
          'plpgsql', 'boolean', false, 'v',
          array['p_event_id','p_worker_id','p_lease_seconds']::text[], 1, '60'),
        ('public.faolla_complete_merchant_outbox_v1(uuid,text,jsonb)',
          'faolla_complete_merchant_outbox_v1', 'ef0b107dd380ca3911d81458a6d65ddc',
          'plpgsql', 'boolean', false, 'v',
          array['p_event_id','p_worker_id','p_result']::text[], 1, '''{}''::jsonb'),
        ('public.faolla_fail_merchant_outbox_v1(uuid,text,text,text,boolean,integer)',
          'faolla_fail_merchant_outbox_v1', '8257998a8a5121e8d4076ff0cc66a883',
          'plpgsql', 'jsonb', false, 'v', array['p_event_id','p_worker_id',
            'p_error_code','p_error_message','p_retryable','p_retry_after_seconds']::text[],
          3, 'NULL::text, true, NULL::integer'),
        ('public.faolla_replay_merchant_outbox_v1(uuid,text,text)',
          'faolla_replay_merchant_outbox_v1', 'c22704e4f5509abad6af841cef776f4c',
          'plpgsql', 'boolean', false, 'v',
          array['p_event_id','p_replayed_by','p_reason_code']::text[], 0, null::text),
        ('public.faolla_claim_merchant_outbox_scoped_v1(text,text[],text[],integer,integer)',
          'faolla_claim_merchant_outbox_scoped_v1', '798846e64dc8981d068da499ed455312',
          'plpgsql', 'public.merchant_outbox_events', true, 'v',
          array['p_worker_id','p_merchant_ids','p_event_types','p_limit','p_lease_seconds']::text[],
          2, '10, 60'),
        ('public.faolla_get_merchant_outbox_health_v1(text,integer)',
          'faolla_get_merchant_outbox_health_v1', 'd6e551d94023bd72764e7589381e4d14',
          'plpgsql', 'jsonb', false, 's',
          array['p_merchant_id','p_window_hours']::text[], 2, 'NULL::text, 24')
      ) as expected(
        signature, function_name, source_md5, language_name, return_type,
        returns_set, volatility, argument_names, argument_defaults,
        default_expression
      )
      left join pg_catalog.pg_proc as function_metadata
        on function_metadata.oid = to_regprocedure(expected.signature)
      left join pg_catalog.pg_language as language_metadata
        on language_metadata.oid = function_metadata.prolang
     where function_metadata.oid is null
        or function_metadata.pronamespace <> 'public'::regnamespace
        or function_metadata.proname <> expected.function_name
        or function_metadata.proowner <> to_regrole(current_user)
        or function_metadata.prokind <> 'f'
        or language_metadata.lanname <> expected.language_name
        or function_metadata.prorettype <> to_regtype(expected.return_type)
        or function_metadata.proretset <> expected.returns_set
        or function_metadata.prosecdef is not true
        or function_metadata.provolatile <> expected.volatility
        or function_metadata.proparallel <> 'u'
        or function_metadata.proconfig is distinct from array['search_path=public']::text[]
        or function_metadata.proisstrict
        or function_metadata.proleakproof
        or function_metadata.pronargs <> cardinality(expected.argument_names)
        or function_metadata.pronargdefaults <> expected.argument_defaults
        or function_metadata.proargnames is distinct from expected.argument_names
        or pg_catalog.pg_get_expr(function_metadata.proargdefaults, 0)
          is distinct from expected.default_expression
        or function_metadata.proargmodes is not null
        or function_metadata.proallargtypes is not null
        or pg_catalog.md5(pg_catalog.replace(
          function_metadata.prosrc, E'\r\n', E'\n'
        )) <> expected.source_md5
        or 1 <> (
          select count(*) from pg_catalog.pg_proc as overload
           where overload.pronamespace = 'public'::regnamespace
             and overload.proname = expected.function_name
        )
  ) then
    raise exception 'runtime_rpc_execute_acl_hardening_definition_postcondition_failed';
  end if;
end;
$definition_postcondition$;

insert into public.faolla_schema_migrations(version, name)
values (202608190039, 'runtime_rpc_execute_acl_hardening')
on conflict (version) do nothing;

do $registry_postcondition$
declare
  v_registry_owner oid;
begin
  select relowner into strict v_registry_owner
    from pg_catalog.pg_class
   where oid = 'public.faolla_schema_migrations'::regclass;

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
    raise exception
      'runtime_rpc_execute_acl_hardening_registry_acl_invariant_failed';
  end if;

  if 1 <> (
    select count(*)
      from public.faolla_schema_migrations
     where version = 202608190039
       and name = 'runtime_rpc_execute_acl_hardening'
  ) or exists (
    select 1
      from public.faolla_schema_migrations
     where version = 202608190039
       and name <> 'runtime_rpc_execute_acl_hardening'
  ) then
    raise exception 'runtime_rpc_execute_acl_hardening_registry_postcondition_failed';
  end if;
end;
$registry_postcondition$;

notify pgrst, 'reload schema';

commit;
