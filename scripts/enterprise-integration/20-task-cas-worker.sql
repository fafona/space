\set ON_ERROR_STOP on
set role service_role;

select public.faolla_update_merchant_task_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'task_id', (
      select task_id::text
        from public.merchant_task_events
       where merchant_id = '10000001'
         and operation_id = 'integration-task-cas-create'
    ),
    'expected_version', 1,
    'title', :'worker_title',
    'replace_assignees', false,
    'actor_type', 'owner',
    'actor_id', '10000000-0000-4000-8000-000000000001',
    'operation_id', :'worker_operation',
    'event_type', 'updated',
    'event_payload', jsonb_build_object('worker', :'worker_operation')
  )
);
