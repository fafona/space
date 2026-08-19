\set ON_ERROR_STOP on
\pset pager off

select id::text as invitation_employee_role_a
  from public.merchant_enterprise_roles
 where merchant_id = '10000001' and system_key = 'employee'
\gset

-- Atomic create + enqueue, including retry after an active HMAC-key rotation.
set role service_role;
select
  result -> 'employee' ->> 'id' as invitation_employee_a,
  result ->> 'event_id' as invitation_event_a,
  result ->> 'invitation_version' as invitation_generation_a
from (
  select public.faolla_create_merchant_enterprise_employee_invitation_v2(
    jsonb_build_object(
      'merchant_id', '10000001',
      'email', 'outbox-invite-a@example.test',
      'display_name', 'Outbox invite A',
      'role_id', :'invitation_employee_role_a',
      'actor_type', 'owner',
      'actor_id', '10000000-0000-4000-8000-000000000001',
      'operation_id', 'integration-invitation-create-a',
      'hmac_key_id', 'key-v1'
    )
  ) as result
) as created
\gset

select
  result ->> 'event_id' as invitation_event_a_retry,
  result ->> 'invitation_version' as invitation_generation_a_retry
from (
  select public.faolla_create_merchant_enterprise_employee_invitation_v2(
    jsonb_build_object(
      'merchant_id', '10000001',
      'email', 'outbox-invite-a@example.test',
      'display_name', 'Outbox invite A',
      'role_id', :'invitation_employee_role_a',
      'actor_type', 'owner',
      'actor_id', '10000000-0000-4000-8000-000000000001',
      'operation_id', 'integration-invitation-create-a',
      'hmac_key_id', 'key-v2'
    )
  ) as result
) as retried
\gset
reset role;

set role service_role;
select public.faolla_get_merchant_outbox_health_v1(
  '10000001',
  24
) ->> 'unknown_event_type_count' as invitation_unknown_event_count
\gset
reset role;

select enterprise_integration.assert_true(
  :'invitation_event_a' = :'invitation_event_a_retry'
  and :'invitation_generation_a' = :'invitation_generation_a_retry',
  'create retry after key rotation did not return the original generation'
);
select enterprise_integration.assert_true(
  :'invitation_unknown_event_count'::integer = 0,
  'invitation delivery was misclassified as an unknown outbox event'
);
select enterprise_integration.assert_true(
  (
    select event.payload = jsonb_build_object(
      'schema_version', 1,
      'invitation_version', :'invitation_generation_a'::bigint,
      'hmac_key_id', 'key-v1'
    )
      and event.aggregate_id = :'invitation_employee_a'
      and event.event_key =
        'enterprise-invitation/' || :'invitation_employee_a' || '/' ||
        :'invitation_generation_a'
      and event.status = 'pending'
    from public.merchant_outbox_events as event
    where event.id = :'invitation_event_a'::uuid
  ),
  'create did not persist the minimal immutable invitation seed'
);
select enterprise_integration.assert_true(
  (
    select index_metadata.indisunique
      and index_metadata.indisready
      and index_metadata.indisvalid
    from pg_catalog.pg_class as index_relation
    join pg_catalog.pg_namespace as index_namespace
      on index_namespace.oid = index_relation.relnamespace
    join pg_catalog.pg_index as index_metadata
      on index_metadata.indexrelid = index_relation.oid
    where index_namespace.nspname = 'public'
      and index_relation.relname =
        'merchant_enterprise_employees_invitation_exchange_idx'
  ),
  'invitation exchange digest lookup is not uniquely fail-closed'
);
select enterprise_integration.assert_true(
  (
    select employee.invitation_expires_at
      between statement_timestamp() + interval '6 days 23 hours'
          and statement_timestamp() + interval '7 days 1 minute'
    from public.merchant_enterprise_employees as employee
    where employee.id = :'invitation_employee_a'::uuid
  ),
  'new invitation expiry is not the seven-day product contract'
);
select enterprise_integration.assert_true(
  not exists (
    select 1
      from public.merchant_idempotency_keys as key
     where key.merchant_id = '10000001'
       and key.idempotency_key =
         'enterprise-employee-invitation-create-v2:integration-invitation-create-a'
       and (
         key.response_body::text ilike '%outbox-invite-a@example.test%'
         or key.response_body ? 'employee'
       )
  ),
  'create idempotency cache retained an email or full employee'
);

select enterprise_integration.expect_error(
  format(
    'update public.merchant_outbox_events set payload = payload || %L::jsonb where id = %L::uuid',
    '{"email":"must-not-persist@example.test"}',
    :'invitation_event_a'
  ),
  'merchant_enterprise_invitation_event_seed_immutable'
);

-- Claim, deterministic digest preparation, exact Auth recovery, binding and
-- safe completion. The raw delivery address appears only in the RPC response.
set role service_role;
select id::text as invitation_claim_a
  from public.faolla_claim_merchant_outbox_scoped_v1(
    'integration-invitation-worker-a',
    array['10000001']::text[],
    array['enterprise.employee_invitation.deliver']::text[],
    1,
    900
  )
\gset

