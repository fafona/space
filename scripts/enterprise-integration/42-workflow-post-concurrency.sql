\set ON_ERROR_STOP on
\pset pager off

drop trigger aaa_enterprise_integration_delay_workflow_cas
  on public.merchant_enterprise_workflows;
drop function enterprise_integration.delay_workflow_cas_row();

select workflow_id::text as workflow_cas_id
  from public.merchant_enterprise_workflow_steps
 where merchant_id = '10000001'
   and id = '72200000-0000-4000-8000-000000000001'::uuid
\gset

select enterprise_integration.assert_true(
  (
    select version = 2
      and title in ('Workflow CAS worker A', 'Workflow CAS worker B')
      and status = 'draft'
      and published_version = 0
    from public.merchant_enterprise_workflows
    where merchant_id = '10000001'
      and id = :'workflow_cas_id'::uuid
  ),
  'workflow CAS did not produce exactly one draft version increment'
);
select enterprise_integration.assert_true(
  (
    select count(*) = 1
    from public.merchant_enterprise_audit_events
    where merchant_id = '10000001'
      and entity_id = :'workflow_cas_id'::uuid
      and event_type = 'workflow.updated'
      and operation_id in (
        'integration-workflow-cas-a',
        'integration-workflow-cas-b'
      )
  ),
  'losing workflow CAS session left an audit event behind'
);
select enterprise_integration.assert_true(
  (
    select count(*) = 1
    from public.merchant_idempotency_keys
    where merchant_id = '10000001'
      and idempotency_key in (
        'enterprise-workflow-update-v1:integration-workflow-cas-a',
        'enterprise-workflow-update-v1:integration-workflow-cas-b'
      )
  ),
  'losing workflow CAS session left an idempotency claim behind'
);
select enterprise_integration.assert_true(
  (
    select count(*) = 1 and min(version) >= 3
    from public.merchant_enterprise_workflow_steps
    where merchant_id = '10000001'
      and workflow_id = :'workflow_cas_id'::uuid
      and status = 'active'
  ),
  'workflow CAS corrupted the ordered draft step set'
);

\echo 'Concurrent workflow PostgreSQL acceptance checks passed.'
