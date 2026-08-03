\set ON_ERROR_STOP on
\pset pager off

drop trigger zzz_enterprise_integration_delay_workflow_restore
  on public.merchant_enterprise_workflows;
drop function enterprise_integration.delay_workflow_restore_row();

select
  workflow.id::text as restore_winner_id,
  case workflow.id
    when '73000000-0000-4000-8000-000000000001'::uuid
      then 'integration-workflow-restore-limit-a'
    else 'integration-workflow-restore-limit-b'
  end as restore_winner_operation
from public.merchant_enterprise_workflows as workflow
where workflow.merchant_id = '10000001'
  and workflow.id in (
    '73000000-0000-4000-8000-000000000001'::uuid,
    '73000000-0000-4000-8000-000000000002'::uuid
  )
  and workflow.status <> 'archived'
\gset

select
  workflow.id::text as restore_remaining_id
from public.merchant_enterprise_workflows as workflow
where workflow.merchant_id = '10000001'
  and workflow.id in (
    '73000000-0000-4000-8000-000000000001'::uuid,
    '73000000-0000-4000-8000-000000000002'::uuid
  )
  and workflow.status = 'archived'
\gset

select enterprise_integration.assert_true(
  (
    select count(*) = 200
    from public.merchant_enterprise_workflows
    where merchant_id = '10000001' and status <> 'archived'
  )
  and (
    select count(*) = 1
    from public.merchant_enterprise_workflows
    where merchant_id = '10000001'
      and id in (
        '73000000-0000-4000-8000-000000000001'::uuid,
        '73000000-0000-4000-8000-000000000002'::uuid
      )
      and status <> 'archived'
      and version = 2
  )
  and (
    select count(*) = 1
    from public.merchant_enterprise_workflows
    where merchant_id = '10000001'
      and id in (
        '73000000-0000-4000-8000-000000000001'::uuid,
        '73000000-0000-4000-8000-000000000002'::uuid
      )
      and status = 'archived'
      and version = 1
  ),
  'restore capacity race did not stop exactly at 200 active workflows'
);

select enterprise_integration.assert_true(
  (
    select count(*) = 1
    from public.merchant_enterprise_audit_events
    where merchant_id = '10000001'
      and entity_id in (
        '73000000-0000-4000-8000-000000000001'::uuid,
        '73000000-0000-4000-8000-000000000002'::uuid
      )
      and event_type = 'workflow.restored'
      and operation_id in (
        'integration-workflow-restore-limit-a',
        'integration-workflow-restore-limit-b'
      )
  )
  and (
    select count(*) = 1
    from public.merchant_idempotency_keys
    where merchant_id = '10000001'
      and idempotency_key in (
        'enterprise-workflow-update-v1:integration-workflow-restore-limit-a',
        'enterprise-workflow-update-v1:integration-workflow-restore-limit-b'
      )
      and status = 'completed'
  ),
  'losing restore-capacity session left audit/idempotency residue'
);

-- An exact replay of the winning request must return the cached response even
-- though the tenant is now at capacity.
set role service_role;
select enterprise_integration.assert_true(
  (
    public.faolla_update_merchant_enterprise_workflow_v1(
      jsonb_build_object(
        'merchant_id', '10000001',
        'workflow_id', :'restore_winner_id',
        'expected_version', 1,
        'action', 'restore',
        'actor_type', 'employee',
        'actor_id', '71000000-0000-4000-8000-000000000002',
        'operation_id', :'restore_winner_operation'
      )
    ) -> 'workflow' ->> 'id'
  ) = :'restore_winner_id',
  'winning restore replay did not return its cached response at capacity'
);

-- A fresh operation against the remaining archived target is rejected; the
-- failed statement rolls its idempotency claim and audit work back atomically.
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_update_merchant_enterprise_workflow_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'workflow_id', %L,
          'expected_version', 1,
          'action', 'restore',
          'actor_type', 'employee',
          'actor_id', '71000000-0000-4000-8000-000000000002',
          'operation_id', 'integration-workflow-restore-after-cap'
        )
      )
    $sql$,
    :'restore_remaining_id'
  ),
  'workflow_limit_reached'
);
reset role;

select enterprise_integration.assert_true(
  (
    select status = 'archived' and version = 1
    from public.merchant_enterprise_workflows
    where merchant_id = '10000001'
      and id = :'restore_remaining_id'::uuid
  )
  and not exists (
    select 1
    from public.merchant_idempotency_keys
    where merchant_id = '10000001'
      and idempotency_key =
        'enterprise-workflow-update-v1:integration-workflow-restore-after-cap'
  )
  and not exists (
    select 1
    from public.merchant_enterprise_audit_events
    where merchant_id = '10000001'
      and operation_id = 'integration-workflow-restore-after-cap'
  ),
  'post-capacity restore failure changed state or left transaction residue'
);

\echo 'Concurrent workflow restore-capacity checks passed.'