select
  result ->> 'employee_version' as invitation_employee_version_a,
  result ->> 'email_hash' as invitation_email_hash_a
from (
  select public.faolla_prepare_merchant_employee_invitation_delivery_v1(
    jsonb_build_object(
      'event_id', :'invitation_event_a',
      'worker_id', 'integration-invitation-worker-a',
      'token_hash', repeat('d', 64)
    )
  ) as result
) as prepared
\gset
reset role;

select enterprise_integration.assert_true(
  :'invitation_claim_a' = :'invitation_event_a',
  'scoped worker did not claim the invitation event'
);
select enterprise_integration.assert_true(
  (
    select employee.invitation_token_hash = repeat('d', 64)
    from public.merchant_enterprise_employees as employee
    where employee.id = :'invitation_employee_a'::uuid
  ),
  'prepare did not persist the deterministic token digest'
);

insert into auth.users (id, email, raw_app_meta_data)
values (
  '81000000-0000-4000-8000-000000000001'::uuid,
  'outbox-invite-a@example.test',
  jsonb_build_object(
    'principal_type', 'merchant_staff',
    'merchant_staff_email_hash', :'invitation_email_hash_a'
  )
);

set role service_role;
select enterprise_integration.assert_true(
  public.faolla_lookup_merchant_enterprise_staff_identity_v1(
    :'invitation_email_hash_a'
  ) ->> 'source' = 'auth_recovery',
  'lost createUser response was not recovered from exact staff metadata'
);

select public.faolla_bind_merchant_employee_invitation_identity_v2(
  jsonb_build_object(
    'event_id', :'invitation_event_a',
    'worker_id', 'integration-invitation-worker-a',
    'auth_user_id', '81000000-0000-4000-8000-000000000001',
    'email_hash', :'invitation_email_hash_a'
  )
);
select enterprise_integration.assert_true(
  public.faolla_lookup_merchant_enterprise_staff_identity_v1(
    :'invitation_email_hash_a'
  ) ->> 'source' = 'registry',
  'bound staff identity was not materialized in the immutable registry'
);

select enterprise_integration.expect_error(
  format(
    'select public.faolla_complete_merchant_outbox_v1(%L::uuid, %L, %L::jsonb)',
    :'invitation_event_a',
    'integration-invitation-worker-a',
    '{"email":"must-not-persist@example.test"}'
  ),
  'invalid_merchant_enterprise_invitation_result'
);

select public.faolla_complete_merchant_employee_invitation_delivery_v1(
  jsonb_build_object(
    'event_id', :'invitation_event_a',
    'worker_id', 'integration-invitation-worker-a'
  )
);
select result ->> 'already_completed' as invitation_complete_retry_a
from (
  select public.faolla_complete_merchant_employee_invitation_delivery_v1(
    jsonb_build_object(
      'event_id', :'invitation_event_a',
      'worker_id', 'integration-invitation-worker-a'
    )
  ) as result
) as retried_completion
\gset
reset role;

select enterprise_integration.assert_true(
  (
    select event.status = 'completed'
      and event.result = jsonb_build_object(
        'status', 'sent',
        'invitation_version', :'invitation_generation_a'::bigint
      )
      and event.last_error is null
    from public.merchant_outbox_events as event
    where event.id = :'invitation_event_a'::uuid
  )
  and :'invitation_complete_retry_a'::boolean,
  'invitation completion did not write the bounded safe result'
);

-- A same-generation resend reuses the event, token digest and original key,
-- even when the server active key has rotated twice.
update public.merchant_outbox_events
   set completed_at = statement_timestamp() - interval '2 minutes',
       last_replayed_at = statement_timestamp() - interval '2 minutes'
 where id = :'invitation_event_a'::uuid;
select version as invitation_resend_expected_version_a
  from public.merchant_enterprise_employees
 where id = :'invitation_employee_a'::uuid
\gset

set role service_role;
select
  result ->> 'event_id' as invitation_resend_event_a,
  result ->> 'invitation_version' as invitation_resend_generation_a
from (
  select public.faolla_schedule_merchant_employee_invitation_delivery_v2(
    jsonb_build_object(
      'merchant_id', '10000001',
      'employee_id', :'invitation_employee_a',
      'expected_version', :invitation_resend_expected_version_a,
      'action', 'resend',
      'operation_id', 'integration-invitation-resend-a',
      'hmac_key_id', 'key-v2',
      'actor_type', 'owner',
      'actor_id', '10000000-0000-4000-8000-000000000001'
    )
  ) as result
) as replayed
\gset

select
  result ->> 'event_id' as invitation_resend_event_a_retry,
  result ->> 'invitation_version' as invitation_resend_generation_a_retry
from (
  select public.faolla_schedule_merchant_employee_invitation_delivery_v2(
    jsonb_build_object(
      'merchant_id', '10000001',
      'employee_id', :'invitation_employee_a',
      'expected_version', :invitation_resend_expected_version_a,
      'action', 'resend',
      'operation_id', 'integration-invitation-resend-a',
      'hmac_key_id', 'key-v3',
      'actor_type', 'owner',
      'actor_id', '10000000-0000-4000-8000-000000000001'
    )
  ) as result
) as replay_retry
\gset
reset role;

