\set ON_ERROR_STOP on
\pset pager off

drop trigger aaa_enterprise_integration_delay_task_cas
  on public.merchant_tasks;
drop trigger aaa_enterprise_integration_delay_invitation_cas
  on public.merchant_enterprise_employees;
drop function enterprise_integration.delay_task_cas_row();
drop function enterprise_integration.delay_invitation_cas_row();

select enterprise_integration.assert_true(
  (
    select task.version = 2
       and task.title in ('CAS task worker A', 'CAS task worker B')
      from public.merchant_tasks as task
      join public.merchant_task_events as created_event
        on created_event.merchant_id = task.merchant_id
       and created_event.task_id = task.id
     where created_event.merchant_id = '10000001'
       and created_event.operation_id = 'integration-task-cas-create'
  ),
  'task CAS did not produce exactly one version increment'
);
select enterprise_integration.assert_true(
  (
    select count(*) = 1
      from public.merchant_task_events
     where merchant_id = '10000001'
       and operation_id in (
         'integration-task-cas-a',
         'integration-task-cas-b'
       )
  ),
  'losing task CAS session left an event behind'
);
select enterprise_integration.assert_true(
  (
    select count(*) = 1
      from public.merchant_idempotency_keys
     where merchant_id = '10000001'
       and idempotency_key in (
         'enterprise-task:integration-task-cas-a',
         'enterprise-task:integration-task-cas-b'
       )
  ),
  'losing task CAS session left an idempotency claim behind'
);

select id::text as cas_invite_employee,
       version as cas_invite_version,
       invitation_version as cas_invitation_version
  from public.merchant_enterprise_employees
 where merchant_id = '10000001' and email = 'cas-invite@example.test'
\gset

select enterprise_integration.assert_true(
  :cas_invite_version = 2
  and :cas_invitation_version = 1
  and (
    select invitation_token_hash in (repeat('b', 64), repeat('c', 64))
      from public.merchant_enterprise_employees
     where id = :'cas_invite_employee'::uuid
  ),
  'invitation CAS did not reserve exactly one token'
);
select enterprise_integration.assert_true(
  (
    select count(*) = 1
      from public.merchant_enterprise_audit_events
     where merchant_id = '10000001'
       and entity_id = :'cas_invite_employee'::uuid
       and event_type = 'invitation.reserved'
  ),
  'losing invitation CAS session left an audit event behind'
);

-- Revoke the winning invitation with the current employee version, then prove
-- stale CAS and post-revocation acceptance are both rejected.
set role service_role;
select public.faolla_revoke_merchant_employee_invitation_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'employee_id', :'cas_invite_employee',
    'expected_version', :cas_invite_version,
    'actor_type', 'owner',
    'actor_id', '10000000-0000-4000-8000-000000000001'
  )
);
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_revoke_merchant_employee_invitation_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'employee_id', %L,
          'expected_version', 2,
          'actor_type', 'owner',
          'actor_id', '10000000-0000-4000-8000-000000000001'
        )
      )
    $sql$,
    :'cas_invite_employee'
  ),
  'enterprise_version_conflict'
);
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_bind_merchant_employee_auth_user_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'employee_id', %L,
          'auth_user_id', '60000000-0000-4000-8000-000000000006',
          'expected_version', 3,
          'invitation_version', 2
        )
      )
    $sql$,
    :'cas_invite_employee'
  ),
  'employee_invitation_revoked'
);
reset role;

select enterprise_integration.assert_true(
  (
    select version = 3
       and invitation_version = 2
       and invitation_revoked_at is not null
       and invitation_delivery_status = 'revoked'
      from public.merchant_enterprise_employees
     where id = :'cas_invite_employee'::uuid
  ),
  'invitation revoke did not commit its CAS transition'
);

select enterprise_integration.assert_true(
  not exists (
    select 1
      from public.merchant_task_events
     where operation_id in (
       'integration-cross-merchant-task',
       'integration-forged-owner-task'
     )
  ),
  'rejected security probes left task history behind'
);

\echo 'Concurrent enterprise PostgreSQL acceptance checks passed.'
