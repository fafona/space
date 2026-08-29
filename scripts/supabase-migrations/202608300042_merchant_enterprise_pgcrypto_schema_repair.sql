-- Repair the production-only pgcrypto schema mismatch without widening any
-- SECURITY DEFINER search path. The eleven existing functions are replaced in
-- place after exact catalog/source checks; no business-table row or ACL is
-- changed.

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
    raise exception 'merchant_enterprise_pgcrypto_schema_repair_untrusted_migrator';
  end if;
end;
$migrator_preflight$;

select pg_catalog.pg_advisory_xact_lock(20260731, 1);

-- Freeze the same security catalogs and in the same order as the preceding
-- hardening migrations. This keeps owner, role, definition, and ACL checks
-- stable across every CREATE OR REPLACE FUNCTION below.
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

do $repair$
declare
  v_registered boolean;
  v_expected record;
  v_function_oid oid;
  v_before_source text;
  v_before_definition text;
  v_repaired_definition text;
  v_after_source text;
begin
  if current_user <> 'supabase_admin'
     or not exists (
       select 1
         from pg_catalog.pg_roles as role_metadata
        where role_metadata.rolname = current_user
          and role_metadata.rolsuper
     ) then
    raise exception 'merchant_enterprise_pgcrypto_schema_repair_untrusted_migrator';
  end if;

  if exists (
    select 1
      from public.faolla_schema_migrations
     where version = 202608300042
       and name <> 'merchant_enterprise_pgcrypto_schema_repair'
  ) then
    raise exception 'merchant_enterprise_pgcrypto_schema_repair_registry_conflict';
  end if;

  select exists (
    select 1
      from public.faolla_schema_migrations
     where version = 202608300042
       and name = 'merchant_enterprise_pgcrypto_schema_repair'
  ) into v_registered;

  if to_regrole('supabase_admin') is null
     or to_regrole('postgres') is null
     or to_regrole('service_role') is null
     or to_regrole('anon') is null
     or to_regrole('authenticated') is null
     or to_regclass('auth.users') is null
     or to_regclass('public.merchant_enterprise_employees') is null
     or to_regclass('public.merchant_enterprise_staff_identities') is null
     or not exists (
       select 1
         from public.faolla_schema_migrations
        where version = 202607250007
          and name = 'reliable_outbox_runtime'
     )
     or not exists (
       select 1
         from public.faolla_schema_migrations
        where version = 202608190033
          and name = 'merchant_enterprise_invitation_delivery_outbox'
     )
     or not exists (
       select 1
         from public.faolla_schema_migrations
        where version = 202608190039
          and name = 'runtime_rpc_execute_acl_hardening'
     )
     or not exists (
       select 1
         from public.faolla_schema_migrations
        where version = 202608280041
          and name = 'merchant_staff_business_permissions'
     ) then
    raise exception 'merchant_enterprise_pgcrypto_schema_repair_prerequisite_missing';
  end if;

  if not exists (
       select 1
         from pg_catalog.pg_extension as extension_metadata
         join pg_catalog.pg_namespace as extension_namespace
           on extension_namespace.oid = extension_metadata.extnamespace
        where extension_metadata.extname = 'pgcrypto'
          and extension_namespace.nspname = 'extensions'
     )
     or to_regprocedure('extensions.digest(bytea,text)') is null
     or to_regprocedure('extensions.digest(text,text)') is null
     or to_regprocedure('public.digest(bytea,text)') is not null
     or to_regprocedure('public.digest(text,text)') is not null
     or not exists (
       select 1
         from pg_catalog.pg_depend as dependency
         join pg_catalog.pg_extension as extension_metadata
           on extension_metadata.oid = dependency.refobjid
        where dependency.classid = 'pg_catalog.pg_proc'::regclass
          and dependency.objid =
            'extensions.digest(bytea,text)'::regprocedure
          and dependency.refclassid = 'pg_catalog.pg_extension'::regclass
          and dependency.deptype = 'e'
          and extension_metadata.extname = 'pgcrypto'
     )
     or not exists (
       select 1
         from pg_catalog.pg_depend as dependency
         join pg_catalog.pg_extension as extension_metadata
           on extension_metadata.oid = dependency.refobjid
        where dependency.classid = 'pg_catalog.pg_proc'::regclass
          and dependency.objid =
            'extensions.digest(text,text)'::regprocedure
          and dependency.refclassid = 'pg_catalog.pg_extension'::regclass
          and dependency.deptype = 'e'
          and extension_metadata.extname = 'pgcrypto'
     )
     or not pg_catalog.has_schema_privilege(
       'supabase_admin', 'extensions', 'USAGE'
     )
     or not pg_catalog.has_function_privilege(
       'supabase_admin', 'extensions.digest(bytea,text)', 'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'supabase_admin', 'extensions.digest(text,text)', 'EXECUTE'
     )
     or pg_catalog.has_schema_privilege('anon', 'extensions', 'CREATE')
     or pg_catalog.has_schema_privilege(
       'authenticated', 'extensions', 'CREATE'
     )
     or pg_catalog.has_schema_privilege(
       'service_role', 'extensions', 'CREATE'
     ) then
    raise exception 'merchant_enterprise_pgcrypto_schema_repair_extension_invalid';
  end if;

  -- The trigger shape is security-critical: replacement must retain its OID so
  -- this AFTER INSERT/UPDATE-OF hook continues to run for every replication
  -- origin exactly as it did before the repair.
  if 1 <> (
    select count(*)
      from pg_catalog.pg_trigger as trigger_metadata
     where trigger_metadata.tgrelid =
       'public.merchant_enterprise_employees'::regclass
       and trigger_metadata.tgname =
         'merchant_enterprise_employees_staff_identity_sync'
       and trigger_metadata.tgfoid =
         'public.faolla_sync_merchant_enterprise_staff_identity_v1()'::regprocedure
       and trigger_metadata.tgtype = 21
       and trigger_metadata.tgenabled = 'O'
       and trigger_metadata.tgnargs = 0
       and trigger_metadata.tgattr = '3 4'::pg_catalog.int2vector
       and trigger_metadata.tgqual is null
       and not trigger_metadata.tgisinternal
  ) then
    raise exception 'merchant_enterprise_pgcrypto_schema_repair_trigger_invalid';
  end if;

  for v_expected in
    select *
      from (values
        (
          'public.faolla_begin_merchant_employee_invitation_exchange_v1(jsonb)',
          'faolla_begin_merchant_employee_invitation_exchange_v1',
          '031ca32996cdf97b026b61b8a8b9fdec',
          'aa9e0203469de98b0da0b7c3b23d87a1',
          'jsonb', 'v', 1, array['p_input']::text[], 0, null::text,
          array[
            'supabase_admin=X/supabase_admin'::pg_catalog.aclitem,
            'postgres=X/supabase_admin'::pg_catalog.aclitem,
            'service_role=X/supabase_admin'::pg_catalog.aclitem
          ]::pg_catalog.aclitem[]
        ),
        (
          'public.faolla_bind_merchant_employee_invitation_identity_v2(jsonb)',
          'faolla_bind_merchant_employee_invitation_identity_v2',
          '7100ad0b517c0d68f1ad5c11a80a0c10',
          '897e075e63d93f995d74f42bd71432b9',
          'jsonb', 'v', 3, array['p_input']::text[], 0, null::text,
          array[
            'supabase_admin=X/supabase_admin'::pg_catalog.aclitem,
            'postgres=X/supabase_admin'::pg_catalog.aclitem,
            'service_role=X/supabase_admin'::pg_catalog.aclitem
          ]::pg_catalog.aclitem[]
        ),
        (
          'public.faolla_complete_merchant_employee_invitation_delivery_v1(jsonb)',
          'faolla_complete_merchant_employee_invitation_delivery_v1',
          '10382a58cade0512e2649347663f2ea4',
          '3e66f5fdb159a04bad2637695afca05a',
          'jsonb', 'v', 1, array['p_input']::text[], 0, null::text,
          array[
            'supabase_admin=X/supabase_admin'::pg_catalog.aclitem,
            'postgres=X/supabase_admin'::pg_catalog.aclitem,
            'service_role=X/supabase_admin'::pg_catalog.aclitem
          ]::pg_catalog.aclitem[]
        ),
        (
          'public.faolla_create_merchant_enterprise_employee_invitation_v2(jsonb)',
          'faolla_create_merchant_enterprise_employee_invitation_v2',
          'f7122c8bb4fc4ed375b4826823df9201',
          '31eff80d7894509ca2033ae846db4b4f',
          'jsonb', 'v', 1, array['p_input']::text[], 0, null::text,
          array[
            'supabase_admin=X/supabase_admin'::pg_catalog.aclitem,
            'postgres=X/supabase_admin'::pg_catalog.aclitem,
            'service_role=X/supabase_admin'::pg_catalog.aclitem
          ]::pg_catalog.aclitem[]
        ),
        (
          'public.faolla_fail_merchant_outbox_v1(uuid,text,text,text,boolean,integer)',
          'faolla_fail_merchant_outbox_v1',
          '8257998a8a5121e8d4076ff0cc66a883',
          '36c3010e94db4ba1618a4c636faa4577',
          'jsonb', 'v', 1,
          array[
            'p_event_id', 'p_worker_id', 'p_error_code',
            'p_error_message', 'p_retryable', 'p_retry_after_seconds'
          ]::text[],
          3, 'NULL::text, true, NULL::integer',
          array[
            'supabase_admin=X/supabase_admin'::pg_catalog.aclitem,
            'service_role=X/supabase_admin'::pg_catalog.aclitem
          ]::pg_catalog.aclitem[]
        ),
        (
          'public.faolla_lookup_merchant_enterprise_staff_identity_v1(text)',
          'faolla_lookup_merchant_enterprise_staff_identity_v1',
          '3364d153fd3176b0f847743c9e9e9371',
          'e8119318f0b31a58d684cd8b15102867',
          'jsonb', 's', 1, array['p_email_hash']::text[], 0, null::text,
          array[
            'supabase_admin=X/supabase_admin'::pg_catalog.aclitem,
            'postgres=X/supabase_admin'::pg_catalog.aclitem,
            'service_role=X/supabase_admin'::pg_catalog.aclitem
          ]::pg_catalog.aclitem[]
        ),
        (
          'public.faolla_mark_merchant_employee_invitation_exchange_issued_v1(jsonb)',
          'faolla_mark_merchant_employee_invitation_exchange_issued_v1',
          'e8c68f68895e1777ebbd6e6a3d6db551',
          'a238928720ea9a0e24e4704a7f5c30e8',
          'jsonb', 'v', 1, array['p_input']::text[], 0, null::text,
          array[
            'supabase_admin=X/supabase_admin'::pg_catalog.aclitem,
            'postgres=X/supabase_admin'::pg_catalog.aclitem,
            'service_role=X/supabase_admin'::pg_catalog.aclitem
          ]::pg_catalog.aclitem[]
        ),
        (
          'public.faolla_prepare_merchant_employee_invitation_delivery_v1(jsonb)',
          'faolla_prepare_merchant_employee_invitation_delivery_v1',
          '71c68685e0c1ec1101464a3f2e36cece',
          'ab3433f462c47356aaa9371a49e75b66',
          'jsonb', 'v', 1, array['p_input']::text[], 0, null::text,
          array[
            'supabase_admin=X/supabase_admin'::pg_catalog.aclitem,
            'postgres=X/supabase_admin'::pg_catalog.aclitem,
            'service_role=X/supabase_admin'::pg_catalog.aclitem
          ]::pg_catalog.aclitem[]
        ),
        (
          'public.faolla_recheck_merchant_employee_invitation_exchange_v1(jsonb)',
          'faolla_recheck_merchant_employee_invitation_exchange_v1',
          'aaa84a9c3c44db2f04af9970cb85ad64',
          'fc5dcddf341a78201072411845bb8af2',
          'jsonb', 's', 1, array['p_input']::text[], 0, null::text,
          array[
            'supabase_admin=X/supabase_admin'::pg_catalog.aclitem,
            'postgres=X/supabase_admin'::pg_catalog.aclitem,
            'service_role=X/supabase_admin'::pg_catalog.aclitem
          ]::pg_catalog.aclitem[]
        ),
        (
          'public.faolla_schedule_merchant_employee_invitation_delivery_v2(jsonb)',
          'faolla_schedule_merchant_employee_invitation_delivery_v2',
          '12bc175a4da0452985e9d3aeaa0d123a',
          'cefbd251b31556168ae677b780026f4c',
          'jsonb', 'v', 1, array['p_input']::text[], 0, null::text,
          array[
            'supabase_admin=X/supabase_admin'::pg_catalog.aclitem,
            'postgres=X/supabase_admin'::pg_catalog.aclitem,
            'service_role=X/supabase_admin'::pg_catalog.aclitem
          ]::pg_catalog.aclitem[]
        ),
        (
          'public.faolla_sync_merchant_enterprise_staff_identity_v1()',
          'faolla_sync_merchant_enterprise_staff_identity_v1',
          'c7ba14a42946d31f4b39263b1e833aed',
          '6d0ac1e7cbbb7e519f8a3e82b7eea06b',
          'trigger', 'v', 1, null::text[], 0, null::text,
          array[
            'supabase_admin=X/supabase_admin'::pg_catalog.aclitem,
            'postgres=X/supabase_admin'::pg_catalog.aclitem
          ]::pg_catalog.aclitem[]
        )
      ) as expected(
        signature,
        function_name,
        source_md5,
        repaired_source_md5,
        return_type,
        volatility,
        digest_count,
        argument_names,
        argument_default_count,
        argument_defaults,
        expected_acl
      )
  loop
    v_function_oid := pg_catalog.to_regprocedure(v_expected.signature);
    if v_function_oid is null then
      raise exception
        'merchant_enterprise_pgcrypto_schema_repair_function_missing:%',
        v_expected.function_name;
    end if;

    select function_metadata.prosrc,
           pg_catalog.pg_get_functiondef(function_metadata.oid)
      into v_before_source, v_before_definition
      from pg_catalog.pg_proc as function_metadata
      join pg_catalog.pg_language as language_metadata
        on language_metadata.oid = function_metadata.prolang
     where function_metadata.oid = v_function_oid
       and function_metadata.pronamespace = 'public'::regnamespace
       and function_metadata.proname = v_expected.function_name
       and function_metadata.proowner = 'supabase_admin'::regrole
       and function_metadata.prokind = 'f'
       and language_metadata.lanname = 'plpgsql'
       and function_metadata.prorettype =
         pg_catalog.to_regtype(v_expected.return_type)
       and not function_metadata.proretset
       and function_metadata.prosecdef
       and function_metadata.provolatile::text = v_expected.volatility
       and function_metadata.proparallel = 'u'
       and function_metadata.proconfig is not distinct from
         array['search_path=public']::text[]
       and not function_metadata.proisstrict
       and not function_metadata.proleakproof
       and function_metadata.pronargs =
         coalesce(pg_catalog.cardinality(v_expected.argument_names), 0)
       and function_metadata.pronargdefaults =
         v_expected.argument_default_count
       and function_metadata.proargnames is not distinct from
         v_expected.argument_names
       and function_metadata.proargmodes is null
       and function_metadata.proallargtypes is null
       and pg_catalog.pg_get_expr(
         function_metadata.proargdefaults,
         0
       ) is not distinct from v_expected.argument_defaults
       and function_metadata.proacl is not distinct from
         v_expected.expected_acl
       and pg_catalog.md5(pg_catalog.replace(
         function_metadata.prosrc,
         E'\r\n',
         E'\n'
       )) = case
         when v_registered then v_expected.repaired_source_md5
         else v_expected.source_md5
       end
       and 1 = (
         select count(*)
           from pg_catalog.pg_proc as overload
          where overload.pronamespace = 'public'::regnamespace
            and overload.proname = v_expected.function_name
       );

    if not found then
      raise exception
        'merchant_enterprise_pgcrypto_schema_repair_function_prestate_invalid:%',
        v_expected.function_name;
    end if;

    if v_registered then
      if v_before_source ~
           '(^|[^.[:alnum:]_])digest[[:space:]]*\('
         or (
           pg_catalog.length(v_before_source) -
           pg_catalog.length(pg_catalog.replace(
             v_before_source,
             'extensions.digest(',
             ''
           ))
         ) / pg_catalog.length('extensions.digest(') <>
           v_expected.digest_count then
        raise exception
          'merchant_enterprise_pgcrypto_schema_repair_registered_body_invalid:%',
          v_expected.function_name;
      end if;
      continue;
    end if;

    if pg_catalog.strpos(v_before_source, 'extensions.digest(') <> 0
       or (
         pg_catalog.length(v_before_source) -
         pg_catalog.length(pg_catalog.replace(
           v_before_source,
           'digest(',
           ''
         ))
       ) / pg_catalog.length('digest(') <> v_expected.digest_count then
      raise exception
        'merchant_enterprise_pgcrypto_schema_repair_digest_prestate_invalid:%',
        v_expected.function_name;
    end if;

    v_repaired_definition := pg_catalog.replace(
      v_before_definition,
      'digest(',
      'extensions.digest('
    );
    if v_repaired_definition = v_before_definition then
      raise exception
        'merchant_enterprise_pgcrypto_schema_repair_noop:%',
        v_expected.function_name;
    end if;

    execute v_repaired_definition;

    select function_metadata.prosrc
      into v_after_source
      from pg_catalog.pg_proc as function_metadata
      join pg_catalog.pg_language as language_metadata
        on language_metadata.oid = function_metadata.prolang
     where function_metadata.oid = v_function_oid
       and function_metadata.pronamespace = 'public'::regnamespace
       and function_metadata.proname = v_expected.function_name
       and function_metadata.proowner = 'supabase_admin'::regrole
       and function_metadata.prokind = 'f'
       and language_metadata.lanname = 'plpgsql'
       and function_metadata.prorettype =
         pg_catalog.to_regtype(v_expected.return_type)
       and not function_metadata.proretset
       and function_metadata.prosecdef
       and function_metadata.provolatile::text = v_expected.volatility
       and function_metadata.proparallel = 'u'
       and function_metadata.proconfig is not distinct from
         array['search_path=public']::text[]
       and not function_metadata.proisstrict
       and not function_metadata.proleakproof
       and function_metadata.pronargs =
         coalesce(pg_catalog.cardinality(v_expected.argument_names), 0)
       and function_metadata.pronargdefaults =
         v_expected.argument_default_count
       and function_metadata.proargnames is not distinct from
         v_expected.argument_names
       and function_metadata.proargmodes is null
       and function_metadata.proallargtypes is null
       and pg_catalog.pg_get_expr(
         function_metadata.proargdefaults,
         0
       ) is not distinct from v_expected.argument_defaults
       and function_metadata.proacl is not distinct from
         v_expected.expected_acl
       and pg_catalog.md5(pg_catalog.replace(
         function_metadata.prosrc,
         E'\r\n',
         E'\n'
       )) = v_expected.repaired_source_md5;

    if not found
       or v_after_source is distinct from pg_catalog.replace(
         v_before_source,
         'digest(',
         'extensions.digest('
       )
       or v_after_source ~
         '(^|[^.[:alnum:]_])digest[[:space:]]*\('
       or (
         pg_catalog.length(v_after_source) -
         pg_catalog.length(pg_catalog.replace(
           v_after_source,
           'extensions.digest(',
           ''
         ))
       ) / pg_catalog.length('extensions.digest(') <>
         v_expected.digest_count then
      raise exception
        'merchant_enterprise_pgcrypto_schema_repair_function_poststate_invalid:%',
        v_expected.function_name;
    end if;
  end loop;

  if 1 <> (
    select count(*)
      from pg_catalog.pg_trigger as trigger_metadata
     where trigger_metadata.tgrelid =
       'public.merchant_enterprise_employees'::regclass
       and trigger_metadata.tgname =
         'merchant_enterprise_employees_staff_identity_sync'
       and trigger_metadata.tgfoid =
         'public.faolla_sync_merchant_enterprise_staff_identity_v1()'::regprocedure
       and trigger_metadata.tgtype = 21
       and trigger_metadata.tgenabled = 'O'
       and trigger_metadata.tgnargs = 0
       and trigger_metadata.tgattr = '3 4'::pg_catalog.int2vector
       and trigger_metadata.tgqual is null
       and not trigger_metadata.tgisinternal
  ) then
    raise exception 'merchant_enterprise_pgcrypto_schema_repair_trigger_changed';
  end if;

  insert into public.faolla_schema_migrations (version, name)
  values (202608300042, 'merchant_enterprise_pgcrypto_schema_repair')
  on conflict (version) do nothing;

  if not exists (
    select 1
      from public.faolla_schema_migrations
     where version = 202608300042
       and name = 'merchant_enterprise_pgcrypto_schema_repair'
  ) then
    raise exception
      'merchant_enterprise_pgcrypto_schema_repair_registry_postcondition_failed';
  end if;
end;
$repair$;

notify pgrst, 'reload schema';

commit;