select enterprise_integration.assert_true(
  :'invitation_resend_event_a' = :'invitation_event_a'
  and :'invitation_resend_event_a_retry' = :'invitation_event_a'
  and :'invitation_resend_generation_a' = :'invitation_generation_a'
  and :'invitation_resend_generation_a_retry' = :'invitation_generation_a'
  and (
    select event.payload ->> 'hmac_key_id' = 'key-v1'
    from public.merchant_outbox_events as event
    where event.id = :'invitation_event_a'::uuid
  )
  and (
    select employee.invitation_token_hash = repeat('d', 64)
    from public.merchant_enterprise_employees as employee
    where employee.id = :'invitation_employee_a'::uuid
  ),
  'same-generation resend rotated the event, key, or token digest'
);

set role service_role;
select id::text as invitation_reclaim_a
  from public.faolla_claim_merchant_outbox_scoped_v1(
    'integration-invitation-worker-a2',
    array['10000001']::text[],
    array['enterprise.employee_invitation.deliver']::text[],
    1,
    900
  )
\gset
select public.faolla_prepare_merchant_employee_invitation_delivery_v1(
  jsonb_build_object(
    'event_id', :'invitation_event_a',
    'worker_id', 'integration-invitation-worker-a2',
    'token_hash', repeat('d', 64)
  )
);
select public.faolla_complete_merchant_employee_invitation_delivery_v1(
  jsonb_build_object(
    'event_id', :'invitation_event_a',
    'worker_id', 'integration-invitation-worker-a2'
  )
);
reset role;

-- Full Auth-link TTL issuance lease: same attempt is idempotently blocked,
-- another attempt is cooled down, pre-generate release works, and issued rows
-- survive release attempts until accept invalidates the invitation generation.
set role service_role;
select
  result ->> 'allowed' as exchange_allowed_a1,
  result ->> 'issuance_id' as exchange_issuance_a1,
  result ->> 'auth_user_id' as exchange_auth_a
from (
  select public.faolla_begin_merchant_employee_invitation_exchange_v1(
    jsonb_build_object(
      'merchant_id', '10000001',
      'invitation_version', :'invitation_generation_a'::bigint,
      'token_hash', repeat('d', 64),
      'attempt_id', '82000000-0000-4000-8000-000000000001',
      'issuance_lease_seconds', 3900
    )
  ) as result
) as exchange
\gset

select
  result ->> 'allowed' as exchange_duplicate_allowed_a1,
  result ->> 'duplicate_attempt' as exchange_duplicate_a1
from (
  select public.faolla_begin_merchant_employee_invitation_exchange_v1(
    jsonb_build_object(
      'merchant_id', '10000001',
      'invitation_version', :'invitation_generation_a'::bigint,
      'token_hash', repeat('d', 64),
      'attempt_id', '82000000-0000-4000-8000-000000000001',
      'issuance_lease_seconds', 3900
    )
  ) as result
) as duplicate_exchange
\gset

select
  result ->> 'allowed' as exchange_other_allowed_a1,
  result ->> 'duplicate_attempt' as exchange_other_duplicate_a1
from (
  select public.faolla_begin_merchant_employee_invitation_exchange_v1(
    jsonb_build_object(
      'merchant_id', '10000001',
      'invitation_version', :'invitation_generation_a'::bigint,
      'token_hash', repeat('d', 64),
      'attempt_id', '82000000-0000-4000-8000-000000000002',
      'issuance_lease_seconds', 3900
    )
  ) as result
) as other_exchange
\gset

select
  public.faolla_release_merchant_employee_invitation_exchange_v1(
    jsonb_build_object(
      'merchant_id', '10000001',
      'employee_id', :'invitation_employee_a',
      'auth_user_id', :'exchange_auth_a',
      'invitation_version', :'invitation_generation_a'::bigint,
      'issuance_id', :'exchange_issuance_a1'
    )
  ) ->> 'released' as exchange_released_a1
\gset

select
  result ->> 'allowed' as exchange_allowed_a2,
  result ->> 'issuance_id' as exchange_issuance_a2
from (
  select public.faolla_begin_merchant_employee_invitation_exchange_v1(
    jsonb_build_object(
      'merchant_id', '10000001',
      'invitation_version', :'invitation_generation_a'::bigint,
      'token_hash', repeat('d', 64),
      'attempt_id', '82000000-0000-4000-8000-000000000002',
      'issuance_lease_seconds', 3900
    )
  ) as result
) as second_exchange
\gset

select public.faolla_mark_merchant_employee_invitation_exchange_issued_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'employee_id', :'invitation_employee_a',
    'auth_user_id', :'exchange_auth_a',
    'invitation_version', :'invitation_generation_a'::bigint,
    'issuance_id', :'exchange_issuance_a2',
    'token_hash', repeat('d', 64)
  )
);
select
  public.faolla_recheck_merchant_employee_invitation_exchange_v1(
    jsonb_build_object(
      'merchant_id', '10000001',
      'employee_id', :'invitation_employee_a',
      'auth_user_id', :'exchange_auth_a',
      'invitation_version', :'invitation_generation_a'::bigint,
      'issuance_id', :'exchange_issuance_a2',
      'token_hash', repeat('d', 64)
    )
  ) ->> 'valid' as exchange_recheck_a2
