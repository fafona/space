\set ON_ERROR_STOP on
\pset pager off

select enterprise_integration.assert_true(
  (
    select extension_namespace.nspname = 'extensions'
      from pg_catalog.pg_extension as extension_metadata
      join pg_catalog.pg_namespace as extension_namespace
        on extension_namespace.oid = extension_metadata.extnamespace
     where extension_metadata.extname = 'pgcrypto'
  )
  and to_regprocedure('extensions.digest(bytea,text)') is not null
  and to_regprocedure('extensions.digest(text,text)') is not null
  and to_regprocedure('public.digest(bytea,text)') is null
  and to_regprocedure('public.digest(text,text)') is null,
  '042 did not retain the hosted extensions-only pgcrypto layout'
);

with expected(
  signature,
  source_md5,
  digest_count,
  acl_mode
) as (
  values
    ('public.faolla_begin_merchant_employee_invitation_exchange_v1(jsonb)',
      'aa9e0203469de98b0da0b7c3b23d87a1', 1, 'service'),
    ('public.faolla_bind_merchant_employee_invitation_identity_v2(jsonb)',
      '897e075e63d93f995d74f42bd71432b9', 3, 'service'),
    ('public.faolla_complete_merchant_employee_invitation_delivery_v1(jsonb)',
      '3e66f5fdb159a04bad2637695afca05a', 1, 'service'),
    ('public.faolla_create_merchant_enterprise_employee_invitation_v2(jsonb)',
      '31eff80d7894509ca2033ae846db4b4f', 1, 'service'),
    ('public.faolla_fail_merchant_outbox_v1(uuid,text,text,text,boolean,integer)',
      '36c3010e94db4ba1618a4c636faa4577', 1, 'service'),
    ('public.faolla_lookup_merchant_enterprise_staff_identity_v1(text)',
      'e8119318f0b31a58d684cd8b15102867', 1, 'service'),
    ('public.faolla_mark_merchant_employee_invitation_exchange_issued_v1(jsonb)',
      'a238928720ea9a0e24e4704a7f5c30e8', 1, 'service'),
    ('public.faolla_prepare_merchant_employee_invitation_delivery_v1(jsonb)',
      'ab3433f462c47356aaa9371a49e75b66', 1, 'service'),
    ('public.faolla_recheck_merchant_employee_invitation_exchange_v1(jsonb)',
      'fc5dcddf341a78201072411845bb8af2', 1, 'service'),
    ('public.faolla_schedule_merchant_employee_invitation_delivery_v2(jsonb)',
      'cefbd251b31556168ae677b780026f4c', 1, 'service'),
    ('public.faolla_sync_merchant_enterprise_staff_identity_v1()',
      '6d0ac1e7cbbb7e519f8a3e82b7eea06b', 1, 'trigger')
), actual as (
  select
    expected.*,
    function_metadata.oid,
    function_metadata.prosrc,
    function_metadata.proowner,
    function_metadata.proacl,
    function_metadata.prosecdef,
    function_metadata.proconfig,
    function_metadata.provolatile,
    function_metadata.proparallel
  from expected
  left join pg_catalog.pg_proc as function_metadata
    on function_metadata.oid =
      pg_catalog.to_regprocedure(expected.signature)
)
select enterprise_integration.assert_true(
  count(*) = 11
  and pg_catalog.bool_and(oid is not null)
  and pg_catalog.bool_and(proowner = 'supabase_admin'::regrole)
  and pg_catalog.bool_and(prosecdef)
  and pg_catalog.bool_and(proconfig = array['search_path=public']::text[])
  and pg_catalog.bool_and(proparallel = 'u')
  and pg_catalog.bool_and(
    pg_catalog.md5(pg_catalog.replace(prosrc, E'\r\n', E'\n')) =
      source_md5
  )
  and pg_catalog.bool_and(
    prosrc !~ '(^|[^.[:alnum:]_])digest[[:space:]]*\('
  )
  and pg_catalog.bool_and(
    (
      pg_catalog.length(prosrc) -
      pg_catalog.length(pg_catalog.replace(
        prosrc,
        'extensions.digest(',
        ''
      ))
    ) / pg_catalog.length('extensions.digest(') = digest_count
  )
  and pg_catalog.bool_and(
    not pg_catalog.has_function_privilege('anon', signature, 'EXECUTE')
  )
  and pg_catalog.bool_and(
    not pg_catalog.has_function_privilege(
      'authenticated', signature, 'EXECUTE'
    )
  )
  and pg_catalog.bool_and(
    case acl_mode
      when 'service' then
        pg_catalog.has_function_privilege('service_role', signature, 'EXECUTE')
      else
        not pg_catalog.has_function_privilege(
          'service_role', signature, 'EXECUTE'
        )
    end
  ),
  '042 function source, schema qualification, or ACL postcondition failed'
)
from actual;

select enterprise_integration.assert_true(
  1 = (
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
  ),
  '042 changed the staff identity synchronization trigger'
);

