\set ON_ERROR_STOP on
\pset pager off

set role service_role;

select public.faolla_update_merchant_enterprise_workflow_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'workflow_id', :'restore_target',
    'expected_version', 1,
    'action', 'restore',
    'actor_type', 'employee',
    'actor_id', '71000000-0000-4000-8000-000000000002',
    'operation_id', :'restore_operation'
  )
);