\gset
select
  public.faolla_release_merchant_employee_invitation_exchange_v1(
    jsonb_build_object(
      'merchant_id', '10000001',
      'employee_id', :'invitation_employee_a',
      'auth_user_id', :'exchange_auth_a',
      'invitation_version', :'invitation_generation_a'::bigint,
      'issuance_id', :'exchange_issuance_a2'
    )
  ) ->> 'released' as exchange_released_issued_a2
\gset
reset role;

select enterprise_integration.assert_true(
  :'exchange_allowed_a1'::boolean
  and :'exchange_duplicate_allowed_a1'::boolean = false
  and :'exchange_duplicate_a1'::boolean
  and :'exchange_other_allowed_a1'::boolean = false
  and :'exchange_other_duplicate_a1'::boolean = false
  and :'exchange_released_a1'::boolean
  and :'exchange_allowed_a2'::boolean
  and :'exchange_recheck_a2'::boolean
  and :'exchange_released_issued_a2'::boolean = false,
  'exchange issuance lease state machine did not enforce single generation'
);
select enterprise_integration.assert_true(
  (
    select issuance.expires_at - issuance.claimed_at
      = interval '3900 seconds'
    from public.merchant_enterprise_invitation_exchange_issuances as issuance
    where issuance.issuance_id = :'exchange_issuance_a2'::uuid
  ),
  'exchange issuance did not retain the configured 3900-second Auth TTL'
);
select enterprise_integration.assert_true(
  (
    select bucket.attempt_count = 2
    from public.merchant_enterprise_invitation_exchange_rate_buckets as bucket
    where bucket.merchant_id = '10000001'
      and bucket.employee_id = :'invitation_employee_a'::uuid
      and bucket.invitation_version = :'invitation_generation_a'::bigint
      and bucket.window_kind = 'ten_minute'
      and statement_timestamp() between
        bucket.window_started_at and bucket.window_ends_at
  ),
  'duplicate/cooldown attempts incorrectly consumed rate budget'
);

set role service_role;
select public.faolla_accept_merchant_employee_invitation_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'auth_user_id', :'exchange_auth_a',
    'invitation_version', :'invitation_generation_a'::bigint,
    'token_hash', repeat('d', 64)
  )
);
reset role;

select enterprise_integration.assert_true(
  not exists (
    select 1
      from public.merchant_enterprise_invitation_exchange_issuances
     where issuance_id = :'exchange_issuance_a2'::uuid
  ),
  'legacy accept did not release the exact invitation issuance lease'
);

-- Expiry + explicit renew is the only generation rotation. The active key is
-- consumed once, later retries ignore active-key changes, and the old create
-- operation remains paired with its original event after the renewal.
set role service_role;
select
  result -> 'employee' ->> 'id' as invitation_employee_b,
  result ->> 'event_id' as invitation_event_b_old,
  result ->> 'invitation_version' as invitation_generation_b_old
from (
  select public.faolla_create_merchant_enterprise_employee_invitation_v2(
    jsonb_build_object(
      'merchant_id', '10000001',
      'email', 'outbox-invite-b@example.test',
      'display_name', 'Outbox invite B',
      'role_id', :'invitation_employee_role_a',
      'actor_type', 'owner',
      'actor_id', '10000000-0000-4000-8000-000000000001',
      'operation_id', 'integration-invitation-create-b',
      'hmac_key_id', 'key-v1'
    )
  ) as result
) as created
\gset
select id::text as invitation_claim_b_old
  from public.faolla_claim_merchant_outbox_scoped_v1(
    'integration-invitation-worker-b1',
    array['10000001']::text[],
    array['enterprise.employee_invitation.deliver']::text[],
    1,
    900
  )
\gset
select
  result ->> 'email_hash' as invitation_email_hash_b
from (
  select public.faolla_prepare_merchant_employee_invitation_delivery_v1(
    jsonb_build_object(
      'event_id', :'invitation_event_b_old',
      'worker_id', 'integration-invitation-worker-b1',
      'token_hash', repeat('e', 64)
    )
  ) as result
) as prepared
\gset
reset role;

insert into auth.users (id, email, raw_app_meta_data)
values (
  '81000000-0000-4000-8000-000000000002'::uuid,
  'outbox-invite-b@example.test',
  jsonb_build_object(
    'principal_type', 'merchant_staff',
    'merchant_staff_email_hash', :'invitation_email_hash_b'
  )
);

set role service_role;
select public.faolla_bind_merchant_employee_invitation_identity_v2(
  jsonb_build_object(
    'event_id', :'invitation_event_b_old',
    'worker_id', 'integration-invitation-worker-b1',
    'auth_user_id', '81000000-0000-4000-8000-000000000002',
    'email_hash', :'invitation_email_hash_b'
  )
);
select public.faolla_complete_merchant_employee_invitation_delivery_v1(
  jsonb_build_object(
    'event_id', :'invitation_event_b_old',
    'worker_id', 'integration-invitation-worker-b1'
  )
);
select
  result ->> 'issuance_id' as exchange_issuance_b_old,
  result ->> 'auth_user_id' as exchange_auth_b
