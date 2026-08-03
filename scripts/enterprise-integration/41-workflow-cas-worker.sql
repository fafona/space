\set ON_ERROR_STOP on
select workflow_id::text as cas_workflow_id
  from public.merchant_enterprise_workflow_steps
 where merchant_id = '10000001'
   and id = '72200000-0000-4000-8000-000000000001'::uuid
\gset

set role service_role;

select public.faolla_update_merchant_enterprise_workflow_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'workflow_id', :'cas_workflow_id',
    'expected_version', 1,
    'action', 'save',
    'title', :'worker_title',
    'scenario', 'Two writers save the same version',
    'description', '',
    'category', 'Integration',
    'tags', '[]'::jsonb,
    'steps', jsonb_build_array(
      jsonb_build_object(
        'id', '72200000-0000-4000-8000-000000000001',
        'title', 'Serialize',
        'instruction', 'Only one writer may commit.',
        'position', 0
      )
    ),
    'actor_type', 'owner',
    'actor_id', '10000000-0000-4000-8000-000000000001',
    'operation_id', :'worker_operation'
  )
);