-- A missing hash forces the lookup RPC to scan Auth email candidates and call
-- the repaired digest. This is the smallest runtime reproduction of the 42883
-- failure that production exposed through PostgREST as HTTP 404.
set role service_role;
select enterprise_integration.assert_true(
  public.faolla_lookup_merchant_enterprise_staff_identity_v1(
    repeat('f', 64)
  ) ->> 'source' = 'none',
  '042 lookup runtime still cannot resolve extensions.digest'
);
reset role;

-- Even a hostile same-named public function cannot intercept the qualified
-- calls. It is installed only in this disposable integration database.
set role supabase_admin;
create function public.digest(bytea, text)
returns bytea
language plpgsql
as $$
begin
  raise exception 'public_digest_hijacked';
end;
$$;
create function public.digest(text, text)
returns bytea
language plpgsql
as $$
begin
  raise exception 'public_digest_hijacked';
end;
$$;
reset role;
set role service_role;
select enterprise_integration.assert_true(
  public.faolla_lookup_merchant_enterprise_staff_identity_v1(
    repeat('e', 64)
  ) ->> 'source' = 'none',
  '042 qualified lookup was intercepted by public.digest'
);
reset role;

-- Reproduce the exact legacy delivery state: Auth creation already succeeded,
-- while an invited employee still has no auth_user_id. V1 bind must fire the
-- repaired trigger and atomically materialize the immutable identity row.
insert into auth.users (id, email, raw_app_meta_data)
values (
  'f4200000-0000-4000-8000-000000000001'::uuid,
  'pgcrypto-repair-bind@example.test',
  jsonb_build_object(
    'principal_type', 'merchant_staff',
    'merchant_staff_email_hash', encode(
      extensions.digest(
        convert_to('pgcrypto-repair-bind@example.test', 'UTF8'),
        'sha256'
      ),
      'hex'
    )
  )
);
insert into public.merchant_enterprise_employees (
  id,
  merchant_id,
  email,
  display_name,
  status,
  version,
  invitation_version,
  invitation_expires_at,
  invitation_delivery_status
) values (
  'f4200000-0000-4000-8000-000000000002'::uuid,
  '10000001',
  'pgcrypto-repair-bind@example.test',
  'Pgcrypto repair bind',
  'invited',
  1,
  1,
  statement_timestamp() + interval '7 days',
  'failed'
);

set role service_role;
select public.faolla_bind_merchant_employee_auth_user_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'employee_id', 'f4200000-0000-4000-8000-000000000002',
    'auth_user_id', 'f4200000-0000-4000-8000-000000000001',
    'expected_version', 1,
    'invitation_version', 1,
    'actor_type', 'system'
  )
);
reset role;

select enterprise_integration.assert_true(
  (
    select employee.auth_user_id =
      'f4200000-0000-4000-8000-000000000001'::uuid
      from public.merchant_enterprise_employees as employee
     where employee.id =
       'f4200000-0000-4000-8000-000000000002'::uuid
  )
  and exists (
    select 1
      from public.merchant_enterprise_staff_identities as identity
     where identity.auth_user_id =
       'f4200000-0000-4000-8000-000000000001'::uuid
       and identity.email_hash = encode(
         extensions.digest(
           convert_to('pgcrypto-repair-bind@example.test', 'UTF8'),
           'sha256'
         ),
         'hex'
       )
  ),
  '042 did not repair the legacy V1 bind and identity trigger path'
);

-- Exercise the generic outbox retry branch with retry_after_seconds omitted;
-- this is the otherwise-latent digest call inherited from migration 007.
set role service_role;
select result ->> 'id' as pgcrypto_repair_outbox_event
from (
  select public.faolla_enqueue_merchant_outbox_v1(
    jsonb_build_object(
      'merchant_id', '10000001',
      'event_key', 'integration/pgcrypto-schema-repair/1',
      'event_type', 'integration.pgcrypto_repair',
      'aggregate_type', 'integration',
      'aggregate_id', 'pgcrypto-schema-repair',
      'payload', '{}'::jsonb,
      'max_attempts', 3
    )
  ) as result
) as enqueued
\gset

select id::text as pgcrypto_repair_claimed_event
from public.faolla_claim_merchant_outbox_v1(
  'integration-pgcrypto-repair-worker',
  1,
  60,
  array['integration.pgcrypto_repair']::text[]
)
\gset

select result ->> 'status' as pgcrypto_repair_failure_status
from (
  select public.faolla_fail_merchant_outbox_v1(
    :'pgcrypto_repair_outbox_event'::uuid,
    'integration-pgcrypto-repair-worker',
    'integration_retry',
    'retry without explicit delay',
    true,
    null
  ) as result
) as failed
\gset
reset role;

select enterprise_integration.assert_true(
  :'pgcrypto_repair_claimed_event' = :'pgcrypto_repair_outbox_event'
  and :'pgcrypto_repair_failure_status' = 'retry_scheduled',
  '042 did not repair the generic outbox retry digest branch'
);

set role supabase_admin;
drop function public.digest(bytea, text);
drop function public.digest(text, text);
reset role;