from (
  select public.faolla_begin_merchant_employee_invitation_exchange_v1(
    jsonb_build_object(
      'merchant_id', '10000001',
      'invitation_version', :'invitation_generation_b_old'::bigint,
      'token_hash', repeat('e', 64),
      'attempt_id', '82000000-0000-4000-8000-000000000003',
      'issuance_lease_seconds', 3900
    )
  ) as result
) as exchange
\gset
reset role;

-- Simulate the clock crossing expiry without rotating the generation. The
-- version touch is intentional; the schedule request uses the refreshed CAS.
update public.merchant_enterprise_employees
   set invitation_expires_at = statement_timestamp() - interval '1 second'
 where id = :'invitation_employee_b'::uuid;
select version as invitation_renew_expected_version_b
  from public.merchant_enterprise_employees
 where id = :'invitation_employee_b'::uuid
\gset

set role service_role;
select enterprise_integration.expect_error(
  format(
    'select public.faolla_schedule_merchant_employee_invitation_delivery_v2(%L::jsonb)',
    jsonb_build_object(
      'merchant_id', '10000001',
      'employee_id', :'invitation_employee_b',
      'expected_version', :invitation_renew_expected_version_b,
      'action', 'resend',
      'operation_id', 'integration-invitation-expired-resend-b',
      'hmac_key_id', 'key-v2',
      'actor_type', 'owner',
      'actor_id', '10000000-0000-4000-8000-000000000001'
    )::text
  ),
  'employee_invitation_renew_required'
);
select
  result ->> 'event_id' as invitation_event_b_new,
  result ->> 'invitation_version' as invitation_generation_b_new
from (
  select public.faolla_schedule_merchant_employee_invitation_delivery_v2(
    jsonb_build_object(
      'merchant_id', '10000001',
      'employee_id', :'invitation_employee_b',
      'expected_version', :invitation_renew_expected_version_b,
      'action', 'renew',
      'operation_id', 'integration-invitation-renew-b',
      'hmac_key_id', 'key-v2',
      'actor_type', 'owner',
      'actor_id', '10000000-0000-4000-8000-000000000001'
    )
  ) as result
) as renewed
\gset

select
  result ->> 'event_id' as invitation_event_b_new_retry,
  result ->> 'invitation_version' as invitation_generation_b_new_retry
from (
  select public.faolla_schedule_merchant_employee_invitation_delivery_v2(
    jsonb_build_object(
      'merchant_id', '10000001',
      'employee_id', :'invitation_employee_b',
      'expected_version', :invitation_renew_expected_version_b,
      'action', 'renew',
      'operation_id', 'integration-invitation-renew-b',
      'hmac_key_id', 'key-v3',
      'actor_type', 'owner',
      'actor_id', '10000000-0000-4000-8000-000000000001'
    )
  ) as result
) as renew_retry
\gset

select
  result ->> 'event_id' as invitation_event_b_create_retry,
  result ->> 'invitation_version' as invitation_generation_b_create_retry
from (
  select public.faolla_create_merchant_enterprise_employee_invitation_v2(
    jsonb_build_object(
      'merchant_id', '10000001',
      'email', 'outbox-invite-b@example.test',
      'display_name', 'Outbox invite B',
      'role_id', :'invitation_employee_role_a',
      'actor_type', 'owner',
      'actor_id', '10000000-0000-4000-8000-000000000001',
      'operation_id', 'integration-invitation-create-b',
      'hmac_key_id', 'key-v3'
    )
  ) as result
) as old_create_retry
\gset
reset role;

select enterprise_integration.assert_true(
  :'invitation_event_b_new' = :'invitation_event_b_new_retry'
  and :'invitation_generation_b_new' = :'invitation_generation_b_new_retry'
  and :'invitation_event_b_create_retry' = :'invitation_event_b_old'
  and :'invitation_generation_b_create_retry' = :'invitation_generation_b_old'
  and :'invitation_event_b_new' <> :'invitation_event_b_old'
  and :'invitation_generation_b_new'::bigint =
    :'invitation_generation_b_old'::bigint + 1
  and (
    select event.payload ->> 'hmac_key_id' = 'key-v2'
    from public.merchant_outbox_events as event
    where event.id = :'invitation_event_b_new'::uuid
  )
  and not exists (
    select 1
      from public.merchant_enterprise_invitation_exchange_issuances
     where issuance_id = :'exchange_issuance_b_old'::uuid
  ),
  'renew/key-rotation idempotency pair or exact lease release failed'
);
select enterprise_integration.assert_true(
  (
    select employee.invitation_expires_at
      between statement_timestamp() + interval '6 days 23 hours'
          and statement_timestamp() + interval '7 days 1 minute'
    from public.merchant_enterprise_employees as employee
    where employee.id = :'invitation_employee_b'::uuid
  ),
  'renewed invitation expiry is not seven days'
);

-- Prepare the renewed generation, then prove legacy revoke releases only that
-- generation's issuance and terminalizes its runnable event.
set role service_role;
select id::text as invitation_claim_b_new
  from public.faolla_claim_merchant_outbox_scoped_v1(
    'integration-invitation-worker-b2',
    array['10000001']::text[],
    array['enterprise.employee_invitation.deliver']::text[],
    1,
    900
  )
