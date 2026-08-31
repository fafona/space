\set ON_ERROR_STOP on
\pset pager off

select enterprise_integration.assert_true(
  exists (
    select 1
      from public.faolla_schema_migrations
     where version = 202608310043
       and name = 'merchant_employee_initial_password_setup'
  ),
  '043 initial-password migration is not registered'
);

-- All rows that predate 043 are explicitly waived. New rows fail closed by
-- default, including while an older application instance is still serving.
select enterprise_integration.assert_true(
  not exists (
    select 1
      from public.merchant_enterprise_employees
     where initial_password_policy <> 'waived'
  ),
  '043 did not waive every pre-migration employee row'
);

select enterprise_integration.assert_true(
  column_metadata.is_nullable = 'NO'
  and column_metadata.column_default = '''required''::text'
  and exists (
    select 1
      from pg_catalog.pg_constraint as constraint_metadata
     where constraint_metadata.conrelid =
           'public.merchant_enterprise_employees'::regclass
       and constraint_metadata.conname =
           'merchant_employees_initial_password_policy_check'
       and constraint_metadata.contype = 'c'
       and constraint_metadata.convalidated
  ),
  '043 initial-password policy column/default/constraint is invalid'
)
from information_schema.columns as column_metadata
where column_metadata.table_schema = 'public'
  and column_metadata.table_name = 'merchant_enterprise_employees'
  and column_metadata.column_name = 'initial_password_policy';

-- PostgreSQL silently truncates identifiers after 63 bytes. Query the real
-- catalog names so a long source-level wrapper name cannot pass this test.
select enterprise_integration.assert_true(
  pg_catalog.to_regprocedure(
    'public.faolla_accept_employee_invite_pre043(jsonb)'
  ) is not null
  and pg_catalog.to_regprocedure(
    'public.faolla_bind_employee_invite_identity_pre043(jsonb)'
  ) is not null
  and not exists (
    select 1
      from pg_catalog.pg_proc as function_metadata
      join pg_catalog.pg_namespace as namespace_metadata
        on namespace_metadata.oid = function_metadata.pronamespace
     where namespace_metadata.nspname = 'public'
       and function_metadata.proname like
           'faolla_accept_merchant_employee_invitation_v1_preinitial%'
  )
  and not exists (
    select 1
      from pg_catalog.pg_proc as function_metadata
      join pg_catalog.pg_namespace as namespace_metadata
        on namespace_metadata.oid = function_metadata.pronamespace
     where namespace_metadata.nspname = 'public'
       and pg_catalog.octet_length(function_metadata.proname::text) > 63
       and function_metadata.proname like 'faolla%043%'
  ),
  '043 installed a missing or truncated private wrapper function'
);

with expected(signature, service_entry) as (
  values
    ('public.faolla_claim_merchant_employee_initial_password_setup_v1(jsonb)', true),
    ('public.faolla_complete_merchant_employee_initial_password_setup_v1(jsonb)', true),
    ('public.faolla_release_merchant_employee_initial_password_setup_v1(jsonb)', true),
    ('public.faolla_create_password_recovery_intent_v1(jsonb)', true),
    ('public.faolla_activate_password_recovery_grant_v1(jsonb)', true),
    ('public.faolla_validate_password_recovery_grant_v1(jsonb)', true),
    ('public.faolla_claim_password_recovery_grant_v1(jsonb)', true),
    ('public.faolla_complete_password_recovery_grant_v1(jsonb)', true),
    ('public.faolla_release_password_recovery_grant_v1(jsonb)', true),
    ('public.faolla_bind_merchant_employee_invitation_identity_v2(jsonb)', true),
    ('public.faolla_waive_employee_initial_password_v1(jsonb)', true),
    ('public.faolla_accept_merchant_employee_invitation_v1(jsonb)', true),
    ('public.faolla_bind_employee_invite_identity_pre043(jsonb)', false),
    ('public.faolla_accept_employee_invite_pre043(jsonb)', false)
), actual as (
  select
    expected.*,
    function_metadata.oid,
    function_metadata.proname,
    function_metadata.proowner,
    function_metadata.prosecdef,
    function_metadata.proconfig
  from expected
  left join pg_catalog.pg_proc as function_metadata
    on function_metadata.oid =
       pg_catalog.to_regprocedure(expected.signature)
)
select enterprise_integration.assert_true(
  count(*) = 14
  and pg_catalog.bool_and(oid is not null)
  and pg_catalog.bool_and(proowner = 'supabase_admin'::regrole)
  and pg_catalog.bool_and(prosecdef)
  and pg_catalog.bool_and(proconfig = array['search_path=public']::text[])
  and pg_catalog.bool_and(pg_catalog.octet_length(proname::text) <= 63)
  and pg_catalog.bool_and(
    not pg_catalog.has_function_privilege('anon', signature, 'EXECUTE')
  )
  and pg_catalog.bool_and(
    not pg_catalog.has_function_privilege(
      'authenticated', signature, 'EXECUTE'
    )
  )
  and pg_catalog.bool_and(
    pg_catalog.has_function_privilege(
      'service_role', signature, 'EXECUTE'
    ) = service_entry
  ),
  '043 RPC catalog metadata or execute ACL is invalid'
)
from actual;

select enterprise_integration.assert_true(
  position(
    'pg_advisory_xact_lock' in pg_catalog.pg_get_functiondef(
      'public.faolla_claim_merchant_employee_initial_password_setup_v1(jsonb)'::regprocedure
    )
  ) > 0
  and exists (
    select 1
      from pg_catalog.pg_index as index_metadata
      join pg_catalog.pg_class as index_relation
        on index_relation.oid = index_metadata.indexrelid
     where index_relation.relnamespace = 'public'::regnamespace
       and index_relation.relname =
           'merchant_employee_initial_password_claim_auth_uidx'
       and index_metadata.indisunique
       and index_metadata.indisvalid
       and pg_catalog.pg_get_expr(
             index_metadata.indpred,
             index_metadata.indrelid
           ) like '%state = ''claimed''%'
  ),
  '043 global Auth-subject advisory or unique claim fence is absent'
);

with expected(table_name) as (
  values
    ('merchant_employee_initial_password_setups'::text),
    ('auth_password_recovery_grants'::text)
), actual as (
  select expected.table_name,
         relation_metadata.oid,
         relation_metadata.relowner,
         relation_metadata.relrowsecurity
    from expected
    left join pg_catalog.pg_class as relation_metadata
      on relation_metadata.oid =
         pg_catalog.to_regclass('public.' || expected.table_name)
)
select enterprise_integration.assert_true(
  count(*) = 2
  and pg_catalog.bool_and(oid is not null)
  and pg_catalog.bool_and(relowner = 'supabase_admin'::regrole)
  and pg_catalog.bool_and(relrowsecurity)
  and pg_catalog.bool_and(
    pg_catalog.has_table_privilege(
      'service_role', 'public.' || table_name, 'SELECT'
    )
    and pg_catalog.has_table_privilege(
      'service_role', 'public.' || table_name, 'INSERT'
    )
    and pg_catalog.has_table_privilege(
      'service_role', 'public.' || table_name, 'UPDATE'
    )
    and pg_catalog.has_table_privilege(
      'service_role', 'public.' || table_name, 'DELETE'
    )
    and not pg_catalog.has_table_privilege(
      'anon', 'public.' || table_name, 'SELECT'
    )
    and not pg_catalog.has_table_privilege(
      'authenticated', 'public.' || table_name, 'SELECT'
    )
  ),
  '043 security table owner, RLS, or table ACL is invalid'
)
from actual;

set role authenticated;
select enterprise_integration.expect_error(
  $sql$
    select * from public.merchant_employee_initial_password_setups
  $sql$,
  'permission denied'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_claim_merchant_employee_initial_password_setup_v1(
      '{}'::jsonb
    )
  $sql$,
  'permission denied'
);
reset role;

set role anon;
select enterprise_integration.expect_error(
  $sql$
    select * from public.auth_password_recovery_grants
  $sql$,
  'permission denied'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_activate_password_recovery_grant_v1('{}'::jsonb)
  $sql$,
  'permission denied'
);
reset role;

select id::text as initial_password_role_a
  from public.merchant_enterprise_roles
 where merchant_id = '10000001'
   and system_key = 'employee'
\gset

select id::text as initial_password_role_b
  from public.merchant_enterprise_roles
 where merchant_id = '10000002'
   and system_key = 'employee'
\gset

insert into public.merchant_enterprise_employees (
  id,
  merchant_id,
  auth_user_id,
  email,
  display_name,
  role_id,
  status,
  invited_at,
  version,
  invitation_version,
  invitation_token_hash,
  invitation_expires_at,
  invitation_sent_at,
  invitation_delivery_status
) values
  (
    '65100000-0000-4000-8000-000000000001'::uuid,
    '10000001',
    '65000000-0000-4000-8000-000000000001'::uuid,
    'initial-complete-65@example.test',
    'Initial complete 65',
    :'initial_password_role_a'::uuid,
    'invited', statement_timestamp(), 1, 1, repeat('1', 64),
    statement_timestamp() + interval '1 day', statement_timestamp(), 'sent'
  ),
  (
    '65100000-0000-4000-8000-000000000002'::uuid,
    '10000001',
    '65000000-0000-4000-8000-000000000002'::uuid,
    'initial-lease-65@example.test',
    'Initial lease 65',
    :'initial_password_role_a'::uuid,
    'invited', statement_timestamp(), 1, 1, repeat('2', 64),
    statement_timestamp() + interval '1 day', statement_timestamp(), 'sent'
  ),
  (
    '65100000-0000-4000-8000-000000000003'::uuid,
    '10000001',
    '65000000-0000-4000-8000-000000000003'::uuid,
    'initial-cross-65@example.test',
    'Initial cross merchant A 65',
    :'initial_password_role_a'::uuid,
    'invited', statement_timestamp(), 1, 1, repeat('3', 64),
    statement_timestamp() + interval '1 day', statement_timestamp(), 'sent'
  ),
  (
    '65200000-0000-4000-8000-000000000003'::uuid,
    '10000002',
    '65000000-0000-4000-8000-000000000003'::uuid,
    'initial-cross-65@example.test',
    'Initial cross merchant B 65',
    :'initial_password_role_b'::uuid,
    'invited', statement_timestamp(), 1, 1, repeat('4', 64),
    statement_timestamp() + interval '1 day', statement_timestamp(), 'sent'
  ),
  (
    '65100000-0000-4000-8000-000000000004'::uuid,
    '10000001',
    '65000000-0000-4000-8000-000000000004'::uuid,
    'initial-waive-65@example.test',
    'Initial waive 65',
    :'initial_password_role_a'::uuid,
    'invited', statement_timestamp(), 1, 1, repeat('5', 64),
    statement_timestamp() + interval '1 day', statement_timestamp(), 'sent'
  );

select enterprise_integration.assert_true(
  5 = (
    select count(*)
      from public.merchant_enterprise_employees
     where id in (
       '65100000-0000-4000-8000-000000000001'::uuid,
       '65100000-0000-4000-8000-000000000002'::uuid,
       '65100000-0000-4000-8000-000000000003'::uuid,
       '65200000-0000-4000-8000-000000000003'::uuid,
       '65100000-0000-4000-8000-000000000004'::uuid
     )
       and initial_password_policy = 'required'
  ),
  'post-043 employees did not default to required'
);

-- Required invitations fail closed even when an older application calls the
-- service RPC without first creating a setup claim.
set role service_role;
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_accept_merchant_employee_invitation_v1(
      jsonb_build_object(
        'merchant_id', '10000001',
        'auth_user_id', '65000000-0000-4000-8000-000000000004',
        'invitation_version', 1,
        'token_hash', repeat('5', 64)
      )
    )
  $sql$,
  'employee_initial_password_setup_incomplete'
);
reset role;

select enterprise_integration.assert_true(
  (
    select status = 'invited'
       and accepted_at is null
       and initial_password_policy = 'required'
      from public.merchant_enterprise_employees
     where id = '65100000-0000-4000-8000-000000000004'::uuid
  ),
  'rejected required invitation changed employee state'
);

-- A server-validated existing-password account can explicitly waive setup.
set role service_role;
select enterprise_integration.assert_true(
  public.faolla_waive_employee_initial_password_v1(
    jsonb_build_object(
      'merchant_id', '10000001',
      'auth_user_id', '65000000-0000-4000-8000-000000000004',
      'invitation_version', 1,
      'token_hash', repeat('5', 64)
    )
  ) = jsonb_build_object('policy', 'waived', 'changed', true),
  'required invitation was not explicitly waived'
);
select public.faolla_accept_merchant_employee_invitation_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'auth_user_id', '65000000-0000-4000-8000-000000000004',
    'invitation_version', 1,
    'token_hash', repeat('5', 64)
  )
);
reset role;

select enterprise_integration.assert_true(
  (
    select status = 'active'
       and accepted_at is not null
       and initial_password_policy = 'waived'
      from public.merchant_enterprise_employees
     where id = '65100000-0000-4000-8000-000000000004'::uuid
  ),
  'waived invitation did not retain waived policy through acceptance'
);

-- Claim replay changes only the volatile operation id when the password
-- fingerprint is identical, allowing a refreshed browser to resume safely.
set role service_role;
select enterprise_integration.assert_true(
  (
    public.faolla_claim_merchant_employee_initial_password_setup_v1(
      jsonb_build_object(
        'merchant_id', '10000001',
        'auth_user_id', '65000000-0000-4000-8000-000000000001',
        'invitation_version', 1,
        'token_hash', repeat('1', 64),
        'operation_id', '65000001-0000-4000-8000-000000000001',
        'password_fingerprint', repeat('a', 64)
      )
    ) ->> 'resumed'
  )::boolean = false,
  'first setup claim was not new'
);
select enterprise_integration.assert_true(
  (
    public.faolla_claim_merchant_employee_initial_password_setup_v1(
      jsonb_build_object(
        'merchant_id', '10000001',
        'auth_user_id', '65000000-0000-4000-8000-000000000001',
        'invitation_version', 1,
        'token_hash', repeat('1', 64),
        'operation_id', '65000001-0000-4000-8000-000000000002',
        'password_fingerprint', repeat('a', 64)
      )
    ) ->> 'resumed'
  )::boolean,
  'same-password setup claim did not resume'
);
reset role;

select enterprise_integration.assert_true(
  (
    select state = 'claimed'
       and operation_id =
           '65000001-0000-4000-8000-000000000002'::uuid
       and password_fingerprint = repeat('a', 64)
       and claim_expires_at > statement_timestamp()
       and completed_at is null
      from public.merchant_employee_initial_password_setups
     where employee_id =
           '65100000-0000-4000-8000-000000000001'::uuid
  ),
  'same-password replay did not renew the exact claim'
);

-- Force an error after complete returned. Both the setup transition and the
-- employee policy update must roll back as one PostgreSQL statement.
set role service_role;
select enterprise_integration.expect_error(
  $sql$
    with mutation as materialized (
      select public.faolla_complete_merchant_employee_initial_password_setup_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'auth_user_id', '65000000-0000-4000-8000-000000000001',
          'invitation_version', 1,
          'token_hash', repeat('1', 64),
          'operation_id', '65000001-0000-4000-8000-000000000002',
          'password_fingerprint', repeat('a', 64)
        )
      ) as result
    )
    select pg_catalog.pg_column_size(result) /
           (pg_catalog.pg_column_size(result) - pg_catalog.pg_column_size(result))
      from mutation
  $sql$,
  'division by zero'
);
reset role;

select enterprise_integration.assert_true(
  (
    select state = 'claimed' and completed_at is null
      from public.merchant_employee_initial_password_setups
     where employee_id =
           '65100000-0000-4000-8000-000000000001'::uuid
  )
  and (
    select initial_password_policy = 'required'
      from public.merchant_enterprise_employees
     where id = '65100000-0000-4000-8000-000000000001'::uuid
  ),
  'failed complete did not atomically roll back setup and policy'
);

set role service_role;
select enterprise_integration.assert_true(
  (
    public.faolla_complete_merchant_employee_initial_password_setup_v1(
      jsonb_build_object(
        'merchant_id', '10000001',
        'auth_user_id', '65000000-0000-4000-8000-000000000001',
        'invitation_version', 1,
        'token_hash', repeat('1', 64),
        'operation_id', '65000001-0000-4000-8000-000000000002',
        'password_fingerprint', repeat('a', 64)
      )
    ) ->> 'state'
  ) = 'completed',
  'valid setup completion did not return completed'
);
select enterprise_integration.assert_true(
  (
    public.faolla_complete_merchant_employee_initial_password_setup_v1(
      jsonb_build_object(
        'merchant_id', '10000001',
        'auth_user_id', '65000000-0000-4000-8000-000000000001',
        'invitation_version', 1,
        'token_hash', repeat('1', 64),
        'operation_id', '65000001-0000-4000-8000-000000000002',
        'password_fingerprint', repeat('a', 64)
      )
    ) ->> 'state'
  ) = 'completed',
  'setup completion replay was not idempotent'
);
reset role;

select enterprise_integration.assert_true(
  (
    select setup.state = 'completed'
       and setup.claim_expires_at is null
       and setup.completed_at is not null
       and employee.initial_password_policy = 'completed'
      from public.merchant_employee_initial_password_setups as setup
      join public.merchant_enterprise_employees as employee
        on employee.id = setup.employee_id
     where setup.employee_id =
           '65100000-0000-4000-8000-000000000001'::uuid
  ),
  'complete did not atomically persist setup and employee policy'
);

set role service_role;
select public.faolla_accept_merchant_employee_invitation_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'auth_user_id', '65000000-0000-4000-8000-000000000001',
    'invitation_version', 1,
    'token_hash', repeat('1', 64)
  )
);
reset role;

select enterprise_integration.assert_true(
  (
    select status = 'active'
       and accepted_at is not null
       and initial_password_policy = 'completed'
      from public.merchant_enterprise_employees
     where id = '65100000-0000-4000-8000-000000000001'::uuid
  ),
  'completed invitation was not accepted'
);

-- A crashed setup may be reclaimed after its durable lease expires.
set role service_role;
select public.faolla_claim_merchant_employee_initial_password_setup_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'auth_user_id', '65000000-0000-4000-8000-000000000002',
    'invitation_version', 1,
    'token_hash', repeat('2', 64),
    'operation_id', '65000002-0000-4000-8000-000000000001',
    'password_fingerprint', repeat('b', 64)
  )
);
reset role;

update public.merchant_employee_initial_password_setups
   set claim_expires_at = statement_timestamp() - interval '1 second'
 where employee_id = '65100000-0000-4000-8000-000000000002'::uuid;

set role service_role;
select enterprise_integration.assert_true(
  (
    public.faolla_claim_merchant_employee_initial_password_setup_v1(
      jsonb_build_object(
        'merchant_id', '10000001',
        'auth_user_id', '65000000-0000-4000-8000-000000000002',
        'invitation_version', 1,
        'token_hash', repeat('2', 64),
        'operation_id', '65000002-0000-4000-8000-000000000002',
        'password_fingerprint', repeat('c', 64)
      )
    ) ->> 'resumed'
  )::boolean = false,
  'expired setup lease was not reclaimed'
);
reset role;

select enterprise_integration.assert_true(
  (
    select operation_id =
             '65000002-0000-4000-8000-000000000002'::uuid
       and password_fingerprint = repeat('c', 64)
       and claim_expires_at > statement_timestamp()
      from public.merchant_employee_initial_password_setups
     where employee_id =
           '65100000-0000-4000-8000-000000000002'::uuid
  ),
  'lease takeover did not replace the stale claim exactly'
);

set role service_role;
select enterprise_integration.assert_true(
  (
    public.faolla_release_merchant_employee_initial_password_setup_v1(
      jsonb_build_object(
        'merchant_id', '10000001',
        'auth_user_id', '65000000-0000-4000-8000-000000000002',
        'invitation_version', 1,
        'token_hash', repeat('2', 64),
        'operation_id', '65000002-0000-4000-8000-000000000002',
        'password_fingerprint', repeat('c', 64)
      )
    ) ->> 'released'
  )::boolean,
  'reclaimed setup lease was not releasable'
);
reset role;

-- The password belongs to one Auth subject globally. A claim in merchant A
-- blocks the same subject in merchant B until release or lease takeover.
set role service_role;
select public.faolla_claim_merchant_employee_initial_password_setup_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'auth_user_id', '65000000-0000-4000-8000-000000000003',
    'invitation_version', 1,
    'token_hash', repeat('3', 64),
    'operation_id', '65000003-0000-4000-8000-000000000001',
    'password_fingerprint', repeat('d', 64)
  )
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_claim_merchant_employee_initial_password_setup_v1(
      jsonb_build_object(
        'merchant_id', '10000002',
        'auth_user_id', '65000000-0000-4000-8000-000000000003',
        'invitation_version', 1,
        'token_hash', repeat('4', 64),
        'operation_id', '65000003-0000-4000-8000-000000000002',
        'password_fingerprint', repeat('e', 64)
      )
    )
  $sql$,
  'employee_initial_password_setup_in_progress'
);
reset role;

update public.merchant_employee_initial_password_setups
   set claim_expires_at = statement_timestamp() - interval '1 second'
 where employee_id = '65100000-0000-4000-8000-000000000003'::uuid;

set role service_role;
select enterprise_integration.assert_true(
  (
    public.faolla_claim_merchant_employee_initial_password_setup_v1(
      jsonb_build_object(
        'merchant_id', '10000002',
        'auth_user_id', '65000000-0000-4000-8000-000000000003',
        'invitation_version', 1,
        'token_hash', repeat('4', 64),
        'operation_id', '65000003-0000-4000-8000-000000000002',
        'password_fingerprint', repeat('e', 64)
      )
    ) ->> 'resumed'
  )::boolean = false,
  'cross-merchant expired claim was not taken over'
);
reset role;

select enterprise_integration.assert_true(
  1 = (
    select count(*)
      from public.merchant_employee_initial_password_setups
     where auth_user_id =
           '65000000-0000-4000-8000-000000000003'::uuid
       and state = 'claimed'
  )
  and exists (
    select 1
      from public.merchant_employee_initial_password_setups
     where employee_id =
           '65200000-0000-4000-8000-000000000003'::uuid
       and state = 'claimed'
  ),
  'global Auth-subject claim fence retained multiple or wrong claims'
);

set role service_role;
select public.faolla_release_merchant_employee_initial_password_setup_v1(
  jsonb_build_object(
    'merchant_id', '10000002',
    'auth_user_id', '65000000-0000-4000-8000-000000000003',
    'invitation_version', 1,
    'token_hash', repeat('4', 64),
    'operation_id', '65000003-0000-4000-8000-000000000002',
    'password_fingerprint', repeat('e', 64)
  )
);
reset role;

-- A delivery retry may observe Auth metadata=true after the password write but
-- before the complete RPC commits. The same invitation's durable claim wins:
-- binding must keep policy required so the retry can complete atomically.
select encode(
  extensions.digest(
    convert_to('initial-bind-retry-65@example.test', 'UTF8'),
    'sha256'
  ),
  'hex'
) as initial_bind_retry_email_hash
\gset

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
values (
  '65000000-0000-4000-8000-000000000006'::uuid,
  'initial-bind-retry-65@example.test',
  jsonb_build_object(
    'principal_type', 'merchant_staff',
    'merchant_staff_email_hash', :'initial_bind_retry_email_hash',
    'merchant_staff_password_initialized', true
  ),
  '{}'::jsonb
);

insert into public.merchant_enterprise_employees (
  id,
  merchant_id,
  auth_user_id,
  email,
  display_name,
  role_id,
  status,
  invited_at,
  version,
  invitation_version,
  invitation_token_hash,
  invitation_expires_at,
  invitation_sent_at,
  invitation_delivery_status
) values (
  '65100000-0000-4000-8000-000000000006'::uuid,
  '10000001',
  '65000000-0000-4000-8000-000000000006'::uuid,
  'initial-bind-retry-65@example.test',
  'Initial bind retry 65',
  :'initial_password_role_a'::uuid,
  'invited', statement_timestamp(), 1, 1, repeat('9', 64),
  statement_timestamp() + interval '1 day', statement_timestamp(), 'sent'
);

set role service_role;
select public.faolla_claim_merchant_employee_initial_password_setup_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'auth_user_id', '65000000-0000-4000-8000-000000000006',
    'invitation_version', 1,
    'token_hash', repeat('9', 64),
    'operation_id', '65000006-0000-4000-8000-000000000001',
    'password_fingerprint', repeat('a', 64)
  )
);
reset role;

insert into public.merchant_outbox_events (
  id,
  merchant_id,
  event_key,
  event_type,
  aggregate_type,
  aggregate_id,
  payload,
  status,
  attempts,
  available_at,
  locked_at,
  locked_by,
  lease_expires_at
) values (
  '65300000-0000-4000-8000-000000000006'::uuid,
  '10000001',
  'enterprise-invitation/65100000-0000-4000-8000-000000000006/1',
  'enterprise.employee_invitation.deliver',
  'merchant_enterprise_employee',
  '65100000-0000-4000-8000-000000000006',
  jsonb_build_object(
    'schema_version', 1,
    'invitation_version', 1,
    'hmac_key_id', 'key-v1'
  ),
  'processing',
  1,
  statement_timestamp(),
  statement_timestamp(),
  'integration-initial-bind-retry-65',
  statement_timestamp() + interval '10 minutes'
);

set role service_role;
select public.faolla_bind_merchant_employee_invitation_identity_v2(
  jsonb_build_object(
    'event_id', '65300000-0000-4000-8000-000000000006',
    'worker_id', 'integration-initial-bind-retry-65',
    'auth_user_id', '65000000-0000-4000-8000-000000000006',
    'email_hash', :'initial_bind_retry_email_hash',
    'initial_password_policy', 'waived'
  )
);
reset role;

select enterprise_integration.assert_true(
  (
    select initial_password_policy = 'required'
      from public.merchant_enterprise_employees
     where id = '65100000-0000-4000-8000-000000000006'::uuid
  )
  and exists (
    select 1
      from public.merchant_employee_initial_password_setups
     where employee_id =
           '65100000-0000-4000-8000-000000000006'::uuid
       and invitation_version = 1
       and invitation_token_hash = repeat('9', 64)
       and state = 'claimed'
  ),
  'Auth-initialized delivery retry waived an in-flight setup claim'
);

set role service_role;
select public.faolla_complete_merchant_employee_initial_password_setup_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'auth_user_id', '65000000-0000-4000-8000-000000000006',
    'invitation_version', 1,
    'token_hash', repeat('9', 64),
    'operation_id', '65000006-0000-4000-8000-000000000001',
    'password_fingerprint', repeat('a', 64)
  )
);
reset role;

select enterprise_integration.assert_true(
  (
    select initial_password_policy = 'completed'
      from public.merchant_enterprise_employees
     where id = '65100000-0000-4000-8000-000000000006'::uuid
  )
  and exists (
    select 1
      from public.merchant_employee_initial_password_setups
     where employee_id =
           '65100000-0000-4000-8000-000000000006'::uuid
       and state = 'completed'
  ),
  'in-flight setup could not complete after Auth-initialized delivery retry'
);

-- If a new generation is delivered after Auth succeeded but the prior
-- generation never completed, worker waiver must release only that stale
-- claimed fence. Completed setup evidence is covered separately below.
update public.merchant_employee_initial_password_setups
   set state = 'claimed',
       claim_expires_at = statement_timestamp() + interval '10 minutes',
       completed_at = null
 where employee_id = '65100000-0000-4000-8000-000000000006'::uuid;

update public.merchant_enterprise_employees
   set invitation_version = 2,
       invitation_token_hash = repeat('b', 64),
       invitation_expires_at = statement_timestamp() + interval '1 day',
       initial_password_policy = 'completed'
 where id = '65100000-0000-4000-8000-000000000006'::uuid;

insert into public.merchant_outbox_events (
  id,
  merchant_id,
  event_key,
  event_type,
  aggregate_type,
  aggregate_id,
  payload,
  status,
  attempts,
  available_at,
  locked_at,
  locked_by,
  lease_expires_at
) values (
  '65300000-0000-4000-8000-000000000007'::uuid,
  '10000001',
  'enterprise-invitation/65100000-0000-4000-8000-000000000006/2',
  'enterprise.employee_invitation.deliver',
  'merchant_enterprise_employee',
  '65100000-0000-4000-8000-000000000006',
  jsonb_build_object(
    'schema_version', 1,
    'invitation_version', 2,
    'hmac_key_id', 'key-v1'
  ),
  'processing',
  1,
  statement_timestamp(),
  statement_timestamp(),
  'integration-initial-bind-reinvite-65',
  statement_timestamp() + interval '10 minutes'
);

set role service_role;
select public.faolla_bind_merchant_employee_invitation_identity_v2(
  jsonb_build_object(
    'event_id', '65300000-0000-4000-8000-000000000007',
    'worker_id', 'integration-initial-bind-reinvite-65',
    'auth_user_id', '65000000-0000-4000-8000-000000000006',
    'email_hash', :'initial_bind_retry_email_hash',
    'initial_password_policy', 'waived'
  )
);
reset role;

select enterprise_integration.assert_true(
  (
    select initial_password_policy = 'waived'
      from public.merchant_enterprise_employees
     where id = '65100000-0000-4000-8000-000000000006'::uuid
  )
  and not exists (
    select 1
      from public.merchant_employee_initial_password_setups
     where employee_id =
           '65100000-0000-4000-8000-000000000006'::uuid
       and state = 'claimed'
  ),
  'new-generation waiver retained a stale global Auth-subject claim fence'
);

-- A completed old invitation generation is not inherited by a new generation.
-- The server may waive the new invite only after validating the existing Auth
-- password state; the old completed setup remains historical evidence.
insert into public.merchant_enterprise_employees (
  id,
  merchant_id,
  auth_user_id,
  email,
  display_name,
  role_id,
  status,
  invited_at,
  version,
  invitation_version,
  invitation_token_hash,
  invitation_expires_at,
  invitation_sent_at,
  invitation_delivery_status,
  initial_password_policy
) values (
  '65100000-0000-4000-8000-000000000005'::uuid,
  '10000001',
  '65000000-0000-4000-8000-000000000005'::uuid,
  'initial-reinvite-65@example.test',
  'Initial reinvite 65',
  :'initial_password_role_a'::uuid,
  'invited', statement_timestamp(), 1, 2, repeat('7', 64),
  statement_timestamp() + interval '1 day', statement_timestamp(), 'sent',
  'completed'
);

insert into public.merchant_employee_initial_password_setups (
  employee_id,
  merchant_id,
  auth_user_id,
  invitation_version,
  invitation_token_hash,
  operation_id,
  password_fingerprint,
  state,
  claimed_at,
  claim_expires_at,
  completed_at
) values (
  '65100000-0000-4000-8000-000000000005'::uuid,
  '10000001',
  '65000000-0000-4000-8000-000000000005'::uuid,
  1,
  repeat('6', 64),
  '65000005-0000-4000-8000-000000000001'::uuid,
  repeat('f', 64),
  'completed',
  statement_timestamp() - interval '1 hour',
  null,
  statement_timestamp() - interval '30 minutes'
);

set role service_role;
select enterprise_integration.assert_true(
  public.faolla_waive_employee_initial_password_v1(
    jsonb_build_object(
      'merchant_id', '10000001',
      'auth_user_id', '65000000-0000-4000-8000-000000000005',
      'invitation_version', 2,
      'token_hash', repeat('7', 64)
    )
  ) = jsonb_build_object('policy', 'waived', 'changed', true),
  'new invitation generation inherited stale completed policy'
);
select public.faolla_accept_merchant_employee_invitation_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'auth_user_id', '65000000-0000-4000-8000-000000000005',
    'invitation_version', 2,
    'token_hash', repeat('7', 64)
  )
);
reset role;

select enterprise_integration.assert_true(
  (
    select status = 'active'
       and accepted_at is not null
       and initial_password_policy = 'waived'
      from public.merchant_enterprise_employees
     where id = '65100000-0000-4000-8000-000000000005'::uuid
  )
  and exists (
    select 1
      from public.merchant_employee_initial_password_setups
     where employee_id =
           '65100000-0000-4000-8000-000000000005'::uuid
       and invitation_version = 1
       and state = 'completed'
  ),
  'reinvited completed employee was not safely waived and accepted'
);

-- Recovery grants use the same durable claim/replay/release protocol around an
-- Auth mutation. Exercise the real compiled RPCs, including fingerprint
-- conflict, retry after release, completion replay, and terminal release.
set role service_role;
select enterprise_integration.assert_true(
  public.faolla_activate_password_recovery_grant_v1(
    jsonb_build_object(
      'token_hash', repeat('c', 64),
      'email_hash', repeat('d', 64),
      'auth_user_id', '65000000-0000-4000-8000-000000000008',
      'session_id', 'initial-password-recovery-replay-65',
      'proof_kind', 'typed_recovery'
    )
  ) ->> 'state' = 'ready',
  'typed recovery grant was not activated'
);
select enterprise_integration.assert_true(
  public.faolla_claim_password_recovery_grant_v1(
    jsonb_build_object(
      'token_hash', repeat('c', 64),
      'auth_user_id', '65000000-0000-4000-8000-000000000008',
      'session_id', 'initial-password-recovery-replay-65',
      'password_fingerprint', repeat('e', 64)
    )
  ) = jsonb_build_object('state', 'claimed', 'resumed', false),
  'first recovery grant claim was not new'
);
select enterprise_integration.assert_true(
  public.faolla_claim_password_recovery_grant_v1(
    jsonb_build_object(
      'token_hash', repeat('c', 64),
      'auth_user_id', '65000000-0000-4000-8000-000000000008',
      'session_id', 'initial-password-recovery-replay-65',
      'password_fingerprint', repeat('e', 64)
    )
  ) = jsonb_build_object('state', 'claimed', 'resumed', true),
  'same-fingerprint recovery grant did not replay'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_claim_password_recovery_grant_v1(
      jsonb_build_object(
        'token_hash', repeat('c', 64),
        'auth_user_id', '65000000-0000-4000-8000-000000000008',
        'session_id', 'initial-password-recovery-replay-65',
        'password_fingerprint', repeat('f', 64)
      )
    )
  $sql$,
  'password_recovery_grant_in_progress'
);
select enterprise_integration.assert_true(
  (
    public.faolla_release_password_recovery_grant_v1(
      jsonb_build_object(
        'token_hash', repeat('c', 64),
        'auth_user_id', '65000000-0000-4000-8000-000000000008',
        'session_id', 'initial-password-recovery-replay-65',
        'password_fingerprint', repeat('e', 64)
      )
    ) ->> 'released'
  )::boolean,
  'claimed recovery grant was not released'
);
select enterprise_integration.assert_true(
  public.faolla_claim_password_recovery_grant_v1(
    jsonb_build_object(
      'token_hash', repeat('c', 64),
      'auth_user_id', '65000000-0000-4000-8000-000000000008',
      'session_id', 'initial-password-recovery-replay-65',
      'password_fingerprint', repeat('f', 64)
    )
  ) = jsonb_build_object('state', 'claimed', 'resumed', false),
  'released recovery grant could not be reclaimed'
);
select enterprise_integration.assert_true(
  public.faolla_complete_password_recovery_grant_v1(
    jsonb_build_object(
      'token_hash', repeat('c', 64),
      'auth_user_id', '65000000-0000-4000-8000-000000000008',
      'session_id', 'initial-password-recovery-replay-65',
      'password_fingerprint', repeat('f', 64)
    )
  ) = jsonb_build_object('state', 'completed'),
  'recovery grant was not completed'
);
select enterprise_integration.assert_true(
  public.faolla_claim_password_recovery_grant_v1(
    jsonb_build_object(
      'token_hash', repeat('c', 64),
      'auth_user_id', '65000000-0000-4000-8000-000000000008',
      'session_id', 'initial-password-recovery-replay-65',
      'password_fingerprint', repeat('f', 64)
    )
  ) = jsonb_build_object('state', 'completed', 'resumed', true),
  'completed recovery grant replay was not terminal'
);
select enterprise_integration.assert_true(
  not (
    public.faolla_release_password_recovery_grant_v1(
      jsonb_build_object(
        'token_hash', repeat('c', 64),
        'auth_user_id', '65000000-0000-4000-8000-000000000008',
        'session_id', 'initial-password-recovery-replay-65',
        'password_fingerprint', repeat('f', 64)
      )
    ) ->> 'released'
  )::boolean,
  'completed recovery grant was reopened by release'
);
reset role;

-- NULL is UNKNOWN for SQL NOT IN. The explicit NULL check and IS DISTINCT
-- FROM branch must reject rather than minting a typed-recovery grant.
set role service_role;
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_activate_password_recovery_grant_v1(
      jsonb_build_object(
        'token_hash', repeat('8', 64),
        'email_hash', repeat('9', 64),
        'auth_user_id', '65000000-0000-4000-8000-000000000008',
        'session_id', 'initial-password-null-proof-65'
      )
    )
  $sql$,
  'invalid_password_recovery_grant'
);
reset role;

select enterprise_integration.assert_true(
  not exists (
    select 1
      from public.auth_password_recovery_grants
     where token_hash = repeat('8', 64)
  ),
  'NULL proof_kind created a recovery grant'
);