\gset
select public.faolla_prepare_merchant_employee_invitation_delivery_v1(
  jsonb_build_object(
    'event_id', :'invitation_event_b_new',
    'worker_id', 'integration-invitation-worker-b2',
    'token_hash', repeat('f', 64)
  )
);
select public.faolla_complete_merchant_employee_invitation_delivery_v1(
  jsonb_build_object(
    'event_id', :'invitation_event_b_new',
    'worker_id', 'integration-invitation-worker-b2'
  )
);
select
  result ->> 'issuance_id' as exchange_issuance_b_new
from (
  select public.faolla_begin_merchant_employee_invitation_exchange_v1(
    jsonb_build_object(
      'merchant_id', '10000001',
      'invitation_version', :'invitation_generation_b_new'::bigint,
      'token_hash', repeat('f', 64),
      'attempt_id', '82000000-0000-4000-8000-000000000004',
      'issuance_lease_seconds', 3900
    )
  ) as result
) as exchange
\gset
reset role;

select version as invitation_revoke_expected_version_b
  from public.merchant_enterprise_employees
 where id = :'invitation_employee_b'::uuid
\gset
set role service_role;
select public.faolla_revoke_merchant_employee_invitation_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'employee_id', :'invitation_employee_b',
    'expected_version', :invitation_revoke_expected_version_b,
    'actor_type', 'owner',
    'actor_id', '10000000-0000-4000-8000-000000000001'
  )
);
reset role;

select enterprise_integration.assert_true(
  not exists (
    select 1
      from public.merchant_enterprise_invitation_exchange_issuances
     where issuance_id = :'exchange_issuance_b_new'::uuid
  ),
  'legacy revoke did not release the exact issuance lease'
);

-- Remove while a delivery attempt is processing. The old V1 remove RPC must
-- close the attempt, terminalize the outbox job, and release the issuance.
set role service_role;
select
  result -> 'employee' ->> 'id' as invitation_employee_c,
  result ->> 'event_id' as invitation_event_c,
  result ->> 'invitation_version' as invitation_generation_c
from (
  select public.faolla_create_merchant_enterprise_employee_invitation_v2(
    jsonb_build_object(
      'merchant_id', '10000001',
      'email', 'outbox-invite-c@example.test',
      'display_name', 'Outbox invite C',
      'role_id', :'invitation_employee_role_a',
      'actor_type', 'owner',
      'actor_id', '10000000-0000-4000-8000-000000000001',
      'operation_id', 'integration-invitation-create-c',
      'hmac_key_id', 'key-v2'
    )
  ) as result
) as created
\gset
select id::text as invitation_claim_c
  from public.faolla_claim_merchant_outbox_scoped_v1(
    'integration-invitation-worker-c',
    array['10000001']::text[],
    array['enterprise.employee_invitation.deliver']::text[],
    1,
    900
  )
\gset
select result ->> 'email_hash' as invitation_email_hash_c
from (
  select public.faolla_prepare_merchant_employee_invitation_delivery_v1(
    jsonb_build_object(
      'event_id', :'invitation_event_c',
      'worker_id', 'integration-invitation-worker-c',
      'token_hash', repeat('1', 64)
    )
  ) as result
) as prepared
\gset
reset role;

insert into auth.users (id, email, raw_app_meta_data)
values (
  '81000000-0000-4000-8000-000000000003'::uuid,
  'outbox-invite-c@example.test',
  jsonb_build_object(
    'principal_type', 'merchant_staff',
    'merchant_staff_email_hash', :'invitation_email_hash_c'
  )
);
set role service_role;
select public.faolla_bind_merchant_employee_invitation_identity_v2(
  jsonb_build_object(
    'event_id', :'invitation_event_c',
    'worker_id', 'integration-invitation-worker-c',
    'auth_user_id', '81000000-0000-4000-8000-000000000003',
    'email_hash', :'invitation_email_hash_c'
  )
);
select result ->> 'issuance_id' as exchange_issuance_c
from (
  select public.faolla_begin_merchant_employee_invitation_exchange_v1(
    jsonb_build_object(
      'merchant_id', '10000001',
      'invitation_version', :'invitation_generation_c'::bigint,
      'token_hash', repeat('1', 64),
      'attempt_id', '82000000-0000-4000-8000-000000000005',
      'issuance_lease_seconds', 3900
    )
  ) as result
) as exchange
\gset
reset role;

select version as invitation_remove_expected_version_c
  from public.merchant_enterprise_employees
 where id = :'invitation_employee_c'::uuid
\gset
set role service_role;
select public.faolla_remove_merchant_employee_invitation_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'employee_id', :'invitation_employee_c',
    'expected_version', :invitation_remove_expected_version_c,
    'actor_type', 'owner',
    'actor_id', '10000000-0000-4000-8000-000000000001'
  )
);
reset role;

select enterprise_integration.assert_true(
  not exists (
    select 1 from public.merchant_enterprise_employees
     where id = :'invitation_employee_c'::uuid
  )
  and not exists (
    select 1
      from public.merchant_enterprise_invitation_exchange_issuances
     where issuance_id = :'exchange_issuance_c'::uuid
  )
  and (
    select event.status = 'completed'
      and event.result ->> 'status' = 'removed'
    from public.merchant_outbox_events as event
    where event.id = :'invitation_event_c'::uuid
  )
  and (
    select attempt.outcome = 'completed'
    from public.merchant_outbox_attempts as attempt
    where attempt.event_id = :'invitation_event_c'::uuid
    order by attempt.attempt_number desc
    limit 1
  ),
  'legacy remove did not close its job/attempt and exact issuance lease'
);

-- Failure finalization is bounded and idempotent after the worker response is
-- lost. Provider text is reduced to a stable code before it reaches storage.
set role service_role;
select
  result -> 'employee' ->> 'id' as invitation_employee_d,
  result ->> 'event_id' as invitation_event_d,
  result ->> 'invitation_version' as invitation_generation_d
from (
  select public.faolla_create_merchant_enterprise_employee_invitation_v2(
    jsonb_build_object(
      'merchant_id', '10000001',
      'email', 'outbox-invite-d@example.test',
      'display_name', 'Outbox invite D',
      'role_id', :'invitation_employee_role_a',
      'actor_type', 'owner',
      'actor_id', '10000000-0000-4000-8000-000000000001',
      'operation_id', 'integration-invitation-create-d',
      'hmac_key_id', 'key-v2'
    )
  ) as result
) as created
\gset
select id::text as invitation_claim_d
  from public.faolla_claim_merchant_outbox_scoped_v1(
    'integration-invitation-worker-d',
    array['10000001']::text[],
    array['enterprise.employee_invitation.deliver']::text[],
    1,
    900
  )
\gset
select public.faolla_prepare_merchant_employee_invitation_delivery_v1(
  jsonb_build_object(
    'event_id', :'invitation_event_d',
    'worker_id', 'integration-invitation-worker-d',
    'token_hash', repeat('2', 64)
  )
);
select
  result ->> 'status' as invitation_failure_status_d,
  result ->> 'already_failed' as invitation_failure_first_d
from (
  select public.faolla_fail_merchant_employee_invitation_delivery_v1(
    jsonb_build_object(
      'event_id', :'invitation_event_d',
      'worker_id', 'integration-invitation-worker-d',
      'error_code', 'provider_unavailable',
      'retryable', false
    )
  ) as result
) as first_failure
\gset
select
  result ->> 'status' as invitation_failure_retry_status_d,
  result ->> 'already_failed' as invitation_failure_retry_d
from (
  select public.faolla_fail_merchant_employee_invitation_delivery_v1(
    jsonb_build_object(
      'event_id', :'invitation_event_d',
      'worker_id', 'integration-invitation-worker-d',
      'error_code', 'provider_unavailable',
      'retryable', false
    )
  ) as result
) as retried_failure
\gset
reset role;

select enterprise_integration.assert_true(
  :'invitation_claim_d' = :'invitation_event_d'
  and :'invitation_failure_status_d' = 'dead_lettered'
  and :'invitation_failure_first_d'::boolean = false
  and :'invitation_failure_retry_status_d' = 'dead_lettered'
  and :'invitation_failure_retry_d'::boolean
  and (
    select event.status = 'failed'
      and event.dead_lettered_at is not null
      and event.last_error = 'provider_unavailable'
      and event.last_error_code = 'provider_unavailable'
    from public.merchant_outbox_events as event
    where event.id = :'invitation_event_d'::uuid
  )
  and (
    select employee.invitation_delivery_status = 'failed'
    from public.merchant_enterprise_employees as employee
    where employee.id = :'invitation_employee_d'::uuid
  ),
  'invitation failure/dead-letter finalization was not bounded and idempotent'
);

-- A valid V1 invitation has no deterministic event/token seed. Resend must not
-- silently rotate it, but explicit renew is the supported one-time upgrade.
set role service_role;
select result -> 'employee' ->> 'id' as invitation_employee_e
from (
  select public.faolla_create_merchant_enterprise_employee_v1(
    jsonb_build_object(
      'merchant_id', '10000001',
      'email', 'outbox-invite-e@example.test',
      'display_name', 'Outbox invite E legacy',
      'role_id', :'invitation_employee_role_a',
      'actor_type', 'owner',
      'actor_id', '10000000-0000-4000-8000-000000000001'
    )
  ) as result
) as legacy_created
\gset
reset role;
select
  version as invitation_expected_version_e,
  invitation_version as invitation_generation_e_old
from public.merchant_enterprise_employees
where id = :'invitation_employee_e'::uuid
\gset

set role service_role;
select enterprise_integration.expect_error(
  format(
    'select public.faolla_schedule_merchant_employee_invitation_delivery_v2(%L::jsonb)',
    jsonb_build_object(
      'merchant_id', '10000001',
      'employee_id', :'invitation_employee_e',
      'expected_version', :invitation_expected_version_e,
      'action', 'resend',
      'operation_id', 'integration-invitation-legacy-resend-e',
      'hmac_key_id', 'key-v2',
      'actor_type', 'owner',
      'actor_id', '10000000-0000-4000-8000-000000000001'
    )::text
  ),
  'employee_invitation_renew_required'
);
select
  result ->> 'event_id' as invitation_event_e_new,
  result ->> 'invitation_version' as invitation_generation_e_new
from (
  select public.faolla_schedule_merchant_employee_invitation_delivery_v2(
    jsonb_build_object(
      'merchant_id', '10000001',
      'employee_id', :'invitation_employee_e',
      'expected_version', :invitation_expected_version_e,
      'action', 'renew',
      'operation_id', 'integration-invitation-legacy-renew-e',
      'hmac_key_id', 'key-v2',
      'actor_type', 'owner',
      'actor_id', '10000000-0000-4000-8000-000000000001'
    )
  ) as result
) as legacy_upgraded
\gset
reset role;

select enterprise_integration.assert_true(
  :'invitation_generation_e_new'::bigint =
    :'invitation_generation_e_old'::bigint + 1
  and (
    select event.payload = jsonb_build_object(
      'schema_version', 1,
      'invitation_version', :'invitation_generation_e_new'::bigint,
      'hmac_key_id', 'key-v2'
    )
    from public.merchant_outbox_events as event
    where event.id = :'invitation_event_e_new'::uuid
  )
  and (
    select employee.invitation_expires_at
      between statement_timestamp() + interval '6 days 23 hours'
          and statement_timestamp() + interval '7 days 1 minute'
    from public.merchant_enterprise_employees as employee
    where employee.id = :'invitation_employee_e'::uuid
  ),
  'explicit legacy invitation upgrade did not create one stable generation'
);

-- A plain Auth account is never silently adopted as merchant staff.
select encode(
  digest(convert_to('ordinary-account@example.test', 'UTF8'), 'sha256'),
  'hex'
) as ordinary_email_hash
\gset
insert into auth.users (id, email, raw_app_meta_data)
values (
  '81000000-0000-4000-8000-000000000004'::uuid,
  'ordinary-account@example.test',
  '{}'::jsonb
);
set role service_role;
select enterprise_integration.expect_error(
  format(
    'select public.faolla_lookup_merchant_enterprise_staff_identity_v1(%L)',
    :'ordinary_email_hash'
  ),
  'merchant_enterprise_staff_identity_conflict'
);
select enterprise_integration.expect_error(
  $$
    update public.merchant_enterprise_staff_identities
       set principal_type = 'merchant_staff'
  $$,
  'permission denied'
);
reset role;

-- Secrets and addresses may exist only in the employee/Auth source or in-memory
-- RPC results, never in outbox/audit/idempotency/rate/issuance persistence.
select enterprise_integration.assert_true(
  not exists (
    select 1
      from public.merchant_outbox_events as event
     where event.event_type = 'enterprise.employee_invitation.deliver'
       and concat_ws(
         ' ',
         event.payload::text,
         coalesce(event.result::text, ''),
         coalesce(event.last_error, ''),
         coalesce(event.last_error_code, '')
       ) ~* 'outbox-invite-[abcde]@example\\.test|must-not-persist|action_link|redirect_to'
  )
  and not exists (
    select 1
      from public.merchant_outbox_attempts as attempt
      join public.merchant_outbox_events as event on event.id = attempt.event_id
     where event.event_type = 'enterprise.employee_invitation.deliver'
       and concat_ws(
         ' ',
         coalesce(attempt.error_code, ''),
         coalesce(attempt.error_message, '')
       ) ~* 'outbox-invite-[abcde]@example\\.test|must-not-persist|action_link|redirect_to'
  )
  and not exists (
    select 1
      from public.merchant_outbox_replays as replay
      join public.merchant_outbox_events as event on event.id = replay.event_id
     where event.event_type = 'enterprise.employee_invitation.deliver'
       and (
         replay.replayed_by ~*
           '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or concat_ws(
           ' ',
           replay.replayed_by,
           replay.reason_code
         ) ~* 'outbox-invite-[abcde]@example\\.test|must-not-persist|action_link|redirect_to|dddddddddddddddd|2222222222222222'
       )
  )
  and not exists (
    select 1
      from public.merchant_enterprise_audit_events as audit
     where audit.merchant_id = '10000001'
       and concat_ws(
         ' ',
         audit.before_data::text,
         audit.after_data::text,
         audit.target_label
       ) ~* 'outbox-invite-[abcde]@example\\.test|must-not-persist|action_link|redirect_to|dddddddddddddddd|2222222222222222'
  )
  and not exists (
    select 1
      from public.merchant_idempotency_keys as key
     where key.merchant_id = '10000001'
       and concat_ws(
         ' ',
         key.request_hash,
         coalesce(key.response_body::text, '')
       ) ~* 'outbox-invite-[abcde]@example\\.test|must-not-persist|action_link|redirect_to|dddddddddddddddd|2222222222222222'
  ),
  'invitation secret/address scan found persisted delivery material'
);

select enterprise_integration.assert_true(
  (select count(*) = 1
     from public.faolla_schema_migrations
    where version = 202608190033
      and name = 'merchant_enterprise_invitation_delivery_outbox'),
  '033 migration registry row missing or duplicated'
);
